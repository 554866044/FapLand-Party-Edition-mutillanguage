import React, { useEffect, useMemo, useState } from "react";
import { db, type InstalledRound } from "../../services/db";
import { trpc } from "../../services/trpc";
import { playHoverSound, playSelectSound } from "../../utils/audio";
import {
  DEFAULT_INSTALL_WEB_FUNSCRIPT_URL_ENABLED,
  INSTALL_WEB_FUNSCRIPT_URL_ENABLED_KEY,
  normalizeInstallWebFunscriptUrlEnabled,
} from "../../constants/experimentalFeatures";
import { ConverterSelectionCard } from "./ConverterSelectionCard";

type SourceSection = "round" | "hero" | "file" | "url";

type HeroSummary = {
  id: string;
  name: string;
  author: string | null;
  description: string | null;
  roundCount: number;
  totalDurationMs: number;
};

type ConverterSourcePickerProps = {
  section: SourceSection;
  onSelectRound: (roundId: string) => void;
  onSelectHero: (heroId: string) => void;
  onSelectLocalVideo: () => void;
  onSelectLocalFunscript: () => void;
  onSelectWebsiteSource: (videoUri: string, funscriptUri: string | null) => void;
};

function normalizeHttpUrl(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    if (!(parsed.protocol === "http:" || parsed.protocol === "https:")) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export const ConverterSourcePicker: React.FC<ConverterSourcePickerProps> = React.memo(
  ({
    section,
    onSelectRound,
    onSelectHero,
    onSelectLocalVideo,
    onSelectLocalFunscript,
    onSelectWebsiteSource,
  }) => {
    const [rounds, setRounds] = useState<InstalledRound[]>([]);
    const [heroes, setHeroes] = useState<HeroSummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [websiteVideoUrl, setWebsiteVideoUrl] = useState("");
    const [websiteFunscriptUrl, setWebsiteFunscriptUrl] = useState("");
    const [websiteFunscriptFileUri, setWebsiteFunscriptFileUri] = useState<string | null>(null);
    const [websiteFunscriptFileLabel, setWebsiteFunscriptFileLabel] = useState<string | null>(null);
    const [websitePickerError, setWebsitePickerError] = useState<string | null>(null);
    const [installWebFunscriptUrlEnabled, setInstallWebFunscriptUrlEnabled] = useState(
      DEFAULT_INSTALL_WEB_FUNSCRIPT_URL_ENABLED
    );

    useEffect(() => {
      let mounted = true;

      const loadData = async () => {
        setIsLoading(true);
        try {
          const [allRounds, allHeroes, rawInstallWebFunscriptUrlEnabled] = await Promise.all([
            db.round.findInstalled(true),
            db.hero.findMany(),
            trpc.store.get.query({ key: INSTALL_WEB_FUNSCRIPT_URL_ENABLED_KEY }),
          ]);

          if (!mounted) return;

          setInstallWebFunscriptUrlEnabled(
            normalizeInstallWebFunscriptUrlEnabled(rawInstallWebFunscriptUrlEnabled)
          );

          const standaloneRounds = allRounds.filter(
            (round) => !round.heroId && round.resources.length > 0
          );
          setRounds(standaloneRounds);

          const heroSummaries: HeroSummary[] = allHeroes
            .map((hero) => {
              const heroRounds = allRounds.filter(
                (round) => round.heroId === hero.id && round.resources.length > 0
              );
              const totalDurationMs = heroRounds.reduce(
                (sum, round) => sum + (round.endTime ?? 0) - (round.startTime ?? 0),
                0
              );
              return {
                id: hero.id,
                name: hero.name,
                author: hero.author ?? null,
                description: hero.description ?? null,
                roundCount: heroRounds.length,
                totalDurationMs,
              };
            })
            .filter((hero) => hero.roundCount > 0)
            .sort((a, b) => a.name.localeCompare(b.name));

          setHeroes(heroSummaries);
        } catch (error) {
          console.error("Failed to load converter source data", error);
        } finally {
          if (mounted) setIsLoading(false);
        }
      };

      void loadData();

      return () => {
        mounted = false;
      };
    }, []);

    const filteredRounds = useMemo(() => {
      const query = searchQuery.trim().toLowerCase();
      if (!query) return rounds;
      return rounds.filter((round) => {
        const searchText = [
          round.name,
          round.author ?? "",
          round.description ?? "",
        ]
          .join(" ")
          .toLowerCase();
        return searchText.includes(query);
      });
    }, [rounds, searchQuery]);

    const filteredHeroes = useMemo(() => {
      const query = searchQuery.trim().toLowerCase();
      if (!query) return heroes;
      return heroes.filter((hero) => {
        const searchText = [
          hero.name,
          hero.author ?? "",
          hero.description ?? "",
        ]
          .join(" ")
          .toLowerCase();
        return searchText.includes(query);
      });
    }, [heroes, searchQuery]);

    if (section === "file") {
      return (
        <div className="space-y-4">
          <div className="rounded-2xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl">
            <h3 className="text-lg font-bold text-violet-100">Local Video File</h3>
            <p className="mt-1 text-sm text-zinc-400">
              Select a video file from your computer to convert into rounds.
            </p>
            <button
              type="button"
              onMouseEnter={playHoverSound}
              onClick={() => {
                playSelectSound();
                onSelectLocalVideo();
              }}
              className="mt-4 rounded-xl border border-violet-300/60 bg-violet-500/30 px-5 py-3 text-sm font-semibold text-violet-100 transition-all duration-200 hover:border-violet-200/80 hover:bg-violet-500/45"
            >
              Select Video File
            </button>
          </div>

          <div className="rounded-2xl border border-cyan-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl">
            <h3 className="text-lg font-bold text-cyan-100">Attach Funscript (Optional)</h3>
            <p className="mt-1 text-sm text-zinc-400">
              Attach a funscript file for auto-detection of round boundaries.
            </p>
            <button
              type="button"
              onMouseEnter={playHoverSound}
              onClick={() => {
                playSelectSound();
                onSelectLocalFunscript();
              }}
              className="mt-4 rounded-xl border border-cyan-300/60 bg-cyan-500/30 px-5 py-3 text-sm font-semibold text-cyan-100 transition-all duration-200 hover:border-cyan-200/80 hover:bg-cyan-500/45"
            >
              Select Funscript File
            </button>
          </div>
        </div>
      );
    }

    if (section === "url") {
      return (
        <div className="space-y-4">
          <div className="rounded-2xl border border-violet-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl">
            <h3 className="text-lg font-bold text-violet-100">Website Video URL</h3>
            <p className="mt-1 text-sm text-zinc-400">
              Paste a supported website video URL and jump straight into the converter. The app will cache the video first, then you can start editing.
            </p>

            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">
                  Video URL
                </span>
                <input
                  type="url"
                  value={websiteVideoUrl}
                  onChange={(event) => {
                    setWebsiteVideoUrl(event.target.value);
                    setWebsitePickerError(null);
                  }}
                  placeholder="https://www.pornhub.com/view_video.php?viewkey=..."
                  className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-4 py-3 text-sm text-zinc-100 outline-none transition-colors focus:border-violet-200/75"
                />
              </label>

              {installWebFunscriptUrlEnabled && (
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">
                    Funscript URL
                  </span>
                  <input
                    type="url"
                    value={websiteFunscriptUrl}
                    onChange={(event) => {
                      setWebsiteFunscriptUrl(event.target.value);
                      setWebsiteFunscriptFileUri(null);
                      setWebsiteFunscriptFileLabel(null);
                      setWebsitePickerError(null);
                    }}
                    placeholder="Optional: https://example.com/video.funscript"
                    className="w-full rounded-xl border border-cyan-300/30 bg-black/45 px-4 py-3 text-sm text-zinc-100 outline-none transition-colors focus:border-cyan-200/75"
                  />
                </label>
              )}
            </div>

            {websitePickerError ? (
              <div className="mt-3 rounded-xl border border-rose-300/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                {websitePickerError}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onMouseEnter={playHoverSound}
                onClick={() => {
                  playSelectSound();
                  void window.electronAPI.dialog.selectConverterFunscriptFile().then((filePath) => {
                    if (!filePath) return;
                    const converted = window.electronAPI.file.convertFileSrc(filePath);
                    setWebsiteFunscriptFileUri(converted);
                    setWebsiteFunscriptFileLabel(filePath.split(/[/\\]/).pop() ?? filePath);
                    setWebsiteFunscriptUrl("");
                    setWebsitePickerError(null);
                  });
                }}
                className="rounded-xl border border-cyan-300/60 bg-cyan-500/25 px-5 py-3 text-sm font-semibold text-cyan-100 transition-all duration-200 hover:border-cyan-200/80 hover:bg-cyan-500/40"
              >
                Select Local Funscript
              </button>
              <button
                type="button"
                onMouseEnter={playHoverSound}
                onClick={() => {
                  playSelectSound();
                  const normalizedVideoUrl = normalizeHttpUrl(websiteVideoUrl);
                  if (!normalizedVideoUrl) {
                    setWebsitePickerError("Enter a valid http(s) video URL.");
                    return;
                  }

                  const trimmedFunscriptUrl = websiteFunscriptUrl.trim();
                  const normalizedFunscriptUrl = trimmedFunscriptUrl.length > 0
                    ? normalizeHttpUrl(trimmedFunscriptUrl)
                    : null;
                  if (trimmedFunscriptUrl.length > 0 && !normalizedFunscriptUrl) {
                    setWebsitePickerError("Funscript URL must also be a valid http(s) URL.");
                    return;
                  }

                  setWebsitePickerError(null);
                  onSelectWebsiteSource(
                    normalizedVideoUrl,
                    websiteFunscriptFileUri ?? normalizedFunscriptUrl,
                  );
                }}
                className="rounded-xl border border-violet-300/60 bg-violet-500/30 px-5 py-3 text-sm font-semibold text-violet-100 transition-all duration-200 hover:border-violet-200/80 hover:bg-violet-500/45"
              >
                Use Website Source
              </button>
            </div>

            {websiteFunscriptFileLabel ? (
              <div className="mt-3 rounded-xl border border-cyan-300/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
                Local funscript attached: {websiteFunscriptFileLabel}
              </div>
            ) : null}

            <div className="mt-4 rounded-xl border border-zinc-700/70 bg-black/30 px-4 py-3 text-xs text-zinc-400">
              Supported in practice through yt-dlp-backed playback. Paste sites like Pornhub,
              XVideos, or xHamster here, then add segments the same way as any other source.
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-purple-400/20 bg-black/30 p-3">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search ${section === "round" ? "rounds" : "heroes"}...`}
            className="w-full rounded-xl border border-zinc-700/80 bg-black/40 px-4 py-2 text-sm text-zinc-100 outline-none transition-colors focus:border-violet-400/60 focus:ring-2 focus:ring-violet-400/20"
          />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-sm text-zinc-400">Loading...</div>
          </div>
        ) : section === "round" ? (
          filteredRounds.length === 0 ? (
            <div className="rounded-2xl border border-zinc-700/50 bg-black/20 p-8 text-center">
              <p className="text-sm text-zinc-400">
                {searchQuery.trim()
                  ? "No rounds match your search."
                  : "No standalone rounds available. Install some rounds first."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredRounds.map((round) => {
                const resource = round.resources[0];
                const durationMs =
                  round.endTime != null && round.startTime != null
                    ? round.endTime - round.startTime
                    : null;
                return (
                  <ConverterSelectionCard
                    key={round.id}
                    kind="round"
                    name={round.name}
                    author={round.author}
                    description={round.description}
                    type={round.type}
                    bpm={round.bpm}
                    durationMs={durationMs}
                    hasFunscript={Boolean(resource?.funscriptUri)}
                    previewImage={round.previewImage}
                    previewVideoUri={resource?.videoUri ?? null}
                    previewStartTimeMs={round.startTime}
                    previewEndTimeMs={round.endTime}
                    onClick={() => onSelectRound(round.id)}
                  />
                );
              })}
            </div>
          )
        ) : filteredHeroes.length === 0 ? (
          <div className="rounded-2xl border border-zinc-700/50 bg-black/20 p-8 text-center">
            <p className="text-sm text-zinc-400">
              {searchQuery.trim()
                ? "No heroes match your search."
                : "No heroes with rounds available. Create a hero first."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredHeroes.map((hero) => (
              <ConverterSelectionCard
                key={hero.id}
                kind="hero"
                name={hero.name}
                author={hero.author}
                description={hero.description}
                roundCount={hero.roundCount}
                durationMs={hero.totalDurationMs}
                onClick={() => onSelectHero(hero.id)}
              />
            ))}
          </div>
        )}
      </div>
    );
  }
);

ConverterSourcePicker.displayName = "ConverterSourcePicker";
