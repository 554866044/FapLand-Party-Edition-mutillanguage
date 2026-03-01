import type { GameState } from "../../game/types";
import { CinematicTransitionFrame } from "./CinematicTransitionFrame";

export type RoundStartTransitionProps = {
  queuedRound: GameState["queuedRound"];
  remaining: number;
  duration: number;
};

export function RoundStartTransition({
  queuedRound,
  remaining,
  duration,
}: RoundStartTransitionProps) {
  if (!queuedRound) return null;

  const progress = duration > 0 ? 1 - remaining / duration : 1;
  const countdownLabel = `${Math.max(1, Math.ceil(remaining))}`;
  const hintText = queuedRound.phaseKind === "cum"
    ? "In this round, you may cum when the video instructs you to do so."
    : null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[82]" data-testid="round-start-transition">
      <CinematicTransitionFrame
        title={queuedRound.roundName}
        overline={queuedRound.phaseKind === "cum" ? "CUM ROUND" : "NORMAL ROUND"}
        accentLabel={queuedRound.selectionKind === "random" ? "Random round acquired" : "Target locked"}
        hintText={hintText}
        countdownLabel={countdownLabel}
        progress={progress}
        variant="round-start"
      />
    </div>
  );
}
