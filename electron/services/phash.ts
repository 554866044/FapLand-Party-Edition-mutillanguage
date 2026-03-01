import { resolvePhashBinaries } from "./phash/binaries";
import { decodeBmpFrame } from "./phash/bmp";
import { extractSpriteBmp } from "./phash/extract";
import { generateSpritePhashHex } from "./phash/phash";
import { probeVideoDurationMs } from "./phash/probe";
import { normalizeVideoHashRange, toVideoHashRangeCacheKey } from "./phash/range";
import type { NormalizedVideoHashRange } from "./phash/types";

export type { NormalizedVideoHashRange };
export { resolvePhashBinaries, toVideoHashRangeCacheKey };

export async function getNormalizedVideoHashRange(
  videoPath: string,
  startTimeMs?: number,
  endTimeMs?: number
): Promise<NormalizedVideoHashRange> {
  const binaries = await resolvePhashBinaries();
  const durationMs = await probeVideoDurationMs(binaries.ffprobePath, videoPath);
  return normalizeVideoHashRange(durationMs, startTimeMs, endTimeMs);
}

export async function generateVideoPhashForNormalizedRange(
  videoPath: string,
  range: NormalizedVideoHashRange,
  options?: { lowPriority?: boolean }
): Promise<string> {
  const binaries = await resolvePhashBinaries();

  const spriteBmp = await extractSpriteBmp(binaries.ffmpegPath, videoPath, range, options);

  const sprite = decodeBmpFrame(spriteBmp);
  return generateSpritePhashHex(sprite);
}

export async function generateVideoPhash(
  path: string,
  startTime?: number,
  endTime?: number,
  options?: { lowPriority?: boolean }
): Promise<string> {
  console.log("generateVideoPhash", path, startTime, endTime);
  const normalizedRange = await getNormalizedVideoHashRange(path, startTime, endTime);
  return generateVideoPhashForNormalizedRange(path, normalizedRange, options);
}
