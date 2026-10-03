import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AppIcon } from "@/app/AppIcon";
import { MessageDialog } from "@/app/MessageDialog";
import { SearchPanel } from "@/app/SearchPanel";
import { SearchWorkspace } from "@/app/SearchWorkspace";
import {
  appendSearchResultsPage,
  getAllSearchResults,
  getSearchResultCount,
  resetSearchResultsState,
  setManualSearchResultsState,
  setSearchResultsState,
  setVisibleSearchResults,
} from "@/app/searchResultsState";
import {
  buildPlayCountDramasFromDramas,
  buildVersionedUrl,
  collectSelectedEpisodesFromDramas,
  createPlatformState,
  createRuntimeMeta,
  createStatsState,
  extractResponseItems,
  getBackendVersionFromResponse,
  getDefaultAppConfig,
  isAbortError,
  selectDramaEpisodesByMode,
} from "@/app/app-utils";
import {
  cancelStatsTask,
  createStatsTask,
  getStatsTaskSnapshotWithRetry,
  notifyStatsTaskCancel,
} from "@/app/statsTaskClient";
import { useStatsTaskRun } from "@/app/useStatsTaskRun";
import { useToolNavigation } from "@/app/useToolNavigation";
import { useSearchCardMetrics } from "@/app/useSearchCardMetrics";
import { canParseShareUrl, decryptShareUrl, extractResolvedId } from "@/utils/manboCrypto";
import { isMemberEpisode, isPaidEpisode } from "../../shared/episodeRules.js";

const searchPlatforms = [
  { key: "missevan", label: "猫耳" },
  { key: "manbo", label: "漫播" },
];

function makeDesktopPlatformState() {
  const { historyEntries: _historyEntries, ...state } = createPlatformState();
  return state;
}

function createInitialDesktopStates() {
  return {
    missevan: makeDesktopPlatformState(),
    manbo: makeDesktopPlatformState(),
  };
}

function cloneDrama(drama) {
  return {
    ...drama,
    drama: { ...(drama?.drama || {}) },
    episodes: {
      ...(drama?.episodes || {}),
      episode: Array.isArray(drama?.episodes?.episode)
        ? drama.episodes.episode.map((episode) => ({ ...episode }))
        : [],
    },
  };
}

function normalizeFetchedDrama(result, expand = false) {
  return {
    ...result.info,
    expanded: expand,
    episodes: {
      ...(result.info?.episodes || {}),
      episode: Array.isArray(result.info?.episodes?.episode)
        ? result.info.episodes.episode.map((episode) => ({ ...episode, selected: false }))
        : [],
    },
  };
}

function createEmptyStats() {
  return {
    ...createStatsState(),
    currentAction: "",
  };
}

export function DesktopStatisticsView({ initialAppConfig }) {
  const [appConfig, setAppConfig] = useState(() => ({
    ...getDefaultAppConfig(),
    ...(initialAppConfig || {}),
    desktopApp: true,
    missevanEnabled: true,
    feedbackEnabled: false,
  }));
  const navigation = useToolNavigation({
    initialAppConfig: { ...initialAppConfig, desktopApp: true, missevanEnabled: true },
    appConfig,
  });
  const [platformStates, setPlatformStates] = useState(createInitialDesktopStates);
  const [activePlatform, setActivePlatform] = useState(() => navigation.initialToolRouteState.platform);
  const [searchForm, setSearchForm] = useState(() => ({ keyword: navigation.initialToolRouteState.q, manualInput: "" }));
  const [searchPending, setSearchPending] = useState(false);
  const [notice, setNotice] = useState(null);
  const platformStatesRef = useRef(platformStates);
  const appConfigRef = useRef(appConfig);
  const activePlatformRef = useRef(activePlatform);
  const runtimeMetaRef = useRef({ missevan: createRuntimeMeta(), manbo: createRuntimeMeta() });
  const searchGenerationRef = useRef(0);

  useEffect(() => {
    platformStatesRef.current = platformStates;
  }, [platformStates]);

  useEffect(() => {
    appConfigRef.current = appConfig;
  }, [appConfig]);

  useEffect(() => {
    activePlatformRef.current = activePlatform;
  }, [activePlatform]);

  useEffect(() => {
    setActivePlatform(navigation.toolRouteState.platform);
    setSearchForm((current) => current.keyword === navigation.toolRouteState.q
      ? current
      : { ...current, keyword: navigation.toolRouteState.q });
  }, [navigation.toolRouteState.platform, navigation.toolRouteState.q]);

  function updatePlatformState(platform, updater) {
    setPlatformStates((current) => {
      const next = { ...current, [platform]: updater(current[platform]) };
      platformStatesRef.current = next;
      return next;
    });
  }

  function updateVersionStatus(response, data) {
    setAppConfig((current) => ({
      ...current,
      backendVersion: getBackendVersionFromResponse(response, data),
    }));
  }

  function applyTaskSnapshot(platform, snapshot) {
    const result = snapshot?.result || {};
    const queuePosition = Number(snapshot?.queuePosition ?? 0);
    const currentAction = snapshot?.status === "queued" && queuePosition > 0
      ? `任务排队中，前方 ${queuePosition} 个任务`
      : snapshot?.currentAction || "统计中";

    updatePlatformState(platform, (state) => ({
      ...state,
      stats: {
        ...state.stats,
        progress: Number(snapshot?.progress ?? state.stats.progress ?? 0),
        currentAction,
        totalDanmaku: Number(snapshot?.totalDanmaku ?? state.stats.totalDanmaku ?? 0),
        totalUsers: Number(snapshot?.totalUsers ?? state.stats.totalUsers ?? 0),
        playCountResults: Array.isArray(result.playCountResults) ? result.playCountResults : state.stats.playCountResults,
        playCountSelectedEpisodeCount: Array.isArray(result.playCountResults)
          ? Number(result.playCountSelectedEpisodeCount ?? state.stats.playCountSelectedEpisodeCount ?? 0)
          : state.stats.playCountSelectedEpisodeCount,
        playCountTotal: Array.isArray(result.playCountResults)
          ? Number(result.playCountTotal ?? 0)
          : state.stats.playCountTotal,
        playCountFailed: Array.isArray(result.playCountResults)
          ? Boolean(result.playCountFailed)
          : state.stats.playCountFailed,
        idResults: Array.isArray(result.idResults) ? result.idResults : state.stats.idResults,
        idSelectedEpisodeCount: Array.isArray(result.idResults)
          ? Number(result.idSelectedEpisodeCount ?? state.stats.idSelectedEpisodeCount ?? 0)
          : state.stats.idSelectedEpisodeCount,
        episodeDetails: Array.isArray(result.idResults) || Array.isArray(result.revenueResults)
          ? Array.isArray(result.episodeDetails)
            ? result.episodeDetails
            : Array.isArray(result.suspectedOverflowEpisodes)
              ? result.suspectedOverflowEpisodes
              : Array.isArray(result.revenueSummary?.suspectedOverflowEpisodes)
                ? result.revenueSummary.suspectedOverflowEpisodes
                : []
          : state.stats.episodeDetails,
        revenueResults: Array.isArray(result.revenueResults) ? result.revenueResults : state.stats.revenueResults,
        revenueSummary: Array.isArray(result.revenueResults)
          ? result.revenueSummary || null
          : state.stats.revenueSummary,
      },
    }));
  }

  const statsTaskRun = useStatsTaskRun({
    getRuntimeMeta: (platform) => runtimeMetaRef.current[platform],
    getActiveTaskId: (platform) => platformStatesRef.current[platform]?.stats?.activeTaskId || "",
    getRunStartedAt: (platform) => platformStatesRef.current[platform]?.stats?.startedAt || 0,
    isRunMarkedRunning: (platform) => Boolean(platformStatesRef.current[platform]?.stats?.isRunning),
    createTask: ({ platform, taskType, payload, signal }) => createStatsTask({
      platform,
      taskType,
      payload,
      signal,
      frontendVersion: appConfigRef.current.frontendVersion,
      onVersionStatus: (status) => setAppConfig((current) => ({ ...current, ...status })),
    }),
    getTaskSnapshot: ({ platform, taskId, signal }) => getStatsTaskSnapshotWithRetry(taskId, {
      signal,
      frontendVersion: appConfigRef.current.frontendVersion,
      onVersionStatus: (status) => setAppConfig((current) => ({ ...current, ...status })),
      onConnectionState: (connection) => {
        if (connection?.retrying) {
          updatePlatformState(platform, (state) => ({
            ...state,
            stats: { ...state.stats, currentAction: "连接异常，正在重试" },
          }));
        }
      },
    }),
    cancelTask: ({ taskId, signal }) => cancelStatsTask(taskId, {
      signal,
      frontendVersion: appConfigRef.current.frontendVersion,
    }),
    notifyTaskCancel: notifyStatsTaskCancel,
    onRunStarted: ({ platform, startedAt }) => updatePlatformState(platform, (state) => ({
      ...state,
      stats: { ...createEmptyStats(), isRunning: true, startedAt, currentAction: "正在创建统计任务" },
    })),
    onElapsed: ({ platform, elapsedMs }) => updatePlatformState(platform, (state) => ({
      ...state,
      stats: { ...state.stats, elapsedMs },
    })),
    onRunCancelled: ({ platform }) => updatePlatformState(platform, (state) => ({
      ...state,
      stats: {
        ...state.stats,
        isRunning: false,
        activeTaskId: "",
        activeTaskType: "",
        currentAction: "已停止本地等待；服务器取消状态可能尚未确认。",
      },
    })),
    onRunFinished: ({ platform, status }) => updatePlatformState(platform, (state) => ({
      ...state,
      stats: {
        ...state.stats,
        isRunning: false,
        activeTaskId: "",
        activeTaskType: "",
        currentAction: status === "completed"
          ? state.stats.currentAction || "统计完成"
          : state.stats.currentAction,
      },
    })),
    onTaskCreated: ({ platform, taskId, taskType }) => updatePlatformState(platform, (state) => ({
      ...state,
      stats: { ...state.stats, activeTaskId: taskId, activeTaskType: taskType },
    })),
    onSnapshot: ({ platform, snapshot }) => applyTaskSnapshot(platform, snapshot),
    onCompleted: ({ platform, snapshot }) => applyTaskSnapshot(platform, snapshot),
  });

  useEffect(() => {
    const notifyPageExit = () => statsTaskRun.notifyAllActiveTaskCancels();
    window.addEventListener("pagehide", notifyPageExit);
    window.addEventListener("beforeunload", notifyPageExit);
    return () => {
      window.removeEventListener("pagehide", notifyPageExit);
      window.removeEventListener("beforeunload", notifyPageExit);
      notifyPageExit();
      statsTaskRun.dispose();
    };
  }, [statsTaskRun]);

  const currentState = platformStates[activePlatform];
  const currentStats = currentState?.stats || createEmptyStats();
  const hasActiveStatistics = Object.values(platformStates).some((state) => state.stats?.isRunning);
  const metricController = useSearchCardMetrics({
    activeBrowsePlatform: activePlatform,
    activeSearchCategory: activePlatform,
    appConfigRef,
    currentBrowseState: currentState,
    currentPlatform: "search",
    getPlatformState: (platform) => platformStatesRef.current[platform],
    updatePlatformState,
  });

  async function postJson(path, body, message) {
    const response = await fetch(buildVersionedUrl(path, appConfigRef.current.frontendVersion), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    updateVersionStatus(response, data);
    if (!response.ok) throw new Error(data?.message || data?.error || `${message}: ${response.status}`);
    return data;
  }

  function setSearchResults(platform, results, source, meta = {}) {
    searchGenerationRef.current += 1;
    updatePlatformState(platform, (state) => setSearchResultsState(state, results, source, {
      ...meta,
      searchGeneration: searchGenerationRef.current,
    }));
  }

  async function loadMoreSearchResults() {
    const platform = activePlatformRef.current;
    const state = platformStatesRef.current[platform];
    const keyword = String(state?.searchKeyword || "").trim();
    if (!keyword || !state?.searchHasMore || state?.isLoadingMoreResults || state?.searchResultSource !== "search") return;
    const searchGeneration = Number(state.searchGeneration ?? 0);
    const pageSize = Number(state.searchPageSize || 5);
    const offset = Number(state.searchNextOffset || state.searchResults?.length || 0);
    updatePlatformState(platform, (current) => ({ ...current, isLoadingMoreResults: true }));
    try {
      const path = `/unified-search?keyword=${encodeURIComponent(keyword)}&offset=${offset}&limit=${pageSize}`;
      const response = await fetch(buildVersionedUrl(path, appConfigRef.current.frontendVersion), { cache: "no-store" });
      const data = await response.json();
      updateVersionStatus(response, data);
      const latestState = platformStatesRef.current[platform];
      if (
        Number(latestState?.searchGeneration ?? 0) !== searchGeneration
        || String(latestState?.searchKeyword || "").trim() !== keyword
        || latestState?.searchResultSource !== "search"
      ) return;
      const platformResult = data?.results?.[platform];
      if (!response.ok || !platformResult?.success) {
        throw new Error(platformResult?.error || data?.error || `加载搜索结果失败：${response.status}`);
      }
      const items = Array.isArray(platformResult.results) ? platformResult.results : [];
      const nextOffset = Number(platformResult.meta?.nextOffset ?? offset + items.length);
      const totalMatched = Number(platformResult.meta?.matchedCount ?? platformResult.meta?.totalMatched ?? state.searchTotalMatched);
      const page = Math.floor(offset / Math.max(1, pageSize)) + 1;
      updatePlatformState(platform, (current) => appendSearchResultsPage(current, items, {
        hasMore: platformResult.meta?.hasMore,
        nextOffset,
        page,
        pageSize,
        totalMatched,
      }));
    } catch (error) {
      const latestState = platformStatesRef.current[platform];
      if (
        Number(latestState?.searchGeneration ?? 0) !== searchGeneration
        || String(latestState?.searchKeyword || "").trim() !== keyword
      ) return;
      toast.error(error instanceof Error ? error.message : "加载搜索结果失败，请稍后重试。");
      updatePlatformState(platform, (current) => ({ ...current, isLoadingMoreResults: false }));
    }
  }

  async function addDramas(ids, options = {}) {
    const platform = options.platform === "missevan" || options.platform === "manbo"
      ? options.platform
      : activePlatformRef.current;
    const requestedIds = Array.from(new Set((Array.isArray(ids) ? ids : [])
      .map((id) => String(id ?? "").trim()).filter(Boolean)));
    if (!requestedIds.length) return { dramas: platformStatesRef.current[platform]?.dramas || [], importedIds: [] };
    const state = platformStatesRef.current[platform];
    const mergedDramas = (state?.dramas || []).map(cloneDrama);
    const known = new Set(mergedDramas.map((item) => String(item?.drama?.id ?? "")));
    const missingIds = requestedIds.filter((id) => !known.has(id));
    try {
      if (missingIds.length) {
        const selectedSearchResults = getAllSearchResults(state).filter((item) => missingIds.includes(String(item.id)));
        const soundIdMap = Object.fromEntries(selectedSearchResults
          .filter((item) => platform === "missevan" && Number(item.sound_id) > 0)
          .map((item) => [String(item.id), Number(item.sound_id)]));
        const data = await postJson(platform === "manbo" ? "/manbo/getdramas" : "/getdramas", {
          drama_ids: missingIds,
          ...(platform === "missevan" ? { sound_id_map: soundIdMap } : {}),
        }, "导入作品失败");
        const byId = new Map(extractResponseItems(data).map((item) => [String(item?.id ?? ""), item]));
        missingIds.forEach((id) => {
          const result = byId.get(id);
          if (result?.success && result?.info) mergedDramas.push(normalizeFetchedDrama(result, options.expandImported === true));
        });
      }
      if (options.selectMode === "all" || options.selectMode === "paid") {
        selectDramaEpisodesByMode(mergedDramas, requestedIds, {
          mode: options.selectMode,
          checked: true,
          expand: options.expandImported === true,
          isSelectableEpisode: (episode) => isPaidEpisode(platform, episode) || isMemberEpisode(platform, episode),
        });
      }
      const importedSet = new Set(mergedDramas.map((item) => String(item?.drama?.id ?? "")));
      updatePlatformState(platform, (current) => {
        const markChecked = (items) => (Array.isArray(items) ? items : []).map((item) => ({
          ...item,
          ...(options.autoCheck === true && requestedIds.includes(String(item.id)) ? { checked: true } : {}),
        }));
        return {
          ...current,
          dramas: mergedDramas,
          selectedEpisodesSnapshot: collectSelectedEpisodesFromDramas(mergedDramas),
          searchResults: markChecked(current.searchResults),
          searchPageCache: Object.fromEntries(Object.entries(current.searchPageCache || {}).map(([page, items]) => [page, markChecked(items)])),
        };
      });
      return { dramas: mergedDramas, importedIds: requestedIds.filter((id) => importedSet.has(id)) };
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导入作品失败，请稍后重试。");
      return { dramas: state?.dramas || [], importedIds: [] };
    }
  }

  async function importRawItemsIntoPlatform(targetPlatform, rawItems) {
    const platform = targetPlatform === "manbo" ? "manbo" : "missevan";
    const normalizedItems = Array.from(new Set((Array.isArray(rawItems) ? rawItems : [])
      .map((item) => String(item ?? "").trim()).filter(Boolean)));
    if (!normalizedItems.length) return;
    try {
      const items = platform === "manbo"
        ? await Promise.all(normalizedItems.map(async (raw) => {
            if (!canParseShareUrl(raw)) return { raw };
            const payload = await decryptShareUrl(raw);
            const resolved = extractResolvedId(payload, raw);
            return {
              raw: resolved?.dramaId || resolved?.setId || raw,
              resolvedShareData: resolved?.payload || payload,
            };
          }))
        : normalizedItems.map((raw) => ({ raw }));
      const data = await postJson(platform === "manbo" ? "/manbo/getdramacards" : "/getdramacards", { items }, "导入失败");
      const results = Array.isArray(data?.results)
        ? data.results.map((item) => ({ ...item, platform: item?.platform || platform }))
        : [];
      if (!data?.success || results.length === 0) {
        throw new Error(platform === "manbo" ? "漫播导入失败，请检查输入内容。" : "猫耳导入失败，请检查输入内容。");
      }
      setSearchForm({ keyword: normalizedItems.join(", "), manualInput: normalizedItems.join("\n") });
      updatePlatformState(platform, (state) => setManualSearchResultsState(state, results, { limit: normalizedItems.length }));
      setActivePlatform(platform);
      navigation.navigateToolRoute({ view: "search", q: "", platform });
      if (data.failedItems?.length || data.failedIds?.length) {
        toast.warning("部分输入未能导入，请检查结果列表后重试。");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导入失败，请检查输入内容或稍后重试。");
    }
  }

  async function runStats(platform, taskType, payload) {
    if (hasActiveStatistics) {
      toast.warning("统计任务运行中，请等待完成后再开始新的统计。");
      return;
    }
    const { runId, signal } = statsTaskRun.beginRun(platform);
    let finalStatus = "completed";
    try {
      await statsTaskRun.startStatsTask(platform, taskType, payload, runId, signal);
    } catch (error) {
      if (!isAbortError(error)) {
        finalStatus = "failed";
        const message = error instanceof Error ? error.message : "统计失败，请稍后重试。";
        toast.error(message);
        updatePlatformState(platform, (state) => ({ ...state, stats: { ...state.stats, currentAction: message } }));
      } else {
        finalStatus = "cancelled";
      }
    } finally {
      statsTaskRun.finishRun(platform, runId, finalStatus);
    }
  }

  function startIdStatistics(soundIds) {
    const selectedIds = new Set((Array.isArray(soundIds) ? soundIds : []).map(String));
    const episodes = (platformStatesRef.current[activePlatform]?.selectedEpisodesSnapshot || [])
      .filter((episode) => selectedIds.has(String(episode.sound_id)));
    if (!episodes.length) {
      toast.warning("请先选择分集。");
      return;
    }
    void runStats(activePlatform, "id", { episodes, source: "custom" });
  }

  function startPlayCountStatistics(soundIds) {
    const selectedIds = new Set((Array.isArray(soundIds) ? soundIds : []).map(String));
    const state = platformStatesRef.current[activePlatform];
    const episodes = (state?.selectedEpisodesSnapshot || [])
      .filter((episode) => selectedIds.has(String(episode.sound_id)));
    if (!episodes.length) {
      toast.warning("请先选择分集。");
      return;
    }
    const payload = { episodes, source: "custom" };
    if (activePlatform === "missevan") {
      const playCountDramas = buildPlayCountDramasFromDramas(state?.dramas || []);
      if (playCountDramas.length) payload.playCountDramas = playCountDramas;
    }
    void runStats(activePlatform, "play_count", payload);
  }

  function startRevenueEstimate(dramaIds, options = {}) {
    const ids = Array.from(new Set((Array.isArray(dramaIds) ? dramaIds : []).map((id) => String(id ?? "").trim()).filter(Boolean)));
    if (!ids.length) {
      toast.warning("请先选择作品。");
      return;
    }
    void runStats(activePlatform, "revenue", { dramaIds: ids, source: options.source || "search" });
  }

  async function startPaidIdStatistics(dramaId, options = {}) {
    const imported = await addDramas([dramaId], {
      platform: activePlatform,
      autoCheck: true,
      expandImported: true,
      selectMode: "paid",
    });
    const target = String(dramaId);
    const episodes = collectSelectedEpisodesFromDramas(imported.dramas || [])
      .filter((episode) => String(episode.drama_id) === target);
    if (!episodes.length) {
      toast.warning("没有可统计的付费分集。");
      return;
    }
    void runStats(activePlatform, "id", { episodes, source: options.source || `${target}payID` });
  }

  function cancelStatistics() {
    statsTaskRun.cancelRun(activePlatformRef.current);
  }

  function commitGlobalSearchNavigation(action = {}) {
    const targetPlatform = ["missevan", "manbo"].includes(action.targetPlatform)
      ? action.targetPlatform
      : activePlatformRef.current;
    navigation.navigateToolRoute({
      view: "search",
      q: action.action === "search" ? action.keyword : "",
      platform: targetPlatform,
    });
  }

  function selectPlatform(platform) {
    if (!["missevan", "manbo"].includes(platform)) return;
    setActivePlatform(platform);
    navigation.navigateToolRoute({
      view: "search",
      q: navigation.toolRouteState.q,
      platform,
    }, { replace: true });
  }

  const allResults = getAllSearchResults(currentState);
  const results = currentState?.searchResults || [];
  const resultCounts = useMemo(() => ({
    missevan: getSearchResultCount(platformStates.missevan),
    manbo: getSearchResultCount(platformStates.manbo),
  }), [platformStates]);
  const outputShared = {
    platform: activePlatform,
    progress: currentStats.progress,
    currentAction: currentStats.currentAction,
    elapsedMs: currentStats.elapsedMs,
    idResults: currentStats.idResults,
    idSelectedEpisodeCount: currentStats.idSelectedEpisodeCount,
    totalDanmaku: currentStats.totalDanmaku,
    totalUsers: currentStats.totalUsers,
    playCountResults: currentStats.playCountResults,
    playCountSelectedEpisodeCount: currentStats.playCountSelectedEpisodeCount,
    playCountTotal: currentStats.playCountTotal,
    playCountFailed: currentStats.playCountFailed,
    revenueResults: currentStats.revenueResults,
    revenueSummary: currentStats.revenueSummary,
    episodeDetails: currentStats.episodeDetails,
    isRunning: currentStats.isRunning,
    onCancelStatistics: cancelStatistics,
    showHistory: false,
  };

  return (
    <main className="app-shell mx-auto flex min-h-screen max-w-7xl flex-col gap-4 px-3 pt-3 sm:px-5 sm:pt-6 lg:gap-5 lg:px-6">
      <header className="grid gap-3 border-b border-border/75 pb-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
        <AppIcon className="size-12 rounded-xl" />
        <div className="min-w-0">
          <div className="text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-primary">{appConfig.brandName}</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{appConfig.titleZh}</h1>
          <p className="mt-1 text-sm text-muted-foreground">搜索剧集、选择分集，并统计弹幕 ID、播放量与收益。</p>
        </div>
      </header>

      <SearchPanel
        isDesktopApp
        formState={searchForm}
        frontendVersion={appConfig.frontendVersion}
        handleVersionResponse={(status) => setAppConfig((current) => ({ ...current, ...status }))}
        onUpdateFormState={(patch) => setSearchForm((current) => ({ ...current, ...patch }))}
        onUpdatePlatformFormState={(_platform, patch) => setSearchForm((current) => ({ ...current, ...patch }))}
        onResetPlatformState={(platform) => updatePlatformState(platform, resetSearchResultsState)}
        onUpdatePlatformResults={(platform, items, source, meta) => setSearchResults(platform, items, source, meta)}
        onUpdateCvResults={() => {}}
        onSelectPlatform={selectPlatform}
        onSelectCategory={selectPlatform}
        onCrossPlatformImport={({ targetPlatform, rawItems }) => importRawItemsIntoPlatform(targetPlatform, rawItems)}
        onNotice={setNotice}
        onSearchCommit={commitGlobalSearchNavigation}
        onSearchPendingChange={setSearchPending}
        restoreSearchRequest={navigation.toolRouteState.view === "search"
          && navigation.toolRouteState.q
          && navigation.toolRouteState.q === navigation.searchRouteRestoreKeyword
          ? {
              keyword: navigation.toolRouteState.q,
              category: navigation.toolRouteState.platform,
              signature: `${navigation.searchRouteRestoreGeneration}:${navigation.toolRouteState.q}`,
            }
          : null}
        cooldownHours={appConfig.cooldownHours}
        cooldownUntil={appConfig.cooldownUntil}
      />

      <SearchWorkspace
        legend={{ open: false }}
        panelRefs={{ results: null, output: null }}
        results={{
          platform: activePlatform,
          activePlatform,
          platformTabs: searchPlatforms,
          onPlatformChange: selectPlatform,
          platformResultCounts: resultCounts,
          frontendVersion: appConfig.frontendVersion,
          handleVersionResponse: (status) => setAppConfig((current) => ({ ...current, ...status })),
          isDesktopApp: true,
          isSearchPending: searchPending,
          isLoadingMoreResults: Boolean(currentState?.isLoadingMoreResults),
          resultSource: currentState?.searchResultSource || "search",
          searchError: currentState?.searchError || "",
          results,
          allResults,
          dramas: currentState?.dramas || [],
          selectedEpisodes: currentState?.selectedEpisodesSnapshot || [],
          totalResults: Number(currentState?.searchTotalMatched ?? 0),
          loadedResultCount: results.length,
          hasMoreResults: Boolean(currentState?.searchHasMore),
          onLoadMoreResults: loadMoreSearchResults,
          onSetResults: (next) => updatePlatformState(activePlatform, (state) => setVisibleSearchResults(state, next)),
          onSetDramas: (next) => updatePlatformState(activePlatform, (state) => ({
            ...state,
            dramas: next,
            selectedEpisodesSnapshot: collectSelectedEpisodesFromDramas(next),
          })),
          onSelectionChange: (selectedEpisodes) => updatePlatformState(activePlatform, (state) => ({ ...state, selectedEpisodesSnapshot: selectedEpisodes })),
          onAddDramas: addDramas,
          onStartIdStatistics: startIdStatistics,
          onStartPlayCountStatistics: startPlayCountStatistics,
          onStartRevenueEstimate: startRevenueEstimate,
          onStartDramaPaidIdStatistics: startPaidIdStatistics,
          onRetryMetrics: metricController.retrySearchCardMetrics,
          statisticsActionsDisabled: hasActiveStatistics,
          favoriteActionsDisabled: true,
          cvResults: [],
          onOpenCv: undefined,
        }}
        output={outputShared}
      />

      <MessageDialog notice={notice} onClose={() => setNotice(null)} />
    </main>
  );
}

export default DesktopStatisticsView;
