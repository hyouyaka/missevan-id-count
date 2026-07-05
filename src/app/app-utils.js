import { normalizeVersion } from "../../shared/versionUtils.js";
import {
  isSearchKeywordLongEnough,
  normalizeSearchText,
  parseMissevanInputToken,
} from "../../shared/searchUtils.js";
import { isMemberEpisode, isPaidEpisode } from "../../shared/episodeRules.js";

export { normalizeVersion };

export function getInlineTaggedTitleDisplayText(title, options = {}) {
  const normalized = String(title ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  const viewport = options.viewport === "desktop" ? "desktop" : "mobile";
  const hasTags = options.hasTags === true;
  const maxLength = viewport === "desktop"
    ? hasTags ? 30 : 42
    : hasTags ? 18 : 22;
  const characters = Array.from(normalized);
  if (characters.length <= maxLength) {
    return normalized;
  }

  return `${characters.slice(0, maxLength).join("").trimEnd()}...`;
}

function normalizeExternalHttpUrl(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }

  try {
    const url = new URL(normalized);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch (_) {
    return "";
  }
}

export function getDefaultAppConfig() {
  return {
    missevanEnabled: true,
    desktopApp: false,
    brandName: "MMTOOLKIT.APP",
    titleZh: "小猫小狐数据分析",
    description: "支持 Missevan 与 Manbo 的作品导入、分集筛选、弹幕统计和数据汇总。",
    cooldownHours: 4,
    cooldownUntil: 0,
    desktopAppUrl: "",
    featureSuggestionUrl: "",
    frontendVersion: typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0",
    backendVersion: "0.0.0",
    versionMismatch: false,
  };
}

export function mergeAppConfig(currentConfig, config = {}) {
  const defaults = getDefaultAppConfig();
  const brandName = String(config.brandName || "").trim();
  const frontendVersion = normalizeVersion(
    config.frontendVersion ?? currentConfig?.frontendVersion ?? defaults.frontendVersion
  );
  const backendVersion = normalizeVersion(
    config.backendVersion ?? currentConfig?.backendVersion ?? defaults.backendVersion
  );

  return {
    missevanEnabled: config.missevanEnabled !== false,
    desktopApp: config.desktopApp === true,
    brandName: brandName && brandName !== "M&M Toolkit" ? brandName : defaults.brandName,
    titleZh: config.titleZh || defaults.titleZh,
    description: config.description || defaults.description,
    cooldownHours: Number(config.cooldownHours ?? defaults.cooldownHours) || defaults.cooldownHours,
    cooldownUntil: Number(config.cooldownUntil ?? 0) || 0,
    desktopAppUrl: String(config.desktopAppUrl || "").trim(),
    featureSuggestionUrl: normalizeExternalHttpUrl(config.featureSuggestionUrl),
    frontendVersion,
    backendVersion,
    versionMismatch:
      config.versionMismatch == null ? frontendVersion !== backendVersion : Boolean(config.versionMismatch),
  };
}

export function getBackendVersionFromResponse(response, data = null) {
  const headerVersion = normalizeVersion(response?.headers?.get?.("X-Backend-Version") ?? "");
  if (headerVersion !== "0.0.0") {
    return headerVersion;
  }
  return normalizeVersion(data?.backendVersion ?? "0.0.0");
}

export function buildVersionedUrl(url, frontendVersion) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}frontendVersion=${encodeURIComponent(normalizeVersion(frontendVersion))}`;
}

export async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch (error) {
    if (response?.ok) {
      throw error;
    }
    return null;
  }
}

export function prefersReducedMotion() {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function getScrollBehavior() {
  return prefersReducedMotion() ? "auto" : "smooth";
}

export const TOOL_VIEW_QUERY_PARAM = "view";
export const TOOL_ROUTE_QUERY_PARAMS = {
  view: "view",
  platform: "platform",
  window: "window",
  category: "category",
  rank: "rank",
};

export function getAllowedToolViews({ desktopApp = false } = {}) {
  return desktopApp
    ? ["search", "favorites"]
    : ["home", "search", "ongoing", "ranks", "favorites"];
}

export function normalizeToolView(value, options = {}) {
  const allowedViews = getAllowedToolViews(options);
  const normalized = String(value || "").trim();
  const defaultView = options?.desktopApp ? "search" : "home";
  return allowedViews.includes(normalized) ? normalized : defaultView;
}

export function normalizeToolPlatform(value) {
  return value === "manbo" ? "manbo" : "missevan";
}

export function normalizeOngoingWindow(value) {
  return ["3d", "7d", "30d"].includes(value) ? value : "7d";
}

export function normalizeToolRouteState(routeState = {}, options = {}) {
  return {
    view: normalizeToolView(routeState.view, options),
    platform: normalizeToolPlatform(routeState.platform),
    window: normalizeOngoingWindow(routeState.window),
    category: String(routeState.category || "").trim(),
    rank: String(routeState.rank || "").trim(),
  };
}

export function readToolViewFromLocation(locationLike, options = {}) {
  const search = String(locationLike?.search || "");
  const params = new URLSearchParams(search);
  return normalizeToolView(params.get(TOOL_VIEW_QUERY_PARAM), options);
}

export function readToolRouteStateFromLocation(locationLike, options = {}) {
  const search = String(locationLike?.search || "");
  const params = new URLSearchParams(search);
  return normalizeToolRouteState(
    {
      view: params.get(TOOL_ROUTE_QUERY_PARAMS.view),
      platform: params.get(TOOL_ROUTE_QUERY_PARAMS.platform),
      window: params.get(TOOL_ROUTE_QUERY_PARAMS.window),
      category: params.get(TOOL_ROUTE_QUERY_PARAMS.category),
      rank: params.get(TOOL_ROUTE_QUERY_PARAMS.rank),
    },
    options
  );
}

function deleteToolRouteDetailParams(params) {
  params.delete(TOOL_ROUTE_QUERY_PARAMS.platform);
  params.delete(TOOL_ROUTE_QUERY_PARAMS.window);
  params.delete(TOOL_ROUTE_QUERY_PARAMS.category);
  params.delete(TOOL_ROUTE_QUERY_PARAMS.rank);
}

export function buildToolRouteUrl(locationLike, routeState = {}, options = {}) {
  const pathname = String(locationLike?.pathname || "/tool") || "/tool";
  const search = String(locationLike?.search || "");
  const hash = String(locationLike?.hash || "");
  const params = new URLSearchParams(search);
  const nextState = normalizeToolRouteState(routeState, options);

  params.delete(TOOL_ROUTE_QUERY_PARAMS.view);
  deleteToolRouteDetailParams(params);

  if (nextState.view === "home") {
    params.delete(TOOL_ROUTE_QUERY_PARAMS.view);
  } else if (nextState.view === "search") {
    params.set(TOOL_ROUTE_QUERY_PARAMS.view, "search");
  } else if (nextState.view === "ongoing") {
    params.set(TOOL_ROUTE_QUERY_PARAMS.view, "ongoing");
  } else {
    params.set(TOOL_ROUTE_QUERY_PARAMS.view, nextState.view);
  }

  if (nextState.view === "ongoing") {
    if (nextState.platform === "missevan" && nextState.window === "7d") {
      deleteToolRouteDetailParams(params);
    } else {
      params.set(TOOL_ROUTE_QUERY_PARAMS.platform, nextState.platform);
      params.set(TOOL_ROUTE_QUERY_PARAMS.window, nextState.window);
    }
  } else if (nextState.view === "ranks") {
    params.set(TOOL_ROUTE_QUERY_PARAMS.platform, nextState.platform);
    if (nextState.category) {
      params.set(TOOL_ROUTE_QUERY_PARAMS.category, nextState.category);
    }
    if (nextState.rank) {
      params.set(TOOL_ROUTE_QUERY_PARAMS.rank, nextState.rank);
    }
  }

  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}${hash}`;
}

export function buildToolViewUrl(locationLike, view, options = {}) {
  const pathname = String(locationLike?.pathname || "/tool") || "/tool";
  const search = String(locationLike?.search || "");
  const hash = String(locationLike?.hash || "");
  const params = new URLSearchParams(search);
  const nextView = normalizeToolView(view, options);

  if (nextView === "home") {
    params.delete(TOOL_VIEW_QUERY_PARAM);
  } else {
    params.set(TOOL_VIEW_QUERY_PARAM, nextView);
  }

  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}${hash}`;
}

export function buildOngoingNavigationMenu() {
  return [
    { key: "missevan", label: "猫耳" },
    { key: "manbo", label: "漫播" },
  ].map((platform) => ({
    ...platform,
    platform: {
      key: platform.key,
      label: platform.label,
    },
    routePatch: {
      view: "ongoing",
      platform: platform.key,
      window: "7d",
    },
    activeRoutePatch: {
      view: "ongoing",
      platform: platform.key,
    },
  }));
}

function normalizeNavigationLabel(value, fallback) {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function stripTrailingRankSuffix(value) {
  return String(value ?? "").trim().replace(/榜$/, "");
}

function formatMobileRankNavigationLabel(categoryLabel, rankLabel, singleRank = false) {
  const normalizedCategoryLabel = normalizeNavigationLabel(categoryLabel, "");
  const normalizedRankLabel = normalizeNavigationLabel(rankLabel, "");
  if (normalizedCategoryLabel === "CV榜") {
    if (normalizedRankLabel === "总榜") {
      return "CV总榜";
    }
    if (normalizedRankLabel === "付费榜") {
      return "CV付费榜";
    }
  }
  if (singleRank) {
    if (!normalizedRankLabel || normalizedRankLabel === normalizedCategoryLabel) {
      return normalizedCategoryLabel;
    }
    const prefix = stripTrailingRankSuffix(normalizedCategoryLabel);
    return `${prefix}${normalizedRankLabel}`;
  }

  const prefix = stripTrailingRankSuffix(normalizedCategoryLabel);
  const suffix = normalizedRankLabel.endsWith("剧") ? `${normalizedRankLabel}榜` : normalizedRankLabel;
  return `${prefix}${suffix}` || normalizedRankLabel || normalizedCategoryLabel;
}

export const RANK_PLATFORM_CARRY_CATEGORY_KEYS = ["peak", "cv"];

function getFirstRankCategory(platformData) {
  return Array.isArray(platformData?.categories) ? platformData.categories.find((category) => category?.key) || null : null;
}

function getRankCategoryByKey(platformData, categoryKey) {
  const normalizedKey = String(categoryKey || "").trim();
  return Array.isArray(platformData?.categories)
    ? platformData.categories.find((category) => String(category?.key || "").trim() === normalizedKey) || null
    : null;
}

function getFirstRankItem(category) {
  return Array.isArray(category?.ranks) ? category.ranks.find((rank) => rank?.key) || null : null;
}

function rankItemMatchesPreference(rank, preference) {
  const key = String(rank?.key || "").trim().toLowerCase();
  const label = String(rank?.label || "").trim();
  if (preference === "daily") {
    return key.includes("daily") || label === "日榜";
  }
  if (preference === "weekly") {
    return key.includes("weekly") || label === "周榜";
  }
  if (preference === "total") {
    return key.endsWith("total") || key === "cv" || label === "总榜";
  }
  return false;
}

function getPreferredRankKeyForCategory(category) {
  const key = String(category?.key || "").trim().toLowerCase();
  const label = String(category?.label || "").trim();
  if (key.includes("new") || label.includes("新品")) {
    return "daily";
  }
  if (key.includes("popular") || key.includes("hot") || label.includes("人气")) {
    return "weekly";
  }
  if (key.includes("best_seller") || key.includes("seller") || label.includes("畅销")) {
    return "weekly";
  }
  if (key.includes("cv") || label.toUpperCase().includes("CV")) {
    return "total";
  }
  if (key.includes("box_office") || label.includes("票房")) {
    return "total";
  }
  return "";
}

function getDefaultRankItemForCategory(category, ranks) {
  const preference = getPreferredRankKeyForCategory(category);
  const preferredRank = preference ? ranks.find((rank) => rankItemMatchesPreference(rank, preference)) : null;
  return preferredRank || ranks[0];
}

function getRankItemByKey(category, rankKey) {
  const normalizedKey = String(rankKey || "").trim();
  return Array.isArray(category?.ranks)
    ? category.ranks.find((rank) => String(rank?.key || "").trim() === normalizedKey) || null
    : null;
}

export function buildRankPlatformSwitchRoutePatch(platform, platformData, currentSelection = {}) {
  const nextPlatform = String(platform || platformData?.key || "").trim();
  const currentCategoryKey = String(currentSelection?.category || "").trim();
  const canCarryCategory = RANK_PLATFORM_CARRY_CATEGORY_KEYS.includes(currentCategoryKey);
  const carriedCategory = canCarryCategory ? getRankCategoryByKey(platformData, currentCategoryKey) : null;
  const nextCategory = carriedCategory || getFirstRankCategory(platformData);
  const carriedRank = carriedCategory ? getRankItemByKey(carriedCategory, currentSelection?.rank) : null;
  const nextRank = carriedRank || getFirstRankItem(nextCategory);

  return {
    view: "ranks",
    platform: nextPlatform,
    category: String(nextCategory?.key || "").trim(),
    rank: String(nextRank?.key || "").trim(),
  };
}

export function buildRanksNavigationMenu(ranksPayload) {
  const platforms = ranksPayload?.data?.platforms || ranksPayload?.platforms || {};
  return ["missevan", "manbo"]
    .map((platformKey) => {
      const platform = platforms?.[platformKey];
      const categories = (Array.isArray(platform?.categories) ? platform.categories : [])
        .map((category) => {
          const ranks = (Array.isArray(category?.ranks) ? category.ranks : [])
            .map((rank) => {
              const rankKey = String(rank?.key || "").trim();
              if (!rankKey) {
                return null;
              }
              return {
                key: rankKey,
                label: normalizeNavigationLabel(rank?.label, rankKey),
                routePatch: {
                  view: "ranks",
                  platform: platformKey,
                  category: String(category?.key || "").trim(),
                  rank: rankKey,
                },
              };
            })
            .filter(Boolean);
          const categoryKey = String(category?.key || "").trim();
          if (!categoryKey || !ranks.length) {
            return null;
          }
          return {
            key: categoryKey,
            label: normalizeNavigationLabel(category?.label, categoryKey),
            routePatch: {
              view: "ranks",
              platform: platformKey,
              category: categoryKey,
              rank: getDefaultRankItemForCategory(category, ranks).key,
            },
            activeRoutePatch: {
              view: "ranks",
              platform: platformKey,
              category: categoryKey,
            },
            rankItems: ranks,
            ...(ranks.length > 1 ? { children: ranks } : {}),
          };
        })
        .filter(Boolean);
      if (!categories.length) {
        return null;
      }
      return {
        key: platformKey,
        label: normalizeNavigationLabel(platform?.label, platformKey === "manbo" ? "漫播" : "猫耳"),
        platform: {
          key: platformKey,
          label: normalizeNavigationLabel(platform?.label, platformKey === "manbo" ? "漫播" : "猫耳"),
        },
        routePatch: {
          view: "ranks",
          platform: platformKey,
          category: categories[0].key,
          rank: categories[0].routePatch?.rank || "",
        },
        activeRoutePatch: {
          view: "ranks",
          platform: platformKey,
        },
        children: categories,
      };
    })
    .filter(Boolean);
}

export function buildMobileRankNavigationItems(platformItem) {
  const categories = Array.isArray(platformItem?.children) ? platformItem.children : [];
  return categories.flatMap((category) => {
    const rankItems = Array.isArray(category?.rankItems) && category.rankItems.length
      ? category.rankItems
      : Array.isArray(category?.children) && category.children.length
        ? category.children
        : [category];
    const singleRank = rankItems.length === 1;
    return rankItems
      .map((rankItem) => {
        const routePatch = rankItem?.routePatch || category?.routePatch;
        return {
          key: `${category?.key || ""}:${rankItem?.key || category?.key || ""}`,
          label: formatMobileRankNavigationLabel(category?.label, rankItem?.label, singleRank),
          routePatch,
        };
      })
      .filter((item) => item.routePatch?.rank);
  });
}

export function hasSearchKeywordInResultTitles(results, keyword) {
  const normalizedKeyword = normalizeSearchText(keyword);
  if (!normalizedKeyword) {
    return false;
  }
  return (Array.isArray(results) ? results : []).some((item) => {
    const normalizedTitle = normalizeSearchText(item?.title ?? item?.name);
    return normalizedTitle.includes(normalizedKeyword);
  });
}

export function shouldUseManboLibraryFallbackForMissevanSearch(data, keyword) {
  if (data?.meta?.source !== "missevan_api") {
    return false;
  }
  return !hasSearchKeywordInResultTitles(data?.results, keyword);
}

export function formatCooldownRemaining(until) {
  const remainingMs = Math.max(0, Number(until ?? 0) - Date.now());
  if (!remainingMs) {
    return "可用";
  }
  const totalMinutes = Math.ceil(remainingMs / 60000);
  return `${totalMinutes}分钟`;
}

export function getRemainingCooldownHours(config = null, fallbackHours = 4) {
  const until = Number(config?.cooldownUntil ?? 0);
  if (until > Date.now()) {
    return Math.ceil(((until - Date.now()) / (60 * 60 * 1000)) * 10) / 10;
  }
  return Number(config?.cooldownHours ?? fallbackHours ?? 4);
}

export function getRemainingCooldownMinutes(config = null, fallbackHours = 4) {
  const until = Number(config?.cooldownUntil ?? 0);
  if (until > Date.now()) {
    return Math.max(1, Math.ceil((until - Date.now()) / 60000));
  }
  const hours = Number(config?.cooldownHours ?? fallbackHours ?? 4) || Number(fallbackHours ?? 4) || 4;
  return Math.max(1, Math.ceil(hours * 60));
}

export function getMissevanAccessDeniedMessage(config = null, fallbackHours = 4) {
  return `当前所有备份节点都在冷却中，请${getRemainingCooldownMinutes(config, fallbackHours)}分钟之后再来，或使用桌面版。`;
}

export const MISSEVAN_DESKTOP_ACCESS_HINT = "如果遇到接口受限，请使用任意浏览器打开猫耳首页按提示解锁即可。";

export function createStatsState() {
  return {
    progress: 0,
    currentAction: "",
    startedAt: 0,
    elapsedMs: 0,
    playCountResults: [],
    playCountSelectedEpisodeCount: 0,
    playCountTotal: 0,
    playCountFailed: false,
    idResults: [],
    suspectedOverflowEpisodes: [],
    idSelectedEpisodeCount: 0,
    totalDanmaku: 0,
    totalUsers: 0,
    revenueResults: [],
    revenueSummary: null,
    isRunning: false,
    activeTaskId: "",
    activeTaskType: "",
    currentHistoryEntryId: "",
  };
}

export const STATS_HISTORY_LIMIT = 20;
export const STATS_HISTORY_STORAGE_KEY = "missevan-counter.history.v1";
export const STATS_HISTORY_STORAGE_VERSION = 1;

function getHistoryStorage(storage = null) {
  if (storage) {
    return storage;
  }
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage || null;
  } catch (_) {
    return null;
  }
}

function createEmptyPersistedHistory() {
  return {
    missevan: [],
    manbo: [],
  };
}

function normalizeHistoryMetric(metric, keyField = "key") {
  if (!metric || typeof metric !== "object") {
    return null;
  }
  const key = String(metric[keyField] ?? "").trim();
  const label = String(metric.label ?? "").trim();
  const value = String(metric.value ?? "").trim();
  const unit = String(metric.unit ?? "").trim();
  if (!key || !label || !value) {
    return null;
  }
  return {
    [keyField]: key,
    ...(keyField === "metricKey" ? { key } : {}),
    label,
    value,
    ...(unit ? { unit } : {}),
  };
}

function normalizeHistoryItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  const id = String(item.id ?? "").trim();
  const title = String(item.title ?? "").trim();
  const segments = Array.isArray(item.segments)
    ? item.segments.map((segment) => normalizeHistoryMetric(segment, "metricKey")).filter(Boolean)
    : [];
  if (!id || !title || segments.length === 0) {
    return null;
  }
  return {
    id,
    title,
    segments,
  };
}

function normalizeHistoryEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const id = String(entry.id ?? "").trim();
  const platform = String(entry.platform ?? "").trim();
  const createdAt = Number(entry.createdAt ?? 0);
  const createdAtLabel = String(entry.createdAtLabel ?? "").trim();
  const taskType = String(entry.taskType ?? "").trim();
  const summaryMetrics = Array.isArray(entry.summaryMetrics)
    ? entry.summaryMetrics.map((metric) => normalizeHistoryMetric(metric)).filter(Boolean)
    : [];
  const items = Array.isArray(entry.items) ? entry.items.map(normalizeHistoryItem).filter(Boolean) : [];
  if (!id || !platform || !Number.isFinite(createdAt) || !createdAtLabel || !taskType || items.length === 0) {
    return null;
  }
  return {
    id,
    platform,
    createdAt,
    createdAtLabel,
    taskType,
    summaryMetrics,
    items,
  };
}

function normalizeHistoryEntryCollection(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.map(normalizeHistoryEntry).filter(Boolean).slice(0, STATS_HISTORY_LIMIT);
}

export function loadPersistedHistoryEntries(storage = null) {
  const historyStorage = getHistoryStorage(storage);
  const emptyHistory = createEmptyPersistedHistory();
  if (!historyStorage) {
    return emptyHistory;
  }

  try {
    const rawValue = historyStorage.getItem(STATS_HISTORY_STORAGE_KEY);
    if (!rawValue) {
      return emptyHistory;
    }
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== "object" || Number(parsed.version) !== STATS_HISTORY_STORAGE_VERSION) {
      return emptyHistory;
    }
    return {
      missevan: normalizeHistoryEntryCollection(parsed.missevan),
      manbo: normalizeHistoryEntryCollection(parsed.manbo),
    };
  } catch (_) {
    return emptyHistory;
  }
}

export function savePersistedHistoryEntries(historyByPlatform = {}, storage = null) {
  const historyStorage = getHistoryStorage(storage);
  if (!historyStorage) {
    return;
  }

  const payload = {
    version: STATS_HISTORY_STORAGE_VERSION,
    missevan: normalizeHistoryEntryCollection(historyByPlatform.missevan),
    manbo: normalizeHistoryEntryCollection(historyByPlatform.manbo),
  };

  try {
    historyStorage.setItem(STATS_HISTORY_STORAGE_KEY, JSON.stringify(payload));
  } catch (_) {
  }
}

export function createPlatformState() {
  return {
    searchForm: {
      keyword: "",
      manualInput: "",
    },
    searchResultSource: "search",
    searchKeyword: "",
    searchNextOffset: 0,
    searchHasMore: false,
    searchCurrentPage: 1,
    searchPageSize: 5,
    searchTotalMatched: 0,
    searchPageCache: {},
    isLoadingMoreResults: false,
    searchResults: [],
    dramas: [],
    selectedEpisodesSnapshot: [],
    historyEntries: [],
    stats: createStatsState(),
  };
}

export function createRuntimeMeta() {
  return {
    activeRunId: 0,
    activeAbortController: null,
    activeElapsedTimer: null,
    completedHistoryTaskIds: new Set(),
  };
}

export function isAbortError(error) {
  return error?.name === "AbortError";
}

export function extractResponseItems(data) {
  if (Array.isArray(data)) {
    return data;
  }
  return Array.isArray(data?.items) ? data.items : [];
}

export function collectSelectedEpisodesFromDramas(dramas = []) {
  const selectedEpisodes = [];
  dramas.forEach((drama) => {
    const dramaId = String(drama?.drama?.id ?? "").trim();
    const dramaTitle = drama?.drama?.name || "";
    const episodes = Array.isArray(drama?.episodes?.episode) ? drama.episodes.episode : [];
    episodes.forEach((episode) => {
      if (episode.selected) {
        selectedEpisodes.push({
          drama_id: dramaId,
          sound_id: episode.sound_id,
          drama_title: dramaTitle,
          episode_title: episode.name,
          duration: Number(episode.duration ?? 0),
        });
      }
    });
  });
  return selectedEpisodes;
}

export function resolveIdStatisticsSource({
  platform = "missevan",
  dramas = [],
  selectedEpisodes = [],
  source = "",
} = {}) {
  const fallbackSource = String(source ?? "").trim();
  const normalizedSelectedEpisodes = Array.isArray(selectedEpisodes)
    ? selectedEpisodes
    : [];
  const selectedDramaIds = new Set(
    normalizedSelectedEpisodes
      .map((episode) => String(episode?.drama_id ?? "").trim())
      .filter(Boolean)
  );
  if (!normalizedSelectedEpisodes.length || selectedDramaIds.size !== 1) {
    return fallbackSource;
  }

  const [dramaId] = selectedDramaIds;
  const drama = (Array.isArray(dramas) ? dramas : []).find(
    (item) => String(item?.drama?.id ?? "").trim() === dramaId
  );
  const episodes = Array.isArray(drama?.episodes?.episode)
    ? drama.episodes.episode
    : [];
  const paidEpisodeIds = new Set(
    episodes
      .filter(
        (episode) =>
          isPaidEpisode(platform, episode) || isMemberEpisode(platform, episode)
      )
      .map((episode) => String(episode?.sound_id ?? "").trim())
      .filter(Boolean)
  );
  const selectedEpisodeIds = new Set(
    normalizedSelectedEpisodes
      .map((episode) => String(episode?.sound_id ?? "").trim())
      .filter(Boolean)
  );
  const isCompletePaidSelection =
    paidEpisodeIds.size > 0 &&
    selectedEpisodeIds.size === paidEpisodeIds.size &&
    Array.from(selectedEpisodeIds).every((soundId) =>
      paidEpisodeIds.has(soundId)
    );

  return isCompletePaidSelection ? `${dramaId}payID` : fallbackSource;
}

export function buildPlayCountDramasFromDramas(dramas = []) {
  return (Array.isArray(dramas) ? dramas : [])
    .map((drama) => {
      const dramaId = String(drama?.drama?.id ?? "").trim();
      const dramaTitle = drama?.drama?.name || "";
      const rawTotalViewCount = drama?.drama?.view_count;
      const totalViewCount = rawTotalViewCount == null || String(rawTotalViewCount).trim() === ""
        ? null
        : Number(rawTotalViewCount);
      const episodes = Array.isArray(drama?.episodes?.episode) ? drama.episodes.episode : [];
      const normalizedEpisodes = episodes
        .map((episode) => ({
          drama_id: dramaId,
          sound_id: episode.sound_id,
          drama_title: dramaTitle,
          episode_title: episode.name,
          duration: Number(episode.duration ?? 0),
          selected: Boolean(episode.selected),
        }))
        .filter((episode) => String(episode.sound_id ?? "").trim());

      if (!normalizedEpisodes.length) {
        return null;
      }
      if (!normalizedEpisodes.some((episode) => episode.selected)) {
        return null;
      }

      return {
        drama_id: dramaId,
        drama_title: dramaTitle,
        total_view_count: Number.isFinite(totalViewCount) && totalViewCount >= 0 ? totalViewCount : null,
        total_episode_count: normalizedEpisodes.length,
        episodes: normalizedEpisodes,
      };
    })
    .filter(Boolean);
}

export function selectDramaEpisodesByMode(dramas = [], dramaIds = [], options = {}) {
  const dramaIdSet = new Set((Array.isArray(dramaIds) ? dramaIds : []).map((id) => String(id)));
  const mode = options.mode === "paid" ? "paid" : "all";
  const checked = Boolean(options.checked);
  const shouldExpand = options.expand === true;
  const isSelectableEpisode =
    typeof options.isSelectableEpisode === "function" ? options.isSelectableEpisode : () => true;
  let hasMatchingEpisode = false;

  (Array.isArray(dramas) ? dramas : []).forEach((drama) => {
    if (!dramaIdSet.has(String(drama?.drama?.id))) {
      return;
    }
    const episodes = Array.isArray(drama?.episodes?.episode) ? drama.episodes.episode : [];
    episodes.forEach((episode) => {
      const matchesMode = mode === "all" || isSelectableEpisode(episode);
      if (!matchesMode) {
        return;
      }
      hasMatchingEpisode = true;
      episode.selected = checked;
    });
    if (shouldExpand) {
      drama.expanded = true;
    }
  });

  return { hasMatchingEpisode };
}

export function normalizeOptionalNumber(value) {
  if (value == null || value === "") {
    return null;
  }
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

export function buildUniqueUserIds(collections) {
  const userSet = new Set();
  collections.forEach((item) => {
    const users = Array.isArray(item?.users) ? item.users : item;
    (Array.isArray(users) ? users : []).forEach((uid) => userSet.add(uid));
  });
  return Array.from(userSet);
}

export function getRevenuePaidCountLabel(result) {
  if (result?.platform === "missevan") {
    const payType = Number(result?.payType ?? -1);
    if (result?.revenueType === "episode" || payType === 1) {
      return "付费集总ID数";
    }
    if (result?.revenueType === "season" || payType === 2) {
      return "付费集去重ID数";
    }
  }
  if (result?.platform === "manbo" && result?.paidCountSource === "pay_count") {
    return "付费人数";
  }
  return "付费用户 ID 数";
}

function isManboRewardOnlyRevenueResult(result) {
  if (result?.platform !== "manbo") {
    return false;
  }
  if (result?.summaryRevenueMode === "member_reward" || result?.revenueType === "member") {
    return true;
  }
  const rewardValue = Number(result?.diamondValue ?? result?.rewardTotal ?? 0);
  const titlePrice = Number(result?.titlePrice ?? result?.titlePriceTotal ?? 0);
  return rewardValue > 0 && titlePrice <= 0 && !shouldShowRevenueRange(result);
}

function isMissevanRewardOnlyRevenueResult(result) {
  if (result?.platform !== "missevan") {
    return false;
  }
  return Boolean(
    result?.revenueType === "reward_only" ||
      result?.vipOnlyReward ||
      result?.summaryRevenueMode === "member_reward" ||
      (!result?.failed && !result?.hasSummaryPrice && Number(result?.rewardTotal ?? 0) > 0)
  );
}

export function getRevenueDisplayLabel(result) {
  if (isManboRewardOnlyRevenueResult(result)) {
    return "收益预估（仅计算投喂，元）";
  }
  if (isMissevanRewardOnlyRevenueResult(result)) {
    return "收益预估（仅计算打赏，元）";
  }
  return "收益预估（元）";
}

function hasRevenueRange(result) {
  if (!result || result.summaryRevenueMode === "single" || result.summaryRevenueMode === "member_reward") {
    return false;
  }
  return Number.isFinite(Number(result?.minRevenueYuan)) && Number.isFinite(Number(result?.maxRevenueYuan));
}

export function getSummaryRevenueMode(result, platform) {
  if (!result) {
    return "single";
  }
  if (result.summaryRevenueMode) {
    return result.summaryRevenueMode;
  }
  if (platform === "missevan" && result.vipOnlyReward) {
    return "member_reward";
  }
  if (
    platform === "manbo" &&
    (result.revenueType === "member" ||
      (Number(result?.diamondValue ?? 0) > 0 &&
        Number(result?.titlePrice ?? 0) <= 0 &&
        !hasRevenueRange({ ...result, summaryRevenueMode: "single" })))
  ) {
    return "member_reward";
  }
  if (hasRevenueRange(result)) {
    return "range";
  }
  return "single";
}

export function getSummaryRevenueTotals(results, platform) {
  let estimatedRevenueYuan = 0;
  let minRevenueYuan = null;
  let maxRevenueYuan = null;
  let hasRevenueRangeValue = false;
  let hasMemberReward = false;

  results.forEach((item) => {
    const mode = getSummaryRevenueMode(item, platform);
    if (mode === "member_reward") {
      hasMemberReward = true;
      const amount = platform === "manbo" ? Number(item?.diamondValue ?? 0) / 100 : Number(item?.rewardCoinTotal ?? 0) / 10;
      estimatedRevenueYuan += amount;
      if (hasRevenueRangeValue) {
        minRevenueYuan = Number(minRevenueYuan ?? 0) + amount;
        maxRevenueYuan = Number(maxRevenueYuan ?? 0) + amount;
      }
      return;
    }

    if (mode === "range" && hasRevenueRange(item)) {
      if (!hasRevenueRangeValue) {
        minRevenueYuan = estimatedRevenueYuan;
        maxRevenueYuan = estimatedRevenueYuan;
        hasRevenueRangeValue = true;
      }
      minRevenueYuan += Number(item?.minRevenueYuan ?? 0);
      maxRevenueYuan += Number(item?.maxRevenueYuan ?? 0);
      estimatedRevenueYuan += Number(item?.estimatedRevenueYuan ?? 0);
      return;
    }

    const amount = Number(item?.estimatedRevenueYuan ?? 0);
    estimatedRevenueYuan += amount;
    if (hasRevenueRangeValue) {
      minRevenueYuan = Number(minRevenueYuan ?? 0) + amount;
      maxRevenueYuan = Number(maxRevenueYuan ?? 0) + amount;
    }
  });

  if (estimatedRevenueYuan <= 0 && hasMemberReward) {
    const rewardTotal = results.reduce((sum, item) => {
      const mode = getSummaryRevenueMode(item, platform);
      if (mode !== "member_reward") {
        return sum;
      }
      return sum + (platform === "manbo" ? Number(item?.diamondValue ?? 0) / 100 : Number(item?.rewardCoinTotal ?? 0) / 10);
    }, 0);
    estimatedRevenueYuan = rewardTotal;
    if (hasRevenueRangeValue) {
      minRevenueYuan = Number(minRevenueYuan ?? 0) + rewardTotal;
      maxRevenueYuan = Number(maxRevenueYuan ?? 0) + rewardTotal;
    }
  }

  return {
    estimatedRevenueYuan,
    minRevenueYuan,
    maxRevenueYuan,
  };
}

function getRevenueCurrencyUnit(platform) {
  return platform === "manbo" ? "红豆" : "钻石";
}

function buildRevenueSummaryTitle(summary) {
  const baseTitle = `汇总 / 已选 ${summary.selectedDramaCount} 部`;
  if (!summary || summary.failed || !summary.hasSummaryPrice) {
    return baseTitle;
  }
  const titleMemberPriceTotal = normalizeOptionalNumber(summary.titleMemberPriceTotal);
  if (titleMemberPriceTotal != null) {
    return `${baseTitle}，总价 ${summary.titlePriceTotal}（会员 ${titleMemberPriceTotal}）${summary.currencyUnit}`;
  }
  return `${baseTitle}，总价 ${summary.titlePriceTotal} ${summary.currencyUnit}`;
}

export function buildRevenueSummary(results, currentPlatform) {
  if (!Array.isArray(results) || results.length === 0) {
    return null;
  }

  const platform = results[0]?.platform || currentPlatform;
  const failed = results.some((item) => item?.failed);
  const paidUserIds = buildUniqueUserIds(results.map((item) => item?.paidUserIds || []));
  let totalPayCount = 0;
  let hasPayCount = false;
  let allPayCount = results.length > 0;
  let hasDanmakuIds = false;
  results.forEach((item) => {
    const paidCountSource = String(item?.paidCountSource || "");
    if (paidCountSource === "pay_count") {
      hasPayCount = true;
      totalPayCount += Number(item?.payCount ?? item?.paidUserCount ?? 0);
    } else {
      allPayCount = false;
      hasDanmakuIds = true;
    }
  });
  const totalDanmakuPaidUserCount = paidUserIds.length;
  const paidCountSourceSummary = allPayCount ? "pay_count" : hasPayCount ? "mixed" : "danmaku_ids";
  const rewardTotal = results.reduce((sum, item) => {
    const rewardValue = platform === "manbo" ? Number(item?.diamondValue ?? 0) : Number(item?.rewardCoinTotal ?? 0);
    return sum + rewardValue;
  }, 0);
  const totalViewCount = results.reduce((sum, item) => sum + Number(item?.viewCount ?? 0), 0);
  const rewardNumValues =
    platform === "missevan"
      ? results.map((item) => normalizeOptionalNumber(item?.rewardNum)).filter((value) => value != null)
      : [];
  const rewardNumTotal = platform === "missevan" ? (rewardNumValues.length ? rewardNumValues.reduce((sum, value) => sum + value, 0) : null) : null;
  const revenueTotals = getSummaryRevenueTotals(results, platform);
  const summaryRevenueModes = results.map((item) => getSummaryRevenueMode(item, platform));
  const summaryRevenueMode =
    summaryRevenueModes.length > 0 && summaryRevenueModes.every((mode) => mode === "member_reward")
      ? "member_reward"
      : summaryRevenueModes.some((mode) => mode === "range")
        ? "range"
        : "single";
  const priceItems = results.filter((item) => item?.includeInSummaryPrice);
  const hasSummaryPrice = !failed && priceItems.length > 0;
  const titlePriceTotal = hasSummaryPrice ? priceItems.reduce((sum, item) => sum + Number(item?.titlePrice ?? 0), 0) : null;
  const memberPriceItems = priceItems.filter((item) => Number.isFinite(Number(item?.titleMemberPrice)) && Number(item?.titleMemberPrice) > 0);
  const titleMemberPriceTotal =
    hasSummaryPrice && memberPriceItems.length > 0
      ? memberPriceItems.reduce((sum, item) => sum + Number(item?.titleMemberPrice ?? 0), 0)
      : null;

  const summary = {
    platform,
    currencyUnit: getRevenueCurrencyUnit(platform),
    selectedDramaCount: results.length,
    totalPaidUserCount:
      paidCountSourceSummary === "pay_count" ? totalPayCount : paidCountSourceSummary === "danmaku_ids" ? totalDanmakuPaidUserCount : null,
    totalPayCount: hasPayCount ? totalPayCount : null,
    totalDanmakuPaidUserCount: hasDanmakuIds ? totalDanmakuPaidUserCount : null,
    paidCountSourceSummary,
    paidUserIds,
    totalViewCount,
    rewardTotal,
    rewardNum: rewardNumTotal,
    hasSummaryPrice,
    titlePriceTotal,
    titleMemberPriceTotal,
    summaryRevenueMode,
    estimatedRevenueYuan: revenueTotals.estimatedRevenueYuan,
    minRevenueYuan: revenueTotals.minRevenueYuan,
    maxRevenueYuan: revenueTotals.maxRevenueYuan,
    failed,
    summaryTitle: "",
  };
  summary.summaryTitle = buildRevenueSummaryTitle(summary);
  return summary;
}

function summaryShowsPositiveRevenue(summary) {
  if (!summary || summary.failed) {
    return false;
  }
  return (
    Number(summary?.estimatedRevenueYuan ?? 0) > 0 ||
    Number(summary?.minRevenueYuan ?? 0) > 0 ||
    Number(summary?.maxRevenueYuan ?? 0) > 0
  );
}

export function resolveRevenueSummaryForHistory(results, currentPlatform, incomingSummary = null) {
  if (!Array.isArray(results) || results.length === 0) {
    return null;
  }

  const successfulResults = results.filter((item) => !item?.failed);
  const fallbackResults = successfulResults.length > 0 ? successfulResults : results;
  const rebuiltSummary = buildRevenueSummary(fallbackResults, currentPlatform);

  if (!incomingSummary) {
    return rebuiltSummary;
  }

  if (incomingSummary.failed && successfulResults.length > 0) {
    return rebuiltSummary;
  }

  if (summaryShowsPositiveRevenue(rebuiltSummary) && !summaryShowsPositiveRevenue(incomingSummary)) {
    return rebuiltSummary;
  }

  return incomingSummary;
}

function formatPlayCount(value) {
  const count = Number(value ?? 0);
  if (!Number.isFinite(count) || count <= 0) {
    return "0";
  }
  if (count < 10000) {
    return `${count}`;
  }
  if (count < 100000000) {
    return `${(count / 10000).toFixed(1)}万`;
  }
  return `${(count / 100000000).toFixed(2)}亿`;
}

export function formatPlainNumber(value) {
  const count = Number(value ?? 0);
  return Number.isFinite(count) ? `${Math.trunc(count)}` : "0";
}

export function formatRankCompactCount(value) {
  const count = Number(value ?? 0);
  if (!Number.isFinite(count) || count <= 0) {
    return "0";
  }
  if (count < 10000) {
    return `${Math.trunc(count)}`;
  }
  if (count < 100000000) {
    return `${(count / 10000).toFixed(2)}万`;
  }
  return `${(count / 100000000).toFixed(2)}亿`;
}

export function formatPlayCountDisplay(value, failed) {
  if (failed) {
    return "部分分集统计失败";
  }
  return formatPlayCount(value);
}

export function formatPlayCountWanFixed(value) {
  const count = Number(value ?? 0);
  if (!Number.isFinite(count) || count <= 0) {
    return "0.0万";
  }
  return `${(count / 10000).toFixed(1)}万`;
}

function formatRevenue(value) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return "0 元";
  }
  if (amount >= 100000000) {
    return `${(amount / 100000000).toFixed(2)} 亿元`;
  }
  if (amount >= 10000) {
    return `${(amount / 10000).toFixed(1)} 万元`;
  }
  if (Number.isInteger(amount)) {
    return `${amount} 元`;
  }
  return `${amount.toFixed(2).replace(/\.?0+$/, "")} 元`;
}

export function shouldShowRevenueRange(result) {
  if (!result || result.failed) {
    return false;
  }
  if (result.minRevenueYuan == null || result.maxRevenueYuan == null) {
    return false;
  }
  return Number.isFinite(Number(result.minRevenueYuan)) && Number.isFinite(Number(result.maxRevenueYuan));
}

export function formatRevenueDisplayValue(result, formatter = formatCompactMetricValue, rangeFormatter = null) {
  if (shouldShowRevenueRange(result)) {
    const minValue = Number(result?.minRevenueYuan ?? 0);
    const maxValue = Number(result?.maxRevenueYuan ?? 0);
    if (minValue === maxValue) {
      return formatter(minValue);
    }
    if (typeof rangeFormatter === "function") {
      return rangeFormatter(minValue, maxValue);
    }
    return `${formatter(minValue)}-${formatter(maxValue)}`;
  }
  return formatter(result?.estimatedRevenueYuan);
}

export function formatHistoryTimestamp(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
}

export function formatDeviceDateTime(value, options = {}) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "未知";
  }

  let date = value instanceof Date ? value : null;
  if (!date) {
    if (typeof value === "number" && Number.isFinite(value)) {
      date = new Date(value);
    } else if (/^\d{11,}$/.test(normalized)) {
      const timestamp = Number(normalized);
      date = Number.isFinite(timestamp) ? new Date(timestamp) : new Date(normalized);
    } else if (/^\d{10}$/.test(normalized)) {
      const timestamp = Number(normalized) * 1000;
      date = Number.isFinite(timestamp) ? new Date(timestamp) : new Date(normalized);
    } else {
      date = new Date(normalized);
    }
  }
  if (Number.isNaN(date.getTime())) {
    return normalized;
  }

  const dateTimeOptions = {
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  };
  if (options.timeZone) {
    dateTimeOptions.timeZone = options.timeZone;
  }

  const parts = new Intl.DateTimeFormat("zh-CN", dateTimeOptions)
    .formatToParts(date)
    .reduce((map, part) => {
      map[part.type] = part.value;
      return map;
    }, {});

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function trimTrailingZero(value) {
  return value.replace(/\.?0+$/, "");
}

export function formatCompactMetricValue(value) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return "0";
  }
  if (amount >= 100000000) {
    return `${trimTrailingZero((amount / 100000000).toFixed(2))}亿`;
  }
  if (amount >= 10000) {
    return `${trimTrailingZero((amount / 10000).toFixed(1))}万`;
  }
  if (Number.isInteger(amount)) {
    return `${amount}`;
  }
  return trimTrailingZero(amount.toFixed(2));
}

export function formatSignedCompactMetricValue(value) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount === 0) {
    return "0";
  }
  const sign = amount > 0 ? "+" : "-";
  return `${sign}${formatCompactMetricValue(Math.abs(amount))}`;
}

function hasRevenueRangeValues(result) {
  return Number.isFinite(Number(result?.minRevenueYuan)) && Number.isFinite(Number(result?.maxRevenueYuan));
}

function formatCompactRevenue(result) {
  return formatRevenueDisplayValue(result, formatCompactMetricValue);
}

function formatHistoryRewardMetric(platform, value) {
  return platform === "manbo" ? formatCompactMetricValue(value) : formatCompactMetricValue(value);
}

function getHistoryRewardLabel(platform) {
  return platform === "manbo" ? "投喂总数" : "打赏榜总和";
}

function buildHistoryMetricSegment(metricKey, label, value, unit = "") {
  return {
    key: metricKey,
    kind: "metric",
    metricKey,
    label,
    value,
    unit,
  };
}

export function getHistoryMetricIconKey(metric) {
  const metricKey = metric?.key || metric?.metricKey || "";
  if (metricKey === "episodePaidUserCountTotal" || metricKey === "seasonPaidUserCount") {
    return "uniqueUsers";
  }
  return metricKey;
}

function hasFiniteOptionalNumber(value) {
  return value != null && Number.isFinite(Number(value));
}

function isMissevanEpisodeRevenueResult(drama) {
  return drama?.platform === "missevan" && (
    drama?.revenueType === "episode" || Number(drama?.payType ?? -1) === 1
  );
}

export function buildRevenuePaidMetricSegments(drama) {
  if (drama?.platform === "manbo" && drama?.paidCountSource === "pay_count") {
    return [buildHistoryMetricSegment("paidCount", "付费人数", formatPlainNumber(drama?.paidUserCount))];
  }
  if (isMissevanEpisodeRevenueResult(drama)) {
    const seasonPaidUserCount =
      drama?.seasonPaidUserCount ?? (Array.isArray(drama?.paidUserIds) ? drama.paidUserIds.length : 0);
    return [
      buildHistoryMetricSegment(
        "episodePaidUserCountTotal",
        "付费集总ID数",
        formatPlainNumber(drama?.paidUserCount),
        "ID"
      ),
      buildHistoryMetricSegment(
        "seasonPaidUserCount",
        "付费集去重ID数",
        formatPlainNumber(seasonPaidUserCount),
        "ID"
      ),
    ];
  }
  if (drama?.platform === "missevan" && (drama?.revenueType === "season" || Number(drama?.payType ?? -1) === 2)) {
    return [buildHistoryMetricSegment("uniqueUsers", "付费集去重ID数", formatPlainNumber(drama?.paidUserCount), "ID")];
  }
  return [buildHistoryMetricSegment("uniqueUsers", "付费用户 ID 数", formatPlainNumber(drama?.paidUserCount), "ID")];
}

function buildRevenueSummaryPaidMetricSegments(summary) {
  if (summary?.paidCountSourceSummary === "mixed") {
    return [
      buildHistoryMetricSegment("paidCount", "总付费人次", formatPlainNumber(summary?.totalPayCount)),
      buildHistoryMetricSegment("uniqueUsers", "总和去重 ID", formatPlainNumber(summary?.totalDanmakuPaidUserCount), "ID"),
    ];
  }

  if (summary?.platform === "manbo" && summary?.paidCountSourceSummary === "pay_count") {
    return [buildHistoryMetricSegment("paidCount", "总付费人次", formatPlainNumber(summary?.totalPaidUserCount))];
  }

  return [buildHistoryMetricSegment("uniqueUsers", "总和去重 ID", formatPlainNumber(summary?.totalPaidUserCount), "ID")];
}

function buildPlayCountHistoryEntry(platform, stats, createdAt) {
  if (!Array.isArray(stats?.playCountResults) || stats.playCountResults.length === 0) {
    return null;
  }

  const hasSummary = stats.playCountResults.length > 1;

  return {
    id: `${platform}-play_count-${createdAt}`,
    platform,
    createdAt,
    taskType: "play_count",
    summaryMetrics: hasSummary
      ? [
          {
            key: "playCount",
            label: "总播放量",
            value: formatPlayCountDisplay(stats.playCountTotal, stats.playCountFailed),
          },
        ]
      : [],
    items: stats.playCountResults.map((drama, index) => ({
      id: String(drama?.dramaId ?? drama?.title ?? `play-${index}`),
      title: drama?.title || "未知作品",
      segments: [
        buildHistoryMetricSegment("playCount", "总播放量", formatPlayCountDisplay(drama?.playCountTotal, drama?.playCountFailed)),
      ],
    })),
  };
}

function buildIdHistoryEntry(platform, stats, createdAt) {
  if (!Array.isArray(stats?.idResults) || stats.idResults.length === 0) {
    return null;
  }

  const hasSummary = stats.idResults.length > 1;

  return {
    id: `${platform}-id-${createdAt}`,
    platform,
    createdAt,
    taskType: "id",
    summaryMetrics: hasSummary
      ? [
          {
            key: "danmakuCount",
            label: "总弹幕数",
            value: formatPlainNumber(stats.totalDanmaku),
          },
          {
            key: "uniqueUsers",
            label: "去重 ID",
            value: formatCompactMetricValue(stats.totalUsers),
          },
        ]
      : [],
    items: stats.idResults.map((drama, index) => ({
      id: String(drama?.dramaId ?? drama?.title ?? `id-${index}`),
      title: drama?.title || "未知作品",
      segments: [
        buildHistoryMetricSegment("danmakuCount", "总弹幕数", formatPlainNumber(drama?.danmaku)),
        buildHistoryMetricSegment("uniqueUsers", "去重 ID", formatPlainNumber(drama?.users), "ID"),
      ],
    })),
  };
}

function buildRevenueHistoryEntry(platform, stats, createdAt) {
  if (!Array.isArray(stats?.revenueResults) || stats.revenueResults.length === 0) {
    return null;
  }

  const successfulResults = stats.revenueResults.filter((drama) => !drama?.failed);
  if (successfulResults.length === 0) {
    return null;
  }

  const revenueSummary = resolveRevenueSummaryForHistory(stats.revenueResults, platform, stats?.revenueSummary || null);
  const hasSummary = successfulResults.length > 1;

  return {
    id: `${platform}-revenue-${createdAt}`,
    platform,
    createdAt,
    taskType: "revenue",
    summaryMetrics: hasSummary
      ? [
          ...buildRevenueSummaryPaidMetricSegments(revenueSummary),
          {
            key: "playCount",
            label: "总播放量",
            value: formatPlayCountWanFixed(revenueSummary.totalViewCount),
          },
          {
            key: "rewardTotal",
            label: getHistoryRewardLabel(platform),
            value: formatHistoryRewardMetric(platform, revenueSummary.rewardTotal),
          },
          ...(hasFiniteOptionalNumber(revenueSummary?.rewardNum)
            ? [
                {
                  key: "rewardNum",
                  label: "打赏人数",
                  value: formatPlainNumber(revenueSummary.rewardNum),
                },
              ]
            : []),
          {
            key: "revenue",
            label: "收益预估",
            value: formatCompactRevenue(revenueSummary),
          },
        ]
      : [],
    items: successfulResults
      .map((drama, index) => {
        const rewardValue = platform === "manbo" ? Number(drama?.diamondValue ?? drama?.rewardTotal ?? 0) : Number(drama?.rewardCoinTotal ?? drama?.rewardTotal ?? 0);
        return {
          id: String(drama?.dramaId ?? drama?.title ?? `revenue-${index}`),
          title: drama?.title || "未知作品",
          segments: [
            ...buildRevenuePaidMetricSegments(drama),
            buildHistoryMetricSegment("rewardTotal", getHistoryRewardLabel(platform), formatHistoryRewardMetric(platform, rewardValue), platform === "manbo" ? "红豆" : "钻石"),
            ...(hasFiniteOptionalNumber(drama?.rewardNum)
              ? [buildHistoryMetricSegment("rewardNum", "打赏人数", formatPlainNumber(drama.rewardNum))]
              : []),
            buildHistoryMetricSegment("revenue", "收益预估", formatCompactRevenue(drama), "元"),
          ],
        };
      }),
  };
}

export function createStatsHistoryEntry(platform, stats, options = {}) {
  const normalizedPlatform = String(platform || "").trim();
  const createdAt = Number(options.createdAt ?? Date.now());
  const taskType = String(options.taskType ?? stats?.activeTaskType ?? "").trim();
  if (!normalizedPlatform || !stats || !taskType) {
    return null;
  }

  const entry =
    taskType === "play_count"
      ? buildPlayCountHistoryEntry(normalizedPlatform, stats, createdAt)
      : taskType === "id"
        ? buildIdHistoryEntry(normalizedPlatform, stats, createdAt)
        : taskType === "revenue"
          ? buildRevenueHistoryEntry(normalizedPlatform, stats, createdAt)
          : null;

  if (!entry || !Array.isArray(entry.items) || entry.items.length === 0) {
    return null;
  }

  return {
    ...entry,
    createdAtLabel: formatHistoryTimestamp(createdAt),
    summaryMetrics: Array.isArray(entry.summaryMetrics)
      ? entry.summaryMetrics.filter((metric) => String(metric?.value ?? "").trim() !== "")
      : [],
    items: entry.items
      .map((item) => ({
        ...item,
        segments: Array.isArray(item?.segments)
          ? item.segments.filter((segment) => String(segment?.value ?? "").trim() !== "")
          : [],
      }))
      .filter((item) => item.segments.length > 0),
  };
}

export function formatElapsed(value) {
  const totalSeconds = Math.max(0, Math.floor(Number(value ?? 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function parseNumericIds(rawValue) {
  return Array.from(
    new Set(
      String(rawValue ?? "")
        .split(/[\s,，]+/)
        .map((item) => item.trim())
        .filter((item) => /^\d+$/.test(item))
        .map((item) => Number(item))
    )
  );
}

export function parseRawItems(rawValue) {
  return Array.from(
    new Set(
      String(rawValue ?? "")
        .split(/[\s,，]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_) {
    return false;
  }
}

function isManboHostUrl(value) {
  const raw = String(value ?? "").trim();
  if (!isHttpUrl(raw)) {
    return false;
  }

  try {
    const url = new URL(raw);
    return (
      /manbo/i.test(url.hostname) ||
      /(^|\.)kilamanbo\.(com|world)$/i.test(url.hostname) ||
      /(^|\.)hongdoulive\.com$/i.test(url.hostname)
    );
  } catch (_) {
    return false;
  }
}

function isManboImportToken(value) {
  const raw = String(value ?? "").trim();
  if (/^\d+$/.test(raw)) {
    return /^\d{18,20}$/.test(raw);
  }

  return isManboHostUrl(raw);
}

function isMissevanHostUrl(value) {
  const raw = String(value ?? "").trim();
  if (!isHttpUrl(raw)) {
    return false;
  }

  try {
    const url = new URL(raw);
    return /(^|\.)missevan\.com$/i.test(url.hostname);
  } catch (_) {
    return false;
  }
}

function isManboCrossImportToken(value) {
  const raw = String(value ?? "").trim();
  return /^\d{18,20}$/.test(raw) || isManboHostUrl(raw);
}

function isMissevanCrossImportToken(value) {
  const raw = String(value ?? "").trim();
  return Boolean(parseMissevanInputToken(raw));
}

function areAllTokensImportable(tokens, platform) {
  if (!tokens.length) {
    return false;
  }
  if (platform === "manbo") {
    return tokens.every(isManboImportToken);
  }
  return tokens.every((token) => Boolean(parseMissevanInputToken(token)));
}

function getNumericEmptyResultNotice(value) {
  return String(value ?? "").trim().length < 3 ? "short_keyword" : "not_found";
}

export function classifyMergedSearchInput(rawValue, platform = "missevan", options = {}) {
  const keyword = String(rawValue ?? "").trim();
  if (!keyword) {
    return {
      action: "empty",
      keyword: "",
      rawItems: [],
    };
  }

  const rawItems = parseRawItems(keyword);
  const normalizedPlatform = platform === "manbo" ? "manbo" : "missevan";
  const isSingleNumericToken = rawItems.length === 1 && /^\d+$/.test(rawItems[0]);
  if (
    isSingleNumericToken &&
    options?.numericLookup !== false &&
    isSearchKeywordLongEnough(rawItems[0])
  ) {
    return {
      action: "numeric_lookup",
      keyword: rawItems[0],
      rawItems,
    };
  }

  if (normalizedPlatform === "missevan" && rawItems.every(isManboCrossImportToken)) {
    return {
      action: "cross_import",
      targetPlatform: "manbo",
      keyword: "",
      rawItems,
    };
  }

  if (normalizedPlatform === "manbo" && isSingleNumericToken) {
    if (isManboImportToken(rawItems[0])) {
      return {
        action: "import",
        keyword: "",
        rawItems,
      };
    }
    const emptyResultNotice = getNumericEmptyResultNotice(rawItems[0]);
    if (emptyResultNotice === "short_keyword") {
      return {
        action: "keyword_too_short",
        keyword,
        rawItems: [],
      };
    }
    return {
      action: "search",
      keyword,
      rawItems: [],
    };
  }

  if (normalizedPlatform === "manbo" && rawItems.every(isMissevanCrossImportToken)) {
    return {
      action: "search",
      keyword,
      rawItems: [],
    };
  }

  if (areAllTokensImportable(rawItems, normalizedPlatform)) {
    return {
      action: "import",
      keyword: "",
      rawItems,
    };
  }

  if (!isSearchKeywordLongEnough(keyword)) {
    return {
      action: "keyword_too_short",
      keyword,
      rawItems: [],
    };
  }

  return {
    action: "search",
    keyword,
    rawItems: [],
  };
}

export function classifyUnifiedSearchInput(rawValue) {
  const keyword = String(rawValue ?? "").trim();
  if (!keyword) {
    return {
      action: "empty",
      keyword: "",
      rawItems: [],
    };
  }

  const rawItems = parseRawItems(keyword);
  const tokenPlatforms = rawItems.map((item) => {
    if (isManboCrossImportToken(item)) {
      return "manbo";
    }
    if (isMissevanCrossImportToken(item)) {
      return "missevan";
    }
    return "";
  });
  const hasImportToken = tokenPlatforms.some(Boolean);
  const hasKeywordToken = tokenPlatforms.some((item) => !item);

  if (hasImportToken && hasKeywordToken) {
    return {
      action: "mixed_import",
      keyword: "",
      rawItems,
    };
  }

  if (tokenPlatforms.length > 0 && tokenPlatforms.every((item) => item === "manbo")) {
    return {
      action: "import",
      targetPlatform: "manbo",
      keyword: "",
      rawItems,
    };
  }

  if (tokenPlatforms.length > 0 && tokenPlatforms.every((item) => item === "missevan")) {
    return {
      action: "import",
      targetPlatform: "missevan",
      keyword: "",
      rawItems,
    };
  }

  if (tokenPlatforms.every(Boolean) && new Set(tokenPlatforms).size > 1) {
    return {
      action: "mixed_import",
      keyword: "",
      rawItems,
    };
  }

  if (!isSearchKeywordLongEnough(keyword)) {
    return {
      action: "keyword_too_short",
      keyword,
      rawItems: [],
    };
  }

  return {
    action: "search",
    keyword,
    rawItems: [],
  };
}
