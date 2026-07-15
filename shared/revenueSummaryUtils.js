function toFiniteNumber(value, fallback = 0) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
}

function hasFiniteOptionalNumber(value) {
  return value != null && Number.isFinite(Number(value));
}

export function hasRevenueRange(result) {
  if (!result || result.summaryRevenueMode === "single" || result.summaryRevenueMode === "member_reward") {
    return false;
  }
  return hasFiniteOptionalNumber(result.minRevenueYuan)
    && hasFiniteOptionalNumber(result.maxRevenueYuan);
}

export function getSummaryRevenueMode(result, platform = result?.platform) {
  if (!result) {
    return "single";
  }
  if (["single", "member_reward"].includes(result.summaryRevenueMode)) {
    return result.summaryRevenueMode;
  }
  if (result.summaryRevenueMode === "range") {
    return hasRevenueRange(result) ? "range" : "single";
  }
  if (platform === "missevan" && result.vipOnlyReward) {
    return "member_reward";
  }
  if (
    platform === "manbo"
    && (result.revenueType === "member"
      || (toFiniteNumber(result.diamondValue) > 0
        && toFiniteNumber(result.titlePrice) <= 0
        && !hasRevenueRange(result)))
  ) {
    return "member_reward";
  }
  return hasRevenueRange(result) ? "range" : "single";
}

function getMissevanEpisodeSummaryPrice(item, member = false) {
  const rawPrice = member ? item?.memberPrice : item?.price;
  const fallbackPrice = member ? item?.titleMemberPrice : item?.titlePrice;
  const paidEpisodeCount = Math.max(0, toFiniteNumber(item?.paidEpisodeCount));

  if (hasFiniteOptionalNumber(rawPrice)) {
    return toFiniteNumber(rawPrice) * paidEpisodeCount;
  }
  return hasFiniteOptionalNumber(fallbackPrice) ? toFiniteNumber(fallbackPrice) : null;
}

export function getRevenueSummaryPrice(item, member = false) {
  if (!item?.includeInSummaryPrice) {
    return null;
  }
  const isMissevanEpisode = item?.platform === "missevan"
    && (item?.revenueType === "episode" || Number(item?.payType) === 1);
  if (isMissevanEpisode) {
    return getMissevanEpisodeSummaryPrice(item, member);
  }

  const value = member ? item?.titleMemberPrice : item?.titlePrice;
  return hasFiniteOptionalNumber(value) ? toFiniteNumber(value) : null;
}

function getEstimatedRevenueAmount(item, mode, platform) {
  if (mode === "member_reward") {
    return platform === "manbo"
      ? toFiniteNumber(item?.diamondValue ?? item?.rewardTotal) / 100
      : toFiniteNumber(item?.rewardCoinTotal ?? item?.rewardTotal) / 10;
  }
  return toFiniteNumber(item?.estimatedRevenueYuan);
}

export function aggregateRevenueFinancials(results, currentPlatform = "") {
  const safeResults = Array.isArray(results) ? results : [];
  const platform = safeResults[0]?.platform || currentPlatform;
  let estimatedRevenueYuan = 0;
  let minRevenueYuan = 0;
  let maxRevenueYuan = 0;
  let hasRange = false;
  const modes = [];

  safeResults.forEach((item) => {
    const mode = getSummaryRevenueMode(item, platform);
    const amount = getEstimatedRevenueAmount(item, mode, platform);
    const itemHasRange = mode === "range" && hasRevenueRange(item);
    modes.push(itemHasRange ? "range" : mode === "member_reward" ? "member_reward" : "single");
    estimatedRevenueYuan += amount;
    if (itemHasRange) {
      hasRange = true;
      minRevenueYuan += toFiniteNumber(item.minRevenueYuan);
      maxRevenueYuan += toFiniteNumber(item.maxRevenueYuan);
    } else {
      minRevenueYuan += amount;
      maxRevenueYuan += amount;
    }
  });

  const failed = safeResults.some((item) => item?.failed);
  const priceItems = safeResults.filter((item) => item?.includeInSummaryPrice);
  const titlePrices = priceItems
    .map((item) => getRevenueSummaryPrice(item, false))
    .filter((value) => value != null);
  const memberPrices = priceItems
    .map((item) => getRevenueSummaryPrice(item, true))
    .filter((value) => value != null && value > 0);
  const hasSummaryPrice = !failed && titlePrices.length > 0;
  const summaryRevenueMode = modes.length > 0 && modes.every((mode) => mode === "member_reward")
    ? "member_reward"
    : hasRange
      ? "range"
      : "single";

  return {
    summaryRevenueMode,
    estimatedRevenueYuan,
    minRevenueYuan: hasRange ? minRevenueYuan : null,
    maxRevenueYuan: hasRange ? maxRevenueYuan : null,
    hasSummaryPrice,
    titlePriceTotal: hasSummaryPrice
      ? titlePrices.reduce((sum, value) => sum + value, 0)
      : null,
    titleMemberPriceTotal: hasSummaryPrice && memberPrices.length > 0
      ? memberPrices.reduce((sum, value) => sum + value, 0)
      : null,
  };
}
