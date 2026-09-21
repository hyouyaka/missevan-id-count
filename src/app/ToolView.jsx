import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RefreshCwIcon,
  AlertTriangleIcon,
  MenuIcon,
} from "lucide-react";
import { toast } from "sonner";

import { AppIcon } from "@/app/AppIcon";
import { BackgroundTaskCenter } from "@/app/BackgroundTaskCenter";
import { DramaCompareBasket, DramaCompareDialog } from "@/app/DramaCompare";
import { useDramaCompare } from "@/app/useDramaCompare";
import { ChangelogDialog, useChangelogDialog } from "@/app/ChangelogDialog";
import { HomeView } from "@/app/HomeView";
import { MessageDialog } from "@/app/MessageDialog";
import { SearchPanel } from "@/app/SearchPanel";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";
import {
  MainNavigationDrawer,
  LazyRouteFallback,
  getInitialDrawerExpandedRootKeys,
} from "@/app/navigation";
import { canParseShareUrl, decryptShareUrl, extractResolvedId } from "@/utils/manboCrypto";
import {
  createFavoriteKey,
  listFavorites,
  removeFavoriteWithSnapshots,
  saveFavorite,
} from "@/app/favoritesStorage";
import {
  buildCvProfileOpenUsagePayload,
  buildOngoingNavigationMenu,
  buildRanksNavigationMenu,
  buildRevenueSummary,
  buildVersionedUrl,
  buildPlayCountDramasFromDramas,
  collectSelectedEpisodesFromDramas,
  createRuntimeMeta,
  createStatsState,
  extractResponseItems,
  getBackendVersionFromResponse,
  getDefaultAppConfig,
  getMissevanAccessDeniedMessage,
  getRemainingCooldownMinutes,
  getScrollBehavior,
  isAbortError,
  mergeAppConfig,
  MISSEVAN_DESKTOP_ACCESS_HINT,
  normalizeVersion,
  readJsonResponse,
  resolveIdStatisticsSource,
  normalizeStatsHistoryReplay,
  selectDramaEpisodesByMode,
} from "@/app/app-utils";
import { fetchRanksData, getCachedRanksData } from "@/app/ranksData";
import {
  createStatsTask,
  getStatsTaskSnapshot,
  notifyStatsTaskCancel,
} from "@/app/statsTaskClient";
import { useStatsTaskRun } from "@/app/useStatsTaskRun";
import { createPlatformStatesWithHistory, useStatsHistory } from "@/app/useStatsHistory";
import {
  clearSearchCardDynamicMetrics,
  useSearchCardMetrics,
} from "@/app/useSearchCardMetrics";
import {
  appendSearchResultsPage,
  getAllSearchResults,
  getSearchResultCount,
  resetSearchResultsState,
  setManualSearchResultsState,
  setSearchResultsState,
  setVisibleSearchResults,
  updateSearchResultsPage,
} from "@/app/searchResultsState";
import { useToolNavigation } from "@/app/useToolNavigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isMemberEpisode, isPaidEpisode } from "../../shared/episodeRules.js";
import { getRevenueEpisodesForDrama } from "../../shared/revenueEpisodeSelection.js";

const RanksPanel = lazy(() =>
  import("@/app/RanksPanel").then((module) => ({ default: module.RanksPanel }))
);

const OngoingPanel = lazy(() =>
  import("@/app/OngoingPanel").then((module) => ({ default: module.OngoingPanel }))
);

const FeedbackView = lazy(() =>
  import("@/app/FeedbackView").then((module) => ({ default: module.FeedbackView }))
);

const SearchWorkspace = lazy(() => import("@/app/SearchWorkspace"));

const FavoritesPanel = lazy(() =>
  import("@/app/FavoritesPanel").then((module) => ({ default: module.FavoritesPanel }))
);

const CvProfileView = lazy(() =>
  import("@/app/CvProfileView").then((module) => ({ default: module.CvProfileView }))
);

function getStatsRequestErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.trim() || "统计失败，请稍后重试。";
}


function createIdleBackgroundTask() {
  return {
    isRunning: false,
    status: "idle",
    type: "",
    title: "",
    description: "",
    progress: 0,
    action: "",
    resultTarget: "",
    highlighted: false,
  };
}

export function ToolView({ initialAppConfig }) {
  const [appConfig, setAppConfig] = useState({
    ...getDefaultAppConfig(),
    ...(initialAppConfig || {}),
  });
  const {
    appConfigRef,
    currentPlatform,
    currentPlatformRef,
    initialToolRouteState,
    navigateCurrentPlatform,
    navigateToolRoute,
    searchRouteRestoreGeneration,
    searchRouteRestoreKeyword,
    toolRouteState,
    toolRouteStateRef,
  } = useToolNavigation({ initialAppConfig, appConfig });
  const [activeSearchPlatform, setActiveSearchPlatform] = useState(() =>
    initialToolRouteState.platform === "manbo" || initialAppConfig?.missevanEnabled === false ? "manbo" : "missevan"
  );
  const [activeSearchCategory, setActiveSearchCategory] = useState(() =>
    initialToolRouteState.view === "search" && ["missevan", "manbo", "cv"].includes(initialToolRouteState.platform)
      ? initialToolRouteState.platform
      : initialAppConfig?.missevanEnabled === false ? "manbo" : "missevan"
  );
  const [cvSearchState, setCvSearchState] = useState({
    results: [],
    matchedCount: 0,
    exactMatch: false,
    keyword: "",
  });
  const [sharedSearchForm, setSharedSearchForm] = useState({
    keyword: initialToolRouteState.q,
    manualInput: "",
  });
  const [sharedOutputPlatform, setSharedOutputPlatform] = useState(() =>
    initialAppConfig?.missevanEnabled === false ? "manbo" : "missevan"
  );
  const [platformStates, setPlatformStates] = useState(createPlatformStatesWithHistory);
  const [notice, setNotice] = useState(null);
  const [searchJumpStatus, setSearchJumpStatus] = useState(null);
  const [searchMetricLegendOpen, setSearchMetricLegendOpen] = useState(false);
  const [globalSearchPending, setGlobalSearchPending] = useState(() => Boolean(initialToolRouteState.q));
  const [favoriteItems, setFavoriteItems] = useState([]);
  const [favoriteRefreshState, setFavoriteRefreshState] = useState({
    isRunning: false,
    progress: 0,
    currentTitle: "",
    currentAction: "",
  });
  const [backgroundTask, setBackgroundTask] = useState(() => createIdleBackgroundTask());
  const {
    addDramaToCompareBasket,
    canAddDramaToCompareBasket,
    clearCompareBasket,
    compareBasketOpen,
    compareDialogOpen,
    compareItems,
    openCompareDialog,
    removeDramaFromCompareBasket,
    setCompareBasketOpen,
    setCompareDialogOpen,
  } = useDramaCompare();
  const [favoriteRefreshRevision, setFavoriteRefreshRevision] = useState(0);
  const [cancelFavoriteRequest, setCancelFavoriteRequest] = useState(null);
  const [mainDrawerOpen, setMainDrawerOpen] = useState(false);
  const [isDesktopBrowser, setIsDesktopBrowser] = useState(false);
  const [mainNavigationRanksData, setMainNavigationRanksData] = useState(null);
  const [mainNavigationRanksStatus, setMainNavigationRanksStatus] = useState("idle");
  const {
    changelogOpen,
    changelogMode,
    openChangelog,
    showChangelogHistory,
    setChangelogOpen,
  } = useChangelogDialog(appConfig.frontendVersion);

  const activeSearchPlatformRef = useRef(activeSearchPlatform);
  const sharedOutputPlatformRef = useRef(sharedOutputPlatform);
  const platformStatesRef = useRef(platformStates);
  const favoriteRefreshStateRef = useRef(favoriteRefreshState);
  const backgroundTaskRef = useRef(backgroundTask);
  const runtimeMetaRef = useRef({
    missevan: createRuntimeMeta(),
    manbo: createRuntimeMeta(),
  });
  const resultsPanelRef = useRef(null);
  const outputPanelRef = useRef(null);
  const replayPreparingRef = useRef(new Set());
  const replayPreparationAbortControllerRef = useRef(null);
  const replayCardsAbortControllerRef = useRef(null);
  const refreshRunUnlinksRef = useRef(new Map());
  const replaySearchGenerationRef = useRef(0);
  const historyPersistenceFailureRef = useRef(false);
  const [replayPreparingEntryIds, setReplayPreparingEntryIds] = useState([]);
  const statsHistory = useStatsHistory({
    platformStates,
    getPlatformStates: () => platformStatesRef.current,
    getRuntimeMeta: (platform) => runtimeMetaRef.current[platform],
    updatePlatformState,
    onPersistenceFailure: () => {
      if (!historyPersistenceFailureRef.current) {
        historyPersistenceFailureRef.current = true;
        toast.warning("查询历史未能保存到本机，当前结果仍保留在本次页面中。");
      }
    },
  });
  const statsTaskRun = useStatsTaskRun({
    getRuntimeMeta: (platform) => runtimeMetaRef.current[platform],
    getActiveTaskId: (platform) => platformStatesRef.current[platform]?.stats?.activeTaskId || "",
    getActiveTaskIds: () => Object.values(platformStatesRef.current)
      .map((state) => state?.stats?.activeTaskId || ""),
    getRunStartedAt: (platform) => platformStatesRef.current[platform]?.stats?.startedAt || 0,
    isRunMarkedRunning: (platform) => Boolean(platformStatesRef.current[platform]?.stats?.isRunning),
    createTask: ({ platform, taskType, payload, signal }) => createStatsTask({
      platform,
      taskType,
      payload,
      signal,
      frontendVersion: appConfigRef.current.frontendVersion,
      onVersionStatus: updateVersionStatusFromResponse,
    }),
    getTaskSnapshot: ({ taskId, signal }) => getStatsTaskSnapshot(taskId, {
      signal,
      frontendVersion: appConfigRef.current.frontendVersion,
      onVersionStatus: updateVersionStatusFromResponse,
    }),
    notifyTaskCancel: notifyStatsTaskCancel,
    onRunStarted: applyStatsRunStarted,
    onElapsed: applyStatsRunElapsed,
    onRunCancelled: applyStatsRunCancelled,
    onRunFinished: applyStatsRunFinished,
    onTaskCreated: applyStatsTaskCreated,
    onSnapshot: applyStatsTaskSnapshot,
    onCompleted: applyStatsTaskCompleted,
  });

  function logCompareUsage(items = []) {
    if (!Array.isArray(items) || !items.length) {
      return;
    }
    fetch(buildVersionedUrl("/usage-log", appConfigRef.current.frontendVersion), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "compare",
        platforms: items.map((item) => item.platform),
        dramaIds: items.map((item) => item.id),
        dramaTitles: items.map((item) => item.title),
        compareKinds: items.map((item) => item.compareKind),
      }),
    }).catch((error) => {
      console.error("Failed to log compare usage", error);
    });
  }

  function openCompareDialogFromBasket() {
    logCompareUsage(compareItems);
    openCompareDialog();
  }

  useEffect(() => {
    activeSearchPlatformRef.current = activeSearchPlatform;
  }, [activeSearchPlatform]);

  useEffect(() => {
    if (toolRouteState.view !== "search") {
      return;
    }
    setSharedSearchForm((current) => current.keyword === toolRouteState.q ? current : { ...current, keyword: toolRouteState.q });
    setActiveSearchCategory(toolRouteState.platform);
    if (toolRouteState.platform === "missevan" || toolRouteState.platform === "manbo") {
      setActiveSearchPlatform(toolRouteState.platform);
    }
  }, [toolRouteState.platform, toolRouteState.q, toolRouteState.view]);

  useEffect(() => {
    if (toolRouteState.view !== "search" || !toolRouteState.q || typeof window === "undefined") {
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [toolRouteState.q, toolRouteState.view]);

  useEffect(() => {
    sharedOutputPlatformRef.current = sharedOutputPlatform;
  }, [sharedOutputPlatform]);

  useEffect(() => {
    platformStatesRef.current = platformStates;
  }, [platformStates]);

  useEffect(() => {
    favoriteRefreshStateRef.current = favoriteRefreshState;
  }, [favoriteRefreshState]);

  useEffect(() => {
    backgroundTaskRef.current = backgroundTask;
  }, [backgroundTask]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }
    const mediaQuery = window.matchMedia("(min-width: 640px)");
    const updateDesktopState = () => {
      setIsDesktopBrowser(mediaQuery.matches);
    };
    updateDesktopState();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updateDesktopState);
      return () => mediaQuery.removeEventListener("change", updateDesktopState);
    }
    mediaQuery.addListener?.(updateDesktopState);
    return () => mediaQuery.removeListener?.(updateDesktopState);
  }, []);

  const searchPlatforms = [
    { key: "missevan", label: "猫耳" },
    { key: "manbo", label: "漫播" },
  ];
  const webPlatforms = [
    { key: "home", label: "首页" },
    { key: "search", label: "计算与统计" },
    { key: "missevan", label: "猫耳" },
    { key: "manbo", label: "漫播" },
    { key: "favorites", label: "收藏" },
  ];
  const desktopPlatforms = [
    { key: "search", label: "计算与统计" },
    { key: "favorites", label: "收藏" },
  ];
  const visiblePlatforms = appConfig.desktopApp ? desktopPlatforms : webPlatforms;
  const drawerRootItemClassName = appConfig.desktopApp
    ? "relative w-full justify-start overflow-hidden text-sm! font-medium text-foreground visited:text-foreground hover:text-foreground"
    : "relative w-full justify-start overflow-hidden text-base! font-medium text-foreground visited:text-foreground hover:text-foreground";
  const drawerChildItemClassName = appConfig.desktopApp
    ? "relative w-full justify-start overflow-hidden text-[0.82rem]! font-medium text-foreground visited:text-foreground hover:text-foreground"
    : "relative w-full justify-start overflow-hidden text-sm! font-medium text-foreground visited:text-foreground hover:text-foreground";
  const drawerUtilityItemClassName = appConfig.desktopApp
    ? "relative w-full justify-start overflow-hidden text-[0.82rem]! font-normal! text-foreground visited:text-foreground hover:text-foreground"
    : "relative w-full justify-start overflow-hidden text-sm! font-normal! text-foreground visited:text-foreground hover:text-foreground";
  const mobileMenuActiveItemClassName = "bg-accent text-accent-foreground before:absolute before:inset-y-1.5 before:left-1 before:w-1 before:rounded-full before:bg-primary";
  const defaultExpandedRootKeys = useMemo(
    () => getInitialDrawerExpandedRootKeys(toolRouteState, isDesktopBrowser && !appConfig.desktopApp),
    [appConfig.desktopApp, isDesktopBrowser, toolRouteState]
  );
  const ongoingNavigationMenu = useMemo(() => buildOngoingNavigationMenu(), []);
  const ranksNavigationMenu = useMemo(
    () => buildRanksNavigationMenu(mainNavigationRanksData),
    [mainNavigationRanksData]
  );
  const activeBrowsePlatform = activeSearchPlatform === "manbo" || appConfig.missevanEnabled ? activeSearchPlatform : "manbo";

  const currentBrowseState = currentPlatform === "search" ? platformStates[activeBrowsePlatform] : null;
  const sharedOutputState = platformStates[sharedOutputPlatform];
  const sharedStatsState = sharedOutputState?.stats || null;
  const sharedRevenueSummary = sharedStatsState?.revenueSummary || buildRevenueSummary(sharedStatsState?.revenueResults || [], sharedOutputPlatform);
  const sharedHistoryEntries = statsHistory.getMergedHistoryEntries();
  const historyActionsDisabled = Boolean(
    backgroundTask?.isRunning ||
      favoriteRefreshState?.isRunning ||
      replayPreparingEntryIds.length ||
      Object.values(platformStates || {}).some((state) => state?.stats?.isRunning)
  );
  const { retrySearchCardMetrics } = useSearchCardMetrics({
    activeBrowsePlatform,
    activeSearchCategory,
    appConfigRef,
    currentBrowseState,
    currentPlatform,
    getPlatformState: (platform) => platformStatesRef.current[platform],
    updatePlatformState,
  });
  useEffect(() => {
    closeMainDrawer();
  }, [currentPlatform]);

  function getActiveWorkPlatform() {
    return activeSearchPlatformRef.current === "manbo" || appConfigRef.current.missevanEnabled
      ? activeSearchPlatformRef.current
      : "manbo";
  }

  function closeMainDrawer() {
    setMainDrawerOpen(false);
  }

  function navigateToolRouteFromMenu(routePatch) {
    navigateToolRoute(routePatch);
    scrollToPageTop();
    setMainDrawerOpen(false);
  }

  function navigateHomeRoute(routePatch) {
    navigateToolRoute(routePatch);
    scrollToPageTop();
  }

  function openHomeFromHeader() {
    navigateCurrentPlatform(appConfigRef.current.desktopApp ? "search" : "home");
    scrollToPageTop();
    setMainDrawerOpen(false);
  }

  const mainMenuButtonLabel = mainDrawerOpen ? "关闭菜单" : "打开菜单";
  const headerHomeLabel = appConfig.desktopApp ? "返回统计页" : "返回首页";

  function commitGlobalSearchNavigation(action = {}) {
    replaySearchGenerationRef.current += 1;
    replayCardsAbortControllerRef.current?.abort();
    if (action?.action === "import") {
      clearCvSearchResults();
      navigateToolRoute({ view: "search", q: "" });
      setMainDrawerOpen(false);
      return;
    }
    navigateToolRoute({
      view: "search",
      q: action?.action === "search" ? action.keyword : "",
      platform: ["missevan", "manbo", "cv"].includes(activeSearchCategory) ? activeSearchCategory : activeSearchPlatform,
    });
    setMainDrawerOpen(false);
  }

  async function loadMainNavigationRanks() {
    if (appConfigRef.current.desktopApp || mainNavigationRanksStatus === "loading") {
      return;
    }
    const cachedPayload = getCachedRanksData(appConfigRef.current.frontendVersion);
    const hasCachedPayload = Boolean(cachedPayload?.data?.success);
    if (hasCachedPayload) {
      setMainNavigationRanksData(cachedPayload.data);
      setMainNavigationRanksStatus("ready");
    } else {
      setMainNavigationRanksStatus("loading");
    }
    try {
      const { response, data } = await fetchRanksData(appConfigRef.current.frontendVersion, { revalidate: true });
      const backendVersion = getBackendVersionFromResponse(response, data);
      updateVersionStatusFromResponse({
        ...data,
        backendVersion,
        frontendVersion: appConfigRef.current.frontendVersion,
      });
      if (!response.ok || !data?.success) {
        if (!hasCachedPayload) {
          setMainNavigationRanksData(null);
          setMainNavigationRanksStatus("error");
        }
        return;
      }
      setMainNavigationRanksData(data);
      setMainNavigationRanksStatus("ready");
    } catch (error) {
      console.error("Failed to load main navigation ranks", error);
      if (!hasCachedPayload) {
        setMainNavigationRanksData(null);
        setMainNavigationRanksStatus("error");
      }
    }
  }

  function openDrawerChangelog() {
    openChangelog();
    setMainDrawerOpen(false);
  }

  function openDrawerFeedback() {
    if (appConfig.desktopApp || !appConfig.featureSuggestionUrl) {
      return;
    }
    navigateToolRoute({ view: "feedback" });
    setMainDrawerOpen(false);
  }

  function resolveStatsPlatform(platform) {
    return platform === "manbo" ? "manbo" : platform === "missevan" ? "missevan" : getActiveWorkPlatform();
  }

  function openSearchPlatform(platform) {
    const normalizedPlatform = platform === "manbo" ? "manbo" : "missevan";
    setActiveSearchPlatform(normalizedPlatform);
    setActiveSearchCategory(normalizedPlatform);
    navigateToolRoute({ view: "search", q: "", platform: normalizedPlatform });
  }

  function changeSearchCategory(category) {
    if (category === "cv") {
      setActiveSearchCategory("cv");
      if (toolRouteStateRef.current.view === "search" && toolRouteStateRef.current.q) {
        navigateToolRoute({ platform: "cv" }, { replace: true });
      }
      return;
    }
    const platform = category === "manbo" ? "manbo" : "missevan";
    setActiveSearchPlatform(platform);
    setActiveSearchCategory(platform);
    if (toolRouteStateRef.current.view === "search" && toolRouteStateRef.current.q) {
      navigateToolRoute({ platform }, { replace: true });
    }
  }

  function clearCvSearchResults() {
    setCvSearchState({
      results: [],
      matchedCount: 0,
      exactMatch: false,
      keyword: "",
    });
  }

  function openCvProfile(name, context = {}) {
    const cvName = String(name ?? "").replace(/\s+/g, " ").trim();
    if (!cvName) {
      return;
    }
    const usagePayload = buildCvProfileOpenUsagePayload(cvName, context);
    if (usagePayload) {
      fetch(buildVersionedUrl("/usage-log", appConfigRef.current.frontendVersion), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(usagePayload),
      }).catch((error) => {
        console.error("Failed to log CV profile navigation", error);
      });
    }
    navigateToolRoute({
      view: "cv",
      cv: cvName,
      cvKey: String(context?.profileId ?? "").trim(),
      platform: "all",
      payment: "all",
      release: "all",
      partners: "all",
    });
    scrollToPageTop();
  }

  function returnFromCvProfile() {
    navigateToolRoute({ view: "search", cv: "" }, { replace: true });
    scrollToPageTop();
  }

  function renderMissevanDesktopLink(config = appConfig) {
    const desktopAppUrl = String(config?.desktopAppUrl || "").trim();
    if (!desktopAppUrl) {
      return "桌面版";
    }
    return (
      <a className="font-medium text-primary underline underline-offset-4" href={desktopAppUrl} rel="noreferrer" target="_blank">
        桌面版
      </a>
    );
  }

  function renderMissevanAccessDeniedMessage(config = appConfig) {
    const plainMessage = getMissevanAccessDeniedMessage(config, appConfig.cooldownHours);
    return (
      <span aria-label={plainMessage}>
        当前所有备份节点都在冷却中，请{getRemainingCooldownMinutes(config, appConfig.cooldownHours)}分钟之后再来，或使用
        {renderMissevanDesktopLink(config)}。
      </span>
    );
  }

  function scrollToPanel(ref) {
    if (typeof window === "undefined") {
      return;
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        ref.current?.scrollIntoView?.({ behavior: getScrollBehavior(), block: "start" });
      });
    });
  }

  function scrollToPageTop() {
    if (typeof window === "undefined") {
      return;
    }
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: getScrollBehavior() });
    });
  }

  function scrollToDramaResult(dramaId) {
    if (typeof window === "undefined" || dramaId == null) {
      return;
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document
          .querySelector(`[data-search-result-id="${CSS.escape(String(dramaId))}"]`)
          ?.scrollIntoView?.({ behavior: getScrollBehavior(), block: "start" });
      });
    });
  }

  function applyVersionStatus(frontendVersion, backendVersion, versionMismatch = null) {
    setAppConfig((current) => ({
      ...current,
      frontendVersion: normalizeVersion(frontendVersion),
      backendVersion: normalizeVersion(backendVersion),
      versionMismatch:
        versionMismatch == null
          ? normalizeVersion(frontendVersion) !== normalizeVersion(backendVersion)
          : Boolean(versionMismatch),
    }));
  }

  function updateVersionStatusFromResponse(data) {
    if (!data || typeof data !== "object") {
      return data;
    }
    applyVersionStatus(
      normalizeVersion(data.frontendVersion ?? appConfigRef.current.frontendVersion),
      normalizeVersion(data.backendVersion ?? "0.0.0"),
      data.versionMismatch
    );
    return data;
  }

  const loadAppConfig = useCallback(async () => {
    try {
      const response = await fetch(buildVersionedUrl("/app-config", appConfigRef.current.frontendVersion), {
        cache: "no-store",
      });
      if (!response.ok) {
        setAppConfig((current) => mergeAppConfig(current));
        return;
      }
      const config = await response.json();
      const merged = mergeAppConfig(appConfigRef.current, {
        ...config,
        backendVersion: getBackendVersionFromResponse(response, config),
      });
      setAppConfig(merged);
      if (!merged.missevanEnabled && activeSearchPlatformRef.current === "missevan") {
        setActiveSearchPlatform("manbo");
        setActiveSearchCategory((current) => current === "missevan" ? "manbo" : current);
      }
      if (!merged.missevanEnabled && sharedOutputPlatformRef.current === "missevan") {
        setSharedOutputPlatform("manbo");
      }
    } catch (_) {
      setAppConfig((current) => mergeAppConfig(current));
    }
  }, [appConfigRef]);

  async function reloadFavoriteItems() {
    try {
      setFavoriteItems(await listFavorites());
    } catch (error) {
      console.error("Failed to load favorites", error);
      toast.error("读取收藏失败。");
    }
  }

  const favoriteKeySet = useMemo(
    () => new Set((Array.isArray(favoriteItems) ? favoriteItems : []).map((item) => item.key)),
    [favoriteItems]
  );
  const statisticsActionsDisabled = Boolean(backgroundTask.isRunning);
  const favoriteActionsDisabled = favoriteRefreshState.isRunning;

  async function handleFavoriteRefreshSettled() {
    setFavoriteRefreshRevision((current) => current + 1);
    await reloadFavoriteItems();
  }

  function buildFavoriteLogPayload(item, action) {
    const platform = item?.platform === "manbo" ? "manbo" : item?.platform === "missevan" ? "missevan" : "";
    const dramaId = String(item?.dramaId ?? item?.id ?? "").trim();
    return {
      platform,
      action,
      dramaId,
      dramaName: item?.title || item?.name || "",
      source: item?.source || item?.favoriteSource || (currentPlatformRef.current === "search" ? "search" : currentPlatformRef.current) || "unknown",
    };
  }

  async function logFavoriteUsage(item, action) {
    const payload = buildFavoriteLogPayload(item, action);
    if (!payload.platform || !payload.dramaId) {
      return;
    }
    try {
      await fetch(buildVersionedUrl("/usage-log", appConfigRef.current.frontendVersion), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      console.error("Failed to log favorite action", error);
    }
  }

  async function confirmRemoveFavorite() {
    const request = cancelFavoriteRequest;
    if (!request) {
      return;
    }
    if (favoriteRefreshStateRef.current.isRunning) {
      toast.warning("收藏刷新中，请稍后再操作。");
      setCancelFavoriteRequest(null);
      return;
    }
    const platform = request.platform === "manbo" ? "manbo" : request.platform === "missevan" ? "missevan" : "";
    const dramaId = String(request.dramaId ?? request.id ?? "").trim();
    try {
      await removeFavoriteWithSnapshots(platform, dramaId);
      await logFavoriteUsage(request, "favorite_remove");
      await reloadFavoriteItems();
      toast.success("已取消收藏，并删除历史统计记录。");
    } catch (error) {
      console.error("Failed to remove favorite", error);
      toast.error("取消收藏失败。");
    } finally {
      setCancelFavoriteRequest(null);
    }
  }

  async function toggleFavorite(item) {
    if (favoriteRefreshStateRef.current.isRunning) {
      toast.warning("收藏刷新中，请稍后再操作。");
      return;
    }
    const platform = item?.platform === "manbo" ? "manbo" : item?.platform === "missevan" ? "missevan" : "";
    const dramaId = String(item?.dramaId ?? item?.id ?? "").trim();
    const key = createFavoriteKey(platform, dramaId);
    if (!key) {
      toast.error("收藏失败，作品信息不完整。");
      return;
    }
    try {
      if (favoriteKeySet.has(key)) {
        setCancelFavoriteRequest({
          ...item,
          platform,
          dramaId,
          title: item?.title || item?.name || "",
        });
      } else {
        const favorite = await saveFavorite({
          platform,
          dramaId,
          title: item?.title || item?.name || "",
          cover: item?.cover || "",
          paymentLabel: item?.paymentLabel || item?.payment_label || "",
          contentTypeLabel: item?.contentTypeLabel || item?.content_type_label || "",
          dramaUpdatedAt: item?.dramaUpdatedAt || item?.drama_updated_at || item?.updated_at || "",
          mainCvText: item?.mainCvText || item?.main_cv_text || "",
        });
        await logFavoriteUsage({ ...item, ...favorite }, "favorite_add");
        toast.success("已加入收藏。");
        await reloadFavoriteItems();
      }
    } catch (error) {
      console.error("Failed to toggle favorite", error);
      toast.error("收藏操作失败。");
    }
  }

  useEffect(() => {
    loadAppConfig();
    reloadFavoriteItems();
    const pageExitHandler = () => {
      statsTaskRun.notifyAllActiveTaskCancels();
    };
    window.addEventListener("pagehide", pageExitHandler);
    window.addEventListener("beforeunload", pageExitHandler);
    return () => {
      replayPreparationAbortControllerRef.current?.abort?.();
      replayCardsAbortControllerRef.current?.abort?.();
      statsTaskRun.dispose();
      window.removeEventListener("pagehide", pageExitHandler);
      window.removeEventListener("beforeunload", pageExitHandler);
    };
  }, [loadAppConfig, statsTaskRun]);

  function updatePlatformState(platform, updater) {
    setPlatformStates((current) => {
      const nextSlice = updater(current[platform]);
      return { ...current, [platform]: nextSlice };
    });
  }

  function updateSharedSearchForm(patch) {
    setSharedSearchForm((current) => ({
      ...current,
      ...patch,
    }));
  }

  function updateSearchFormForPlatform(platform, patch) {
    updatePlatformState(platform, (state) => ({
      ...state,
      searchForm: {
        ...state.searchForm,
        ...patch,
      },
    }));
  }

  function resetOutputs(platform) {
    updatePlatformState(platform, (state) => ({
      ...state,
      stats: createStatsState(),
    }));
  }

  function resetSearchFlow(platform = getActiveWorkPlatform()) {
    replaySearchGenerationRef.current += 1;
    replayCardsAbortControllerRef.current?.abort?.();
    updatePlatformState(platform, (state) => resetSearchResultsState(state));
  }

  function setSearchResults(platform, results, source = "search", meta = {}) {
    replaySearchGenerationRef.current += 1;
    replayCardsAbortControllerRef.current?.abort?.();
    updatePlatformState(platform, (state) => setSearchResultsState(state, results, source, meta));
    if (Array.isArray(results) && results.length > 0) {
      scrollToPanel(resultsPanelRef);
    }
  }

  function setManualSearchResults(platform, results, meta = {}) {
    replaySearchGenerationRef.current += 1;
    replayCardsAbortControllerRef.current?.abort?.();
    updatePlatformState(platform, (state) => setManualSearchResultsState(state, results, meta));
    if (Array.isArray(results) && results.length > 0 && meta?.scroll !== false) {
      scrollToPanel(resultsPanelRef);
    }
  }

  function setResults(nextResults, platform = getActiveWorkPlatform()) {
    replaySearchGenerationRef.current += 1;
    replayCardsAbortControllerRef.current?.abort?.();
    updatePlatformState(platform, (state) => setVisibleSearchResults(state, nextResults));
  }

  function setDramas(nextDramas, platform = getActiveWorkPlatform()) {
    updatePlatformState(platform, (state) => ({
      ...state,
      dramas: nextDramas,
    }));
  }

  function updateSelection(selectedEpisodes, platform = getActiveWorkPlatform()) {
    updatePlatformState(platform, (state) => ({
      ...state,
      selectedEpisodesSnapshot: selectedEpisodes,
    }));
  }

  function activateSharedOutputPlatform(platform) {
    setSharedOutputPlatform(platform);
    sharedOutputPlatformRef.current = platform;
  }

  function isAnyBackgroundTaskRunning() {
    return Boolean(
      backgroundTaskRef.current?.isRunning ||
        favoriteRefreshStateRef.current?.isRunning ||
        Object.values(platformStatesRef.current || {}).some((state) => state?.stats?.isRunning)
    );
  }

  function warnIfBackgroundTaskRunning() {
    if (!isAnyBackgroundTaskRunning()) {
      return false;
    }
    toast.warning("后台任务运行中，请等待完成后再开始新的统计。");
    return true;
  }

  function openBackgroundTaskResult() {
    const activeTask = backgroundTaskRef.current;
    const target = activeTask?.resultTarget;
    if (target === "favorites") {
      navigateCurrentPlatform("favorites");
      if (!activeTask?.isRunning) {
        setBackgroundTask(createIdleBackgroundTask());
      }
      return;
    }
    if (target === "stats") {
      navigateCurrentPlatform("search");
      scrollToPanel(outputPanelRef);
      if (!activeTask?.isRunning) {
        setBackgroundTask(createIdleBackgroundTask());
      }
    }
  }

  function updateSearchPage(platform, page, results, meta = {}) {
    updatePlatformState(platform, (state) => updateSearchResultsPage(state, page, results, meta));
  }

  async function parseVersionedJsonResponse(response) {
    const data = await response.json();
    updateVersionStatusFromResponse({
      frontendVersion: appConfigRef.current.frontendVersion,
      backendVersion: getBackendVersionFromResponse(response, data),
      versionMismatch: data?.versionMismatch,
    });
    return data;
  }

  async function buildManboImportItems(rawItems) {
    return Promise.all(
      rawItems.map(async (raw) => {
        if (!canParseShareUrl(raw)) {
          return { raw };
        }
        const payload = await decryptShareUrl(raw);
        const resolved = extractResolvedId(payload, raw);
        if (resolved?.dramaId) {
          return {
            raw: String(resolved.dramaId),
            resolvedShareData: resolved.payload || payload,
          };
        }
        if (resolved?.setId) {
          return {
            raw: String(resolved.setId),
            resolvedShareData: resolved.payload || payload,
          };
        }
        return {
          raw,
          resolvedShareData: resolved?.payload || payload,
        };
      })
    );
  }

  async function importRawItemsIntoPlatform(targetPlatform, rawItems, options = {}) {
    const normalizedPlatform = targetPlatform === "manbo" ? "manbo" : "missevan";
    const normalizedRawItems = Array.from(
      new Set(
        (Array.isArray(rawItems) ? rawItems : [])
          .map((item) => String(item ?? "").trim())
          .filter(Boolean)
      )
    );
    if (!normalizedRawItems.length) {
      toast.error("导入失败，请检查输入内容。");
      return;
    }

    setSearchJumpStatus({
      platform: normalizedPlatform,
      name: "",
    });

    try {
      const items =
        normalizedPlatform === "manbo"
          ? await buildManboImportItems(normalizedRawItems)
          : normalizedRawItems.map((raw) => ({ raw }));
      const endpoint = normalizedPlatform === "manbo" ? "/manbo/getdramacards" : "/getdramacards";
      const response = await fetch(buildVersionedUrl(endpoint, appConfigRef.current.frontendVersion), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await parseVersionedJsonResponse(response);
      const results = Array.isArray(data?.results)
        ? data.results.map((item) => ({
            ...item,
            platform: item?.platform || normalizedPlatform,
          }))
        : [];

      if (!response.ok || !data?.success || !results.length) {
        if (normalizedPlatform === "missevan" && data?.accessDenied) {
          await refreshCooldownState();
        }
        toast.error(normalizedPlatform === "manbo" ? "Manbo 导入失败，请检查输入内容。" : "猫耳导入失败，请检查输入内容。");
        return;
      }

      const visibleImportInput = normalizedRawItems.length === 1 ? normalizedRawItems[0] : normalizedRawItems.join(", ");
      const manualInput = normalizedRawItems.join("\n");
      updateSharedSearchForm({
        keyword: visibleImportInput,
        manualInput,
      });
      updateSearchFormForPlatform(normalizedPlatform, {
        keyword: visibleImportInput,
        manualInput,
      });
      setManualSearchResults(normalizedPlatform, results, { limit: normalizedRawItems.length, scroll: false });
      openSearchPlatform(normalizedPlatform);
      scrollToPanel(resultsPanelRef);
      if (data.failedItems?.length) {
        toast.warning(`以下内容导入失败：${data.failedItems.join(" | ")}`);
      } else if (data.failedIds?.length) {
        toast.warning(`以下作品ID导入失败：${data.failedIds.join(", ")}`);
      }
    } catch (error) {
      console.error("Failed to cross import items", error);
      toast.error("导入失败，请检查输入内容或稍后重试。");
    } finally {
      setSearchJumpStatus(null);
    }
  }

  function normalizeDramaSearchTitles(titles, dramaIds, fallbackTitle) {
    const normalizedTitles = (Array.isArray(titles) ? titles : [])
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
    const fallback = String(fallbackTitle ?? "").trim();
    if (!normalizedTitles.length && fallback) {
      return dramaIds.map(() => fallback);
    }
    if (normalizedTitles.length === 1 && dramaIds.length > 1) {
      return dramaIds.map(() => normalizedTitles[0]);
    }
    return normalizedTitles.slice(0, dramaIds.length);
  }

  async function openDramaInSearch({
    platform,
    id,
    ids,
    titles,
    name,
    paymentLabel,
    contentTypeLabel,
    usageAction,
    usageSource,
    suppressUsageLog = false,
  }) {
    const targetPlatform = platform === "manbo" ? "manbo" : "missevan";
    const dramaIds = Array.from(
      new Set(
        (Array.isArray(ids) && ids.length ? ids : [id])
          .map((item) => String(item ?? "").trim())
          .filter((item) => /^\d+$/.test(item))
      )
    );
    const manualInput = dramaIds.join("\n");
    const visibleImportInput = dramaIds.length === 1 ? dramaIds[0] : dramaIds.join(", ");
    const dramaName = String(name ?? "").trim();
    const dramaTitles = normalizeDramaSearchTitles(titles, dramaIds, dramaName);
    const normalizedUsageAction = ["ranks_open_search_result", "ongoing_open_search_result", "cv_profile_open_search_result"].includes(String(usageAction ?? "").trim())
      ? String(usageAction).trim()
      : "";
    const normalizedUsageSource = String(usageSource ?? "").trim().slice(0, 40);
    if (!dramaIds.length) {
      toast.error("打开搜索结果失败，请稍后重试。");
      return false;
    }

    setSearchJumpStatus({
      platform: targetPlatform,
      name: dramaName,
    });

    try {
      const endpoint = targetPlatform === "manbo" ? "/manbo/getdramacards" : "/getdramacards";
      const usageFields = {
        ...(dramaTitles.length ? { titles: dramaTitles } : {}),
        ...(normalizedUsageAction ? { usageAction: normalizedUsageAction } : {}),
        ...(normalizedUsageSource ? { source: normalizedUsageSource } : {}),
        ...(suppressUsageLog === true ? { suppressUsageLog: true } : {}),
      };
      const body = targetPlatform === "manbo"
        ? { items: dramaIds.map((dramaId) => ({ raw: dramaId })), ...usageFields }
        : { drama_ids: dramaIds, ...usageFields };
      const response = await fetch(buildVersionedUrl(endpoint, appConfigRef.current.frontendVersion), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await parseVersionedJsonResponse(response);
      const results = Array.isArray(data?.results)
        ? data.results.map((item) => ({
            ...item,
            platform: item?.platform || targetPlatform,
            payment_label: item?.payment_label || paymentLabel,
            content_type_label: item?.content_type_label || contentTypeLabel,
          }))
        : [];

      if (!response.ok || !data?.success || !results.length) {
        if (targetPlatform === "missevan" && data?.accessDenied) {
          if (!appConfigRef.current.desktopApp) {
            await refreshCooldownState();
          }
          updatePlatformState("missevan", (state) => ({
            ...state,
            stats: {
              ...state.stats,
              currentAction: appConfigRef.current.desktopApp ? "访问受限，请先打开猫耳主页验证" : getMissevanAccessDeniedMessage(appConfigRef.current),
            },
          }));
          if (appConfigRef.current.desktopApp) {
            toast.error(MISSEVAN_DESKTOP_ACCESS_HINT);
          } else {
            toast.error(renderMissevanAccessDeniedMessage(appConfigRef.current));
          }
          return false;
        }
        toast.error("打开搜索结果失败，请稍后重试。");
        return false;
      }

      resetSearchFlow("missevan");
      resetSearchFlow("manbo");
      clearCvSearchResults();
      updateSharedSearchForm({
        keyword: visibleImportInput,
        manualInput,
      });
      updateSearchFormForPlatform(targetPlatform, {
        keyword: visibleImportInput,
        manualInput,
      });
      setManualSearchResults(targetPlatform, results, { limit: dramaIds.length, scroll: false });
      openSearchPlatform(targetPlatform);
      scrollToPanel(resultsPanelRef);
      return true;
    } catch (error) {
      console.error("Failed to open drama in search", error);
      toast.error("打开搜索结果失败，请稍后重试。");
      return false;
    } finally {
      setSearchJumpStatus(null);
    }
  }

  function beginRun(platform, replay = null, refreshSignal = null) {
    if (refreshSignal?.aborted) throw new DOMException("Aborted", "AbortError");
    const run = statsTaskRun.beginRun(platform, { replay });
    if (refreshSignal) {
      const key = `${platform}:${run.runId}`;
      const cancelRefreshRun = () => {
        if (statsTaskRun.isRunActive(platform, run.runId)) void cancelActiveRun(platform);
      };
      const unlink = () => {
        refreshSignal.removeEventListener("abort", cancelRefreshRun);
        run.signal.removeEventListener("abort", unlink);
        refreshRunUnlinksRef.current.delete(key);
      };
      refreshRunUnlinksRef.current.set(key, unlink);
      refreshSignal.addEventListener("abort", cancelRefreshRun, { once: true });
      run.signal.addEventListener("abort", unlink, { once: true });
    }
    return run;
  }

  function applyStatsRunStarted({ platform, startedAt }) {
    updatePlatformState(platform, (state) => ({
      ...state,
      stats: {
        ...state.stats,
        isRunning: true,
        startedAt,
        elapsedMs: 0,
      },
    }));
    setBackgroundTask({
      isRunning: true,
      status: "running",
      type: "statistics",
      title: platform === "manbo" ? "漫播统计任务" : "猫耳统计任务",
      description: "正在准备统计",
      progress: 0,
      action: "正在准备统计",
      resultTarget: "stats",
      highlighted: true,
    });
  }

  function applyStatsRunElapsed({ platform, elapsedMs }) {
    updatePlatformState(platform, (state) => ({
      ...state,
      stats: {
        ...state.stats,
        elapsedMs: state.stats.isRunning ? elapsedMs : state.stats.elapsedMs,
      },
    }));
  }

  function applyStatsRunCancelled({ platform, wasRunning }) {
    updatePlatformState(platform, (state) => ({
      ...state,
      stats: {
        ...state.stats,
        isRunning: false,
        activeTaskId: "",
        activeTaskType: "",
        elapsedMs: state.stats.startedAt > 0 ? Date.now() - state.stats.startedAt : state.stats.elapsedMs,
      },
    }));
    setBackgroundTask((current) =>
      wasRunning && current.type === "statistics"
        ? {
            ...current,
            isRunning: false,
            status: "cancelled",
            title: "统计已取消",
            action: "统计已取消",
            highlighted: true,
          }
        : current
    );
  }

  async function cancelActiveRun(platform = getActiveWorkPlatform()) {
    return statsTaskRun.cancelRun(platform);
  }

  function applyStatsRunFinished({ platform, status }) {
    updatePlatformState(platform, (state) => ({
      ...state,
      stats: {
        ...state.stats,
        isRunning: false,
        activeTaskId: "",
        activeTaskType: "",
        elapsedMs: state.stats.startedAt > 0 ? Date.now() - state.stats.startedAt : state.stats.elapsedMs,
      },
    }));
    if (status === "completed") {
      toast.success("统计完成，结果已更新。");
    }
    setBackgroundTask((current) => {
      if (current.type !== "statistics") {
        return current;
      }
      if (current.status === "cancelled") {
        return current;
      }
      if (status === "idle") {
        return createIdleBackgroundTask();
      }
      return {
        ...current,
        isRunning: false,
        status,
        title: status === "completed" ? "统计完成" : "统计失败",
        action: status === "completed" ? "结果已更新，可前往查看。" : "统计未完成，请稍后重试。",
        progress: status === "completed" ? 100 : current.progress,
        resultTarget: "stats",
        highlighted: true,
      };
    });
  }

  function finishRun(platform, runId, status = "completed") {
    refreshRunUnlinksRef.current.get(`${platform}:${runId}`)?.();
    return statsTaskRun.finishRun(platform, runId, status);
  }

  function ensureStatsRunActive(platform, runId, signal) {
    if (!signal?.aborted && statsTaskRun.isRunActive(platform, runId)) {
      return;
    }
    throw new DOMException("Aborted", "AbortError");
  }

  function applyStatsTaskCreated({ platform, taskId, taskType }) {
    updatePlatformState(platform, (state) => ({
      ...state,
      stats: {
        ...state.stats,
        activeTaskId: taskId,
        activeTaskType: taskType,
      },
    }));
  }

  async function postJson(url, payload, signal, errorMessage) {
    const response = await fetch(buildVersionedUrl(url, appConfigRef.current.frontendVersion), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(data?.message || data?.error || `${errorMessage}: ${response.status}`);
    }
    updateVersionStatusFromResponse({
      backendVersion: getBackendVersionFromResponse(response, data),
      frontendVersion: appConfigRef.current.frontendVersion,
    });
    return data;
  }

  function applyTaskSnapshot(platform, snapshot) {
    const progress = Number(snapshot?.progress ?? 0);
    const queuePosition = Number(snapshot?.queuePosition ?? 0);
    const currentAction =
      snapshot?.status === "queued" && queuePosition > 0
        ? `任务排队中，前方 ${queuePosition} 个任务`
        : snapshot?.currentAction || "统计中";
    setBackgroundTask((current) =>
      current.type === "statistics"
        ? {
            ...current,
            isRunning: snapshot?.status !== "completed" && snapshot?.status !== "cancelled" && snapshot?.status !== "failed",
            status: snapshot?.status || current.status || "running",
            progress,
            action: currentAction,
            description: currentAction,
            resultTarget: "stats",
            highlighted: true,
          }
        : current
    );
    updatePlatformState(platform, (state) => {
      const result = snapshot?.result || {};
      return {
        ...state,
        stats: {
          ...state.stats,
          progress,
          currentAction,
          totalDanmaku: Number(snapshot?.totalDanmaku ?? state.stats.totalDanmaku ?? 0),
          totalUsers: Number(snapshot?.totalUsers ?? state.stats.totalUsers ?? 0),
          playCountResults: Array.isArray(result.playCountResults) ? result.playCountResults : state.stats.playCountResults,
          playCountSelectedEpisodeCount: Array.isArray(result.playCountResults)
            ? Number(result.playCountSelectedEpisodeCount ?? state.stats.playCountSelectedEpisodeCount ?? 0)
            : state.stats.playCountSelectedEpisodeCount,
          playCountTotal: Array.isArray(result.playCountResults) ? Number(result.playCountTotal ?? 0) : state.stats.playCountTotal,
          playCountFailed: Array.isArray(result.playCountResults) ? Boolean(result.playCountFailed) : state.stats.playCountFailed,
          idResults: Array.isArray(result.idResults) ? result.idResults : state.stats.idResults,
          episodeDetails: Array.isArray(result.idResults) || Array.isArray(result.revenueResults)
            ? Array.isArray(result.episodeDetails)
              ? result.episodeDetails
              : Array.isArray(result.suspectedOverflowEpisodes)
                ? result.suspectedOverflowEpisodes
                : Array.isArray(result.revenueSummary?.suspectedOverflowEpisodes)
                  ? result.revenueSummary.suspectedOverflowEpisodes
                  : []
            : state.stats.episodeDetails,
          idSelectedEpisodeCount: Array.isArray(result.idResults)
            ? Number(result.idSelectedEpisodeCount ?? state.stats.idSelectedEpisodeCount ?? 0)
            : state.stats.idSelectedEpisodeCount,
          revenueResults: Array.isArray(result.revenueResults) ? result.revenueResults : state.stats.revenueResults,
          revenueSummary: Array.isArray(result.revenueResults) ? result.revenueSummary || null : state.stats.revenueSummary,
        },
      };
    });
  }

  function applyStatsTaskSnapshot({ platform, snapshot }) {
    applyTaskSnapshot(platform, snapshot);
  }

  function applyStatsTaskCompleted({ platform, taskType, taskId, snapshot, runData }) {
    statsHistory.recordCompletedStatsHistory(platform, taskType, taskId, snapshot, runData?.replay || null);
  }

  async function startStatsTask(platform, taskType, payload, runId, signal) {
    return statsTaskRun.startStatsTask(platform, taskType, payload, runId, signal);
  }

  async function refreshCooldownState() {
    if (!appConfigRef.current.desktopApp) {
      await loadAppConfig();
    }
  }

  function getCooldownMessage() {
    return getMissevanAccessDeniedMessage(appConfigRef.current);
  }

  async function showMissevanAccessHint() {
    if (getActiveWorkPlatform() !== "missevan") return;
    if (!appConfigRef.current.desktopApp) {
      await refreshCooldownState();
    }
    const message = appConfigRef.current.desktopApp ? MISSEVAN_DESKTOP_ACCESS_HINT : getCooldownMessage();
    updatePlatformState("missevan", (state) => ({
      ...state,
      stats: {
        ...state.stats,
        currentAction: appConfigRef.current.desktopApp ? "访问受限，请先打开猫耳主页验证" : message,
      },
    }));
    setNotice({
      title: "Missevan 当前受限",
      description: appConfigRef.current.desktopApp ? message : renderMissevanAccessDeniedMessage(appConfigRef.current),
    });
  }

  function getSearchResultById(platform, dramaId) {
    return getAllSearchResults(platformStatesRef.current[platform]).find((item) => String(item.id) === String(dramaId));
  }

  function getSearchResultsByIds(platform, dramaIds) {
    const idSet = new Set((Array.isArray(dramaIds) ? dramaIds : []).map((id) => String(id)));
    return getAllSearchResults(platformStatesRef.current[platform]).filter((item) => idSet.has(String(item.id)));
  }

  function getLoadedDramaById(platform, dramaId) {
    return platformStatesRef.current[platform]?.dramas.find((item) => String(item?.drama?.id) === String(dramaId));
  }

  function getDramasEndpoint(platform) {
    return platform === "manbo" ? "/manbo/getdramas" : "/getdramas";
  }

  function normalizeFetchedDrama(result, shouldExpandImported = false) {
    return {
      ...result.info,
      expanded: shouldExpandImported,
      episodes: {
        ...result.info.episodes,
        episode: Array.isArray(result.info?.episodes?.episode)
          ? result.info.episodes.episode.map((episode) => ({
              ...episode,
              selected: false,
            }))
          : [],
      },
    };
  }

  async function fetchDramasByIds(platform, dramaIds, signal, options = {}) {
    const requestedIds = Array.from(
      new Set(
        (Array.isArray(dramaIds) ? dramaIds : [])
          .map((id) => String(id ?? "").trim())
          .filter(Boolean)
      )
    );
    const loadedById = new Map();
    const missingIds = [];
    requestedIds.forEach((id) => {
      const loaded = options.forceRefresh === true
        ? null
        : (Array.isArray(options.loadedDramas) ? options.loadedDramas : []).find((item) => String(item?.drama?.id) === id)
          || getLoadedDramaById(platform, id);
      if (loaded) {
        loadedById.set(id, loaded);
        return;
      }
      missingIds.push(id);
    });

    if (!missingIds.length) {
      return requestedIds.map((id) => ({
        success: true,
        id,
        drama: loadedById.get(id),
        loaded: true,
      }));
    }

    const searchResults = Array.isArray(options.searchResults) ? options.searchResults : getAllSearchResults(platformStatesRef.current[platform]);
    const payload = { drama_ids: missingIds };
    if (options.forceRefresh === true) {
      payload.force_refresh = true;
    }
    if (platform === "missevan") {
      const soundIdMap = {};
      missingIds.forEach((id) => {
        const searchResult = searchResults.find((item) => String(item?.id) === id);
        if (Number(searchResult?.sound_id) > 0) {
          soundIdMap[id] = Number(searchResult.sound_id);
        }
      });
      payload.sound_id_map = soundIdMap;
    }

    const data = await postJson(getDramasEndpoint(platform), payload, signal, "Failed to load dramas");
    const fetchedById = new Map(
      extractResponseItems(data).map((result) => [String(result?.id ?? ""), result])
    );

    return requestedIds.map((id) => {
      const loaded = loadedById.get(id);
      if (loaded) {
        return {
          success: true,
          id,
          drama: loaded,
          loaded: true,
        };
      }
      const result = fetchedById.get(id);
      if (result?.success && result?.info) {
        return {
          success: true,
          id,
          drama: normalizeFetchedDrama(result, Boolean(options.expandImported)),
          loaded: false,
        };
      }
      return {
        success: false,
        id,
        accessDenied: Boolean(result?.accessDenied),
      };
    });
  }

  async function registerApiSearchDramaIds(platform, ids, signal) {
    const normalizedPlatform = platform === "manbo" ? "manbo" : platform === "missevan" ? "missevan" : "";
    if (!normalizedPlatform) {
      return;
    }

    const expectedSource = normalizedPlatform === "manbo" ? "manbo_api" : "missevan_api";
    const fallbackIds = getSearchResultsByIds(normalizedPlatform, ids)
      .filter((item) => item?.search_source === expectedSource)
      .map((item) => normalizedPlatform === "manbo" ? String(item.id) : item.id);
    if (!fallbackIds.length) {
      return;
    }

    try {
      await postJson(
        "/register-new-drama-ids",
        { platform: normalizedPlatform, drama_ids: fallbackIds },
        signal,
        "Failed to register new drama ids"
      );
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      console.error("Failed to register API search drama ids", error);
    }
  }

  async function addDramas(ids, options = {}) {
    const platform = resolveStatsPlatform(options?.platform);
    if (!ids?.length) {
      toast.warning("请先选择作品。");
      return;
    }
    const shouldAutoCheck = options?.autoCheck === true;
    const shouldExpandImported = options?.expandImported === true;
    const selectMode = ["all", "paid"].includes(options?.selectMode) ? options.selectMode : "";
    const shouldSelectImportedEpisodes = Boolean(selectMode);
    const shouldPreserveScroll = options?.preserveScroll === true;
    const scrollToDramaId = options?.scrollToDramaId;
    let hasAccessDenied = false;
    const currentState = platformStatesRef.current[platform];
    const existingDramaMap = new Map(currentState.dramas.map((drama) => [String(drama?.drama?.id), drama]));
    const mergedDramas = [...currentState.dramas];
    const importedIdSet = new Set();
    const requestedIdSet = new Set(ids.map((id) => String(id)));

    try {
      await registerApiSearchDramaIds(platform, ids);

      const missingIds = ids
        .map((id) => String(id))
        .filter((id) => !existingDramaMap.has(String(id)));
      const batchResult = await fetchDramasByIds(platform, missingIds);
      batchResult.forEach((result) => {
        if (result?.success && result?.drama) {
          const drama = {
            ...result.drama,
            expanded: shouldExpandImported,
          };
          mergedDramas.push(drama);
          existingDramaMap.set(String(result.id), drama);
          importedIdSet.add(String(result.id));
          return;
        }
        if (result?.accessDenied) {
          hasAccessDenied = true;
        }
        console.error(`Failed to import drama ${result?.id}`);
      });

      if (shouldSelectImportedEpisodes) {
        selectDramaEpisodesByMode(mergedDramas, Array.from(requestedIdSet), {
          mode: selectMode,
          checked: true,
          expand: shouldExpandImported,
          isSelectableEpisode: (episode) => isPaidEpisode(platform, episode) || isMemberEpisode(platform, episode),
        });
      }

      updatePlatformState(platform, (state) => ({
        ...state,
        searchResults: shouldAutoCheck
          ? state.searchResults.map((item) => ({
              ...item,
              checked: requestedIdSet.has(String(item.id)) || importedIdSet.has(String(item.id)) ? true : item.checked,
            }))
          : state.searchResults,
        searchPageCache: shouldAutoCheck
          ? Object.fromEntries(
              Object.entries(state.searchPageCache || {}).map(([page, pageResults]) => [
                page,
                Array.isArray(pageResults)
                  ? pageResults.map((item) => ({
                      ...item,
                      checked: requestedIdSet.has(String(item.id)) || importedIdSet.has(String(item.id)) ? true : item.checked,
                    }))
                  : pageResults,
              ])
            )
          : state.searchPageCache,
        dramas: mergedDramas,
        selectedEpisodesSnapshot: collectSelectedEpisodesFromDramas(mergedDramas),
      }));
      if (hasAccessDenied) {
        await showMissevanAccessHint();
      }
      if (scrollToDramaId != null) {
        scrollToDramaResult(scrollToDramaId);
      } else if (mergedDramas.length > 0 && !shouldPreserveScroll) {
        scrollToPanel(resultsPanelRef);
      }
      return {
        dramas: mergedDramas,
        importedIds: Array.from(importedIdSet),
        requestedIds: Array.from(requestedIdSet),
      };
    } catch (error) {
      console.error("Failed to import dramas", error);
      toast.error("导入作品失败，请稍后重试。");
      return {
        dramas: platformStatesRef.current[platform]?.dramas || [],
        importedIds: [],
        requestedIds: Array.from(requestedIdSet),
      };
    }
  }

  async function loadMoreSearchResults(platform = getActiveWorkPlatform()) {
    const state = platformStatesRef.current[platform];
    const keyword = String(state?.searchKeyword ?? "").trim();
    const pageSize = Number(state?.searchPageSize ?? 5) || 5;
    const offset = Number(state?.searchNextOffset ?? state?.searchResults?.length ?? 0) || 0;
    if (!keyword || state?.searchResultSource === "manual" || state?.isLoadingMoreResults || !state?.searchHasMore) {
      return;
    }

    updatePlatformState(platform, (current) => ({
      ...current,
      isLoadingMoreResults: true,
    }));

    try {
      const endpoint = `/unified-search?keyword=${encodeURIComponent(keyword)}&offset=${offset}&limit=${pageSize}`;
      const response = await fetch(buildVersionedUrl(endpoint, appConfigRef.current.frontendVersion), {
        cache: "no-store",
      });
      const unifiedData = await parseVersionedJsonResponse(response);
      const data = unifiedData?.results?.[platform];

      if (!data?.success) {
        if (platform === "missevan" && data?.accessDenied) {
          resetSearchFlow(platform);
          await showMissevanAccessHint();
        } else if (platform === "manbo" && data?.unavailable) {
          toast.error("漫播搜索不可用，请改用 ID 或链接导入。");
          updatePlatformState(platform, (current) => ({
            ...current,
            isLoadingMoreResults: false,
          }));
        } else {
          toast.error("加载搜索结果失败，请稍后重试。");
          updatePlatformState(platform, (current) => ({
            ...current,
            isLoadingMoreResults: false,
          }));
        }
        return;
      }

      const incomingResults = Array.isArray(data.results) ? data.results.map((item) => ({ ...item })) : [];
      const nextOffset = Number(data.meta?.nextOffset ?? offset + incomingResults.length) || 0;
      const totalMatched = Number(data.meta?.matchedCount ?? data.meta?.totalMatched ?? state.searchTotalMatched ?? 0) || 0;
      const page = Math.floor(offset / Math.max(1, pageSize)) + 1;

      updatePlatformState(platform, (current) => appendSearchResultsPage(current, incomingResults, {
        hasMore: data.meta?.hasMore,
        nextOffset,
        page,
        pageSize,
        totalMatched,
      }));
    } catch (error) {
      console.error("Failed to load more search results", error);
      if (platform === "missevan" && error?.accessDenied) {
        await showMissevanAccessHint();
      } else {
        toast.error("加载搜索结果失败，请稍后重试。");
      }
      updatePlatformState(platform, (current) => ({
        ...current,
        isLoadingMoreResults: false,
      }));
    }
  }

  function buildSelectedEpisodesReplay(operation, selectedEpisodes, source = "custom") {
    const byDrama = new Map();
    (Array.isArray(selectedEpisodes) ? selectedEpisodes : []).forEach((episode) => {
      const dramaId = String(episode?.drama_id ?? "").trim();
      const episodeId = String(episode?.sound_id ?? "").trim();
      if (!dramaId || !episodeId) return;
      const ids = byDrama.get(dramaId) || [];
      ids.push(episodeId);
      byDrama.set(dramaId, ids);
    });
    return {
      version: 1,
      operation,
      source,
      dramas: Array.from(byDrama, ([dramaId, episodeIds]) => ({ dramaId, episodeIds: Array.from(new Set(episodeIds)) })),
    };
  }

  function appendRefreshSource(source) {
    const normalized = String(source ?? "").trim();
    return `${normalized}refresh`;
  }

  function applyReplaySelection(dramas, selectedEpisodes) {
    const selected = new Set((selectedEpisodes || []).map((episode) => `${episode.drama_id}:${episode.sound_id}`));
    return (dramas || []).map((drama) => ({
      ...drama,
      episodes: { ...drama.episodes, episode: (drama.episodes?.episode || []).map((episode) => ({ ...episode, selected: selected.has(`${drama?.drama?.id}:${episode.sound_id}`) })) },
    }));
  }

  function updateReplaySearch(platform, generation, dramaIds, patch) {
    updatePlatformState(platform, (state) => {
      if (replaySearchGenerationRef.current !== generation) return state;
      const dramas = patch.dramas ?? state.dramas;
      const currentCardsById = new Map((state.searchResults || []).map((card) => [String(card.id), card]));
      const cardsById = new Map((patch.cards ?? state.searchResults ?? []).map((card) => [String(card.id), card]));
      const dramasById = new Map((dramas || []).map((drama) => [String(drama?.drama?.id), drama]));
      const cards = dramaIds.flatMap((id) => {
        const card = cardsById.get(String(id));
        const detail = dramasById.get(String(id))?.drama;
        if (!card && !detail) return [];
        const currentCard = currentCardsById.get(String(id));
        // Cards and episode details arrive independently of the metric queue.
        // Keep its status and completed metrics when either response arrives late.
        const metricsStatus = String(
          currentCard?.metrics_status || card?.metrics_status || "pending"
        );
        const completedMetrics = metricsStatus === "ready"
          ? Object.fromEntries(["view_count", "subscription_num", "reward_num", "diamond_value", "pay_count", "member_listen_count"]
            .filter((field) => currentCard && Object.hasOwn(currentCard, field))
            .map((field) => [field, currentCard[field]]))
          : {};
        const terminalFailureMetrics = ["error", "access_denied"].includes(metricsStatus)
          ? clearSearchCardDynamicMetrics()
          : {};
        return [{
          ...card,
          ...detail,
          ...completedMetrics,
          ...terminalFailureMetrics,
          id: String(id),
          title: detail?.name || card?.title || "",
          platform,
          checked: true,
          metrics_status: metricsStatus,
          metrics_error_code: currentCard?.metrics_error_code || card?.metrics_error_code || "",
        }];
      });
      return {
        ...state,
        searchResults: cards,
        searchPageCache: {},
        searchResultSource: "manual",
        searchCurrentPage: 1,
        searchPageSize: Math.max(1, cards.length),
        searchHasMore: false,
        searchNextOffset: 0,
        searchTotalMatched: cards.length,
        searchKeyword: "",
        searchGeneration: generation,
        isLoadingMoreResults: false,
        ...(patch.dramas ? {
          dramas: applyReplaySelection(patch.dramas, patch.selectedEpisodes || []),
          selectedEpisodesSnapshot: patch.selectedEpisodes || [],
        } : {}),
      };
    });
  }

  async function startPlayCountStatistics(soundIds, options = {}) {
    if (warnIfBackgroundTaskRunning()) {
      return;
    }
    const platform = resolveStatsPlatform(options?.platform);
    const selectedEpisodeSource = Array.isArray(options?.selectedEpisodes)
      ? options.selectedEpisodes
      : platformStatesRef.current[platform].selectedEpisodesSnapshot;
    const selectedEpisodes = selectedEpisodeSource.filter((episode) => soundIds.includes(episode.sound_id));
    await cancelActiveRun(platform);
    resetOutputs(platform);
    const source = options.isHistoryRefresh
      ? String(options.source ?? "custom").trim()
      : String(options?.source ?? "custom").trim() || "custom";
    const replay = options.replay ? { ...options.replay, source } : buildSelectedEpisodesReplay("play_count", selectedEpisodes, source);
    const { runId, signal } = beginRun(platform, replay, options.refreshSignal);
    if (!selectedEpisodes.length) {
      toast.warning("请先选择分集。");
      finishRun(platform, runId, "idle");
      return;
    }
    activateSharedOutputPlatform(platform);
    let finalStatus = "completed";
    try {
      await registerApiSearchDramaIds(
        platform,
        selectedEpisodes.map((episode) => episode.drama_id),
        signal
      );
      ensureStatsRunActive(platform, runId, signal);
      updatePlatformState(platform, (state) => ({
        ...state,
        stats: {
          ...state.stats,
          currentAction: "开始统计播放量",
          playCountSelectedEpisodeCount: selectedEpisodes.length,
        },
      }));
      ensureStatsRunActive(platform, runId, signal);
      scrollToPanel(outputPanelRef);
      const payload = { episodes: selectedEpisodes, source: options.isHistoryRefresh ? appendRefreshSource(source) : source };
      if (platform === "missevan") {
        const playCountDramas = options.playCountDramas || buildPlayCountDramasFromDramas(platformStatesRef.current[platform].dramas);
        if (playCountDramas.length) {
          payload.playCountDramas = playCountDramas;
        }
      }
      await startStatsTask(platform, "play_count", payload, runId, signal);
      ensureStatsRunActive(platform, runId, signal);
      scrollToPanel(outputPanelRef);
    } catch (error) {
      if (!isAbortError(error)) {
        finalStatus = "failed";
        toast.error(getStatsRequestErrorMessage(error));
        updatePlatformState(platform, (state) => ({
          ...state,
          stats: {
            ...state.stats,
            currentAction: getStatsRequestErrorMessage(error),
          },
        }));
      } else {
        finalStatus = "cancelled";
      }
    } finally {
      finishRun(platform, runId, finalStatus);
    }
  }

  async function startIdStatisticsForEpisodes(selectedEpisodes, emptyMessage = "请先选择分集。", options = {}) {
    if (warnIfBackgroundTaskRunning()) {
      return;
    }
    const platform = resolveStatsPlatform(options?.platform);
    const resolvedSource = resolveIdStatisticsSource({
      platform,
      dramas: options.dramas || platformStatesRef.current[platform]?.dramas,
      selectedEpisodes,
      source: options?.source,
    });
    await cancelActiveRun(platform);
    resetOutputs(platform);
    const baseSource = options.isHistoryRefresh ? String(options.source ?? resolvedSource).trim() : resolvedSource;
    const source = options.isHistoryRefresh ? appendRefreshSource(baseSource) : resolvedSource;
    const replay = options.replay
      ? { ...options.replay, source: options.isHistoryRefresh ? baseSource : resolvedSource }
      : buildSelectedEpisodesReplay("id", selectedEpisodes, resolvedSource);
    const { runId, signal } = beginRun(platform, replay, options.refreshSignal);
    if (!selectedEpisodes.length) {
      toast.warning(emptyMessage);
      finishRun(platform, runId, "idle");
      return;
    }
    activateSharedOutputPlatform(platform);
    let finalStatus = "completed";
    try {
      await registerApiSearchDramaIds(
        platform,
        selectedEpisodes.map((episode) => episode.drama_id),
        signal
      );
      ensureStatsRunActive(platform, runId, signal);
      updatePlatformState(platform, (state) => ({
        ...state,
        stats: {
          ...state.stats,
          currentAction: "开始统计弹幕与去重 ID",
          idSelectedEpisodeCount: selectedEpisodes.length,
        },
      }));
      ensureStatsRunActive(platform, runId, signal);
      scrollToPanel(outputPanelRef);
      await startStatsTask(
        platform,
        "id",
        { episodes: selectedEpisodes, source },
        runId,
        signal
      );
      ensureStatsRunActive(platform, runId, signal);
      scrollToPanel(outputPanelRef);
    } catch (error) {
      if (!isAbortError(error)) {
        finalStatus = "failed";
        toast.error(getStatsRequestErrorMessage(error));
        updatePlatformState(platform, (state) => ({
          ...state,
          stats: {
            ...state.stats,
            currentAction: getStatsRequestErrorMessage(error),
          },
        }));
      } else {
        finalStatus = "cancelled";
      }
    } finally {
      finishRun(platform, runId, finalStatus);
    }
  }

  async function startIdStatisticsConcurrent(soundIds, options = {}) {
    const platform = resolveStatsPlatform(options?.platform);
    const selectedEpisodeSource = Array.isArray(options?.selectedEpisodes)
      ? options.selectedEpisodes
      : platformStatesRef.current[platform].selectedEpisodesSnapshot;
    const selectedEpisodes = selectedEpisodeSource.filter((episode) => soundIds.includes(episode.sound_id));
    await startIdStatisticsForEpisodes(selectedEpisodes, "请先选择分集。", { platform });
  }

  async function startDramaPaidIdStatistics(dramaId, options = {}) {
    if (warnIfBackgroundTaskRunning()) {
      return;
    }
    const normalizedDramaId = String(dramaId ?? "").trim();
    if (!normalizedDramaId) {
      toast.warning("请先选择作品。");
      return;
    }
    const platform = resolveStatsPlatform(options?.platform);
    const addDramasForContext = options?.addDramas || addDramas;
    const importResult = options?.freshDramas
      ? { dramas: options.freshDramas }
      : await addDramasForContext([dramaId], {
      autoCheck: true,
      expandImported: true,
      preserveScroll: true,
      selectMode: "paid",
      platform,
      });
    const nextDramas = importResult?.dramas || platformStatesRef.current[platform]?.dramas || [];
    const drama = nextDramas.find((item) => String(item?.drama?.id) === normalizedDramaId);
    const episodes = Array.isArray(drama?.episodes?.episode) ? drama.episodes.episode : [];
    const paidEpisodes = episodes.filter((episode) => isPaidEpisode(platform, episode) || isMemberEpisode(platform, episode));

    if (!paidEpisodes.length) {
      toast.warning("没有可统计的付费分集。");
      return;
    }

    const dramaTitle = drama?.drama?.name || "";
    const selectedPaidEpisodes = paidEpisodes.map((episode) => ({
      drama_id: normalizedDramaId,
      sound_id: episode.sound_id,
      drama_title: dramaTitle,
      episode_title: episode.name,
      duration: Number(episode.duration ?? 0),
    }));
    const paidSource = resolveIdStatisticsSource({ platform, dramas: nextDramas, selectedEpisodes: selectedPaidEpisodes, source: options?.source });
    await startIdStatisticsForEpisodes(
      selectedPaidEpisodes,
      "没有可统计的付费分集。",
      { platform, source: paidSource, replay: options?.replay || { version: 1, operation: "paid_id", dramaIds: [normalizedDramaId], source: paidSource } }
    );
  }

  async function startRevenueEstimate(dramaIds, options = {}) {
    if (warnIfBackgroundTaskRunning()) {
      return;
    }
    if (!dramaIds?.length) {
      toast.warning("请先选择作品。");
      return;
    }
    const platform = resolveStatsPlatform(options?.platform);
    await cancelActiveRun(platform);
    resetOutputs(platform);
    const replay = options.replay || { version: 1, operation: "revenue", dramaIds: Array.from(new Set(dramaIds.map((id) => String(id)))), ...(options?.source ? { source: options.source } : {}) };
    const { runId, signal } = beginRun(platform, replay, options.refreshSignal);
    activateSharedOutputPlatform(platform);
    let finalStatus = "completed";
    try {
      await registerApiSearchDramaIds(platform, dramaIds, signal);
      ensureStatsRunActive(platform, runId, signal);
      updatePlatformState(platform, (state) => ({
        ...state,
        stats: {
          ...state.stats,
          currentAction: "开始最低收益预估",
        },
      }));
      ensureStatsRunActive(platform, runId, signal);
      scrollToPanel(outputPanelRef);
      await startStatsTask(
        platform,
        "revenue",
        { dramaIds, source: options?.source },
        runId,
        signal
      );
      ensureStatsRunActive(platform, runId, signal);
      scrollToPanel(outputPanelRef);
    } catch (error) {
      if (!isAbortError(error)) {
        finalStatus = "failed";
        toast.error(getStatsRequestErrorMessage(error));
        updatePlatformState(platform, (state) => ({
          ...state,
          stats: {
            ...state.stats,
            currentAction: getStatsRequestErrorMessage(error),
          },
        }));
      } else {
        finalStatus = "cancelled";
      }
    } finally {
      finishRun(platform, runId, finalStatus);
    }
  }

  async function cancelCurrentStatistics() {
    if (replayPreparationAbortControllerRef.current) {
      replayPreparationAbortControllerRef.current.abort();
    }
    replayCardsAbortControllerRef.current?.abort?.();
    const platform = sharedOutputPlatformRef.current;
    const stats = platformStatesRef.current[platform]?.stats;
    if (!stats?.isRunning && !stats?.activeTaskId) {
      return;
    }
    await cancelActiveRun(platform);
    updatePlatformState(platform, (state) => ({
      ...state,
      stats: {
        ...state.stats,
        currentAction: "统计已取消",
      },
    }));
  }

  async function replayHistoryEntry(entry) {
    const replay = normalizeStatsHistoryReplay(entry?.replay);
    const entryId = String(entry?.id ?? "").trim();
    const platform = entry?.platform === "manbo" ? "manbo" : entry?.platform === "missevan" ? "missevan" : "";
    if (!entryId || !platform || !replay) {
      toast.warning("旧记录未保存刷新参数，无法刷新。");
      return;
    }
    if (replayPreparingRef.current.size > 0 || isAnyBackgroundTaskRunning()) {
      toast.warning("统计任务运行中，请等待完成后再刷新。");
      return;
    }
    replayPreparingRef.current.add(entryId);
    setReplayPreparingEntryIds(Array.from(replayPreparingRef.current));
    const preparationAbortController = new AbortController();
    replayPreparationAbortControllerRef.current = preparationAbortController;
    const cardsAbortController = new AbortController();
    replayCardsAbortControllerRef.current?.abort?.();
    replayCardsAbortControllerRef.current = cardsAbortController;
    let resolveFreshDetails = null;
    let statisticsStarted = false;
    try {
      const dramaIds = replay.operation === "id" || replay.operation === "play_count"
        ? replay.dramas.map((drama) => drama.dramaId)
        : replay.dramaIds;
      const searchGeneration = ++replaySearchGenerationRef.current;
      let freshDramasForCards = [];
      const freshDetailsReady = new Promise((resolve) => { resolveFreshDetails = resolve; });
      updatePlatformState(platform, (state) => setManualSearchResultsState(state, [], { searchGeneration }));
      openSearchPlatform(platform);
      void (async () => {
        const endpoint = platform === "manbo" ? "/manbo/getdramacards" : "/getdramacards";
        const body = platform === "manbo" ? { items: dramaIds.map((raw) => ({ raw })), suppressUsageLog: true } : { drama_ids: dramaIds, suppressUsageLog: true };
        const response = await fetch(buildVersionedUrl(endpoint, appConfigRef.current.frontendVersion), {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: cardsAbortController.signal,
        });
        const data = await parseVersionedJsonResponse(response);
        if (cardsAbortController.signal.aborted || replaySearchGenerationRef.current !== searchGeneration) return;
        const cards = Array.isArray(data?.results) ? data.results : [];
        if (response.ok && data?.success && cards.length) {
          updateReplaySearch(platform, searchGeneration, dramaIds, { cards });
        } else if (data?.accessDenied) {
          preparationAbortController.abort();
          cardsAbortController.abort();
          if (platform === "missevan") await showMissevanAccessHint();
          else toast.error(data.message || "任务剧集加载受限，已停止刷新。");
        } else {
          await freshDetailsReady;
          if (!cardsAbortController.signal.aborted && replaySearchGenerationRef.current === searchGeneration && freshDramasForCards.length) {
            updateReplaySearch(platform, searchGeneration, dramaIds, {});
            toast.warning("刷新未能加载任务卡片，已使用最新作品详情继续统计。");
          }
        }
      })().catch(async (error) => {
        if (isAbortError(error)) return;
        await freshDetailsReady;
        if (!cardsAbortController.signal.aborted && replaySearchGenerationRef.current === searchGeneration && freshDramasForCards.length) {
          updateReplaySearch(platform, searchGeneration, dramaIds, {});
          toast.warning("刷新未能加载任务卡片，已使用最新作品详情继续统计。");
        }
      }).finally(() => {
        if (replayCardsAbortControllerRef.current === cardsAbortController) {
          replayCardsAbortControllerRef.current = null;
        }
      });
      const refreshed = await fetchDramasByIds(platform, dramaIds, preparationAbortController.signal, { forceRefresh: true });
      if (preparationAbortController.signal.aborted || replayPreparationAbortControllerRef.current !== preparationAbortController) {
        return;
      }
      if (replaySearchGenerationRef.current !== searchGeneration) return;
      if (isAnyBackgroundTaskRunning()) {
        toast.warning("统计任务运行中，已停止刷新准备。");
        return;
      }
      const failed = refreshed.find((result) => !result?.success || !result?.drama);
      if (failed) {
        if (failed.accessDenied) {
          preparationAbortController.abort();
          if (platform === "missevan") await showMissevanAccessHint();
        }
        toast.error(`无法重新加载作品 ${failed.id}，未开始刷新。`);
        return;
      }
      const freshDramas = refreshed.map((result) => result.drama);
      freshDramasForCards = freshDramas;
      resolveFreshDetails();
      updateReplaySearch(platform, searchGeneration, dramaIds, { dramas: freshDramas });
      if (replay.operation === "revenue") {
        const selectedEpisodes = freshDramas.flatMap((drama) => getRevenueEpisodesForDrama(platform, drama).map((episode) => ({
          drama_id: String(drama?.drama?.id ?? ""), sound_id: String(episode?.sound_id ?? ""), drama_title: drama?.drama?.name || "", episode_title: episode?.name || "", duration: Number(episode?.duration ?? 0),
        })).filter((episode) => episode.drama_id && episode.sound_id));
        updateReplaySearch(platform, searchGeneration, dramaIds, { dramas: freshDramas, selectedEpisodes });
        statisticsStarted = true;
        await startRevenueEstimate(replay.dramaIds, { platform, replay, source: appendRefreshSource(replay.source), refreshSignal: preparationAbortController.signal });
        return;
      }
      if (replay.operation === "paid_id") {
        const selectedPaidEpisodes = freshDramas.flatMap((drama) => (drama?.episodes?.episode || [])
          .filter((episode) => isPaidEpisode(platform, episode) || isMemberEpisode(platform, episode))
          .map((episode) => ({
            drama_id: String(drama?.drama?.id ?? ""),
            sound_id: episode.sound_id,
            drama_title: drama?.drama?.name || "",
            episode_title: episode.name,
            duration: Number(episode.duration ?? 0),
          }))
        );
        if (!selectedPaidEpisodes.length) {
          toast.warning("当前作品没有可统计的付费分集。");
          return;
        }
        updateReplaySearch(platform, searchGeneration, dramaIds, { dramas: freshDramas, selectedEpisodes: selectedPaidEpisodes });
        statisticsStarted = true;
        await startIdStatisticsForEpisodes(selectedPaidEpisodes, "当前作品没有可统计的付费分集。", {
          platform,
          replay,
          dramas: freshDramas,
          source: replay.source ?? (freshDramas.length === 1 ? `${freshDramas[0].drama?.id}payID` : ""),
          isHistoryRefresh: true,
          refreshSignal: preparationAbortController.signal,
        });
        return;
      }
      const selectedEpisodes = [];
      for (const replayDrama of replay.dramas) {
        const freshDrama = freshDramas.find((drama) => String(drama?.drama?.id) === replayDrama.dramaId);
        const episodesById = new Map((freshDrama?.episodes?.episode || []).map((episode) => [String(episode.sound_id), episode]));
        const missingEpisodeId = replayDrama.episodeIds.find((episodeId) => !episodesById.has(episodeId));
        if (missingEpisodeId) {
          toast.error(`作品《${freshDrama?.drama?.name || replayDrama.dramaId}》缺少原选分集 ${missingEpisodeId}，未开始刷新。`);
          return;
        }
        replayDrama.episodeIds.forEach((episodeId) => {
          const episode = episodesById.get(episodeId);
          selectedEpisodes.push({
            drama_id: replayDrama.dramaId,
            sound_id: episodeId,
            drama_title: freshDrama?.drama?.name || "",
            episode_title: episode?.name || "",
            duration: Number(episode?.duration ?? 0),
          });
        });
      }
      if (replay.operation === "id") {
        updateReplaySearch(platform, searchGeneration, dramaIds, { dramas: freshDramas, selectedEpisodes });
        statisticsStarted = true;
        await startIdStatisticsForEpisodes(selectedEpisodes, "原选分集不可用。", {
          platform,
          replay,
          source: replay.source,
          dramas: freshDramas,
          isHistoryRefresh: true,
          refreshSignal: preparationAbortController.signal,
        });
        return;
      }
      const selectedIds = new Set(selectedEpisodes.map((episode) => `${episode.drama_id}:${episode.sound_id}`));
      const playCountDramas = freshDramas.map((drama) => ({
        ...drama,
        episodes: {
          ...drama.episodes,
          episode: (drama.episodes?.episode || []).map((episode) => ({
            ...episode,
            selected: selectedIds.has(`${drama.drama?.id}:${episode.sound_id}`),
          })),
        },
      }));
      updateReplaySearch(platform, searchGeneration, dramaIds, { dramas: playCountDramas, selectedEpisodes });
      statisticsStarted = true;
      await startPlayCountStatistics(selectedEpisodes.map((episode) => episode.sound_id), {
        platform,
        selectedEpisodes,
        playCountDramas: buildPlayCountDramasFromDramas(playCountDramas),
        replay,
        source: replay.source ?? "custom",
        isHistoryRefresh: true,
        refreshSignal: preparationAbortController.signal,
      });
    } catch (error) {
      if (!isAbortError(error)) {
        console.error("Failed to replay stats history", error);
        toast.error(getStatsRequestErrorMessage(error));
      }
    } finally {
      if (!statisticsStarted || preparationAbortController.signal.aborted) cardsAbortController.abort();
      resolveFreshDetails?.();
      if (replayPreparationAbortControllerRef.current === preparationAbortController) {
        replayPreparationAbortControllerRef.current = null;
      }
      replayPreparingRef.current.delete(entryId);
      setReplayPreparingEntryIds(Array.from(replayPreparingRef.current));
    }
  }

  const missevanResultCount = getSearchResultCount(platformStates.missevan);
  const manboResultCount = getSearchResultCount(platformStates.manbo);
  const cvResultCount = Number(cvSearchState.matchedCount ?? cvSearchState.results.length) || 0;
  const visibleSearchCategories = [
    ...searchPlatforms.filter((platform) =>
      platform.key !== "missevan" || appConfig.missevanEnabled
    ),
    { key: "cv", label: "CV" },
  ];
  const searchResultCounts = {
    missevan: missevanResultCount,
    manbo: manboResultCount,
    cv: cvResultCount,
  };

  return (
    <Sheet open={mainDrawerOpen} onOpenChange={setMainDrawerOpen}>
      <div className="app-shell mx-auto flex min-h-screen max-w-7xl flex-col gap-4 px-3 pt-3 sm:px-5 sm:pt-[6.5rem] lg:gap-5 lg:px-6">
        <MainNavigationDrawer
          open={mainDrawerOpen}
          platforms={visiblePlatforms}
          currentRoute={toolRouteState}
          ongoingMenu={ongoingNavigationMenu}
          ranksMenu={ranksNavigationMenu}
          ranksMenuStatus={mainNavigationRanksStatus}
          defaultExpandedRootKeys={defaultExpandedRootKeys}
          drawerRootItemClassName={drawerRootItemClassName}
          drawerChildItemClassName={drawerChildItemClassName}
          drawerUtilityItemClassName={drawerUtilityItemClassName}
          mobileMenuActiveItemClassName={mobileMenuActiveItemClassName}
          onRequestRanksMenu={loadMainNavigationRanks}
          onCommitRoute={navigateToolRouteFromMenu}
          onOpenChangelog={openDrawerChangelog}
          onOpenFeedback={openDrawerFeedback}
          featureSuggestionUrl={appConfig.featureSuggestionUrl}
          desktopApp={appConfig.desktopApp}
          desktopAppUrl={appConfig.desktopAppUrl}
        />
      <header className="contents sm:fixed sm:inset-x-0 sm:top-0 sm:z-30 sm:block sm:border-b sm:border-border/75 sm:bg-background/92 sm:px-5 sm:py-3 sm:backdrop-blur-xl lg:px-6">
        <div className="contents sm:relative sm:mx-auto sm:grid sm:max-w-7xl sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-5">
          <div className="relative flex min-w-0 items-start gap-3 pr-14 text-left text-inherit sm:col-start-1 sm:row-start-1 sm:pr-0">
            <button
              type="button"
              aria-label={headerHomeLabel}
              className="absolute inset-0 z-10 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              onClick={openHomeFromHeader}
            />
            <AppIcon className="pointer-events-none size-14 self-center rounded-xl sm:size-12" />
            <div className="pointer-events-none min-w-0">
              <div className="flex min-w-0 flex-wrap items-baseline gap-2">
                <div className="text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-primary">{appConfig.brandName}</div>
                <span className="text-xs font-semibold leading-none text-muted-foreground">
                  v{appConfig.frontendVersion}
                </span>
              </div>
              <h1 className="mt-1 min-w-0 text-[1.625rem] font-semibold leading-tight tracking-tight">
                <span className="min-w-0">{appConfig.titleZh}</span>
              </h1>
            </div>
          </div>
          <div className="sticky top-[env(safe-area-inset-top)] z-30 -mx-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-border/75 bg-background px-3 pb-3 pt-0 sm:static sm:contents sm:py-3">
            <SearchPanel
            className="min-w-0 w-full sm:col-start-2 sm:row-start-1 sm:w-full"
            descriptionClassName="sm:hidden"
            cooldownHours={appConfig.cooldownHours}
            cooldownUntil={appConfig.cooldownUntil}
            desktopAppUrl={appConfig.desktopAppUrl}
            formState={sharedSearchForm}
            frontendVersion={appConfig.frontendVersion}
            handleVersionResponse={updateVersionStatusFromResponse}
            isDesktopApp={appConfig.desktopApp}
            onCrossPlatformImport={({ targetPlatform, rawItems, sourcePlatform, emptyResultNotice }) =>
              importRawItemsIntoPlatform(targetPlatform, rawItems, {
                sourcePlatform,
                emptyResultNotice,
              })
            }
            onNotice={setNotice}
            onResetPlatformState={resetSearchFlow}
            onSearchCommit={commitGlobalSearchNavigation}
            onSearchPendingChange={setGlobalSearchPending}
            onSelectPlatform={setActiveSearchPlatform}
            onSelectCategory={changeSearchCategory}
            onUpdateFormState={updateSharedSearchForm}
            onUpdatePlatformResults={(platform, results, source, meta) => setSearchResults(platform, results, source, meta)}
            onUpdateCvResults={(results, meta) => setCvSearchState({
              results: Array.isArray(results) ? results : [],
              matchedCount: Number(meta?.matchedCount ?? results?.length ?? 0) || 0,
              exactMatch: Boolean(meta?.exactMatch),
              keyword: String(meta?.keyword ?? "").trim(),
            })}
            restoreSearchRequest={toolRouteState.view === "search" && toolRouteState.q && toolRouteState.q === searchRouteRestoreKeyword ? {
              keyword: toolRouteState.q,
              category: toolRouteState.platform,
              signature: `${searchRouteRestoreGeneration}:${toolRouteState.q}`,
            } : null}
            placeholder="请输入关键词、ID、分享链接。"
            />
            <SheetTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon-lg"
                className="shrink-0 bg-background sm:inline-flex sm:col-start-3 sm:row-start-1"
                aria-controls="main-navigation-drawer"
                aria-label={mainMenuButtonLabel}
                title={mainMenuButtonLabel}
              >
                <MenuIcon aria-hidden="true" className="size-4" />
              </Button>
            </SheetTrigger>
          </div>

          {appConfig.versionMismatch ? (
            <Alert className="border-destructive/30 bg-destructive/10 sm:col-span-3">
              <AlertTriangleIcon className="size-4" />
              <AlertTitle>工具版本已更新</AlertTitle>
              <AlertDescription>
                工具已更新，请刷新或重新打开页面。若还看到此提醒，请清理缓存后再重试。
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      </header>

      {currentPlatform === "home" ? (
        <HomeView
          favoriteKeys={favoriteKeySet}
          favoriteActionsDisabled={favoriteActionsDisabled}
          statisticsActionsDisabled={statisticsActionsDisabled}
          frontendVersion={appConfig.frontendVersion}
          handleVersionResponse={updateVersionStatusFromResponse}
          onNavigateRoute={navigateHomeRoute}
          onOpenSearchResult={openDramaInSearch}
          onOpenCv={openCvProfile}
          onToggleFavorite={toggleFavorite}
          onAddCompareItem={addDramaToCompareBasket}
          onStartDramaPaidIdStatistics={startDramaPaidIdStatistics}
          onStartRevenueEstimate={startRevenueEstimate}
          historyEntries={sharedHistoryEntries}
          onDeleteHistoryEntry={(entry) => statsHistory.deleteHistoryEntry(entry.platform, entry.id)}
          onClearHistory={statsHistory.clearAllHistoryEntries}
          onReplayHistoryEntry={replayHistoryEntry}
          isReplayPreparing={replayPreparingEntryIds.length > 0}
          replayPreparingEntryIds={replayPreparingEntryIds}
          historyActionsDisabled={historyActionsDisabled}
        />
      ) : currentPlatform === "ranks" ? (
        <Suspense
          fallback={
            <LazyRouteFallback
              title="正在加载榜单"
              description="正在准备完整榜单页，首页榜单缓存会继续复用。"
            />
          }
        >
          <RanksPanel
            favoriteKeys={favoriteKeySet}
            favoriteActionsDisabled={favoriteActionsDisabled}
            statisticsActionsDisabled={statisticsActionsDisabled}
            frontendVersion={appConfig.frontendVersion}
            handleVersionResponse={updateVersionStatusFromResponse}
            routeState={toolRouteState}
            onRouteStateChange={navigateToolRoute}
            onToggleFavorite={toggleFavorite}
            onOpenSearchResult={openDramaInSearch}
            onOpenCv={openCvProfile}
            onAddCompareItem={addDramaToCompareBasket}
            onStartDramaPaidIdStatistics={startDramaPaidIdStatistics}
            onStartRevenueEstimate={startRevenueEstimate}
          />
        </Suspense>
      ) : currentPlatform === "ongoing" ? (
        <Suspense
          fallback={
            <LazyRouteFallback
              title="正在加载追更"
              description="正在准备完整追更页，首页连载缓存会继续复用。"
            />
          }
        >
          <OngoingPanel
            favoriteKeys={favoriteKeySet}
            favoriteActionsDisabled={favoriteActionsDisabled}
            statisticsActionsDisabled={statisticsActionsDisabled}
            frontendVersion={appConfig.frontendVersion}
            handleVersionResponse={updateVersionStatusFromResponse}
            routeState={toolRouteState}
            onRouteStateChange={navigateToolRoute}
            onToggleFavorite={toggleFavorite}
            onOpenSearchResult={openDramaInSearch}
            onAddCompareItem={addDramaToCompareBasket}
            onStartDramaPaidIdStatistics={startDramaPaidIdStatistics}
            onStartRevenueEstimate={startRevenueEstimate}
          />
        </Suspense>
      ) : currentPlatform === "feedback" ? (
        <Suspense
          fallback={
            <LazyRouteFallback
              title="正在加载建议反馈"
              description="正在准备建议反馈与收益预估说明。"
            />
          }
        >
          <FeedbackView
            featureSuggestionUrl={appConfig.featureSuggestionUrl}
            frontendVersion={appConfig.frontendVersion}
          />
        </Suspense>
      ) : currentPlatform === "cv" ? (
        <Suspense fallback={<LazyRouteFallback title="正在加载 CV 主页" description="正在准备 CV 作品与筛选数据。" />}>
          <CvProfileView
            cvName={toolRouteState.cv}
            profileId={toolRouteState.cvKey}
            frontendVersion={appConfig.frontendVersion}
            handleVersionResponse={updateVersionStatusFromResponse}
            onBack={returnFromCvProfile}
            platformFilter={toolRouteState.platform}
            paymentFilter={toolRouteState.payment}
            releaseFilter={toolRouteState.release}
            partnersFilter={toolRouteState.partners}
            onRouteStateChange={(patch) => navigateToolRoute(patch, { replace: true })}
            onOpenSearchResult={openDramaInSearch}
            favoriteKeys={favoriteKeySet}
            favoriteActionsDisabled={favoriteActionsDisabled}
            statisticsActionsDisabled={statisticsActionsDisabled}
            onToggleFavorite={toggleFavorite}
            onAddCompareItem={addDramaToCompareBasket}
            onStartDramaPaidIdStatistics={startDramaPaidIdStatistics}
            onStartRevenueEstimate={startRevenueEstimate}
          />
        </Suspense>
      ) : currentPlatform === "favorites" ? (
        <Suspense fallback={<LazyRouteFallback title="正在加载收藏" description="正在准备收藏作品与历史记录。" />}>
          <FavoritesPanel
            favorites={favoriteItems}
            favoriteActionsDisabled={favoriteActionsDisabled}
            statisticsActionsDisabled={statisticsActionsDisabled}
            frontendVersion={appConfig.frontendVersion}
            handleVersionResponse={updateVersionStatusFromResponse}
            isDesktopApp={appConfig.desktopApp}
            cooldownHours={appConfig.cooldownHours}
            cooldownUntil={appConfig.cooldownUntil}
            desktopAppUrl={appConfig.desktopAppUrl}
            onFavoritesChange={reloadFavoriteItems}
            onBackgroundTaskChange={setBackgroundTask}
            refreshState={favoriteRefreshState}
            refreshRevision={favoriteRefreshRevision}
            onRefreshStateChange={setFavoriteRefreshState}
            onRefreshSettled={handleFavoriteRefreshSettled}
            onToggleFavorite={toggleFavorite}
          />
        </Suspense>
      ) : (
        <Suspense fallback={<LazyRouteFallback title="正在加载搜索结果" description="搜索框保持可用，正在准备结果和统计区域。" />}>
          <SearchWorkspace
            legend={{
              open: searchMetricLegendOpen,
              onToggle: () => setSearchMetricLegendOpen((open) => !open),
            }}
            panelRefs={{ results: resultsPanelRef, output: outputPanelRef }}
            results={{
              dramas: currentBrowseState?.dramas || [],
              frontendVersion: appConfig.frontendVersion,
              handleVersionResponse: updateVersionStatusFromResponse,
              favoriteKeys: favoriteKeySet,
              favoriteActionsDisabled,
              statisticsActionsDisabled,
              onAddDramas: addDramas,
              onSelectionChange: updateSelection,
              onSetDramas: setDramas,
              onSetResults: setResults,
              onStartIdStatistics: startIdStatisticsConcurrent,
              onStartDramaPaidIdStatistics: startDramaPaidIdStatistics,
              onStartPlayCountStatistics: startPlayCountStatistics,
              onStartRevenueEstimate: startRevenueEstimate,
              onToggleFavorite: toggleFavorite,
              onAddCompareItem: addDramaToCompareBasket,
              canAddCompareItem: (item) => canAddDramaToCompareBasket({ ...item, platform: activeBrowsePlatform }),
              onRetryMetrics: retrySearchCardMetrics,
              onLoadMoreResults: () => loadMoreSearchResults(activeBrowsePlatform),
              allResults: getAllSearchResults(currentBrowseState),
              hasMoreResults: Boolean(currentBrowseState?.searchHasMore),
              isSearchPending: globalSearchPending,
              isLoadingMoreResults: Boolean(currentBrowseState?.isLoadingMoreResults),
              loadedResultCount: Number(currentBrowseState?.searchResults?.length ?? 0) || 0,
              platformTabs: visibleSearchCategories,
              activePlatform: activeSearchCategory,
              onPlatformChange: changeSearchCategory,
              cvResults: cvSearchState.results,
              onOpenCv: openCvProfile,
              platformResultCounts: searchResultCounts,
              platform: activeBrowsePlatform,
              resultSource: currentBrowseState?.searchResultSource || "search",
              results: currentBrowseState?.searchResults || [],
              selectedEpisodes: currentBrowseState?.selectedEpisodesSnapshot || [],
              totalResults: Number(currentBrowseState?.searchTotalMatched ?? 0) || 0,
            }}
            output={{
              currentAction: sharedStatsState?.currentAction,
              currentHistoryEntryId: sharedStatsState?.currentHistoryEntryId,
              elapsedMs: sharedStatsState?.elapsedMs,
              historyEntries: sharedHistoryEntries,
              idResults: sharedStatsState?.idResults,
              idSelectedEpisodeCount: sharedStatsState?.idSelectedEpisodeCount,
              isRunning: sharedStatsState?.isRunning,
              onCancelStatistics: cancelCurrentStatistics,
              onClearHistory: statsHistory.clearAllHistoryEntries,
              onDeleteHistoryEntry: (entry) => statsHistory.deleteHistoryEntry(entry.platform, entry.id),
              onReplayHistoryEntry: replayHistoryEntry,
              isReplayPreparing: replayPreparingEntryIds.length > 0,
              replayPreparingEntryIds,
              historyActionsDisabled,
              onCancelReplayPreparation: cancelCurrentStatistics,
              platform: sharedOutputPlatform,
              playCountFailed: sharedStatsState?.playCountFailed,
              playCountResults: sharedStatsState?.playCountResults,
              playCountSelectedEpisodeCount: sharedStatsState?.playCountSelectedEpisodeCount,
              playCountTotal: sharedStatsState?.playCountTotal,
              progress: sharedStatsState?.progress,
              revenueResults: sharedStatsState?.revenueResults,
              revenueSummary: sharedRevenueSummary,
              episodeDetails: sharedStatsState?.episodeDetails,
              totalDanmaku: sharedStatsState?.totalDanmaku,
              totalUsers: sharedStatsState?.totalUsers,
            }}
          />
        </Suspense>
      )}

      <BackgroundTaskCenter
        task={backgroundTask}
        isDesktopApp={appConfig.desktopApp}
        onOpenResults={openBackgroundTaskResult}
        onDismiss={() => setBackgroundTask(createIdleBackgroundTask())}
      />
      <DramaCompareBasket
        items={compareItems}
        open={compareBasketOpen}
        onOpenChange={setCompareBasketOpen}
        onOpenCompare={openCompareDialogFromBasket}
        onRemoveItem={removeDramaFromCompareBasket}
        onClear={clearCompareBasket}
      />
      <DramaCompareDialog
        open={compareDialogOpen}
        onOpenChange={setCompareDialogOpen}
        items={compareItems}
        frontendVersion={appConfig.frontendVersion}
        handleVersionResponse={updateVersionStatusFromResponse}
      />
      <MessageDialog notice={notice} onClose={() => setNotice(null)} />
      <ChangelogDialog
        open={changelogOpen}
        mode={changelogMode}
        onOpenChange={setChangelogOpen}
        onShowHistory={showChangelogHistory}
      />

      <AlertDialog
        open={Boolean(cancelFavoriteRequest)}
        onOpenChange={(open) => {
          if (!open) {
            setCancelFavoriteRequest(null);
          }
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia>
              <AlertTriangleIcon aria-hidden="true" className="size-5" />
            </AlertDialogMedia>
            <AlertDialogTitle>取消收藏</AlertDialogTitle>
            <AlertDialogDescription>
              会删除这部作品的收藏记录和历史统计数据，确认取消收藏吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>保留</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemoveFavorite}>取消收藏</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(searchJumpStatus)} onOpenChange={() => {}}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia>
              <RefreshCwIcon aria-hidden="true" className="size-5 animate-spin" />
            </AlertDialogMedia>
            <AlertDialogTitle>正在查询</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-wrap">
              {searchJumpStatus?.name
                ? `正在查询《${searchJumpStatus.name}》，稍后将跳转到搜索结果。`
                : "正在查询目标剧集，稍后将跳转到搜索结果。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </Sheet>
  );
}
