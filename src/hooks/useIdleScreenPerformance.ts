import { useEffect } from "react";

type IdleScreenRoute = "home" | "settings" | "playlist-workshop";

export function useIdleScreenPerformance(
  route: IdleScreenRoute,
  options?: { reduceEffects?: boolean }
) {
  useEffect(() => {
    const body = document.body;
    const reduceEffects = options?.reduceEffects ?? true;

    const updateState = () => {
      if (reduceEffects) {
        body.classList.add("perf-reduced-effects");
      } else {
        body.classList.remove("perf-reduced-effects");
      }
      void window.electronAPI.performance?.updateState({
        route,
        visible: !document.hidden,
        idleSensitive: true,
      });
    };

    const clearState = () => {
      body.classList.remove("perf-reduced-effects");
      void window.electronAPI.performance?.updateState({
        route: "unknown",
        visible: !document.hidden,
        idleSensitive: false,
      });
    };

    const handleVisibilityChange = () => {
      updateState();
    };

    updateState();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearState();
    };
  }, [options?.reduceEffects, route]);
}
