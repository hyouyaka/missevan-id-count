import { useEffect, useMemo, useRef, useState } from "react";
import {
  BeanIcon,
  CoinsIcon,
  GemIcon,
  HashIcon,
  HeartIcon,
  MicIcon,
  PlayCircleIcon,
  RefreshCwIcon,
  ShoppingCartIcon,
  StarIcon,
  TrophyIcon,
  UsersRoundIcon,
  XIcon,
} from "lucide-react";

import { buildVersionedUrl, formatPlainNumber, getBackendVersionFromResponse } from "@/app/app-utils";
import {
  canShowRankTrend,
  fetchRankTrendData as fetchSharedRankTrendData,
  logRankTrendOpen,
  rankTrendTagVariants,
  RankTrendButton,
  RankTrendDialog as SharedRankTrendDialog,
} from "@/app/rankTrendUi";
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
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

function buildProxyImageUrl(url) {
  return url ? `/image-proxy?url=${encodeURIComponent(url)}` : "";
}

const RANKS_CLIENT_CACHE_TTL_MS = 30 * 60 * 1000;
const RANKS_EXPECTED_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;
const ranksClientCache = {
  data: null,
  loadedAt: 0,
  frontendVersion: "",
  promise: null,
};
const RANK_TREND_CLIENT_SCHEMA_VERSION = 4;
const rankTrendClientCache = new Map();
function formatRankUpdatedAt(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "未知";
  }

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return normalized;
  }

  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .formatToParts(date)
    .reduce((map, part) => {
      map[part.type] = part.value;
      return map;
    }, {});

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function formatRankUpdatedDate(value) {
  const formatted = formatRankUpdatedAt(value);
  return formatted === "未知" ? "" : formatted.slice(0, 10);
}

function isRanksClientCacheFresh(frontendVersion) {
  const normalizedVersion = String(frontendVersion ?? "").trim();
  if (!ranksClientCache.data || ranksClientCache.frontendVersion !== normalizedVersion) {
    return false;
  }
  const now = Date.now();
  if (now - ranksClientCache.loadedAt >= RANKS_CLIENT_CACHE_TTL_MS) {
    return false;
  }

  const updatedAtMs = Date.parse(ranksClientCache.data?.data?.updatedAt || "");
  if (Number.isFinite(updatedAtMs) && now >= updatedAtMs + RANKS_EXPECTED_REFRESH_INTERVAL_MS) {
    return false;
  }

  return true;
}

function getTitleClassName(title) {
  const length = String(title ?? "").trim().length;
  if (length >= 34) {
    return "text-sm font-semibold leading-5 sm:text-[15px]";
  }
  if (length >= 22) {
    return "text-[15px] font-semibold leading-5 sm:text-base";
  }
  return "text-base font-semibold leading-6 sm:text-lg";
}

const metricLegendItems = [
  { label: "播放", icon: PlayCircleIcon },
  { label: "追剧", icon: HeartIcon },
  { label: "收藏", icon: StarIcon },
  { label: "打赏人数", icon: GemIcon },
  { label: "打赏榜总和", icon: CoinsIcon },
  { label: "付费集弹幕ID数", icon: UsersRoundIcon },
  { label: "投喂", icon: BeanIcon },
  { label: "购买人数/收听人数", icon: ShoppingCartIcon },
  { label: "排行值", icon: TrophyIcon },
];

const metricIconMap = {
  总播放量: PlayCircleIcon,
  播放量: PlayCircleIcon,
  追剧数: HeartIcon,
  追剧人数: HeartIcon,
  收藏数: StarIcon,
  打赏人数: GemIcon,
  打赏榜总和: CoinsIcon,
  付费集弹幕ID数: UsersRoundIcon,
  弹幕ID数: UsersRoundIcon,
  投喂总数: BeanIcon,
  "购买人数/收听人数": ShoppingCartIcon,
  收听人数: ShoppingCartIcon,
  排行值: TrophyIcon,
};

function MetricIcon({ label, className = "size-3.5" }) {
  const Icon = metricIconMap[label] || PlayCircleIcon;
  return <Icon aria-hidden="true" className={className} />;
}

function MetricLegend() {
  return (
    <div
      aria-label="榜单图标图例"
      className="rounded-lg border border-border/75 bg-card/96 px-3 py-2 shadow-[0_18px_38px_-34px_rgba(15,23,42,0.28)]"
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.68rem] leading-5 text-muted-foreground">
        {metricLegendItems.map((item) => {
          const Icon = item.icon;
          return (
            <span key={item.label} className="inline-flex min-w-fit items-center gap-1">
              <Icon aria-hidden="true" className="size-3.5 text-foreground/74" />
              <span>{item.label}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

const rankTagVariants = {
  猫耳: rankTrendTagVariants.猫耳,
  漫播: rankTrendTagVariants.漫播,
  免费: "free",
  会员: "member",
  付费: "paid",
  广播剧: "radioDrama",
  有声剧: "audioDrama",
  有声漫: "audioComic",
};

const metaBadgeClassName = "h-[1.05rem] px-1.5 text-[0.6rem] leading-none";
const mobileInlineBadgeClassName = `${metaBadgeClassName} ml-1 -translate-y-px align-middle`;
const coverPaymentBadgeClassName =
  "absolute bottom-0 right-0 h-4 rounded-none rounded-tl-[calc(var(--radius)-0.18rem)] border-0! px-1 text-[0.54rem] leading-none shadow-none! lg:h-[1.05rem] lg:px-1.5 lg:text-[0.58rem]";
const metaIconClassName = "size-3.5 shrink-0 text-muted-foreground";

function getRankPaymentTag(item) {
  if (item?.is_member) {
    return "会员";
  }
  return String(item?.payment_label ?? "").trim();
}

function getRankTitleTags(item) {
  return [item?.content_type_label || item?.catalogName || item?.catalog_name]
    .map((label) => String(label ?? "").trim())
    .map((label) => (label === "有声书" ? "有声剧" : label))
    .filter(Boolean);
}

function getRankMetrics(platform, item, rankKey = "") {
  const metrics = [
    {
      label: "总播放量",
      value: formatPlainNumber(item.view_count),
    },
  ];

  if (platform === "missevan") {
    if (item.type !== "peak" && item.subscription_num != null) {
      metrics.push({ label: "追剧数", value: formatPlainNumber(item.subscription_num) });
    }
    if (item.type !== "peak" && item.reward_num != null) {
      metrics.push({ label: "打赏人数", value: formatPlainNumber(item.reward_num) });
    }
    if (item.type !== "peak" && item.reward_total != null) {
      metrics.push({ label: "打赏榜总和", value: formatPlainNumber(item.reward_total) });
    }
    if (item.type !== "peak" && item.danmaku_uid_count != null) {
      metrics.push({ label: "付费集弹幕ID数", value: formatPlainNumber(item.danmaku_uid_count) });
    }
    return metrics;
  }

  if (item.subscription_num != null) {
    metrics.push({ label: "收藏数", value: formatPlainNumber(item.subscription_num) });
  }
  if (item.diamond_value != null) {
    metrics.push({ label: "投喂总数", value: formatPlainNumber(item.diamond_value) });
  }
  if (rankKey !== "peak" && item.danmaku_uid_count != null) {
    metrics.push({ label: "付费集弹幕ID数", value: formatPlainNumber(item.danmaku_uid_count) });
  }
  if (Number(item.pay_count) > 0) {
    metrics.push({ label: "购买人数/收听人数", value: formatPlainNumber(item.pay_count) });
  }
  if (item.rank_value != null && !(platform === "manbo" && rankKey === "peak")) {
    metrics.push({
      label: item.rank_value_label || "排行值",
      iconLabel: "排行值",
      value: formatPlainNumber(item.rank_value),
    });
  }
  return metrics;
}

function RankItemCard({ item, platform, rankKey = "", frontendVersion = "0.0.0", handleVersionResponse }) {
  const coverUrl = buildProxyImageUrl(item.cover);
  const metrics = getRankMetrics(platform, item, rankKey);
  const isMissevanPeak = platform === "missevan" && item.type === "peak";
  const dramaIdText = Array.isArray(item.drama_ids) && item.drama_ids.length ? item.drama_ids.join("，") : "";
  const recentUpdatedDate = isMissevanPeak ? "" : formatRankUpdatedDate(item.updated_at);
  const paymentTag = getRankPaymentTag(item);
  const titleTags = getRankTitleTags(item);
  const detailIdText = isMissevanPeak ? dramaIdText : item.id;
  const mainCvText = String(item.main_cv_text ?? "").replace(/^主要CV：/, "");
  const peakPlayMetric = isMissevanPeak
    ? { label: "系列总播放量", iconLabel: "总播放量", value: formatPlainNumber(item.view_count) }
    : null;
  const displayMetrics = isMissevanPeak ? [] : metrics;
  const canShowTrend = canShowRankTrend({ platform, rankKey, item, isMissevanPeak, detailIdText });
  const [isTrendOpen, setIsTrendOpen] = useState(false);
  const [trendState, setTrendState] = useState({
    isLoading: false,
    error: "",
    data: null,
  });

  async function openTrendDialog() {
    if (!canShowTrend) {
      return;
    }
    setIsTrendOpen(true);
    logRankTrendOpen({
      platform,
      id: detailIdText,
      name: item.name,
      source: "ranks",
      rankKey,
      frontendVersion,
    });
    setTrendState((current) => ({
      ...current,
      isLoading: !current.data,
      error: "",
    }));
    try {
      const { response, data } = await fetchSharedRankTrendData({
        platform,
        id: detailIdText,
        frontendVersion,
      });
      handleVersionResponse?.({
        ...data,
        backendVersion: getBackendVersionFromResponse(response, data),
        frontendVersion,
      });
      if (!response.ok || !data?.success) {
        setTrendState({
          isLoading: false,
          error: data?.message || "趋势数据暂不可用。",
          data: null,
        });
        return;
      }
      setTrendState({
        isLoading: false,
        error: "",
        data,
      });
    } catch (error) {
      console.error("Failed to load rank trend", error);
      setTrendState({
        isLoading: false,
        error: "趋势数据暂不可用。",
        data: null,
      });
    }
  }

  return (
    <Card className="border-border/75 bg-card py-3 shadow-[0_18px_36px_-32px_rgba(15,23,42,0.18)]">
      <CardContent className="px-3.5">
        <div className="flex gap-3">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background text-xs font-semibold tabular-nums text-foreground">
            {item.rank}
          </div>
          <div className="relative size-20 shrink-0 overflow-hidden rounded-[calc(var(--radius)-0.05rem)] border border-border/70 bg-muted/50 lg:size-[6rem]">
            {coverUrl ? (
              <img alt={item.name} className="aspect-square size-20 object-cover lg:size-[6rem]" src={coverUrl} />
            ) : (
              <div className="flex aspect-square size-20 items-center justify-center text-xs text-muted-foreground lg:size-[6rem]">
                暂无封面
              </div>
            )}
            {paymentTag ? (
              <Badge variant={rankTagVariants[paymentTag] || "outline"} className={coverPaymentBadgeClassName}>
                {paymentTag}
              </Badge>
            ) : null}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="hidden min-w-0 flex-wrap items-center gap-1.5 lg:flex">
              <span className={`min-w-0 break-words ${getTitleClassName(item.name)}`}>{item.name}</span>
              {titleTags.map((label) => (
                <Badge key={`${item.rank}-${item.id || item.name}-desktop-${label}`} variant={rankTagVariants[label] || "outline"} className={metaBadgeClassName}>
                  {label}
                </Badge>
              ))}
            </div>
            <div className="min-w-0 lg:hidden">
              <span className={`break-words ${getTitleClassName(item.name)}`}>{item.name}</span>
              {titleTags.map((label) => (
                <Badge key={`${item.rank}-${item.id || item.name}-${label}`} variant={rankTagVariants[label] || "outline"} className={mobileInlineBadgeClassName}>
                  {label}
                </Badge>
              ))}
            </div>
            {detailIdText ? (
              <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <HashIcon aria-label={isMissevanPeak ? "包含作品ID" : "作品ID"} className={metaIconClassName} title={isMissevanPeak ? "包含作品ID" : "作品ID"} />
                <span className="min-w-0 break-all">{detailIdText}</span>
              </div>
            ) : null}
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <MicIcon aria-label="主要CV" className={metaIconClassName} title="主要CV" />
              <span className="min-w-0 break-words">{mainCvText || "暂无"}</span>
            </div>
            {peakPlayMetric ? (
              <div
                aria-label={`${peakPlayMetric.label}: ${peakPlayMetric.value}`}
                title={`${peakPlayMetric.label}: ${peakPlayMetric.value}`}
                className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
              >
                <MetricIcon label={peakPlayMetric.iconLabel} className={metaIconClassName} />
                <span className="min-w-0 break-all font-medium tabular-nums text-foreground">{peakPlayMetric.value}</span>
              </div>
            ) : null}
            {recentUpdatedDate ? (
              <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <RefreshCwIcon aria-label="最近更新" className={metaIconClassName} title="最近更新" />
                <span className="min-w-0 break-all">{recentUpdatedDate}</span>
              </div>
            ) : null}
          </div>
        </div>

        {displayMetrics.length || canShowTrend ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm lg:ml-10">
            {displayMetrics.map((metric) => (
                <div
                  key={`${item.id}-${metric.label}`}
                  aria-label={`${metric.label}: ${metric.value}`}
                  title={`${metric.label}: ${metric.value}`}
                  className="max-w-full text-foreground"
                >
                  <span className="flex max-w-full items-center gap-1">
                    <MetricIcon label={metric.iconLabel || metric.label} className="size-3.5 shrink-0 text-muted-foreground" />
                    {metric.iconLabel === "排行值" && metric.label !== "排行值" ? (
                      <span className="shrink-0 text-[0.68rem] text-muted-foreground">{metric.label}</span>
                    ) : null}
                    <span className="max-w-full break-all text-[0.74rem] font-medium tabular-nums sm:text-sm">{metric.value}</span>
                  </span>
                </div>
              ))}
            {canShowTrend ? (
              <RankTrendButton
                onClick={openTrendDialog}
                aria-label={`查看${item.name}趋势`}
                title="查看趋势"
              />
            ) : null}
          </div>
        ) : null}
        {canShowTrend ? (
          <SharedRankTrendDialog
            open={isTrendOpen}
            onOpenChange={setIsTrendOpen}
            item={item}
            platform={platform}
            trendState={trendState}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function RankColumn({ rank, platform, frontendVersion = "0.0.0", handleVersionResponse }) {
  return (
    <section className="min-w-0 rounded-lg border border-border/80 bg-background/76 p-3 shadow-[0_20px_46px_-38px_rgba(15,23,42,0.26)]">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold leading-6">{rank.name}</h2>
          <div className="text-xs text-muted-foreground">{rank.items.length} 项</div>
        </div>
        {rank.fetchedAt ? <div className="text-xs text-muted-foreground">更新：{formatRankUpdatedAt(rank.fetchedAt)}</div> : null}
      </div>
      {rank.items.length ? (
        <div className="grid gap-3">
          {rank.items.map((item) => (
            <RankItemCard
              key={`${rank.key}-${item.rank}-${item.id}`}
              item={item}
              platform={platform}
              rankKey={rank.key}
              frontendVersion={frontendVersion}
              handleVersionResponse={handleVersionResponse}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border/80 bg-muted/30 px-5 py-8 text-center text-sm text-muted-foreground">
          该榜单暂无数据
        </div>
      )}
    </section>
  );
}

function getPlatformData(data, platform) {
  return data?.platforms?.[platform] || null;
}

function getFirstCategory(platformData) {
  return platformData?.categories?.[0] || null;
}

function getCategory(platformData, categoryKey) {
  return platformData?.categories?.find((category) => category.key === categoryKey) || getFirstCategory(platformData);
}

function getRank(category, rankKey) {
  return category?.ranks?.find((rank) => rank.key === rankKey) || category?.ranks?.[0] || null;
}

async function fetchRanksData(frontendVersion) {
  const normalizedVersion = String(frontendVersion ?? "").trim();
  if (isRanksClientCacheFresh(frontendVersion)) {
    return ranksClientCache.data;
  }

  if (ranksClientCache.promise && ranksClientCache.frontendVersion === normalizedVersion) {
    return ranksClientCache.promise;
  }

  ranksClientCache.frontendVersion = normalizedVersion;
  ranksClientCache.promise = (async () => {
    try {
      const response = await fetch(buildVersionedUrl("/ranks", frontendVersion), {
        cache: "no-cache",
      });
      const data = await response.json();
      const payload = {
        response,
        data,
      };
      if (response.ok && data?.success) {
        ranksClientCache.data = payload;
        ranksClientCache.loadedAt = Date.now();
      }
      return payload;
    } finally {
      ranksClientCache.promise = null;
    }
  })();

  return ranksClientCache.promise;
}

async function fetchRankTrendData({ platform, id, frontendVersion }) {
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
      const payload = {
        response,
        data,
      };
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

function getTrendMetaTags(item, platform) {
  const platformLabel = platform === "missevan" ? "猫耳" : "漫播";
  return [platformLabel, getRankPaymentTag(item), ...getRankTitleTags(item)]
    .map((label) => String(label ?? "").trim())
    .filter(Boolean);
}

function getTrendPointPosition(point, index, points, minValue, maxValue) {
  const width = 320;
  const height = 170;
  const left = 18;
  const right = 18;
  const top = 20;
  const bottom = 30;
  const value = getTrendNumber(point.value);
  const x = points.length <= 1 ? width / 2 : left + (index / (points.length - 1)) * (width - left - right);
  const range = maxValue - minValue;
  const normalized = range === 0 || value == null ? 0.5 : (value - minValue) / range;
  const y = top + (1 - normalized) * (height - top - bottom);
  return { x, y };
}

function clampTrendY(value) {
  return Math.min(144, Math.max(18, value));
}

function clampTrendX(value) {
  return Math.min(304, Math.max(16, value));
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

function buildTrendPolyline(metric) {
  const points = Array.isArray(metric?.history) ? metric.history : [];
  const values = points
    .map((point) => getTrendNumber(point.value))
    .filter((value) => value != null);
  if (values.length < 2) {
    return null;
  }

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const positions = points.map((point, index) =>
    getTrendPointPosition(point, index, points, minValue, maxValue)
  );
  const segment = points
    .map((point, index) => ({ point, position: positions[index] }))
    .filter(({ point }) => getTrendNumber(point.value) != null);

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
  const signatureCounts = new Map();
  return metrics
    .map((metric) => {
      const line = buildTrendPolyline(metric);
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
}

function RankTrendLineChart({ metrics }) {
  const availableMetrics = Array.isArray(metrics) ? metrics : [];
  const chartLines = buildTrendChartLines(availableMetrics);
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
          {[35, 65, 95, 125].map((y) => (
            <line
              key={y}
              x1="18"
              x2="302"
              y1={y}
              y2={y}
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

function TrendMetricRow({ metric }) {
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
            当前：<span className="tabular-nums text-foreground">{formatTrendValue(metric.toValue)}</span>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-end pl-2">
        <Badge
          variant={hasDelta ? "outline" : "outline"}
          className={hasDelta ? "h-6 border-transparent px-2 text-xs shadow-none" : "h-6 px-2 text-xs"}
          style={deltaStyle}
        >
          {formatTrendDelta(emptyPaidEpisodes ? { ...metric, emptyPaidEpisodes } : metric)}
        </Badge>
      </div>
    </div>
  );
}

function RankTrendDialog({ open, onOpenChange, item, platform, trendState }) {
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
                variant={rankTagVariants[label] || "outline"}
                className={metaBadgeClassName}
              >
                {label}
              </Badge>
            ))}
          </div>
          <AlertDialogDescription className="flex items-center gap-1 text-left text-xs">
            <HashIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="break-all">{item?.id}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {trendState.isLoading ? (
          <Alert>
            <RefreshCwIcon className="size-4 animate-spin" />
            <AlertTitle>正在读取趋势</AlertTitle>
            <AlertDescription>正在从榜单快照中计算指标变化。</AlertDescription>
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
                <div className="grid gap-1.5">
                  {activeMetrics.map((metric) => (
                    <TrendMetricRow key={`${activeWindow.key}-${metric.key}`} metric={metric} />
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

export function RanksPanel({ frontendVersion = "0.0.0", handleVersionResponse }) {
  const [rankData, setRankData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedPlatform, setSelectedPlatform] = useState("missevan");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedRank, setSelectedRank] = useState("");
  const loggedRanksRef = useRef(new Set());

  useEffect(() => {
    let cancelled = false;

    async function loadRanks() {
      setIsLoading(true);
      setErrorMessage("");
      try {
        const { response, data } = await fetchRanksData(frontendVersion);
        handleVersionResponse?.({
          ...data,
          backendVersion: getBackendVersionFromResponse(response, data),
          frontendVersion,
        });
        if (cancelled) {
          return;
        }
        if (!response.ok || !data?.success) {
          setRankData(null);
          setErrorMessage("Ranks 暂不可用，请稍后重试。");
          return;
        }
        setRankData(data);
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load ranks", error);
          setRankData(null);
          setErrorMessage("Ranks 暂不可用，请稍后重试。");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadRanks();
    return () => {
      cancelled = true;
    };
  }, [frontendVersion]);

  const platformData = getPlatformData(rankData, selectedPlatform);
  const category = getCategory(platformData, selectedCategory);
  const activeRank = getRank(category, selectedRank);
  const availablePlatforms = useMemo(() => {
    return ["missevan", "manbo"]
      .map((platform) => getPlatformData(rankData, platform))
      .filter((platform) => platform?.categories?.length);
  }, [rankData]);

  useEffect(() => {
    if (!availablePlatforms.length) {
      return;
    }

    if (!availablePlatforms.some((platform) => platform.key === selectedPlatform)) {
      setSelectedPlatform(availablePlatforms[0].key);
    }
  }, [availablePlatforms, selectedPlatform]);

  useEffect(() => {
    if (!platformData?.categories?.length) {
      return;
    }

    const nextCategory = getCategory(platformData, selectedCategory);
    if (nextCategory?.key && nextCategory.key !== selectedCategory) {
      setSelectedCategory(nextCategory.key);
      setSelectedRank(nextCategory.ranks?.[0]?.key || "");
      return;
    }

    const nextRank = getRank(nextCategory, selectedRank);
    if (nextRank?.key && nextRank.key !== selectedRank) {
      setSelectedRank(nextRank.key);
    }
  }, [platformData, selectedCategory, selectedRank]);

  useEffect(() => {
    if (isLoading || errorMessage || !category?.key || !category?.label) {
      return;
    }

    const logKey = `${selectedPlatform}:${category.key}`;
    if (loggedRanksRef.current.has(logKey)) {
      return;
    }
    loggedRanksRef.current.add(logKey);

    fetch(buildVersionedUrl("/usage-log", frontendVersion), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: selectedPlatform,
        action: "ranks",
        keyword: category.label,
        success: true,
      }),
    }).catch((error) => {
      console.error("Failed to log ranks view", error);
    });
  }, [category?.key, category?.label, errorMessage, frontendVersion, isLoading, selectedPlatform]);

  function updatePlatform(platform) {
    const nextPlatform = getPlatformData(rankData, platform);
    const nextCategory = getFirstCategory(nextPlatform);
    setSelectedPlatform(platform);
    setSelectedCategory(nextCategory?.key || "");
    setSelectedRank(nextCategory?.ranks?.[0]?.key || "");
  }

  function updateCategory(categoryKey) {
    const nextCategory = getCategory(platformData, categoryKey);
    setSelectedCategory(nextCategory?.key || "");
    setSelectedRank(nextCategory?.ranks?.[0]?.key || "");
  }

  const hasRanks = availablePlatforms.length > 0;

  return (
    <div className="grid gap-4 sm:gap-5">
      <div className="px-1 text-sm leading-6 text-muted-foreground">
        同步猫耳和漫播榜单，每日更新。此次榜单刷新于：{formatRankUpdatedAt(rankData?.updatedAt)}（北京时间）
      </div>

      {isLoading ? (
        <Alert>
          <RefreshCwIcon className="size-4 animate-spin" />
          <AlertTitle>正在读取榜单</AlertTitle>
          <AlertDescription>榜单数据加载中。</AlertDescription>
        </Alert>
      ) : null}

      {!isLoading && errorMessage ? (
        <Alert className="border-destructive/30 bg-destructive/10">
          <AlertTitle>Ranks 暂不可用</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {!isLoading && !errorMessage && !hasRanks ? (
        <div className="rounded-lg border border-dashed border-border/80 bg-muted/30 px-6 py-10 text-center">
          <div className="text-base font-semibold">还没有榜单数据</div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">请稍后重试。</p>
        </div>
      ) : null}

      {!isLoading && !errorMessage && hasRanks ? (
        <>
          <div className="grid gap-3">
            <MetricLegend />
            <Tabs value={selectedPlatform} onValueChange={updatePlatform}>
              <TabsList className="inline-flex w-full justify-start overflow-x-auto sm:w-fit">
                {availablePlatforms.map((platform) => (
                  <TabsTrigger key={platform.key} className="px-3" value={platform.key}>
                    {platform.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            {platformData?.categories?.length ? (
              <Tabs value={category?.key || ""} onValueChange={updateCategory}>
                <TabsList className="inline-flex w-full justify-start overflow-x-auto sm:w-fit">
                  {platformData.categories.map((item) => (
                    <TabsTrigger key={item.key} className="px-3" value={item.key}>
                      {item.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            ) : null}
            {category?.ranks?.length > 1 ? (
              <Tabs value={activeRank?.key || ""} onValueChange={setSelectedRank}>
                <TabsList className="inline-flex w-full justify-start overflow-x-auto sm:w-fit lg:hidden">
                  {category.ranks.map((rank) => (
                    <TabsTrigger key={rank.key} className="px-3" value={rank.key}>
                      {rank.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            ) : null}
          </div>

          <div className="hidden gap-3 lg:grid lg:grid-cols-[repeat(auto-fit,minmax(21rem,1fr))]">
            {(category?.ranks || []).map((rank) => (
              <RankColumn
                key={rank.key}
                platform={selectedPlatform}
                rank={rank}
                frontendVersion={frontendVersion}
                handleVersionResponse={handleVersionResponse}
              />
            ))}
          </div>

          <div className="grid gap-3 lg:hidden">
            {activeRank ? (
              <RankColumn
                platform={selectedPlatform}
                rank={activeRank}
                frontendVersion={frontendVersion}
                handleVersionResponse={handleVersionResponse}
              />
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
