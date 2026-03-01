import { execSync } from "node:child_process";
import { version as packageVersion } from "../package.json";

function readCommitHash(): string | null {
  try {
    const hash = execSync("git rev-parse --short=8 HEAD", {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return hash.length > 0 ? hash : null;
  } catch {
    return null;
  }
}

export function getBuildVersion(): string {
  const commitHash = process.env.FLAND_COMMIT_HASH?.trim() || readCommitHash();
  return commitHash ? `${packageVersion}+${commitHash}` : packageVersion;
}
