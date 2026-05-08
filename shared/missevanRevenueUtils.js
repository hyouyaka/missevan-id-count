export function normalizeMissevanPayType(value) {
  if (value == null || value === "") {
    return null;
  }
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return null;
  }
  return [0, 1, 2].includes(normalized) ? normalized : null;
}

export function resolveMissevanRevenueType({ payTypeRaw, vip, isMember }) {
  const payType = normalizeMissevanPayType(payTypeRaw);
  const isVipMember = Boolean(isMember) || Number(vip ?? 0) === 1;
  if (isVipMember || payType === 0) {
    return {
      payType,
      revenueType: "reward_only",
      vipOnlyReward: true,
    };
  }
  if (payType === 1) {
    return {
      payType,
      revenueType: "episode",
      vipOnlyReward: false,
    };
  }
  if (payType === 2) {
    return {
      payType,
      revenueType: "season",
      vipOnlyReward: false,
    };
  }
  return {
    payType: null,
    revenueType: "legacy",
    vipOnlyReward: false,
  };
}

export function computeMissevanRevenueMetrics({
  payTypeRaw,
  vip,
  isMember,
  price,
  rewardCoinTotal,
  seasonPaidUserCount,
  episodePaidUserCountTotal,
  paidEpisodeCount,
}) {
  const revenueInfo = resolveMissevanRevenueType({ payTypeRaw, vip, isMember });
  const normalizedPrice = Math.max(0, Number(price ?? 0) || 0);
  const normalizedRewardCoinTotal = Math.max(0, Number(rewardCoinTotal ?? 0) || 0);
  const normalizedSeasonPaidUserCount = Math.max(0, Number(seasonPaidUserCount ?? 0) || 0);
  const normalizedEpisodePaidUserCountTotal = Math.max(
    0,
    Number(episodePaidUserCountTotal ?? 0) || 0
  );
  const normalizedPaidEpisodeCount = Math.max(0, Number(paidEpisodeCount ?? 0) || 0);
  const paidUserCount =
    revenueInfo.revenueType === "reward_only"
      ? 0
      : revenueInfo.revenueType === "episode"
        ? normalizedEpisodePaidUserCountTotal
        : normalizedSeasonPaidUserCount;
  let estimatedRevenueYuan = 0;
  let minRevenueYuan = null;
  let maxRevenueYuan = null;
  let summaryRevenueMode = "single";
  if (revenueInfo.revenueType === "reward_only") {
    estimatedRevenueYuan = normalizedRewardCoinTotal / 10;
    summaryRevenueMode = "member_reward";
  } else if (revenueInfo.revenueType === "episode") {
    minRevenueYuan = (
      normalizedEpisodePaidUserCountTotal * normalizedPrice + normalizedRewardCoinTotal
    ) / 10;
    maxRevenueYuan = (
      normalizedSeasonPaidUserCount * normalizedPaidEpisodeCount * normalizedPrice +
      normalizedRewardCoinTotal
    ) / 10;
    estimatedRevenueYuan = minRevenueYuan;
    summaryRevenueMode = "range";
  } else {
    estimatedRevenueYuan = (paidUserCount * normalizedPrice + normalizedRewardCoinTotal) / 10;
  }

  return {
    ...revenueInfo,
    episodePaidUserCountTotal: normalizedEpisodePaidUserCountTotal,
    seasonPaidUserCount: normalizedSeasonPaidUserCount,
    paidEpisodeCount: normalizedPaidEpisodeCount,
    paidUserCount,
    estimatedRevenueYuan,
    minRevenueYuan,
    maxRevenueYuan,
    summaryRevenueMode,
  };
}
