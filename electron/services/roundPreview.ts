import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePhashBinaries } from "./phash/binaries";
import { runCommand } from "./phash/extract";
import { getCachedWebsiteVideoLocalPath, getWebsiteVideoTargetUrl } from "./webVideo";

const PREVIEW_IMAGE_WIDTH = 480;
const PREVIEW_JPEG_QUALITY = 6;

type GenerateRoundPreviewImageInput = {
  videoUri: string;
  startTimeMs?: number | null;
  endTimeMs?: number | null;
};

function normalizeTimestampMs(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.floor(value);
  return rounded >= 0 ? rounded : null;
}

function resolvePreviewTimestampMs(startTimeMs?: number | null, endTimeMs?: number | null): number {
  const normalizedStart = normalizeTimestampMs(startTimeMs);
  const normalizedEnd = normalizeTimestampMs(endTimeMs);

  if (normalizedStart !== null && normalizedEnd !== null && normalizedEnd > normalizedStart) {
    return Math.floor((normalizedStart + normalizedEnd) / 2);
  }

  if (normalizedStart !== null) {
    return normalizedStart;
  }

  if (normalizedEnd !== null) {
    return Math.max(0, normalizedEnd - 1000);
  }

  return 1000;
}

async function toFfmpegInput(videoUri: string): Promise<string | null> {
  try {
    const parsed = new URL(videoUri);

    if (parsed.protocol === "app:" && parsed.hostname === "media") {
      return decodeURIComponent(parsed.pathname.replace(/^\/+/, "/"));
    }

    if (parsed.protocol === "file:") {
      return fileURLToPath(parsed);
    }

    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    // fall through to website cache / proxy resolution below
  }

  const cachedLocalPath = await getCachedWebsiteVideoLocalPath(videoUri);
  if (cachedLocalPath) {
    return path.normalize(cachedLocalPath);
  }

  return getWebsiteVideoTargetUrl(videoUri);
}

export async function generateRoundPreviewImageDataUri(input: GenerateRoundPreviewImageInput): Promise<string | null> {
  const ffmpegInput = await toFfmpegInput(input.videoUri);
  if (!ffmpegInput) return null;

  const timestampMs = resolvePreviewTimestampMs(input.startTimeMs, input.endTimeMs);
  const timestampSeconds = (timestampMs / 1000).toFixed(6);

  try {
    const binaries = await resolvePhashBinaries();
    const { stdout } = await runCommand(binaries.ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-ss",
      timestampSeconds,
      "-i",
      ffmpegInput,
      "-frames:v",
      "1",
      "-vf",
      `scale=${PREVIEW_IMAGE_WIDTH}:-2`,
      "-q:v",
      `${PREVIEW_JPEG_QUALITY}`,
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "-",
    ]);

    if (stdout.length === 0) return null;
    return `data:image/jpeg;base64,${stdout.toString("base64")}`;
  } catch {
    return null;
  }
}
