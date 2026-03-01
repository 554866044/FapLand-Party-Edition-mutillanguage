// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let userDataPath = "";
let storeValues = new Map<string, unknown>();

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => userDataPath),
    getAppPath: vi.fn(() => userDataPath),
  },
}));

vi.mock("./webVideo/binaries", () => ({
  resolveYtDlpBinary: vi.fn(async () => ({
    ytDlpPath: "/mock/yt-dlp",
    source: "bundled",
    version: "2025.12.08",
  })),
}));

vi.mock("./phash/extract", () => ({
  runCommand: vi.fn(),
}));

vi.mock("./store", () => ({
  getStore: () => ({
    get: (key: string) => storeValues.get(key),
  }),
}));

import { runCommand } from "./phash/extract";
import { WEBSITE_VIDEO_CACHE_ROOT_PATH_KEY } from "../../src/constants/websiteVideoCacheSettings";
import {
  __resetWebsiteVideoCachesForTests,
  buildWebsiteVideoCacheKey,
  clearWebsiteVideoCache,
  ensureWebsiteVideoCached,
  getCachedWebsiteVideoLocalPath,
  getWebsiteVideoCacheState,
  isDirectRemoteMediaUri,
  isWebsiteVideoCandidateUri,
  removeCachedWebsiteVideo,
} from "./webVideo";

describe("webVideo", () => {
  beforeEach(async () => {
    userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-web-video-"));
    storeValues = new Map();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    __resetWebsiteVideoCachesForTests();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await fs.rm(userDataPath, { recursive: true, force: true });
  });

  it("classifies direct media and webpage URLs correctly", () => {
    expect(isDirectRemoteMediaUri("https://cdn.example.com/video.mp4")).toBe(true);
    expect(isWebsiteVideoCandidateUri("https://cdn.example.com/video.mp4")).toBe(false);
    expect(isDirectRemoteMediaUri("https://www.xvideos.com/video123/example")).toBe(false);
    expect(isWebsiteVideoCandidateUri("https://www.xvideos.com/video123/example")).toBe(true);
  });

  it("builds stable cache keys", () => {
    expect(buildWebsiteVideoCacheKey("https://example.com/watch?v=1")).toBe(
      buildWebsiteVideoCacheKey("https://example.com/watch?v=1#ignored"),
    );
  });

  it("deduplicates concurrent downloads for the same URL", async () => {
    let releaseDownload: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      releaseDownload = resolve;
    });

    vi.mocked(runCommand).mockImplementation(async (_command, args) => {
      if (args.includes("--get-url")) {
        return {
          stdout: Buffer.from("https://media.example.com/direct.mp4\n", "utf8"),
          stderr: Buffer.alloc(0),
        };
      }
      if (args.includes("--dump-single-json")) {
        return {
          stdout: Buffer.from(JSON.stringify({
            url: "https://media.example.com/stream.mp4",
            extractor_key: "Generic",
            title: "Example",
            duration: 12.34,
          })),
          stderr: Buffer.alloc(0),
        };
      }

      await gate;
      const outputIndex = args.indexOf("--output");
      const outputTemplate = String(args[outputIndex + 1] ?? "");
      await fs.writeFile(outputTemplate.replace("%(ext)s", "mp4"), "video", "utf8");
      return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    });

    const first = ensureWebsiteVideoCached("https://example.com/watch?v=1");
    const second = ensureWebsiteVideoCached("https://example.com/watch?v=1");

    await vi.waitFor(() => {
      expect(vi.mocked(runCommand).mock.calls.filter(([, args]) => args.includes("--output"))).toHaveLength(1);
    });

    releaseDownload?.();
    const [a, b] = await Promise.all([first, second]);
    expect(a.finalFilePath).toBe(b.finalFilePath);
  });

  it("allows different URLs to download in parallel", async () => {
    let activeDownloads = 0;
    let peakDownloads = 0;
    let releaseA: (() => void) | null = null;
    let releaseB: (() => void) | null = null;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const gateB = new Promise<void>((resolve) => {
      releaseB = resolve;
    });

    vi.mocked(runCommand).mockImplementation(async (_command, args) => {
      if (args.includes("--get-url")) {
        return {
          stdout: Buffer.from("https://media.example.com/direct.mp4\n", "utf8"),
          stderr: Buffer.alloc(0),
        };
      }
      if (args.includes("--dump-single-json")) {
        return {
          stdout: Buffer.from(JSON.stringify({
            url: "https://media.example.com/stream.mp4",
            extractor_key: "Generic",
            title: "Example",
            duration: 12.34,
          })),
          stderr: Buffer.alloc(0),
        };
      }

      activeDownloads += 1;
      peakDownloads = Math.max(peakDownloads, activeDownloads);
      const outputIndex = args.indexOf("--output");
      const outputTemplate = String(args[outputIndex + 1] ?? "");
      const normalizedOutput = outputTemplate.replace("%(ext)s", "mp4");
      if (normalizedOutput.includes(buildWebsiteVideoCacheKey("https://example.com/watch?v=1"))) {
        await gateA;
      } else {
        await gateB;
      }
      await fs.writeFile(normalizedOutput, "video", "utf8");
      activeDownloads -= 1;
      return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    });

    const first = ensureWebsiteVideoCached("https://example.com/watch?v=1");
    const second = ensureWebsiteVideoCached("https://example.com/watch?v=2");

    await vi.waitFor(() => {
      expect(peakDownloads).toBe(2);
    });

    releaseA?.();
    releaseB?.();
    await Promise.all([first, second]);
  });

  it("reuses cached files without downloading again", async () => {
    vi.mocked(runCommand).mockImplementation(async (_command, args) => {
      if (args.includes("--get-url")) {
        return {
          stdout: Buffer.from("https://media.example.com/direct.mp4\n", "utf8"),
          stderr: Buffer.alloc(0),
        };
      }
      if (args.includes("--dump-single-json")) {
        return {
          stdout: Buffer.from(JSON.stringify({
            url: "https://media.example.com/stream.mp4",
            extractor_key: "Generic",
            title: "Example",
            duration: 12.34,
          })),
          stderr: Buffer.alloc(0),
        };
      }

      const outputIndex = args.indexOf("--output");
      const outputTemplate = String(args[outputIndex + 1] ?? "");
      await fs.writeFile(outputTemplate.replace("%(ext)s", "mp4"), "video", "utf8");
      return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    });

    const first = await ensureWebsiteVideoCached("https://example.com/watch?v=1");
    const second = await ensureWebsiteVideoCached("https://example.com/watch?v=1");
    expect(second.finalFilePath).toBe(first.finalFilePath);
    expect(vi.mocked(runCommand).mock.calls.filter(([, args]) => args.includes("--output"))).toHaveLength(1);
    expect(await getCachedWebsiteVideoLocalPath("https://example.com/watch?v=1")).toBe(first.finalFilePath);
  });

  it("logs when website video caching starts and finishes", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    vi.mocked(runCommand).mockImplementation(async (_command, args) => {
      if (args.includes("--get-url")) {
        return {
          stdout: Buffer.from("https://media.example.com/direct.mp4\n", "utf8"),
          stderr: Buffer.alloc(0),
        };
      }
      if (args.includes("--dump-single-json")) {
        return {
          stdout: Buffer.from(JSON.stringify({
            url: "https://media.example.com/stream.mp4",
            extractor_key: "Generic",
            title: "Example",
            duration: 12.34,
          })),
          stderr: Buffer.alloc(0),
        };
      }

      const outputIndex = args.indexOf("--output");
      const outputTemplate = String(args[outputIndex + 1] ?? "");
      await fs.writeFile(outputTemplate.replace("%(ext)s", "mp4"), "video", "utf8");
      return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    });

    await ensureWebsiteVideoCached("https://example.com/watch?v=1");

    expect(infoSpy).toHaveBeenCalledWith("[webVideo] Cache started: https://example.com/watch?v=1");
    expect(infoSpy).toHaveBeenCalledWith("[webVideo] Cache finished: https://example.com/watch?v=1");
    infoSpy.mockRestore();
  });

  it("treats interrupted downloads as pending and recaches them", async () => {
    const cacheKey = buildWebsiteVideoCacheKey("https://example.com/watch?v=1");
    const cacheDir = path.join(userDataPath, "web-video-cache", cacheKey);
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(
      path.join(cacheDir, "download-in-progress.json"),
      JSON.stringify({ startedAt: "2026-01-01T00:00:00.000Z" }),
      "utf8"
    );
    await fs.writeFile(path.join(cacheDir, "video.mp4"), "", "utf8");
    await fs.writeFile(
      path.join(cacheDir, "meta.json"),
      JSON.stringify({
        originalUrl: "https://example.com/watch?v=1",
        extractor: "Generic",
        title: "Broken",
        durationMs: 1234,
        finalFilePath: path.join(cacheDir, "video.mp4"),
        fileExtension: "mp4",
        ytDlpVersion: "2025.12.08",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastAccessedAt: "2026-01-01T00:00:00.000Z",
      }),
      "utf8"
    );

    vi.mocked(runCommand).mockImplementation(async (_command, args) => {
      if (args.includes("--get-url")) {
        return {
          stdout: Buffer.from("https://media.example.com/direct.mp4\n", "utf8"),
          stderr: Buffer.alloc(0),
        };
      }
      if (args.includes("--dump-single-json")) {
        return {
          stdout: Buffer.from(JSON.stringify({
            url: "https://media.example.com/stream.mp4",
            extractor_key: "Generic",
            title: "Recovered",
            duration: 12.34,
          })),
          stderr: Buffer.alloc(0),
        };
      }

      const outputIndex = args.indexOf("--output");
      const outputTemplate = String(args[outputIndex + 1] ?? "");
      await fs.writeFile(outputTemplate.replace("%(ext)s", "mp4"), "video", "utf8");
      return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    });

    expect(await getWebsiteVideoCacheState("https://example.com/watch?v=1")).toBe("pending");

    const recovered = await ensureWebsiteVideoCached("https://example.com/watch?v=1");

    expect(recovered.finalFilePath).toBe(path.join(cacheDir, "video.mp4"));
    expect(await getWebsiteVideoCacheState("https://example.com/watch?v=1")).toBe("cached");
    expect(await getCachedWebsiteVideoLocalPath("https://example.com/watch?v=1")).toBe(
      recovered.finalFilePath
    );
    expect(await fs.access(path.join(cacheDir, "download-in-progress.json")).catch(() => null)).toBeNull();
  });

  it("clears the on-disk website video cache", async () => {
    const cacheKey = buildWebsiteVideoCacheKey("https://example.com/watch?v=1");
    const cacheDir = path.join(userDataPath, "web-video-cache", cacheKey);
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(path.join(cacheDir, "video.mp4"), "video", "utf8");

    await clearWebsiteVideoCache();

    await expect(fs.access(cacheDir)).rejects.toThrow();
  });

  it("uses a configured custom website video cache root when one is set", async () => {
    const customRoot = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-web-video-custom-"));
    storeValues.set(WEBSITE_VIDEO_CACHE_ROOT_PATH_KEY, customRoot);

    vi.mocked(runCommand).mockImplementation(async (_command, args) => {
      if (args.includes("--get-url")) {
        return {
          stdout: Buffer.from("https://media.example.com/direct.mp4\n", "utf8"),
          stderr: Buffer.alloc(0),
        };
      }
      if (args.includes("--dump-single-json")) {
        return {
          stdout: Buffer.from(JSON.stringify({
            url: "https://media.example.com/stream.mp4",
            extractor_key: "Generic",
            title: "Example",
            duration: 12.34,
          })),
          stderr: Buffer.alloc(0),
        };
      }

      const outputIndex = args.indexOf("--output");
      const outputTemplate = String(args[outputIndex + 1] ?? "");
      await fs.writeFile(outputTemplate.replace("%(ext)s", "mp4"), "video", "utf8");
      return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    });

    const cached = await ensureWebsiteVideoCached("https://example.com/watch?v=1");
    expect(cached.finalFilePath.startsWith(customRoot)).toBe(true);
  });

  it("removes one cached website video on demand", async () => {
    vi.mocked(runCommand).mockImplementation(async (_command, args) => {
      if (args.includes("--get-url")) {
        return {
          stdout: Buffer.from("https://media.example.com/direct.mp4\n", "utf8"),
          stderr: Buffer.alloc(0),
        };
      }
      if (args.includes("--dump-single-json")) {
        return {
          stdout: Buffer.from(JSON.stringify({
            url: "https://media.example.com/stream.mp4",
            extractor_key: "Generic",
            title: "Example",
            duration: 12.34,
          })),
          stderr: Buffer.alloc(0),
        };
      }

      const outputIndex = args.indexOf("--output");
      const outputTemplate = String(args[outputIndex + 1] ?? "");
      await fs.writeFile(outputTemplate.replace("%(ext)s", "mp4"), "video", "utf8");
      return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    });

    const cached = await ensureWebsiteVideoCached("https://example.com/watch?v=1");
    expect(await getCachedWebsiteVideoLocalPath("https://example.com/watch?v=1")).toBe(cached.finalFilePath);

    await removeCachedWebsiteVideo("https://example.com/watch?v=1");

    expect(await getCachedWebsiteVideoLocalPath("https://example.com/watch?v=1")).toBeNull();
    expect(await getWebsiteVideoCacheState("https://example.com/watch?v=1")).toBe("pending");
  });

  it("does not recreate a removed cache after an in-flight download completes", async () => {
    let releaseDownload: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      releaseDownload = resolve;
    });

    vi.mocked(runCommand).mockImplementation(async (_command, args) => {
      if (args.includes("--get-url")) {
        return {
          stdout: Buffer.from("https://media.example.com/direct.mp4\n", "utf8"),
          stderr: Buffer.alloc(0),
        };
      }
      if (args.includes("--dump-single-json")) {
        return {
          stdout: Buffer.from(JSON.stringify({
            url: "https://media.example.com/stream.mp4",
            extractor_key: "Generic",
            title: "Example",
            duration: 12.34,
          })),
          stderr: Buffer.alloc(0),
        };
      }

      const outputIndex = args.indexOf("--output");
      const outputTemplate = String(args[outputIndex + 1] ?? "");
      await gate;
      await fs.writeFile(outputTemplate.replace("%(ext)s", "mp4"), "video", "utf8");
      return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    });

    const pending = ensureWebsiteVideoCached("https://example.com/watch?v=1");

    await vi.waitFor(() => {
      expect(vi.mocked(runCommand).mock.calls.filter(([, args]) => args.includes("--output"))).toHaveLength(1);
    });

    await removeCachedWebsiteVideo("https://example.com/watch?v=1");
    releaseDownload?.();

    await expect(pending).rejects.toThrow("removed before caching completed");
    expect(await getCachedWebsiteVideoLocalPath("https://example.com/watch?v=1")).toBeNull();
    expect(await getWebsiteVideoCacheState("https://example.com/watch?v=1")).toBe("pending");
  });

  it("prefers yt-dlp --get-url for live website streaming", async () => {
    vi.mocked(runCommand).mockImplementation(async (_command, args) => {
      if (args.includes("--get-url")) {
        return {
          stdout: Buffer.from("https://media.example.com/direct.mp4\n", "utf8"),
          stderr: Buffer.alloc(0),
        };
      }
      if (args.includes("--dump-single-json")) {
        return {
          stdout: Buffer.from(JSON.stringify({
            url: "https://media.example.com/fallback.mp4",
            http_headers: { Referer: "https://example.com/" },
            extractor_key: "Generic",
            title: "Example",
            duration: 12.34,
          })),
          stderr: Buffer.alloc(0),
        };
      }
      return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    });

    const { resolveWebsiteVideoStream } = await import("./webVideo");
    const result = await resolveWebsiteVideoStream("https://example.com/watch?v=1");

    expect(result).toEqual({
      streamUrl: "https://media.example.com/direct.mp4",
      headers: { Referer: "https://example.com/" },
      extractor: "Generic",
      title: "Example",
      durationMs: 12340,
      contentType: "video/mp4",
      playbackStrategy: "remote",
    });
  });

  it("prefers a browser-playable progressive format over a manifest url", async () => {
    vi.mocked(runCommand).mockImplementation(async (_command, args) => {
      if (args.includes("--get-url")) {
        return {
          stdout: Buffer.from("https://media.example.com/master.m3u8\n", "utf8"),
          stderr: Buffer.alloc(0),
        };
      }
      if (args.includes("--dump-single-json")) {
        return {
          stdout: Buffer.from(JSON.stringify({
            url: "https://media.example.com/master.m3u8",
            http_headers: { Referer: "https://example.com/" },
            extractor_key: "Generic",
            title: "Example",
            duration: 12.34,
            formats: [
              {
                url: "https://media.example.com/master.m3u8",
                ext: "mp4",
                protocol: "m3u8_native",
                vcodec: "h264",
                acodec: "aac",
                height: 1080,
                tbr: 4000,
              },
              {
                url: "https://media.example.com/progressive.mp4",
                ext: "mp4",
                protocol: "https",
                vcodec: "h264",
                acodec: "aac",
                height: 720,
                tbr: 2200,
              },
            ],
          }), "utf8"),
          stderr: Buffer.alloc(0),
        };
      }
      return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    });

    const { resolveWebsiteVideoStream } = await import("./webVideo");
    const result = await resolveWebsiteVideoStream("https://example.com/watch?v=1");

    expect(result.streamUrl).toBe("https://media.example.com/progressive.mp4");
    expect(result.headers).toEqual({ Referer: "https://example.com/" });
    expect(result.contentType).toBe("video/mp4");
    expect(result.playbackStrategy).toBe("remote");
  });

  it("uses per-format headers for a selected progressive stream", async () => {
    vi.mocked(runCommand).mockImplementation(async (_command, args) => {
      if (args.includes("--get-url")) {
        return {
          stdout: Buffer.from("https://media.example.com/master.m3u8\n", "utf8"),
          stderr: Buffer.alloc(0),
        };
      }
      if (args.includes("--dump-single-json")) {
        return {
          stdout: Buffer.from(JSON.stringify({
            extractor_key: "XVideos",
            title: "Example",
            duration: 12.34,
            formats: [
              {
                url: "https://media.example.com/video_360p.mp4",
                ext: "mp4",
                protocol: "https",
                vcodec: "h264",
                acodec: "none",
                http_headers: {
                  "User-Agent": "Mozilla/5.0 Test",
                  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                },
              },
            ],
          }), "utf8"),
          stderr: Buffer.alloc(0),
        };
      }
      return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    });

    const { resolveWebsiteVideoStream } = await import("./webVideo");
    const result = await resolveWebsiteVideoStream("https://example.com/watch?v=1");

    expect(result.streamUrl).toBe("https://media.example.com/video_360p.mp4");
    expect(result.headers).toEqual({
      "User-Agent": "Mozilla/5.0 Test",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    });
    expect(result.contentType).toBe("video/mp4");
    expect(result.playbackStrategy).toBe("remote");
  });

  it("falls back to the JSON-derived URL when --get-url does not succeed", async () => {
    vi.mocked(runCommand).mockImplementation(async (_command, args) => {
      if (args.includes("--get-url")) {
        throw new Error("get-url failed");
      }
      if (args.includes("--dump-single-json")) {
        return {
          stdout: Buffer.from(JSON.stringify({
            url: "https://media.example.com/fallback.mp4",
            http_headers: { Referer: "https://example.com/" },
            extractor_key: "Generic",
            title: "Example",
            duration: 12.34,
          })),
          stderr: Buffer.alloc(0),
        };
      }
      return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    });

    const { resolveWebsiteVideoStream } = await import("./webVideo");
    const result = await resolveWebsiteVideoStream("https://example.com/watch?v=1");

    expect(result.streamUrl).toBe("https://media.example.com/fallback.mp4");
    expect(result.headers).toEqual({ Referer: "https://example.com/" });
    expect(result.contentType).toBe("video/mp4");
    expect(result.playbackStrategy).toBe("remote");
  });

  it("falls back to a direct media URL exposed in page HTML when yt-dlp fails", async () => {
    vi.mocked(runCommand).mockImplementation(async (_command, args) => {
      if (args.includes("--get-url") || args.includes("--dump-single-json")) {
        throw new Error("No video formats found");
      }
      return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          `<html><body><a href="https://video7.xhcdn.com/key=abc/video.mp4?e=123&amp;h=456">play</a></body></html>`,
          { status: 200, headers: { "Content-Type": "text/html" } }
        )
      )
    );

    const { resolveWebsiteVideoStream } = await import("./webVideo");
    const result = await resolveWebsiteVideoStream("https://xhamster.com/videos/example");

    expect(result).toEqual({
      streamUrl: "https://video7.xhcdn.com/key=abc/video.mp4?e=123&h=456",
      headers: { Referer: "https://xhamster.com/videos/example" },
      extractor: "html_fallback",
      title: null,
      durationMs: null,
      contentType: "video/mp4",
      playbackStrategy: "remote",
    });
  });

  it("treats extensionless progressive candidates as direct remote playback", async () => {
    vi.mocked(runCommand).mockImplementation(async (_command, args) => {
      if (args.includes("--get-url")) {
        return {
          stdout: Buffer.from("https://media.example.com/manifest.m3u8\n", "utf8"),
          stderr: Buffer.alloc(0),
        };
      }
      if (args.includes("--dump-single-json")) {
        return {
          stdout: Buffer.from(JSON.stringify({
            extractor_key: "Generic",
            title: "Example",
            duration: 12.34,
            formats: [
              {
                url: "https://media.example.com/play?token=abc",
                ext: "mp4",
                protocol: "https",
                vcodec: "h264",
                acodec: "aac",
                height: 720,
                tbr: 2200,
              },
            ],
          }), "utf8"),
          stderr: Buffer.alloc(0),
        };
      }
      return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    });

    const { resolveWebsiteVideoStream } = await import("./webVideo");
    const result = await resolveWebsiteVideoStream("https://example.com/watch?v=1");

    expect(result.streamUrl).toBe("https://media.example.com/play?token=abc");
    expect(result.contentType).toBe("video/mp4");
    expect(result.playbackStrategy).toBe("remote");
  });
});
