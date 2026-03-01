export const CONTROLLER_SUPPORT_ENABLED_KEY = "experimental.controllerSupportEnabled";
export const CONTROLLER_SUPPORT_ENABLED_EVENT = "fland:experimental-controller-support-enabled";
export const DEFAULT_CONTROLLER_SUPPORT_ENABLED = false;

export function normalizeControllerSupportEnabled(value: unknown): boolean {
  return typeof value === "boolean" ? value : DEFAULT_CONTROLLER_SUPPORT_ENABLED;
}

export const CHEAT_MODE_ENABLED_KEY = "experimental.cheatModeEnabled";
export const CHEAT_MODE_ENABLED_EVENT = "fland:experimental-cheat-mode-enabled";
export const DEFAULT_CHEAT_MODE_ENABLED = false;

export function normalizeCheatModeEnabled(value: unknown): boolean {
  return typeof value === "boolean" ? value : DEFAULT_CHEAT_MODE_ENABLED;
}

export const SFW_MODE_ENABLED_KEY = "experimental.sfwModeEnabled";
export const SFW_MODE_ENABLED_EVENT = "fland:experimental-sfw-mode-enabled";
export const DEFAULT_SFW_MODE_ENABLED = false;

export function normalizeSfwModeEnabled(value: unknown): boolean {
  return typeof value === "boolean" ? value : DEFAULT_SFW_MODE_ENABLED;
}

export const MULTIPLAYER_SKIP_ROUNDS_CHECK_KEY = "experimental.multiplayerSkipRoundsCheck";
export const MULTIPLAYER_SKIP_ROUNDS_CHECK_EVENT =
  "fland:experimental-multiplayer-skip-rounds-check";
export const DEFAULT_MULTIPLAYER_SKIP_ROUNDS_CHECK = false;

export function normalizeMultiplayerSkipRoundsCheck(value: unknown): boolean {
  return typeof value === "boolean" ? value : DEFAULT_MULTIPLAYER_SKIP_ROUNDS_CHECK;
}

export const INSTALL_WEB_FUNSCRIPT_URL_ENABLED_KEY =
  "experimental.installWebFunscriptUrlEnabled";
export const DEFAULT_INSTALL_WEB_FUNSCRIPT_URL_ENABLED = false;

export function normalizeInstallWebFunscriptUrlEnabled(value: unknown): boolean {
  return typeof value === "boolean" ? value : DEFAULT_INSTALL_WEB_FUNSCRIPT_URL_ENABLED;
}

export const MULTIPLAYER_MINIMUM_ROUNDS = 100;
