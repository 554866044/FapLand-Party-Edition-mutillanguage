import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RoundStartTransition } from "./RoundStartTransition";

afterEach(() => {
  cleanup();
});

describe("RoundStartTransition", () => {
  it("renders nothing without a queued round", () => {
    const { container } = render(<RoundStartTransition queuedRound={null} remaining={1.4} duration={2.1} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders normal round labels and countdown", () => {
    const view = render(
      <RoundStartTransition
        queuedRound={{
          fieldId: "field-1",
          nodeId: "node-1",
          roundId: "round-1",
          roundName: "Round One",
          selectionKind: "fixed",
          poolId: null,
          phaseKind: "normal",
          campaignIndex: 0,
        }}
        remaining={1.7}
        duration={2.1}
      />,
    );

    expect(view.getByTestId("round-start-transition")).toBeDefined();
    expect(view.getByText("NORMAL ROUND")).toBeDefined();
    expect(view.getByTestId("cinematic-transition-title").textContent).toBe("Round One");
    expect(view.getByTestId("cinematic-transition-countdown").textContent).toBe("2");
  });

  it("renders cum round labels", () => {
    const view = render(
      <RoundStartTransition
        queuedRound={{
          fieldId: "field-1",
          nodeId: "node-1",
          roundId: "round-1",
          roundName: "Finale",
          selectionKind: "random",
          poolId: "pool-1",
          phaseKind: "cum",
          campaignIndex: 2,
        }}
        remaining={0.4}
        duration={2.1}
      />,
    );

    expect(view.getByText("CUM ROUND")).toBeDefined();
    expect(view.getByTestId("cinematic-transition-countdown").textContent).toBe("1");
  });
});
