export function normalizeVersion(value) {
  const normalized = String(value ?? "").trim();
  return /^\d+\.\d+\.\d+$/.test(normalized) ? normalized : "0.0.0";
}

export function normalizeRegionBaseUrl(value) {
  return String(value ?? "").trim().replace(/\/+$/, "");
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

export function getDefaultGatewayConfig() {
  return {
    desktopApp: false,
    hostedDeployment: false,
    featureSuggestionUrl: "",
  };
}

export function getDefaultAppConfig() {
  return {
    missevanEnabled: true,
    desktopApp: false,
    hostedDeployment: false,
    brandName: "M&M Toolkit",
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
  const frontendVersion = normalizeVersion(
    config.frontendVersion ?? currentConfig?.frontendVersion ?? defaults.frontendVersion
  );
  const backendVersion = normalizeVersion(
    config.backendVersion ?? currentConfig?.backendVersion ?? defaults.backendVersion
  );

  return {
    missevanEnabled: config.missevanEnabled !== false,
    desktopApp: config.desktopApp === true,
    hostedDeployment: config.hostedDeployment === true,
    brandName: config.brandName || defaults.brandName,
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

export function createRegionState(key, label, baseUrl) {
  return {
    key,
    label,
    baseUrl,
    loading: Boolean(baseUrl),
    requestFailed: false,
    requestError: "",
    missevanEnabled: false,
    cooldownUntil: 0,
    cooldownHours: 0,
    frontendVersion: "0.0.0",
    desktopApp: false,
    versionMismatch: false,
    requestToken: 0,
  };
}

export function pickPreferredRegion(regions) {
  const preferredOrder = ["area1", "area2", "area3"];
  return preferredOrder.map((key) => regions.find((region) => region.key === key)).find(Boolean) || regions[0] || null;
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

function formatRewardValue(platform, value) {
  const amount = Number(value ?? 0);
  return platform === "manbo" ? `${amount} 红豆` : `${amount} 钻石`;
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

function formatRevenueRange(minValue, maxValue) {
  return `${formatRevenue(minValue)} - ${formatRevenue(maxValue)}`;
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

function trimTrailingZero(value) {
  return value.replace(/\.?0+$/, "");
}

function formatCompactMetricValue(value) {
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

function hasFiniteOptionalNumber(value) {
  return value != null && Number.isFinite(Number(value));
}

function buildRevenuePaidMetricSegment(drama) {
  if (drama?.platform === "manbo" && drama?.paidCountSource === "pay_count") {
    return buildHistoryMetricSegment("paidCount", "付费人数", formatPlainNumber(drama?.paidUserCount));
  }
  return buildHistoryMetricSegment("uniqueUsers", "付费用户 ID 数", formatPlainNumber(drama?.paidUserCount), "ID");
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
            buildRevenuePaidMetricSegment(drama),
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
