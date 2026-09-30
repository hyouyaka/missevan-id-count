import { formatPlainNumber } from "@/app/app-utils";

export const MAX_COMPARE_ITEMS = 6;

export const comparePalette = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--accent-rose)",
  "var(--accent-neutral)",
];

export function buildProxyImageUrl(url) {
  return url ? `/image-proxy?url=${encodeURIComponent(url)}` : "";
}

export function formatTrendDate(value) {
  const normalized = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? `${normalized.slice(5, 7)}/${normalized.slice(8, 10)}`
    : normalized || "未知";
}

export function formatCompareWindowLabel(windowKey) {
  const normalized = String(windowKey ?? "").trim();
  const unit = normalized.endsWith("w") ? "周" : "日";
  return `${normalized.slice(0, -1)}${unit}`;
}

export function formatSignedPlainNumber(value) {
  if (value == null || String(value).trim() === "") {
    return "暂无";
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "暂无";
  }
  return `${number > 0 ? "+" : ""}${formatPlainNumber(number)}`;
}

export function formatOptionalPlainNumber(value) {
  if (value == null || String(value).trim() === "") {
    return "暂无";
  }
  return formatPlainNumber(value);
}

export function formatComparePercent(value) {
  if (value == null || String(value).trim() === "") {
    return "暂无";
  }
  const percent = Number(value);
  if (!Number.isFinite(percent)) {
    return "暂无";
  }
  const rounded = Math.round(percent * 1000) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(Math.abs(rounded) >= 100 ? 0 : 1)}%`;
}

export function getCompareItemKey(item) {
  return `${String(item?.compareKind ?? "drama").trim()}:${String(item?.platform ?? "").trim()}:${String(item?.id ?? "").trim()}`;
}

export function getMetricFromTrend(trendData, windowKey, metricKey) {
  const metrics = Array.isArray(trendData?.windows?.[windowKey]?.metrics)
    ? trendData.windows[windowKey].metrics
    : [];
  return metrics.find((metric) => metric.key === metricKey) || null;
}

export function hasCompareMetricValues(metric) {
  const history = Array.isArray(metric?.history) ? metric.history : [];
  return history.some((point) => point?.value != null && String(point.value).trim() !== "");
}

export function isCompareMetricAvailableForItem(item, windowKey, metricKey) {
  const metric = getMetricFromTrend(item?.trendData, windowKey, metricKey);
  return Boolean(metric);
}

export function getMetricLatestValue(trendData, windowKey, metricKey) {
  const metric = getMetricFromTrend(trendData, windowKey, metricKey);
  const history = Array.isArray(metric?.history) ? metric.history : [];
  if (String(windowKey ?? "").endsWith("d")) {
    return history.at(-1)?.value ?? null;
  }
  const latest = [...history].reverse().find((point) => point?.value != null && String(point.value).trim() !== "");
  return latest?.value ?? null;
}

function normalizeDateKey(value) {
  const normalized = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function parseDateKey(value) {
  const normalized = normalizeDateKey(value);
  return normalized ? Date.parse(`${normalized}T00:00:00.000Z`) : NaN;
}

function formatDateKey(timestamp) {
  const date = new Date(timestamp);
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function buildCalendarDateKeys(fromDate, toDate) {
  const fromTime = parseDateKey(fromDate);
  const toTime = parseDateKey(toDate);
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime) || fromTime > toTime) {
    return [];
  }
  const dates = [];
  for (let timestamp = fromTime; timestamp <= toTime; timestamp += 24 * 60 * 60 * 1000) {
    dates.push(formatDateKey(timestamp));
  }
  return dates;
}

function getTrendNumber(value) {
  if (value == null || String(value).trim() === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getTrendWindowEndDate(trendData, window) {
  return normalizeDateKey(trendData?.windowEndDate) || normalizeDateKey(window?.toDate);
}

function alignMetricToWindow(metric, windowStartDate, windowEndDate) {
  const originalHistory = Array.isArray(metric?.history) ? metric.history : [];
  const pointByDate = new Map(
    originalHistory
      .map((point) => [normalizeDateKey(point?.date), point])
      .filter(([date]) => date)
  );
  const historyDates = [
    formatDateKey(parseDateKey(windowStartDate) - 24 * 60 * 60 * 1000),
    ...buildCalendarDateKeys(windowStartDate, windowEndDate),
  ];
  const history = historyDates.map((date, index) => ({
    ...(pointByDate.get(date) || { date, value: null }),
    date,
    ...(index === 0 ? { isPreWindow: true } : { isPreWindow: false }),
  }));
  const windowHistory = history.slice(1);
  const firstPoint = windowHistory.find((point) => getTrendNumber(point.value) != null);
  const latestPoint = windowHistory.at(-1);
  const fromValue = getTrendNumber(firstPoint?.value);
  const toValue = getTrendNumber(latestPoint?.value);
  const available = Boolean(
    firstPoint &&
      latestPoint &&
      firstPoint !== latestPoint &&
      fromValue != null &&
      toValue != null
  );
  return {
    ...metric,
    fromValue,
    toValue,
    delta: available ? toValue - fromValue : null,
    deltaPercent: available && fromValue !== 0 ? (toValue - fromValue) / fromValue : null,
    available,
    history,
  };
}

function alignTrendDataToWindowEnd(trendData, targetEndDate) {
  if (!trendData || !normalizeDateKey(targetEndDate)) {
    return trendData;
  }
  const windows = Object.fromEntries(
    Object.entries(trendData.windows || {}).map(([windowKey, window]) => {
      if (!windowKey.endsWith("d") || !window || !Array.isArray(window.metrics)) {
        return [windowKey, window];
      }
      const days = Number(window.days) || Number(windowKey.match(/\d+/)?.[0]) || 0;
      if (!days) {
        return [windowKey, window];
      }
      const endTime = parseDateKey(targetEndDate);
      const windowStartDate = formatDateKey(endTime - days * 24 * 60 * 60 * 1000);
      const metrics = window.metrics.map((metric) =>
        alignMetricToWindow(metric, windowStartDate, targetEndDate)
      );
      return [windowKey, {
        ...window,
        fromDate: windowStartDate,
        toDate: targetEndDate,
        insufficientData: metrics.every((metric) => !metric.available),
        metrics,
      }];
    })
  );
  return {
    ...trendData,
    windowEndDate: targetEndDate,
    windows,
  };
}

export function alignCompareTrendItems(items) {
  const normalizedItems = Array.isArray(items) ? items : [];
  const dailyEnds = normalizedItems
    .filter((item) => item?.trendData?.kind !== "weekly_playback")
    .map((item) => getTrendWindowEndDate(item.trendData, item.trendData?.windows?.["7d"]))
    .filter(Boolean)
    .sort();
  const targetEndDate = dailyEnds.at(-1) || "";
  if (!targetEndDate) {
    return normalizedItems;
  }
  return normalizedItems.map((item) => ({
    ...item,
    trendData: item?.trendData?.kind === "weekly_playback"
      ? item.trendData
      : alignTrendDataToWindowEnd(item.trendData, targetEndDate),
  }));
}

export function getCompareAxisTick(value, metricKey) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "";
  }
  if (metricKey === "view_count" || Math.abs(number) >= 10000) {
    const wan = number / 10000;
    return `${wan.toLocaleString("zh-CN", { maximumFractionDigits: Math.abs(wan) >= 100 ? 0 : 1 })}万`;
  }
  return formatPlainNumber(Math.round(number));
}

export function clampCompareTooltipPercent(value) {
  return Math.min(92, Math.max(8, value));
}

export function buildCompareChartMetrics(items, windowKey, metricOption) {
  if (!metricOption?.key) {
    return [];
  }
  return items
    .map((item, index) => {
      const metric = getMetricFromTrend(item.trendData, windowKey, metricOption.key);
      if (!metric) {
        return null;
      }
      return {
        ...metric,
        key: `${item.key}:${metricOption.key}`,
        label: item.title,
        item,
        color: item.compareColor || comparePalette[index % comparePalette.length],
      };
    })
    .filter(Boolean);
}
