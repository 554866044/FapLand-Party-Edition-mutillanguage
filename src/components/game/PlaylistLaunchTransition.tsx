import { CinematicTransitionFrame } from "./CinematicTransitionFrame";

export type PlaylistLaunchTransitionProps = {
  visible: boolean;
  playlistName: string;
  boardModeLabel: string;
  roundCount: number;
  estimatedDurationLabel: string;
  progress: number;
};

export function PlaylistLaunchTransition({
  visible,
  playlistName,
  boardModeLabel,
  roundCount,
  estimatedDurationLabel,
  progress,
}: PlaylistLaunchTransitionProps) {
  if (!visible) return null;

  return (
    <div className="absolute inset-0 z-[120]" data-testid="playlist-launch-transition">
      <CinematicTransitionFrame
        title={playlistName}
        overline="RUN INITIALIZATION"
        accentLabel="Playlist locked"
        metadata={[
          `${boardModeLabel} board`,
          `${Math.max(0, roundCount)} rounds`,
          estimatedDurationLabel,
        ]}
        progress={progress}
        variant="playlist-launch"
      />
    </div>
  );
}
