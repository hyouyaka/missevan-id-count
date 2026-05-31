import { useEffect, useRef, useState } from "react";
import {
  BeanIcon,
  CheckIcon,
  ChevronDownIcon,
  CoinsIcon,
  GemIcon,
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

import { buildVersionedUrl, formatDeviceDateTime, formatPlainNumber } from "@/app/app-utils";
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

export const RANK_TREND_CLIENT_SCHEMA_VERSION = 4;
export const ONGOING_TREND_LOOKUP_SCHEMA_VERSION = 3;
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
const ongoingTrendLookupCache = new Map();
const ONGOING_TREND_LOOKUP_TTL_MS = 5 * 60 * 1000;

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

function formatTrendSnapshotValue(value) {
  return value == null ? "无数据" : formatTrendValue(value);
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

export async function fetchRankTrendData({ platform, id, frontendVersion }) {
  const normalizedPlatform = String(platform ?? "").trim();
  const normalizedId = String(id ?? "").trim();
  const normalizedVersion = String(frontendVersion ?? "").trim();
  const cacheKey = `${RANK_TREND_CLIENT_SCHEMA_VERSION}:${normalizedVersion}:${normalizedPlatform}:${normalizedId}`;
  const cached = rankTrendClientCache.get(cacheKey);
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
        cache: "no-store",
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

export async function fetchOngoingTrendLookupData({ platform, frontendVersion } = {}) {
  const normalizedPlatform = String(platform ?? "").trim();
  if (normalizedPlatform !== "missevan" && normalizedPlatform !== "manbo") {
    return { response: { ok: false }, data: null };
  }

  const normalizedVersion = String(frontendVersion ?? "").trim();
  const cacheKey = `${ONGOING_TREND_LOOKUP_SCHEMA_VERSION}:${normalizedVersion}:${normalizedPlatform}`;
  const now = Date.now();
  const cached = ongoingTrendLookupCache.get(cacheKey);
  if (cached?.data && now - cached.loadedAt < ONGOING_TREND_LOOKUP_TTL_MS) {
    return cached.data;
  }
  if (cached?.promise) {
    return cached.promise;
  }

  const params = new URLSearchParams({
    platform: normalizedPlatform,
    schema: String(ONGOING_TREND_LOOKUP_SCHEMA_VERSION),
    _: String(Date.now()),
  });
  const promise = (async () => {
    try {
      const response = await fetch(buildVersionedUrl(`/ongoing?${params.toString()}`, frontendVersion), {
        cache: "no-store",
      });
      const data = await response.json();
      const payload = { response, data };
      if (response.ok && data?.success) {
        ongoingTrendLookupCache.set(cacheKey, {
          data: payload,
          loadedAt: Date.now(),
          promise: null,
        });
      }
      return payload;
    } finally {
      const current = ongoingTrendLookupCache.get(cacheKey);
      if (current?.promise === promise) {
        ongoingTrendLookupCache.set(cacheKey, {
          data: current.data || null,
          loadedAt: current.loadedAt || 0,
          promise: null,
        });
      }
    }
  })();

  ongoingTrendLookupCache.set(cacheKey, {
    data: cached?.data || null,
    loadedAt: cached?.loadedAt || 0,
    promise,
  });
  return promise;
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

export function buildOngoingTrendEligibleIdSet(ongoingPayload) {
  const idSet = new Set();
  const items = Array.isArray(ongoingPayload?.items)
    ? ongoingPayload.items
    : Array.isArray(ongoingPayload?.data?.items)
      ? ongoingPayload.data.items
      : [];
  items.forEach((item) => {
    const id = getRankItemId(item);
    if (id) {
      idSet.add(id);
    }
  });
  return idSet;
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
  const platformLabel = platform === "missevan" ? "猫耳" : "漫播";
  return [...new Set([platformLabel, getGenericPaymentTag(item, platform), ...getGenericTitleTags(item)]
    .map((label) => String(label ?? "").trim())
    .filter(Boolean))];
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

function getTrendPointPosition(point, index, points, minValue, maxValue, valueKey = "percent") {
  const width = 320;
  const height = 170;
  const left = 44;
  const right = 18;
  const top = 20;
  const bottom = 30;
  const x = points.length <= 1 ? width / 2 : left + (index / (points.length - 1)) * (width - left - right);
  const range = maxValue - minValue;
  const normalized = range === 0 ? 0.5 : (Number(point[valueKey]) - minValue) / range;
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
  const isPaidIdMetric = metric?.key === "danmaku_uid_count";
  const basePoint = isPaidIdMetric
    ? history.find((point) => {
        const value = getTrendNumber(point.value);
        return value != null && value > 0;
      })
    : history.find((point) => getTrendNumber(point.value) != null);
  const baseValue = getTrendNumber(basePoint?.value);
  if (baseValue == null || baseValue === 0) {
    return [];
  }
  let hasReachedBasePoint = false;
  return history.map((point) => {
    const value = getTrendNumber(point.value);
    if (isPaidIdMetric) {
      hasReachedBasePoint = hasReachedBasePoint || point === basePoint;
      if (!hasReachedBasePoint || value == null) {
        return { ...point, percent: null };
      }
    }
    return {
      ...point,
      percent: value != null
        ? ((value - baseValue) / baseValue) * 100
        : null,
    };
  });
}

function isPeakSeriesChart(metrics) {
  return (
    Array.isArray(metrics) &&
    metrics.length === 1 &&
    metrics[0]?.key === "view_count" &&
    metrics[0]?.label === "系列总播放量"
  );
}

function buildTrendValuePoints(metric) {
  const history = Array.isArray(metric?.history) ? metric.history : [];
  return history.map((point) => {
    const value = getTrendNumber(point.value);
    return {
      ...point,
      axisValue: value == null ? null : value / 10000,
    };
  });
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

function buildTrendValueDomain(values) {
  if (!values.length) {
    return { min: 0, max: 1, step: 1 };
  }
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const spread = maxValue - minValue;
  const padding = spread === 0 ? Math.max(Math.abs(maxValue) * 0.001, 1) : spread * 0.15;
  const paddedMin = Math.max(0, minValue - padding);
  const paddedMax = maxValue + padding;
  const rawStep = (paddedMax - paddedMin || 1) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalizedStep = rawStep / magnitude;
  const stepMultiplier = normalizedStep <= 1 ? 1 : normalizedStep <= 2 ? 2 : normalizedStep <= 5 ? 5 : 10;
  const step = stepMultiplier * magnitude;
  let min = Math.floor(paddedMin / step) * step;
  let max = Math.ceil(paddedMax / step) * step;
  if (min === max) {
    max = min + step;
  }
  return {
    min: Number(min.toFixed(4)),
    max: Number(max.toFixed(4)),
    step,
  };
}

function buildTrendValueTicks(domain) {
  const ticks = [];
  const step = domain.step || 1;
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

function getTrendAxisY(value, domain) {
  const top = 20;
  const bottom = 30;
  const height = 170;
  const range = domain.max - domain.min || 1;
  return top + (1 - (value - domain.min) / range) * (height - top - bottom);
}

function buildTrendPolyline(metric, domain, { pointBuilder = buildTrendPercentPoints, valueKey = "percent" } = {}) {
  const points = pointBuilder(metric);
  const validPointCount = points.filter((point) => getTrendNumber(point[valueKey]) != null).length;
  if (validPointCount < 2) {
    return null;
  }

  const positions = points.map((point, index) =>
    getTrendPointPosition(point, index, points, domain.min, domain.max, valueKey)
  );
  const segment = points
    .map((point, index) => ({ point, position: positions[index] }))
    .filter(({ point }) => getTrendNumber(point[valueKey]) != null);

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
  const useValueAxis = isPeakSeriesChart(metrics);
  const pointBuilder = useValueAxis ? buildTrendValuePoints : buildTrendPercentPoints;
  const valueKey = useValueAxis ? "axisValue" : "percent";
  const axisValues = metrics
    .flatMap((metric) => pointBuilder(metric))
    .map((point) => point[valueKey])
    .filter((value) => Number.isFinite(value));
  const domain = useValueAxis ? buildTrendValueDomain(axisValues) : buildTrendPercentDomain(axisValues);
  const ticks = useValueAxis ? buildTrendValueTicks(domain) : buildTrendPercentTicks(domain);
  const signatureCounts = new Map();
  const lines = metrics
    .map((metric) => {
      const line = buildTrendPolyline(metric, domain, { pointBuilder, valueKey });
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
  return {
    lines,
    domain,
    ticks,
    formatTick: useValueAxis ? formatAxisWan : formatAxisPercent,
  };
}

function getTrendAxisLabelPoints(points, windowKey) {
  const axisPoints = Array.isArray(points) ? points : [];
  if (windowKey !== "30d") {
    return axisPoints;
  }

  const lastIndex = axisPoints.length - 1;
  return axisPoints.filter((point, index) => index % 5 === 0 || index === lastIndex);
}

function clampTrendTooltipPercent(value) {
  return Math.min(92, Math.max(8, value));
}

function TrendMetricToggleLegend({ metrics, visibleMetricKeys, onToggleMetric }) {
  const legendMetrics = Array.isArray(metrics) ? metrics : [];
  if (!legendMetrics.length) {
    return null;
  }
  const visibleCurrentMetricCount = legendMetrics.filter((metric) => visibleMetricKeys.has(metric.key)).length;

  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
      {legendMetrics.map((metric) => {
        const style = getTrendMetricStyle(metric);
        const isChecked = visibleMetricKeys.has(metric.key);
        const isOnlyVisible = isChecked && visibleCurrentMetricCount <= 1;
        return (
          <label
            key={metric.key}
            className={`inline-flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-[0.7rem] font-medium text-foreground transition-colors ${
              isOnlyVisible ? "cursor-default" : "cursor-pointer hover:bg-muted/50"
            }`}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={isChecked}
              disabled={isOnlyVisible}
              aria-label={`显示${metric.label}曲线`}
              onChange={() => onToggleMetric?.(metric.key)}
            />
            <span
              aria-hidden="true"
              className="flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border transition-colors"
              style={{
                backgroundColor: isChecked ? style.color : "transparent",
                borderColor: style.color,
                color: "white",
              }}
            >
              {isChecked ? <CheckIcon className="size-2.5 stroke-[3]" /> : null}
            </span>
            <span className="min-w-0 truncate">{metric.label}</span>
          </label>
        );
      })}
    </div>
  );
}

function RankTrendLineChart({ metrics, legendMetrics = metrics, visibleMetricKeys = new Set(), onToggleMetric, windowKey }) {
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [selectedPoint, setSelectedPoint] = useState(null);
  const availableMetrics = Array.isArray(metrics) ? metrics : [];
  const availableLegendMetrics = Array.isArray(legendMetrics) ? legendMetrics : availableMetrics;
  const chartMetricSignature = availableMetrics
    .map((metric) => `${metric.key}:${(Array.isArray(metric.history) ? metric.history : []).map((point) => point.date).join(",")}`)
    .join("|");
  const chartData = buildTrendChartLines(availableMetrics);
  const chartLines = chartData.lines;
  const axisPoints =
    availableMetrics.find((metric) => Array.isArray(metric.history) && metric.history.length)?.history || [];
  const axisLabelPoints = getTrendAxisLabelPoints(axisPoints, windowKey);
  const activeTooltipPoint = selectedPoint || hoveredPoint;

  function buildTooltipPoint(line, point, position, style) {
    return {
      key: `${line.metric.key}-${point.date}`,
      date: formatTrendDate(point.date),
      value: formatTrendValue(point.value),
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
  }, [windowKey, chartMetricSignature]);

  return (
    <div className="rounded-lg border border-border/80 bg-background/82 p-2.5 shadow-[0_18px_38px_-34px_rgba(15,23,42,0.22)]">
      <TrendMetricToggleLegend
        metrics={availableLegendMetrics}
        visibleMetricKeys={visibleMetricKeys}
        onToggleMetric={onToggleMetric}
      />
      <div
        className="relative h-48 w-full overflow-hidden rounded-md bg-card sm:h-52"
        onClick={() => setSelectedPoint(null)}
        onPointerLeave={() => setHoveredPoint(null)}
      >
        <svg aria-label="趋势折线图" className="size-full" preserveAspectRatio="none" viewBox="0 0 320 170">
          {chartData.ticks.map((tick) => (
            <line
              key={tick}
              x1="44"
              x2="302"
              y1={getTrendAxisY(tick, chartData.domain)}
              y2={getTrendAxisY(tick, chartData.domain)}
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
          {chartData.ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-1 -translate-y-1/2 tabular-nums"
              style={{ top: `${(getTrendAxisY(tick, chartData.domain) / 170) * 100}%` }}
            >
              {chartData.formatTick(tick)}
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
        {chartLines.flatMap((line) => {
          const style = getTrendMetricStyle(line.metric);
          return line.segments.flatMap((segment) =>
            segment.map(({ point, position }) => {
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
            })
          );
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
            <div className="mt-0.5 tabular-nums">{activeTooltipPoint.value}</div>
          </div>
        ) : null}
        <div className="pointer-events-none absolute inset-x-3 bottom-2 flex justify-between text-[0.65rem] font-medium text-muted-foreground">
          {axisLabelPoints.map((point) => (
            <span key={point.date}>{formatTrendDate(point.date)}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function getSnapshotColumns(metrics, platform) {
  const metricMap = new Map((Array.isArray(metrics) ? metrics : []).map((metric) => [metric.key, metric]));
  const viewMetric = metricMap.get("view_count") || null;
  const isPeakSeriesTrend =
    metricMap.size === 1 &&
    viewMetric?.label === "系列总播放量";
  if (isPeakSeriesTrend) {
    return [
      { key: "date", label: "日期", metric: null },
      { key: "view_count", label: "系列总播放量", metric: viewMetric },
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
        className="flex h-9 w-full items-center justify-between gap-2 px-2.5 text-left text-sm! font-medium text-foreground"
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
                        {column.key === "date" ? formatTrendDate(row.date) : formatTrendSnapshotValue(row.values[column.key])}
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

function TrendMetricRow({ metric, windowLabel }) {
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
            今日：<span className="tabular-nums text-foreground">{formatTrendValue(metric.toValue)}</span>
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
  const [visibleMetricKeys, setVisibleMetricKeys] = useState(() => new Set());
  const knownMetricKeysRef = useRef(new Set());
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
  const activeWindowGeneratedAt = getTrendWindowGeneratedAt(activeWindow, activeMetrics);
  const chartMetrics = getChartTrendMetrics(activeMetrics);
  const chartMetricKeySignature = chartMetrics.map((metric) => metric.key).join("|");
  const visibleChartMetrics = visibleMetricKeys.size
    ? chartMetrics.filter((metric) => visibleMetricKeys.has(metric.key))
    : chartMetrics;
  const detailIdText = Array.isArray(data?.dramaIds) && data.dramaIds.length
    ? data.dramaIds.join("，")
    : item?.id ?? data?.id;

  function resetVisibleTrendMetrics() {
    setVisibleMetricKeys(new Set());
    knownMetricKeysRef.current = new Set();
  }

  useEffect(() => {
    if (open) {
      setSelectedWindow("3d");
      resetVisibleTrendMetrics();
    }
  }, [open, item?.id]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const chartMetricKeys = chartMetricKeySignature.split("|").filter(Boolean);
    if (!chartMetricKeys.length) {
      return;
    }
    const knownMetricKeys = knownMetricKeysRef.current;
    const newMetricKeys = chartMetricKeys.filter((key) => !knownMetricKeys.has(key));
    setVisibleMetricKeys((current) => {
      if (!knownMetricKeys.size) {
        return new Set(chartMetricKeys);
      }
      const next = new Set(current);
      newMetricKeys.forEach((key) => next.add(key));
      const hasVisibleCurrentMetric = chartMetricKeys.some((key) => next.has(key));
      if (!hasVisibleCurrentMetric) {
        next.add(chartMetricKeys[0]);
      }
      return next;
    });
    if (newMetricKeys.length) {
      const next = new Set(knownMetricKeys);
      newMetricKeys.forEach((key) => next.add(key));
      knownMetricKeysRef.current = next;
    }
  }, [open, chartMetricKeySignature]);

  function toggleVisibleMetric(metricKey) {
    setVisibleMetricKeys((current) => {
      const currentMetricKeys = chartMetrics.map((metric) => metric.key);
      const visibleCurrentMetricCount = currentMetricKeys.filter((key) => current.has(key)).length;
      if (current.has(metricKey) && currentMetricKeys.includes(metricKey) && visibleCurrentMetricCount <= 1) {
        return current;
      }
      const next = new Set(current);
      if (next.has(metricKey)) {
        next.delete(metricKey);
      } else {
        next.add(metricKey);
      }
      return next;
    });
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
          </div>
          <AlertDialogDescription
            className="flex w-full max-w-none justify-self-stretch items-start gap-1 text-left text-xs"
            style={{ textWrap: "wrap" }}
          >
            <PlatformIdIcon platform={platform} aria-label="作品ID" className="size-3.5 shrink-0" />
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
            <Tabs value={activeWindowKey} onValueChange={setSelectedWindow} className="w-fit">
              <TabsList className="inline-flex h-[34px] w-fit items-center justify-center gap-1 rounded-lg border border-border/70 bg-background/82 p-1 text-xs!">
                {availableWindows.map((key) => (
                  <TabsTrigger key={key} className="h-[26px] min-w-0 rounded-md px-3 text-xs!" value={key}>
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
                  {activeWindowGeneratedAt ? `，数据刷新于：${formatDeviceDateTime(activeWindowGeneratedAt)}` : ""}
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
                <RankTrendLineChart
                  metrics={visibleChartMetrics}
                  legendMetrics={chartMetrics}
                  visibleMetricKeys={visibleMetricKeys}
                  onToggleMetric={toggleVisibleMetric}
                  windowKey={activeWindowKey}
                />
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
