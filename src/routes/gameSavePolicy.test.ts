import { describe, expect, it } from "vitest";
import { shouldClearSinglePlayerSaveOnCompletion } from "./gameSavePolicy";

describe("shouldClearSinglePlayerSaveOnCompletion", () => {
  it("clears the save only for successful finishes", () => {
    expect(shouldClearSinglePlayerSaveOnCompletion("finished")).toBe(true);
    expect(shouldClearSinglePlayerSaveOnCompletion("self_reported_cum")).toBe(false);
    expect(shouldClearSinglePlayerSaveOnCompletion("cum_instruction_failed")).toBe(false);
    expect(shouldClearSinglePlayerSaveOnCompletion(null)).toBe(false);
  });
});
