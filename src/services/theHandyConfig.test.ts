import { describe, expect, it } from "vitest";
import { DEFAULT_THEHANDY_APP_API_KEY } from "../constants/theHandy";
import { normalizeHandyAppApiKeyOverride, resolveHandyAppApiKey } from "./theHandyConfig";

describe("theHandyConfig", () => {
  it("resolves to the bundled default when no override is provided", () => {
    expect(resolveHandyAppApiKey("")).toBe(DEFAULT_THEHANDY_APP_API_KEY);
    expect(resolveHandyAppApiKey("   ")).toBe(DEFAULT_THEHANDY_APP_API_KEY);
  });

  it("prefers a trimmed override key over the bundled default", () => {
    expect(resolveHandyAppApiKey("  custom-key  ")).toBe("custom-key");
  });

  it("normalizes override values consistently", () => {
    expect(normalizeHandyAppApiKeyOverride("  custom-key  ")).toBe("custom-key");
    expect(normalizeHandyAppApiKeyOverride(undefined)).toBe("");
  });
});
