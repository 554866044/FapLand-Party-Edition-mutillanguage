import React from "react";
import { playHoverSound, playSelectSound } from "../../utils/audio";
import type { ConverterState, ConverterStep, SelectedSourceInfo } from "./useConverterState";

type ConverterHeaderBaseProps = {
  step: ConverterStep;
  selectedSourceInfo: SelectedSourceInfo;
  segmentCount: number;
  sourceSummary: string;
};

type ConverterHeaderProps = ConverterHeaderBaseProps & {
  onGoToSelect: () => void;
};

export const ConverterHeader: React.FC<ConverterHeaderProps> = React.memo(
  ({ step, selectedSourceInfo, segmentCount, sourceSummary, onGoToSelect }) => {
    if (step === "select") {
      return (
        <header className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-6 backdrop-blur-xl">
          <p className="font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.45em] text-purple-200/85">
            Conversion Lab
          </p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <h1 className="text-2xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-violet-200 via-purple-100 to-indigo-200 drop-shadow-[0_0_20px_rgba(139,92,246,0.45)] sm:text-3xl">
              Round Converter
            </h1>
          </div>
          <p className="mt-2 text-sm text-zinc-400">
            Select a source to convert rounds into hero segments, or add more rounds to an existing
            hero.
          </p>
        </header>
      );
    }

    return (
      <header className="animate-entrance rounded-3xl border border-purple-400/25 bg-zinc-950/55 p-6 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onMouseEnter={playHoverSound}
            onClick={() => {
              playSelectSound();
              onGoToSelect();
            }}
            className="rounded-xl border border-violet-300/55 bg-violet-500/20 px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] text-violet-100 transition-all duration-200 hover:border-violet-200/80 hover:bg-violet-500/35"
          >
            Change Source
          </button>
          <p className="font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.45em] text-purple-200/85">
            Conversion Lab
          </p>
        </div>

        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-violet-200 via-purple-100 to-indigo-200 drop-shadow-[0_0_20px_rgba(139,92,246,0.45)] sm:text-3xl">
              {selectedSourceInfo?.name ?? "Editor"}
            </h1>
            {selectedSourceInfo && (
              <p className="mt-1 text-xs text-zinc-400">
                {selectedSourceInfo.kind === "round"
                  ? "Converting standalone round to hero"
                  : selectedSourceInfo.kind === "hero"
                    ? "Editing hero rounds"
                    : "Converting local video file"}
              </p>
            )}
          </div>
          <div className="rounded-xl border border-violet-200/30 bg-violet-400/10 px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] text-violet-100">
            {segmentCount} Segment{segmentCount === 1 ? "" : "s"} • {sourceSummary}
          </div>
        </div>
      </header>
    );
  }
);

ConverterHeader.displayName = "ConverterHeader";

export function pickConverterHeaderProps(state: ConverterState): ConverterHeaderBaseProps {
  return {
    step: state.step,
    selectedSourceInfo: state.selectedSourceInfo,
    segmentCount: state.sortedSegments.length,
    sourceSummary: state.sourceSummary,
  };
}
