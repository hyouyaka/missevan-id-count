function createPlatformMetrics() {
  return {
    active: 0,
    queued: 0,
    started: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    totalWaitMs: 0,
    totalRunMs: 0,
    finishedRuns: 0,
  };
}

export function createTaskMetrics({ now = Date.now } = {}) {
  const platforms = new Map();
  const timings = new Map();

  function getPlatform(task) {
    const key = String(task?.platform ?? "unknown");
    if (!platforms.has(key)) {
      platforms.set(key, createPlatformMetrics());
    }
    return platforms.get(key);
  }

  return {
    queued(task) {
      getPlatform(task).queued += 1;
      timings.set(String(task.taskId), { queuedAt: now(), startedAt: null });
    },

    rejected(task) {
      const metrics = getPlatform(task);
      metrics.queued = Math.max(0, metrics.queued - 1);
      timings.delete(String(task.taskId));
    },

    started(task) {
      const metrics = getPlatform(task);
      const timing = timings.get(String(task.taskId)) || { queuedAt: now() };
      timing.startedAt = now();
      timings.set(String(task.taskId), timing);
      metrics.queued = Math.max(0, metrics.queued - 1);
      metrics.active += 1;
      metrics.started += 1;
      metrics.totalWaitMs += Math.max(0, timing.startedAt - timing.queuedAt);
    },

    finished(task, status) {
      const metrics = getPlatform(task);
      const timing = timings.get(String(task.taskId));
      if (timing?.startedAt != null) {
        metrics.active = Math.max(0, metrics.active - 1);
        metrics.totalRunMs += Math.max(0, now() - timing.startedAt);
        metrics.finishedRuns += 1;
      } else {
        metrics.queued = Math.max(0, metrics.queued - 1);
      }
      if (status === "cancelled") {
        metrics.cancelled += 1;
      } else if (status === "failed") {
        metrics.failed += 1;
      } else {
        metrics.completed += 1;
      }
      timings.delete(String(task.taskId));
    },

    snapshot() {
      return {
        platforms: Object.fromEntries(
          [...platforms.entries()].map(([platform, metrics]) => [
            platform,
            {
              active: metrics.active,
              queued: metrics.queued,
              started: metrics.started,
              completed: metrics.completed,
              failed: metrics.failed,
              cancelled: metrics.cancelled,
              averageWaitMs: metrics.started > 0
                ? Math.round(metrics.totalWaitMs / metrics.started)
                : 0,
              averageRunMs: metrics.finishedRuns > 0
                ? Math.round(metrics.totalRunMs / metrics.finishedRuns)
                : 0,
            },
          ])
        ),
      };
    },
  };
}
