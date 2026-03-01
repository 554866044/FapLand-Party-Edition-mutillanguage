export const BACKGROUND_PHASH_SCANNING_ENABLED_KEY = "game.backgroundPhashScanning.enabled";
export const DEFAULT_BACKGROUND_PHASH_SCANNING_ENABLED = true;

export function normalizeBackgroundPhashScanningEnabled(value: unknown): boolean {
    if (typeof value === "boolean") return value;
    return DEFAULT_BACKGROUND_PHASH_SCANNING_ENABLED;
}
