import { useEffect, useRef, useState } from "react";
import {
  RefreshCwIcon,
  AlertTriangleIcon,
  ChartNoAxesColumnIncreasingIcon,
  Clock3Icon,
  MessageSquarePlusIcon,
} from "lucide-react";
import { toast } from "sonner";

import { DesktopReportPanel } from "@/app/DesktopReportPanel";
import { MessageDialog } from "@/app/MessageDialog";
import { OngoingPanel } from "@/app/OngoingPanel";
import { OutputPanel } from "@/app/OutputPanel";
import { RanksPanel } from "@/app/RanksPanel";
import { SearchPanel } from "@/app/SearchPanel";
import { SearchResults } from "@/app/SearchResults";
import {
  buildRevenueSummary,
  buildUniqueUserIds,
  buildVersionedUrl,
  collectSelectedEpisodesFromDramas,
  createPlatformState,
  createRuntimeMeta,
  createStatsHistoryEntry,
  createStatsState,
  extractResponseItems,
  getBackendVersionFromResponse,
  getDefaultAppConfig,
  getRemainingCooldownHours,
  getSummaryRevenueMode,
  getSummaryRevenueTotals,
  isAbortError,
  loadPersistedHistoryEntries,
  mergeAppConfig,
  normalizeOptionalNumber,
  normalizeVersion,
  resolveRevenueSummaryForHistory,
  savePersistedHistoryEntries,
  selectDramaEpisodesByMode,
  STATS_HISTORY_LIMIT,
} from "@/app/app-utils";
import { PlatformTabLabel } from "@/app/platformTabLabel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isMemberEpisode, isPaidEpisode } from "../../shared/episodeRules.js";

const mainNavigationIconMap = {
  ongoing: Clock3Icon,
  ranks: ChartNoAxesColumnIncreasingIcon,
};

function MainNavigationTabLabel({ platform }) {
  if (platform.key === "missevan" || platform.key === "manbo") {
    return <PlatformTabLabel platform={platform.key} iconClassName="size-3.5 sm:size-4" />;
  }

  const Icon = mainNavigationIconMap[platform.key];
  return (
    <span className="inline-flex min-w-0 items-center justify-center gap-1.5">
      {Icon ? <Icon aria-hidden="true" className="size-3.5 shrink-0 sm:size-4" /> : null}
      <span className="min-w-0 truncate">{platform.label}</span>
    </span>
  );
}

export function ToolView({ initialAppConfig }) {
  const [currentPlatform, setCurrentPlatform] = useState("missevan");
  const [appConfig, setAppConfig] = useState({
    ...getDefaultAppConfig(),
    ...(initialAppConfig || {}),
  });
  const [platformStates, setPlatformStates] = useState(() => {
    const persistedHistory = loadPersistedHistoryEntries();
    return {
      missevan: {
        ...createPlatformState(),
        historyEntries: persistedHistory.missevan,
      },
      manbo: {
        ...createPlatformState(),
        historyEntries: persistedHistory.manbo,
      },
    };
  });
  const [notice, setNotice] = useState(null);
  const [searchJumpStatus, setSearchJumpStatus] = useState(null);

  const currentPlatformRef = useRef(currentPlatform);
  const appConfigRef = useRef(appConfig);
  const platformStatesRef = useRef(platformStates);
  const runtimeMetaRef = useRef({
    missevan: createRuntimeMeta(),
    manbo: createRuntimeMeta(),
  });
  const resultsPanelRef = useRef(null);
  const outputPanelRef = useRef(null);

  useEffect(() => {
    currentPlatformRef.current = currentPlatform;
  }, [currentPlatform]);

  useEffect(() => {
    appConfigRef.current = appConfig;
    if (typeof document !== "undefined") {
      document.title = appConfig.brandName;
    }
  }, [appConfig]);

  useEffect(() => {
    platformStatesRef.current = platformStates;
  }, [platformStates]);

  useEffect(() => {
    savePersistedHistoryEntries({
      missevan: platformStates.missevan?.historyEntries || [],
      manbo: platformStates.manbo?.historyEntries || [],
    });
  }, [platformStates.missevan?.historyEntries, platformStates.manbo?.historyEntries]);

  const visiblePlatforms = [
    { key: "missevan", label: "猫耳" },
    { key: "manbo", label: "漫播" },
    { key: "ongoing", label: "更新" },
    { key: "ranks", label: "榜单" },
    { key: "report", label: "Excel 报表" },
  ].filter((platform) => {
    if (platform.key === "report") {
      return appConfig.desktopApp;
    }
    return platform.key !== "missevan" || appConfig.missevanEnabled;
  });

  const currentBrowseState =
    currentPlatform === "report" || currentPlatform === "ranks" || currentPlatform === "ongoing"
      ? null
      : platformStates[currentPlatform];
  const currentStatsState = currentBrowseState?.stats || null;
  const currentRevenueSummary = currentStatsState?.revenueSummary || buildRevenueSummary(currentStatsState?.revenueResults || [], currentPlatform);
  const stepOneHint =
    currentPlatform === "missevan"
      ? appConfig.desktopApp
        ? "如果遇到接口受限，请使用任意浏览器打开猫耳首页按提示解锁即可。"
        : `如果猫耳接口暂时受限，请 ${getRemainingCooldownHours(
            {
              cooldownHours: appConfig.cooldownHours,
              cooldownUntil: appConfig.cooldownUntil,
            },
            appConfig.cooldownHours
          )} 小时后再来。`
      : "";

  function scrollToPanel(ref) {
    if (typeof window === "undefined") {
      return;
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        ref.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      });
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
          ?.scrollIntoView?.({ behavior: "smooth", block: "start" });
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

  async function loadAppConfig() {
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
      if (!merged.missevanEnabled && currentPlatformRef.current === "missevan") {
        setCurrentPlatform("manbo");
      }
      if (!merged.desktopApp && currentPlatformRef.current === "report") {
        setCurrentPlatform(merged.missevanEnabled ? "missevan" : "manbo");
      }
    } catch (_) {
      setAppConfig((current) => mergeAppConfig(current));
    }
  }

  function notifyTaskCancel(taskId) {
    if (!taskId) return;
    const url = `/stat-tasks/${taskId}/cancel`;
    try {
      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        navigator.sendBeacon(url, new Blob(["{}"], { type: "application/json" }));
        return;
      }
    } catch (_) {
    }
    fetch(url, { method: "POST", keepalive: true }).catch(() => {});
  }

  function notifyAllActiveStatsTaskCancels() {
    Object.values(platformStatesRef.current).forEach((state) => {
      if (state?.stats?.activeTaskId) {
        notifyTaskCancel(state.stats.activeTaskId);
      }
    });
  }

  useEffect(() => {
    loadAppConfig();
    const pageExitHandler = () => {
      notifyAllActiveStatsTaskCancels();
    };
    window.addEventListener("pagehide", pageExitHandler);
    window.addEventListener("beforeunload", pageExitHandler);
    return () => {
      Object.values(runtimeMetaRef.current).forEach((meta) => {
        meta.activeAbortController?.abort?.();
        if (meta.activeElapsedTimer) {
          clearInterval(meta.activeElapsedTimer);
          meta.activeElapsedTimer = null;
        }
      });
      window.removeEventListener("pagehide", pageExitHandler);
      window.removeEventListener("beforeunload", pageExitHandler);
    };
  }, []);

  function updatePlatformState(platform, updater) {
    setPlatformStates((current) => {
      const nextSlice = updater(current[platform]);
      return { ...current, [platform]: nextSlice };
    });
  }

  function updateSearchForm(patch) {
    updatePlatformState(currentPlatformRef.current, (state) => ({
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

  function resetSearchFlow(platform = currentPlatformRef.current) {
    updatePlatformState(platform, (state) => ({
      ...state,
      searchResultSource: "search",
      searchKeyword: "",
      searchNextOffset: 0,
      searchHasMore: false,
      searchCurrentPage: 1,
      searchPageSize: 5,
      searchTotalMatched: 0,
      searchPageCache: {},
      isLoadingMoreResults: false,
      searchResults: [],
      dramas: [],
      selectedEpisodesSnapshot: [],
    }));
  }

  function setSearchResults(platform, results, source = "search", meta = {}) {
    const normalizedResults = Array.isArray(results) ? results.map((item) => ({ ...item })) : [];
    const pageSize = Number(meta?.limit ?? normalizedResults.length ?? 5) || 5;
    const offset = Number(meta?.offset ?? 0) || 0;
    const page = source === "search" ? Math.floor(offset / Math.max(1, pageSize)) + 1 : 1;
    const totalMatched = source === "search" ? Number(meta?.matchedCount ?? meta?.totalMatched ?? normalizedResults.length) || 0 : 0;
    updatePlatformState(platform, (state) => ({
      ...state,
      searchResultSource: source === "manual" ? "manual" : "search",
      searchKeyword: source === "search" ? String(meta?.keyword ?? state.searchForm.keyword ?? "").trim() : "",
      searchNextOffset: source === "search" ? Number(meta?.nextOffset ?? normalizedResults.length) || 0 : 0,
      searchHasMore: source === "search" ? Boolean(meta?.hasMore) : false,
      searchCurrentPage: page,
      searchPageSize: Math.max(1, pageSize),
      searchTotalMatched: totalMatched,
      searchPageCache: source === "search" ? { [page]: normalizedResults } : {},
      isLoadingMoreResults: false,
      searchResults: normalizedResults,
    }));
    if (normalizedResults.length > 0) {
      scrollToPanel(resultsPanelRef);
    }
  }

  function setManualSearchResults(platform, results, meta = {}) {
    const normalizedResults = Array.isArray(results) ? results.map((item) => ({ ...item })) : [];
    updatePlatformState(platform, (state) => ({
      ...state,
      searchResultSource: "manual",
      searchKeyword: "",
      searchNextOffset: 0,
      searchHasMore: false,
      searchCurrentPage: 1,
      searchPageSize: Math.max(1, Number(meta?.limit ?? normalizedResults.length ?? 1) || 1),
      searchTotalMatched: 0,
      searchPageCache: {},
      isLoadingMoreResults: false,
      searchResults: normalizedResults,
      dramas: [],
      selectedEpisodesSnapshot: [],
    }));
    if (normalizedResults.length > 0 && meta?.scroll !== false) {
      scrollToPanel(resultsPanelRef);
    }
  }

  function setResults(nextResults) {
    updatePlatformState(currentPlatformRef.current, (state) => ({
      ...state,
      searchResults: nextResults,
      searchPageCache:
        state.searchResultSource === "search"
          ? {
              ...state.searchPageCache,
              [state.searchCurrentPage || 1]: nextResults,
            }
          : state.searchPageCache,
    }));
  }

  function setDramas(nextDramas) {
    updatePlatformState(currentPlatformRef.current, (state) => ({
      ...state,
      dramas: nextDramas,
    }));
  }

  function updateSelection(selectedEpisodes) {
    updatePlatformState(currentPlatformRef.current, (state) => ({
      ...state,
      selectedEpisodesSnapshot: selectedEpisodes,
    }));
  }

  function appendHistoryEntry(platform, entry, taskId = "") {
    if (!entry) {
      return "";
    }

    const meta = runtimeMetaRef.current[platform];
    const normalizedTaskId = String(taskId || "").trim();
    if (normalizedTaskId) {
      meta.completedHistoryTaskIds ||= new Set();
      if (meta.completedHistoryTaskIds.has(normalizedTaskId)) {
        return "";
      }
      meta.completedHistoryTaskIds.add(normalizedTaskId);
    }

    updatePlatformState(platform, (state) => {
      const nextEntries = [entry, ...(Array.isArray(state.historyEntries) ? state.historyEntries : [])];
      return {
        ...state,
        historyEntries: nextEntries.slice(0, STATS_HISTORY_LIMIT),
      };
    });

    return entry.id;
  }

  function recordCompletedStatsHistory(platform, taskType, taskId, snapshot) {
    const normalizedTaskId = String(taskId || snapshot?.taskId || "").trim();
    const result = snapshot?.result || {};
    const baseStats = platformStatesRef.current[platform]?.stats || createStatsState();
    const completedStats = {
      ...baseStats,
      activeTaskType: taskType,
      totalDanmaku: Number(snapshot?.totalDanmaku ?? baseStats.totalDanmaku ?? 0),
      totalUsers: Number(snapshot?.totalUsers ?? baseStats.totalUsers ?? 0),
      playCountResults: Array.isArray(result.playCountResults) ? result.playCountResults : baseStats.playCountResults,
      playCountSelectedEpisodeCount: Array.isArray(result.playCountResults)
        ? Number(result.playCountSelectedEpisodeCount ?? baseStats.playCountSelectedEpisodeCount ?? 0)
        : baseStats.playCountSelectedEpisodeCount,
      playCountTotal: Array.isArray(result.playCountResults) ? Number(result.playCountTotal ?? 0) : baseStats.playCountTotal,
      playCountFailed: Array.isArray(result.playCountResults) ? Boolean(result.playCountFailed) : baseStats.playCountFailed,
      idResults: Array.isArray(result.idResults) ? result.idResults : baseStats.idResults,
      idSelectedEpisodeCount: Array.isArray(result.idResults)
        ? Number(result.idSelectedEpisodeCount ?? baseStats.idSelectedEpisodeCount ?? 0)
        : baseStats.idSelectedEpisodeCount,
      revenueResults: Array.isArray(result.revenueResults) ? result.revenueResults : baseStats.revenueResults,
      revenueSummary: Array.isArray(result.revenueResults)
        ? resolveRevenueSummaryForHistory(result.revenueResults, platform, result.revenueSummary || null)
        : baseStats.revenueSummary,
    };

    const historyEntry = createStatsHistoryEntry(platform, completedStats, {
      taskType,
      createdAt: Date.now(),
    });
    const historyEntryId = appendHistoryEntry(platform, historyEntry, normalizedTaskId);
    if (historyEntryId) {
      updatePlatformState(platform, (state) => ({
        ...state,
        stats: {
          ...state.stats,
          currentHistoryEntryId: historyEntryId,
        },
      }));
    }
  }

  function deleteHistoryEntry(platform, entryId) {
    updatePlatformState(platform, (state) => ({
      ...state,
      historyEntries: (Array.isArray(state.historyEntries) ? state.historyEntries : []).filter((entry) => entry.id !== entryId),
    }));
  }

  function clearHistoryEntries(platform) {
    updatePlatformState(platform, (state) => ({
      ...state,
      historyEntries: [],
    }));
  }

  function getAllSearchResults(state) {
    if (state?.searchResultSource !== "search") {
      return state?.searchResults || [];
    }
    const pageCache = state?.searchPageCache || {};
    const merged = new Map();
    Object.keys(pageCache)
      .map((key) => Number(key))
      .filter((key) => Number.isFinite(key))
      .sort((left, right) => left - right)
      .forEach((page) => {
        (Array.isArray(pageCache[page]) ? pageCache[page] : []).forEach((item) => {
          merged.set(String(item.id), item);
        });
      });
    return Array.from(merged.values());
  }

  function updateSearchPage(platform, page, results, meta = {}) {
    const normalizedResults = Array.isArray(results) ? results.map((item) => ({ ...item })) : [];
    updatePlatformState(platform, (state) => ({
      ...state,
      searchNextOffset: Number(meta?.nextOffset ?? state.searchNextOffset) || 0,
      searchHasMore: Boolean(meta?.hasMore),
      searchCurrentPage: page,
      searchPageSize: Number(meta?.limit ?? state.searchPageSize ?? 5) || 5,
      searchTotalMatched: Number(meta?.matchedCount ?? meta?.totalMatched ?? state.searchTotalMatched ?? normalizedResults.length) || 0,
      searchPageCache: {
        ...state.searchPageCache,
        [page]: normalizedResults.map((item) => {
          const previous = (state.searchPageCache?.[page] || []).find((cached) => String(cached.id) === String(item.id));
          return {
            ...item,
            checked: previous?.checked ?? item.checked,
          };
        }),
      },
      isLoadingMoreResults: false,
      searchResults: normalizedResults.map((item) => {
        const previous = (state.searchPageCache?.[page] || []).find((cached) => String(cached.id) === String(item.id));
        return {
          ...item,
          checked: previous?.checked ?? item.checked,
        };
      }),
    }));
  }

  function mergeSearchResults(existingResults = [], incomingResults = []) {
    const existingById = new Map(existingResults.map((item) => [String(item.id), item]));
    const mergedById = new Map();
    existingResults.forEach((item) => {
      mergedById.set(String(item.id), item);
    });
    incomingResults.forEach((item) => {
      const previous = existingById.get(String(item.id));
      mergedById.set(String(item.id), {
        ...item,
        checked: previous?.checked ?? item.checked,
      });
    });
    return Array.from(mergedById.values());
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

  async function openDramaInSearch({ platform, id, name, paymentLabel, contentTypeLabel, usageAction }) {
    const targetPlatform = platform === "manbo" ? "manbo" : "missevan";
    const dramaId = String(id ?? "").trim();
    const dramaName = String(name ?? "").trim();
    const normalizedUsageAction = ["ranks_open_search_result", "ongoing_open_search_result"].includes(String(usageAction ?? "").trim())
      ? String(usageAction).trim()
      : "";
    if (!dramaId) {
      toast.error("打开搜索结果失败，请稍后重试。");
      return;
    }

    if (targetPlatform === "missevan" && !appConfigRef.current.desktopApp && Number(appConfigRef.current.cooldownUntil ?? 0) > Date.now()) {
      updatePlatformState("missevan", (state) => ({
        ...state,
        stats: {
          ...state.stats,
          currentAction: getCooldownMessage(),
        },
      }));
      toast.error("打开搜索结果失败，请稍后重试。");
      return;
    }

    setSearchJumpStatus({
      platform: targetPlatform,
      name: dramaName,
    });

    try {
      const endpoint = targetPlatform === "manbo" ? "/manbo/getdramacards" : "/getdramacards";
      const body = targetPlatform === "manbo"
        ? { items: [{ raw: dramaId }], ...(normalizedUsageAction ? { usageAction: normalizedUsageAction } : {}) }
        : { drama_ids: [dramaId], ...(normalizedUsageAction ? { usageAction: normalizedUsageAction } : {}) };
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
              currentAction: appConfigRef.current.desktopApp ? "访问受限，请先打开猫耳主页验证" : getCooldownMessage(),
            },
          }));
        }
        toast.error("打开搜索结果失败，请稍后重试。");
        return;
      }

      updatePlatformState(targetPlatform, (state) => ({
        ...state,
        searchForm: {
          ...state.searchForm,
          keyword: String(name ?? "").trim(),
          manualInput: dramaId,
        },
      }));
      setManualSearchResults(targetPlatform, results, { limit: 1, scroll: false });
      setCurrentPlatform(targetPlatform);
      scrollToPanel(resultsPanelRef);
    } catch (error) {
      console.error("Failed to open drama in search", error);
      toast.error("打开搜索结果失败，请稍后重试。");
    } finally {
      setSearchJumpStatus(null);
    }
  }

  async function loadSearchPage(page, platform = currentPlatformRef.current) {
    const state = platformStatesRef.current[platform];
    const keyword = String(state?.searchKeyword ?? "").trim();
    const pageSize = Number(state?.searchPageSize ?? 5) || 5;
    const safePage = Math.max(1, Number(page ?? 1) || 1);
    const cachedPage = state?.searchPageCache?.[safePage];
    if (!keyword || state?.searchResultSource === "manual" || state?.isLoadingMoreResults) {
      return;
    }
    if (Array.isArray(cachedPage)) {
      updatePlatformState(platform, (current) => ({
        ...current,
        searchCurrentPage: safePage,
        searchResults: cachedPage,
      }));
      scrollToPanel(resultsPanelRef);
      return;
    }

    updatePlatformState(platform, (current) => ({
      ...current,
      isLoadingMoreResults: true,
    }));

    try {
      const offset = (safePage - 1) * pageSize;
      const endpoint =
        platform === "manbo"
          ? `/manbo/search?keyword=${encodeURIComponent(keyword)}&offset=${offset}&limit=${pageSize}`
          : `/search?keyword=${encodeURIComponent(keyword)}&offset=${offset}&limit=${pageSize}`;
      const response = await fetch(buildVersionedUrl(endpoint, appConfigRef.current.frontendVersion), {
        cache: "no-store",
      });
      const data = await parseVersionedJsonResponse(response);

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

      updateSearchPage(platform, safePage, data.results || [], data.meta || {});
      scrollToPanel(resultsPanelRef);
    } catch (error) {
      console.error("Failed to load search page", error);
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

  function beginRun(platform) {
    const meta = runtimeMetaRef.current[platform];
    meta.activeRunId += 1;
    meta.activeAbortController = new AbortController();
    if (meta.activeElapsedTimer) {
      clearInterval(meta.activeElapsedTimer);
    }
    const startedAt = Date.now();
    updatePlatformState(platform, (state) => ({
      ...state,
      stats: {
        ...state.stats,
        isRunning: true,
        startedAt,
        elapsedMs: 0,
      },
    }));
    meta.activeElapsedTimer = setInterval(() => {
      updatePlatformState(platform, (state) => ({
        ...state,
        stats: state.stats.isRunning
          ? {
              ...state.stats,
              elapsedMs: Date.now() - startedAt,
            }
          : state.stats,
      }));
    }, 1000);
    return {
      runId: meta.activeRunId,
      signal: meta.activeAbortController.signal,
    };
  }

  function cancelPollingRun(platform) {
    const meta = runtimeMetaRef.current[platform];
    const taskId = platformStatesRef.current[platform]?.stats?.activeTaskId || "";
    meta.activeAbortController?.abort?.();
    meta.activeAbortController = null;
    if (meta.activeElapsedTimer) {
      clearInterval(meta.activeElapsedTimer);
      meta.activeElapsedTimer = null;
    }
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
    return taskId;
  }

  async function cancelActiveRun(platform = currentPlatformRef.current) {
    const taskId = cancelPollingRun(platform);
    if (taskId) {
      notifyTaskCancel(taskId);
    }
  }

  function finishRun(platform, runId) {
    const meta = runtimeMetaRef.current[platform];
    if (runId !== meta.activeRunId) {
      return;
    }
    if (meta.activeElapsedTimer) {
      clearInterval(meta.activeElapsedTimer);
      meta.activeElapsedTimer = null;
    }
    meta.activeAbortController = null;
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
  }

  function isRunActive(platform, runId) {
    return platformStatesRef.current[platform]?.stats?.isRunning && runtimeMetaRef.current[platform].activeRunId === runId;
  }

  async function postJson(url, payload, signal, errorMessage) {
    const response = await fetch(buildVersionedUrl(url, appConfigRef.current.frontendVersion), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    if (!response.ok) {
      throw new Error(`${errorMessage}: ${response.status}`);
    }
    const data = await response.json();
    updateVersionStatusFromResponse({
      backendVersion: getBackendVersionFromResponse(response, data),
      frontendVersion: appConfigRef.current.frontendVersion,
    });
    return data;
  }

  async function getJson(url, signal, errorMessage) {
    const response = await fetch(buildVersionedUrl(url, appConfigRef.current.frontendVersion), {
      signal,
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`${errorMessage}: ${response.status}`);
    }
    const data = await response.json();
    updateVersionStatusFromResponse({
      backendVersion: getBackendVersionFromResponse(response, data),
      frontendVersion: appConfigRef.current.frontendVersion,
    });
    return data;
  }

  function buildTaskSnapshotUrl(taskId) {
    return `/stat-tasks/${String(taskId ?? "").trim()}?_ts=${Date.now()}`;
  }

  async function waitForTaskPoll(signal, delayMs = 2000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, delayMs);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true }
      );
    });
  }

  function applyTaskSnapshot(platform, snapshot) {
    updatePlatformState(platform, (state) => {
      const result = snapshot?.result || {};
      return {
        ...state,
        stats: {
          ...state.stats,
          progress: Number(snapshot?.progress ?? 0),
          currentAction: snapshot?.currentAction || "统计中",
          totalDanmaku: Number(snapshot?.totalDanmaku ?? state.stats.totalDanmaku ?? 0),
          totalUsers: Number(snapshot?.totalUsers ?? state.stats.totalUsers ?? 0),
          playCountResults: Array.isArray(result.playCountResults) ? result.playCountResults : state.stats.playCountResults,
          playCountSelectedEpisodeCount: Array.isArray(result.playCountResults)
            ? Number(result.playCountSelectedEpisodeCount ?? state.stats.playCountSelectedEpisodeCount ?? 0)
            : state.stats.playCountSelectedEpisodeCount,
          playCountTotal: Array.isArray(result.playCountResults) ? Number(result.playCountTotal ?? 0) : state.stats.playCountTotal,
          playCountFailed: Array.isArray(result.playCountResults) ? Boolean(result.playCountFailed) : state.stats.playCountFailed,
          idResults: Array.isArray(result.idResults) ? result.idResults : state.stats.idResults,
          suspectedOverflowEpisodes: Array.isArray(result.idResults)
            ? Array.isArray(result.suspectedOverflowEpisodes)
              ? result.suspectedOverflowEpisodes
              : []
            : Array.isArray(result.revenueResults)
              ? Array.isArray(result.revenueSummary?.suspectedOverflowEpisodes)
                ? result.revenueSummary.suspectedOverflowEpisodes
                : []
              : state.stats.suspectedOverflowEpisodes,
          idSelectedEpisodeCount: Array.isArray(result.idResults)
            ? Number(result.idSelectedEpisodeCount ?? state.stats.idSelectedEpisodeCount ?? 0)
            : state.stats.idSelectedEpisodeCount,
          revenueResults: Array.isArray(result.revenueResults) ? result.revenueResults : state.stats.revenueResults,
          revenueSummary: Array.isArray(result.revenueResults) ? result.revenueSummary || null : state.stats.revenueSummary,
        },
      };
    });
  }

  async function startStatsTask(platform, taskType, payload, runId, signal) {
    const task = await postJson(
      "/stat-tasks",
      {
        platform,
        taskType,
        ...payload,
      },
      signal,
      "Failed to create stats task"
    );
    if (!isRunActive(platform, runId)) {
      return;
    }
    const taskId = String(task.taskId ?? "").trim();
    const resolvedTaskType = task.taskType || taskType;
    updatePlatformState(platform, (state) => ({
      ...state,
      stats: {
        ...state.stats,
        activeTaskId: taskId,
        activeTaskType: resolvedTaskType,
      },
    }));
    applyTaskSnapshot(platform, task);
    if (!taskId) {
      throw new Error("Stats task missing taskId");
    }

    const initialSnapshot = await getJson(buildTaskSnapshotUrl(taskId), signal, "Failed to fetch stats task");
    if (!isRunActive(platform, runId)) {
      return;
    }
    applyTaskSnapshot(platform, initialSnapshot);
    if (initialSnapshot.status === "completed" || initialSnapshot.status === "cancelled") {
      if (initialSnapshot.status === "completed") {
        recordCompletedStatsHistory(platform, resolvedTaskType, taskId, initialSnapshot);
      }
      return;
    }
    if (initialSnapshot.status === "failed") {
      throw new Error(initialSnapshot.error || "Stats task failed");
    }

    while (isRunActive(platform, runId) && platformStatesRef.current[platform]?.stats?.activeTaskId === taskId) {
      await waitForTaskPoll(signal);
      const snapshot = await getJson(buildTaskSnapshotUrl(taskId), signal, "Failed to fetch stats task");
      if (!isRunActive(platform, runId)) {
        return;
      }
      applyTaskSnapshot(platform, snapshot);
      if (snapshot.status === "completed" || snapshot.status === "cancelled") {
        if (snapshot.status === "completed") {
          recordCompletedStatsHistory(platform, resolvedTaskType, taskId, snapshot);
        }
        return;
      }
      if (snapshot.status === "failed") {
        throw new Error(snapshot.error || "Stats task failed");
      }
    }
  }

  async function refreshCooldownState() {
    if (!appConfigRef.current.desktopApp) {
      await loadAppConfig();
    }
  }

  function getCooldownMessage() {
    const remainingMs = Math.max(0, Number(appConfigRef.current.cooldownUntil ?? 0) - Date.now());
    const remainingHours =
      remainingMs > 0 ? Math.ceil((remainingMs / (60 * 60 * 1000)) * 10) / 10 : Number(appConfigRef.current.cooldownHours ?? 4);
    return `请 ${remainingHours} 小时后再来。`;
  }

  async function showMissevanAccessHint() {
    if (currentPlatformRef.current !== "missevan") return;
    if (!appConfigRef.current.desktopApp) {
      await refreshCooldownState();
    }
    const message = appConfigRef.current.desktopApp
      ? "如果遇到接口受限，请使用任意浏览器打开猫耳首页按提示解锁即可。"
      : getCooldownMessage();
    updatePlatformState("missevan", (state) => ({
      ...state,
      stats: {
        ...state.stats,
        currentAction: appConfigRef.current.desktopApp ? "访问受限，请先打开猫耳主页验证" : message,
      },
    }));
    setNotice({
      title: "Missevan 当前受限",
      description: message,
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

  async function fetchDramaById(platform, dramaId, signal) {
    const loaded = getLoadedDramaById(platform, dramaId);
    if (loaded) {
      return loaded;
    }
    const searchResult = getSearchResultById(platform, dramaId);
    const payload = { drama_ids: [dramaId] };
    if (platform === "missevan") {
      const soundIdMap = {};
      if (Number(searchResult?.sound_id) > 0) {
        soundIdMap[dramaId] = Number(searchResult.sound_id);
      }
      payload.sound_id_map = soundIdMap;
    }
    const data = await postJson(getDramasEndpoint(platform), payload, signal, "Failed to load drama");
    const result = extractResponseItems(data)[0];
    if (!result?.success) {
      const error = new Error(`Failed to load drama: ${dramaId}`);
      error.accessDenied = Boolean(result?.accessDenied);
      throw error;
    }
    return {
      ...result.info,
      expanded: false,
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

  async function registerFallbackMissevanDramaIds(platform, ids) {
    if (platform !== "missevan") {
      return;
    }

    const fallbackIds = getSearchResultsByIds(platform, ids)
      .filter((item) => item?.search_source === "missevan_api")
      .map((item) => item.id);
    if (!fallbackIds.length) {
      return;
    }

    try {
      await postJson(
        "/register-new-drama-ids",
        { platform: "missevan", drama_ids: fallbackIds },
        undefined,
        "Failed to register new drama ids"
      );
    } catch (error) {
      console.error("Failed to register fallback Missevan drama ids", error);
    }
  }

  async function addDramas(ids, options = {}) {
    const platform = currentPlatformRef.current;
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
      await registerFallbackMissevanDramaIds(platform, ids);

      for (let index = 0; index < ids.length; index += 1) {
        const id = String(ids[index]);
        if (existingDramaMap.has(id)) {
          continue;
        }
        try {
          const drama = {
            ...(await fetchDramaById(platform, id)),
            expanded: shouldExpandImported,
          };
          mergedDramas.push(drama);
          existingDramaMap.set(id, drama);
          importedIdSet.add(id);
        } catch (error) {
          if (error?.accessDenied) {
            hasAccessDenied = true;
          }
          console.error(`Failed to import drama ${id}`, error);
        }
      }

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

  async function loadMoreSearchResults(platform = currentPlatformRef.current) {
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
      const endpoint =
        platform === "manbo"
          ? `/manbo/search?keyword=${encodeURIComponent(keyword)}&offset=${offset}&limit=${pageSize}`
          : `/search?keyword=${encodeURIComponent(keyword)}&offset=${offset}&limit=${pageSize}`;
      const response = await fetch(buildVersionedUrl(endpoint, appConfigRef.current.frontendVersion), {
        cache: "no-store",
      });
      const data = await parseVersionedJsonResponse(response);

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

      updatePlatformState(platform, (current) => {
        const mergedResults = mergeSearchResults(current.searchResults || [], incomingResults);
        return {
          ...current,
          searchNextOffset: nextOffset,
          searchHasMore: Boolean(data.meta?.hasMore) && (!totalMatched || mergedResults.length < totalMatched),
          searchCurrentPage: page,
          searchPageSize: pageSize,
          searchTotalMatched: totalMatched,
          searchPageCache: {
            ...current.searchPageCache,
            [page]: incomingResults.map((item) => {
              const previous = (current.searchResults || []).find((cached) => String(cached.id) === String(item.id));
              return {
                ...item,
                checked: previous?.checked ?? item.checked,
              };
            }),
          },
          isLoadingMoreResults: false,
          searchResults: mergedResults,
        };
      });
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

  async function startPlayCountStatistics(soundIds) {
    const platform = currentPlatformRef.current;
    const selectedEpisodes = platformStatesRef.current[platform].selectedEpisodesSnapshot.filter((episode) =>
      soundIds.includes(episode.sound_id)
    );
    await cancelActiveRun(platform);
    resetOutputs(platform);
    const { runId, signal } = beginRun(platform);
    if (!selectedEpisodes.length) {
      toast.warning("请先选择分集。");
      finishRun(platform, runId);
      return;
    }
    updatePlatformState(platform, (state) => ({
      ...state,
      stats: {
        ...state.stats,
        currentAction: "开始统计播放量",
        playCountSelectedEpisodeCount: selectedEpisodes.length,
      },
    }));
    scrollToPanel(outputPanelRef);
    try {
      await startStatsTask(platform, "play_count", { episodes: selectedEpisodes }, runId, signal);
      scrollToPanel(outputPanelRef);
    } catch (error) {
      if (!isAbortError(error)) {
        updatePlatformState(platform, (state) => ({
          ...state,
          stats: {
            ...state.stats,
            currentAction: "统计失败",
          },
        }));
      }
    } finally {
      finishRun(platform, runId);
    }
  }

  async function startIdStatisticsForEpisodes(selectedEpisodes, emptyMessage = "请先选择分集。") {
    const platform = currentPlatformRef.current;
    await cancelActiveRun(platform);
    resetOutputs(platform);
    const { runId, signal } = beginRun(platform);
    if (!selectedEpisodes.length) {
      toast.warning(emptyMessage);
      finishRun(platform, runId);
      return;
    }
    updatePlatformState(platform, (state) => ({
      ...state,
      stats: {
        ...state.stats,
        currentAction: "开始统计弹幕与去重 ID",
        idSelectedEpisodeCount: selectedEpisodes.length,
      },
    }));
    scrollToPanel(outputPanelRef);
    try {
      await startStatsTask(platform, "id", { episodes: selectedEpisodes }, runId, signal);
      scrollToPanel(outputPanelRef);
    } catch (error) {
      if (!isAbortError(error)) {
        updatePlatformState(platform, (state) => ({
          ...state,
          stats: {
            ...state.stats,
            currentAction: "统计失败",
          },
        }));
      }
    } finally {
      finishRun(platform, runId);
    }
  }

  async function startIdStatisticsConcurrent(soundIds) {
    const platform = currentPlatformRef.current;
    const selectedEpisodes = platformStatesRef.current[platform].selectedEpisodesSnapshot.filter((episode) =>
      soundIds.includes(episode.sound_id)
    );
    await startIdStatisticsForEpisodes(selectedEpisodes);
  }

  async function startDramaPaidIdStatistics(dramaId) {
    const normalizedDramaId = String(dramaId ?? "").trim();
    if (!normalizedDramaId) {
      toast.warning("请先选择作品。");
      return;
    }
    const platform = currentPlatformRef.current;
    const importResult = await addDramas([dramaId], {
      autoCheck: true,
      expandImported: true,
      preserveScroll: true,
      selectMode: "paid",
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
    await startIdStatisticsForEpisodes(selectedPaidEpisodes, "没有可统计的付费分集。");
  }

  async function startRevenueEstimate(dramaIds) {
    if (!dramaIds?.length) {
      toast.warning("请先选择作品。");
      return;
    }
    const platform = currentPlatformRef.current;
    await cancelActiveRun(platform);
    resetOutputs(platform);
    const { runId, signal } = beginRun(platform);
    updatePlatformState(platform, (state) => ({
      ...state,
      stats: {
        ...state.stats,
        currentAction: "开始最低收益预估",
      },
    }));
    scrollToPanel(outputPanelRef);
    try {
      await registerFallbackMissevanDramaIds(platform, dramaIds);
      await startStatsTask(platform, "revenue", { dramaIds }, runId, signal);
      scrollToPanel(outputPanelRef);
    } catch (error) {
      if (!isAbortError(error)) {
        updatePlatformState(platform, (state) => ({
          ...state,
          stats: {
            ...state.stats,
            currentAction: "统计失败",
          },
        }));
      }
    } finally {
      finishRun(platform, runId);
    }
  }

  async function cancelCurrentStatistics() {
    const platform = currentPlatformRef.current;
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

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 px-3 pb-24 pt-3 sm:px-5 sm:pb-8 lg:gap-5 lg:px-6">
      <header className="-mx-3 border-b border-border/75 bg-background/92 px-3 py-3 backdrop-blur-xl sm:-mx-5 sm:px-5 lg:sticky lg:top-0 lg:z-20 lg:-mx-6 lg:px-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-primary">{appConfig.brandName}</div>
                  <Badge variant="coral" className="h-5 px-2 text-[0.68rem]">
                    v{appConfig.frontendVersion}
                  </Badge>
                </div>
                {appConfig.featureSuggestionUrl ? (
                  <Button variant="outline" size="xs" className="sm:hidden" asChild>
                    <a href={appConfig.featureSuggestionUrl} rel="noreferrer" target="_blank">
                      <MessageSquarePlusIcon data-icon="inline-start" />
                      功能建议
                    </a>
                  </Button>
                ) : null}
              </div>
              <div className="mt-1 flex flex-col gap-1 sm:flex-row sm:items-end sm:gap-3">
                <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{appConfig.titleZh}</h1>
                <p className="line-clamp-2 max-w-3xl text-xs leading-5 text-muted-foreground sm:text-sm">{appConfig.description}</p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              {appConfig.featureSuggestionUrl ? (
                <Button variant="outline" size="sm" className="hidden sm:inline-flex" asChild>
                  <a href={appConfig.featureSuggestionUrl} rel="noreferrer" target="_blank">
                    <MessageSquarePlusIcon data-icon="inline-start" />
                    功能建议
                  </a>
                </Button>
              ) : null}
              <Tabs value={currentPlatform} onValueChange={setCurrentPlatform}>
                <TabsList
                  className="grid h-9 w-full overflow-hidden p-0.5 sm:inline-flex sm:w-fit"
                  style={{ gridTemplateColumns: `repeat(${visiblePlatforms.length}, minmax(0, 1fr))` }}
                >
                  {visiblePlatforms.map((platform) => (
                    <TabsTrigger key={platform.key} className="h-[30px] px-1.5 text-[13px] sm:px-3 sm:text-sm" value={platform.key}>
                      <MainNavigationTabLabel platform={platform} />
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          </div>

          {appConfig.versionMismatch ? (
            <Alert className="border-destructive/30 bg-destructive/10">
              <AlertTriangleIcon className="size-4" />
              <AlertTitle>工具版本已更新</AlertTitle>
              <AlertDescription>
                工具已更新，请刷新或重新打开页面。若还看到此提醒，请清理缓存后再重试。
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      </header>

      {currentPlatform === "ranks" ? (
        <RanksPanel
          frontendVersion={appConfig.frontendVersion}
          handleVersionResponse={updateVersionStatusFromResponse}
          onOpenSearchResult={openDramaInSearch}
        />
      ) : currentPlatform === "ongoing" ? (
        <OngoingPanel
          frontendVersion={appConfig.frontendVersion}
          handleVersionResponse={updateVersionStatusFromResponse}
          onOpenSearchResult={openDramaInSearch}
        />
      ) : currentPlatform !== "report" ? (
        <div className="grid gap-4 sm:gap-5">
          {currentPlatform === "missevan" ? (
            <div className="px-1 text-sm leading-6 text-muted-foreground">
              {appConfig.desktopApp ? (
                stepOneHint
              ) : (
                <>
                  {stepOneHint} 也可前往
                  {" "}
                  <a className="font-medium text-primary underline underline-offset-4" href="/nodes">
                    节点页
                  </a>
                  {" "}选择其他节点，或直接使用
                  {appConfig.desktopAppUrl ? (
                    <>
                      <a className="font-medium text-primary underline underline-offset-4" href={appConfig.desktopAppUrl} rel="noreferrer" target="_blank">
                        桌面版
                      </a>
                      。
                    </>
                  ) : "桌面版。"}
                </>
              )}
            </div>
          ) : null}

          <SearchPanel
            cooldownHours={appConfig.cooldownHours}
            cooldownUntil={appConfig.cooldownUntil}
            desktopAppUrl={appConfig.desktopAppUrl}
            formState={currentBrowseState?.searchForm}
            frontendVersion={appConfig.frontendVersion}
            handleVersionResponse={updateVersionStatusFromResponse}
            isDesktopApp={appConfig.desktopApp}
            onNotice={setNotice}
            onResetState={() => resetSearchFlow(currentPlatform)}
            onUpdateFormState={updateSearchForm}
            onUpdateResults={(results, source, meta) => setSearchResults(currentPlatform, results, source, meta)}
            platform={currentPlatform}
          />

          <section ref={resultsPanelRef} className="grid gap-3">
            <SearchResults
              dramas={currentBrowseState?.dramas || []}
              frontendVersion={appConfig.frontendVersion}
              handleVersionResponse={updateVersionStatusFromResponse}
              onAddDramas={addDramas}
              onSelectionChange={updateSelection}
              onSetDramas={setDramas}
              onSetResults={setResults}
              onStartIdStatistics={startIdStatisticsConcurrent}
              onStartDramaPaidIdStatistics={startDramaPaidIdStatistics}
              onStartPlayCountStatistics={startPlayCountStatistics}
              onStartRevenueEstimate={startRevenueEstimate}
              onLoadMoreResults={() => loadMoreSearchResults(currentPlatform)}
              allResults={getAllSearchResults(currentBrowseState)}
              hasMoreResults={Boolean(currentBrowseState?.searchHasMore)}
              isLoadingMoreResults={Boolean(currentBrowseState?.isLoadingMoreResults)}
              loadedResultCount={Number(currentBrowseState?.searchResults?.length ?? 0) || 0}
              platform={currentPlatform}
              resultSource={currentBrowseState?.searchResultSource || "search"}
              results={currentBrowseState?.searchResults || []}
              selectedEpisodes={currentBrowseState?.selectedEpisodesSnapshot || []}
              totalResults={Number(currentBrowseState?.searchTotalMatched ?? 0) || 0}
            />
          </section>

          <section ref={outputPanelRef} className="grid gap-3">
            <OutputPanel
              currentAction={currentStatsState?.currentAction}
              currentHistoryEntryId={currentStatsState?.currentHistoryEntryId}
              elapsedMs={currentStatsState?.elapsedMs}
              historyEntries={currentBrowseState?.historyEntries || []}
              idResults={currentStatsState?.idResults}
              idSelectedEpisodeCount={currentStatsState?.idSelectedEpisodeCount}
              isRunning={currentStatsState?.isRunning}
              onCancelStatistics={cancelCurrentStatistics}
              onClearHistory={() => clearHistoryEntries(currentPlatform)}
              onDeleteHistoryEntry={(entryId) => deleteHistoryEntry(currentPlatform, entryId)}
              platform={currentPlatform}
              playCountFailed={currentStatsState?.playCountFailed}
              playCountResults={currentStatsState?.playCountResults}
              playCountSelectedEpisodeCount={currentStatsState?.playCountSelectedEpisodeCount}
              playCountTotal={currentStatsState?.playCountTotal}
              progress={currentStatsState?.progress}
              revenueResults={currentStatsState?.revenueResults}
              revenueSummary={currentRevenueSummary}
              suspectedOverflowEpisodes={currentStatsState?.suspectedOverflowEpisodes}
              totalDanmaku={currentStatsState?.totalDanmaku}
              totalUsers={currentStatsState?.totalUsers}
            />
          </section>
        </div>
      ) : (
        <DesktopReportPanel handleVersionResponse={updateVersionStatusFromResponse} />
      )}

      <MessageDialog notice={notice} onClose={() => setNotice(null)} />

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
  );
}
