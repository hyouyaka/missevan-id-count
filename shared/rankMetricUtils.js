export const SKIPPED_DANMAKU_METRIC_VALUE = "无需抓取";

export function isSkippedDanmakuMetricValue(value) {
  return String(value ?? "").trim() === SKIPPED_DANMAKU_METRIC_VALUE;
}

export function filterItemsByRank(items, maxRank) {
  return (Array.isArray(items) ? items : []).filter((item) => {
    if (!["number", "string"].includes(typeof item?.rank)) return false;
    const rank = Number(item.rank);
    return Number.isInteger(rank) && rank > 0 && rank <= maxRank;
  });
}

export function sortRankTiesByPlayback(items) {
  const playback = (item) => item?.totalViewCount == null || String(item.totalViewCount).trim() === ""
    ? null : Number(item.totalViewCount);
  return [...items].sort((left, right) => {
    const rankOrder = Number(left.rank) - Number(right.rank);
    if (rankOrder) return rankOrder;
    const leftPlayback = playback(left);
    const rightPlayback = playback(right);
    const hasLeft = Number.isFinite(leftPlayback);
    const hasRight = Number.isFinite(rightPlayback);
    if (!hasLeft || !hasRight) return Number(hasRight) - Number(hasLeft);
    return rightPlayback - leftPlayback;
  });
}
