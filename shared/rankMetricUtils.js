export const SKIPPED_DANMAKU_METRIC_VALUE = "无需抓取";

export function isSkippedDanmakuMetricValue(value) {
  return String(value ?? "").trim() === SKIPPED_DANMAKU_METRIC_VALUE;
}
