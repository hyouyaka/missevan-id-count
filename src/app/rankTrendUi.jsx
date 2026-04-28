import { useEffect, useState } from "react";
import {
  BeanIcon,
  ChevronDownIcon,
  CoinsIcon,
  GemIcon,
  HashIcon,
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

import { buildVersionedUrl, formatPlainNumber } from "@/app/app-utils";
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

export const RANK_TREND_CLIENT_SCHEMA_VERSION = 4;
export const trendActionButtonClassName =
  "w-fit border-[rgba(20,121,111,0.32)] bg-[rgb(20,121,111)] px-2.5 text-white shadow-[0_12px_24px_-16px_rgba(20,121,111,0.72)] hover:bg-[rgb(17,104,96)] hover:text-white";

const rankTrendClientCache = new Map();
const ranksTrendLookupCache = {
  data: null,
  frontendVersion: "",
  loadedAt: 0,
  promise: null,
};
const RANKS_TREND_LOOKUP_TTL_MS = 30 * 60 * 1000;

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
  "付费人数/收听人数": ShoppingCartIcon,
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

function formatTrendValue(value) {
  return value == null ? "暂无数据" : formatPlainNumber(value);
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
  if (!detailIdText || isMissevanPeak || rankKey === "peak") {
    return false;
  }
  if (platform === "missevan") {
    return true;
  }
  return platform === "manbo";
}

export async function fetchRankTrendData({ platform, id, frontendVersion }) {
  const normalizedPlatform = String(platform ?? "").trim();
  const normalizedId = String(id ?? "").trim();
  const normalizedVersion = String(frontendVersion ?? "").trim();
  const cacheKey = `${RANK_TREND_CLIENT_SCHEMA_VERSION}:${normalizedVersion}:${normalizedPlatform}:${normalizedId}`;
  const cached = rankTrendClientCache.get(cacheKey);
  if (cached?.data) {
    return cached.data;
  }
  if (cached?.promise) {
    return cached.promise;
  }

  const params = new URLSearchParams({
    platform: normalizedPlatform,
    id: normalizedId,
    schema: String(RANK_TREND_CLIENT_SCHEMA_VERSION),
  });
  const promise = (async () => {
    try {
      const response = await fetch(buildVersionedUrl(`/ranks/trends?${params.toString()}`, frontendVersion), {
        cache: "no-cache",
      });
      const data = await response.json();
      const payload = { response, data };
      if (response.ok && data?.success) {
        rankTrendClientCache.set(cacheKey, { data: payload, promise: null });
      }
      return payload;
    } finally {
      const current = rankTrendClientCache.get(cacheKey);
      if (current?.promise === promise) {
        rankTrendClientCache.set(cacheKey, { data: current.data || null, promise: null });
      }
    }
  })();

  rankTrendClientCache.set(cacheKey, { data: null, promise });
  return promise;
}

export async function fetchRanksTrendLookupData(frontendVersion) {
  const normalizedVersion = String(frontendVersion ?? "").trim();
  const now = Date.now();
  if (
    ranksTrendLookupCache.data &&
    ranksTrendLookupCache.frontendVersion === normalizedVersion &&
    now - ranksTrendLookupCache.loadedAt < RANKS_TREND_LOOKUP_TTL_MS
  ) {
    return ranksTrendLookupCache.data;
  }
  if (ranksTrendLookupCache.promise && ranksTrendLookupCache.frontendVersion === normalizedVersion) {
    return ranksTrendLookupCache.promise;
  }

  ranksTrendLookupCache.frontendVersion = normalizedVersion;
  ranksTrendLookupCache.promise = (async () => {
    try {
      const response = await fetch(buildVersionedUrl("/ranks", frontendVersion), {
        cache: "no-cache",
      });
      const data = await response.json();
      const payload = { response, data };
      if (response.ok && data?.success) {
        ranksTrendLookupCache.data = payload;
        ranksTrendLookupCache.loadedAt = Date.now();
      }
      return payload;
    } finally {
      ranksTrendLookupCache.promise = null;
    }
  })();

  return ranksTrendLookupCache.promise;
}

export function logRankTrendOpen({
  platform,
  id,
  name,
  source,
  rankKey,
  frontendVersion,
} = {}) {
  const normalizedPlatform = String(platform ?? "").trim();
  const normalizedId = String(id ?? "").trim();
  if (!normalizedPlatform || !normalizedId) {
    return;
  }

  fetch(buildVersionedUrl("/usage-log", frontendVersion), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      platform: normalizedPlatform,
      action: "trend",
      dramaId: normalizedId,
      dramaName: String(name ?? "").trim(),
      source: String(source ?? "").trim(),
      rankKey: String(rankKey ?? "").trim(),
    }),
  }).catch((error) => {
    console.error("Failed to log rank trend open", error);
  });
}

function getRankItemId(item) {
  return String(item?.id ?? item?.drama_id ?? item?.dramaId ?? item?.radioDramaId ?? "").trim();
}

export function buildSearchTrendEligibleIdSet(ranksPayload, platform) {
  const idSet = new Set();
  const platformData = ranksPayload?.platforms?.[platform] || ranksPayload?.data?.platforms?.[platform];
  const categories = Array.isArray(platformData?.categories) ? platformData.categories : [];
  categories.forEach((category) => {
    const ranks = Array.isArray(category?.ranks) ? category.ranks : [];
    ranks.forEach((rank) => {
      const rankKey = String(rank?.key ?? "").trim();
      const items = Array.isArray(rank?.items) ? rank.items : [];
      items.forEach((item) => {
        const id = getRankItemId(item);
        if (!id) {
          return;
        }
        if (platform === "missevan") {
          if (rankKey !== "peak" && item?.type !== "peak") {
            idSet.add(id);
          }
          return;
        }
        if (platform === "manbo" && rankKey !== "peak" && item?.type !== "peak") {
          idSet.add(id);
        }
      });
    });
  });
  return idSet;
}

function getGenericPaymentTag(item) {
  if (item?.is_member) {
    return "会员";
  }
  return String(item?.payment_label ?? "").trim();
}

function getGenericTitleTags(item) {
  return [item?.content_type_label || item?.catalogName || item?.catalog_name]
    .map((label) => String(label ?? "").trim())
    .map((label) => (label === "有声书" ? "有声剧" : label))
    .filter(Boolean);
}

function getTrendMetaTags(item, platform) {
  const platformLabel = platform === "missevan" ? "猫耳" : "漫播";
  return [platformLabel, getGenericPaymentTag(item), ...getGenericTitleTags(item)]
    .map((label) => String(label ?? "").trim())
    .filter(Boolean);
}

const trendMetricStyles = {
  view_count: {
    color: "var(--chart-1)",
    background: "rgba(36, 74, 134, 0.1)",
  },
  danmaku_uid_count: {
    color: "var(--chart-3)",
    background: "rgba(31, 157, 138, 0.1)",
  },
  subscription_num: {
    color: "var(--chart-2)",
    background: "rgba(230, 107, 79, 0.11)",
  },
  pay_count: {
    color: "var(--chart-2)",
    background: "rgba(230, 107, 79, 0.11)",
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

function getTrendPointPosition(point, index, points, minPercent, maxPercent) {
  const width = 320;
  const height = 170;
  const left = 44;
  const right = 18;
  const top = 20;
  const bottom = 30;
  const x = points.length <= 1 ? width / 2 : left + (index / (points.length - 1)) * (width - left - right);
  const range = maxPercent - minPercent;
  const normalized = range === 0 ? 0.5 : (Number(point.percent) - minPercent) / range;
  const y = top + (1 - normalized) * (height - top - bottom);
  return { x, y };
}

function clampTrendY(value) {
  return Math.min(144, Math.max(18, value));
}

function clampTrendX(value) {
  return Math.min(304, Math.max(42, value));
}

function offsetTrendPositions(positions, offset) {
  if (!offset || positions.length < 2) {
    return positions;
  }
  const first = positions[0];
  const last = positions.at(-1);
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const length = Math.hypot(dx, dy) || 1;
  const normalX = -dy / length;
  const normalY = dx / length;
  return positions.map((point) => ({
    ...point,
    x: clampTrendX(point.x + normalX * offset),
    y: clampTrendY(point.y + normalY * offset),
  }));
}

function buildTrendPercentPoints(metric) {
  const history = Array.isArray(metric?.history) ? metric.history : [];
  const baseValue = getTrendNumber(history.find((point) => getTrendNumber(point.value) != null)?.value);
  if (baseValue == null || baseValue === 0) {
    return [];
  }
  return history.map((point) => ({
    ...point,
    percent: getTrendNumber(point.value) != null
      ? ((getTrendNumber(point.value) - baseValue) / baseValue) * 100
      : null,
  }));
}

function buildTrendPercentDomain(percentValues) {
  if (!percentValues.length) {
    return { min: -5, max: 5 };
  }
  const minValue = Math.min(...percentValues);
  const maxValue = Math.max(...percentValues);
  const step = Math.max(Math.abs(minValue), Math.abs(maxValue)) < 5 ? 0.5 : 5;
  let min = Math.floor(minValue / step) * step;
  let max = Math.ceil(maxValue / step) * step;
  if (min === max) {
    if (min === 0) {
      min = -step;
      max = step;
    } else {
      min -= step;
      max += step;
    }
  }
  return {
    min: Number(min.toFixed(4)),
    max: Number(max.toFixed(4)),
    step,
  };
}

function buildTrendPercentTicks(domain) {
  const range = domain.max - domain.min;
  const baseStep = domain.step || 5;
  const step = Math.max(baseStep, Math.ceil(range / 4 / baseStep) * baseStep);
  const ticks = [];
  for (let value = domain.min; value <= domain.max + step / 1000; value += step) {
    ticks.push(Number(value.toFixed(4)));
  }
  if (ticks.at(-1) !== domain.max) {
    ticks.push(domain.max);
  }
  return ticks;
}

function formatAxisPercent(value) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) {
    return "";
  }
  const prefix = percent > 0 ? "+" : "";
  return `${prefix}${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

function getTrendPercentY(percent, domain) {
  const top = 20;
  const bottom = 30;
  const height = 170;
  const range = domain.max - domain.min || 1;
  return top + (1 - (percent - domain.min) / range) * (height - top - bottom);
}

function buildTrendPolyline(metric, domain) {
  const points = buildTrendPercentPoints(metric);
  const validPointCount = points.filter((point) => getTrendNumber(point.percent) != null).length;
  if (validPointCount < 2) {
    return null;
  }

  const positions = points.map((point, index) =>
    getTrendPointPosition(point, index, points, domain.min, domain.max)
  );
  const segment = points
    .map((point, index) => ({ point, position: positions[index] }))
    .filter(({ point }) => getTrendNumber(point.percent) != null);

  if (segment.length < 2) {
    return null;
  }

  return {
    points,
    positions,
    segments: [segment],
  };
}

function buildTrendChartLines(metrics) {
  const percentValues = metrics
    .flatMap((metric) => buildTrendPercentPoints(metric))
    .map((point) => point.percent)
    .filter((value) => Number.isFinite(value));
  const domain = buildTrendPercentDomain(percentValues);
  const ticks = buildTrendPercentTicks(domain);
  const signatureCounts = new Map();
  const lines = metrics
    .map((metric) => {
      const line = buildTrendPolyline(metric, domain);
      if (!line) {
        return null;
      }

      const renderedEntries = line.segments.flatMap((segment) => segment);
      const signature = renderedEntries
        .map(({ position }) => position)
        .map((point) => `${Math.round(point.x)}:${Math.round(point.y)}`)
        .join("|");
      const seenCount = signatureCounts.get(signature) || 0;
      signatureCounts.set(signature, seenCount + 1);
      const offset = seenCount * 8;
      const positions = offsetTrendPositions(
        renderedEntries.map(({ position }) => position),
        offset
      );
      const positionByDate = new Map(
        renderedEntries.map(({ point }, index) => [String(point?.date ?? ""), positions[index]])
      );
      const segments = line.segments
        .map((segment) =>
          segment
            .map(({ point }) => ({
              point,
              position: positionByDate.get(String(point?.date ?? "")),
            }))
            .filter((segmentPoint) => segmentPoint.position)
        )
        .filter((segment) => segment.length > 1);

      return {
        ...line,
        metric,
        positions,
        segments,
      };
    })
    .filter(Boolean);
  return { lines, domain, ticks };
}

function RankTrendLineChart({ metrics }) {
  const availableMetrics = Array.isArray(metrics) ? metrics : [];
  const chartData = buildTrendChartLines(availableMetrics);
  const chartLines = chartData.lines;
  const axisPoints =
    availableMetrics.find((metric) => Array.isArray(metric.history) && metric.history.length)?.history || [];

  return (
    <div className="rounded-lg border border-border/80 bg-background/82 p-2.5 shadow-[0_18px_38px_-34px_rgba(15,23,42,0.22)]">
      <div className="mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-1">
        {availableMetrics.map((metric) => {
          const style = getTrendMetricStyle(metric);
          return (
            <span key={metric.key} className="inline-flex items-center gap-1 text-[0.7rem] font-medium text-foreground">
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ backgroundColor: style.color }}
              />
              {metric.label}
            </span>
          );
        })}
      </div>
      <div className="relative h-48 w-full overflow-hidden rounded-md bg-card sm:h-52">
        <svg aria-label="趋势折线图" className="size-full" preserveAspectRatio="none" viewBox="0 0 320 170">
          {chartData.ticks.map((tick) => (
            <line
              key={tick}
              x1="44"
              x2="302"
              y1={getTrendPercentY(tick, chartData.domain)}
              y2={getTrendPercentY(tick, chartData.domain)}
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
        <div className="pointer-events-none absolute inset-y-0 left-1 top-0 w-9 text-[0.58rem] font-medium text-muted-foreground">
          {chartData.ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-1 -translate-y-1/2 tabular-nums"
              style={{ top: `${(getTrendPercentY(tick, chartData.domain) / 170) * 100}%` }}
            >
              {formatAxisPercent(tick)}
            </span>
          ))}
        </div>
        {chartLines.flatMap((line) => {
          const style = getTrendMetricStyle(line.metric);
          return line.segments.flatMap((segment) => segment).map(({ point, position }) => (
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
        <div className="pointer-events-none absolute inset-x-3 bottom-2 flex justify-between text-[0.65rem] font-medium text-muted-foreground">
          {axisPoints.map((point) => (
            <span key={point.date}>{formatTrendDate(point.date)}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function getSnapshotColumns(metrics, platform) {
  const metricMap = new Map((Array.isArray(metrics) ? metrics : []).map((metric) => [metric.key, metric]));
  const finalMetricKey = platform === "missevan" ? "subscription_num" : "pay_count";
  const finalMetric = metricMap.get(finalMetricKey);
  const columns = [
    { key: "date", label: "日期", metric: null },
    { key: "view_count", label: "播放量", metric: metricMap.get("view_count") || null },
    { key: "danmaku_uid_count", label: "付费ID数", metric: metricMap.get("danmaku_uid_count") || null },
  ];

  if (finalMetric && hasTrendMetricValues(finalMetric)) {
    columns.push({
      key: finalMetricKey,
      label: platform === "missevan" ? "追剧人数" : "付费人数/收听人数",
      metric: finalMetric,
    });
  }

  return columns;
}

function buildSnapshotRows(columns) {
  const dateSet = new Set();
  const valueMaps = new Map();

  columns.forEach((column) => {
    if (!column.metric) {
      return;
    }
    const metricValues = new Map();
    (Array.isArray(column.metric.history) ? column.metric.history : []).forEach((point) => {
      const date = String(point?.date ?? "").trim();
      if (!date) {
        return;
      }
      dateSet.add(date);
      metricValues.set(date, point.value ?? null);
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

function TrendSnapshotDetails({ metrics, platform }) {
  const [isOpen, setIsOpen] = useState(false);
  const columns = getSnapshotColumns(metrics, platform);
  const rows = buildSnapshotRows(columns);

  return (
    <div className="rounded-lg border border-border/70 bg-background/82">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left text-[0.78rem] font-medium text-foreground"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span>数据明细</span>
        <ChevronDownIcon
          aria-hidden="true"
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>
      {isOpen ? (
        <div className="max-h-44 overflow-y-auto border-t border-border/70">
          {rows.length ? (
            <table className="w-full border-collapse text-[0.68rem]">
              <thead className="sticky top-0 z-10 bg-background/95 text-muted-foreground">
                <tr>
                  {columns.map((column) => (
                    <th
                      key={column.key}
                      className={`border-b border-border/70 px-2 py-1.5 font-medium ${
                        column.key === "date" ? "text-left" : "text-right"
                      }`}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.date} className="border-b border-border/45 last:border-b-0">
                    {columns.map((column) => (
                      <td
                        key={`${row.date}-${column.key}`}
                        className={`px-2 py-1.5 tabular-nums ${
                          column.key === "date" ? "text-left text-muted-foreground" : "text-right text-foreground"
                        }`}
                      >
                        {column.key === "date" ? formatTrendDate(row.date) : formatTrendValue(row.values[column.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="px-2.5 py-3 text-xs text-muted-foreground">暂无快照数据</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function TrendMetricRow({ metric, windowLabel }) {
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
            今日：<span className="tabular-nums text-foreground">{formatTrendValue(metric.toValue)}</span>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-1.5 pl-2">
        <span className="text-[0.68rem] font-medium text-muted-foreground">{windowLabel}</span>
        <Badge
          variant="outline"
          className={hasDelta ? "h-6 border-transparent px-2 text-xs shadow-none" : "h-6 px-2 text-xs"}
          style={deltaStyle}
        >
          {formatTrendDeltaWithPercent(emptyPaidEpisodes ? { ...metric, emptyPaidEpisodes } : metric)}
        </Badge>
      </div>
    </div>
  );
}

export function RankTrendButton({ className = "", ...props }) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="xs"
      className={`${trendActionButtonClassName} ${className}`.trim()}
      {...props}
    >
      <TrendingUpIcon data-icon="inline-start" />
      趋势
    </Button>
  );
}

export function RankTrendDialog({ open, onOpenChange, item, platform, trendState }) {
  const [selectedWindow, setSelectedWindow] = useState("3d");
  const data = trendState.data;
  const windows = data?.windows || {};
  const metaTags = getTrendMetaTags(item, platform);
  const latestRankHistory = Array.isArray(data?.rankHistory) ? data.rankHistory.at(-1) : null;
  const availableWindows = ["3d", "7d", "30d"].filter((key) => windows[key]);
  const activeWindowKey = availableWindows.includes(selectedWindow)
    ? selectedWindow
    : availableWindows[0] || "3d";
  const activeWindow = windows[activeWindowKey];
  const activeMetrics = getDisplayTrendMetrics(activeWindow?.metrics, platform);
  const chartMetrics = getChartTrendMetrics(activeMetrics);

  useEffect(() => {
    if (open) {
      setSelectedWindow("3d");
    }
  }, [open, item?.id]);

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
          </div>
          <AlertDialogDescription className="flex items-center gap-1 text-left text-xs">
            <HashIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="break-all">{item?.id ?? data?.id}</span>
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
            <Tabs value={activeWindowKey} onValueChange={setSelectedWindow}>
              <TabsList className="grid h-8 w-full grid-cols-3 p-1">
                {availableWindows.map((key) => (
                  <TabsTrigger key={key} className="h-6 min-w-0 px-2 text-[12px]" value={key}>
                    {windows[key].label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            {activeWindow ? (
              <div className="grid min-w-0 gap-2.5">
                <div className="text-xs leading-5 text-muted-foreground">
                  {formatTrendDate(activeWindow.fromDate)} → {formatTrendDate(activeWindow.toDate)}
                  {activeWindow.insufficientData ? "，数据不足" : ""}
                </div>
                {latestRankHistory?.ranks?.length ? (
                  <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                    {latestRankHistory.ranks.map((rank) => (
                      <Badge key={`${latestRankHistory.date}-${rank.key}`} variant="outline">
                        {rank.name} #{rank.position}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                <RankTrendLineChart metrics={chartMetrics} />
                <TrendSnapshotDetails metrics={activeMetrics} platform={platform} />
                <div className="grid gap-1.5">
                  {activeMetrics.map((metric) => (
                    <TrendMetricRow
                      key={`${activeWindow.key}-${metric.key}`}
                      metric={metric}
                      windowLabel={activeWindow.label}
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
