import { buildVersionedUrl } from "@/app/app-utils";

const ongoingClientCache = new Map();
const ONGOING_CLIENT_SCHEMA_VERSION = 3;
const ONGOING_CLIENT_CACHE_TTL_MS = 30 * 60 * 1000;

export async function fetchOngoingData({ platform, frontendVersion, revalidate = false }) {
  const normalizedVersion = String(frontendVersion ?? "").trim();
  const cacheKey = `${ONGOING_CLIENT_SCHEMA_VERSION}:${normalizedVersion}:${platform}`;
  const cached = ongoingClientCache.get(cacheKey);
  if (!revalidate && cached?.data && Date.now() - cached.loadedAt < ONGOING_CLIENT_CACHE_TTL_MS) {
    return cached.data;
  }
  if (cached?.promise) {
    return cached.promise;
  }

  const params = new URLSearchParams({
    platform,
    schema: String(ONGOING_CLIENT_SCHEMA_VERSION),
    _: String(Date.now()),
  });
  const promise = (async () => {
    try {
      const response = await fetch(buildVersionedUrl(`/ongoing?${params.toString()}`, frontendVersion), {
        cache: "no-store",
      });
      const data = await response.json();
      const payload = { response, data };
      if (response.ok && data?.success) {
        ongoingClientCache.set(cacheKey, {
          data: payload,
          loadedAt: Date.now(),
          promise: null,
        });
      }
      return payload;
    } finally {
      const current = ongoingClientCache.get(cacheKey);
      if (current?.promise === promise) {
        ongoingClientCache.set(cacheKey, {
          ...current,
          promise: null,
        });
      }
    }
  })();

  ongoingClientCache.set(cacheKey, { ...(cached || {}), promise });
  return promise;
}

export function getCachedOngoingData({ platform, frontendVersion }) {
  const normalizedVersion = String(frontendVersion ?? "").trim();
  const cacheKey = `${ONGOING_CLIENT_SCHEMA_VERSION}:${normalizedVersion}:${platform}`;
  return ongoingClientCache.get(cacheKey)?.data || null;
}
