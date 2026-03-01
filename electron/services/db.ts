import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { app } from "electron";
import path from "node:path";
import { getNodeEnv } from "../../src/zod/env";
import * as schema from "./db/schema";

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let databaseReadyPromise: Promise<void> | null = null;
let dbClientUrl: string = "";

function rowValueToString(row: Record<string, unknown>, key: string): string | null {
    const value = row[key];
    return typeof value === "string" ? value : null;
}

async function hasColumn(
    dbInstance: ReturnType<typeof drizzle<typeof schema>>,
    tableName: string,
    columnName: string,
): Promise<boolean> {
    const result = await dbInstance.$client.execute(`PRAGMA table_info("${tableName}")`);
    return result.rows.some((row) => {
        const rowRecord = row as Record<string, unknown>;
        return rowValueToString(rowRecord, "name") === columnName;
    });
}

async function hasIndex(
    dbInstance: ReturnType<typeof drizzle<typeof schema>>,
    tableName: string,
    indexName: string,
): Promise<boolean> {
    const result = await dbInstance.$client.execute(`PRAGMA index_list("${tableName}")`);
    return result.rows.some((row) => {
        const rowRecord = row as Record<string, unknown>;
        return rowValueToString(rowRecord, "name") === indexName;
    });
}

async function repairLegacyPlaylistSchema(dbInstance: ReturnType<typeof drizzle<typeof schema>>): Promise<void> {
    const playlistInstallSourceKeyExists = await hasColumn(dbInstance, "Playlist", "installSourceKey");
    if (!playlistInstallSourceKeyExists) {
        await dbInstance.$client.execute(`ALTER TABLE "Playlist" ADD COLUMN "installSourceKey" text`);
    }

    const playlistInstallSourceKeyIndexExists = await hasIndex(dbInstance, "Playlist", "Playlist_installSourceKey_unique");
    if (!playlistInstallSourceKeyIndexExists) {
        await dbInstance.$client.execute(
            `CREATE UNIQUE INDEX "Playlist_installSourceKey_unique" ON "Playlist" ("installSourceKey")`,
        );
    }
}

export function resolveDatabaseUrl(): string {
    const env = getNodeEnv();
    if (env.databaseUrlRaw) return env.databaseUrl;

    const baseDir = app.isPackaged ? app.getPath("userData") : app.getAppPath();
    return `file:${path.join(baseDir, "dev.db")}`;
}

export function getDb() {
    if (!db) {
        dbClientUrl = resolveDatabaseUrl();
        const client = createClient({ url: dbClientUrl });
        db = drizzle(client, { schema });
    }
    return db;
}

export async function ensureAppDatabaseReady(): Promise<void> {
    if (!databaseReadyPromise) {
        databaseReadyPromise = (async () => {
            const dbInstance = getDb();
            const migrationsFolder = app.isPackaged
                ? path.join(process.resourcesPath, "drizzle")
                : path.join(app.getAppPath(), "drizzle");

            await migrate(dbInstance, { migrationsFolder });
            await repairLegacyPlaylistSchema(dbInstance);
        })();
    }
    return databaseReadyPromise;
}
