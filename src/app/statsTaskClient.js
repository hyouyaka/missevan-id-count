import {
  buildVersionedUrl,
  getBackendVersionFromResponse,
  readJsonResponse,
} from "./app-utils.js";

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
    throw new Error(`${errorMessage}: ${response.status}`);
  }
  const data = await response.json();
  reportBackendVersion(response, data, frontendVersion, onVersionStatus);
  return data;
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
