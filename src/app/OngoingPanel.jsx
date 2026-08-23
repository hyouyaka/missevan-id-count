import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRightIcon,
  HandCoinsIcon,
  HeartIcon,
  MicIcon,
  MoreHorizontalIcon,
  PlayCircleIcon,
  RefreshCwIcon,
  ShoppingCartIcon,
  StarIcon,
  TrendingUpIcon,
  UserSearchIcon,
  UsersRoundIcon,
} from "lucide-react";

import {
  buildVersionedUrl,
  formatDeviceDateTime,
  formatPlainNumber,
  getBackendVersionFromResponse,
} from "@/app/app-utils";
import { fetchOngoingData, getCachedOngoingData } from "@/app/ongoingData";
import {
  fetchRankTrendAvailabilityData,
  resolveRankTrendAvailabilityIds,
} from "@/app/rankTrendData";
import { LazyRankTrendDialog } from "@/app/LazyRankTrendDialog";
import { RankWatermark } from "@/app/RankBadge";
import { PlatformDramaLink, PlatformIdIcon, PlatformTabLabel } from "@/app/platformTabLabel";
import {
  fetchRankTrendData,
  logRankTrendOpen,
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  isOngoingEmptyPaidDanmakuMetric,
  sortOngoingItemsByWindowDelta,
} from "../../shared/ongoingUtils.js";

const platformLabels = {
  missevan: "猫耳",
  manbo: "漫播",
};

const mobileOngoingTextTabsListClassName =
  "grid h-9 min-h-9 w-fit justify-start";
const mobileOngoingPlatformTabClassName =
  "h-7 min-h-7 min-w-0 px-3 text-sm!";
const mobileOngoingWindowTabClassName =
  "h-7 min-h-7 min-w-11 justify-center px-2 text-xs!";
const mobileOngoingSelectedTabClassName = "";
const mobileOngoingSelectedPlatformTabClassName = "";
const desktopOngoingTextTabsListClassName =
  "inline-flex h-9 min-h-9 w-fit justify-start";
const desktopOngoingTabClassName =
  "h-7 min-h-7 min-w-max px-3 text-sm!";
const desktopOngoingSelectedTabClassName = mobileOngoingSelectedTabClassName;
const desktopOngoingSelectedPlatformTabClassName =
  `${desktopOngoingSelectedTabClassName} [&_.platform-tab-label-text]:font-bold!`;

const tagVariants = {
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
  播放量: PlayCircleIcon,
  付费ID数: UsersRoundIcon,
  追剧人数: HeartIcon,
  "付费/收听人数": ShoppingCartIcon,
};

const coverPaymentBadgeClassName =
  "absolute bottom-0 right-0 h-4 rounded-none rounded-tl-[calc(var(--radius)-0.18rem)] border-0! px-1 text-[0.54rem] leading-none shadow-none! lg:h-[1.05rem] lg:px-1.5 lg:text-[0.58rem]";
const ongoingActionButtonClassName =
  "relative h-8 min-w-11 shrink-0 justify-center gap-1 rounded-[calc(var(--radius)-0.12rem)] px-1.5 text-center text-[0.7rem] after:absolute after:inset-x-0 after:-inset-y-1.5 after:rounded-md after:content-[''] sm:gap-1.5 sm:px-2.5 sm:text-xs";
const ongoingTrendButtonClassName =
  `${ongoingActionButtonClassName} border-[color-mix(in_oklch,var(--accent-success)_32%,transparent)] bg-[var(--accent-success)] text-[var(--accent-success-foreground)] shadow-[0_12px_24px_-16px_var(--accent-success)] hover:bg-[color-mix(in_oklch,var(--accent-success)_88%,var(--foreground))] hover:text-[var(--accent-success-foreground)]`;
const ongoingCompareButtonClassName =
  `${ongoingActionButtonClassName} border-[color-mix(in_oklch,var(--accent-compare)_34%,transparent)] bg-[var(--accent-compare)] text-[var(--accent-compare-foreground)] shadow-[0_12px_24px_-16px_var(--accent-compare)] hover:bg-[var(--accent-compare-hover)] hover:text-[var(--accent-compare-foreground)]`;

function OngoingActionLayout({ children }) {
  const containerRef = useRef(null);
  const trendButtonRef = useRef(null);
  const compareButtonRef = useRef(null);
  const moreButtonRef = useRef(null);
  const [actionMode, setActionMode] = useState("more-only");

  useLayoutEffect(() => {
    const container = containerRef.current;
    const trendButton = trendButtonRef.current;
    const compareButton = compareButtonRef.current;
    const moreButton = moreButtonRef.current;
    if (!container || !trendButton || !compareButton || !moreButton) return undefined;

    let cancelled = false;
    const updateActionMode = () => {
      if (cancelled) return;
      const availableWidth = container.getBoundingClientRect().width;
      const gap = Number.parseFloat(window.getComputedStyle(container).columnGap) || 0;
      const trendWidth = trendButton.getBoundingClientRect().width;
      const compareWidth = compareButton.getBoundingClientRect().width;
      const moreWidth = moreButton.getBoundingClientRect().width;
      const allActionsWidth = trendWidth + compareWidth + moreWidth + gap * 2;
      const trendAndMoreWidth = trendWidth + moreWidth + gap;
      const nextMode = availableWidth + 0.5 >= allActionsWidth
        ? "all"
        : availableWidth + 0.5 >= trendAndMoreWidth
          ? "trend-more"
          : "more-only";
      setActionMode((current) => current === nextMode ? current : nextMode);
    };

    updateActionMode();
    document.fonts?.ready?.then(updateActionMode);
    if (typeof ResizeObserver === "undefined") {
      return () => {
        cancelled = true;
      };
    }

    const resizeObserver = new ResizeObserver(updateActionMode);
    resizeObserver.observe(container);
    resizeObserver.observe(trendButton);
    resizeObserver.observe(compareButton);
    resizeObserver.observe(moreButton);
    return () => {
      cancelled = true;
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      data-action-mode={actionMode}
      className="relative flex w-full min-w-0 flex-nowrap items-center justify-end gap-x-1 gap-y-1.5 overflow-visible"
    >
      {children({ actionMode, trendButtonRef, compareButtonRef, moreButtonRef })}
    </div>
  );
}

function OngoingTitle({ itemId, onClick, title, titleTags }) {
  const containerRef = useRef(null);
  const measureRef = useRef(null);
  const measureTitleRef = useRef(null);
  const normalizedTitle = String(title || "未命名剧集");
  const [visibleTitle, setVisibleTitle] = useState(normalizedTitle);
  const titleTagsKey = titleTags.join("\u0001");

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    const measureTitle = measureTitleRef.current;
    if (!container || !measure || !measureTitle) return undefined;

    let animationFrameId = 0;
    let cancelled = false;

    const updateVisibleTitle = () => {
      measure.style.width = `${container.clientWidth}px`;
      const lineHeight = Number.parseFloat(window.getComputedStyle(measureTitle).lineHeight) || 20;
      const maxHeight = lineHeight * 2 + 2;
      const fitsWithinTwoLines = (candidate) => {
        measureTitle.textContent = candidate;
        return measure.getBoundingClientRect().height <= maxHeight;
      };

      if (fitsWithinTwoLines(normalizedTitle)) {
        setVisibleTitle((current) => (current === normalizedTitle ? current : normalizedTitle));
        return;
      }

      const titleCharacters = Array.from(normalizedTitle);
      let low = 0;
      let high = titleCharacters.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        const candidate = `${titleCharacters.slice(0, middle).join("").trimEnd()}…`;
        if (fitsWithinTwoLines(candidate)) low = middle;
        else high = middle - 1;
      }
      const truncatedTitle = `${titleCharacters.slice(0, low).join("").trimEnd()}…`;
      setVisibleTitle((current) => (current === truncatedTitle ? current : truncatedTitle));
    };

    const scheduleUpdate = () => {
      window.cancelAnimationFrame(animationFrameId);
      animationFrameId = window.requestAnimationFrame(updateVisibleTitle);
    };
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleUpdate);
    resizeObserver?.observe(container);
    updateVisibleTitle();
    document.fonts?.ready.then(() => {
      if (!cancelled) scheduleUpdate();
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrameId);
      resizeObserver?.disconnect();
    };
  }, [normalizedTitle, titleTagsKey]);

  const renderTags = () => titleTags.map((label) => (
    <Badge
      key={`${itemId}-${label}`}
      variant={tagVariants[label] || "outline"}
      className="ml-1 inline-flex h-[1.05rem] shrink-0 px-1.5 align-[0.12em] text-[0.6rem] leading-none"
    >
      {label}
    </Badge>
  ));

  const titleTextClassName = "break-words text-base! font-semibold! leading-5!";
  return (
    <div ref={containerRef} className="relative min-w-0 max-h-[42px] overflow-hidden" title={normalizedTitle}>
      <button
        type="button"
        className="block w-full rounded-sm text-left text-foreground underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        onClick={onClick}
      >
        <span className={titleTextClassName}>{visibleTitle}</span>
        {renderTags()}
      </button>
      <span
        ref={measureRef}
        aria-hidden="true"
        className="pointer-events-none invisible absolute left-0 top-0 block whitespace-normal"
      >
        <span ref={measureTitleRef} className={titleTextClassName}>{normalizedTitle}</span>
        {renderTags()}
      </span>
    </div>
  );
}

function buildProxyImageUrl(url) {
  return url ? `/image-proxy?url=${encodeURIComponent(url)}` : "";
}

function formatOngoingDate(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "未知";
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return normalized.slice(0, 10) || "未知";
  }

  const parts = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(date)
    .reduce((map, part) => {
      map[part.type] = part.value;
      return map;
    }, {});

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatOngoingUpdatedAt(value) {
  return formatDeviceDateTime(value);
}

function formatWanNumber(value, options = {}) {
  const { forceWanDecimal = false } = options;
  const count = Number(value);
  if (!Number.isFinite(count)) {
    return "暂无";
  }
  if (Math.abs(count) >= 10000) {
    const wan = count / 10000;
    const digits = forceWanDecimal ? 1 : Math.abs(wan) >= 1000 ? 0 : 1;
    return `${wan.toFixed(digits)}万`;
  }
  return formatPlainNumber(count);
}

function formatOngoingMetricValue(value, metricKey, options = {}) {
  const count = Number(value);
  if (!Number.isFinite(count)) {
    return "暂无";
  }
  if (metricKey === "danmaku_uid_count") {
    return formatPlainNumber(count);
  }
  return formatWanNumber(count, options);
}

function formatDelta(value, metricKey, options = {}) {
  const delta = Number(value);
  if (!Number.isFinite(delta)) {
    return "暂无";
  }
  const prefix = delta > 0 ? "+" : "";
  return `${prefix}${formatOngoingMetricValue(delta, metricKey, options)}`;
}

function getMetricValue(item, metricKey) {
  return item?.metrics?.[metricKey]?.value ?? null;
}

function getMetricDelta(item, windowKey, metricKey) {
  return item?.windows?.[windowKey]?.metrics?.[metricKey]?.delta ?? null;
}

function MetricIcon({ label }) {
  const Icon = metricIconMap[label] || PlayCircleIcon;
  return <Icon aria-hidden="true" className="size-3.5 text-muted-foreground" />;
}

function OngoingMetric({ item, windowKey, metricKey }) {
  const metric = item?.metrics?.[metricKey] || item?.windows?.[windowKey]?.metrics?.[metricKey];
  const windowMetric = item?.windows?.[windowKey]?.metrics?.[metricKey];
  const delta = getMetricDelta(item, windowKey, metricKey);
  const showEmptyPaidDanmaku = isOngoingEmptyPaidDanmakuMetric(windowMetric);
  const showMissingDelta = !showEmptyPaidDanmaku && (windowMetric?.available === false || windowMetric?.delta == null);
  const numberOptions = metricKey === "view_count" ? { forceWanDecimal: true } : {};
  return (
    <div className="min-w-0 border-l border-border/70 px-2 text-center first:border-l-0 sm:px-3">
      <div className="flex min-w-0 items-center justify-center gap-1 text-[0.68rem] text-muted-foreground">
        <MetricIcon label={metric?.label} />
        <span className="truncate">{metric?.label || "指标"}</span>
      </div>
      <div className={`mt-1 text-[0.92rem] leading-5 tabular-nums text-foreground ${showEmptyPaidDanmaku ? "font-normal" : "font-semibold"}`}>
        {showEmptyPaidDanmaku ? "暂无付费集" : formatOngoingMetricValue(getMetricValue(item, metricKey), metricKey, numberOptions)}
      </div>
      <div className="text-[0.74rem] font-medium leading-5 tabular-nums text-[var(--accent-success)]">
        {showEmptyPaidDanmaku ? "\u00a0" : showMissingDelta ? "暂无" : formatDelta(delta, metricKey, numberOptions)}
      </div>
    </div>
  );
}

function OngoingCard({
  item,
  rank,
  windowKey,
  platform,
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
  const baseMetricKeys = platform === "missevan"
    ? ["view_count", "subscription_num", "danmaku_uid_count"]
    : ["view_count", "pay_count", "danmaku_uid_count"];
  const metricKeys = baseMetricKeys.filter((metricKey) => item?.metrics?.[metricKey]?.visible !== false);
  const titleTags = [item.content_type_label].filter(Boolean);
  const paymentTag = item.payment_label;
  const metricGridClassName = metricKeys.length >= 3 ? "grid-cols-3" : "grid-cols-2";
  const canOpenTrend = Boolean(platform && item?.id && trendAvailable);
  const favoriteKey = `${platform}:${String(item?.id ?? "").trim()}`;
  const isFavorite = Boolean(favoriteKeys?.has?.(favoriteKey));
  const [isTrendOpen, setIsTrendOpen] = useState(false);
  const [statisticsActionPending, setStatisticsActionPending] = useState("");
  const statisticsActionLockRef = useRef(false);
  const [trendState, setTrendState] = useState({
    isLoading: false,
    error: "",
    data: null,
  });

  async function openTrendDialog() {
    if (!canOpenTrend || isTrendOpen) {
      return;
    }
    setIsTrendOpen(true);
    logRankTrendOpen({
      platform,
      id: item.id,
      name: item.name,
      source: "ongoing",
      rankKey: "ongoing",
      frontendVersion,
    });
    setTrendState((current) => ({
      ...current,
      isLoading: !current.data,
      error: "",
    }));
    try {
      const { response, data } = await fetchRankTrendData({
        platform,
        id: item.id,
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
      console.error("Failed to load ongoing rank trend", error);
      setTrendState({
        isLoading: false,
        error: "趋势数据暂不可用。",
        data: null,
      });
    }
  }

  function openSearchResult() {
    if (!platform || !item?.id) {
      return;
    }
    onOpenSearchResult?.({
      platform,
      id: item.id,
      titles: [item.name],
      name: item.name,
      paymentLabel: item.payment_label,
      contentTypeLabel: item.content_type_label,
      usageAction: "ongoing_open_search_result",
    });
  }

  function toggleFavorite() {
    if (!platform || !item?.id) {
      return;
    }
    onToggleFavorite?.({
      platform,
      dramaId: String(item.id),
      title: item.name || "",
      cover: item.cover || "",
      paymentLabel: item.payment_label || "",
      contentTypeLabel: item.content_type_label || "",
      dramaUpdatedAt: item.updated_at || "",
      mainCvText: item.main_cv_text || "",
      source: "ongoing",
    });
  }

  function addCompareItem() {
    if (!canOpenTrend) {
      return;
    }
    onAddCompareItem?.({
      platform,
      id: String(item.id),
      title: item.name || "",
      cover: item.cover || "",
      mainCvText: item.main_cv_text || "",
    });
  }

  function logStatisticsMenuClick(action) {
    fetch(buildVersionedUrl("/usage-log", frontendVersion), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform,
        action,
        dramaId: String(item.id),
        dramaName: item.name || "",
        source: "ongoing",
        success: true,
      }),
      keepalive: true,
    }).catch((error) => {
      console.error("Failed to log ongoing statistics action", error);
    });
  }

  async function runStatisticsAction(action) {
    if (statisticsActionsDisabled || statisticsActionLockRef.current || !onOpenSearchResult) {
      return;
    }
    const isPaidIdAction = action === "paid_id_click";
    const startStatistics = isPaidIdAction
      ? onStartDramaPaidIdStatistics
      : onStartRevenueEstimate;
    if (!startStatistics) {
      return;
    }

    statisticsActionLockRef.current = true;
    setStatisticsActionPending(action);
    logStatisticsMenuClick(action);
    try {
      const opened = await onOpenSearchResult({
        platform,
        id: item.id,
        titles: [item.name],
        name: item.name,
        paymentLabel: item.payment_label,
        contentTypeLabel: item.content_type_label,
        suppressUsageLog: true,
      });
      if (!opened) {
        return;
      }
      if (isPaidIdAction) {
        await startStatistics(item.id, {
          platform,
          source: `${item.id}payID`,
        });
      } else {
        await startStatistics([item.id], {
          platform,
          source: `${item.id}earn`,
        });
      }
    } finally {
      statisticsActionLockRef.current = false;
      setStatisticsActionPending("");
    }
  }

  return (
    <>
      <Card className="relative isolate overflow-hidden py-0">
        <RankWatermark rank={rank} />
        <CardContent className="relative z-10 p-0">
          <div className="grid grid-cols-[116px_minmax(0,1fr)] items-stretch gap-3 p-3.5">
            <div className="relative size-[116px] shrink-0 self-center overflow-hidden rounded-md border border-border/70 bg-muted/50">
              {coverUrl ? (
                <LazyImage alt={item.name} className="size-full object-cover" src={coverUrl} />
              ) : (
                <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
                  暂无封面
                </div>
              )}
              {paymentTag ? (
                <Badge variant={tagVariants[paymentTag] || "outline"} className={coverPaymentBadgeClassName}>
                  {paymentTag}
                </Badge>
              ) : null}
            </div>
            <div className="flex min-w-0 flex-col gap-1.5 pt-0.5">
              <OngoingTitle itemId={item.id} onClick={openSearchResult} title={item.name} titleTags={titleTags} />
              <div
                className="flex min-w-0 items-center gap-1.5 text-xs leading-5 text-muted-foreground"
                aria-label={`${platformLabels[platform] || "平台"}作品ID：${item.id}`}
                title={`${platformLabels[platform] || "平台"}作品ID：${item.id}`}
              >
                <PlatformIdIcon aria-hidden="true" className="size-3.5 shrink-0" platform={platform} tone="inherit" />
                <span className="min-w-0 break-all">{item.id}</span>
              </div>
              <div className="flex min-w-0 items-start gap-1.5 text-xs leading-5 text-muted-foreground">
                <MicIcon aria-label="主要CV" className="mt-[3px] size-3.5 shrink-0" />
                <span className="min-w-0 break-words">{String(item.main_cv_text || "").replace(/^主要CV：/, "") || "暂无"}</span>
              </div>
              <div className="flex min-w-0 items-center gap-1.5 text-xs leading-5 text-muted-foreground">
                <RefreshCwIcon aria-label="最近更新" className="size-3.5 shrink-0" />
                <span className="min-w-0 break-all">{formatOngoingDate(item.updated_at)}</span>
              </div>
              <div className="mt-1 min-w-0">
                <OngoingActionLayout>
                  {({ actionMode, trendButtonRef, compareButtonRef, moreButtonRef }) => {
                    const showTrendButton = actionMode !== "more-only";
                    const showCompareButton = actionMode === "all";
                    return (
                      <>
                        <Button
                          ref={trendButtonRef}
                          type="button"
                          data-touch="compact"
                          className={`${ongoingTrendButtonClassName} ${showTrendButton ? "" : "pointer-events-none invisible absolute"}`}
                          disabled={!canOpenTrend}
                          onClick={openTrendDialog}
                          aria-hidden={showTrendButton ? undefined : true}
                          aria-label={`查看${item.name}趋势`}
                          tabIndex={showTrendButton ? undefined : -1}
                          title={canOpenTrend ? "查看趋势" : "暂无趋势数据"}
                        >
                          <TrendingUpIcon data-icon="inline-start" />
                          <span className="whitespace-nowrap">趋势</span>
                        </Button>
                        <Button
                          ref={compareButtonRef}
                          type="button"
                          data-touch="compact"
                          className={`${ongoingCompareButtonClassName} ${showCompareButton ? "" : "pointer-events-none invisible absolute"}`}
                          disabled={!canOpenTrend || !onAddCompareItem}
                          onClick={addCompareItem}
                          aria-hidden={showCompareButton ? undefined : true}
                          aria-label={`加入${item.name}对比`}
                          tabIndex={showCompareButton ? undefined : -1}
                          title={canOpenTrend ? "加入对比" : "暂无趋势数据"}
                        >
                          <ArrowLeftRightIcon data-icon="inline-start" />
                          <span className="whitespace-nowrap">对比</span>
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              ref={moreButtonRef}
                              type="button"
                              data-touch="compact"
                              variant="outline"
                              className={ongoingActionButtonClassName}
                              aria-label={`${item.name}更多操作`}
                              title="更多操作"
                            >
                              <MoreHorizontalIcon data-icon="inline-start" />
                              <span className="whitespace-nowrap">更多</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" side="bottom">
                            {actionMode === "more-only" ? (
                              <DropdownMenuItem disabled={!canOpenTrend} onSelect={openTrendDialog}>
                                <TrendingUpIcon aria-hidden="true" />
                                趋势
                              </DropdownMenuItem>
                            ) : null}
                            {actionMode !== "all" ? (
                              <DropdownMenuItem disabled={!canOpenTrend || !onAddCompareItem} onSelect={addCompareItem}>
                                <ArrowLeftRightIcon aria-hidden="true" />
                                对比
                              </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuItem disabled={favoriteActionsDisabled} onSelect={toggleFavorite}>
                              <StarIcon aria-hidden="true" className={isFavorite ? "fill-primary text-primary" : ""} />
                              {isFavorite ? "取消收藏" : "收藏"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={statisticsActionsDisabled || Boolean(statisticsActionPending)}
                              onSelect={() => runStatisticsAction("paid_id_click")}
                            >
                              <UserSearchIcon aria-hidden="true" />
                              付费ID
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={statisticsActionsDisabled || Boolean(statisticsActionPending)}
                              onSelect={() => runStatisticsAction("revenue_click")}
                            >
                              <HandCoinsIcon aria-hidden="true" />
                              收益
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <PlatformDramaLink
                                appearance="menu"
                                platform={platform}
                                dramaId={item.id}
                                source="ongoing"
                                dramaTitle={item.name}
                                frontendVersion={frontendVersion}
                              />
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </>
                    );
                  }}
                </OngoingActionLayout>
              </div>
            </div>
          </div>
          <div className={`grid ${metricGridClassName} border-t border-border/70 bg-background/54 py-2`}>
            {metricKeys.map((metricKey) => (
              <OngoingMetric key={metricKey} item={item} metricKey={metricKey} windowKey={windowKey} />
            ))}
          </div>
        </CardContent>
      </Card>
      {canOpenTrend && isTrendOpen ? (
        <LazyRankTrendDialog
          open={isTrendOpen}
          onOpenChange={setIsTrendOpen}
          item={item}
          platform={platform}
          trendState={trendState}
          frontendVersion={frontendVersion}
          handleVersionResponse={handleVersionResponse}
        />
      ) : null}
    </>
  );
}

export function OngoingPanel({
  frontendVersion = "0.0.0",
  handleVersionResponse,
  routeState = null,
  onRouteStateChange,
  onOpenSearchResult,
  favoriteKeys = new Set(),
  favoriteActionsDisabled = false,
  statisticsActionsDisabled = false,
  onToggleFavorite,
  onAddCompareItem,
  onStartDramaPaidIdStatistics,
  onStartRevenueEstimate,
}) {
  const [selectedPlatform, setSelectedPlatform] = useState(() =>
    routeState?.platform === "manbo" ? "manbo" : "missevan"
  );
  const [selectedWindow, setSelectedWindow] = useState(() =>
    ["3d", "7d", "30d"].includes(routeState?.window) ? routeState.window : "3d"
  );
  const [ongoingData, setOngoingData] = useState(null);
  const [platformCounts, setPlatformCounts] = useState({
    missevan: null,
    manbo: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [trendEligibility, setTrendEligibility] = useState({
    platform: "",
    lookupKey: "",
    ids: new Set(),
  });
  const loggedOngoingRef = useRef(new Set());
  const handleVersionResponseRef = useRef(handleVersionResponse);

  useEffect(() => {
    handleVersionResponseRef.current = handleVersionResponse;
  }, [handleVersionResponse]);

  useEffect(() => {
    if (routeState?.view !== "ongoing") {
      return;
    }
    setSelectedPlatform(routeState.platform === "manbo" ? "manbo" : "missevan");
    setSelectedWindow(["3d", "7d", "30d"].includes(routeState.window) ? routeState.window : "3d");
  }, [routeState?.view, routeState?.platform, routeState?.window]);

  useEffect(() => {
    let cancelled = false;

    async function loadOngoing() {
      const cachedPayload = getCachedOngoingData({
        platform: selectedPlatform,
        frontendVersion,
      });
      if (cachedPayload?.data?.success) {
        setOngoingData(cachedPayload.data);
        setPlatformCounts((current) => ({
          ...current,
          [selectedPlatform]: cachedPayload.data.items?.length || 0,
        }));
      }
      setIsLoading(!cachedPayload);
      setErrorMessage("");
      try {
        const { response, data } = await fetchOngoingData({
          platform: selectedPlatform,
          frontendVersion,
          revalidate: true,
        });
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
            setOngoingData(null);
            setErrorMessage("连载中数据暂不可用，请稍后重试。");
          }
          return;
        }
        setOngoingData(data);
        setPlatformCounts((current) => ({
          ...current,
          [selectedPlatform]: data.items?.length || 0,
        }));
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load ongoing dramas", error);
          if (!cachedPayload?.data?.success) {
            setOngoingData(null);
            setErrorMessage("连载中数据暂不可用，请稍后重试。");
          }
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadOngoing();
    return () => {
      cancelled = true;
    };
  }, [frontendVersion, selectedPlatform]);

  useEffect(() => {
    let cancelled = false;

    ["missevan", "manbo"].forEach((platform) => {
      const cachedPayload = getCachedOngoingData({
        platform,
        frontendVersion,
      });
      if (cachedPayload?.data?.success) {
        setPlatformCounts((current) => ({
          ...current,
          [platform]: cachedPayload.data.items?.length || 0,
        }));
      }

      fetchOngoingData({
        platform,
        frontendVersion,
        revalidate: false,
      })
        .then(({ response, data } = {}) => {
          if (!cancelled && response?.ok && data?.success) {
            setPlatformCounts((current) => ({
              ...current,
              [platform]: data.items?.length || 0,
            }));
          }
        })
        .catch((error) => {
          if (!cancelled) {
            console.error(`Failed to load ${platform} ongoing count`, error);
          }
        });
    });

    return () => {
      cancelled = true;
    };
  }, [frontendVersion]);

  useEffect(() => {
    if (isLoading || errorMessage || !ongoingData?.success) {
      return;
    }

    const logKey = selectedPlatform;
    if (loggedOngoingRef.current.has(logKey)) {
      return;
    }
    loggedOngoingRef.current.add(logKey);

    const platformLabel = platformLabels[selectedPlatform] || selectedPlatform;
    fetch(buildVersionedUrl("/usage-log", frontendVersion), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: selectedPlatform,
        action: "ongoing",
        keyword: `${platformLabel}一周内更新`,
        success: true,
      }),
    }).catch((error) => {
      console.error("Failed to log ongoing view", error);
    });
  }, [errorMessage, frontendVersion, isLoading, ongoingData?.success, selectedPlatform]);

  const windows = ongoingData?.windows || {};
  const availableWindows = ["3d", "7d", "30d"].filter((key) => windows[key]);
  const activeWindow = availableWindows.includes(selectedWindow)
    ? selectedWindow
    : availableWindows[0] || "7d";
  useEffect(() => {
    if (routeState?.view !== "ongoing" || !availableWindows.length || selectedWindow === activeWindow) {
      return;
    }
    setSelectedWindow(activeWindow);
    onRouteStateChange?.(
      {
        view: "ongoing",
        platform: selectedPlatform,
        window: activeWindow,
      },
      { replace: true }
    );
  }, [activeWindow, availableWindows.length, onRouteStateChange, routeState?.view, selectedPlatform, selectedWindow]);
  const sortedItems = useMemo(
    () => sortOngoingItemsByWindowDelta(ongoingData?.items || [], activeWindow),
    [activeWindow, ongoingData?.items]
  );
  const trendLookupIds = useMemo(
    () => Array.from(new Set(
      (ongoingData?.items || [])
        .map((item) => String(item?.id ?? "").trim())
        .filter(Boolean)
    )).sort(),
    [ongoingData?.items]
  );
  const trendLookupKey = trendLookupIds.join("|");

  useEffect(() => {
    let cancelled = false;
    setTrendEligibility({
      platform: selectedPlatform,
      lookupKey: trendLookupKey,
      ids: new Set(trendLookupIds),
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
            ids: resolveRankTrendAvailabilityIds({
              response,
              data,
              requestedIds: trendLookupIds,
            }),
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Failed to load ongoing trend eligibility", error);
          setTrendEligibility({
            platform: selectedPlatform,
            lookupKey: trendLookupKey,
            ids: new Set(trendLookupIds),
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
    : new Set(trendLookupIds);
  function updatePlatform(platform) {
    const nextPlatform = platform === "manbo" ? "manbo" : "missevan";
    setSelectedPlatform(nextPlatform);
    onRouteStateChange?.({
      view: "ongoing",
      platform: nextPlatform,
      window: activeWindow,
    });
  }

  function updateWindow(windowKey) {
    const nextWindow = ["3d", "7d", "30d"].includes(windowKey) ? windowKey : "3d";
    setSelectedWindow(nextWindow);
    onRouteStateChange?.({
      view: "ongoing",
      platform: selectedPlatform,
      window: nextWindow,
    });
  }

  return (
    <div className="grid gap-4 sm:gap-5">
      <div className="px-1 py-1">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <div className="shrink-0 text-xs leading-5 text-muted-foreground">
              更新：{formatOngoingUpdatedAt(ongoingData?.updatedAt)}
            </div>
          </div>
          <div className="flex min-h-8 items-center justify-between gap-3 sm:hidden">
            <Tabs value={selectedPlatform} onValueChange={updatePlatform} className="min-w-0 gap-0">
              <TabsList
                aria-label="选择平台"
                variant="line"
                className={`${mobileOngoingTextTabsListClassName} grid-cols-2`}
              >
                {["missevan", "manbo"].map((platform) => (
                  <TabsTrigger
                    key={platform}
                    data-touch="compact"
                    data-platform={platform}
                    className={`${mobileOngoingPlatformTabClassName} ${
                      platform === selectedPlatform ? mobileOngoingSelectedPlatformTabClassName : ""
                    }`}
                    value={platform}
                  >
                    <PlatformTabLabel platform={platform} />
                    <span className="tabular-nums">{platformCounts[platform] ?? "—"}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Tabs value={activeWindow} onValueChange={updateWindow} className="shrink-0 gap-0">
              <TabsList
                aria-label="选择增量周期"
                variant="line"
                className={`${mobileOngoingTextTabsListClassName} grid-cols-3 justify-end`}
              >
                {["3d", "7d", "30d"].map((key) => (
                  <TabsTrigger
                    key={key}
                    data-touch="compact"
                    className={`${mobileOngoingWindowTabClassName} ${
                      key === activeWindow ? mobileOngoingSelectedTabClassName : ""
                    }`}
                    value={key}
                  >
                    {{ "3d": "3日", "7d": "7日", "30d": "30日" }[key]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          <div className="hidden flex-col gap-1 sm:flex sm:flex-row sm:items-center sm:justify-end sm:gap-10 lg:flex-row lg:gap-12">
            <Tabs value={selectedPlatform} onValueChange={updatePlatform}>
              <TabsList aria-label="选择平台" className={`${desktopOngoingTextTabsListClassName} gap-4`}>
                {["missevan", "manbo"].map((platform) => (
                  <TabsTrigger
                    key={platform}
                    data-platform={platform}
                    className={`${desktopOngoingTabClassName} ${
                      platform === selectedPlatform ? desktopOngoingSelectedPlatformTabClassName : ""
                    }`}
                    value={platform}
                  >
                    <PlatformTabLabel platform={platform} />
                    <span className="tabular-nums">{platformCounts[platform] ?? "—"}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Tabs value={activeWindow} onValueChange={updateWindow}>
              <TabsList aria-label="选择增量周期" className={`${desktopOngoingTextTabsListClassName} gap-4`}>
                {["3d", "7d", "30d"].map((key) => (
                  <TabsTrigger
                    key={key}
                    className={`${desktopOngoingTabClassName} ${key === activeWindow ? desktopOngoingSelectedTabClassName : ""}`}
                    value={key}
                  >
                    {{ "3d": "3日", "7d": "7日", "30d": "30日" }[key]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </div>
      </div>

      {isLoading ? (
        <Alert>
          <RefreshCwIcon className="size-4 animate-spin" />
          <AlertTitle>正在读取连载中</AlertTitle>
          <AlertDescription>正在读取连载剧集数据。</AlertDescription>
        </Alert>
      ) : null}

      {!isLoading && errorMessage ? (
        <Alert className="border-destructive/30 bg-destructive/10">
          <AlertTitle>连载中暂不可用</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {!isLoading && !errorMessage && !sortedItems.length ? (
        <div className="rounded-lg border border-dashed border-border/80 bg-muted/30 px-6 py-10 text-center">
          <div className="text-base font-semibold">还没有连载中数据</div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">请稍后重试。</p>
        </div>
      ) : null}

      {!isLoading && !errorMessage && sortedItems.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sortedItems.map((item, index) => (
            <OngoingCard
              key={`${selectedPlatform}-${item.id}`}
              item={item}
              platform={selectedPlatform}
              rank={index + 1}
              windowKey={activeWindow}
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
              trendAvailable={availableTrendIds.has(String(item.id))}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
