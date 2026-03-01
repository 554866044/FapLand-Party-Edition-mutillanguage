const { copyFile, access } = require("node:fs/promises");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const source = path.join(context.appOutDir, "v8_context_snapshot.bin");
  const target = path.join(context.appOutDir, "browser_v8_context_snapshot.bin");

  try {
    await access(source);
  } catch {
    return;
  }

  try {
    await access(target);
    return;
  } catch {
    // Electron 41 with browser-specific V8 snapshots expects this extra file.
  }

  await copyFile(source, target);
};
