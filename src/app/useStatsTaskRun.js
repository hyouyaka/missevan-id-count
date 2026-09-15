import { useRef } from "react";

function createAbortError() {
  return new DOMException("Aborted", "AbortError");
}

function getTimerApi(options) {
  return {
    setIntervalFn: options?.setIntervalFn || globalThis.setInterval,
    clearIntervalFn: options?.clearIntervalFn || globalThis.clearInterval,
    setTimeoutFn: options?.setTimeoutFn || globalThis.setTimeout,
    clearTimeoutFn: options?.clearTimeoutFn || globalThis.clearTimeout,
  };
}

export function waitForStatsTaskPoll(signal, delayMs = 2000, options = {}) {
  const { setTimeoutFn, clearTimeoutFn } = getTimerApi(options);
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    let settled = false;
    let timer = null;
    const cleanup = () => {
      if (timer != null) {
        clearTimeoutFn(timer);
        timer = null;
      }
      signal?.removeEventListener?.("abort", handleAbort);
    };
    const complete = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    };
    const handleAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(createAbortError());
    };

    timer = setTimeoutFn(complete, delayMs);
    signal?.addEventListener?.("abort", handleAbort, { once: true });
  });
}

function getTaskId(value) {
  return String(value ?? "").trim();
}

function getRunKey(platform, runId) {
  return `${platform}:${runId}`;
}

function cloneRunData(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

export function createStatsTaskRunController(initialOptions = {}) {
  let latestOptions = initialOptions;
  const contexts = new Map();
  const activeContexts = new Map();

  function getOptions() {
    return typeof initialOptions.getOptions === "function"
      ? initialOptions.getOptions() || {}
      : latestOptions || {};
  }

  function updateOptions(nextOptions) {
    latestOptions = nextOptions || {};
  }

  function getMeta(platform) {
    const meta = getOptions().getRuntimeMeta?.(platform);
    if (!meta) {
      throw new Error(`Missing stats runtime metadata for ${platform}`);
    }
    return meta;
  }

  function getContext(platform, runId) {
    return contexts.get(getRunKey(platform, runId)) || null;
  }

  function isCurrent(context) {
    return Boolean(
      context &&
        context.isActive &&
        activeContexts.get(context.platform) === context &&
        getMeta(context.platform).activeRunId === context.runId
    );
  }

  function clearContextTimer(context) {
    if (context?.elapsedTimer == null) {
      return;
    }
    const { clearIntervalFn } = getTimerApi(getOptions());
    clearIntervalFn(context.elapsedTimer);
    if (context.meta.activeElapsedTimer === context.elapsedTimer) {
      context.meta.activeElapsedTimer = null;
    }
    context.elapsedTimer = null;
  }

  function deactivateContext(context, { abort = false } = {}) {
    if (!context) {
      return;
    }
    context.isActive = false;
    if (abort) {
      context.abortController?.abort?.();
    }
    clearContextTimer(context);
    if (activeContexts.get(context.platform) === context) {
      activeContexts.delete(context.platform);
    }
    if (context.meta.activeAbortController === context.abortController) {
      context.meta.activeAbortController = null;
    }
    if (context.meta.activeTaskId === context.activeTaskId) {
      context.meta.activeTaskId = "";
    }
  }

  function retireContext(context) {
    if (context && !context.isActive) {
      contexts.delete(getRunKey(context.platform, context.runId));
    }
  }

  function throwIfNotCurrent(context) {
    if (isCurrent(context)) {
      return;
    }
    retireContext(context);
    throw createAbortError();
  }

  function requestTaskCancel(taskId) {
    const normalizedTaskId = getTaskId(taskId);
    if (!normalizedTaskId) {
      return;
    }
    try {
      Promise.resolve(getOptions().notifyTaskCancel?.(normalizedTaskId)).catch(() => {});
    } catch (_) {
      // Cancelling must never replace the original task error or teardown path.
    }
  }

  function beginRun(platform, runData = null) {
    const meta = getMeta(platform);
    const previous = activeContexts.get(platform);
    if (previous) {
      const previousTaskId = previous.activeTaskId;
      deactivateContext(previous, { abort: true });
      retireContext(previous);
      requestTaskCancel(previousTaskId);
    }
    if (meta.activeElapsedTimer != null) {
      const { clearIntervalFn } = getTimerApi(getOptions());
      clearIntervalFn(meta.activeElapsedTimer);
      meta.activeElapsedTimer = null;
    }

    meta.activeRunId += 1;
    const abortController = new AbortController();
    const startedAt = (getOptions().now || Date.now)();
    const context = {
      platform,
      runId: meta.activeRunId,
      meta,
      startedAt,
      abortController,
      elapsedTimer: null,
      activeTaskId: "",
      isActive: true,
      runData: cloneRunData(runData),
    };
    contexts.set(getRunKey(platform, context.runId), context);
    activeContexts.set(platform, context);
    meta.activeAbortController = abortController;
    meta.activeTaskId = "";

    getOptions().onRunStarted?.({ platform, runId: context.runId, startedAt });

    const { setIntervalFn } = getTimerApi(getOptions());
    context.elapsedTimer = setIntervalFn(() => {
      if (!isCurrent(context)) {
        return;
      }
      const elapsedMs = Math.max(0, (getOptions().now || Date.now)() - startedAt);
      getOptions().onElapsed?.({ platform, runId: context.runId, startedAt, elapsedMs });
    }, 1000);
    meta.activeElapsedTimer = context.elapsedTimer;

    return {
      runId: context.runId,
      signal: abortController.signal,
    };
  }

  function isRunActive(platform, runId) {
    return isCurrent(getContext(platform, runId));
  }

  function cancelRun(platform) {
    const context = activeContexts.get(platform);
    const meta = getMeta(platform);
    const options = getOptions();
    const taskId = getTaskId(
      context?.activeTaskId || meta.activeTaskId || options.getActiveTaskId?.(platform)
    );
    const wasRunning = Boolean(
      context?.isActive || options.isRunMarkedRunning?.(platform) || taskId
    );
    const startedAt = context?.startedAt ?? options.getRunStartedAt?.(platform) ?? 0;

    if (context) {
      deactivateContext(context, { abort: true });
      retireContext(context);
    } else {
      meta.activeAbortController?.abort?.();
      meta.activeAbortController = null;
      if (meta.activeElapsedTimer != null) {
        const { clearIntervalFn } = getTimerApi(options);
        clearIntervalFn(meta.activeElapsedTimer);
        meta.activeElapsedTimer = null;
      }
      meta.activeTaskId = "";
    }

    options.onRunCancelled?.({ platform, taskId, wasRunning, startedAt });
    requestTaskCancel(taskId);
    return taskId;
  }

  function finishRun(platform, runId, status = "completed") {
    const context = getContext(platform, runId);
    if (!isCurrent(context)) {
      retireContext(context);
      return false;
    }
    const startedAt = context.startedAt;
    deactivateContext(context);
    getOptions().onRunFinished?.({ platform, runId, status, startedAt });
    retireContext(context);
    return true;
  }

  async function startStatsTask(platform, taskType, payload, runId, signal) {
    const context = getContext(platform, runId);
    throwIfNotCurrent(context);

    let task;
    try {
      task = await getOptions().createTask?.({ platform, taskType, payload, signal });
    } catch (error) {
      if (!isCurrent(context)) {
        retireContext(context);
        throw createAbortError();
      }
      throw error;
    }

    const taskId = getTaskId(task?.taskId);
    const resolvedTaskType = task?.taskType || taskType;
    context.activeTaskId = taskId;

    if (!isCurrent(context)) {
      requestTaskCancel(taskId);
      retireContext(context);
      throw createAbortError();
    }
    context.meta.activeTaskId = taskId;
    getOptions().onTaskCreated?.({
      platform,
      runId,
      taskId,
      taskType: resolvedTaskType,
      task,
    });
    getOptions().onSnapshot?.({ platform, runId, taskId, taskType: resolvedTaskType, snapshot: task });
    if (!taskId) {
      throw new Error("Stats task missing taskId");
    }

    const readSnapshot = async () => {
      let snapshot;
      try {
        snapshot = await getOptions().getTaskSnapshot?.({ taskId, signal });
      } catch (error) {
        if (!isCurrent(context)) {
          retireContext(context);
          throw createAbortError();
        }
        throw error;
      }
      if (!isCurrent(context)) {
        retireContext(context);
        throw createAbortError();
      }
      getOptions().onSnapshot?.({ platform, runId, taskId, taskType: resolvedTaskType, snapshot });
      return snapshot;
    };

    const processTerminalSnapshot = (snapshot) => {
      if (!snapshot) {
        return true;
      }
      if (snapshot.status === "completed") {
        getOptions().onCompleted?.({ platform, runId, taskId, taskType: resolvedTaskType, snapshot, runData: context.runData });
        return true;
      }
      if (snapshot.status === "cancelled") {
        throw createAbortError();
      }
      if (snapshot.status === "failed") {
        throw new Error(snapshot.error || "Stats task failed");
      }
      return false;
    };

    const initialSnapshot = await readSnapshot();
    if (processTerminalSnapshot(initialSnapshot)) {
      return;
    }

    while (isCurrent(context) && context.activeTaskId === taskId) {
      const options = getOptions();
      try {
        if (typeof options.waitForPoll === "function") {
          await options.waitForPoll(signal, 2000);
        } else {
          await waitForStatsTaskPoll(signal, 2000, options);
        }
      } catch (error) {
        if (!isCurrent(context)) {
          retireContext(context);
          throw createAbortError();
        }
        throw error;
      }
      const snapshot = await readSnapshot();
      if (processTerminalSnapshot(snapshot)) {
        return;
      }
    }
    throwIfNotCurrent(context);
    throw createAbortError();
  }

  function notifyAllActiveTaskCancels() {
    const taskIds = new Set();
    activeContexts.forEach((context) => {
      const taskId = getTaskId(context.activeTaskId);
      if (taskId) {
        taskIds.add(taskId);
      }
    });
    const knownTaskIds = getOptions().getActiveTaskIds?.();
    (Array.isArray(knownTaskIds) ? knownTaskIds : []).forEach((taskId) => {
      const normalizedTaskId = getTaskId(taskId);
      if (normalizedTaskId) {
        taskIds.add(normalizedTaskId);
      }
    });
    taskIds.forEach(requestTaskCancel);
    return Array.from(taskIds);
  }

  function dispose() {
    Array.from(activeContexts.values()).forEach((context) => {
      deactivateContext(context, { abort: true });
      retireContext(context);
    });
    contexts.clear();
  }

  return {
    beginRun,
    cancelRun,
    dispose,
    finishRun,
    isRunActive,
    getContextCounts() {
      return {
        active: activeContexts.size,
        total: contexts.size,
      };
    },
    notifyAllActiveTaskCancels,
    startStatsTask,
    updateOptions,
  };
}

export function useStatsTaskRun(options) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const controllerRef = useRef(null);
  if (!controllerRef.current) {
    controllerRef.current = createStatsTaskRunController({
      getOptions: () => optionsRef.current,
    });
  }
  controllerRef.current.updateOptions(options);
  return controllerRef.current;
}
