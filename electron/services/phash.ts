import { resolvePhashBinaries } from "./phash/binaries";
import { normalizeVideoHashRange, toVideoHashRangeCacheKey } from "./phash/range";
import type { NormalizedVideoHashRange } from "./phash/types";
import { probeVideoDurationMs } from "./phash/probe";

import { computePhashInWorker } from "./phashWorkerClient";

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

  return computePhashInWorker(
    binaries.ffmpegPath,
    videoPath,
    range,
    options
  );
}

export async function generateVideoPhash(
  path: string,
  startTime?: number,
  endTime?: number,
  options?: { lowPriority?: boolean }
): Promise<string> {
  const normalizedRange = await getNormalizedVideoHashRange(path, startTime, endTime);
  return generateVideoPhashForNormalizedRange(path, normalizedRange, options);
}
