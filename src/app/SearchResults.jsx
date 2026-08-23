import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRightIcon,
  BeanIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ChevronsDownIcon,
  EraserIcon,
  FeatherIcon,
  GemIcon,
  HandCoinsIcon,
  HashIcon,
  HeartIcon,
  ImportIcon,
  LoaderCircleIcon,
  MicIcon,
  MoreHorizontalIcon,
  PlayCircleIcon,
  ShoppingCartIcon,
  StarIcon,
  TrendingUpIcon,
  UserSearchIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LazyImage } from "@/components/ui/lazy-image";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { formatPlainNumber, getBackendVersionFromResponse, selectDramaEpisodesByMode } from "@/app/app-utils";
import {
  fetchRankTrendAvailabilityData,
  fetchRankTrendData,
  logRankTrendOpen,
} from "@/app/rankTrendData";
import { PlatformDramaLink, PlatformIdIcon, PlatformTabLabel } from "@/app/platformTabLabel";
import { LazyRankTrendDialog } from "@/app/LazyRankTrendDialog";
import { CvSearchResults } from "@/app/CvSearchResults";
import { isMemberEpisode, isPaidEpisode } from "../../shared/episodeRules.js";

function buildProxyImageUrl(url) {
  return url ? `/image-proxy?url=${encodeURIComponent(url)}` : "";
}

function collectSelectedEpisodes(dramas = []) {
  const selectedEpisodes = [];
  dramas.forEach((drama) => {
    const dramaId = String(drama?.drama?.id ?? "").trim();
    const dramaTitle = drama?.drama?.name || "";
    const episodes = Array.isArray(drama?.episodes?.episode) ? drama.episodes.episode : [];
    episodes.forEach((episode) => {
      if (episode.selected) {
        selectedEpisodes.push({
          drama_id: dramaId,
          sound_id: episode.sound_id,
          drama_title: dramaTitle,
          episode_title: episode.name,
          duration: Number(episode.duration ?? 0),
        });
      }
    });
  });
  return selectedEpisodes;
}

const metricLegendItems = [
  { label: "导入分集", icon: ImportIcon },
  { label: "播放", icon: PlayCircleIcon },
  { label: "追剧", icon: HeartIcon },
  { label: "收藏", icon: StarIcon },
  { label: "打赏人数", icon: GemIcon },
  { label: "投喂", icon: BeanIcon },
  { label: "付费/收听", icon: ShoppingCartIcon },
];

const metricIconMap = {
  总播放量: PlayCircleIcon,
  追剧人数: HeartIcon,
  收藏人数: StarIcon,
  收藏数: StarIcon,
  打赏人数: GemIcon,
  投喂总数: BeanIcon,
  付费人数: ShoppingCartIcon,
  收听人数: ShoppingCartIcon,
};

function getMetricLoadingMotionClass(label) {
  if (label === "总播放量") return "metric-motion-play";
  if (label === "追剧人数" || label === "收藏人数" || label === "收藏数") return "metric-motion-heart";
  if (label === "打赏人数") return "metric-motion-reward";
  if (label === "投喂总数") return "metric-motion-feed";
  return "metric-motion-count";
}

function MetricIcon({ label, className = "size-3.5", loading = false }) {
  const Icon = metricIconMap[label] || PlayCircleIcon;
  return <Icon aria-hidden="true" className={`${className} ${loading ? getMetricLoadingMotionClass(label) : ""}`.trim()} />;
}

export function MetricLegend({ className = "" }) {
  return (
    <div
      className={`rounded-lg border border-border bg-card px-3 py-2 shadow-[var(--shadow-card)] ${className}`}
      aria-label="统计图标图例"
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

const rankTrendTagVariants = {
  猫耳: "missevanPlatform",
  漫播: "manboPlatform",
  免费: "free",
  会员: "member",
  付费: "paid",
  广播剧: "radioDrama",
  有声剧: "audioDrama",
  有声漫: "audioComic",
};

const searchResultTagVariants = {
  猫耳: rankTrendTagVariants.猫耳,
  漫播: rankTrendTagVariants.漫播,
  免费: "free",
  会员: "member",
  付费: "paid",
  广播剧: "radioDrama",
  有声剧: "audioDrama",
  有声漫: "audioComic",
};

function getFallbackPaymentLabel(item) {
  if (item?.is_member == null && item?.price == null && item?.member_price == null && !item?.revenue_type) {
    return "";
  }
  if (item?.is_member) {
    return "会员";
  }
  if (item?.platform === "manbo") {
    if (Number(item?.price ?? 0) === 100) {
      return "免费";
    }
    return ["season", "episode"].includes(String(item?.revenue_type ?? "")) ? "付费" : "免费";
  }
  return Number(item?.price ?? 0) > 0 || Number(item?.member_price ?? 0) > 0 ? "付费" : "免费";
}

function getSearchResultPaymentTag(item) {
  return String(item?.payment_label || getFallbackPaymentLabel(item)).trim();
}

function getSearchResultTitleTags(item) {
  return [item?.content_type_label]
    .map((label) => String(label ?? "").trim())
    .filter(Boolean);
}

const metaBadgeClassName = "h-[1.05rem] px-1.5 text-[0.6rem] leading-none";
const mobileInlineBadgeClassName = `${metaBadgeClassName} -translate-y-px align-middle`;
const coverPaymentBadgeClassName =
  "absolute bottom-0 right-0 h-4 rounded-none rounded-tl-[calc(var(--radius)-0.18rem)] border-0! px-1 text-[0.54rem] leading-none shadow-none! lg:h-[1.05rem] lg:px-1.5 lg:text-[0.58rem]";
const metaIconClassName = "size-3.5 shrink-0 text-muted-foreground";

function SearchResultTitle({ imported, itemId, title, titleClassName, titleTags }) {
  const containerRef = useRef(null);
  const measureRef = useRef(null);
  const measureTitleRef = useRef(null);
  const [visibleTitle, setVisibleTitle] = useState(title);
  const hasTags = titleTags.length > 0 || imported;
  const titleTagsKey = titleTags.join("\u0001");

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    const measureTitle = measureTitleRef.current;
    if (!container || !measure || !measureTitle) return undefined;

    let animationFrameId = 0;
    let cancelled = false;

    const updateVisibleTitle = () => {
      const fullTitle = String(title ?? "");
      if (!hasTags) {
        setVisibleTitle((current) => (current === fullTitle ? current : fullTitle));
        return;
      }

      measure.style.width = `${container.clientWidth}px`;
      const lineHeight = Number.parseFloat(window.getComputedStyle(measureTitle).lineHeight) || 24;
      const maxHeight = lineHeight * 2 + 0.5;
      const fitsWithinTwoLines = (candidate) => {
        measureTitle.textContent = candidate;
        return measure.getBoundingClientRect().height <= maxHeight;
      };

      if (fitsWithinTwoLines(fullTitle)) {
        setVisibleTitle((current) => (current === fullTitle ? current : fullTitle));
        return;
      }

      let low = 0;
      let high = fullTitle.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        const candidate = `${fullTitle.slice(0, middle).trimEnd()}…`;
        if (fitsWithinTwoLines(candidate)) low = middle;
        else high = middle - 1;
      }

      const truncatedTitle = `${fullTitle.slice(0, low).trimEnd()}…`;
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
  }, [hasTags, imported, title, titleClassName, titleTagsKey]);

  const renderTags = () => hasTags ? (
    <span data-search-card-title-tags className="ml-1.5 inline-flex shrink-0 items-center gap-1 whitespace-nowrap align-middle">
      {titleTags.map((label) => (
        <Badge key={`${itemId}-${label}`} variant={searchResultTagVariants[label] || "outline"} className={mobileInlineBadgeClassName}>
          {label}
        </Badge>
      ))}
      {imported ? <Badge variant="imported" className={mobileInlineBadgeClassName}>已导入</Badge> : null}
    </span>
  ) : null;

  return (
    <div ref={containerRef} data-search-card-title className="relative min-w-0 py-0.5" title={title}>
      <span className={cn("min-w-0", hasTags ? "block overflow-hidden" : "line-clamp-2")}>
        <span className={`break-words ${titleClassName}`}>{visibleTitle}</span>
        {renderTags()}
      </span>
      <span ref={measureRef} aria-hidden="true" className="pointer-events-none invisible absolute left-0 top-0 block whitespace-normal">
        <span ref={measureTitleRef} className={`break-words ${titleClassName}`}>{title}</span>
        {renderTags()}
      </span>
    </div>
  );
}

function SearchResultActionLayout({ imported, children, ...props }) {
  const containerRef = useRef(null);
  const [shouldWrap, setShouldWrap] = useState(false);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const actionCount = imported ? 6 : 4;
    const minimumSingleLineWidth = actionCount * 44 + (actionCount - 1) * 4;
    const updateWrapping = (width) => {
      const nextShouldWrap = width + 0.5 < minimumSingleLineWidth;
      setShouldWrap((current) => (current === nextShouldWrap ? current : nextShouldWrap));
    };

    updateWrapping(container.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return undefined;

    const resizeObserver = new ResizeObserver(([entry]) => {
      updateWrapping(entry?.contentRect?.width ?? container.getBoundingClientRect().width);
    });
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [imported]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative z-10 flex w-full min-w-0 items-center justify-end gap-x-1 lg:w-auto lg:flex-nowrap lg:gap-y-1.5",
        shouldWrap ? "flex-wrap gap-y-3" : "flex-nowrap gap-y-1.5"
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function SearchResults({
  platform = "missevan",
  frontendVersion = "0.0.0",
  handleVersionResponse,
  resultSource = "search",
  results = [],
  dramas = [],
  selectedEpisodes = [],
  onSetResults,
  onSetDramas,
  onSelectionChange,
  onAddDramas,
  onStartRevenueEstimate,
  onStartDramaPaidIdStatistics,
  onStartPlayCountStatistics,
  onStartIdStatistics,
  onLoadMoreResults,
  hasMoreResults = false,
  loadedResultCount = 0,
  allResults = [],
  isSearchPending = false,
  isLoadingMoreResults = false,
  totalResults = 0,
  platformTabs = [],
  activePlatform = platform,
  onPlatformChange,
  platformResultCounts = {},
  cvResults = [],
  onOpenCv,
  metricLegendOpen = false,
  onToggleMetricLegend,
  favoriteKeys = new Set(),
  favoriteActionsDisabled = false,
  statisticsActionsDisabled = false,
  onToggleFavorite,
  onAddCompareItem,
  canAddCompareItem,
  onRetryMetrics,
}) {
  const idLabel = "作品ID";
  const episodeIdLabel = platform === "manbo" ? "Set ID" : "Sound ID";
  const extraMetaLabel = platform === "manbo" ? "收藏数" : "追剧人数";
  const actionResults = allResults.length ? allResults : results;
  const selectedDramaCount = actionResults.filter((result) => result.checked).length;
  const selectedEpisodeCount = selectedEpisodes.length;
  const visibleResults = results;
  const showLoadMore = resultSource === "search" && Boolean(hasMoreResults);
  const loadedCount = Number(loadedResultCount || visibleResults.length || 0);
  const totalCount = Number(totalResults || 0);
  const canToggleMetricLegend = typeof onToggleMetricLegend === "function";
  const showResultsHeader = platformTabs.length > 1 || canToggleMetricLegend;
  const showingCvResults = activePlatform === "cv";
  const selectedDramaIdSet = new Set(actionResults.filter((result) => result.checked).map((result) => String(result.id)));
  const trendLookupIds = useMemo(() => {
    const sourceResults = Array.isArray(allResults) && allResults.length > 0 ? allResults : results;
    return Array.from(
      new Set(
        sourceResults
          .map((item) => String(item?.id ?? "").trim())
          .filter(Boolean)
      )
    );
  }, [allResults, results]);
  const trendLookupKey = trendLookupIds.join("|");
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [importingDramaIds, setImportingDramaIds] = useState(() => new Set());
  const [trendEligibility, setTrendEligibility] = useState({
    platform: "",
    ids: new Set(),
    isLoaded: false,
  });
  const [trendDialog, setTrendDialog] = useState({
    open: false,
    item: null,
  });
  const [trendState, setTrendState] = useState({
    isLoading: false,
    error: "",
    data: null,
  });
  const trendRequestIdRef = useRef(0);
  const trendEligibilityCacheRef = useRef(new Map());

  function getPlatformResultCountText(nextPlatform) {
    const count = Number(platformResultCounts?.[nextPlatform] ?? 0) || 0;
    return String(count);
  }

  useEffect(() => {
    let cancelled = false;
    if (showingCvResults) {
      return undefined;
    }
    if (!trendLookupKey || (platform !== "missevan" && platform !== "manbo")) {
      setTrendEligibility((current) => {
        if (current.platform === platform && !current.isLoaded && current.ids.size === 0) {
          return current;
        }
        return { platform, ids: new Set(), isLoaded: false };
      });
      return () => {
        cancelled = true;
      };
    }

    const cacheKey = `${frontendVersion}:${platform}:${trendLookupKey}`;
    const cachedIds = trendEligibilityCacheRef.current.get(cacheKey);
    if (cachedIds) {
      setTrendEligibility({
        platform,
        ids: new Set(cachedIds),
        isLoaded: true,
      });
      return undefined;
    }

    setTrendEligibility((current) => ({
      platform,
      ids: current.platform === platform ? current.ids : new Set(),
      isLoaded: current.platform === platform ? current.isLoaded : false,
    }));

    fetchRankTrendAvailabilityData({
      platform,
      ids: trendLookupIds,
      frontendVersion,
    })
      .then(({ response, data } = {}) => {
        if (cancelled) {
          return;
        }

        const ids = response?.ok && data?.success
          ? new Set((Array.isArray(data.ids) ? data.ids : []).map((id) => String(id)))
          : new Set();
        if (response?.ok && data?.success) {
          const cache = trendEligibilityCacheRef.current;
          cache.set(cacheKey, ids);
          if (cache.size > 50) {
            cache.delete(cache.keys().next().value);
          }
        }
        setTrendEligibility({
          platform,
          ids,
          isLoaded: true,
        });
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Failed to load search trend eligibility", error);
          setTrendEligibility({ platform, ids: new Set(), isLoaded: true });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [frontendVersion, platform, showingCvResults, trendLookupIds, trendLookupKey]);

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

  function getImportedDrama(dramaId) {
    return dramas.find((drama) => String(drama?.drama?.id) === String(dramaId)) || null;
  }

  function getEpisodes(dramaId) {
    const drama = getImportedDrama(dramaId);
    return Array.isArray(drama?.episodes?.episode) ? drama.episodes.episode : [];
  }

  function isPaidOrMemberEpisode(episode) {
    return isPaidEpisode(platform, episode) || isMemberEpisode(platform, episode);
  }

  function areAllEpisodesSelected(dramaId) {
    const episodes = getEpisodes(dramaId);
    return episodes.length > 0 && episodes.every((episode) => episode.selected);
  }

  function arePaidEpisodesSelected(dramaId) {
    let hasPaidEpisode = false;
    let allPaidSelected = true;
    getEpisodes(dramaId).forEach((episode) => {
      if (!isPaidOrMemberEpisode(episode)) {
        return;
      }
      hasPaidEpisode = true;
      if (!episode.selected) {
        allPaidSelected = false;
      }
    });
    return hasPaidEpisode && allPaidSelected;
  }

  function areAllResultsSelected() {
    return results.length > 0 && results.every((result) => result.checked);
  }

  function areSelectedDramaPaidEpisodesSelected() {
    if (!selectedDramaIdSet.size) {
      return false;
    }
    for (const dramaId of selectedDramaIdSet) {
      if (!getImportedDrama(dramaId)) {
        return false;
      }
    }
    let hasPaidEpisode = false;
    let allPaidSelected = true;
    dramas.forEach((drama) => {
      if (!selectedDramaIdSet.has(String(drama?.drama?.id))) {
        return;
      }
      const episodes = Array.isArray(drama?.episodes?.episode) ? drama.episodes.episode : [];
      episodes.forEach((episode) => {
        if (!isPaidOrMemberEpisode(episode)) {
          return;
        }
        hasPaidEpisode = true;
        if (!episode.selected) {
          allPaidSelected = false;
        }
      });
    });
    return hasPaidEpisode && allPaidSelected;
  }

  function emitSelectionChange(nextDramas) {
    onSelectionChange?.(collectSelectedEpisodes(nextDramas));
  }

  function setResultsMutator(mutator) {
    const nextResults = results.map((item) => ({ ...item }));
    mutator(nextResults);
    onSetResults?.(nextResults);
  }

  function setDramasMutator(mutator) {
    const nextDramas = dramas.map((drama) => ({
      ...drama,
      episodes: {
        ...drama.episodes,
        episode: Array.isArray(drama?.episodes?.episode)
          ? drama.episodes.episode.map((episode) => ({ ...episode }))
          : [],
      },
    }));
    mutator(nextDramas);
    onSetDramas?.(nextDramas);
    emitSelectionChange(nextDramas);
  }

  function getSelectedDramaIds() {
    return actionResults
      .filter((result) => result.checked)
      .map((result) => (platform === "manbo" ? String(result.id) : Number(result.id)));
  }

  function getFirstSelectedDramaId() {
    const firstSelected = actionResults.find((result) => result.checked);
    return firstSelected ? getResultDramaId(firstSelected) : null;
  }

  function getResultDramaId(item) {
    return platform === "manbo" ? String(item.id) : Number(item.id);
  }

  function getFavoriteKey(item) {
    return `${platform}:${String(item?.id ?? "").trim()}`;
  }

  function isFavorite(item) {
    return Boolean(favoriteKeys?.has?.(getFavoriteKey(item)));
  }

  function buildFavoritePayload(item) {
    return {
      platform,
      dramaId: String(item?.id ?? "").trim(),
      title: item?.name || "",
      cover: item?.cover || "",
      paymentLabel: getSearchResultPaymentTag(item),
      contentTypeLabel: getSearchResultTitleTags(item)[0] || "",
      dramaUpdatedAt: item?.updated_at || item?.dramaUpdatedAt || "",
      mainCvText: item?.main_cv_text || item?.mainCvText || "",
      source: resultSource || "search",
    };
  }

  function canShowSearchTrend(item) {
    if (!trendEligibility.isLoaded || trendEligibility.platform !== platform) {
      return false;
    }
    const id = String(item?.id ?? "").trim();
    return Boolean(id && trendEligibility.ids.has(id));
  }

  async function openTrendDialog(item) {
    if (!canShowSearchTrend(item)) {
      return;
    }
    const id = String(item?.id ?? "").trim();
    const requestId = trendRequestIdRef.current + 1;
    trendRequestIdRef.current = requestId;
    setTrendDialog({ open: true, item });
    logRankTrendOpen({
      platform,
      id,
      name: item?.name,
      source: "search",
      frontendVersion,
    });
    setTrendState((current) => ({
      ...current,
      isLoading: !current.data || String(current.data?.id ?? "") !== id,
      error: "",
    }));
    try {
      const { response, data } = await fetchRankTrendData({
        platform,
        id,
        frontendVersion,
      });
      if (trendRequestIdRef.current !== requestId) {
        return;
      }
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
      console.error("Failed to load search result trend", error);
      if (trendRequestIdRef.current !== requestId) {
        return;
      }
      setTrendState({
        isLoading: false,
        error: "趋势数据暂不可用。",
        data: null,
      });
    }
  }

  function addCompareItem(item) {
    if (!canShowSearchTrend(item)) {
      return;
    }
    onAddCompareItem?.({
      platform,
      id: String(item?.id ?? "").trim(),
      title: item?.name || "",
      cover: item?.cover || "",
      mainCvText: item?.main_cv_text || item?.mainCvText || "",
    });
  }

  function closeTrendDialog(open) {
    setTrendDialog((current) => ({
      ...current,
      open,
    }));
  }

  function getSelectedEpisodeIds() {
    return selectedEpisodes.map((episode) => episode.sound_id);
  }

  function clearAllResults() {
    setResultsMutator((nextResults) => {
      nextResults.forEach((result) => {
        result.checked = false;
      });
    });
  }

  function clearAllSelections() {
    clearAllResults();
    setDramasMutator((nextDramas) => {
      nextDramas.forEach((drama) => {
        const episodes = Array.isArray(drama?.episodes?.episode) ? drama.episodes.episode : [];
        episodes.forEach((episode) => {
          episode.selected = false;
        });
      });
    });
  }

  function setAllResultsChecked(checked) {
    setResultsMutator((nextResults) => {
      nextResults.forEach((result) => {
        result.checked = Boolean(checked);
      });
    });
  }

  async function importOrToggleDrama(item) {
    const dramaId = String(item?.id ?? "");
    if (!dramaId || importingDramaIds.has(dramaId)) {
      return;
    }
    if (getImportedDrama(dramaId)) {
      toggleDrama(dramaId);
      return;
    }
    setImportingDramaIds((current) => new Set(current).add(dramaId));
    try {
      await onAddDramas?.([item.id], { autoCheck: true, expandImported: true, preserveScroll: true });
    } finally {
      setImportingDramaIds((current) => {
        const next = new Set(current);
        next.delete(dramaId);
        return next;
      });
    }
  }

  function updateResultChecked(id, checked) {
    setResultsMutator((nextResults) => {
      nextResults.forEach((result) => {
        if (String(result.id) === String(id)) {
          result.checked = checked;
        }
      });
    });
  }

  function toggleDrama(dramaId) {
    setDramasMutator((nextDramas) => {
      nextDramas.forEach((drama) => {
        if (String(drama?.drama?.id) === String(dramaId)) {
          drama.expanded = !drama.expanded;
        }
      });
    });
  }

  function setSelectedEpisodes(dramaId, checked) {
    setDramasMutator((nextDramas) => {
      selectDramaEpisodesByMode(nextDramas, [dramaId], {
        mode: "all",
        checked,
        expand: true,
      });
    });
  }

  function updateEpisodeChecked(dramaId, episodeId, checked) {
    setDramasMutator((nextDramas) => {
      nextDramas.forEach((drama) => {
        if (String(drama?.drama?.id) !== String(dramaId)) {
          return;
        }
        const episodes = Array.isArray(drama?.episodes?.episode) ? drama.episodes.episode : [];
        episodes.forEach((episode) => {
          if (String(episode.sound_id) === String(episodeId)) {
            episode.selected = checked;
          }
        });
      });
    });
  }

  function setPaidEpisodesSelected(dramaId, checked) {
    setDramasMutator((nextDramas) => {
      selectDramaEpisodesByMode(nextDramas, [dramaId], {
        mode: "paid",
        checked,
        expand: true,
        isSelectableEpisode: isPaidOrMemberEpisode,
      });
    });
  }

  function restoreWindowScroll(scrollY) {
    if (typeof window === "undefined" || !Number.isFinite(scrollY)) {
      return;
    }
    const restore = () => window.scrollTo({ top: scrollY, left: window.scrollX, behavior: "auto" });
    restore();
    window.requestAnimationFrame(() => {
      restore();
      window.requestAnimationFrame(restore);
    });
    window.setTimeout(restore, 120);
    window.setTimeout(restore, 420);
  }

  function setSelectedDramaPaidEpisodesSelected(checked, options = {}) {
    const scrollY = options?.preserveViewport && typeof window !== "undefined" ? window.scrollY : NaN;
    if (!selectedDramaIdSet.size) {
      if (checked) {
        toast.warning("请先选择作品。");
      }
      return;
    }
    if (checked) {
      onAddDramas?.(getSelectedDramaIds(), {
        autoCheck: true,
        expandImported: true,
        selectMode: "paid",
        preserveScroll: true,
      })?.finally?.(() => restoreWindowScroll(scrollY));
      restoreWindowScroll(scrollY);
      return;
    }
    setDramasMutator((nextDramas) => {
      selectDramaEpisodesByMode(nextDramas, Array.from(selectedDramaIdSet), {
        mode: "paid",
        checked: false,
        expand: false,
        isSelectableEpisode: isPaidOrMemberEpisode,
      });
    });
    restoreWindowScroll(scrollY);
  }

  function setResultAllEpisodesSelected(item, checked) {
    if (getImportedDrama(item.id)) {
      setSelectedEpisodes(item.id, Boolean(checked));
      return;
    }
    if (checked) {
      onAddDramas?.([item.id], {
        autoCheck: true,
        expandImported: true,
        selectMode: "all",
        preserveScroll: true,
      });
    }
  }

  function setResultPaidEpisodesSelected(item, checked) {
    if (getImportedDrama(item.id)) {
      setPaidEpisodesSelected(item.id, Boolean(checked));
      return;
    }
    if (checked) {
      onAddDramas?.([item.id], {
        autoCheck: true,
        expandImported: true,
        selectMode: "paid",
        preserveScroll: true,
      });
    }
  }

  function getEpisodeTagText(episode) {
    if (isMemberEpisode(platform, episode)) {
      return "会员";
    }
    return isPaidEpisode(platform, episode) ? "付费" : "";
  }

  function getResultMetrics(item) {
    const metricsStatus = String(item?.metrics_status || "ready");
    if (metricsStatus !== "ready") {
      const value = metricsStatus === "loading" || metricsStatus === "pending"
        ? "正在获取"
        : metricsStatus === "access_denied"
          ? "暂不可用"
          : "获取失败";
      return [
        { label: "总播放量", value, loading: metricsStatus === "loading" || metricsStatus === "pending" },
        { label: extraMetaLabel, value, loading: metricsStatus === "loading" || metricsStatus === "pending" },
        platform === "missevan"
          ? { label: "打赏人数", value, loading: metricsStatus === "loading" || metricsStatus === "pending" }
          : { label: "投喂总数", value, loading: metricsStatus === "loading" || metricsStatus === "pending" },
      ];
    }
    return [
      {
        label: "总播放量",
        value: formatPlainNumber(item.view_count),
      },
      item?.subscription_num != null
        ? {
            label: extraMetaLabel,
            value: formatPlainNumber(item.subscription_num),
          }
        : null,
      platform === "manbo" && !item?.is_member && item?.revenue_type !== "episode" && Number.isFinite(Number(item?.pay_count)) && Number(item.pay_count) > 0
        ? {
            label: "付费人数",
            value: formatPlainNumber(item.pay_count),
          }
        : null,
      platform === "manbo" && item?.is_member && Number.isFinite(Number(item?.member_listen_count)) && Number(item.member_listen_count) > 0
        ? {
            label: "收听人数",
            value: formatPlainNumber(item.member_listen_count),
          }
        : null,
      platform === "missevan" && item?.reward_num != null && Number.isFinite(Number(item.reward_num))
        ? {
            label: "打赏人数",
            value: formatPlainNumber(item.reward_num),
          }
        : null,
      platform === "manbo"
        ? {
            label: "投喂总数",
            value: formatPlainNumber(item.diamond_value),
          }
        : null,
    ].filter(Boolean);
  }

  const actionButtonBaseClass = "h-9 w-full justify-start px-2.5 text-[14px]!";
  const mobileBatchTextClass = "text-xs! font-medium";
  const mobileActionHitAreaClass = "relative h-11 min-h-11 w-full min-w-0 bg-transparent! p-0 shadow-none! hover:bg-transparent! active:translate-y-0";
  const mobileActionVisualClass = `pointer-events-none absolute -inset-x-px top-1/2 h-9 w-auto min-w-0 -translate-y-1/2 gap-1 px-1 sm:px-2 ${mobileBatchTextClass}`;
  const mobileManagementVisualClass = "border-border/70 bg-background/84";
  const batchSwitchHitAreaClass = "relative block h-11 min-h-11 w-full min-w-0";
  const batchSwitchVisualClass = "absolute inset-x-0 top-1/2 flex h-9 w-full min-w-0 -translate-y-1/2 items-center justify-center gap-1.5 rounded-[calc(var(--radius)-0.12rem)] border border-border/70 bg-background/84 px-1 text-[0.7rem] font-medium text-foreground sm:gap-2 sm:px-2 sm:text-xs";
  const desktopBatchControlClass = "flex h-9 w-full items-center justify-start gap-2 rounded-md border border-border/75 bg-background px-2.5 text-[14px]! font-medium";
  const resultActionButtonClass = "relative h-8 min-w-11 shrink justify-center gap-1 rounded-[calc(var(--radius)-0.12rem)] px-1.5 text-center text-[0.7rem] after:absolute after:inset-x-0 after:-inset-y-1.5 after:rounded-md after:content-[''] sm:gap-1.5 sm:px-2.5 sm:text-xs lg:min-w-0";
  const resultSelectionActionClass = `${resultActionButtonClass} border-border/70 bg-background/84 text-foreground aria-pressed:border-2 aria-pressed:border-primary aria-pressed:bg-primary/8 aria-pressed:font-semibold aria-pressed:text-primary hover:bg-surface-hover`;
  const trendResultActionButtonClass = `${resultActionButtonClass} border-[color-mix(in_oklch,var(--accent-success)_32%,transparent)] bg-[var(--accent-success)] text-[var(--accent-success-foreground)] shadow-[0_12px_24px_-16px_var(--accent-success)] hover:bg-[color-mix(in_oklch,var(--accent-success)_88%,var(--foreground))] hover:text-[var(--accent-success-foreground)]`;
  function runMobileAction(callback) {
    setMobileActionsOpen(false);
    callback?.();
  }

  function MobileBatchButton({ variant = "outline", visualClassName = "", children, ...props }) {
    return (
      <Button
        type="button"
        variant="ghost"
        data-touch="compact"
        className={mobileActionHitAreaClass}
        {...props}
      >
        <span className={cn(buttonVariants({ variant, size: "sm" }), mobileActionVisualClass, visualClassName)}>
          {children}
        </span>
      </Button>
    );
  }

  function ActionPanel({ variant = "desktop" }) {
    if (variant === "mobile") {
      return (
        <div className="grid gap-0 rounded-lg border border-border/80 bg-surface-floating p-2 shadow-[var(--shadow-panel)] backdrop-blur-xl">
          <div className="grid grid-cols-4 gap-1">
            <label className={batchSwitchHitAreaClass}>
              <span className={batchSwitchVisualClass}>
                <Switch
                  aria-label="切换全选作品"
                  size="sm"
                  checked={areAllResultsSelected()}
                  onCheckedChange={(checked) => setAllResultsChecked(Boolean(checked))}
                  className="data-checked:bg-primary data-unchecked:bg-muted"
                />
                <span>作品</span>
              </span>
            </label>
            <label className={batchSwitchHitAreaClass}>
              <span className={batchSwitchVisualClass}>
                <Switch
                  aria-label="切换全选付费"
                  size="sm"
                  checked={areSelectedDramaPaidEpisodesSelected()}
                  onCheckedChange={(checked) => setSelectedDramaPaidEpisodesSelected(Boolean(checked), { preserveViewport: true })}
                  className="data-checked:bg-primary data-unchecked:bg-muted"
                />
                <span>付费</span>
              </span>
            </label>
            <MobileBatchButton visualClassName={mobileManagementVisualClass} onClick={clearAllSelections}>
              <EraserIcon data-icon="inline-start" />
              清空
            </MobileBatchButton>
            <MobileBatchButton
              visualClassName={mobileManagementVisualClass}
              onClick={() => runMobileAction(() => onAddDramas?.(getSelectedDramaIds(), { scrollToDramaId: getFirstSelectedDramaId() }))}
            >
              <ImportIcon data-icon="inline-start" />
              导入
            </MobileBatchButton>
          </div>
          <div className="grid grid-cols-3 gap-1">
            <MobileBatchButton
              variant="secondary"
              disabled={statisticsActionsDisabled}
              onClick={() => runMobileAction(() => onStartRevenueEstimate?.(getSelectedDramaIds()))}
            >
              <HandCoinsIcon data-icon="inline-start" />
              收益预估
            </MobileBatchButton>
            <MobileBatchButton
              variant="secondary"
              disabled={statisticsActionsDisabled}
              onClick={() => runMobileAction(() => onStartPlayCountStatistics?.(getSelectedEpisodeIds()))}
            >
              <PlayCircleIcon data-icon="inline-start" />
              统计播放量
            </MobileBatchButton>
            <MobileBatchButton
              variant="secondary"
              disabled={statisticsActionsDisabled}
              onClick={() => runMobileAction(() => onStartIdStatistics?.(getSelectedEpisodeIds()))}
            >
              <UserSearchIcon data-icon="inline-start" />
              统计弹幕ID
            </MobileBatchButton>
          </div>
        </div>
      );
    }

    const statClass = "flex min-h-9 items-center justify-between gap-2 rounded-md border border-border/75 bg-background px-2.5 py-1.5";

    return (
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
          {[
            { label: "作品", value: selectedDramaCount },
            { label: "分集", value: selectedEpisodeCount },
          ].map((item) => (
            <div key={item.label} className={statClass}>
              <div className="text-[0.68rem] text-muted-foreground">{item.label}</div>
              <div className="text-sm font-semibold text-foreground">{item.value}</div>
            </div>
          ))}
        </div>

        <div className="grid gap-2">
          <label className={desktopBatchControlClass}>
            <Switch
              aria-label="切换全选作品"
              checked={areAllResultsSelected()}
              onCheckedChange={(checked) => setAllResultsChecked(Boolean(checked))}
              className="data-checked:bg-primary data-unchecked:bg-muted"
            />
            <span>作品全选</span>
          </label>
          <label className={desktopBatchControlClass}>
            <Switch
              aria-label="切换全选付费"
              checked={areSelectedDramaPaidEpisodesSelected()}
              onCheckedChange={(checked) => setSelectedDramaPaidEpisodesSelected(Boolean(checked))}
              className="data-checked:bg-primary data-unchecked:bg-muted"
            />
            <span>付费全选</span>
          </label>
        </div>

        <div className="grid gap-2">
          <Button
            variant="outline"
            className={actionButtonBaseClass}
            onClick={() => {
              setMobileActionsOpen(false);
              clearAllSelections();
            }}
          >
            <EraserIcon data-icon="inline-start" />
            清空选择
          </Button>
          <Button
            variant="outline"
            className={actionButtonBaseClass}
            onClick={() => {
              setMobileActionsOpen(false);
              onAddDramas?.(getSelectedDramaIds());
            }}
          >
            <ImportIcon data-icon="inline-start" />
            批量导入
          </Button>
        </div>

        <div className="grid gap-2">
          <Button
            variant="secondary"
            className={actionButtonBaseClass}
            disabled={statisticsActionsDisabled}
            onClick={() => {
              setMobileActionsOpen(false);
              onStartRevenueEstimate?.(getSelectedDramaIds());
            }}
          >
            <HandCoinsIcon data-icon="inline-start" />
            收益预估
          </Button>
          <Button
            variant="secondary"
            className={actionButtonBaseClass}
            disabled={statisticsActionsDisabled}
            onClick={() => {
              setMobileActionsOpen(false);
              onStartPlayCountStatistics?.(getSelectedEpisodeIds());
            }}
          >
            <PlayCircleIcon data-icon="inline-start" />
            统计播放量
          </Button>
          <Button
            variant="secondary"
            className={actionButtonBaseClass}
            disabled={statisticsActionsDisabled}
            onClick={() => {
              setMobileActionsOpen(false);
              onStartIdStatistics?.(getSelectedEpisodeIds());
            }}
          >
            <UserSearchIcon data-icon="inline-start" />
            统计弹幕 ID
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_150px] lg:items-start">
      <div className="min-w-0">
        {showResultsHeader ? (
          <div className="mb-3">
            <div className="flex items-center justify-between gap-2">
              {platformTabs.length > 1 ? (
                <Tabs className="w-fit max-w-full shrink-0" value={activePlatform} onValueChange={onPlatformChange}>
                  <TabsList className="h-9 max-w-full justify-start">
                    {platformTabs.map((item) => (
                      <TabsTrigger
                        key={item.key}
                        data-touch="compact"
                        data-platform={item.key}
                        className="h-7 min-w-[3.75rem] flex-none px-1 text-xs sm:min-w-[5.25rem] sm:px-2 sm:text-sm"
                        value={item.key}
                      >
                        <PlatformTabLabel platform={item.key} iconClassName="size-3.5" />
                        <span className="tabular-nums">{getPlatformResultCountText(item.key)}</span>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              ) : (
                <div className="min-w-0" />
              )}
              {canToggleMetricLegend ? (
                <button
                  type="button"
                  aria-controls="search-metric-legend"
                  aria-expanded={metricLegendOpen}
                  aria-label={metricLegendOpen ? "收起统计图例" : "展开统计图例"}
                  className="shrink-0 text-sm! font-semibold leading-5 text-primary underline-offset-4 hover:underline sm:hidden"
                  onClick={onToggleMetricLegend}
                >
                  图例
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {showingCvResults ? (
          <CvSearchResults
            results={cvResults}
            onOpenCv={onOpenCv}
          />
        ) : results.length ? (
          <div className="grid gap-3 sm:gap-4">
            {visibleResults.map((item) => {
              const importedDrama = getImportedDrama(item.id);
              const coverUrl = buildProxyImageUrl(item.cover);
              const mainCvText = item.main_cv_text || "";
              const originalAuthorText = String(item.author ?? "").trim();
              const paymentTag = getSearchResultPaymentTag(item);
              const titleTags = getSearchResultTitleTags(item);
              const metrics = getResultMetrics(item);
              const metricsStatus = String(item?.metrics_status || "ready");
              const metricsFailed = metricsStatus === "error" || metricsStatus === "access_denied";
              const canShowTrend = canShowSearchTrend(item);
              const allEpisodesSelected = importedDrama ? areAllEpisodesSelected(item.id) : false;
              const paidEpisodesSelected = importedDrama ? arePaidEpisodesSelected(item.id) : false;
              const importingDrama = importingDramaIds.has(String(item.id));
              const importActionLabel = importingDrama
                ? "正在导入分集"
                : importedDrama
                  ? (importedDrama.expanded ? "收起分集" : "展开分集")
                  : "导入分集";
              const importActionText = importingDrama
                ? "导入中"
                : importedDrama
                  ? (importedDrama.expanded ? "收起" : "展开")
                  : "导入";

              return (
                <Card
                  key={item.id}
                  data-search-result-id={String(item.id)}
                  data-selected={item.checked ? "true" : "false"}
                  className={cn(
                    "relative min-w-0 cursor-pointer gap-0 overflow-visible py-0 transition-colors hover:bg-card",
                    item.checked ? "border-2 border-primary" : "border-border"
                  )}
                  onClick={(event) => {
                    if (event.target.closest("button, a, input, label, select, textarea, [role='menuitem'], [role='switch'], [data-search-card-actions]")) return;
                    updateResultChecked(item.id, !item.checked);
                  }}
                >
                  <button
                    type="button"
                    aria-label={`${item.checked ? "取消选择" : "选择"}${item.name}`}
                    aria-pressed={Boolean(item.checked)}
                    className="pointer-events-none absolute inset-0 z-0 rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring/55"
                    title={`${item.checked ? "取消选择" : "选择"}${item.name}`}
                    onClick={() => updateResultChecked(item.id, !item.checked)}
                  />
                  <CardContent className="relative flex min-w-0 flex-col gap-2 px-3 py-3 sm:px-4 sm:py-4">
                    <div className="grid min-w-0 grid-cols-[6rem_minmax(0,1fr)] items-start gap-3">
                      <div className="relative size-24 shrink-0 self-center overflow-hidden rounded-[calc(var(--radius)-0.05rem)] border border-border/70 bg-muted/50">
                        {coverUrl ? (
                          <LazyImage alt={item.name} className="size-full object-cover" src={coverUrl} />
                        ) : (
                          <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
                            暂无封面
                          </div>
                        )}
                        {paymentTag ? (
                          <Badge variant={searchResultTagVariants[paymentTag] || "outline"} className={coverPaymentBadgeClassName}>
                            {paymentTag}
                          </Badge>
                        ) : null}
                      </div>

                      <div className="flex min-w-0 flex-col justify-center gap-1 lg:min-h-24">
                        <SearchResultTitle
                          imported={Boolean(importedDrama)}
                          itemId={item.id}
                          title={item.name}
                          titleClassName={getTitleClassName(item.name)}
                          titleTags={titleTags}
                        />

                        <div data-search-card-metadata className="min-w-0">
                          <div className="flex min-w-0 flex-col gap-1">
                            <div className="flex min-w-0 items-center gap-1.5 text-xs leading-5 text-muted-foreground" aria-label={`${idLabel}: ${item.id}`} title={`${idLabel}: ${item.id}`}>
                              <PlatformIdIcon aria-hidden="true" className={metaIconClassName} platform={platform} tone="inherit" />
                              <span className="min-w-0 break-all">{item.id}</span>
                            </div>
                            <div className="flex min-w-0 items-center gap-1.5 text-xs leading-5 text-muted-foreground">
                              <FeatherIcon aria-label="原作名" className={metaIconClassName} title="原作名" />
                              <span className="min-w-0 break-words">{originalAuthorText || "暂无"}</span>
                            </div>
                            <div className="flex min-w-0 items-center gap-1.5 text-xs leading-5 text-muted-foreground">
                              <MicIcon aria-label="主要CV" className={metaIconClassName} title="主要CV" />
                              <span className="min-w-0 break-words">{mainCvText.replace(/^主要CV：/, "") || "暂无"}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex min-w-0 flex-col gap-1.5 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex min-w-0 flex-nowrap items-center gap-x-2 text-xs sm:gap-x-3">
                        {metrics.map((metric) => (
                          <div
                            key={`${item.id}-${metric.label}`}
                            aria-label={`${metric.label}: ${metric.value}`}
                            title={`${metric.label}: ${metric.value}`}
                            className="min-w-0 shrink text-foreground"
                          >
                            <span className="inline-flex w-fit max-w-full items-center gap-1">
                              <MetricIcon label={metric.label} loading={metric.loading} className="size-3.5 shrink-0 text-muted-foreground" />
                              <span className={`min-w-0 whitespace-nowrap font-medium tabular-nums ${metricsStatus === "ready" ? "metric-value-ready" : ""}`}>{metric.value}</span>
                            </span>
                          </div>
                        ))}
                        {metricsFailed ? (
                          <Button type="button" variant="ghost" size="xs" className="h-7 px-1.5 text-xs" onClick={() => onRetryMetrics?.(item)}>
                            重试
                          </Button>
                        ) : null}
                      </div>

                      <SearchResultActionLayout data-search-card-actions="true" imported={Boolean(importedDrama)}>
                        <Button
                          type="button"
                          data-touch="compact"
                          variant={importedDrama ? "outline" : "default"}
                          className={resultActionButtonClass}
                          aria-label={importActionLabel}
                          title={importActionLabel}
                          disabled={importingDrama}
                          onClick={() => importOrToggleDrama(item)}
                        >
                          {importingDrama ? (
                            <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
                          ) : importedDrama ? (
                            importedDrama.expanded
                              ? <ChevronDownIcon data-icon="inline-start" />
                              : <ChevronRightIcon data-icon="inline-start" />
                          ) : (
                            <ImportIcon data-icon="inline-start" />
                          )}
                          <span className={cn("min-w-0 truncate whitespace-nowrap", importedDrama && "hidden lg:inline")}>{importActionText}</span>
                        </Button>
                        {importedDrama ? <Button
                          type="button"
                          data-touch="compact"
                          variant="outline"
                          className={resultSelectionActionClass}
                          aria-label={allEpisodesSelected ? "取消当前作品全选" : "选择当前作品全部分集"}
                          aria-pressed={allEpisodesSelected}
                          title="全选"
                          onClick={() => setResultAllEpisodesSelected(item, !allEpisodesSelected)}
                        >
                          <span className="min-w-0 truncate whitespace-nowrap">全选</span>
                        </Button> : null}
                        {importedDrama ? <Button
                          type="button"
                          data-touch="compact"
                          variant="outline"
                          className={resultSelectionActionClass}
                          aria-label={paidEpisodesSelected ? "取消当前作品付费分集选择" : "选择当前作品付费分集"}
                          aria-pressed={paidEpisodesSelected}
                          title="付费"
                          onClick={() => setResultPaidEpisodesSelected(item, !paidEpisodesSelected)}
                        >
                          <span className="min-w-0 truncate whitespace-nowrap">付费</span>
                        </Button> : null}
                        <Button
                          type="button"
                          data-touch="compact"
                          className={trendResultActionButtonClass}
                          aria-label="查看趋势"
                          title="趋势"
                          disabled={!canShowTrend}
                          onClick={() => openTrendDialog(item)}
                        >
                          <TrendingUpIcon data-icon="inline-start" />
                          <span className={cn("min-w-0 truncate whitespace-nowrap", importedDrama && "hidden lg:inline")}>趋势</span>
                        </Button>
                        <Button
                          type="button"
                          data-touch="compact"
                          variant="secondary"
                          className={resultActionButtonClass}
                          aria-label="统计付费ID"
                          title="付费ID"
                          disabled={statisticsActionsDisabled}
                          onClick={() => onStartDramaPaidIdStatistics?.(
                            getResultDramaId(item),
                            { source: `${getResultDramaId(item)}payID` }
                          )}
                        >
                          <UserSearchIcon data-icon="inline-start" />
                          <span className={cn("min-w-0 truncate whitespace-nowrap", importedDrama && "hidden lg:inline")}>付费ID</span>
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              data-touch="compact"
                              variant="outline"
                              className={resultActionButtonClass}
                              aria-label={`${item.name}更多操作`}
                              title="更多操作"
                            >
                              <MoreHorizontalIcon data-icon="inline-start" />
                              <span className={cn("min-w-0 truncate whitespace-nowrap", importedDrama && "hidden lg:inline")}>更多</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" side="bottom">
                            <DropdownMenuItem
                              disabled={favoriteActionsDisabled}
                              onSelect={() => onToggleFavorite?.(buildFavoritePayload(item))}
                            >
                              <StarIcon aria-hidden="true" className={isFavorite(item) ? "fill-primary text-primary" : ""} />
                              {isFavorite(item) ? "取消收藏" : "收藏"}
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={!canShowTrend || (canAddCompareItem ? !canAddCompareItem(item) : false)} onSelect={() => addCompareItem(item)}>
                              <ArrowLeftRightIcon aria-hidden="true" />
                              对比
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={statisticsActionsDisabled}
                              onSelect={() => onStartRevenueEstimate?.([getResultDramaId(item)], { source: `${getResultDramaId(item)}earn` })}
                            >
                              <HandCoinsIcon aria-hidden="true" />
                              收益
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <PlatformDramaLink
                                appearance="menu"
                                platform={platform}
                                dramaId={item.id}
                                idLabel={idLabel}
                                source="search"
                                dramaTitle={item.name}
                                frontendVersion={frontendVersion}
                              />
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </SearchResultActionLayout>
                    </div>

                    {canShowTrend && trendDialog.open && String(trendDialog.item?.id) === String(item.id) ? (
                      <LazyRankTrendDialog
                        open
                        onOpenChange={closeTrendDialog}
                        item={item}
                        platform={platform}
                        trendState={trendState}
                        frontendVersion={frontendVersion}
                        handleVersionResponse={handleVersionResponse}
                      />
                    ) : null}

                    {importedDrama?.expanded ? (
                      <>
                        <div className="border-t border-dotted border-border/80" />
                        <div className="border-y border-border/70 lg:rounded-[calc(var(--radius)-0.05rem)] lg:border lg:bg-muted/12">
                          <div className="max-h-[22rem] divide-y divide-border overflow-y-auto sm:max-h-[28rem] lg:grid lg:gap-px lg:divide-y-0 lg:bg-border">
                            {getEpisodes(item.id).map((episode) => (
                            <div
                              key={episode.sound_id}
                              className="flex flex-col gap-2 bg-background px-1 py-2.5 sm:flex-row sm:items-center sm:justify-between lg:bg-background/94 lg:px-3"
                            >
                              <label className="flex min-w-0 flex-1 items-start gap-3">
                                <Checkbox
                                  checked={Boolean(episode.selected)}
                                  onCheckedChange={(checked) => updateEpisodeChecked(item.id, episode.sound_id, Boolean(checked))}
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium leading-5">
                                      <span className="break-words">{episode.name}</span>
                                      {getEpisodeTagText(episode) ? (
                                        <Badge variant={isMemberEpisode(platform, episode) ? "info" : "coral"} className={`${metaBadgeClassName} shrink-0`}>
                                          {getEpisodeTagText(episode)}
                                        </Badge>
                                      ) : null}
                                      <span className="inline-flex min-w-0 items-center gap-1 text-xs font-normal text-muted-foreground sm:text-[0.82rem]">
                                        <HashIcon aria-label={episodeIdLabel} className="size-3.5 shrink-0" title={episodeIdLabel} />
                                        <span className="min-w-0 break-all">{episode.sound_id}</span>
                                      </span>
                                  </div>
                                </div>
                              </label>
                            </div>
                          ))}
                        </div>
                        </div>
                      </>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
            {showLoadMore ? (
              <div className="flex flex-row flex-wrap items-center justify-center gap-2 pt-2 text-sm">
                <Button
                  aria-label="加载更多搜索结果"
                  variant="outline"
                  className="h-9 min-w-36 gap-2 px-4 text-sm"
                  disabled={isLoadingMoreResults}
                  onClick={() => onLoadMoreResults?.()}
                >
                  {isLoadingMoreResults ? "加载中" : "加载更多"}
                  <ChevronsDownIcon data-icon="inline-end" />
                </Button>
                {totalCount > 0 ? (
                  <div className="whitespace-nowrap text-xs text-muted-foreground">
                    已显示 {Math.min(loadedCount, totalCount)} / {totalCount}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className={`${showResultsHeader ? "mt-4 " : ""}rounded-lg border border-dashed border-border/80 bg-muted/30 px-6 py-10 text-center`}>
            {isSearchPending ? (
              <div className="inline-flex items-center justify-center gap-2 text-base font-semibold">
                <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
                <span>正在搜索/导入……</span>
              </div>
            ) : (
              <div className="text-base font-semibold">还没有结果</div>
            )}
          </div>
        )}
      </div>
      {results.length ? (
        <aside className="hidden lg:sticky lg:top-36 lg:block">
          <div className="grid gap-3">
            <div className="rounded-lg border border-border bg-card p-3 shadow-[var(--shadow-card)]">
              <div className="mb-3 text-xs font-semibold text-muted-foreground">批量操作</div>
              <ActionPanel />
            </div>
          </div>
        </aside>
      ) : null}
      {results.length ? (
        <>
          {mobileActionsOpen ? (
            <button
              aria-label="收起批量操作"
              className="fixed inset-0 z-30 cursor-default bg-transparent lg:hidden"
              type="button"
              onClick={() => setMobileActionsOpen(false)}
            />
          ) : null}
          <div className="fixed inset-x-3 mobile-fixed-bottom z-40 lg:hidden">
            {mobileActionsOpen ? (
              <div>
                <ActionPanel variant="mobile" />
              </div>
            ) : null}
            <div className="rounded-lg border border-border/80 bg-surface-floating p-1.5 shadow-[var(--shadow-panel)] backdrop-blur-xl">
            <div className="grid grid-cols-[repeat(2,minmax(0,1fr))_auto] items-center gap-1.5">
              {[
                { label: "作品", value: selectedDramaCount },
                { label: "分集", value: selectedEpisodeCount },
              ].map((item) => (
                <div key={item.label} className="flex h-11 min-w-0 items-center justify-center gap-1 rounded-md bg-muted/55 px-2 text-center">
                  <span className="truncate text-xs text-muted-foreground">{item.label}</span>
                  <span className="text-sm font-semibold">{item.value}</span>
                </div>
              ))}
              <Button size="sm" className="h-11 px-3 text-[14px]!" onClick={() => setMobileActionsOpen((current) => !current)}>
                批量
                <ChevronUpIcon className={mobileActionsOpen ? "rotate-180 transition-transform" : "transition-transform"} data-icon="inline-end" />
              </Button>
            </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
