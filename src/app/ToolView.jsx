import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { toast } from "sonner";

import { DesktopReportPanel } from "@/app/DesktopReportPanel";
import { MessageDialog } from "@/app/MessageDialog";
import { OutputPanel } from "@/app/OutputPanel";
import { SearchPanel } from "@/app/SearchPanel";
import { SearchResults } from "@/app/SearchResults";
import {
  buildRevenueSummary,
  buildUniqueUserIds,
  buildVersionedUrl,
  collectSelectedEpisodesFromDramas,
  createPlatformState,
  createRuntimeMeta,
  createStatsState,
  extractResponseItems,
  getBackendVersionFromResponse,
  getDefaultAppConfig,
  getRemainingCooldownHours,
  getSummaryRevenueMode,
  getSummaryRevenueTotals,
  isAbortError,
  mergeAppConfig,
  normalizeOptionalNumber,
  normalizeVersion,
} from "@/app/app-utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function ToolView({ initialAppConfig }) {
  const [currentPlatform, setCurrentPlatform] = useState("missevan");
  const [appConfig, setAppConfig] = useState({
    ...getDefaultAppConfig(),
    ...(initialAppConfig || {}),
  });
  const [platformStates, setPlatformStates] = useState({
    missevan: createPlatformState(),
    manbo: createPlatformState(),
  });
  const [notice, setNotice] = useState(null);

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

  const visiblePlatforms = useMemo(
    () =>
      [
        { key: "missevan", label: "Missevan" },
        { key: "manbo", label: "Manbo" },
        { key: "report", label: "Excel 报表" },
      ].filter((platform) => {
        if (platform.key === "report") {
          return appConfig.desktopApp;
        }
        return platform.key !== "missevan" || appConfig.missevanEnabled;
      }),
    [appConfig.desktopApp, appConfig.missevanEnabled]
  );

  const currentBrowseState = currentPlatform === "report" ? null : platformStates[currentPlatform];
  const currentStatsState = currentBrowseState?.stats || null;
  const currentRevenueSummary = currentStatsState?.revenueSummary || buildRevenueSummary(currentStatsState?.revenueResults || [], currentPlatform);
  const stepOneHint =
    currentPlatform === "missevan"
      ? `如果猫耳接口暂时受限，请 ${getRemainingCooldownHours(
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
      ref.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
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
      isLoadingMoreResults: false,
      searchResults: [],
      dramas: [],
      selectedEpisodesSnapshot: [],
    }));
  }

  function setSearchResults(platform, results, source = "search", meta = {}) {
    const normalizedResults = Array.isArray(results) ? results.map((item) => ({ ...item })) : [];
    updatePlatformState(platform, (state) => ({
      ...state,
      searchResultSource: source === "manual" ? "manual" : "search",
      searchKeyword: source === "search" ? String(meta?.keyword ?? state.searchForm.keyword ?? "").trim() : "",
      searchNextOffset: source === "search" ? Number(meta?.nextOffset ?? normalizedResults.length) || 0 : 0,
      searchHasMore: source === "search" ? Boolean(meta?.hasMore) : false,
      isLoadingMoreResults: false,
      searchResults: normalizedResults,
    }));
    if (normalizedResults.length > 0) {
      scrollToPanel(resultsPanelRef);
    }
  }

  function setResults(nextResults) {
    updatePlatformState(currentPlatformRef.current, (state) => ({
      ...state,
      searchResults: nextResults,
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

  function appendSearchResults(platform, results, meta = {}) {
    const normalizedResults = Array.isArray(results) ? results.map((item) => ({ ...item })) : [];
    updatePlatformState(platform, (state) => ({
      ...state,
      searchNextOffset: Number(meta?.nextOffset ?? state.searchNextOffset) || 0,
      searchHasMore: Boolean(meta?.hasMore),
      isLoadingMoreResults: false,
      searchResults: Array.from(
        normalizedResults.reduce((map, item) => {
          const key = String(item.id);
          if (map.has(key)) {
            const previous = map.get(key);
            map.set(key, {
              ...item,
              checked: previous?.checked ?? item.checked,
            });
          } else {
            map.set(key, item);
          }
          return map;
        }, new Map(state.searchResults.map((item) => [String(item.id), item]))).values()
      ),
    }));
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

  async function loadMoreSearchResults(platform = currentPlatformRef.current) {
    const state = platformStatesRef.current[platform];
    const keyword = String(state?.searchKeyword ?? "").trim();
    const offset = Number(state?.searchNextOffset ?? 0);
    if (!keyword || state?.searchResultSource === "manual" || !state?.searchHasMore || state?.isLoadingMoreResults) {
      return;
    }

    updatePlatformState(platform, (current) => ({
      ...current,
      isLoadingMoreResults: true,
    }));

    try {
      const endpoint =
        platform === "manbo"
          ? `/manbo/search?keyword=${encodeURIComponent(keyword)}&offset=${offset}&limit=5`
          : `/search?keyword=${encodeURIComponent(keyword)}&offset=${offset}&limit=5`;
      const response = await fetch(buildVersionedUrl(endpoint, appConfigRef.current.frontendVersion), {
        cache: "no-store",
      });
      const data = await parseVersionedJsonResponse(response);

      if (!data?.success) {
        if (platform === "missevan" && data?.accessDenied) {
          await showMissevanAccessHint();
        } else {
          toast.error("加载更多结果失败，请稍后重试。");
        }
        updatePlatformState(platform, (current) => ({
          ...current,
          isLoadingMoreResults: false,
        }));
        return;
      }

      appendSearchResults(platform, data.results || [], data.meta || {});
    } catch (error) {
      console.error("Failed to load more search results", error);
      if (platform === "missevan" && error?.accessDenied) {
        await showMissevanAccessHint();
      } else {
        toast.error("加载更多结果失败，请稍后重试。");
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
    updatePlatformState(platform, (state) => ({
      ...state,
      stats: {
        ...state.stats,
        activeTaskId: taskId,
        activeTaskType: task.taskType || taskType,
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
      ? "如果看到访问受限，请先使用任意浏览器打开猫耳主页完成验证后再重试。"
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
    return platformStatesRef.current[platform]?.searchResults.find((item) => String(item.id) === String(dramaId));
  }

  function getSearchResultsByIds(platform, dramaIds) {
    const idSet = new Set((Array.isArray(dramaIds) ? dramaIds : []).map((id) => String(id)));
    return (platformStatesRef.current[platform]?.searchResults || []).filter((item) => idSet.has(String(item.id)));
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

  async function addDramas(ids) {
    const platform = currentPlatformRef.current;
    if (!ids?.length) {
      toast.warning("请先选择作品。");
      return;
    }
    let hasAccessDenied = false;
    const currentState = platformStatesRef.current[platform];
    const existingDramaMap = new Map(currentState.dramas.map((drama) => [String(drama?.drama?.id), drama]));
    const mergedDramas = [...currentState.dramas];

    try {
      if (platform === "missevan") {
        const fallbackIds = getSearchResultsByIds(platform, ids)
          .filter((item) => item?.search_source === "missevan_api")
          .map((item) => item.id);
        if (fallbackIds.length) {
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
      }

      for (let index = 0; index < ids.length; index += 1) {
        const id = String(ids[index]);
        if (existingDramaMap.has(id)) {
          const existingDrama = existingDramaMap.get(id);
          existingDrama.expanded = false;
          continue;
        }
        try {
          const drama = await fetchDramaById(platform, id);
          mergedDramas.push(drama);
          existingDramaMap.set(id, drama);
        } catch (error) {
          if (error?.accessDenied) {
            hasAccessDenied = true;
          }
          console.error(`Failed to import drama ${id}`, error);
        }
      }

      updatePlatformState(platform, (state) => ({
        ...state,
        dramas: mergedDramas,
        selectedEpisodesSnapshot: collectSelectedEpisodesFromDramas(mergedDramas),
      }));
      if (hasAccessDenied) {
        await showMissevanAccessHint();
      }
      if (mergedDramas.length > 0) {
        scrollToPanel(resultsPanelRef);
      }
    } catch (error) {
      console.error("Failed to import dramas", error);
      toast.error("导入作品失败，请稍后重试。");
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

  async function startIdStatisticsConcurrent(soundIds) {
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
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 sm:py-8">
      <Card className="border-white/65 bg-[rgba(255,252,247,0.98)] shadow-[0_24px_56px_-42px_rgba(30,32,41,0.16)]">
        <CardContent className="relative flex flex-col gap-6 p-6 sm:p-8">
          <div className="pointer-events-none absolute left-6 top-0 h-24 w-[min(36rem,calc(100%-3rem))] rounded-b-[2rem] bg-[linear-gradient(90deg,rgba(59,62,122,0.14),rgba(239,131,95,0.16)_48%,transparent)] blur-sm sm:w-[min(40rem,calc(100%-3.5rem))]" />
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="relative space-y-3">
              <div className="text-[0.7rem] font-semibold uppercase tracking-[0.32em] text-[rgb(59,62,122)]">{appConfig.brandName}</div>
              <div className="text-3xl font-semibold tracking-tight sm:text-[2.7rem]">{appConfig.titleZh}</div>
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground/85">{appConfig.description}</p>
            </div>
            <Badge variant="coral" className="w-fit px-3 py-1 text-xs font-semibold">
              v{appConfig.frontendVersion}
            </Badge>
          </div>

          {appConfig.versionMismatch ? (
            <Alert className="border-[rgba(239,131,95,0.22)] bg-[rgba(255,240,233,0.9)]">
              <AlertTriangleIcon className="size-4" />
              <AlertTitle>工具版本已更新</AlertTitle>
              <AlertDescription>
                工具已更新，请刷新或重新打开页面。若还看到此提醒，请清理缓存后再重试。
              </AlertDescription>
            </Alert>
          ) : null}

          <Tabs value={currentPlatform} onValueChange={setCurrentPlatform}>
            <TabsList className="inline-flex w-fit max-w-full justify-start overflow-x-auto">
              {visiblePlatforms.map((platform) => (
                <TabsTrigger key={platform.key} className="px-3.5" value={platform.key}>
                  {platform.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </CardContent>
      </Card>

      {currentPlatform !== "report" ? (
        <div className="grid gap-4 sm:gap-5">
          {currentPlatform === "missevan" ? (
            <div className="px-1 text-sm leading-6 text-muted-foreground">
              {stepOneHint} 也可前往
              {" "}
              <a className="font-medium text-[rgb(59,62,122)] underline underline-offset-4" href="/">
                首页
              </a>
              {" "}选择其他节点，或直接使用
              {appConfig.desktopAppUrl ? (
                <>
                  <a className="font-medium text-[rgb(59,62,122)] underline underline-offset-4" href={appConfig.desktopAppUrl} rel="noreferrer" target="_blank">
                    桌面版
                  </a>
                  。
                </>
              ) : "桌面版。"}
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
              onAddDramas={addDramas}
              onSelectionChange={updateSelection}
              onSetDramas={setDramas}
              onSetResults={setResults}
              onStartIdStatistics={startIdStatisticsConcurrent}
              onStartPlayCountStatistics={startPlayCountStatistics}
              onStartRevenueEstimate={startRevenueEstimate}
              onLoadMoreResults={() => loadMoreSearchResults(currentPlatform)}
              hasMoreResults={Boolean(currentBrowseState?.searchHasMore)}
              isLoadingMoreResults={Boolean(currentBrowseState?.isLoadingMoreResults)}
              platform={currentPlatform}
              resultSource={currentBrowseState?.searchResultSource || "search"}
              results={currentBrowseState?.searchResults || []}
              selectedEpisodes={currentBrowseState?.selectedEpisodesSnapshot || []}
            />
          </section>

          <section ref={outputPanelRef} className="grid gap-3">
            <OutputPanel
              currentAction={currentStatsState?.currentAction}
              elapsedMs={currentStatsState?.elapsedMs}
              idResults={currentStatsState?.idResults}
              idSelectedEpisodeCount={currentStatsState?.idSelectedEpisodeCount}
              isRunning={currentStatsState?.isRunning}
              onCancelStatistics={cancelCurrentStatistics}
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
    </div>
  );
}
