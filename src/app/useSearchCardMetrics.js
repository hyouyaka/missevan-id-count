import { useEffect, useRef } from "react";

import {
  buildVersionedUrl,
  isAbortError,
  mergeMissingSearchCardFields,
  readJsonResponse,
  selectSearchMetricQueue,
  shouldLoadSearchMetrics,
} from "./app-utils.js";
import { waitForStatsTaskPoll } from "./useStatsTaskRun.js";

export const waitForSearchCardMetricRetry = waitForStatsTaskPoll;

function patchSearchMetricItems(items, itemId, patch) {
  const normalizedId = String(itemId ?? "");
  return (Array.isArray(items) ? items : []).map((item) => {
    if (String(item?.id ?? "") !== normalizedId) {
      return item;
    }
    const resolvedPatch = typeof patch === "function" ? patch(item) : patch;
    return { ...item, ...resolvedPatch };
  });
}

function getResponseRetryAfterSeconds(response, payload) {
  const headerSeconds = Number(response?.headers?.get?.("Retry-After") ?? 0);
  return Math.max(
    1,
    Number(payload?.retryAfterSeconds ?? headerSeconds ?? 60) || 60
  );
}

export function createSearchCardMetricsController(initialOptions = {}) {
  let latestOptions = initialOptions;
  const activeControllers = new Set();

  function getOptions() {
    return typeof initialOptions.getOptions === "function"
      ? initialOptions.getOptions() || {}
      : latestOptions || {};
  }

  function updateOptions(nextOptions) {
    latestOptions = nextOptions || {};
  }

  function getPlatformState(platform) {
    const options = getOptions();
    return options.getPlatformState?.(platform) || options.platformState || null;
  }

  function getCurrentBrowseState() {
    return getOptions().currentBrowseState || null;
  }

  function updatePlatformState(platform, updater) {
    return getOptions().updatePlatformState?.(platform, updater);
  }

  function patchSearchMetricItem(platform, itemId, patch, searchGeneration) {
    updatePlatformState(platform, (state) => {
      if (Number(state?.searchGeneration ?? 0) !== Number(searchGeneration ?? 0)) {
        return state;
      }
      const patchItems = (items) => patchSearchMetricItems(items, itemId, patch);
      return {
        ...state,
        searchResults: patchItems(state?.searchResults),
        searchPageCache: Object.fromEntries(
          Object.entries(state?.searchPageCache || {}).map(([page, items]) => [page, patchItems(items)])
        ),
      };
    });
  }

  function resetLoadingSearchMetricItems(platform, searchGeneration) {
    updatePlatformState(platform, (state) => {
      if (Number(state?.searchGeneration ?? 0) !== Number(searchGeneration ?? 0)) {
        return state;
      }
      const resetLoading = (items = []) => (Array.isArray(items) ? items : []).map((item) =>
        String(item?.metrics_status) === "loading"
          ? { ...item, metrics_status: "pending", metrics_error_code: "" }
          : item
      );
      return {
        ...state,
        searchResults: resetLoading(state?.searchResults),
        searchPageCache: Object.fromEntries(
          Object.entries(state?.searchPageCache || {}).map(([page, items]) => [page, resetLoading(items)])
        ),
      };
    });
  }

  async function requestSearchCardMetrics(platform, item, signal) {
    const options = getOptions();
    if (typeof options.requestSearchCardMetrics === "function") {
      return options.requestSearchCardMetrics({ platform, item, signal });
    }

    const fetchFn = options.fetchFn || globalThis.fetch;
    const response = await fetchFn(
      buildVersionedUrl("/search-card-metrics", options.appConfigRef?.current?.frontendVersion),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          id: item.id,
          ...(platform === "missevan" && item.sound_id ? { soundId: item.sound_id } : {}),
        }),
        signal,
      }
    );
    return {
      response,
      payload: await (options.readJsonResponse || readJsonResponse)(response),
    };
  }

  async function refreshSearchMetricItems(platform, items, searchGeneration, controller, resultSource = "search") {
    const options = getOptions();
    const selectQueue = options.selectSearchMetricQueue || selectSearchMetricQueue;
    const queue = selectQueue(items, resultSource);
    if (!queue.length) {
      return;
    }

    let nextIndex = 0;
    const concurrency = platform === "manbo" ? 2 : 1;
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (nextIndex < queue.length && !controller.signal.aborted) {
        const item = queue[nextIndex];
        nextIndex += 1;
        try {
          patchSearchMetricItem(platform, item.id, {
            metrics_status: "loading",
            metrics_error_code: "",
          }, searchGeneration);

          let payload = null;
          while (!controller.signal.aborted) {
            const result = await requestSearchCardMetrics(platform, item, controller.signal);
            const response = result?.response;
            payload = result?.payload;
            if (response?.ok && payload?.success) {
              break;
            }

            const code = payload?.code || "UPSTREAM_ERROR";
            if (code === "METRICS_RATE_LIMITED" && resultSource === "manual") {
              const retryAfterSeconds = getResponseRetryAfterSeconds(response, payload);
              patchSearchMetricItem(platform, item.id, {
                metrics_status: "pending",
                metrics_error_code: code,
              }, searchGeneration);
              const waitForRetry = getOptions().waitForRetry || waitForSearchCardMetricRetry;
              await waitForRetry(controller.signal, retryAfterSeconds * 1000 + 250);
              patchSearchMetricItem(platform, item.id, {
                metrics_status: "loading",
                metrics_error_code: "",
              }, searchGeneration);
              continue;
            }

            const error = new Error(payload?.message || "动态指标获取失败。");
            error.code = code;
            throw error;
          }

          if (controller.signal.aborted || !payload?.success) {
            throw new DOMException("Aborted", "AbortError");
          }
          const mergeFields = getOptions().mergeMissingSearchCardFields || mergeMissingSearchCardFields;
          patchSearchMetricItem(platform, item.id, (currentItem) => ({
            ...(payload.metrics || {}),
            ...mergeFields(currentItem, payload.card_patch),
            metrics_status: "ready",
            metrics_error_code: "",
          }), searchGeneration);
        } catch (error) {
          const isAborted = (getOptions().isAbortError || isAbortError)(error) || controller.signal.aborted;
          if (isAborted) {
            patchSearchMetricItem(platform, item.id, { metrics_status: "pending" }, searchGeneration);
            continue;
          }
          patchSearchMetricItem(platform, item.id, {
            metrics_status: error?.code === "ACCESS_DENIED" ? "access_denied" : "error",
            metrics_error_code: error?.code || "UPSTREAM_ERROR",
          }, searchGeneration);
        }
      }
    });

    await Promise.all(workers);
  }

  function startRefresh(platform, items, searchGeneration, resultSource = "search") {
    const controller = new AbortController();
    activeControllers.add(controller);
    const promise = refreshSearchMetricItems(platform, items, searchGeneration, controller, resultSource)
      .finally(() => activeControllers.delete(controller));
    return { controller, promise };
  }

  function abortRefresh(session, platform, searchGeneration) {
    if (!session) {
      return;
    }
    session.controller?.abort();
    activeControllers.delete(session.controller);
    resetLoadingSearchMetricItems(platform, searchGeneration);
  }

  function retrySearchCardMetrics(item) {
    const platform = getOptions().activeBrowsePlatform;
    const state = getPlatformState(platform);
    const searchGeneration = Number(state?.searchGeneration ?? 0);
    if (!item?.id || !searchGeneration) {
      return null;
    }
    return startRefresh(
      platform,
      [{ ...item, metrics_status: "pending" }],
      searchGeneration,
      state?.searchResultSource
    );
  }

  function dispose() {
    activeControllers.forEach((controller) => controller.abort());
    activeControllers.clear();
  }

  return {
    abortRefresh,
    dispose,
    getActiveControllerCount: () => activeControllers.size,
    getCurrentBrowseState,
    patchSearchMetricItem,
    refreshSearchMetricItems,
    resetLoadingSearchMetricItems,
    retrySearchCardMetrics,
    startRefresh,
    updateOptions,
  };
}

export function useSearchCardMetrics(options = {}) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const controllerRef = useRef(null);
  if (!controllerRef.current) {
    controllerRef.current = createSearchCardMetricsController({
      getOptions: () => optionsRef.current,
    });
  }
  const controller = controllerRef.current;
  controller.updateOptions(options);

  const currentBrowseState = options.currentBrowseState || null;
  const searchGeneration = Number(currentBrowseState?.searchGeneration ?? 0);
  const searchResultCount = Array.isArray(currentBrowseState?.searchResults)
    ? currentBrowseState.searchResults.length
    : 0;

  useEffect(() => {
    if (!shouldLoadSearchMetrics(
      options.currentPlatform,
      options.activeSearchCategory,
      options.activeBrowsePlatform
    )) {
      return undefined;
    }

    // Only a new search generation or result count starts a queue. Metric patches
    // intentionally do not restart this effect, but scheduling reads this render's state.
    const scheduledBrowseState = controller.getCurrentBrowseState();
    const pendingItems = (scheduledBrowseState?.searchResults || []).filter((item) =>
      ["pending", "loading"].includes(String(item?.metrics_status || "pending"))
    );
    if (!searchGeneration || !pendingItems.length) {
      return undefined;
    }

    const session = controller.startRefresh(
      options.activeBrowsePlatform,
      pendingItems,
      searchGeneration,
      scheduledBrowseState?.searchResultSource
    );
    return () => {
      controller.abortRefresh(session, options.activeBrowsePlatform, searchGeneration);
    };
  }, [
    controller,
    options.activeBrowsePlatform,
    options.activeSearchCategory,
    options.currentPlatform,
    searchGeneration,
    searchResultCount,
  ]);

  useEffect(() => () => {
    controller.dispose();
  }, [controller]);

  return controller;
}
