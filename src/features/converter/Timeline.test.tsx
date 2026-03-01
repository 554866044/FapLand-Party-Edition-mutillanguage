import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Timeline } from "./Timeline";

vi.mock("../../utils/audio", () => ({
  playHoverSound: vi.fn(),
}));

describe("Timeline", () => {
  it("allows entering a zoom value manually", () => {
    const onZoomChange = vi.fn();

    render(
      <Timeline
        timelineScrollRef={{ current: null }}
        dragStateRef={{ current: null }}
        durationMs={10_000}
        currentTimeMs={2_000}
        markInMs={null}
        markOutMs={null}
        zoomPxPerSec={80}
        timelineWidthPx={1200}
        sortedSegments={[]}
        selectedSegmentId={null}
        funscriptActions={[]}
        onTimelineWheel={vi.fn()}
        onTimelinePointerDown={vi.fn()}
        onSelectSegment={vi.fn()}
        onZoomChange={onZoomChange}
      />,
    );

    const input = screen.getByLabelText("Timeline zoom");
    fireEvent.change(input, { target: { value: "123" } });
    fireEvent.blur(input);

    expect(onZoomChange).toHaveBeenCalledWith(123);
  });
});
