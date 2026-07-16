import { useEffect, useState } from "react";
import {
  BeanIcon,
  CheckIcon,
  ChevronDownIcon,
  CoinsIcon,
  GemIcon,
  ArrowLeftRightIcon,
  HeartIcon,
  PlayCircleIcon,
  RefreshCwIcon,
  ShoppingCartIcon,
  StarIcon,
  TrendingUpIcon,
  TrophyIcon,
  UsersRoundIcon,
  XIcon,
} from "lucide-react";

import { formatDeviceDateTime, formatPlainNumber, formatRankCompactCount } from "@/app/app-utils";
import {
  buildTrendChartLines as buildSingleAxisTrendChartLines,
  getTrendAxisLabelMarkers,
  getTrendAxisY as getSingleAxisTrendAxisY,
} from "@/app/rankTrendChartUtils";
import { PlatformIdIcon } from "@/app/platformTabLabel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
export {
  fetchRankTrendAvailabilityData,
  fetchRankTrendData,
  logRankTrendOpen,
  RANK_TREND_CLIENT_SCHEMA_VERSION,
} from "@/app/rankTrendData";

export const trendActionButtonClassName =
  "h-[22px] w-[50px] min-w-[50px] border-[color-mix(in_oklch,var(--accent-success)_32%,transparent)] bg-[var(--accent-success)] px-1 text-xs! text-[var(--accent-success-foreground)] shadow-[0_12px_24px_-16px_var(--accent-success)] hover:bg-[color-mix(in_oklch,var(--accent-success)_88%,var(--foreground))] hover:text-[var(--accent-success-foreground)]";
export const compareActionButtonClassName =
  "h-[22px] w-[50px] min-w-[50px] border-[color-mix(in_oklch,var(--accent-compare)_34%,transparent)] bg-[var(--accent-compare)] px-1 text-xs! text-[var(--accent-compare-foreground)] shadow-[0_12px_24px_-16px_var(--accent-compare)] hover:bg-[var(--accent-compare-hover)] hover:text-[var(--accent-compare-foreground)]";
const trendActionHitAreaClassName =
  "h-11 min-h-11 w-[58px] min-w-[58px] border-transparent! bg-transparent! p-0 text-inherit shadow-none! hover:bg-transparent! hover:text-inherit active:translate-y-0";
const trendActionInlineClassName =
  "relative h-[22px] min-h-[22px] w-[50px] min-w-[50px] overflow-visible border-transparent! bg-transparent! p-0 text-inherit shadow-none! hover:bg-transparent! hover:text-inherit active:translate-y-0 after:absolute after:inset-x-0 after:-inset-y-[11px] after:rounded-md after:content-['']";
const trendActionVisualClassName =
  "pointer-events-none inline-flex items-center justify-center gap-1 rounded-[calc(var(--radius)-0.18rem)] border";

const cvTrendWindowFallbackLabels = {
  "3w": "3周",
  "7w": "7周",
  "30w": "30周",
};

export const rankTrendTagVariants = {
  猫耳: "missevanPlatform",
  漫播: "manboPlatform",
  免费: "free",
  会员: "member",
  付费: "paid",
  广播剧: "radioDrama",
  有声剧: "audioDrama",
  有声漫: "audioComic",
};

const metricIconMap = {
  总播放量: PlayCircleIcon,
  播放量: PlayCircleIcon,
  追剧数: HeartIcon,
  追剧人数: HeartIcon,
  收藏数: StarIcon,
  打赏人数: GemIcon,
  打赏榜总和: CoinsIcon,
  付费集弹幕ID数: UsersRoundIcon,
  付费ID数: UsersRoundIcon,
  弹幕ID数: UsersRoundIcon,
  投喂总数: BeanIcon,
  "购买人数/收听人数": ShoppingCartIcon,
  "付费/收听人数": ShoppingCartIcon,
  收听人数: ShoppingCartIcon,
  排行值: TrophyIcon,
};

const metaBadgeClassName = "h-[1.05rem] px-1.5 text-[0.6rem] leading-none";

function MetricIcon({ label, className = "size-3.5" }) {
  const Icon = metricIconMap[label] || PlayCircleIcon;
  return <Icon aria-hidden="true" className={className} />;
}

function formatTrendDate(value) {
  const normalized = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized || "未知";
  }
  return `${normalized.slice(5, 7)}/${normalized.slice(8, 10)}`;
}

function getTrendWindowGeneratedAt(activeWindow, activeMetrics) {
  const directValue = String(activeWindow?.generatedAt ?? "").trim();
  if (directValue) {
    return directValue;
  }

  const targetDate = String(activeWindow?.toDate ?? "").trim();
  for (const metric of activeMetrics || []) {
    const history = Array.isArray(metric?.history) ? metric.history : [];
    const matchedPoint = targetDate
      ? history.find((point) => point?.date === targetDate && point?.generatedAt)
      : null;
    const fallbackPoint = [...history].reverse().find((point) => point?.generatedAt);
    const generatedAt = String((matchedPoint || fallbackPoint)?.generatedAt ?? "").trim();
    if (generatedAt) {
      return generatedAt;
    }
  }

  return "";
}

function formatTrendValue(value) {
  return value == null ? "暂无数据" : formatPlainNumber(value);
}

function formatSignedTrendValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "暂无数据";
  }
  const prefix = number > 0 ? "+" : "";
  return `${prefix}${formatPlainNumber(number)}`;
}

function formatTrendSnapshotValue(value) {
  return value == null ? "无数据" : formatTrendValue(value);
}

function formatTrendSnapshotDeltaValue(value) {
  return value == null ? "无数据" : formatSignedTrendValue(value);
}

function parseTrendDate(value) {
  const normalized = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return NaN;
  }
  return Date.parse(`${normalized}T00:00:00.000Z`);
}

function areAdjacentTrendDates(left, right) {
  const leftTime = parseTrendDate(left);
  const rightTime = parseTrendDate(right);
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && rightTime - leftTime === 24 * 60 * 60 * 1000;
}

function formatTrendDelta(metric) {
  if (metric?.emptyPaidEpisodes) {
    return "暂无付费集";
  }
  if (!metric?.available || metric.delta == null) {
    return "暂无数据";
  }
  const delta = Number(metric.delta);
  if (!Number.isFinite(delta)) {
    return "暂无数据";
  }
  const prefix = delta > 0 ? "+" : "";
  return `${prefix}${formatPlainNumber(delta)}`;
}

export function formatRankTrendCompactDelta(metric) {
  if (metric?.emptyPaidEpisodes) {
    return "暂无付费集";
  }
  if (!metric?.available || metric.delta == null) {
    return "暂无数据";
  }
  const delta = Number(metric.delta);
  if (!Number.isFinite(delta)) {
    return "暂无数据";
  }
  const prefix = delta > 0 ? "+" : delta < 0 ? "-" : "";
  return `${prefix}${formatRankCompactCount(Math.abs(delta))}`;
}

function formatTrendPercent(value) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) {
    return "";
  }
  const normalized = percent * 100;
  const rounded = Math.round(normalized * 10) / 10;
  const prefix = rounded > 0 ? "+" : "";
  return `${prefix}${rounded.toFixed(Math.abs(rounded) >= 100 ? 0 : 1)}%`;
}

function formatTrendDeltaWithPercent(metric) {
  const delta = formatTrendDelta(metric);
  if (delta === "暂无数据" || delta === "暂无付费集") {
    return delta;
  }
  const percent = formatTrendPercent(metric?.deltaPercent);
  return percent ? `${delta} / ${percent}` : delta;
}

export function canShowRankTrend({ platform, rankKey, item, isMissevanPeak, detailIdText }) {
  if (!detailIdText) {
    return false;
  }
  if (platform === "missevan") {
    if (isMissevanPeak) {
      return true;
    }
    if (rankKey === "peak" || item?.type === "peak") {
      return false;
    }
    return true;
  }
  return platform === "manbo" && rankKey !== "peak" && item?.type !== "peak";
}

function getGenericPaymentTag(item, platform) {
  const explicitLabel = String(item?.payment_label ?? "").trim();
  if (["付费", "会员", "免费"].includes(explicitLabel)) {
    return explicitLabel;
  }
  const payStatus = String(item?.payStatus ?? item?.paystatus ?? item?.pay_status ?? "").trim();
  if (["付费", "会员", "免费"].includes(payStatus)) {
    return payStatus;
  }
  if (item?.is_member) {
    return "会员";
  }
  return "";
}

function getGenericTitleTags(item) {
  return [item?.content_type_label || item?.catalogName || item?.catalog_name || item?.catalog_name_label]
    .map((label) => String(label ?? "").trim())
    .map((label) => (label === "有声书" ? "有声剧" : label))
    .filter(Boolean);
}

function getTrendMetaTags(item, platform) {
  if (platform === "cv") {
    return [];
  }
  const platformLabel = platform === "missevan" ? "猫耳" : "漫播";
  return [...new Set([platformLabel, getGenericPaymentTag(item, platform), ...getGenericTitleTags(item)]
    .map((label) => String(label ?? "").trim())
    .filter(Boolean))];
}

const trendMetricStyles = {
  view_count: {
    color: "var(--chart-1)",
    background: "color-mix(in oklch, var(--chart-1) 10%, transparent)",
  },
  danmaku_uid_count: {
    color: "var(--chart-3)",
    background: "color-mix(in oklch, var(--chart-3) 10%, transparent)",
  },
  subscription_num: {
    color: "var(--chart-2)",
    background: "color-mix(in oklch, var(--chart-2) 11%, transparent)",
  },
  pay_count: {
    color: "var(--chart-2)",
    background: "color-mix(in oklch, var(--chart-2) 11%, transparent)",
  },
  missevan_total_view_count: {
    color: "var(--chart-1)",
    background: "color-mix(in oklch, var(--chart-1) 10%, transparent)",
  },
  missevan_paid_view_count: {
    color: "var(--chart-3)",
    background: "color-mix(in oklch, var(--chart-3) 10%, transparent)",
  },
  manbo_total_view_count: {
    color: "var(--chart-2)",
    background: "color-mix(in oklch, var(--chart-2) 11%, transparent)",
  },
  manbo_paid_view_count: {
    color: "var(--chart-4)",
    background: "color-mix(in oklch, var(--chart-4) 11%, transparent)",
  },
};

function getTrendMetricStyle(metric) {
  return trendMetricStyles[metric?.key] || trendMetricStyles.view_count;
}

function getTrendNumber(value) {
  if (value == null || String(value).trim() === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hasTrendMetricValues(metric) {
  const values = [
    metric?.fromValue,
    metric?.toValue,
    ...(Array.isArray(metric?.history) ? metric.history.map((point) => point?.value) : []),
  ];
  return values.some((value) => getTrendNumber(value) != null);
}

function shouldDisplayTrendMetric(metric, platform) {
  if (platform !== "manbo" || metric?.key !== "pay_count") {
    return true;
  }
  const values = [metric.fromValue, metric.toValue, metric.delta]
    .map((value) => getTrendNumber(value))
    .filter((value) => value != null);
  return values.some((value) => value !== 0);
}

function getDisplayTrendMetrics(metrics, platform) {
  return (Array.isArray(metrics) ? metrics : []).filter((metric) =>
    shouldDisplayTrendMetric(metric, platform)
  );
}

function isEmptyPaidDanmakuTrendMetric(metric) {
  if (metric?.key !== "danmaku_uid_count") {
    return false;
  }
  const fromValue = getTrendNumber(metric.fromValue);
  const toValue = getTrendNumber(metric.toValue);
  return fromValue != null && toValue != null && fromValue === 0 && toValue === 0;
}

function getChartTrendMetrics(metrics) {
  return (Array.isArray(metrics) ? metrics : []).filter(
    (metric) => !isEmptyPaidDanmakuTrendMetric(metric)
  );
}

function formatAxisWan(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "";
  }
  const digits = Math.abs(number) >= 1000 ? 0 : Math.abs(number) >= 100 ? 1 : 2;
  return `${number.toLocaleString("zh-CN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  })}万`;
}

function formatMetricAxisTick(value, metric) {
  if (metric?.key === "view_count") {
    return formatAxisWan(value / 10000);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "";
  }
  if (Math.abs(number) >= 10000) {
    return formatAxisWan(number / 10000);
  }
  return formatPlainNumber(Math.round(number));
}

function clampTrendTooltipPercent(value) {
  return Math.min(92, Math.max(8, value));
}

function TrendMetricRadioLegend({ metrics, selectedMetricKey, onSelectMetric }) {
  const legendMetrics = Array.isArray(metrics) ? metrics : [];
  if (!legendMetrics.length) {
    return null;
  }

  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
      {legendMetrics.map((metric) => {
        const style = getTrendMetricStyle(metric);
        const isSelected = selectedMetricKey === metric.key;
        return (
          <label
            key={metric.key}
            className={`inline-flex min-w-0 cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 text-[0.7rem] font-medium text-foreground transition-colors ${
              isSelected ? "bg-muted/60" : "hover:bg-muted/50"
            }`}
          >
            <input
              type="radio"
              name="rank-trend-metric"
              className="sr-only"
              checked={isSelected}
              aria-label={`选择${metric.label}曲线`}
              onChange={() => onSelectMetric?.(metric.key)}
            />
            <span
              aria-hidden="true"
              className="flex size-3.5 shrink-0 items-center justify-center rounded-full border transition-colors"
              style={{
                backgroundColor: isSelected ? style.color : "transparent",
                borderColor: style.color,
                color: "white",
              }}
            >
              {isSelected ? <CheckIcon className="size-2.5 stroke-[3]" /> : null}
            </span>
            <span className="min-w-0 truncate">{metric.label}</span>
          </label>
        );
      })}
    </div>
  );
}

function RankTrendLineChart({ metrics, legendMetrics = metrics, selectedMetricKey, onSelectMetric, windowKey, chartMode = "absolute" }) {
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [selectedPoint, setSelectedPoint] = useState(null);
  const availableMetrics = Array.isArray(metrics) ? metrics : [];
  const availableLegendMetrics = Array.isArray(legendMetrics) ? legendMetrics : availableMetrics;
  const chartMetricSignature = availableMetrics
    .map((metric) => `${metric.key}:${(Array.isArray(metric.history) ? metric.history : []).map((point) => `${point.date}:${point.value ?? ""}`).join(",")}`)
    .join("|");
  const chartData = buildSingleAxisTrendChartLines(availableMetrics, { chartMode });
  const chartLines = chartData.lines;
  const axis = chartData.axis || chartData.axes.left;
  const selectedMetric = availableMetrics[0] || availableLegendMetrics.find((metric) => metric.key === selectedMetricKey) || null;
  const axisLabelMarkers = getTrendAxisLabelMarkers(
    chartData.dateMarkers || chartLines[0]?.markers || [],
    windowKey
  );
  const activeTooltipPoint = selectedPoint || hoveredPoint;

  function buildTooltipPoint(line, point, position, style) {
    return {
      key: `${line.metric.key}-${point.date}`,
      label: line.metric.label,
      date: formatTrendDate(point.date),
      value: chartMode === "increment" ? formatSignedTrendValue(point.displayValue) : formatTrendValue(point.value),
      color: style.color,
      position,
    };
  }

  const tooltipPlacement = activeTooltipPoint?.position?.y < 44 ? "below" : "above";
  const tooltipLeft = activeTooltipPoint
    ? clampTrendTooltipPercent((activeTooltipPoint.position.x / 320) * 100)
    : 50;
  const tooltipTop = activeTooltipPoint
    ? clampTrendTooltipPercent(
        ((activeTooltipPoint.position.y + (tooltipPlacement === "below" ? 18 : -12)) / 170) * 100
      )
    : 50;

  useEffect(() => {
    setHoveredPoint(null);
    setSelectedPoint(null);
  }, [windowKey, chartMetricSignature, chartMode]);

  return (
    <div className="rounded-lg border border-border bg-card p-2.5 shadow-[var(--shadow-card)]">
      {availableLegendMetrics.length > 1 ? (
        <TrendMetricRadioLegend
          metrics={availableLegendMetrics}
          selectedMetricKey={selectedMetricKey}
          onSelectMetric={onSelectMetric}
        />
      ) : null}
      <div
        className="relative h-48 w-full overflow-visible rounded-md bg-card sm:h-52"
        role="group"
        tabIndex={0}
        aria-label="趋势图交互区域"
        onClick={() => setSelectedPoint(null)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setSelectedPoint(null);
          }
        }}
        onPointerLeave={() => setHoveredPoint(null)}
      >
        <svg aria-label="趋势折线图" className="size-full" preserveAspectRatio="none" viewBox="0 0 320 170">
          {axis.ticks.map((tick) => (
            <line
              key={`axis-${tick}`}
              x1="44"
              x2="302"
              y1={getSingleAxisTrendAxisY(tick, axis.domain)}
              y2={getSingleAxisTrendAxisY(tick, axis.domain)}
              stroke="var(--border)"
              strokeDasharray="4 6"
              strokeWidth="1"
            />
          ))}
          {chartLines.map((line) => {
            const metric = line.metric;
            const style = getTrendMetricStyle(metric);
            return (
              <g key={metric.key}>
                {line.segments.map((segment, index) => (
                  <polyline
                    key={`${metric.key}-${index}`}
                    fill="none"
                    points={segment.map(({ position }) => `${position.x},${position.y}`).join(" ")}
                    stroke={style.color}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2.5"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </g>
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-y-0 left-1 top-0 w-12 text-[0.52rem] font-medium text-muted-foreground">
          {axis.ticks.map((tick) => (
            <span
              key={`axis-label-${tick}`}
              className="absolute right-1 -translate-y-1/2 tabular-nums"
              style={{ top: `${(getSingleAxisTrendAxisY(tick, axis.domain) / 170) * 100}%` }}
            >
              {formatMetricAxisTick(tick, selectedMetric)}
            </span>
          ))}
        </div>
        {chartLines.flatMap((line) => {
          const style = getTrendMetricStyle(line.metric);
          return line.markers.map(({ point, position }) => (
            <span
              key={`${line.metric.key}-${point.date}`}
              aria-hidden="true"
              className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-card"
              style={{
                borderColor: style.color,
                left: `${(position.x / 320) * 100}%`,
                top: `${(position.y / 170) * 100}%`,
              }}
            />
          ));
        })}
        {chartLines.flatMap((line) => {
          const style = getTrendMetricStyle(line.metric);
          return line.markers.map(({ point, position }) => {
              const tooltipPoint = buildTooltipPoint(line, point, position, style);
              return (
                <button
                  key={`target-${tooltipPoint.key}`}
                  type="button"
                  aria-label={`${line.metric.label} ${tooltipPoint.date} ${tooltipPoint.value}`}
                  className="absolute size-7 -translate-x-1/2 -translate-y-1/2 rounded-full bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                  style={{
                    left: `${(position.x / 320) * 100}%`,
                    top: `${(position.y / 170) * 100}%`,
                  }}
                  onFocus={() => setHoveredPoint(tooltipPoint)}
                  onBlur={() => setHoveredPoint(null)}
                  onPointerEnter={() => setHoveredPoint(tooltipPoint)}
                  onPointerLeave={() => setHoveredPoint(null)}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedPoint(tooltipPoint);
                  }}
                />
              );
            });
        })}
        {activeTooltipPoint ? (
          <div
            className={`pointer-events-none absolute z-20 min-w-12 -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-center text-[0.62rem] font-medium leading-tight text-popover-foreground shadow-md ${
              tooltipPlacement === "below" ? "" : "-translate-y-full"
            }`}
            style={{
              borderColor: activeTooltipPoint.color,
              left: `${tooltipLeft}%`,
              top: `${tooltipTop}%`,
            }}
          >
            <div>{activeTooltipPoint.date}</div>
            <div className="mt-0.5">{activeTooltipPoint.label}</div>
            <div className="mt-0.5 tabular-nums">{activeTooltipPoint.value}</div>
          </div>
        ) : null}
        <div className="pointer-events-none absolute inset-x-0 bottom-2 text-[0.65rem] font-medium text-muted-foreground">
          {axisLabelMarkers.map(({ point, position }) => (
            <span
              key={point.date}
              className="absolute -translate-x-1/2 whitespace-nowrap"
              style={{ left: `${(position.x / 320) * 100}%` }}
            >
              {formatTrendDate(point.date)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function getSnapshotColumns(metrics, platform, isWeeklyPlayback = false) {
  const metricMap = new Map((Array.isArray(metrics) ? metrics : []).map((metric) => [metric.key, metric]));
  const viewMetric = metricMap.get("view_count") || null;
  const isCvTrend =
    metricMap.has("missevan_total_view_count") ||
    metricMap.has("missevan_paid_view_count") ||
    metricMap.has("manbo_total_view_count") ||
    metricMap.has("manbo_paid_view_count");
  if (isCvTrend) {
    return [
      { key: "date", label: "日期", metric: null },
      { key: "missevan_total_view_count", label: "猫耳汇总", metric: metricMap.get("missevan_total_view_count") || null },
      { key: "missevan_paid_view_count", label: "猫耳付费", metric: metricMap.get("missevan_paid_view_count") || null },
      { key: "manbo_total_view_count", label: "漫播汇总", metric: metricMap.get("manbo_total_view_count") || null },
      { key: "manbo_paid_view_count", label: "漫播付费", metric: metricMap.get("manbo_paid_view_count") || null },
    ];
  }
  const isPeakSeriesTrend =
    metricMap.size === 1 &&
    viewMetric?.label === "系列总播放量";
  if (isPeakSeriesTrend) {
    return [
      { key: "date", label: "日期", metric: null },
      { key: "view_count", label: "系列总播放量", metric: viewMetric },
    ];
  }
  if (isWeeklyPlayback) {
    return [
      { key: "date", label: "日期", metric: null },
      { key: "view_count", label: "播放量", metric: viewMetric },
    ];
  }

  const finalMetricKey = platform === "missevan" ? "subscription_num" : "pay_count";
  const finalMetric = metricMap.get(finalMetricKey);
  const columns = [
    { key: "date", label: "日期", metric: null },
    { key: "view_count", label: "播放量", metric: viewMetric },
    { key: "danmaku_uid_count", label: "付费ID数", metric: metricMap.get("danmaku_uid_count") || null },
  ];

  if (finalMetric && hasTrendMetricValues(finalMetric)) {
    columns.push({
      key: finalMetricKey,
      label: platform === "missevan" ? "追剧人数" : "付费/收听人数",
      metric: finalMetric,
    });
  }

  return columns;
}

function buildSnapshotRows(columns, chartMode = "absolute") {
  const dateSet = new Set();
  const valueMaps = new Map();

  columns.forEach((column) => {
    if (!column.metric) {
      return;
    }
    const metricValues = new Map();
    let previousPoint = null;
    (Array.isArray(column.metric.history) ? column.metric.history : []).forEach((point) => {
      const date = String(point?.date ?? "").trim();
      if (!date) {
        return;
      }
      const value = getTrendNumber(point?.value);
      if (point?.isPreWindow) {
        previousPoint = point;
        return;
      }
      dateSet.add(date);
      if (chartMode === "increment") {
        const previousValue = getTrendNumber(previousPoint?.value);
        const explicitDelta = getTrendNumber(point?.deltaValue);
        metricValues.set(
          date,
          explicitDelta != null
            ? explicitDelta
            : value != null && previousValue != null && areAdjacentTrendDates(previousPoint?.date, date)
            ? value - previousValue
            : null
        );
      } else {
        metricValues.set(date, point.value ?? null);
      }
      previousPoint = point;
    });
    valueMaps.set(column.key, metricValues);
  });

  return [...dateSet].sort().map((date) => {
    const values = {};
    columns.forEach((column) => {
      if (column.key !== "date") {
        values[column.key] = valueMaps.get(column.key)?.get(date) ?? null;
      }
    });
    return { date, values };
  });
}

function TrendSnapshotDetails({ metrics, platform, chartMode = "absolute", isWeeklyPlayback = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const columns = getSnapshotColumns(metrics, platform, isWeeklyPlayback);
  const rows = buildSnapshotRows(columns, chartMode);

  return (
    <div className="rounded-lg border border-border/70 bg-background/82">
      {!isOpen ? (
        <button
          type="button"
          className="flex h-8 w-full items-center justify-between gap-2 px-2.5 text-left text-xs! font-medium text-foreground"
          aria-expanded={isOpen}
          onClick={() => setIsOpen(true)}
        >
          <span>数据明细</span>
          <ChevronDownIcon
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground transition-transform"
          />
        </button>
      ) : (
        <div className="max-h-44 overflow-y-auto border-t border-border/70">
          {rows.length ? (
            <table className="w-full table-fixed border-collapse text-[0.68rem]">
              <thead className="sticky top-0 z-10 bg-background/95 text-muted-foreground">
                <tr>
                  {columns.map((column, index) => {
                    const isLastColumn = index === columns.length - 1;
                    return (
                      <th
                        key={column.key}
                        className={`border-b border-border/70 px-2 py-1.5 font-medium ${
                          column.key === "date" ? "text-left" : "text-right"
                        } ${isLastColumn ? "relative pr-8" : ""}`}
                      >
                        {column.label}
                        {isLastColumn ? (
                          <button
                            type="button"
                            className="absolute right-1 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                            aria-label="收起数据明细"
                            onClick={() => setIsOpen(false)}
                          >
                            <ChevronDownIcon aria-hidden="true" className="size-3.5 rotate-180" />
                          </button>
                        ) : null}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.date} className="border-b border-border/45 last:border-b-0">
                    {columns.map((column, index) => (
                      <td
                        key={`${row.date}-${column.key}`}
                        className={`px-2 py-1.5 tabular-nums ${index === columns.length - 1 ? "pr-8" : ""} ${
                          column.key === "date" ? "text-left text-muted-foreground" : "text-right text-foreground"
                        }`}
                      >
                        {column.key === "date"
                          ? formatTrendDate(row.date)
                          : chartMode === "increment"
                            ? formatTrendSnapshotDeltaValue(row.values[column.key])
                            : formatTrendSnapshotValue(row.values[column.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="flex items-center justify-between gap-2 px-2.5 py-3 text-xs text-muted-foreground">
              <span>暂无快照数据</span>
              <button
                type="button"
                className="inline-flex size-6 items-center justify-center rounded-md hover:bg-muted hover:text-foreground"
                aria-label="收起数据明细"
                onClick={() => setIsOpen(false)}
              >
                <ChevronDownIcon aria-hidden="true" className="size-3.5 rotate-180" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function RankTrendDeltaBadge({ metric, children, className = "" }) {
  const style = getTrendMetricStyle(metric);
  const emptyPaidEpisodes = isEmptyPaidDanmakuTrendMetric(metric);
  const hasDelta =
    !emptyPaidEpisodes && metric?.available && metric.delta != null && Number.isFinite(Number(metric.delta));
  const deltaStyle = hasDelta
    ? {
        backgroundColor: style.color,
        borderColor: style.color,
        color: "white",
      }
    : undefined;
  return (
    <Badge
      variant="outline"
      className={`${hasDelta ? "h-6 border-transparent px-2 text-xs shadow-none" : "h-6 px-2 text-xs"} ${className}`.trim()}
      style={deltaStyle}
    >
      {children ?? formatTrendDeltaWithPercent(emptyPaidEpisodes ? { ...metric, emptyPaidEpisodes } : metric)}
    </Badge>
  );
}

export function formatRankTrendDelta(metric) {
  return formatTrendDelta(metric);
}

function TrendMetricRow({ metric, windowLabel, isWeeklyPlayback = false }) {
  const style = getTrendMetricStyle(metric);
  const emptyPaidEpisodes = isEmptyPaidDanmakuTrendMetric(metric);
  return (
    <div className="flex items-center justify-between gap-2.5 rounded-lg border border-border/70 bg-background/82 p-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-md border"
          style={{
            backgroundColor: style.background,
            borderColor: style.color,
            color: style.color,
            boxShadow: `inset 0 0 0 1px ${style.color}`,
          }}
        >
          <MetricIcon label={metric.label} className="size-3.5" />
        </span>
        <div className="min-w-0">
          <div className="text-[0.82rem] font-medium leading-4">{metric.label}</div>
          <div className="text-[0.7rem] text-muted-foreground">
            {isWeeklyPlayback ? "最新：" : "今日："}<span className="tabular-nums text-foreground">{formatTrendValue(metric.toValue)}</span>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-1.5 pl-2">
        <span className="text-[0.68rem] font-medium text-muted-foreground">{windowLabel}</span>
        <RankTrendDeltaBadge metric={emptyPaidEpisodes ? { ...metric, emptyPaidEpisodes } : metric} />
      </div>
    </div>
  );
}

export function RankTrendButton({ className = "", density = "default", ...props }) {
  const hitAreaClassName = density === "inline" ? trendActionInlineClassName : trendActionHitAreaClassName;
  return (
    <Button
      type="button"
      variant="ghost"
      data-touch="compact"
      className={`${hitAreaClassName} ${className}`.trim()}
      {...props}
    >
      <span className={`${trendActionVisualClassName} ${trendActionButtonClassName}`}>
        <TrendingUpIcon data-icon="inline-start" />
        趋势
      </span>
    </Button>
  );
}

export function CompareActionButton({ className = "", density = "default", ...props }) {
  const hitAreaClassName = density === "inline" ? trendActionInlineClassName : trendActionHitAreaClassName;
  return (
    <Button
      type="button"
      variant="ghost"
      data-touch="compact"
      className={`${hitAreaClassName} ${className}`.trim()}
      {...props}
    >
      <span className={`${trendActionVisualClassName} ${compareActionButtonClassName}`}>
        <ArrowLeftRightIcon data-icon="inline-start" />
        对比
      </span>
    </Button>
  );
}

export function RankTrendDialog({ open, onOpenChange, item, platform, trendState }) {
  const [selectedWindow, setSelectedWindow] = useState("7d");
  const [selectedChartMode, setSelectedChartMode] = useState("absolute");
  const [selectedMetricKey, setSelectedMetricKey] = useState("view_count");
  const data = trendState.data;
  const windows = data?.windows || {};
  const isCvTrend = data?.kind === "cv";
  const isWeeklyPlaybackTrend = data?.kind === "weekly_playback";
  const metaTags = getTrendMetaTags(item, platform);
  const latestRankHistory = Array.isArray(data?.rankHistory) ? data.rankHistory.at(-1) : null;
  const latestRankHistoryDate = String(latestRankHistory?.date ?? "").trim();
  const rankHistoryLatestDate = String(data?.rankHistoryLatestDate ?? data?.latestDate ?? "").trim();
  const shouldShowRankHistoryDate = Boolean(
    latestRankHistoryDate &&
      rankHistoryLatestDate &&
      latestRankHistoryDate !== rankHistoryLatestDate
  );
  const defaultWindowKey = isCvTrend || isWeeklyPlaybackTrend ? "7w" : "7d";
  const availableWindowOrder = isCvTrend || isWeeklyPlaybackTrend
    ? ["3w", "7w", "30w"]
    : ["3d", "7d", "30d"];
  const availableWindows = availableWindowOrder.filter((key) => windows[key]);
  const activeWindowKey = availableWindows.includes(selectedWindow)
    ? selectedWindow
    : availableWindows.includes(defaultWindowKey)
      ? defaultWindowKey
      : availableWindows[0] || defaultWindowKey;
  const activeWindow = windows[activeWindowKey];
  const activeMetrics = getDisplayTrendMetrics(activeWindow?.metrics, platform);
  const activeWindowGeneratedAt = getTrendWindowGeneratedAt(activeWindow, activeMetrics);
  const chartMetrics = getChartTrendMetrics(activeMetrics);
  const chartMetricKeySignature = chartMetrics.map((metric) => metric.key).join("|");
  const selectedChartMetric = chartMetrics.find((metric) => metric.key === selectedMetricKey) || chartMetrics[0] || null;
  const visibleChartMetrics = selectedChartMetric ? [selectedChartMetric] : [];
  const detailIdText = Array.isArray(data?.dramaIds) && data.dramaIds.length
    ? data.dramaIds.join("，")
    : isCvTrend
      ? "CV趋势"
      : item?.id ?? data?.id;

  useEffect(() => {
    if (open) {
      setSelectedWindow(defaultWindowKey);
      setSelectedChartMode("absolute");
      setSelectedMetricKey("view_count");
    }
  }, [open, item?.id, defaultWindowKey]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const chartMetricKeys = chartMetricKeySignature.split("|").filter(Boolean);
    if (!chartMetricKeys.length) {
      setSelectedMetricKey("view_count");
      return;
    }
    setSelectedMetricKey((current) => {
      if (chartMetricKeys.includes(current)) {
        return current;
      }
      return chartMetricKeys.includes("view_count") ? "view_count" : chartMetricKeys[0];
    });
  }, [open, activeWindowKey, chartMetricKeySignature]);

  function selectTrendMetric(metricKey) {
    if (chartMetrics.some((metric) => metric.key === metricKey)) {
      setSelectedMetricKey(metricKey);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        scrollable
        className="w-[calc(100vw-1.5rem)] max-w-[30rem] gap-3 overflow-visible p-3 pt-4 sm:max-w-[32rem] sm:p-4 sm:pt-5"
      >
        <AlertDialogCancel
          aria-label="关闭趋势弹窗"
          className="absolute right-3 top-3"
          size="icon-xs"
          title="关闭"
          variant="secondary"
        >
          <XIcon />
        </AlertDialogCancel>
        <AlertDialogHeader className="gap-1 place-items-start pr-8 text-left">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <AlertDialogTitle className="text-base">{data?.name || item?.name || "作品"}</AlertDialogTitle>
            {metaTags.map((label) => (
              <Badge
                key={`${item?.id || data?.id || data?.name}-${label}`}
                variant={rankTrendTagVariants[label] || "outline"}
                className={metaBadgeClassName}
              >
                {label}
              </Badge>
            ))}
            {isWeeklyPlaybackTrend ? (
              <Badge variant="outline" className={metaBadgeClassName}>每周采样 · 仅播放量</Badge>
            ) : null}
          </div>
          <AlertDialogDescription
            className="flex w-full max-w-none justify-self-stretch items-start gap-1 text-left text-xs"
            style={{ textWrap: "wrap" }}
          >
            {isCvTrend ? (
              <TrendingUpIcon aria-label="趋势类型" className="size-3.5 shrink-0" />
            ) : (
              <PlatformIdIcon platform={platform} aria-label="作品ID" className="size-3.5 shrink-0" />
            )}
            <span className="min-w-0 flex-1 break-words" style={{ textWrap: "wrap" }}>{detailIdText}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {trendState.isLoading ? (
          <Alert>
            <RefreshCwIcon className="size-4 animate-spin" />
            <AlertTitle>正在读取趋势</AlertTitle>
            <AlertDescription>正在读取历史数据</AlertDescription>
          </Alert>
        ) : null}

        {!trendState.isLoading && trendState.error ? (
          <Alert className="border-destructive/30 bg-destructive/10">
            <AlertTitle>趋势暂不可用</AlertTitle>
            <AlertDescription>{trendState.error}</AlertDescription>
          </Alert>
        ) : null}

        {!trendState.isLoading && !trendState.error && data?.success ? (
          <div className="grid min-w-0 gap-2.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Tabs value={activeWindowKey} onValueChange={setSelectedWindow} className="w-fit">
                <TabsList className="inline-flex h-[34px] w-fit items-center justify-center text-xs!">
                  {availableWindows.map((key) => (
                    <TabsTrigger key={key} data-touch="compact" className="h-[26px] min-w-0 px-3 text-xs!" value={key}>
                      {windows[key].label || cvTrendWindowFallbackLabels[key]}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <Tabs value={selectedChartMode} onValueChange={setSelectedChartMode} className="w-fit shrink-0">
                <TabsList
                  aria-label="趋势曲线类型"
                  className="inline-flex h-[34px] w-fit items-center justify-center text-xs!"
                >
                  <TabsTrigger data-touch="compact" className="h-[26px] min-w-0 px-3 text-xs!" value="absolute">
                    绝对值
                  </TabsTrigger>
                  <TabsTrigger data-touch="compact" className="h-[26px] min-w-0 px-3 text-xs!" value="increment">
                    增量
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {activeWindow ? (
              <div className="grid min-w-0 gap-2.5">
                <div className="text-xs leading-5 text-muted-foreground">
                  {formatTrendDate(activeWindow.fromDate)} → {formatTrendDate(activeWindow.toDate)}
                  {activeWindow.insufficientData ? "，数据不足" : ""}
                  {activeWindowGeneratedAt ? `，数据刷新于：${formatDeviceDateTime(activeWindowGeneratedAt)}` : ""}
                </div>
                {latestRankHistory?.ranks?.length ? (
                  <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                    {latestRankHistory.ranks.map((rank) => (
                      <Badge key={`${latestRankHistory.date}-${rank.key}`} variant="outline">
                        {shouldShowRankHistoryDate ? `${formatTrendDate(latestRankHistoryDate)} ` : ""}{rank.name} #{rank.position}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                <RankTrendLineChart
                  metrics={visibleChartMetrics}
                  legendMetrics={chartMetrics}
                  selectedMetricKey={selectedChartMetric?.key || selectedMetricKey}
                  onSelectMetric={selectTrendMetric}
                  windowKey={activeWindowKey}
                  chartMode={selectedChartMode}
                />
                <TrendSnapshotDetails
                  metrics={activeMetrics}
                  platform={platform}
                  chartMode={selectedChartMode}
                  isWeeklyPlayback={isWeeklyPlaybackTrend}
                />
                <div className="grid gap-1.5">
                  {activeMetrics.map((metric) => (
                    <TrendMetricRow
                      key={`${activeWindow.key}-${metric.key}`}
                      metric={metric}
                      windowLabel={activeWindow.label}
                      isWeeklyPlayback={isWeeklyPlaybackTrend}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}
