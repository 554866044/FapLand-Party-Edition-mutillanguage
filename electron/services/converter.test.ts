// @vitest-environment node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fromUriToLocalPath,
  saveConvertedRounds,
  toDeterministicInstallSourceKey,
  validateAndNormalizeSegments,
} from "./converter";

const mocks = vi.hoisted(() => {
  const savedRounds: Array<{ id: string; phash: string | null; startTime: number; endTime: number }> = [];
  const savedResources: Array<{ roundId: string; videoUri: string; phash: string | null }> = [];

  return {
    savedRounds,
    savedResources,
    generateVideoPhash: vi.fn(),
    generateRoundPreviewImageDataUri: vi.fn(async () => null),
  };
});

vi.mock("./phash", () => ({
  generateVideoPhash: mocks.generateVideoPhash,
}));

vi.mock("./roundPreview", () => ({
  generateRoundPreviewImageDataUri: mocks.generateRoundPreviewImageDataUri,
}));

vi.mock("./db", () => ({
  getDb: () => ({
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(createMockTx()),
  }),
}));

function createMockTx() {
  return {
    query: {
      hero: {
        findFirst: vi.fn(async () => null),
      },
      round: {
        findFirst: vi.fn(async () => null),
      },
    },
    insert: vi.fn(() => ({
      values: vi.fn((value: Record<string, unknown>) => ({
        returning: vi.fn(async () => {
          if ("roundId" in value && "videoUri" in value) {
            mocks.savedResources.push({
              roundId: String(value.roundId),
              videoUri: String(value.videoUri),
              phash: typeof value.phash === "string" ? value.phash : null,
            });
            return [{ id: `resource-${mocks.savedResources.length}` }];
          }

          if ("installSourceKey" in value || "startTime" in value || "endTime" in value) {
            const id = `round-${mocks.savedRounds.length + 1}`;
            mocks.savedRounds.push({
              id,
              phash: typeof value.phash === "string" ? value.phash : null,
              startTime: Number(value.startTime),
              endTime: Number(value.endTime),
            });
            return [{ id }];
          }

          return [{ id: "hero-1" }];
        }),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => [{ id: "round-updated" }]),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => []),
      })),
    })),
  };
}

function toAppMediaUri(filePath: string): string {
  return `app://media/${encodeURIComponent(filePath)}`;
}

let tempDirs: string[] = [];

beforeEach(() => {
  mocks.savedRounds.length = 0;
  mocks.savedResources.length = 0;
  mocks.generateVideoPhash.mockReset();
  mocks.generateRoundPreviewImageDataUri.mockClear();
});

afterEach(async () => {
  const dirs = tempDirs;
  tempDirs = [];
  await Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function writeTempVideo(contents: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fland-converter-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, "source.mp4");
  await fs.writeFile(filePath, contents);
  return filePath;
}

describe("converter helpers", () => {
  it("sorts and validates segments", () => {
    const normalized = validateAndNormalizeSegments([
      { startTimeMs: 3000, endTimeMs: 6000, type: "Normal" },
      { startTimeMs: 0, endTimeMs: 2000, type: "Cum" },
    ]);

    expect(normalized).toEqual([
      { startTimeMs: 0, endTimeMs: 2000, type: "Cum", customName: null, bpm: null, difficulty: null },
      { startTimeMs: 3000, endTimeMs: 6000, type: "Normal", customName: null, bpm: null, difficulty: null },
    ]);
  });

  it("normalizes custom segment names", () => {
    const normalized = validateAndNormalizeSegments([
      { startTimeMs: 0, endTimeMs: 2000, type: "Normal", customName: "  Intro Segment  " },
      { startTimeMs: 3000, endTimeMs: 6000, type: "Cum", customName: "   " },
    ]);

    expect(normalized[0]?.customName).toBe("Intro Segment");
    expect(normalized[1]?.customName).toBeNull();
  });

  it("normalizes and validates bpm and difficulty", () => {
    const normalized = validateAndNormalizeSegments([
      { startTimeMs: 0, endTimeMs: 2000, type: "Normal", bpm: 119.7, difficulty: 4 },
      { startTimeMs: 3000, endTimeMs: 6000, type: "Cum", bpm: null, difficulty: null },
    ]);

    expect(normalized[0]?.bpm).toBe(120);
    expect(normalized[0]?.difficulty).toBe(4);
    expect(normalized[1]?.bpm).toBeNull();
    expect(normalized[1]?.difficulty).toBeNull();
  });

  it("rejects invalid bpm", () => {
    expect(() =>
      validateAndNormalizeSegments([{ startTimeMs: 0, endTimeMs: 2000, type: "Normal", bpm: 0 }]),
    ).toThrow(/bpm/i);
    expect(() =>
      validateAndNormalizeSegments([{ startTimeMs: 0, endTimeMs: 2000, type: "Normal", bpm: 401 }]),
    ).toThrow(/bpm/i);
    expect(() =>
      validateAndNormalizeSegments([{ startTimeMs: 0, endTimeMs: 2000, type: "Normal", bpm: Number.NaN }]),
    ).toThrow(/bpm/i);
  });

  it("rejects invalid difficulty", () => {
    expect(() =>
      validateAndNormalizeSegments([{ startTimeMs: 0, endTimeMs: 2000, type: "Normal", difficulty: 0 }]),
    ).toThrow(/difficulty/i);
    expect(() =>
      validateAndNormalizeSegments([{ startTimeMs: 0, endTimeMs: 2000, type: "Normal", difficulty: 6 }]),
    ).toThrow(/difficulty/i);
    expect(() =>
      validateAndNormalizeSegments([{ startTimeMs: 0, endTimeMs: 2000, type: "Normal", difficulty: 2.5 }]),
    ).toThrow(/difficulty/i);
  });

  it("rejects overlapping segments", () => {
    expect(() =>
      validateAndNormalizeSegments([
        { startTimeMs: 0, endTimeMs: 3000, type: "Normal" },
        { startTimeMs: 2000, endTimeMs: 4000, type: "Interjection" },
      ]),
    ).toThrow(/overlap/i);
  });

  it("builds deterministic install source keys", () => {
    const first = toDeterministicInstallSourceKey({
      heroName: "Test Hero",
      videoUri: "app://media/%2Ftmp%2Fvideo.mp4",
      funscriptUri: "app://media/%2Ftmp%2Fvideo.funscript",
      startTimeMs: 1000,
      endTimeMs: 5000,
    });

    const second = toDeterministicInstallSourceKey({
      heroName: "Test Hero",
      videoUri: "app://media/%2Ftmp%2Fvideo.mp4",
      funscriptUri: "app://media/%2Ftmp%2Fvideo.funscript",
      startTimeMs: 1000,
      endTimeMs: 5000,
    });

    const third = toDeterministicInstallSourceKey({
      heroName: "Test Hero",
      videoUri: "app://media/%2Ftmp%2Fvideo.mp4",
      funscriptUri: "app://media/%2Ftmp%2Fvideo.funscript",
      startTimeMs: 1200,
      endTimeMs: 5000,
    });

    expect(first).toBe(second);
    expect(third).not.toBe(first);
  });

  it("resolves app and file uris to local paths", () => {
    expect(fromUriToLocalPath("app://media/%2Ftmp%2Fvideo.mp4")).toBe("/tmp/video.mp4");
    expect(fromUriToLocalPath("https://cdn.example.com/video.mp4")).toBeNull();
  });
});

describe("saveConvertedRounds phash fallback", () => {
  it("uses a sha256 fallback when video phash generation fails", async () => {
    mocks.generateVideoPhash.mockRejectedValue(new Error("phash failed"));
    const filePath = await writeTempVideo("video-data");
    const expectedHash = crypto.createHash("sha256").update("video-data").digest("hex");

    const result = await saveConvertedRounds({
      hero: { name: "Fallback Hero" },
      source: { videoUri: toAppMediaUri(filePath) },
      segments: [{ startTimeMs: 1000, endTimeMs: 2000, type: "Normal" }],
    });

    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0]?.phash).toBe(`sha256:${expectedHash}@1000-2000`);
    expect(mocks.savedRounds[0]?.phash).toBe(`sha256:${expectedHash}@1000-2000`);
  });

  it("shares one fallback file hash across concurrent failed segment phashes", async () => {
    mocks.generateVideoPhash.mockRejectedValue(new Error("phash failed"));
    const filePath = await writeTempVideo("shared-video-data");
    const expectedHash = crypto.createHash("sha256").update("shared-video-data").digest("hex");

    const result = await saveConvertedRounds({
      hero: { name: "Multi Segment Hero" },
      source: { videoUri: toAppMediaUri(filePath) },
      segments: [
        { startTimeMs: 1000, endTimeMs: 2000, type: "Normal" },
        { startTimeMs: 3000, endTimeMs: 4000, type: "Interjection" },
        { startTimeMs: 5000, endTimeMs: 6000, type: "Cum" },
      ],
    });

    expect(result.rounds.map((round) => round.phash)).toEqual([
      `sha256:${expectedHash}@1000-2000`,
      `sha256:${expectedHash}@3000-4000`,
      `sha256:${expectedHash}@5000-6000`,
    ]);
    expect(new Set(result.rounds.map((round) => round.phash?.split("@")[0]))).toEqual(
      new Set([`sha256:${expectedHash}`]),
    );
  });

  it("uses the generated video phash when available", async () => {
    mocks.generateVideoPhash.mockResolvedValue("phash-1");
    const filePath = await writeTempVideo("video-data");

    const result = await saveConvertedRounds({
      hero: { name: "Generated Phash Hero" },
      source: { videoUri: toAppMediaUri(filePath) },
      segments: [{ startTimeMs: 1000, endTimeMs: 2000, type: "Normal" }],
    });

    expect(result.rounds[0]?.phash).toBe("phash-1");
    expect(mocks.savedRounds[0]?.phash).toBe("phash-1");
  });
});
