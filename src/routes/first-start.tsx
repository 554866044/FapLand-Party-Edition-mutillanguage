import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatedBackground } from "../components/AnimatedBackground";
import { DEFAULT_INTERMEDIARY_LOADING_PROMPT } from "../constants/booruSettings";
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
  eyebrow: string;
  title: string;
  description: string;
  details: string[];
};

const STEPS: StepDefinition[] = [
  {
    id: "welcome",
    eyebrow: "Start Here",
    title: "What Fap Land Party Edition is and how the two play modes work",
    description: "Fap Land Party Edition is a board-game style app. You move across a map, trigger rounds, and try to finish with a strong score and a good run.",
    details: [
      "Singleplayer is the solo mode. You build or choose a playlist, play alone, and try to survive the board, clear rounds, and push your personal highscore as far as you can.",
      "Multiplayer is the shared mode. Several players run the same board setup and compare how well they do. The goal is to outscore the other players and finish the match in a better state than they do.",
      "Both modes use rounds as the core content. The board decides what happens next, and your choices change how risky or rewarding the run becomes.",
    ],
  },
  {
    id: "heroes",
    eyebrow: "Content",
    title: "How to add fap or cock heroes and round content",
    description: "Heroes and rounds are the content packs the game uses during play. If you do not add any, the game has very little to work with.",
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
    eyebrow: "Optional Setup",
    title: "Install some music for the menus and downtime",
    description: "Music is optional, but it makes the app feel much more alive. Fap Land Party Edition can keep a global music queue running while you move through menus.",
    details: [
      "Music does not replace your round videos. It is background audio for the app when no foreground video is actively playing.",
      "You can add normal audio files from your computer. The game stores them in a queue, and you can reorder or remove them later in Settings.",
      "If you want, you can skip this now and come back later.",
    ],
  },
  {
    id: "round-packs",
    eyebrow: "Optional Setup",
    title: "Install some round packs now",
    description: "Round packs are the gameplay library. This is the content the board pulls from when a round starts.",
    details: [
      "Adding a folder is best when you already keep your packs together in one place. The app scans the folder and imports supported content.",
      "Importing a single file is better when someone sent you one `.hero` or `.round` file and you just want that item.",
      "You can install content now, or skip this and manage it later from Installed Rounds or Settings.",
    ],
  },
  {
    id: "maps",
    eyebrow: "Creation",
    title: "Linear maps, graph maps, and their two editors",
    description: "Fap Land Party Edition supports two board styles, because not every run should feel the same.",
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
    eyebrow: "Hardware",
    title: "Linking your Handy device",
    description: "You can link your Handy in Settings. It is not required to own one, but the experience is much better if you do.",
    details: [
      "If you have a Handy, open Settings and go to Hardware & Sync. There you can paste the connection key and connect the device.",
      "If you do not own one, that is fine. You can still use the rest of the app, build content, and play the game without hardware.",
      "The hardware link adds synchronized motion support, so this step is worth doing later if you have the device nearby.",
    ],
  },
  {
    id: "booru",
    eyebrow: "Intermediary Media",
    title: "Choose a booru search prompt",
    description: "Fap Land Party Edition can use a booru search prompt for intermediary loading media. If you do nothing, the default prompt stays in place.",
    details: [
      "This prompt tells the app what kind of media it should look for during loading and intermediary moments.",
      "A simple, specific prompt usually works better than a long one. You can keep the default if you are unsure.",
      "You can change this later in Settings under Gameplay.",
    ],
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
  const {
    queue,
    addTracks,
  } = useGlobalMusic();
  const [stepIndex, setStepIndex] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [musicMessage, setMusicMessage] = useState<string | null>(null);
  const [roundMessage, setRoundMessage] = useState<string | null>(null);
  const [booruPrompt, setBooruPrompt] = useState(DEFAULT_INTERMEDIARY_LOADING_PROMPT);
  const [isLoadingPrompt, setIsLoadingPrompt] = useState(true);
  const stepNavRef = useRef<HTMLDivElement | null>(null);
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const currentStep = STEPS[stepIndex] ?? STEPS[0]!;
  const isLastStep = stepIndex >= STEPS.length - 1;
  const isContinueDisabled = isBusy || (currentStep.id === "booru" && isLoadingPrompt);

  useEffect(() => {
    let cancelled = false;
    void trpc.store.get.query({ key: INTERMEDIARY_LOADING_PROMPT_KEY }).then((value) => {
      if (cancelled) return;
      const nextPrompt =
        typeof value === "string" && value.trim().length > 0
          ? value.trim()
          : DEFAULT_INTERMEDIARY_LOADING_PROMPT;
      setBooruPrompt(nextPrompt);
    }).catch((error) => {
      console.error("Failed to load onboarding booru prompt", error);
    }).finally(() => {
      if (!cancelled) {
        setIsLoadingPrompt(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const stepNav = stepNavRef.current;
    if (stepNav) {
      const activeStep = stepNav.querySelector<HTMLElement>(`[data-step-index="${stepIndex}"]`);
      activeStep?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }

    contentScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [stepIndex]);

  const progressLabel = useMemo(
    () => `Step ${stepIndex + 1} of ${STEPS.length}`,
    [stepIndex],
  );

  const finish = async () => {
    await trpc.store.set.mutate({ key: FIRST_START_COMPLETED_KEY, value: true });
    await navigate({ to: search.returnTo === "settings" ? "/settings" : "/" });
  };

  const skip = async () => {
    await finish();
  };

  const goNext = async () => {
    if (currentStep.id === "booru") {
      const value = booruPrompt.trim().length > 0 ? booruPrompt.trim() : DEFAULT_INTERMEDIARY_LOADING_PROMPT;
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
        setMusicMessage("No music files were selected. You can continue and add them later in Settings.");
        return;
      }
      await addTracks(filePaths);
      setMusicMessage(`Added ${filePaths.length} track${filePaths.length === 1 ? "" : "s"} to the global music queue.`);
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
        `Imported folder. Installed ${stats.installed} rounds, imported ${stats.playlistsImported} playlists, updated ${stats.updated}, and failed ${stats.failed}.`,
      );
    } catch (error) {
      console.error("Failed to add onboarding round folder", error);
      setRoundMessage(error instanceof Error ? error.message : "Failed to import the selected folder.");
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
        setRoundMessage("No file was selected. You can continue and import files later from Installed Rounds.");
        return;
      }

      const result = await importOpenedFile(filePath);
      if (result.kind === "sidecar") {
        const stats = result.result.status.stats;
        setRoundMessage(
          `Imported file. Installed ${stats.installed} rounds, imported ${stats.playlistsImported} playlists, updated ${stats.updated}, and failed ${stats.failed}.`,
        );
        return;
      }

      if (result.kind === "playlist") {
        setRoundMessage("A playlist file was imported. You can edit it later in Playlist Workshop.");
        return;
      }

      setRoundMessage("That file type is not supported here.");
    } catch (error) {
      console.error("Failed to import onboarding hero or round", error);
      setRoundMessage(error instanceof Error ? error.message : "Failed to import the selected file.");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <AnimatedBackground />

      <div className="relative z-10 flex h-screen items-center justify-center px-3 py-3 sm:px-5 sm:py-5">
        <div className="parallax-ui-none flex h-full w-full max-w-[1800px] flex-col rounded-[2rem] border border-violet-300/25 bg-zinc-950/75 p-5 shadow-[0_0_80px_rgba(76,29,149,0.28)] backdrop-blur-2xl sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-[72rem]">
              <p className="font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.35em] text-violet-200/80">
                First Start Workflow
              </p>
              <h1 className="mt-2 max-w-[18ch] text-3xl font-black leading-[0.92] tracking-tight text-white sm:text-4xl xl:text-5xl">
                Learn the basics before you jump in
              </h1>
              <p className="mt-2 max-w-4xl text-sm text-zinc-300 sm:text-base xl:text-lg">
                This walkthrough explains what each important feature does in easy words, lets you install a few basics now, and can be skipped if you just want to explore.
              </p>
            </div>

            <div className="flex shrink-0 gap-3">
              <button
                type="button"
                onMouseEnter={playHoverSound}
                onClick={() => {
                  playSelectSound();
                  void skip();
                }}
                className="rounded-xl border border-zinc-500/60 bg-zinc-900/80 px-4 py-3 text-sm font-semibold text-zinc-100 transition-colors hover:border-zinc-300/80 hover:bg-zinc-800"
              >
                Skip Setup
              </button>
            </div>
          </div>

          <div className="mt-4 grid min-h-0 flex-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="min-h-0 overflow-y-auto rounded-3xl border border-violet-300/20 bg-black/25 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-violet-200/80">{progressLabel}</p>
              <div ref={stepNavRef} className="mt-3 space-y-2.5">
                {STEPS.map((step, index) => {
                  const active = index === stepIndex;
                  const complete = index < stepIndex;
                  return (
                    <div
                      key={step.id}
                      data-step-index={index}
                      className={`rounded-2xl border px-3 py-2.5 text-sm leading-6 transition-colors ${active
                        ? "border-violet-300/50 bg-violet-500/15 text-violet-50"
                        : complete
                          ? "border-emerald-300/30 bg-emerald-500/10 text-emerald-100"
                          : "border-zinc-800 bg-black/20 text-zinc-400"
                        }`}
                    >
                      <div className="font-semibold">{step.title}</div>
                    </div>
                  );
                })}
              </div>
            </aside>

            <section className="flex min-h-0 flex-col rounded-3xl border border-violet-300/20 bg-black/25 p-5 sm:p-6">
              <p className="font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.28em] text-cyan-200/80">
                {currentStep.eyebrow}
              </p>
              <h2 className="mt-2 max-w-[20ch] text-2xl font-black leading-tight tracking-tight text-white sm:text-3xl xl:text-4xl">
                {currentStep.title}
              </h2>
              <p className="mt-3 text-sm leading-7 text-zinc-200 sm:text-base xl:text-lg">
                {currentStep.description}
              </p>

              <div ref={contentScrollRef} className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                {currentStep.details.map((detail) => (
                  <div key={detail} className="rounded-2xl border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-sm leading-7 text-zinc-300 sm:text-base">
                    {detail}
                  </div>
                ))}

                {currentStep.id === "music" ? (
                  <div className="rounded-3xl border border-violet-300/25 bg-violet-500/10 p-4">
                    <p className="text-sm font-semibold text-violet-100">
                      Current queue: {queue.length} track{queue.length === 1 ? "" : "s"} configured
                    </p>
                    <p className="mt-2 text-sm text-zinc-300">
                      Use this button to pick music files from your computer and add them to the global queue.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-3">
                      <button
                        type="button"
                        disabled={isBusy}
                        onMouseEnter={playHoverSound}
                        onClick={() => {
                          playSelectSound();
                          void addMusicTracks();
                        }}
                        className={`rounded-xl border px-4 py-3 text-sm font-semibold transition-colors ${isBusy
                          ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                          : "border-violet-300/70 bg-violet-500/30 text-violet-100 hover:border-violet-200/90 hover:bg-violet-500/45"
                          }`}
                      >
                        {isBusy ? "Working..." : "Add Music Files"}
                      </button>
                    </div>
                    {musicMessage ? (
                      <div className="mt-3 rounded-2xl border border-cyan-300/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
                        {musicMessage}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {currentStep.id === "round-packs" ? (
                  <div className="rounded-3xl border border-violet-300/25 bg-violet-500/10 p-4">
                    <p className="text-sm text-zinc-300">
                      You can either add a whole content folder or import a single hero/round file.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-3">
                      <button
                        type="button"
                        disabled={isBusy}
                        onMouseEnter={playHoverSound}
                        onClick={() => {
                          playSelectSound();
                          void addRoundFolder();
                        }}
                        className={`rounded-xl border px-4 py-3 text-sm font-semibold transition-colors ${isBusy
                          ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                          : "border-violet-300/70 bg-violet-500/30 text-violet-100 hover:border-violet-200/90 hover:bg-violet-500/45"
                          }`}
                      >
                        {isBusy ? "Working..." : "Add Round Pack Folder"}
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onMouseEnter={playHoverSound}
                        onClick={() => {
                          playSelectSound();
                          void importHeroOrRound();
                        }}
                        className={`rounded-xl border px-4 py-3 text-sm font-semibold transition-colors ${isBusy
                          ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                          : "border-cyan-300/60 bg-cyan-500/20 text-cyan-100 hover:border-cyan-200/85 hover:bg-cyan-500/35"
                          }`}
                      >
                        {isBusy ? "Working..." : "Import .hero / .round File"}
                      </button>
                    </div>
                    {roundMessage ? (
                      <div className="mt-3 rounded-2xl border border-cyan-300/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
                        {roundMessage}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {currentStep.id === "booru" ? (
                  <div className="rounded-3xl border border-violet-300/25 bg-violet-500/10 p-4">
                    <label className="block text-sm font-semibold text-violet-100" htmlFor="first-start-booru-prompt">
                      Booru search prompt
                    </label>
                    <p className="mt-2 text-sm text-zinc-300">
                      Leave the default in place if you are not sure what to use. The app will save whatever is in this box when you continue.
                    </p>
                    <textarea
                      id="first-start-booru-prompt"
                      value={booruPrompt}
                      disabled={isLoadingPrompt}
                      onChange={(event) => setBooruPrompt(event.target.value)}
                      className="mt-3 min-h-24 w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-violet-400 focus:ring-1 focus:ring-violet-400 disabled:opacity-60"
                    />
                  </div>
                ) : null}
              </div>

              <div className="mt-4 flex flex-col-reverse gap-3 border-t border-zinc-800/80 pt-4 sm:flex-row sm:justify-between">
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={stepIndex === 0}
                    onMouseEnter={playHoverSound}
                    onClick={() => {
                      playSelectSound();
                      setStepIndex((current) => Math.max(0, current - 1));
                    }}
                    className={`rounded-xl border px-4 py-3 text-sm font-semibold transition-colors ${stepIndex === 0
                      ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                      : "border-zinc-500/60 bg-zinc-900/80 text-zinc-100 hover:border-zinc-300/80 hover:bg-zinc-800"
                      }`}
                  >
                    Back
                  </button>
                </div>

                <div className="flex flex-wrap gap-3 sm:justify-end">
                  <button
                    type="button"
                    onMouseEnter={playHoverSound}
                    onClick={() => {
                      playSelectSound();
                      void skip();
                    }}
                    className="rounded-xl border border-zinc-500/60 bg-zinc-900/80 px-4 py-3 text-sm font-semibold text-zinc-100 transition-colors hover:border-zinc-300/80 hover:bg-zinc-800"
                  >
                    Skip This Setup
                  </button>
                  <button
                    type="button"
                    disabled={isContinueDisabled}
                    onMouseEnter={playHoverSound}
                    onClick={() => {
                      playSelectSound();
                      void goNext();
                    }}
                    className={`rounded-xl border px-5 py-3 text-sm font-semibold transition-colors ${isContinueDisabled
                      ? "cursor-not-allowed border-zinc-600 bg-zinc-800 text-zinc-500"
                      : "border-violet-300/70 bg-violet-500/30 text-violet-100 hover:border-violet-200/90 hover:bg-violet-500/45"
                      }`}
                  >
                    {isLastStep ? (search.returnTo === "settings" ? "Save and Return to Settings" : "Finish and Open Main Menu") : "Continue"}
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
