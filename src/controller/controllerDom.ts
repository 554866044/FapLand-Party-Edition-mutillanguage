import type { ControllerAction, ControllerSurfaceOptions } from "./types";

const FOCUSABLE_SELECTOR = [
  "[data-controller-focus-id]",
  "button",
  "a[href]",
  "input",
  "select",
  "textarea",
  "[tabindex]",
  "[role=\"button\"]",
].join(",");

function isElementDisabled(element: HTMLElement): boolean {
  if (element.dataset.controllerDisabled === "true") return true;
  if (element.closest("[data-controller-skip=\"true\"]")) return true;
  if (element.getAttribute("aria-disabled") === "true") return true;

  const maybeDisabled = element as HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  return Boolean(maybeDisabled.disabled);
}

function isElementVisible(element: HTMLElement): boolean {
  if (element.hidden) return false;
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function isEditableElement(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return false;
  if (element.isContentEditable) return true;
  const tagName = element.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea";
}

function isTextEntryElement(element: HTMLElement | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement) return true;
  if (!(element instanceof HTMLInputElement)) return false;
  return !["checkbox", "radio", "range", "button", "submit", "reset"].includes(element.type);
}

function isSelectElement(element: HTMLElement | null): element is HTMLSelectElement {
  return element instanceof HTMLSelectElement;
}

function isNumberStepperElement(element: HTMLElement | null): element is HTMLInputElement {
  return element instanceof HTMLInputElement && (element.type === "number" || element.type === "range");
}

export function getSurfaceRoot(surface: Pick<ControllerSurfaceOptions, "scopeRef">): HTMLElement {
  return surface.scopeRef?.current ?? document.body;
}

export function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (!root.contains(element)) return false;
    if (isElementDisabled(element)) return false;
    if (!isElementVisible(element)) return false;
    if (element.tabIndex < 0 && !element.dataset.controllerFocusId) return false;
    return true;
  });
}

export function findFocusableById(root: HTMLElement, id: string | null | undefined): HTMLElement | null {
  if (!id) return null;
  return Array.from(root.querySelectorAll<HTMLElement>("[data-controller-focus-id]"))
    .find((element) => element.dataset.controllerFocusId === id) ?? null;
}

export function findInitialFocusable(root: HTMLElement, initialFocusId?: string): HTMLElement | null {
  const explicit = findFocusableById(root, initialFocusId);
  if (explicit && !isElementDisabled(explicit) && isElementVisible(explicit)) {
    return explicit;
  }

  const marked = root.querySelector<HTMLElement>("[data-controller-initial=\"true\"]");
  if (marked && !isElementDisabled(marked) && isElementVisible(marked)) {
    return marked;
  }

  return getFocusableElements(root)[0] ?? null;
}

export function focusElement(element: HTMLElement | null): boolean {
  if (!element) return false;
  element.focus({ preventScroll: true });
  element.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  return document.activeElement === element;
}

function getDirectionalOverride(element: HTMLElement, action: Extract<ControllerAction, "UP" | "DOWN" | "LEFT" | "RIGHT">): string | null {
  switch (action) {
    case "UP":
      return element.dataset.controllerUp ?? null;
    case "DOWN":
      return element.dataset.controllerDown ?? null;
    case "LEFT":
      return element.dataset.controllerLeft ?? null;
    case "RIGHT":
      return element.dataset.controllerRight ?? null;
  }
}

function directionMatches(deltaX: number, deltaY: number, action: Extract<ControllerAction, "UP" | "DOWN" | "LEFT" | "RIGHT">): boolean {
  switch (action) {
    case "UP":
      return deltaY < -4;
    case "DOWN":
      return deltaY > 4;
    case "LEFT":
      return deltaX < -4;
    case "RIGHT":
      return deltaX > 4;
  }
}

function getDirectionScore(deltaX: number, deltaY: number, action: Extract<ControllerAction, "UP" | "DOWN" | "LEFT" | "RIGHT">): number {
  const primary = action === "UP" || action === "DOWN" ? Math.abs(deltaY) : Math.abs(deltaX);
  const secondary = action === "UP" || action === "DOWN" ? Math.abs(deltaX) : Math.abs(deltaY);
  return primary + secondary * 0.35;
}

export function moveFocus(
  root: HTMLElement,
  current: HTMLElement | null,
  action: Extract<ControllerAction, "UP" | "DOWN" | "LEFT" | "RIGHT">,
): boolean {
  const focusables = getFocusableElements(root);
  if (focusables.length === 0) return false;

  if (!current || !root.contains(current) || isElementDisabled(current) || !isElementVisible(current)) {
    return focusElement(focusables[0] ?? null);
  }

  const overrideId = getDirectionalOverride(current, action);
  if (overrideId) {
    const overrideTarget = findFocusableById(root, overrideId);
    if (overrideTarget) {
      return focusElement(overrideTarget);
    }
  }

  const currentRect = current.getBoundingClientRect();
  const currentCenterX = currentRect.left + currentRect.width / 2;
  const currentCenterY = currentRect.top + currentRect.height / 2;

  let bestCandidate: HTMLElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of focusables) {
    if (candidate === current) continue;
    const rect = candidate.getBoundingClientRect();
    const deltaX = rect.left + rect.width / 2 - currentCenterX;
    const deltaY = rect.top + rect.height / 2 - currentCenterY;
    if (!directionMatches(deltaX, deltaY, action)) continue;
    const score = getDirectionScore(deltaX, deltaY, action);
    if (score < bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  if (bestCandidate) {
    return focusElement(bestCandidate);
  }

  const currentIndex = focusables.indexOf(current);
  if (currentIndex < 0) return focusElement(focusables[0] ?? null);

  const delta = action === "UP" || action === "LEFT" ? -1 : 1;
  const wrappedIndex = (currentIndex + delta + focusables.length) % focusables.length;
  return focusElement(focusables[wrappedIndex] ?? null);
}

function stepSelect(element: HTMLSelectElement, direction: -1 | 1): boolean {
  const nextIndex = Math.max(0, Math.min(element.options.length - 1, element.selectedIndex + direction));
  if (nextIndex === element.selectedIndex) return false;
  element.selectedIndex = nextIndex;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function stepNumber(element: HTMLInputElement, direction: -1 | 1): boolean {
  try {
    if (direction > 0) {
      element.stepUp();
    } else {
      element.stepDown();
    }
  } catch {
    const current = Number(element.value || 0);
    const step = Number(element.step || 1) || 1;
    element.value = `${current + step * direction}`;
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

export function handleDomAction(surface: ControllerSurfaceOptions, action: ControllerAction): boolean {
  const root = getSurfaceRoot(surface);
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const focused = activeElement && root.contains(activeElement) ? activeElement : null;

  if ((action === "SECONDARY" || action === "BACK") && isTextEntryElement(focused)) {
    focused.blur();
    return true;
  }

  if ((action === "LEFT" || action === "RIGHT") && isSelectElement(focused)) {
    return stepSelect(focused, action === "RIGHT" ? 1 : -1);
  }

  if ((action === "LEFT" || action === "RIGHT") && isNumberStepperElement(focused)) {
    return stepNumber(focused, action === "RIGHT" ? 1 : -1);
  }

  if (
    (action === "UP" || action === "DOWN" || action === "LEFT" || action === "RIGHT")
    && (!focused || !isTextEntryElement(focused))
  ) {
    return moveFocus(root, focused, action);
  }

  if (action === "PRIMARY") {
    if (!focused) {
      return focusElement(findInitialFocusable(root, surface.initialFocusId));
    }

    if (isTextEntryElement(focused)) {
      focused.focus({ preventScroll: true });
      return true;
    }

    focused.click();
    return true;
  }

  if (action === "SECONDARY" || action === "BACK") {
    if (focused?.dataset.controllerBack === "true") {
      focused.click();
      return true;
    }
  }

  return false;
}
