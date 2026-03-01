import type { GameCompletionReason } from "../game/types";

export const shouldClearSinglePlayerSaveOnCompletion = (
  completionReason: GameCompletionReason | null
): boolean => completionReason === "finished";
