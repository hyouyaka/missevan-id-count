import {
  normalizeWeeklyPlaybackDate,
  normalizeWeeklyPlaybackIndex,
  normalizeWeeklyPlaybackSnapshot,
  normalizeWeeklyPlaybackBundle,
  selectWeeklyPlaybackDates,
} from "../../shared/weeklyPlaybackUtils.js";

export const WEEKLY_PLAYBACK_INDEX_KEY_SUFFIX = ":watchcount:weekly:index";
export const WEEKLY_PLAYBACK_DAILY_KEY_PATTERN = "{platform}:watchcount:*";
export const WEEKLY_PLAYBACK_CACHE_TTL_MS = 5 * 60 * 1000;

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

export function createWeeklyPlaybackStore({
  command,
  now = () => Date.now(),
  cacheTtlMs = WEEKLY_PLAYBACK_CACHE_TTL_MS,
  maxWeeks = 32,
  scanMaxPages = 64,
  scanCount = 100,
} = {}) {
  if (typeof command !== "function") {
    throw new TypeError("createWeeklyPlaybackStore requires a command function");
  }

  const cache = new Map();

  async function readJson(key) {
    return parseJsonValue(await command(["GET", key]));
  }

  async function scanDailyIndex(platform) {
    let cursor = "0";
    let previousCursor = "";
    const keys = new Set();
    for (let page = 0; page < Math.max(1, Number(scanMaxPages) || 64); page += 1) {
      const result = await command([
        "SCAN",
        cursor,
        "MATCH",
        WEEKLY_PLAYBACK_DAILY_KEY_PATTERN.replace("{platform}", platform),
        "COUNT",
        String(Math.max(10, Number(scanCount) || 100)),
      ]);
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
    const rawIndex = await readJson(`${platform}${WEEKLY_PLAYBACK_INDEX_KEY_SUFFIX}`).catch(() => null);
    return normalizeWeeklyPlaybackIndex(rawIndex, platform) || scanDailyIndex(platform);
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
    const timestamp = Number(now()) || Date.now();
    const cached = cache.get(normalizedPlatform);
    if (
      !force &&
      cached &&
      !cached.promise &&
      timestamp - cached.loadedAt < Math.max(1000, Number(cacheTtlMs) || WEEKLY_PLAYBACK_CACHE_TTL_MS)
    ) {
      return cached.bundle;
    }
    if (!force && cached?.promise) {
      return cached.promise;
    }

    const loadPromise = (async () => {
      const index = await readIndex(normalizedPlatform);
      if (!index) {
        return null;
      }
      const dates = selectWeeklyPlaybackDates(index, maxWeeks);
      const keys = dates.map((date) => resolveSnapshotKey(normalizedPlatform, index, date));
      const rawSnapshots = keys.length ? await command(["MGET", ...keys]) : [];
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

    cache.set(normalizedPlatform, {
      bundle: cached?.bundle || null,
      loadedAt: cached?.loadedAt || 0,
      promise: loadPromise,
    });
    try {
      const bundle = await loadPromise;
      cache.set(normalizedPlatform, {
        bundle,
        loadedAt: Number(now()) || Date.now(),
        promise: null,
      });
      return bundle;
    } catch (error) {
      cache.delete(normalizedPlatform);
      throw error;
    }
  }

  return {
    getSnapshot: load,
    clear(platform = "") {
      const normalizedPlatform = normalizePlatform(platform);
      if (normalizedPlatform) {
        cache.delete(normalizedPlatform);
      } else {
        cache.clear();
      }
    },
    getCacheSnapshot() {
      return Object.fromEntries(
        Array.from(cache.entries()).map(([platform, entry]) => [platform, {
          loadedAt: entry.loadedAt || 0,
          hasBundle: Boolean(entry.bundle),
          loading: Boolean(entry.promise),
        }])
      );
    },
  };
}
