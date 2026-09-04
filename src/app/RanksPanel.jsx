import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRightIcon,
  BeanIcon,
  CalendarDaysIcon,
  ChevronDownIcon,
  CoinsIcon,
  GemIcon,
  HandCoinsIcon,
  HeartIcon,
  InfoIcon,
  MicIcon,
  MoreHorizontalIcon,
  PlayCircleIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  ShoppingCartIcon,
  StarIcon,
  TrendingUpIcon,
  TrophyIcon,
  UserSearchIcon,
  UsersRoundIcon,
} from "lucide-react";

import {
  buildCvRankProfileId,
  buildRankPlatformSwitchRoutePatch,
  buildVersionedUrl,
  formatDeviceDateTime,
  formatPlainNumber,
  formatRankCardMetricValue,
  formatRankCompactCount,
  formatSignedRankCardMetricValue,
  getBackendVersionFromResponse,
  getInlineTaggedTitleDisplayText,
} from "@/app/app-utils";
import { PlatformDramaLink, PlatformIdIcon, PlatformTabLabel } from "@/app/platformTabLabel";
import { LazyRankTrendDialog } from "@/app/LazyRankTrendDialog";
import { RankWatermark } from "@/app/RankBadge";
import { fetchRanksData, getCachedRanksData, resolveRankRefreshAt } from "@/app/ranksData";
import {
  fetchRankTrendAvailabilityData,
  resolveRankTrendAvailabilityIds,
} from "@/app/rankTrendData";
import { isSkippedDanmakuMetricValue } from "../../shared/rankMetricUtils.js";
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
} from "@/app/rankTrendActions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LazyImage } from "@/components/ui/lazy-image";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

function buildProxyImageUrl(url) {
  return url ? `/image-proxy?url=${encodeURIComponent(url)}` : "";
}

const mobilePlatformTabsListClassName =
  "inline-flex h-9 min-h-9 w-fit max-w-full justify-start";
const mobilePlatformTabClassName =
  "relative h-7 min-h-7 min-w-0 px-3 text-sm!";
const mobileTextTabsListClassName =
  "grid h-9 min-h-9 w-full justify-stretch";
const mobileCategoryTabClassName =
  "h-7 min-h-7 min-w-11 justify-center px-2 text-sm!";
const mobileRankTabClassName =
  "h-7 min-h-7 min-w-11 justify-center px-2 text-xs!";
const mobileSelectedTabClassName = "";
const mobileSelectedPlatformTabClassName = "";
const desktopTextTabsListClassName =
  "inline-flex h-9 min-h-9 w-fit justify-start";
const desktopTextTabClassName =
  "h-7 min-h-7 min-w-0 px-3 text-sm!";
const desktopSelectedTabClassName = mobileSelectedTabClassName;
const desktopSelectedPlatformTabClassName = `${desktopSelectedTabClassName} [&_.platform-tab-label-text]:font-bold!`;
const desktopRankToolbarClassName = "hidden min-w-0 items-center gap-3 lg:flex lg:flex-nowrap";
const desktopRankControlsClassName = "flex shrink-0 items-center gap-3";

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

function MetricLegend({ variant = "default", className = "" }) {
  const isCompact = variant === "compact";
  return (
    <div
      aria-label="榜单图标图例"
      className={`${
        isCompact
          ? "min-w-0 rounded-md border border-border/65 bg-card/92 px-2.5 py-1.5 shadow-none"
          : "rounded-lg border border-border bg-card px-3 py-2 shadow-[var(--shadow-card)]"
      } ${className}`}
    >
      <div
        className={`flex items-center text-muted-foreground ${
          isCompact
            ? "w-max min-w-full flex-nowrap justify-end gap-x-2 text-[0.64rem] leading-4"
            : "flex-wrap gap-x-2.5 gap-y-1 text-[0.68rem] leading-5"
        }`}
      >
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

function isWeeklyGrowthRankKey(rankKey) {
  return ["growth_weekly", "growth_monthly"].includes(String(rankKey ?? "").trim());
}

function formatRankStatisticsPeriod(period) {
  const startDate = String(period?.startDate ?? "").trim();
  const endDate = String(period?.endDate ?? "").trim();
  return startDate && endDate ? `${startDate} 至 ${endDate}` : "";
}

function RankInfoPopover({ infoText }) {
  if (!infoText) {
    return null;
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="ml-1 inline-flex align-middle text-muted-foreground hover:text-primary"
          aria-label="查看榜单说明"
        >
          <InfoIcon aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="right"
        sideOffset={8}
        avoidCollisions
        collisionPadding={12}
        sticky="always"
        className="max-h-[min(16rem,calc(100vh-2rem))] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md bg-popover p-3 text-xs leading-5 shadow-[var(--shadow-panel)]"
        style={{
          width: "min(clamp(12rem,60vw,18rem),calc(100vw - 2rem))",
          maxWidth: "calc(100vw - 2rem)",
        }}
      >
        <p className="text-muted-foreground">{infoText}</p>
      </PopoverContent>
    </Popover>
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
    if (
      item.type !== "peak" &&
      item.danmaku_uid_count != null &&
      !isSkippedDanmakuMetricValue(item.danmaku_uid_count)
    ) {
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
  if (
    rankKey !== "peak" &&
    item.danmaku_uid_count != null &&
    !isSkippedDanmakuMetricValue(item.danmaku_uid_count)
  ) {
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

const rankActionButtonClassName =
  "relative h-8 min-h-8 min-w-11 shrink-0 justify-center gap-1 rounded-[calc(var(--radius)-0.12rem)] px-2 text-xs! after:absolute after:inset-x-0 after:-inset-y-1.5 after:rounded-md after:content-['']";

function useMeasuredActionMode({ peak = false } = {}) {
  const containerRef = useRef(null);
  const trendButtonRef = useRef(null);
  const compareButtonRef = useRef(null);
  const moreButtonRef = useRef(null);
  const [mode, setMode] = useState(peak ? "more-icon" : "more-only");

  useLayoutEffect(() => {
    const container = containerRef.current;
    const trend = trendButtonRef.current;
    const compare = compareButtonRef.current;
    const more = moreButtonRef.current;
    if (!container || !trend || !compare || !more) return undefined;
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const available = container.getBoundingClientRect().width;
      const gap = Number.parseFloat(window.getComputedStyle(container).columnGap) || 0;
      const allWidth = trend.getBoundingClientRect().width + compare.getBoundingClientRect().width + gap;
      const moreWidth = more.getBoundingClientRect().width;
      const next = peak
        ? available + 0.5 >= allWidth ? "all" : available + 0.5 >= moreWidth ? "more-label" : "more-icon"
        : available + 0.5 >= allWidth + moreWidth + gap ? "all" : available + 0.5 >= trend.getBoundingClientRect().width + moreWidth + gap ? "trend-more" : "more-only";
      setMode((current) => current === next ? current : next);
    };
    requestAnimationFrame(measure);
    document.fonts?.ready?.then(() => {
      if (!cancelled) measure();
    });
    if (typeof ResizeObserver === "undefined") {
      return () => {
        cancelled = true;
      };
    }
    const observer = new ResizeObserver(measure);
    [container, trend, compare, more].forEach((node) => observer.observe(node));
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [peak]);

  return { containerRef, trendButtonRef, compareButtonRef, moreButtonRef, mode };
}

function PeakRankFourthRow({ item, canShowTrend, onOpenTrend, onAddCompareItem, className = "" }) {
  const layout = useMeasuredActionMode({ peak: true });
  const mode = layout.mode;
  const dailyMetric = {
    key: "view_count",
    available: Boolean(item.daily_view_delta?.available),
    delta: item.daily_view_delta?.delta ?? null,
  };
  return (
    <div className={`flex min-w-0 items-center gap-2 text-xs ${className}`.trim()}>
      <div className="flex shrink-0 items-center gap-1 text-foreground" aria-label={`系列总播放量: ${formatPlainNumber(item.view_count)}`} title={`系列总播放量: ${formatPlainNumber(item.view_count)}`}>
        <PlayCircleIcon aria-hidden="true" className={metaIconClassName} />
        <span className="tabular-nums">{formatRankCardMetricValue(item.view_count)}</span>
      </div>
      <RankTrendDeltaBadge metric={dailyMetric} className="h-6 shrink-0 px-1.5 text-[0.68rem]">
        日增：{formatRankTrendDelta(dailyMetric)}
      </RankTrendDeltaBadge>
      <div ref={layout.containerRef} className="relative flex min-w-0 flex-1 flex-nowrap items-center justify-end gap-2">
        <span ref={layout.moreButtonRef} aria-hidden="true" className={`${rankActionButtonClassName} pointer-events-none invisible absolute inline-flex items-center`}>
          <MoreHorizontalIcon className="size-4" />
          <span className="whitespace-nowrap">更多</span>
        </span>
        <RankTrendButton ref={layout.trendButtonRef} appearance="link" density="inline" className={mode === "all" ? "" : "pointer-events-none invisible absolute"} disabled={!canShowTrend} aria-hidden={mode === "all" ? undefined : true} tabIndex={mode === "all" ? undefined : -1} onClick={onOpenTrend} aria-label={`查看${item.name}趋势`} title={canShowTrend ? "查看趋势" : "暂无趋势数据"} />
        <CompareActionButton ref={layout.compareButtonRef} appearance="link" density="inline" className={mode === "all" ? "" : "pointer-events-none invisible absolute"} disabled={!canShowTrend || !onAddCompareItem} aria-hidden={mode === "all" ? undefined : true} tabIndex={mode === "all" ? undefined : -1} onClick={onAddCompareItem} aria-label={`加入${item.name}对比`} title={canShowTrend ? "加入对比" : "暂无趋势数据"} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" data-touch="compact" className={`${rankActionButtonClassName} ${mode === "all" ? "pointer-events-none invisible absolute" : ""}`} aria-hidden={mode === "all" ? true : undefined} tabIndex={mode === "all" ? -1 : undefined} aria-label={`${item.name}更多操作`} title="更多操作">
              <MoreHorizontalIcon data-icon="inline-start" />
              {mode !== "more-icon" ? <span className="whitespace-nowrap">更多</span> : null}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={!canShowTrend} onSelect={onOpenTrend}><TrendingUpIcon aria-hidden="true" />趋势</DropdownMenuItem>
            <DropdownMenuItem disabled={!canShowTrend || !onAddCompareItem} onSelect={onAddCompareItem}><ArrowLeftRightIcon aria-hidden="true" />对比</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
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
  statisticsActionsDisabled = false,
  onToggleFavorite,
  onAddCompareItem,
  onStartDramaPaidIdStatistics,
  onStartRevenueEstimate,
  trendAvailable = false,
}) {
  const coverUrl = buildProxyImageUrl(item.cover);
  const isMissevanPeak = platform === "missevan" && item.type === "peak";
  const isWeeklyGrowth = isWeeklyGrowthRankKey(rankKey);
  const metrics = isMissevanPeak || isWeeklyGrowth ? [] : getRankMetrics(platform, item, rankKey);
  const dramaIdText = Array.isArray(item.drama_ids) && item.drama_ids.length ? item.drama_ids.join("，") : "";
  const detailIdText = isMissevanPeak ? dramaIdText : String(item.id ?? "");
  const paymentTag = getRankPaymentTag(item);
  const titleTags = getRankTitleTags(item);
  const displayTitle = getInlineTaggedTitleDisplayText(item.name, { hasTags: titleTags.length > 0, viewport: "desktop" });
  const searchDramaIds = isMissevanPeak ? (Array.isArray(item.drama_ids) ? item.drama_ids : []) : item.id != null ? [item.id] : [];
  const trendLookupId = isMissevanPeak ? item.name : item.id;
  const favoriteDramaId = String(searchDramaIds[0] ?? item.id ?? "").trim();
  const favoriteKey = favoriteDramaId ? `${platform}:${favoriteDramaId}` : "";
  const isFavorite = Boolean(favoriteKey && favoriteKeys?.has?.(favoriteKey));
  const canToggleFavorite = !isMissevanPeak && Boolean(favoriteDramaId);
  const canOpenSearchResult = Boolean(onOpenSearchResult && searchDramaIds.length);
  const canShowTrend = canShowRankTrend({ platform, rankKey, item, isMissevanPeak, detailIdText: trendLookupId }) && (isMissevanPeak || trendAvailable);
  const mainCvText = String(item.main_cv_text ?? "").replace(/^主要CV：/, "");
  const trendItem = isMissevanPeak ? { ...item, id: trendLookupId } : item;
  const [isTrendOpen, setIsTrendOpen] = useState(false);
  const [statisticsActionPending, setStatisticsActionPending] = useState("");
  const statisticsActionLockRef = useRef(false);
  const [trendState, setTrendState] = useState({ isLoading: false, error: "", data: null });
  const normalLayout = useMeasuredActionMode();

  async function openTrendDialog() {
    if (!canShowTrend) return;
    setIsTrendOpen(true);
    logRankTrendOpen({ platform, id: trendLookupId, name: item.name, source: "ranks", rankKey, frontendVersion });
    setTrendState((current) => ({ ...current, isLoading: !current.data, error: "" }));
    try {
      const { response, data } = await fetchSharedRankTrendData({ platform, id: trendLookupId, frontendVersion });
      handleVersionResponse?.({ ...data, backendVersion: getBackendVersionFromResponse(response, data), frontendVersion });
      setTrendState(response.ok && data?.success
        ? { isLoading: false, error: "", data }
        : { isLoading: false, error: data?.message || "趋势数据暂不可用。", data: null });
    } catch (error) {
      console.error("Failed to load rank trend", error);
      setTrendState({ isLoading: false, error: "趋势数据暂不可用。", data: null });
    }
  }

  function openSearchResult(options = {}) {
    if (!canOpenSearchResult) return false;
    return onOpenSearchResult?.({
      platform,
      id: searchDramaIds[0],
      ids: searchDramaIds,
      titles: searchDramaIds.map(() => item.name),
      name: item.name,
      paymentLabel: paymentTag,
      contentTypeLabel: titleTags[0],
      usageAction: options.suppressUsageLog ? undefined : "ranks_open_search_result",
      suppressUsageLog: options.suppressUsageLog === true,
    });
  }

  function toggleFavorite() {
    if (!canToggleFavorite) return;
    onToggleFavorite?.({ platform, dramaId: favoriteDramaId, title: item.name, cover: item.cover || "", paymentLabel: paymentTag, contentTypeLabel: titleTags[0] || "", dramaUpdatedAt: item.updated_at || "", mainCvText: item.main_cv_text || "", source: "ranks" });
  }

  function addCompareItem() {
    if (!canShowTrend) return;
    onAddCompareItem?.({ platform, id: String(trendLookupId ?? "").trim(), title: isMissevanPeak ? `系列：${item.name || ""}` : item.name || "", cover: item.cover || "", mainCvText: item.main_cv_text || "", compareKind: isMissevanPeak ? "peak_series" : "drama", dramaIds: isMissevanPeak ? searchDramaIds : [] });
  }

  function logStatisticsMenuClick(action) {
    fetch(buildVersionedUrl("/usage-log", frontendVersion), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform, action, dramaId: favoriteDramaId, dramaName: item.name || "", source: "ranks", success: true }),
      keepalive: true,
    }).catch((error) => console.error("Failed to log rank statistics action", error));
  }

  async function runStatisticsAction(action) {
    if (statisticsActionsDisabled || statisticsActionLockRef.current || !canOpenSearchResult) return;
    const isPaidIdAction = action === "paid_id_click";
    const startStatistics = isPaidIdAction ? onStartDramaPaidIdStatistics : onStartRevenueEstimate;
    if (!startStatistics) return;
    statisticsActionLockRef.current = true;
    setStatisticsActionPending(action);
    logStatisticsMenuClick(action);
    try {
      const opened = await openSearchResult({ suppressUsageLog: true });
      if (!opened) return;
      if (isPaidIdAction) await startStatistics(favoriteDramaId, { platform, source: `${favoriteDramaId}payID` });
      else await startStatistics([favoriteDramaId], { platform, source: `${favoriteDramaId}earn` });
    } finally {
      statisticsActionLockRef.current = false;
      setStatisticsActionPending("");
    }
  }

  function renderTitle() {
    const content = <><span>{displayTitle}</span>{titleTags.map((label) => <Badge key={`${item.rank}-${item.id || item.name}-${label}`} variant={rankTagVariants[label] || "outline"} className={mobileInlineBadgeClassName}>{label}</Badge>)}</>;
    return canOpenSearchResult ? (
      <button type="button" className={`line-clamp-2 min-w-0 break-words rounded-sm text-left text-foreground underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${getTitleClassName(item.name)}`} onClick={() => openSearchResult()} title={item.name}>{content}</button>
    ) : <div className={`line-clamp-2 min-w-0 break-words text-foreground ${getTitleClassName(item.name)}`} title={item.name}>{content}</div>;
  }

  function renderTrendButton(ref, visible = true) {
    return <RankTrendButton ref={ref} density="inline" className={visible ? "" : "pointer-events-none invisible absolute"} disabled={!canShowTrend} aria-hidden={visible ? undefined : true} tabIndex={visible ? undefined : -1} onClick={openTrendDialog} aria-label={`查看${item.name}趋势`} title={canShowTrend ? "查看趋势" : "暂无趋势数据"} />;
  }

  function renderCompareButton(ref, visible = true) {
    return <CompareActionButton ref={ref} density="inline" className={visible ? "" : "pointer-events-none invisible absolute"} disabled={!canShowTrend || !onAddCompareItem} aria-hidden={visible ? undefined : true} tabIndex={visible ? undefined : -1} onClick={addCompareItem} aria-label={`加入${item.name}对比`} title={canShowTrend ? "加入对比" : "暂无趋势数据"} />;
  }

  function renderNormalActions() {
    const mode = normalLayout.mode;
    return (
      <div ref={normalLayout.containerRef} className="relative flex min-w-0 flex-1 flex-nowrap items-center justify-end gap-2">
        {renderTrendButton(normalLayout.trendButtonRef, mode !== "more-only")}
        {renderCompareButton(normalLayout.compareButtonRef, mode === "all")}
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button ref={normalLayout.moreButtonRef} type="button" variant="outline" data-touch="compact" className={rankActionButtonClassName} aria-label={`${item.name}更多操作`} title="更多操作"><MoreHorizontalIcon data-icon="inline-start" /><span className="whitespace-nowrap">更多</span></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {mode === "more-only" ? <DropdownMenuItem disabled={!canShowTrend} onSelect={openTrendDialog}><TrendingUpIcon aria-hidden="true" />趋势</DropdownMenuItem> : null}
            {mode !== "all" ? <DropdownMenuItem disabled={!canShowTrend || !onAddCompareItem} onSelect={addCompareItem}><ArrowLeftRightIcon aria-hidden="true" />对比</DropdownMenuItem> : null}
            <DropdownMenuItem disabled={favoriteActionsDisabled} onSelect={toggleFavorite}><StarIcon aria-hidden="true" className={isFavorite ? "fill-primary text-primary" : ""} />{isFavorite ? "取消收藏" : "收藏"}</DropdownMenuItem>
            <DropdownMenuItem disabled={statisticsActionsDisabled || Boolean(statisticsActionPending)} onSelect={() => runStatisticsAction("paid_id_click")}><UserSearchIcon aria-hidden="true" />付费ID</DropdownMenuItem>
            <DropdownMenuItem disabled={statisticsActionsDisabled || Boolean(statisticsActionPending)} onSelect={() => runStatisticsAction("revenue_click")}><HandCoinsIcon aria-hidden="true" />收益</DropdownMenuItem>
            <DropdownMenuItem asChild><PlatformDramaLink appearance="menu" platform={platform} dramaId={favoriteDramaId} source="ranks" dramaTitle={item.name} frontendVersion={frontendVersion} /></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  return (
    <Card className="relative isolate overflow-hidden py-3">
      <RankWatermark rank={item.rank} />
      <CardContent className="relative z-10 px-3.5">
        <div className={`grid min-w-0 items-center gap-3 ${isMissevanPeak ? "grid-cols-[5rem_minmax(0,1fr)] lg:grid-cols-[6rem_minmax(0,1fr)]" : "grid-cols-[6rem_minmax(0,1fr)]"}`}>
          <div className={`relative shrink-0 self-center overflow-hidden rounded-[calc(var(--radius)-0.05rem)] border border-border/70 bg-muted/50 ${isMissevanPeak ? "size-20 lg:size-24" : "size-24"}`}>
            {coverUrl ? <LazyImage alt={item.name} className="size-full object-cover" src={coverUrl} /> : <div className="flex size-full items-center justify-center text-xs text-muted-foreground">暂无封面</div>}
            {paymentTag ? <Badge variant={rankTagVariants[paymentTag] || "outline"} className={coverPaymentBadgeClassName}>{paymentTag}</Badge> : null}
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            {renderTitle()}
            {detailIdText ? <div className="flex min-w-0 items-start gap-1.5 text-xs leading-5 text-muted-foreground" aria-label={`作品ID：${detailIdText}`} title={`作品ID：${detailIdText}`}><PlatformIdIcon aria-hidden="true" className={`${metaIconClassName} mt-[3px]`} platform={platform} tone="inherit" /><span className="min-w-0 break-all">{detailIdText}</span></div> : null}
            <div className="flex min-w-0 items-start gap-1.5 text-xs leading-5 text-muted-foreground"><MicIcon aria-label="主要CV" className={`${metaIconClassName} mt-[3px]`} title="主要CV" /><span className="min-w-0 break-words">{mainCvText || "暂无"}</span></div>
            {isWeeklyGrowth ? <div className="flex min-w-0 items-start gap-1.5 text-xs leading-5 text-muted-foreground" title={`上线时间：${item.create_time || "暂无"}`}><CalendarDaysIcon aria-label="上线时间" className={`${metaIconClassName} mt-[3px]`} title="上线时间" /><span className="min-w-0 break-words">{item.create_time || "暂无"}</span></div> : null}
            {!isMissevanPeak && !isWeeklyGrowth && formatRankUpdatedDate(item.updated_at) ? <div className="flex min-w-0 items-center gap-1.5 text-xs leading-5 text-muted-foreground"><RefreshCwIcon aria-label="最近更新" className={metaIconClassName} title="最近更新" /><span>{formatRankUpdatedDate(item.updated_at)}</span></div> : null}
            {isMissevanPeak ? <PeakRankFourthRow item={item} canShowTrend={canShowTrend} onOpenTrend={openTrendDialog} onAddCompareItem={addCompareItem} className="hidden lg:flex" /> : null}
          </div>
        </div>
        {isMissevanPeak ? <PeakRankFourthRow item={item} canShowTrend={canShowTrend} onOpenTrend={openTrendDialog} onAddCompareItem={addCompareItem} className="mt-3 lg:hidden" /> : isWeeklyGrowth ? (
          <div className="mt-3 flex min-h-8 min-w-0 items-center gap-2">
            <div className="flex min-w-0 shrink items-center gap-1.5 text-sm text-foreground" aria-label={`最新播放量：${formatPlainNumber(item.view_count)}`} title={`最新播放量：${formatPlainNumber(item.view_count)}`}>
              <PlayCircleIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="shrink-0 tabular-nums">{formatRankCardMetricValue(item.view_count)}</span>
              <span className="shrink-0 font-bold tabular-nums text-[var(--accent-success)]" title={`播放量增量：${formatSignedRankCardMetricValue(item.view_count_increase)}`}>
                （{formatSignedRankCardMetricValue(item.view_count_increase)}）
              </span>
            </div>
            {renderNormalActions()}
          </div>
        ) : (
          <>
            {metrics.length ? <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">{metrics.map((metric) => {
              const rawValue = metric.label === "总播放量" ? item.view_count : metric.label === "追剧数" || metric.label === "收藏数" ? item.subscription_num : metric.label === "打赏人数" ? item.reward_num : metric.label === "打赏榜总和" ? item.reward_total : metric.label === "付费集弹幕ID数" ? item.danmaku_uid_count : metric.label === "投喂总数" ? item.diamond_value : metric.label === "购买人数/收听人数" ? item.pay_count : item.rank_value;
              const displayValue = ["付费集弹幕ID数", "购买人数/收听人数"].includes(metric.label) ? formatPlainNumber(rawValue) : formatRankCardMetricValue(rawValue);
              return <div key={`${item.id}-${metric.label}`} className="flex min-w-0 items-center gap-1 text-foreground" aria-label={`${metric.label}: ${formatPlainNumber(rawValue)}`} title={`${metric.label}: ${formatPlainNumber(rawValue)}`}><MetricIcon label={metric.iconLabel || metric.label} className="size-3.5 shrink-0 text-muted-foreground" />{metric.iconLabel === "排行值" && metric.label !== "排行值" ? <span className="shrink-0 text-[0.68rem] text-muted-foreground">{metric.label}</span> : null}<span className="tabular-nums">{displayValue}</span></div>;
            })}</div> : null}
            <div className="mt-2 flex min-h-8 min-w-0 justify-end">{renderNormalActions()}</div>
          </>
        )}
        {canShowTrend && isTrendOpen ? <LazyRankTrendDialog open={isTrendOpen} onOpenChange={setIsTrendOpen} item={trendItem} platform={platform} trendState={trendState} frontendVersion={frontendVersion} handleVersionResponse={handleVersionResponse} /> : null}
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

function CvWorksList({ works = [], platform, frontendVersion = "0.0.0", onOpenSearchResult }) {
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
      <div className="max-h-[24rem] overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
        {works.length ? (
          <div className="divide-y divide-border/70">
            {works.map((work) => {
              const coverUrl = buildProxyImageUrl(work.cover);
              const mainCvText = Array.isArray(work.mainCvs) && work.mainCvs.length ? work.mainCvs.join("，") : "暂无";
              return (
                <div
                  key={`${platform}-${work.dramaId}`}
                  className="grid grid-cols-[4rem_minmax(0,1fr)] gap-3 p-2.5 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:gap-3.5 sm:p-3"
                >
                  <div className="size-16 shrink-0 overflow-hidden rounded-md border border-border/70 bg-muted/45 sm:size-[4.5rem]">
                    {coverUrl ? (
                      <LazyImage alt={work.title} className="size-full object-cover" src={coverUrl} />
                    ) : (
                      <div className="flex size-full items-center justify-center text-[0.65rem] text-muted-foreground">
                        暂无封面
                      </div>
                    )}
                  </div>
                  <div className="grid min-w-0 content-start gap-1.5">
                    <button
                      type="button"
                      title={work.title}
                      className="min-w-0 w-full truncate rounded-sm text-left text-sm font-semibold leading-5 text-foreground underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:text-base"
                      onClick={() => openWorkInSearch(work)}
                    >
                      {work.title}
                    </button>
                    <PlatformDramaLink
                      platform={platform}
                      dramaId={work.dramaId}
                      source="ranks_cv"
                      dramaTitle={work.title}
                      frontendVersion={frontendVersion}
                      className="sm:text-sm"
                      iconClassName={metaIconClassName}
                      textClassName="truncate text-foreground"
                    />
                    <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground sm:text-sm">
                      <PlayCircleIcon aria-label="播放量" className={metaIconClassName} title="播放量" />
                      <span className="min-w-0 break-words font-medium tabular-nums text-foreground">
                        {formatRankCompactCount(work.viewCount)}
                      </span>
                    </div>
                    <div className="flex min-w-0 items-start gap-1.5 text-xs text-muted-foreground sm:text-sm">
                      <MicIcon aria-label="主役CV" className={`${metaIconClassName} mt-0.5`} title="主役CV" />
                      <span className="min-w-0 break-words text-foreground">{mainCvText}</span>
                    </div>
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

function useCvRankTrend({ item, frontendVersion, handleVersionResponse }) {
  const [isTrendOpen, setIsTrendOpen] = useState(false);
  const [trendState, setTrendState] = useState({
    isLoading: false,
    error: "",
    data: null,
  });
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

  return {
    canShowTrend,
    isTrendOpen,
    openTrendDialog,
    setIsTrendOpen,
    trendState,
  };
}

function CvRankActions({ item, canShowTrend, onOpenTrend, className }) {
  return (
    <div className={className}>
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
          appearance="link"
          density="inline"
          onClick={onOpenTrend}
          aria-label={`查看${item.cvName}趋势`}
          title="查看趋势"
        />
      ) : null}
    </div>
  );
}

function CvRankItemCard({
  item,
  platform,
  rankKey,
  frontendVersion = "0.0.0",
  handleVersionResponse,
  onOpenSearchResult,
  onOpenCv,
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const worksRegionId = useId();
  const {
    canShowTrend,
    isTrendOpen,
    openTrendDialog,
    setIsTrendOpen,
    trendState,
  } = useCvRankTrend({ item, frontendVersion, handleVersionResponse });
  const avatarUrl = buildProxyImageUrl(item.avatar);
  const topWorksText = getCvWorksPreviewText(item.topWorks || item.works);

  return (
    <Card className="relative isolate overflow-hidden py-3">
      <RankWatermark rank={item.rank} />
      <CardContent className="relative z-10 px-3.5">
        <div className="grid grid-cols-[3.75rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 sm:grid-cols-[4.25rem_minmax(0,1fr)]">
          <div className="row-span-2 size-[3.75rem] overflow-hidden rounded-full border border-border/70 bg-muted/45 sm:size-[4.25rem]">
            {avatarUrl ? (
              <LazyImage alt={item.cvName} className="size-full object-cover" src={avatarUrl} />
            ) : (
              <div className="flex size-full items-center justify-center text-xs font-semibold text-muted-foreground">
                CV
              </div>
            )}
          </div>
          <div className="col-start-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <button
              type="button"
              className="min-w-0 rounded-sm text-left text-base font-semibold leading-6 text-foreground underline underline-offset-4 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:text-lg"
              title={item.cvName}
              onClick={() => onOpenCv?.(item.cvName, {
                platform,
                profileId: buildCvRankProfileId(platform, item),
                source: "ranks",
                rankKey,
              })}
            >
              {item.cvName}
            </button>
            <div
              aria-label={`总播放量: ${formatRankCompactCount(item.totalViewCount)}`}
              title={`总播放量: ${formatRankCompactCount(item.totalViewCount)}`}
              className="flex shrink-0 items-center gap-1 text-sm font-semibold leading-5 text-foreground"
            >
              <PlayCircleIcon aria-hidden="true" className="size-3.5 shrink-0 text-foreground" />
              <span className="tabular-nums">{formatRankCompactCount(item.totalViewCount)}</span>
            </div>
          </div>
          <div className="col-start-2 min-w-0 text-sm">
            <CvRankActions
              item={item}
              canShowTrend={canShowTrend}
              onOpenTrend={openTrendDialog}
              className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5"
            />
          </div>
          <button
            type="button"
            className="group col-span-2 flex w-full min-w-0 items-center gap-2 rounded-sm text-left text-xs leading-5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:text-sm"
            onClick={() => setIsExpanded((current) => !current)}
            aria-expanded={isExpanded}
            aria-controls={worksRegionId}
            aria-label={isExpanded ? `收起${item.cvName}作品列表` : `展开${item.cvName}作品列表`}
            title={isExpanded ? "收起作品列表" : "展开作品列表"}
          >
            <span className="min-w-0 flex-1 break-words">{topWorksText}</span>
            <ChevronDownIcon
              aria-hidden="true"
              className="size-4 shrink-0 transition-transform duration-200 group-aria-expanded:rotate-180"
            />
          </button>
        </div>
        {isExpanded ? (
          <div id={worksRegionId}>
            <CvWorksList
              works={item.works || []}
              platform={platform}
              frontendVersion={frontendVersion}
              onOpenSearchResult={onOpenSearchResult}
            />
          </div>
        ) : null}
        {canShowTrend && isTrendOpen ? (
          <LazyRankTrendDialog
            open={isTrendOpen}
            onOpenChange={setIsTrendOpen}
            item={{ id: item.cvName, name: item.cvName }}
            platform="cv"
            trendState={trendState}
            frontendVersion={frontendVersion}
            handleVersionResponse={handleVersionResponse}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function CvRankColumn({
  rank,
  platform,
  infoText = "",
  refreshAt = "",
  frontendVersion = "0.0.0",
  handleVersionResponse,
  onOpenSearchResult,
  onOpenCv,
}) {
  const rankUpdatedAtText = refreshAt ? formatRankUpdatedAt(refreshAt) : "";
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card p-3 shadow-[var(--shadow-card)]">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="inline-flex items-center text-base font-semibold leading-6">
            <span>{rank.name}</span>
            <RankInfoPopover infoText={infoText} />
          </h2>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground sm:block">
            <span>{rank.items.length} 位 CV</span>
            {rankUpdatedAtText ? <span className="text-right sm:hidden">更新：{rankUpdatedAtText}</span> : null}
          </div>
        </div>
        {rankUpdatedAtText ? <div className="hidden text-xs text-muted-foreground sm:block">更新：{rankUpdatedAtText}</div> : null}
      </div>
      {rank.items.length ? (
        <div className="grid gap-3">
          {rank.items.map((item) => (
            <CvRankItemCard
              key={`${rank.key}-${item.rank}-${item.cvName}`}
              item={item}
              platform={platform}
              rankKey={rank.key}
              frontendVersion={frontendVersion}
              handleVersionResponse={handleVersionResponse}
              onOpenSearchResult={onOpenSearchResult}
              onOpenCv={onOpenCv}
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
  infoText = "",
  refreshAt = "",
  frontendVersion = "0.0.0",
  handleVersionResponse,
  onOpenSearchResult,
  favoriteKeys = new Set(),
  favoriteActionsDisabled = false,
  statisticsActionsDisabled = false,
  onToggleFavorite,
  onAddCompareItem,
  onStartDramaPaidIdStatistics,
  onStartRevenueEstimate,
  trendAvailableIds = new Set(),
}) {
  const rankUpdatedAtText = refreshAt ? formatRankUpdatedAt(refreshAt) : "";
  const statisticsPeriodText = formatRankStatisticsPeriod(rank?.statisticsPeriod);
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card p-3 shadow-[var(--shadow-card)]">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="inline-flex items-center text-base font-semibold leading-6">
            <span>{rank.name}</span>
            <RankInfoPopover infoText={infoText} />
          </h2>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground sm:block">
            <span>{rank.items.length} 项</span>
            {statisticsPeriodText ? <span className="text-right sm:hidden">统计区间：{statisticsPeriodText}</span> : rankUpdatedAtText ? <span className="text-right sm:hidden">更新：{rankUpdatedAtText}</span> : null}
          </div>
        </div>
        {statisticsPeriodText ? <div className="hidden text-right text-xs text-muted-foreground sm:block">统计区间：{statisticsPeriodText}</div> : rankUpdatedAtText ? <div className="hidden text-xs text-muted-foreground sm:block">更新：{rankUpdatedAtText}</div> : null}
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
              statisticsActionsDisabled={statisticsActionsDisabled}
              onToggleFavorite={onToggleFavorite}
              onAddCompareItem={onAddCompareItem}
              onStartDramaPaidIdStatistics={onStartDramaPaidIdStatistics}
              onStartRevenueEstimate={onStartRevenueEstimate}
              trendAvailable={trendAvailableIds.has(String(item.id))}
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
  onOpenCv,
  favoriteKeys = new Set(),
  favoriteActionsDisabled = false,
  statisticsActionsDisabled = false,
  onToggleFavorite,
  onAddCompareItem,
  onStartDramaPaidIdStatistics,
  onStartRevenueEstimate,
}) {
  const [rankData, setRankData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [showMetricLegend, setShowMetricLegend] = useState(false);
  const [trendEligibility, setTrendEligibility] = useState({
    platform: "",
    lookupKey: "",
    ids: new Set(),
  });
  const [selectedPlatform, setSelectedPlatform] = useState(() =>
    routeState?.platform === "manbo" ? "manbo" : "missevan"
  );
  const [selectedCategory, setSelectedCategory] = useState(() => String(routeState?.category || "").trim());
  const [selectedRank, setSelectedRank] = useState(() => String(routeState?.rank || "").trim());
  const loggedRanksRef = useRef(new Set());
  const handleVersionResponseRef = useRef(handleVersionResponse);

  useEffect(() => {
    handleVersionResponseRef.current = handleVersionResponse;
  }, [handleVersionResponse]);

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
        handleVersionResponseRef.current?.({
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
  const trendLookupIds = useMemo(() => Array.from(new Set(
    (category?.key === "cv" ? [] : category?.ranks || [])
      .flatMap((rank) => rank?.items || [])
      .filter((item) => item?.type !== "peak")
      .map((item) => String(item?.id ?? "").trim())
      .filter(Boolean)
  )).sort(), [category]);
  const trendLookupKey = trendLookupIds.join("|");

  useEffect(() => {
    let cancelled = false;
    setTrendEligibility({
      platform: selectedPlatform,
      lookupKey: trendLookupKey,
      ids: new Set(),
    });
    if (!trendLookupIds.length) {
      return () => {
        cancelled = true;
      };
    }

    fetchRankTrendAvailabilityData({
      platform: selectedPlatform,
      ids: trendLookupIds,
      frontendVersion,
    })
      .then(({ response, data } = {}) => {
        if (!cancelled) {
          setTrendEligibility({
            platform: selectedPlatform,
            lookupKey: trendLookupKey,
            ids: response?.ok && data?.success
              ? resolveRankTrendAvailabilityIds({
                  response,
                  data,
                  requestedIds: trendLookupIds,
                })
              : new Set(),
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Failed to load ranks trend eligibility", error);
          setTrendEligibility({
            platform: selectedPlatform,
            lookupKey: trendLookupKey,
            ids: new Set(),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [frontendVersion, selectedPlatform, trendLookupIds, trendLookupKey]);

  const availableTrendIds = trendEligibility.platform === selectedPlatform &&
    trendEligibility.lookupKey === trendLookupKey
    ? trendEligibility.ids
    : new Set();

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
  const canShowMetricLegend = !isLoading && !errorMessage && hasRanks;
  const isCvCategory = category?.key === "cv";
  const isGrowthCategory = category?.key === "growth";
  const cvSummary = rankData?.cvSummary || {};
  const growthSummary = rankData?.growthSummary || {};
  const hasGrowthDramaCounts =
    growthSummary.missevanDramaCount != null && growthSummary.manboDramaCount != null;
  const rankRefreshAt = resolveRankRefreshAt(rankData, category?.key, activeRank);
  const rankInfoText = isCvCategory
    ? `统计来自猫耳${formatPlainNumber(cvSummary.missevanDramaCount)}部，漫播${formatPlainNumber(cvSummary.manboDramaCount)}部上架中的作品，每周更新。此次数据刷新于：${formatRankUpdatedAt(rankRefreshAt)}`
    : isGrowthCategory
      ? hasGrowthDramaCounts
        ? `统计来自猫耳${formatPlainNumber(growthSummary.missevanDramaCount)}部，漫播${formatPlainNumber(growthSummary.manboDramaCount)}部上架中的作品，每周更新。`
        : "每周更新。"
      : `同步猫耳和漫播榜单，每日更新。此次数据刷新于：${formatRankUpdatedAt(rankRefreshAt)}`;
  const renderMobileMetricLegendToggle = () =>
    canShowMetricLegend ? (
      <button
        type="button"
        aria-controls="rank-metric-legend"
        aria-expanded={showMetricLegend}
        className="shrink-0 text-sm! font-semibold leading-5 text-primary underline-offset-4 hover:underline lg:hidden"
        onClick={() => setShowMetricLegend((open) => !open)}
      >
        {showMetricLegend ? "收起图例" : "查看图例"}
      </button>
    ) : null;

  return (
    <div className="grid gap-4 sm:gap-5">
      {canShowMetricLegend && showMetricLegend ? (
        <div id="rank-metric-legend" className="px-1 lg:hidden">
          <MetricLegend />
        </div>
      ) : null}

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
          <div className="grid gap-2">
            <div className={desktopRankToolbarClassName}>
              <div className={desktopRankControlsClassName}>
                <Tabs value={selectedPlatform} onValueChange={updatePlatform} className="gap-0">
                  <TabsList className={`${desktopTextTabsListClassName} gap-1`}>
                    {availablePlatforms.map((platform) => (
                      <TabsTrigger
                        key={platform.key}
                        data-platform={platform.key}
                        className={`${desktopTextTabClassName} ${
                          platform.key === selectedPlatform ? desktopSelectedPlatformTabClassName : ""
                        }`}
                        value={platform.key}
                      >
                        <PlatformTabLabel platform={platform} />
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
                {platformData?.categories?.length ? (
                  <Tabs value={category?.key || ""} onValueChange={updateCategory} className="gap-0">
                    <TabsList className={`${desktopTextTabsListClassName} gap-1`}>
                      {platformData.categories.map((item) => (
                        <TabsTrigger
                          key={item.key}
                          className={`${desktopTextTabClassName} ${item.key === category?.key ? desktopSelectedTabClassName : ""}`}
                          value={item.key}
                        >
                          {item.label}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                ) : null}
              </div>
              {canShowMetricLegend ? (
                <MetricLegend
                  variant="compact"
                  className="ml-auto w-max min-w-0 max-w-full shrink overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                />
              ) : null}
            </div>
            <div className="grid gap-1 lg:hidden">
              <div className="flex items-center justify-between gap-3">
                <Tabs value={selectedPlatform} onValueChange={updatePlatform} className="min-w-0 items-center gap-0">
                  <TabsList className={mobilePlatformTabsListClassName}>
                    {availablePlatforms.map((platform) => (
                      <TabsTrigger
                        key={platform.key}
                        data-touch="compact"
                        data-platform={platform.key}
                        className={`${mobilePlatformTabClassName} ${
                          platform.key === selectedPlatform ? mobileSelectedPlatformTabClassName : ""
                        }`}
                        value={platform.key}
                      >
                        <PlatformTabLabel platform={platform} />
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
                {renderMobileMetricLegendToggle()}
              </div>
              {platformData?.categories?.length ? (
                <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-border/60 pt-1">
                  <Tabs
                    value={category?.key || ""}
                    onValueChange={updateCategory}
                    className="w-fit max-w-full shrink-0 gap-0"
                  >
                    <TabsList
                      variant="line"
                      className={`${mobileTextTabsListClassName} w-fit`}
                      style={getRankTabsGridStyle(platformData.categories.length)}
                    >
                      {platformData.categories.map((item) => (
                        <TabsTrigger
                          key={item.key}
                          data-touch="compact"
                          className={`${mobileCategoryTabClassName} ${
                            item.key === category?.key ? mobileSelectedTabClassName : ""
                          }`}
                          value={item.key}
                        >
                          {formatMobileRankMenuLabel(item.label)}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                  {category?.ranks?.length > 1 ? (
                    <Tabs
                      value={activeRank?.key || ""}
                      onValueChange={updateRank}
                      className="ml-auto w-fit shrink-0 items-end gap-0"
                    >
                      <TabsList
                        variant="line"
                        className={`${mobileTextTabsListClassName} ml-auto w-fit`}
                        style={{ gridTemplateColumns: `repeat(${category.ranks.length}, minmax(0, 1fr))` }}
                      >
                        {category.ranks.map((rank) => (
                          <TabsTrigger
                            key={rank.key}
                            data-touch="compact"
                            className={`${mobileRankTabClassName} ${
                              rank.key === activeRank?.key ? mobileSelectedTabClassName : ""
                            }`}
                            value={rank.key}
                          >
                            {formatMobileRankMenuLabel(rank.label)}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </Tabs>
                  ) : null}
                </div>
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
                  infoText={rankInfoText}
                  refreshAt={rankRefreshAt}
                  frontendVersion={frontendVersion}
                  handleVersionResponse={handleVersionResponse}
                  onOpenSearchResult={onOpenSearchResult}
                  onOpenCv={onOpenCv}
                />
              ))
            ) : (
              (category?.ranks || []).map((rank) => (
                <RankColumn
                  key={rank.key}
                  platform={selectedPlatform}
                  rank={rank}
                  infoText={rankInfoText}
                  refreshAt={rankRefreshAt}
                  frontendVersion={frontendVersion}
                  handleVersionResponse={handleVersionResponse}
                  onOpenSearchResult={onOpenSearchResult}
                  favoriteKeys={favoriteKeys}
                  favoriteActionsDisabled={favoriteActionsDisabled}
                  statisticsActionsDisabled={statisticsActionsDisabled}
                  onToggleFavorite={onToggleFavorite}
                  onAddCompareItem={onAddCompareItem}
                  onStartDramaPaidIdStatistics={onStartDramaPaidIdStatistics}
                  onStartRevenueEstimate={onStartRevenueEstimate}
                  trendAvailableIds={availableTrendIds}
                />
              ))
            )}
          </div>

          <div className="grid gap-3 lg:hidden">
            {isCvCategory && activeRank ? (
              <CvRankColumn
                platform={selectedPlatform}
                rank={activeRank}
                infoText={rankInfoText}
                refreshAt={rankRefreshAt}
                frontendVersion={frontendVersion}
                handleVersionResponse={handleVersionResponse}
                onOpenSearchResult={onOpenSearchResult}
                onOpenCv={onOpenCv}
              />
            ) : activeRank ? (
              <RankColumn
                platform={selectedPlatform}
                rank={activeRank}
                infoText={rankInfoText}
                refreshAt={rankRefreshAt}
                frontendVersion={frontendVersion}
                handleVersionResponse={handleVersionResponse}
                onOpenSearchResult={onOpenSearchResult}
                favoriteKeys={favoriteKeys}
                favoriteActionsDisabled={favoriteActionsDisabled}
                statisticsActionsDisabled={statisticsActionsDisabled}
                onToggleFavorite={onToggleFavorite}
                onAddCompareItem={onAddCompareItem}
                onStartDramaPaidIdStatistics={onStartDramaPaidIdStatistics}
                onStartRevenueEstimate={onStartRevenueEstimate}
                trendAvailableIds={availableTrendIds}
              />
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
