// @vitest-environment node

import path from "node:path";
import fs from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

let userDataPath = "/tmp/f-land-user-data";
const storeValues = new Map<string, unknown>();

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === "temp") return "/tmp";
      return userDataPath;
    }),
  },
}));

vi.mock("./store", () => ({
  getStore: () => ({
    get: (key: string) => storeValues.get(key),
  }),
}));

import { createFpackFromDirectory, ensureFpackExtracted, getFpackExtractionRoot, inspectFpack } from "./fpack";

describe("fpack.getFpackExtractionRoot", () => {
  it("uses userData for the default extraction root", async () => {
    storeValues.clear();
    await expect(getFpackExtractionRoot()).resolves.toBe(path.join(userDataPath, "fpacks"));
  });

  it("uses the configured extraction root when present", async () => {
    storeValues.set("fpack.extractionPath", "/custom/fpacks");
    await expect(getFpackExtractionRoot()).resolves.toBe(path.resolve("/custom/fpacks"));
  });
});

describe("fpack archive workflows", () => {
  it("inspects sidecar entries without extraction and reuses cached extraction", async () => {
    const tempRoot = await fs.mkdtemp(path.join("/tmp", "fpack-test-"));
    userDataPath = tempRoot;
    storeValues.clear();

    const sourceDir = path.join(tempRoot, "source");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.mkdir(path.join(sourceDir, "media"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "demo.round"),
      JSON.stringify({
        name: "Demo Round",
        resources: [{ videoUri: "./media/demo.mp4", funscriptUri: "./media/demo.funscript" }],
      }),
      "utf8"
    );
    await fs.writeFile(path.join(sourceDir, "media", "demo.mp4"), "video", "utf8");
    await fs.writeFile(path.join(sourceDir, "media", "demo.funscript"), "script", "utf8");

    const fpackPath = path.join(tempRoot, "demo.fpack");
    await createFpackFromDirectory(sourceDir, fpackPath);

    const inspection = await inspectFpack(fpackPath);
    expect(inspection.sidecarCount).toBe(1);
    expect(inspection.sidecars[0]?.archiveEntryPath).toBe("demo.round");
    expect(inspection.sidecars[0]?.resources[0]?.videoUri).toBe("media/demo.mp4");

    const extracted = await ensureFpackExtracted(fpackPath);
    expect(extracted.reused).toBe(false);
    expect(extracted.manifest.sidecarEntries[0]?.archiveEntryPath).toBe("demo.round");

    const reused = await ensureFpackExtracted(fpackPath);
    expect(reused.reused).toBe(true);
    expect(reused.dir).toBe(extracted.dir);
  });
});
