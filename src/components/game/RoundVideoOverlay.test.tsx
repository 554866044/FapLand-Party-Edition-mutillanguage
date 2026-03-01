import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveRound, PlayerState } from "../../game/types";
import type { InstalledRound } from "../../services/db";
import { extractBeatbarMotionEvents, getAntiPerkSequenceDefinition } from "./antiPerkSequences";
import * as handyRuntime from "../../services/thehandy/runtime";
import * as booru from "../../services/booru";

const mocks = vi.hoisted(() => ({
  handy: {
    connectionKey: "",
    appApiKey: "",
    connected: false,
    manuallyStopped: false,
    setSyncStatus: vi.fn(),
    toggleManualStop: vi.fn(async () => "unavailable" as const),
  },
  isGameDevelopmentMode: vi.fn(() => false),
  playAntiPerkBeatSound: vi.fn(),
}));

vi.mock("../../services/booru", () => ({
  getCachedBooruMedia: vi.fn(async () => []),
  getCachedBooruMediaForDisplay: vi.fn(async () => []),
  refreshBooruMediaCache: vi.fn(async () => []),
  isVideoMedia: vi.fn(() => false),
}));

vi.mock("../../hooks/useForegroundVideoRegistration", () => ({
  useForegroundVideoRegistration: () => ({
    markPlaying: vi.fn(),
    handlePause: vi.fn(),
    handleEnded: vi.fn(),
  }),
}));

vi.mock("../../hooks/usePlayableVideoFallback", () => ({
  usePlayableVideoFallback: () => ({
    getVideoSrc: (uri: string) => uri,
    ensurePlayableVideo: vi.fn(async (uri: string) => uri),
    handleVideoError: vi.fn(),
  }),
}));

vi.mock("../../contexts/HandyContext", () => ({
  useHandy: () => mocks.handy,
}));

vi.mock("../../services/thehandy/runtime", () => ({
  issueHandySession: vi.fn(),
  pauseHandyPlayback: vi.fn(),
  preloadHspScript: vi.fn(),
  sendHspSync: vi.fn(),
  stopHandyPlayback: vi.fn(),
}));

vi.mock("../../game/media/playback", () => ({
  buildIntermediaryQueue: vi.fn(() => []),
  computePlaybackRate: vi.fn(() => 1),
  getActivePlaybackModifiers: vi.fn(() => []),
  getFunscriptPositionAtMs: vi.fn(() => null),
  loadFunscriptTimeline: vi.fn(async () => null),
}));

vi.mock("../../utils/audio", async () => {
  const actual = await vi.importActual<typeof import("../../utils/audio")>("../../utils/audio");
  return {
    ...actual,
    playAntiPerkBeatSound: mocks.playAntiPerkBeatSound,
    playDiceResultSound: vi.fn(),
    playHoverSound: vi.fn(),
    playPerkActionSound: vi.fn(),
    playRoundStartSound: vi.fn(),
    playSelectSound: vi.fn(),
  };
});

vi.mock("../../utils/devFeatures", () => ({
  isGameDevelopmentMode: mocks.isGameDevelopmentMode,
}));

import { RoundVideoOverlay } from "./RoundVideoOverlay";

function createInstalledRound(): InstalledRound {
  return {
    id: "round-1",
    name: "Round 1",
    type: "Main",
    startTime: 0,
    endTime: 30_000,
    previewImage: null,
    resources: [
      {
        videoUri: "/video.mp4",
        funscriptUri: null,
      },
    ],
  } as unknown as InstalledRound;
}

function createActiveRound(): ActiveRound {
  return {
    fieldId: "field-1",
    nodeId: "node-1",
    roundId: "round-1",
    roundName: "Round 1",
    selectionKind: "fixed",
    poolId: null,
    phaseKind: "normal",
    campaignIndex: 0,
  };
}

function renderOverlay({
  activeRound = createActiveRound(),
  currentPlayer,
  boardSequence = null,
  idleBoardSequence = null,
  allowDebugRoundControls = false,
  initialShowAntiPerkBeatbar = true,
  onCompleteBoardSequence,
}: {
  activeRound?: ActiveRound | null;
  currentPlayer?: PlayerState | undefined;
  boardSequence?: "milker" | "jackhammer" | null;
  idleBoardSequence?: "no-rest" | null;
  allowDebugRoundControls?: boolean;
  initialShowAntiPerkBeatbar?: boolean;
  onCompleteBoardSequence?: ((perkId: "milker" | "jackhammer") => void) | undefined;
} = {}) {
  return render(
    <RoundVideoOverlay
      activeRound={activeRound}
      installedRounds={[createInstalledRound()]}
      currentPlayer={currentPlayer}
      intermediaryProbability={0}
      booruSearchPrompt="animated gif webm"
      intermediaryLoadingDurationSec={10}
      intermediaryReturnPauseSec={4}
      onFinishRound={vi.fn()}
      boardSequence={boardSequence}
      idleBoardSequence={idleBoardSequence}
      onCompleteBoardSequence={onCompleteBoardSequence}
      allowDebugRoundControls={allowDebugRoundControls}
      initialShowAntiPerkBeatbar={initialShowAntiPerkBeatbar}
    />,
  );
}

describe("RoundVideoOverlay", () => {
  beforeEach(() => {
    mocks.isGameDevelopmentMode.mockReturnValue(false);
    mocks.playAntiPerkBeatSound.mockClear();
    mocks.handy.connectionKey = "";
    mocks.handy.appApiKey = "";
    mocks.handy.connected = false;
    mocks.handy.manuallyStopped = false;
    vi.mocked(booru.getCachedBooruMedia).mockClear();
    vi.mocked(booru.getCachedBooruMediaForDisplay).mockClear();
    vi.mocked(booru.refreshBooruMediaCache).mockClear();
    vi.mocked(handyRuntime.issueHandySession).mockClear();
    vi.mocked(handyRuntime.pauseHandyPlayback).mockClear();
    vi.mocked(handyRuntime.preloadHspScript).mockClear();
    vi.mocked(handyRuntime.sendHspSync).mockClear();
    vi.mocked(handyRuntime.stopHandyPlayback).mockClear();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows a compact lower-left playback timer during normal playback", async () => {
    renderOverlay();

    expect((await screen.findByTestId("round-playback-timer")).textContent).toContain("0:00 / 0:00");
    expect(screen.queryByText("Segment: Main")).toBeNull();
  });

  it("prefers persisted booru cache for display reads", async () => {
    vi.mocked(booru.getCachedBooruMediaForDisplay).mockResolvedValueOnce([
      {
        id: "cached-1",
        source: "rule34",
        url: "https://cdn.example.com/cached-1.gif",
        previewUrl: "https://cdn.example.com/cached-1.jpg",
      },
    ]);

    renderOverlay({ activeRound: null, boardSequence: "milker" });

    await waitFor(() => {
      expect(vi.mocked(booru.getCachedBooruMediaForDisplay)).toHaveBeenCalledWith(
        "animated gif webm",
        18,
      );
    });
    await waitFor(() => {
      expect(vi.mocked(booru.refreshBooruMediaCache)).toHaveBeenCalledWith(
        "animated gif webm",
        18,
      );
    });
  });

  it("does not re-read persisted booru cache on rerender with the same prompt", async () => {
    vi.mocked(booru.getCachedBooruMediaForDisplay).mockResolvedValue([
      {
        id: "cached-1",
        source: "rule34",
        url: "https://cdn.example.com/cached-1.gif",
        previewUrl: "https://cdn.example.com/cached-1.jpg",
      },
    ]);

    const view = renderOverlay({ activeRound: null, boardSequence: "milker" });
    await waitFor(() => {
      expect(vi.mocked(booru.getCachedBooruMediaForDisplay)).toHaveBeenCalledTimes(1);
    });

    view.rerender(
      <RoundVideoOverlay
        activeRound={null}
        installedRounds={[createInstalledRound()]}
        currentPlayer={undefined}
        intermediaryProbability={0}
        boardSequence="milker"
        booruSearchPrompt="animated gif webm"
        intermediaryLoadingDurationSec={10}
        intermediaryReturnPauseSec={4}
        onFinishRound={vi.fn()}
      />,
    );

    expect(vi.mocked(booru.getCachedBooruMediaForDisplay)).toHaveBeenCalledTimes(1);
  });

  it("can transition from no active round to an active round without changing hook order", async () => {
    const view = renderOverlay({ activeRound: null });

    expect(screen.queryByTestId("round-playback-timer")).toBeNull();

    view.rerender(
      <RoundVideoOverlay
        activeRound={createActiveRound()}
        installedRounds={[createInstalledRound()]}
        currentPlayer={undefined}
        intermediaryProbability={0}
        booruSearchPrompt="animated gif webm"
        intermediaryLoadingDurationSec={10}
        intermediaryReturnPauseSec={4}
        onFinishRound={vi.fn()}
      />,
    );

    expect((await screen.findByTestId("round-playback-timer")).textContent).toContain("0:00 / 0:00");
  });

  it("shows proceed and close actions in the cum round dialog", async () => {
    const onFinishRound = vi.fn();
    const onClose = vi.fn();
    const view = render(
      <RoundVideoOverlay
        activeRound={{ ...createActiveRound(), phaseKind: "cum" }}
        installedRounds={[createInstalledRound()]}
        currentPlayer={undefined}
        intermediaryProbability={0}
        booruSearchPrompt="animated gif webm"
        intermediaryLoadingDurationSec={10}
        intermediaryReturnPauseSec={4}
        onFinishRound={onFinishRound}
        onClose={onClose}
        cumRequestSignal={0}
        showCumRoundOutcomeMenuOnCumRequest
      />,
    );

    view.rerender(
      <RoundVideoOverlay
        activeRound={{ ...createActiveRound(), phaseKind: "cum" }}
        installedRounds={[createInstalledRound()]}
        currentPlayer={undefined}
        intermediaryProbability={0}
        booruSearchPrompt="animated gif webm"
        intermediaryLoadingDurationSec={10}
        intermediaryReturnPauseSec={4}
        onFinishRound={onFinishRound}
        onClose={onClose}
        cumRequestSignal={1}
        showCumRoundOutcomeMenuOnCumRequest
      />,
    );

    const proceedButton = await screen.findByRole("button", { name: "Proceed round" });
    const closeButton = screen.getByRole("button", { name: "Close" });

    expect(proceedButton).not.toBeNull();
    expect(closeButton).not.toBeNull();

    proceedButton.click();

    await waitFor(() => {
      expect(onFinishRound).toHaveBeenCalledWith({
        intermediaryCount: 0,
        activeAntiPerkCount: 0,
      });
    });

    cleanup();

    const secondView = render(
      <RoundVideoOverlay
        activeRound={{ ...createActiveRound(), phaseKind: "cum" }}
        installedRounds={[createInstalledRound()]}
        currentPlayer={undefined}
        intermediaryProbability={0}
        booruSearchPrompt="animated gif webm"
        intermediaryLoadingDurationSec={10}
        intermediaryReturnPauseSec={4}
        onFinishRound={vi.fn()}
        onClose={onClose}
        cumRequestSignal={0}
        showCumRoundOutcomeMenuOnCumRequest
      />,
    );

    secondView.rerender(
      <RoundVideoOverlay
        activeRound={{ ...createActiveRound(), phaseKind: "cum" }}
        installedRounds={[createInstalledRound()]}
        currentPlayer={undefined}
        intermediaryProbability={0}
        booruSearchPrompt="animated gif webm"
        intermediaryLoadingDurationSec={10}
        intermediaryReturnPauseSec={4}
        onFinishRound={vi.fn()}
        onClose={onClose}
        cumRequestSignal={1}
        showCumRoundOutcomeMenuOnCumRequest
      />,
    );

    (await screen.findByRole("button", { name: "Close" })).click();

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("allows gameplay video audio to play through the round player", async () => {
    const { container } = renderOverlay();

    const mainVideo = container.querySelector("video");
    expect(mainVideo).not.toBeNull();
    expect(mainVideo?.muted).toBe(false);
    expect(mainVideo?.defaultMuted).toBe(false);
    expect(mainVideo?.volume).toBe(1);
  });

  it("does not apply an opaque black backdrop during active round playback", () => {
    const { container } = renderOverlay();
    const root = container.firstChild as HTMLElement | null;

    expect(root).not.toBeNull();
    expect(root?.className).toContain("bg-transparent");
    expect(root?.className).not.toContain("bg-black");
  });

  it("keeps the board visible during board-only anti-perk sequences", () => {
    const { container } = renderOverlay({ activeRound: null, boardSequence: "milker" });
    const root = container.firstChild as HTMLElement | null;

    expect(root).not.toBeNull();
    expect(root?.className).toContain("bg-transparent");
    expect(root?.className).not.toContain("bg-black");
  });

  it("shows the debug panel only when debug controls are enabled", async () => {
    renderOverlay({ allowDebugRoundControls: true });
    expect(await screen.findByText("Segment: Main")).not.toBeNull();
    expect(screen.queryByText("Intermediary queue: 0")).toBeNull();
  });

  it("shows the intermediary queue only in development mode", async () => {
    mocks.isGameDevelopmentMode.mockReturnValue(true);

    renderOverlay();

    expect(await screen.findByText("Intermediary queue: 0")).not.toBeNull();
  });

  it("renders a beatbar for milker sequences when enabled", async () => {
    renderOverlay({ activeRound: null, boardSequence: "milker" });
    expect(await screen.findByTestId("anti-perk-beatbar")).not.toBeNull();
  });

  it("renders a beatbar for jackhammer sequences when enabled", async () => {
    renderOverlay({ activeRound: null, boardSequence: "jackhammer" });
    expect(await screen.findByTestId("anti-perk-beatbar")).not.toBeNull();
  });

  it("anchors the anti-perk sequence card in the lower-left corner", async () => {
    renderOverlay({ activeRound: null, boardSequence: "milker" });

    const sequenceCard = await screen.findByTestId("anti-perk-sequence-card");
    expect(sequenceCard.className).toContain("rounded-xl");
    expect(sequenceCard.parentElement?.className).toContain("bottom-5");
    expect(sequenceCard.parentElement?.className).toContain("left-5");
    expect(sequenceCard.parentElement?.className).not.toContain("left-1/2");
  });

  it("renders multiple preview markers from the generated anti-perk motion", async () => {
    renderOverlay({ activeRound: null, boardSequence: "jackhammer" });
    expect((await screen.findAllByTestId("anti-perk-beat-note")).length).toBeGreaterThan(1);
    expect(screen.queryByTestId("anti-perk-position-ball")).toBeNull();
  });

  it("does not render a beatbar for no-rest sequences", async () => {
    renderOverlay({ activeRound: null, idleBoardSequence: "no-rest" });
    await waitFor(() => {
      expect(screen.queryByTestId("anti-perk-beatbar")).toBeNull();
    });
  });

  it("runs no-rest as a hidden board filler without booru loading media", async () => {
    renderOverlay({ activeRound: null, idleBoardSequence: "no-rest" });

    expect(screen.queryByTestId("anti-perk-sequence-card")).toBeNull();
    expect(screen.queryByAltText("loading media")).toBeNull();
    expect(vi.mocked(booru.refreshBooruMediaCache)).not.toHaveBeenCalled();
  });

  it("starts handy sync for no-rest idle filler without rendering a countdown overlay", async () => {
    mocks.handy.connectionKey = "conn-key";
    mocks.handy.appApiKey = "app-key";
    mocks.handy.connected = true;
    vi.mocked(handyRuntime.issueHandySession).mockResolvedValue({
      mode: "appId",
      clientToken: null,
      expiresAtMs: Date.now() + 60_000,
      loadedScriptId: null,
      activeScriptId: null,
      lastSyncAtMs: 0,
      lastPlaybackRate: 1,
      maxBufferPoints: 4000,
      streamedPoints: null,
      nextStreamPointIndex: 0,
      tailPointStreamIndex: 0,
      uploadedUntilMs: 0,
    });

    renderOverlay({ activeRound: null, idleBoardSequence: "no-rest" });

    expect(screen.queryByTestId("anti-perk-sequence-card")).toBeNull();
    await waitFor(() => {
      expect(vi.mocked(handyRuntime.sendHspSync)).toHaveBeenCalled();
    });
  });

  it("hides the beatbar when the setting is disabled", async () => {
    renderOverlay({ activeRound: null, boardSequence: "milker", initialShowAntiPerkBeatbar: false });
    await waitFor(() => {
      expect(screen.queryByTestId("anti-perk-beatbar")).toBeNull();
    });
  });

  it("renders the beatbar even when TheHandy is disconnected", async () => {
    mocks.handy.connected = false;
    renderOverlay({ activeRound: null, boardSequence: "jackhammer" });
    expect(await screen.findByTestId("anti-perk-beatbar")).not.toBeNull();
  });

  it("shows only the moving Handy position ball when TheHandy is connected", async () => {
    mocks.handy.connected = true;
    renderOverlay({ activeRound: null, boardSequence: "jackhammer" });
    expect(await screen.findByTestId("anti-perk-beatbar")).not.toBeNull();
    expect(screen.getByTestId("anti-perk-position-ball")).not.toBeNull();
    expect(screen.queryByTestId("anti-perk-beat-note")).toBeNull();
  });

  it("starts generated sequence sync if TheHandy connects after the anti-perk overlay already started", async () => {
    mocks.handy.connectionKey = "conn-key";
    mocks.handy.appApiKey = "app-key";
    mocks.handy.connected = false;
    vi.mocked(handyRuntime.issueHandySession).mockResolvedValue({
      mode: "appId",
      clientToken: null,
      expiresAtMs: Date.now() + 60_000,
      loadedScriptId: null,
      activeScriptId: null,
      lastSyncAtMs: 0,
      lastPlaybackRate: 1,
      maxBufferPoints: 4000,
      streamedPoints: null,
      nextStreamPointIndex: 0,
      tailPointStreamIndex: 0,
      uploadedUntilMs: 0,
    });

    const view = renderOverlay({ activeRound: null, boardSequence: "jackhammer" });
    expect(vi.mocked(handyRuntime.sendHspSync)).not.toHaveBeenCalled();

    mocks.handy.connected = true;
    view.rerender(
      <RoundVideoOverlay
        activeRound={null}
        installedRounds={[createInstalledRound()]}
        currentPlayer={undefined}
        intermediaryProbability={0}
        booruSearchPrompt="animated gif webm"
        intermediaryLoadingDurationSec={10}
        intermediaryReturnPauseSec={4}
        onFinishRound={vi.fn()}
        boardSequence="jackhammer"
        initialShowAntiPerkBeatbar
      />,
    );

    await waitFor(() => {
      expect(vi.mocked(handyRuntime.preloadHspScript)).toHaveBeenCalled();
      expect(vi.mocked(handyRuntime.sendHspSync)).toHaveBeenCalled();
    });
  });

  it("does not pause TheHandy during an active jackhammer anti-perk countdown", async () => {
    mocks.handy.connectionKey = "conn-key";
    mocks.handy.appApiKey = "app-key";
    mocks.handy.connected = true;
    vi.mocked(handyRuntime.issueHandySession).mockResolvedValue({
      mode: "appId",
      clientToken: null,
      expiresAtMs: Date.now() + 60_000,
      loadedScriptId: null,
      activeScriptId: null,
      lastSyncAtMs: 0,
      lastPlaybackRate: 1,
      maxBufferPoints: 4000,
      streamedPoints: null,
      nextStreamPointIndex: 0,
      tailPointStreamIndex: 0,
      uploadedUntilMs: 0,
    });

    renderOverlay({
      currentPlayer: {
        id: "p1",
        name: "Player 1",
        colorHex: "#fff",
        position: 0,
        score: 0,
        coins: 0,
        perks: [],
        antiPerks: ["jackhammer"],
        shieldRounds: 0,
        inventory: [],
        pendingRoundControl: null,
        pendingIntensityCap: null,
        hasCame: false,
        stats: {
          diceMin: 1,
          diceMax: 6,
          roundPauseMs: 0,
          intermediaryProbability: 0,
        },
      },
    });

    await waitFor(() => {
      expect(vi.mocked(handyRuntime.sendHspSync)).toHaveBeenCalled();
    });
    expect(vi.mocked(handyRuntime.pauseHandyPlayback)).not.toHaveBeenCalled();
  });

  it("keeps generated Handy sync marked fresh during a jackhammer sequence", async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockImplementation(() => Date.now());
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));

    mocks.handy.connectionKey = "conn-key";
    mocks.handy.appApiKey = "app-key";
    mocks.handy.connected = true;
    mocks.handy.setSyncStatus.mockClear();

    vi.mocked(handyRuntime.issueHandySession).mockResolvedValue({
      mode: "appId",
      clientToken: null,
      expiresAtMs: Date.now() + 60_000,
      loadedScriptId: null,
      activeScriptId: null,
      lastSyncAtMs: 0,
      lastPlaybackRate: 1,
      maxBufferPoints: 4000,
      streamedPoints: null,
      nextStreamPointIndex: 0,
      tailPointStreamIndex: 0,
      uploadedUntilMs: 0,
    });

    renderOverlay({ activeRound: null, boardSequence: "jackhammer" });

    await waitFor(() => {
      expect(mocks.handy.setSyncStatus).toHaveBeenCalledWith({ synced: true, error: null });
    });

    const staleResetCountAtSync = mocks.handy.setSyncStatus.mock.calls.filter(
      ([value]) => value?.synced === false && value?.error === null,
    ).length;

    await vi.advanceTimersByTimeAsync(2_500);

    const staleResetCountAfter = mocks.handy.setSyncStatus.mock.calls.filter(
      ([value]) => value?.synced === false && value?.error === null,
    ).length;

    expect(staleResetCountAfter).toBe(staleResetCountAtSync);
  }, 10_000);

  it("does not play beatbar impact sounds during manual anti-perk overlays", async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockImplementation(() => Date.now());
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    renderOverlay({ activeRound: null, boardSequence: "jackhammer" });
    const definition = getAntiPerkSequenceDefinition("jackhammer");

    await vi.advanceTimersByTimeAsync(definition.durationSec * 1000 + 250);

    expect(mocks.playAntiPerkBeatSound).not.toHaveBeenCalled();
  }, 10_000);

  it("keeps the manual beatbar silent before and after the first downstroke impact", async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockImplementation(() => Date.now());
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));

    renderOverlay({ activeRound: null, boardSequence: "jackhammer" });

    const definition = getAntiPerkSequenceDefinition("jackhammer");
    const actions = definition.createActions(definition.durationSec * 1000, () => 0.37);
    const firstImpactAt = extractBeatbarMotionEvents(actions).find((event) => event.kind === "downstroke")?.at;

    expect(firstImpactAt).toBeTypeOf("number");

    await vi.advanceTimersByTimeAsync(Math.max(0, (firstImpactAt ?? 0) - 1));
    expect(mocks.playAntiPerkBeatSound).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2);
    expect(mocks.playAntiPerkBeatSound).not.toHaveBeenCalled();
  }, 10_000);

  it("does not play anti-perk beat sounds when only the Handy position ball is shown", async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockImplementation(() => Date.now());
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    mocks.handy.connected = true;
    renderOverlay({ activeRound: null, boardSequence: "jackhammer" });

    await vi.advanceTimersByTimeAsync(2_000);

    expect(mocks.playAntiPerkBeatSound).not.toHaveBeenCalled();
    expect(screen.getByTestId("anti-perk-position-ball")).not.toBeNull();
  }, 10_000);

  it("stops beatbar activity once the sequence finishes", async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockImplementation(() => Date.now());
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    renderOverlay({ activeRound: null, boardSequence: "jackhammer" });
    const callsBefore = mocks.playAntiPerkBeatSound.mock.calls.length;

    await vi.advanceTimersByTimeAsync(16_000);
    expect(screen.queryByTestId("anti-perk-beatbar")).toBeNull();

    const settledCalls = mocks.playAntiPerkBeatSound.mock.calls.length;
    expect(settledCalls).toBeGreaterThanOrEqual(callsBefore);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.playAntiPerkBeatSound.mock.calls.length).toBe(settledCalls);
  }, 10_000);

  it("does not restart the board-sequence countdown when the completion callback identity changes", async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockImplementation(() => Date.now());
    const firstComplete = vi.fn();
    const secondComplete = vi.fn();

    const view = renderOverlay({
      activeRound: null,
      boardSequence: "jackhammer",
      onCompleteBoardSequence: firstComplete,
    });

    expect(screen.getByText("15")).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(screen.getByText("14")).not.toBeNull();

    view.rerender(
      <RoundVideoOverlay
        activeRound={null}
        installedRounds={[createInstalledRound()]}
        currentPlayer={undefined}
        intermediaryProbability={0}
        booruSearchPrompt="animated gif webm"
        intermediaryLoadingDurationSec={10}
        intermediaryReturnPauseSec={4}
        onFinishRound={vi.fn()}
        boardSequence="jackhammer"
        onCompleteBoardSequence={secondComplete}
        initialShowAntiPerkBeatbar
      />,
    );

    expect(screen.getByText("14")).not.toBeNull();

    expect(screen.queryByText("15")).toBeNull();
    expect(screen.getByText("14")).not.toBeNull();
    expect(firstComplete).not.toHaveBeenCalled();
    expect(secondComplete).not.toHaveBeenCalled();
  }, 10_000);
});
