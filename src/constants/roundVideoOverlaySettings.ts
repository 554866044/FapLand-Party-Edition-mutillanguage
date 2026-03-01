export const ROUND_PROGRESS_BAR_ALWAYS_VISIBLE_KEY = "game.video.roundProgressBarAlwaysVisible";
export const DEFAULT_ROUND_PROGRESS_BAR_ALWAYS_VISIBLE = false;
export const ANTI_PERK_BEATBAR_ENABLED_KEY = "game.video.antiPerkBeatbarEnabled";
export const DEFAULT_ANTI_PERK_BEATBAR_ENABLED = true;

export function normalizeRoundProgressBarAlwaysVisible(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return DEFAULT_ROUND_PROGRESS_BAR_ALWAYS_VISIBLE;
}

export function normalizeAntiPerkBeatbarEnabled(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return DEFAULT_ANTI_PERK_BEATBAR_ENABLED;
}
