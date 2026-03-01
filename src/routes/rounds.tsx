import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatedBackground } from "../components/AnimatedBackground";
import { RoundVideoOverlay } from "../components/game/RoundVideoOverlay";
import type { ActiveRound } from "../game/types";
import { CURRENT_PLAYLIST_VERSION, type PlaylistConfig, type PortableRoundRef } from "../game/playlistSchema";
import { collectPlaylistRefs } from "../game/playlistResolution";
import { resolvePortableRoundRef } from "../game/playlistRuntime";
import { MenuButton } from "../components/MenuButton";
import {
  db,
  type InstallFolderInspectionResult,
  type InstallFolderScanResult,
  type InstallScanStatus,
  type InstalledRound,
  type LegacyReviewedImportResult,
} from "../services/db";
import { playlists, type StoredPlaylist } from "../services/playlists";
import { trpc } from "../services/trpc";
import { importOpenedFile } from "../services/openedFiles";
import { buildRoundRenderRowsWithOptions, type RoundRenderRow } from "./roundRows";
import { usePlayableVideoFallback } from "../hooks/usePlayableVideoFallback";
import { playHoverSound, playSelectSound } from "../utils/audio";
import {
  DEFAULT_ROUND_PROGRESS_BAR_ALWAYS_VISIBLE,
  ROUND_PROGRESS_BAR_ALWAYS_VISIBLE_KEY,
  normalizeRoundProgressBarAlwaysVisible,
} from "../constants/roundVideoOverlaySettings";
import { DEFAULT_INTERMEDIARY_LOADING_PROMPT } from "../constants/booruSettings";

type TypeFilter = "all" | NonNullable<InstalledRound["type"]>;
type ScriptFilter = "all" | "installed" | "missing";
type SortMode = "newest" | "difficulty" | "bpm" | "name";
type GroupMode = "hero" | "playlist";
type EditableRoundType = "Normal" | "Interjection" | "Cum";
type RoundEditDraft = {
  id: string;
  name: string;
  author: string;
  description: string;
  bpm: string;
  difficulty: string;
  startTime: string;
  endTime: string;
  type: EditableRoundType;
};
type HeroEditDraft = {
  id: string;
  name: string;
  author: string;
  description: string;
};
type RoundTemplateRepairState = {
  roundId: string;
  roundName: string;
  installedRoundId: string;
};
type HeroTemplateRepairAssignment = {
  roundId: string;
  roundName: string;
  installedRoundId: string;
};
type HeroTemplateRepairState = {
  heroId: string;
  heroName: string;
  sourceHeroId: string;
  assignments: HeroTemplateRepairAssignment[];
};
type LegacyImportedSlot = NonNullable<LegacyReviewedImportResult["legacyImport"]>["orderedSlots"][number];
type LegacyInspectionSlot = Extract<InstallFolderInspectionResult, { kind: "legacy" }>["legacySlots"][number];
type LegacyImportReviewSlot = LegacyInspectionSlot & {
  selectedAsCheckpoint: boolean;
  excludedFromImport: boolean;
};
type LegacyPlaylistReviewState = {
  folderPath: string;
  slots: LegacyImportReviewSlot[];
  playlistName: string;
  createPlaylist: boolean;
  creating: boolean;
  error: string | null;
};
type InstalledDatabaseExportDialogState = {
  includeResourceUris: boolean;
  acknowledgedUriRisk: boolean;
  result: Awaited<ReturnType<typeof db.install.exportDatabase>> | null;
  error: string | null;
};
type RoundSectionId = "library" | "overview" | "transfer";
type RoundSection = {
  id: RoundSectionId;
  icon: string;
  title: string;
  description: string;
};
const ROUNDS_PAGE_SIZE = 60;
const INTERMEDIARY_LOADING_PROMPT_KEY = "game.intermediary.loadingPrompt";
const INTERMEDIARY_LOADING_DURATION_KEY = "game.intermediary.loadingDurationSec";
const INTERMEDIARY_RETURN_PAUSE_KEY = "game.intermediary.returnPauseSec";
const DEFAULT_INTERMEDIARY_LOADING_DURATION_SEC = 5;
const DEFAULT_INTERMEDIARY_RETURN_PAUSE_SEC = 4;
const ZELDA_INTERMEDIARY_VIDEO_URI_FRAGMENT = "Fugtrup%20Zelda%20x%20Bokoblin.mp4";
const roundNameCollator = new Intl.Collator();
const ROUND_SECTIONS: RoundSection[] = [
  {
    id: "library",
    icon: "📚",
    title: "Library",
    description: "Browse, filter, and edit installed rounds with the main library view front and center.",
  },
  {
    id: "overview",
    icon: "📊",
    title: "Overview",
    description: "See collection health, quick stats, and the fastest paths into the library.",
  },
  {
    id: "transfer",
    icon: "📦",
    title: "Import & Export",
    description: "Install new rounds, import portable files, and manage database exports from one place.",
  },
];

type IndexedRound = {
  round: InstalledRound;
  searchText: string;
  roundType: NonNullable<InstalledRound["type"]>;
  hasScript: boolean;
  createdAtMs: number;
  difficultyValue: number;
  bpmValue: number;
};

type PlaylistMembership = {
  playlistId: string;
  playlistName: string;
};

type SourceHeroOption = {
  heroId: string;
  heroName: string;
  rounds: InstalledRound[];
};

function toLegacyPlaylistConfig(orderedSlots: LegacyImportedSlot[]): PlaylistConfig {
  const safePointIndices: number[] = [];
  const normalRoundRefsByIndex: Record<string, PortableRoundRef> = {};
  orderedSlots.forEach((slot, index) => {
    const position = index + 1;
    if (slot.kind === "checkpoint") {
      safePointIndices.push(position);
      return;
    }
    normalRoundRefsByIndex[String(position)] = slot.ref;
  });

  return {
    playlistVersion: CURRENT_PLAYLIST_VERSION,
    boardConfig: {
      mode: "linear",
      totalIndices: Math.max(1, orderedSlots.length),
      safePointIndices,
      safePointRestMsByIndex: {},
      normalRoundRefsByIndex,
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
      initialIntermediaryProbability: 0.1,
      initialAntiPerkProbability: 0.1,
      intermediaryIncreasePerRound: 0.02,
      antiPerkIncreasePerRound: 0.015,
      maxIntermediaryProbability: 0.85,
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
  };
}

function pickHeroGroupRoundToKeep(rounds: InstalledRound[]): InstalledRound | null {
  if (rounds.length === 0) return null;
  const [first, ...rest] = rounds;
  if (!first) return null;
  return rest.reduce((best, current) => {
    const bestCreated = new Date(best.createdAt).getTime();
    const currentCreated = new Date(current.createdAt).getTime();
    if (currentCreated !== bestCreated) {
      return currentCreated < bestCreated ? current : best;
    }

    return current.id < best.id ? current : best;
  }, first);
}

function toRoundEditDraft(round: InstalledRound): RoundEditDraft {
  return {
    id: round.id,
    name: round.name,
    author: round.author ?? "",
    description: round.description ?? "",
    bpm: round.bpm == null ? "" : `${round.bpm}`,
    difficulty: round.difficulty == null ? "" : `${round.difficulty}`,
    startTime: round.startTime == null ? "" : `${round.startTime}`,
    endTime: round.endTime == null ? "" : `${round.endTime}`,
    type: round.type ?? "Normal",
  };
}

function toHeroEditDraft(round: InstalledRound): HeroEditDraft | null {
  if (!round.heroId || !round.hero) return null;
  return {
    id: round.heroId,
    name: round.hero.name ?? "",
    author: round.hero.author ?? "",
    description: round.hero.description ?? "",
  };
}

function parseOptionalInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return Number.NaN;
  return Math.max(0, Math.round(parsed));
}

function parseOptionalFloat(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return Number.NaN;
  return parsed;
}

function toIndexedRound(round: InstalledRound): IndexedRound {
  return {
    round,
    searchText: [
      round.name,
      round.author ?? "",
      round.hero?.name ?? "",
      round.description ?? "",
    ].join("\n").toLowerCase(),
    roundType: round.type ?? "Normal",
    hasScript: Boolean(round.resources[0]?.funscriptUri),
    createdAtMs: Date.parse(String(round.createdAt)) || 0,
    difficultyValue: round.difficulty ?? 0,
    bpmValue: round.bpm ?? 0,
  };
}

function isTemplateRound(round: InstalledRound): boolean {
  return round.resources.length === 0;
}

const getInstalledRounds = async (includeDisabled = false, includeTemplates = true): Promise<InstalledRound[]> => {
  try {
    return await db.round.findInstalled(includeDisabled, includeTemplates);
  } catch (error) {
    console.error("Error loading installed rounds", error);
    return [];
  }
};

const getAvailablePlaylists = async (): Promise<StoredPlaylist[]> => {
  try {
    return await playlists.list();
  } catch (error) {
    console.error("Error loading playlists", error);
    return [];
  }
};

const getDisabledRoundIds = async (): Promise<Set<string>> => {
  try {
    const ids = await db.round.getDisabledIds();
    return new Set(ids);
  } catch (error) {
    console.error("Error loading disabled round IDs", error);
    return new Set<string>();
  }
};

const getIntermediaryLoadingPrompt = async (): Promise<string> => {
  try {
    const stored = await trpc.store.get.query({ key: INTERMEDIARY_LOADING_PROMPT_KEY });
    if (typeof stored !== "string") return DEFAULT_INTERMEDIARY_LOADING_PROMPT;
    const trimmed = stored.trim();
    return trimmed.length > 0 ? trimmed : DEFAULT_INTERMEDIARY_LOADING_PROMPT;
  } catch (error) {
    console.warn("Failed to read intermediary loading prompt from store", error);
    return DEFAULT_INTERMEDIARY_LOADING_PROMPT;
  }
};

const getIntermediaryLoadingDurationSec = async (): Promise<number> => {
  try {
    const stored = await trpc.store.get.query({ key: INTERMEDIARY_LOADING_DURATION_KEY });
    const parsed = typeof stored === "number" ? stored : Number(stored);
    if (!Number.isFinite(parsed)) return DEFAULT_INTERMEDIARY_LOADING_DURATION_SEC;
    return Math.max(1, Math.min(60, Math.floor(parsed)));
  } catch (error) {
    console.warn("Failed to read intermediary loading duration from store", error);
    return DEFAULT_INTERMEDIARY_LOADING_DURATION_SEC;
  }
};

const getIntermediaryReturnPauseSec = async (): Promise<number> => {
  try {
    const stored = await trpc.store.get.query({ key: INTERMEDIARY_RETURN_PAUSE_KEY });
    const parsed = typeof stored === "number" ? stored : Number(stored);
    if (!Number.isFinite(parsed)) return DEFAULT_INTERMEDIARY_RETURN_PAUSE_SEC;
    return Math.max(0, Math.min(60, Math.floor(parsed)));
  } catch (error) {
    console.warn("Failed to read intermediary return pause from store", error);
    return DEFAULT_INTERMEDIARY_RETURN_PAUSE_SEC;
  }
};

const getRoundProgressBarAlwaysVisible = async (): Promise<boolean> => {
  try {
    const stored = await trpc.store.get.query({ key: ROUND_PROGRESS_BAR_ALWAYS_VISIBLE_KEY });
    return normalizeRoundProgressBarAlwaysVisible(stored);
  } catch (error) {
    console.warn("Failed to read round progress bar visibility from store", error);
    return DEFAULT_ROUND_PROGRESS_BAR_ALWAYS_VISIBLE;
  }
};

export const Route = createFileRoute("/rounds")({
  loader: async () => {
    const [rounds, availablePlaylists, intermediaryLoadingPrompt, intermediaryLoadingDurationSec, intermediaryReturnPauseSec, roundProgressBarAlwaysVisible] =
      await Promise.all([
        getInstalledRounds(),
        getAvailablePlaylists(),
        getIntermediaryLoadingPrompt(),
        getIntermediaryLoadingDurationSec(),
        getIntermediaryReturnPauseSec(),
        getRoundProgressBarAlwaysVisible(),
      ]);
    return {
      rounds,
      availablePlaylists,
      intermediaryLoadingPrompt,
      intermediaryLoadingDurationSec,
      intermediaryReturnPauseSec,
      roundProgressBarAlwaysVisible,
    };
  },
  component: InstalledRoundsPage,
});

export function InstalledRoundsPage() {
  const {
    rounds: initialRounds,
    availablePlaylists: initialPlaylists,
    intermediaryLoadingPrompt,
    intermediaryLoadingDurationSec,
    intermediaryReturnPauseSec,
    roundProgressBarAlwaysVisible,
  } = Route.useLoaderData();
  const [rounds, setRounds] = useState<InstalledRound[]>(initialRounds);
  const [availablePlaylists, setAvailablePlaylists] = useState<StoredPlaylist[]>(initialPlaylists);
  const [showDisabledRounds, setShowDisabledRounds] = useState(false);
  const [disabledRoundIds, setDisabledRoundIds] = useState<Set<string>>(new Set());
  const [isStartingScan, setIsStartingScan] = useState(false);
  const [isExportingDatabase, setIsExportingDatabase] = useState(false);
  const [isOpeningExportFolder, setIsOpeningExportFolder] = useState(false);
  const [scanStatus, setScanStatus] = useState<InstallScanStatus | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [scriptFilter, setScriptFilter] = useState<ScriptFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [groupMode, setGroupMode] = useState<GroupMode>("hero");
  const [expandedHeroGroups, setExpandedHeroGroups] = useState<Record<string, boolean>>({});
  const [activePreviewRound, setActivePreviewRound] = useState<InstalledRound | null>(null);
  const [convertingHeroGroupKey, setConvertingHeroGroupKey] = useState<string | null>(null);
  const [editingRound, setEditingRound] = useState<RoundEditDraft | null>(null);
  const [editingHero, setEditingHero] = useState<HeroEditDraft | null>(null);
  const [repairingTemplateRound, setRepairingTemplateRound] = useState<RoundTemplateRepairState | null>(null);
  const [repairingTemplateHero, setRepairingTemplateHero] = useState<HeroTemplateRepairState | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [showInstallOverlay, setShowInstallOverlay] = useState(false);
  const [isAbortingInstall, setIsAbortingInstall] = useState(false);
  const [legacyPlaylistReview, setLegacyPlaylistReview] = useState<LegacyPlaylistReviewState | null>(null);
  const [exportDialog, setExportDialog] = useState<InstalledDatabaseExportDialogState | null>(null);
  const [visibleCount, setVisibleCount] = useState(ROUNDS_PAGE_SIZE);
  const [activeSectionId, setActiveSectionId] = useState<RoundSectionId>("library");
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const deferredQuery = useDeferredValue(query);
  const goBack = useCallback(() => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    void navigate({ to: "/" });
  }, [navigate]);
  const handleHoverSfx = useCallback(() => {
    playHoverSound();
  }, []);
  const handleSelectSfx = useCallback(() => {
    playSelectSound();
  }, []);
  const activePreview: ActiveRound | null = useMemo(
    () =>
      activePreviewRound
        ? {
            fieldId: "preview-field",
            nodeId: "preview-node",
            roundId: activePreviewRound.id,
            roundName: activePreviewRound.name,
            selectionKind: "fixed",
            poolId: null,
            phaseKind: "normal",
            campaignIndex: 1,
          }
        : null,
    [activePreviewRound],
  );
  const previewInstalledRounds = useMemo(() => {
    if (!activePreviewRound) return [];
    const zeldaPool = rounds.filter((round) => {
      if (round.id === activePreviewRound.id || round.type !== "Interjection") return false;
      const videoUri = round.resources[0]?.videoUri ?? "";
      return videoUri.includes(ZELDA_INTERMEDIARY_VIDEO_URI_FRAGMENT);
    });
    return [activePreviewRound, ...zeldaPool];
  }, [activePreviewRound, rounds]);

  const refreshInstalledRounds = useCallback(async () => {
    const [refreshed, disabledIds] = await Promise.all([
      getInstalledRounds(showDisabledRounds),
      getDisabledRoundIds(),
    ]);
    setRounds(refreshed);
    setDisabledRoundIds(disabledIds);
  }, [showDisabledRounds]);

  const refreshAvailablePlaylists = useCallback(async () => {
    const next = await getAvailablePlaylists();
    setAvailablePlaylists(next);
  }, []);

  useEffect(() => {
    let mounted = true;
    let previousState: InstallScanStatus["state"] | null = null;

    const pollScanStatus = async () => {
      try {
        const status = await db.install.getScanStatus();
        if (!mounted) return;

        setScanStatus(status);

        if (previousState === "running" && status.state !== "running") {
          if (mounted) {
            await refreshInstalledRounds();
          }
        }

        previousState = status.state;
      } catch (error) {
        console.error("Failed to poll install scan status", error);
      }
    };

    void pollScanStatus();
    const interval = window.setInterval(() => {
      void pollScanStatus();
    }, 2000);

    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [refreshInstalledRounds, showDisabledRounds]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const [next, disabledIds] = await Promise.all([getInstalledRounds(showDisabledRounds), getDisabledRoundIds()]);
      if (!mounted) return;
      setRounds(next);
      setDisabledRoundIds(disabledIds);
    })();
    return () => {
      mounted = false;
    };
  }, [showDisabledRounds]);

  const indexedRounds = useMemo(
    () => rounds.map(toIndexedRound),
    [rounds],
  );
  const sortedRoundEntries = useMemo(() => {
    const newest = [...indexedRounds].sort((a, b) => b.createdAtMs - a.createdAtMs);
    const difficulty = [...indexedRounds].sort((a, b) => b.difficultyValue - a.difficultyValue);
    const bpm = [...indexedRounds].sort((a, b) => b.bpmValue - a.bpmValue);
    const name = [...indexedRounds].sort((a, b) => roundNameCollator.compare(a.round.name, b.round.name));

    return { newest, difficulty, bpm, name };
  }, [indexedRounds]);
  const filteredRounds = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase();
    const sortedSource = sortedRoundEntries[sortMode];

    if (normalized.length === 0 && typeFilter === "all" && scriptFilter === "all") {
      return sortedSource.map((entry) => entry.round);
    }

    const result: InstalledRound[] = [];
    for (const entry of sortedSource) {
      if (typeFilter !== "all" && entry.roundType !== typeFilter) {
        continue;
      }
      if (scriptFilter !== "all" && entry.hasScript !== (scriptFilter === "installed")) {
        continue;
      }
      if (normalized.length > 0 && !entry.searchText.includes(normalized)) {
        continue;
      }
      result.push(entry.round);
    }

    return result;
  }, [deferredQuery, scriptFilter, sortMode, sortedRoundEntries, typeFilter]);
  const playlistsByRoundId = useMemo(() => {
    const memberships = new Map<string, PlaylistMembership[]>();

    for (const playlist of availablePlaylists) {
      const seenRoundIds = new Set<string>();
      for (const entry of collectPlaylistRefs(playlist.config)) {
        const resolved = resolvePortableRoundRef(entry.ref, rounds);
        if (!resolved || seenRoundIds.has(resolved.id)) continue;
        seenRoundIds.add(resolved.id);
        const existing = memberships.get(resolved.id);
        const membership = { playlistId: playlist.id, playlistName: playlist.name };
        if (existing) {
          existing.push(membership);
        } else {
          memberships.set(resolved.id, [membership]);
        }
      }
    }

    return memberships;
  }, [availablePlaylists, rounds]);

  const visibleRounds = useMemo(
    () => filteredRounds.slice(0, visibleCount),
    [filteredRounds, visibleCount],
  );
  const activeSection = ROUND_SECTIONS.find((section) => section.id === activeSectionId) ?? ROUND_SECTIONS[0];
  const standaloneRoundCount = useMemo(
    () => rounds.filter((round) => !round.heroId && !round.hero).length,
    [rounds],
  );
  const heroGroupCount = useMemo(() => {
    const groupKeys = new Set<string>();
    rounds.forEach((round) => {
      const heroKey = round.heroId ?? round.hero?.name;
      if (heroKey) {
        groupKeys.add(heroKey);
      }
    });
    return groupKeys.size;
  }, [rounds]);
  const roundsWithScriptCount = useMemo(
    () => rounds.filter((round) => Boolean(round.resources[0]?.funscriptUri)).length,
    [rounds],
  );
  const sourceHeroOptions = useMemo<SourceHeroOption[]>(() => {
    const groups = new Map<string, SourceHeroOption>();
    for (const round of rounds) {
      if (!round.heroId || !round.hero || isTemplateRound(round)) continue;
      const existing = groups.get(round.heroId);
      if (existing) {
        existing.rounds.push(round);
        continue;
      }
      groups.set(round.heroId, {
        heroId: round.heroId,
        heroName: round.hero.name,
        rounds: [round],
      });
    }
    return [...groups.values()].sort((a, b) => a.heroName.localeCompare(b.heroName));
  }, [rounds]);
  const hasActiveFilters = query.trim().length > 0 || typeFilter !== "all" || scriptFilter !== "all";
  const activeFilterCount = Number(query.trim().length > 0) + Number(typeFilter !== "all") + Number(scriptFilter !== "all");
  const actionButtonsDisabled = isStartingScan || isExportingDatabase || isOpeningExportFolder || scanStatus?.state === "running";
  const scanRunning = isStartingScan || scanStatus?.state === "running";
  const sortModeLabel =
    sortMode === "difficulty" ? "Difficulty" : sortMode === "bpm" ? "BPM" : sortMode === "name" ? "Name" : "Newest";
  const groupModeLabel = groupMode === "playlist" ? "Playlist" : "Hero";
  const highestVisibleDifficulty = useMemo(
    () => visibleRounds.reduce((max, round) => Math.max(max, round.difficulty ?? 0), 0),
    [visibleRounds],
  );
  const renderRows = useMemo(
    () => buildRoundRenderRowsWithOptions(
      visibleRounds,
      groupMode === "playlist"
        ? { mode: "playlist", playlistsByRoundId: playlistsByRoundId }
        : { mode: "hero" },
    ),
    [groupMode, playlistsByRoundId, visibleRounds],
  );
  const visibleGroupKeys = useMemo(
    () =>
      renderRows
        .filter((row): row is Extract<RoundRenderRow, { kind: "hero-group" | "playlist-group" }> => row.kind !== "standalone")
        .map((row) => row.groupKey),
    [renderRows],
  );
  const allVisibleGroupsExpanded =
    visibleGroupKeys.length > 0 && visibleGroupKeys.every((groupKey) => Boolean(expandedHeroGroups[groupKey]));
  const handleConvertRoundToHero = useCallback((round: InstalledRound) => {
    handleSelectSfx();
    void navigate({
      to: "/converter",
      search: {
        sourceRoundId: round.id,
        heroName: round.name,
      },
    });
  }, [handleSelectSfx, navigate]);
  const handlePlayRound = useCallback((round: InstalledRound) => {
    handleSelectSfx();
    setActivePreviewRound(round);
  }, [handleSelectSfx]);
  const handleEditRound = useCallback((round: InstalledRound) => {
    handleSelectSfx();
    setEditingRound(toRoundEditDraft(round));
  }, [handleSelectSfx]);

  useEffect(() => {
    setVisibleCount(ROUNDS_PAGE_SIZE);
  }, [filteredRounds]);

  useEffect(() => {
    const visibleSet = new Set(visibleGroupKeys);
    setExpandedHeroGroups((previous) => {
      const nextEntries = Object.entries(previous).filter(([key]) => visibleSet.has(key));
      if (nextEntries.length === Object.keys(previous).length) {
        return previous;
      }
      return Object.fromEntries(nextEntries);
    });
  }, [visibleGroupKeys]);

  useEffect(() => {
    const target = loadMoreRef.current;
    const hasMore = filteredRounds.length > visibleCount;
    if (!target || !hasMore) return;

    if (typeof IntersectionObserver === "undefined") {
      setVisibleCount((current) => Math.min(filteredRounds.length, current + ROUNDS_PAGE_SIZE));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisibleCount((current) => Math.min(filteredRounds.length, current + ROUNDS_PAGE_SIZE));
      },
      { root: null, rootMargin: "400px 0px", threshold: 0.01 },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [filteredRounds.length, visibleCount]);

  const scanNow = async () => {
    if (isStartingScan || scanStatus?.state === "running") return;
    setIsStartingScan(true);
    try {
      const status = await db.install.scanNow();
      setScanStatus(status);
      await refreshInstalledRounds();
    } catch (error) {
      console.error("Failed to scan install folders", error);
    } finally {
      setIsStartingScan(false);
    }
  };

  const createLegacyPlaylistFromImport = useCallback(async (result: InstallFolderScanResult, playlistName: string) => {
    if (!result.legacyImport || result.legacyImport.orderedSlots.length === 0) return;
    const created = await playlists.create({
      name: playlistName,
      config: toLegacyPlaylistConfig(result.legacyImport.orderedSlots),
    });
    await playlists.setActive(created.id);
    await refreshAvailablePlaylists();
  }, [refreshAvailablePlaylists]);

  const installRoundsFromFolder = async () => {
    if (isStartingScan || scanStatus?.state === "running") return;

    try {
      const selectedFolders = await window.electronAPI.dialog.selectFolders();
      const folderPath = selectedFolders[0];
      if (!folderPath) return;

      setIsStartingScan(true);
      setIsAbortingInstall(false);
      setLegacyPlaylistReview(null);
      const inspection = await db.install.inspectFolder(folderPath);
      if (inspection.kind === "empty") {
        window.alert("No supported video files found in selected folder.");
        return;
      }

      if (inspection.kind === "legacy") {
        setLegacyPlaylistReview({
          folderPath: inspection.folderPath,
          playlistName: inspection.playlistNameHint.trim() || "Legacy Playlist",
          createPlaylist: true,
          creating: false,
          error: null,
          slots: inspection.legacySlots.map((slot) => ({
            ...slot,
            selectedAsCheckpoint: slot.defaultCheckpoint,
            excludedFromImport: false,
          })),
        });
        return;
      }

      setShowInstallOverlay(true);
      const result = await db.install.scanFolderOnce(inspection.folderPath, true);
      setScanStatus(result.status);
      await refreshInstalledRounds();
    } catch (error) {
      console.error("Failed to install rounds from selected folder", error);
    } finally {
      setShowInstallOverlay(false);
      setIsAbortingInstall(false);
      setIsStartingScan(false);
    }
  };

  const importRoundsFromFile = async () => {
    if (isStartingScan || isExportingDatabase || scanStatus?.state === "running") return;

    try {
      const filePath = await window.electronAPI.dialog.selectInstallImportFile();
      if (!filePath) return;

      setIsStartingScan(true);
      setIsAbortingInstall(false);
      setLegacyPlaylistReview(null);
      setShowInstallOverlay(true);

      const result = await importOpenedFile(filePath);
      if (result.kind === "sidecar") {
        setScanStatus(result.result.status);
        await refreshInstalledRounds();
        return;
      }

      if (result.kind === "playlist") {
        await refreshAvailablePlaylists();
        await navigate({ to: "/playlist-workshop" });
      }
    } catch (error) {
      console.error("Failed to import selected file", error);
    } finally {
      setShowInstallOverlay(false);
      setIsAbortingInstall(false);
      setIsStartingScan(false);
    }
  };

  const abortInstallImport = async () => {
    if (!showInstallOverlay || isAbortingInstall) return;

    setIsAbortingInstall(true);
    try {
      const status = await db.install.abortScan();
      setScanStatus(status);
    } catch (error) {
      console.error("Failed to abort round import", error);
      setIsAbortingInstall(false);
    }
  };

  const dismissLegacyPlaylistReview = () => {
    if (legacyPlaylistReview?.creating) return;
    setLegacyPlaylistReview(null);
  };

  const toggleLegacyCheckpointSelection = (slotId: string) => {
    setLegacyPlaylistReview((current) =>
      current
        ? {
            ...current,
            error: null,
            slots: current.slots.map((slot) =>
              slot.id === slotId ? { ...slot, selectedAsCheckpoint: !slot.selectedAsCheckpoint } : slot),
          }
        : null,
    );
  };

  const toggleLegacyImportExclusion = (slotId: string) => {
    setLegacyPlaylistReview((current) =>
      current
        ? {
            ...current,
            error: null,
            slots: current.slots.map((slot) =>
              slot.id === slotId ? { ...slot, excludedFromImport: !slot.excludedFromImport } : slot),
          }
        : null,
    );
  };

  const createLegacyPlaylist = async () => {
    if (!legacyPlaylistReview || legacyPlaylistReview.creating) return;

    const playlistName = legacyPlaylistReview.playlistName.trim() || "Legacy Playlist";
    const shouldCreatePlaylist = legacyPlaylistReview.createPlaylist;
    setLegacyPlaylistReview((current) =>
      current
        ? {
            ...current,
            playlistName,
            creating: true,
            error: null,
          }
        : null,
    );

    try {
      setShowInstallOverlay(true);
      setIsAbortingInstall(false);
      const result = await db.install.importLegacyWithPlan(
        legacyPlaylistReview.folderPath,
        legacyPlaylistReview.slots.map((slot) => ({
          id: slot.id,
          sourcePath: slot.sourcePath,
          originalOrder: slot.originalOrder,
          selectedAsCheckpoint: slot.selectedAsCheckpoint,
          excludedFromImport: slot.excludedFromImport,
        })),
      );
      setScanStatus(result.status);
      await refreshInstalledRounds();
      if (result.status.state !== "done" || !result.legacyImport) {
        setLegacyPlaylistReview((current) =>
          current
            ? {
                ...current,
                creating: false,
                error: result.status.lastMessage ?? "Legacy import did not finish.",
              }
            : null,
        );
        return;
      }
      if (shouldCreatePlaylist) {
        await createLegacyPlaylistFromImport({
          status: result.status,
          legacyImport: result.legacyImport,
        }, playlistName);
      }
      setLegacyPlaylistReview(null);
    } catch (error) {
      setLegacyPlaylistReview((current) =>
        current
          ? {
              ...current,
              creating: false,
              error: error instanceof Error ? error.message : "Failed to create legacy playlist.",
            }
          : null,
      );
    } finally {
      setShowInstallOverlay(false);
      setIsAbortingInstall(false);
    }
  };

  const openExportDatabaseDialog = () => {
    if (isExportingDatabase || isStartingScan || scanStatus?.state === "running") return;
    setExportDialog({
      includeResourceUris: false,
      acknowledgedUriRisk: false,
      result: null,
      error: null,
    });
  };

  const exportInstalledDatabase = async () => {
    if (!exportDialog || isExportingDatabase || isStartingScan || scanStatus?.state === "running") return;
    if (exportDialog.includeResourceUris && !exportDialog.acknowledgedUriRisk) {
      setExportDialog((current) =>
        current
          ? {
              ...current,
              error: "Advanced export requires confirming that remote resource URIs are intentional.",
            }
          : current,
      );
      return;
    }

    setIsExportingDatabase(true);
    try {
      const result = await db.install.exportDatabase(exportDialog.includeResourceUris);
      setExportDialog((current) =>
        current
          ? {
              ...current,
              result,
              error: null,
            }
          : current,
      );
    } catch (error) {
      console.error("Failed to export installed database", error);
      setExportDialog((current) =>
        current
          ? {
              ...current,
              error: error instanceof Error ? error.message : "Failed to export installed database.",
            }
          : current,
      );
    } finally {
      setIsExportingDatabase(false);
    }
  };

  const openInstallExportFolder = async () => {
    if (isOpeningExportFolder || isStartingScan || isExportingDatabase || scanStatus?.state === "running") return;

    setIsOpeningExportFolder(true);
    try {
      await db.install.openExportFolder();
    } catch (error) {
      console.error("Failed to open install export folder", error);
      window.alert(error instanceof Error ? error.message : "Failed to open install export folder.");
    } finally {
      setIsOpeningExportFolder(false);
    }
  };

  const convertHeroGroupToRound = async (group: Extract<RoundRenderRow, { kind: "hero-group" }>) => {
    const roundToKeep = pickHeroGroupRoundToKeep(group.rounds);
    if (!roundToKeep) return;

    const roundsToDeleteCount = Math.max(0, group.rounds.length - 1);
    const firstWarning = window.confirm(
      `Convert "${group.heroName}" back to a standalone round?\n\n` +
        `This will keep "${roundToKeep.name}" and permanently delete ${roundsToDeleteCount} attached round(s).`,
    );
    if (!firstWarning) return;

    const typedConfirmation = window.prompt(
      `Type "${group.heroName}" to confirm this destructive action.`,
      "",
    );
    if (typedConfirmation === null) return;
    if (typedConfirmation.trim() !== group.heroName) {
      window.alert("Confirmation text did not match. No changes were made.");
      return;
    }

    const finalWarning = window.confirm(
      "Final confirmation: this cannot be undone in-app. Continue?",
    );
    if (!finalWarning) return;

    setConvertingHeroGroupKey(group.groupKey);
    try {
      await db.round.convertHeroGroupToRound({
        keepRoundId: roundToKeep.id,
        roundIds: group.rounds.map((round) => round.id),
        heroId: group.rounds[0]?.heroId ?? null,
        roundName: group.heroName,
      });
      await refreshInstalledRounds();
    } catch (error) {
      console.error("Failed to convert hero group back to a round", error);
      window.alert(error instanceof Error ? error.message : "Failed to convert hero group back to a round.");
    } finally {
      setConvertingHeroGroupKey(null);
    }
  };

  const saveRoundEdit = async () => {
    if (!editingRound || isSavingEdit) return;

    const bpm = parseOptionalFloat(editingRound.bpm);
    const difficulty = parseOptionalInteger(editingRound.difficulty);
    const startTime = parseOptionalInteger(editingRound.startTime);
    const endTime = parseOptionalInteger(editingRound.endTime);
    if ([bpm, difficulty, startTime, endTime].some((value) => Number.isNaN(value))) {
      window.alert("Round fields must use valid numeric values.");
      return;
    }

    setIsSavingEdit(true);
    try {
      await db.round.update({
        id: editingRound.id,
        name: editingRound.name,
        author: editingRound.author,
        description: editingRound.description,
        bpm,
        difficulty,
        startTime,
        endTime,
        type: editingRound.type,
      });
      setEditingRound(null);
      await refreshInstalledRounds();
    } catch (error) {
      console.error("Failed to update round", error);
      window.alert(error instanceof Error ? error.message : "Failed to update round.");
    } finally {
      setIsSavingEdit(false);
    }
  };

  const saveHeroEdit = async () => {
    if (!editingHero || isSavingEdit) return;

    setIsSavingEdit(true);
    try {
      await db.hero.update({
        id: editingHero.id,
        name: editingHero.name,
        author: editingHero.author,
        description: editingHero.description,
      });
      setEditingHero(null);
      await refreshInstalledRounds();
    } catch (error) {
      console.error("Failed to update hero", error);
      window.alert(error instanceof Error ? error.message : "Failed to update hero.");
    } finally {
      setIsSavingEdit(false);
    }
  };

  const deleteRoundEntry = async () => {
    if (!editingRound || isSavingEdit) return;

    const confirmed = window.confirm(
      `Delete round entry "${editingRound.name}" from the database?\n\n` +
        "This removes only the database entry. Files on disk will be left untouched.",
    );
    if (!confirmed) return;

    setIsSavingEdit(true);
    try {
      await db.round.delete(editingRound.id);
      setEditingRound(null);
      await refreshInstalledRounds();
    } catch (error) {
      console.error("Failed to delete round", error);
      window.alert(error instanceof Error ? error.message : "Failed to delete round.");
    } finally {
      setIsSavingEdit(false);
    }
  };

  const deleteHeroEntry = async () => {
    if (!editingHero || isSavingEdit) return;

    const confirmed = window.confirm(
      `Delete hero entry "${editingHero.name}" from the database?\n\n` +
        "This removes only the hero database entry. Files on disk will be left untouched, and attached rounds will remain installed.",
    );
    if (!confirmed) return;

    setIsSavingEdit(true);
    try {
      await db.hero.delete(editingHero.id);
      setEditingHero(null);
      await refreshInstalledRounds();
    } catch (error) {
      console.error("Failed to delete hero", error);
      window.alert(error instanceof Error ? error.message : "Failed to delete hero.");
    } finally {
      setIsSavingEdit(false);
    }
  };

  const retryTemplateLinkingForRound = async (round: InstalledRound) => {
    if (isSavingEdit) return;
    setIsSavingEdit(true);
    try {
      await db.round.retryTemplateLinking({ roundId: round.id });
      await refreshInstalledRounds();
    } catch (error) {
      console.error("Failed to retry template round linking", error);
      window.alert(error instanceof Error ? error.message : "Failed to retry template round linking.");
    } finally {
      setIsSavingEdit(false);
    }
  };

  const retryTemplateLinkingForHero = async (heroId: string) => {
    if (isSavingEdit) return;
    setIsSavingEdit(true);
    try {
      await db.template.retryLinking({ heroId });
      await refreshInstalledRounds();
    } catch (error) {
      console.error("Failed to retry template hero linking", error);
      window.alert(error instanceof Error ? error.message : "Failed to retry template hero linking.");
    } finally {
      setIsSavingEdit(false);
    }
  };

  const saveRoundTemplateRepair = async () => {
    if (!repairingTemplateRound || isSavingEdit) return;
    if (!repairingTemplateRound.installedRoundId) {
      window.alert("Select an installed round to repair this template.");
      return;
    }
    setIsSavingEdit(true);
    try {
      await db.round.repairTemplate({
        roundId: repairingTemplateRound.roundId,
        installedRoundId: repairingTemplateRound.installedRoundId,
      });
      setRepairingTemplateRound(null);
      await refreshInstalledRounds();
    } catch (error) {
      console.error("Failed to repair template round", error);
      window.alert(error instanceof Error ? error.message : "Failed to repair template round.");
    } finally {
      setIsSavingEdit(false);
    }
  };

  const applySourceHeroToRepairDraft = (sourceHeroId: string) => {
    const sourceHero = sourceHeroOptions.find((entry) => entry.heroId === sourceHeroId);
    setRepairingTemplateHero((current) => {
      if (!current) return current;
      const remaining = [...(sourceHero?.rounds ?? [])];
      const nextAssignments = current.assignments.map((assignment) => {
        const exactNameIndex = remaining.findIndex((candidate) => candidate.name === assignment.roundName);
        const matched = exactNameIndex >= 0
          ? remaining.splice(exactNameIndex, 1)[0]
          : remaining.shift();
        return {
          ...assignment,
          installedRoundId: matched?.id ?? "",
        };
      });
      return {
        ...current,
        sourceHeroId,
        assignments: nextAssignments,
      };
    });
  };

  const saveHeroTemplateRepair = async () => {
    if (!repairingTemplateHero || isSavingEdit) return;
    if (!repairingTemplateHero.sourceHeroId) {
      window.alert("Select a source hero first.");
      return;
    }
    if (repairingTemplateHero.assignments.some((assignment) => !assignment.installedRoundId)) {
      window.alert("Assign every unresolved hero round before saving.");
      return;
    }
    setIsSavingEdit(true);
    try {
      await db.template.repairHero({
        heroId: repairingTemplateHero.heroId,
        sourceHeroId: repairingTemplateHero.sourceHeroId,
        assignments: repairingTemplateHero.assignments.map((assignment) => ({
          roundId: assignment.roundId,
          installedRoundId: assignment.installedRoundId,
        })),
      });
      setRepairingTemplateHero(null);
      await refreshInstalledRounds();
    } catch (error) {
      console.error("Failed to repair template hero", error);
      window.alert(error instanceof Error ? error.message : "Failed to repair template hero.");
    } finally {
      setIsSavingEdit(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <AnimatedBackground />

      <div className="relative z-10 flex h-screen flex-col overflow-hidden lg:flex-row">
        <nav className="animate-entrance flex shrink-0 flex-row gap-1 overflow-x-auto border-b border-purple-400/20 bg-zinc-950/70 px-3 py-2 backdrop-blur-xl lg:w-64 lg:flex-col lg:gap-0.5 lg:overflow-x-visible lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-3 lg:py-6">
          <div className="hidden lg:mb-5 lg:block lg:px-3">
            <p className="font-[family-name:var(--font-jetbrains-mono)] text-[0.6rem] uppercase tracking-[0.45em] text-purple-200/70">
              Round Vault
            </p>
            <h1 className="mt-1.5 text-xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-violet-200 via-purple-100 to-indigo-200 drop-shadow-[0_0_20px_rgba(139,92,246,0.45)]">
              Installed Rounds
            </h1>
            <p className="mt-2 text-sm text-zinc-400">
              Manage imports, hero groups, and exports with the same focused shell as the new settings screen.
            </p>
          </div>

          {ROUND_SECTIONS.map((section) => {
            const active = section.id === activeSectionId;
            return (
              <button
                key={section.id}
                type="button"
                aria-current={active ? "page" : undefined}
                onMouseEnter={handleHoverSfx}
                onFocus={handleHoverSfx}
                onClick={() => {
                  handleSelectSfx();
                  setActiveSectionId(section.id);
                }}
                className={`settings-sidebar-item whitespace-nowrap ${active ? "is-active" : ""}`}
              >
                <span aria-hidden="true" className="settings-sidebar-icon">{section.icon}</span>
                <span>{section.title}</span>
              </button>
            );
          })}

          <div className="min-w-0 shrink-0 rounded-2xl border border-purple-400/20 bg-black/25 p-2 lg:mt-4">
            <p className="px-2 pb-2 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.24em] text-zinc-400">
              Library Grouping
            </p>
            <div className="flex gap-1 lg:flex-col">
              {[
                { value: "hero", label: "Heroes" },
                { value: "playlist", label: "Playlists" },
              ].map((option) => {
                const active = groupMode === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onMouseEnter={handleHoverSfx}
                    onFocus={handleHoverSfx}
                    onClick={() => {
                      handleSelectSfx();
                      setGroupMode(option.value as GroupMode);
                    }}
                    className={`rounded-xl px-3 py-2 text-left font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] transition-all duration-200 ${
                      active
                        ? "border border-cyan-300/45 bg-cyan-500/18 text-cyan-100"
                        : "border border-transparent bg-zinc-900/55 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="hidden lg:mt-auto lg:block lg:px-1 lg:pt-4">
            <MenuButton
              label="← Back"
              onHover={handleHoverSfx}
              onClick={() => {
                handleSelectSfx();
                goBack();
              }}
            />
          </div>
        </nav>

        <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8 lg:px-10 lg:py-8">
          <main className="parallax-ui-none mx-auto flex w-full max-w-6xl flex-col gap-5">
            <header className="settings-panel-enter mb-1">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.34em] text-violet-200/75">
                    Installed Rounds
                  </p>
                  <h2 className="mt-2 text-3xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-violet-200 via-purple-100 to-indigo-200 drop-shadow-[0_0_20px_rgba(139,92,246,0.4)] sm:text-4xl">
                    {activeSection.title}
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm text-zinc-400">{activeSection.description}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="rounded-xl border border-violet-200/30 bg-violet-400/10 px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.3em] text-violet-100">
                    {filteredRounds.length} / {rounds.length} Visible
                  </div>
                  {scanStatus ? (
                    <InstallScanStatusBadge status={scanStatus} />
                  ) : (
                    <div className="rounded-xl border border-emerald-300/30 bg-emerald-500/10 px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.24em] text-emerald-100">
                      Library Idle
                    </div>
                  )}
                </div>
              </div>
            </header>

            <div className="settings-panel-enter flex flex-col gap-5" key={`content-${activeSection.id}`}>
              {activeSection.id === "library" && (
                <>
                  <section
                    className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
                    style={{ animationDelay: "0.05s" }}
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h3 className="text-lg font-extrabold tracking-tight text-violet-100">Library Snapshot</h3>
                        <p className="mt-1 text-sm text-zinc-300">
                          Keep the main browsing tools, collection health, and import actions in one place.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <RoundActionButton
                          label="Install Rounds"
                          tone="violet"
                          disabled={actionButtonsDisabled}
                          onHover={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            void installRoundsFromFolder();
                          }}
                        />
                        <RoundActionButton
                          label="Import File"
                          tone="emerald"
                          disabled={actionButtonsDisabled}
                          onHover={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            void importRoundsFromFile();
                          }}
                        />
                        <RoundActionButton
                          label={isExportingDatabase ? "Exporting..." : "Export Database"}
                          tone="cyan"
                          disabled={actionButtonsDisabled}
                          onHover={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            openExportDatabaseDialog();
                          }}
                        />
                        <RoundActionButton
                          label={isOpeningExportFolder ? "Opening..." : "Open Export Folder"}
                          tone="sky"
                          disabled={actionButtonsDisabled}
                          onHover={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            void openInstallExportFolder();
                          }}
                        />
                      </div>
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <LibraryStatCard
                        label="Standalone"
                        value={standaloneRoundCount}
                        description="Rounds not attached to a hero group."
                        tone="violet"
                      />
                      <LibraryStatCard
                        label="Hero Groups"
                        value={heroGroupCount}
                        description="Grouped sets that can be expanded or edited together."
                        tone="pink"
                      />
                      <LibraryStatCard
                        label="Scripts Ready"
                        value={roundsWithScriptCount}
                        description={`${Math.max(0, rounds.length - roundsWithScriptCount)} still missing funscripts.`}
                        tone="emerald"
                      />
                      <LibraryStatCard
                        label="Disabled"
                        value={disabledRoundIds.size}
                        description={showDisabledRounds ? "Disabled imports are visible in results." : "Turn on disabled imports to review hidden entries."}
                        tone="amber"
                      />
                    </div>
                  </section>

                  <section
                    className="relative z-40 animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
                    style={{ animationDelay: "0.08s" }}
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h3 className="text-lg font-extrabold tracking-tight text-violet-100">Search & Filter</h3>
                        <p className="mt-1 text-sm text-zinc-300">
                          Narrow the collection by round type, script availability, or a text search across round metadata.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-black/30 px-3 py-2 text-xs uppercase tracking-[0.18em] text-zinc-300">
                          <input
                            type="checkbox"
                            checked={showDisabledRounds}
                            onChange={(event) => setShowDisabledRounds(event.target.checked)}
                          />
                          Show Disabled Imports
                        </label>
                        <button
                          type="button"
                          onMouseEnter={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            setQuery("");
                            setTypeFilter("all");
                            setScriptFilter("all");
                            setSortMode("newest");
                          }}
                          disabled={!hasActiveFilters}
                          className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.18em] transition-all duration-200 ${
                            hasActiveFilters
                              ? "border-violet-300/50 bg-violet-500/15 text-violet-100 hover:border-violet-200/75 hover:bg-violet-500/25"
                              : "cursor-not-allowed border-zinc-700 bg-zinc-900/70 text-zinc-500"
                          }`}
                        >
                          Clear Filters
                        </button>
                      </div>
                    </div>

                    <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-5">
                      <label className="lg:col-span-2">
                        <span className="mb-2 block font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.25em] text-zinc-300">Search</span>
                        <input
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                          onFocus={handleHoverSfx}
                          onMouseEnter={handleHoverSfx}
                          placeholder="Search title, hero, author"
                          className="w-full rounded-xl border border-purple-300/30 bg-black/45 px-4 py-3 text-sm text-zinc-100 outline-none transition-all duration-200 focus:border-purple-300/75 focus:ring-2 focus:ring-purple-400/30"
                        />
                      </label>

                      <GameDropdown
                        label="Type"
                        value={typeFilter}
                        options={[
                          { value: "all", label: "All" },
                          { value: "Normal", label: "Normal" },
                          { value: "Interjection", label: "Interjection" },
                          { value: "Cum", label: "Cum" },
                        ]}
                        onChange={setTypeFilter}
                        onHoverSfx={handleHoverSfx}
                        onSelectSfx={handleSelectSfx}
                      />

                      <GameDropdown
                        label="Script"
                        value={scriptFilter}
                        options={[
                          { value: "all", label: "All" },
                          { value: "installed", label: "Installed" },
                          { value: "missing", label: "Missing" },
                        ]}
                        onChange={setScriptFilter}
                        onHoverSfx={handleHoverSfx}
                        onSelectSfx={handleSelectSfx}
                      />

                      <GameDropdown
                        label="Sort"
                        value={sortMode}
                        options={[
                          { value: "newest", label: "Newest" },
                          { value: "difficulty", label: "Difficulty" },
                          { value: "bpm", label: "BPM" },
                          { value: "name", label: "Name" },
                        ]}
                        onChange={setSortMode}
                        onHoverSfx={handleHoverSfx}
                        onSelectSfx={handleSelectSfx}
                      />
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <div className="rounded-xl border border-zinc-700/80 bg-black/30 px-3 py-2 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-300">
                        {activeFilterCount > 0 ? `${activeFilterCount} Active Filters` : "No Active Filters"}
                      </div>
                      <div className="rounded-xl border border-zinc-700/80 bg-black/30 px-3 py-2 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-300">
                        Sort: {sortModeLabel}
                      </div>
                      <div className="rounded-xl border border-zinc-700/80 bg-black/30 px-3 py-2 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-300">
                        Grouping: {groupModeLabel}
                      </div>
                      <div className="rounded-xl border border-zinc-700/80 bg-black/30 px-3 py-2 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-300">
                        {showDisabledRounds ? "Disabled Included" : "Disabled Hidden"}
                      </div>
                    </div>
                  </section>

                  <section
                    className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
                    style={{ animationDelay: "0.11s" }}
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h3 className="text-lg font-extrabold tracking-tight text-violet-100">Round Library</h3>
                        <p className="mt-1 text-sm text-zinc-300">
                          {filteredRounds.length === 0
                            ? "No rounds currently match the active search and filter state."
                            : `${visibleRounds.length} of ${filteredRounds.length} matching rounds are currently loaded.`}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onMouseEnter={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            setExpandedHeroGroups((previous) => {
                              const next = { ...previous };
                              visibleGroupKeys.forEach((groupKey) => {
                                next[groupKey] = true;
                              });
                              return next;
                            });
                          }}
                          disabled={visibleGroupKeys.length === 0 || allVisibleGroupsExpanded}
                          className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.18em] transition-all duration-200 ${
                            visibleGroupKeys.length > 0 && !allVisibleGroupsExpanded
                              ? "border-cyan-300/45 bg-cyan-500/15 text-cyan-100 hover:border-cyan-200/75 hover:bg-cyan-500/25"
                              : "cursor-not-allowed border-zinc-700 bg-zinc-900/70 text-zinc-500"
                          }`}
                        >
                          Expand All Groups
                        </button>
                        <button
                          type="button"
                          onMouseEnter={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            setExpandedHeroGroups((previous) => {
                              const next = { ...previous };
                              visibleGroupKeys.forEach((groupKey) => {
                                delete next[groupKey];
                              });
                              return next;
                            });
                          }}
                          disabled={visibleGroupKeys.length === 0 || !allVisibleGroupsExpanded}
                          className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.18em] transition-all duration-200 ${
                            visibleGroupKeys.length > 0 && allVisibleGroupsExpanded
                              ? "border-violet-300/45 bg-violet-500/15 text-violet-100 hover:border-violet-200/75 hover:bg-violet-500/25"
                              : "cursor-not-allowed border-zinc-700 bg-zinc-900/70 text-zinc-500"
                          }`}
                        >
                          Collapse Groups
                        </button>
                      </div>
                    </div>

                    {scanStatus?.lastMessage && (
                      <div className="mt-4 rounded-2xl border border-zinc-700/70 bg-black/25 px-4 py-3 text-sm text-zinc-300">
                        {scanStatus.lastMessage}
                      </div>
                    )}

                    {filteredRounds.length === 0 ? (
                      <div className="mt-5 rounded-2xl border border-zinc-700/60 bg-zinc-950/60 p-8 text-center backdrop-blur-xl">
                        <p className="font-[family-name:var(--font-jetbrains-mono)] text-sm uppercase tracking-[0.28em] text-zinc-400">
                          No rounds match this filter
                        </p>
                        <p className="mt-3 text-sm text-zinc-400">
                          {hasActiveFilters
                            ? "Clear the current filters to get back to the full library."
                            : "Install a folder or import a portable file to start building the library."}
                        </p>
                        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                          {hasActiveFilters ? (
                            <RoundActionButton
                              label="Reset Filters"
                              tone="violet"
                              onHover={handleHoverSfx}
                              onClick={() => {
                                handleSelectSfx();
                                setQuery("");
                                setTypeFilter("all");
                                setScriptFilter("all");
                                setSortMode("newest");
                              }}
                            />
                          ) : (
                            <RoundActionButton
                              label="Open Import & Export"
                              tone="cyan"
                              onHover={handleHoverSfx}
                              onClick={() => {
                                handleSelectSfx();
                                setActiveSectionId("transfer");
                              }}
                            />
                          )}
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
                          {renderRows.map((row, rowIndex) => {
                            if (row.kind === "standalone") {
                              const round = row.round;
                              return (
                                <RoundCard
                                  key={round.id}
                                  round={round}
                                  index={rowIndex}
                                  onHoverSfx={handleHoverSfx}
                                  onConvertToHero={handleConvertRoundToHero}
                                  onPlay={handlePlayRound}
                                  onEdit={handleEditRound}
                                  onRetryTemplateLinking={retryTemplateLinkingForRound}
                                  onRepairTemplate={(templateRound) => {
                                    handleSelectSfx();
                                    setRepairingTemplateRound({
                                      roundId: templateRound.id,
                                      roundName: templateRound.name,
                                      installedRoundId: "",
                                    });
                                  }}
                                  animateDifficulty={(round.difficulty ?? 0) === highestVisibleDifficulty && highestVisibleDifficulty > 0}
                                  showDisabledBadge={disabledRoundIds.has(round.id)}
                                />
                              );
                            }

                            const isExpanded = Boolean(expandedHeroGroups[row.groupKey]);
                            return (
                              <div key={row.groupKey} className="space-y-4 sm:col-span-2 xl:col-span-3">
                                {row.kind === "hero-group" ? (
                                  <HeroGroupHeader
                                    heroName={row.heroName}
                                    roundCount={row.rounds.length}
                                    expanded={isExpanded}
                                    onHoverSfx={handleHoverSfx}
                                    converting={convertingHeroGroupKey === row.groupKey}
                                    hasTemplateRounds={row.rounds.some((round) => isTemplateRound(round))}
                                    onToggle={() => {
                                      handleSelectSfx();
                                      setExpandedHeroGroups((previous) => ({
                                        ...previous,
                                        [row.groupKey]: !previous[row.groupKey],
                                      }));
                                    }}
                                    onConvertToRound={() => {
                                      handleSelectSfx();
                                      void convertHeroGroupToRound(row);
                                    }}
                                    onEditHero={() => {
                                      const draft = toHeroEditDraft(row.rounds[0]);
                                      if (!draft) return;
                                      handleSelectSfx();
                                      setEditingHero(draft);
                                    }}
                                    onRetryTemplateLinking={() => {
                                      const heroId = row.rounds[0]?.heroId;
                                      if (!heroId) return;
                                      handleSelectSfx();
                                      void retryTemplateLinkingForHero(heroId);
                                    }}
                                    onRepairTemplate={() => {
                                      const heroId = row.rounds[0]?.heroId;
                                      if (!heroId) return;
                                      handleSelectSfx();
                                      setRepairingTemplateHero({
                                        heroId,
                                        heroName: row.heroName,
                                        sourceHeroId: "",
                                        assignments: row.rounds
                                          .filter((round) => isTemplateRound(round))
                                          .map((round) => ({
                                            roundId: round.id,
                                            roundName: round.name,
                                            installedRoundId: "",
                                          })),
                                      });
                                    }}
                                  />
                                ) : (
                                  <PlaylistGroupHeader
                                    playlistName={row.playlistName}
                                    roundCount={row.rounds.length}
                                    expanded={isExpanded}
                                    onHoverSfx={handleHoverSfx}
                                    onToggle={() => {
                                      handleSelectSfx();
                                      setExpandedHeroGroups((previous) => ({
                                        ...previous,
                                        [row.groupKey]: !previous[row.groupKey],
                                      }));
                                    }}
                                  />
                                )}
                                {isExpanded && (
                                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
                                    {row.rounds.map((round, groupIndex) => (
                                      <RoundCard
                                        key={`${row.groupKey}:${round.id}`}
                                        round={round}
                                        index={rowIndex + groupIndex + 1}
                                        onHoverSfx={handleHoverSfx}
                                        onConvertToHero={handleConvertRoundToHero}
                                        onPlay={handlePlayRound}
                                        onEdit={handleEditRound}
                                        onRetryTemplateLinking={retryTemplateLinkingForRound}
                                        onRepairTemplate={(templateRound) => {
                                          handleSelectSfx();
                                          setRepairingTemplateRound({
                                            roundId: templateRound.id,
                                            roundName: templateRound.name,
                                            installedRoundId: "",
                                          });
                                        }}
                                        animateDifficulty={(round.difficulty ?? 0) === highestVisibleDifficulty && highestVisibleDifficulty > 0}
                                        showDisabledBadge={disabledRoundIds.has(round.id)}
                                      />
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {visibleRounds.length < filteredRounds.length && (
                          <div
                            ref={loadMoreRef}
                            className="py-4 text-center font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-400"
                          >
                            Loading more rounds...
                          </div>
                        )}
                      </>
                    )}
                  </section>
                </>
              )}

              {activeSection.id === "overview" && (
                <>
                  <section
                    className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
                    style={{ animationDelay: "0.05s" }}
                  >
                    <div className="mb-5">
                      <h3 className="text-lg font-extrabold tracking-tight text-violet-100">Collection Health</h3>
                      <p className="mt-1 text-sm text-zinc-300">
                        A quick read on the current library before you jump back into the detailed browser.
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <LibraryStatCard label="Installed" value={rounds.length} description="Total rounds currently available in the app." tone="violet" />
                      <LibraryStatCard label="Visible" value={filteredRounds.length} description="Rounds matching your current library filters." tone="cyan" />
                      <LibraryStatCard label="Hero Groups" value={heroGroupCount} description="Collections you can expand, edit, or collapse together." tone="pink" />
                      <LibraryStatCard label="Needs Script" value={Math.max(0, rounds.length - roundsWithScriptCount)} description="Rounds without a detected funscript on the primary resource." tone="amber" />
                    </div>
                  </section>

                  <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
                    <div
                      className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
                      style={{ animationDelay: "0.08s" }}
                    >
                      <div className="mb-4">
                        <h3 className="text-lg font-extrabold tracking-tight text-violet-100">Quick Actions</h3>
                        <p className="mt-1 text-sm text-zinc-300">
                          Start common install and maintenance tasks without leaving the page shell.
                        </p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <RoundActionButton
                          label="Install Rounds"
                          tone="violet"
                          disabled={actionButtonsDisabled}
                          onHover={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            void installRoundsFromFolder();
                          }}
                        />
                        <RoundActionButton
                          label="Import File"
                          tone="emerald"
                          disabled={actionButtonsDisabled}
                          onHover={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            void importRoundsFromFile();
                          }}
                        />
                        <RoundActionButton
                          label={scanRunning ? "Scanning..." : "Scan Now"}
                          tone="cyan"
                          disabled={scanRunning}
                          onHover={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            void scanNow();
                          }}
                        />
                        <RoundActionButton
                          label={isExportingDatabase ? "Exporting..." : "Export Database"}
                          tone="sky"
                          disabled={actionButtonsDisabled}
                          onHover={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            openExportDatabaseDialog();
                          }}
                        />
                      </div>
                    </div>

                    <div
                      className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
                      style={{ animationDelay: "0.11s" }}
                    >
                      <div className="mb-4">
                        <h3 className="text-lg font-extrabold tracking-tight text-violet-100">Jump Back Into Library</h3>
                        <p className="mt-1 text-sm text-zinc-300">
                          Use these shortcuts when you already know what you want to inspect next.
                        </p>
                      </div>
                      <div className="space-y-3">
                        <button
                          type="button"
                          onMouseEnter={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            setActiveSectionId("library");
                          }}
                          className="w-full rounded-2xl border border-violet-300/25 bg-black/30 px-4 py-4 text-left transition-all duration-200 hover:border-violet-200/60 hover:bg-violet-500/10"
                        >
                          <div className="font-semibold text-zinc-100">Open full library browser</div>
                          <div className="mt-1 text-sm text-zinc-400">Search, sort, filter, and edit every installed round from the main browser.</div>
                        </button>
                        <button
                          type="button"
                          onMouseEnter={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            setShowDisabledRounds(true);
                            setActiveSectionId("library");
                          }}
                          className="w-full rounded-2xl border border-amber-300/25 bg-black/30 px-4 py-4 text-left transition-all duration-200 hover:border-amber-200/60 hover:bg-amber-500/10"
                        >
                          <div className="font-semibold text-zinc-100">Review disabled imports</div>
                          <div className="mt-1 text-sm text-zinc-400">{disabledRoundIds.size} disabled rounds are currently hidden from the standard library view.</div>
                        </button>
                      </div>
                    </div>
                  </section>

                  <section
                    className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
                    style={{ animationDelay: "0.14s" }}
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h3 className="text-lg font-extrabold tracking-tight text-violet-100">Current Scan State</h3>
                        <p className="mt-1 text-sm text-zinc-300">
                          Background install scans and manual imports surface their latest status here.
                        </p>
                      </div>
                      {scanStatus && <InstallScanStatusBadge status={scanStatus} />}
                    </div>
                    <div className="mt-4 rounded-2xl border border-zinc-700/70 bg-black/25 p-4">
                      <p className="text-sm text-zinc-100">{scanStatus?.lastMessage ?? "No recent scan message available."}</p>
                      <p className="mt-2 text-sm text-zinc-400">
                        {scanStatus
                          ? formatScanStatsSummary(scanStatus)
                          : "Run a scan or import to populate status details."}
                      </p>
                    </div>
                  </section>
                </>
              )}

              {activeSection.id === "transfer" && (
                <>
                  <section className="grid gap-5 xl:grid-cols-2">
                    <div
                      className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
                      style={{ animationDelay: "0.05s" }}
                    >
                      <div className="mb-4">
                        <h3 className="text-lg font-extrabold tracking-tight text-violet-100">Import New Content</h3>
                        <p className="mt-1 text-sm text-zinc-300">
                          Folder installs are best for bulk local content. Portable file import is best for sidecars and packaged exports.
                        </p>
                      </div>
                      <div className="space-y-3">
                        <RoundActionButton
                          label="Install Rounds"
                          description="Choose a folder and scan it for supported round media."
                          tone="violet"
                          disabled={actionButtonsDisabled}
                          onHover={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            void installRoundsFromFolder();
                          }}
                        />
                        <RoundActionButton
                          label="Import File"
                          description="Bring in a portable round package or other supported import file."
                          tone="emerald"
                          disabled={actionButtonsDisabled}
                          onHover={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            void importRoundsFromFile();
                          }}
                        />
                        <RoundActionButton
                          label={scanRunning ? "Scanning..." : "Scan Now"}
                          description="Re-run install folder discovery for sources already connected to the app."
                          tone="cyan"
                          disabled={scanRunning}
                          onHover={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            void scanNow();
                          }}
                        />
                      </div>
                    </div>

                    <div
                      className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
                      style={{ animationDelay: "0.08s" }}
                    >
                      <div className="mb-4">
                        <h3 className="text-lg font-extrabold tracking-tight text-violet-100">Export & Share</h3>
                        <p className="mt-1 text-sm text-zinc-300">
                          Build a clean installed-database export or open the export library directly from here.
                        </p>
                      </div>
                      <div className="space-y-3">
                        <RoundActionButton
                          label={isExportingDatabase ? "Exporting..." : "Export Database"}
                          description="Open the export flow and package the installed database."
                          tone="sky"
                          disabled={actionButtonsDisabled}
                          onHover={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            openExportDatabaseDialog();
                          }}
                        />
                        <RoundActionButton
                          label={isOpeningExportFolder ? "Opening..." : "Open Export Folder"}
                          description="Jump straight to the app-managed export library on disk."
                          tone="cyan"
                          disabled={actionButtonsDisabled}
                          onHover={handleHoverSfx}
                          onClick={() => {
                            handleSelectSfx();
                            void openInstallExportFolder();
                          }}
                        />
                      </div>
                    </div>
                  </section>

                  <section
                    className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl"
                    style={{ animationDelay: "0.11s" }}
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h3 className="text-lg font-extrabold tracking-tight text-violet-100">Transfer Guidance</h3>
                        <p className="mt-1 text-sm text-zinc-300">
                          Keep the flow predictable: install from folders for bulk local content, use safe exports for portability, and only include URIs when the receiving machine expects them.
                        </p>
                      </div>
                      {scanStatus && <InstallScanStatusBadge status={scanStatus} />}
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-4">
                      <LibraryStatCard label="Folders" value={scanStatus?.stats.scannedFolders ?? 0} description="Folders touched by the latest scan or import run." tone="violet" />
                      <LibraryStatCard label="Installed" value={scanStatus?.stats.installed ?? 0} description="New rounds added during the latest transfer operation." tone="emerald" />
                      <LibraryStatCard label="Playlists" value={scanStatus?.stats.playlistsImported ?? 0} description="Playlists imported during the latest transfer operation." tone="cyan" />
                      <LibraryStatCard label="Failed" value={scanStatus?.stats.failed ?? 0} description="Items that failed during the latest transfer operation." tone="amber" />
                    </div>
                  </section>
                </>
              )}
            </div>

            <div className="mx-auto grid w-full max-w-md grid-cols-1 gap-2 pb-6">
              <MenuButton
                label={scanRunning ? "Scanning..." : "Scan Now"}
                primary
                onClick={() => {
                  handleSelectSfx();
                  void scanNow();
                }}
                onHover={handleHoverSfx}
              />
              <MenuButton
                label="Back to Main Menu"
                onClick={() => {
                  handleSelectSfx();
                  navigate({ to: "/" });
                }}
                onHover={handleHoverSfx}
              />
            </div>
          </main>
        </div>
      </div>
      {showInstallOverlay && (
        <InstallImportOverlay
          status={scanStatus}
          aborting={isAbortingInstall}
          onAbort={abortInstallImport}
        />
      )}
      {activePreviewRound && (
        <RoundVideoOverlay
          activeRound={activePreview}
          installedRounds={previewInstalledRounds}
          currentPlayer={undefined}
          intermediaryProbability={1}
          allowAutomaticIntermediaries
          showCloseButton
          onClose={() => {
            setActivePreviewRound(null);
          }}
          booruSearchPrompt={intermediaryLoadingPrompt}
          intermediaryLoadingDurationSec={intermediaryLoadingDurationSec}
          intermediaryReturnPauseSec={intermediaryReturnPauseSec}
          initialShowProgressBarAlways={roundProgressBarAlwaysVisible}
          onFinishRound={() => {
            setActivePreviewRound(null);
          }}
        />
      )}
      {editingRound && (
        <EditDialog
          title="Edit Round"
          onClose={() => !isSavingEdit && setEditingRound(null)}
          onSubmit={() => {
            void saveRoundEdit();
          }}
          submitLabel={isSavingEdit ? "Saving..." : "Save Round"}
          disabled={isSavingEdit}
          destructiveActionLabel={isSavingEdit ? "Deleting..." : "Delete Round"}
          onDestructiveAction={() => {
            void deleteRoundEntry();
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ModalField label="Name">
              <input
                value={editingRound.name}
                onChange={(event) => setEditingRound((previous) => previous ? { ...previous, name: event.target.value } : previous)}
                className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
              />
            </ModalField>
            <ModalField label="Type">
              <select
                value={editingRound.type}
                onChange={(event) => setEditingRound((previous) => previous ? { ...previous, type: event.target.value as EditableRoundType } : previous)}
                className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
              >
                <option value="Normal">Normal</option>
                <option value="Interjection">Interjection</option>
                <option value="Cum">Cum</option>
              </select>
            </ModalField>
            <ModalField label="Author">
              <input
                value={editingRound.author}
                onChange={(event) => setEditingRound((previous) => previous ? { ...previous, author: event.target.value } : previous)}
                className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
              />
            </ModalField>
            <ModalField label="BPM">
              <input
                value={editingRound.bpm}
                onChange={(event) => setEditingRound((previous) => previous ? { ...previous, bpm: event.target.value } : previous)}
                className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
              />
            </ModalField>
            <ModalField label="Difficulty">
              <input
                value={editingRound.difficulty}
                onChange={(event) => setEditingRound((previous) => previous ? { ...previous, difficulty: event.target.value } : previous)}
                className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
              />
            </ModalField>
            <ModalField label="Start Time (ms)">
              <input
                value={editingRound.startTime}
                onChange={(event) => setEditingRound((previous) => previous ? { ...previous, startTime: event.target.value } : previous)}
                className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
              />
            </ModalField>
            <ModalField label="End Time (ms)">
              <input
                value={editingRound.endTime}
                onChange={(event) => setEditingRound((previous) => previous ? { ...previous, endTime: event.target.value } : previous)}
                className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
              />
            </ModalField>
            <ModalField label="Description" className="sm:col-span-2">
              <textarea
                value={editingRound.description}
                onChange={(event) => setEditingRound((previous) => previous ? { ...previous, description: event.target.value } : previous)}
                className="min-h-28 w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
              />
            </ModalField>
          </div>
        </EditDialog>
      )}
      {editingHero && (
        <EditDialog
          title="Edit Hero"
          onClose={() => !isSavingEdit && setEditingHero(null)}
          onSubmit={() => {
            void saveHeroEdit();
          }}
          submitLabel={isSavingEdit ? "Saving..." : "Save Hero"}
          disabled={isSavingEdit}
          destructiveActionLabel={isSavingEdit ? "Deleting..." : "Delete Hero"}
          onDestructiveAction={() => {
            void deleteHeroEntry();
          }}
        >
          <div className="grid grid-cols-1 gap-3">
            <ModalField label="Name">
              <input
                value={editingHero.name}
                onChange={(event) => setEditingHero((previous) => previous ? { ...previous, name: event.target.value } : previous)}
                className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
              />
            </ModalField>
            <ModalField label="Author">
              <input
                value={editingHero.author}
                onChange={(event) => setEditingHero((previous) => previous ? { ...previous, author: event.target.value } : previous)}
                className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
              />
            </ModalField>
            <ModalField label="Description">
              <textarea
                value={editingHero.description}
                onChange={(event) => setEditingHero((previous) => previous ? { ...previous, description: event.target.value } : previous)}
                className="min-h-28 w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
              />
            </ModalField>
          </div>
        </EditDialog>
      )}
      {repairingTemplateRound && (
        <EditDialog
          title="Repair Template Round"
          onClose={() => !isSavingEdit && setRepairingTemplateRound(null)}
          onSubmit={() => {
            void saveRoundTemplateRepair();
          }}
          submitLabel={isSavingEdit ? "Repairing..." : "Attach Source Media"}
          disabled={isSavingEdit}
        >
          <div className="space-y-4">
            <p className="rounded-2xl border border-amber-300/25 bg-amber-500/10 p-4 text-sm text-zinc-200">
              Attach installed media to <span className="font-semibold text-amber-100">{repairingTemplateRound.roundName}</span>.
            </p>
            <ModalField label="Installed Round Source">
              <select
                value={repairingTemplateRound.installedRoundId}
                onChange={(event) => setRepairingTemplateRound((current) => current ? { ...current, installedRoundId: event.target.value } : current)}
                className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
              >
                <option value="">Select installed round</option>
                {rounds
                  .filter((round) => !isTemplateRound(round))
                  .map((round) => (
                    <option key={round.id} value={round.id}>
                      {round.name}{round.hero?.name ? ` [${round.hero.name}]` : ""}
                    </option>
                  ))}
              </select>
            </ModalField>
          </div>
        </EditDialog>
      )}
      {repairingTemplateHero && (
        <EditDialog
          title="Repair Template Hero"
          onClose={() => !isSavingEdit && setRepairingTemplateHero(null)}
          onSubmit={() => {
            void saveHeroTemplateRepair();
          }}
          submitLabel={isSavingEdit ? "Repairing..." : "Attach Hero Media"}
          disabled={isSavingEdit}
        >
          <div className="space-y-4">
            <p className="rounded-2xl border border-amber-300/25 bg-amber-500/10 p-4 text-sm text-zinc-200">
              Choose a source hero for <span className="font-semibold text-amber-100">{repairingTemplateHero.heroName}</span>. Assignments are auto-filled by round name, then order.
            </p>
            <ModalField label="Source Hero">
              <select
                value={repairingTemplateHero.sourceHeroId}
                onChange={(event) => applySourceHeroToRepairDraft(event.target.value)}
                className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
              >
                <option value="">Select source hero</option>
                {sourceHeroOptions.map((option) => (
                  <option key={option.heroId} value={option.heroId}>
                    {option.heroName} ({option.rounds.length} rounds)
                  </option>
                ))}
              </select>
            </ModalField>
            <div className="space-y-3">
              {repairingTemplateHero.assignments.map((assignment) => {
                const selectedSourceHero = sourceHeroOptions.find((entry) => entry.heroId === repairingTemplateHero.sourceHeroId);
                return (
                  <ModalField key={assignment.roundId} label={assignment.roundName}>
                    <select
                      value={assignment.installedRoundId}
                      onChange={(event) =>
                        setRepairingTemplateHero((current) =>
                          current
                            ? {
                                ...current,
                                assignments: current.assignments.map((entry) =>
                                  entry.roundId === assignment.roundId
                                    ? { ...entry, installedRoundId: event.target.value }
                                    : entry),
                              }
                            : current
                        )
                      }
                      className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-200/70"
                    >
                      <option value="">Select installed round</option>
                      {(selectedSourceHero?.rounds ?? []).map((round) => (
                        <option key={round.id} value={round.id}>
                          {round.name}
                        </option>
                      ))}
                    </select>
                  </ModalField>
                );
              })}
            </div>
          </div>
        </EditDialog>
      )}
      {legacyPlaylistReview && (
        <EditDialog
          title="Review Legacy Import"
          onClose={dismissLegacyPlaylistReview}
          onSubmit={() => {
            void createLegacyPlaylist();
          }}
          submitLabel={
            legacyPlaylistReview.creating
              ? "Importing..."
              : legacyPlaylistReview.createPlaylist
                ? "Import and Create Playlist"
                : "Import Without Playlist"
          }
          disabled={legacyPlaylistReview.creating}
        >
          <div className="space-y-4">
            <div className="rounded-2xl border border-violet-300/25 bg-violet-500/10 p-4 text-sm text-zinc-200">
              Review the folder before import. Ordered by filename (natural sort), so entries like 2, 10, and 100 stay in human order.
            </div>
            <label className="flex items-start gap-3 rounded-2xl border border-zinc-700/70 bg-black/35 px-4 py-3 text-sm text-zinc-200">
              <input
                type="checkbox"
                checked={legacyPlaylistReview.createPlaylist}
                onChange={(event) =>
                  setLegacyPlaylistReview((current) =>
                    current
                      ? {
                          ...current,
                          createPlaylist: event.target.checked,
                          error: null,
                        }
                      : null
                  )
                }
                className="mt-0.5 h-4 w-4 rounded border-zinc-500 bg-black/40"
              />
              <span>
                Create a playlist after import.
              </span>
            </label>
            <ModalField label="Playlist Name">
              <input
                value={legacyPlaylistReview.playlistName}
                onChange={(event) =>
                  setLegacyPlaylistReview((current) =>
                    current
                      ? {
                          ...current,
                          playlistName: event.target.value,
                          error: null,
                        }
                      : null
                  )
                }
                disabled={!legacyPlaylistReview.createPlaylist}
                className={`w-full rounded-xl border px-4 py-3 text-sm outline-none transition-all duration-200 ${
                  legacyPlaylistReview.createPlaylist
                    ? "border-violet-300/35 bg-black/45 text-zinc-100 focus:border-violet-200/80 focus:ring-2 focus:ring-violet-400/25"
                    : "cursor-not-allowed border-zinc-700 bg-zinc-900/70 text-zinc-500"
                }`}
                placeholder="Legacy Playlist"
              />
            </ModalField>
            <div className="rounded-2xl border border-zinc-700/70 bg-black/35 p-4">
              <div className="mb-3 flex items-center justify-between gap-3 text-xs uppercase tracking-[0.18em] text-zinc-300">
                <span>Import Order Preview</span>
                <span>{legacyPlaylistReview.slots.length} slots</span>
              </div>
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {legacyPlaylistReview.slots.map((slot) => (
                  <div
                    key={slot.id}
                    className="flex items-center gap-3 rounded-xl border border-zinc-700/60 bg-zinc-900/60 px-3 py-3 text-sm text-zinc-100"
                  >
                    <span className="w-10 shrink-0 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.18em] text-violet-200">
                      {slot.originalOrder + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-zinc-50">{slot.sourceLabel}</div>
                      <div className="text-xs text-zinc-400">Excluded: {slot.excludedFromImport ? "Yes" : "No"}</div>
                      <div className="text-xs text-zinc-400">Checkpoint: {slot.selectedAsCheckpoint ? "Yes" : "No"}</div>
                    </div>
                    <label className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-zinc-300">
                      <input
                        type="checkbox"
                        checked={!slot.excludedFromImport}
                        onChange={() => toggleLegacyImportExclusion(slot.id)}
                        className="h-4 w-4 rounded border-zinc-500 bg-black/40"
                      />
                      <span>Import</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-zinc-300">
                      <input
                        type="checkbox"
                        checked={slot.selectedAsCheckpoint}
                        disabled={slot.excludedFromImport}
                        onChange={() => toggleLegacyCheckpointSelection(slot.id)}
                        className="h-4 w-4 rounded border-zinc-500 bg-black/40 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      <span>Checkpoint</span>
                    </label>
                  </div>
                ))}
              </div>
            </div>
            {legacyPlaylistReview.error && (
              <p className="rounded-xl border border-rose-300/35 bg-rose-500/15 px-4 py-3 text-sm text-rose-100">
                {legacyPlaylistReview.error}
              </p>
            )}
          </div>
        </EditDialog>
      )}
      {exportDialog && (
        <InstalledDatabaseExportDialog
          state={exportDialog}
          exporting={isExportingDatabase}
          openingFolder={isOpeningExportFolder}
          onClose={() => {
            if (isExportingDatabase || isOpeningExportFolder) return;
            setExportDialog(null);
          }}
          onChange={(updater) => {
            setExportDialog((current) => {
              if (!current) return current;
              return typeof updater === "function" ? updater(current) : updater;
            });
          }}
          onSubmit={() => {
            void exportInstalledDatabase();
          }}
          onOpenFolder={() => {
            void openInstallExportFolder();
          }}
        />
      )}
    </div>
  );
}

const RoundCard = memo(function RoundCard({
  round,
  index,
  onHoverSfx,
  onConvertToHero,
  onPlay,
  onEdit,
  onRetryTemplateLinking,
  onRepairTemplate,
  animateDifficulty,
  showDisabledBadge,
}: {
  round: InstalledRound;
  index: number;
  onHoverSfx: () => void;
  onConvertToHero: (round: InstalledRound) => void;
  onPlay: (round: InstalledRound) => void;
  onEdit: (round: InstalledRound) => void;
  onRetryTemplateLinking: (round: InstalledRound) => void;
  onRepairTemplate: (round: InstalledRound) => void;
  animateDifficulty: boolean;
  showDisabledBadge: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [isPreviewActive, setIsPreviewActive] = useState(false);
  const { getVideoSrc, ensurePlayableVideo, handleVideoError } = usePlayableVideoFallback();
  const previewUri = round.resources[0]?.videoUri;
  const previewImage = round.previewImage;
  const primaryResource = round.resources[0];
  const hasFunscript = Boolean(round.resources[0]?.funscriptUri);
  const isTemplate = isTemplateRound(round);
  const difficulty = round.difficulty ?? 1;
  const sourceLabel = round.installSourceKey?.startsWith("stash:") ? "Stash" : "Local";
  const shouldLoadPreview = Boolean(previewUri) && isPreviewActive;
  const previewVideoSrc = shouldLoadPreview ? getVideoSrc(previewUri) : undefined;
  const previewWindowSec = useMemo(() => {
    const startMs =
      typeof round.startTime === "number" && Number.isFinite(round.startTime)
        ? Math.max(0, round.startTime)
        : 0;
    const rawEndMs =
      typeof round.endTime === "number" && Number.isFinite(round.endTime)
        ? Math.max(0, round.endTime)
        : null;
    const endMs = rawEndMs !== null && rawEndMs > startMs ? rawEndMs : null;
    return {
      startSec: startMs / 1000,
      endSec: endMs === null ? null : endMs / 1000,
    };
  }, [round.endTime, round.startTime]);

  const resolvePreviewWindow = (video: HTMLVideoElement) => {
    const hasFiniteDuration = Number.isFinite(video.duration) && video.duration > 0;
    const startSec = hasFiniteDuration ? Math.min(previewWindowSec.startSec, video.duration) : previewWindowSec.startSec;
    let endSec = previewWindowSec.endSec;
    if (endSec !== null && hasFiniteDuration) {
      endSec = Math.min(endSec, video.duration);
    }
    if (endSec !== null && endSec <= startSec + 0.001) {
      endSec = null;
    }
    return { startSec, endSec };
  };

  const startPreview = async () => {
    setIsPreviewActive(true);
    const video = videoRef.current;
    if (!video) return;
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) return;
    const { startSec } = resolvePreviewWindow(video);
    video.currentTime = startSec;
    try {
      await video.play();
    } catch (error) {
      console.error("Preview play blocked", error);
    }
  };

  const stopPreview = () => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    const { startSec } = resolvePreviewWindow(video);
    video.currentTime = startSec;
  };

  return (
    <article
      className="group animate-entrance relative overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(14,10,25,0.94),rgba(5,7,14,0.98))] shadow-[0_22px_60px_rgba(2,6,23,0.44)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-violet-300/55 hover:shadow-[0_28px_72px_rgba(76,29,149,0.34)]"
      style={{ animationDelay: `${0.14 + index * 0.04}s` }}
      onMouseEnter={async () => {
        onHoverSfx();
        await startPreview();
      }}
      onMouseLeave={stopPreview}
      onFocus={async () => {
        onHoverSfx();
        await startPreview();
      }}
      onBlur={stopPreview}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.14),transparent_26%),radial-gradient(circle_at_bottom_left,rgba(168,85,247,0.18),transparent_38%)]" />

      <div className="group/video relative aspect-video overflow-hidden border-b border-white/10 bg-gradient-to-br from-[#1b1130] via-[#120a25] to-[#0d1a33]">
        {previewImage && (
          <img
            src={previewImage}
            alt={`${round.name} preview`}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            loading="lazy"
            decoding="async"
          />
        )}
        {previewUri ? (
          <video
            ref={videoRef}
            className={`h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06] ${previewImage ? "opacity-0 group-hover/video:opacity-100 group-focus-within/video:opacity-100" : ""}`}
            src={previewVideoSrc}
            muted
            preload={shouldLoadPreview ? "metadata" : "none"}
            playsInline
            poster={previewImage ?? undefined}
            onError={() => {
              void handleVideoError(previewUri);
            }}
            onLoadedMetadata={() => {
              if (!isPreviewActive) return;
              void ensurePlayableVideo(previewUri);
              const video = videoRef.current;
              if (!video) return;
              const { startSec } = resolvePreviewWindow(video);
              video.currentTime = startSec;
            }}
            onLoadedData={() => {
              if (!isPreviewActive) return;
              const video = videoRef.current;
              if (!video) return;
              const { startSec } = resolvePreviewWindow(video);
              video.currentTime = startSec;
              void video.play().catch(() => {});
            }}
            onTimeUpdate={() => {
              if (!isPreviewActive) return;
              const video = videoRef.current;
              if (!video) return;
              const { startSec, endSec } = resolvePreviewWindow(video);
              if (video.currentTime < startSec) {
                video.currentTime = startSec;
                return;
              }
              if (endSec !== null && video.currentTime >= endSec - 0.04) {
                video.currentTime = startSec;
                if (video.paused) {
                  void video.play().catch(() => {});
                }
              }
            }}
            onEnded={() => {
              if (!isPreviewActive) return;
              const video = videoRef.current;
              if (!video) return;
              const { startSec } = resolvePreviewWindow(video);
              video.currentTime = startSec;
              void video.play().catch(() => {});
            }}
          />
        ) : !previewImage ? (
          <div className="flex h-full items-center justify-center text-zinc-500 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.35em]">
            No Preview
          </div>
        ) : null}

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#030407]/90 via-black/20 to-white/5" />
        <DifficultyBadge difficulty={difficulty} animate={animateDifficulty} />

        {previewUri && (
          <button
            type="button"
            aria-label={`Play ${round.name}`}
            className="absolute left-1/2 top-1/2 z-20 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/45 bg-black/55 text-white opacity-0 shadow-[0_0_30px_rgba(0,0,0,0.45)] transition-all duration-200 group-hover/video:scale-105 group-hover/video:opacity-100 focus-visible:opacity-100"
            onMouseEnter={onHoverSfx}
            onClick={() => onPlay(round)}
          >
            <span className="ml-1 text-2xl leading-none">▶</span>
          </button>
        )}

        <div className="absolute right-3 top-3 flex flex-col items-end gap-1.5">
          <span className="rounded-full border border-violet-300/35 bg-violet-500/18 px-2.5 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[9px] uppercase tracking-[0.28em] text-violet-100 backdrop-blur-md">
            {round.type ?? "Normal"}
          </span>
          <span className="rounded-full border border-cyan-300/35 bg-cyan-500/18 px-2.5 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[9px] uppercase tracking-[0.24em] text-cyan-100 backdrop-blur-md">
            {sourceLabel}
          </span>
          {showDisabledBadge && (
            <span className="rounded-full border border-rose-300/35 bg-rose-500/18 px-2.5 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[9px] uppercase tracking-[0.24em] text-rose-100 backdrop-blur-md">
              Disabled
            </span>
          )}
          {isTemplate && (
            <span className="rounded-full border border-amber-300/35 bg-amber-500/18 px-2.5 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[9px] uppercase tracking-[0.24em] text-amber-100 backdrop-blur-md">
              Template
            </span>
          )}
        </div>

        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 px-3 pb-3">
          <div className="min-w-0 rounded-2xl border border-white/10 bg-black/25 px-3 py-2 backdrop-blur-md">
            <p className="font-[family-name:var(--font-jetbrains-mono)] text-[9px] uppercase tracking-[0.28em] text-white/55">
              Library
            </p>
            <p className="mt-1 max-w-[12rem] truncate text-sm font-semibold text-white/90">
              {round.author ?? round.hero?.name ?? "Installed"}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full border px-2.5 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[9px] uppercase tracking-[0.24em] backdrop-blur-md ${
              hasFunscript
                ? "border-emerald-300/35 bg-emerald-500/18 text-emerald-100"
                : "border-orange-300/35 bg-orange-500/18 text-orange-100"
            }`}
          >
            {hasFunscript ? "Script Ready" : "No Script"}
          </span>
        </div>
      </div>

      <div className="relative space-y-3 p-3.5">
        <div className="space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <h2 className="min-w-0 flex-1 truncate text-[1.15rem] font-black tracking-tight text-zinc-100">
              {round.name}
            </h2>
            <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[9px] uppercase tracking-[0.24em] text-zinc-200/80">
              {formatDate(round.createdAt)}
            </span>
          </div>
          <p className="text-sm leading-5 text-zinc-300/85 line-clamp-2">
            {round.description ?? "No description"}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <MetaItem label="BPM" value={round.bpm ? `${Math.round(round.bpm)}` : "N/A"} tone="cyan" />
          <MetaItem label="Hero" value={round.hero?.name ?? "N/A"} tone="pink" />
          <MetaItem label="Script" value={isTemplate ? "Template" : hasFunscript ? "Installed" : "Missing"} tone={hasFunscript ? "emerald" : "orange"} />
          <MetaItem label="Author" value={round.author ?? "Unknown"} tone="violet" />
          <MetaItem label="Window" value={formatWindow(round.startTime, round.endTime)} tone="indigo" />
          <MetaItem label="Source" value={sourceLabel} tone="cyan" />
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <button
            className="min-w-0 rounded-2xl border border-cyan-300/35 bg-cyan-500/14 px-4 py-2.5 font-[family-name:var(--font-jetbrains-mono)] text-[11px] uppercase tracking-[0.22em] text-cyan-100 transition-all duration-200 hover:border-cyan-200/75 hover:bg-cyan-500/28"
            onClick={() => onEdit(round)}
            onMouseEnter={onHoverSfx}
            type="button"
          >
            Edit Round
          </button>
          <button
            className="rounded-2xl border border-violet-300/35 bg-violet-500/12 px-3 py-2.5 font-[family-name:var(--font-jetbrains-mono)] text-[11px] uppercase tracking-[0.2em] text-violet-100 transition-all duration-200 hover:border-violet-200/75 hover:bg-violet-500/24"
            onClick={() => setShowTechnicalDetails((prev) => !prev)}
            onMouseEnter={onHoverSfx}
            type="button"
            aria-label={showTechnicalDetails ? "Hide Technical Details" : "Show Technical Details"}
          >
            {showTechnicalDetails ? "Hide Details" : "Details"}
          </button>
          {isTemplate && (
            <>
              <button
                className="col-span-2 rounded-2xl border border-amber-300/35 bg-amber-500/14 px-4 py-2.5 font-[family-name:var(--font-jetbrains-mono)] text-[11px] uppercase tracking-[0.22em] text-amber-100 transition-all duration-200 hover:border-amber-200/75 hover:bg-amber-500/28"
                onClick={() => onRepairTemplate(round)}
                onMouseEnter={onHoverSfx}
                type="button"
              >
                Repair Template
              </button>
              <button
                className="col-span-2 rounded-2xl border border-fuchsia-300/35 bg-fuchsia-500/14 px-4 py-2.5 font-[family-name:var(--font-jetbrains-mono)] text-[11px] uppercase tracking-[0.22em] text-fuchsia-100 transition-all duration-200 hover:border-fuchsia-200/75 hover:bg-fuchsia-500/28"
                onClick={() => onRetryTemplateLinking(round)}
                onMouseEnter={onHoverSfx}
                type="button"
              >
                Retry Auto-Link
              </button>
            </>
          )}
          {!round.heroId && !round.hero && (
            <button
              className="col-span-2 rounded-2xl border border-emerald-300/35 bg-emerald-500/14 px-4 py-2.5 font-[family-name:var(--font-jetbrains-mono)] text-[11px] uppercase tracking-[0.22em] text-emerald-100 transition-all duration-200 hover:border-emerald-200/75 hover:bg-emerald-500/28"
              onClick={() => onConvertToHero(round)}
              onMouseEnter={onHoverSfx}
              type="button"
            >
              Convert to Hero
            </button>
          )}
        </div>

        {showTechnicalDetails && (
          <div className="grid gap-2 rounded-2xl border border-white/10 bg-black/30 p-3 font-[family-name:var(--font-jetbrains-mono)] text-[10px] tracking-[0.12em] text-zinc-300 sm:grid-cols-2">
            <TechnicalDetail label="Round Hash" value={round.phash ?? "N/A"} />
            <TechnicalDetail label="Resource Hash" value={primaryResource?.phash ?? "N/A"} />
            <TechnicalDetail label="Round ID" value={round.id} />
            <TechnicalDetail label="Resource ID" value={primaryResource?.id ?? "N/A"} />
            <TechnicalDetail label="Source Key" value={round.installSourceKey ?? "N/A"} className="sm:col-span-2" />
          </div>
        )}
      </div>
    </article>
  );
});

function HeroGroupHeader({
  heroName,
  roundCount,
  expanded,
  converting,
  hasTemplateRounds,
  onToggle,
  onConvertToRound,
  onEditHero,
  onRetryTemplateLinking,
  onRepairTemplate,
  onHoverSfx,
}: {
  heroName: string;
  roundCount: number;
  expanded: boolean;
  converting: boolean;
  hasTemplateRounds: boolean;
  onToggle: () => void;
  onConvertToRound: () => void;
  onEditHero: () => void;
  onRetryTemplateLinking: () => void;
  onRepairTemplate: () => void;
  onHoverSfx: () => void;
}) {
  return (
    <div className="flex w-full items-stretch gap-3 rounded-2xl">
      <button
        type="button"
        onMouseEnter={onHoverSfx}
        onFocus={onHoverSfx}
        onClick={onEditHero}
        className="shrink-0 rounded-2xl border border-cyan-300/45 bg-cyan-500/20 px-4 py-3 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-cyan-100 transition-all duration-200 hover:border-cyan-200/80 hover:bg-cyan-500/35"
      >
        Edit Hero
      </button>
      {hasTemplateRounds && (
        <button
          type="button"
          onMouseEnter={onHoverSfx}
          onFocus={onHoverSfx}
          onClick={onRepairTemplate}
          className="shrink-0 rounded-2xl border border-amber-300/45 bg-amber-500/20 px-4 py-3 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-amber-100 transition-all duration-200 hover:border-amber-200/80 hover:bg-amber-500/35"
        >
          Repair
        </button>
      )}
      {hasTemplateRounds && (
        <button
          type="button"
          onMouseEnter={onHoverSfx}
          onFocus={onHoverSfx}
          onClick={onRetryTemplateLinking}
          className="shrink-0 rounded-2xl border border-fuchsia-300/45 bg-fuchsia-500/20 px-4 py-3 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-fuchsia-100 transition-all duration-200 hover:border-fuchsia-200/80 hover:bg-fuchsia-500/35"
        >
          Retry
        </button>
      )}
      <button
        type="button"
        onMouseEnter={onHoverSfx}
        onFocus={onHoverSfx}
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center justify-between rounded-2xl border border-violet-300/35 bg-black/45 px-4 py-3 text-left shadow-[0_0_25px_rgba(139,92,246,0.12)] transition-all duration-200 hover:border-violet-200/70 hover:bg-violet-500/12"
        aria-expanded={expanded}
        aria-label={`${heroName} (${roundCount} rounds)`}
      >
        <div className="min-w-0">
          <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.25em] text-violet-200/85">
            Hero Group
          </p>
          <h2 className="mt-1 truncate text-lg font-extrabold tracking-tight text-zinc-100">
            {heroName}
          </h2>
        </div>
        <div className="flex items-center gap-3 pl-3">
          <span className="rounded-md border border-violet-300/40 bg-violet-500/15 px-2 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-violet-100">
            {roundCount} Rounds
          </span>
          <span className={`text-violet-200 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}>▾</span>
        </div>
      </button>
      <button
        type="button"
        onMouseEnter={onHoverSfx}
        onFocus={onHoverSfx}
        onClick={onConvertToRound}
        disabled={converting}
        className={`shrink-0 rounded-2xl border px-4 py-3 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] transition-all duration-200 ${
          converting
            ? "cursor-wait border-zinc-700 bg-zinc-800/80 text-zinc-400"
            : "border-rose-300/45 bg-rose-500/20 text-rose-100 hover:border-rose-200/80 hover:bg-rose-500/35"
        }`}
        aria-label={`Convert ${heroName} to round`}
      >
        {converting ? "Converting..." : "Convert to Round"}
      </button>
    </div>
  );
}

function PlaylistGroupHeader({
  playlistName,
  roundCount,
  expanded,
  onToggle,
  onHoverSfx,
}: {
  playlistName: string;
  roundCount: number;
  expanded: boolean;
  onToggle: () => void;
  onHoverSfx: () => void;
}) {
  return (
    <button
      type="button"
      onMouseEnter={onHoverSfx}
      onFocus={onHoverSfx}
      onClick={onToggle}
      className="flex w-full min-w-0 items-center justify-between rounded-2xl border border-emerald-300/35 bg-black/45 px-4 py-3 text-left shadow-[0_0_25px_rgba(16,185,129,0.12)] transition-all duration-200 hover:border-emerald-200/70 hover:bg-emerald-500/12"
      aria-expanded={expanded}
      aria-label={`${playlistName} (${roundCount} rounds)`}
    >
      <div className="min-w-0">
        <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.25em] text-emerald-200/85">
          Playlist Group
        </p>
        <h2 className="mt-1 truncate text-lg font-extrabold tracking-tight text-zinc-100">
          {playlistName}
        </h2>
      </div>
      <div className="flex items-center gap-3 pl-3">
        <span className="rounded-md border border-emerald-300/40 bg-emerald-500/15 px-2 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-emerald-100">
          {roundCount} Rounds
        </span>
        <span className={`text-emerald-200 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}>▾</span>
      </div>
    </button>
  );
}

function DifficultyBadge({ difficulty, animate }: { difficulty: number; animate: boolean }) {
  const level = Math.max(1, Math.min(5, difficulty));
  return (
    <div className={`absolute left-3 top-3 flex items-center gap-2 rounded-full border border-pink-200/45 bg-pink-400/22 px-3 py-1.5 font-[family-name:var(--font-jetbrains-mono)] text-[10px] text-white shadow-[0_0_30px_rgba(236,72,153,0.45)] backdrop-blur-md ${animate ? "animate-difficulty-pop" : ""}`}>
      <span className="text-pink-100/90">Difficulty</span>
      <span className="text-yellow-200 drop-shadow-[0_0_8px_rgba(253,224,71,0.85)]">{"★".repeat(level)}</span>
      <span className="rounded-full bg-black/30 px-2 py-0.5 text-white/90">{level}/5</span>
    </div>
  );
}

function EditDialog({
  title,
  children,
  onClose,
  onSubmit,
  submitLabel,
  disabled,
  destructiveActionLabel,
  onDestructiveAction,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel: string;
  disabled: boolean;
  destructiveActionLabel?: string;
  onDestructiveAction?: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-3xl border border-violet-300/30 bg-zinc-950/95 p-5 shadow-[0_0_40px_rgba(139,92,246,0.28)]">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-xl font-extrabold tracking-tight text-zinc-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={disabled}
            className="rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-xs uppercase tracking-[0.18em] text-zinc-300"
          >
            Close
          </button>
        </div>
        {children}
        <div className="mt-4 flex justify-end gap-3">
          {onDestructiveAction && destructiveActionLabel && (
            <button
              type="button"
              onClick={onDestructiveAction}
              disabled={disabled}
              className={`mr-auto rounded-xl border px-4 py-2 text-sm font-semibold ${
                disabled
                  ? "cursor-not-allowed border-zinc-700 bg-zinc-800 text-zinc-500"
                  : "border-rose-300/60 bg-rose-500/20 text-rose-100 hover:bg-rose-500/35"
              }`}
            >
              {destructiveActionLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={disabled}
            className="rounded-xl border border-zinc-700 bg-black/40 px-4 py-2 text-sm text-zinc-300"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={disabled}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold ${disabled ? "cursor-not-allowed border-zinc-700 bg-zinc-800 text-zinc-500" : "border-emerald-300/60 bg-emerald-500/25 text-emerald-100 hover:bg-emerald-500/40"}`}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalField({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={className}>
      <span className="mb-2 block font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.24em] text-zinc-300">
        {label}
      </span>
      {children}
    </label>
  );
}

function formatScanStatsSummary(status: InstallScanStatus): string {
  return `${status.stats.installed} rounds installed, ${status.stats.playlistsImported} playlists imported, ${status.stats.updated} updated, ${status.stats.failed} failed.`;
}

function InstallScanStatusBadge({ status }: { status: InstallScanStatus }) {
  const tone =
    status.state === "running"
      ? "border-cyan-300/60 bg-cyan-500/20 text-cyan-100"
      : status.state === "aborted"
        ? "border-amber-300/60 bg-amber-500/20 text-amber-100"
      : status.state === "error"
        ? "border-rose-300/60 bg-rose-500/20 text-rose-100"
        : "border-emerald-300/60 bg-emerald-500/20 text-emerald-100";

  const summary = `${status.stats.installed} rounds / ${status.stats.playlistsImported} playlists / ${status.stats.updated} updated / ${status.stats.failed} failed`;
  const label =
    status.state === "running"
      ? `Scan running (${summary})`
      : status.state === "aborted"
        ? `Scan aborted (${summary})`
      : status.state === "error"
        ? `Scan error (${summary})`
        : `Last scan done (${summary})`;

  return (
    <div className={`rounded-xl border px-3 py-1.5 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] ${tone}`}>
      {label}
    </div>
  );
}

function InstallImportOverlay({
  status,
  aborting,
  onAbort,
}: {
  status: InstallScanStatus | null;
  aborting: boolean;
  onAbort: () => void;
}) {
  const summary = status
    ? `${status.stats.installed} rounds, ${status.stats.playlistsImported} playlists, ${status.stats.updated} updated, ${status.stats.failed} failed`
    : "Preparing import...";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 px-4 backdrop-blur-md">
      <div className="w-full max-w-xl rounded-[2rem] border border-cyan-300/30 bg-zinc-950/95 p-6 shadow-[0_0_60px_rgba(34,211,238,0.18)]">
        <div className="flex items-start gap-4">
          <div className="mt-1 h-4 w-4 shrink-0 rounded-full bg-cyan-300 shadow-[0_0_22px_rgba(34,211,238,0.9)] animate-pulse" />
          <div className="flex-1 space-y-4">
            <div>
              <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.32em] text-cyan-200/85">
                Long Import Running
              </p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-zinc-50">
                Installing rounds can take a very long time.
              </h2>
              <p className="mt-3 text-sm leading-6 text-zinc-300">
                Hashes may need to be calculated, and video transcoding or preview generation may also be required.
                If you do not abort, you need to wait until the import finishes.
              </p>
            </div>

            <div className="rounded-2xl border border-cyan-300/20 bg-cyan-500/10 p-4">
              <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.22em] text-cyan-100">
                Progress
              </p>
              <p className="mt-2 text-sm text-zinc-100">{summary}</p>
              <p className="mt-2 text-sm text-zinc-300">
                {status?.lastMessage ?? "Scanning files and preparing imported rounds..."}
              </p>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={onAbort}
                disabled={aborting}
                className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.22em] transition-all duration-200 ${
                  aborting
                    ? "cursor-wait border-zinc-700 bg-zinc-800 text-zinc-500"
                    : "border-rose-300/55 bg-rose-500/20 text-rose-100 hover:border-rose-200/80 hover:bg-rose-500/35"
                }`}
              >
                {aborting ? "Aborting..." : "Abort Import"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InstalledDatabaseExportDialog({
  state,
  exporting,
  openingFolder,
  onClose,
  onChange,
  onSubmit,
  onOpenFolder,
}: {
  state: InstalledDatabaseExportDialogState;
  exporting: boolean;
  openingFolder: boolean;
  onClose: () => void;
  onChange: (
    next:
      | InstalledDatabaseExportDialogState
      | ((current: InstalledDatabaseExportDialogState) => InstalledDatabaseExportDialogState),
  ) => void;
  onSubmit: () => void;
  onOpenFolder: () => void;
}) {
  const hasResult = Boolean(state.result);
  const disableClose = exporting || openingFolder;

  return (
    <div
      className="fixed inset-0 z-[75] overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.18),transparent_35%),rgba(2,6,23,0.84)] px-4 py-6 backdrop-blur-md sm:flex sm:items-center sm:justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="installed-database-export-title"
    >
      <div className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-[2rem] border border-cyan-300/30 bg-slate-950/95 shadow-[0_30px_120px_rgba(8,145,178,0.3)] sm:max-h-[calc(100vh-3rem)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.16),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.18),transparent_35%)]" />
        <div className="relative space-y-6 p-6 sm:max-h-[calc(100vh-3rem)] sm:overflow-y-auto sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-3">
              <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.34em] text-cyan-200/85">
                Installed Database Export
              </p>
              <div>
                <h2 id="installed-database-export-title" className="text-3xl font-black tracking-tight text-white sm:text-4xl">
                  {hasResult ? "Export complete." : "Package your installed rounds."}
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                  {hasResult
                    ? "Your export is ready in the app export library. You can jump straight to the folder or close this dialog."
                    : "No system file picker is needed here. Exports are written into the app-managed export library so the flow stays inside the app."}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={disableClose}
              className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] ${
                disableClose
                  ? "cursor-not-allowed border-slate-700 bg-slate-900 text-slate-500"
                  : "border-slate-600/80 bg-black/30 text-slate-300 transition-all duration-200 hover:border-cyan-200/60 hover:text-white"
              }`}
            >
              Close
            </button>
          </div>

          {hasResult ? (
            <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-[1.5rem] border border-emerald-300/25 bg-emerald-500/10 p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-300/35 bg-emerald-400/15 text-2xl text-emerald-100">
                    ✓
                  </div>
                  <div>
                    <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.24em] text-emerald-100/80">
                      Export Ready
                    </p>
                    <p className="text-sm text-emerald-50">
                      Resource URIs included: {state.result?.includeResourceUris ? "yes" : "no"}
                    </p>
                  </div>
                </div>
                <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.22em] text-slate-400">
                    Export Folder
                  </p>
                  <p className="mt-2 break-all text-sm text-white">{state.result?.exportDir}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 rounded-[1.5rem] border border-cyan-300/18 bg-cyan-500/8 p-5 text-sm text-slate-100">
                <ExportStat label="Heroes" value={state.result?.heroFiles ?? 0} />
                <ExportStat label="Standalone" value={state.result?.roundFiles ?? 0} />
                <ExportStat label="Total Rounds" value={state.result?.exportedRounds ?? 0} />
                <ExportStat label="Mode" value={state.result?.includeResourceUris ? "Advanced" : "Safe"} />
              </div>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={() =>
                    onChange((current) => ({
                      ...current,
                      includeResourceUris: false,
                      acknowledgedUriRisk: false,
                      error: null,
                      result: null,
                    }))
                  }
                  className={`w-full rounded-[1.5rem] border p-5 text-left transition-all duration-200 ${
                    !state.includeResourceUris
                      ? "border-cyan-200/75 bg-cyan-400/14 shadow-[0_0_35px_rgba(34,211,238,0.18)]"
                      : "border-slate-700/90 bg-slate-900/75 hover:border-cyan-300/35 hover:bg-slate-900"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.22em] text-cyan-100/85">
                        Recommended
                      </p>
                      <h3 className="mt-2 text-xl font-bold text-white">Safe export</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-300">
                        Writes clean `.round` and `.hero` files without embedding resource URIs. Best for backups and portable sharing.
                      </p>
                    </div>
                    <SelectionChip selected={!state.includeResourceUris} />
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    onChange((current) => ({
                      ...current,
                      includeResourceUris: true,
                      error: null,
                      result: null,
                    }))
                  }
                  className={`w-full rounded-[1.5rem] border p-5 text-left transition-all duration-200 ${
                    state.includeResourceUris
                      ? "border-amber-200/70 bg-amber-400/12 shadow-[0_0_35px_rgba(251,191,36,0.16)]"
                      : "border-slate-700/90 bg-slate-900/75 hover:border-amber-300/35 hover:bg-slate-900"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.22em] text-amber-100/85">
                        Advanced
                      </p>
                      <h3 className="mt-2 text-xl font-bold text-white">Include resource URIs</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-300">
                        Only use this when media is remotely hosted and intentionally addressable outside this machine.
                      </p>
                    </div>
                    <SelectionChip selected={state.includeResourceUris} tone="amber" />
                  </div>
                </button>
              </div>

              <div className="rounded-[1.5rem] border border-slate-700/80 bg-black/25 p-5">
                <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.22em] text-slate-400">
                  Workflow
                </p>
                <div className="mt-4 space-y-3 text-sm text-slate-200">
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                    <p className="font-semibold text-white">1. Review export mode</p>
                    <p className="mt-1 leading-6 text-slate-300">Safe mode is the default. Switch to advanced only when URIs are intentional.</p>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                    <p className="font-semibold text-white">2. Export into the app library</p>
                    <p className="mt-1 leading-6 text-slate-300">The export lands in a timestamped folder that stays easy to reopen from this page.</p>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                    <p className="font-semibold text-white">3. Open the folder after completion</p>
                    <p className="mt-1 leading-6 text-slate-300">Use the success state below to jump straight to the generated package.</p>
                  </div>
                </div>

                {state.includeResourceUris && (
                  <label className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-300/30 bg-amber-500/10 px-4 py-4 text-sm text-amber-50">
                    <input
                      type="checkbox"
                      checked={state.acknowledgedUriRisk}
                      onChange={(event) =>
                        onChange((current) => ({
                          ...current,
                          acknowledgedUriRisk: event.target.checked,
                          error: null,
                        }))
                      }
                      className="mt-0.5 h-4 w-4 rounded border-amber-200/50 bg-black/30"
                    />
                    <span className="leading-6">
                      I understand this can leak or break resource paths unless the referenced media is deliberately hosted and shareable.
                    </span>
                  </label>
                )}
              </div>
            </div>
          )}

          {state.error && (
            <p className="rounded-2xl border border-rose-300/35 bg-rose-500/15 px-4 py-3 text-sm text-rose-100">
              {state.error}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-2">
            <p className="text-sm text-slate-400">
              {hasResult
                ? "You can close this dialog or open the folder now."
                : state.includeResourceUris
                  ? "Advanced mode stays blocked until the warning is acknowledged."
                  : "Safe mode exports immediately with no embedded resource URIs."}
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={onOpenFolder}
                disabled={openingFolder}
                className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.22em] transition-all duration-200 ${
                  openingFolder
                    ? "cursor-wait border-slate-700 bg-slate-900 text-slate-500"
                    : "border-sky-300/55 bg-sky-500/20 text-sky-100 hover:border-sky-200/80 hover:bg-sky-500/35"
                }`}
              >
                {openingFolder ? "Opening..." : hasResult ? "Open Export Folder" : "Browse Export Library"}
              </button>
              {!hasResult && (
                <button
                  type="button"
                  onClick={onSubmit}
                  disabled={exporting || (state.includeResourceUris && !state.acknowledgedUriRisk)}
                  className={`rounded-xl border px-5 py-2.5 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.22em] transition-all duration-200 ${
                    exporting || (state.includeResourceUris && !state.acknowledgedUriRisk)
                      ? "cursor-not-allowed border-slate-700 bg-slate-900 text-slate-500"
                      : "border-cyan-300/60 bg-cyan-500/22 text-cyan-100 hover:border-cyan-200/85 hover:bg-cyan-500/36"
                  }`}
                >
                  {exporting ? "Exporting..." : state.includeResourceUris ? "Start Advanced Export" : "Start Safe Export"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LibraryStatCard({
  label,
  value,
  description,
  tone = "violet",
}: {
  label: string;
  value: string | number;
  description: string;
  tone?: "violet" | "cyan" | "emerald" | "pink" | "amber";
}) {
  const toneClass =
    tone === "cyan"
      ? "border-cyan-300/25 bg-cyan-500/10"
      : tone === "emerald"
        ? "border-emerald-300/25 bg-emerald-500/10"
        : tone === "pink"
          ? "border-pink-300/25 bg-pink-500/10"
          : tone === "amber"
            ? "border-amber-300/25 bg-amber-500/10"
            : "border-violet-300/25 bg-violet-500/10";

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-300">{label}</p>
      <p className="mt-2 text-2xl font-black tracking-tight text-zinc-50">{value}</p>
      <p className="mt-2 text-sm text-zinc-400">{description}</p>
    </div>
  );
}

function RoundActionButton({
  label,
  onClick,
  onHover,
  disabled = false,
  description,
  tone = "violet",
}: {
  label: string;
  onClick: () => void;
  onHover: () => void;
  disabled?: boolean;
  description?: string;
  tone?: "violet" | "emerald" | "cyan" | "sky";
}) {
  const activeToneClass =
    tone === "emerald"
      ? "border-emerald-300/55 bg-emerald-500/18 text-emerald-100 hover:border-emerald-200/80 hover:bg-emerald-500/30"
      : tone === "cyan"
        ? "border-cyan-300/55 bg-cyan-500/18 text-cyan-100 hover:border-cyan-200/80 hover:bg-cyan-500/30"
        : tone === "sky"
          ? "border-sky-300/55 bg-sky-500/18 text-sky-100 hover:border-sky-200/80 hover:bg-sky-500/30"
          : "border-violet-300/55 bg-violet-500/18 text-violet-100 hover:border-violet-200/80 hover:bg-violet-500/30";

  return (
    <button
      type="button"
      disabled={disabled}
      onMouseEnter={onHover}
      onFocus={onHover}
      onClick={onClick}
      className={`rounded-2xl border px-4 py-3 text-left font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.18em] transition-all duration-200 ${
        disabled ? "cursor-not-allowed border-zinc-700 bg-zinc-900/70 text-zinc-500" : activeToneClass
      }`}
    >
      <div>{label}</div>
      {description && <div className="mt-2 text-[11px] normal-case tracking-normal opacity-80">{description}</div>}
    </button>
  );
}

function ExportStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
      <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className="mt-2 text-xl font-bold text-white">{value}</p>
    </div>
  );
}

function SelectionChip({ selected, tone = "cyan" }: { selected: boolean; tone?: "cyan" | "amber" }) {
  const selectedClasses =
    tone === "amber"
      ? "border-amber-200/70 bg-amber-300/20 text-amber-50"
      : "border-cyan-200/70 bg-cyan-300/20 text-cyan-50";

  return (
    <span
      className={`inline-flex min-w-20 items-center justify-center rounded-full border px-3 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.22em] ${
        selected ? selectedClasses : "border-slate-600 bg-slate-900 text-slate-400"
      }`}
    >
      {selected ? "Selected" : "Idle"}
    </span>
  );
}

type GameOption<T extends string> = {
  value: T;
  label: string;
};

function GameDropdown<T extends string>({
  label,
  value,
  options,
  onChange,
  onHoverSfx,
  onSelectSfx,
}: {
  label: string;
  value: T;
  options: GameOption<T>[];
  onChange: (next: T) => void;
  onHoverSfx: () => void;
  onSelectSfx: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const selected = options.find((opt) => opt.value === value) ?? options[0];

  return (
    <div ref={rootRef} className="relative">
      <span className="mb-2 block font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.25em] text-zinc-300">{label}</span>
      <button
        type="button"
        onMouseEnter={onHoverSfx}
        onFocus={onHoverSfx}
        onClick={() => {
          onSelectSfx();
          setOpen((prev) => !prev);
        }}
        className="flex w-full items-center justify-between rounded-xl border border-violet-300/30 bg-black/45 px-4 py-3 text-sm text-zinc-100 outline-none transition-all duration-200 hover:border-violet-200/60 focus:border-violet-200/70 focus:ring-2 focus:ring-violet-400/30"
      >
        <span>{selected.label}</span>
        <span className={`text-xs text-violet-200 transition-transform duration-200 ${open ? "rotate-180" : ""}`}>▾</span>
      </button>

      {open && (
        <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-xl border border-violet-300/35 bg-zinc-950/95 shadow-[0_0_24px_rgba(139,92,246,0.38)] backdrop-blur-xl">
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                onMouseEnter={onHoverSfx}
                onClick={() => {
                  onSelectSfx();
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition-colors duration-150 ${active ? "bg-violet-500/25 text-violet-100" : "text-zinc-200 hover:bg-violet-500/15"}`}
              >
                <span>{option.label}</span>
                {active && <span className="text-xs text-violet-200">●</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MetaItem({ label, value, tone = "cyan" }: { label: string; value: string; tone?: "cyan" | "pink" | "emerald" | "orange" | "violet" | "indigo" }) {
  const toneClass =
    tone === "pink"
      ? "border-pink-300/28 bg-pink-500/10"
      : tone === "emerald"
        ? "border-emerald-300/28 bg-emerald-500/10"
        : tone === "orange"
          ? "border-orange-300/28 bg-orange-500/10"
          : tone === "violet"
            ? "border-violet-300/28 bg-violet-500/10"
            : tone === "indigo"
              ? "border-indigo-300/28 bg-indigo-500/10"
              : "border-cyan-300/28 bg-cyan-500/10";

  return (
    <div className={`min-w-0 rounded-2xl border px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors duration-300 ${toneClass}`}>
      <p className="truncate font-[family-name:var(--font-jetbrains-mono)] text-[9px] uppercase tracking-[0.22em] text-zinc-400">
        {label}
      </p>
      <p
        className="mt-1 truncate font-[family-name:var(--font-jetbrains-mono)] text-[11px] tracking-[0.08em] text-zinc-100"
        title={value}
      >
        {value}
      </p>
    </div>
  );
}

function TechnicalDetail({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className={`min-w-0 rounded-xl border border-white/6 bg-white/[0.03] px-2.5 py-2 ${className}`.trim()}>
      <p className="text-[9px] uppercase tracking-[0.2em] text-zinc-500">{label}</p>
      <p className="mt-1 break-all text-[10px] uppercase text-zinc-200">{value}</p>
    </div>
  );
}

function formatWindow(startTime: number | null, endTime: number | null): string {
  if (typeof startTime !== "number" || !Number.isFinite(startTime)) {
    return "Full";
  }
  const startLabel = formatMediaTimestamp(startTime);
  if (typeof endTime !== "number" || !Number.isFinite(endTime) || endTime <= startTime) {
    return `${startLabel}+`;
  }
  return `${startLabel}-${formatMediaTimestamp(endTime)}`;
}

function formatDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatMediaTimestamp(valueMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(valueMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
