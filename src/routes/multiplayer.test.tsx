import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loaderData: {
    activePlaylist: {
      id: "playlist-1",
      name: "Playlist One",
      config: { playlistVersion: 1 },
    },
    availablePlaylists: [
      {
        id: "playlist-1",
        name: "Playlist One",
        config: { playlistVersion: 1 },
      },
    ],
    installedRounds: [],
    profiles: [
      {
        id: "default-server",
        name: "F-Land Online",
        url: "https://hosted.supabase.co",
        anonKey: "hosted-key",
        isDefault: true,
        isBuiltIn: true,
        createdAtIso: "2026-03-08T00:00:00.000Z",
        updatedAtIso: "2026-03-08T00:00:00.000Z",
      },
    ],
    activeProfile: {
      id: "default-server",
      name: "F-Land Online",
      url: "https://hosted.supabase.co",
      anonKey: "hosted-key",
      isDefault: true,
      isBuiltIn: true,
      createdAtIso: "2026-03-08T00:00:00.000Z",
      updatedAtIso: "2026-03-08T00:00:00.000Z",
    },
  },
  search: {
    inviteCode: "",
  },
  navigate: vi.fn(),
  resolveMultiplayerAuthStatus: vi.fn(),
  getPreferredMultiplayerServerProfile: vi.fn(),
  getOptionalActiveMultiplayerServerProfile: vi.fn(),
  listMultiplayerServerProfiles: vi.fn(),
  setActiveMultiplayerServerProfile: vi.fn(),
  saveMultiplayerServerProfile: vi.fn(),
  removeMultiplayerServerProfile: vi.fn(),
  joinLobby: vi.fn(),
  createLobby: vi.fn(),
  startDiscordMultiplayerLink: vi.fn(),
  subscribeToMultiplayerAuthRefresh: vi.fn(() => () => {}),
  buildMultiplayerPlaylistSnapshot: vi.fn(() => ({ playlistVersion: 1 })),
  isLikelyConfiguredSupabaseServer: vi.fn((profile: { url: string; anonKey: string }) => profile.url.length > 0 && profile.anonKey.length > 0),
}));

function createAuthStatus(overrides: Record<string, unknown> = {}) {
  return {
    profile: mocks.loaderData.activeProfile,
    client: {},
    user: { id: "user-1", email: null, identities: [] },
    requirement: "anonymous_only",
    isAnonymous: true,
    hasDiscordIdentity: false,
    hasEmail: false,
    discordLinkUrl: null,
    status: "ready",
    message: "This server allows anonymous multiplayer.",
    ...overrides,
  };
}

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useLoaderData: () => mocks.loaderData,
    useSearch: () => mocks.search,
  }),
  useNavigate: () => mocks.navigate,
}));

vi.mock("../components/AnimatedBackground", () => ({
  AnimatedBackground: () => null,
}));

vi.mock("../services/db", () => ({
  db: {
    round: {
      findInstalled: vi.fn(),
    },
  },
}));

vi.mock("../services/multiplayer", () => ({
  buildMultiplayerPlaylistSnapshot: mocks.buildMultiplayerPlaylistSnapshot,
  createLobby: mocks.createLobby,
  getOptionalActiveMultiplayerServerProfile: mocks.getOptionalActiveMultiplayerServerProfile,
  getPreferredMultiplayerServerProfile: mocks.getPreferredMultiplayerServerProfile,
  isLikelyConfiguredSupabaseServer: mocks.isLikelyConfiguredSupabaseServer,
  joinLobby: mocks.joinLobby,
  listMultiplayerServerProfiles: mocks.listMultiplayerServerProfiles,
  removeMultiplayerServerProfile: mocks.removeMultiplayerServerProfile,
  resolveMultiplayerAuthStatus: mocks.resolveMultiplayerAuthStatus,
  saveMultiplayerServerProfile: mocks.saveMultiplayerServerProfile,
  setActiveMultiplayerServerProfile: mocks.setActiveMultiplayerServerProfile,
  startDiscordMultiplayerLink: mocks.startDiscordMultiplayerLink,
  subscribeToMultiplayerAuthRefresh: mocks.subscribeToMultiplayerAuthRefresh,
}));

vi.mock("../services/playlists", () => ({
  playlists: {
    list: vi.fn(),
    getActive: vi.fn(),
  },
}));

vi.mock("../utils/audio", () => ({
  playHoverSound: vi.fn(),
  playSelectSound: vi.fn(),
}));

import { Route } from "./multiplayer";

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.resolveMultiplayerAuthStatus.mockResolvedValue(createAuthStatus());
  mocks.getPreferredMultiplayerServerProfile.mockResolvedValue(mocks.loaderData.activeProfile);
  mocks.getOptionalActiveMultiplayerServerProfile.mockResolvedValue(mocks.loaderData.activeProfile);
  mocks.listMultiplayerServerProfiles.mockResolvedValue(mocks.loaderData.profiles);
  mocks.setActiveMultiplayerServerProfile.mockResolvedValue(mocks.loaderData.activeProfile);
  mocks.saveMultiplayerServerProfile.mockResolvedValue(mocks.loaderData.activeProfile);
  mocks.removeMultiplayerServerProfile.mockResolvedValue(undefined);
  mocks.joinLobby.mockResolvedValue({
    lobbyId: "lobby-1",
    inviteCode: "ABCD",
    playerId: "player-1",
  });
  mocks.createLobby.mockResolvedValue({
    lobbyId: "lobby-1",
    inviteCode: "ABCD",
    playerId: "player-1",
  });
  mocks.startDiscordMultiplayerLink.mockResolvedValue(undefined);
  mocks.subscribeToMultiplayerAuthRefresh.mockReturnValue(() => {});
  mocks.isLikelyConfiguredSupabaseServer.mockImplementation((profile: { url: string; anonKey: string }) => profile.url.length > 0 && profile.anonKey.length > 0);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MultiplayerRoute", () => {
  it("shows a go back button in the header and returns to the main menu", () => {
    const Component = (Route as unknown as { component: () => ReactElement }).component;
    render(<Component />);

    fireEvent.click(screen.getByRole("button", { name: "Go Back" }));

    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("allows anonymous-only servers to play after bootstrap", async () => {
    const Component = (Route as unknown as { component: () => ReactElement }).component;
    render(<Component />);

    await waitFor(() => {
      expect(mocks.resolveMultiplayerAuthStatus).toHaveBeenCalledWith(mocks.loaderData.activeProfile);
      expect(screen.getByText("Ready")).toBeDefined();
      expect(screen.getByText("This server allows anonymous multiplayer")).toBeDefined();
    });

    expect(screen.getByRole("button", { name: "Create Lobby" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "Join Lobby" }).hasAttribute("disabled")).toBe(true);
  });

  it("hides built-in endpoint credentials from the editor", async () => {
    const Component = (Route as unknown as { component: () => ReactElement }).component;
    render(<Component />);

    await waitFor(() => {
      expect(screen.getByText("Ready")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "Show Advanced" }));

    expect(screen.queryByRole("button", { name: "Load Into Editor" })).toBeNull();
    expect(screen.getAllByText("Hidden for built-in server").length).toBeGreaterThan(0);
    expect(screen.getByText("Built-in server credentials stay hidden and cannot be edited.")).toBeDefined();
  });

  it("shows discord linking requirements and blocks play", async () => {
    mocks.resolveMultiplayerAuthStatus.mockResolvedValue(createAuthStatus({
      requirement: "discord_required",
      status: "needs_discord",
      message: "Link a Discord account with email to upgrade this anonymous multiplayer account.",
      discordLinkUrl: "https://discord.example/auth",
    }));

    const Component = (Route as unknown as { component: () => ReactElement }).component;
    render(<Component />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Link Discord" })).toBeDefined();
      expect(screen.getByText("This server requires Discord")).toBeDefined();
    });

    expect(screen.getByRole("button", { name: "Create Lobby" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Join Lobby" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getAllByRole("button", { name: "Link Discord" })[0]!);
    await waitFor(() => {
      expect(mocks.startDiscordMultiplayerLink).toHaveBeenCalledWith(mocks.loaderData.activeProfile);
    });
  });

  it("shows missing email state for linked discord accounts", async () => {
    mocks.resolveMultiplayerAuthStatus.mockResolvedValue(createAuthStatus({
      user: { id: "user-1", email: null, identities: [{ provider: "discord" }] },
      requirement: "discord_required",
      isAnonymous: false,
      hasDiscordIdentity: true,
      hasEmail: false,
      status: "needs_email",
      message: "This Discord-linked account has no email attached. Add an email in Discord and recheck.",
    }));

    const Component = (Route as unknown as { component: () => ReactElement }).component;
    render(<Component />);

    await waitFor(() => {
      expect(screen.getByText("Email Required")).toBeDefined();
      expect(screen.getByText("Discord account has no email; multiplayer blocked")).toBeDefined();
    });
  });

  it("shows unavailable state and opens advanced when no configured server exists", async () => {
    mocks.getPreferredMultiplayerServerProfile.mockResolvedValue({
      ...mocks.loaderData.activeProfile,
      url: "",
      anonKey: "",
    });
    mocks.isLikelyConfiguredSupabaseServer.mockReturnValue(false);

    const Component = (Route as unknown as { component: () => ReactElement }).component;
    render(<Component />);

    await waitFor(() => {
      expect(screen.getByText("Unavailable")).toBeDefined();
      expect(screen.getByRole("button", { name: "Hide Advanced" })).toBeDefined();
    });

    expect(mocks.resolveMultiplayerAuthStatus).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Create Lobby" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows retry after auth failure and retries bootstrap", async () => {
    mocks.resolveMultiplayerAuthStatus
      .mockRejectedValueOnce(new Error("Boom"))
      .mockResolvedValueOnce(createAuthStatus({
        user: { id: "user-1", email: "test@example.com", identities: [{ provider: "discord" }] },
        requirement: "discord_required",
        isAnonymous: false,
        hasDiscordIdentity: true,
        hasEmail: true,
        status: "ready",
        message: "Discord is linked and ready for multiplayer.",
      }));

    const Component = (Route as unknown as { component: () => ReactElement }).component;
    render(<Component />);

    await waitFor(() => {
      expect(screen.getByText("Boom")).toBeDefined();
      expect(screen.getByRole("button", { name: "Retry" })).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(mocks.resolveMultiplayerAuthStatus).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Ready")).toBeDefined();
    });
  });

  it("creates a new custom endpoint without reusing the built-in profile id", async () => {
    const Component = (Route as unknown as { component: () => ReactElement }).component;
    render(<Component />);

    await waitFor(() => {
      expect(screen.getByText("Ready")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "Show Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: "New Endpoint" }));
    fireEvent.change(screen.getByLabelText("Server Name"), { target: { value: "My Server" } });
    fireEvent.change(screen.getByLabelText("Supabase URL"), { target: { value: "https://custom.supabase.co" } });
    fireEvent.change(screen.getByLabelText("Anon Key"), { target: { value: "custom-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Endpoint" }));

    await waitFor(() => {
      expect(mocks.saveMultiplayerServerProfile).toHaveBeenCalledWith({
        id: undefined,
        name: "My Server",
        url: "https://custom.supabase.co",
        anonKey: "custom-key",
      });
    });
  });
});
