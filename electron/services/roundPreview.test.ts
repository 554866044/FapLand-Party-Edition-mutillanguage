import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateRoundPreviewImageDataUri } from "./roundPreview";

const {
  resolvePhashBinariesMock,
  runCommandMock,
  getCachedWebsiteVideoLocalPathMock,
  getWebsiteVideoTargetUrlMock,
  storeGetMock,
} = vi.hoisted(() => ({
  resolvePhashBinariesMock: vi.fn(),
  runCommandMock: vi.fn(),
  getCachedWebsiteVideoLocalPathMock: vi.fn(),
  getWebsiteVideoTargetUrlMock: vi.fn(),
  storeGetMock: vi.fn(),
}));

vi.mock("./phash/binaries", () => ({
  resolvePhashBinaries: resolvePhashBinariesMock,
}));

vi.mock("./phash/extract", () => ({
  runCommand: runCommandMock,
}));

vi.mock("./webVideo", () => ({
  getCachedWebsiteVideoLocalPath: getCachedWebsiteVideoLocalPathMock,
  getWebsiteVideoTargetUrl: getWebsiteVideoTargetUrlMock,
}));

vi.mock("./store", () => ({
  getStore: () => ({
    get: storeGetMock,
  }),
}));

describe("generateRoundPreviewImageDataUri", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePhashBinariesMock.mockResolvedValue({
      ffmpegPath: "/tmp/ffmpeg",
      ffprobePath: "/tmp/ffprobe",
    });
    getCachedWebsiteVideoLocalPathMock.mockResolvedValue(null);
    getWebsiteVideoTargetUrlMock.mockReturnValue(null);
    storeGetMock.mockReturnValue(false);
  });

  it("extracts a compact jpeg preview sized for the UI", async () => {
    runCommandMock.mockResolvedValue({
      stdout: Buffer.from("preview-bytes"),
      stderr: Buffer.alloc(0),
    });

    const result = await generateRoundPreviewImageDataUri({
      videoUri: "file:///tmp/video.mp4",
      startTimeMs: 5_000,
      endTimeMs: 9_000,
    });

    expect(result).toBe(
      `data:image/jpeg;base64,${Buffer.from("preview-bytes").toString("base64")}`
    );
    expect(runCommandMock).toHaveBeenCalledWith("/tmp/ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-ss",
      "7.000000",
      "-i",
      "/tmp/video.mp4",
      "-frames:v",
      "1",
      "-vf",
      "scale=480:-2",
      "-q:v",
      "6",
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "-",
    ]);
  });

  it("adds single-thread ffmpeg args only when the setting is enabled", async () => {
    storeGetMock.mockReturnValue(true);
    runCommandMock.mockResolvedValue({
      stdout: Buffer.from("preview-bytes"),
      stderr: Buffer.alloc(0),
    });

    await generateRoundPreviewImageDataUri({
      videoUri: "file:///tmp/video.mp4",
    });

    expect(runCommandMock).toHaveBeenCalledWith(
      "/tmp/ffmpeg",
      expect.arrayContaining(["-threads", "1"])
    );
  });

  it("returns null for unsupported uris", async () => {
    const result = await generateRoundPreviewImageDataUri({
      videoUri: "ftp://example.com/video.mp4",
    });

    expect(result).toBeNull();
    expect(runCommandMock).not.toHaveBeenCalled();
  });

  it("uses a cached website video file for proxied website uris", async () => {
    getCachedWebsiteVideoLocalPathMock.mockResolvedValue("/tmp/cached-video.mp4");
    runCommandMock.mockResolvedValue({
      stdout: Buffer.from("preview-bytes"),
      stderr: Buffer.alloc(0),
    });

    const result = await generateRoundPreviewImageDataUri({
      videoUri: "app://external/web-url?target=https%3A%2F%2Fexample.com%2Fwatch%3Fv%3D1",
      startTimeMs: 2_000,
      endTimeMs: 6_000,
    });

    expect(result).toBe(
      `data:image/jpeg;base64,${Buffer.from("preview-bytes").toString("base64")}`
    );
    expect(getCachedWebsiteVideoLocalPathMock).toHaveBeenCalledWith(
      "app://external/web-url?target=https%3A%2F%2Fexample.com%2Fwatch%3Fv%3D1"
    );
    expect(runCommandMock).toHaveBeenCalledWith(
      "/tmp/ffmpeg",
      expect.arrayContaining(["-i", "/tmp/cached-video.mp4"])
    );
  });

  it("falls back to the underlying website target url when no cached file exists", async () => {
    getWebsiteVideoTargetUrlMock.mockReturnValue("https://example.com/watch?v=1");
    runCommandMock.mockResolvedValue({
      stdout: Buffer.from("preview-bytes"),
      stderr: Buffer.alloc(0),
    });

    const result = await generateRoundPreviewImageDataUri({
      videoUri: "app://external/web-url?target=https%3A%2F%2Fexample.com%2Fwatch%3Fv%3D1",
    });

    expect(result).toBe(
      `data:image/jpeg;base64,${Buffer.from("preview-bytes").toString("base64")}`
    );
    expect(runCommandMock).toHaveBeenCalledWith(
      "/tmp/ffmpeg",
      expect.arrayContaining(["-i", "https://example.com/watch?v=1"])
    );
  });
});
