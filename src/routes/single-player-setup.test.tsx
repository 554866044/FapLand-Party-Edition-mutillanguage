import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function makePlaylist(id: string, name: string) {
  return {
    id,
    name,
    description: null,
    formatVersion: 1,
    config: {
      playlistVersion: 1,
      boardConfig: {
        mode: "linear" as const,
        totalIndices: 10,
        safePointIndices: [5],
        normalRoundRefsByIndex: {},
        normalRoundOrder: [],
        cumRoundRefs: [],
      },
      perkSelection: {
        optionsPerPick: 3,
        triggerChancePerCompletedRound: 0.35,
      },
      perkPool: {
        enabledPerkIds: [],
        enabledAntiPerkIds: [],
      },
      probabilityScaling: {
        initialIntermediaryProbability: 0,
        initialAntiPerkProbability: 0,
        intermediaryIncreasePerRound: 0.02,
        antiPerkIncreasePerRound: 0.015,
        maxIntermediaryProbability: 1,
        maxAntiPerkProbability: 0.75,
      },
      economy: {
        startingMoney: 120,
        moneyPerCompletedRound: 50,
        startingScore: 0,
        scorePerCompletedRound: 100,
        scorePerIntermediary: 30,
        scorePerActiveAntiPerk: 25,
        scorePerCumRoundSuccess: 420,
      },
    },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

const PLAYLIST_LAUNCH_DURATION_MS = 2500;

const mocks = vi.hoisted(() => ({
  loaderData: {
    availablePlaylists: [] as unknown[],
    activePlaylist: null as unknown,
    installedRounds: [] as unknown[],
  },
  navigate: vi.fn(),
  playlists: {
    setActive: vi.fn(),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({
    useLoaderData: () => mocks.loaderData,
  }),
  useNavigate: () => mocks.navigate,
}));

vi.mock("../components/AnimatedBackground", () => ({
  AnimatedBackground: () => null,
}));

vi.mock("../components/MenuButton", () => ({
  MenuButton: ({ label, onClick }: { label: string; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{label}</button>
  ),
}));

vi.mock("../components/PlaylistMapPreview", () => ({
  PlaylistMapPreview: () => <div data-testid="playlist-preview" />,
}));

vi.mock("../services/playlists", () => ({
  playlists: mocks.playlists,
}));

vi.mock("../utils/audio", () => ({
  playHoverSound: vi.fn(),
  playPlaylistLaunchSound: vi.fn(),
  playSelectSound: vi.fn(),
}));

import { SinglePlayerSetupRoute } from "./single-player-setup";

beforeEach(() => {
  mocks.playlists.setActive.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("SinglePlayerSetupRoute", () => {
  it("shows a go back button in the header and falls back to home navigation", () => {
    mocks.loaderData = {
      availablePlaylists: [],
      activePlaylist: null,
      installedRounds: [],
    };

    render(<SinglePlayerSetupRoute />);
    fireEvent.click(screen.getByRole("button", { name: "Go Back" }));

    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("uses active playlist as default selection when starting", async () => {
    vi.useFakeTimers();
    const first = makePlaylist("playlist-1", "First Playlist");
    const second = makePlaylist("playlist-2", "Second Playlist");
    mocks.loaderData = {
      availablePlaylists: [first, second],
      activePlaylist: second,
      installedRounds: [],
    };

    render(<SinglePlayerSetupRoute />);
    fireEvent.click(screen.getByRole("button", { name: "Start Selected Playlist" }));
    await vi.advanceTimersByTimeAsync(PLAYLIST_LAUNCH_DURATION_MS);
    await Promise.resolve();
    expect(mocks.playlists.setActive).toHaveBeenCalledWith("playlist-2");
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/game",
      search: {
        playlistId: "playlist-2",
        launchNonce: expect.any(Number),
      },
    });
  });

  it("opens workshop with the selected playlist", async () => {
    const first = makePlaylist("playlist-1", "First Playlist");
    const second = makePlaylist("playlist-2", "Second Playlist");
    mocks.loaderData = {
      availablePlaylists: [first, second],
      activePlaylist: first,
      installedRounds: [],
    };

    render(<SinglePlayerSetupRoute />);
    fireEvent.click(screen.getByRole("button", { name: /Second Playlist/i }));
    fireEvent.click(screen.getByRole("button", { name: "Open Playlist Workshop" }));

    await waitFor(() => {
      expect(mocks.playlists.setActive).toHaveBeenCalledWith("playlist-2");
      expect(mocks.navigate).toHaveBeenCalledWith({ to: "/playlist-workshop" });
    });
  });

  it("falls back to active playlist when active is not in list", async () => {
    vi.useFakeTimers();
    const first = makePlaylist("playlist-1", "First Playlist");
    const active = makePlaylist("playlist-active", "Active Playlist");
    mocks.loaderData = {
      availablePlaylists: [first],
      activePlaylist: active,
      installedRounds: [],
    };

    render(<SinglePlayerSetupRoute />);
    expect(screen.getByTestId("playlist-preview")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Start Selected Playlist" }));
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(PLAYLIST_LAUNCH_DURATION_MS);
    await Promise.resolve();
    expect(mocks.playlists.setActive).toHaveBeenCalledWith("playlist-active");
  });

  it("blocks duplicate starts while the launch transition is active", async () => {
    vi.useFakeTimers();
    const playlist = makePlaylist("playlist-1", "First Playlist");
    mocks.loaderData = {
      availablePlaylists: [playlist],
      activePlaylist: playlist,
      installedRounds: [],
    };

    render(<SinglePlayerSetupRoute />);
    const startButton = screen.getByRole("button", { name: "Start Selected Playlist" });

    fireEvent.click(startButton);
    fireEvent.click(startButton);
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(PLAYLIST_LAUNCH_DURATION_MS);
    await Promise.resolve();
    expect(mocks.playlists.setActive).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
  });

  it("clears the launch transition when starting fails", async () => {
    mocks.playlists.setActive.mockRejectedValueOnce(new Error("boom"));
    const playlist = makePlaylist("playlist-1", "First Playlist");
    mocks.loaderData = {
      availablePlaylists: [playlist],
      activePlaylist: playlist,
      installedRounds: [],
    };

    render(<SinglePlayerSetupRoute />);
    fireEvent.click(screen.getByRole("button", { name: "Start Selected Playlist" }));

    await waitFor(() => {
      expect(screen.getByText("Failed to start selected playlist.")).toBeDefined();
    });
    expect(screen.queryByTestId("playlist-launch-transition")).toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("shows an empty state when no playlists exist", () => {
    mocks.loaderData = {
      availablePlaylists: [],
      activePlaylist: null,
      installedRounds: [],
    };

    render(<SinglePlayerSetupRoute />);

    expect(screen.getByText("No Playlist Yet")).toBeDefined();
    expect(screen.getByRole("button", { name: "Open Playlist Workshop" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Open Map Editor" })).toBeDefined();
  });
});
