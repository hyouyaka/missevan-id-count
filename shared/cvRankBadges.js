const CV_RANK_BADGES = [
  ["combined", "cv", "播放总榜"],
  ["combined", "cv-paid", "付费总榜"],
  ["combined", "cv-series-count", "勤劳总榜"],
  ["missevan", "cv", "猫耳总榜"],
  ["manbo", "cv", "漫播总榜"],
  ["missevan", "cv-paid", "猫耳付费榜"],
  ["manbo", "cv-paid", "漫播付费榜"],
  ["missevan", "cv-series-count", "猫耳勤劳榜"],
  ["manbo", "cv-series-count", "漫播勤劳榜"],
];

export function selectCvRankBadges(items = []) {
  const positions = new Map(items.map((item) => [item.platform + ":" + item.rankKey, item]));
  const candidates = CV_RANK_BADGES.map(([platform, rankKey, label]) => {
    const key = platform + ":" + rankKey;
    const item = positions.get(key);
    const rank = Number.isInteger(item?.rank) && item.rank > 0 ? item.rank : null;
    return { key, platform, label, rank, updatedAt: item?.updatedAt };
  });
  const isTop30 = ({ rank }) => rank != null && rank <= 30;
  return [...candidates.filter(isTop30), ...candidates.filter((candidate) => !isTop30(candidate))].slice(0, 4);
}
