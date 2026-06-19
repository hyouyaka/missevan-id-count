import { useEffect, useMemo, useRef, useState } from "react";
import {
  BeanIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CoinsIcon,
  GemIcon,
  HeartIcon,
  MicIcon,
  PlayCircleIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  ShoppingCartIcon,
  StarIcon,
  TrophyIcon,
  UsersRoundIcon,
} from "lucide-react";

import {
  buildRankPlatformSwitchRoutePatch,
  buildVersionedUrl,
  formatDeviceDateTime,
  formatPlainNumber,
  formatRankCompactCount,
  getBackendVersionFromResponse,
  getInlineTaggedTitleDisplayText,
} from "@/app/app-utils";
import { PlatformIdIcon, PlatformTabLabel } from "@/app/platformTabLabel";
import { RankBadge } from "@/app/RankBadge";
import { fetchRanksData, getCachedRanksData } from "@/app/ranksData";
import {
  canShowRankTrend,
  CompareActionButton,
  fetchRankTrendData as fetchSharedRankTrendData,
  formatRankTrendCompactDelta,
  formatRankTrendDelta,
  logRankTrendOpen,
  rankTrendTagVariants,
  RankTrendDeltaBadge,
  RankTrendButton,
  RankTrendDialog as SharedRankTrendDialog,
} from "@/app/rankTrendUi";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

function buildProxyImageUrl(url) {
  return url ? `/image-proxy?url=${encodeURIComponent(url)}` : "";
}

const mobileRankTabClassName = "min-w-0 px-1.5 text-[12px]! leading-none";
const mobileMenuTabsListClassName =
  "grid w-full justify-stretch rounded-none border-0! bg-transparent! shadow-none!";

function getRankTabsGridStyle(count) {
  const columns = Math.max(1, Number(count) || 1);
  return { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` };
}

function formatMobileRankMenuLabel(label) {
  const normalized = String(label ?? "").trim();
  if (normalized === "会员剧") {
    return "会员";
  }
  if (normalized === "付费剧") {
    return "付费";
  }
  return normalized.replace(/榜$/, "");
}

function formatRankUpdatedAt(value) {
  return formatDeviceDateTime(value);
}

function formatRankUpdatedDate(value) {
  const formatted = formatRankUpdatedAt(value);
  return formatted === "未知" ? "" : formatted.slice(0, 10);
}

function getTitleClassName(title) {
  const length = String(title ?? "").trim().length;
  if (length >= 34) {
    return "text-sm! font-semibold! leading-5! sm:text-[15px]!";
  }
  if (length >= 22) {
    return "text-[15px]! font-semibold! leading-5! sm:text-base!";
  }
  return "text-base! font-semibold! leading-6! sm:text-lg!";
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

function RankItemCard({
  item,
  platform,
  rankKey = "",
  frontendVersion = "0.0.0",
  handleVersionResponse,
  onOpenSearchResult,
  favoriteKeys = new Set(),
  favoriteActionsDisabled = false,
  onToggleFavorite,
  onAddCompareItem,
}) {
  const coverUrl = buildProxyImageUrl(item.cover);
  const metrics = getRankMetrics(platform, item, rankKey);
  const isMissevanPeak = platform === "missevan" && item.type === "peak";
  const dramaIdText = Array.isArray(item.drama_ids) && item.drama_ids.length ? item.drama_ids.join("，") : "";
  const recentUpdatedDate = isMissevanPeak ? "" : formatRankUpdatedDate(item.updated_at);
  const paymentTag = getRankPaymentTag(item);
  const titleTags = getRankTitleTags(item);
  const mobileDisplayTitle = getInlineTaggedTitleDisplayText(item.name, {
    hasTags: titleTags.length > 0,
    viewport: "mobile",
  });
  const desktopDisplayTitle = getInlineTaggedTitleDisplayText(item.name, {
    hasTags: titleTags.length > 0,
    viewport: "desktop",
  });
  const detailIdText = isMissevanPeak ? dramaIdText : item.id;
  const trendLookupId = isMissevanPeak ? item.name : item.id;
  const trendItemBase = paymentTag ? { ...item, payment_label: paymentTag, payStatus: paymentTag } : item;
  const trendItem = isMissevanPeak ? { ...trendItemBase, id: trendLookupId } : trendItemBase;
  const searchDramaIds = isMissevanPeak
    ? (Array.isArray(item.drama_ids) ? item.drama_ids : [])
    : item.id != null
      ? [item.id]
      : [];
  const canOpenSearchResult = Boolean(onOpenSearchResult && platform && searchDramaIds.length);
  const favoriteDramaId = String(searchDramaIds[0] ?? item.id ?? "").trim();
  const canToggleFavorite = !isMissevanPeak && Boolean(favoriteDramaId);
  const favoriteKey = favoriteDramaId ? `${platform}:${favoriteDramaId}` : "";
  const isFavorite = Boolean(canToggleFavorite && favoriteKey && favoriteKeys?.has?.(favoriteKey));
  const mainCvText = String(item.main_cv_text ?? "").replace(/^主要CV：/, "");
  const peakPlayMetric = isMissevanPeak
    ? { label: "系列总播放量", iconLabel: "总播放量", value: formatPlainNumber(item.view_count) }
    : null;
  const peakDailyDeltaMetric = isMissevanPeak
    ? {
        key: "view_count",
        label: "系列总播放量",
        available: Boolean(item.daily_view_delta?.available),
        delta: item.daily_view_delta?.delta ?? null,
      }
    : null;
  const displayMetrics = isMissevanPeak ? [] : metrics;
  const canShowTrend = canShowRankTrend({ platform, rankKey, item, isMissevanPeak, detailIdText: trendLookupId });
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
      id: trendLookupId,
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
        id: trendLookupId,
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

  function openSearchResult() {
    if (!canOpenSearchResult) {
      return;
    }
    onOpenSearchResult?.({
      platform,
      id: searchDramaIds[0],
      ids: searchDramaIds,
      titles: searchDramaIds.map(() => item.name),
      name: item.name,
      paymentLabel: paymentTag,
      contentTypeLabel: titleTags[0],
      usageAction: "ranks_open_search_result",
    });
  }

  function toggleFavorite() {
    if (!canToggleFavorite) {
      return;
    }
    onToggleFavorite?.({
      platform,
      dramaId: favoriteDramaId,
      title: item.name,
      cover: item.cover || "",
      paymentLabel: paymentTag,
      contentTypeLabel: titleTags[0] || "",
      dramaUpdatedAt: item.updated_at || "",
      mainCvText: item.main_cv_text || "",
      source: "ranks",
    });
  }

  function addCompareItem() {
    if (!canShowTrend) {
      return;
    }
    onAddCompareItem?.({
      platform,
      id: String(trendLookupId ?? "").trim(),
      title: isMissevanPeak ? `系列：${item.name || ""}` : item.name || "",
      cover: item.cover || "",
      mainCvText: item.main_cv_text || "",
      compareKind: isMissevanPeak ? "peak_series" : "drama",
      dramaIds: isMissevanPeak ? searchDramaIds : [],
    });
  }

  return (
    <Card className="border-border/75 bg-card py-3 shadow-[0_18px_36px_-32px_rgba(15,23,42,0.18)]">
      <CardContent className="px-3.5">
        <div className="flex gap-3">
          <div className="flex shrink-0 flex-col items-center gap-2">
            <RankBadge rank={item.rank} />
            {canToggleFavorite ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="bg-background/84"
                disabled={favoriteActionsDisabled}
                onClick={toggleFavorite}
                aria-label={isFavorite ? "取消收藏" : "加入收藏"}
                title={isFavorite ? "取消收藏" : "加入收藏"}
              >
                <StarIcon className={isFavorite ? "fill-primary text-primary" : ""} />
              </Button>
            ) : null}
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
            <div className="hidden min-w-0 lg:block">
              {canOpenSearchResult ? (
                <button
                  type="button"
                  className={`min-w-0 break-words rounded-sm text-left text-foreground underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${getTitleClassName(item.name)}`}
                  onClick={openSearchResult}
                >
                  <span>{desktopDisplayTitle}</span>
                  {titleTags.map((label) => (
                    <Badge key={`${item.rank}-${item.id || item.name}-desktop-${label}`} variant={rankTagVariants[label] || "outline"} className={mobileInlineBadgeClassName}>
                      {label}
                    </Badge>
                  ))}
                </button>
              ) : (
                <span className={`min-w-0 break-words text-foreground ${getTitleClassName(item.name)}`}>
                  <span>{desktopDisplayTitle}</span>
                  {titleTags.map((label) => (
                    <Badge key={`${item.rank}-${item.id || item.name}-desktop-${label}`} variant={rankTagVariants[label] || "outline"} className={mobileInlineBadgeClassName}>
                      {label}
                    </Badge>
                  ))}
                </span>
              )}
            </div>
            <div className="min-w-0 lg:hidden">
              {canOpenSearchResult ? (
                <button
                  type="button"
                  className={`break-words rounded-sm text-left text-foreground underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${getTitleClassName(item.name)}`}
                  onClick={openSearchResult}
                >
                  <span>{mobileDisplayTitle}</span>
                  {titleTags.map((label) => (
                    <Badge key={`${item.rank}-${item.id || item.name}-${label}`} variant={rankTagVariants[label] || "outline"} className={mobileInlineBadgeClassName}>
                      {label}
                    </Badge>
                  ))}
                </button>
              ) : (
                <span className={`break-words text-foreground ${getTitleClassName(item.name)}`}>
                  <span>{mobileDisplayTitle}</span>
                  {titleTags.map((label) => (
                    <Badge key={`${item.rank}-${item.id || item.name}-${label}`} variant={rankTagVariants[label] || "outline"} className={mobileInlineBadgeClassName}>
                      {label}
                    </Badge>
                  ))}
                </span>
              )}
            </div>
            {detailIdText ? (
              <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <PlatformIdIcon platform={platform} aria-label={isMissevanPeak ? "包含作品ID" : "作品ID"} className={metaIconClassName} title={isMissevanPeak ? "包含作品ID" : "作品ID"} />
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
                className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
              >
                <MetricIcon label={peakPlayMetric.iconLabel} className={metaIconClassName} />
                <span className="min-w-0 break-all font-medium tabular-nums text-foreground">{peakPlayMetric.value}</span>
                <RankTrendDeltaBadge
                  metric={peakDailyDeltaMetric}
                  className="h-[1.35rem] px-1.5 text-[0.68rem]"
                >
                  日增：{formatRankTrendDelta(peakDailyDeltaMetric)}
                </RankTrendDeltaBadge>
                {canShowTrend ? (
                  <>
                    <RankTrendButton
                      onClick={openTrendDialog}
                      aria-label={`查看${item.name}趋势`}
                      title="查看趋势"
                    />
                    <CompareActionButton
                      onClick={addCompareItem}
                      aria-label={`加入${item.name}对比`}
                      title="加入对比"
                    />
                  </>
                ) : null}
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

        {displayMetrics.length || (!isMissevanPeak && canShowTrend) ? (
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
            {!isMissevanPeak && canShowTrend ? (
              <>
                <RankTrendButton
                  onClick={openTrendDialog}
                  aria-label={`查看${item.name}趋势`}
                  title="查看趋势"
                />
                <CompareActionButton
                  onClick={addCompareItem}
                  aria-label={`加入${item.name}对比`}
                  title="加入对比"
                />
              </>
            ) : null}
          </div>
        ) : null}
        {canShowTrend ? (
          <SharedRankTrendDialog
            open={isTrendOpen}
            onOpenChange={setIsTrendOpen}
            item={trendItem}
            platform={platform}
            trendState={trendState}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function getCvWorksPreviewText(works) {
  const titles = (Array.isArray(works) ? works : [])
    .slice(0, 3)
    .map((work) => String(work?.title ?? "").trim())
    .filter(Boolean);
  return titles.length ? `TOP3：${titles.map((title) => `《${title}》`).join(" ")}` : "TOP3：暂无";
}

function CvWorksList({ works = [], platform, onOpenSearchResult }) {
  function openWorkInSearch(work) {
    if (!work?.dramaId || !work?.title) {
      return;
    }
    onOpenSearchResult?.({
      platform,
      id: work.dramaId,
      dramaId: work.dramaId,
      titles: [work.title],
      name: work.title,
      usageAction: "ranks_open_search_result",
    });
  }

  return (
    <div className="mt-3 rounded-lg border border-border/80 bg-background/78 p-2.5 sm:p-3">
      <div className="mb-2 text-sm font-semibold leading-5">作品列表</div>
      <div
        data-cv-works-scroll-region="true"
        className="max-h-[24rem] overflow-y-auto overscroll-contain rounded-md border border-border/70 bg-card/70 [-webkit-overflow-scrolling:touch]"
      >
        {works.length ? (
          <div className="divide-y divide-border/70">
            {works.map((work) => {
              const coverUrl = buildProxyImageUrl(work.cover);
              const mainCvText = Array.isArray(work.mainCvs) && work.mainCvs.length ? work.mainCvs.join("，") : "暂无";
              return (
                <div
                  key={`${platform}-${work.dramaId}`}
                  className="grid grid-cols-[4rem_minmax(0,1fr)] gap-2 p-2.5 sm:grid-cols-[3.75rem_minmax(0,1fr)_minmax(8rem,0.45fr)_minmax(9rem,0.55fr)] sm:items-center"
                >
                  <div className="size-16 shrink-0 overflow-hidden rounded-md border border-border/70 bg-muted/45 sm:size-[3.75rem]">
                    {coverUrl ? (
                      <img alt={work.title} className="size-full object-cover" src={coverUrl} />
                    ) : (
                      <div className="flex size-full items-center justify-center text-[0.65rem] text-muted-foreground">
                        暂无封面
                      </div>
                    )}
                  </div>
                  <div data-cv-work-mobile-detail="true" className="grid min-w-0 gap-1 sm:hidden">
                    <button
                      type="button"
                      title={work.title}
                      className="block max-w-full truncate rounded-sm text-left text-sm font-semibold leading-5 text-foreground underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      onClick={() => openWorkInSearch(work)}
                    >
                      {work.title}
                    </button>
                    <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <PlatformIdIcon platform={platform} aria-label="作品ID" className={metaIconClassName} title="作品ID" />
                      <span className="min-w-0 truncate text-foreground" title={work.dramaId}>{work.dramaId}</span>
                    </div>
                    <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <PlayCircleIcon aria-label="播放量" className={metaIconClassName} title="播放量" />
                      <span className="min-w-0 break-all font-medium tabular-nums text-foreground">
                        {formatRankCompactCount(work.viewCount)}
                      </span>
                    </div>
                    <div className="flex min-w-0 items-start gap-1.5 text-xs text-muted-foreground">
                      <MicIcon aria-label="主役CV" className={`${metaIconClassName} mt-0.5`} title="主役CV" />
                      <span className="min-w-0 break-words text-foreground">{mainCvText}</span>
                    </div>
                  </div>
                  <div className="hidden min-w-0 sm:block">
                    <button
                      type="button"
                      title={work.title}
                      className="min-w-0 break-words rounded-sm text-left text-sm font-semibold leading-5 text-foreground underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      onClick={() => openWorkInSearch(work)}
                    >
                      {work.title}
                    </button>
                    <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <PlatformIdIcon platform={platform} aria-label="作品ID" className={metaIconClassName} title="作品ID" />
                      <span className="min-w-0 break-all text-foreground" title={work.dramaId}>{work.dramaId}</span>
                    </div>
                  </div>
                  <div className="hidden min-w-0 items-center gap-1.5 text-xs text-muted-foreground sm:flex sm:text-sm">
                    <PlayCircleIcon aria-label="播放量" className={metaIconClassName} title="播放量" />
                    <span className="min-w-0 break-all font-medium tabular-nums text-foreground">
                      {formatRankCompactCount(work.viewCount)}
                    </span>
                  </div>
                  <div className="hidden min-w-0 items-start gap-1.5 text-xs text-muted-foreground sm:flex sm:text-sm">
                    <MicIcon aria-label="主役CV" className={`${metaIconClassName} mt-0.5`} title="主役CV" />
                    <span className="min-w-0 break-words text-foreground">{mainCvText}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">暂无作品明细</div>
        )}
      </div>
    </div>
  );
}

function CvRankItemCard({
  item,
  platform,
  frontendVersion = "0.0.0",
  handleVersionResponse,
  onOpenSearchResult,
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isTrendOpen, setIsTrendOpen] = useState(false);
  const [trendState, setTrendState] = useState({
    isLoading: false,
    error: "",
    data: null,
  });
  const avatarUrl = buildProxyImageUrl(item.avatar);
  const topWorksText = getCvWorksPreviewText(item.topWorks || item.works);
  const canShowTrend = Boolean(item.cvName);

  async function openTrendDialog() {
    if (!canShowTrend) {
      return;
    }
    setIsTrendOpen(true);
    logRankTrendOpen({
      platform: "cv",
      id: item.cvName,
      name: item.cvName,
      source: "ranks",
      rankKey: item.trendScope === "paid" ? "cv-paid" : "cv",
      frontendVersion,
    });
    setTrendState((current) => ({
      ...current,
      isLoading: !current.data,
      error: "",
    }));
    try {
      const { response, data } = await fetchSharedRankTrendData({
        kind: "cv",
        id: item.cvName,
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
      console.error("Failed to load CV rank trend", error);
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
        <div className="grid grid-cols-[auto_3.75rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 sm:grid-cols-[auto_4.25rem_minmax(0,1fr)]">
          <RankBadge rank={item.rank} />
          <div className="row-span-2 size-[3.75rem] overflow-hidden rounded-full border border-border/70 bg-muted/45 sm:row-span-3 sm:size-[4.25rem]">
            {avatarUrl ? (
              <img alt={item.cvName} className="size-full object-cover" src={avatarUrl} />
            ) : (
              <div className="flex size-full items-center justify-center text-xs font-semibold text-muted-foreground">
                CV
              </div>
            )}
          </div>
          <div
            data-cv-card-title-row="true"
            className="col-start-3 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
          >
            <div className="min-w-0 break-words text-base font-semibold leading-6 text-foreground sm:text-lg">
              {item.cvName}
            </div>
            <div
              data-cv-card-playback-total="true"
              aria-label={`总播放量: ${formatRankCompactCount(item.totalViewCount)}`}
              title={`总播放量: ${formatRankCompactCount(item.totalViewCount)}`}
              className="flex shrink-0 items-center gap-1 text-sm font-semibold leading-5 text-foreground"
            >
              <PlayCircleIcon aria-hidden="true" className="size-3.5 shrink-0 text-foreground" />
              <span className="tabular-nums">{formatRankCompactCount(item.totalViewCount)}</span>
            </div>
          </div>
          <div
            data-cv-card-topworks-row="true"
            className="col-start-3 min-w-0 break-words text-xs leading-5 text-muted-foreground sm:text-sm"
          >
            {topWorksText}
          </div>
          <div
            data-cv-card-actions-row="true"
            className="col-start-3 hidden min-w-0 items-center justify-between gap-2 text-sm sm:flex"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <div
                aria-label={`作品数: ${formatPlainNumber(item.workCount)}`}
                title={`作品数: ${formatPlainNumber(item.workCount)}`}
                className="flex min-w-0 items-center gap-1.5"
              >
                <ScrollTextIcon aria-hidden="true" className={metaIconClassName} />
                <span className="min-w-0 break-all font-medium tabular-nums text-foreground">
                  {formatPlainNumber(item.workCount)}
                </span>
              </div>
              <RankTrendDeltaBadge
                metric={item.playbackDelta}
                className="h-[1.35rem] px-1.5 text-[0.68rem]"
              >
                周增：{formatRankTrendCompactDelta(item.playbackDelta)}
              </RankTrendDeltaBadge>
              {canShowTrend ? (
                <RankTrendButton
                  onClick={openTrendDialog}
                  aria-label={`查看${item.cvName}趋势`}
                  title="查看趋势"
                />
              ) : null}
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="shrink-0 bg-background/84"
              onClick={() => setIsExpanded((current) => !current)}
              aria-label={isExpanded ? `收起${item.cvName}作品列表` : `展开${item.cvName}作品列表`}
              title={isExpanded ? "收起作品列表" : "展开作品列表"}
            >
              {isExpanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
            </Button>
          </div>
          <div
            data-cv-mobile-summary-row="true"
            data-cv-card-mobile-actions-row="true"
            className="col-start-2 col-span-2 flex min-w-0 items-center justify-between gap-2 text-sm sm:hidden"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
              <div
                aria-label={`作品数: ${formatPlainNumber(item.workCount)}`}
                title={`作品数: ${formatPlainNumber(item.workCount)}`}
                className="flex min-w-0 items-center gap-1.5"
              >
                <ScrollTextIcon aria-hidden="true" className={metaIconClassName} />
                <span className="min-w-0 break-all font-medium tabular-nums text-foreground">
                  {formatPlainNumber(item.workCount)}
                </span>
              </div>
              <RankTrendDeltaBadge
                metric={item.playbackDelta}
                className="h-[1.35rem] px-1.5 text-[0.68rem]"
              >
                周增：{formatRankTrendCompactDelta(item.playbackDelta)}
              </RankTrendDeltaBadge>
              {canShowTrend ? (
                <RankTrendButton
                  onClick={openTrendDialog}
                  aria-label={`查看${item.cvName}趋势`}
                  title="查看趋势"
                />
              ) : null}
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="shrink-0 bg-background/84"
              onClick={() => setIsExpanded((current) => !current)}
              aria-label={isExpanded ? `收起${item.cvName}作品列表` : `展开${item.cvName}作品列表`}
              title={isExpanded ? "收起作品列表" : "展开作品列表"}
            >
              {isExpanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
            </Button>
          </div>
        </div>
        {isExpanded ? (
          <CvWorksList works={item.works || []} platform={platform} onOpenSearchResult={onOpenSearchResult} />
        ) : null}
        {canShowTrend ? (
          <SharedRankTrendDialog
            open={isTrendOpen}
            onOpenChange={setIsTrendOpen}
            item={{ id: item.cvName, name: item.cvName }}
            platform="cv"
            trendState={trendState}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function CvRankColumn({
  rank,
  platform,
  frontendVersion = "0.0.0",
  handleVersionResponse,
  onOpenSearchResult,
}) {
  return (
    <section className="min-w-0 rounded-lg border border-border/80 bg-background/76 p-3 shadow-[0_20px_46px_-38px_rgba(15,23,42,0.26)]">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold leading-6">{rank.name}</h2>
          <div data-rank-count-row="true" className="flex items-center justify-between gap-2 text-xs text-muted-foreground sm:block">
            <span>{rank.items.length} 位 CV</span>
            {rank.fetchedAt ? <span className="text-right sm:hidden">更新：{formatRankUpdatedAt(rank.fetchedAt)}</span> : null}
          </div>
        </div>
        {rank.fetchedAt ? <div className="hidden text-xs text-muted-foreground sm:block">更新：{formatRankUpdatedAt(rank.fetchedAt)}</div> : null}
      </div>
      {rank.items.length ? (
        <div className="grid gap-3">
          {rank.items.map((item) => (
            <CvRankItemCard
              key={`${rank.key}-${item.rank}-${item.cvName}`}
              item={item}
              platform={platform}
              frontendVersion={frontendVersion}
              handleVersionResponse={handleVersionResponse}
              onOpenSearchResult={onOpenSearchResult}
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

function RankColumn({
  rank,
  platform,
  frontendVersion = "0.0.0",
  handleVersionResponse,
  onOpenSearchResult,
  favoriteKeys = new Set(),
  favoriteActionsDisabled = false,
  onToggleFavorite,
  onAddCompareItem,
}) {
  return (
    <section className="min-w-0 rounded-lg border border-border/80 bg-background/76 p-3 shadow-[0_20px_46px_-38px_rgba(15,23,42,0.26)]">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold leading-6">{rank.name}</h2>
          <div data-rank-count-row="true" className="flex items-center justify-between gap-2 text-xs text-muted-foreground sm:block">
            <span>{rank.items.length} 项</span>
            {rank.fetchedAt ? <span className="text-right sm:hidden">更新：{formatRankUpdatedAt(rank.fetchedAt)}</span> : null}
          </div>
        </div>
        {rank.fetchedAt ? <div className="hidden text-xs text-muted-foreground sm:block">更新：{formatRankUpdatedAt(rank.fetchedAt)}</div> : null}
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
              onOpenSearchResult={onOpenSearchResult}
              favoriteKeys={favoriteKeys}
              favoriteActionsDisabled={favoriteActionsDisabled}
              onToggleFavorite={onToggleFavorite}
              onAddCompareItem={onAddCompareItem}
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

export function RanksPanel({
  frontendVersion = "0.0.0",
  handleVersionResponse,
  routeState = null,
  onRouteStateChange,
  onOpenSearchResult,
  favoriteKeys = new Set(),
  favoriteActionsDisabled = false,
  onToggleFavorite,
  onAddCompareItem,
}) {
  const [rankData, setRankData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedPlatform, setSelectedPlatform] = useState(() =>
    routeState?.platform === "manbo" ? "manbo" : "missevan"
  );
  const [selectedCategory, setSelectedCategory] = useState(() => String(routeState?.category || "").trim());
  const [selectedRank, setSelectedRank] = useState(() => String(routeState?.rank || "").trim());
  const loggedRanksRef = useRef(new Set());

  useEffect(() => {
    let cancelled = false;

    async function loadRanks() {
      const cachedPayload = getCachedRanksData(frontendVersion);
      if (cachedPayload?.data?.success) {
        setRankData(cachedPayload.data);
      }
      setIsLoading(!cachedPayload);
      setErrorMessage("");
      try {
        const { response, data } = await fetchRanksData(frontendVersion, { revalidate: true });
        handleVersionResponse?.({
          ...data,
          backendVersion: getBackendVersionFromResponse(response, data),
          frontendVersion,
        });
        if (cancelled) {
          return;
        }
        if (!response.ok || !data?.success) {
          if (!cachedPayload?.data?.success) {
            setRankData(null);
            setErrorMessage("Ranks 暂不可用，请稍后重试。");
          }
          return;
        }
        setRankData(data);
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load ranks", error);
          if (!cachedPayload?.data?.success) {
            setRankData(null);
            setErrorMessage("Ranks 暂不可用，请稍后重试。");
          }
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
    if (routeState?.view !== "ranks") {
      return;
    }
    setSelectedPlatform(routeState.platform === "manbo" ? "manbo" : "missevan");
    setSelectedCategory(String(routeState.category || "").trim());
    setSelectedRank(String(routeState.rank || "").trim());
  }, [routeState?.view, routeState?.platform, routeState?.category, routeState?.rank]);

  useEffect(() => {
    if (!availablePlatforms.length) {
      return;
    }

    if (!availablePlatforms.some((platform) => platform.key === selectedPlatform)) {
      const nextPlatform = availablePlatforms[0];
      const nextCategory = getFirstCategory(nextPlatform);
      const nextRank = nextCategory?.ranks?.[0] || null;
      setSelectedPlatform(nextPlatform.key);
      setSelectedCategory(nextCategory?.key || "");
      setSelectedRank(nextRank?.key || "");
      if (routeState?.view === "ranks") {
        onRouteStateChange?.(
          {
            view: "ranks",
            platform: nextPlatform.key,
            category: nextCategory?.key || "",
            rank: nextRank?.key || "",
          },
          { replace: true }
        );
      }
    }
  }, [availablePlatforms, onRouteStateChange, routeState?.view, selectedPlatform]);

  useEffect(() => {
    if (!platformData?.categories?.length) {
      return;
    }

    const nextCategory = getCategory(platformData, selectedCategory);
    if (nextCategory?.key && nextCategory.key !== selectedCategory) {
      setSelectedCategory(nextCategory.key);
      const nextRankKey = nextCategory.ranks?.[0]?.key || "";
      setSelectedRank(nextRankKey);
      if (routeState?.view === "ranks") {
        onRouteStateChange?.(
          {
            view: "ranks",
            platform: selectedPlatform,
            category: nextCategory.key,
            rank: nextRankKey,
          },
          { replace: true }
        );
      }
      return;
    }

    const nextRank = getRank(nextCategory, selectedRank);
    if (nextRank?.key && nextRank.key !== selectedRank) {
      setSelectedRank(nextRank.key);
      if (routeState?.view === "ranks") {
        onRouteStateChange?.(
          {
            view: "ranks",
            platform: selectedPlatform,
            category: nextCategory?.key || "",
            rank: nextRank.key,
          },
          { replace: true }
        );
      }
    }
  }, [onRouteStateChange, platformData, routeState?.view, selectedCategory, selectedPlatform, selectedRank]);

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
    const nextRoute = buildRankPlatformSwitchRoutePatch(platform, nextPlatform, {
      category: category?.key || selectedCategory,
      rank: activeRank?.key || selectedRank,
    });
    setSelectedPlatform(nextRoute.platform);
    setSelectedCategory(nextRoute.category);
    setSelectedRank(nextRoute.rank);
    onRouteStateChange?.(nextRoute);
  }

  function updateCategory(categoryKey) {
    const nextCategory = getCategory(platformData, categoryKey);
    setSelectedCategory(nextCategory?.key || "");
    setSelectedRank(nextCategory?.ranks?.[0]?.key || "");
    onRouteStateChange?.({
      view: "ranks",
      platform: selectedPlatform,
      category: nextCategory?.key || "",
      rank: nextCategory?.ranks?.[0]?.key || "",
    });
  }

  function updateRank(rankKey) {
    const nextRank = getRank(category, rankKey);
    setSelectedRank(nextRank?.key || "");
    onRouteStateChange?.({
      view: "ranks",
      platform: selectedPlatform,
      category: category?.key || "",
      rank: nextRank?.key || "",
    });
  }

  const hasRanks = availablePlatforms.length > 0;
  const isCvCategory = category?.key === "cv";
  const cvSummary = rankData?.cvSummary || {};
  const rankIntro = isCvCategory
    ? `统计来自猫耳${formatPlainNumber(cvSummary.missevanDramaCount)}部，漫播${formatPlainNumber(cvSummary.manboDramaCount)}部上架中的作品，每周更新。`
    : "同步猫耳和漫播榜单，每日更新。";
  const rankRefreshAt = isCvCategory ? cvSummary.updatedAt || activeRank?.fetchedAt : rankData?.updatedAt;

  return (
    <div className="grid gap-4 sm:gap-5">
      <div className="flex flex-col gap-1 px-1 text-sm leading-6 text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div>{rankIntro}</div>
        <div className="sm:text-right">此次榜单刷新于：{formatRankUpdatedAt(rankRefreshAt)}</div>
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
          <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:gap-3">
            <MetricLegend />
            <div className="hidden lg:flex lg:justify-end lg:gap-2">
              <Tabs value={selectedPlatform} onValueChange={updatePlatform} className="gap-0">
                <TabsList className="grid w-full grid-cols-2 justify-stretch sm:w-fit lg:inline-flex lg:justify-start">
                  {availablePlatforms.map((platform) => (
                    <TabsTrigger key={platform.key} className="px-3" value={platform.key}>
                      <PlatformTabLabel platform={platform} />
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              {platformData?.categories?.length ? (
                <Tabs value={category?.key || ""} onValueChange={updateCategory} className="gap-0">
                  <TabsList className="grid w-full justify-stretch sm:w-fit lg:inline-flex lg:justify-start">
                    {platformData.categories.map((item) => (
                      <TabsTrigger key={item.key} className="px-3" value={item.key}>
                        {item.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              ) : null}
            </div>
            <div className="grid gap-0 overflow-hidden rounded-lg border border-border/80 bg-card/80 shadow-sm lg:hidden">
              <Tabs value={selectedPlatform} onValueChange={updatePlatform} className="gap-0">
                <TabsList className={`${mobileMenuTabsListClassName} grid-cols-2`}>
                  {availablePlatforms.map((platform) => (
                    <TabsTrigger key={platform.key} className="min-w-0 px-2" value={platform.key}>
                      <PlatformTabLabel platform={platform} />
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              {platformData?.categories?.length ? (
                <>
                  <div className="h-px bg-border/70" />
                  <div className="flex h-9 items-center gap-2 px-1.5">
                    <Tabs
                      value={category?.key || ""}
                      onValueChange={updateCategory}
                      className="min-w-0 flex-1 gap-0"
                    >
                      <TabsList
                        className={mobileMenuTabsListClassName}
                        style={getRankTabsGridStyle(platformData.categories.length)}
                      >
                        {platformData.categories.map((item) => (
                          <TabsTrigger key={item.key} className={mobileRankTabClassName} value={item.key}>
                            {formatMobileRankMenuLabel(item.label)}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </Tabs>
                    {category?.ranks?.length > 1 ? (
                      <>
                        <div className="h-7 w-px shrink-0 bg-border/80" />
                        <Tabs
                          value={activeRank?.key || ""}
                          onValueChange={updateRank}
                          className="w-[38%] min-w-[6.5rem] max-w-[8.75rem] shrink-0 gap-0"
                        >
                          <TabsList
                            className={mobileMenuTabsListClassName}
                            style={{ gridTemplateColumns: `repeat(${category.ranks.length}, minmax(0, 1fr))` }}
                          >
                            {category.ranks.map((rank) => (
                              <TabsTrigger key={rank.key} className={mobileRankTabClassName} value={rank.key}>
                                {formatMobileRankMenuLabel(rank.label)}
                              </TabsTrigger>
                            ))}
                          </TabsList>
                        </Tabs>
                      </>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          </div>

          <div className="hidden gap-3 lg:grid lg:grid-cols-[repeat(auto-fit,minmax(21rem,1fr))]">
            {isCvCategory ? (
              (category?.ranks || []).map((rank) => (
                <CvRankColumn
                  key={rank.key}
                  platform={selectedPlatform}
                  rank={rank}
                  frontendVersion={frontendVersion}
                  handleVersionResponse={handleVersionResponse}
                  onOpenSearchResult={onOpenSearchResult}
                />
              ))
            ) : (
              (category?.ranks || []).map((rank) => (
                <RankColumn
                  key={rank.key}
                  platform={selectedPlatform}
                  rank={rank}
                  frontendVersion={frontendVersion}
                  handleVersionResponse={handleVersionResponse}
                  onOpenSearchResult={onOpenSearchResult}
                  favoriteKeys={favoriteKeys}
                  favoriteActionsDisabled={favoriteActionsDisabled}
                  onToggleFavorite={onToggleFavorite}
                  onAddCompareItem={onAddCompareItem}
                />
              ))
            )}
          </div>

          <div className="grid gap-3 lg:hidden">
            {isCvCategory && activeRank ? (
              <CvRankColumn
                platform={selectedPlatform}
                rank={activeRank}
                frontendVersion={frontendVersion}
                handleVersionResponse={handleVersionResponse}
                onOpenSearchResult={onOpenSearchResult}
              />
            ) : activeRank ? (
              <RankColumn
                platform={selectedPlatform}
                rank={activeRank}
                frontendVersion={frontendVersion}
                handleVersionResponse={handleVersionResponse}
                onOpenSearchResult={onOpenSearchResult}
                favoriteKeys={favoriteKeys}
                favoriteActionsDisabled={favoriteActionsDisabled}
                onToggleFavorite={onToggleFavorite}
                onAddCompareItem={onAddCompareItem}
              />
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
