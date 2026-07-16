const DAY_MS = 24 * 60 * 60 * 1000;
export const METRIC_SAMPLE_WINDOW_DAYS = 30;

export const WEEKLY_PLAYBACK_WINDOWS = Object.freeze([
  { key: "3w", label: "3周", weeks: 3, days: 21 },
  { key: "7w", label: "7周", weeks: 7, days: 49 },
  { key: "30w", label: "30周", weeks: 30, days: 210 },
]);

export const WEEKLY_PLAYBACK_METRIC = Object.freeze({
  key: "view_count",
  label: "播放量",
});

const METRIC_KEYS_BY_PLATFORM = Object.freeze({
  missevan: ["view_count", "danmaku_uid_count", "subscription_num"],
  manbo: ["view_count", "danmaku_uid_count", "pay_count"],
});

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

export function normalizeWeeklyPlaybackDate(value) {
  const normalized = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function parseDateKey(value) {
  const normalized = normalizeWeeklyPlaybackDate(value);
  return normalized ? Date.parse(`${normalized}T00:00:00.000Z`) : NaN;
}

export function normalizeWeeklyPlaybackFiniteNumber(value) {
  if (value == null || String(value).trim() === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeGeneratedAt(value) {
  return String(
    value?.generated_at ??
      value?.generatedAt ??
      value?.updated_at ??
      value?.updatedAt ??
      value?.fetched_at ??
      value?.fetchedAt ??
      value?._meta?.generated_at ??
      value?._meta?.generatedAt ??
      value?._meta?.updated_at ??
      value?._meta?.updatedAt ??
      value?._meta?.fetched_at ??
      value?._meta?.fetchedAt ??
      ""
  ).trim();
}

function normalizeStringMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([date, key]) => [normalizeWeeklyPlaybackDate(date), String(key ?? "").trim()])
      .filter(([date, key]) => date && key)
  );
}

export function normalizeWeeklyPlaybackIndex(rawValue, platform, options = {}) {
  const normalizedPlatform = String(platform ?? "").trim();
  const raw = parseJsonValue(rawValue);
  const candidate = raw?.index && typeof raw.index === "object" ? raw.index : raw;
  if (!normalizedPlatform || !candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const dates = Array.from(
    new Set(
      (Array.isArray(candidate.dates)
        ? candidate.dates
        : Array.isArray(candidate.weeks)
          ? candidate.weeks
          : Object.keys(candidate.snapshots || candidate.keys || {}))
        .map(normalizeWeeklyPlaybackDate)
        .filter(Boolean)
    )
  ).sort();
  if (!dates.length) {
    return null;
  }

  const rawGranularity = String(
    candidate.granularity ?? candidate.period ?? candidate.frequency ?? options.granularity ?? "weekly"
  ).trim().toLowerCase();
  const granularity = rawGranularity === "daily" ? "daily" : "weekly";
  const keys = normalizeStringMap(candidate.keys ?? candidate.weekly_keys ?? candidate.snapshot_keys);
  const generatedAt = normalizeGeneratedAt(candidate);
  return {
    version: candidate.version ?? 1,
    platform: normalizedPlatform,
    granularity,
    dates,
    keys,
    ...(candidate.key_prefix || candidate.keyPrefix
      ? { keyPrefix: String(candidate.key_prefix ?? candidate.keyPrefix).trim() }
      : {}),
    ...(generatedAt ? { generatedAt } : {}),
    ...(candidate.source ? { source: String(candidate.source).trim() } : {}),
  };
}

function getSnapshotRecords(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return [];
  }
  const nested =
    raw.dramas ??
    raw.records ??
    raw.items ??
    raw.counts ??
    raw.data?.dramas ??
    raw.data?.counts ??
    raw.data;
  const candidate = nested && typeof nested === "object" && !Array.isArray(nested) ? nested : raw;
  if (Array.isArray(nested)) {
    return nested.map((record) => [String(record?.id ?? record?.drama_id ?? "").trim(), record]);
  }
  return Object.entries(candidate).filter(([key]) =>
    !["version", "platform", "date", "week", "week_ending", "generated_at", "generatedAt", "updated_at", "updatedAt"].includes(key)
  );
}

function getPlaybackValue(record) {
  if (typeof record === "number") {
    return normalizeWeeklyPlaybackFiniteNumber(record);
  }
  if (!record || typeof record !== "object") {
    return null;
  }
  const metrics = record.metrics && typeof record.metrics === "object" ? record.metrics : {};
  const candidates = [
    record.view_count,
    record.viewCount,
    record.watch_count,
    record.watchCount,
    record.play_count,
    record.playCount,
    metrics.view_count,
    metrics.viewCount,
    metrics.watch_count,
    metrics.watchCount,
    metrics.play_count,
    metrics.playCount,
  ];
  for (const candidate of candidates) {
    const value = normalizeWeeklyPlaybackFiniteNumber(candidate);
    if (value != null) {
      return value;
    }
  }
  return null;
}

export function normalizeWeeklyPlaybackSnapshot(rawValue, platform, fallbackDate = "") {
  const normalizedPlatform = String(platform ?? "").trim();
  const raw = parseJsonValue(rawValue);
  if (!normalizedPlatform || !raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const date = normalizeWeeklyPlaybackDate(
    raw.date ?? raw.week ?? raw.week_ending ?? raw.weekEnding ?? fallbackDate
  ) || normalizeWeeklyPlaybackDate(fallbackDate);
  if (!date) {
    return null;
  }

  const dramas = {};
  for (const [rawId, rawRecord] of getSnapshotRecords(raw)) {
    const recordId = String(
      rawRecord?.id ?? rawRecord?.drama_id ?? rawRecord?.dramaId ?? rawId ?? ""
    ).trim();
    const viewCount = getPlaybackValue(rawRecord);
    if (!recordId || viewCount == null) {
      continue;
    }
    const name = String(rawRecord?.name ?? rawRecord?.title ?? rawRecord?.drama_name ?? "").trim();
    const generatedAt = normalizeGeneratedAt(rawRecord) || normalizeGeneratedAt(raw);
    dramas[recordId] = {
      id: recordId,
      ...(name ? { name } : {}),
      view_count: viewCount,
      ...(generatedAt ? { generated_at: generatedAt } : {}),
    };
  }

  const generatedAt = normalizeGeneratedAt(raw);
  return {
    version: raw.version ?? 1,
    platform: normalizedPlatform,
    date,
    ...(generatedAt ? { generatedAt } : {}),
    dramas,
  };
}

export function normalizeWeeklyPlaybackBundle({ platform, index, snapshotsByDate } = {}) {
  const normalizedPlatform = String(platform ?? index?.platform ?? "").trim();
  const normalizedIndex = normalizeWeeklyPlaybackIndex(index, normalizedPlatform);
  if (!normalizedPlatform || !normalizedIndex) {
    return null;
  }
  const normalizedSnapshots = Object.fromEntries(
    Object.entries(snapshotsByDate && typeof snapshotsByDate === "object" ? snapshotsByDate : {})
      .map(([date, snapshot]) => [
        normalizeWeeklyPlaybackDate(date),
        snapshot && typeof snapshot === "object" ? snapshot : null,
      ])
      .filter(([date, snapshot]) => date && snapshot?.platform === normalizedPlatform)
  );
  const latestSnapshotGeneratedAt = [...normalizedIndex.dates]
    .reverse()
    .map((date) => String(normalizedSnapshots[date]?.generatedAt ?? "").trim())
    .find(Boolean) || "";
  return {
    platform: normalizedPlatform,
    version: normalizedIndex.version,
    granularity: normalizedIndex.granularity,
    dates: normalizedIndex.dates,
    generatedAt: latestSnapshotGeneratedAt || normalizedIndex.generatedAt || "",
    snapshotsByDate: normalizedSnapshots,
    source: normalizedIndex.source || "watchcount",
  };
}

export function selectWeeklyPlaybackDates(index, maxWeeks = 32) {
  const dates = Array.from(
    new Set((Array.isArray(index?.dates) ? index.dates : []).map(normalizeWeeklyPlaybackDate).filter(Boolean))
  ).sort();
  const limit = Math.max(1, Math.floor(Number(maxWeeks) || 32));
  if (index?.granularity !== "daily") {
    return dates.slice(-limit);
  }

  const selected = [];
  let targetTime = parseDateKey(dates.at(-1));
  for (let indexOffset = 0; indexOffset < limit && Number.isFinite(targetTime); indexOffset += 1) {
    const date = [...dates].reverse().find((candidate) => parseDateKey(candidate) <= targetTime);
    if (date && !selected.includes(date)) {
      selected.unshift(date);
    }
    targetTime -= 7 * DAY_MS;
  }
  return selected;
}

export function getWeeklyPlaybackRecord(bundle, id, date) {
  const snapshot = bundle?.snapshotsByDate?.[date];
  const dramas = snapshot?.dramas && typeof snapshot.dramas === "object" ? snapshot.dramas : {};
  return dramas[String(id ?? "").trim()] || null;
}

export function hasWeeklyPlaybackRecord(bundle, id) {
  return (Array.isArray(bundle?.dates) ? bundle.dates : []).some((date) =>
    getWeeklyPlaybackRecord(bundle, id, date)?.view_count != null
  );
}

export function countValidMetricSamples({
  platform,
  aggregateSnapshot,
  id,
  windowDays = METRIC_SAMPLE_WINDOW_DAYS,
} = {}) {
  const metricKeys = METRIC_KEYS_BY_PLATFORM[String(platform ?? "").trim()] || [];
  const normalizedId = String(id ?? "").trim();
  const dates = Array.from(
    new Set(
      (Array.isArray(aggregateSnapshot?.dates) ? aggregateSnapshot.dates : [])
        .map(normalizeWeeklyPlaybackDate)
        .filter(Boolean)
        .sort()
    )
  );
  const latestTime = Math.max(...dates.map(parseDateKey).filter(Number.isFinite));
  const normalizedWindowDays = Math.max(1, Math.floor(Number(windowDays) || METRIC_SAMPLE_WINDOW_DAYS));
  const earliestTime = latestTime - (normalizedWindowDays - 1) * DAY_MS;
  const dramaRecord = aggregateSnapshot?.dramas?.[normalizedId];
  const samples = dramaRecord?.samples && typeof dramaRecord.samples === "object"
    ? dramaRecord.samples
    : {};
  let previousMetricValues = null;
  return dates
    .map(normalizeWeeklyPlaybackDate)
    .filter(Boolean)
    .filter((date) => {
      const sample = samples[date];
      if (!sample || typeof sample !== "object" || Array.isArray(sample)) {
        return false;
      }
      const metrics = sample.metrics;
      if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) {
        return false;
      }
      const currentMetricValues = metricKeys.map((key) =>
        normalizeWeeklyPlaybackFiniteNumber(metrics?.[key])
      );
      if (!currentMetricValues.some((value) => value != null)) {
        return false;
      }
      const isRepeated = previousMetricValues && currentMetricValues.every((value, index) =>
        value === previousMetricValues[index]
      );
      previousMetricValues = currentMetricValues;
      const dateTime = parseDateKey(date);
      if (!Number.isFinite(latestTime) || !Number.isFinite(dateTime) || dateTime < earliestTime || dateTime > latestTime) {
        return false;
      }
      return !isRepeated;
    }).length;
}

function getMetricFallbackRecord(aggregateSnapshot, id, date) {
  const dramaRecord = aggregateSnapshot?.dramas?.[String(id ?? "").trim()];
  const sample = dramaRecord?.samples?.[date];
  const viewCount = normalizeWeeklyPlaybackFiniteNumber(sample?.metrics?.view_count);
  if (viewCount == null) {
    return null;
  }
  const generatedAt = normalizeGeneratedAt(sample) || normalizeGeneratedAt(aggregateSnapshot);
  return {
    id: String(id ?? "").trim(),
    name: String(dramaRecord?.name ?? "").trim(),
    view_count: viewCount,
    ...(generatedAt ? { generated_at: generatedAt } : {}),
  };
}

function buildWeeklyMetric({ history, windowHistory }) {
  const availableHistory = windowHistory.filter((point) => point.value != null);
  const fromPoint = availableHistory[0] || null;
  const toPoint = availableHistory.at(-1) || null;
  const fromValue = fromPoint?.value ?? null;
  const toValue = toPoint?.value ?? null;
  const available = Boolean(fromPoint && toPoint && fromPoint !== toPoint);
  const delta = available ? toValue - fromValue : null;
  const deltaPercent = available && fromValue !== 0 ? delta / fromValue : null;
  return {
    key: WEEKLY_PLAYBACK_METRIC.key,
    label: WEEKLY_PLAYBACK_METRIC.label,
    fromValue,
    toValue,
    delta,
    deltaPercent,
    available,
    history,
  };
}

function buildWeeklyWindow({ key, label, weeks, dates, latestDate, valuesByDate }) {
  const latestTime = parseDateKey(latestDate);
  const earliestAllowedTime = latestTime - weeks * 7 * DAY_MS;
  const preWindowDate = [...dates].reverse().find((date) => {
    const time = parseDateKey(date);
    return Number.isFinite(time) && time < earliestAllowedTime && valuesByDate[date]?.value != null;
  }) || "";
  const windowDates = dates.filter((date) => {
    const time = parseDateKey(date);
    return Number.isFinite(time) && time >= earliestAllowedTime && time <= latestTime;
  });
  const historyDates = preWindowDate ? [preWindowDate, ...windowDates] : windowDates;
  let previousValue = null;
  const history = historyDates.map((date) => {
    const source = valuesByDate[date] || { value: null };
    const value = normalizeWeeklyPlaybackFiniteNumber(source.value);
    const isPreWindow = date === preWindowDate;
    const deltaValue = !isPreWindow && value != null && previousValue != null
      ? value - previousValue
      : null;
    if (value != null) {
      previousValue = value;
    }
    return {
      date,
      value,
      ...(deltaValue != null ? { deltaValue } : {}),
      ...(source.generatedAt ? { generatedAt: source.generatedAt } : {}),
      ...(isPreWindow ? { isPreWindow: true } : {}),
    };
  });
  const windowHistory = history.filter((point) => !point.isPreWindow);
  const availableHistory = windowHistory.filter((point) => point.value != null);
  const metric = buildWeeklyMetric({ history, windowHistory });
  return {
    key,
    label,
    weeks,
    days: weeks * 7,
    fromDate: availableHistory[0]?.date || "",
    toDate: availableHistory.at(-1)?.date || "",
    insufficientData: availableHistory.length < 2,
    metrics: [metric],
    ...(availableHistory.at(-1)?.generatedAt ? { generatedAt: availableHistory.at(-1).generatedAt } : {}),
  };
}

export function buildWeeklyPlaybackTrendResponse({
  platform,
  id,
  weeklyPlaybackSnapshot,
  metricAggregateSnapshot,
  allowMetricFallback = false,
} = {}) {
  const normalizedPlatform = String(platform ?? "").trim();
  const normalizedId = String(id ?? "").trim();
  if (!normalizedPlatform || !normalizedId) {
    return { success: false, status: 400, message: "Invalid rank trend request" };
  }

  const weeklyDates = Array.isArray(weeklyPlaybackSnapshot?.dates)
    ? Array.from(
        new Set(weeklyPlaybackSnapshot.dates.map(normalizeWeeklyPlaybackDate).filter(Boolean))
      ).sort()
    : [];
  const dates = weeklyDates;
  const valuesByDate = {};
  let usedWatchcount = false;
  let usedMetricFallback = false;
  let name = "";

  dates.forEach((date) => {
    const weeklyRecord = getWeeklyPlaybackRecord(weeklyPlaybackSnapshot, normalizedId, date);
    const weeklyValue = normalizeWeeklyPlaybackFiniteNumber(weeklyRecord?.view_count);
    const fallbackRecord = allowMetricFallback
      ? getMetricFallbackRecord(metricAggregateSnapshot, normalizedId, date)
      : null;
    const value = weeklyValue ?? fallbackRecord?.view_count ?? null;
    if (weeklyValue != null) {
      usedWatchcount = true;
      name = name || String(weeklyRecord?.name ?? "").trim();
    } else if (fallbackRecord?.view_count != null) {
      usedMetricFallback = true;
      name = name || fallbackRecord.name;
    }
    valuesByDate[date] = {
      value,
      generatedAt: normalizeGeneratedAt(weeklyRecord) || normalizeGeneratedAt(fallbackRecord),
    };
  });

  const availableDates = dates.filter((date) => valuesByDate[date]?.value != null);
  if (!availableDates.length) {
    return {
      success: false,
      status: 404,
      platform: normalizedPlatform,
      id: normalizedId,
      kind: "weekly_playback",
      message: "Weekly playback trend not found",
    };
  }

  const latestDate = availableDates.at(-1);
  const latestRecord = getWeeklyPlaybackRecord(weeklyPlaybackSnapshot, normalizedId, latestDate);
  name = String(name || latestRecord?.name || metricAggregateSnapshot?.dramas?.[normalizedId]?.name || normalizedId).trim();
  const source = usedWatchcount && usedMetricFallback
    ? "watchcount+metric_fallback"
    : usedWatchcount
      ? "watchcount"
      : "metric_fallback";

  return {
    success: true,
    kind: "weekly_playback",
    trendType: "weekly_playback",
    dataSource: source,
    platform: normalizedPlatform,
    id: normalizedId,
    name,
    latestDate,
    rankHistoryLatestDate: "",
    rankHistory: [],
    weeklySampleCount: availableDates.length,
    windows: Object.fromEntries(
      WEEKLY_PLAYBACK_WINDOWS.map((windowConfig) => [
        windowConfig.key,
        buildWeeklyWindow({
          key: windowConfig.key,
          label: windowConfig.label,
          weeks: windowConfig.weeks,
          dates,
          latestDate,
          valuesByDate,
        }),
      ])
    ),
  };
}
