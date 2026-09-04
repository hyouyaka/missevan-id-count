import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRightIcon,
  CalendarClockIcon,
  ChartNoAxesColumnIcon,
  ChevronRightIcon,
  HandCoinsIcon,
  MicIcon,
  MoreHorizontalIcon,
  PlayCircleIcon,
  RefreshCwIcon,
  StarIcon,
  TrendingUpIcon,
  UserSearchIcon,
} from "lucide-react";

import {
  buildCvRankProfileId,
  buildVersionedUrl,
  formatDeviceDateTime,
  formatPlainNumber,
  formatRankCompactCount,
  getBackendVersionFromResponse,
} from "@/app/app-utils";
import { fetchOngoingData, getCachedOngoingData } from "@/app/ongoingData";
import { LazyRankTrendDialog } from "@/app/LazyRankTrendDialog";
import { PlatformDramaLink, PlatformTabLabel } from "@/app/platformTabLabel";
import { RankWatermark } from "@/app/RankBadge";
import { fetchRanksData, getCachedRanksData, resolveRankRefreshAt } from "@/app/ranksData";
import {
  fetchRankTrendAvailabilityData,
  fetchRankTrendData,
  logRankTrendOpen,
} from "@/app/rankTrendData";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { LazyImage } from "@/components/ui/lazy-image";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { sortOngoingItemsByWindowDelta } from "../../shared/ongoingUtils.js";

const platformMeta = {
  missevan: { label: "猫耳" },
  manbo: { label: "漫播" },
};

const HOME_RANK_CONFIG = {
  missevan: [
    { title: "猫耳新品日榜", displayTitle: "新品日榜", categoryKey: "new", rankKey: "new_daily" },
    { title: "猫耳人气周榜", displayTitle: "人气周榜", categoryKey: "popular", rankKey: "popular_weekly" },
    { title: "猫耳畅销周榜", displayTitle: "畅销周榜", categoryKey: "bestseller", rankKey: "bestseller_weekly" },
    { title: "猫耳巅峰榜", displayTitle: "巅峰榜", categoryKey: "peak", rankKey: "peak" },
    { title: "猫耳7日飙升榜", displayTitle: "7日飙升榜", categoryKey: "growth", rankKey: "growth_weekly" },
    { title: "猫耳CV榜总榜", displayTitle: "CV总榜", categoryKey: "cv", rankKey: "cv", itemType: "cv" },
  ],
  manbo: [
    { title: "漫播热播榜", displayTitle: "热播榜", categoryKey: "hot", rankKey: "hot" },
    { title: "漫播票房总榜", displayTitle: "票房总榜", categoryKey: "box_office", rankKey: "box_office_total" },
    { title: "漫播钻石榜", displayTitle: "钻石榜", categoryKey: "diamond", rankKey: "diamond_monthly" },
    { title: "漫播巅峰榜", displayTitle: "巅峰榜", categoryKey: "peak", rankKey: "peak" },
    { title: "漫播7日飙升榜", displayTitle: "7日飙升榜", categoryKey: "growth", rankKey: "growth_weekly" },
    { title: "漫播CV总榜", displayTitle: "CV总榜", categoryKey: "cv", rankKey: "cv", itemType: "cv" },
  ],
};

const homePillTabsListClassName = "inline-flex h-9 min-h-9 w-fit";
const homePillTabClassName = "h-7 min-h-7 min-w-0 px-3 text-sm!";
const homeRankItemTitleClassName =
  "min-w-0 truncate whitespace-nowrap text-base! font-semibold! leading-6! text-foreground";
const homeMoreButtonClassName =
  "h-8 min-h-8 min-w-11 shrink-0 overflow-visible rounded-[calc(var(--radius)-0.12rem)] border-0 bg-transparent px-2 shadow-none hover:bg-accent hover:text-accent-foreground after:absolute after:inset-x-0 after:-inset-y-1.5 after:rounded-md after:content-['']";

function buildProxyImageUrl(url) {
  return url ? `/image-proxy?url=${encodeURIComponent(url)}` : "";
}

function formatHomeDate(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "未知";
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return normalized.slice(0, 10) || "未知";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .replaceAll("/", "-");
}

function formatHomeUpdatedLabel(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }

  let date;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "number" && Number.isFinite(value)) {
    date = new Date(value);
  } else if (/^\d{11,}$/.test(normalized)) {
    date = new Date(Number(normalized));
  } else if (/^\d{10}$/.test(normalized)) {
    date = new Date(Number(normalized) * 1000);
  } else {
    date = new Date(normalized);
  }

  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return `${formatDeviceDateTime(date)} 更新`;
}

function formatHomeStatisticsPeriod(period) {
  const startDate = String(period?.startDate ?? "").trim();
  const endDate = String(period?.endDate ?? "").trim();
  return startDate && endDate ? `${startDate} 至 ${endDate}` : "";
}

function formatCompactCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count)) {
    return "暂无";
  }
  if (Math.abs(count) >= 10000) {
    const wan = count / 10000;
    return `${wan.toFixed(Math.abs(wan) >= 1000 ? 0 : 1)}万`;
  }
  return formatPlainNumber(count);
}

function formatDelta(value) {
  const delta = Number(value);
  if (!Number.isFinite(delta)) {
    return "暂无";
  }
  return `${delta > 0 ? "+" : ""}${formatCompactCount(delta)}`;
}

function getMainCvText(item) {
  return String(item?.main_cv_text ?? "").replace(/^主要CV：/, "").trim() || "暂无";
}

function getSevenDayViewDelta(item) {
  const metric = item?.windows?.["7d"]?.metrics?.view_count;
  return metric?.available === false ? null : metric?.delta ?? null;
}

function getViewCountValue(item) {
  return item?.metrics?.view_count?.value ?? item?.view_count ?? item?.viewCount ?? null;
}

function getHomeCvWorksPreviewText(works) {
  const titles = (Array.isArray(works) ? works : [])
    .slice(0, 3)
    .map((work) => String(work?.title ?? "").trim())
    .filter(Boolean);
  return titles.length ? `TOP3：${titles.map((title) => `《${title}》`).join("")}` : "TOP3：暂无";
}

function getPlatformRanks(data, platform) {
  return data?.platforms?.[platform]?.categories || [];
}

function getRankByConfig(data, platform, rankConfig) {
  const category = getPlatformRanks(data, platform).find((item) => item?.key === rankConfig.categoryKey);
  return (category?.ranks || []).find((rank) => rank?.key === rankConfig.rankKey) || null;
}

function getHomeTrendLookup(item, platform, rankKey = "") {
  const isCvRank = rankKey === "cv" && Boolean(item?.cvName);
  const isMissevanPeak = platform === "missevan" && (rankKey === "peak" || item?.type === "peak");
  const id = String(isCvRank ? item?.cvName : isMissevanPeak ? item?.name : item?.id ?? "").trim();
  return {
    id,
    isCvRank,
    isMissevanPeak,
    canUseSeriesTrend: isMissevanPeak && Boolean(item?.daily_view_delta?.available),
  };
}

function getSettledPayload(result) {
  return result?.status === "fulfilled" ? result.value : null;
}

function logRejectedHomePayload(label, result) {
  if (result?.status === "rejected") {
    console.error(`Failed to load home ${label}`, result.reason);
  }
}

function SectionHeader({ title, description, sectionIcon: SectionIcon }) {
  return (
    <div className="home-editorial-section-heading">
      <div className="home-editorial-section-title">
        {SectionIcon ? <SectionIcon aria-hidden="true" className="home-editorial-section-icon" /> : null}
        <h2>{title}</h2>
      </div>
      {description ? <p className="home-editorial-section-note">{description}</p> : null}
    </div>
  );
}

function PlatformTabs({ value, onValueChange, ariaLabel, counts = null }) {
  return (
    <Tabs value={value} onValueChange={onValueChange} className="shrink-0 gap-0">
      <TabsList aria-label={ariaLabel} className={`${homePillTabsListClassName} grid-cols-2`}>
        {["missevan", "manbo"].map((platform) => (
          <TabsTrigger
            key={platform}
            data-touch="compact"
            data-platform={platform}
            className={homePillTabClassName}
            value={platform}
          >
            <PlatformTabLabel platform={platform} />
            {counts ? <span className="ml-0.5 tabular-nums">{counts[platform] ?? 0}</span> : null}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

function HomeTextLink({ children, ariaLabel, onClick }) {
  return (
    <Button
      type="button"
      variant="link"
      className="mx-auto h-8 px-2 text-sm! font-semibold"
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {children}
      <ChevronRightIcon aria-hidden="true" data-icon="inline-end" />
    </Button>
  );
}

function HomeMoreMenu({
  item,
  platform,
  rankKey = "",
  kind = "drama",
  overlay = false,
  canOpenTrend = false,
  onOpenTrend,
  openSearchResult,
  favoriteKeys,
  favoriteActionsDisabled = false,
  statisticsActionsDisabled = false,
  onToggleFavorite,
  onAddCompareItem,
  onStartDramaPaidIdStatistics,
  onStartRevenueEstimate,
  frontendVersion = "0.0.0",
}) {
  const [statisticsActionPending, setStatisticsActionPending] = useState("");
  const statisticsActionLockRef = useRef(false);
  const isPeakSeries = kind === "peak";
  const isCv = kind === "cv";
  const dramaId = String(item?.id ?? "").trim();
  const title = String(isCv ? item?.cvName : item?.name ?? "").trim() || (isCv ? "未命名CV" : "未命名剧集");
  const favoriteKey = dramaId ? `${platform}:${dramaId}` : "";
  const isFavorite = Boolean(favoriteKey && favoriteKeys?.has?.(favoriteKey));

  function openTrend() {
    if (canOpenTrend) {
      onOpenTrend?.({ item, platform, rankKey });
    }
  }

  function addCompareItem() {
    if (!canOpenTrend || isCv) return;
    onAddCompareItem?.({
      platform,
      id: isPeakSeries ? title : dramaId,
      title: isPeakSeries ? `系列：${title}` : title,
      cover: item?.cover || "",
      mainCvText: getMainCvText(item),
      compareKind: isPeakSeries ? "peak_series" : "drama",
      dramaIds: isPeakSeries ? (Array.isArray(item?.drama_ids) ? item.drama_ids : []) : [],
    });
  }

  function toggleFavorite() {
    if (!dramaId || favoriteActionsDisabled) return;
    onToggleFavorite?.({
      platform,
      dramaId,
      title,
      cover: item?.cover || "",
      paymentLabel: item?.payment_label || item?.paymentLabel || item?.payStatus || "",
      contentTypeLabel: item?.content_type_label || item?.contentTypeLabel || "",
      dramaUpdatedAt: item?.updated_at || "",
      mainCvText: getMainCvText(item),
      source: "homeview",
    });
  }

  function logStatisticsMenuClick(action) {
    fetch(buildVersionedUrl("/usage-log", frontendVersion), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform, action, dramaId, dramaName: title, source: "homeview", success: true }),
      keepalive: true,
    }).catch((error) => console.error("Failed to log home statistics action", error));
  }

  async function runStatisticsAction(action) {
    if (statisticsActionsDisabled || statisticsActionLockRef.current || !dramaId || !openSearchResult) return;
    const isPaidIdAction = action === "paid_id_click";
    const startStatistics = isPaidIdAction ? onStartDramaPaidIdStatistics : onStartRevenueEstimate;
    if (!startStatistics) return;
    statisticsActionLockRef.current = true;
    setStatisticsActionPending(action);
    logStatisticsMenuClick(action);
    try {
      const opened = await openSearchResult({ suppressUsageLog: true });
      if (!opened) return;
      if (isPaidIdAction) await startStatistics(dramaId, { platform, source: `${dramaId}payID` });
      else await startStatistics([dramaId], { platform, source: `${dramaId}earn` });
    } finally {
      statisticsActionLockRef.current = false;
      setStatisticsActionPending("");
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          data-touch="compact"
          className={`${homeMoreButtonClassName} ${overlay ? "absolute right-0 top-1/2 -translate-y-1/2 active:-translate-y-1/2" : "relative ml-auto active:translate-y-0"}`}
          aria-label={`${title}更多操作`}
          title="更多操作"
        >
          <MoreHorizontalIcon aria-hidden="true" className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={!canOpenTrend} onSelect={openTrend}><TrendingUpIcon aria-hidden="true" />趋势</DropdownMenuItem>
        {!isCv ? <DropdownMenuItem disabled={!canOpenTrend || !onAddCompareItem} onSelect={addCompareItem}><ArrowLeftRightIcon aria-hidden="true" />对比</DropdownMenuItem> : null}
        {kind === "drama" ? (
          <>
            <DropdownMenuItem disabled={favoriteActionsDisabled || !dramaId} onSelect={toggleFavorite}><StarIcon aria-hidden="true" className={isFavorite ? "fill-primary text-primary" : ""} />{isFavorite ? "取消收藏" : "收藏"}</DropdownMenuItem>
            <DropdownMenuItem disabled={statisticsActionsDisabled || Boolean(statisticsActionPending)} onSelect={() => runStatisticsAction("paid_id_click")}><UserSearchIcon aria-hidden="true" />付费ID</DropdownMenuItem>
            <DropdownMenuItem disabled={statisticsActionsDisabled || Boolean(statisticsActionPending)} onSelect={() => runStatisticsAction("revenue_click")}><HandCoinsIcon aria-hidden="true" />收益</DropdownMenuItem>
            <DropdownMenuItem asChild><PlatformDramaLink appearance="menu" platform={platform} dramaId={dramaId} source="homeview" dramaTitle={title} frontendVersion={frontendVersion} /></DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OngoingMiniItem({
  item,
  platform,
  onOpenSearchResult,
  onOpenTrend,
  canOpenTrend = false,
  featured = false,
  favoriteKeys,
  favoriteActionsDisabled,
  statisticsActionsDisabled,
  onToggleFavorite,
  onAddCompareItem,
  onStartDramaPaidIdStatistics,
  onStartRevenueEstimate,
  frontendVersion,
}) {
  const coverUrl = buildProxyImageUrl(item?.cover);
  const delta = getSevenDayViewDelta(item);

  function openSearchResult(options = {}) {
    if (!platform || !item?.id) {
      return false;
    }
    return onOpenSearchResult?.({
      platform,
      id: item.id,
      titles: [item.name],
      name: item.name,
      paymentLabel: item.payment_label,
      contentTypeLabel: item.content_type_label,
      usageAction: options.suppressUsageLog ? undefined : "ongoing_open_search_result",
      usageSource: "homeview",
      suppressUsageLog: options.suppressUsageLog === true,
    });
  }

  return (
    <article className={`home-editorial-update-item ${featured ? "is-featured" : ""}`}>
      <div className="home-editorial-cover-stack">
        <div className="home-editorial-trend-cover-static">
          <div className="home-editorial-update-cover">
            {coverUrl ? (
              <LazyImage alt={item?.name || "剧集封面"} className="size-full object-cover" src={coverUrl} />
            ) : (
              <div className="flex size-full items-center justify-center text-xs text-muted-foreground">暂无封面</div>
            )}
          </div>
        </div>
      </div>
      <div className="home-editorial-update-copy">
        <button
          type="button"
          className="line-clamp-1 rounded-sm text-left text-sm font-semibold! leading-5 text-foreground underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:text-base"
          title={item?.name || "未命名剧集"}
          onClick={openSearchResult}
        >
          {item?.name || "未命名剧集"}
        </button>
        <div className="flex min-w-0 items-start gap-1.5 text-xs leading-5 text-muted-foreground">
          <MicIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span className="line-clamp-1 min-w-0">{getMainCvText(item)}</span>
        </div>
        <div className="home-editorial-update-meta">
          <span className="inline-flex flex-none items-center gap-1 whitespace-nowrap">
            <RefreshCwIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span>{formatHomeDate(item?.updated_at)}</span>
          </span>
          <span className="inline-flex flex-none items-center gap-1 whitespace-nowrap">
            <PlayCircleIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="tabular-nums">
              {formatCompactCount(getViewCountValue(item))}
              <span className="home-editorial-delta">（{formatDelta(delta)}）</span>
            </span>
          </span>
          <HomeMoreMenu
            item={item}
            platform={platform}
            rankKey="ongoing"
            overlay
            canOpenTrend={canOpenTrend}
            onOpenTrend={onOpenTrend}
            openSearchResult={openSearchResult}
            favoriteKeys={favoriteKeys}
            favoriteActionsDisabled={favoriteActionsDisabled}
            statisticsActionsDisabled={statisticsActionsDisabled}
            onToggleFavorite={onToggleFavorite}
            onAddCompareItem={onAddCompareItem}
            onStartDramaPaidIdStatistics={onStartDramaPaidIdStatistics}
            onStartRevenueEstimate={onStartRevenueEstimate}
            frontendVersion={frontendVersion}
          />
        </div>
      </div>
    </article>
  );
}

function OngoingPlatformList({
  platform,
  items,
  totalCount,
  updatedAt,
  onNavigateRoute,
  onOpenSearchResult,
  canOpenTrend,
  onOpenTrend,
  actionProps,
}) {
  const [featuredItem, ...compactItems] = items;

  return (
    <div className="home-editorial-platform">
      <div className="home-editorial-platform-header">
        <span className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap">
          <PlatformTabLabel platform={platform} />
          <span className="home-editorial-count tabular-nums">{totalCount}</span>
        </span>
        {formatHomeUpdatedLabel(updatedAt) ? (
          <span className="home-editorial-updated-at">
            {formatHomeUpdatedLabel(updatedAt)}
          </span>
        ) : null}
      </div>
      <div className="home-editorial-update-list">
        {featuredItem ? (
          <>
            <OngoingMiniItem
              item={featuredItem}
              platform={platform}
              onOpenSearchResult={onOpenSearchResult}
              onOpenTrend={onOpenTrend}
              canOpenTrend={canOpenTrend(featuredItem, platform)}
              featured={true}
              {...actionProps}
            />
            <div className="home-editorial-compact-list">
              {compactItems.map((item) => (
                <OngoingMiniItem
                  key={`${platform}-${item.id}`}
                  item={item}
                  platform={platform}
                  onOpenSearchResult={onOpenSearchResult}
                  onOpenTrend={onOpenTrend}
                  canOpenTrend={canOpenTrend(item, platform)}
                  {...actionProps}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="home-editorial-empty">
            <CalendarClockIcon aria-hidden="true" className="size-5" />
            <span>暂无更新数据</span>
          </div>
        )}
      </div>
      <HomeTextLink
        ariaLabel={`查看更多${platformMeta[platform].label}一周内更新`}
        onClick={() => onNavigateRoute({
          view: "ongoing",
          platform,
          window: "7d",
        })}
      >
        查看更多
      </HomeTextLink>
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="home-editorial-skeleton" aria-hidden="true">
      <section className="home-editorial-section home-editorial-section-first">
        <div className="home-editorial-skeleton-line home-editorial-skeleton-title" />
        <div className="home-editorial-updates-grid">
          {[0, 1].map((platformIndex) => (
            <div className="home-editorial-platform" key={platformIndex}>
              <div className="home-editorial-skeleton-line home-editorial-skeleton-label" />
              <div className="home-editorial-skeleton-feature">
                <div className="home-editorial-skeleton-block" />
                <div className="grid flex-1 gap-3">
                  <div className="home-editorial-skeleton-line" />
                  <div className="home-editorial-skeleton-line is-short" />
                  <div className="home-editorial-skeleton-line is-shorter" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="home-editorial-section">
        <div className="home-editorial-skeleton-line home-editorial-skeleton-title" />
        <div className="home-editorial-skeleton-ranks">
          {[0, 1, 2].map((rankIndex) => (
            <div className="home-editorial-skeleton-card" key={rankIndex}>
              <div className="home-editorial-skeleton-line home-editorial-skeleton-label" />
              {[0, 1, 2].map((rowIndex) => (
                <div className="home-editorial-skeleton-row" key={rowIndex}>
                  <div className="home-editorial-skeleton-avatar" />
                  <div className="home-editorial-skeleton-line" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function RankDramaItem({
  item,
  platform,
  rankKey,
  onOpenSearchResult,
  onOpenTrend,
  canOpenTrend = false,
  actionProps,
}) {
  const coverUrl = buildProxyImageUrl(item?.cover);
  const isMissevanPeak = platform === "missevan" && item?.type === "peak";
  const playCountText = formatRankCompactCount(getViewCountValue(item));
  const growthText = rankKey === "growth_weekly"
    ? formatDelta(item?.view_count_increase)
    : "";
  const searchDramaIds = isMissevanPeak
    ? (Array.isArray(item.drama_ids) ? item.drama_ids : [])
    : item?.id != null
      ? [item.id]
      : [];

  function openSearchResult(options = {}) {
    if (!platform || !searchDramaIds.length) {
      return false;
    }
    return onOpenSearchResult?.({
      platform,
      id: searchDramaIds[0],
      ids: searchDramaIds,
      titles: searchDramaIds.map(() => item.name),
      name: item.name,
      paymentLabel: item?.payment_label || item?.paymentLabel || item?.payStatus || "",
      contentTypeLabel: item?.content_type_label || item?.contentTypeLabel || "",
      usageAction: options.suppressUsageLog ? undefined : "ranks_open_search_result",
      usageSource: "homeview",
      suppressUsageLog: options.suppressUsageLog === true,
    });
  }

  return (
    <div className="relative isolate grid min-w-0 grid-cols-[4rem_minmax(0,1fr)] items-center gap-2 overflow-hidden">
      <RankWatermark rank={item?.rank} placement="row" />
      <div className="home-editorial-rank-cover-stack relative z-10">
        <div className="home-editorial-trend-cover-static">
          <div className="size-16 overflow-hidden rounded-md border border-border bg-muted/55">
            {coverUrl ? (
              <LazyImage alt={item?.name || "剧集封面"} className="size-full object-cover" src={coverUrl} />
            ) : (
              <div className="flex size-full items-center justify-center text-[0.62rem] text-muted-foreground">暂无</div>
            )}
          </div>
        </div>
      </div>
      <div className="relative z-10 min-w-0">
        {searchDramaIds.length ? (
          <button
            type="button"
            className={`${homeRankItemTitleClassName} block w-full rounded-sm text-left underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
            title={item?.name || "未命名剧集"}
            onClick={openSearchResult}
          >
            {item?.name || "未命名剧集"}
          </button>
        ) : (
          <div className={`${homeRankItemTitleClassName} w-full`}>
            {item?.name || "未命名剧集"}
          </div>
        )}
        <div className="mt-0.5 flex min-w-0 items-start gap-1.5 text-xs leading-5 text-muted-foreground">
          <MicIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 break-words">{getMainCvText(item)}</span>
        </div>
        <div
          className="relative mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 pr-12 text-xs leading-5 text-muted-foreground"
          title={`${isMissevanPeak ? "系列总播放量" : "播放量"}：${playCountText}`}
        >
          <PlayCircleIcon aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="min-w-0 break-words tabular-nums">
            {playCountText}
            {growthText ? <span className="home-editorial-delta">（{growthText}）</span> : null}
          </span>
          <HomeMoreMenu
            item={item}
            platform={platform}
            rankKey={rankKey}
            kind={isMissevanPeak ? "peak" : "drama"}
            overlay
            canOpenTrend={canOpenTrend}
            onOpenTrend={onOpenTrend}
            openSearchResult={openSearchResult}
            {...actionProps}
          />
        </div>
      </div>
    </div>
  );
}

function RankCvItem({ item, platform, rankKey, onOpenCv, onOpenTrend, canOpenTrend = false, actionProps }) {
  const avatarUrl = buildProxyImageUrl(item?.avatar);
  const playCountText = formatRankCompactCount(item?.totalViewCount);
  const topWorksText = getHomeCvWorksPreviewText(item?.topWorks || item?.works);
  return (
    <div className="relative isolate grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2 overflow-hidden">
      <RankWatermark rank={item?.rank} placement="row" />
      <div className="relative z-10 size-14 overflow-hidden rounded-full border border-border/70 bg-muted/55">
        {avatarUrl ? (
          <LazyImage alt={item?.cvName || "CV头像"} className="size-full object-cover" src={avatarUrl} />
        ) : (
          <div className="flex size-full items-center justify-center text-xs font-semibold text-muted-foreground">CV</div>
        )}
      </div>
      <div className="relative z-10 min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            className="min-w-0 break-words rounded-sm text-left text-base! font-semibold! leading-6! text-foreground underline underline-offset-4 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            title={item?.cvName || "未命名CV"}
            onClick={() => onOpenCv?.(item?.cvName, {
              platform,
              profileId: buildCvRankProfileId(platform, item),
              source: "ranks",
              rankKey,
            })}
          >
            {item?.cvName || "未命名CV"}
          </button>
          <HomeMoreMenu
            item={item}
            platform={platform}
            rankKey={rankKey}
            kind="cv"
            canOpenTrend={canOpenTrend}
            onOpenTrend={onOpenTrend}
            {...actionProps}
          />
        </div>
        <div
          className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-5 text-muted-foreground"
          title={`播放量：${playCountText}`}
        >
          <PlayCircleIcon aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="min-w-0 break-words tabular-nums">{playCountText}</span>
        </div>
        <div className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground" title={topWorksText}>
          {topWorksText}
        </div>
      </div>
    </div>
  );
}

function HomeRankCard({
  platform,
  rankConfig,
  rank,
  updatedAt,
  onNavigateRoute,
  onOpenSearchResult,
  onOpenCv,
  canOpenTrend,
  onOpenTrend,
  actionProps,
}) {
  const items = (rank?.items || []).slice(0, 3);
  const isCvRank = rankConfig.itemType === "cv";
  const statisticsPeriodText = rankConfig.categoryKey === "growth"
    ? formatHomeStatisticsPeriod(rank?.statisticsPeriod)
    : "";
  return (
    <div className="home-editorial-rank-card">
      <div className="home-editorial-rank-header">
          <h3 className="line-clamp-1 min-w-0" title={rankConfig.displayTitle || rankConfig.title}>
            {rankConfig.displayTitle || rankConfig.title}
          </h3>
          {statisticsPeriodText ? (
            <span className="home-editorial-updated-at">
              统计区间：{statisticsPeriodText}
            </span>
          ) : formatHomeUpdatedLabel(updatedAt) ? (
            <span className="home-editorial-updated-at">
              {formatHomeUpdatedLabel(updatedAt)}
            </span>
          ) : null}
      </div>
      <div className="home-editorial-rank-items">
          {items.length ? (
            items.map((item) =>
              isCvRank ? (
                <RankCvItem
                  key={`${rankConfig.rankKey}-${item.rank}-${item.cvName}`}
                  item={item}
                  platform={platform}
                  rankKey={rankConfig.rankKey}
                  onOpenCv={onOpenCv}
                  onOpenTrend={onOpenTrend}
                  canOpenTrend={canOpenTrend(item, platform, rankConfig.rankKey)}
                  actionProps={actionProps}
                />
              ) : (
                <RankDramaItem
                  key={`${rankConfig.rankKey}-${item.rank}-${item.id || item.name}`}
                  item={item}
                  platform={platform}
                  rankKey={rankConfig.rankKey}
                  onOpenSearchResult={onOpenSearchResult}
                  onOpenTrend={onOpenTrend}
                  canOpenTrend={canOpenTrend(item, platform, rankConfig.rankKey)}
                  actionProps={actionProps}
                />
              )
            )
          ) : (
            <div className="home-editorial-empty">
              <ChartNoAxesColumnIcon aria-hidden="true" className="size-5" />
              <span>暂无榜单数据</span>
            </div>
          )}
      </div>
      <HomeTextLink
        ariaLabel={`查看更多${rankConfig.title}`}
        onClick={() => onNavigateRoute({
          view: "ranks",
          platform,
          category: rankConfig.categoryKey,
          rank: rankConfig.rankKey,
        })}
      >
        查看更多
      </HomeTextLink>
    </div>
  );
}

export function HomeView({
  frontendVersion = "0.0.0",
  handleVersionResponse,
  onNavigateRoute,
  onOpenSearchResult,
  onOpenCv,
  favoriteKeys,
  favoriteActionsDisabled = false,
  statisticsActionsDisabled = false,
  onToggleFavorite,
  onAddCompareItem,
  onStartDramaPaidIdStatistics,
  onStartRevenueEstimate,
}) {
  const handleVersionResponseRef = useRef(handleVersionResponse);
  const [selectedRankPlatform, setSelectedRankPlatform] = useState("missevan");
  const [ongoingByPlatform, setOngoingByPlatform] = useState({ missevan: null, manbo: null });
  const [rankData, setRankData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [trendEligibility, setTrendEligibility] = useState({
    missevan: { ids: new Set(), isLoaded: false },
    manbo: { ids: new Set(), isLoaded: false },
  });
  const [trendDialog, setTrendDialog] = useState({ open: false, item: null, platform: "", rankKey: "" });
  const [trendState, setTrendState] = useState({ isLoading: false, error: "", data: null });
  const trendRequestIdRef = useRef(0);

  useEffect(() => {
    handleVersionResponseRef.current = handleVersionResponse;
  }, [handleVersionResponse]);

  useEffect(() => {
    let cancelled = false;

    async function loadHomeData() {
      const cachedMissevan = getCachedOngoingData({ platform: "missevan", frontendVersion });
      const cachedManbo = getCachedOngoingData({ platform: "manbo", frontendVersion });
      const cachedRanks = getCachedRanksData(frontendVersion);
      if (cachedMissevan?.data?.success || cachedManbo?.data?.success || cachedRanks?.data?.success) {
        setOngoingByPlatform({
          missevan: cachedMissevan?.data || null,
          manbo: cachedManbo?.data || null,
        });
        setRankData(cachedRanks?.data || null);
      }
      setIsLoading(!(cachedMissevan || cachedManbo || cachedRanks));
      setErrorMessage("");

      try {
        const [missevanOngoingResult, manboOngoingResult, ranksResult] = await Promise.allSettled([
          fetchOngoingData({ platform: "missevan", frontendVersion, revalidate: true }),
          fetchOngoingData({ platform: "manbo", frontendVersion, revalidate: true }),
          fetchRanksData(frontendVersion, { revalidate: true }),
        ]);
        logRejectedHomePayload("missevan ongoing", missevanOngoingResult);
        logRejectedHomePayload("manbo ongoing", manboOngoingResult);
        logRejectedHomePayload("ranks", ranksResult);

        const missevanOngoing = getSettledPayload(missevanOngoingResult);
        const manboOngoing = getSettledPayload(manboOngoingResult);
        const ranks = getSettledPayload(ranksResult);

        [missevanOngoing, manboOngoing, ranks].filter(Boolean).forEach((payload) => {
          handleVersionResponseRef.current?.({
            ...payload.data,
            backendVersion: getBackendVersionFromResponse(payload.response, payload.data),
            frontendVersion,
          });
        });
        if (cancelled) {
          return;
        }
        const nextOngoingByPlatform = {
          missevan: missevanOngoing?.response?.ok && missevanOngoing?.data?.success
            ? missevanOngoing.data
            : cachedMissevan?.data?.success
              ? cachedMissevan.data
              : null,
          manbo: manboOngoing?.response?.ok && manboOngoing?.data?.success
            ? manboOngoing.data
            : cachedManbo?.data?.success
              ? cachedManbo.data
              : null,
        };
        const nextRankData = ranks?.response?.ok && ranks?.data?.success ? ranks.data : cachedRanks?.data?.success ? cachedRanks.data : null;
        setOngoingByPlatform(nextOngoingByPlatform);
        setRankData(nextRankData);
        if (!nextOngoingByPlatform.missevan && !nextOngoingByPlatform.manbo && !nextRankData) {
          setErrorMessage("首页数据暂不可用，请稍后重试。");
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load home data", error);
          if (!cachedMissevan?.data?.success && !cachedManbo?.data?.success && !cachedRanks?.data?.success) {
            setErrorMessage("首页数据暂不可用，请稍后重试。");
          }
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadHomeData();
    return () => {
      cancelled = true;
    };
  }, [frontendVersion]);

  const ongoingItems = useMemo(() => {
    return {
      missevan: sortOngoingItemsByWindowDelta(ongoingByPlatform.missevan?.items || [], "7d").slice(0, 3),
      manbo: sortOngoingItemsByWindowDelta(ongoingByPlatform.manbo?.items || [], "7d").slice(0, 3),
    };
  }, [ongoingByPlatform.missevan?.items, ongoingByPlatform.manbo?.items]);

  const ongoingCounts = useMemo(() => ({
    missevan: ongoingByPlatform.missevan?.items?.length || 0,
    manbo: ongoingByPlatform.manbo?.items?.length || 0,
  }), [ongoingByPlatform.missevan?.items, ongoingByPlatform.manbo?.items]);

  const activeRankConfigs = useMemo(
    () => HOME_RANK_CONFIG[selectedRankPlatform] || [],
    [selectedRankPlatform]
  );
  const trendIdsByPlatform = useMemo(() => {
    const ids = {
      missevan: new Set(ongoingItems.missevan.map((item) => String(item?.id ?? "").trim()).filter(Boolean)),
      manbo: new Set(ongoingItems.manbo.map((item) => String(item?.id ?? "").trim()).filter(Boolean)),
    };
    activeRankConfigs.forEach((rankConfig) => {
      if (rankConfig.itemType === "cv") {
        return;
      }
      const rank = getRankByConfig(rankData, selectedRankPlatform, rankConfig);
      (rank?.items || []).slice(0, 3).forEach((item) => {
        const lookup = getHomeTrendLookup(item, selectedRankPlatform, rankConfig.rankKey);
        if (lookup.id && !lookup.isMissevanPeak) {
          ids[selectedRankPlatform].add(lookup.id);
        }
      });
    });
    return {
      missevan: Array.from(ids.missevan).sort(),
      manbo: Array.from(ids.manbo).sort(),
    };
  }, [activeRankConfigs, ongoingItems.manbo, ongoingItems.missevan, rankData, selectedRankPlatform]);
  const missevanTrendLookupKey = trendIdsByPlatform.missevan.join("|");
  const manboTrendLookupKey = trendIdsByPlatform.manbo.join("|");

  useEffect(() => {
    let cancelled = false;
    const requests = [
      ["missevan", missevanTrendLookupKey.split("|").filter(Boolean)],
      ["manbo", manboTrendLookupKey.split("|").filter(Boolean)],
    ];

    requests.forEach(([platform, ids]) => {
      if (!ids.length) {
        setTrendEligibility((current) => ({
          ...current,
          [platform]: { ids: new Set(), isLoaded: true },
        }));
        return;
      }
      setTrendEligibility((current) => ({
        ...current,
        [platform]: { ids: current[platform]?.ids || new Set(), isLoaded: false },
      }));
      fetchRankTrendAvailabilityData({ platform, ids, frontendVersion })
        .then(({ response, data } = {}) => {
          if (cancelled) {
            return;
          }
          setTrendEligibility((current) => ({
            ...current,
            [platform]: {
              ids: response?.ok && data?.success
                ? new Set((Array.isArray(data.ids) ? data.ids : []).map((id) => String(id)))
                : new Set(),
              isLoaded: true,
            },
          }));
        })
        .catch((error) => {
          if (!cancelled) {
            console.error(`Failed to load home ${platform} trend availability`, error);
            setTrendEligibility((current) => ({
              ...current,
              [platform]: { ids: new Set(), isLoaded: true },
            }));
          }
        });
    });

    return () => {
      cancelled = true;
    };
  }, [frontendVersion, manboTrendLookupKey, missevanTrendLookupKey]);

  function canOpenHomeTrend(item, platform, rankKey = "") {
    const lookup = getHomeTrendLookup(item, platform, rankKey);
    if (!lookup.id) {
      return false;
    }
    if (lookup.isCvRank) {
      return true;
    }
    if (lookup.isMissevanPeak) {
      return lookup.canUseSeriesTrend;
    }
    const eligibility = trendEligibility[platform];
    return Boolean(eligibility?.isLoaded && eligibility.ids.has(lookup.id));
  }

  async function openHomeTrend({ item, platform, rankKey = "" }) {
    if (!canOpenHomeTrend(item, platform, rankKey)) {
      return;
    }
    const lookup = getHomeTrendLookup(item, platform, rankKey);
    const trendItem = lookup.isCvRank
      ? { id: lookup.id, name: lookup.id }
      : lookup.isMissevanPeak
        ? { ...item, id: lookup.id }
        : item;
    const trendPlatform = lookup.isCvRank ? "cv" : platform;
    const requestId = trendRequestIdRef.current + 1;
    trendRequestIdRef.current = requestId;
    setTrendDialog({ open: true, item: trendItem, platform: trendPlatform, rankKey });
    logRankTrendOpen({
      platform: trendPlatform,
      id: lookup.id,
      name: lookup.isCvRank ? item?.cvName : item?.name,
      source: "homeview",
      rankKey: lookup.isCvRank ? (item?.trendScope === "paid" ? "cv-paid" : "cv") : rankKey,
      frontendVersion,
    });
    setTrendState((current) => ({
      ...current,
      isLoading: !current.data || String(current.data?.id ?? "") !== lookup.id,
      error: "",
    }));
    try {
      const { response, data } = await fetchRankTrendData({
        platform: lookup.isCvRank ? "" : platform,
        id: lookup.id,
        kind: lookup.isCvRank ? "cv" : "",
        frontendVersion,
      });
      if (trendRequestIdRef.current !== requestId) {
        return;
      }
      handleVersionResponseRef.current?.({
        ...data,
        backendVersion: getBackendVersionFromResponse(response, data),
        frontendVersion,
      });
      if (!response.ok || !data?.success) {
        setTrendState({ isLoading: false, error: data?.message || "趋势数据暂不可用。", data: null });
        return;
      }
      setTrendState({ isLoading: false, error: "", data });
    } catch (error) {
      console.error("Failed to load home trend", error);
      if (trendRequestIdRef.current === requestId) {
        setTrendState({ isLoading: false, error: "趋势数据暂不可用。", data: null });
      }
    }
  }

  const hasVisibleContent = Boolean(
    ongoingByPlatform.missevan?.items?.length ||
    ongoingByPlatform.manbo?.items?.length ||
    rankData
  );

  return (
    <div className="home-editorial" aria-busy={isLoading}>
      {isLoading && !hasVisibleContent ? <HomeSkeleton /> : null}
      {!isLoading && errorMessage ? (
        <Alert className="home-editorial-error">
          <AlertTitle>首页暂不可用</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {!isLoading || hasVisibleContent ? (
        <>
      <section className="home-editorial-section home-editorial-section-first">
        <div className="home-editorial-section-header">
          <SectionHeader
            title="一周内更新"
            description="按近七日播放量增量排列"
            sectionIcon={CalendarClockIcon}
          />
        </div>

        <div className="home-editorial-updates-grid">
            <OngoingPlatformList
              platform="missevan"
              items={ongoingItems.missevan}
              totalCount={ongoingCounts.missevan}
              updatedAt={ongoingByPlatform.missevan?.updatedAt}
              onNavigateRoute={onNavigateRoute}
              onOpenSearchResult={onOpenSearchResult}
              canOpenTrend={canOpenHomeTrend}
              onOpenTrend={openHomeTrend}
              actionProps={{ favoriteKeys, favoriteActionsDisabled, statisticsActionsDisabled, onToggleFavorite, onAddCompareItem, onStartDramaPaidIdStatistics, onStartRevenueEstimate, frontendVersion }}
            />
            <OngoingPlatformList
              platform="manbo"
              items={ongoingItems.manbo}
              totalCount={ongoingCounts.manbo}
              updatedAt={ongoingByPlatform.manbo?.updatedAt}
              onNavigateRoute={onNavigateRoute}
              onOpenSearchResult={onOpenSearchResult}
              canOpenTrend={canOpenHomeTrend}
              onOpenTrend={openHomeTrend}
              actionProps={{ favoriteKeys, favoriteActionsDisabled, statisticsActionsDisabled, onToggleFavorite, onAddCompareItem, onStartDramaPaidIdStatistics, onStartRevenueEstimate, frontendVersion }}
            />
        </div>
      </section>

      <section className="home-editorial-section">
        <div className="home-editorial-section-header home-editorial-ranks-header">
          <SectionHeader
            title="榜单速览"
            sectionIcon={ChartNoAxesColumnIcon}
          />
          <PlatformTabs value={selectedRankPlatform} onValueChange={setSelectedRankPlatform} ariaLabel="选择榜单平台" />
        </div>
        <Carousel
          className="home-editorial-ranks-carousel"
          opts={{ align: "start", loop: false }}
          aria-label={`${platformMeta[selectedRankPlatform].label}榜单速览`}
        >
          <CarouselContent className="-ml-3">
            {activeRankConfigs.map((rankConfig) => {
              const rank = getRankByConfig(rankData, selectedRankPlatform, rankConfig);
              return (
                <CarouselItem
                  key={`${selectedRankPlatform}-${rankConfig.categoryKey}-${rankConfig.rankKey}`}
                  className="flex basis-full pl-3 sm:basis-1/2 lg:basis-1/3"
                >
                  <HomeRankCard
                    platform={selectedRankPlatform}
                    rankConfig={rankConfig}
                    rank={rank}
                    updatedAt={resolveRankRefreshAt(rankData, rankConfig.categoryKey, rank)}
                    onNavigateRoute={onNavigateRoute}
                    onOpenSearchResult={onOpenSearchResult}
                    onOpenCv={onOpenCv}
                    canOpenTrend={canOpenHomeTrend}
                    onOpenTrend={openHomeTrend}
                    actionProps={{ favoriteKeys, favoriteActionsDisabled, statisticsActionsDisabled, onToggleFavorite, onAddCompareItem, onStartDramaPaidIdStatistics, onStartRevenueEstimate, frontendVersion }}
                  />
                </CarouselItem>
              );
            })}
          </CarouselContent>
          <CarouselPrevious className="left-2" />
          <CarouselNext className="right-2" />
        </Carousel>
      </section>
        </>
      ) : null}
      {trendDialog.open ? (
        <LazyRankTrendDialog
          open={trendDialog.open}
          onOpenChange={(open) => setTrendDialog((current) => ({ ...current, open }))}
          item={trendDialog.item}
          platform={trendDialog.platform}
          trendState={trendState}
          frontendVersion={frontendVersion}
          handleVersionResponse={handleVersionResponse}
          fallback={
            <Alert className="border-border/70 bg-card/92">
              <RefreshCwIcon className="size-4 animate-spin" />
              <AlertTitle>正在加载趋势</AlertTitle>
              <AlertDescription>正在准备趋势图表。</AlertDescription>
            </Alert>
          }
        />
      ) : null}
    </div>
  );
}
