import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownUpIcon,
  BeanIcon,
  ChevronDownIcon,
  CoinsIcon,
  DownloadIcon,
  GemIcon,
  HeartIcon,
  MicIcon,
  PlayCircleIcon,
  RefreshCwIcon,
  ShoppingCartIcon,
  StarIcon,
  TrendingUpIcon,
  Trash2Icon,
  UploadIcon,
  UsersRoundIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  buildVersionedUrl,
  extractResponseItems,
  formatCompactMetricValue,
  formatDeviceDateTime,
  getMissevanAccessDeniedMessage,
  getRemainingCooldownMinutes,
  formatPlainNumber,
  formatSignedCompactMetricValue,
  getBackendVersionFromResponse,
  MISSEVAN_DESKTOP_ACCESS_HINT,
} from "@/app/app-utils";
import {
  buildFavoritesBackup,
  exportFavoritesData,
  FAVORITE_DELTA_METRICS,
  FAVORITE_SORT_OPTIONS,
  getFavoriteByKey,
  getLatestSnapshot,
  getSnapshotsForFavorite,
  importFavoritesData,
  listSnapshots,
  loadFavoriteSettings,
  normalizeFavoriteSettings,
  saveFavoriteSettings,
  saveSnapshot,
  resolveFavoriteMetricKey,
  sortFavoritesWithSnapshots,
  updateFavoriteIfExists,
} from "@/app/favoritesStorage";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { LazyImage } from "@/components/ui/lazy-image";
import { Progress } from "@/components/ui/progress";
import { isMemberEpisode, isPaidEpisode } from "../../shared/episodeRules.js";

const metricIconMap = {
  viewCount: PlayCircleIcon,
  subscriptionCount: HeartIcon,
  rewardCount: GemIcon,
  rewardTotal: CoinsIcon,
  giftTotal: BeanIcon,
  paidOrListenCount: ShoppingCartIcon,
  paidIdCount: UsersRoundIcon,
};

const metricLabels = {
  viewCount: "播放量",
  subscriptionCount: "追剧/收藏人数",
  rewardCount: "打赏人数",
  rewardTotal: "打赏榜总和",
  giftTotal: "总投喂",
  paidOrListenCount: "付费/收听人数",
  paidIdCount: "付费 ID",
};

const SNAPSHOT_HISTORY_TABLE_MIN_WIDTH = "min-w-[46rem]";
const favoriteCoverPaymentBadgeClassName =
  "absolute bottom-0 right-0 h-4 rounded-none rounded-tl-[calc(var(--radius)-0.18rem)] border-0! px-1 text-[0.54rem] leading-none shadow-none! lg:h-[1.05rem] lg:px-1.5 lg:text-[0.58rem]";

const favoriteTagVariants = {
  猫耳: "missevanPlatform",
  漫播: "manboPlatform",
  免费: "free",
  会员: "member",
  付费: "paid",
  广播剧: "radioDrama",
  有声剧: "audioDrama",
  有声漫: "audioComic",
};

function buildProxyImageUrl(url) {
  return url ? `/image-proxy?url=${encodeURIComponent(url)}` : "";
}

function isFavoriteMoneyMetric(metricKey) {
  return metricKey === "rewardTotal" || metricKey === "giftTotal";
}

function formatFavoriteMoneyYuan(value, platform) {
  if (value == null || value === "") {
    return "暂无";
  }
  const rawAmount = Number(value);
  if (!Number.isFinite(rawAmount)) {
    return "暂无";
  }
  const divisor = platform === "missevan" ? 10 : 100;
  const amount = rawAmount / divisor;
  const sign = amount < 0 ? "-" : "";
  const absoluteAmount = Math.abs(amount);
  if (absoluteAmount >= 100000000) {
    return `${sign}${(absoluteAmount / 100000000).toFixed(1)}亿元`;
  }
  if (absoluteAmount >= 10000) {
    return `${sign}${(absoluteAmount / 10000).toFixed(1)}万元`;
  }
  if (Number.isInteger(absoluteAmount)) {
    return `${sign}${absoluteAmount}元`;
  }
  return `${sign}${absoluteAmount.toFixed(2).replace(/\.?0+$/, "")}元`;
}

function formatMetricValue(value, metricKey = "", platform = "") {
  if (value == null || value === "") {
    return "暂无";
  }
  if (isFavoriteMoneyMetric(metricKey)) {
    return formatFavoriteMoneyYuan(value, platform);
  }
  return metricKey === "paidIdCount" ? formatPlainNumber(value) : formatCompactMetricValue(value);
}

function formatDeltaValue(value, metricKey = "", platform = "") {
  if (value == null) {
    return "暂无";
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "暂无";
  }
  if (isFavoriteMoneyMetric(metricKey)) {
    return `${number > 0 ? "+" : ""}${formatFavoriteMoneyYuan(number, platform)}`;
  }
  if (metricKey === "paidIdCount") {
    return `${number > 0 ? "+" : ""}${formatPlainNumber(number)}`;
  }
  return formatSignedCompactMetricValue(number);
}

function getVisibleMetricKeys(platform) {
  return platform === "missevan"
    ? ["viewCount", "subscriptionCount", "rewardCount", "rewardTotal", "paidIdCount"]
    : ["viewCount", "subscriptionCount", "paidOrListenCount", "giftTotal", "paidIdCount"];
}

function getMetricValue(snapshot, key) {
  return snapshot?.metrics?.[key] ?? null;
}

function formatFavoriteMainCvText(value) {
  return String(value ?? "").replace(/^主要CV：/, "").trim() || "暂无";
}

function countFavoriteMainCvNames(value) {
  const normalized = String(value ?? "").replace(/^主要CV：/, "").trim();
  if (!normalized || normalized === "暂无") {
    return 0;
  }
  return normalized.split(/[，,、/]/).map((item) => item.trim()).filter(Boolean).length;
}

function MetricPill({ metricKey, value, platform }) {
  const Icon = metricIconMap[metricKey] || PlayCircleIcon;
  return (
    <div className="min-w-0 text-center text-foreground">
      <div className="flex min-w-0 items-center justify-center gap-1 text-[0.68rem] text-muted-foreground">
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate">{metricLabels[metricKey]}</span>
      </div>
      <div className="mt-1 text-sm font-semibold tabular-nums leading-5">{formatMetricValue(value, metricKey, platform)}</div>
    </div>
  );
}

function MetricHeaderLabel({ label, subLabel, className = "", headerClassName = "" }) {
  return (
    <div className={`min-w-0 leading-4 ${className}`} title={subLabel ? `${label} / ${subLabel}` : label}>
      <div className={`truncate ${headerClassName}`}>{label}</div>
      {subLabel ? <div className={`mt-0.5 truncate ${headerClassName || "text-muted-foreground/85"}`}>{subLabel}</div> : null}
    </div>
  );
}

function getDeltaMetricLabel(deltaMetric) {
  return FAVORITE_DELTA_METRICS.find((item) => item.key === deltaMetric)?.label || metricLabels[deltaMetric] || "增量";
}

function getHistoryMetricColumns(platform, deltaMetric) {
  return [
    {
      type: "time",
      key: "time",
      label: "时间",
      columnClassName: "w-[8.75rem] whitespace-nowrap",
      cellClassName: "text-left",
    },
    {
      type: "metric",
      key: "viewCount",
      label: metricLabels.viewCount,
    },
    {
      type: "metric",
      key: "subscriptionCount",
      label: "追剧人数",
      subLabel: "收藏人数",
    },
    {
      type: "metric",
      key: platform === "missevan" ? "rewardCount" : "paidOrListenCount",
      label: "打赏人数",
      subLabel: "付费/收听人数",
    },
    {
      type: "metric",
      key: platform === "missevan" ? "rewardTotal" : "giftTotal",
      label: "打赏榜总和",
      subLabel: "总投喂",
    },
    {
      type: "metric",
      key: "paidIdCount",
      label: "付费ID",
    },
    {
      type: "delta",
      key: deltaMetric,
      label: `+${getDeltaMetricLabel(deltaMetric)}`,
      headerClassName: "text-secondary",
      cellClassName: "font-medium text-secondary",
    },
  ];
}

function SnapshotDetailsDisclosure({ favorite, snapshots, deltaMetric, expanded, onToggle }) {
  const rows = getSnapshotsForFavorite(favorite.key, snapshots).slice(0, 30);
  const columns = getHistoryMetricColumns(favorite.platform, deltaMetric);
  const resolvedDeltaMetric = resolveFavoriteMetricKey(favorite.platform, deltaMetric);

  if (!expanded) {
    return (
      <div className="min-w-0 overflow-hidden rounded-lg border border-border/70 bg-background/82">
        <button
          type="button"
          className="flex w-full cursor-pointer items-center justify-between gap-2 px-2.5 py-2 text-left text-[0.78rem] font-medium text-foreground transition-colors hover:bg-muted/35"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <span>数据明细</span>
          <ChevronDownIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground transition-transform" />
        </button>
      </div>
    );
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border/70 bg-background/82">
      <div className="max-h-44 overflow-x-auto overflow-y-auto">
        <table className={`${SNAPSHOT_HISTORY_TABLE_MIN_WIDTH} w-full table-fixed border-collapse text-[0.68rem]`}>
          <thead className="sticky top-0 z-10 bg-background/95 text-muted-foreground">
            <tr
              className="cursor-pointer border-b border-border/70 transition-colors hover:bg-muted/35"
              role="button"
              tabIndex={0}
              aria-expanded={expanded}
              onClick={onToggle}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onToggle();
                }
              }}
            >
              {columns.map((column, index) => (
                <th
                  key={`header-${column.type}-${column.key}`}
                  className={`px-2 py-1.5 font-medium ${column.key === "time" ? "text-left" : "text-right"} ${column.columnClassName || ""}`}
                >
                  <div className={`flex min-w-0 items-center gap-1 ${column.key === "time" ? "justify-start" : "justify-end"}`}>
                    <MetricHeaderLabel
                      label={column.label}
                      subLabel={column.subLabel}
                      className={column.key === "time" ? "text-left" : "text-right"}
                      headerClassName={column.headerClassName}
                    />
                    {index === columns.length - 1 ? (
                      <ChevronDownIcon aria-hidden="true" className="size-3.5 shrink-0 rotate-180 text-muted-foreground transition-transform" />
                    ) : null}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((snapshot, index) => {
              const previous = rows[index + 1] || null;
              const latestValue = snapshot.metrics?.[resolvedDeltaMetric];
              const previousValue = previous?.metrics?.[resolvedDeltaMetric];
              const delta =
                latestValue == null || previousValue == null
                  ? null
                  : Number(latestValue) - Number(previousValue);
              return (
                <tr key={snapshot.id} className="border-b border-border/45 last:border-b-0">
                  {columns.map((column) => {
                    let value = "";
                    if (column.type === "time") {
                      value = formatDeviceDateTime(snapshot.capturedAt);
                    } else if (column.type === "delta") {
                      value = formatDeltaValue(delta, resolvedDeltaMetric, favorite.platform);
                    } else {
                      value = formatMetricValue(snapshot.metrics?.[column.key], column.key, favorite.platform);
                    }

                    return (
                      <td
                        key={`${snapshot.id}-${column.type}-${column.key}`}
                        className={`px-2 py-1.5 tabular-nums ${column.key === "time" ? "text-left text-muted-foreground" : "text-right text-foreground"} ${column.columnClassName || ""} ${column.cellClassName || ""}`}
                      >
                        {value}
                      </td>
                    );
                  })}
                </tr>
              );
            }) : (
              <tr>
                <td colSpan={columns.length} className="px-2.5 py-3 text-xs text-muted-foreground">
                  暂无快照数据
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

async function parseVersionedJson(response, frontendVersion, handleVersionResponse) {
  const data = await response.json();
  handleVersionResponse?.({
    ...data,
    frontendVersion,
    backendVersion: getBackendVersionFromResponse(response, data),
  });
  return data;
}

async function postJson(path, payload, frontendVersion, handleVersionResponse) {
  const response = await fetch(buildVersionedUrl(path, frontendVersion), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await parseVersionedJson(response, frontendVersion, handleVersionResponse);
  if (data?.accessDenied) {
    throw createFavoriteAccessDeniedError(data?.message || data?.error || "猫耳访问受限");
  }
  if (!response.ok) {
    throw new Error(data?.message || `请求失败：${response.status}`);
  }
  return data;
}

async function getJson(path, frontendVersion, handleVersionResponse) {
  const response = await fetch(buildVersionedUrl(path, frontendVersion), {
    cache: "no-store",
  });
  const data = await parseVersionedJson(response, frontendVersion, handleVersionResponse);
  if (data?.accessDenied) {
    throw createFavoriteAccessDeniedError(data?.message || data?.error || "猫耳访问受限");
  }
  if (!response.ok) {
    throw new Error(data?.message || `请求失败：${response.status}`);
  }
  return data;
}

async function wait(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

class FavoriteAccessDeniedError extends Error {
  constructor(message = "猫耳访问受限") {
    super(message);
    this.name = "FavoriteAccessDeniedError";
    this.accessDenied = true;
  }
}

function isFavoriteAccessDeniedError(error) {
  return error?.accessDenied === true || error?.name === "FavoriteAccessDeniedError";
}

function createFavoriteAccessDeniedError(message) {
  return new FavoriteAccessDeniedError(message);
}

async function runStatsTask({ platform, taskType, payload, frontendVersion, handleVersionResponse }) {
  const created = await postJson("/stat-tasks", { platform, taskType, ...payload }, frontendVersion, handleVersionResponse);
  const taskId = String(created?.taskId ?? "").trim();
  if (!taskId) {
    throw new Error("统计任务创建失败");
  }

  let snapshot = created;
  for (let index = 0; index < 240; index += 1) {
    if (platform === "missevan" && snapshot?.accessDenied) {
      throw createFavoriteAccessDeniedError(snapshot.currentAction || snapshot.error || "猫耳访问受限");
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
    await wait(1200);
    snapshot = await getJson(`/stat-tasks/${taskId}?_ts=${Date.now()}`, frontendVersion, handleVersionResponse);
  }
  throw new Error("统计任务超时");
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

async function fetchFavoriteDramaInfo(favorite, frontendVersion, handleVersionResponse) {
  const path = favorite.platform === "manbo" ? "/manbo/getdramas" : "/getdramas";
  const data = await postJson(
    path,
    { drama_ids: [favorite.platform === "manbo" ? String(favorite.dramaId) : Number(favorite.dramaId)] },
    frontendVersion,
    handleVersionResponse
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

async function fetchFavoriteMainCvText(favorite, frontendVersion, handleVersionResponse) {
  const params = new URLSearchParams({
    platform: favorite.platform,
    dramaId: String(favorite.dramaId ?? ""),
  });
  const data = await getJson(`/favorites/meta?${params.toString()}`, frontendVersion, handleVersionResponse);
  return String(data?.mainCvText ?? data?.main_cv_text ?? "").trim();
}

async function refreshFavoriteSnapshot({ favorite, frontendVersion, handleVersionResponse, isDesktopApp = false }) {
  const capturedAt = Date.now();
  const errors = [];
  const dramaInfo = await fetchFavoriteDramaInfo(favorite, frontendVersion, handleVersionResponse);
  const drama = dramaInfo?.drama || {};
  const paidEpisodes = buildPaidEpisodePayload(favorite.platform, dramaInfo);
  let refreshedMainCvText = "";
  if (!isDesktopApp && countFavoriteMainCvNames(favorite.mainCvText) <= 2) {
    try {
      const fetchedMainCvText = await fetchFavoriteMainCvText(favorite, frontendVersion, handleVersionResponse);
      if (countFavoriteMainCvNames(fetchedMainCvText) >= countFavoriteMainCvNames(favorite.mainCvText)) {
        refreshedMainCvText = fetchedMainCvText;
      }
    } catch (error) {
      if (isFavoriteAccessDeniedError(error)) {
        throw error;
      }
      console.warn("Failed to refresh favorite main CV", error);
    }
  }
  let paidIdCount = 0;

  if (favorite.platform !== "missevan" && paidEpisodes.length > 0) {
    try {
      const idTask = await runStatsTask({
        platform: favorite.platform,
        taskType: "id",
        payload: { episodes: paidEpisodes, source: "favorite" },
        frontendVersion,
        handleVersionResponse,
      });
      const idResults = Array.isArray(idTask?.result?.idResults) ? idTask.result.idResults : [];
      paidIdCount = idResults.reduce((sum, item) => sum + Number(item?.users ?? 0), 0);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  let rewardCount = null;
  let rewardTotal = null;
  let giftTotal = Number(drama.diamond_value ?? 0) || null;
  let paidOrListenCount = null;

  if (favorite.platform === "missevan") {
    try {
      const revenueTask = await runStatsTask({
        platform: favorite.platform,
        taskType: "revenue",
        payload: { dramaIds: [Number(favorite.dramaId)], source: "favorite" },
        frontendVersion,
        handleVersionResponse,
      });
      const revenueResult = (Array.isArray(revenueTask?.result?.revenueResults) ? revenueTask.result.revenueResults : [])
        .find((item) => String(item?.dramaId) === String(favorite.dramaId));
      rewardCount = revenueResult?.rewardNum ?? null;
      rewardTotal = revenueResult?.rewardCoinTotal ?? null;
      paidIdCount = Number(revenueResult?.seasonPaidUserCount ?? revenueResult?.paidUserCount ?? 0) || 0;
    } catch (error) {
      if (isFavoriteAccessDeniedError(error)) {
        throw error;
      }
      errors.push(error instanceof Error ? error.message : String(error));
    }
  } else {
    giftTotal = Number(drama.diamond_value ?? 0) || null;
    const payCount = Number(drama.pay_count ?? 0);
    const listenCount = Number(drama.member_listen_count ?? 0);
    paidOrListenCount = payCount > 0 ? payCount : listenCount > 0 ? listenCount : null;
  }

  const metrics = {
    viewCount: Number(drama.view_count ?? 0) || 0,
    subscriptionCount: Number(drama.subscription_num ?? 0) || 0,
    rewardCount,
    rewardTotal,
    giftTotal,
    paidOrListenCount,
    paidIdCount,
  };

  const nextFavorite = await updateFavoriteIfExists(favorite.key, (activeFavorite) => ({
    ...activeFavorite,
    title: String(drama.name ?? activeFavorite.title ?? "").trim() || activeFavorite.title,
    cover: getDramaCover(dramaInfo, activeFavorite.cover),
    dramaUpdatedAt: String(drama.updated_at ?? drama.updatedAt ?? activeFavorite.dramaUpdatedAt ?? "").trim(),
    mainCvText: refreshedMainCvText || activeFavorite.mainCvText || "",
    updatedAt: capturedAt,
    lastSnapshotAt: capturedAt,
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
    errors,
  });
  return { favorite: nextFavorite, snapshot };
}

export function FavoritesPanel({
  favorites = [],
  favoriteActionsDisabled = false,
  statisticsActionsDisabled = false,
  cooldownHours = 4,
  cooldownUntil = 0,
  desktopAppUrl = "",
  frontendVersion = "0.0.0",
  handleVersionResponse,
  isDesktopApp = false,
  onBackgroundTaskChange = () => {},
  onFavoritesChange,
  onRefreshSettled,
  onRefreshStateChange = () => {},
  onToggleFavorite,
  refreshRevision = 0,
  refreshState = {
    isRunning: false,
    progress: 0,
    currentTitle: "",
  },
}) {
  const [snapshots, setSnapshots] = useState([]);
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [expandedKeys, setExpandedKeys] = useState(new Set());
  const [settings, setSettings] = useState(() => normalizeFavoriteSettings());
  const fileInputRef = useRef(null);
  const backfilledCvKeysRef = useRef(new Set());
  const mountedRef = useRef(true);

  async function reloadSnapshots() {
    try {
      const nextSnapshots = await listSnapshots();
      if (mountedRef.current) {
        setSnapshots(nextSnapshots);
      }
    } catch (error) {
      console.error("Failed to load favorite snapshots", error);
      toast.error("读取收藏统计记录失败。");
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    reloadSnapshots();
  }, [refreshRevision]);

  useEffect(() => {
    loadFavoriteSettings()
      .then(setSettings)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (isDesktopApp) {
      return undefined;
    }
    const queue = favorites.filter((favorite) => {
      const key = String(favorite?.key ?? "").trim();
      return key && !String(favorite?.mainCvText ?? "").trim() && !backfilledCvKeysRef.current.has(key);
    });
    if (!queue.length) {
      return undefined;
    }

    queue.forEach((favorite) => {
      backfilledCvKeysRef.current.add(favorite.key);
    });

    let cancelled = false;
    async function backfillMissingMainCvText() {
      let changed = false;
      for (const favorite of queue) {
        try {
          const mainCvText = await fetchFavoriteMainCvText(favorite, frontendVersion, handleVersionResponse);
          if (mainCvText) {
            const updatedFavorite = await updateFavoriteIfExists(favorite.key, (activeFavorite) => ({
              ...activeFavorite,
              mainCvText,
              updatedAt: Date.now(),
            }));
            if (updatedFavorite) {
              changed = true;
            }
          }
        } catch (error) {
          console.warn("Failed to backfill favorite main CV", error);
        }
      }
      if (changed && !cancelled) {
        await onFavoritesChange?.();
      }
    }

    void backfillMissingMainCvText();
    return () => {
      cancelled = true;
    };
  }, [favorites, frontendVersion, handleVersionResponse, isDesktopApp, onFavoritesChange]);

  const sortedFavorites = useMemo(
    () => sortFavoritesWithSnapshots(favorites, snapshots, settings.sortBy),
    [favorites, snapshots, settings.sortBy]
  );

  function toggleSelected(key, checked) {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }

  function toggleExpanded(key) {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  async function updateSettings(patch) {
    const nextSettings = normalizeFavoriteSettings({ ...settings, ...patch });
    setSettings(nextSettings);
    await saveFavoriteSettings(nextSettings);
  }

  function getFavoriteAccessDeniedText() {
    return isDesktopApp
      ? MISSEVAN_DESKTOP_ACCESS_HINT
      : getMissevanAccessDeniedMessage({ cooldownHours, cooldownUntil }, cooldownHours);
  }

  function renderFavoriteAccessDeniedMessage() {
    if (isDesktopApp) {
      return MISSEVAN_DESKTOP_ACCESS_HINT;
    }
    return (
      <span aria-label={getFavoriteAccessDeniedText()}>
        当前所有备份节点都在冷却中，请{getRemainingCooldownMinutes({ cooldownHours, cooldownUntil }, cooldownHours)}分钟之后再来，或使用
        {desktopAppUrl ? (
          <a className="font-medium text-primary underline underline-offset-4" href={desktopAppUrl} rel="noreferrer" target="_blank">
            桌面版
          </a>
        ) : (
          "桌面版"
        )}
        。
      </span>
    );
  }

  async function refreshMany(targetFavorites) {
    if (statisticsActionsDisabled) {
      toast.warning("后台任务运行中，请等待完成后再刷新收藏。");
      return;
    }
    const queue = (Array.isArray(targetFavorites) ? targetFavorites : []).filter(Boolean);
    if (!queue.length) {
      toast.warning("请先选择收藏作品。");
      return;
    }
    onRefreshStateChange({ isRunning: true, progress: 0, currentTitle: "" });
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
    let failedCount = 0;
    let stoppedByAccessDenied = false;
    try {
      for (let index = 0; index < queue.length; index += 1) {
        const favorite = queue[index];
        onRefreshStateChange({
          isRunning: true,
          progress: Math.floor((index / queue.length) * 100),
          currentTitle: favorite.title,
        });
        onBackgroundTaskChange({
          isRunning: true,
          status: "running",
          type: "favorites_refresh",
          title: "收藏刷新",
          description: `正在刷新：${favorite.title || "收藏作品"}`,
          progress: Math.floor((index / queue.length) * 100),
          action: `正在刷新：${favorite.title || "收藏作品"}`,
          resultTarget: "favorites",
          highlighted: true,
        });
        try {
          await refreshFavoriteSnapshot({ favorite, frontendVersion, handleVersionResponse, isDesktopApp });
        } catch (error) {
          if (isFavoriteAccessDeniedError(error)) {
            stoppedByAccessDenied = true;
            console.warn("Stopped favorite refresh because Missevan access is denied", error);
            break;
          }
          const activeFavorite = await getFavoriteByKey(favorite.key).catch(() => null);
          if (!activeFavorite) {
            continue;
          }
          failedCount += 1;
          console.error("Failed to refresh favorite", error);
          await saveSnapshot({
            id: `${favorite.key}:${Date.now()}`,
            favoriteKey: favorite.key,
            platform: favorite.platform,
            dramaId: favorite.dramaId,
            capturedAt: Date.now(),
            status: "failed",
            metrics: {},
            errors: [error instanceof Error ? error.message : String(error)],
          }).catch(() => {});
        }
      }
      await reloadSnapshots();
      await onFavoritesChange?.();
      if (stoppedByAccessDenied) {
        toast.error(renderFavoriteAccessDeniedMessage());
      } else if (failedCount > 0) {
        toast.warning(`刷新完成，${failedCount} 部作品失败。`);
      } else {
        toast.success("收藏刷新完成。");
      }
      onBackgroundTaskChange({
        isRunning: false,
        status: stoppedByAccessDenied || failedCount > 0 ? "failed" : "completed",
        type: "favorites_refresh",
        title: stoppedByAccessDenied ? "收藏刷新已停止" : failedCount > 0 ? "收藏刷新完成，部分失败" : "收藏刷新完成",
        description: stoppedByAccessDenied ? getFavoriteAccessDeniedText() : failedCount > 0 ? `${failedCount} 部作品刷新失败。` : "收藏统计记录已更新。",
        progress: 100,
        action: stoppedByAccessDenied ? getFavoriteAccessDeniedText() : failedCount > 0 ? `${failedCount} 部作品刷新失败。` : "收藏统计记录已更新。",
        resultTarget: "favorites",
        highlighted: true,
      });
      await onRefreshSettled?.();
    } finally {
      onRefreshStateChange({ isRunning: false, progress: 100, currentTitle: "" });
    }
  }

  async function exportData() {
    try {
      const backup = await exportFavoritesData();
      const blob = new Blob([JSON.stringify(buildFavoritesBackup(backup), null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `mm-toolkit-favorites-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("收藏数据已导出。");
    } catch (error) {
      console.error("Failed to export favorites", error);
      toast.error("导出收藏数据失败。");
    }
  }

  async function importFile(file) {
    if (!file) {
      return;
    }
    try {
      const payload = JSON.parse(await file.text());
      await importFavoritesData(payload);
      await reloadSnapshots();
      await onFavoritesChange?.();
      toast.success("收藏数据导入完成。");
    } catch (error) {
      console.error("Failed to import favorites", error);
      toast.error(error instanceof Error ? error.message : "导入收藏数据失败。");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 px-1">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-2xl font-semibold tracking-tight">收藏</h2>
          <Badge variant="outline" className="h-6 px-2 text-xs">已收藏 {favorites.length} 部</Badge>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">查看已收藏剧集的最近统计和历史记录</p>
      </div>

      <Alert className="border-primary/20 bg-accent/80">
        <StarIcon className="size-4" />
        <AlertTitle>本地收藏说明</AlertTitle>
        <AlertDescription className="![text-wrap:wrap] md:![text-wrap:wrap]">
          收藏数据保存在当前浏览器，清除浏览器数据后可能丢失。如需备份或与其他浏览器同步，请使用导出和导入数据功能。
        </AlertDescription>
      </Alert>

      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="grid min-w-0 grid-cols-4 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <Button
            type="button"
            variant="secondary"
            className="h-9 gap-1 px-2 text-sm sm:px-3"
            disabled={refreshState.isRunning || favoriteActionsDisabled || statisticsActionsDisabled || selectedKeys.size === 0}
            onClick={() => refreshMany(favorites.filter((favorite) => selectedKeys.has(favorite.key)))}
          >
            <RefreshCwIcon data-icon="inline-start" className={refreshState.isRunning ? "animate-spin" : ""} />
            {refreshState.isRunning ? "刷新中" : "选中"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-9 gap-1 px-2 text-sm sm:px-3"
            disabled={refreshState.isRunning || favoriteActionsDisabled || statisticsActionsDisabled || favorites.length === 0}
            onClick={() => refreshMany(sortedFavorites)}
          >
            <RefreshCwIcon data-icon="inline-start" className={refreshState.isRunning ? "animate-spin" : ""} />
            {refreshState.isRunning ? "刷新中" : "全部"}
          </Button>
          <Button type="button" variant="outline" className="h-9 gap-1 px-2 text-sm sm:px-3" disabled={favoriteActionsDisabled} onClick={() => fileInputRef.current?.click()} aria-label="导入数据" title="导入数据">
            <DownloadIcon data-icon="inline-start" />
            导入
          </Button>
          <Button type="button" variant="outline" className="h-9 gap-1 px-2 text-sm sm:px-3" onClick={exportData} aria-label="导出数据" title="导出数据">
            <UploadIcon data-icon="inline-start" />
            导出
          </Button>
          <input
            ref={fileInputRef}
            className="hidden"
            type="file"
            accept="application/json,.json"
            onChange={(event) => importFile(event.target.files?.[0])}
          />
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-2 lg:flex lg:items-center lg:justify-end">
          <label className="flex h-9 min-w-0 items-center gap-1.5 rounded-md border border-border/75 bg-background px-2.5 text-sm text-foreground">
            <TrendingUpIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <select
              aria-label="关注指标"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
              value={settings.deltaMetric}
              onChange={(event) => updateSettings({ deltaMetric: event.target.value })}
            >
              {FAVORITE_DELTA_METRICS.map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="flex h-9 min-w-0 items-center gap-1.5 rounded-md border border-border/75 bg-background px-2.5 text-sm text-foreground">
            <ArrowDownUpIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <select
              aria-label="排序"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
              value={settings.sortBy}
              onChange={(event) => updateSettings({ sortBy: event.target.value })}
            >
              {FAVORITE_SORT_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {refreshState.isRunning ? (
        <div className="grid gap-2 rounded-lg border border-border/80 bg-card p-3">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium">正在刷新：{refreshState.currentTitle || "收藏作品"}</span>
            <span className="tabular-nums">{refreshState.progress}%</span>
          </div>
          <Progress value={refreshState.progress} className="h-3 rounded-full bg-muted" indicatorClassName="bg-primary" />
        </div>
      ) : null}

      {sortedFavorites.length ? (
        <div className="grid gap-3">
          {sortedFavorites.map((favorite) => {
            const latest = getLatestSnapshot(favorite.key, snapshots);
            const expanded = expandedKeys.has(favorite.key);
            const coverUrl = buildProxyImageUrl(favorite.cover);
            const metricKeys = getVisibleMetricKeys(favorite.platform);
            const platformLabel = favorite.platform === "missevan" ? "猫耳" : "漫播";
            const paymentTag = favorite.paymentLabel;
            const titleTags = [platformLabel, favorite.contentTypeLabel].filter(Boolean);

            return (
              <Card key={favorite.key} className="border-border/80 bg-card shadow-[0_18px_42px_-36px_rgba(15,23,42,0.26)]">
                <CardContent className="grid gap-3 p-3 sm:p-4">
                  <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
                    <div className="flex flex-col items-center gap-2 pt-1">
                      <Checkbox checked={selectedKeys.has(favorite.key)} onCheckedChange={(checked) => toggleSelected(favorite.key, Boolean(checked))} />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => onToggleFavorite?.({ ...favorite, source: "favorites" })}
                        aria-label="取消收藏"
                        title="取消收藏"
                        disabled={favoriteActionsDisabled}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                    <div className="contents">
                      <div className="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-3 lg:grid-cols-[5.5rem_minmax(0,1.1fr)_minmax(25rem,1.6fr)]">
                        <div className="relative size-[4.5rem] overflow-hidden rounded-md border border-border/70 bg-muted/50 lg:size-[5.5rem]">
                          {coverUrl ? (
                            <LazyImage alt={favorite.title} className="size-full object-cover" src={coverUrl} />
                          ) : (
                            <div className="flex size-full items-center justify-center text-xs text-muted-foreground">暂无封面</div>
                          )}
                          {paymentTag ? (
                            <Badge variant={favoriteTagVariants[paymentTag] || "outline"} className={favoriteCoverPaymentBadgeClassName}>
                              {paymentTag}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="min-w-0">
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <div className="min-w-0 break-words text-base font-semibold leading-6 sm:text-lg">{favorite.title}</div>
                            {titleTags.map((label) => (
                              <Badge key={`${favorite.key}-${label}`} variant={favoriteTagVariants[label] || "outline"} className="h-[1.05rem] px-1.5 text-[0.6rem] leading-none">
                                {label}
                              </Badge>
                            ))}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground"># {favorite.dramaId}</div>
                          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                            <MicIcon aria-label="主役CV" className="size-3.5 shrink-0" title="主役CV" />
                            <span className="min-w-0 truncate">{formatFavoriteMainCvText(favorite.mainCvText)}</span>
                          </div>
                        </div>
                        <div className="hidden grid-cols-5 gap-3 lg:grid">
                          {metricKeys.map((key) => (
                            <MetricPill key={`${favorite.key}-${key}`} metricKey={key} value={getMetricValue(latest, key)} platform={favorite.platform} />
                          ))}
                        </div>
                      </div>

                      <div className="col-span-2 grid grid-cols-3 gap-2 lg:hidden">
                        {metricKeys.slice(0, 5).map((key) => (
                          <MetricPill key={`${favorite.key}-mobile-${key}`} metricKey={key} value={getMetricValue(latest, key)} platform={favorite.platform} />
                        ))}
                      </div>

                      <div className="col-span-2">
                        <SnapshotDetailsDisclosure
                          favorite={favorite}
                          snapshots={snapshots}
                          deltaMetric={settings.deltaMetric}
                          expanded={expanded}
                          onToggle={() => toggleExpanded(favorite.key)}
                        />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border/80 bg-card/72 px-4 py-10 text-center text-sm text-muted-foreground">
          暂无收藏作品。可以在搜索结果、更新页或榜单页点击星标加入收藏。
        </div>
      )}
    </div>
  );
}
