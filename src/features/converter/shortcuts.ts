import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { SegmentType } from "./types";

export type ConverterShortcutCategory =
  | "Playback"
  | "Marking"
  | "Segment Navigation"
  | "Segment Editing"
  | "Detection & Save";

export type ConverterShortcutDisplay = {
  id: string;
  keysLabel: string;
  description: string;
  category: ConverterShortcutCategory;
};

export type ConverterShortcutContext = {
  showHotkeys: boolean;
  toggleHotkeys: () => void;
  clearTransientEditorState: () => void;
  togglePlayback: () => Promise<void> | void;
  setMarkInAtPlayhead: () => void;
  setMarkOutAtPlayhead: () => void;
  addSegmentFromMarks: () => void;
  deleteSelectedSegment: () => void;
  setSelectedSegmentType: (type: SegmentType) => void;
  seekByMs: (amountMs: number) => void;
  nudgeSelectedSegment: (amountMs: number) => void;
  moveSelectedSegmentStartToPlayhead: () => void;
  moveSelectedSegmentEndToPlayhead: () => void;
  zoomByFactor: (factor: number) => void;
  resetZoom: () => void;
  jumpToRandomPoint: () => void;
  splitSegmentAtPlayhead: () => void;
  selectNextSegment: () => void;
  selectPreviousSegment: () => void;
  selectSegmentAtPlayhead: () => void;
  seekToSelectedSegmentStart: () => void;
  seekToSelectedSegmentEnd: () => void;
  mergeSelectedSegmentWithNext: () => void;
  runAutoDetect: () => Promise<void> | void;
  applyDetectedSuggestions: () => void;
  saveConvertedRounds: () => Promise<void> | void;
};

type ConverterShortcutBinding = ConverterShortcutDisplay & {
  matches: (event: KeyboardEvent | ReactKeyboardEvent<HTMLElement>) => boolean;
  trigger: (context: ConverterShortcutContext) => void;
};

function keyMatch(
  event: KeyboardEvent | ReactKeyboardEvent<HTMLElement>,
  key: string,
  options?: { shiftKey?: boolean; ctrlOrMeta?: boolean }
): boolean {
  if (event.key !== key) return false;
  if ((options?.shiftKey ?? false) !== event.shiftKey) return false;
  if ((options?.ctrlOrMeta ?? false) !== (event.ctrlKey || event.metaKey)) return false;
  if (!options?.ctrlOrMeta && (event.ctrlKey || event.metaKey)) return false;
  return true;
}

export const CONVERTER_SHORTCUTS: readonly ConverterShortcutBinding[] = [
  {
    id: "toggle-hotkeys",
    keysLabel: "?",
    description: "Show or hide the shortcut overlay.",
    category: "Detection & Save",
    matches: (event) => keyMatch(event, "?"),
    trigger: (context) => context.toggleHotkeys(),
  },
  {
    id: "play-pause",
    keysLabel: "Space",
    description: "Play or pause the source video.",
    category: "Playback",
    matches: (event) => keyMatch(event, " "),
    trigger: (context) => {
      void context.togglePlayback();
    },
  },
  {
    id: "mark-in",
    keysLabel: "I",
    description: "Set the IN marker at the current time.",
    category: "Marking",
    matches: (event) => keyMatch(event, "i") || keyMatch(event, "I"),
    trigger: (context) => context.setMarkInAtPlayhead(),
  },
  {
    id: "mark-out",
    keysLabel: "O",
    description: "Set the OUT marker at the current time.",
    category: "Marking",
    matches: (event) => keyMatch(event, "o") || keyMatch(event, "O"),
    trigger: (context) => context.setMarkOutAtPlayhead(),
  },
  {
    id: "add-segment",
    keysLabel: "Enter",
    description: "Create a segment from the current IN and OUT markers.",
    category: "Marking",
    matches: (event) => keyMatch(event, "Enter"),
    trigger: (context) => context.addSegmentFromMarks(),
  },
  {
    id: "delete-segment",
    keysLabel: "Delete / Backspace",
    description: "Remove the currently selected segment.",
    category: "Segment Editing",
    matches: (event) => keyMatch(event, "Delete") || keyMatch(event, "Backspace"),
    trigger: (context) => context.deleteSelectedSegment(),
  },
  {
    id: "set-type-normal",
    keysLabel: "1",
    description: "Set the selected segment type to Normal.",
    category: "Segment Editing",
    matches: (event) => keyMatch(event, "1"),
    trigger: (context) => context.setSelectedSegmentType("Normal"),
  },
  {
    id: "set-type-interjection",
    keysLabel: "2",
    description: "Set the selected segment type to Interjection.",
    category: "Segment Editing",
    matches: (event) => keyMatch(event, "2"),
    trigger: (context) => context.setSelectedSegmentType("Interjection"),
  },
  {
    id: "set-type-cum",
    keysLabel: "3",
    description: "Set the selected segment type to Cum.",
    category: "Segment Editing",
    matches: (event) => keyMatch(event, "3"),
    trigger: (context) => context.setSelectedSegmentType("Cum"),
  },
  {
    id: "seek-backward",
    keysLabel: "Left",
    description: "Seek backward by 1 second.",
    category: "Playback",
    matches: (event) => keyMatch(event, "ArrowLeft"),
    trigger: (context) => context.seekByMs(-1000),
  },
  {
    id: "seek-forward",
    keysLabel: "Right",
    description: "Seek forward by 1 second.",
    category: "Playback",
    matches: (event) => keyMatch(event, "ArrowRight"),
    trigger: (context) => context.seekByMs(1000),
  },
  {
    id: "seek-backward-fast",
    keysLabel: "Shift+Left",
    description: "Seek backward by 5 seconds.",
    category: "Playback",
    matches: (event) => keyMatch(event, "ArrowLeft", { shiftKey: true }),
    trigger: (context) => context.seekByMs(-5000),
  },
  {
    id: "seek-forward-fast",
    keysLabel: "Shift+Right",
    description: "Seek forward by 5 seconds.",
    category: "Playback",
    matches: (event) => keyMatch(event, "ArrowRight", { shiftKey: true }),
    trigger: (context) => context.seekByMs(5000),
  },
  {
    id: "nudge-end-backward",
    keysLabel: ",",
    description: "Nudge the selected segment end earlier by 100 ms.",
    category: "Segment Editing",
    matches: (event) => keyMatch(event, ","),
    trigger: (context) => context.nudgeSelectedSegment(-100),
  },
  {
    id: "nudge-end-forward",
    keysLabel: ".",
    description: "Nudge the selected segment end later by 100 ms.",
    category: "Segment Editing",
    matches: (event) => keyMatch(event, "."),
    trigger: (context) => context.nudgeSelectedSegment(100),
  },
  {
    id: "move-start-to-playhead",
    keysLabel: "S",
    description: "Move the selected segment start to the playhead.",
    category: "Segment Editing",
    matches: (event) => keyMatch(event, "s"),
    trigger: (context) => context.moveSelectedSegmentStartToPlayhead(),
  },
  {
    id: "move-end-to-playhead",
    keysLabel: "E",
    description: "Move the selected segment end to the playhead.",
    category: "Segment Editing",
    matches: (event) => keyMatch(event, "e") || keyMatch(event, "E"),
    trigger: (context) => context.moveSelectedSegmentEndToPlayhead(),
  },
  {
    id: "snap-start",
    keysLabel: "[",
    description: "Snap the selected segment start to the playhead.",
    category: "Segment Editing",
    matches: (event) => keyMatch(event, "["),
    trigger: (context) => context.moveSelectedSegmentStartToPlayhead(),
  },
  {
    id: "snap-end",
    keysLabel: "]",
    description: "Snap the selected segment end to the playhead.",
    category: "Segment Editing",
    matches: (event) => keyMatch(event, "]"),
    trigger: (context) => context.moveSelectedSegmentEndToPlayhead(),
  },
  {
    id: "zoom-in",
    keysLabel: "= / +",
    description: "Zoom the converter timeline in.",
    category: "Playback",
    matches: (event) => keyMatch(event, "=") || keyMatch(event, "+"),
    trigger: (context) => context.zoomByFactor(1.1),
  },
  {
    id: "zoom-out",
    keysLabel: "-",
    description: "Zoom the converter timeline out.",
    category: "Playback",
    matches: (event) => keyMatch(event, "-"),
    trigger: (context) => context.zoomByFactor(0.9),
  },
  {
    id: "zoom-reset",
    keysLabel: "0",
    description: "Reset the converter timeline zoom.",
    category: "Playback",
    matches: (event) => keyMatch(event, "0"),
    trigger: (context) => context.resetZoom(),
  },
  {
    id: "random-jump",
    keysLabel: "R",
    description: "Jump to a random point in the source video.",
    category: "Playback",
    matches: (event) => keyMatch(event, "r") || keyMatch(event, "R"),
    trigger: (context) => context.jumpToRandomPoint(),
  },
  {
    id: "split-segment",
    keysLabel: "K",
    description: "Split the segment under the playhead into two segments.",
    category: "Segment Editing",
    matches: (event) => keyMatch(event, "k") || keyMatch(event, "K"),
    trigger: (context) => context.splitSegmentAtPlayhead(),
  },
  {
    id: "select-next-segment",
    keysLabel: "N",
    description: "Select the next segment.",
    category: "Segment Navigation",
    matches: (event) => keyMatch(event, "n"),
    trigger: (context) => context.selectNextSegment(),
  },
  {
    id: "select-previous-segment",
    keysLabel: "Shift+N",
    description: "Select the previous segment.",
    category: "Segment Navigation",
    matches: (event) => keyMatch(event, "N", { shiftKey: true }),
    trigger: (context) => context.selectPreviousSegment(),
  },
  {
    id: "select-at-playhead",
    keysLabel: "P",
    description: "Select the segment under the playhead.",
    category: "Segment Navigation",
    matches: (event) => keyMatch(event, "p") || keyMatch(event, "P"),
    trigger: (context) => context.selectSegmentAtPlayhead(),
  },
  {
    id: "seek-selected-start",
    keysLabel: "Home",
    description: "Jump the playhead to the selected segment start.",
    category: "Segment Navigation",
    matches: (event) => keyMatch(event, "Home"),
    trigger: (context) => context.seekToSelectedSegmentStart(),
  },
  {
    id: "seek-selected-end",
    keysLabel: "End",
    description: "Jump the playhead to the selected segment end.",
    category: "Segment Navigation",
    matches: (event) => keyMatch(event, "End"),
    trigger: (context) => context.seekToSelectedSegmentEnd(),
  },
  {
    id: "merge-next",
    keysLabel: "M",
    description: "Merge the selected segment with the next segment.",
    category: "Segment Editing",
    matches: (event) => keyMatch(event, "m") || keyMatch(event, "M"),
    trigger: (context) => context.mergeSelectedSegmentWithNext(),
  },
  {
    id: "clear-transient-state",
    keysLabel: "Esc",
    description: "Hide shortcuts, clear marks, or clear selection.",
    category: "Segment Editing",
    matches: (event) => keyMatch(event, "Escape"),
    trigger: (context) => context.clearTransientEditorState(),
  },
  {
    id: "run-auto-detect",
    keysLabel: "A",
    description: "Run auto-detection on the current funscript.",
    category: "Detection & Save",
    matches: (event) => keyMatch(event, "a"),
    trigger: (context) => {
      void context.runAutoDetect();
    },
  },
  {
    id: "apply-auto-detect",
    keysLabel: "Shift+A",
    description: "Apply the current auto-detection suggestions.",
    category: "Detection & Save",
    matches: (event) => keyMatch(event, "A", { shiftKey: true }),
    trigger: (context) => context.applyDetectedSuggestions(),
  },
  {
    id: "save",
    keysLabel: "Ctrl/Cmd+S",
    description: "Save converted rounds to the current hero.",
    category: "Detection & Save",
    matches: (event) => keyMatch(event, "s", { ctrlOrMeta: true }) || keyMatch(event, "S", { ctrlOrMeta: true }),
    trigger: (context) => {
      void context.saveConvertedRounds();
    },
  },
] as const;

export const CONVERTER_SHORTCUT_CATEGORIES: readonly ConverterShortcutCategory[] = [
  "Playback",
  "Marking",
  "Segment Navigation",
  "Segment Editing",
  "Detection & Save",
] as const;

export function getConverterShortcutGroups(): Array<{
  category: ConverterShortcutCategory;
  shortcuts: ConverterShortcutDisplay[];
}> {
  return CONVERTER_SHORTCUT_CATEGORIES.map((category) => ({
    category,
    shortcuts: CONVERTER_SHORTCUTS.filter((shortcut) => shortcut.category === category),
  })).filter((group) => group.shortcuts.length > 0);
}
