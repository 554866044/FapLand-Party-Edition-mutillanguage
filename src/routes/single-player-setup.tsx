import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatedBackground } from "../components/AnimatedBackground";
import { MenuButton } from "../components/MenuButton";
import { PlaylistMapPreview } from "../components/PlaylistMapPreview";
import { PlaylistLaunchTransition } from "../components/game/PlaylistLaunchTransition";
import { useControllerSurface } from "../controller";
import type { PlaylistConfig } from "../game/playlistSchema";
import { resolvePortableRoundRef } from "../game/playlistRuntime";
import { db, type InstalledRound } from "../services/db";
import { playlists, type StoredPlaylist } from "../services/playlists";
import { formatDurationLabel, getRoundDurationSec } from "../utils/duration";
import { playHoverSound, playSelectSound, playPlaylistLaunchSound } from "../utils/audio";

const withActivePlaylist = (playlistsToShow: StoredPlaylist[], activePlaylist: StoredPlaylist | null): StoredPlaylist[] => {
  if (!activePlaylist) return playlistsToShow;
  if (playlistsToShow.some((playlist) => playlist.id === activePlaylist.id)) {
    return playlistsToShow;
  }
  return [activePlaylist, ...playlistsToShow];
};

const describeBoard = (config: PlaylistConfig): {
  modeLabel: string;
  nodeCount: number;
  edgeCount: number;
  safePointCount: number;
  roundNodeCount: number;
} => {
  if (config.boardConfig.mode === "linear") {
    return {
      modeLabel: "Linear",
      nodeCount: config.boardConfig.totalIndices + 1,
      edgeCount: config.boardConfig.totalIndices,
      safePointCount: config.boardConfig.safePointIndices.length,
      roundNodeCount: config.boardConfig.totalIndices - config.boardConfig.safePointIndices.length,
    };
  }

  return {
    modeLabel: "Graph",
    nodeCount: config.boardConfig.nodes.length,
    edgeCount: config.boardConfig.edges.length,
    safePointCount: config.boardConfig.nodes.filter((node) => node.kind === "safePoint").length,
    roundNodeCount: config.boardConfig.nodes.filter((node) => node.kind === "round" || node.kind === "randomRound").length,
  };
};

const estimatePlaylistDurationSec = (config: PlaylistConfig, installedRounds: InstalledRound[]): number => {
  if (config.boardConfig.mode === "linear") {
    const safeSet = new Set(config.boardConfig.safePointIndices);
    const explicitRefsByIndex = config.boardConfig.normalRoundRefsByIndex;
    let orderedCursor = 0;
    let totalDurationSec = 0;

    for (let fieldIndex = 1; fieldIndex <= config.boardConfig.totalIndices; fieldIndex += 1) {
      if (safeSet.has(fieldIndex)) continue;
      const ref = explicitRefsByIndex[String(fieldIndex)] ?? config.boardConfig.normalRoundOrder[orderedCursor] ?? null;
      if (!(String(fieldIndex) in explicitRefsByIndex)) {
        orderedCursor += 1;
      }
      if (!ref) continue;
      const round = resolvePortableRoundRef(ref, installedRounds);
      if (!round) continue;
      totalDurationSec += getRoundDurationSec(round);
    }

    return totalDurationSec;
  }

  return config.boardConfig.nodes.reduce((total, node) => {
    if (!node.roundRef) return total;
    const round = resolvePortableRoundRef(node.roundRef, installedRounds);
    if (!round) return total;
    return total + getRoundDurationSec(round);
  }, 0);
};

const PLAYLIST_LAUNCH_DURATION_MS = 2500;

type LaunchState =
  | { kind: "idle" }
  | { kind: "animating"; startedAt: number };

export const Route = createFileRoute("/single-player-setup")({
  loader: async () => {
    const [availablePlaylists, installedRounds] = await Promise.all([
      playlists.list(),
      db.round.findInstalled(),
    ]);
    const activePlaylist = availablePlaylists.length > 0 ? await playlists.getActive() : null;

    return {
      availablePlaylists: withActivePlaylist(availablePlaylists, activePlaylist),
      activePlaylist,
      installedRounds,
    };
  },
  component: SinglePlayerSetupRoute,
});

export function SinglePlayerSetupRoute() {
  const navigate = useNavigate();
  const { availablePlaylists, activePlaylist, installedRounds } = Route.useLoaderData() as {
    availablePlaylists: StoredPlaylist[];
    activePlaylist: StoredPlaylist | null;
    installedRounds: InstalledRound[];
  };
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(activePlaylist?.id ?? availablePlaylists[0]?.id ?? null);
  const [pendingAction, setPendingAction] = useState<"start" | "workshop" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [launchState, setLaunchState] = useState<LaunchState>({ kind: "idle" });
  const [launchProgress, setLaunchProgress] = useState(0);
  const scopeRef = useRef<HTMLDivElement | null>(null);
  const goBack = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    void navigate({ to: "/" });
  };

  const selectedPlaylist = useMemo(
    () => availablePlaylists.find((playlist) => playlist.id === selectedPlaylistId) ?? activePlaylist ?? null,
    [activePlaylist, availablePlaylists, selectedPlaylistId],
  );

  const boardSummary = useMemo(
    () => (selectedPlaylist ? describeBoard(selectedPlaylist.config) : null),
    [selectedPlaylist],
  );
  const selectedPlaylistDurationSec = useMemo(
    () => (selectedPlaylist ? estimatePlaylistDurationSec(selectedPlaylist.config, installedRounds) : 0),
    [installedRounds, selectedPlaylist],
  );
  const isLaunchAnimating = launchState.kind === "animating";

  useEffect(() => {
    if (launchState.kind !== "animating") {
      setLaunchProgress(0);
      return;
    }

    let rafId = 0;
    const step = () => {
      const elapsed = performance.now() - launchState.startedAt;
      setLaunchProgress(Math.max(0, Math.min(1, elapsed / PLAYLIST_LAUNCH_DURATION_MS)));
      rafId = window.requestAnimationFrame(step);
    };

    step();
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [launchState]);

  const activateSelectedPlaylist = async () => {
    if (!selectedPlaylist) {
      throw new Error("No playlist selected.");
    }
    await playlists.setActive(selectedPlaylist.id);
  };

  const handleStart = async () => {
    if (pendingAction || !selectedPlaylist) return;
    setPendingAction("start");
    setNotice(null);
    try {
      await activateSelectedPlaylist();
      playPlaylistLaunchSound();
      setLaunchState({ kind: "animating", startedAt: performance.now() });
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, PLAYLIST_LAUNCH_DURATION_MS);
      });
      await navigate({
        to: "/game",
        search: {
          playlistId: selectedPlaylist.id,
          launchNonce: Date.now(),
        },
      });
    } catch (error) {
      console.error("Failed to start selected playlist", error);
      setLaunchState({ kind: "idle" });
      setNotice("Failed to start selected playlist.");
    } finally {
      setPendingAction(null);
    }
  };

  const handleOpenWorkshop = async () => {
    if (pendingAction) return;
    setPendingAction("workshop");
    setNotice(null);
    try {
      await activateSelectedPlaylist();
      await navigate({ to: "/playlist-workshop" });
    } catch (error) {
      console.error("Failed to open playlist workshop", error);
      setNotice("Failed to open playlist workshop.");
    } finally {
      setPendingAction(null);
    }
  };

  useControllerSurface({
    id: "single-player-setup-route",
    scopeRef,
    priority: 10,
    initialFocusId: selectedPlaylist ? `single-playlist-${selectedPlaylist.id}` : "single-open-workshop",
    onBack: () => {
      goBack();
      return true;
    },
  });

  if (!selectedPlaylist || !boardSummary) {
    return (
      <div ref={scopeRef} className="relative min-h-screen overflow-hidden">
        <AnimatedBackground />

        <div className="relative z-10 h-screen overflow-y-auto px-4 py-8 sm:px-8">
          <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 pb-6">
            <header
              className="animate-entrance rounded-3xl border border-purple-400/35 bg-zinc-950/60 p-6 backdrop-blur-xl shadow-[0_0_50px_rgba(139,92,246,0.28)] noise"
              style={{ animationDelay: "0.05s" }}
            >
              <button
                type="button"
                onMouseEnter={playHoverSound}
                onClick={() => {
                  playSelectSound();
                  goBack();
                }}
                className="rounded-xl border border-violet-300/55 bg-violet-500/20 px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] text-violet-100 transition-all duration-200 hover:border-violet-200/80 hover:bg-violet-500/35"
              >
                Go Back
              </button>
              <p className="font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.45em] text-purple-200/85">
                Single Player
              </p>
              <h1 className="mt-3 text-3xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-violet-200 via-purple-100 to-indigo-200 sm:text-5xl drop-shadow-[0_0_30px_rgba(139,92,246,0.4)]">
                No Playlist Yet
              </h1>
              <p className="mt-3 text-sm text-zinc-300/80">
                Create a playlist or import one first, then start your run.
              </p>
            </header>

            <section
              className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
              style={{ animationDelay: "0.12s" }}
            >
              <p className="text-sm text-zinc-200">
                Open the playlist workshop to build a linear playlist, or use the map editor if you want a graph-based board.
              </p>
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                <MenuButton
                  label="Open Playlist Workshop"
                  primary
                  onHover={playHoverSound}
                  onClick={() => {
                    playSelectSound();
                    void navigate({ to: "/playlist-workshop" });
                  }}
                  controllerFocusId="single-open-workshop"
                  controllerInitial
                />
                <MenuButton
                  label="Open Map Editor"
                  onHover={playHoverSound}
                  onClick={() => {
                    playSelectSound();
                    void navigate({ to: "/map-editor" });
                  }}
                  controllerFocusId="single-open-map-editor"
                />
              </div>
            </section>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div ref={scopeRef} className="relative min-h-screen overflow-hidden">
      <AnimatedBackground />
      <PlaylistLaunchTransition
        visible={isLaunchAnimating}
        playlistName={selectedPlaylist.name}
        boardModeLabel={boardSummary.modeLabel}
        roundCount={boardSummary.roundNodeCount}
        estimatedDurationLabel={formatDurationLabel(selectedPlaylistDurationSec)}
        progress={launchProgress}
      />

      <div
        className={`relative z-10 flex h-screen flex-col overflow-hidden lg:flex-row ${isLaunchAnimating ? "pointer-events-none" : ""
          }`}
        style={{
          opacity: isLaunchAnimating ? 1 - launchProgress * 0.8 : 1,
          filter: isLaunchAnimating ? `blur(${launchProgress * 20}px) saturate(${1 - launchProgress * 0.4}) brightness(${1 - launchProgress * 0.6})` : "none",
          transform: isLaunchAnimating ? `scale(${1 + launchProgress * 0.08})` : "scale(1)",
        }}
      >
        <aside className="animate-entrance flex shrink-0 flex-col border-b border-purple-400/20 bg-zinc-950/70 backdrop-blur-xl lg:w-[24rem] lg:border-b-0 lg:border-r">
          <div className="border-b border-purple-400/15 px-4 py-4 sm:px-6 lg:px-5 lg:py-5">
            <p className="font-[family-name:var(--font-jetbrains-mono)] text-[0.65rem] uppercase tracking-[0.42em] text-purple-200/75">
              Single Player
            </p>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-violet-200 via-purple-100 to-indigo-200 drop-shadow-[0_0_20px_rgba(139,92,246,0.4)]">
              Pick And Start
            </h1>
            <p className="mt-2 text-sm text-zinc-400">
              Choose a playlist on the left, then start immediately from the main panel.
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 lg:px-3 lg:py-4">
            <div className="mb-3 flex items-center justify-between px-2">
              <h2 className="font-[family-name:var(--font-jetbrains-mono)] text-[0.65rem] uppercase tracking-[0.28em] text-violet-300/80">
                Playlists
              </h2>
              <span className="rounded-full border border-zinc-700/70 bg-black/30 px-2 py-1 text-[10px] font-[family-name:var(--font-jetbrains-mono)] uppercase tracking-[0.16em] text-zinc-400">
                {availablePlaylists.length} total
              </span>
            </div>

            <div className="grid gap-2">
              {availablePlaylists.map((playlist) => {
                const isSelected = playlist.id === selectedPlaylist.id;
                const isActive = playlist.id === activePlaylist?.id;
                const summary = describeBoard(playlist.config);
                const estimatedDurationSec = estimatePlaylistDurationSec(playlist.config, installedRounds);
                const isLinear = summary.modeLabel === "Linear";

                return (
                  <button
                    key={playlist.id}
                    type="button"
                    onMouseEnter={playHoverSound}
                    onFocus={playHoverSound}
                    onClick={() => {
                      playSelectSound();
                      setSelectedPlaylistId(playlist.id);
                    }}
                    data-controller-focus-id={`single-playlist-${playlist.id}`}
                    data-controller-initial={playlist.id === selectedPlaylist.id ? "true" : undefined}
                    className={`settings-sidebar-item min-w-0 text-left ${isSelected ? "is-active" : ""}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm font-semibold text-zinc-100">{playlist.name}</span>
                        <span
                          className={[
                            "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em]",
                            isLinear
                              ? "border-teal-400/45 bg-teal-500/15 text-teal-200"
                              : "border-amber-400/45 bg-amber-500/15 text-amber-200",
                          ].join(" ")}
                        >
                          {summary.modeLabel}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] font-[family-name:var(--font-jetbrains-mono)] uppercase tracking-[0.14em] text-zinc-400">
                        <span>{summary.roundNodeCount} rounds</span>
                        <span>•</span>
                        <span>{formatDurationLabel(estimatedDurationSec)}</span>
                        {isActive && (
                          <>
                            <span>•</span>
                            <span className="text-emerald-200">Active</span>
                          </>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-purple-400/15 px-4 py-4 sm:px-6 lg:px-4 lg:py-4">
            <MenuButton
              label="← Back"
              subLabel="Return to main menu"
              onHover={playHoverSound}
              onClick={() => {
                playSelectSound();
                goBack();
              }}
              controllerBack
            />
          </div>
        </aside>

        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          <main className="mx-auto flex w-full max-w-5xl flex-col gap-5">
            <section
              className="animate-entrance rounded-3xl border border-purple-400/30 bg-zinc-950/60 p-5 backdrop-blur-xl shadow-[0_0_40px_rgba(139,92,246,0.18)]"
              style={{ animationDelay: "0.08s" }}
            >
              <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                <div className="max-w-2xl">
                  <p className="font-[family-name:var(--font-jetbrains-mono)] text-[0.65rem] uppercase tracking-[0.38em] text-emerald-200/85">
                    Ready To Play
                  </p>
                  <h2 className="mt-2 text-3xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-violet-100 via-white to-emerald-100 sm:text-4xl">
                    {selectedPlaylist.name}
                  </h2>
                  <p className="mt-2 text-sm text-zinc-300/85">
                    {selectedPlaylist.description ?? "No description"}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-[family-name:var(--font-jetbrains-mono)] uppercase tracking-[0.16em] text-zinc-300">
                    <span className="rounded-full border border-violet-400/30 bg-violet-500/10 px-3 py-1.5">
                      {boardSummary.modeLabel} board
                    </span>
                    <span className="rounded-full border border-zinc-700/70 bg-black/30 px-3 py-1.5">
                      {Math.max(0, boardSummary.roundNodeCount)} rounds
                    </span>
                    <span className="rounded-full border border-zinc-700/70 bg-black/30 px-3 py-1.5">
                      {boardSummary.safePointCount} safe points
                    </span>
                    <span className="rounded-full border border-zinc-700/70 bg-black/30 px-3 py-1.5">
                      {formatDurationLabel(selectedPlaylistDurationSec)} estimated
                    </span>
                    <span className="rounded-full border border-zinc-700/70 bg-black/30 px-3 py-1.5">
                      v{selectedPlaylist.config.playlistVersion}
                    </span>
                  </div>
                  {notice && (
                    <p className="mt-3 text-sm text-rose-200">{notice}</p>
                  )}
                </div>

                <div className="w-full max-w-xl xl:min-w-[24rem]">
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                    <div className="single-player-start-cta rounded-2xl border border-emerald-300/25 bg-emerald-500/8 p-2">
                      <div className="mb-2 flex items-center justify-between gap-3 px-2">
                        <span className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.24em] text-emerald-200/85">
                          Primary Action
                        </span>
                        <span className="rounded-full border border-emerald-300/35 bg-emerald-400/15 px-2 py-1 text-[9px] font-[family-name:var(--font-jetbrains-mono)] uppercase tracking-[0.18em] text-emerald-100">
                          Start Here
                        </span>
                      </div>
                      <MenuButton
                        label={pendingAction === "start" ? "Starting..." : "Start Selected Playlist"}
                        subLabel="Fastest path into a round"
                        primary
                        onHover={playHoverSound}
                        onClick={() => {
                          playSelectSound();
                          void handleStart();
                        }}
                        controllerFocusId="single-start"
                      />
                    </div>
                    <MenuButton
                      label={pendingAction === "workshop" ? "Opening Workshop..." : "Open Playlist Workshop"}
                      subLabel="Edit this playlist before playing"
                      onHover={playHoverSound}
                      onClick={() => {
                        playSelectSound();
                        void handleOpenWorkshop();
                      }}
                      controllerFocusId="single-workshop"
                    />
                  </div>
                </div>
              </div>
            </section>

            <section className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
              <div
                className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-4 backdrop-blur-xl"
                style={{ animationDelay: "0.14s" }}
              >
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.26em] text-zinc-400">
                      Map Preview
                    </p>
                    <p className="mt-1 text-sm text-zinc-400">Verify the board and start.</p>
                  </div>
                </div>
                <div className="playlist-preview-frame rounded-2xl border border-violet-300/20 bg-black/35 p-3">
                  <PlaylistMapPreview config={selectedPlaylist.config} className="h-[210px] w-full sm:h-[240px]" />
                </div>
              </div>

              <div
                className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
                style={{ animationDelay: "0.18s" }}
              >
                <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.26em] text-zinc-400">
                  Run Summary
                </p>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-zinc-700/60 bg-black/30 p-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Nodes</p>
                    <p className="mt-1 text-2xl font-black text-violet-100">{boardSummary.nodeCount}</p>
                  </div>
                  <div className="rounded-2xl border border-zinc-700/60 bg-black/30 p-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Edges</p>
                    <p className="mt-1 text-2xl font-black text-violet-100">{boardSummary.edgeCount}</p>
                  </div>
                  <div className="rounded-2xl border border-zinc-700/60 bg-black/30 p-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Rounds</p>
                    <p className="mt-1 text-2xl font-black text-violet-100">{Math.max(0, boardSummary.roundNodeCount)}</p>
                  </div>
                  <div className="rounded-2xl border border-zinc-700/60 bg-black/30 p-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Safe Points</p>
                    <p className="mt-1 text-2xl font-black text-violet-100">{boardSummary.safePointCount}</p>
                  </div>
                </div>
                <div className="mt-4 rounded-2xl border border-emerald-400/25 bg-emerald-500/10 p-4">
                  <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-emerald-200/80">
                    Quick Start
                  </p>
                  <p className="mt-2 text-sm text-emerald-50">
                    Start uses the selected playlist immediately and drops you straight into the run.
                  </p>
                </div>
              </div>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}
