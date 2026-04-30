const DAY_MS = 24 * 60 * 60 * 1000;

const TREND_WINDOWS = Object.freeze([
  { key: "3d", label: "3日", days: 3 },
  { key: "7d", label: "7日", days: 7 },
  { key: "30d", label: "30日", days: 30 },
]);

const TREND_METRICS = Object.freeze({
  missevan: [
    { key: "view_count", label: "播放量" },
    { key: "danmaku_uid_count", label: "付费ID数" },
    { key: "subscription_num", label: "追剧人数" },
  ],
  manbo: [
    { key: "view_count", label: "播放量" },
    { key: "danmaku_uid_count", label: "付费ID数" },
    { key: "pay_count", label: "付费/收听人数" },
  ],
});

function normalizeDateKey(value) {
  const normalized = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function parseDateKey(value) {
  const normalized = normalizeDateKey(value);
  if (!normalized) {
    return NaN;
  }
  return Date.parse(`${normalized}T00:00:00.000Z`);
}

function normalizeFiniteNumber(value) {
  if (value == null || String(value).trim() === "") {
    return null;
  }
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

export function normalizeRankTrendDates(indexSnapshot) {
  const dates = Array.isArray(indexSnapshot?.dates) ? indexSnapshot.dates : [];
  return Array.from(new Set(dates.map(normalizeDateKey).filter(Boolean))).sort();
}

export function getRankTrendMetricConfigs(platform) {
  return TREND_METRICS[platform] || [];
}

function getDramaMetrics(snapshot, id) {
  const dramas = snapshot?.dramas && typeof snapshot.dramas === "object" ? snapshot.dramas : {};
  return dramas[String(id)] || null;
}

function getRankItemId(item) {
  if (item && typeof item === "object") {
    return String(
      item.drama_id ??
        item.dramaId ??
        item.raw?.dramaId ??
        item.raw?.drama_id ??
        ""
    ).trim();
  }
  return String(item ?? "").trim();
}

function buildRankHistory(dates, listSnapshotsByDate, id) {
  return dates
    .map((date) => {
      const ranks =
        listSnapshotsByDate?.[date]?.ranks && typeof listSnapshotsByDate[date].ranks === "object"
          ? listSnapshotsByDate[date].ranks
          : {};
      const matchedRanks = Object.entries(ranks)
        .map(([rankKey, rank]) => {
          const items = Array.isArray(rank?.items) ? rank.items : [];
          const itemIndex = items.findIndex((item) => getRankItemId(item) === id);
          if (itemIndex < 0) {
            return null;
          }
          const item = items[itemIndex];
          const position = normalizeFiniteNumber(
            item && typeof item === "object" ? item.position : itemIndex + 1
          );
          return {
            key: rankKey,
            name: String(rank?.name ?? rankKey).trim(),
            position: position ?? itemIndex + 1,
          };
        })
        .filter(Boolean);

      return matchedRanks.length
        ? {
            date,
            ranks: matchedRanks,
          }
        : null;
    })
    .filter(Boolean);
}

function buildMetric(config, fromDrama, toDrama, history) {
  const fromValue = normalizeFiniteNumber(fromDrama?.[config.key]);
  const toValue = normalizeFiniteNumber(toDrama?.[config.key]);
  const available = fromValue != null && toValue != null;
  const delta = available ? toValue - fromValue : null;
  const deltaPercent = available && fromValue !== 0 ? delta / fromValue : null;

  return {
    key: config.key,
    label: config.label,
    fromValue,
    toValue,
    delta,
    deltaPercent,
    available,
    history: history.map((point) => ({
      date: point.date,
      value: normalizeFiniteNumber(point.drama?.[config.key]),
    })),
  };
}

function buildWindowTrend({ windowConfig, dates, latestDate, snapshotsByDate, platform, id }) {
  const latestTime = parseDateKey(latestDate);
  const earliestAllowedTime = latestTime - windowConfig.days * DAY_MS;
  const windowDates = dates.filter((date) => {
    const time = parseDateKey(date);
    return Number.isFinite(time) && time >= earliestAllowedTime && time <= latestTime;
  });
  const history = windowDates
    .map((date) => ({
      date,
      drama: getDramaMetrics(snapshotsByDate[date], id),
    }))
    .filter((point) => point.drama);

  if (history.length < 2) {
    return {
      key: windowConfig.key,
      label: windowConfig.label,
      days: windowConfig.days,
      fromDate: history[0]?.date || "",
      toDate: history.at(-1)?.date || "",
      insufficientData: true,
      metrics: getRankTrendMetricConfigs(platform).map((config) =>
        buildMetric(config, history[0]?.drama || null, history.at(-1)?.drama || null, history)
      ),
    };
  }

  const fromPoint = history[0];
  const toPoint = history.at(-1);
  return {
    key: windowConfig.key,
    label: windowConfig.label,
    days: windowConfig.days,
    fromDate: fromPoint.date,
    toDate: toPoint.date,
    insufficientData: false,
    metrics: getRankTrendMetricConfigs(platform).map((config) =>
      buildMetric(config, fromPoint.drama, toPoint.drama, history)
    ),
  };
}

export function buildRankTrendResponse({
  platform,
  id,
  indexSnapshot,
  metricSnapshotsByDate,
  listSnapshotsByDate,
} = {}) {
  const normalizedPlatform = String(platform ?? "").trim();
  const normalizedId = String(id ?? "").trim();
  const metricConfigs = getRankTrendMetricConfigs(normalizedPlatform);
  if (!metricConfigs.length || !normalizedId) {
    return {
      success: false,
      status: 400,
      message: "Invalid rank trend request",
    };
  }

  const dates = normalizeRankTrendDates(indexSnapshot).filter((date) =>
    metricSnapshotsByDate?.[date]
  );
  const latestDate = [...dates]
    .reverse()
    .find((date) => getDramaMetrics(metricSnapshotsByDate[date], normalizedId));

  if (!latestDate) {
    return {
      success: false,
      status: 404,
      platform: normalizedPlatform,
      id: normalizedId,
      message: "Rank trend drama not found",
    };
  }

  const latestDrama = getDramaMetrics(metricSnapshotsByDate[latestDate], normalizedId);
  return {
    success: true,
    platform: normalizedPlatform,
    id: normalizedId,
    name: String(latestDrama?.name ?? "").trim(),
    latestDate,
    rankHistory: buildRankHistory(dates, listSnapshotsByDate, normalizedId),
    windows: Object.fromEntries(
      TREND_WINDOWS.map((windowConfig) => [
        windowConfig.key,
        buildWindowTrend({
          windowConfig,
          dates,
          latestDate,
          snapshotsByDate: metricSnapshotsByDate,
          platform: normalizedPlatform,
          id: normalizedId,
        }),
      ])
    ),
  };
}
