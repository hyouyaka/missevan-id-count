export function normalizePaidCoefficient(value, { max = 10, allowDecimal = false } = {}) {
  const number = Number(value);
  const validStep = allowDecimal ? Math.abs(number * 10 - Math.round(number * 10)) < 1e-8 : Number.isInteger(number);
  return Number.isFinite(number) && validStep && number >= 1 && number <= max ? number : 1;
}

export function getEffectivePaidCoefficient(basis, value) {
  const requested = normalizePaidCoefficient(value, { max: Number.MAX_SAFE_INTEGER, allowDecimal: true });
  const maximum = basis?.maxCoefficient ?? 10;
  return requested >= maximum ? maximum : Math.floor(requested);
}

// Only called on the server's original N=1 results. Rewards never scale.
export function buildPaidCoefficientBasis(result) {
  let reason = "";
  if (result.failed) reason = "统计失败";
  else if (result.vipOnlyReward || ["member", "reward_only"].includes(result.revenueType) || result.summaryRevenueMode === "member_reward") reason = "仅计算打赏或投喂";
  else if (!["season", "episode", "legacy"].includes(result.revenueType)) reason = "暂不支持收益调整";
  else if (result.platform === "manbo" && Number(result.payCount) > 0) {
    if (result.revenueType === "episode" && Number(result.paidEpisodeCount) > 0 && Number(result.minimumEpisodePrice) > 0) {
      const users = Number(result.seasonPaidUserCount ?? result.paidUserCount ?? 0);
      const ratio = users > 0 ? Number(result.payCount) / users : 1;
      return {
        applicable: true,
        reason: "",
        mode: "manbo_official_episode",
        maxCoefficient: Math.max(1, Math.floor((ratio + Number.EPSILON) * 10) / 10),
        officialMinimumYuan: Number(result.payCount) * Number(result.minimumEpisodePrice) / 100,
        idMinimumYuan: Number(result.episodePaidUserCountTotal) * Number(result.minimumEpisodePrice) / 100,
        rewardYuan: Number(result.diamondValue ?? 0) / 100,
      };
    }
    reason = result.revenueType === "episode" ? "没有可用的付费分集计算依据" : "使用官方付费人数";
  }
  const reward = result.platform === "manbo"
    ? Number(result.diamondValue ?? 0) / 100
    : Number(result.rewardCoinTotal ?? 0) / 10;
  const paidPart = (value) => value == null ? null : Math.max(0, Number(value) - reward);
  return {
    applicable: !reason,
    reason,
    maxCoefficient: 10,
    estimatedRevenueYuan: reason ? 0 : paidPart(result.estimatedRevenueYuan),
    minRevenueYuan: reason ? 0 : paidPart(result.minRevenueYuan),
    maxRevenueYuan: reason ? 0 : paidPart(result.maxRevenueYuan),
  };
}

export function applyPaidCoefficient(result, value) {
  const basis = result.paidCoefficientBasis;
  const applicable = Boolean(basis?.applicable) && !result.failed;
  const coefficient = applicable ? getEffectivePaidCoefficient(basis, value) : 1;
  const adjusted = { ...result, paidCoefficient: coefficient, paidCoefficientApplicable: applicable };
  if (applicable && basis.mode === "manbo_official_episode") {
    const minimum = Math.max(basis.officialMinimumYuan, basis.idMinimumYuan * coefficient) + basis.rewardYuan;
    adjusted.estimatedRevenueYuan = minimum;
    adjusted.minRevenueYuan = minimum;
    return adjusted;
  }
  for (const key of ["estimatedRevenueYuan", "minRevenueYuan", "maxRevenueYuan"]) {
    if (result[key] != null && applicable) adjusted[key] = Number(result[key]) + Number(basis[key] ?? 0) * (coefficient - 1);
  }
  return adjusted;
}
