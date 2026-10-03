import {
  buildVersionedUrl,
  extractResponseItems,
  getBackendVersionFromResponse,
} from "@/app/app-utils";
import { cancelStatsTask, getStatsTaskSnapshot } from "@/app/statsTaskClient";
import {
  pollStatsTaskSnapshot,
  retryTransientGet,
  TaskPollingExhaustedError,
  TaskSnapshotInvalidResponseError,
  TaskSnapshotRequestError,
  parseRetryAfter,
} from "@/app/taskPolling";
import {
  saveSnapshot,
  updateFavoriteIfExists,
} from "@/app/favoritesStorage";
import {
  isMemberEpisode,
  isPaidEpisode,
} from "../../shared/episodeRules.js";

function getNullableFavoriteMetric(value) {
  if (value == null || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function addFavoriteMetricError(errors, metricErrors, metricKeys, message) {
  const normalizedMessage = String(message ?? "").trim() || "指标未获取";
  (Array.isArray(metricKeys) ? metricKeys : [metricKeys]).forEach((metricKey) => {
    metricErrors[metricKey] = normalizedMessage;
  });
  if (!errors.includes(normalizedMessage)) {
    errors.push(normalizedMessage);
  }
}

function countFavoriteMainCvNames(value) {
  const normalized = String(value ?? "").replace(/^主要CV：/, "").trim();
  if (!normalized || normalized === "暂无") {
    return 0;
  }
  return normalized.split(/[，,、/]/).map((item) => item.trim()).filter(Boolean).length;
}

async function parseVersionedJson(response, frontendVersion, handleVersionResponse) {
  let data;
  try {
    data = await response.json();
  } catch (error) {
    if (error?.name === "SyntaxError") {
      throw new TaskSnapshotInvalidResponseError("服务器返回了无效 JSON");
    }
    throw error;
  }
  handleVersionResponse?.({
    ...data,
    frontendVersion,
    backendVersion: getBackendVersionFromResponse(response, data),
  });
  return data;
}

async function postJson(path, payload, frontendVersion, handleVersionResponse, signal) {
  const response = await fetch(buildVersionedUrl(path, frontendVersion), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  const data = await parseVersionedJson(response, frontendVersion, handleVersionResponse);
  if (data?.accessDenied) {
    throw createFavoriteAccessDeniedError(data?.message || data?.error || "猫耳访问受限");
  }
  if (!response.ok) {
    throw new TaskSnapshotRequestError(data?.message || `请求失败：${response.status}`, {
      status: response.status,
      retryAfterMs: parseRetryAfter(response.headers?.get?.("Retry-After")),
    });
  }
  return data;
}

async function getJson(path, frontendVersion, handleVersionResponse, signal) {
  return retryTransientGet({
    signal,
    getResponse: async ({ signal: requestSignal }) => {
      const response = await fetch(buildVersionedUrl(path, frontendVersion), {
        cache: "no-store",
        signal: requestSignal,
      });
      if (!response.ok) {
        throw new TaskSnapshotRequestError(`请求失败：${response.status}`, {
          status: response.status,
          retryAfterMs: parseRetryAfter(response.headers?.get?.("Retry-After")),
        });
      }
      const data = await parseVersionedJson(response, frontendVersion, handleVersionResponse);
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new TaskSnapshotInvalidResponseError("服务器返回了无效响应");
      }
      if (data?.accessDenied) {
        throw createFavoriteAccessDeniedError(data?.message || data?.error || "猫耳访问受限");
      }
      return data;
    },
  });
}

async function wait(delayMs, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.("abort", handleAbort);
      resolve();
    }, delayMs);
    const handleAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener?.("abort", handleAbort, { once: true });
  });
}

class FavoriteAccessDeniedError extends Error {
  constructor(message = "猫耳访问受限") {
    super(message);
    this.name = "FavoriteAccessDeniedError";
    this.accessDenied = true;
    this.retryable = false;
  }
}

export function isFavoriteAccessDeniedError(error) {
  return error?.accessDenied === true || error?.name === "FavoriteAccessDeniedError";
}

function createFavoriteAccessDeniedError(message) {
  return new FavoriteAccessDeniedError(message);
}

function clampFavoriteProgress(value, maximum = 100) {
  const number = Number(value ?? 0);
  return Math.max(0, Math.min(Number.isFinite(number) ? number : 0, maximum));
}

function getStatsTaskProgressSnapshot(snapshot) {
  const queuePosition = Number(snapshot?.queuePosition ?? 0);
  return {
    ...snapshot,
    progress: clampFavoriteProgress(snapshot?.progress),
    currentAction: snapshot?.status === "queued" && queuePosition > 0
      ? `任务排队中，前方 ${queuePosition} 个任务`
      : snapshot?.currentAction || "统计中",
  };
}

export function getFavoriteBatchProgress(favoriteIndex, favoriteCount, favoriteProgress) {
  const count = Math.max(1, Number(favoriteCount ?? 0) || 1);
  const index = Math.max(0, Number(favoriteIndex ?? 0) || 0);
  const itemProgress = clampFavoriteProgress(favoriteProgress);
  return Math.min(99, Math.floor(((index + itemProgress / 100) / count) * 100));
}

async function runStatsTask({ platform, taskType, payload, frontendVersion, handleVersionResponse, onProgress, signal }) {
  const created = await postJson("/stat-tasks", { platform, taskType, ...payload }, frontendVersion, handleVersionResponse, signal);
  const taskId = String(created?.taskId ?? "").trim();
  if (!taskId) {
    throw new Error("统计任务创建失败");
  }

  let snapshot = created;
  let latestProgressSnapshot = getStatsTaskProgressSnapshot(snapshot);
  try {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    while (true) {
      const progressSnapshot = getStatsTaskProgressSnapshot(snapshot);
      latestProgressSnapshot = progressSnapshot;
      onProgress?.(progressSnapshot);
      if (platform === "missevan" && snapshot?.accessDenied) {
        throw createFavoriteAccessDeniedError(progressSnapshot.currentAction || snapshot.error || "猫耳访问受限");
      }
      if (snapshot.status === "completed") {
        return snapshot;
      }
      if (snapshot.status === "failed") {
        throw new Error(snapshot.error || "统计任务失败");
      }
      if (snapshot.status === "cancelled") {
        throw new Error("统计任务已取消");
      }
      await wait(1200, signal);
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      snapshot = await pollStatsTaskSnapshot({
        taskId,
        signal,
        getSnapshot: ({ taskId: activeTaskId, signal: requestSignal }) => getStatsTaskSnapshot(activeTaskId, {
          signal: requestSignal,
          frontendVersion,
          onVersionStatus: handleVersionResponse,
        }),
        onConnectionState: (state) => {
          if (state.retrying) {
            onProgress?.({ ...latestProgressSnapshot, currentAction: "连接异常，正在重试" });
          }
        },
      });
    }
  } catch (error) {
    if (error instanceof TaskPollingExhaustedError) {
      const outcome = await cancelStatsTask(taskId, { frontendVersion });
      error.cancelConfirmed = outcome.confirmed;
      error.message = outcome.confirmed
        ? "统计连接持续失败，服务器已确认取消该任务。"
        : "统计连接持续失败，已停止本地等待；服务器未确认任务已取消。";
    } else if (signal?.aborted) {
      const cancellationError = new Error("收藏刷新已停止；服务器任务取消状态未知。", { cause: error });
      cancellationError.name = "AbortError";
      cancellationError.serverCancelAttempted = true;
      cancellationError.cancelConfirmed = false;
      void cancelStatsTask(taskId, { frontendVersion });
      throw cancellationError;
    }
    throw error;
  }
}

function buildPaidEpisodePayload(platform, dramaInfo) {
  const drama = dramaInfo?.drama || {};
  const dramaId = String(drama.id ?? "").trim();
  const dramaTitle = String(drama.name ?? "").trim();
  const episodes = Array.isArray(dramaInfo?.episodes?.episode) ? dramaInfo.episodes.episode : [];
  return episodes
    .filter((episode) => isPaidEpisode(platform, episode) || isMemberEpisode(platform, episode))
    .map((episode) => ({
      drama_id: dramaId,
      sound_id: episode.sound_id,
      drama_title: dramaTitle,
      episode_title: episode.name,
      duration: Number(episode.duration ?? 0),
    }));
}

function getDramaCover(dramaInfo, fallback = "") {
  const drama = dramaInfo?.drama || {};
  return String(drama.cover ?? drama.cover_url ?? drama.coverUrl ?? fallback ?? "").trim();
}

async function fetchFavoriteDramaInfo(favorite, frontendVersion, handleVersionResponse, signal) {
  const path = favorite.platform === "manbo" ? "/manbo/getdramas" : "/getdramas";
  const data = await postJson(
    path,
    { drama_ids: [favorite.platform === "manbo" ? String(favorite.dramaId) : Number(favorite.dramaId)] },
    frontendVersion,
    handleVersionResponse,
    signal
  );
  const result = extractResponseItems(data)[0];
  if (favorite.platform === "missevan" && (data?.accessDenied || result?.accessDenied)) {
    throw createFavoriteAccessDeniedError(data?.message || result?.message || "猫耳访问受限");
  }
  if (!result?.success || !result?.info) {
    throw new Error(result?.message || "作品详情读取失败");
  }
  return result.info;
}

export async function fetchFavoriteMainCvText(favorite, frontendVersion, handleVersionResponse, signal) {
  const params = new URLSearchParams({
    platform: favorite.platform,
    dramaId: String(favorite.dramaId ?? ""),
  });
  const data = await getJson(`/favorites/meta?${params.toString()}`, frontendVersion, handleVersionResponse, signal);
  return String(data?.mainCvText ?? data?.main_cv_text ?? "").trim();
}

export async function refreshFavoriteSnapshot({ favorite, frontendVersion, handleVersionResponse, isDesktopApp = false, onProgress, signal }) {
  const capturedAt = Date.now();
  const errors = [];
  const metricErrors = {};
  onProgress?.({ progress: 0, currentAction: "读取作品详情" });
  const dramaInfo = await fetchFavoriteDramaInfo(favorite, frontendVersion, handleVersionResponse, signal);
  onProgress?.({ progress: 10, currentAction: "整理作品信息" });
  const drama = dramaInfo?.drama || {};
  const paidEpisodes = buildPaidEpisodePayload(favorite.platform, dramaInfo);
  let refreshedMainCvText = "";
  if (!isDesktopApp && countFavoriteMainCvNames(favorite.mainCvText) <= 2) {
    try {
      const fetchedMainCvText = await fetchFavoriteMainCvText(favorite, frontendVersion, handleVersionResponse, signal);
      if (countFavoriteMainCvNames(fetchedMainCvText) >= countFavoriteMainCvNames(favorite.mainCvText)) {
        refreshedMainCvText = fetchedMainCvText;
      }
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") throw error;
      if (isFavoriteAccessDeniedError(error)) {
        throw error;
      }
      console.warn("Failed to refresh favorite main CV", error);
    }
  }
  onProgress?.({ progress: 15, currentAction: "准备统计指标" });
  let paidIdCount = favorite.platform === "manbo" && paidEpisodes.length === 0 ? 0 : null;

  if (favorite.platform !== "missevan" && paidEpisodes.length > 0) {
    try {
      const idTask = await runStatsTask({
        platform: favorite.platform,
        taskType: "id",
        payload: { episodes: paidEpisodes, source: "favorite" },
        frontendVersion,
        handleVersionResponse,
        signal,
        onProgress: (snapshot) => onProgress?.({
          progress: 15 + Math.floor(clampFavoriteProgress(snapshot.progress) * 0.8),
          currentAction: snapshot.currentAction,
        }),
      });
      if (Number(idTask?.failedCount ?? 0) > 0) {
        throw new Error(idTask.currentAction || "付费 ID 统计部分失败");
      }
      if (!Array.isArray(idTask?.result?.idResults)) {
        throw new Error("付费 ID 统计未返回结果");
      }
      const userCounts = idTask.result.idResults.map((item) => getNullableFavoriteMetric(item?.users));
      if (userCounts.some((value) => value == null)) {
        throw new Error("付费 ID 统计结果不完整");
      }
      paidIdCount = userCounts.reduce((sum, value) => sum + value, 0);
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") throw error;
      const message = error instanceof Error ? error.message : String(error);
      addFavoriteMetricError(errors, metricErrors, "paidIdCount", message);
    }
  }

  let rewardCount = null;
  let rewardTotal = null;
  let giftTotal = getNullableFavoriteMetric(drama.diamond_value);
  let paidOrListenCount = null;

  if (favorite.platform === "missevan") {
    try {
      const revenueTask = await runStatsTask({
        platform: favorite.platform,
        taskType: "revenue",
        payload: { dramaIds: [Number(favorite.dramaId)], source: "favorite" },
        frontendVersion,
        handleVersionResponse,
        signal,
        onProgress: (snapshot) => onProgress?.({
          progress: 15 + Math.floor(clampFavoriteProgress(snapshot.progress) * 0.8),
          currentAction: snapshot.currentAction,
        }),
      });
      if (!Array.isArray(revenueTask?.result?.revenueResults)) {
        throw new Error("收益统计未返回结果");
      }
      const revenueResult = revenueTask.result.revenueResults
        .find((item) => String(item?.dramaId) === String(favorite.dramaId));
      if (!revenueResult) {
        throw new Error("收益统计未返回当前作品数据");
      }
      if (revenueResult.failed || Number(revenueTask?.failedCount ?? 0) > 0) {
        throw new Error(revenueResult.error || revenueTask.currentAction || "收益统计失败");
      }
      rewardCount = getNullableFavoriteMetric(revenueResult.rewardNum);
      rewardTotal = getNullableFavoriteMetric(revenueResult.rewardCoinTotal);
      paidIdCount = getNullableFavoriteMetric(
        revenueResult.seasonPaidUserCount ?? revenueResult.paidUserCount
      );
      if (rewardCount == null) {
        addFavoriteMetricError(errors, metricErrors, "rewardCount", "打赏人数未获取");
      }
      if (rewardTotal == null) {
        addFavoriteMetricError(errors, metricErrors, "rewardTotal", "打赏榜总和未获取");
      }
      if (paidIdCount == null) {
        addFavoriteMetricError(errors, metricErrors, "paidIdCount", "付费 ID 未获取");
      }
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") throw error;
      if (isFavoriteAccessDeniedError(error)) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      addFavoriteMetricError(errors, metricErrors, ["rewardCount", "rewardTotal", "paidIdCount"], message);
    }
  } else {
    const payCount = getNullableFavoriteMetric(drama.pay_count);
    const listenCount = getNullableFavoriteMetric(drama.member_listen_count);
    paidOrListenCount = payCount != null && payCount > 0
      ? payCount
      : listenCount != null && listenCount > 0
        ? listenCount
        : payCount === 0 || listenCount === 0
          ? 0
          : null;
    if (giftTotal == null) {
      addFavoriteMetricError(errors, metricErrors, "giftTotal", "总投喂未获取");
    }
    if (paidOrListenCount == null) {
      addFavoriteMetricError(errors, metricErrors, "paidOrListenCount", "付费/收听人数未获取");
    }
  }

  const viewCount = getNullableFavoriteMetric(drama.view_count);
  const subscriptionCount = getNullableFavoriteMetric(drama.subscription_num);
  if (viewCount == null) {
    addFavoriteMetricError(errors, metricErrors, "viewCount", "播放量未获取");
  }
  if (subscriptionCount == null) {
    addFavoriteMetricError(errors, metricErrors, "subscriptionCount", "追剧/收藏人数未获取");
  }

  const metrics = {
    viewCount,
    subscriptionCount,
    rewardCount,
    rewardTotal,
    giftTotal,
    paidOrListenCount,
    paidIdCount,
  };

  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  onProgress?.({ progress: 95, currentAction: "保存收藏历史" });
  const nextFavorite = await updateFavoriteIfExists(favorite.key, (activeFavorite) => ({
    ...activeFavorite,
    title: String(drama.name ?? activeFavorite.title ?? "").trim() || activeFavorite.title,
    cover: getDramaCover(dramaInfo, activeFavorite.cover),
    dramaUpdatedAt: String(drama.updated_at ?? drama.updatedAt ?? activeFavorite.dramaUpdatedAt ?? "").trim(),
    mainCvText: refreshedMainCvText || activeFavorite.mainCvText || "",
    updatedAt: capturedAt,
  }));
  if (!nextFavorite) {
    return null;
  }

  const snapshot = await saveSnapshot({
    id: `${favorite.key}:${capturedAt}`,
    favoriteKey: favorite.key,
    platform: favorite.platform,
    dramaId: favorite.dramaId,
    capturedAt,
    status: errors.length ? "partial" : "success",
    metrics,
    metricErrors,
    errors,
  });
  if (!snapshot) {
    return null;
  }
  onProgress?.({ progress: 100, currentAction: "收藏历史已保存" });
  return { favorite: nextFavorite, snapshot };
}


