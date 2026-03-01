import { trpc } from "./trpc";

export type CachedInstalledRoundCatalog = Awaited<
  ReturnType<typeof trpc.db.getInstalledRoundCatalog.query>
>;
export type CachedInstalledRoundCardAssets = Awaited<
  ReturnType<typeof trpc.db.getInstalledRoundCardAssets.query>
>;
export type CachedInstalledRoundMediaResources = Awaited<
  ReturnType<typeof trpc.db.getRoundMediaResources.query>
>;

const catalogRequests = new Map<string, Promise<CachedInstalledRoundCatalog>>();
const cardAssetRequests = new Map<string, Promise<CachedInstalledRoundCardAssets[number]>>();
const cardAssetCache = new Map<string, CachedInstalledRoundCardAssets[number]>();
const mediaRequests = new Map<string, Promise<CachedInstalledRoundMediaResources>>();
const mediaCache = new Map<string, CachedInstalledRoundMediaResources>();
const MAX_CARD_ASSET_CACHE_ENTRIES = 300;
const MAX_MEDIA_CACHE_ENTRIES = 120;

function touchLruEntry<T>(cache: Map<string, T>, key: string, value: T, maxEntries: number): void {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);

  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

function getCatalogKey(includeDisabled: boolean, includeTemplates: boolean): string {
  return `${includeDisabled ? "1" : "0"}:${includeTemplates ? "1" : "0"}`;
}

function getMediaKey(roundId: string, includeDisabled: boolean): string {
  return `${roundId}:${includeDisabled ? "1" : "0"}`;
}

function getCardAssetKey(roundId: string, includeDisabled: boolean): string {
  return `${roundId}:${includeDisabled ? "1" : "0"}`;
}

export function getInstalledRoundCatalogCached(
  includeDisabled = false,
  includeTemplates = false
): Promise<CachedInstalledRoundCatalog> {
  const key = getCatalogKey(includeDisabled, includeTemplates);
  const existing = catalogRequests.get(key);
  if (existing) {
    return existing;
  }

  const request = trpc.db.getInstalledRoundCatalog.query({
    includeDisabled,
    includeTemplates,
  }).catch((error) => {
    catalogRequests.delete(key);
    throw error;
  });
  catalogRequests.set(key, request);
  return request;
}

export function getRoundMediaResourcesCached(
  roundId: string,
  includeDisabled = false
): Promise<CachedInstalledRoundMediaResources> {
  const key = getMediaKey(roundId, includeDisabled);
  const cached = mediaCache.get(key);
  if (cached) {
    touchLruEntry(mediaCache, key, cached, MAX_MEDIA_CACHE_ENTRIES);
    return Promise.resolve(cached);
  }

  const existing = mediaRequests.get(key);
  if (existing) {
    return existing;
  }

  const request = trpc.db.getRoundMediaResources
    .query({
      roundId,
      includeDisabled,
    })
    .then((result) => {
      touchLruEntry(mediaCache, key, result, MAX_MEDIA_CACHE_ENTRIES);
      mediaRequests.delete(key);
      return result;
    })
    .catch((error) => {
      mediaRequests.delete(key);
      throw error;
    });
  mediaRequests.set(key, request);
  return request;
}

export async function getInstalledRoundCardAssetsCached(
  roundIds: string[],
  includeDisabled = false
): Promise<CachedInstalledRoundCardAssets> {
  const uniqueRoundIds = [...new Set(roundIds.filter((roundId) => roundId.trim().length > 0))];
  if (uniqueRoundIds.length === 0) {
    return [];
  }

  const pendingFetchIds: string[] = [];
  const pendingPromises: Promise<CachedInstalledRoundCardAssets[number]>[] = [];

  for (const roundId of uniqueRoundIds) {
    const key = getCardAssetKey(roundId, includeDisabled);
    const cached = cardAssetCache.get(key);
    if (cached) {
      touchLruEntry(cardAssetCache, key, cached, MAX_CARD_ASSET_CACHE_ENTRIES);
      continue;
    }

    const existing = cardAssetRequests.get(key);
    if (existing) {
      pendingPromises.push(existing);
      continue;
    }

    pendingFetchIds.push(roundId);
  }

  if (pendingFetchIds.length > 0) {
    const request = trpc.db.getInstalledRoundCardAssets
      .query({
        roundIds: pendingFetchIds,
        includeDisabled,
      })
      .then((entries) => {
        for (const entry of entries) {
          const key = getCardAssetKey(entry.roundId, includeDisabled);
          touchLruEntry(cardAssetCache, key, entry, MAX_CARD_ASSET_CACHE_ENTRIES);
          cardAssetRequests.delete(key);
        }
        for (const roundId of pendingFetchIds) {
          const key = getCardAssetKey(roundId, includeDisabled);
          if (!cardAssetCache.has(key)) {
            cardAssetRequests.delete(key);
          }
        }
        return entries;
      })
      .catch((error) => {
        for (const roundId of pendingFetchIds) {
          cardAssetRequests.delete(getCardAssetKey(roundId, includeDisabled));
        }
        throw error;
      });

    for (const roundId of pendingFetchIds) {
      const key = getCardAssetKey(roundId, includeDisabled);
      const perRoundRequest = request.then((entries) => {
        const entry = entries.find((candidate) => candidate.roundId === roundId);
        if (!entry) {
          throw new Error(`Failed to load installed round card assets for ${roundId}.`);
        }
        return entry;
      });
      cardAssetRequests.set(key, perRoundRequest);
      pendingPromises.push(perRoundRequest);
    }
  }

  if (pendingPromises.length > 0) {
    await Promise.all(pendingPromises);
  }

  return uniqueRoundIds
    .map((roundId) => cardAssetCache.get(getCardAssetKey(roundId, includeDisabled)))
    .filter((entry): entry is CachedInstalledRoundCardAssets[number] => entry != null);
}

export function invalidateInstalledRoundCaches(): void {
  catalogRequests.clear();
  cardAssetRequests.clear();
  cardAssetCache.clear();
  mediaRequests.clear();
  mediaCache.clear();
}

export function invalidateInstalledRoundMedia(roundId?: string): void {
  if (!roundId) {
    mediaRequests.clear();
    mediaCache.clear();
    return;
  }

  for (const key of mediaRequests.keys()) {
    if (key.startsWith(`${roundId}:`)) {
      mediaRequests.delete(key);
    }
  }
  for (const key of mediaCache.keys()) {
    if (key.startsWith(`${roundId}:`)) {
      mediaCache.delete(key);
    }
  }
}

export function invalidateInstalledRoundCardAssets(roundId?: string): void {
  if (!roundId) {
    cardAssetRequests.clear();
    cardAssetCache.clear();
    return;
  }

  for (const key of cardAssetRequests.keys()) {
    if (key.startsWith(`${roundId}:`)) {
      cardAssetRequests.delete(key);
    }
  }
  for (const key of cardAssetCache.keys()) {
    if (key.startsWith(`${roundId}:`)) {
      cardAssetCache.delete(key);
    }
  }
}
