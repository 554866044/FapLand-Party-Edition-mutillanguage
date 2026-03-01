import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  search: {
    score: 420,
    highscore: 500,
    survivedDurationSec: 372,
    reason: "finished" as const,
  },
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({
    useSearch: () => mocks.search,
  }),
  useNavigate: () => mocks.navigate,
}));

import { SingleResultRoute } from "./single-result";

describe("SingleResultRoute", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.search = {
      score: 420,
      highscore: 500,
      survivedDurationSec: 372,
      reason: "finished",
    };
  });

  it("renders the survived duration from route search", () => {
    render(<SingleResultRoute />);

    expect(screen.getByText("Survived")).toBeTruthy();
    expect(screen.getByText("6:12")).toBeTruthy();
    expect(screen.getByText("TIME")).toBeTruthy();
  });
});
