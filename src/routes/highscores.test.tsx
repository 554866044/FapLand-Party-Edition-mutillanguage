import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loaderData: {
    localHighscore: 900,
    singleRuns: [
      {
        id: "run-1",
        finishedAt: "2026-03-20T10:00:00.000Z",
        score: 540,
        survivedDurationSec: 812,
        highscoreBefore: 500,
        highscoreAfter: 540,
        wasNewHighscore: true,
        completionReason: "finished",
        playlistId: "playlist-1",
        playlistName: "Default Playlist",
        playlistFormatVersion: 1,
        endingPosition: 100,
        turn: 42,
        createdAt: "2026-03-20T10:00:00.000Z",
      },
      {
        id: "run-2",
        finishedAt: "2026-03-20T09:00:00.000Z",
        score: 320,
        survivedDurationSec: null,
        highscoreBefore: 540,
        highscoreAfter: 540,
        wasNewHighscore: false,
        completionReason: "self_reported_cum",
        playlistId: "playlist-2",
        playlistName: "",
        playlistFormatVersion: 1,
        endingPosition: 74,
        turn: 28,
        createdAt: "2026-03-20T09:00:00.000Z",
      },
    ],
    cachedViews: [],
    initialSyncQueueCount: 0,
  },
  navigate: vi.fn(),
  db: {
    gameProfile: {
      getLocalHighscore: vi.fn().mockResolvedValue(900),
    },
    singlePlayerHistory: {
      listRuns: vi.fn().mockResolvedValue([]),
    },
    multiplayer: {
      listResultSyncLobbies: vi.fn().mockResolvedValue([]),
      listMatchCache: vi.fn().mockResolvedValue([]),
      upsertMatchCache: vi.fn(),
      removeResultSyncLobby: vi.fn(),
      touchResultSyncLobby: vi.fn(),
    },
  },
  multiplayer: {
    listMatchHistory: vi.fn().mockResolvedValue([]),
    getMatchHistoryByLobby: vi.fn(),
    parseHistoryStandings: vi.fn(),
    parseStandingsJson: vi.fn().mockReturnValue([]),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({
    useLoaderData: () => mocks.loaderData,
  }),
  useNavigate: () => mocks.navigate,
}));

vi.mock("../services/db", () => ({
  db: mocks.db,
}));

vi.mock("../services/multiplayer", () => mocks.multiplayer);

vi.mock("../components/AnimatedBackground", () => ({
  AnimatedBackground: () => null,
}));

vi.mock("../components/MenuButton", () => ({
  MenuButton: ({ label, onClick }: { label: string; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{label}</button>
  ),
}));

vi.mock("../utils/audio", () => ({
  resolveAssetUrl: (path: string) => path,
  playHoverSound: vi.fn(),
  playSelectSound: vi.fn(),
}));

class AudioMock {
  volume = 1;
  loop = false;
  play() {
    return Promise.resolve();
  }
  pause() {}
}

import { HighscoresRoute } from "./highscores";

describe("HighscoresRoute", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    vi.stubGlobal("Audio", AudioMock);
  });

  it("renders survived duration for new rows and fallback for legacy rows", () => {
    render(<HighscoresRoute />);
    fireEvent.click(screen.getByRole("button", { name: "Single-Player" }));

    expect(screen.getAllByText(/Survived:/)).toHaveLength(2);
    expect(screen.getByText("13:32")).toBeTruthy();
    expect(screen.getByText("Legacy run")).toBeTruthy();
    expect(screen.getAllByText(/Playlist:/)).toHaveLength(4);
    expect(screen.getByText("Default Playlist")).toBeTruthy();
    expect(screen.getByText("playlist-2")).toBeTruthy();
  });
});
