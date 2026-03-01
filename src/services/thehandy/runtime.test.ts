import { describe, expect, it } from "vitest";
import { resolveInitialPreloadTargetMs } from "./runtime";

describe("resolveInitialPreloadTargetMs", () => {
  it("extends the initial preload to include the first point after startup", () => {
    const targetMs = resolveInitialPreloadTargetMs(
      [
        { t: 0, x: 25 },
        { t: 30_000, x: 75 },
      ],
      0,
      0,
    );

    expect(targetMs).toBe(30_000);
  });

  it("extends the initial preload when resuming inside a long interpolation gap", () => {
    const targetMs = resolveInitialPreloadTargetMs(
      [
        { t: 0, x: 25 },
        { t: 30_000, x: 75 },
      ],
      0,
      10_000,
    );

    expect(targetMs).toBe(30_000);
  });

  it("keeps the normal 15s preload window when a future point is already nearby", () => {
    const targetMs = resolveInitialPreloadTargetMs(
      [
        { t: 9_000, x: 25 },
        { t: 12_000, x: 75 },
      ],
      0,
      10_000,
    );

    expect(targetMs).toBe(25_000);
  });
});
