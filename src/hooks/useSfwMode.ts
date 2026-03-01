import { useEffect, useState } from "react";
import { trpc } from "../services/trpc";
import {
  DEFAULT_SFW_MODE_ENABLED,
  normalizeSfwModeEnabled,
  SFW_MODE_ENABLED_EVENT,
  SFW_MODE_ENABLED_KEY,
} from "../constants/experimentalFeatures";

export function useSfwMode(): boolean {
  const [enabled, setEnabled] = useState(DEFAULT_SFW_MODE_ENABLED);

  useEffect(() => {
    let cancelled = false;
    trpc.store.get
      .query({ key: SFW_MODE_ENABLED_KEY })
      .then((result) => {
        if (!cancelled) setEnabled(normalizeSfwModeEnabled(result));
      })
      .catch(() => {});

    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<boolean>;
      setEnabled(customEvent.detail);
    };
    window.addEventListener(SFW_MODE_ENABLED_EVENT, handler);
    return () => {
      cancelled = true;
      window.removeEventListener(SFW_MODE_ENABLED_EVENT, handler);
    };
  }, []);

  return enabled;
}
