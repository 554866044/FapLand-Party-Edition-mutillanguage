import crypto from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { app } from "electron";
import { inArray } from "drizzle-orm";
import { ZHeroSidecar, ZRoundSidecar } from "../../src/zod/installSidecar";
import { getDb } from "./db";
import { round as roundTable } from "./db/schema";
import { createFpackFromDirectory } from "./fpack";
import { fetchStashMediaWithAuth } from "./integrations/stashClient";
import { stashProvider } from "./integrations/providers/stashProvider";
import { listExternalSources, normalizeBaseUrl } from "./integrations/store";
import { fromLocalMediaUri, toPortableRelativePath } from "./localMedia";
import {
  detectAv1Encoder,
  isAv1Codec,
  normalizeCompressionStrength,
  probeLocalVideo,
  transcodeVideoToAv1,
  type Av1EncoderDetails,
  type PlaylistExportCompressionEncoderKind,
  type PlaylistExportCompressionMode,
  type PlaylistExportCompressionPhase,
  type PlaylistExportVideoProbe,
} from "./playlistExportCompression";
import { resolvePhashBinaries } from "./phash/binaries";
import { getCachedWebsiteVideoLocalPath } from "./webVideo";

export type LibraryExportPackageInput = {
  roundIds?: string[];
  heroIds?: string[];
  includeMedia?: boolean;
  directoryPath?: string;
  asFpack?: boolean;
  compressionMode?: PlaylistExportCompressionMode;
  compressionStrength?: number;
};

export type LibraryExportPackageState = "idle" | "running" | "done" | "aborted" | "error";

export type LibraryExportPackageCompressionStatus = {
  enabled: boolean;
  encoderName: string | null;
  encoderKind: PlaylistExportCompressionEncoderKind | null;
  strength: number;
  reencodedCompleted: number;
  reencodedTotal: number;
  alreadyAv1Copied: number;
  activeJobs: number;
};

export type LibraryExportPackageStatus = {
  state: LibraryExportPackageState;
  phase: PlaylistExportCompressionPhase;
  startedAt: string | null;
  finishedAt: string | null;
  lastMessage: string | null;
  progress: {
    completed: number;
    total: number;
  };
  stats: {
    heroFiles: number;
    roundFiles: number;
    videoFiles: number;
    funscriptFiles: number;
  };
  compression: LibraryExportPackageCompressionStatus | null;
};

export type LibraryExportPackageResult = {
  exportDir: string;
  fpackPath?: string;
  heroFiles: number;
  roundFiles: number;
  videoFiles: number;
  funscriptFiles: number;
  exportedRounds: number;
  includeMedia: boolean;
  compression: {
    enabled: boolean;
    encoderName: string | null;
    encoderKind: PlaylistExportCompressionEncoderKind | null;
    strength: number;
    reencodedVideos: number;
    alreadyAv1Copied: number;
    actualVideoBytes: number;
  };
};

type ExportableResource = {
  videoUri: string;
  funscriptUri: string | null;
  phash: string | null;
  durationMs: number | null;
};

type ExportableHero = {
  id: string;
  name: string;
  author: string | null;
  description: string | null;
  phash: string | null;
};

type ExportableRound = {
  id: string;
  name: string;
  author: string | null;
  description: string | null;
  bpm: number | null;
  difficulty: number | null;
  phash: string | null;
  startTime: number | null;
  endTime: number | null;
  type: "Normal" | "Interjection" | "Cum";
  installSourceKey: string | null;
  heroId: string | null;
  hero: ExportableHero | null;
  resources: ExportableResource[];
};

type ExportedMediaFile = {
  absolutePath: string;
  relativePath: string;
};

type VideoTask = {
  canonicalKey: string;
  uri: string;
  installSourceKey: string | null;
  preferredBaseName: string;
  originalExtension: string;
  probe: PlaylistExportVideoProbe;
  output: ExportedMediaFile | null;
};

type FunscriptTask = {
  canonicalKey: string;
  uri: string;
  installSourceKey: string | null;
  preferredBaseName: string;
  output: ExportedMediaFile | null;
};

type ResourceReference = {
  round: ExportableRound;
  resource: ExportableResource;
  preferredBaseName: string;
};

type RoundResourceEntry = {
  round: ExportableRound;
  resource: ExportableResource;
  materialized: {
    canonicalVideoKey: string;
    video: ExportedMediaFile | null;
    funscript: ExportedMediaFile | null;
  };
};

const WINDOWS_RESERVED_BASENAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

let exportStatus: LibraryExportPackageStatus = {
  state: "idle",
  phase: "idle",
  startedAt: null,
  finishedAt: null,
  lastMessage: null,
  progress: { completed: 0, total: 0 },
  stats: { heroFiles: 0, roundFiles: 0, videoFiles: 0, funscriptFiles: 0 },
  compression: null,
};

const activeEncodeChildren = new Set<ChildProcess>();

function toSafeIsoTimestamp(date: Date): string {
  return date.toISOString().replace(/:/g, "-");
}

export function sanitizeFileSystemName(value: string, fallback = "unnamed"): string {
  const trimmed = value.trim();
  const stripped = trimmed
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  const normalized = stripped.length > 0 ? stripped : fallback;
  const reservedSafe = WINDOWS_RESERVED_BASENAMES.has(normalized.toUpperCase())
    ? `${normalized}_`
    : normalized;
  return reservedSafe || fallback;
}

function sanitizeExtension(value: string, fallback: string): string {
  const normalized = value.trim().toLowerCase();
  if (/^\.[a-z0-9]{1,12}$/i.test(normalized)) {
    return normalized;
  }
  return fallback;
}

function inferExtensionFromUri(uri: string, fallback: string): string {
  const localPath = fromLocalMediaUri(uri);
  if (localPath) {
    return sanitizeExtension(path.extname(localPath), fallback);
  }
  try {
    const parsed = new URL(uri);
    return sanitizeExtension(path.posix.extname(decodeURIComponent(parsed.pathname)), fallback);
  } catch {
    return fallback;
  }
}

function canonicalizeResourceKey(uri: string): string {
  const localPath = fromLocalMediaUri(uri);
  if (localPath) {
    return `local:${path.normalize(localPath)}`;
  }
  try {
    return new URL(uri).toString();
  } catch {
    return uri.trim();
  }
}

async function resolveLocalSourcePath(uri: string): Promise<string | null> {
  const localPath = fromLocalMediaUri(uri);
  if (localPath) return localPath;
  return getCachedWebsiteVideoLocalPath(uri);
}

function toUniqueCaseInsensitiveFileName(
  usedNames: Set<string>,
  baseName: string,
  extension: string
): string {
  const normalizedExtension = extension.startsWith(".") ? extension : `.${extension}`;
  let candidate = `${baseName}${normalizedExtension}`;
  let suffix = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${baseName}-${suffix}${normalizedExtension}`;
    suffix += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

async function writeJsonFile(filePath: string, payload: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

type ExternalSourceRecord = ReturnType<typeof listExternalSources>[number];

async function resolveRemoteResponse(
  uri: string,
  installSourceKey: string | null,
  request: Request
): Promise<Response> {
  const enabledSources = listExternalSources().filter((source) => source.enabled);
  for (const source of enabledSources) {
    if (source.kind !== "stash") continue;
    const shouldUseByInstallSource = installSourceKey?.startsWith(
      `stash:${normalizeBaseUrl(source.baseUrl)}:scene:`
    );
    const shouldUseByUri = stashProvider.canHandleUri(uri, source);
    if (!shouldUseByInstallSource && !shouldUseByUri) continue;
    return fetchStashMediaWithAuth(source as ExternalSourceRecord, uri, request);
  }
  return fetch(uri, {
    method: request.method,
    headers: request.headers,
    signal: request.signal,
  });
}

async function copyLocalFile(sourcePath: string, destinationPath: string): Promise<void> {
  let completed = false;
  try {
    await pipeline(createReadStream(sourcePath), createWriteStream(destinationPath));
    completed = true;
  } finally {
    if (!completed) {
      await fs.rm(destinationPath, { force: true }).catch(() => {});
    }
  }
}

async function ensureLocalSourceExists(sourcePath: string, resourceLabel: string): Promise<void> {
  try {
    const stats = await fs.stat(sourcePath);
    if (!stats.isFile()) {
      throw new Error(`Local ${resourceLabel} source is not a file: ${sourcePath}`);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      throw new Error(`Local ${resourceLabel} source is missing: ${sourcePath}`);
    }
    throw error;
  }
}

async function downloadRemoteResource(
  uri: string,
  installSourceKey: string | null,
  destinationPath: string
): Promise<void> {
  let completed = false;
  try {
    const response = await resolveRemoteResponse(
      uri,
      installSourceKey,
      new Request(uri, { method: "GET" })
    );
    if (!response.ok) {
      throw new Error(
        `Failed to download resource: ${response.status} ${response.statusText}`.trim()
      );
    }
    if (!response.body) {
      throw new Error("Failed to download resource: empty response body.");
    }
    await pipeline(
      Readable.fromWeb(response.body as unknown as import("node:stream/web").ReadableStream),
      createWriteStream(destinationPath)
    );
    completed = true;
  } finally {
    if (!completed) {
      await fs.rm(destinationPath, { force: true }).catch(() => {});
    }
  }
}

function updateStatus(updates: Partial<LibraryExportPackageStatus>): void {
  exportStatus = { ...exportStatus, ...updates };
}

function updatePhase(phase: PlaylistExportCompressionPhase, message?: string): void {
  if (exportStatus.state !== "running") return;
  exportStatus = {
    ...exportStatus,
    phase,
    lastMessage: message ?? exportStatus.lastMessage,
  };
}

function setProgress(input: Partial<LibraryExportPackageStatus["progress"]>): void {
  if (exportStatus.state !== "running") return;
  exportStatus = {
    ...exportStatus,
    progress: { ...exportStatus.progress, ...input },
  };
}

function incrementProgress(amount = 1): void {
  setProgress({ completed: exportStatus.progress.completed + amount });
}

function incrementStat(key: keyof LibraryExportPackageStatus["stats"]): void {
  if (exportStatus.state !== "running") return;
  exportStatus = {
    ...exportStatus,
    stats: { ...exportStatus.stats, [key]: exportStatus.stats[key] + 1 },
  };
}

function setCompressionStatus(input: Partial<LibraryExportPackageCompressionStatus>): void {
  if (exportStatus.state !== "running" || !exportStatus.compression) return;
  exportStatus = {
    ...exportStatus,
    compression: {
      ...exportStatus.compression,
      ...input,
    },
  };
}

function registerEncodeChild(child: ChildProcess): void {
  activeEncodeChildren.add(child);
}

function unregisterEncodeChild(child: ChildProcess): void {
  activeEncodeChildren.delete(child);
}

function toRoundSidecarPayload(entry: RoundResourceEntry, includeMedia: boolean) {
  return ZRoundSidecar.parse({
    name: entry.round.name,
    author: entry.round.author ?? undefined,
    description: entry.round.description ?? undefined,
    bpm: entry.round.bpm ?? undefined,
    difficulty: entry.round.difficulty ?? undefined,
    phash: entry.round.phash ?? undefined,
    startTime: entry.round.startTime ?? undefined,
    endTime: entry.round.endTime ?? undefined,
    type: entry.round.type,
    resources: [
      {
        videoUri: includeMedia
          ? (entry.materialized.video?.relativePath ?? entry.resource.videoUri)
          : entry.resource.videoUri,
        funscriptUri:
          entry.materialized.funscript?.relativePath ?? entry.resource.funscriptUri ?? undefined,
      },
    ],
  });
}

function toHeroSidecarPayload(
  hero: ExportableHero,
  entries: RoundResourceEntry[],
  includeMedia: boolean
) {
  return ZHeroSidecar.parse({
    name: hero.name,
    author: hero.author ?? undefined,
    description: hero.description ?? undefined,
    phash: hero.phash ?? undefined,
    rounds: entries
      .slice()
      .sort((a, b) =>
        a.round.name.localeCompare(b.round.name, undefined, { sensitivity: "base", numeric: true })
      )
      .map((entry) => ({
        name: entry.round.name,
        author: entry.round.author ?? undefined,
        description: entry.round.description ?? undefined,
        bpm: entry.round.bpm ?? undefined,
        difficulty: entry.round.difficulty ?? undefined,
        phash: entry.round.phash ?? undefined,
        startTime: entry.round.startTime ?? undefined,
        endTime: entry.round.endTime ?? undefined,
        type: entry.round.type,
        resources: [
          {
            videoUri: includeMedia
              ? (entry.materialized.video?.relativePath ?? entry.resource.videoUri)
              : entry.resource.videoUri,
            funscriptUri:
              entry.materialized.funscript?.relativePath ??
              entry.resource.funscriptUri ??
              undefined,
          },
        ],
      })),
  });
}

function buildResourceInventory(rounds: ExportableRound[]): {
  resourceReferences: ResourceReference[];
  videoTasks: VideoTask[];
  funscriptTasks: FunscriptTask[];
} {
  const resourceReferences: ResourceReference[] = [];
  const videoTaskByKey = new Map<string, VideoTask>();
  const funscriptTaskByKey = new Map<string, FunscriptTask>();

  for (const round of rounds) {
    if (round.resources.length === 0) continue;

    for (const resource of round.resources) {
      const preferredBaseName = round.hero ? round.hero.name : round.name;
      resourceReferences.push({ round, resource, preferredBaseName });

      const canonicalVideoKey = canonicalizeResourceKey(resource.videoUri);
      if (!videoTaskByKey.has(canonicalVideoKey)) {
        videoTaskByKey.set(canonicalVideoKey, {
          canonicalKey: canonicalVideoKey,
          uri: resource.videoUri,
          installSourceKey: round.installSourceKey,
          preferredBaseName,
          originalExtension: inferExtensionFromUri(resource.videoUri, ".mp4"),
          probe: {
            codecName: null,
            width: null,
            height: null,
            durationMs: resource.durationMs ?? null,
            fileSizeBytes: null,
          },
          output: null,
        });
      } else if (resource.durationMs && !videoTaskByKey.get(canonicalVideoKey)?.probe.durationMs) {
        const existing = videoTaskByKey.get(canonicalVideoKey);
        if (existing) {
          existing.probe.durationMs = resource.durationMs;
        }
      }

      if (resource.funscriptUri) {
        const canonicalFunscriptKey = canonicalizeResourceKey(resource.funscriptUri);
        if (!funscriptTaskByKey.has(canonicalFunscriptKey)) {
          funscriptTaskByKey.set(canonicalFunscriptKey, {
            canonicalKey: canonicalFunscriptKey,
            uri: resource.funscriptUri,
            installSourceKey: round.installSourceKey,
            preferredBaseName,
            output: null,
          });
        }
      }
    }
  }

  const sortByKey = <T extends { preferredBaseName: string; canonicalKey: string }>(
    left: T,
    right: T
  ) => {
    const byName = left.preferredBaseName.localeCompare(right.preferredBaseName, undefined, {
      sensitivity: "base",
      numeric: true,
    });
    if (byName !== 0) return byName;
    return left.canonicalKey.localeCompare(right.canonicalKey, undefined, {
      sensitivity: "base",
      numeric: true,
    });
  };

  return {
    resourceReferences,
    videoTasks: Array.from(videoTaskByKey.values()).sort(sortByKey),
    funscriptTasks: Array.from(funscriptTaskByKey.values()).sort(sortByKey),
  };
}

function allocateMediaOutputs(input: {
  tasks: VideoTask[] | FunscriptTask[];
  usedNames: Set<string>;
  packageDir: string;
  compressionMode: PlaylistExportCompressionMode;
}): void {
  for (const task of input.tasks) {
    const baseName = sanitizeFileSystemName(task.preferredBaseName, "media");
    const extension =
      "probe" in task && input.compressionMode === "av1" && !isAv1Codec(task.probe.codecName)
        ? ".mp4"
        : "probe" in task
          ? sanitizeExtension(task.originalExtension, ".mp4")
          : sanitizeExtension(inferExtensionFromUri(task.uri, ".funscript"), ".funscript");
    const fileName = toUniqueCaseInsensitiveFileName(input.usedNames, baseName, extension);
    const absolutePath = path.join(input.packageDir, fileName);
    task.output = {
      absolutePath,
      relativePath: toPortableRelativePath(input.packageDir, absolutePath),
    };
  }
}

async function materializeVideoTask(input: {
  task: VideoTask;
  workDir: string;
  ffmpegPath: string;
  ffprobePath: string;
  encoder: Av1EncoderDetails | null;
  compressionMode: PlaylistExportCompressionMode;
  compressionStrength: number;
}): Promise<{ reencoded: boolean; alreadyAv1Copied: boolean; outputBytes: number }> {
  const output = input.task.output;
  if (!output) {
    throw new Error("Video output path was not allocated.");
  }

  const localPath = await resolveLocalSourcePath(input.task.uri);
  const shouldTryCompression = input.compressionMode === "av1" && input.encoder;
  const knownAv1 = isAv1Codec(input.task.probe.codecName);
  const outputFileName = path.basename(output.absolutePath);

  if (!shouldTryCompression) {
    updatePhase("copying", `Exporting video ${outputFileName}...`);
    if (localPath) {
      await ensureLocalSourceExists(localPath, "video");
      await copyLocalFile(localPath, output.absolutePath);
    } else {
      await downloadRemoteResource(
        input.task.uri,
        input.task.installSourceKey,
        output.absolutePath
      );
    }
    const stats = await fs.stat(output.absolutePath);
    incrementStat("videoFiles");
    incrementProgress();
    return {
      reencoded: false,
      alreadyAv1Copied: false,
      outputBytes: stats.size,
    };
  }

  if (knownAv1 && localPath) {
    updatePhase("copying", `Copying AV1 video ${outputFileName}...`);
    await ensureLocalSourceExists(localPath, "video");
    await copyLocalFile(localPath, output.absolutePath);
    const stats = await fs.stat(output.absolutePath);
    incrementStat("videoFiles");
    incrementProgress();
    setCompressionStatus({
      alreadyAv1Copied: (exportStatus.compression?.alreadyAv1Copied ?? 0) + 1,
    });
    return {
      reencoded: false,
      alreadyAv1Copied: true,
      outputBytes: stats.size,
    };
  }

  let sourcePath = localPath;
  let shouldDeleteSourcePath = false;
  if (localPath) {
    await ensureLocalSourceExists(localPath, "video");
    const stagedSourcePath = path.join(
      input.workDir,
      `${crypto.randomUUID()}${sanitizeExtension(input.task.originalExtension, ".mp4")}`
    );
    updatePhase("copying", `Preparing source video ${outputFileName}...`);
    await copyLocalFile(localPath, stagedSourcePath);
    sourcePath = stagedSourcePath;
    shouldDeleteSourcePath = true;
  } else if (!sourcePath) {
    const tempSourcePath = path.join(
      input.workDir,
      `${crypto.randomUUID()}${sanitizeExtension(input.task.originalExtension, ".mp4")}`
    );
    updatePhase("copying", `Downloading source video ${outputFileName}...`);
    await downloadRemoteResource(input.task.uri, input.task.installSourceKey, tempSourcePath);
    sourcePath = tempSourcePath;
    shouldDeleteSourcePath = true;
  }

  try {
    if (!sourcePath) {
      throw new Error("Video source path could not be resolved.");
    }

    const probedSource = localPath
      ? input.task.probe
      : await probeLocalVideo(input.ffprobePath, sourcePath);

    if (isAv1Codec(probedSource.codecName)) {
      updatePhase("copying", `Copying AV1 video ${outputFileName}...`);
      if (shouldDeleteSourcePath) {
        await fs.rename(sourcePath, output.absolutePath);
      } else {
        await copyLocalFile(sourcePath, output.absolutePath);
      }
      const stats = await fs.stat(output.absolutePath);
      incrementStat("videoFiles");
      incrementProgress();
      setCompressionStatus({
        alreadyAv1Copied: (exportStatus.compression?.alreadyAv1Copied ?? 0) + 1,
        reencodedTotal: Math.max(0, (exportStatus.compression?.reencodedTotal ?? 0) - 1),
      });
      return {
        reencoded: false,
        alreadyAv1Copied: true,
        outputBytes: stats.size,
      };
    }

    if (!input.encoder) {
      throw new Error("AV1 compression was requested, but no AV1 encoder is available.");
    }

    updatePhase("compressing", `Compressing video ${outputFileName} to AV1...`);
    setCompressionStatus({
      activeJobs: (exportStatus.compression?.activeJobs ?? 0) + 1,
    });
    let encodedSuccessfully = false;
    try {
      await transcodeVideoToAv1({
        ffmpegPath: input.ffmpegPath,
        sourcePath,
        outputPath: output.absolutePath,
        encoder: input.encoder,
        strength: input.compressionStrength,
        onSpawn: registerEncodeChild,
      });
      encodedSuccessfully = true;
    } finally {
      for (const child of activeEncodeChildren) {
        if (child.exitCode !== null || child.killed) {
          unregisterEncodeChild(child);
        }
      }
      setCompressionStatus({
        activeJobs: Math.max(0, (exportStatus.compression?.activeJobs ?? 1) - 1),
      });
      if (encodedSuccessfully) {
        setCompressionStatus({
          reencodedCompleted: (exportStatus.compression?.reencodedCompleted ?? 0) + 1,
        });
      }
    }

    const stats = await fs.stat(output.absolutePath);
    incrementStat("videoFiles");
    incrementProgress();
    return {
      reencoded: true,
      alreadyAv1Copied: false,
      outputBytes: stats.size,
    };
  } finally {
    if (shouldDeleteSourcePath && sourcePath) {
      await fs.rm(sourcePath, { force: true }).catch(() => {});
    }
  }
}

async function materializeFunscriptTask(task: FunscriptTask): Promise<void> {
  if (!task.output) {
    throw new Error("Funscript output path was not allocated.");
  }

  updateStatus({
    lastMessage: `Exporting funscript ${path.basename(task.output.absolutePath)}...`,
  });

  const localPath = await resolveLocalSourcePath(task.uri);
  if (localPath) {
    await copyLocalFile(localPath, task.output.absolutePath);
  } else {
    await downloadRemoteResource(task.uri, task.installSourceKey, task.output.absolutePath);
  }

  incrementStat("funscriptFiles");
  incrementProgress();
}

export function getLibraryExportPackageStatus(): LibraryExportPackageStatus {
  return { ...exportStatus };
}

async function packResultAsFpack(
  result: LibraryExportPackageResult,
  asFpack: boolean
): Promise<LibraryExportPackageResult> {
  if (!asFpack) return result;
  const fpackFileName = `${path.basename(result.exportDir)}.fpack`;
  const fpackPath = path.join(path.dirname(result.exportDir), fpackFileName);
  updateStatus({ lastMessage: "Packing .fpack file..." });
  await createFpackFromDirectory(result.exportDir, fpackPath);
  await fs.rm(result.exportDir, { recursive: true, force: true });
  return { ...result, exportDir: path.dirname(result.exportDir), fpackPath };
}

export async function exportLibraryPackage(
  input: LibraryExportPackageInput = {}
): Promise<LibraryExportPackageResult> {
  const includeMedia = input.includeMedia ?? true;
  const now = new Date();
  const compressionStrength = normalizeCompressionStrength(input.compressionStrength);

  const exportBaseDir =
    input.directoryPath ?? (app.isPackaged ? app.getPath("userData") : app.getAppPath());
  const exportDir = path.join(exportBaseDir, "export", toSafeIsoTimestamp(now));
  const workDir = path.join(exportDir, ".work");

  exportStatus = {
    state: "running",
    phase: "analyzing",
    startedAt: now.toISOString(),
    finishedAt: null,
    lastMessage: "Preparing export...",
    progress: { completed: 0, total: 0 },
    stats: { heroFiles: 0, roundFiles: 0, videoFiles: 0, funscriptFiles: 0 },
    compression: null,
  };

  try {
    updateStatus({ lastMessage: "Loading rounds from database..." });

    let rounds: ExportableRound[];

    if (input.roundIds?.length || input.heroIds?.length) {
      const roundIds = input.roundIds ?? [];
      const heroIds = input.heroIds ?? [];

      const queries: Promise<ExportableRound[]>[] = [];

      if (roundIds.length > 0) {
        queries.push(
          getDb().query.round.findMany({
            where: inArray(roundTable.id, roundIds),
            with: { hero: true, resources: true },
          }) as Promise<ExportableRound[]>
        );
      }

      if (heroIds.length > 0) {
        queries.push(
          getDb().query.round.findMany({
            where: inArray(roundTable.heroId, heroIds),
            with: { hero: true, resources: true },
          }) as Promise<ExportableRound[]>
        );
      }

      const results = await Promise.all(queries);
      const seenIds = new Set<string>();
      rounds = [];
      for (const batch of results) {
        for (const round of batch) {
          if (!seenIds.has(round.id)) {
            seenIds.add(round.id);
            rounds.push(round);
          }
        }
      }
    } else {
      rounds = (await getDb().query.round.findMany({
        with: { hero: true, resources: true },
      })) as ExportableRound[];
    }

    if (rounds.length === 0) {
      throw new Error("No rounds found to export.");
    }

    updateStatus({ lastMessage: "Preparing export directory..." });
    await fs.mkdir(exportDir, { recursive: true });
    await fs.mkdir(workDir, { recursive: true });

    const { resourceReferences, videoTasks, funscriptTasks } = buildResourceInventory(rounds);

    const binaries = await resolvePhashBinaries();
    const encoder = await detectAv1Encoder(binaries.ffmpegPath);
    const defaultMode: PlaylistExportCompressionMode = encoder ? "av1" : "copy";
    const requestedMode = input.compressionMode ?? defaultMode;
    const effectiveCompressionMode = requestedMode === "av1" && encoder ? "av1" : "copy";

    if (includeMedia) {
      for (const task of videoTasks) {
        const localPath = await resolveLocalSourcePath(task.uri);
        if (localPath) {
          task.probe = await probeLocalVideo(binaries.ffprobePath, localPath);
          if (task.probe.durationMs === null && resourceReferences.length > 0) {
            const matching = resourceReferences.find(
              (entry) => canonicalizeResourceKey(entry.resource.videoUri) === task.canonicalKey
            );
            task.probe.durationMs = matching?.resource.durationMs ?? null;
          }
          continue;
        }
      }
    }

    if (includeMedia && effectiveCompressionMode === "av1") {
      const estimatedReencodeVideos = videoTasks.filter(
        (task) => !isAv1Codec(task.probe.codecName)
      ).length;
      exportStatus = {
        ...exportStatus,
        compression: {
          enabled: true,
          encoderName: encoder?.name ?? null,
          encoderKind: encoder?.kind ?? null,
          strength: compressionStrength,
          reencodedCompleted: 0,
          reencodedTotal: estimatedReencodeVideos,
          alreadyAv1Copied: 0,
          activeJobs: 0,
        },
      };
    }

    const usedMediaNames = new Set<string>();
    const usedSidecarNames = new Set<string>();

    let videoFiles = 0;
    let funscriptFiles = 0;

    if (includeMedia) {
      allocateMediaOutputs({
        tasks: videoTasks,
        usedNames: usedMediaNames,
        packageDir: exportDir,
        compressionMode: effectiveCompressionMode,
      });
    }

    allocateMediaOutputs({
      tasks: funscriptTasks,
      usedNames: usedMediaNames,
      packageDir: exportDir,
      compressionMode: effectiveCompressionMode,
    });

    const totalWork =
      (includeMedia ? videoTasks.length : 0) + funscriptTasks.length + rounds.length;
    setProgress({ completed: 0, total: totalWork });

    let actualVideoBytes = 0;
    let reencodedVideos = 0;
    let alreadyAv1Copied = 0;

    if (includeMedia) {
      for (const task of videoTasks) {
        const result = await materializeVideoTask({
          task,
          workDir,
          ffmpegPath: binaries.ffmpegPath,
          ffprobePath: binaries.ffprobePath,
          encoder,
          compressionMode: effectiveCompressionMode,
          compressionStrength,
        });
        actualVideoBytes += result.outputBytes;
        if (result.reencoded) reencodedVideos += 1;
        if (result.alreadyAv1Copied) alreadyAv1Copied += 1;
      }
      videoFiles = videoTasks.length;
    }

    for (const task of funscriptTasks) {
      await materializeFunscriptTask(task);
    }
    funscriptFiles = funscriptTasks.length;

    const videoOutputByKey = new Map<string, ExportedMediaFile>(
      includeMedia
        ? videoTasks
            .filter((task): task is VideoTask & { output: ExportedMediaFile } =>
              Boolean(task.output)
            )
            .map((task) => [`video:${task.canonicalKey}`, task.output])
        : []
    );
    const funscriptOutputByKey = new Map<string, ExportedMediaFile>(
      funscriptTasks
        .filter((task): task is FunscriptTask & { output: ExportedMediaFile } =>
          Boolean(task.output)
        )
        .map((task) => [`funscript:${task.canonicalKey}`, task.output])
    );

    const materializedEntries: RoundResourceEntry[] = resourceReferences.map((entry) => {
      const funscriptKey = entry.resource.funscriptUri
        ? `funscript:${canonicalizeResourceKey(entry.resource.funscriptUri)}`
        : null;
      let video = null;

      if (includeMedia) {
        const videoKey = `video:${canonicalizeResourceKey(entry.resource.videoUri)}`;
        video = videoOutputByKey.get(videoKey) ?? null;
        if (!video) {
          throw new Error(`Exported video output is missing for ${entry.resource.videoUri}`);
        }
      }

      return {
        round: entry.round,
        resource: entry.resource,
        materialized: {
          canonicalVideoKey: canonicalizeResourceKey(entry.resource.videoUri),
          video: video ?? null,
          funscript: funscriptKey ? (funscriptOutputByKey.get(funscriptKey) ?? null) : null,
        },
      };
    });

    let roundFiles = 0;
    let heroFiles = 0;
    const heroGroups = new Map<string, { hero: ExportableHero; entries: RoundResourceEntry[] }>();

    for (const entry of materializedEntries) {
      if (entry.round.heroId && entry.round.hero) {
        const key = entry.round.heroId;
        const existing = heroGroups.get(key);
        if (existing) {
          existing.entries.push(entry);
        } else {
          heroGroups.set(key, { hero: entry.round.hero, entries: [entry] });
        }
        continue;
      }

      const sidecarBaseName = sanitizeFileSystemName(entry.round.name, `round__${entry.round.id}`);
      const fileName = toUniqueCaseInsensitiveFileName(usedSidecarNames, sidecarBaseName, ".round");
      updateStatus({ lastMessage: `Writing sidecar ${fileName}...` });
      await writeJsonFile(
        path.join(exportDir, fileName),
        toRoundSidecarPayload(entry, includeMedia)
      );
      incrementStat("roundFiles");
      incrementProgress();
      roundFiles += 1;
    }

    const sortedHeroGroups = Array.from(heroGroups.values()).sort((a, b) => {
      const byName = a.hero.name.localeCompare(b.hero.name, undefined, {
        sensitivity: "base",
        numeric: true,
      });
      if (byName !== 0) return byName;
      return a.hero.id.localeCompare(b.hero.id);
    });

    for (const group of sortedHeroGroups) {
      const sidecarBaseName = sanitizeFileSystemName(group.hero.name, `hero__${group.hero.id}`);
      const fileName = toUniqueCaseInsensitiveFileName(usedSidecarNames, sidecarBaseName, ".hero");
      updateStatus({ lastMessage: `Writing sidecar ${fileName}...` });
      await writeJsonFile(
        path.join(exportDir, fileName),
        toHeroSidecarPayload(group.hero, group.entries, includeMedia)
      );
      incrementStat("heroFiles");
      incrementProgress();
      heroFiles += 1;
    }

    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});

    const result: LibraryExportPackageResult = {
      exportDir,
      heroFiles,
      roundFiles,
      videoFiles,
      funscriptFiles,
      exportedRounds: rounds.length,
      includeMedia,
      compression: {
        enabled: effectiveCompressionMode === "av1" && Boolean(encoder),
        encoderName: encoder?.name ?? null,
        encoderKind: encoder?.kind ?? null,
        strength: compressionStrength,
        reencodedVideos,
        alreadyAv1Copied,
        actualVideoBytes,
      },
    };

    exportStatus = {
      state: "done",
      phase: "done",
      startedAt: exportStatus.startedAt,
      finishedAt: new Date().toISOString(),
      lastMessage: "Export complete.",
      progress: { completed: exportStatus.progress.total, total: exportStatus.progress.total },
      stats: { ...exportStatus.stats, heroFiles, roundFiles, videoFiles, funscriptFiles },
      compression: exportStatus.compression,
    };

    return await packResultAsFpack(result, input.asFpack ?? false);
  } catch (error) {
    exportStatus = {
      state: "error",
      phase: "error",
      startedAt: exportStatus.startedAt,
      finishedAt: new Date().toISOString(),
      lastMessage: error instanceof Error ? error.message : "Export failed.",
      progress: exportStatus.progress,
      stats: exportStatus.stats,
      compression: exportStatus.compression,
    };
    throw error;
  }
}
