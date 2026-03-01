import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useControllerSubscription, useControllerSurface } from "../controller";
import type { MusicLoopMode } from "../constants/musicSettings";
import { useGlobalMusic } from "../hooks/useGlobalMusic";
import { playHoverSound, playSelectSound } from "../utils/audio";

function isEditableElement(target: Element | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (isEditableElement(target instanceof Element ? target : null)) return true;
  return isEditableElement(document.activeElement);
}

function formatPlaybackStatus({
  enabled,
  isPlaying,
  isSuppressedByVideo,
}: {
  enabled: boolean;
  isPlaying: boolean;
  isSuppressedByVideo: boolean;
}): string {
  if (isSuppressedByVideo) return "Blocked by foreground video";
  if (!enabled) return "Music disabled";
  return isPlaying ? "Now playing" : "Ready to play";
}

export function GlobalMusicOverlay() {
  const {
    enabled,
    queue,
    currentTrack,
    isPlaying,
    isSuppressedByVideo,
    volume,
    shuffle,
    loopMode,
    setEnabled,
    addTracks,
    clearQueue,
    play,
    pause,
    next,
    previous,
    setCurrentTrack,
    setVolume,
    setShuffle,
    setLoopMode,
  } = useGlobalMusic();
  const [open, setOpen] = useState(false);
  const [isAddingTracks, setIsAddingTracks] = useState(false);
  const [showQueue, setShowQueue] = useState(true);
  const [volumeDraft, setVolumeDraft] = useState(() => Math.round(volume * 100));
  const overlayRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setVolumeDraft(Math.round(volume * 100));
  }, [volume]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "m" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        if (!open && isEditableTarget(event.target)) return;
        setOpen((current) => !current);
        return;
      }
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const statusLabel = useMemo(
    () => formatPlaybackStatus({ enabled, isPlaying, isSuppressedByVideo }),
    [enabled, isPlaying, isSuppressedByVideo],
  );

  const addSelectedTracks = async () => {
    if (isAddingTracks) return;
    setIsAddingTracks(true);
    try {
      const filePaths = await window.electronAPI.dialog.selectMusicFiles();
      if (filePaths.length === 0) return;
      await addTracks(filePaths);
    } catch (error) {
      console.error("Failed to add music tracks", error);
    } finally {
      setIsAddingTracks(false);
    }
  };

  const togglePlayback = async () => {
    playSelectSound();
    if (isPlaying) {
      pause();
      return;
    }
    if (isSuppressedByVideo || !enabled || !currentTrack) return;
    await play();
  };

  const commitVolumeDraft = async () => {
    await setVolume(volumeDraft / 100);
  };

  const handleToggleOverlay = useCallback(() => {
    setOpen((current) => !current);
  }, []);

  useControllerSubscription(useCallback((action) => {
    if (action === "START") {
      handleToggleOverlay();
    }
  }, [handleToggleOverlay]));

  useControllerSurface({
    id: "global-music-overlay",
    scopeRef: overlayRef,
    priority: 240,
    enabled: open,
    initialFocusId: "music-enabled-toggle",
    onBack: () => {
      setOpen(false);
      return true;
    },
  });

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="music-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[240] flex items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.14),_transparent_34%),linear-gradient(180deg,rgba(8,12,20,0.88),rgba(5,8,14,0.96))] px-3 py-3 sm:px-4 sm:py-4 backdrop-blur-md"
          onClick={() => setOpen(false)}
        >
          <motion.section
            ref={overlayRef}
            initial={{ opacity: 0, y: 28, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 240, damping: 24 }}
            onClick={(event) => event.stopPropagation()}
            className="relative flex max-h-[calc(100vh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-[2rem] border border-white/12 bg-[linear-gradient(145deg,rgba(18,28,46,0.95),rgba(9,12,22,0.98))] text-zinc-100 shadow-[0_32px_120px_rgba(0,0,0,0.55)] sm:max-h-[calc(100vh-2rem)]"
            role="dialog"
            aria-modal="true"
            aria-label="Global music controls"
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.18),_transparent_30%),radial-gradient(circle_at_80%_18%,_rgba(251,191,36,0.16),_transparent_22%),linear-gradient(180deg,transparent,rgba(255,255,255,0.02))]" />

            <div className="relative border-b border-white/10 px-5 py-5 sm:px-7">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-2xl">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-cyan-200/80">Global Music</p>
                  <h2 className="mt-2 text-3xl font-black tracking-tight text-white">Control the soundtrack from anywhere</h2>
                  <p className="mt-2 text-sm text-zinc-300">
                    Press <span className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs font-semibold text-white">Ctrl+M</span> to toggle this overlay.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onMouseEnter={playHoverSound}
                    onClick={() => {
                      playSelectSound();
                      void setEnabled(!enabled);
                    }}
                    className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${enabled
                      ? "border-emerald-300/50 bg-emerald-400/15 text-emerald-100"
                      : "border-zinc-600 bg-black/30 text-zinc-300"
                      }`}
                    data-controller-focus-id="music-enabled-toggle"
                    data-controller-initial="true"
                  >
                    {enabled ? "Music On" : "Music Off"}
                  </button>
                  <button
                    type="button"
                    onMouseEnter={playHoverSound}
                    onClick={() => {
                      playSelectSound();
                      setOpen(false);
                    }}
                    className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:bg-white/10"
                    aria-label="Close music overlay"
                    data-controller-focus-id="music-close"
                    data-controller-back="true"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>

            <div className="relative min-h-0 overflow-y-auto">
              <div className="grid gap-5 px-4 py-4 sm:px-5 sm:py-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)] lg:px-7">
              <div className="space-y-5">
                <div className="rounded-[1.6rem] border border-white/10 bg-black/25 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-200/75">{statusLabel}</p>
                      <div className="mt-3 truncate text-2xl font-black text-white">
                        {currentTrack?.name ?? "No track selected"}
                      </div>
                      <div className="mt-1 truncate text-sm text-zinc-400">
                        {currentTrack?.filePath ?? "Add local audio files to start a queue."}
                      </div>
                    </div>
                    {isSuppressedByVideo ? (
                      <div className="rounded-2xl border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
                        Playback is paused while a foreground video is active.
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-6 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onMouseEnter={playHoverSound}
                      onClick={() => {
                        playSelectSound();
                        void previous();
                      }}
                      className="rounded-2xl border border-white/12 bg-white/5 px-4 py-3 text-sm font-semibold text-zinc-100 transition hover:bg-white/10"
                      data-controller-focus-id="music-previous"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      onMouseEnter={playHoverSound}
                      onClick={() => {
                        void togglePlayback();
                      }}
                      disabled={!currentTrack || !enabled || isSuppressedByVideo}
                      className={`rounded-2xl px-6 py-3 text-sm font-semibold transition ${!currentTrack || !enabled || isSuppressedByVideo
                        ? "cursor-not-allowed border border-zinc-700 bg-zinc-900 text-zinc-500"
                        : "border border-cyan-300/45 bg-cyan-400/20 text-cyan-50 shadow-[0_0_30px_rgba(34,211,238,0.16)] hover:bg-cyan-400/28"
                        }`}
                      data-controller-focus-id="music-toggle-playback"
                    >
                      {isPlaying ? "Pause" : "Play"}
                    </button>
                    <button
                      type="button"
                      onMouseEnter={playHoverSound}
                      onClick={() => {
                        playSelectSound();
                        void next();
                      }}
                      className="rounded-2xl border border-white/12 bg-white/5 px-4 py-3 text-sm font-semibold text-zinc-100 transition hover:bg-white/10"
                      data-controller-focus-id="music-next"
                    >
                      Next
                    </button>
                    <button
                      type="button"
                      onMouseEnter={playHoverSound}
                      onClick={() => {
                        playSelectSound();
                        void addSelectedTracks();
                      }}
                      disabled={isAddingTracks}
                      className={`rounded-2xl px-4 py-3 text-sm font-semibold transition ${isAddingTracks
                        ? "cursor-not-allowed border border-zinc-700 bg-zinc-900 text-zinc-500"
                        : "border border-amber-300/45 bg-amber-300/15 text-amber-50 hover:bg-amber-300/24"
                        }`}
                      data-controller-focus-id="music-add-tracks"
                    >
                      {isAddingTracks ? "Adding..." : "Add Tracks"}
                    </button>
                    <button
                      type="button"
                      onMouseEnter={playHoverSound}
                      onClick={() => {
                        playSelectSound();
                        setShowQueue((current) => !current);
                      }}
                      className="rounded-2xl border border-white/12 bg-white/5 px-4 py-3 text-sm font-semibold text-zinc-100 transition hover:bg-white/10"
                      data-controller-focus-id="music-toggle-queue"
                    >
                      {showQueue ? "Hide Queue" : "Show Queue"}
                    </button>
                  </div>
                </div>

                <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(220px,260px)]">
                  <div className="rounded-[1.6rem] border border-white/10 bg-black/25 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-lg font-bold text-white">Queue</p>
                        <p className="text-sm text-zinc-400">{queue.length} tracks ready</p>
                      </div>
                      <button
                        type="button"
                        disabled={queue.length === 0}
                        onMouseEnter={playHoverSound}
                        onClick={() => {
                          playSelectSound();
                          void clearQueue();
                        }}
                        className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${queue.length === 0
                          ? "cursor-not-allowed border-zinc-700 bg-zinc-900 text-zinc-500"
                          : "border-rose-300/40 bg-rose-400/12 text-rose-100 hover:bg-rose-400/20"
                          }`}
                      >
                        Clear Queue
                      </button>
                    </div>

                    {showQueue ? (
                      <div className="mt-4 max-h-[min(320px,40vh)] space-y-2 overflow-y-auto pr-1">
                        {queue.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-white/12 bg-white/[0.03] px-4 py-8 text-center text-sm text-zinc-400">
                            Your queue is empty.
                          </div>
                        ) : (
                          queue.map((entry) => {
                            const isCurrent = currentTrack?.id === entry.id;
                            return (
                              <button
                                key={entry.id}
                                type="button"
                                onClick={() => {
                                  playSelectSound();
                                  void setCurrentTrack(entry.id);
                                }}
                                className={`block w-full rounded-2xl border px-4 py-3 text-left transition ${isCurrent
                                  ? "border-cyan-300/45 bg-cyan-400/12 shadow-[0_0_24px_rgba(34,211,238,0.08)]"
                                  : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                                  }`}
                              >
                                <div className="truncate text-sm font-semibold text-zinc-100">{entry.name}</div>
                                <div className="mt-1 truncate text-xs text-zinc-500">{entry.filePath}</div>
                              </button>
                            );
                          })
                        )}
                      </div>
                    ) : (
                      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-5 text-sm text-zinc-400">
                        Queue hidden.
                      </div>
                    )}
                  </div>

                  <div className="space-y-5">
                    <div className="rounded-[1.6rem] border border-white/10 bg-black/25 p-5">
                      <p className="text-lg font-bold text-white">Volume</p>
                      <p className="mt-1 text-sm text-zinc-400">{volumeDraft}%</p>
                      <input
                        aria-label="Music volume"
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={volumeDraft}
                        onChange={(event) => {
                          setVolumeDraft(Number(event.target.value));
                        }}
                        onMouseUp={() => {
                          void commitVolumeDraft();
                        }}
                        onTouchEnd={() => {
                          void commitVolumeDraft();
                        }}
                        onKeyUp={() => {
                          void commitVolumeDraft();
                        }}
                        onBlur={() => {
                          void commitVolumeDraft();
                        }}
                        className="mt-4 w-full accent-cyan-300"
                      />
                    </div>

                    <div className="rounded-[1.6rem] border border-white/10 bg-black/25 p-5">
                      <p className="text-lg font-bold text-white">Shuffle</p>
                      <p className="mt-1 text-sm text-zinc-400">Randomize track advancement.</p>
                      <button
                        type="button"
                        aria-pressed={shuffle}
                        onMouseEnter={playHoverSound}
                        onClick={() => {
                          playSelectSound();
                          void setShuffle(!shuffle);
                        }}
                        className={`mt-4 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${shuffle
                          ? "border-cyan-300/45 bg-cyan-400/18 text-cyan-50"
                          : "border-white/12 bg-white/5 text-zinc-200"
                          }`}
                      >
                        {shuffle ? "Shuffle On" : "Shuffle Off"}
                      </button>
                    </div>

                    <div className="rounded-[1.6rem] border border-white/10 bg-black/25 p-5">
                      <p className="text-lg font-bold text-white">Loop Mode</p>
                      <div className="mt-4 grid gap-2">
                        {([
                          ["queue", "Loop Queue"],
                          ["track", "Loop Track"],
                          ["off", "Off"],
                        ] as const satisfies ReadonlyArray<readonly [MusicLoopMode, string]>).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            onMouseEnter={playHoverSound}
                            onClick={() => {
                              playSelectSound();
                              void setLoopMode(value);
                            }}
                            className={`rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition ${loopMode === value
                              ? "border-amber-300/45 bg-amber-300/16 text-amber-50"
                              : "border-white/12 bg-white/5 text-zinc-200 hover:bg-white/10"
                              }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <aside className="rounded-[1.8rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-zinc-400">Now Loaded</p>
                <div className="mt-4 rounded-[1.5rem] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.16),transparent_45%),rgba(255,255,255,0.03)] p-5">
                  <div className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-100/75">Current Track</div>
                  <div className="mt-4 text-3xl font-black leading-tight text-white">
                    {currentTrack?.name ?? "Silence"}
                  </div>
                  <div className="mt-3 text-sm text-zinc-300">
                    {currentTrack
                      ? "Pinned to your global queue and carried across routes."
                      : "Pick a local audio file to fill the room."}
                  </div>
                </div>

                <div className="mt-5 space-y-3 rounded-[1.5rem] border border-white/10 bg-black/20 p-5 text-sm text-zinc-300">
                  <div className="flex items-center justify-between gap-3">
                    <span>Status</span>
                    <span className="font-semibold text-white">{statusLabel}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Queue Size</span>
                    <span className="font-semibold text-white">{queue.length}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Shortcut</span>
                    <span className="font-semibold text-white">Ctrl+M</span>
                  </div>
                </div>

                <div className="mt-5 rounded-[1.5rem] border border-amber-300/20 bg-amber-300/8 p-5 text-sm text-amber-50">
                  Music will not start while foreground video playback is active. The overlay stays available, but play remains blocked until the video stops.
                </div>
              </aside>
              </div>
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
