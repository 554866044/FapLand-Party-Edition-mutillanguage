import { useCallback, useEffect } from "react";
import { useForegroundMedia } from "../contexts/ForegroundMediaContext";

export function useForegroundVideoRegistration(id: string) {
  const { register, unregister, setPlaying } = useForegroundMedia();

  useEffect(() => {
    register(id);
    return () => {
      unregister(id);
    };
  }, [id, register, unregister]);

  const markPlaying = useCallback((playing: boolean) => {
    setPlaying(id, playing);
  }, [id, setPlaying]);

  return {
    markPlaying,
    handlePlay: useCallback(() => {
      setPlaying(id, true);
    }, [id, setPlaying]),
    handlePause: useCallback(() => {
      setPlaying(id, false);
    }, [id, setPlaying]),
    handleEnded: useCallback(() => {
      setPlaying(id, false);
    }, [id, setPlaying]),
  };
}
