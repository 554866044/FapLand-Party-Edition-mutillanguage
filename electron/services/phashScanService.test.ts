// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getDbMock,
  getInstallScanStatusMock,
  generateVideoPhashMock,
  getCachedWebsiteVideoLocalPathMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  getInstallScanStatusMock: vi.fn(),
  generateVideoPhashMock: vi.fn(),
  getCachedWebsiteVideoLocalPathMock: vi.fn(),
}));

vi.mock("./db", () => ({
  getDb: getDbMock,
}));

vi.mock("./installer", () => ({
  getInstallScanStatus: getInstallScanStatusMock,
}));

vi.mock("./phash", () => ({
  generateVideoPhash: generateVideoPhashMock,
}));

vi.mock("./webVideo", () => ({
  getCachedWebsiteVideoLocalPath: getCachedWebsiteVideoLocalPathMock,
}));

function buildDbMock(rows: Array<{
  roundId: string;
  roundName: string;
  resourceId: string;
  videoUri: string;
  startTime: number | null;
  endTime: number | null;
}>) {
  const roundUpdates: Array<{ phash: string | null }> = [];
  const resourceUpdates: Array<{ phash: string | null }> = [];
  let updateCallCount = 0;

  return {
    roundUpdates,
    resourceUpdates,
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(async () => rows),
        })),
      })),
    })),
    update: vi.fn((_table: unknown) => ({
      set: vi.fn((values: { phash?: string | null }) => ({
        where: vi.fn(async () => {
          updateCallCount += 1;
          if (updateCallCount % 2 === 1) {
            roundUpdates.push({ phash: values.phash ?? null });
            return;
          }
          resourceUpdates.push({ phash: values.phash ?? null });
        }),
      })),
    })),
  };
}

describe("phashScanService", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useRealTimers();
    getInstallScanStatusMock.mockReturnValue({ state: "idle" });
    generateVideoPhashMock.mockResolvedValue("phash-1");
    getCachedWebsiteVideoLocalPathMock.mockResolvedValue(null);
  });

  it("computes phash for cached website videos via the phash service", async () => {
    const dbMock = buildDbMock([
      {
        roundId: "round-1",
        roundName: "Round One",
        resourceId: "res-1",
        videoUri: "https://page.example/watch/1",
        startTime: 1000,
        endTime: 5000,
      },
    ]);
    getDbMock.mockReturnValue(dbMock);
    getCachedWebsiteVideoLocalPathMock.mockResolvedValue("/tmp/cached-website.mp4");

    const service = await import("./phashScanService");
    const result = await service.startPhashScanManual();

    expect(getCachedWebsiteVideoLocalPathMock).toHaveBeenCalledWith("https://page.example/watch/1");
    expect(generateVideoPhashMock).toHaveBeenCalledWith("/tmp/cached-website.mp4", 1000, 5000, {
      lowPriority: true,
    });
    expect(dbMock.roundUpdates).toHaveLength(1);
    expect(dbMock.resourceUpdates).toHaveLength(1);
    expect(result.state).toBe("done");
    expect(result.completedCount).toBe(1);
  });

  it("queues a rerun when another phash scan is requested during an active scan", async () => {
    vi.useFakeTimers();

    const rowsByPass = [
      [
        {
          roundId: "round-1",
          roundName: "Round One",
          resourceId: "res-1",
          videoUri: "https://page.example/watch/1",
          startTime: 1000,
          endTime: 5000,
        },
      ],
      [
        {
          roundId: "round-2",
          roundName: "Round Two",
          resourceId: "res-2",
          videoUri: "https://page.example/watch/2",
          startTime: 2000,
          endTime: 6000,
        },
      ],
      [],
    ];

    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(async () => rowsByPass.shift() ?? []),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => undefined),
        })),
      })),
    });

    const releases = new Map<string, () => void>();
    getCachedWebsiteVideoLocalPathMock.mockImplementation(async (videoUri: string) => {
      if (videoUri.endsWith("/1")) return "/tmp/cached-website-1.mp4";
      if (videoUri.endsWith("/2")) return "/tmp/cached-website-2.mp4";
      return null;
    });
    generateVideoPhashMock.mockImplementation(
      (videoPath: string) =>
        new Promise<string>((resolve) => {
          releases.set(videoPath, () => resolve(`phash:${videoPath}`));
        })
    );

    const service = await import("./phashScanService");
    const firstRun = service.startPhashScanManual();

    await vi.waitFor(() => {
      expect(generateVideoPhashMock).toHaveBeenCalledWith("/tmp/cached-website-1.mp4", 1000, 5000, {
        lowPriority: true,
      });
    });

    await service.startPhashScanManual();

    releases.get("/tmp/cached-website-1.mp4")?.();
    await vi.runAllTimersAsync();

    await vi.waitFor(() => {
      expect(generateVideoPhashMock).toHaveBeenCalledWith("/tmp/cached-website-2.mp4", 2000, 6000, {
        lowPriority: true,
      });
    });

    releases.get("/tmp/cached-website-2.mp4")?.();
    await vi.runAllTimersAsync();

    await firstRun;
    expect(service.getPhashScanStatus().state).toBe("done");
    expect(generateVideoPhashMock).toHaveBeenCalledTimes(2);
  });
});
