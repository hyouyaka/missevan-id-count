export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeVersion(value) {
  const normalized = String(value ?? "").trim();
  return /^\d+\.\d+\.\d+$/.test(normalized) ? normalized : "0.0.0";
}

export function normalizeRegionBaseUrl(value) {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

export function getDefaultGatewayConfig() {
  return {
    desktopApp: false,
    hostedDeployment: false,
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
  };
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
    isLoadingMoreResults: false,
    searchResults: [],
    dramas: [],
    selectedEpisodesSnapshot: [],
    stats: createStatsState(),
  };
}

export function createRuntimeMeta() {
  return {
    activeRunId: 0,
    activeAbortController: null,
    activeElapsedTimer: null,
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
    const dramaTitle = drama?.drama?.name || "";
    const episodes = Array.isArray(drama?.episodes?.episode) ? drama.episodes.episode : [];
    episodes.forEach((episode) => {
      if (episode.selected) {
        selectedEpisodes.push({
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

export function hasRevenueRange(result) {
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

export function getRevenueCurrencyUnit(platform) {
  return platform === "manbo" ? "红豆" : "钻石";
}

export function buildRevenueSummaryTitle(summary) {
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
    estimatedRevenueYuan: revenueTotals.estimatedRevenueYuan,
    minRevenueYuan: revenueTotals.minRevenueYuan,
    maxRevenueYuan: revenueTotals.maxRevenueYuan,
    failed,
    summaryTitle: "",
  };
  summary.summaryTitle = buildRevenueSummaryTitle(summary);
  return summary;
}

export function formatPlayCount(value) {
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

export function formatRewardValue(platform, value) {
  const amount = Number(value ?? 0);
  return platform === "manbo" ? `${amount} 红豆` : `${amount} 钻石`;
}

export function formatRevenue(value) {
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

export function formatRevenueRange(minValue, maxValue) {
  return `${formatRevenue(minValue)} - ${formatRevenue(maxValue)}`;
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
