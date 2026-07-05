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

const PEAK_SERIES_TREND_METRICS = Object.freeze([
  { key: "view_count", label: "系列总播放量" },
]);

const CV_TREND_WINDOWS = Object.freeze([
  { key: "3w", label: "3周", days: 21 },
  { key: "7w", label: "7周", days: 49 },
  { key: "30w", label: "30周", days: 210 },
]);

const CV_TREND_METRICS = Object.freeze([
  {
    key: "missevan_total_view_count",
    label: "猫耳总播放量",
    platform: "missevan",
    scope: "total",
    metricKey: "totalViewCount",
  },
  {
    key: "missevan_paid_view_count",
    label: "猫耳付费播放量",
    platform: "missevan",
    scope: "paid",
    metricKey: "paidViewCount",
  },
  {
    key: "manbo_total_view_count",
    label: "漫播总播放量",
    platform: "manbo",
    scope: "total",
    metricKey: "totalViewCount",
  },
  {
    key: "manbo_paid_view_count",
    label: "漫播付费播放量",
    platform: "manbo",
    scope: "paid",
    metricKey: "paidViewCount",
  },
]);

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

function normalizeGeneratedAt(record) {
  return String(
    record?.generated_at ??
      record?.generatedAt ??
      record?.fetched_at ??
      record?.fetchedAt ??
      record?.updated_at ??
      record?.updatedAt ??
      ""
  ).trim();
}

function withGeneratedAt(payload, record) {
  const generatedAt = normalizeGeneratedAt(record);
  return generatedAt ? { ...payload, generatedAt } : payload;
}

function normalizeStringIdList(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
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

function normalizeCvName(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function isRankTrendAggregateSnapshot(snapshot, platform) {
  const normalizedPlatform = String(platform ?? "").trim();
  return Boolean(
    normalizedPlatform &&
      snapshot &&
      typeof snapshot === "object" &&
      String(snapshot.platform ?? "").trim() === normalizedPlatform &&
      Array.isArray(snapshot.dates) &&
      snapshot.dramas &&
      typeof snapshot.dramas === "object" &&
      !Array.isArray(snapshot.dramas)
  );
}

export function isCvRankTrendAggregateSnapshot(snapshot, platform) {
  const normalizedPlatform = String(platform ?? "").trim();
  return Boolean(
    normalizedPlatform &&
      snapshot &&
      typeof snapshot === "object" &&
      String(snapshot.platform ?? "").trim() === normalizedPlatform &&
      snapshot.cvs &&
      typeof snapshot.cvs === "object" &&
      !Array.isArray(snapshot.cvs)
  );
}

function normalizePeakSeriesSamples(seriesRecord) {
  const samples = seriesRecord?.samples && typeof seriesRecord.samples === "object"
    ? seriesRecord.samples
    : {};
  return Object.entries(samples)
    .map(([date, sample]) => ({
      date: normalizeDateKey(date),
      view_count: normalizeFiniteNumber(sample?.view_count),
      position: normalizeFiniteNumber(sample?.position),
      fetched_at: String(sample?.fetched_at ?? "").trim(),
    }))
    .filter((sample) => sample.date && sample.view_count != null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function getPeakSeriesDates(peakSnapshot, seriesRecord) {
  const snapshotDates = Array.isArray(peakSnapshot?.dates) ? peakSnapshot.dates : [];
  const sampleDates = normalizePeakSeriesSamples(seriesRecord).map((sample) => sample.date);
  return Array.from(new Set([...snapshotDates, ...sampleDates].map(normalizeDateKey).filter(Boolean))).sort();
}

function findPeakSeriesRecord(peakSnapshot, id) {
  const normalizedId = String(id ?? "").trim();
  const series = peakSnapshot?.series && typeof peakSnapshot.series === "object"
    ? peakSnapshot.series
    : {};
  if (!normalizedId) {
    return null;
  }

  if (series[normalizedId] && typeof series[normalizedId] === "object") {
    return {
      key: normalizedId,
      record: series[normalizedId],
    };
  }

  const matchedEntry = Object.entries(series).find(([, record]) =>
    String(record?.name ?? "").trim() === normalizedId
  );
  if (!matchedEntry) {
    return null;
  }
  return {
    key: matchedEntry[0],
    record: matchedEntry[1],
  };
}

function getMetricHistoryRange(history, getValue) {
  const points = (Array.isArray(history) ? history : [])
    .map((point) => ({
      point,
      value: getValue(point),
    }))
    .filter((entry) => entry.value != null);
  const from = points[0] || null;
  const to = points.at(-1) || null;
  return {
    fromPoint: from?.point || null,
    toPoint: to?.point || null,
    fromValue: from?.value ?? null,
    toValue: to?.value ?? null,
    hasComparableRange: Boolean(from && to && from.point !== to.point),
  };
}

function getTrendMetricValues(record, metricConfigs) {
  return metricConfigs.map((config) => normalizeFiniteNumber(record?.[config.key]));
}

function areTrendMetricValuesEqual(leftValues, rightValues) {
  return (
    Array.isArray(leftValues) &&
    Array.isArray(rightValues) &&
    leftValues.length === rightValues.length &&
    leftValues.every((value, index) => value === rightValues[index])
  );
}

function getRepeatedTrendSampleDateSet({ dates, snapshotsByDate, platform, id }) {
  const metricConfigs = getRankTrendMetricConfigs(platform);
  const staleDateSet = new Set();
  let previousValues = null;

  dates.forEach((date) => {
    const drama = getDramaMetrics(snapshotsByDate[date], id);
    if (!drama) {
      return;
    }
    const currentValues = getTrendMetricValues(drama, metricConfigs);
    if (previousValues && areTrendMetricValuesEqual(currentValues, previousValues)) {
      staleDateSet.add(date);
    }
    previousValues = currentValues;
  });

  return staleDateSet;
}

function getRepeatedPeakSeriesSampleDateSet({ dates, samplesByDate }) {
  const staleDateSet = new Set();
  let previousValues = null;

  dates.forEach((date) => {
    const sample = samplesByDate[date];
    if (!sample) {
      return;
    }
    const currentValues = getTrendMetricValues(sample, PEAK_SERIES_TREND_METRICS);
    if (previousValues && areTrendMetricValuesEqual(currentValues, previousValues)) {
      staleDateSet.add(date);
    }
    previousValues = currentValues;
  });

  return staleDateSet;
}

function buildPeakSeriesMetric(config, history, rangeHistory = history) {
  const range = getMetricHistoryRange(rangeHistory, (sample) =>
    normalizeFiniteNumber(sample?.[config.key])
  );
  const fromValue = range.fromValue;
  const toValue = range.toValue;
  const available = range.hasComparableRange;
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
    history: history.map((sample) =>
      withGeneratedAt(
        {
          date: sample.date,
          value: normalizeFiniteNumber(sample?.[config.key]),
          ...(sample?.isPreWindow ? { isPreWindow: true } : {}),
        },
        sample
      )
    ),
  };
}

function buildPeakSeriesWindowTrend({ windowConfig, dates, latestDate, samplesByDate, staleDateSet }) {
  const latestTime = parseDateKey(latestDate);
  const earliestAllowedTime = latestTime - windowConfig.days * DAY_MS;
  const preWindowTime = earliestAllowedTime - DAY_MS;
  const preWindowDate = dates.find((date) => parseDateKey(date) === preWindowTime) || "";
  const windowDates = dates.filter((date) => {
    const time = parseDateKey(date);
    return Number.isFinite(time) && time >= earliestAllowedTime && time <= latestTime;
  });
  const historyDates = preWindowDate ? [preWindowDate, ...windowDates] : windowDates;
  const history = historyDates.map((date) => {
    const sample = staleDateSet.has(date) ? { date } : samplesByDate[date] || { date };
    return {
      ...sample,
      date,
      ...(date === preWindowDate ? { isPreWindow: true } : {}),
    };
  });
  const windowHistory = history.filter((sample) => !sample.isPreWindow);
  const availableHistory = windowHistory.filter((sample) =>
    normalizeFiniteNumber(sample?.view_count) != null
  );

  if (availableHistory.length < 2) {
    return withGeneratedAt({
      key: windowConfig.key,
      label: windowConfig.label,
      days: windowConfig.days,
      fromDate: availableHistory[0]?.date || "",
      toDate: availableHistory.at(-1)?.date || "",
      insufficientData: true,
      metrics: PEAK_SERIES_TREND_METRICS.map((config) =>
        buildPeakSeriesMetric(config, history, windowHistory)
      ),
    }, availableHistory.at(-1));
  }

  const fromSample = availableHistory[0];
  const toSample = availableHistory.at(-1);
  return withGeneratedAt({
    key: windowConfig.key,
    label: windowConfig.label,
    days: windowConfig.days,
    fromDate: fromSample.date,
    toDate: toSample.date,
    insufficientData: false,
    metrics: PEAK_SERIES_TREND_METRICS.map((config) =>
      buildPeakSeriesMetric(config, history, windowHistory)
    ),
  }, toSample);
}

function buildPeakSeriesRankHistory(samples) {
  return samples
    .filter((sample) => sample.position != null)
    .map((sample) => ({
      date: sample.date,
      ranks: [
        {
          key: "peak",
          name: "巅峰榜",
          position: sample.position,
        },
      ],
    }));
}

export function getPeakSeriesDailyViewDelta(seriesRecord) {
  const samples = normalizePeakSeriesSamples(seriesRecord);
  if (samples.length < 2) {
    return {
      available: false,
      fromDate: samples[0]?.date || "",
      toDate: samples.at(-1)?.date || "",
      fromValue: samples[0]?.view_count ?? null,
      toValue: samples.at(-1)?.view_count ?? null,
      delta: null,
    };
  }

  const fromSample = samples.at(-2);
  const toSample = samples.at(-1);
  return {
    available: true,
    fromDate: fromSample.date,
    toDate: toSample.date,
    fromValue: fromSample.view_count,
    toValue: toSample.view_count,
    delta: toSample.view_count - fromSample.view_count,
  };
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

function findCvTrendRecord(snapshot, cvName) {
  const normalizedCvName = normalizeCvName(cvName);
  const cvs = snapshot?.cvs && typeof snapshot.cvs === "object" ? snapshot.cvs : {};
  if (!normalizedCvName) {
    return null;
  }
  if (cvs[normalizedCvName] && typeof cvs[normalizedCvName] === "object") {
    return cvs[normalizedCvName];
  }
  return Object.values(cvs).find((record) =>
    normalizeCvName(record?.cvName ?? record?.name) === normalizedCvName
  ) || null;
}

function getCvTrendSample(snapshot, cvName, date) {
  const samples = findCvTrendRecord(snapshot, cvName)?.samples;
  return samples && typeof samples === "object" ? samples[date] || null : null;
}

function getCvTrendDates(trendSnapshots, cvName) {
  const dates = new Set();
  ["missevan", "manbo"].forEach((platform) => {
    const snapshot = trendSnapshots?.[platform];
    const record = findCvTrendRecord(snapshot, cvName);
    const sampleDates = record?.samples && typeof record.samples === "object"
      ? Object.keys(record.samples)
      : [];
    sampleDates.forEach((date) => {
      const normalizedDate = normalizeDateKey(date);
      if (normalizedDate) {
        dates.add(normalizedDate);
      }
    });
  });
  return Array.from(dates).sort();
}

function getCvMetricPoint({ date, config, trendSnapshots, cvName }) {
  const sample = getCvTrendSample(trendSnapshots?.[config.platform], cvName, date);
  const metrics = sample?.metrics && typeof sample.metrics === "object" ? sample.metrics : {};
  const ranks = sample?.ranks && typeof sample.ranks === "object" ? sample.ranks : {};
  return {
    date,
    value: normalizeFiniteNumber(metrics?.[config.metricKey]),
    position: normalizeFiniteNumber(ranks?.[config.scope]),
    generatedAt: normalizeGeneratedAt(sample) || normalizeGeneratedAt(trendSnapshots?.[config.platform]),
  };
}

function buildCvMetric(config, history, rangeHistory = history) {
  const range = getMetricHistoryRange(rangeHistory, (point) => normalizeFiniteNumber(point?.value));
  const fromValue = range.fromValue;
  const toValue = range.toValue;
  const available = range.hasComparableRange;
  const delta = available ? toValue - fromValue : null;
  const deltaPercent = available && fromValue !== 0 ? delta / fromValue : null;
  let previousValue = null;

  return {
    key: config.key,
    label: config.label,
    fromValue,
    toValue,
    delta,
    deltaPercent,
    available,
    history: history.map((point) => {
      const value = normalizeFiniteNumber(point?.value);
      const deltaValue = value != null && previousValue != null ? value - previousValue : null;
      if (!point?.isPreWindow && value != null) {
        previousValue = value;
      } else if (point?.isPreWindow && value != null) {
        previousValue = value;
      }
      return withGeneratedAt(
        {
          date: point.date,
          value,
          ...(deltaValue != null ? { deltaValue } : {}),
          ...(point?.isPreWindow ? { isPreWindow: true } : {}),
        },
        { generated_at: point.generatedAt }
      );
    }),
  };
}

function buildCvWindowTrend({ windowConfig, dates, latestDate, metricPointsByKey }) {
  const latestTime = parseDateKey(latestDate);
  const earliestAllowedTime = latestTime - windowConfig.days * DAY_MS;
  const preWindowDate = [...dates].reverse().find((date) => {
    const time = parseDateKey(date);
    return Number.isFinite(time) && time < earliestAllowedTime;
  }) || "";
  const windowDates = dates.filter((date) => {
    const time = parseDateKey(date);
    return Number.isFinite(time) && time >= earliestAllowedTime && time <= latestTime;
  });
  const historyDates = preWindowDate ? [preWindowDate, ...windowDates] : windowDates;
  const metrics = CV_TREND_METRICS.map((config) => {
    const pointsByDate = metricPointsByKey[config.key] || {};
    const history = historyDates.map((date) => ({
      ...(pointsByDate[date] || { date, value: null }),
      date,
      ...(date === preWindowDate ? { isPreWindow: true } : {}),
    }));
    return buildCvMetric(config, history, history.filter((point) => !point.isPreWindow));
  });
  const availableDates = windowDates.filter((date) =>
    CV_TREND_METRICS.some((config) => normalizeFiniteNumber(metricPointsByKey[config.key]?.[date]?.value) != null)
  );

  return withGeneratedAt({
    key: windowConfig.key,
    label: windowConfig.label,
    days: windowConfig.days,
    fromDate: availableDates[0] || "",
    toDate: availableDates.at(-1) || "",
    insufficientData: metrics.every((metric) => !metric.available),
    metrics,
  }, { generated_at: historyDates.map((date) =>
    CV_TREND_METRICS.map((config) => metricPointsByKey[config.key]?.[date]?.generatedAt).find(Boolean)
  ).find(Boolean) });
}

function buildCvRankHistory(dates, metricPointsByKey) {
  const rankConfigs = [
    { metricKey: "missevan_total_view_count", key: "missevan-cv", name: "猫耳CV总榜" },
    { metricKey: "missevan_paid_view_count", key: "missevan-cv-paid", name: "猫耳CV付费榜" },
    { metricKey: "manbo_total_view_count", key: "manbo-cv", name: "漫播CV总榜" },
    { metricKey: "manbo_paid_view_count", key: "manbo-cv-paid", name: "漫播CV付费榜" },
  ];
  return dates
    .map((date) => {
      const ranks = rankConfigs
        .map((config) => {
          const position = normalizeFiniteNumber(metricPointsByKey[config.metricKey]?.[date]?.position);
          return position == null
            ? null
            : {
                key: config.key,
                name: config.name,
                position,
              };
        })
        .filter(Boolean);
      return ranks.length ? { date, ranks } : null;
    })
    .filter(Boolean);
}

export function buildCvTrendResponse({
  id,
  trendSnapshots,
} = {}) {
  const cvName = normalizeCvName(id);
  if (!cvName) {
    return {
      success: false,
      status: 400,
      message: "Invalid rank trend request",
    };
  }

  if (
    !["missevan", "manbo"].every((platform) =>
      isCvRankTrendAggregateSnapshot(trendSnapshots?.[platform], platform)
    )
  ) {
    return {
      success: false,
      status: 503,
      kind: "cv",
      id: cvName,
      message: "CV rank trend aggregate is unavailable",
    };
  }

  const dates = getCvTrendDates(trendSnapshots, cvName);
  const metricPointsByKey = Object.fromEntries(
    CV_TREND_METRICS.map((config) => [
      config.key,
      Object.fromEntries(
        dates.map((date) => [
          date,
          getCvMetricPoint({ date, config, trendSnapshots, cvName }),
        ])
      ),
    ])
  );
  const availableDates = dates.filter((date) =>
    CV_TREND_METRICS.some((config) => normalizeFiniteNumber(metricPointsByKey[config.key]?.[date]?.value) != null)
  );
  if (!availableDates.length) {
    return {
      success: false,
      status: 404,
      kind: "cv",
      id: cvName,
      message: "Rank trend drama not found",
    };
  }

  const latestDate = availableDates.at(-1);
  return {
    success: true,
    kind: "cv",
    platform: "cv",
    id: cvName,
    name: cvName,
    latestDate,
    rankHistoryLatestDate: dates.at(-1) || "",
    rankHistory: buildCvRankHistory(dates, metricPointsByKey),
    windows: Object.fromEntries(
      CV_TREND_WINDOWS.map((windowConfig) => [
        windowConfig.key,
        buildCvWindowTrend({
          windowConfig,
          dates,
          latestDate,
          metricPointsByKey,
        }),
      ])
    ),
  };
}

function buildAggregateMetricSnapshotsByDate(aggregateSnapshot, platform, id) {
  const normalizedId = String(id ?? "").trim();
  const dates = normalizeRankTrendDates(aggregateSnapshot);
  const dramaRecord = aggregateSnapshot?.dramas?.[normalizedId];
  const samples = dramaRecord?.samples && typeof dramaRecord.samples === "object"
    ? dramaRecord.samples
    : {};
  const snapshotsByDate = {};

  dates.forEach((date) => {
    const generatedAt = normalizeGeneratedAt(samples[date]) || normalizeGeneratedAt(aggregateSnapshot);
    snapshotsByDate[date] = {
      version: aggregateSnapshot?.version,
      date,
      platform,
      generated_at: generatedAt,
      dramas: {},
    };

    const sample = samples[date];
    const metrics = sample?.metrics && typeof sample.metrics === "object"
      ? sample.metrics
      : null;
    if (!metrics) {
      return;
    }

    snapshotsByDate[date].dramas[normalizedId] = {
      ...metrics,
      name: String(metrics.name ?? dramaRecord?.name ?? "").trim(),
      ...(generatedAt ? { generated_at: generatedAt } : {}),
    };
  });

  return snapshotsByDate;
}

function hasMetricSample(sample) {
  return Boolean(
    sample?.metrics &&
      typeof sample.metrics === "object" &&
      Object.keys(sample.metrics).length > 0
  );
}

export function buildRankTrendAvailabilityResponse({
  platform,
  ids,
  aggregateSnapshot,
} = {}) {
  const normalizedPlatform = String(platform ?? "").trim();
  const idList = normalizeStringIdList(ids);
  if (!getRankTrendMetricConfigs(normalizedPlatform).length || !idList.length) {
    return {
      success: false,
      status: 400,
      message: "Invalid rank trend availability request",
    };
  }

  if (isRankTrendAggregateSnapshot(aggregateSnapshot, normalizedPlatform)) {
    const dates = normalizeRankTrendDates(aggregateSnapshot);
    const dramas = aggregateSnapshot?.dramas && typeof aggregateSnapshot.dramas === "object"
      ? aggregateSnapshot.dramas
      : {};
    return {
      success: true,
      platform: normalizedPlatform,
      ids: idList.filter((id) => {
        const samples = dramas[id]?.samples && typeof dramas[id].samples === "object"
          ? dramas[id].samples
          : {};
        return dates.some((date) => hasMetricSample(samples[date]));
      }),
      latestDate: dates.at(-1) || "",
      updatedAt: normalizeGeneratedAt(aggregateSnapshot),
    };
  }

  return {
    success: false,
    status: 503,
    platform: normalizedPlatform,
    ids: [],
    message: "Rank trend availability is unavailable",
  };
}

export function buildMetricSnapshotsFromRankTrendAggregate(aggregateSnapshot, platform) {
  const normalizedPlatform = String(platform ?? "").trim();
  const dates = normalizeRankTrendDates(aggregateSnapshot);
  const aggregateGeneratedAt = normalizeGeneratedAt(aggregateSnapshot);
  const indexSnapshot = {
    version: aggregateSnapshot?.version,
    platform: normalizedPlatform,
    dates,
    ...(aggregateGeneratedAt ? { updated_at: aggregateGeneratedAt } : {}),
  };
  const metricSnapshotsByDate = Object.fromEntries(
    dates.map((date) => [
      date,
      {
        version: aggregateSnapshot?.version,
        date,
        platform: normalizedPlatform,
        ...(aggregateGeneratedAt ? { generated_at: aggregateGeneratedAt } : {}),
        dramas: {},
      },
    ])
  );
  const dramas = aggregateSnapshot?.dramas && typeof aggregateSnapshot.dramas === "object"
    ? aggregateSnapshot.dramas
    : {};

  Object.entries(dramas).forEach(([id, dramaRecord]) => {
    const normalizedId = String(id ?? "").trim();
    if (!normalizedId) {
      return;
    }
    const { samples: _samples, ...dramaMetadata } = dramaRecord && typeof dramaRecord === "object"
      ? dramaRecord
      : {};
    const samples = dramaRecord?.samples && typeof dramaRecord.samples === "object"
      ? dramaRecord.samples
      : {};

    dates.forEach((date) => {
      const sample = samples[date];
      const metrics = sample?.metrics && typeof sample.metrics === "object"
        ? sample.metrics
        : null;
      if (!metrics) {
        return;
      }

      const generatedAt = normalizeGeneratedAt(sample) || aggregateGeneratedAt;
      metricSnapshotsByDate[date].dramas[normalizedId] = {
        ...dramaMetadata,
        ...metrics,
        name: String(metrics.name ?? dramaRecord?.name ?? "").trim(),
        ...(generatedAt ? { generated_at: generatedAt } : {}),
      };
    });
  });

  return {
    indexSnapshot,
    metricSnapshotsByDate: Object.fromEntries(
      Object.entries(metricSnapshotsByDate).filter(([, snapshot]) =>
        Object.keys(snapshot.dramas).length > 0
      )
    ),
  };
}

function buildAggregateListSnapshotsByDate(aggregateSnapshot, platform, id) {
  const normalizedId = String(id ?? "").trim();
  const dates = normalizeRankTrendDates(aggregateSnapshot);
  const dramaRecord = aggregateSnapshot?.dramas?.[normalizedId];
  const samples = dramaRecord?.samples && typeof dramaRecord.samples === "object"
    ? dramaRecord.samples
    : {};
  const snapshotsByDate = {};

  dates.forEach((date) => {
    const ranks = Array.isArray(samples[date]?.ranks) ? samples[date].ranks : [];
    const rankPayload = {};
    ranks.forEach((rank) => {
      const key = String(rank?.key ?? "").trim();
      if (!key) {
        return;
      }
      rankPayload[key] = {
        name: String(rank?.name ?? key).trim(),
        items: [
          {
            drama_id: normalizedId,
            position: normalizeFiniteNumber(rank?.position),
          },
        ],
      };
    });

    if (Object.keys(rankPayload).length > 0) {
      snapshotsByDate[date] = {
        version: aggregateSnapshot?.version,
        date,
        platform,
        generated_at: normalizeGeneratedAt(samples[date]) || normalizeGeneratedAt(aggregateSnapshot),
        ranks: rankPayload,
      };
    }
  });

  return snapshotsByDate;
}

function buildMetric(config, history, rangeHistory = history) {
  const range = getMetricHistoryRange(rangeHistory, (point) =>
    normalizeFiniteNumber(point.drama?.[config.key])
  );
  const fromValue = range.fromValue;
  const toValue = range.toValue;
  const available = range.hasComparableRange;
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
    history: history.map((point) =>
      withGeneratedAt(
        {
          date: point.date,
          value: normalizeFiniteNumber(point.drama?.[config.key]),
          ...(point?.isPreWindow ? { isPreWindow: true } : {}),
        },
        point.drama
      )
    ),
  };
}

function buildWindowTrend({ windowConfig, dates, latestDate, snapshotsByDate, platform, id, staleDateSet }) {
  const latestTime = parseDateKey(latestDate);
  const earliestAllowedTime = latestTime - windowConfig.days * DAY_MS;
  const preWindowTime = earliestAllowedTime - DAY_MS;
  const preWindowDate = dates.find((date) => parseDateKey(date) === preWindowTime) || "";
  const windowDates = dates.filter((date) => {
    const time = parseDateKey(date);
    return Number.isFinite(time) && time >= earliestAllowedTime && time <= latestTime;
  });
  const historyDates = preWindowDate ? [preWindowDate, ...windowDates] : windowDates;
  const history = historyDates
    .map((date) => ({
      date,
      drama: staleDateSet.has(date) ? null : getDramaMetrics(snapshotsByDate[date], id),
      ...(date === preWindowDate ? { isPreWindow: true } : {}),
    }));
  const windowHistory = history.filter((point) => !point.isPreWindow);
  const availableHistory = windowHistory.filter((point) => point.drama);

  if (availableHistory.length < 2) {
    return withGeneratedAt({
      key: windowConfig.key,
      label: windowConfig.label,
      days: windowConfig.days,
      fromDate: availableHistory[0]?.date || "",
      toDate: availableHistory.at(-1)?.date || "",
      insufficientData: true,
      metrics: getRankTrendMetricConfigs(platform).map((config) =>
        buildMetric(config, history, windowHistory)
      ),
    }, availableHistory.at(-1)?.drama);
  }

  const fromPoint = availableHistory[0];
  const toPoint = availableHistory.at(-1);
  return withGeneratedAt({
    key: windowConfig.key,
    label: windowConfig.label,
    days: windowConfig.days,
    fromDate: fromPoint.date,
    toDate: toPoint.date,
    insufficientData: false,
    metrics: getRankTrendMetricConfigs(platform).map((config) =>
      buildMetric(config, history, windowHistory)
    ),
  }, toPoint.drama);
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
  const metricDates = dates.filter((date) =>
    getDramaMetrics(metricSnapshotsByDate[date], normalizedId)
  );

  if (!metricDates.length) {
    return {
      success: false,
      status: 404,
      platform: normalizedPlatform,
      id: normalizedId,
      message: "Rank trend drama not found",
    };
  }

  const staleDateSet = getRepeatedTrendSampleDateSet({
    dates,
    snapshotsByDate: metricSnapshotsByDate,
    platform: normalizedPlatform,
    id: normalizedId,
  });
  const latestDate =
    [...metricDates].reverse().find((date) => !staleDateSet.has(date)) ||
    metricDates.at(-1);
  const latestDrama = getDramaMetrics(metricSnapshotsByDate[latestDate], normalizedId);
  return {
    success: true,
    platform: normalizedPlatform,
    id: normalizedId,
    name: String(latestDrama?.name ?? "").trim(),
    latestDate,
    rankHistoryLatestDate: dates.at(-1) || "",
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
          staleDateSet,
        }),
      ])
    ),
  };
}

export function buildAggregatedRankTrendResponse({
  platform,
  id,
  aggregateSnapshot,
} = {}) {
  const normalizedPlatform = String(platform ?? "").trim();
  const normalizedId = String(id ?? "").trim();
  if (!isRankTrendAggregateSnapshot(aggregateSnapshot, normalizedPlatform)) {
    return {
      success: false,
      status: 503,
      platform: normalizedPlatform,
      id: normalizedId,
      message: "Rank trend aggregate is unavailable",
    };
  }

  return buildRankTrendResponse({
    platform: normalizedPlatform,
    id: normalizedId,
    indexSnapshot: aggregateSnapshot,
    metricSnapshotsByDate: buildAggregateMetricSnapshotsByDate(
      aggregateSnapshot,
      normalizedPlatform,
      normalizedId
    ),
    listSnapshotsByDate: buildAggregateListSnapshotsByDate(
      aggregateSnapshot,
      normalizedPlatform,
      normalizedId
    ),
  });
}

export function buildPeakSeriesTrendResponse({
  id,
  peakSnapshot,
} = {}) {
  const normalizedId = String(id ?? "").trim();
  if (!normalizedId) {
    return {
      success: false,
      status: 400,
      message: "Invalid rank trend request",
    };
  }

  const matchedSeries = findPeakSeriesRecord(peakSnapshot, normalizedId);
  if (!matchedSeries) {
    return {
      success: false,
      status: 404,
      platform: "missevan",
      id: normalizedId,
      message: "Rank trend drama not found",
    };
  }

  const seriesName = String(matchedSeries.record?.name ?? matchedSeries.key).trim() || normalizedId;
  const samples = normalizePeakSeriesSamples(matchedSeries.record);
  if (!samples.length) {
    return {
      success: false,
      status: 404,
      platform: "missevan",
      id: seriesName,
      message: "Rank trend drama not found",
    };
  }

  const dates = getPeakSeriesDates(peakSnapshot, matchedSeries.record);
  const samplesByDate = Object.fromEntries(samples.map((sample) => [sample.date, sample]));
  const staleDateSet = getRepeatedPeakSeriesSampleDateSet({ dates, samplesByDate });
  const latestSample =
    [...samples].reverse().find((sample) => !staleDateSet.has(sample.date)) ||
    samples.at(-1);

  return {
    success: true,
    platform: "missevan",
    id: seriesName,
    name: `系列：${seriesName}`,
    dramaIds: normalizeStringIdList(matchedSeries.record?.dramaIds),
    latestDate: latestSample.date,
    rankHistoryLatestDate: dates.at(-1) || "",
    dailyViewDelta: getPeakSeriesDailyViewDelta(matchedSeries.record),
    rankHistory: buildPeakSeriesRankHistory(samples),
    windows: Object.fromEntries(
      TREND_WINDOWS.map((windowConfig) => [
        windowConfig.key,
        buildPeakSeriesWindowTrend({
          windowConfig,
          dates,
          latestDate: latestSample.date,
          samplesByDate,
          staleDateSet,
        }),
      ])
    ),
  };
}
