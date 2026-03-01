import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import * as z from "zod";
import { AnimatedBackground } from "../components/AnimatedBackground";
import { db } from "../services/db";
import {
  buildMultiplayerPlaylistSnapshot,
  createLobby,
  getOptionalActiveMultiplayerServerProfile,
  getPreferredMultiplayerServerProfile,
  isLikelyConfiguredSupabaseServer,
  joinLobby,
  listMultiplayerServerProfiles,
  removeMultiplayerServerProfile,
  resolveMultiplayerAuthStatus,
  saveMultiplayerServerProfile,
  setActiveMultiplayerServerProfile,
  startDiscordMultiplayerLink,
  subscribeToMultiplayerAuthRefresh,
  type MultiplayerAuthStatus,
  type MultiplayerServerProfile,
} from "../services/multiplayer";
import { playlists } from "../services/playlists";
import { playHoverSound, playSelectSound } from "../utils/audio";

const MultiplayerSearchSchema = z.object({
  inviteCode: z.string().optional(),
});

type OnboardingStatus =
  | "provisioning"
  | "ready"
  | "needs_discord"
  | "needs_email"
  | "oauth_unavailable"
  | "error"
  | "unavailable";

export const Route = createFileRoute("/multiplayer")({
  validateSearch: (search) => MultiplayerSearchSchema.parse(search),
  loader: async () => {
    const [availablePlaylists, installedRounds, profiles, activeProfile] = await Promise.all([
      playlists.list(),
      db.round.findInstalled(),
      listMultiplayerServerProfiles(),
      getOptionalActiveMultiplayerServerProfile(),
    ]);
    const activePlaylist = availablePlaylists.length > 0 ? await playlists.getActive() : null;

    return {
      activePlaylist,
      availablePlaylists,
      installedRounds,
      profiles,
      activeProfile,
    };
  },
  component: MultiplayerRoute,
});

function MultiplayerRoute() {
  const navigate = useNavigate();
  const { activePlaylist, availablePlaylists, installedRounds, profiles, activeProfile } = Route.useLoaderData();
  const search = Route.useSearch();
  const bootstrapTokenRef = useRef(0);
  const goBack = () => {
    void navigate({ to: "/" });
  };

  const [serverProfiles, setServerProfiles] = useState<MultiplayerServerProfile[]>(profiles);
  const [selectedServerId, setSelectedServerId] = useState(activeProfile?.id ?? profiles[0]?.id ?? "");
  const [displayName, setDisplayName] = useState<string>(() => localStorage.getItem("fland-multiplayer-username") || "Player");
  const [lobbyName, setLobbyName] = useState("My Lobby");
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(activePlaylist?.id ?? availablePlaylists[0]?.id ?? "");
  const [allowLateJoin, setAllowLateJoin] = useState(true);
  const [inviteCode, setInviteCode] = useState(search.inviteCode ?? "");
  const [joinPending, setJoinPending] = useState(false);
  const [createPending, setCreatePending] = useState(false);
  const [linkPending, setLinkPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newServerName, setNewServerName] = useState("");
  const [newServerUrl, setNewServerUrl] = useState("");
  const [newServerAnonKey, setNewServerAnonKey] = useState("");
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [authStatus, setAuthStatus] = useState<MultiplayerAuthStatus | null>(null);
  const [onboardingStatus, setOnboardingStatus] = useState<OnboardingStatus>("provisioning");
  const [onboardingMessage, setOnboardingMessage] = useState("Preparing multiplayer authentication on the selected server.");
  const [authBootstrapPending, setAuthBootstrapPending] = useState(false);

  useEffect(() => {
    localStorage.setItem("fland-multiplayer-username", displayName);
  }, [displayName]);

  const selectedServer = useMemo(
    () => serverProfiles.find((profile) => profile.id === selectedServerId) ?? activeProfile ?? null,
    [activeProfile, selectedServerId, serverProfiles],
  );
  const editingServer = useMemo(
    () => serverProfiles.find((profile) => profile.id === editingServerId) ?? null,
    [editingServerId, serverProfiles],
  );
  const selectedPlaylist = useMemo(
    () => availablePlaylists.find((playlist: { id: string }) => playlist.id === selectedPlaylistId) ?? activePlaylist ?? null,
    [activePlaylist, availablePlaylists, selectedPlaylistId],
  );
  const serverConfigured = selectedServer ? isLikelyConfiguredSupabaseServer(selectedServer) : false;
  const hasServerProfiles = serverProfiles.length > 0;
  const hasPlayablePlaylist = availablePlaylists.length > 0 && selectedPlaylist !== null;
  const canPlay = onboardingStatus === "ready" && serverConfigured && !authBootstrapPending;
  const selectedServerEndpointLabel = selectedServer
    ? selectedServer.isBuiltIn
      ? "Hidden for built-in server"
      : (selectedServer.url || "No URL configured")
    : "No URL configured";
  const editingBuiltIn = editingServer?.isBuiltIn === true;

  const fieldLabelClass = "flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-300";
  const fieldInputClass = "rounded-2xl border border-white/15 bg-black/35 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-violet-300/60 focus:ring-2 focus:ring-violet-400/25";
  const actionButtonClass = "rounded-xl border px-3 py-2 text-sm font-semibold tracking-wide transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100";
  const panelClass = "animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl";
  const mutedPanelClass = "rounded-2xl border border-violet-300/20 bg-black/30 p-4";

  const reloadServers = async () => {
    const [nextProfiles, nextActive] = await Promise.all([
      listMultiplayerServerProfiles(),
      getOptionalActiveMultiplayerServerProfile(),
    ]);
    setServerProfiles(nextProfiles);
    setSelectedServerId((current: string) => {
      if (current && nextProfiles.some((profile) => profile.id === current)) {
        return current;
      }
      return nextActive?.id ?? nextProfiles[0]?.id ?? "";
    });
    return {
      profiles: nextProfiles,
      activeProfile: nextActive,
    };
  };

  const resetServerEditor = () => {
    setEditingServerId(null);
    setNewServerName("");
    setNewServerUrl("");
    setNewServerAnonKey("");
    setError(null);
  };

  const loadServerIntoEditor = (profile: MultiplayerServerProfile) => {
    if (profile.isBuiltIn) {
      setError("Built-in servers cannot be loaded into the editor.");
      return;
    }
    setEditingServerId(profile.id);
    setNewServerName(profile.name);
    setNewServerUrl(profile.url);
    setNewServerAnonKey(profile.anonKey);
    setError(null);
  };

  const refreshAuth = async (profile: MultiplayerServerProfile | null, options?: { syncActive?: boolean }) => {
    const syncActive = options?.syncActive ?? false;
    const token = ++bootstrapTokenRef.current;

    if (!profile || !isLikelyConfiguredSupabaseServer(profile)) {
      setAuthBootstrapPending(false);
      setAuthStatus(null);
      setOnboardingStatus("unavailable");
      setOnboardingMessage("Online multiplayer is unavailable right now. Retry or use Advanced setup.");
      setAdvancedOpen(true);
      return;
    }

    setAuthBootstrapPending(true);
    setOnboardingStatus("provisioning");
    setOnboardingMessage("Creating or resuming your multiplayer account on the selected server.");

    try {
      if (syncActive) {
        await setActiveMultiplayerServerProfile(profile.id);
      }
      const resolvedStatus = await resolveMultiplayerAuthStatus(profile);
      if (bootstrapTokenRef.current !== token) return;
      setAuthStatus(resolvedStatus);
      setOnboardingStatus(resolvedStatus.status);
      setOnboardingMessage(resolvedStatus.message);
      if (resolvedStatus.status === "oauth_unavailable") {
        setAdvancedOpen(true);
      }
      setError(null);
    } catch (bootstrapError) {
      if (bootstrapTokenRef.current !== token) return;
      setAuthStatus(null);
      setOnboardingStatus("error");
      setOnboardingMessage(bootstrapError instanceof Error
        ? bootstrapError.message
        : "Failed to prepare multiplayer authentication. Retry or use Advanced setup.");
      setAdvancedOpen(true);
    } finally {
      if (bootstrapTokenRef.current === token) {
        setAuthBootstrapPending(false);
      }
    }
  };

  useEffect(() => {
    void (async () => {
      const preferred = await getPreferredMultiplayerServerProfile();
      if (preferred) {
        setSelectedServerId(preferred.id);
      }
      await refreshAuth(preferred, {
        syncActive: Boolean(preferred && preferred.id !== activeProfile?.id && isLikelyConfiguredSupabaseServer(preferred)),
      });
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return subscribeToMultiplayerAuthRefresh(() => {
      void refreshAuth(selectedServer, {
        syncActive: false,
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServerId, serverProfiles]);

  const handleRetryBootstrap = () => {
    void refreshAuth(selectedServer, {
      syncActive: Boolean(selectedServer && selectedServer.id !== activeProfile?.id && serverConfigured),
    });
  };

  const handleLinkDiscord = async () => {
    if (!selectedServer) return;
    setLinkPending(true);
    setError(null);
    try {
      await setActiveMultiplayerServerProfile(selectedServer.id);
      await startDiscordMultiplayerLink(selectedServer);
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : "Failed to start Discord linking.");
    } finally {
      setLinkPending(false);
    }
  };

  const handleCreateLobby = async () => {
    if (!displayName.trim()) {
      setError("Display name is required.");
      return;
    }

    if (!selectedServer || !serverConfigured || onboardingStatus !== "ready") {
      setError("Multiplayer is not ready on this server yet.");
      return;
    }
    if (!selectedPlaylist) {
      setError("Select a playlist before hosting a lobby.");
      return;
    }

    setCreatePending(true);
    setError(null);
    try {
      await setActiveMultiplayerServerProfile(selectedServer.id);
      const snapshot = buildMultiplayerPlaylistSnapshot(selectedPlaylist.config, installedRounds);
      const created = await createLobby({
        name: lobbyName.trim() || "My Lobby",
        playlistSnapshotJson: snapshot,
        displayName: displayName.trim(),
        allowLateJoin,
        serverLabel: selectedServer.name,
      }, selectedServer);

      await navigate({
        to: "/multiplayer-lobby",
        search: {
          lobbyId: created.lobbyId,
          inviteCode: created.inviteCode,
          playerId: created.playerId,
        },
      });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create lobby.");
    } finally {
      setCreatePending(false);
    }
  };

  const handleJoinLobby = async () => {
    if (!displayName.trim()) {
      setError("Display name is required.");
      return;
    }

    if (!inviteCode.trim()) {
      setError("Invite code is required.");
      return;
    }

    if (!selectedServer || !serverConfigured || onboardingStatus !== "ready") {
      setError("Multiplayer is not ready on this server yet.");
      return;
    }

    setJoinPending(true);
    setError(null);
    try {
      await setActiveMultiplayerServerProfile(selectedServer.id);
      const joined = await joinLobby({
        inviteCode: inviteCode.trim().toUpperCase(),
        displayName: displayName.trim(),
      }, selectedServer);

      await navigate({
        to: "/multiplayer-lobby",
        search: {
          lobbyId: joined.lobbyId,
          inviteCode: joined.inviteCode,
          playerId: joined.playerId,
        },
      });
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "Failed to join lobby.");
    } finally {
      setJoinPending(false);
    }
  };

  const badgeClass = onboardingStatus === "ready"
    ? "border-emerald-300/50 bg-emerald-400/15 text-emerald-100"
    : onboardingStatus === "provisioning"
      ? "border-cyan-300/50 bg-cyan-400/15 text-cyan-100"
      : onboardingStatus === "needs_discord" || onboardingStatus === "needs_email"
        ? "border-fuchsia-300/45 bg-fuchsia-400/15 text-fuchsia-100"
        : "border-amber-300/45 bg-amber-400/15 text-amber-100";

  const badgeLabel = onboardingStatus === "ready"
    ? "Ready"
    : onboardingStatus === "provisioning"
      ? "Preparing"
      : onboardingStatus === "needs_discord"
        ? "Link Discord"
        : onboardingStatus === "needs_email"
          ? "Email Required"
          : onboardingStatus === "oauth_unavailable"
            ? "OAuth Unavailable"
            : onboardingStatus === "error"
              ? "Connection Failed"
              : "Unavailable";

  const authModeLabel = authStatus
    ? authStatus.hasDiscordIdentity
      ? "Discord linked"
      : authStatus.isAnonymous
        ? "Anonymous account"
        : "Supabase account"
    : "Unknown";
  const requirementLabel = authStatus
    ? authStatus.requirement === "discord_required"
      ? "This server requires Discord"
      : "This server allows anonymous multiplayer"
    : "Requirement unknown";
  const emailLabel = authStatus
    ? authStatus.requirement === "discord_required"
      ? authStatus.hasEmail
        ? "Discord email confirmed for multiplayer"
        : "Discord account has no email; multiplayer blocked"
      : "Email is not required on this server"
    : "Email check unavailable";
  const readinessHeadline = canPlay
    ? "Ready to join or host"
    : onboardingStatus === "provisioning"
      ? "Preparing your multiplayer account"
      : onboardingStatus === "needs_discord"
        ? "Discord linking required"
        : onboardingStatus === "needs_email"
          ? "Discord account needs an email"
          : "Multiplayer setup needs attention";
  const readinessDetail = canPlay
    ? "Enter a code to join immediately or host a lobby with the current playlist."
    : onboardingMessage;
  const createDisabledReason = !canPlay
    ? authBootstrapPending ? "Finish account setup to host." : "Resolve multiplayer readiness first."
    : !hasPlayablePlaylist
      ? "Create or select a playlist before hosting."
      : null;
  const joinDisabledReason = !canPlay
    ? authBootstrapPending ? "Finish account setup to join." : "Resolve multiplayer readiness first."
    : inviteCode.trim().length === 0
      ? "Paste an invite code to join."
      : null;

  return (
    <div className="relative h-screen overflow-x-hidden overflow-y-auto px-4 py-6 text-zinc-100 sm:px-6 sm:py-8">
      <AnimatedBackground />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.14),transparent_42%),radial-gradient(circle_at_82%_22%,rgba(129,140,248,0.18),transparent_34%),radial-gradient(circle_at_10%_100%,rgba(16,185,129,0.12),transparent_38%)]" />

      <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-5">
        <header className={panelClass}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <button
              type="button"
              onMouseEnter={playHoverSound}
              onClick={() => {
                playSelectSound();
                goBack();
              }}
              className="rounded-xl border border-violet-300/55 bg-violet-500/20 px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] text-violet-100 transition-all duration-200 hover:border-violet-200/80 hover:bg-violet-500/35"
            >
              Go Back
            </button>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  void navigate({ to: "/multiplayer-bans" });
                }}
                className={`${actionButtonClass} border-orange-300/45 bg-orange-400/15 text-orange-100 hover:border-orange-300/70`}
              >
                Host Ban List
              </button>
            </div>
          </div>
          <div className="mt-5">
            <p className="font-[family-name:var(--font-jetbrains-mono)] text-[0.62rem] uppercase tracking-[0.45em] text-purple-200/70">
              Matchmaking
            </p>
            <h1 className="mt-1.5 text-3xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-violet-200 via-purple-100 to-indigo-200 drop-shadow-[0_0_20px_rgba(139,92,246,0.45)] sm:text-4xl">
              Multiplayer
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-zinc-300">
              Join is the default path: set your name once, paste an invite code, and go. Hosting stays one step away when you need it.
            </p>
          </div>
        </header>

        {error && (
          <div className="rounded-2xl border border-rose-400/55 bg-rose-500/12 px-4 py-3 text-sm text-rose-100 backdrop-blur-xl">
            {error}
          </div>
        )}

        <section className={panelClass} data-testid="multiplayer-onboarding-status">
          <div className="grid gap-4 xl:grid-cols-[1.3fr_0.9fr]">
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-200">Quick Start</p>
                  <h2 className="mt-1 text-2xl font-extrabold tracking-tight text-violet-100 sm:text-3xl">
                    {readinessHeadline}
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm text-zinc-300">
                    {readinessDetail}
                  </p>
                </div>
                <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${badgeClass}`}>
                  {badgeLabel}
                </span>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className={mutedPanelClass}>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-400">Server</p>
                  <p className="mt-2 text-sm font-semibold text-zinc-100">{selectedServer?.name ?? "No Server Selected"}</p>
                  <p className="mt-1 text-xs text-zinc-400">{selectedServer?.isBuiltIn ? "Built-in online server" : "Custom endpoint"}</p>
                </div>
                <div className={mutedPanelClass}>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-400">You Join As</p>
                  <p className="mt-2 font-[family-name:var(--font-jetbrains-mono)] text-lg font-bold uppercase tracking-[0.08em] text-cyan-100">
                    {displayName.trim() || "PLAYER"}
                  </p>
                  <p className="mt-1 text-xs text-zinc-400">{authModeLabel}</p>
                </div>
                <div className={mutedPanelClass}>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-400">Round Access</p>
                  <p className="mt-2 text-sm font-semibold text-zinc-100">{requirementLabel}</p>
                  <p className="mt-1 text-xs text-zinc-400">{emailLabel}</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-violet-300/25 bg-black/35 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-violet-200">Player Setup</p>
              <label className={`${fieldLabelClass} mt-4`}>
                Display Name
                <input
                  className={fieldInputClass}
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Player"
                />
              </label>
              <p className="mt-3 text-xs text-zinc-400">
                Set this once. Both join and host use the same identity.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {onboardingStatus === "needs_discord" && (
                  <button
                    type="button"
                    onClick={() => {
                      void handleLinkDiscord();
                    }}
                    disabled={linkPending || authBootstrapPending}
                    className={`${actionButtonClass} border-fuchsia-300/45 bg-fuchsia-500/15 text-fuchsia-100 hover:border-fuchsia-300/70`}
                  >
                    {linkPending ? "Opening Discord..." : "Link Discord"}
                  </button>
                )}
                {(onboardingStatus === "error" || onboardingStatus === "unavailable" || onboardingStatus === "oauth_unavailable") && (
                  <button
                    type="button"
                    onClick={handleRetryBootstrap}
                    className={`${actionButtonClass} border-cyan-300/40 bg-cyan-400/12 text-cyan-100 hover:border-cyan-300/70`}
                  >
                    Retry
                  </button>
                )}
                {(onboardingStatus === "needs_email" || onboardingStatus === "needs_discord") && (
                  <button
                    type="button"
                    onClick={handleRetryBootstrap}
                    disabled={authBootstrapPending}
                    className={`${actionButtonClass} border-cyan-300/40 bg-cyan-400/12 text-cyan-100 hover:border-cyan-300/70`}
                  >
                    Recheck Account
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-5 lg:grid-cols-[1.2fr_0.95fr]">
          <div className={`${panelClass} border-violet-300/30`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-violet-200">Fastest Path</p>
                <h3 className="mt-1 text-2xl font-extrabold tracking-tight text-violet-100">
                  Join Lobby
                </h3>
                <p className="mt-2 text-sm text-zinc-300">
                  Paste the invite code from your host and enter the round on the current server.
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-xs text-zinc-300">
                {authBootstrapPending ? "Working..." : linkPending ? "Redirecting..." : "Idle"}
              </div>
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
              <div>
                <div className="flex flex-col gap-2">
                  <label htmlFor="multiplayer-invite-code" className="text-xs font-bold uppercase tracking-[0.2em] text-violet-300">
                    Invite Code
                  </label>
                  <input
                    id="multiplayer-invite-code"
                    className="rounded-3xl border-2 border-violet-500/50 bg-black/50 px-5 py-4 font-[family-name:var(--font-jetbrains-mono)] text-3xl font-black tracking-[0.2em] text-violet-50 uppercase outline-none transition-all placeholder:text-violet-900/50 focus:border-violet-400 focus:bg-violet-950/40 focus:shadow-[0_0_25px_rgba(139,92,246,0.4)]"
                    value={inviteCode}
                    onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
                    placeholder="CODE"
                  />
                </div>
                <p className="mt-3 text-xs text-zinc-400">
                  Codes are case-insensitive. Lowercase is converted automatically.
                </p>
              </div>

              <div className="grid gap-3">
                <div className={mutedPanelClass}>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-400">Selected Server</p>
                  <p className="mt-2 text-sm font-semibold text-zinc-100">{selectedServer?.name ?? "No Server Selected"}</p>
                  <p className="mt-1 text-xs text-zinc-400 break-all">{selectedServerEndpointLabel}</p>
                </div>
                <div className={mutedPanelClass}>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-400">Before You Join</p>
                  <p className="mt-2 text-sm text-zinc-200">Use the same server as the host and make sure your name is correct.</p>
                </div>
              </div>
            </div>

            <button
              type="button"
              disabled={joinPending || inviteCode.trim().length === 0 || !canPlay}
              className="mt-6 w-full rounded-2xl border border-violet-400/60 bg-gradient-to-r from-violet-600/40 via-fuchsia-600/40 to-indigo-600/40 px-4 py-4 text-base font-black uppercase tracking-[0.15em] text-violet-50 drop-shadow-[0_0_10px_rgba(139,92,246,0.5)] transition-all hover:scale-[1.01] hover:border-violet-300/80 hover:shadow-[0_0_30px_rgba(139,92,246,0.5)] hover:brightness-125 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 disabled:hover:shadow-none active:scale-95"
              onClick={() => {
                void handleJoinLobby();
              }}
            >
              {joinPending ? "Joining..." : authBootstrapPending ? "Preparing Account..." : "Join Lobby"}
            </button>
            {joinDisabledReason && (
              <p className="mt-3 text-xs text-zinc-400">{joinDisabledReason}</p>
            )}
          </div>

          <div className={panelClass}>
            <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-200">Host Your Own</p>
            <h3 className="mt-1 text-2xl font-extrabold tracking-tight text-cyan-100">
              Create Lobby
            </h3>
            <p className="mt-2 text-sm text-zinc-300">
              Start a lobby with the current playlist, then hand the invite code to everyone else.
            </p>

            <label className={`${fieldLabelClass} mt-5`}>
              Lobby Name
              <input
                className={`${fieldInputClass} text-base font-semibold`}
                value={lobbyName}
                onChange={(event) => setLobbyName(event.target.value)}
              />
            </label>

            <label className={`${fieldLabelClass} mt-4`}>
              Playlist
              <select
                className={`${fieldInputClass} font-semibold`}
                value={selectedPlaylistId}
                disabled={!hasPlayablePlaylist}
                onChange={(event) => setSelectedPlaylistId(event.target.value)}
              >
                {!hasPlayablePlaylist && (
                  <option value="">No playlists available</option>
                )}
                {availablePlaylists.map((playlist: { id: string; name: string }) => (
                  <option key={playlist.id} value={playlist.id}>
                    {playlist.name}
                    {playlist.id === activePlaylist?.id ? " (Active)" : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm font-medium tracking-wide text-zinc-200 transition-colors hover:bg-black/60">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-cyan-500/50 bg-black/50 text-cyan-500 focus:ring-cyan-500/50 focus:ring-offset-0"
                checked={allowLateJoin}
                onChange={(event) => setAllowLateJoin(event.target.checked)}
              />
              Allow players to join after match start
            </label>

            {!hasPlayablePlaylist && (
              <p className="mt-3 text-xs text-amber-200">
                Create a playlist in the playlist workshop or map editor before hosting a lobby.
              </p>
            )}

            <button
              type="button"
              disabled={createPending || !hasPlayablePlaylist || !canPlay}
              className="mt-6 w-full rounded-2xl border border-cyan-400/60 bg-gradient-to-r from-cyan-600/40 via-sky-600/40 to-indigo-600/40 px-4 py-4 text-base font-black uppercase tracking-[0.15em] text-cyan-50 drop-shadow-[0_0_10px_rgba(34,211,238,0.5)] transition-all hover:scale-[1.01] hover:border-cyan-300/80 hover:shadow-[0_0_30px_rgba(34,211,238,0.4)] hover:brightness-125 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 disabled:hover:shadow-none active:scale-95"
              onClick={() => {
                void handleCreateLobby();
              }}
            >
              {createPending ? "Initializing..." : authBootstrapPending ? "Preparing Account..." : "Create Lobby"}
            </button>
            {createDisabledReason && (
              <p className="mt-3 text-xs text-zinc-400">{createDisabledReason}</p>
            )}
          </div>
        </section>

        <section className={panelClass}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-purple-200">Advanced</p>
              <h2 className="mt-1 text-lg font-extrabold tracking-tight text-violet-100">
                Servers and Self-Hosted Setup
              </h2>
              <p className="mt-1 text-xs text-zinc-400">
                Keep this closed unless you need a different backend or want to manage custom endpoints.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAdvancedOpen((current) => !current)}
              className={`${actionButtonClass} border-white/20 bg-black/30 hover:border-white/40`}
              aria-expanded={advancedOpen}
            >
              {advancedOpen ? "Hide Advanced" : "Show Advanced"}
            </button>
          </div>

          {advancedOpen && (
            <div className="mt-5 space-y-4">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_1fr]">
                <div className={mutedPanelClass}>
                  <label className={fieldLabelClass}>
                    Active Server
                    <select
                      className={`${fieldInputClass} mt-1`}
                      value={selectedServerId}
                      disabled={!hasServerProfiles}
                      onChange={(event) => {
                        const nextServerId = event.target.value;
                        const nextServer = serverProfiles.find((profile) => profile.id === nextServerId) ?? null;
                        setSelectedServerId(nextServerId);
                        setError(null);
                        void refreshAuth(nextServer, {
                          syncActive: Boolean(nextServer && isLikelyConfiguredSupabaseServer(nextServer)),
                        });
                      }}
                    >
                      {!hasServerProfiles && (
                        <option value="">No servers saved</option>
                      )}
                      {serverProfiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name} {profile.isDefault ? "(Default)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {!selectedServer?.isBuiltIn && (
                      <button
                        type="button"
                        className={`${actionButtonClass} border-cyan-300/40 bg-cyan-400/12 text-cyan-100 hover:border-cyan-300/70`}
                        onClick={() => {
                          if (!selectedServer) return;
                          loadServerIntoEditor(selectedServer);
                        }}
                      >
                        Load Into Editor
                      </button>
                    )}
                    <button
                      type="button"
                      className={`${actionButtonClass} border-sky-300/45 bg-sky-500/15 text-sky-100 hover:border-sky-300/70`}
                      onClick={resetServerEditor}
                    >
                      New Endpoint
                    </button>
                    {!selectedServer?.isDefault && (
                      <button
                        type="button"
                        className={`${actionButtonClass} border-rose-300/45 bg-rose-500/15 text-rose-100 hover:border-rose-300/70`}
                        onClick={() => {
                          void (async () => {
                            try {
                              if (!selectedServer) return;
                              await removeMultiplayerServerProfile(selectedServer.id);
                              const reloaded = await reloadServers();
                              const nextServer = reloaded.activeProfile ?? reloaded.profiles[0] ?? null;
                              await refreshAuth(nextServer, {
                                syncActive: false,
                              });
                            } catch (removeError) {
                              setError(removeError instanceof Error ? removeError.message : "Failed to remove server profile.");
                            }
                          })();
                        }}
                      >
                        Remove Selected
                      </button>
                    )}
                  </div>
                </div>

                <div className={mutedPanelClass}>
                  <p className="text-xs uppercase tracking-[0.15em] text-zinc-300">Selected Endpoint</p>
                  <p className="mt-2 break-all rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-xs text-zinc-200">
                    {selectedServerEndpointLabel}
                  </p>
                  <p className="mt-3 text-xs text-zinc-400">
                    Server name: <span className="text-zinc-200">{selectedServer?.name ?? "None selected"}</span>
                  </p>
                  {selectedServer?.isBuiltIn && (
                    <p className="mt-3 text-xs text-zinc-400">
                      Built-in server credentials stay hidden and cannot be edited.
                    </p>
                  )}
                </div>
              </div>

              <div className={mutedPanelClass}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.15em] text-zinc-300">Endpoint Editor</p>
                    <p className="mt-1 text-xs text-zinc-400">
                      {editingServer
                        ? `Editing ${editingServer.name}`
                        : "Create a new custom multiplayer endpoint."}
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-xs text-zinc-300">
                    {editingBuiltIn ? "Built-in" : editingServer ? "Custom Endpoint" : "New Endpoint"}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <label className={fieldLabelClass}>
                  Server Name
                  <input
                    className={fieldInputClass}
                    value={newServerName}
                    onChange={(event) => setNewServerName(event.target.value)}
                    placeholder="My Private Server"
                  />
                </label>
                <label className={fieldLabelClass}>
                  Supabase URL
                  <input
                    className={fieldInputClass}
                    value={newServerUrl}
                    onChange={(event) => setNewServerUrl(event.target.value)}
                    placeholder="https://project.supabase.co"
                  />
                </label>
                <label className={fieldLabelClass}>
                  Anon Key
                  <input
                    className={fieldInputClass}
                    value={newServerAnonKey}
                    onChange={(event) => setNewServerAnonKey(event.target.value)}
                    placeholder="ey..."
                  />
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`${actionButtonClass} border-emerald-300/45 bg-emerald-500/15 text-emerald-100 hover:border-emerald-300/70`}
                  onClick={() => {
                    void (async () => {
                      try {
                        const saved = await saveMultiplayerServerProfile({
                          id: editingServer?.id,
                          name: newServerName.trim() || "Custom Server",
                          url: newServerUrl.trim(),
                          anonKey: newServerAnonKey.trim(),
                        });
                        const reloaded = await reloadServers();
                        const nextServer = reloaded.profiles.find((profile) => profile.id === saved.id) ?? saved;
                        setEditingServerId(saved.id);
                        setSelectedServerId(saved.id);
                        await refreshAuth(nextServer, {
                          syncActive: isLikelyConfiguredSupabaseServer(nextServer),
                        });
                        setError(null);
                      } catch (saveError) {
                        setError(saveError instanceof Error ? saveError.message : "Failed to save server profile.");
                      }
                    })();
                  }}
                >
                  {editingServer ? "Update Endpoint" : "Save Endpoint"}
                </button>
                <button
                  type="button"
                  className={`${actionButtonClass} border-sky-300/45 bg-sky-500/15 text-sky-100 hover:border-sky-300/70`}
                  onClick={() => {
                    void (async () => {
                      try {
                        const saved = await saveMultiplayerServerProfile({
                          name: newServerName.trim() || "Custom Server",
                          url: newServerUrl.trim(),
                          anonKey: newServerAnonKey.trim(),
                        });
                        await reloadServers();
                        setEditingServerId(saved.id);
                        setSelectedServerId(saved.id);
                        await refreshAuth(saved, {
                          syncActive: isLikelyConfiguredSupabaseServer(saved),
                        });
                        setError(null);
                      } catch (saveError) {
                        setError(saveError instanceof Error ? saveError.message : "Failed to save server profile.");
                      }
                    })();
                  }}
                >
                  Save as New
                </button>
                <button
                  type="button"
                  className={`${actionButtonClass} border-white/20 bg-black/30 hover:border-white/40`}
                  onClick={resetServerEditor}
                >
                  Clear Editor
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
