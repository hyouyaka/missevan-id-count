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
  return Boolean(metric && metric.available !== false && hasCompareMetricValues(metric));
}

export function getMetricLatestValue(trendData, windowKey, metricKey) {
  const metric = getMetricFromTrend(trendData, windowKey, metricKey);
  const history = Array.isArray(metric?.history) ? metric.history : [];
  const latest = [...history].reverse().find((point) => point?.value != null && String(point.value).trim() !== "");
  return latest?.value ?? null;
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
