import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getInstalledRoundCardAssetsCached: vi.fn(),
  peekInstalledRoundCardAssetsCached: vi.fn(),
}));

vi.mock("../../services/installedRoundsCache", () => ({
  getInstalledRoundCardAssetsCached: mocks.getInstalledRoundCardAssetsCached,
  peekInstalledRoundCardAssetsCached: mocks.peekInstalledRoundCardAssetsCached,
}));

import { useVisibleRoundAssets } from "./useVisibleRoundAssets";

describe("useVisibleRoundAssets", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  it("hydrates cached visible previews immediately and only fetches missing entries asynchronously", async () => {
    mocks.peekInstalledRoundCardAssetsCached.mockReturnValue([
      {
        roundId: "round-1",
        previewImage: "data:image/png;base64,cached",
        previewVideoUri: "app://media/cached.mp4",
        websiteVideoCacheStatus: "cached",
        primaryResourceId: "resource-1",
      },
    ]);
    mocks.getInstalledRoundCardAssetsCached.mockResolvedValue([
      {
        roundId: "round-2",
        previewImage: "data:image/png;base64,fetched",
        previewVideoUri: "app://media/fetched.mp4",
        websiteVideoCacheStatus: "cached",
        primaryResourceId: "resource-2",
      },
    ]);

    const { result } = renderHook(() =>
      useVisibleRoundAssets({
        visibleRoundIds: ["round-1", "round-2"],
        selectedRoundId: null,
        includeDisabled: false,
      })
    );

    expect(result.current.get("round-1")?.previewImage).toBe("data:image/png;base64,cached");
    expect(result.current.has("round-2")).toBe(false);
    expect(mocks.getInstalledRoundCardAssetsCached).not.toHaveBeenCalled();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mocks.getInstalledRoundCardAssetsCached).toHaveBeenCalledWith(["round-2"], false);
    expect(result.current.get("round-2")?.previewImage).toBe("data:image/png;base64,fetched");
  });
});
