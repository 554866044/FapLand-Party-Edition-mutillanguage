// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveExistingLocalMediaPath, toLocalMediaUri, fromLocalMediaUri } from "./localMedia";

let tempDir: string;

describe("localMedia", () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "f-land-local-media-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("resolves a double-encoded local media path when the decoded file exists", async () => {
    const filePath = path.join(tempDir, "Fugtrup Zelda x Bokoblin.mp4");
    await fs.writeFile(filePath, "video");

    const doubleEncodedUri = toLocalMediaUri(filePath).replaceAll("%20", "%2520");
    const parsedPath = fromLocalMediaUri(doubleEncodedUri);

    expect(parsedPath).toContain("%20");
    expect(resolveExistingLocalMediaPath(parsedPath ?? "")).toBe(filePath);
  });

  it("preserves literal percent-encoded filenames when that exact file exists", async () => {
    const filePath = path.join(tempDir, "literal%20space.mp4");
    await fs.writeFile(filePath, "video");

    expect(resolveExistingLocalMediaPath(filePath)).toBe(filePath);
  });
});
