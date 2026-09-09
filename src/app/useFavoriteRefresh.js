import { useRef } from "react";
import { toast } from "sonner";

import {
  getFavoriteByKey,
  saveSnapshot,
} from "@/app/favoritesStorage";
import {
  getFavoriteBatchProgress,
  isFavoriteAccessDeniedError,
  refreshFavoriteSnapshot,
} from "@/app/favoritesRefreshService";

export function useFavoriteRefresh({
  frontendVersion,
  getAccessDeniedText,
  handleVersionResponse,
  isDesktopApp,
  onBackgroundTaskChange,
  onClearSelection,
  onFavoritesChange,
  onRefreshSettled,
  onRefreshStateChange,
  onReloadSnapshots,
  renderAccessDeniedMessage,
  statisticsActionsDisabled,
}) {
  const refreshLockRef = useRef(false);

  async function refreshMany(targetFavorites) {
    if (refreshLockRef.current) {
      return;
    }
    if (statisticsActionsDisabled) {
      toast.warning("后台任务运行中，请等待完成后再刷新收藏。");
      return;
    }
    const queue = (Array.isArray(targetFavorites) ? targetFavorites : []).filter(Boolean);
    if (!queue.length) {
      toast.warning("请先选择收藏作品。");
      return;
    }
    refreshLockRef.current = true;
    let failedCount = 0;
    let partialCount = 0;
    let stoppedByAccessDenied = false;
    let unexpectedFailure = false;
    let latestProgress = 0;
    let finalAction = "收藏刷新完成";
    function reportFavoriteProgress(index, favorite, itemProgress, currentAction) {
      latestProgress = Math.max(latestProgress, getFavoriteBatchProgress(index, queue.length, itemProgress));
      const favoriteTitle = favorite.title || "收藏作品";
      const action = currentAction || "正在刷新";
      const description = action.includes(favoriteTitle) ? action : `${favoriteTitle} · ${action}`;
      onRefreshStateChange({
        isRunning: true,
        progress: latestProgress,
        currentTitle: favoriteTitle,
        currentAction: action,
      });
      onBackgroundTaskChange({
        isRunning: true,
        status: "running",
        type: "favorites_refresh",
        title: "收藏刷新",
        description,
        progress: latestProgress,
        action: description,
        resultTarget: "favorites",
        highlighted: true,
      });
    }
    try {
      onRefreshStateChange({ isRunning: true, progress: 0, currentTitle: "", currentAction: "正在准备刷新收藏" });
      onBackgroundTaskChange({
        isRunning: true,
        status: "running",
        type: "favorites_refresh",
        title: "收藏刷新",
        description: "正在准备刷新收藏",
        progress: 0,
        action: "正在准备刷新收藏",
        resultTarget: "favorites",
        highlighted: true,
      });
      for (let index = 0; index < queue.length; index += 1) {
        const favorite = queue[index];
        reportFavoriteProgress(index, favorite, 0, "读取作品详情");
        try {
          const refreshed = await refreshFavoriteSnapshot({
            favorite,
            frontendVersion,
            handleVersionResponse,
            isDesktopApp,
            onProgress: ({ progress, currentAction }) => reportFavoriteProgress(index, favorite, progress, currentAction),
          });
          if (!refreshed) {
            reportFavoriteProgress(index, favorite, 100, "收藏已移除，跳过保存");
          } else if (refreshed.snapshot?.status === "partial") {
            partialCount += 1;
          }
        } catch (error) {
          if (isFavoriteAccessDeniedError(error)) {
            stoppedByAccessDenied = true;
            finalAction = getAccessDeniedText?.() || "猫耳访问受限";
            console.warn("Stopped favorite refresh because Missevan access is denied", error);
            break;
          }
          const activeFavorite = await getFavoriteByKey(favorite.key).catch(() => null);
          if (!activeFavorite) {
            reportFavoriteProgress(index, favorite, 100, "收藏已移除，跳过保存");
            continue;
          }
          failedCount += 1;
          console.error("Failed to refresh favorite", error);
          const failedCapturedAt = Date.now();
          const failedSnapshot = await saveSnapshot({
            id: `${favorite.key}:${failedCapturedAt}`,
            favoriteKey: favorite.key,
            platform: favorite.platform,
            dramaId: favorite.dramaId,
            capturedAt: failedCapturedAt,
            status: "failed",
            metrics: {},
            metricErrors: {},
            errors: [error instanceof Error ? error.message : String(error)],
          }).catch((saveError) => {
            console.error("Failed to save favorite failure snapshot", saveError);
            return null;
          });
          reportFavoriteProgress(
            index,
            favorite,
            100,
            failedSnapshot ? "刷新失败，已保存失败记录" : "刷新失败，失败记录未能保存"
          );
        }
      }
      await onReloadSnapshots?.();
      await onFavoritesChange?.();
      if (stoppedByAccessDenied) {
        toast.error(renderAccessDeniedMessage?.() ?? getAccessDeniedText?.() ?? "猫耳访问受限");
      } else if (failedCount > 0 || partialCount > 0) {
        const issueParts = [
          failedCount > 0 ? `${failedCount} 部作品刷新失败` : "",
          partialCount > 0 ? `${partialCount} 部作品部分指标未获取` : "",
        ].filter(Boolean);
        finalAction = `${issueParts.join("，")}。`;
        toast.warning(`刷新完成，${finalAction}`);
      } else {
        finalAction = "收藏统计记录已更新。";
        toast.success("收藏刷新完成。");
      }
      if (!stoppedByAccessDenied) {
        onClearSelection?.();
      }
      const terminalProgress = stoppedByAccessDenied ? latestProgress : 100;
      onBackgroundTaskChange({
        isRunning: false,
        status: stoppedByAccessDenied || failedCount > 0 ? "failed" : "completed",
        type: "favorites_refresh",
        title: stoppedByAccessDenied
          ? "收藏刷新已停止"
          : failedCount > 0
            ? "收藏刷新完成，部分失败"
            : partialCount > 0
              ? "收藏刷新完成，部分指标未获取"
              : "收藏刷新完成",
        description: stoppedByAccessDenied ? getAccessDeniedText?.() || "猫耳访问受限" : finalAction,
        progress: terminalProgress,
        action: stoppedByAccessDenied ? getAccessDeniedText?.() || "猫耳访问受限" : finalAction,
        resultTarget: "favorites",
        highlighted: true,
      });
      await onRefreshSettled?.();
    } catch (error) {
      unexpectedFailure = true;
      finalAction = error instanceof Error ? error.message : "收藏刷新未能完成";
      console.error("Favorite refresh queue stopped unexpectedly", error);
      toast.error(`收藏刷新异常中止：${finalAction}`);
      onBackgroundTaskChange({
        isRunning: false,
        status: "failed",
        type: "favorites_refresh",
        title: "收藏刷新异常中止",
        description: finalAction,
        progress: latestProgress,
        action: finalAction,
        resultTarget: "favorites",
        highlighted: true,
      });
    } finally {
      refreshLockRef.current = false;
      onRefreshStateChange({
        isRunning: false,
        progress: stoppedByAccessDenied || unexpectedFailure ? latestProgress : 100,
        currentTitle: "",
        currentAction: finalAction,
      });
    }
  }

  return { refreshMany };
}

