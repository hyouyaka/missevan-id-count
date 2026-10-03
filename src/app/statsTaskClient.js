import {
  buildVersionedUrl,
  getBackendVersionFromResponse,
  readJsonResponse,
} from "./app-utils.js";
import {
  pollStatsTaskSnapshot,
  parseRetryAfter,
  TaskSnapshotInvalidResponseError,
  TaskSnapshotRequestError,
} from "./taskPolling.js";

function getFetchImplementation(fetchImpl) {
  if (typeof fetchImpl === "function") {
    return fetchImpl;
  }
  if (typeof globalThis.fetch === "function") {
    return globalThis.fetch.bind(globalThis);
  }
  throw new Error("Fetch is unavailable");
}

function reportBackendVersion(response, data, frontendVersion, onVersionStatus) {
  onVersionStatus?.({
    backendVersion: getBackendVersionFromResponse(response, data),
    frontendVersion,
  });
}

export function buildStatsTaskSnapshotUrl(taskId, now = Date.now) {
  const normalizedTaskId = String(taskId ?? "").trim();
  return `/stat-tasks/${normalizedTaskId}?_ts=${now()}`;
}

export async function createStatsTask({
  platform,
  taskType,
  payload = {},
  signal,
  frontendVersion,
  onVersionStatus,
  fetchImpl,
  errorMessage = "Failed to create stats task",
} = {}) {
  const response = await getFetchImplementation(fetchImpl)(
    buildVersionedUrl("/stat-tasks", frontendVersion),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform,
        taskType,
        ...payload,
      }),
      signal,
    }
  );
  const data = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `${errorMessage}: ${response.status}`);
  }
  reportBackendVersion(response, data, frontendVersion, onVersionStatus);
  return data;
}

export async function getStatsTaskSnapshot(taskId, {
  signal,
  frontendVersion,
  onVersionStatus,
  fetchImpl,
  now,
  errorMessage = "Failed to fetch stats task",
} = {}) {
  const response = await getFetchImplementation(fetchImpl)(
    buildVersionedUrl(buildStatsTaskSnapshotUrl(taskId, now), frontendVersion),
    {
      signal,
      cache: "no-store",
    }
  );
  if (!response.ok) {
    throw new TaskSnapshotRequestError(`${errorMessage}: ${response.status}`, {
      status: response.status,
      retryAfterMs: parseRetryAfter(response.headers?.get?.("Retry-After")),
    });
  }
  let data;
  try {
    data = await response.json();
  } catch (error) {
    if (error?.name === "SyntaxError") {
      throw new TaskSnapshotInvalidResponseError("统计任务返回了无效 JSON");
    }
    throw error;
  }
  reportBackendVersion(response, data, frontendVersion, onVersionStatus);
  return data;
}

export function getStatsTaskSnapshotWithRetry(taskId, options = {}) {
  return pollStatsTaskSnapshot({
    taskId,
    signal: options.signal,
    onConnectionState: options.onConnectionState,
    now: options.now,
    setTimeoutFn: options.setTimeoutFn,
    clearTimeoutFn: options.clearTimeoutFn,
    sleepImpl: options.sleepImpl,
    requestTimeoutMs: options.requestTimeoutMs,
    failureBudgetMs: options.failureBudgetMs,
    retryDelays: options.retryDelays,
    getSnapshot: ({ taskId: activeTaskId, signal }) => getStatsTaskSnapshot(activeTaskId, {
      ...options,
      signal,
    }),
  });
}

export async function cancelStatsTask(taskId, {
  signal,
  frontendVersion,
  fetchImpl,
  timeoutMs = 5000,
} = {}) {
  const normalizedTaskId = String(taskId ?? "").trim();
  if (!normalizedTaskId || signal?.aborted) return { confirmed: false, snapshot: null };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener?.("abort", onAbort, { once: true });
  try {
    const response = await getFetchImplementation(fetchImpl)(
      buildVersionedUrl(`/stat-tasks/${normalizedTaskId}/cancel`, frontendVersion),
      { method: "POST", signal: controller.signal }
    );
    if (!response.ok) return { confirmed: false, status: response.status, snapshot: null };
    const snapshot = await response.json().catch(() => null);
    return {
      confirmed: snapshot?.status === "cancelled" && String(snapshot?.taskId ?? "") === normalizedTaskId,
      status: response.status,
      snapshot,
    };
  } catch (error) {
    return { confirmed: false, status: null, snapshot: null, error };
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener?.("abort", onAbort);
  }
}

export function notifyStatsTaskCancel(taskId, {
  navigatorLike = typeof navigator === "undefined" ? null : navigator,
  fetchImpl,
} = {}) {
  const normalizedTaskId = String(taskId ?? "").trim();
  if (!normalizedTaskId) {
    return;
  }

  const url = `/stat-tasks/${normalizedTaskId}/cancel`;
  try {
    if (typeof navigatorLike?.sendBeacon === "function") {
      const queued = navigatorLike.sendBeacon(url);
      if (queued === true) {
        return;
      }
    }
  } catch (_) {
    // Fall through to the keepalive request when sendBeacon is unavailable.
  }

  try {
    Promise.resolve(
      getFetchImplementation(fetchImpl)(url, { method: "POST", keepalive: true })
    ).catch(() => {});
  } catch (_) {
    // Page teardown should not surface a cancellation transport error.
  }
}
