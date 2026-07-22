import { getRankTrendMetricConfigs, normalizeRankTrendDates } from "./ranksTrendUtils.js";
import { isSkippedDanmakuMetricValue } from "./rankMetricUtils.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const ONGOING_WINDOWS = Object.freeze([
  { key: "3d", label: "3天", days: 3 },
  { key: "7d", label: "7天", days: 7 },
  { key: "30d", label: "30天", days: 30 },
]);

function normalizeDateKey(value) {
  const normalized = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function parseDateKey(value) {
  const normalized = normalizeDateKey(value);
  return normalized ? Date.parse(`${normalized}T00:00:00.000Z`) : NaN;
}

function normalizeFiniteNumber(value) {
  if (value == null || String(value).trim() === "") {
    return null;
  }
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeStringArray(value, maxItems = 20) {
  const items = Array.isArray(value) ? value : value == null ? [] : [value];
  return items.map((item) => normalizeText(item)).filter(Boolean).slice(0, maxItems);
}

function normalizeNumericId(value) {
  const normalized = String(value ?? "").trim();
  return /^\d+$/.test(normalized) ? normalized : "";
}

function getSnapshotDramas(snapshot) {
  return snapshot?.dramas && typeof snapshot.dramas === "object" ? snapshot.dramas : {};
}

function getDramaMetrics(snapshot, id) {
  return getSnapshotDramas(snapshot)[String(id)] || null;
}

export function normalizeOngoingIdList(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map(normalizeNumericId).filter(Boolean)));
  }

  if (value && typeof value === "object") {
    if (
      value.records &&
      typeof value.records === "object" &&
      !Array.isArray(value.records)
    ) {
      return normalizeOngoingIdList(value.records);
    }

    return Array.from(
      new Set(
        Object.entries(value)
          .filter(([, enabled]) => enabled !== false && enabled != null)
          .map(([id]) => normalizeNumericId(id))
          .filter(Boolean)
      )
    );
  }

  return Array.from(
    new Set(
      String(value ?? "")
        .split(/[,\s，、;；]+/)
        .map(normalizeNumericId)
        .filter(Boolean)
    )
  );
}

function getLatestMetricDate(dates, metricSnapshotsByDate) {
  return [...dates].reverse().find((date) => Object.keys(getSnapshotDramas(metricSnapshotsByDate?.[date])).length) || "";
}

function getWindowTargetDate(windowConfig, latestDate) {
  const latestTime = parseDateKey(latestDate);
  if (!Number.isFinite(latestTime)) {
    return "";
  }
  return new Date(latestTime - windowConfig.days * DAY_MS).toISOString().slice(0, 10);
}

function parseYearMonth(value) {
  const match = /^(\d{4})\.(\d{2})$/.exec(normalizeText(value));
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  return { year, month, ordinal: year * 12 + month - 1 };
}

export function getBeijingYearMonth(now = Date.now()) {
  const date = now instanceof Date ? now : new Date(now);
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
    }).formatToParts(date);
    const year = Number(parts.find((part) => part.type === "year")?.value);
    const month = Number(parts.find((part) => part.type === "month")?.value);
    if (Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12) {
      return `${String(year).padStart(4, "0")}.${String(month).padStart(2, "0")}`;
    }
  } catch (_) {
    // Asia/Shanghai is fixed at UTC+8 for the contemporary dates used here.
  }
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return `${String(shifted.getUTCFullYear()).padStart(4, "0")}.${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function isOngoingNewDrama(createTime, currentMonth) {
  const normalizedCreateTime = normalizeText(createTime);
  if (!normalizedCreateTime) {
    return true;
  }
  const created = parseYearMonth(normalizedCreateTime);
  const current = parseYearMonth(currentMonth);
  if (!created || !current) {
    return false;
  }
  const monthDifference = current.ordinal - created.ordinal;
  return monthDifference >= 0 && monthDifference <= 1;
}

function getWeeklyPlaybackDates(weeklyPlaybackSnapshot) {
  const explicitDates = Array.isArray(weeklyPlaybackSnapshot?.dates)
    ? weeklyPlaybackSnapshot.dates
    : Object.keys(weeklyPlaybackSnapshot?.snapshotsByDate || {});
  return Array.from(new Set(explicitDates.map(normalizeDateKey).filter(Boolean))).sort();
}

function findNearestWeeklyPlaybackBaseline({
  weeklyPlaybackSnapshot,
  id,
  targetDate,
  latestDate,
}) {
  const targetTime = parseDateKey(targetDate);
  const latestTime = parseDateKey(latestDate);
  if (!Number.isFinite(targetTime) || !Number.isFinite(latestTime)) {
    return null;
  }
  return getWeeklyPlaybackDates(weeklyPlaybackSnapshot)
    .map((date) => {
      const time = parseDateKey(date);
      const drama = getDramaMetrics(weeklyPlaybackSnapshot?.snapshotsByDate?.[date], id);
      const value = normalizeFiniteNumber(drama?.view_count);
      return Number.isFinite(time) && time <= latestTime && value != null
        ? { date, time, value }
        : null;
    })
    .filter(Boolean)
    .sort((left, right) => {
      const distanceDifference = Math.abs(left.time - targetTime) - Math.abs(right.time - targetTime);
      return distanceDifference || left.time - right.time;
    })[0] || null;
}

function resolveMetricBaseline({
  config,
  exactDrama,
  isNewDrama,
  targetDate,
  weeklyPlaybackBaseline,
}) {
  const exactValue = normalizeFiniteNumber(exactDrama?.[config.key]);
  if (exactValue != null) {
    return { value: exactValue, date: targetDate };
  }
  if (isNewDrama) {
    return { value: 0, date: targetDate };
  }
  if (config.key === "view_count" && weeklyPlaybackBaseline) {
    return {
      value: weeklyPlaybackBaseline.value,
      date: weeklyPlaybackBaseline.date,
    };
  }
  return { value: null, date: "" };
}

function buildWindowMetric(config, baseline, currentDrama) {
  const fromValue = normalizeFiniteNumber(baseline?.value);
  const toValue = normalizeFiniteNumber(currentDrama?.[config.key]);
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
  };
}

function buildItemWindows({
  platform,
  id,
  currentDrama,
  latestDate,
  metricSnapshotsByDate,
  isNewDrama,
  weeklyPlaybackSnapshot,
}) {
  const metricConfigs = getRankTrendMetricConfigs(platform);
  return Object.fromEntries(
    ONGOING_WINDOWS.map((windowConfig) => {
      const targetDate = getWindowTargetDate(windowConfig, latestDate);
      const exactDrama = targetDate
        ? getDramaMetrics(metricSnapshotsByDate?.[targetDate], id)
        : null;
      const weeklyPlaybackBaseline = findNearestWeeklyPlaybackBaseline({
        weeklyPlaybackSnapshot,
        id,
        targetDate,
        latestDate,
      });
      const baselines = Object.fromEntries(metricConfigs.map((config) => [
        config.key,
        resolveMetricBaseline({
          config,
          exactDrama,
          isNewDrama,
          targetDate,
          weeklyPlaybackBaseline,
        }),
      ]));
      const metrics = Object.fromEntries(metricConfigs.map((config) => [
        config.key,
        buildWindowMetric(config, baselines[config.key], currentDrama),
      ]));
      const playbackBaseline = baselines.view_count || { value: null, date: "" };
      return [
        windowConfig.key,
        {
          key: windowConfig.key,
          label: windowConfig.label,
          days: windowConfig.days,
          fromDate: playbackBaseline.date,
          toDate: latestDate,
          insufficientData: metrics.view_count?.available !== true,
          metrics,
        },
      ];
    })
  );
}

function buildCurrentMetrics(platform, currentDrama) {
  return Object.fromEntries(
    getRankTrendMetricConfigs(platform).map((config) => {
      const rawValue = currentDrama?.[config.key];
      const captureSkipped =
        config.key === "danmaku_uid_count" && isSkippedDanmakuMetricValue(rawValue);
      return [
        config.key,
        {
          key: config.key,
          label: config.label,
          value: normalizeFiniteNumber(rawValue),
          ...(captureSkipped ? { visible: false } : {}),
        },
      ];
    })
  );
}

function hasAnyNonZeroWindowMetric(item, metricKey) {
  return Object.values(item?.windows || {})
    .flatMap((windowData) => {
      const metric = windowData?.metrics?.[metricKey];
      return [metric?.fromValue, metric?.toValue, metric?.delta];
    })
    .map((value) => normalizeFiniteNumber(value))
    .some((value) => value != null && value !== 0);
}

function applyMetricVisibility(item) {
  if (item?.platform !== "manbo" || !item?.metrics?.pay_count) {
    return item;
  }

  return {
    ...item,
    metrics: {
      ...item.metrics,
      pay_count: {
        ...item.metrics.pay_count,
        visible:
          item.metrics.pay_count.value != null &&
          hasAnyNonZeroWindowMetric(item, "pay_count"),
      },
    },
  };
}

function normalizeMainCvText(drama) {
  const explicit = normalizeText(drama?.main_cv_text).replace(/^主要CV：/, "");
  if (explicit) {
    return explicit;
  }
  return normalizeStringArray(drama?.main_cvs ?? drama?.maincvs ?? drama?.cvs).join("，");
}

function getContentTypeLabel(drama) {
  const label = normalizeText(drama?.content_type_label ?? drama?.catalogName ?? drama?.catalog_name);
  return label === "有声书" ? "有声剧" : label;
}

function getPaymentLabel(drama) {
  const paystatus = normalizeText(drama?.payStatus ?? drama?.paystatus ?? drama?.pay_status);
  if (["付费", "会员", "免费"].includes(paystatus)) {
    return paystatus;
  }

  const paymentLabel = normalizeText(drama?.payment_label);
  return ["付费", "会员", "免费"].includes(paymentLabel) ? paymentLabel : "";
}

function buildOngoingItem({
  platform,
  id,
  currentDrama,
  latestDate,
  metricSnapshotsByDate,
  createTime,
  currentMonth,
  weeklyPlaybackSnapshot,
}) {
  const isNewDrama = isOngoingNewDrama(createTime, currentMonth);
  return applyMetricVisibility({
    id,
    platform,
    name: normalizeText(currentDrama?.name ?? currentDrama?.title),
    cover: normalizeText(currentDrama?.cover),
    updated_at: normalizeText(currentDrama?.updated_at),
    payment_label: getPaymentLabel(currentDrama),
    content_type_label: getContentTypeLabel(currentDrama),
    main_cvs: normalizeStringArray(currentDrama?.main_cvs ?? currentDrama?.maincvs ?? currentDrama?.cvs),
    main_cv_text: normalizeMainCvText(currentDrama),
    metrics: buildCurrentMetrics(platform, currentDrama),
    windows: buildItemWindows({
      platform,
      id,
      currentDrama,
      latestDate,
      metricSnapshotsByDate,
      isNewDrama,
      weeklyPlaybackSnapshot,
    }),
  });
}

export function sortOngoingItemsByWindowDelta(items, windowKey = "7d") {
  return [...(Array.isArray(items) ? items : [])].sort((left, right) => {
    const leftMetric = left?.windows?.[windowKey]?.metrics?.view_count;
    const rightMetric = right?.windows?.[windowKey]?.metrics?.view_count;
    const leftDelta = leftMetric?.available === false ? null : normalizeFiniteNumber(leftMetric?.delta);
    const rightDelta = rightMetric?.available === false ? null : normalizeFiniteNumber(rightMetric?.delta);
    const normalizedLeft = leftDelta == null ? Number.NEGATIVE_INFINITY : leftDelta;
    const normalizedRight = rightDelta == null ? Number.NEGATIVE_INFINITY : rightDelta;
    if (normalizedRight !== normalizedLeft) {
      return normalizedRight - normalizedLeft;
    }
    return normalizeText(left?.name).localeCompare(normalizeText(right?.name), "zh-CN");
  });
}

export function isOngoingEmptyPaidDanmakuMetric(metric) {
  if (metric?.key !== "danmaku_uid_count") {
    return false;
  }

  const fromValue = normalizeFiniteNumber(metric?.fromValue);
  const toValue = normalizeFiniteNumber(metric?.toValue);
  return fromValue === 0 && toValue === 0;
}

export function buildOngoingResponse({
  platform,
  ongoingIds,
  indexSnapshot,
  metricSnapshotsByDate,
  createTimesById,
  currentMonth,
  weeklyPlaybackSnapshot,
} = {}) {
  const normalizedPlatform = normalizeText(platform);
  const metricConfigs = getRankTrendMetricConfigs(normalizedPlatform);
  if (!metricConfigs.length) {
    return {
      success: false,
      status: 400,
      message: "Invalid ongoing platform",
    };
  }

  const ids = normalizeOngoingIdList(ongoingIds);
  const dates = normalizeRankTrendDates(indexSnapshot).filter((date) =>
    metricSnapshotsByDate?.[date]
  );
  const latestDate = getLatestMetricDate(dates, metricSnapshotsByDate);
  const currentSnapshot = latestDate ? metricSnapshotsByDate[latestDate] : null;
  const items = ids
    .map((id) => {
      const currentDrama = getDramaMetrics(currentSnapshot, id);
      if (!currentDrama) {
        return null;
      }
      return buildOngoingItem({
        platform: normalizedPlatform,
        id,
        currentDrama,
        latestDate,
        metricSnapshotsByDate,
        createTime: createTimesById?.[id],
        currentMonth,
        weeklyPlaybackSnapshot,
      });
    })
    .filter(Boolean);

  return {
    success: true,
    platform: normalizedPlatform,
    updatedAt: normalizeText(indexSnapshot?.updated_at ?? currentSnapshot?.updated_at ?? ""),
    latestDate,
    windows: Object.fromEntries(ONGOING_WINDOWS.map((windowConfig) => [windowConfig.key, windowConfig])),
    items,
  };
}
