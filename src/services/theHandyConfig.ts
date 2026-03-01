import { DEFAULT_THEHANDY_APP_API_KEY } from "../constants/theHandy";

export function normalizeHandyAppApiKeyOverride(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function resolveHandyAppApiKey(appApiKeyOverride: string | null | undefined): string {
  const normalizedOverride = normalizeHandyAppApiKeyOverride(appApiKeyOverride);
  if (normalizedOverride.length > 0) {
    return normalizedOverride;
  }

  return DEFAULT_THEHANDY_APP_API_KEY.trim();
}
