export const CONTROLLER_SUPPORT_ENABLED_KEY = "experimental.controllerSupportEnabled";
export const CONTROLLER_SUPPORT_ENABLED_EVENT = "fland:experimental-controller-support-enabled";
export const DEFAULT_CONTROLLER_SUPPORT_ENABLED = false;

export function normalizeControllerSupportEnabled(value: unknown): boolean {
  return typeof value === "boolean" ? value : DEFAULT_CONTROLLER_SUPPORT_ENABLED;
}
