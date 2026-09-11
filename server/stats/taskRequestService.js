function getArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeItemLimit(value) {
  const limit = Number(value);
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 1000;
}

export function normalizeTaskEpisodes(rawEpisodes = []) {
  return getArray(rawEpisodes)
    .map((episode) => ({
      drama_id: String(episode?.drama_id ?? "").trim(),
      sound_id: String(episode?.sound_id ?? "").trim(),
      drama_title: String(episode?.drama_title ?? "").trim(),
      episode_title: String(episode?.episode_title ?? "").trim(),
      duration: Number(episode?.duration ?? 0),
    }))
    .filter((episode) => episode.sound_id);
}

export function normalizeTaskDramaIds(rawDramaIds = [], platform = "missevan") {
  return Array.from(
    new Set(
      getArray(rawDramaIds)
        .map((value) => String(value ?? "").trim())
        .filter((value) => /^\d+$/.test(value))
        .map((value) => (platform === "manbo" ? value : Number(value)))
    )
  );
}

export function getStatsTaskItemCounts({
  taskType = "",
  episodes = [],
  dramaIds = [],
  playCountDramas = [],
} = {}) {
  const normalizedPlayCountDramas = getArray(playCountDramas);
  return {
    primary:
      taskType === "revenue"
        ? getArray(dramaIds).length
        : getArray(episodes).length,
    playCountDramas: normalizedPlayCountDramas.length,
    playCountEpisodes: normalizedPlayCountDramas.reduce(
      (count, drama) => count + getArray(drama?.episodes).length,
      0
    ),
  };
}

export function isStatsTaskItemLimitExceeded(itemCounts, limit) {
  return (
    Number(itemCounts?.primary ?? 0) > limit ||
    Number(itemCounts?.playCountDramas ?? 0) > limit ||
    Number(itemCounts?.playCountEpisodes ?? 0) > limit
  );
}

export function createStatsTaskRequestService({
  cleanupExpiredStatsTasks = () => {},
  createTaskId,
  getItemCounts = getStatsTaskItemCounts,
  isItemLimitExceeded = isStatsTaskItemLimitExceeded,
  itemLimit,
  normalizeEpisodes = normalizeTaskEpisodes,
  normalizeDramaIds = normalizeTaskDramaIds,
  normalizePlayCountDramas = () => [],
  normalizeSource = (value) => String(value ?? "").trim(),
  now = Date.now,
  statsTaskEngine,
} = {}) {
  if (typeof createTaskId !== "function") {
    throw new TypeError("Stats task request service requires createTaskId");
  }
  if (!statsTaskEngine?.enqueue || !statsTaskEngine?.getSnapshot || !statsTaskEngine?.touch || !statsTaskEngine?.report) {
    throw new TypeError("Stats task request service requires a stats task engine");
  }

  const maxItems = normalizeItemLimit(itemLimit);

  function createStatsTask({
    platform,
    taskType,
    episodes = [],
    dramaIds = [],
    playCountDramas = [],
    source = "",
    clientKey = "unknown",
  }) {
    const task = {
      taskId: createTaskId(),
      platform,
      taskType,
      status: "queued",
      progress: 0,
      currentAction: "任务已创建",
      totalCount: taskType === "revenue" ? dramaIds.length : episodes.length,
      completedCount: 0,
      failedCount: 0,
      totalDanmaku: 0,
      totalUsers: 0,
      accessDenied: false,
      source: normalizeSource(source),
      clientKey: String(clientKey ?? "").trim() || "unknown",
      queuePosition: 0,
      episodes,
      dramaIds,
      playCountDramas,
      result: null,
      error: "",
      cancelled: false,
      createdAt: now(),
      updatedAt: now(),
      lastSeenAt: now(),
    };

    cleanupExpiredStatsTasks();
    return task;
  }

  function getStatsTaskSnapshotOr404(taskId, res, { touch = false } = {}) {
    cleanupExpiredStatsTasks();
    const snapshot = touch
      ? statsTaskEngine.touch(taskId)
      : statsTaskEngine.getSnapshot(taskId);
    if (!snapshot) {
      res.status(404).json({ error: "Task not found" });
      return null;
    }
    return snapshot;
  }

  function createStatsTaskFromRequest(req, res, forcedPlatform = null, defaultTaskType = null) {
    const platform =
      forcedPlatform || (req.body?.platform === "manbo" ? "manbo" : "missevan");
    const taskType = String(req.body?.taskType ?? "").trim();
    const normalizedTaskType = taskType || defaultTaskType || "";
    const episodes = normalizeEpisodes(req.body?.episodes);
    const dramaIds = normalizeDramaIds(req.body?.dramaIds, platform);
    const playCountDramas = platform === "missevan" && normalizedTaskType === "play_count"
      ? normalizePlayCountDramas(req.body?.playCountDramas)
      : [];
    const source = normalizeSource(req.body?.source);
    const itemCounts = getItemCounts({
      taskType: normalizedTaskType,
      episodes,
      dramaIds,
      playCountDramas,
    });

    if (!["play_count", "id", "revenue"].includes(normalizedTaskType)) {
      res.status(400).json({ error: "Invalid taskType" });
      return null;
    }

    if (normalizedTaskType === "revenue" && !dramaIds.length) {
      res.status(400).json({ error: "Missing dramaIds" });
      return null;
    }

    if (normalizedTaskType !== "revenue" && !episodes.length) {
      res.status(400).json({ error: "Missing episodes" });
      return null;
    }

    if (isItemLimitExceeded(itemCounts, maxItems)) {
      res.status(400).json({
        success: false,
        code: "TASK_ITEM_LIMIT_EXCEEDED",
        message: `单次统计最多处理 ${maxItems} 个条目。`,
        limit: maxItems,
      });
      return null;
    }

    const task = createStatsTask({
      platform,
      taskType: normalizedTaskType,
      episodes,
      dramaIds,
      playCountDramas,
      source,
      clientKey: req.ip,
    });
    const enqueueResult = statsTaskEngine.enqueue(task);
    if (!enqueueResult.accepted) {
      const code = enqueueResult.code === "TASK_CLIENT_QUEUE_FULL"
        ? "TASK_CLIENT_QUEUE_FULL"
        : "TASK_QUEUE_FULL";
      const message = code === "TASK_CLIENT_QUEUE_FULL"
        ? "当前设备排队中的统计任务已达上限，请稍后重试。"
        : "统计任务队列已满，请稍后重试。";
      res.setHeader("Retry-After", "30");
      res.status(429).json({
        success: false,
        code,
        message,
        platform,
        retryAfterSeconds: 30,
      });
      return null;
    }
    task.queuePosition = enqueueResult.queuePosition;
    if (task.queuePosition > 0) {
      statsTaskEngine.report(task.taskId, {
        currentAction: `任务排队中，前方 ${task.queuePosition} 个任务`,
      });
    }
    return task;
  }

  return {
    createStatsTask,
    createStatsTaskFromRequest,
    getStatsTaskSnapshotOr404,
  };
}

