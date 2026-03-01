export const AUTOFIX_BROKEN_FUNSCRIPTS_KEY = "game.funscript.autofixBrokenFunscripts";
export const DEFAULT_AUTOFIX_BROKEN_FUNSCRIPTS = true;

export function normalizeAutofixBrokenFunscripts(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return DEFAULT_AUTOFIX_BROKEN_FUNSCRIPTS;
}
