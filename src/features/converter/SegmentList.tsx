import React from "react";
import { playSelectSound } from "../../utils/audio";
import type { ConverterState } from "./useConverterState";
import { SegmentCard } from "./SegmentCard";

type SegmentListProps = {
    sortedSegments: ConverterState["sortedSegments"];
    selectedSegmentId: string | null;
    selectedSegment: ConverterState["selectedSegment"];
    heroName: string;
    onSelectSegment: (id: string) => void;
    onRemoveSegment: (id: string) => void;
    onSeekToMs: (ms: number) => void;
    onMergeSegmentWithNext: (id: string) => void;
    onSetSegmentCustomName: (id: string, name: string) => void;
    onSetSegmentBpm: (id: string, rawValue: string) => void;
    onResetSegmentBpm: (id: string) => void;
    onSetSegmentDifficulty: (id: string, rawValue: string) => void;
    onResetSegmentDifficulty: (id: string) => void;
    onSetSegmentType: ConverterState["setSegmentType"];
    onUpdateSegmentTiming: ConverterState["updateSegmentTiming"];
    setMessage: (msg: string | null) => void;
    setError: (err: string | null) => void;
};

export const SegmentList: React.FC<SegmentListProps> = React.memo(
    ({
        sortedSegments,
        selectedSegmentId,
        selectedSegment,
        heroName,
        onSelectSegment,
        onRemoveSegment,
        onSeekToMs,
        onMergeSegmentWithNext,
        onSetSegmentCustomName,
        onSetSegmentBpm,
        onResetSegmentBpm,
        onSetSegmentDifficulty,
        onResetSegmentDifficulty,
        onSetSegmentType,
        onUpdateSegmentTiming,
        setMessage,
        setError,
    }) => (
        <div>
            <div className="mb-2 flex items-center justify-between">
                <div>
                    <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-violet-100">
                        Segments
                        {sortedSegments.length > 0 && (
                            <span className="ml-2 rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-normal text-violet-200">
                                {sortedSegments.length}
                            </span>
                        )}
                    </h3>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-400">
                        <span><kbd className="converter-kbd">N</kbd> / <kbd className="converter-kbd">Shift+N</kbd> Next/Prev</span>
                        <span><kbd className="converter-kbd">M</kbd> Merge</span>
                        <span><kbd className="converter-kbd">Ctrl/Cmd+S</kbd> Save</span>
                        <span><kbd className="converter-kbd">?</kbd> All shortcuts</span>
                    </div>
                </div>
                {selectedSegment && (
                    <button
                        type="button"
                        onClick={() => onRemoveSegment(selectedSegment.id)}
                        className="text-[10px] text-rose-300 hover:text-rose-200"
                    >
                        Delete selected <kbd className="converter-kbd ml-1">Delete</kbd>
                    </button>
                )}
            </div>

            <div className="max-h-[32rem] overflow-y-auto divide-y divide-violet-300/10">
                {sortedSegments.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-6 text-zinc-500">
                        <span className="text-lg opacity-30">📎</span>
                        <p className="text-xs">No segments. Mark IN/OUT and add one.</p>
                    </div>
                ) : (
                    sortedSegments.map((segment, index) => (
                        <SegmentCard
                            key={segment.id}
                            segment={segment}
                            index={index}
                            isSelected={selectedSegmentId === segment.id}
                            hasNext={index < sortedSegments.length - 1}
                            heroName={heroName}
                            onSelect={() => onSelectSegment(segment.id)}
                            onJumpStart={() => {
                                onSeekToMs(segment.startTimeMs);
                                setMessage(`Jumped to segment ${index + 1} start.`);
                                setError(null);
                            }}
                            onJumpEnd={() => {
                                onSeekToMs(segment.endTimeMs);
                                setMessage(`Jumped to segment ${index + 1} end.`);
                                setError(null);
                            }}
                            onMergeWithNext={() => onMergeSegmentWithNext(segment.id)}
                            onSetCustomName={(name) => onSetSegmentCustomName(segment.id, name)}
                            onSetBpm={(rawValue) => onSetSegmentBpm(segment.id, rawValue)}
                            onResetBpm={() => onResetSegmentBpm(segment.id)}
                            onSetDifficulty={(rawValue) => onSetSegmentDifficulty(segment.id, rawValue)}
                            onResetDifficulty={() => onResetSegmentDifficulty(segment.id)}
                            onSetType={(type) => onSetSegmentType(segment.id, type)}
                            onUpdateTiming={(startTimeMs, endTimeMs) =>
                                onUpdateSegmentTiming(segment.id, startTimeMs, endTimeMs)
                            }
                        />
                    ))
                )}
            </div>
        </div>
    ),
);

SegmentList.displayName = "SegmentList";

export function pickSegmentListProps(state: ConverterState): SegmentListProps {
    return {
        sortedSegments: state.sortedSegments,
        selectedSegmentId: state.selectedSegmentId,
        selectedSegment: state.selectedSegment,
        heroName: state.heroName,
        onSelectSegment: state.setSelectedSegmentId,
        onRemoveSegment: state.removeSegment,
        onSeekToMs: (ms: number) => {
            state.seekToMs(ms);
            playSelectSound();
        },
        onMergeSegmentWithNext: state.mergeSegmentWithNext,
        onSetSegmentCustomName: state.setSegmentCustomName,
        onSetSegmentBpm: state.setSegmentBpm,
        onResetSegmentBpm: state.resetSegmentBpm,
        onSetSegmentDifficulty: state.setSegmentDifficulty,
        onResetSegmentDifficulty: state.resetSegmentDifficulty,
        onSetSegmentType: state.setSegmentType,
        onUpdateSegmentTiming: state.updateSegmentTiming,
        setMessage: (_msg: string | null) => {
            // Messages are set inline via jump callbacks
        },
        setError: (_err: string | null) => {
            // Errors are set inline via jump callbacks
        },
    };
}
