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
import { fetchStashMediaWithAuth } from "./integrations/stashClient";
import { stashProvider } from "./integrations/providers/stashProvider";
import { listExternalSources, normalizeBaseUrl } from "./integrations/store";
import { fromLocalMediaUri, toPortableRelativePath } from "./localMedia";

export type LibraryExportPackageInput = {
  roundIds?: string[];
  heroIds?: string[];
  includeMedia?: boolean;
  directoryPath?: string;
};

export type LibraryExportPackageState = "idle" | "running" | "done" | "aborted" | "error";

export type LibraryExportPackageStatus = {
  state: LibraryExportPackageState;
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
};

export type LibraryExportPackageResult = {
  exportDir: string;
  heroFiles: number;
  roundFiles: number;
  videoFiles: number;
  funscriptFiles: number;
  exportedRounds: number;
  includeMedia: boolean;
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
    video: ExportedMediaFile;
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
  startedAt: null,
  finishedAt: null,
  lastMessage: null,
  progress: { completed: 0, total: 0 },
  stats: { heroFiles: 0, roundFiles: 0, videoFiles: 0, funscriptFiles: 0 },
};

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
    resources: includeMedia
      ? [
          {
            videoUri: entry.materialized.video.relativePath,
            funscriptUri: entry.materialized.funscript?.relativePath,
          },
        ]
      : [],
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
        resources: includeMedia
          ? [
              {
                videoUri: entry.materialized.video.relativePath,
                funscriptUri: entry.materialized.funscript?.relativePath,
              },
            ]
          : [],
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
          output: null,
        });
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
}): void {
  for (const task of input.tasks) {
    const baseName = sanitizeFileSystemName(task.preferredBaseName, "media");
    const isVideo = "originalExtension" in task;
    const extension = isVideo
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

async function materializeVideoTask(task: VideoTask): Promise<void> {
  if (!task.output) {
    throw new Error("Video output path was not allocated.");
  }

  const localPath = fromLocalMediaUri(task.uri);
  const outputFileName = path.basename(task.output.absolutePath);

  updateStatus({ lastMessage: `Exporting video ${outputFileName}...` });

  if (localPath) {
    await ensureLocalSourceExists(localPath, "video");
    await copyLocalFile(localPath, task.output.absolutePath);
  } else {
    await downloadRemoteResource(task.uri, task.installSourceKey, task.output.absolutePath);
  }

  incrementStat("videoFiles");
  incrementProgress();
}

async function materializeFunscriptTask(task: FunscriptTask): Promise<void> {
  if (!task.output) {
    throw new Error("Funscript output path was not allocated.");
  }

  updateStatus({
    lastMessage: `Exporting funscript ${path.basename(task.output.absolutePath)}...`,
  });

  const localPath = fromLocalMediaUri(task.uri);
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

export async function exportLibraryPackage(
  input: LibraryExportPackageInput = {}
): Promise<LibraryExportPackageResult> {
  const includeMedia = input.includeMedia ?? true;
  const now = new Date();

  const exportBaseDir =
    input.directoryPath ?? (app.isPackaged ? app.getPath("userData") : app.getAppPath());
  const exportDir = path.join(exportBaseDir, "export", toSafeIsoTimestamp(now));

  exportStatus = {
    state: "running",
    startedAt: now.toISOString(),
    finishedAt: null,
    lastMessage: "Preparing export...",
    progress: { completed: 0, total: 0 },
    stats: { heroFiles: 0, roundFiles: 0, videoFiles: 0, funscriptFiles: 0 },
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

    const { resourceReferences, videoTasks, funscriptTasks } = buildResourceInventory(rounds);

    const usedMediaNames = new Set<string>();
    const usedSidecarNames = new Set<string>();

    let videoFiles = 0;
    let funscriptFiles = 0;

    if (includeMedia) {
      allocateMediaOutputs({
        tasks: videoTasks,
        usedNames: usedMediaNames,
        packageDir: exportDir,
      });
      allocateMediaOutputs({
        tasks: funscriptTasks,
        usedNames: usedMediaNames,
        packageDir: exportDir,
      });

      const totalWork = videoTasks.length + funscriptTasks.length + rounds.length;
      setProgress({ completed: 0, total: totalWork });

      for (const task of videoTasks) {
        await materializeVideoTask(task);
      }
      videoFiles = videoTasks.length;

      for (const task of funscriptTasks) {
        await materializeFunscriptTask(task);
      }
      funscriptFiles = funscriptTasks.length;

      const videoOutputByKey = new Map<string, ExportedMediaFile>(
        videoTasks
          .filter((task): task is VideoTask & { output: ExportedMediaFile } => Boolean(task.output))
          .map((task) => [`video:${task.canonicalKey}`, task.output])
      );
      const funscriptOutputByKey = new Map<string, ExportedMediaFile>(
        funscriptTasks
          .filter((task): task is FunscriptTask & { output: ExportedMediaFile } =>
            Boolean(task.output)
          )
          .map((task) => [`funscript:${task.canonicalKey}`, task.output])
      );

      const materializedEntries: RoundResourceEntry[] = resourceReferences.map((entry) => {
        const videoKey = `video:${canonicalizeResourceKey(entry.resource.videoUri)}`;
        const funscriptKey = entry.resource.funscriptUri
          ? `funscript:${canonicalizeResourceKey(entry.resource.funscriptUri)}`
          : null;
        const video = videoOutputByKey.get(videoKey);
        if (!video) {
          throw new Error(`Exported video output is missing for ${entry.resource.videoUri}`);
        }
        return {
          round: entry.round,
          resource: entry.resource,
          materialized: {
            canonicalVideoKey: canonicalizeResourceKey(entry.resource.videoUri),
            video,
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

        const sidecarBaseName = sanitizeFileSystemName(
          entry.round.name,
          `round__${entry.round.id}`
        );
        const fileName = toUniqueCaseInsensitiveFileName(
          usedSidecarNames,
          sidecarBaseName,
          ".round"
        );
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
        const fileName = toUniqueCaseInsensitiveFileName(
          usedSidecarNames,
          sidecarBaseName,
          ".hero"
        );
        updateStatus({ lastMessage: `Writing sidecar ${fileName}...` });
        await writeJsonFile(
          path.join(exportDir, fileName),
          toHeroSidecarPayload(group.hero, group.entries, includeMedia)
        );
        incrementStat("heroFiles");
        incrementProgress();
        heroFiles += 1;
      }

      const result: LibraryExportPackageResult = {
        exportDir,
        heroFiles,
        roundFiles,
        videoFiles,
        funscriptFiles,
        exportedRounds: rounds.length,
        includeMedia,
      };

      exportStatus = {
        state: "done",
        startedAt: exportStatus.startedAt,
        finishedAt: new Date().toISOString(),
        lastMessage: "Export complete.",
        progress: { completed: exportStatus.progress.total, total: exportStatus.progress.total },
        stats: { ...exportStatus.stats, heroFiles, roundFiles, videoFiles, funscriptFiles },
      };

      return result;
    } else {
      setProgress({ completed: 0, total: rounds.length });

      const standaloneRounds = rounds.filter((round) => !round.heroId || !round.hero);
      const heroGroups = new Map<string, { hero: ExportableHero; rounds: ExportableRound[] }>();

      for (const round of rounds) {
        if (!round.heroId || !round.hero) continue;
        const existing = heroGroups.get(round.heroId);
        if (existing) {
          existing.rounds.push(round);
          continue;
        }
        heroGroups.set(round.heroId, { hero: round.hero, rounds: [round] });
      }

      let roundFiles = 0;
      for (const round of standaloneRounds) {
        const sidecar = ZRoundSidecar.parse({
          name: round.name,
          author: round.author ?? undefined,
          description: round.description ?? undefined,
          bpm: round.bpm ?? undefined,
          difficulty: round.difficulty ?? undefined,
          phash: round.phash ?? undefined,
          startTime: round.startTime ?? undefined,
          endTime: round.endTime ?? undefined,
          type: round.type,
          resources: [],
        });
        const fileName = toUniqueCaseInsensitiveFileName(
          usedSidecarNames,
          sanitizeFileSystemName(round.name, `round__${round.id}`),
          ".round"
        );
        updateStatus({ lastMessage: `Writing ${fileName}...` });
        await writeJsonFile(path.join(exportDir, fileName), sidecar);
        incrementStat("roundFiles");
        incrementProgress();
        roundFiles += 1;
      }

      let heroFiles = 0;
      for (const [, entry] of heroGroups) {
        const sidecar = ZHeroSidecar.parse({
          name: entry.hero.name,
          author: entry.hero.author ?? undefined,
          description: entry.hero.description ?? undefined,
          phash: entry.hero.phash ?? undefined,
          rounds: entry.rounds.map((round) => ({
            name: round.name,
            author: round.author ?? undefined,
            description: round.description ?? undefined,
            bpm: round.bpm ?? undefined,
            difficulty: round.difficulty ?? undefined,
            phash: round.phash ?? undefined,
            startTime: round.startTime ?? undefined,
            endTime: round.endTime ?? undefined,
            type: round.type,
            resources: [],
          })),
        });
        const fileName = toUniqueCaseInsensitiveFileName(
          usedSidecarNames,
          sanitizeFileSystemName(entry.hero.name, `hero__${entry.hero.id}`),
          ".hero"
        );
        updateStatus({ lastMessage: `Writing ${fileName}...` });
        await writeJsonFile(path.join(exportDir, fileName), sidecar);
        incrementStat("heroFiles");
        incrementProgress();
        heroFiles += 1;
      }

      const result: LibraryExportPackageResult = {
        exportDir,
        heroFiles,
        roundFiles,
        videoFiles: 0,
        funscriptFiles: 0,
        exportedRounds: rounds.length,
        includeMedia: false,
      };

      exportStatus = {
        state: "done",
        startedAt: exportStatus.startedAt,
        finishedAt: new Date().toISOString(),
        lastMessage: "Export complete.",
        progress: { completed: exportStatus.progress.total, total: exportStatus.progress.total },
        stats: { ...exportStatus.stats, heroFiles, roundFiles, videoFiles: 0, funscriptFiles: 0 },
      };

      return result;
    }
  } catch (error) {
    exportStatus = {
      state: "error",
      startedAt: exportStatus.startedAt,
      finishedAt: new Date().toISOString(),
      lastMessage: error instanceof Error ? error.message : "Export failed.",
      progress: exportStatus.progress,
      stats: exportStatus.stats,
    };
    throw error;
  }
}
