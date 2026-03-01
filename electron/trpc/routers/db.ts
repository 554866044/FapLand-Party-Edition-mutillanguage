import { TRPCError } from "@trpc/server";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { app, shell } from "electron";
import * as z from "zod";
import { getDb } from "../../services/db";
import { exportInstalledDatabase } from "../../services/installExport";
import { exportLibraryPackage } from "../../services/libraryExportPackage";
import { getDisabledRoundIdSet, resolveResourceUris } from "../../services/integrations";
import { getStore } from "../../services/store";
import { resolveVideoDurationMsForUri } from "../../services/videoDuration";
import {
  addAutoScanFolder,
  addAutoScanFolderAndScan,
  getAutoScanFolders,
  getInstallScanStatus,
  inspectInstallSidecarFile,
  importInstallSidecarFile,
  repairTemplateHero,
  repairTemplateRound,
  importLegacyFolderWithPlan,
  inspectInstallFolder,
  removeAutoScanFolder,
  requestInstallScanAbort,
  scanInstallFolderOnceWithLegacySupport,
  scanInstallSources,
  retryTemplateLinking,
} from "../../services/installer";
import {
  getPhashScanStatus,
  startPhashScan,
  startPhashScanManual,
  requestPhashScanAbort,
} from "../../services/phashScanService";
import {
  getWebsiteVideoScanStatus,
  requestWebsiteVideoScanAbort,
  startWebsiteVideoScan,
  startWebsiteVideoScanManual,
} from "../../services/webVideoScanService";
import { clearPlayableVideoCache } from "../../services/playableVideo";
import {
  clearWebsiteVideoCache,
  ensureWebsiteVideoCached,
  getAllWebsiteVideoDownloadProgresses,
  getWebsiteVideoCacheState,
  getWebsiteVideoDownloadProgress,
  getWebsiteVideoTargetUrl,
  removeCachedWebsiteVideo,
  resolveWebsiteVideoStream,
} from "../../services/webVideo";
import { publicProcedure, router } from "../trpc";
import { eq, desc, asc, inArray } from "drizzle-orm";
import {
  gameProfile,
  singlePlayerRunHistory,
  multiplayerMatchCache,
  resultSyncQueue,
  hero,
  round,
  resource,
  playlistTrackPlay,
  playlist,
} from "../../services/db/schema";

const ZNullableText = z.string().optional().nullable();
const ZRoundType = z.enum(["Normal", "Interjection", "Cum"]);

function normalizeHttpUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new Error("Website URLs must be valid public http(s) URLs.");
  }
  if (!(parsed.protocol === "http:" || parsed.protocol === "https:")) {
    throw new Error("Website URLs must be valid public http(s) URLs.");
  }
  return parsed.toString();
}

function toWebsiteRoundInstallSourceKey(input: {
  name: string;
  videoUri: string;
  funscriptUri: string | null;
}): string {
  const payload = [
    "website-round:v1",
    input.name.trim().toLowerCase(),
    input.videoUri.trim(),
    input.funscriptUri?.trim() ?? "",
  ].join("|");
  const digest = crypto.createHash("sha256").update(payload).digest("hex");
  return `website:${digest}`;
}

function getInstallExportBaseDir(): string {
  const exportBaseDir = app.isPackaged ? app.getPath("userData") : app.getAppPath();
  return path.join(exportBaseDir, "export");
}

function queueWebsiteVideoCaching(): void {
  void startWebsiteVideoScan().catch((error) => {
    console.error("Failed to queue website video caching", error);
  });
}

function collectWebsiteVideoTargetUrls(videoUris: string[]): string[] {
  const targetUrls = new Set<string>();
  for (const videoUri of videoUris) {
    const targetUrl = getWebsiteVideoTargetUrl(videoUri);
    if (targetUrl) {
      targetUrls.add(targetUrl);
    }
  }
  return [...targetUrls];
}

async function hydrateResourceDurationMs(
  db: ReturnType<typeof getDb>,
  resources: Array<{ id: string; videoUri: string; durationMs: number | null }>
): Promise<void> {
  await Promise.all(
    resources.map(async (entry) => {
      if (typeof entry.durationMs === "number" && entry.durationMs > 0) return;
      const durationMs = await resolveVideoDurationMsForUri(entry.videoUri);
      if (durationMs === null) return;
      entry.durationMs = durationMs;
      await db.update(resource).set({ durationMs }).where(eq(resource.id, entry.id));
    })
  );
}

export const dbRouter = router({
  getLocalHighscore: publicProcedure.query(async () => {
    const db = getDb();
    const profile = await db.select().from(gameProfile).where(eq(gameProfile.id, "local")).get();
    return {
      highscore: Math.max(0, profile?.highscore ?? 0),
      highscoreCheatMode: profile?.highscoreCheatMode ?? false,
    };
  }),

  setLocalHighscore: publicProcedure
    .input(z.object({ highscore: z.number().int().min(0), cheatMode: z.boolean().optional() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const clamped = Math.max(0, Math.floor(input.highscore));
      const existing = await db.select().from(gameProfile).where(eq(gameProfile.id, "local")).get();
      const nextHighscore = Math.max(existing?.highscore ?? 0, clamped);
      const nextCheatMode =
        clamped > (existing?.highscore ?? 0)
          ? (input.cheatMode ?? false)
          : (existing?.highscoreCheatMode ?? false);
      await db
        .insert(gameProfile)
        .values({ id: "local", highscore: nextHighscore, highscoreCheatMode: nextCheatMode })
        .onConflictDoUpdate({
          target: gameProfile.id,
          set: { highscore: nextHighscore, highscoreCheatMode: nextCheatMode },
        });
      return { highscore: nextHighscore, highscoreCheatMode: nextCheatMode };
    }),

  recordSinglePlayerRun: publicProcedure
    .input(
      z.object({
        finishedAtIso: z.string().min(1).optional(),
        score: z.number().int().min(0),
        survivedDurationSec: z.number().int().min(0).optional().nullable(),
        highscoreBefore: z.number().int().min(0),
        highscoreAfter: z.number().int().min(0),
        wasNewHighscore: z.boolean(),
        completionReason: z.string().min(1),
        playlistId: z.string().min(1).nullable().optional(),
        playlistName: z.string().min(1),
        playlistFormatVersion: z.number().int().min(1).nullable().optional(),
        endingPosition: z.number().int().min(0),
        turn: z.number().int().min(0),
        cheatModeActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const [created] = await db
        .insert(singlePlayerRunHistory)
        .values({
          finishedAt: input.finishedAtIso ? new Date(input.finishedAtIso) : new Date(),
          score: input.score,
          survivedDurationSec: input.survivedDurationSec ?? null,
          highscoreBefore: input.highscoreBefore,
          highscoreAfter: input.highscoreAfter,
          wasNewHighscore: input.wasNewHighscore,
          completionReason: input.completionReason,
          playlistId: input.playlistId ?? null,
          playlistName: input.playlistName.trim(),
          playlistFormatVersion: input.playlistFormatVersion ?? null,
          endingPosition: input.endingPosition,
          turn: input.turn,
          cheatModeActive: input.cheatModeActive ?? false,
        })
        .returning();
      return created;
    }),

  listSinglePlayerRuns: publicProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }).optional())
    .query(({ input }) => {
      const db = getDb();
      const limit = input?.limit ?? 50;
      return db.query.singlePlayerRunHistory.findMany({
        orderBy: [desc(singlePlayerRunHistory.finishedAt)],
        limit,
      });
    }),

  getSinglePlayerCumLoadCount: publicProcedure.query(async () => {
    const db = getDb();
    const runs = await db.query.singlePlayerRunHistory.findMany();
    return runs.filter(
      (run) =>
        run.completionReason === "self_reported_cum" ||
        run.completionReason === "cum_instruction_failed"
    ).length;
  }),

  deleteSinglePlayerRun: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [deleted] = await db
        .delete(singlePlayerRunHistory)
        .where(eq(singlePlayerRunHistory.id, input.id))
        .returning();

      if (!deleted) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Single-player run not found.",
        });
      }

      const remainingRuns = await db.query.singlePlayerRunHistory.findMany({
        orderBy: [desc(singlePlayerRunHistory.finishedAt)],
        limit: 10_000,
      });
      const nextHighscore = remainingRuns.reduce((best, run) => Math.max(best, run.score), 0);
      const nextHighscoreCheatMode =
        nextHighscore > 0
          ? remainingRuns.some((run) => run.score === nextHighscore && run.cheatModeActive)
          : false;

      await db
        .insert(gameProfile)
        .values({
          id: "local",
          highscore: nextHighscore,
          highscoreCheatMode: nextHighscoreCheatMode,
        })
        .onConflictDoUpdate({
          target: gameProfile.id,
          set: {
            highscore: nextHighscore,
            highscoreCheatMode: nextHighscoreCheatMode,
          },
        });

      return {
        deleted,
        highscore: nextHighscore,
        highscoreCheatMode: nextHighscoreCheatMode,
      };
    }),

  upsertMultiplayerMatchCache: publicProcedure
    .input(
      z.object({
        lobbyId: z.string().min(1),
        finishedAtIso: z.string().min(1),
        isFinal: z.boolean().default(false),
        resultsJson: z.unknown(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const [created] = await db
        .insert(multiplayerMatchCache)
        .values({
          lobbyId: input.lobbyId,
          finishedAt: new Date(input.finishedAtIso),
          isFinal: input.isFinal,
          resultsJson: input.resultsJson,
        })
        .onConflictDoUpdate({
          target: multiplayerMatchCache.lobbyId,
          set: {
            finishedAt: new Date(input.finishedAtIso),
            isFinal: input.isFinal,
            resultsJson: input.resultsJson,
            updatedAt: new Date(),
          },
        })
        .returning();
      return created;
    }),

  getMultiplayerMatchCache: publicProcedure
    .input(z.object({ lobbyId: z.string().min(1) }))
    .query(({ input }) => {
      const db = getDb();
      return db.query.multiplayerMatchCache.findFirst({
        where: eq(multiplayerMatchCache.lobbyId, input.lobbyId),
      });
    }),

  listMultiplayerMatchCache: publicProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }).optional())
    .query(({ input }) => {
      const db = getDb();
      const limit = input?.limit ?? 50;
      return db.query.multiplayerMatchCache.findMany({
        orderBy: [desc(multiplayerMatchCache.finishedAt)],
        limit,
      });
    }),

  enqueueResultSyncLobby: publicProcedure
    .input(z.object({ lobbyId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [created] = await db
        .insert(resultSyncQueue)
        .values({
          lobbyId: input.lobbyId,
        })
        .onConflictDoNothing({ target: resultSyncQueue.lobbyId })
        .returning();
      return created;
    }),

  touchResultSyncLobby: publicProcedure
    .input(z.object({ lobbyId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const now = new Date();
      const [created] = await db
        .insert(resultSyncQueue)
        .values({
          lobbyId: input.lobbyId,
          lastAttemptAt: now,
        })
        .onConflictDoUpdate({
          target: resultSyncQueue.lobbyId,
          set: { lastAttemptAt: now },
        })
        .returning();
      return created;
    }),

  listResultSyncLobbies: publicProcedure.query(() => {
    const db = getDb();
    return db.query.resultSyncQueue.findMany({
      orderBy: [asc(resultSyncQueue.createdAt)],
    });
  }),

  removeResultSyncLobby: publicProcedure
    .input(z.object({ lobbyId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      return db
        .delete(resultSyncQueue)
        .where(eq(resultSyncQueue.lobbyId, input.lobbyId))
        .returning();
    }),

  getHeroes: publicProcedure.query(() => {
    const db = getDb();
    return db.query.hero.findMany();
  }),

  abortInstallScan: publicProcedure.mutation(() => {
    return requestInstallScanAbort();
  }),

  updateHero: publicProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().trim().min(1),
        author: ZNullableText,
        description: ZNullableText,
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const existing = await db.query.hero.findFirst({
        where: eq(hero.id, input.id),
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Hero not found.",
        });
      }

      const trimmedName = input.name.trim();
      const conflict = await db.query.hero.findFirst({
        where: eq(hero.name, trimmedName),
      });
      if (conflict && conflict.id !== input.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Another hero already uses that name.",
        });
      }

      const [updated] = await db
        .update(hero)
        .set({
          name: trimmedName,
          author: input.author?.trim() || null,
          description: input.description?.trim() || null,
          updatedAt: new Date(),
        })
        .where(eq(hero.id, input.id))
        .returning();
      return updated;
    }),

  deleteHero: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const existing = await db.query.hero.findFirst({
        where: eq(hero.id, input.id),
        columns: { id: true },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Hero not found.",
        });
      }

      await db.delete(hero).where(eq(hero.id, input.id));
      return { deleted: true };
    }),

  getHeroRounds: publicProcedure.input(z.object({ heroId: z.string() })).query(({ input }) => {
    const db = getDb();
    return db.query.round.findMany({
      where: eq(round.heroId, input.heroId),
    });
  }),

  updateRound: publicProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().trim().min(1),
        author: ZNullableText,
        description: ZNullableText,
        bpm: z.number().finite().min(1).max(400).optional().nullable(),
        difficulty: z.number().int().min(1).max(5).optional().nullable(),
        startTime: z.number().int().min(0).optional().nullable(),
        endTime: z.number().int().min(0).optional().nullable(),
        funscriptUri: z.string().trim().min(1).optional().nullable(),
        type: ZRoundType,
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const existing = await db.query.round.findFirst({
        where: eq(round.id, input.id),
        columns: { id: true },
        with: {
          resources: {
            orderBy: [asc(resource.createdAt), asc(resource.id)],
            columns: { id: true },
          },
        },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Round not found.",
        });
      }

      const startTime = input.startTime ?? null;
      const endTime = input.endTime ?? null;
      if (startTime !== null && endTime !== null && endTime <= startTime) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Round end time must be greater than start time.",
        });
      }

      if (input.funscriptUri !== undefined) {
        const primaryResource = existing.resources[0];
        if (!primaryResource) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This round has no attached resource to update.",
          });
        }

        await db
          .update(resource)
          .set({
            funscriptUri: input.funscriptUri?.trim() || null,
            updatedAt: new Date(),
          })
          .where(eq(resource.id, primaryResource.id));
      }

      const [updated] = await db
        .update(round)
        .set({
          name: input.name.trim(),
          author: input.author?.trim() || null,
          description: input.description?.trim() || null,
          bpm: input.bpm ?? null,
          difficulty: input.difficulty ?? null,
          startTime,
          endTime,
          type: input.type,
          updatedAt: new Date(),
        })
        .where(eq(round.id, input.id))
        .returning();
      return updated;
    }),

  createWebsiteRound: publicProcedure
    .input(
      z.object({
        name: z.string().trim().min(1),
        videoUri: z.string().trim().min(1),
        funscriptUri: z.string().trim().min(1).optional().nullable(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      let normalizedVideoUri: string;
      let normalizedFunscriptUri: string | null = null;

      try {
        normalizedVideoUri = normalizeHttpUrl(input.videoUri);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Website video URLs must use public http(s).",
        });
      }

      if (input.funscriptUri?.trim()) {
        try {
          normalizedFunscriptUri = normalizeHttpUrl(input.funscriptUri);
        } catch {
          normalizedFunscriptUri = input.funscriptUri.trim();
        }
      }

      try {
        const created = await db.transaction(async (tx) => {
          const [createdRound] = await tx
            .insert(round)
            .values({
              name: input.name.trim(),
              author: null,
              description: null,
              bpm: null,
              difficulty: null,
              phash: null,
              startTime: null,
              endTime: null,
              type: "Normal",
              installSourceKey: toWebsiteRoundInstallSourceKey({
                name: input.name,
                videoUri: normalizedVideoUri,
                funscriptUri: normalizedFunscriptUri,
              }),
              previewImage: null,
              heroId: null,
              updatedAt: new Date(),
            })
            .returning();

          if (!createdRound) {
            throw new Error("Failed to create the website round entry.");
          }

          const [createdResource] = await tx
            .insert(resource)
            .values({
              videoUri: normalizedVideoUri,
              funscriptUri: normalizedFunscriptUri,
              phash: null,
              durationMs: null,
              disabled: false,
              roundId: createdRound.id,
              updatedAt: new Date(),
            })
            .returning();

          if (!createdResource) {
            throw new Error("Failed to attach website media to the installed round.");
          }

          return {
            roundId: createdRound.id,
            resourceId: createdResource.id,
          };
        });

        queueWebsiteVideoCaching();
        return created;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Failed to create the website round entry.",
        });
      }
    }),

  checkWebsiteRoundVideoSupport: publicProcedure
    .input(
      z.object({
        videoUri: z.string().trim().min(1),
      })
    )
    .query(async ({ input }) => {
      let normalizedVideoUri: string;

      try {
        normalizedVideoUri = normalizeHttpUrl(input.videoUri);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Website video URLs must use public http(s).",
        });
      }

      try {
        const resolution = await resolveWebsiteVideoStream(normalizedVideoUri);
        return {
          supported: true,
          normalizedVideoUri,
          extractor: resolution.extractor ?? null,
          title: resolution.title ?? null,
        };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "This website video URL is not supported.",
        });
      }
    }),

  deleteRound: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const existing = await db.query.round.findFirst({
        where: eq(round.id, input.id),
        columns: { id: true },
        with: {
          resources: {
            columns: {
              videoUri: true,
            },
          },
        },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Round not found.",
        });
      }

      const deletedRoundWebsiteUrls = collectWebsiteVideoTargetUrls(
        existing.resources.map((entry) => entry.videoUri)
      );
      await db.delete(round).where(eq(round.id, input.id));

      if (deletedRoundWebsiteUrls.length > 0) {
        const remainingResources = await db.query.resource.findMany({
          columns: {
            videoUri: true,
          },
        });
        const remainingWebsiteUrls = new Set(
          collectWebsiteVideoTargetUrls(remainingResources.map((entry) => entry.videoUri))
        );
        await Promise.all(
          deletedRoundWebsiteUrls
            .filter((targetUrl) => !remainingWebsiteUrls.has(targetUrl))
            .map((targetUrl) => removeCachedWebsiteVideo(targetUrl))
        );
      }

      return { deleted: true };
    }),

  getResource: publicProcedure.input(z.object({ roundId: z.string() })).query(async ({ input }) => {
    const disabledRoundIds = getDisabledRoundIdSet();
    if (disabledRoundIds.has(input.roundId)) {
      return null;
    }

    const db = getDb();
    const firstResource = await db.query.resource.findFirst({
      where: (r, { and, eq }) => and(eq(r.roundId, input.roundId), eq(r.disabled, false)),
    });

    if (!firstResource) return null;
    await hydrateResourceDurationMs(db, [firstResource]);
    return {
      ...firstResource,
      ...resolveResourceUris({
        videoUri: firstResource.videoUri,
        funscriptUri: firstResource.funscriptUri,
      }),
    };
  }),

  getResources: publicProcedure.query(async () => {
    const disabledRoundIds = [...getDisabledRoundIdSet()];
    const db = getDb();

    const resources = await db.query.resource.findMany({
      where: (r, { and, eq, notInArray }) => {
        if (disabledRoundIds.length > 0) {
          return and(eq(r.disabled, false), notInArray(r.roundId, disabledRoundIds));
        }
        return eq(r.disabled, false);
      },
      limit: 5,
    });

    await hydrateResourceDurationMs(db, resources);
    return resources.map((r) => ({
      ...r,
      ...resolveResourceUris({
        videoUri: r.videoUri,
        funscriptUri: r.funscriptUri,
      }),
    }));
  }),

  getInstalledRounds: publicProcedure
    .input(
      z
        .object({
          includeDisabled: z.boolean().optional(),
          includeTemplates: z.boolean().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      const includeDisabled = input?.includeDisabled ?? false;
      const includeTemplates = input?.includeTemplates ?? false;
      const disabledRoundIds = getDisabledRoundIdSet();
      const websiteVideoCacheStateByUri = new Map<
        string,
        Promise<Awaited<ReturnType<typeof getWebsiteVideoCacheState>>>
      >();

      const rounds = await db.query.round.findMany({
        with: {
          hero: true,
          resources: includeDisabled
            ? true
            : {
                where: (r, { eq }) => eq(r.disabled, false),
              },
        },
        orderBy: [desc(round.createdAt)],
      });

      const filteredRounds = rounds.filter((r) => {
        const isTemplate = r.resources.length === 0;
        if (!includeTemplates && isTemplate) return false;
        if (!includeDisabled) {
          if (disabledRoundIds.has(r.id)) return false;
          if (!includeTemplates && r.resources.length === 0) return false;
        }
        return true;
      });

      await hydrateResourceDurationMs(
        db,
        filteredRounds.flatMap((entry) => entry.resources)
      );

      const getCachedStateForUri = (videoUri: string) => {
        const existing = websiteVideoCacheStateByUri.get(videoUri);
        if (existing) return existing;
        const pending = getWebsiteVideoCacheState(videoUri);
        websiteVideoCacheStateByUri.set(videoUri, pending);
        return pending;
      };

      return await Promise.all(
        filteredRounds.map(async (entry) => ({
          ...entry,
          resources: await Promise.all(
            entry.resources.map(async (res) => ({
              ...res,
              ...resolveResourceUris({
                videoUri: res.videoUri,
                funscriptUri: res.funscriptUri,
              }),
              websiteVideoCacheStatus: await getCachedStateForUri(res.videoUri),
            }))
          ),
        }))
      );
    }),

  getDisabledRoundIds: publicProcedure.query(async () => {
    const db = getDb();
    const fromStore = getDisabledRoundIdSet();

    // Find rounds where all resources are disabled and it has at least one resource
    const roundsWithResources = await db.query.round.findMany({
      with: { resources: true },
    });

    for (const r of roundsWithResources) {
      if (r.resources.length > 0 && r.resources.every((res) => res.disabled)) {
        fromStore.add(r.id);
      }
    }

    return [...fromStore];
  }),

  getInstallScanStatus: publicProcedure.query(() => {
    return getInstallScanStatus();
  }),

  inspectInstallFolder: publicProcedure
    .input(
      z.object({
        folderPath: z.string().min(1),
      })
    )
    .query(async ({ input }) => {
      try {
        return await inspectInstallFolder(input.folderPath);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to inspect selected folder.",
        });
      }
    }),

  scanInstallSources: publicProcedure.mutation(async () => {
    const result = await scanInstallSources("manual");
    queueWebsiteVideoCaching();
    return result;
  }),

  scanInstallFolderOnce: publicProcedure
    .input(
      z.object({
        folderPath: z.string().min(1),
        omitCheckpointRounds: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await scanInstallFolderOnceWithLegacySupport(input.folderPath, {
          omitCheckpointRounds: input.omitCheckpointRounds ?? true,
        });
        queueWebsiteVideoCaching();
        return result;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Failed to install from selected folder.",
        });
      }
    }),

  importInstallSidecarFile: publicProcedure
    .input(
      z.object({
        filePath: z.string().min(1),
        allowedBaseDomains: z.array(z.string().trim().min(1)).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await importInstallSidecarFile(
          input.filePath,
          input.allowedBaseDomains ?? []
        );
        queueWebsiteVideoCaching();
        return result;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Failed to import selected sidecar file.",
        });
      }
    }),

  inspectInstallSidecarFile: publicProcedure
    .input(
      z.object({
        filePath: z.string().min(1),
      })
    )
    .query(async ({ input }) => {
      try {
        return await inspectInstallSidecarFile(input.filePath);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Failed to inspect selected sidecar file.",
        });
      }
    }),

  retryTemplateLinking: publicProcedure
    .input(
      z
        .object({
          roundId: z.string().min(1).optional(),
          heroId: z.string().min(1).optional(),
        })
        .optional()
    )
    .mutation(async ({ input }) => {
      try {
        return await retryTemplateLinking({
          roundId: input?.roundId,
          heroId: input?.heroId,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to retry template linking.",
        });
      }
    }),

  repairTemplateRound: publicProcedure
    .input(
      z.object({
        roundId: z.string().min(1),
        installedRoundId: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await repairTemplateRound(input.roundId, input.installedRoundId);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to repair template round.",
        });
      }
    }),

  repairTemplateHero: publicProcedure
    .input(
      z.object({
        heroId: z.string().min(1),
        sourceHeroId: z.string().min(1),
        assignments: z
          .array(
            z.object({
              roundId: z.string().min(1),
              installedRoundId: z.string().min(1),
            })
          )
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await repairTemplateHero(input.heroId, input.sourceHeroId, input.assignments);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to repair template hero.",
        });
      }
    }),

  importLegacyFolderWithPlan: publicProcedure
    .input(
      z.object({
        folderPath: z.string().min(1),
        reviewedSlots: z.array(
          z.object({
            id: z.string().min(1),
            sourcePath: z.string().min(1),
            originalOrder: z.number().int().min(0),
            selectedAsCheckpoint: z.boolean(),
            excludedFromImport: z.boolean(),
          })
        ),
        deferPhash: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await importLegacyFolderWithPlan(input.folderPath, input.reviewedSlots, {
          deferPhash: input.deferPhash,
        });
        queueWebsiteVideoCaching();
        return result;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Failed to import reviewed legacy folder.",
        });
      }
    }),

  getAutoScanFolders: publicProcedure.query(() => {
    return getAutoScanFolders();
  }),

  addAutoScanFolder: publicProcedure
    .input(z.object({ folderPath: z.string().min(1) }))
    .mutation(async ({ input }) => {
      try {
        return await addAutoScanFolder(input.folderPath);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to add auto-scan folder.",
        });
      }
    }),

  addAutoScanFolderAndScan: publicProcedure
    .input(z.object({ folderPath: z.string().min(1) }))
    .mutation(async ({ input }) => {
      try {
        const result = await addAutoScanFolderAndScan(input.folderPath);
        queueWebsiteVideoCaching();
        return result;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Failed to add and import auto-scan folder.",
        });
      }
    }),

  removeAutoScanFolder: publicProcedure
    .input(z.object({ folderPath: z.string().min(1) }))
    .mutation(({ input }) => {
      return removeAutoScanFolder(input.folderPath);
    }),

  exportInstalledDatabase: publicProcedure
    .input(z.object({ includeResourceUris: z.boolean().optional() }).optional())
    .mutation(async ({ input }) => {
      try {
        return await exportInstalledDatabase({
          includeResourceUris: input?.includeResourceUris ?? false,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to export installed database.",
        });
      }
    }),

  exportLibraryPackage: publicProcedure
    .input(
      z.object({
        roundIds: z.array(z.string()).optional(),
        heroIds: z.array(z.string()).optional(),
        includeMedia: z.boolean().optional(),
        directoryPath: z.string().optional(),
        asFpack: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await exportLibraryPackage({
          roundIds: input.roundIds,
          heroIds: input.heroIds,
          includeMedia: input.includeMedia ?? true,
          directoryPath: input.directoryPath,
          asFpack: input.asFpack ?? false,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to export library package.",
        });
      }
    }),

  openInstallExportFolder: publicProcedure.mutation(async () => {
    const exportBaseDir = getInstallExportBaseDir();
    await fs.mkdir(exportBaseDir, { recursive: true });
    const openError = await shell.openPath(exportBaseDir);
    if (openError) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: openError,
      });
    }
    return { path: exportBaseDir };
  }),

  clearAllData: publicProcedure
    .input(
      z
        .object({
          rounds: z.boolean().optional(),
          playlists: z.boolean().optional(),
          stats: z.boolean().optional(),
          history: z.boolean().optional(),
          cache: z.boolean().optional(),
          videoCache: z.boolean().optional(),
          settings: z.boolean().optional(),
        })
        .optional()
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const {
        rounds = true,
        playlists = true,
        stats = true,
        history = true,
        cache = true,
        videoCache = true,
        settings = true,
      } = input ?? {};

      await db.transaction(async (tx) => {
        if (cache) {
          await tx.delete(multiplayerMatchCache);
          await tx.delete(resultSyncQueue);
        }
        if (history) {
          await tx.delete(singlePlayerRunHistory);
        }
        if (playlists) {
          await tx.delete(playlistTrackPlay);
          await tx.delete(playlist);
        }
        if (rounds) {
          await tx.delete(resource);
          await tx.delete(round);
          await tx.delete(hero);
        }
        if (stats) {
          await tx.delete(gameProfile);
        }
      });

      if (settings) {
        getStore().clear();
      }
      if (videoCache) {
        await Promise.all([clearWebsiteVideoCache(), clearPlayableVideoCache()]);
      }
      return { cleared: true };
    }),

  convertHeroGroupToRound: publicProcedure
    .input(
      z.object({
        keepRoundId: z.string().min(1),
        roundIds: z.array(z.string().min(1)).min(1),
        heroId: z.string().min(1).optional().nullable(),
        roundName: z.string().trim().min(1),
      })
    )
    .mutation(async ({ input }) => {
      if (!input.roundIds.includes(input.keepRoundId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The selected round to keep must be part of the hero group.",
        });
      }

      const db = getDb();

      return db.transaction(async (tx) => {
        const rounds = await tx.query.round.findMany({
          where: inArray(round.id, input.roundIds),
          columns: { id: true, heroId: true },
        });
        if (rounds.length !== input.roundIds.length) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Some rounds in this hero group could not be found.",
          });
        }

        const roundById = new Map(rounds.map((r) => [r.id, r]));
        const keepRound = roundById.get(input.keepRoundId);
        if (!keepRound) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "The selected round to keep no longer exists.",
          });
        }

        const keepRoundHeroId = keepRound.heroId ?? null;
        const targetHeroId = input.heroId ?? keepRoundHeroId;
        if (input.heroId && keepRoundHeroId !== input.heroId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The selected round does not belong to the provided hero.",
          });
        }

        const deleteRoundIds = input.roundIds.filter((id) => id !== input.keepRoundId);
        if (deleteRoundIds.length > 0) {
          await tx.delete(resource).where(inArray(resource.roundId, deleteRoundIds));
          await tx.delete(round).where(inArray(round.id, deleteRoundIds));
        }

        await tx
          .update(round)
          .set({
            heroId: null,
            name: input.roundName,
            startTime: null,
            endTime: null,
          })
          .where(eq(round.id, input.keepRoundId));

        let deletedHero = false;
        if (targetHeroId) {
          // count properly
          const groupRemaining = await tx
            .select({ id: round.id })
            .from(round)
            .where(eq(round.heroId, targetHeroId));
          if (groupRemaining.length === 0) {
            await tx.delete(hero).where(eq(hero.id, targetHeroId));
            deletedHero = true;
          }
        }

        return {
          keptRoundId: input.keepRoundId,
          removedRoundCount: deleteRoundIds.length,
          deletedHero,
        };
      });
    }),

  getPhashScanStatus: publicProcedure.query(() => {
    return getPhashScanStatus();
  }),

  startPhashScan: publicProcedure.mutation(async () => {
    return startPhashScan();
  }),

  startPhashScanManual: publicProcedure.mutation(async () => {
    return startPhashScanManual();
  }),

  abortPhashScan: publicProcedure.mutation(() => {
    return requestPhashScanAbort();
  }),

  getWebsiteVideoScanStatus: publicProcedure.query(() => {
    return getWebsiteVideoScanStatus();
  }),

  startWebsiteVideoScan: publicProcedure.mutation(async () => {
    return startWebsiteVideoScan();
  }),

  startWebsiteVideoScanManual: publicProcedure.mutation(async () => {
    return startWebsiteVideoScanManual();
  }),

  abortWebsiteVideoScan: publicProcedure.mutation(() => {
    return requestWebsiteVideoScanAbort();
  }),

  getWebsiteVideoDownloadProgresses: publicProcedure.query(() => {
    return getAllWebsiteVideoDownloadProgresses();
  }),

  ensureWebsiteVideoCachedForConverter: publicProcedure
    .input(
      z.object({
        url: z.string().trim().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const result = await ensureWebsiteVideoCached(input.url);
      return {
        finalFilePath: result.finalFilePath,
        title: result.title,
        durationMs: result.durationMs,
        extractor: result.extractor,
      };
    }),

  getWebsiteVideoDownloadProgressForUrl: publicProcedure
    .input(
      z.object({
        url: z.string().trim().min(1),
      })
    )
    .query(({ input }) => {
      return getWebsiteVideoDownloadProgress(input.url);
    }),

  cancelWebsiteVideoCache: publicProcedure
    .input(
      z.object({
        url: z.string().trim().min(1),
      })
    )
    .mutation(async ({ input }) => {
      await removeCachedWebsiteVideo(input.url);
    }),
});
