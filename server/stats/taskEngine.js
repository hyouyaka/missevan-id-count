import { createStatsTaskScheduler } from "../../shared/statsTaskScheduler.js";
import { createTaskCancellationRegistry } from "./taskCancellation.js";
import { createTaskMetrics } from "./taskMetrics.js";
import {
  TERMINAL_TASK_STATUSES,
  applyTaskProgress,
  mergeCancelledTaskResult,
  transitionTask,
} from "./taskState.js";

function resetRecoveredTask(task, now) {
  return {
    ...task,
    status: "queued",
    resumed: true,
    attempt: Math.max(0, Number(task?.attempt ?? 0)) + 1,
    queuePosition: 0,
    progress: 0,
    completedCount: 0,
    failedCount: 0,
    totalDanmaku: 0,
    totalUsers: 0,
    accessDenied: false,
    cancelled: false,
    result: null,
    resultIncomplete: false,
    error: "",
    currentAction: "恢复任务排队中",
    updatedAt: now,
    lastSeenAt: now,
  };
}

function buildTaskSnapshot(task, queuePosition = 0) {
  if (!task) {
    return null;
  }
  return {
    taskId: task.taskId,
    platform: task.platform,
    taskType: task.taskType,
    status: task.status,
    progress: task.progress,
    currentAction: task.currentAction,
    totalCount: task.totalCount,
    completedCount: task.completedCount,
    failedCount: task.failedCount,
    totalDanmaku: task.totalDanmaku,
    totalUsers: task.totalUsers,
    accessDenied: task.accessDenied,
    source: task.source,
    resumed: Boolean(task.resumed),
    attempt: Math.max(1, Number(task.attempt ?? 1)),
    queuePosition: task.status === "queued" ? queuePosition : 0,
    result:
      task.status === "completed" || task.status === "cancelled"
        ? task.result
        : null,
    resultIncomplete:
      task.status === "cancelled" && task.result != null,
    error: task.error || "",
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    lastSeenAt: task.lastSeenAt,
  };
}

export function normalizeStatsTaskPersistenceDebounceMs(value = 10_000) {
  return Math.min(
    60_000,
    Math.max(
      1000,
      Number.isFinite(Number(value))
        ? Math.floor(Number(value))
        : 10_000
    )
  );
}

export function createStatsTaskEngine({
  limits,
  execute,
  store = null,
  metrics = createTaskMetrics(),
  persistenceDebounceMs = 10_000,
  retentionMs = Infinity,
  onRestore = null,
  onCompleted = null,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (typeof execute !== "function") {
    throw new TypeError("Stats task engine requires an execute function");
  }
  const normalizedPersistenceDebounceMs =
    normalizeStatsTaskPersistenceDebounceMs(persistenceDebounceMs);
  const cancellations = createTaskCancellationRegistry();
  const persistenceTimers = new Map();
  const tasks = new Map();
  let resolveReady;
  const readyPromise = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let restoreWork = null;

  function stamp(task) {
    task.updatedAt = now();
  }

  function persist(task, immediate = false) {
    if (!store?.save || !task?.taskId) {
      return null;
    }
    const taskId = String(task.taskId);
    const existingTimer = persistenceTimers.get(taskId);
    if (existingTimer) {
      clearTimer(existingTimer);
      persistenceTimers.delete(taskId);
    }
    if (immediate || TERMINAL_TASK_STATUSES.has(task.status)) {
      return Promise.resolve(store.save(task));
    }
    const timer = setTimer(() => {
      persistenceTimers.delete(taskId);
      void store.save(task);
    }, normalizedPersistenceDebounceMs);
    timer?.unref?.();
    persistenceTimers.set(taskId, timer);
    return null;
  }

  function report(task, patch) {
    if (!applyTaskProgress(task, patch)) {
      return false;
    }
    stamp(task);
    persist(task);
    return true;
  }

  function finalizeTaskInBackground(task, finalStatus) {
    const snapshot = buildTaskSnapshot(task);
    void (async () => {
      try {
        await persist(task, true);
      } catch (error) {
        console.error("Stats task final persistence failed", error);
      }
      if (finalStatus === "completed" && typeof onCompleted === "function") {
        try {
          await onCompleted(snapshot);
        } catch (error) {
          console.error("Stats task completion callback failed", error);
        }
      }
    })();
  }

  const scheduler = createStatsTaskScheduler({
    limits,
    async execute(task) {
      if (task.status === "cancelled" || task.cancelled) {
        return;
      }
      const signal = cancellations.create(task.taskId);
      Object.defineProperty(task, "abortSignal", {
        configurable: true,
        enumerable: false,
        value: signal,
      });
      transitionTask(task, "running", {
        queuePosition: 0,
        currentAction: task.currentAction || "统计中",
      });
      stamp(task);
      metrics.started(task);
      persist(task, true);
      let finalStatus = "completed";
      const executionTask = new Proxy(task, {
        set(target, property, value) {
          if (
            property === "status" ||
            TERMINAL_TASK_STATUSES.has(target.status)
          ) {
            return true;
          }
          return Reflect.set(target, property, value);
        },
      });
      try {
        const outcome = await execute(executionTask, {
          signal,
          report: (patch) => report(task, patch),
        });
        const cancelled =
          signal.aborted ||
          task.cancelled ||
          outcome?.status === "cancelled";
        if (cancelled) {
          if (!TERMINAL_TASK_STATUSES.has(task.status)) {
            transitionTask(task, "cancelled", {
              cancelled: true,
              currentAction: "统计已取消",
            });
          }
          mergeCancelledTaskResult(task, outcome?.patch);
          finalStatus = "cancelled";
        } else {
          transitionTask(task, "completed", outcome?.patch);
          finalStatus = task.status;
        }
      } catch (error) {
        if (signal.aborted || task.cancelled || task.status === "cancelled") {
          if (!TERMINAL_TASK_STATUSES.has(task.status)) {
            transitionTask(task, "cancelled", {
              cancelled: true,
              currentAction: "统计已取消",
            });
          }
          finalStatus = "cancelled";
        } else {
          transitionTask(task, "failed", {
            currentAction: "统计失败",
            error: error instanceof Error ? error.message : String(error),
          });
          finalStatus = "failed";
        }
      } finally {
        stamp(task);
        metrics.finished(task, finalStatus);
        cancellations.release(task.taskId);
        delete task.abortSignal;
        if (tasks.get(String(task.taskId)) === task) {
          finalizeTaskInBackground(task, finalStatus);
        }
      }
    },
  });

  function enqueue(task, { persistImmediately = true } = {}) {
    task.status = task.status || "queued";
    task.attempt = Math.max(1, Number(task.attempt ?? 1));
    metrics.queued(task);
    const result = scheduler.enqueue(task);
    if (!result.accepted) {
      metrics.rejected(task);
      return result;
    }
    task.queuePosition = result.queuePosition;
    tasks.set(String(task.taskId), task);
    persist(task, persistImmediately);
    return result;
  }

  function remove(taskId) {
    const key = String(taskId);
    const timer = persistenceTimers.get(key);
    if (timer) {
      clearTimer(timer);
      persistenceTimers.delete(key);
    }
    tasks.delete(key);
    return store?.remove?.(key);
  }

  return {
    enqueue,

    cancel(taskOrId) {
      const task = typeof taskOrId === "object"
        ? taskOrId
        : tasks.get(String(taskOrId));
      if (!task?.taskId) {
        return { found: false, changed: false, snapshot: null };
      }
      if (TERMINAL_TASK_STATUSES.has(task.status)) {
        return {
          found: true,
          changed: false,
          snapshot: this.getSnapshot(task.taskId),
        };
      }
      const wasQueued = task.status === "queued";
      const queued = scheduler.cancelQueued(task.taskId).cancelled;
      const running = cancellations.cancel(task.taskId);
      task.cancelled = true;
      transitionTask(task, "cancelled", {
        queuePosition: 0,
        currentAction: "统计已取消",
      });
      stamp(task);
      if (queued || (wasQueued && !running)) {
        metrics.finished(task, "cancelled");
      }
      persist(task, true);
      return {
        found: true,
        changed: queued || running || wasQueued,
        snapshot: this.getSnapshot(task.taskId),
      };
    },

    report(taskOrId, patch) {
      const task = typeof taskOrId === "object"
        ? taskOrId
        : tasks.get(String(taskOrId));
      return report(task, patch);
    },

    recordUpdate(task) {
      return report(task, task);
    },

    remove,

    getTask(taskId) {
      return tasks.get(String(taskId)) || null;
    },

    getSnapshot(taskId) {
      const task = tasks.get(String(taskId));
      return buildTaskSnapshot(
        task,
        task?.status === "queued"
          ? scheduler.getQueuePosition(task.taskId)
          : 0
      );
    },

    touch(taskId) {
      const task = tasks.get(String(taskId));
      if (!task) {
        return null;
      }
      task.lastSeenAt = now();
      return this.getSnapshot(taskId);
    },

    pruneExpired() {
      const currentTime = now();
      for (const [taskId, task] of tasks) {
        const updatedAt = Number(task?.updatedAt ?? task?.createdAt ?? 0);
        if (
          Number.isFinite(retentionMs) &&
          currentTime - updatedAt > retentionMs
        ) {
          this.cancel(taskId);
          void remove(taskId);
        }
      }
    },

    getQueuePosition(taskId) {
      return scheduler.getQueuePosition(taskId);
    },

    getMetrics() {
      return metrics.snapshot();
    },

    whenReady() {
      return readyPromise;
    },

    restore() {
      if (restoreWork) {
        return restoreWork;
      }
      restoreWork = (async () => {
        if (!store?.loadTasks) {
          return [];
        }
        const loaded = await store.loadTasks({
          now: now(),
          retentionMs,
        });
        const restored = [];
        for (const snapshot of loaded) {
          if (TERMINAL_TASK_STATUSES.has(snapshot.status)) {
            const task = { ...snapshot };
            tasks.set(String(task.taskId), task);
            onRestore?.(task);
            restored.push(task);
            continue;
          }
          const task = resetRecoveredTask(snapshot, now());
          const result = enqueue(task, { persistImmediately: true });
          if (!result.accepted) {
            transitionTask(task, "failed", {
              queuePosition: 0,
              currentAction: "任务恢复失败",
              error: result.code || "TASK_RESTORE_QUEUE_FULL",
            });
            tasks.set(String(task.taskId), task);
            persist(task, true);
            continue;
          }
          onRestore?.(task);
          restored.push(task);
        }
        return restored;
      })();
      restoreWork.then(resolveReady, () => resolveReady([]));
      return restoreWork;
    },
  };
}
