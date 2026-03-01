import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SegmentCard } from "./SegmentCard";
import type { SegmentDraft } from "./types";

vi.mock("../../utils/audio", () => ({
    playSelectSound: vi.fn(),
}));

afterEach(() => {
    cleanup();
});

function makeSegment(overrides: Partial<SegmentDraft> = {}): SegmentDraft {
    return {
        id: "segment-1",
        startTimeMs: 59_195,
        endTimeMs: 60_534,
        type: "Normal",
        customName: "Hero - round 1",
        bpm: 90,
        difficulty: 3,
        bpmOverride: false,
        difficultyOverride: false,
        ...overrides,
    };
}

describe("SegmentCard", () => {
    it("starts expanded and shows difficulty stars", () => {
        render(
            <SegmentCard
                segment={makeSegment()}
                index={0}
                isSelected={false}
                hasNext={true}
                heroName="Hero"
                onSelect={vi.fn()}
                onJumpStart={vi.fn()}
                onJumpEnd={vi.fn()}
                onMergeWithNext={vi.fn()}
                onSetCustomName={vi.fn()}
                onSetBpm={vi.fn()}
                onResetBpm={vi.fn()}
                onSetDifficulty={vi.fn()}
                onResetDifficulty={vi.fn()}
                onSetType={vi.fn()}
                onUpdateTiming={vi.fn()}
            />,
        );

        expect(screen.getByText("Timing:")).toBeDefined();
        expect(screen.getByText("Difficulty:")).toBeDefined();
        expect(screen.getByRole("button", { name: "Set difficulty to 5 stars" })).toBeDefined();
    });

    it("maps star clicks to the existing difficulty setter", () => {
        const onSetDifficulty = vi.fn();

        render(
            <SegmentCard
                segment={makeSegment({ difficulty: null })}
                index={0}
                isSelected={false}
                hasNext={true}
                heroName="Hero"
                onSelect={vi.fn()}
                onJumpStart={vi.fn()}
                onJumpEnd={vi.fn()}
                onMergeWithNext={vi.fn()}
                onSetCustomName={vi.fn()}
                onSetBpm={vi.fn()}
                onResetBpm={vi.fn()}
                onSetDifficulty={onSetDifficulty}
                onResetDifficulty={vi.fn()}
                onSetType={vi.fn()}
                onUpdateTiming={vi.fn()}
            />,
        );

        fireEvent.click(screen.getByRole("button", { name: "Set difficulty to 4 stars" }));

        expect(onSetDifficulty).toHaveBeenCalledWith("4");
    });
});
