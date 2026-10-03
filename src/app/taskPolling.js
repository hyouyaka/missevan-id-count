const DEFAULT_RETRY_DELAYS = [2000, 4000, 8000, 10000];

export class TaskSnapshotRequestError extends Error {
  constructor(message, { status = null, retryAfterMs = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "TaskSnapshotRequestError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export class TaskSnapshotInvalidResponseError extends Error {
  constructor(message = "统计任务返回了无效响应") {
    super(message);
    this.name = "TaskSnapshotInvalidResponseError";
  }
}

export class TaskPollingExhaustedError extends Error {
  constructor(taskId, cause = null) {
    super("统计任务连接持续失败，已停止等待。", cause ? { cause } : undefined);
    this.name = "TaskPollingExhaustedError";
    this.code = "TASK_POLLING_UNAVAILABLE";
    this.taskId = String(taskId ?? "").trim();
    this.cancelConfirmed = false;
  }
}

export function parseRetryAfter(value, now = Date.now()) {
  const header = String(value ?? "").trim();
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const retryAt = Date.parse(header);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - now) : null;
}

function createAbortError() {
  return new DOMException("Aborted", "AbortError");
}

function isAbortError(error) {
  return error?.name === "AbortError" || error?.code === "ABORT_ERR";
}

function isRetryableStatus(status) {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function isRetryableError(error) {
  if (!error || isAbortError(error) || error instanceof TaskSnapshotInvalidResponseError) {
    return false;
  }
  if (Number.isInteger(error.status)) {
    return isRetryableStatus(error.status);
  }
  if (error.retryable === false) {
    return false;
  }
  return true;
}

function validateSnapshot(snapshot, taskId) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new TaskSnapshotInvalidResponseError();
  }
  const allowedStatuses = new Set(["queued", "running", "completed", "failed", "cancelled"]);
  if (!allowedStatuses.has(snapshot.status)) {
    throw new TaskSnapshotInvalidResponseError();
  }
  if (snapshot.taskId != null && String(snapshot.taskId) !== String(taskId)) {
    throw new TaskSnapshotInvalidResponseError("统计任务响应与当前任务不匹配");
  }
  return snapshot;
}

function createAbortableRequest({ taskId, getSnapshot, signal, timeoutMs, setTimeoutFn, clearTimeoutFn }) {
  if (signal?.aborted) {
    return Promise.reject(createAbortError());
  }

  const requestController = new AbortController();
  let timeoutId = null;
  let timedOut = false;
  const timeoutError = new TaskSnapshotRequestError("统计任务请求超时", {
    cause: new Error(`Timed out after ${timeoutMs}ms`),
  });
  let removeAbortListener = () => {};
  const abortPromise = new Promise((_, reject) => {
    if (!signal) return;
    const handleAbort = () => {
      requestController.abort();
      reject(createAbortError());
    };
    signal.addEventListener("abort", handleAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", handleAbort);
  });
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeoutFn(() => {
      timedOut = true;
      reject(timeoutError);
      requestController.abort();
    }, timeoutMs);
  });
  const requestPromise = Promise.resolve().then(() => getSnapshot({ taskId, signal: requestController.signal }));

  return Promise.race([requestPromise, timeoutPromise, abortPromise])
    .catch((error) => {
      if (timedOut) throw timeoutError;
      throw error;
    })
    .finally(() => {
      if (timeoutId != null) clearTimeoutFn(timeoutId);
      removeAbortListener();
      if (signal?.aborted) requestController.abort();
    });
}

function waitForRetry(delayMs, signal, setTimeoutFn, clearTimeoutFn) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    let timer = null;
    const cleanup = () => {
      if (timer != null) clearTimeoutFn(timer);
      signal?.removeEventListener?.("abort", handleAbort);
    };
    const handleAbort = () => {
      cleanup();
      reject(createAbortError());
    };
    timer = setTimeoutFn(() => {
      cleanup();
      resolve();
    }, delayMs);
    signal?.addEventListener?.("abort", handleAbort, { once: true });
  });
}

export async function retryTransientGet({
  taskId = "",
  getResponse,
  validateResponse = (value) => value,
  signal,
  onConnectionState,
  now = Date.now,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
  sleepImpl = null,
  requestTimeoutMs = 15000,
  failureBudgetMs = 60000,
  retryDelays = DEFAULT_RETRY_DELAYS,
} = {}) {
  const normalizedTaskId = String(taskId ?? "").trim();
  if (typeof getResponse !== "function") {
    throw new TypeError("A GET request function is required");
  }

  const startedAt = now();
  let failures = 0;
  let lastError = null;
  while (true) {
    if (signal?.aborted) throw createAbortError();
    const remainingMs = Math.max(0, failureBudgetMs - (now() - startedAt));
    if (failures > 0 && remainingMs <= 0) {
      throw new TaskPollingExhaustedError(normalizedTaskId, lastError);
    }
    const timeoutMs = Math.min(requestTimeoutMs, remainingMs || requestTimeoutMs);

    try {
      const snapshot = await createAbortableRequest({
        taskId: normalizedTaskId,
        getSnapshot: getResponse,
        signal,
        timeoutMs,
        setTimeoutFn,
        clearTimeoutFn,
      });
      const validated = validateResponse(snapshot, normalizedTaskId);
      if (failures > 0) {
        try {
          onConnectionState?.({ retrying: false, taskId: normalizedTaskId });
        } catch (_) {
          // A status display callback must not fail an otherwise successful poll.
        }
      }
      return validated;
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) throw createAbortError();
      if (!isRetryableError(error)) throw error;
      lastError = error;
      failures += 1;
      const elapsedMs = Math.max(0, now() - startedAt);
      const remainingAfterFailure = Math.max(0, failureBudgetMs - elapsedMs);
      if (remainingAfterFailure <= 0) {
        throw new TaskPollingExhaustedError(normalizedTaskId, lastError);
      }
      const fallbackDelay = retryDelays[Math.min(failures - 1, retryDelays.length - 1)] ?? 10000;
      const retryAfterMs = Number.isFinite(error?.retryAfterMs) && error.retryAfterMs >= 0
        ? error.retryAfterMs
        : 0;
      const delayMs = Math.min(Math.max(fallbackDelay, retryAfterMs), remainingAfterFailure);
      try {
        onConnectionState?.({ retrying: true, attempt: failures, delayMs, taskId: normalizedTaskId });
      } catch (_) {
        // A status display callback must not interrupt task recovery.
      }
      if (typeof sleepImpl === "function") {
        await sleepImpl(delayMs, signal);
        if (signal?.aborted) throw createAbortError();
      } else {
        await waitForRetry(delayMs, signal, setTimeoutFn, clearTimeoutFn);
      }
      if (now() - startedAt >= failureBudgetMs) {
        throw new TaskPollingExhaustedError(normalizedTaskId, lastError);
      }
    }
  }
}

export function pollStatsTaskSnapshot(options = {}) {
  const taskId = String(options.taskId ?? "").trim();
  if (!taskId || typeof options.getSnapshot !== "function") {
    throw new TypeError("A taskId and getSnapshot function are required");
  }
  return retryTransientGet({
    ...options,
    taskId,
    getResponse: ({ taskId: activeTaskId, signal }) => options.getSnapshot({ taskId: activeTaskId, signal }),
    validateResponse: (snapshot) => validateSnapshot(snapshot, taskId),
  });
}
