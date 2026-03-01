import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONVERTER_MIN_ROUND_KEY, CONVERTER_PAUSE_GAP_KEY, CONVERTER_ZOOM_KEY, MIN_ZOOM_PX_PER_SEC } from "./types";

const mocks = vi.hoisted(() => ({
  db: {
    hero: {
      findMany: vi.fn(),
    },
    round: {
      findInstalled: vi.fn(),
    },
  },
  storeGet: vi.fn(),
  storeSet: vi.fn(),
  converterSaveSegments: vi.fn(),
  loadFunscriptTimeline: vi.fn().mockResolvedValue(null),
  buildDetectedSegments: vi.fn(() => []),
}));

vi.mock("../../services/db", () => ({
  db: mocks.db,
}));

vi.mock("../../services/trpc", () => ({
  trpc: {
    store: {
      get: {
        query: mocks.storeGet,
      },
      set: {
        mutate: mocks.storeSet,
      },
    },
  },
}));

vi.mock("../../utils/audio", () => ({
  playConverterAutoDetectSound: vi.fn(),
  playConverterMarkInSound: vi.fn(),
  playConverterMarkOutSound: vi.fn(),
  playConverterSaveSuccessSound: vi.fn(),
  playConverterSegmentAddSound: vi.fn(),
  playConverterSegmentDeleteSound: vi.fn(),
  playConverterValidationErrorSound: vi.fn(),
  playConverterZoomSound: vi.fn(),
  playSelectSound: vi.fn(),
}));

vi.mock("../../game/media/playback", () => ({
  loadFunscriptTimeline: mocks.loadFunscriptTimeline,
}));

vi.mock("../../services/converter", () => ({
  converter: {
    saveSegments: mocks.converterSaveSegments,
  },
}));

vi.mock("./detection", () => ({
  buildDetectedSegments: mocks.buildDetectedSegments,
}));

vi.mock("./metadata", () => ({
  applyAutoMetadataToSegments: vi.fn((segments: unknown) => segments),
}));

vi.mock("../../hooks/usePlayableVideoFallback", () => ({
  usePlayableVideoFallback: () => ({
    getVideoSrc: (uri: string) => uri,
    ensurePlayableVideo: vi.fn(),
    handleVideoError: vi.fn(),
  }),
}));

import { useConverterState } from "./useConverterState";

describe("useConverterState", () => {
  beforeEach(() => {
    mocks.db.hero.findMany.mockResolvedValue([]);
    mocks.db.round.findInstalled.mockResolvedValue([]);
    mocks.storeSet.mockResolvedValue(null);
    mocks.converterSaveSegments.mockResolvedValue({
      stats: { created: 1, updated: 0 },
      removedSourceRound: false,
    });
    mocks.loadFunscriptTimeline.mockResolvedValue(null);
    mocks.buildDetectedSegments.mockReturnValue([]);
    mocks.storeGet.mockImplementation(async ({ key }: { key: string }) => {
      if (key === CONVERTER_ZOOM_KEY) return "1";
      if (key === CONVERTER_PAUSE_GAP_KEY) return null;
      if (key === CONVERTER_MIN_ROUND_KEY) return null;
      return null;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("clamps persisted zoom to the lower converter zoom floor", async () => {
    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });
  });

  it("splits the segment under the playhead when pressing k", async () => {
    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    act(() => {
      result.current.setDurationMs(10_000);
      result.current.setMarkInMs(1_000);
      result.current.setMarkOutMs(5_000);
    });

    act(() => {
      result.current.addSegmentFromMarks();
    });

    act(() => {
      result.current.setCurrentTimeMs(3_000);
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
    });

    expect(result.current.sortedSegments).toHaveLength(2);
    expect(result.current.sortedSegments.map((segment) => [segment.startTimeMs, segment.endTimeMs]))
      .toEqual([
        [1_000, 3_000],
        [3_000, 5_000],
      ]);
    expect(result.current.selectedSegmentId).toBe(result.current.sortedSegments[1]?.id ?? null);
    expect(result.current.message).toBe("Split segment at 00:03.00.");
    expect(result.current.error).toBeNull();
  });

  it("selects the next and previous segment with wrapping", async () => {
    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    act(() => {
      result.current.setDurationMs(10_000);
      result.current.setMarkInMs(1_000);
      result.current.setMarkOutMs(2_000);
    });

    act(() => {
      result.current.addSegmentFromMarks();
    });

    act(() => {
      result.current.setMarkInMs(4_000);
      result.current.setMarkOutMs(5_000);
    });

    act(() => {
      result.current.addSegmentFromMarks();
    });

    const firstId = result.current.sortedSegments[0]?.id ?? null;
    const secondId = result.current.sortedSegments[1]?.id ?? null;
    expect(result.current.selectedSegmentId).toBe(secondId);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "n" }));
    });
    expect(result.current.selectedSegmentId).toBe(firstId);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "N", shiftKey: true }));
    });
    expect(result.current.selectedSegmentId).toBe(secondId);
  });

  it("selects the segment under the playhead with p", async () => {
    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    act(() => {
      result.current.setDurationMs(10_000);
      result.current.setMarkInMs(1_000);
      result.current.setMarkOutMs(3_000);
    });

    act(() => {
      result.current.addSegmentFromMarks();
    });

    act(() => {
      result.current.setSelectedSegmentId(null);
      result.current.setCurrentTimeMs(2_500);
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "p" }));
    });

    expect(result.current.selectedSegmentId).toBe(result.current.sortedSegments[0]?.id ?? null);
    expect(result.current.error).toBeNull();
  });

  it("jumps to the selected segment boundaries with home and end", async () => {
    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    act(() => {
      result.current.setDurationMs(10_000);
      result.current.setMarkInMs(1_000);
      result.current.setMarkOutMs(4_000);
    });

    act(() => {
      result.current.addSegmentFromMarks();
    });

    act(() => {
      result.current.setCurrentTimeMs(2_500);
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "End" }));
    });
    expect(result.current.currentTimeMs).toBe(4_000);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Home" }));
    });
    expect(result.current.currentTimeMs).toBe(1_000);
  });

  it("moves selected segment boundaries to the playhead with s and e", async () => {
    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    act(() => {
      result.current.setDurationMs(10_000);
      result.current.setMarkInMs(1_000);
      result.current.setMarkOutMs(4_000);
    });

    act(() => {
      result.current.addSegmentFromMarks();
    });

    act(() => {
      result.current.setCurrentTimeMs(2_000);
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "s" }));
    });

    expect(result.current.sortedSegments[0]).toMatchObject({ startTimeMs: 2_000, endTimeMs: 4_000 });

    act(() => {
      result.current.setCurrentTimeMs(3_500);
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "e" }));
    });

    expect(result.current.sortedSegments[0]).toMatchObject({ startTimeMs: 2_000, endTimeMs: 3_500 });
  });

  it("merges the selected segment with the next one when pressing m", async () => {
    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    act(() => {
      result.current.setDurationMs(10_000);
      result.current.setMarkInMs(1_000);
      result.current.setMarkOutMs(2_000);
    });

    act(() => {
      result.current.addSegmentFromMarks();
    });

    act(() => {
      result.current.setMarkInMs(2_000);
      result.current.setMarkOutMs(4_000);
    });

    act(() => {
      result.current.addSegmentFromMarks();
    });

    act(() => {
      result.current.setSelectedSegmentId(result.current.sortedSegments[0]?.id ?? null);
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "m" }));
    });

    expect(result.current.sortedSegments).toHaveLength(1);
    expect(result.current.sortedSegments[0]).toMatchObject({ startTimeMs: 1_000, endTimeMs: 4_000 });
  });

  it("runs and applies auto-detection shortcuts", async () => {
    mocks.loadFunscriptTimeline.mockResolvedValue({ actions: [{ at: 1000, pos: 50 }] });
    mocks.buildDetectedSegments.mockReturnValue([
      {
        id: "detected-1",
        startTimeMs: 1_000,
        endTimeMs: 3_000,
        type: "Normal",
        bpm: null,
        difficulty: null,
        bpmOverride: false,
        difficultyOverride: false,
      },
    ]);

    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    act(() => {
      result.current.setDurationMs(10_000);
      result.current.setFunscriptUri("file:///tmp/test.funscript");
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    });

    await waitFor(() => {
      expect(mocks.buildDetectedSegments).toHaveBeenCalled();
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "A", shiftKey: true }));
    });

    expect(result.current.sortedSegments).toHaveLength(1);
  });

  it("saves converted rounds with ctrl/cmd+s", async () => {
    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    act(() => {
      result.current.setDurationMs(10_000);
      result.current.setHeroName("Hero");
      result.current.setCurrentTimeMs(0);
      result.current.setMarkInMs(1_000);
      result.current.setMarkOutMs(3_000);
    });

    act(() => {
      result.current.addSegmentFromMarks();
    });

    act(() => {
      result.current.setVideoUri("file:///tmp/test.mp4");
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true }));
    });

    await waitFor(() => {
      expect(mocks.converterSaveSegments).toHaveBeenCalled();
    });
  });

  it("clears overlay, marks, then selection with escape", async () => {
    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    act(() => {
      result.current.setDurationMs(10_000);
      result.current.setMarkInMs(1_000);
      result.current.setMarkOutMs(2_000);
    });

    act(() => {
      result.current.addSegmentFromMarks();
    });

    expect(result.current.showHotkeys).toBe(true);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(result.current.showHotkeys).toBe(false);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(result.current.markInMs).toBeNull();
    expect(result.current.markOutMs).toBeNull();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(result.current.selectedSegmentId).toBeNull();
  });

  it("shows and hides the shortcut overlay explicitly and via the toggle shortcut", async () => {
    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    expect(result.current.showHotkeys).toBe(true);

    act(() => {
      result.current.hideHotkeysOverlay();
    });
    expect(result.current.showHotkeys).toBe(false);

    act(() => {
      result.current.showHotkeysOverlay();
    });
    expect(result.current.showHotkeys).toBe(true);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }));
    });
    expect(result.current.showHotkeys).toBe(false);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }));
    });
    expect(result.current.showHotkeys).toBe(true);
  });

  it("ignores shortcuts while an input is focused", async () => {
    const { result } = renderHook(() => useConverterState({ sourceRoundId: "", heroName: "" }));

    await waitFor(() => {
      expect(result.current.zoomPxPerSec).toBe(MIN_ZOOM_PX_PER_SEC);
    });

    act(() => {
      result.current.setDurationMs(10_000);
      result.current.setMarkInMs(1_000);
      result.current.setMarkOutMs(5_000);
    });

    const input = document.createElement("input");
    document.body.appendChild(input);

    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(result.current.sortedSegments).toHaveLength(0);
    input.remove();
  });
});
