import { createHash } from "node:crypto";

import { TtlLruCache } from "../../shared/ttlLruCache.js";
import {
  normalizeWeeklyPlaybackDate,
  normalizeWeeklyPlaybackIndex,
  normalizeWeeklyPlaybackSnapshot,
  normalizeWeeklyPlaybackBundle,
  selectWeeklyPlaybackDates,
} from "../../shared/weeklyPlaybackUtils.js";

export const WEEKLY_PLAYBACK_INDEX_KEY_SUFFIX = ":watchcount:weekly:index";
export const WATCHCOUNT_INDEX_KEY_SUFFIX = ":watchcount:index";
export const WATCHCOUNT_HISTORY_KEY_SUFFIX = ":watchcount:history";
export const WEEKLY_PLAYBACK_DAILY_KEY_PATTERN = "{platform}:watchcount:*";
export const WEEKLY_PLAYBACK_CACHE_TTL_MS = 5 * 60 * 1000;
export const WEEKLY_PLAYBACK_CACHE_MAX_ENTRIES = 500;

function normalizePlatform(value) {
  const platform = String(value ?? "").trim();
  return platform === "missevan" || platform === "manbo" ? platform : "";
}

function parseJsonValue(value) {
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  try {
    return JSON.parse(normalized);
  } catch (_) {
    return null;
  }
}

function getReadBytes(value) {
  try {
    if (value == null) {
      return 0;
    }
    if (Array.isArray(value)) {
      return value.reduce((total, item) => total + getReadBytes(item), 0);
    }
    const encoded = typeof value === "string" ? value : JSON.stringify(value);
    return Buffer.byteLength(encoded, "utf8");
  } catch (_) {
    return 0;
  }
}

function getScanParts(result) {
  if (Array.isArray(result)) {
    return {
      cursor: String(result[0] ?? "0"),
      keys: Array.isArray(result[1]) ? result[1] : [],
    };
  }
  return {
    cursor: String(result?.cursor ?? result?.[0] ?? "0"),
    keys: Array.isArray(result?.keys) ? result.keys : Array.isArray(result?.[1]) ? result[1] : [],
  };
}

function getDateFromDailyKey(platform, key) {
  const prefix = `${platform}:watchcount:`;
  const normalizedKey = String(key ?? "").trim();
  if (!normalizedKey.startsWith(prefix)) {
    return "";
  }
  const suffix = normalizedKey.slice(prefix.length);
  return normalizeWeeklyPlaybackDate(suffix);
}

function normalizeRequestedIds(value) {
  return Array.from(
    new Set((Array.isArray(value) ? value : value == null ? [] : [value])
      .map((item) => String(item ?? "").trim())
      .filter(Boolean))
  ).sort();
}

function normalizeHistoryEntry(rawValue) {
  const parsed = parseJsonValue(rawValue);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const name = String(parsed.name ?? "").trim();
  const points = Array.isArray(parsed.points) ? parsed.points : [];
  const normalizedPoints = points
    .map((point) => ({
      date: normalizeWeeklyPlaybackDate(point?.[0]),
      value: Number(point?.[1]),
    }))
    .filter((point) => point.date && Number.isFinite(point.value))
    .sort((left, right) => left.date.localeCompare(right.date));
  return normalizedPoints.length ? { name, points: normalizedPoints } : null;
}

function buildHistoryBundle(platform, ids, rawValues) {
  const records = ids
    .map((id, index) => [id, normalizeHistoryEntry(rawValues[index])])
    .filter(([, record]) => record);
  if (!records.length) {
    return null;
  }
  const dates = Array.from(
    new Set(records.flatMap(([, record]) => record.points.map((point) => point.date)))
  ).sort();
  const snapshotsByDate = Object.fromEntries(
    dates.map((date) => [date, {
      version: 1,
      platform,
      date,
      dramas: {},
    }])
  );
  records.forEach(([id, record]) => {
    record.points.forEach(({ date, value }) => {
      snapshotsByDate[date].dramas[id] = {
        id,
        ...(record.name ? { name: record.name } : {}),
        view_count: value,
      };
    });
  });
  const contentSignature = createHash("sha1")
    .update(JSON.stringify(ids.map((id, index) => [id, rawValues[index] ?? null])), "utf8")
    .digest("hex")
    .slice(0, 12);
  return {
    platform,
    version: `history:${dates.at(-1) || "empty"}:${contentSignature}`,
    granularity: "weekly",
    dates,
    generatedAt: "",
    snapshotsByDate,
    source: "watchcount_history",
  };
}

export function createWeeklyPlaybackStore({
  command,
  now = () => Date.now(),
  cacheTtlMs = WEEKLY_PLAYBACK_CACHE_TTL_MS,
  cacheMaxEntries = WEEKLY_PLAYBACK_CACHE_MAX_ENTRIES,
  maxWeeks = 32,
  scanMaxPages = 64,
  scanCount = 100,
} = {}) {
  if (typeof command !== "function") {
    throw new TypeError("createWeeklyPlaybackStore requires a command function");
  }

  const numericCacheMaxEntries = Number(cacheMaxEntries);
  const normalizedCacheMaxEntries = Number.isFinite(numericCacheMaxEntries)
    ? Math.max(0, Math.floor(numericCacheMaxEntries))
    : WEEKLY_PLAYBACK_CACHE_MAX_ENTRIES;
  const cache = new TtlLruCache({ maxEntries: normalizedCacheMaxEntries, now });
  const loadRequests = new Map();
  const historyCache = new TtlLruCache({ maxEntries: normalizedCacheMaxEntries, now });
  const historyRequests = new Map();

  function getCacheTtlMs() {
    return Math.max(1000, Number(cacheTtlMs) || WEEKLY_PLAYBACK_CACHE_TTL_MS);
  }

  async function readCommand(parts, { source, key, fallbackReason = "" }) {
    const startedAt = Date.now();
    let result = null;
    try {
      result = await command(parts);
      return result;
    } finally {
      console.info(JSON.stringify({
        source,
        key,
        bytes: getReadBytes(result),
        durationMs: Date.now() - startedAt,
        fallbackReason,
      }));
    }
  }

  async function readJson(key, source, fallbackReason = "") {
    return parseJsonValue(await readCommand(["GET", key], { source, key, fallbackReason }));
  }

  async function scanDailyIndex(platform) {
    let cursor = "0";
    let previousCursor = "";
    const keys = new Set();
    for (let page = 0; page < Math.max(1, Number(scanMaxPages) || 64); page += 1) {
      const result = await readCommand([
        "SCAN",
        cursor,
        "MATCH",
        WEEKLY_PLAYBACK_DAILY_KEY_PATTERN.replace("{platform}", platform),
        "COUNT",
        String(Math.max(10, Number(scanCount) || 100)),
      ], {
        source: "watchcount_scan",
        key: WEEKLY_PLAYBACK_DAILY_KEY_PATTERN.replace("{platform}", platform),
        fallbackReason: "legacy_index_unavailable",
      });
      const parts = getScanParts(result);
      parts.keys.forEach((key) => keys.add(String(key ?? "").trim()));
      previousCursor = cursor;
      cursor = parts.cursor;
      if (cursor === "0" || cursor === previousCursor) {
        break;
      }
    }

    const dates = Array.from(keys)
      .map((key) => ({ key, date: getDateFromDailyKey(platform, key) }))
      .filter(({ date }) => date)
      .sort((left, right) => left.date.localeCompare(right.date));
    if (!dates.length) {
      return null;
    }
    return {
      version: "scan",
      platform,
      granularity: "daily",
      dates: dates.map(({ date }) => date),
      keys: Object.fromEntries(dates.map(({ date, key }) => [date, key])),
      source: "watchcount_scan",
    };
  }

  async function readIndex(platform) {
    const canonicalIndexKey = `${platform}${WATCHCOUNT_INDEX_KEY_SUFFIX}`;
    const canonicalIndex = await readJson(
      canonicalIndexKey,
      "watchcount_index",
      "history_unavailable"
    ).catch(() => null);
    const normalizedCanonical = normalizeWeeklyPlaybackIndex(canonicalIndex, platform);
    if (normalizedCanonical) {
      return normalizedCanonical;
    }
    const legacyIndexKey = `${platform}${WEEKLY_PLAYBACK_INDEX_KEY_SUFFIX}`;
    const legacyIndex = await readJson(
      legacyIndexKey,
      "watchcount_weekly_index",
      "canonical_index_unavailable"
    ).catch(() => null);
    return normalizeWeeklyPlaybackIndex(legacyIndex, platform) || scanDailyIndex(platform);
  }

  async function readHistoryValues(platform, ids, force = false) {
    const timestamp = Number(now()) || Date.now();
    const valuesById = new Map();
    const pending = new Set();
    const missingIds = [];

    ids.forEach((id) => {
      const cacheKey = `${platform}:${id}`;
      const pendingRequest = historyRequests.get(cacheKey);
      if (pendingRequest) {
        pending.add(pendingRequest);
        return;
      }
      const cached = historyCache.get(cacheKey);
      if (!force && cached && timestamp - cached.loadedAt < getCacheTtlMs()) {
        valuesById.set(id, cached.value);
        return;
      }
      missingIds.push(id);
    });

    if (missingIds.length) {
      const historyKey = `${platform}${WATCHCOUNT_HISTORY_KEY_SUFFIX}`;
      const batchPromise = (async () => {
        const rawHistory = await readCommand([
          "HMGET",
          historyKey,
          ...missingIds,
        ], {
          source: "watchcount_history",
          key: historyKey,
        });
        if (!Array.isArray(rawHistory) || rawHistory.length !== missingIds.length) {
          throw new Error("Invalid watchcount history HMGET response");
        }
        const loadedAt = Number(now()) || Date.now();
        const loadedValues = new Map();
        missingIds.forEach((id, index) => {
          const value = rawHistory[index] ?? null;
          loadedValues.set(id, value);
          historyCache.set(`${platform}:${id}`, {
            value,
            loadedAt,
          });
        });
        return loadedValues;
      })().finally(() => {
        missingIds.forEach((id) => {
          const cacheKey = `${platform}:${id}`;
          if (historyRequests.get(cacheKey) === batchPromise) {
            historyRequests.delete(cacheKey);
          }
        });
      });
      missingIds.forEach((id) => {
        historyRequests.set(`${platform}:${id}`, batchPromise);
      });
      pending.add(batchPromise);
    }

    if (pending.size) {
      try {
        const loadedBatches = await Promise.all(pending);
        loadedBatches.forEach((loadedValues) => {
          if (!(loadedValues instanceof Map)) {
            return;
          }
          loadedValues.forEach((value, id) => {
            if (ids.includes(id)) {
              valuesById.set(id, value);
            }
          });
        });
      } catch (_) {
        return null;
      }
    }
    ids.forEach((id) => {
      if (valuesById.has(id)) {
        return;
      }
      const cached = historyCache.get(`${platform}:${id}`);
      if (cached) {
        valuesById.set(id, cached.value);
      }
    });
    return ids.map((id) => valuesById.get(id) ?? null);
  }

  function resolveSnapshotKey(platform, index, date) {
    if (index?.keys?.[date]) {
      return index.keys[date];
    }
    const keyPrefix = String(index?.keyPrefix ?? "").trim();
    if (keyPrefix) {
      return `${keyPrefix}${date}`;
    }
    return `${platform}:watchcount:${date}`;
  }

  async function load(platform, options = {}) {
    const normalizedPlatform = normalizePlatform(platform);
    if (!normalizedPlatform) {
      return null;
    }
    const force = options?.force === true;
    const ids = normalizeRequestedIds(options?.ids);
    const cacheKey = ids.length ? `${normalizedPlatform}:${ids.join(",")}` : normalizedPlatform;
    const timestamp = Number(now()) || Date.now();
    const cached = cache.get(cacheKey);
    if (
      !force &&
      cached &&
      timestamp - cached.loadedAt < getCacheTtlMs()
    ) {
      return cached.bundle;
    }
    const pendingRequest = loadRequests.get(cacheKey);
    if (pendingRequest) {
      return pendingRequest;
    }

    const loadPromise = (async () => {
      if (ids.length) {
        const rawHistory = await readHistoryValues(normalizedPlatform, ids, force);
        const historyBundle = buildHistoryBundle(
          normalizedPlatform,
          ids,
          Array.isArray(rawHistory) ? rawHistory : []
        );
        if (historyBundle) {
          return historyBundle;
        }
      }
      const index = await readIndex(normalizedPlatform);
      if (!index) {
        return null;
      }
      const dates = selectWeeklyPlaybackDates(index, maxWeeks);
      const keys = dates.map((date) => resolveSnapshotKey(normalizedPlatform, index, date));
      const rawSnapshots = keys.length
        ? await readCommand(["MGET", ...keys], {
            source: "watchcount_snapshots",
            key: keys.join(","),
            fallbackReason: "history_unavailable",
          })
        : [];
      const values = Array.isArray(rawSnapshots) ? rawSnapshots : [];
      const snapshotsByDate = {};
      dates.forEach((date, indexPosition) => {
        const snapshot = normalizeWeeklyPlaybackSnapshot(
          values[indexPosition],
          normalizedPlatform,
          date
        );
        if (snapshot) {
          snapshotsByDate[date] = snapshot;
        }
      });
      return normalizeWeeklyPlaybackBundle({
        platform: normalizedPlatform,
        index: {
          ...index,
          dates,
        },
        snapshotsByDate,
      });
    })();

    loadRequests.set(cacheKey, loadPromise);
    try {
      const bundle = await loadPromise;
      cache.set(cacheKey, {
        bundle,
        loadedAt: Number(now()) || Date.now(),
      });
      return bundle;
    } finally {
      if (loadRequests.get(cacheKey) === loadPromise) {
        loadRequests.delete(cacheKey);
      }
    }
  }

  return {
    getSnapshot: load,
    clear(platform = "") {
      const normalizedPlatform = normalizePlatform(platform);
      if (normalizedPlatform) {
        for (const key of Array.from(cache.keys())) {
          if (key === normalizedPlatform || key.startsWith(`${normalizedPlatform}:`)) {
            cache.delete(key);
          }
        }
        for (const key of Array.from(historyCache.keys())) {
          if (key.startsWith(`${normalizedPlatform}:`)) {
            historyCache.delete(key);
          }
        }
      } else {
        cache.clear();
        historyCache.clear();
      }
    },
    getCacheSnapshot() {
      const keys = new Set([...cache.keys(), ...loadRequests.keys()]);
      return Object.fromEntries(
        Array.from(keys).map((key) => {
          const entry = cache.get(key);
          return [key, {
            loadedAt: entry?.loadedAt || 0,
            hasBundle: Boolean(entry?.bundle),
            loading: loadRequests.has(key),
          }];
        })
      );
    },
  };
}
