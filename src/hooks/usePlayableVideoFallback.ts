import { useCallback, useRef, useState } from "react";

type PlayableResolverResult = {
  videoUri: string;
  transcoded: boolean;
  cacheHit: boolean;
};

type PlayableResolver = (videoUri: string) => Promise<PlayableResolverResult>;

const defaultPlayableResolver: PlayableResolver = async (videoUri) => {
  const { resolvePlayableVideoUri } = await import("../services/mediaPlayback");
  return resolvePlayableVideoUri(videoUri);
};

export function isLocalVideoUriForFallback(videoUri: string): boolean {
  return videoUri.startsWith("app://media/") || videoUri.startsWith("file://");
}

export function usePlayableVideoFallback(resolver: PlayableResolver = defaultPlayableResolver): {
  getVideoSrc: (originalUri: string | null | undefined) => string | undefined;
  ensurePlayableVideo: (originalUri: string | null | undefined) => Promise<string | null>;
  handleVideoError: (originalUri: string | null | undefined) => Promise<string | null>;
} {
  const fallbackByOriginalUriRef = useRef<Record<string, string>>({});
  const [, forceUpdate] = useState(0);
  const attemptedOriginalUrisRef = useRef(new Set<string>());
  const inFlightByOriginalUriRef = useRef(new Map<string, Promise<string | null>>());
  const resolverRef = useRef(resolver);
  resolverRef.current = resolver;

  const getVideoSrc = useCallback((originalUri: string | null | undefined): string | undefined => {
    if (!originalUri) return undefined;
    return fallbackByOriginalUriRef.current[originalUri] ?? originalUri;
  }, []);

  const ensurePlayableVideo = useCallback(
    async (originalUri: string | null | undefined): Promise<string | null> => {
      if (!originalUri) return null;
      if (!isLocalVideoUriForFallback(originalUri)) return null;

      const resolved = fallbackByOriginalUriRef.current[originalUri];
      if (resolved && resolved !== originalUri) {
        return resolved;
      }

      const existingInFlight = inFlightByOriginalUriRef.current.get(originalUri);
      if (existingInFlight) return existingInFlight;

      if (attemptedOriginalUrisRef.current.has(originalUri)) {
        return null;
      }
      attemptedOriginalUrisRef.current.add(originalUri);

      const pending = (async () => {
        try {
          const result = await resolverRef.current(originalUri);
          if (result.videoUri && result.videoUri !== originalUri) {
            if (!fallbackByOriginalUriRef.current[originalUri]) {
              fallbackByOriginalUriRef.current[originalUri] = result.videoUri;
              forceUpdate((n) => n + 1);
            }
            return result.videoUri;
          }
          return null;
        } catch (error) {
          console.warn("Video fallback resolve failed", error);
          return null;
        } finally {
          inFlightByOriginalUriRef.current.delete(originalUri);
        }
      })();

      inFlightByOriginalUriRef.current.set(originalUri, pending);
      return pending;
    },
    []
  );

  const handleVideoError = useCallback(
    async (originalUri: string | null | undefined): Promise<string | null> => {
      if (!originalUri) return null;
      if (!isLocalVideoUriForFallback(originalUri)) return null;

      const existingInFlight = inFlightByOriginalUriRef.current.get(originalUri);
      if (existingInFlight) return existingInFlight;

      if (attemptedOriginalUrisRef.current.has(originalUri)) {
        return null;
      }
      attemptedOriginalUrisRef.current.add(originalUri);

      const pending = (async () => {
        try {
          const result = await resolverRef.current(originalUri);
          if (result.videoUri && result.videoUri !== originalUri) {
            if (!fallbackByOriginalUriRef.current[originalUri]) {
              fallbackByOriginalUriRef.current[originalUri] = result.videoUri;
              forceUpdate((n) => n + 1);
            }
            return result.videoUri;
          }
          return null;
        } catch (error) {
          console.warn("Video fallback resolve failed", error);
          return null;
        } finally {
          inFlightByOriginalUriRef.current.delete(originalUri);
        }
      })();

      inFlightByOriginalUriRef.current.set(originalUri, pending);
      return pending;
    },
    []
  );

  return {
    getVideoSrc,
    ensurePlayableVideo,
    handleVideoError,
  };
}
