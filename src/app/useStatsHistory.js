import { useEffect, useRef } from "react";

import {
  createPlatformState,
  createStatsHistoryEntry,
  createStatsState,
  loadPersistedHistoryEntries,
  resolveRevenueSummaryForHistory,
  savePersistedHistoryEntries,
  STATS_HISTORY_LIMIT,
} from "./app-utils.js";

const STATS_HISTORY_PLATFORMS = ["missevan", "manbo"];

function getPlatformHistoryEntries(platformStates, platform) {
  const entries = platformStates?.[platform]?.historyEntries;
  return Array.isArray(entries) ? entries : [];
}

function getStatsHistoryLimit(value) {
  const limit = Number(value);
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : STATS_HISTORY_LIMIT;
}

export function createPlatformStatesWithHistory(options = {}) {
  const loadHistoryEntries = options.loadHistoryEntries || loadPersistedHistoryEntries;
  const createPlatformStateFn = options.createPlatformState || createPlatformState;
  const persistedHistory = loadHistoryEntries() || {};

  return Object.fromEntries(
    STATS_HISTORY_PLATFORMS.map((platform) => [
      platform,
      {
        ...createPlatformStateFn(),
        historyEntries: Array.isArray(persistedHistory[platform]) ? persistedHistory[platform] : [],
      },
    ])
  );
}

export function getStatsHistoryByPlatform(platformStates = {}) {
  return Object.fromEntries(
    STATS_HISTORY_PLATFORMS.map((platform) => [
      platform,
      getPlatformHistoryEntries(platformStates, platform),
    ])
  );
}

export function persistStatsHistoryEntries(historyByPlatform = {}, saveHistoryEntries = savePersistedHistoryEntries) {
  saveHistoryEntries({
    missevan: Array.isArray(historyByPlatform.missevan) ? historyByPlatform.missevan : [],
    manbo: Array.isArray(historyByPlatform.manbo) ? historyByPlatform.manbo : [],
  });
}

export function getMergedStatsHistoryEntries(platformStates = {}) {
  return STATS_HISTORY_PLATFORMS
    .flatMap((platform) =>
      getPlatformHistoryEntries(platformStates, platform)
        .filter(Boolean)
        .map((entry) => {
          const entryPlatform = entry.platform || platform;
          return {
            ...entry,
            platform: entryPlatform,
            platformLabel: entryPlatform === "manbo" ? "漫播" : "猫耳",
          };
        })
    )
    .sort((left, right) => Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0));
}

export function createStatsHistoryController(initialOptions = {}) {
  let latestOptions = initialOptions;

  function getOptions() {
    return typeof initialOptions.getOptions === "function"
      ? initialOptions.getOptions() || {}
      : latestOptions || {};
  }

  function updateOptions(nextOptions) {
    latestOptions = nextOptions || {};
  }

  function getRuntimeMeta(platform) {
    const meta = getOptions().getRuntimeMeta?.(platform);
    if (!meta) {
      throw new Error(`Missing stats runtime metadata for ${platform}`);
    }
    return meta;
  }

  function getLatestPlatformStates() {
    const options = getOptions();
    return options.getPlatformStates?.() || options.platformStates || {};
  }

  function getRenderedPlatformStates() {
    const options = getOptions();
    return options.platformStates || getLatestPlatformStates();
  }

  function updatePlatformState(platform, updater) {
    return getOptions().updatePlatformState?.(platform, updater);
  }

  function appendHistoryEntry(platform, entry, taskId = "") {
    if (!entry) {
      return "";
    }

    const meta = getRuntimeMeta(platform);
    const normalizedTaskId = String(taskId || "").trim();
    if (normalizedTaskId) {
      meta.completedHistoryTaskIds ||= new Set();
      if (meta.completedHistoryTaskIds.has(normalizedTaskId)) {
        return "";
      }
      meta.completedHistoryTaskIds.add(normalizedTaskId);
    }

    const historyLimit = getStatsHistoryLimit(getOptions().historyLimit);
    updatePlatformState(platform, (state) => {
      const nextEntries = [entry, ...(Array.isArray(state.historyEntries) ? state.historyEntries : [])];
      return {
        ...state,
        historyEntries: nextEntries.slice(0, historyLimit),
      };
    });

    return entry.id;
  }

  function recordCompletedStatsHistory(platform, taskType, taskId, snapshot) {
    const options = getOptions();
    const normalizedTaskId = String(taskId || snapshot?.taskId || "").trim();
    const result = snapshot?.result || {};
    const baseStats = getLatestPlatformStates()[platform]?.stats || createStatsState();
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
        ? (options.resolveRevenueSummaryForHistory || resolveRevenueSummaryForHistory)(
            result.revenueResults,
            platform,
            result.revenueSummary || null
          )
        : baseStats.revenueSummary,
    };

    const historyEntry = (options.createStatsHistoryEntry || createStatsHistoryEntry)(platform, completedStats, {
      taskType,
      createdAt: (options.now || Date.now)(),
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
    return historyEntryId;
  }

  function deleteHistoryEntry(platform, entryId) {
    updatePlatformState(platform, (state) => ({
      ...state,
      historyEntries: getPlatformHistoryEntries({ [platform]: state }, platform).filter((entry) => entry.id !== entryId),
    }));
  }

  function clearHistoryEntries(platform) {
    updatePlatformState(platform, (state) => ({
      ...state,
      historyEntries: [],
    }));
  }

  function clearAllHistoryEntries() {
    STATS_HISTORY_PLATFORMS.forEach(clearHistoryEntries);
  }

  function getMergedHistoryEntries() {
    return getMergedStatsHistoryEntries(getRenderedPlatformStates());
  }

  return {
    appendHistoryEntry,
    clearAllHistoryEntries,
    clearHistoryEntries,
    deleteHistoryEntry,
    getMergedHistoryEntries,
    recordCompletedStatsHistory,
    updateOptions,
  };
}

export function useStatsHistory(options = {}) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const controllerRef = useRef(null);
  if (!controllerRef.current) {
    controllerRef.current = createStatsHistoryController({
      getOptions: () => optionsRef.current,
    });
  }
  controllerRef.current.updateOptions(options);

  const historyByPlatform = getStatsHistoryByPlatform(options.platformStates);
  const missevanHistoryEntries = historyByPlatform.missevan;
  const manboHistoryEntries = historyByPlatform.manbo;
  const saveHistoryEntries = options.saveHistoryEntries || savePersistedHistoryEntries;
  useEffect(() => {
    persistStatsHistoryEntries({ missevan: missevanHistoryEntries, manbo: manboHistoryEntries }, saveHistoryEntries);
  }, [manboHistoryEntries, missevanHistoryEntries, saveHistoryEntries]);

  return controllerRef.current;
}
