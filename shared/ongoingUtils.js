import { getRankTrendMetricConfigs, normalizeRankTrendDates } from "./ranksTrendUtils.js";

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

function getWindowFromDate({ windowConfig, dates, latestDate, metricSnapshotsByDate, id }) {
  const latestTime = parseDateKey(latestDate);
  const earliestAllowedTime = latestTime - windowConfig.days * DAY_MS;
  return dates.find((date) => {
    const time = parseDateKey(date);
    return (
      Number.isFinite(time) &&
      time >= earliestAllowedTime &&
      time <= latestTime &&
      getDramaMetrics(metricSnapshotsByDate?.[date], id)
    );
  }) || "";
}

function buildWindowMetric(config, fromDrama, currentDrama) {
  const fromValue = normalizeFiniteNumber(fromDrama?.[config.key]);
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

function buildItemWindows({ platform, id, currentDrama, dates, latestDate, metricSnapshotsByDate }) {
  const metricConfigs = getRankTrendMetricConfigs(platform);
  return Object.fromEntries(
    ONGOING_WINDOWS.map((windowConfig) => {
      const fromDate = getWindowFromDate({
        windowConfig,
        dates,
        latestDate,
        metricSnapshotsByDate,
        id,
      });
      const fromDrama =
        fromDate && fromDate !== latestDate ? getDramaMetrics(metricSnapshotsByDate[fromDate], id) : null;
      const metrics = Object.fromEntries(
        metricConfigs.map((config) => [
          config.key,
          buildWindowMetric(config, fromDrama, currentDrama),
        ])
      );
      return [
        windowConfig.key,
        {
          key: windowConfig.key,
          label: windowConfig.label,
          days: windowConfig.days,
          fromDate,
          toDate: latestDate,
          insufficientData: !fromDate || fromDate === latestDate,
          metrics,
        },
      ];
    })
  );
}

function buildCurrentMetrics(platform, currentDrama) {
  return Object.fromEntries(
    getRankTrendMetricConfigs(platform).map((config) => [
      config.key,
      {
        key: config.key,
        label: config.label,
        value: normalizeFiniteNumber(currentDrama?.[config.key]),
      },
    ])
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

function buildOngoingItem({ platform, id, currentDrama, dates, latestDate, metricSnapshotsByDate }) {
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
      dates,
      latestDate,
      metricSnapshotsByDate,
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
        dates,
        latestDate,
        metricSnapshotsByDate,
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
