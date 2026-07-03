function normalizeLimit(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : fallback;
}

function normalizePlatformLimits(limits = {}) {
  return {
    maxActive: normalizeLimit(limits.maxActive, 1),
    maxActivePerClient: normalizeLimit(limits.maxActivePerClient, 1),
    maxQueued: normalizeLimit(limits.maxQueued, 0),
    maxQueuedPerClient: normalizeLimit(limits.maxQueuedPerClient, 0),
  };
}

export function createStatsTaskScheduler({ limits = {}, execute } = {}) {
  if (typeof execute !== "function") {
    throw new TypeError("Stats task scheduler requires an execute function");
  }

  const states = new Map(
    Object.entries(limits).map(([platform, platformLimits]) => [
      platform,
      {
        limits: normalizePlatformLimits(platformLimits),
        active: new Map(),
        activeByClient: new Map(),
        queue: [],
      },
    ])
  );

  function getState(platform) {
    return states.get(String(platform ?? "").trim()) || null;
  }

  function getClientKey(task) {
    return String(task?.clientKey ?? "").trim() || "unknown";
  }

  function updateQueuePositions(state) {
    state.queue.forEach((task, index) => {
      task.queuePosition = index + 1;
    });
  }

  function getQueuedClientCount(state, clientKey) {
    return state.queue.reduce(
      (count, task) => count + (getClientKey(task) === clientKey ? 1 : 0),
      0
    );
  }

  function canStart(state, task) {
    if (state.active.size >= state.limits.maxActive) {
      return false;
    }
    const clientKey = getClientKey(task);
    return (state.activeByClient.get(clientKey) || 0) < state.limits.maxActivePerClient;
  }

  function drain(state) {
    while (state.active.size < state.limits.maxActive && state.queue.length > 0) {
      const nextIndex = state.queue.findIndex((task) => canStart(state, task));
      if (nextIndex < 0) {
        break;
      }
      const [task] = state.queue.splice(nextIndex, 1);
      updateQueuePositions(state);
      start(state, task);
    }
  }

  function start(state, task) {
    const clientKey = getClientKey(task);
    task.queuePosition = 0;
    state.active.set(task.taskId, task);
    state.activeByClient.set(clientKey, (state.activeByClient.get(clientKey) || 0) + 1);

    Promise.resolve()
      .then(() => execute(task))
      .catch(() => {})
      .finally(() => {
        state.active.delete(task.taskId);
        const nextClientCount = Math.max(0, (state.activeByClient.get(clientKey) || 1) - 1);
        if (nextClientCount > 0) {
          state.activeByClient.set(clientKey, nextClientCount);
        } else {
          state.activeByClient.delete(clientKey);
        }
        drain(state);
      });
  }

  return {
    enqueue(task) {
      const state = getState(task?.platform);
      if (!state) {
        throw new Error(`Unsupported stats task platform: ${task?.platform}`);
      }
      if (canStart(state, task) && state.queue.length === 0) {
        start(state, task);
        return { accepted: true, queuePosition: 0 };
      }

      const clientKey = getClientKey(task);
      if (getQueuedClientCount(state, clientKey) >= state.limits.maxQueuedPerClient) {
        return { accepted: false, code: "TASK_CLIENT_QUEUE_FULL" };
      }
      if (state.queue.length >= state.limits.maxQueued) {
        return { accepted: false, code: "TASK_QUEUE_FULL" };
      }

      state.queue.push(task);
      updateQueuePositions(state);
      drain(state);
      return {
        accepted: true,
        queuePosition: task.queuePosition,
      };
    },

    cancelQueued(taskId) {
      const normalizedTaskId = String(taskId ?? "");
      for (const state of states.values()) {
        const index = state.queue.findIndex((task) => String(task.taskId) === normalizedTaskId);
        if (index >= 0) {
          const [task] = state.queue.splice(index, 1);
          task.queuePosition = 0;
          updateQueuePositions(state);
          drain(state);
          return { cancelled: true, taskId: normalizedTaskId };
        }
      }
      return { cancelled: false, taskId: normalizedTaskId };
    },

    getQueuePosition(taskId) {
      const normalizedTaskId = String(taskId ?? "");
      for (const state of states.values()) {
        const index = state.queue.findIndex((task) => String(task.taskId) === normalizedTaskId);
        if (index >= 0) {
          return index + 1;
        }
      }
      return 0;
    },
  };
}
