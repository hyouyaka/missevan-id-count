import { buildVersionedUrl } from "@/app/app-utils";

export const RANK_TREND_CLIENT_SCHEMA_VERSION = 7;

const rankTrendClientCache = new Map();
const rankTrendAvailabilityCache = new Map();
const rankTrendModePreferenceCache = new Map();
const rankTrendWeeklyUnavailableCache = new Set();
const RANK_TREND_AVAILABILITY_TTL_MS = 5 * 60 * 1000;

function getRankTrendSessionKey(platform, id) {
  const normalizedPlatform = String(platform ?? "").trim();
  const normalizedId = String(id ?? "").trim();
  return normalizedPlatform && normalizedId ? `${normalizedPlatform}:${normalizedId}` : "";
}

export function mapRankTrendWindowKey(windowKey, kind) {
  const windowSize = String(windowKey ?? "").match(/^(30|7|3)/)?.[1] || "7";
  return `${windowSize}${kind === "weekly_playback" ? "w" : "d"}`;
}

export function getRankTrendModePreference({ platform, id } = {}) {
  const key = getRankTrendSessionKey(platform, id);
  return key ? rankTrendModePreferenceCache.get(key) || "metric" : "metric";
}

export function setRankTrendModePreference({ platform, id, kind } = {}) {
  const key = getRankTrendSessionKey(platform, id);
  if (!key) {
    return;
  }
  rankTrendModePreferenceCache.set(key, kind === "weekly_playback" ? "weekly_playback" : "metric");
}

export function isRankTrendWeeklyUnavailable({ platform, id } = {}) {
  const key = getRankTrendSessionKey(platform, id);
  return Boolean(key && rankTrendWeeklyUnavailableCache.has(key));
}

export function markRankTrendWeeklyUnavailable({ platform, id } = {}) {
  const key = getRankTrendSessionKey(platform, id);
  if (key) {
    rankTrendWeeklyUnavailableCache.add(key);
  }
}

export function resolveRankTrendAvailabilityIds({ response, data, requestedIds } = {}) {
  const normalizedRequestedIds = Array.from(new Set(
    (Array.isArray(requestedIds) ? requestedIds : [])
      .map((id) => String(id ?? "").trim())
      .filter(Boolean)
  ));
  if (!response?.ok || !data?.success) {
    return new Set(normalizedRequestedIds);
  }
  const requestedIdSet = new Set(normalizedRequestedIds);
  return new Set(
    (Array.isArray(data.ids) ? data.ids : [])
      .map((id) => String(id ?? "").trim())
      .filter((id) => id && requestedIdSet.has(id))
  );
}

export async function fetchRankTrendData({ platform, id, kind = "", frontendVersion }) {
  const normalizedPlatform = String(platform ?? "").trim();
  const normalizedId = String(id ?? "").trim();
  const normalizedKind = String(kind ?? "").trim();
  const normalizedVersion = String(frontendVersion ?? "").trim();
  const cacheKey = `${RANK_TREND_CLIENT_SCHEMA_VERSION}:${normalizedVersion}:${normalizedKind}:${normalizedPlatform}:${normalizedId}`;
  const cached = rankTrendClientCache.get(cacheKey);
  if (cached?.promise) {
    return cached.promise;
  }

  const params = new URLSearchParams({
    id: normalizedId,
    schema: String(RANK_TREND_CLIENT_SCHEMA_VERSION),
  });
  if (normalizedKind) {
    params.set("kind", normalizedKind);
  }
  if (normalizedPlatform) {
    params.set("platform", normalizedPlatform);
  }
  const promise = (async () => {
    try {
      const response = await fetch(buildVersionedUrl(`/ranks/trends?${params.toString()}`, frontendVersion), {
        cache: "no-store",
      });
      const data = await response.json();
      const payload = { response, data };
      if (response.ok && data?.success) {
        rankTrendClientCache.set(cacheKey, { data: payload, promise: null });
      }
      return payload;
    } finally {
      const current = rankTrendClientCache.get(cacheKey);
      if (current?.promise === promise) {
        rankTrendClientCache.set(cacheKey, { data: current.data || null, promise: null });
      }
    }
  })();

  rankTrendClientCache.set(cacheKey, { data: null, promise });
  return promise;
}

export async function fetchRankTrendAvailabilityData({ platform, ids, frontendVersion } = {}) {
  const normalizedPlatform = String(platform ?? "").trim();
  const normalizedIds = Array.from(
    new Set(
      (Array.isArray(ids) ? ids : [])
        .map((id) => String(id ?? "").trim())
        .filter(Boolean)
    )
  ).sort();
  if (!normalizedIds.length || (normalizedPlatform !== "missevan" && normalizedPlatform !== "manbo")) {
    return { response: { ok: false }, data: null };
  }

  const normalizedVersion = String(frontendVersion ?? "").trim();
  const cacheKey = `${RANK_TREND_CLIENT_SCHEMA_VERSION}:${normalizedVersion}:${normalizedPlatform}:${normalizedIds.join("|")}`;
  const now = Date.now();
  const cached = rankTrendAvailabilityCache.get(cacheKey);
  if (cached?.data && now - cached.loadedAt < RANK_TREND_AVAILABILITY_TTL_MS) {
    return cached.data;
  }
  if (cached?.promise) {
    return cached.promise;
  }

  const params = new URLSearchParams({
    platform: normalizedPlatform,
    schema: String(RANK_TREND_CLIENT_SCHEMA_VERSION),
    _: String(Date.now()),
  });
  normalizedIds.forEach((id) => params.append("id", id));
  const promise = (async () => {
    try {
      const response = await fetch(buildVersionedUrl(`/ranks/trends/availability?${params.toString()}`, frontendVersion), {
        cache: "no-store",
      });
      const data = await response.json();
      const payload = { response, data };
      if (response.ok && data?.success) {
        rankTrendAvailabilityCache.set(cacheKey, {
          data: payload,
          loadedAt: Date.now(),
          promise: null,
        });
      }
      return payload;
    } finally {
      const current = rankTrendAvailabilityCache.get(cacheKey);
      if (current?.promise === promise) {
        rankTrendAvailabilityCache.set(cacheKey, {
          data: current.data || null,
          loadedAt: current.loadedAt || 0,
          promise: null,
        });
      }
    }
  })();

  rankTrendAvailabilityCache.set(cacheKey, {
    data: cached?.data || null,
    loadedAt: cached?.loadedAt || 0,
    promise,
  });
  return promise;
}

export function logRankTrendOpen({
  platform,
  id,
  name,
  source,
  rankKey,
  frontendVersion,
} = {}) {
  const normalizedPlatform = String(platform ?? "").trim();
  const normalizedId = String(id ?? "").trim();
  if (!normalizedPlatform || !normalizedId) {
    return;
  }

  fetch(buildVersionedUrl("/usage-log", frontendVersion), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      platform: normalizedPlatform,
      action: "trend",
      dramaId: normalizedId,
      dramaName: String(name ?? "").trim(),
      source: String(source ?? "").trim(),
      rankKey: String(rankKey ?? "").trim(),
    }),
  }).catch((error) => {
    console.error("Failed to log rank trend open", error);
  });
}
