import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AnimatedBackground } from "../components/AnimatedBackground";
import { DEFAULT_INTERMEDIARY_LOADING_PROMPT } from "../constants/booruSettings";
import { useHandy } from "../contexts/HandyContext";
import { useGlobalMusic } from "../hooks/useGlobalMusic";
import { db } from "../services/db";
import { importOpenedFile } from "../services/openedFiles";
import { trpc } from "../services/trpc";
import { playHoverSound, playSelectSound } from "../utils/audio";

const FIRST_START_COMPLETED_KEY = "app.firstStart.completed";
const INTERMEDIARY_LOADING_PROMPT_KEY = "game.intermediary.loadingPrompt";

type ReturnTarget = "menu" | "settings";

function normalizeReturnTarget(value: unknown): ReturnTarget {
  return value === "settings" ? "settings" : "menu";
}

type StepDefinition = {
  id: string;
  icon: string;
  shortLabel: string;
  eyebrow: string;
  title: string;
  description: string;
  details: string[];
  interactive?: "music" | "round-packs" | "booru" | "handy";
};

const STEPS: StepDefinition[] = [
  {
    id: "welcome",
    icon: "🎮",
    shortLabel: "Welcome",
    eyebrow: "Start Here",
    title: "What Fap Land Party Edition is and how the two play modes work",
    description:
      "Fap Land Party Edition is a board-game style app. You move across a map, trigger rounds, and try to finish with a strong score and a good run.",
    details: [
      "Fap and cockheroes are like guitarhero for your dick. You masturbate up AND down per beat. When a beat hits, you are down at the shaft. Normally there is a beatbar. You can also automate this using thehandy",
      "Singleplayer is the solo mode. You build or choose a playlist, play alone, and try to survive the board, clear rounds, and push your personal highscore as far as you can.",
      "Multiplayer is the shared mode. Several players run the same board setup and compare how well they do. The goal is to outscore the other players and finish the match in a better state than they do.",
      "Both modes use rounds as the core content. The board decides what happens next, and your choices change how risky or rewarding the run becomes.",
    ],
  },
  {
    id: "heroes",
    icon: "📦",
    shortLabel: "Content",
    eyebrow: "Content",
    title: "How to add fap or cock heroes and round content",
    description:
      "Heroes and rounds are the content packs the game uses during play. If you do not add any, the game has very little to work with.",
    details: [
      "You can import a single `.hero` or `.round` file. That is the direct way to add one hero or one round pack at a time.",
      "You can also add a whole folder as a source. Fap Land Party Edition scans that folder right away, imports what it understands, and checks it again on later app starts.",
      "Imported content shows up in Installed Rounds. From there you can review what was added, edit metadata, and use the rounds in playlists and maps.",
      "Making your own packs is also pretty easy. You can use the Round Converter to turn source material into playable rounds, then organize them with the Playlist Workshop or Map Editor.",
      "Exporting your own work is meant to be simple too. Once your rounds or playlists are ready, the app gives you direct export paths so sharing packs is not a complicated process.",
    ],
  },
  {
    id: "music",
    icon: "🎵",
    shortLabel: "Music",
    eyebrow: "Optional Setup",
    title: "Install some music for the menus and downtime",
    description:
      "Music is optional, but it makes the app feel much more alive. Fap Land Party Edition can keep a global music queue running while you move through menus.",
    details: [
      "Music does not replace your round videos. It is background audio for the app when no foreground video is actively playing.",
      "You can add normal audio files from your computer. The game stores them in a queue, and you can reorder or remove them later in Settings.",
      "If you want, you can skip this now and come back later.",
    ],
    interactive: "music",
  },
  {
    id: "round-packs",
    icon: "💿",
    shortLabel: "Rounds",
    eyebrow: "Optional Setup",
    title: "Install some round packs now",
    description:
      "Round packs are the gameplay library. This is the content the board pulls from when a round starts.",
    details: [
      "Adding a folder is best when you already keep your packs together in one place. The app scans the folder and imports supported content.",
      "Importing a single file is better when someone sent you one `.hero` or `.round` file and you just want that item.",
      "You can install content now, or skip this and manage it later from Installed Rounds or Settings.",
    ],
    interactive: "round-packs",
  },
  {
    id: "maps",
    icon: "🗺️",
    shortLabel: "Maps",
    eyebrow: "Creation",
    title: "Linear maps, graph maps, and their two editors",
    description:
      "Fap Land Party Edition supports two board styles, because not every run should feel the same.",
    details: [
      "A linear map is a straight path. It is easier to understand, quicker to build, and good when you want a classic start-to-finish run.",
      "A graph map is a branching board with nodes and connections. It gives you more control, more choice, and more advanced route design.",
      "Because those two map styles work differently, the app has two editors: Playlist Workshop for linear boards, and Map Editor for graph boards.",
      "If you want to build your own pack, the usual flow is simple: create rounds in the Round Converter, place them into a linear or graph board, then export the finished result.",
      "That means you do not need a hard workflow to start making content. The converter, the editors, and the export tools are built so custom pack creation stays approachable.",
    ],
  },
  {
    id: "handy",
    icon: "🔌",
    shortLabel: "Hardware",
    eyebrow: "Hardware",
    title: "Linking your Handy device",
    description:
      "Connect your Handy device for synchronized motion support. This is optional but enhances the experience.",
    details: [
      "Enter your Handy connection key below to connect directly. You can find this key in the Handy app or on the device.",
      "If you do not own a Handy, skip this step. You can still use the app and play the game without hardware.",
      "You can always connect or change settings later in Settings > Hardware & Sync.",
    ],
    interactive: "handy",
  },
  {
    id: "booru",
    icon: "🔍",
    shortLabel: "Media",
    eyebrow: "Intermediary Media",
    title: "Choose a booru search prompt",
    description:
      "Fap Land Party Edition can use a booru search prompt for intermediary loading media. If you do nothing, the default prompt stays in place.",
    details: [
      "This prompt tells the app what kind of media it should look for during loading and intermediary moments.",
      "A simple, specific prompt usually works better than a long one. You can keep the default if you are unsure.",
      "You can change this later in Settings under Gameplay.",
    ],
    interactive: "booru",
  },
];

export const Route = createFileRoute("/first-start")({
  validateSearch: (search: Record<string, unknown>) => ({
    returnTo: normalizeReturnTarget(search.returnTo),
  }),
  component: FirstStartPage,
});

function FirstStartPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const { queue, addTracks } = useGlobalMusic();
  const {
    connectionKey,
    connected: handyConnected,
    isConnecting: handyIsConnecting,
    error: handyError,
    connect: handyConnect,
    disconnect: handyDisconnect,
  } = useHandy();
  const [stepIndex, setStepIndex] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [musicMessage, setMusicMessage] = useState<string | null>(null);
  const [roundMessage, setRoundMessage] = useState<string | null>(null);
  const [booruPrompt, setBooruPrompt] = useState(DEFAULT_INTERMEDIARY_LOADING_PROMPT);
  const [isLoadingPrompt, setIsLoadingPrompt] = useState(true);
  const [isSkipping, setIsSkipping] = useState(false);
  const [contentKey, setContentKey] = useState(0);
  const [handyInputKey, setHandyInputKey] = useState("");
  const stepNavRef = useRef<HTMLDivElement | null>(null);
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const currentStep = STEPS[stepIndex] ?? STEPS[0]!;
  const isLastStep = stepIndex >= STEPS.length - 1;
  const isContinueDisabled = isBusy || (currentStep.id === "booru" && isLoadingPrompt);
  const progressPercent = ((stepIndex + 1) / STEPS.length) * 100;

  useEffect(() => {
    let cancelled = false;
    void trpc.store.get
      .query({ key: INTERMEDIARY_LOADING_PROMPT_KEY })
      .then((value) => {
        if (cancelled) return;
        const nextPrompt =
          typeof value === "string" && value.trim().length > 0
            ? value.trim()
            : DEFAULT_INTERMEDIARY_LOADING_PROMPT;
        setBooruPrompt(nextPrompt);
      })
      .catch((error) => {
        console.error("Failed to load onboarding booru prompt", error);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingPrompt(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (connectionKey) {
      setHandyInputKey(connectionKey);
    }
  }, [connectionKey]);

  useEffect(() => {
    const stepNav = stepNavRef.current;
    if (stepNav) {
      const activeStep = stepNav.querySelector<HTMLElement>(`[data-step-index="${stepIndex}"]`);
      activeStep?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }

    contentScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    setContentKey((k) => k + 1);
  }, [stepIndex]);

  const finish = async () => {
    await trpc.store.set.mutate({ key: FIRST_START_COMPLETED_KEY, value: true });
    await navigate({ to: search.returnTo === "settings" ? "/settings" : "/" });
  };

  const skip = async () => {
    setIsSkipping(true);
    await finish();
  };

  const goNext = async () => {
    if (currentStep.id === "booru") {
      const value =
        booruPrompt.trim().length > 0 ? booruPrompt.trim() : DEFAULT_INTERMEDIARY_LOADING_PROMPT;
      await trpc.store.set.mutate({ key: INTERMEDIARY_LOADING_PROMPT_KEY, value });
      setBooruPrompt(value);
    }

    if (isLastStep) {
      await finish();
      return;
    }

    setStepIndex((current) => Math.min(STEPS.length - 1, current + 1));
  };

  const addMusicTracks = async () => {
    if (isBusy) return;
    setIsBusy(true);
    setMusicMessage(null);
    try {
      const filePaths = await window.electronAPI.dialog.selectMusicFiles();
      if (filePaths.length === 0) {
        setMusicMessage(
          "No music files were selected. You can continue and add them later in Settings."
        );
        return;
      }
      await addTracks(filePaths);
      setMusicMessage(
        `Added ${filePaths.length} track${filePaths.length === 1 ? "" : "s"} to the global music queue.`
      );
    } catch (error) {
      console.error("Failed to add onboarding music tracks", error);
      setMusicMessage(error instanceof Error ? error.message : "Failed to add music files.");
    } finally {
      setIsBusy(false);
    }
  };

  const addRoundFolder = async () => {
    if (isBusy) return;
    setIsBusy(true);
    setRoundMessage(null);
    try {
      const selectedFolders = await window.electronAPI.dialog.selectFolders();
      if (selectedFolders.length === 0) {
        setRoundMessage("No folder was selected. You can continue and import content later.");
        return;
      }

      const folderPath = selectedFolders[0]!;
      const added = await db.install.addAutoScanFolderAndScan(folderPath);
      const stats = added.result.status.stats;
      setRoundMessage(
        `Imported folder. Installed ${stats.installed} rounds, imported ${stats.playlistsImported} playlists, updated ${stats.updated}, and failed ${stats.failed}.`
      );
    } catch (error) {
      console.error("Failed to add onboarding round folder", error);
      setRoundMessage(
        error instanceof Error ? error.message : "Failed to import the selected folder."
      );
    } finally {
      setIsBusy(false);
    }
  };

  const importHeroOrRound = async () => {
    if (isBusy) return;
    setIsBusy(true);
    setRoundMessage(null);
    try {
      const filePath = await window.electronAPI.dialog.selectInstallImportFile();
      if (!filePath) {
        setRoundMessage(
          "No file was selected. You can continue and import files later from Installed Rounds."
        );
        return;
      }

      const result = await importOpenedFile(filePath);
      if (result.kind === "sidecar") {
        const stats = result.result.status.stats;
        setRoundMessage(
          `Imported file. Installed ${stats.installed} rounds, imported ${stats.playlistsImported} playlists, updated ${stats.updated}, and failed ${stats.failed}.`
        );
        return;
      }

      if (result.kind === "playlist") {
        setRoundMessage(
          "A playlist file was imported. You can edit it later in Playlist Workshop."
        );
        return;
      }

      setRoundMessage("That file type is not supported here.");
    } catch (error) {
      console.error("Failed to import onboarding hero or round", error);
      setRoundMessage(
        error instanceof Error ? error.message : "Failed to import the selected file."
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleHandyConnect = async () => {
    if (handyConnected) {
      await handyDisconnect();
      return;
    }
    await handyConnect(handyInputKey.trim());
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <AnimatedBackground />

      <div className="relative z-10 flex h-screen items-center justify-center px-3 py-4 sm:px-6 sm:py-6">
        <div className="parallax-ui-none flex h-full w-full max-w-[1600px] flex-col rounded-[2rem] border border-violet-300/20 bg-zinc-950/80 p-4 shadow-[0_0_60px_rgba(139,92,246,0.2)] backdrop-blur-xl sm:p-5">
          {/* ── Header ── */}
          <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <p
                  className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.35em] text-violet-300/70 animate-entrance"
                  style={{ animationDelay: "0.1s" }}
                >
                  Getting Started
                </p>
                <div className="h-px flex-1 bg-gradient-to-r from-violet-400/30 via-violet-400/10 to-transparent" />
              </div>
              <h1
                className="text-2xl font-black tracking-tight text-white sm:text-3xl xl:text-4xl animate-entrance"
                style={{ animationDelay: "0.2s" }}
              >
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-200 via-purple-100 to-indigo-200 drop-shadow-[0_0_20px_rgba(139,92,246,0.5)]">
                  Welcome to Fap Land
                </span>
              </h1>
              <p
                className="max-w-xl text-sm text-zinc-400 animate-entrance"
                style={{ animationDelay: "0.3s" }}
              >
                Let's get you set up. This quick walkthrough covers the essentials and lets you
                import content right away.
              </p>
            </div>

            <button
              type="button"
              disabled={isSkipping}
              onMouseEnter={playHoverSound}
              onClick={() => {
                playSelectSound();
                void skip();
              }}
              className={`group relative flex items-center gap-2 self-start rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all animate-entrance ${
                isSkipping
                  ? "cursor-not-allowed border-zinc-600/50 bg-zinc-800/50 text-zinc-500"
                  : "border-zinc-500/40 bg-zinc-900/60 text-zinc-300 hover:border-violet-400/50 hover:bg-zinc-800/80 hover:text-violet-100"
              }`}
              style={{ animationDelay: "0.4s" }}
            >
              <span className="absolute inset-0 rounded-xl opacity-0 transition-opacity group-hover:opacity-100 bg-gradient-to-r from-violet-500/5 to-indigo-500/5" />
              {isSkipping ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-500 border-t-zinc-300" />
                  <span>Skipping...</span>
                </>
              ) : (
                <>
                  <span>⏭</span>
                  <span>Skip Setup</span>
                </>
              )}
            </button>
          </header>

          {/* ── Progress Bar ── */}
          <div className="mt-4 animate-entrance" style={{ animationDelay: "0.5s" }}>
            <div className="flex items-center gap-3">
              <span className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                {stepIndex + 1} / {STEPS.length}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800/80">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-500 via-purple-500 to-indigo-500 transition-all duration-500 ease-out shadow-[0_0_10px_rgba(139,92,246,0.5)]"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <span className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-violet-400/80">
                {Math.round(progressPercent)}%
              </span>
            </div>
          </div>

          {/* ── Main Content ── */}
          <div className="mt-4 grid min-h-0 flex-1 gap-4 lg:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)]">
            {/* ── Step Navigation ── */}
            <aside
              className="min-h-0 overflow-y-auto rounded-2xl border border-zinc-800/60 bg-black/30 p-3 backdrop-blur-sm animate-entrance"
              style={{ animationDelay: "0.6s" }}
            >
              <div ref={stepNavRef} className="relative">
                {/* Progress Line */}
                <div className="absolute left-[18px] top-4 bottom-4 w-0.5 bg-zinc-800" />
                <div
                  className="absolute left-[18px] top-4 w-0.5 bg-gradient-to-b from-violet-500 to-purple-500 transition-all duration-500"
                  style={{ height: `${(stepIndex / (STEPS.length - 1)) * 100}%` }}
                />

                <div className="space-y-1">
                  {STEPS.map((step, index) => {
                    const active = index === stepIndex;
                    const complete = index < stepIndex;
                    return (
                      <button
                        key={step.id}
                        type="button"
                        data-step-index={index}
                        onClick={() => {
                          playSelectSound();
                          setStepIndex(index);
                        }}
                        className={`relative flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-all ${
                          active
                            ? "bg-violet-500/15 text-white"
                            : complete
                              ? "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                              : "text-zinc-500 hover:bg-zinc-800/30 hover:text-zinc-400"
                        }`}
                      >
                        {/* Step Indicator */}
                        <span
                          className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm transition-all ${
                            active
                              ? "bg-violet-500/30 ring-2 ring-violet-400/50 shadow-[0_0_12px_rgba(139,92,246,0.4)]"
                              : complete
                                ? "bg-emerald-500/20 ring-1 ring-emerald-400/30"
                                : "bg-zinc-800 ring-1 ring-zinc-700"
                          }`}
                        >
                          {complete ? (
                            <span className="text-emerald-400">✓</span>
                          ) : (
                            <span>{step.icon}</span>
                          )}
                        </span>

                        {/* Step Label */}
                        <span
                          className={`text-xs font-medium transition-all ${
                            active
                              ? "text-violet-100"
                              : complete
                                ? "text-zinc-300"
                                : "text-zinc-500"
                          }`}
                        >
                          {step.shortLabel}
                        </span>

                        {active && (
                          <span className="absolute right-2 text-violet-400/60 animate-pulse">
                            ▶
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </aside>

            {/* ── Content Section ── */}
            <section className="flex min-h-0 flex-col rounded-2xl border border-zinc-800/60 bg-black/30 p-4 backdrop-blur-sm sm:p-5">
              <div
                key={contentKey}
                className="animate-entrance-fade"
                style={{ animationDuration: "0.3s" }}
              >
                {/* Eyebrow */}
                <div className="flex items-center gap-2">
                  <span className="text-lg">{currentStep.icon}</span>
                  <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.25em] text-cyan-300/70">
                    {currentStep.eyebrow}
                  </p>
                </div>

                {/* Title */}
                <h2 className="mt-2 max-w-[28ch] text-xl font-bold leading-tight tracking-tight text-white sm:text-2xl xl:text-3xl">
                  {currentStep.title}
                </h2>

                {/* Description */}
                <p className="mt-2 text-sm leading-relaxed text-zinc-300 sm:text-base">
                  {currentStep.description}
                </p>
              </div>

              {/* Details */}
              <div
                ref={contentScrollRef}
                className="mt-4 min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1"
              >
                {currentStep.details.map((detail, idx) => (
                  <div
                    key={detail}
                    className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 px-3.5 py-3 text-sm leading-relaxed text-zinc-400 animate-entrance"
                    style={{ animationDelay: `${0.1 + idx * 0.05}s` }}
                  >
                    {detail}
                  </div>
                ))}

                {/* Music Section */}
                {currentStep.interactive === "music" && (
                  <div
                    className="mt-3 rounded-2xl border border-violet-400/30 bg-gradient-to-br from-violet-500/10 via-purple-500/5 to-indigo-500/10 p-4 animate-entrance"
                    style={{ animationDelay: "0.3s" }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-violet-400">🎵</span>
                      <p className="text-sm font-semibold text-violet-200">Music Queue</p>
                      {queue.length > 0 && (
                        <span className="ml-auto rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                          {queue.length} track{queue.length === 1 ? "" : "s"}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-zinc-400">
                      Pick music files from your computer to add them to the global queue.
                    </p>
                    <button
                      type="button"
                      disabled={isBusy}
                      onMouseEnter={playHoverSound}
                      onClick={() => {
                        playSelectSound();
                        void addMusicTracks();
                      }}
                      className={`mt-3 flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all ${
                        isBusy
                          ? "cursor-not-allowed border-zinc-600/50 bg-zinc-800/50 text-zinc-500"
                          : "border-violet-400/50 bg-violet-500/20 text-violet-100 hover:border-violet-300/70 hover:bg-violet-500/30 hover:shadow-[0_0_20px_rgba(139,92,246,0.3)]"
                      }`}
                    >
                      {isBusy ? (
                        <>
                          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-violet-400/30 border-t-violet-300" />
                          <span>Adding...</span>
                        </>
                      ) : (
                        <>
                          <span>📁</span>
                          <span>Add Music Files</span>
                        </>
                      )}
                    </button>
                    {musicMessage && (
                      <div
                        className={`mt-3 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${
                          musicMessage.includes("Added")
                            ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                            : "border-cyan-400/30 bg-cyan-500/10 text-cyan-200"
                        }`}
                      >
                        <span>{musicMessage.includes("Added") ? "✓" : "ℹ"}</span>
                        <span>{musicMessage}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Round Packs Section */}
                {currentStep.interactive === "round-packs" && (
                  <div
                    className="mt-3 rounded-2xl border border-cyan-400/30 bg-gradient-to-br from-cyan-500/10 via-blue-500/5 to-indigo-500/10 p-4 animate-entrance"
                    style={{ animationDelay: "0.3s" }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-cyan-400">💿</span>
                      <p className="text-sm font-semibold text-cyan-200">Import Content</p>
                    </div>
                    <p className="text-sm text-zinc-400">
                      Add a content folder or import a single hero/round file.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={isBusy}
                        onMouseEnter={playHoverSound}
                        onClick={() => {
                          playSelectSound();
                          void addRoundFolder();
                        }}
                        className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all ${
                          isBusy
                            ? "cursor-not-allowed border-zinc-600/50 bg-zinc-800/50 text-zinc-500"
                            : "border-violet-400/50 bg-violet-500/20 text-violet-100 hover:border-violet-300/70 hover:bg-violet-500/30 hover:shadow-[0_0_20px_rgba(139,92,246,0.3)]"
                        }`}
                      >
                        {isBusy ? (
                          <>
                            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-violet-400/30 border-t-violet-300" />
                            <span>Working...</span>
                          </>
                        ) : (
                          <>
                            <span>📁</span>
                            <span>Add Folder</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onMouseEnter={playHoverSound}
                        onClick={() => {
                          playSelectSound();
                          void importHeroOrRound();
                        }}
                        className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all ${
                          isBusy
                            ? "cursor-not-allowed border-zinc-600/50 bg-zinc-800/50 text-zinc-500"
                            : "border-cyan-400/50 bg-cyan-500/20 text-cyan-100 hover:border-cyan-300/70 hover:bg-cyan-500/30 hover:shadow-[0_0_20px_rgba(34,211,238,0.3)]"
                        }`}
                      >
                        {isBusy ? (
                          <>
                            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-cyan-400/30 border-t-cyan-300" />
                            <span>Working...</span>
                          </>
                        ) : (
                          <>
                            <span>📄</span>
                            <span>Import File</span>
                          </>
                        )}
                      </button>
                    </div>
                    {roundMessage && (
                      <div
                        className={`mt-3 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${
                          roundMessage.includes("Imported")
                            ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                            : "border-cyan-400/30 bg-cyan-500/10 text-cyan-200"
                        }`}
                      >
                        <span>{roundMessage.includes("Imported") ? "✓" : "ℹ"}</span>
                        <span>{roundMessage}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Booru Section */}
                {currentStep.interactive === "booru" && (
                  <div
                    className="mt-3 rounded-2xl border border-pink-400/30 bg-gradient-to-br from-pink-500/10 via-rose-500/5 to-fuchsia-500/10 p-4 animate-entrance"
                    style={{ animationDelay: "0.3s" }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-pink-400">🔍</span>
                      <p className="text-sm font-semibold text-pink-200">Search Prompt</p>
                    </div>
                    <p className="text-sm text-zinc-400">
                      This determines what media appears during loading. Keep the default if unsure.
                    </p>
                    <textarea
                      id="first-start-booru-prompt"
                      value={booruPrompt}
                      disabled={isLoadingPrompt}
                      onChange={(event) => setBooruPrompt(event.target.value)}
                      className="mt-3 min-h-24 w-full rounded-xl border border-zinc-700/60 bg-zinc-900/60 px-3.5 py-3 text-sm text-white outline-none transition-all focus:border-pink-400/50 focus:ring-2 focus:ring-pink-400/20 disabled:opacity-60"
                      placeholder="Enter search prompt..."
                    />
                  </div>
                )}

                {/* Handy Section */}
                {currentStep.interactive === "handy" && (
                  <div
                    className="mt-3 rounded-2xl border border-emerald-400/30 bg-gradient-to-br from-emerald-500/10 via-green-500/5 to-teal-500/10 p-4 animate-entrance"
                    style={{ animationDelay: "0.3s" }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-emerald-400">🔌</span>
                      <p className="text-sm font-semibold text-emerald-200">Device Connection</p>
                      {handyConnected && (
                        <span className="ml-auto rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                          Connected
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-zinc-400">
                      Enter your Handy connection key to enable synchronized motion.
                    </p>
                    <div className="mt-3 flex flex-col gap-2">
                      <label
                        className="ml-1 font-[family-name:var(--font-jetbrains-mono)] text-xs font-bold uppercase tracking-wider text-zinc-300"
                        htmlFor="first-start-handy-key"
                      >
                        Connection Key
                      </label>
                      <input
                        id="first-start-handy-key"
                        type="text"
                        value={handyInputKey}
                        onChange={(event) => setHandyInputKey(event.target.value)}
                        placeholder="Enter connection key from Handy app"
                        disabled={handyConnected || handyIsConnecting}
                        className="rounded-xl border border-zinc-700/60 bg-zinc-900/60 px-3.5 py-3 text-sm text-white outline-none transition-all focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/20 disabled:opacity-60"
                      />
                    </div>
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 mt-3 text-xs font-[family-name:var(--font-jetbrains-mono)] text-amber-200">
                      Only firmware version 4 and up is supported.
                    </div>
                    {handyError && (
                      <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-200">
                        <span>⚠</span>
                        <span>{handyError}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      disabled={handyIsConnecting || (!handyConnected && !handyInputKey.trim())}
                      onMouseEnter={playHoverSound}
                      onClick={() => {
                        playSelectSound();
                        void handleHandyConnect();
                      }}
                      className={`mt-3 flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all ${
                        handyIsConnecting
                          ? "cursor-not-allowed border-zinc-600/50 bg-zinc-800/50 text-zinc-500"
                          : handyConnected
                            ? "border-rose-400/50 bg-rose-500/20 text-rose-100 hover:border-rose-300/70 hover:bg-rose-500/30"
                            : "border-emerald-400/50 bg-emerald-500/20 text-emerald-100 hover:border-emerald-300/70 hover:bg-emerald-500/30 hover:shadow-[0_0_20px_rgba(16,185,129,0.3)]"
                      }`}
                    >
                      {handyIsConnecting ? (
                        <>
                          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-emerald-400/30 border-t-emerald-300" />
                          <span>Connecting...</span>
                        </>
                      ) : handyConnected ? (
                        <>
                          <span>⏹</span>
                          <span>Disconnect</span>
                        </>
                      ) : (
                        <>
                          <span>🔌</span>
                          <span>Connect</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>

              {/* ── Footer Navigation ── */}
              <div className="mt-4 flex flex-col gap-3 border-t border-zinc-800/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  disabled={stepIndex === 0}
                  onMouseEnter={playHoverSound}
                  onClick={() => {
                    playSelectSound();
                    setStepIndex((current) => Math.max(0, current - 1));
                  }}
                  className={`group flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all ${
                    stepIndex === 0
                      ? "cursor-not-allowed border-zinc-800/50 bg-zinc-900/30 text-zinc-600"
                      : "border-zinc-600/40 bg-zinc-900/60 text-zinc-300 hover:border-zinc-500/60 hover:bg-zinc-800/80 hover:text-white"
                  }`}
                >
                  <span
                    className={`transition-transform ${stepIndex === 0 ? "" : "group-hover:-translate-x-1"}`}
                  >
                    ←
                  </span>
                  <span>Back</span>
                </button>

                <div className="flex flex-wrap gap-2 sm:justify-end">
                  <button
                    type="button"
                    disabled={isSkipping}
                    onMouseEnter={playHoverSound}
                    onClick={() => {
                      playSelectSound();
                      void skip();
                    }}
                    className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all ${
                      isSkipping
                        ? "cursor-not-allowed border-zinc-600/50 bg-zinc-800/50 text-zinc-500"
                        : "border-zinc-600/40 bg-zinc-900/60 text-zinc-400 hover:border-zinc-500/60 hover:bg-zinc-800/80 hover:text-zinc-200"
                    }`}
                  >
                    <span>⏭</span>
                    <span>Skip All</span>
                  </button>
                  <button
                    type="button"
                    disabled={isContinueDisabled}
                    onMouseEnter={playHoverSound}
                    onClick={() => {
                      playSelectSound();
                      void goNext();
                    }}
                    className={`group relative flex items-center gap-2 overflow-hidden rounded-xl border px-5 py-2.5 text-sm font-semibold transition-all ${
                      isContinueDisabled
                        ? "cursor-not-allowed border-zinc-700/50 bg-zinc-800/50 text-zinc-500"
                        : "border-violet-400/50 bg-gradient-to-r from-violet-600/80 via-purple-600/80 to-indigo-600/80 text-white hover:border-violet-300/70 hover:shadow-[0_0_25px_rgba(139,92,246,0.4)]"
                    }`}
                  >
                    <span className="absolute inset-0 bg-gradient-to-r from-violet-500/0 via-white/10 to-violet-500/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
                    <span>
                      {isLastStep
                        ? search.returnTo === "settings"
                          ? "Finish"
                          : "Start Playing"
                        : "Continue"}
                    </span>
                    <span
                      className={`transition-transform ${isContinueDisabled ? "" : "group-hover:translate-x-1"}`}
                    >
                      →
                    </span>
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
