import type { CSSProperties } from "react";

export type CinematicTransitionFrameProps = {
  title: string;
  overline: string;
  accentLabel?: string | null;
  countdownLabel?: string | null;
  progress: number;
  variant: "playlist-launch" | "round-start";
  metadata?: string[];
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

// Easing functions
const easeOutExpo = (x: number) => (x === 1 ? 1 : 1 - Math.pow(2, -10 * x));
const easeInExpo = (x: number) => (x === 0 ? 0 : Math.pow(2, 10 * x - 10));

export function CinematicTransitionFrame({
  title,
  overline,
  accentLabel,
  countdownLabel,
  progress,
  variant,
  metadata = [],
}: CinematicTransitionFrameProps) {
  const safeProgress = clamp01(progress);
  const isPlaylistLaunch = variant === "playlist-launch";

  // Timeline Math
  // Entry: 0 to 15%
  const entryPhase = Math.min(1, safeProgress / 0.15);
  const entryEase = easeOutExpo(entryPhase);

  // Charge: 15% to 75%
  const chargePhase = Math.max(0, Math.min(1, (safeProgress - 0.15) / 0.6));

  // Warp: 75% to 100%
  const warpPhase = Math.max(0, (safeProgress - 0.75) / 0.25);
  const warpEase = easeInExpo(warpPhase);

  // Derived visuals
  const containerScale = 0.85 + 0.15 * entryEase + 0.05 * chargePhase + 1.2 * warpEase;
  const containerOpacity = entryPhase < 1 ? entryEase : 1 - warpEase * 0.3;

  const titleLetterSpacing = `${0.3 - 0.28 * entryEase}em`;
  const titleBlur = entryPhase < 1 ? `${20 - 20 * entryEase}px` : "0px";

  const rootStyle = {
    "--transition-progress": safeProgress.toFixed(3),
  } as CSSProperties;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
      data-testid="cinematic-transition-root"
      data-variant={variant}
      style={rootStyle}
    >
      {/* Background Deep Space */}
      <div className="absolute inset-0 bg-[#02050d]" />
      <div
        className="absolute inset-0 opacity-80"
        style={{
          background:
            "radial-gradient(circle at 50% 10%, rgba(36, 160, 255, 0.25), transparent 45%), radial-gradient(circle at 50% 90%, rgba(255, 74, 196, 0.2), transparent 45%)",
          transform: `scale(${1 + chargePhase * 0.2 + warpEase * 1.5})`,
          opacity: 1 - warpEase,
        }}
      />

      {/* Grid / Velocity lines */}
      <div
        className="absolute inset-0 opacity-40 mix-blend-screen"
        style={{
          background:
            "repeating-linear-gradient(180deg, rgba(88, 211, 255, 0.08) 0px, rgba(88, 211, 255, 0.08) 2px, transparent 2px, transparent 16px)",
          transform: `translateY(${safeProgress * 150}px) scale(1.1)`,
        }}
      />

      {/* Radial hyper-rings expanding outward */}
      <div className="absolute left-1/2 top-1/2 h-0 w-0 -translate-x-1/2 -translate-y-1/2">
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-400/30"
          style={{
            width: `${safeProgress * 180 + 20}vw`,
            height: `${safeProgress * 180 + 20}vw`,
            opacity: 1 - safeProgress,
          }}
        />
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-fuchsia-400/20 shadow-[0_0_40px_rgba(255,74,196,0.3)]"
          style={{
            width: `${safeProgress * 280}vw`,
            height: `${safeProgress * 280}vw`,
            opacity: 1 - safeProgress,
          }}
        />
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white shadow-[0_0_80px_rgba(255,255,255,0.8)]"
          style={{
            width: `${warpEase * 200 + 10}vw`,
            height: `${warpEase * 200 + 10}vw`,
            opacity: Math.min(1, warpEase * 1.5),
          }}
        />
      </div>

      {/* Scanning Light Line */}
      <div className="absolute inset-0">
        <div
          className="absolute h-[15vh] w-full mix-blend-plus-lighter"
          style={{
            background: "linear-gradient(180deg, transparent, rgba(56, 189, 248, 0.4) 50%, transparent)",
            top: `${-15 + safeProgress * 130}%`,
          }}
        />
        <div
          className="absolute h-px w-full bg-cyan-200/80 shadow-[0_0_15px_rgba(130,222,255,1)]"
          style={{ top: `${safeProgress * 100}%` }}
        />
      </div>

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_40%,rgba(2,5,13,0.9)_100%)]" />

      {/* Top Overline */}
      <div className="absolute inset-x-0 top-[12%] flex justify-center px-6">
        <div
          className="rounded-full border border-cyan-200/40 bg-cyan-950/40 px-5 py-1.5 font-[family-name:var(--font-jetbrains-mono)] text-[11px] font-bold uppercase tracking-[0.5em] text-cyan-100 backdrop-blur-xl shadow-[0_0_20px_rgba(56,189,248,0.3)]"
          style={{
            opacity: entryEase,
            transform: `translateY(${20 - 20 * entryEase}px)`,
          }}
        >
          {overline}
        </div>
      </div>

      {/* Main Card */}
      <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center px-4">
        <div
          className={[
            "relative overflow-hidden rounded-[2rem] border backdrop-blur-3xl",
            isPlaylistLaunch
              ? "w-[min(92vw,58rem)] px-6 py-6 sm:px-10 sm:py-9"
              : "w-[min(88vw,44rem)] px-6 py-6 sm:px-9 sm:py-8",
          ].join(" ")}
          style={{
            borderColor: `rgba(154, 225, 255, ${0.15 + 0.3 * chargePhase})`,
            background: `linear-gradient(180deg, rgba(9,18,38,${0.85 - warpEase * 0.4}), rgba(5,10,24,${0.9 - warpEase * 0.4
              }))`,
            boxShadow: `0 0 80px rgba(56, 189, 248, ${0.1 + chargePhase * 0.15}), inset 0 0 40px rgba(255, 74, 196, ${0.05 + warpEase * 0.2
              })`,
            opacity: containerOpacity,
            transform: `scale(${containerScale}) translateY(${warpEase * -20}px)`,
          }}
        >
          <div
            className="absolute inset-0 border bg-[linear-gradient(120deg,rgba(88,211,255,0.4),rgba(255,92,188,0.2),rgba(125,129,255,0.4))] transition-opacity"
            style={{ opacity: warpEase * 0.8 }}
          />

          {accentLabel ? (
            <div className="relative z-10 mb-4 flex items-center gap-3">
              <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,1)]" />
              <span className="font-[family-name:var(--font-jetbrains-mono)] text-[12px] uppercase tracking-[0.35em] text-cyan-100">
                {accentLabel}
              </span>
            </div>
          ) : null}

          <div className="relative z-10">
            <h2
              className="text-balance bg-gradient-to-r from-white via-cyan-100 to-fuchsia-200 bg-clip-text text-4xl font-black text-transparent sm:text-6xl"
              data-testid="cinematic-transition-title"
              style={{
                letterSpacing: titleLetterSpacing,
                filter: `blur(${titleBlur})`,
                textShadow: `0 0 ${20 + chargePhase * 40}px rgba(122, 218, 255, ${0.3 + warpEase * 0.5})`,
              }}
            >
              {title}
            </h2>
            {metadata.length > 0 ? (
              <div
                className="mt-6 flex flex-wrap gap-2.5"
                data-testid="cinematic-transition-metadata"
                style={{ opacity: entryPhase < 1 ? entryEase : 1 }}
              >
                {metadata.map((entry) => (
                  <span
                    key={entry}
                    className="rounded-full border border-cyan-200/20 bg-cyan-950/30 px-3.5 py-1.5 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-cyan-50"
                  >
                    {entry}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          {/* Progress Bar */}
          <div className="relative z-10 mt-8 h-1.5 overflow-hidden rounded-full bg-slate-900/60 shadow-inner">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-white to-fuchsia-400 shadow-[0_0_20px_rgba(103,232,249,0.8)]"
              style={{ width: `${safeProgress * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Countdown (Used in RoundStartTransition) */}
      {countdownLabel ? (
        <div className="absolute bottom-[10%] right-[6%] sm:right-[10%]">
          <div
            className="font-[family-name:var(--font-jetbrains-mono)] text-[clamp(5rem,12vw,10rem)] font-black leading-none tracking-[-0.05em] text-white"
            data-testid="cinematic-transition-countdown"
            style={{
              textShadow: "0 0 40px rgba(56, 189, 248, 0.5), 0 0 80px rgba(255, 74, 196, 0.3)",
              opacity: 0.6 + entryEase * 0.4 - warpEase * 0.5,
              transform: `scale(${1 + chargePhase * 0.1 - warpEase * 0.2})`,
            }}
          >
            {countdownLabel}
          </div>
        </div>
      ) : null}

      {/* Final White Warp Flash */}
      <div
        className="absolute inset-0 bg-white mix-blend-overlay"
        style={{ opacity: warpEase }}
      />
    </div>
  );
}
