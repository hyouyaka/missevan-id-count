import { buildVersionedUrl } from "@/app/app-utils";

const RANKS_CLIENT_CACHE_TTL_MS = 30 * 60 * 1000;
const RANKS_EXPECTED_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;

const ranksClientCache = {
  data: null,
  loadedAt: 0,
  frontendVersion: "",
  promise: null,
};

function isRanksClientCacheFresh(frontendVersion) {
  const normalizedVersion = String(frontendVersion ?? "").trim();
  if (!ranksClientCache.data || ranksClientCache.frontendVersion !== normalizedVersion) {
    return false;
  }
  const now = Date.now();
  if (now - ranksClientCache.loadedAt >= RANKS_CLIENT_CACHE_TTL_MS) {
    return false;
  }

  const updatedAtMs = Date.parse(ranksClientCache.data?.data?.updatedAt || "");
  if (Number.isFinite(updatedAtMs) && now >= updatedAtMs + RANKS_EXPECTED_REFRESH_INTERVAL_MS) {
    return false;
  }

  return true;
}

export function getCachedRanksData(frontendVersion) {
  const normalizedVersion = String(frontendVersion ?? "").trim();
  if (!ranksClientCache.data || ranksClientCache.frontendVersion !== normalizedVersion) {
    return null;
  }
  return ranksClientCache.data;
}

export async function fetchRanksData(frontendVersion, options = {}) {
  const normalizedVersion = String(frontendVersion ?? "").trim();
  const revalidate = options?.revalidate === true;
  if (!revalidate && isRanksClientCacheFresh(frontendVersion)) {
    return ranksClientCache.data;
  }

  if (ranksClientCache.promise && ranksClientCache.frontendVersion === normalizedVersion) {
    return ranksClientCache.promise;
  }

  ranksClientCache.frontendVersion = normalizedVersion;
  ranksClientCache.promise = (async () => {
    try {
      const response = await fetch(buildVersionedUrl("/ranks", frontendVersion), {
        cache: "no-cache",
      });
      const data = await response.json();
      const payload = {
        response,
        data,
      };
      if (response.ok && data?.success) {
        ranksClientCache.data = payload;
        ranksClientCache.loadedAt = Date.now();
      }
      return payload;
    } finally {
      ranksClientCache.promise = null;
    }
  })();

  return ranksClientCache.promise;
}
