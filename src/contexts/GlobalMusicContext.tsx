import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  clampMusicVolume,
  DEFAULT_MUSIC_ENABLED,
  DEFAULT_MUSIC_LOOP_MODE,
  DEFAULT_MUSIC_SHUFFLE,
  DEFAULT_MUSIC_VOLUME,
  MUSIC_CURRENT_INDEX_KEY,
  MUSIC_ENABLED_KEY,
  MUSIC_LOOP_MODE_KEY,
  MUSIC_QUEUE_KEY,
  MUSIC_SHUFFLE_KEY,
  MUSIC_VOLUME_KEY,
  normalizeMusicCurrentIndex,
  normalizeMusicLoopMode,
  normalizeMusicQueue,
  type MusicLoopMode,
  type MusicQueueEntry,
} from "../constants/musicSettings";
import { trpc } from "../services/trpc";
import { useForegroundMedia } from "./ForegroundMediaContext";

export type GlobalMusicState = {
  enabled: boolean;
  queue: MusicQueueEntry[];
  currentIndex: number;
  currentTrack: MusicQueueEntry | null;
  isPlaying: boolean;
  isSuppressedByVideo: boolean;
  volume: number;
  shuffle: boolean;
  loopMode: MusicLoopMode;
};

export type GlobalMusicActions = {
  setEnabled: (next: boolean) => Promise<void>;
  addTracks: (filePaths: string[]) => Promise<void>;
  removeTrack: (id: string) => Promise<void>;
  moveTrack: (id: string, direction: "up" | "down") => Promise<void>;
  clearQueue: () => Promise<void>;
  play: () => Promise<void>;
  pause: () => void;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  setCurrentTrack: (id: string) => Promise<void>;
  setVolume: (next: number) => Promise<void>;
  setShuffle: (next: boolean) => Promise<void>;
  setLoopMode: (next: MusicLoopMode) => Promise<void>;
};

type GlobalMusicContextValue = GlobalMusicState & GlobalMusicActions;

const GlobalMusicContext = createContext<GlobalMusicContextValue | null>(null);

function getTrackName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.split("/").pop()?.trim() || "Unknown Track";
}

function buildQueueEntries(filePaths: string[]): MusicQueueEntry[] {
  return filePaths
    .map((filePath) => filePath.trim())
    .filter((filePath) => filePath.length > 0)
    .map((filePath, index) => ({
      id: `${Date.now()}-${index}-${filePath}`,
      filePath,
      name: getTrackName(filePath),
    }));
}

function shuffleIndices(indices: number[]): number[] {
  const next = [...indices];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex]!, next[index]!];
  }
  return next;
}

export function GlobalMusicProvider({ children }: { children: React.ReactNode }) {
  const { activeForegroundVideoCount } = useForegroundMedia();
  const [enabled, setEnabledState] = useState(DEFAULT_MUSIC_ENABLED);
  const [queue, setQueue] = useState<MusicQueueEntry[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [volume, setVolumeState] = useState(DEFAULT_MUSIC_VOLUME);
  const [shuffle, setShuffleState] = useState(DEFAULT_MUSIC_SHUFFLE);
  const [loopMode, setLoopModeState] = useState<MusicLoopMode>(DEFAULT_MUSIC_LOOP_MODE);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const userPausedRef = useRef(false);
  const resumeAfterVideoRef = useRef(false);
  const shuffleBagRef = useRef<number[]>([]);
  const currentIndexRef = useRef(0);
  const getNextIndexRef = useRef<(fromIndex: number) => number | null>(() => null);
  const activeTrackPathRef = useRef<string | null>(null);

  const currentTrack = queue[currentIndex] ?? null;
  const isSuppressedByVideo = activeForegroundVideoCount > 0;

  const persist = useCallback(async (key: string, value: unknown) => {
    await trpc.store.set.mutate({ key, value });
  }, []);

  const setAndPersistQueue = useCallback(async (nextQueue: MusicQueueEntry[], nextIndex: number) => {
    setQueue(nextQueue);
    setCurrentIndex(nextIndex);
    await Promise.all([
      persist(MUSIC_QUEUE_KEY, nextQueue),
      persist(MUSIC_CURRENT_INDEX_KEY, nextIndex),
    ]);
  }, [persist]);

  const tryPlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !currentTrack || !enabled || isSuppressedByVideo) return;
    try {
      await audio.play();
      setIsPlaying(true);
    } catch (error) {
      console.warn("Failed to start global music playback", error);
    }
  }, [currentTrack, enabled, isSuppressedByVideo]);

  const getNextIndex = useCallback((fromIndex: number): number | null => {
    if (queue.length === 0) return null;
    if (loopMode === "track") return fromIndex;

    if (shuffle) {
      if (shuffleBagRef.current.length === 0) {
        const candidates = Array.from({ length: queue.length }, (_, index) => index).filter((index) => index !== fromIndex);
        if (candidates.length === 0) {
          return loopMode === "queue" ? fromIndex : null;
        }
        shuffleBagRef.current = shuffleIndices(candidates);
      }
      const nextIndex = shuffleBagRef.current.shift() ?? null;
      if (nextIndex === null && loopMode === "queue") {
        shuffleBagRef.current = shuffleIndices(Array.from({ length: queue.length }, (_, index) => index).filter((index) => index !== fromIndex));
        return shuffleBagRef.current.shift() ?? fromIndex;
      }
      return nextIndex;
    }

    const candidate = fromIndex + 1;
    if (candidate < queue.length) return candidate;
    return loopMode === "queue" ? 0 : null;
  }, [loopMode, queue.length, shuffle]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    getNextIndexRef.current = getNextIndex;
  }, [getNextIndex]);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audio.volume = DEFAULT_MUSIC_VOLUME;
    audioRef.current = audio;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => {
      const nextIndex = getNextIndexRef.current(currentIndexRef.current);
      if (nextIndex === null) {
        setIsPlaying(false);
        userPausedRef.current = true;
        return;
      }
      userPausedRef.current = false;
      setCurrentIndex(nextIndex);
      void persist(MUSIC_CURRENT_INDEX_KEY, nextIndex);
    };

    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
      audioRef.current = null;
    };
  }, [persist]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      trpc.store.get.query({ key: MUSIC_ENABLED_KEY }),
      trpc.store.get.query({ key: MUSIC_QUEUE_KEY }),
      trpc.store.get.query({ key: MUSIC_VOLUME_KEY }),
      trpc.store.get.query({ key: MUSIC_SHUFFLE_KEY }),
      trpc.store.get.query({ key: MUSIC_LOOP_MODE_KEY }),
      trpc.store.get.query({ key: MUSIC_CURRENT_INDEX_KEY }),
    ]).then(([rawEnabled, rawQueue, rawVolume, rawShuffle, rawLoopMode, rawCurrentIndex]) => {
      if (cancelled) return;
      const nextQueue = normalizeMusicQueue(rawQueue);
      setEnabledState(typeof rawEnabled === "boolean" ? rawEnabled : DEFAULT_MUSIC_ENABLED);
      setQueue(nextQueue);
      setVolumeState(clampMusicVolume(rawVolume));
      setShuffleState(typeof rawShuffle === "boolean" ? rawShuffle : DEFAULT_MUSIC_SHUFFLE);
      setLoopModeState(normalizeMusicLoopMode(rawLoopMode));
      setCurrentIndex(normalizeMusicCurrentIndex(rawCurrentIndex, nextQueue.length));
      setHasLoaded(true);
    }).catch((error) => {
      console.warn("Failed to load music settings", error);
      if (!cancelled) setHasLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
  }, [volume]);

  useEffect(() => {
    shuffleBagRef.current = [];
  }, [queue, shuffle, loopMode]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!currentTrack) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      activeTrackPathRef.current = null;
      setIsPlaying(false);
      return;
    }
    const nextSrc = window.electronAPI.file.convertFileSrc(currentTrack.filePath);
    if (activeTrackPathRef.current === currentTrack.filePath) return;
    const shouldAutoplay = enabled && !isSuppressedByVideo && !userPausedRef.current;
    activeTrackPathRef.current = currentTrack.filePath;
    audio.src = nextSrc;
    audio.load();
    if (shouldAutoplay) {
      audio.currentTime = 0;
      void tryPlay();
    } else {
      setIsPlaying(false);
    }
  }, [currentTrack, enabled, isSuppressedByVideo, tryPlay]);

  useEffect(() => {
    if (!hasLoaded) return;
    const audio = audioRef.current;
    if (!audio) return;

    if (isSuppressedByVideo) {
      if (!audio.paused) {
        resumeAfterVideoRef.current = true;
        audio.pause();
      }
      return;
    }

    if (resumeAfterVideoRef.current && enabled && currentTrack && !userPausedRef.current) {
      resumeAfterVideoRef.current = false;
      void tryPlay();
      return;
    }

    if (!userPausedRef.current && enabled && currentTrack && audio.paused && audio.currentTime === 0) {
      void tryPlay();
    }
  }, [currentTrack, enabled, hasLoaded, isSuppressedByVideo, tryPlay]);

  const setEnabled = useCallback(async (next: boolean) => {
    setEnabledState(next);
    await persist(MUSIC_ENABLED_KEY, next);
    if (!next) {
      resumeAfterVideoRef.current = false;
      userPausedRef.current = true;
      audioRef.current?.pause();
      return;
    }
    if (queue.length > 0) {
      userPausedRef.current = false;
      await tryPlay();
    }
  }, [persist, queue.length, tryPlay]);

  const addTracks = useCallback(async (filePaths: string[]) => {
    const nextEntries = buildQueueEntries(filePaths)
      .filter((entry) => !queue.some((existing) => existing.filePath === entry.filePath));
    if (nextEntries.length === 0) return;
    const nextQueue = [...queue, ...nextEntries];
    const nextIndex = queue.length === 0 ? 0 : currentIndex;
    userPausedRef.current = false;
    await setAndPersistQueue(nextQueue, nextIndex);
  }, [currentIndex, queue, setAndPersistQueue]);

  const removeTrack = useCallback(async (id: string) => {
    const targetIndex = queue.findIndex((entry) => entry.id === id);
    if (targetIndex < 0) return;
    const nextQueue = queue.filter((entry) => entry.id !== id);
    const nextIndex = nextQueue.length === 0
      ? 0
      : targetIndex < currentIndex
        ? currentIndex - 1
        : targetIndex === currentIndex
          ? Math.min(currentIndex, nextQueue.length - 1)
          : currentIndex;
    if (nextQueue.length === 0) {
      userPausedRef.current = true;
      audioRef.current?.pause();
    }
    await setAndPersistQueue(nextQueue, nextIndex);
  }, [currentIndex, queue, setAndPersistQueue]);

  const moveTrack = useCallback(async (id: string, direction: "up" | "down") => {
    const index = queue.findIndex((entry) => entry.id === id);
    if (index < 0) return;
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= queue.length) return;
    const nextQueue = [...queue];
    [nextQueue[index], nextQueue[swapIndex]] = [nextQueue[swapIndex]!, nextQueue[index]!];
    let nextCurrentIndex = currentIndex;
    if (currentIndex === index) nextCurrentIndex = swapIndex;
    else if (currentIndex === swapIndex) nextCurrentIndex = index;
    await setAndPersistQueue(nextQueue, nextCurrentIndex);
  }, [currentIndex, queue, setAndPersistQueue]);

  const clearQueue = useCallback(async () => {
    userPausedRef.current = true;
    resumeAfterVideoRef.current = false;
    audioRef.current?.pause();
    await setAndPersistQueue([], 0);
  }, [setAndPersistQueue]);

  const play = useCallback(async () => {
    if (!enabled || !currentTrack || isSuppressedByVideo) return;
    userPausedRef.current = false;
    resumeAfterVideoRef.current = false;
    await tryPlay();
  }, [currentTrack, enabled, isSuppressedByVideo, tryPlay]);

  const pause = useCallback(() => {
    userPausedRef.current = true;
    resumeAfterVideoRef.current = false;
    audioRef.current?.pause();
  }, []);

  const next = useCallback(async () => {
    const nextIndex = getNextIndex(currentIndex);
    if (nextIndex === null) {
      pause();
      return;
    }
    userPausedRef.current = false;
    setCurrentIndex(nextIndex);
    await persist(MUSIC_CURRENT_INDEX_KEY, nextIndex);
  }, [currentIndex, getNextIndex, pause, persist]);

  const previous = useCallback(async () => {
    if (queue.length === 0) return;
    const nextIndex = currentIndex > 0 ? currentIndex - 1 : loopMode === "queue" ? queue.length - 1 : 0;
    userPausedRef.current = false;
    setCurrentIndex(nextIndex);
    await persist(MUSIC_CURRENT_INDEX_KEY, nextIndex);
  }, [currentIndex, loopMode, persist, queue.length]);

  const setCurrentTrack = useCallback(async (id: string) => {
    const nextIndex = queue.findIndex((entry) => entry.id === id);
    if (nextIndex < 0) return;
    userPausedRef.current = false;
    setCurrentIndex(nextIndex);
    await persist(MUSIC_CURRENT_INDEX_KEY, nextIndex);
  }, [persist, queue]);

  const setVolume = useCallback(async (next: number) => {
    const normalized = clampMusicVolume(next);
    setVolumeState(normalized);
    await persist(MUSIC_VOLUME_KEY, normalized);
  }, [persist]);

  const setShuffle = useCallback(async (next: boolean) => {
    setShuffleState(next);
    await persist(MUSIC_SHUFFLE_KEY, next);
  }, [persist]);

  const setLoopMode = useCallback(async (next: MusicLoopMode) => {
    setLoopModeState(next);
    await persist(MUSIC_LOOP_MODE_KEY, next);
  }, [persist]);

  const value = useMemo<GlobalMusicContextValue>(() => ({
    enabled,
    queue,
    currentIndex,
    currentTrack,
    isPlaying,
    isSuppressedByVideo,
    volume,
    shuffle,
    loopMode,
    setEnabled,
    addTracks,
    removeTrack,
    moveTrack,
    clearQueue,
    play,
    pause,
    next,
    previous,
    setCurrentTrack,
    setVolume,
    setShuffle,
    setLoopMode,
  }), [
    addTracks,
    clearQueue,
    currentIndex,
    currentTrack,
    enabled,
    isPlaying,
    isSuppressedByVideo,
    loopMode,
    moveTrack,
    next,
    pause,
    play,
    previous,
    queue,
    removeTrack,
    setCurrentTrack,
    setEnabled,
    setLoopMode,
    setShuffle,
    setVolume,
    shuffle,
    volume,
  ]);

  return <GlobalMusicContext.Provider value={value}>{children}</GlobalMusicContext.Provider>;
}

export function useGlobalMusicContext() {
  const context = useContext(GlobalMusicContext);
  if (!context) {
    throw new Error("useGlobalMusicContext must be used within a GlobalMusicProvider.");
  }
  return context;
}
