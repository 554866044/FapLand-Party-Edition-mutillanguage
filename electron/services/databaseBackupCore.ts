import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BACKUP_FILE_PREFIX = "f-land-db-backup-";
const BACKUP_FILE_SUFFIX = ".db";

export type DatabaseBackupResult = {
  backupPath: string;
  deletedBackups: number;
};

export type DatabaseBackupClient = {
  $client: {
    execute: (sql: string) => Promise<unknown>;
  };
};

function toSafeIsoTimestamp(date: Date): string {
  return date.toISOString().replaceAll(":", "-");
}

function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function getDatabaseBackupPath(backupDir: string, date: Date): string {
  return path.join(
    backupDir,
    `${BACKUP_FILE_PREFIX}${toSafeIsoTimestamp(date)}${BACKUP_FILE_SUFFIX}`
  );
}

export function isDatabaseBackupFileName(fileName: string): boolean {
  return fileName.startsWith(BACKUP_FILE_PREFIX) && fileName.endsWith(BACKUP_FILE_SUFFIX);
}

export function parseFileDatabasePath(databaseUrl: string): string | null {
  if (!databaseUrl.startsWith("file:")) return null;

  const rawPath = databaseUrl.slice("file:".length);
  if (rawPath === ":memory:") return null;
  if (rawPath.startsWith("//")) {
    return fileURLToPath(databaseUrl);
  }
  return path.resolve(rawPath);
}

export async function runDatabaseBackupForClient({
  db,
  backupDir,
  databaseUrl,
  now,
  pruneOldBackups,
}: {
  db: DatabaseBackupClient;
  backupDir: string;
  databaseUrl: string;
  now: Date;
  pruneOldBackups: (now: Date) => Promise<number>;
}): Promise<DatabaseBackupResult | null> {
  const databasePath = parseFileDatabasePath(databaseUrl);
  if (!databasePath) return null;

  await fs.access(databasePath);
  const backupPath = getDatabaseBackupPath(backupDir, now);
  await fs.mkdir(backupDir, { recursive: true });

  await db.$client.execute(`VACUUM INTO ${sqlStringLiteral(backupPath)}`);

  const deletedBackups = await pruneOldBackups(now);
  return { backupPath, deletedBackups };
}
