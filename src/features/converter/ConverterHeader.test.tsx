import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConverterHeader } from "./ConverterHeader";

vi.mock("../../utils/audio", () => ({
  playHoverSound: vi.fn(),
  playSelectSound: vi.fn(),
}));

describe("ConverterHeader", () => {
  it("renders explicit shortcut visibility controls", () => {
    const onShowHotkeys = vi.fn();
    const onHideHotkeys = vi.fn();

    const { rerender } = render(
      <ConverterHeader
        step="edit"
        selectedSourceInfo={{ kind: "local", id: "source-1", name: "Editor" }}
        segmentCount={2}
        sourceSummary="Local file"
        showHotkeys
        onGoToSelect={() => {}}
        onShowHotkeys={onShowHotkeys}
        onHideHotkeys={onHideHotkeys}
      />
    );

    fireEvent.click(screen.getByText("Hide Shortcuts"));
    expect(onHideHotkeys).toHaveBeenCalledTimes(1);

    rerender(
      <ConverterHeader
        step="edit"
        selectedSourceInfo={{ kind: "local", id: "source-1", name: "Editor" }}
        segmentCount={2}
        sourceSummary="Local file"
        showHotkeys={false}
        onGoToSelect={() => {}}
        onShowHotkeys={onShowHotkeys}
        onHideHotkeys={onHideHotkeys}
      />
    );

    fireEvent.click(screen.getByText("Show Shortcuts"));
    expect(onShowHotkeys).toHaveBeenCalledTimes(1);
  });
});
