const { copyFile, access, chmod } = require("node:fs/promises");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const source = path.join(context.appOutDir, "v8_context_snapshot.bin");
  const target = path.join(context.appOutDir, "browser_v8_context_snapshot.bin");
  const bundledYtDlpPath = path.join(context.appOutDir, "resources", "yt-dlp", "linux-x64", "yt-dlp");

  try {
    await access(source);
  } catch {
    // Electron 41 with browser-specific V8 snapshots expects this extra file.
  }

  try {
    await access(target);
  } catch {
    try {
      await copyFile(source, target);
    } catch {
      // Best effort only.
    }
  }

  try {
    await access(bundledYtDlpPath);
    await chmod(bundledYtDlpPath, 0o755);
  } catch {
    // Best effort only.
  }
};
