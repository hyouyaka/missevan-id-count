import { ArrowLeftRightIcon, TrendingUpIcon } from "lucide-react";

import { formatPlainNumber, formatRankCompactCount } from "@/app/app-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export {
  fetchRankTrendAvailabilityData,
  fetchRankTrendData,
  logRankTrendOpen,
  RANK_TREND_CLIENT_SCHEMA_VERSION,
} from "@/app/rankTrendData";

export const rankTrendTagVariants = {
  猫耳: "missevanPlatform",
  漫播: "manboPlatform",
  免费: "free",
  会员: "member",
  付费: "paid",
  广播剧: "radioDrama",
  有声剧: "audioDrama",
  有声漫: "audioComic",
};

const trendMetricColors = {
  view_count: "var(--chart-1)",
  danmaku_uid_count: "var(--chart-3)",
  subscription_num: "var(--chart-2)",
  pay_count: "var(--chart-2)",
  missevan_total_view_count: "var(--chart-1)",
  missevan_paid_view_count: "var(--chart-3)",
  manbo_total_view_count: "var(--chart-2)",
  manbo_paid_view_count: "var(--chart-4)",
};
const actionHitArea =
  "h-11 min-h-11 w-[58px] min-w-[58px] border-transparent! bg-transparent! p-0 text-inherit shadow-none! hover:bg-transparent! hover:text-inherit active:translate-y-0";
const actionInline =
  "relative h-[22px] min-h-[22px] w-[50px] min-w-[50px] overflow-visible border-transparent! bg-transparent! p-0 text-inherit shadow-none! hover:bg-transparent! hover:text-inherit active:translate-y-0 after:absolute after:inset-x-0 after:-inset-y-[11px] after:rounded-md after:content-['']";
const actionVisual =
  "pointer-events-none inline-flex items-center justify-center gap-1 rounded-[calc(var(--radius)-0.18rem)] border";
const trendVisual =
  "h-[22px] w-[50px] min-w-[50px] border-[color-mix(in_oklch,var(--accent-success)_32%,transparent)] bg-[var(--accent-success)] px-1 text-xs! text-[var(--accent-success-foreground)] shadow-[0_12px_24px_-16px_var(--accent-success)] hover:bg-[color-mix(in_oklch,var(--accent-success)_88%,var(--foreground))]";
const compareVisual =
  "h-[22px] w-[50px] min-w-[50px] border-[color-mix(in_oklch,var(--accent-compare)_34%,transparent)] bg-[var(--accent-compare)] px-1 text-xs! text-[var(--accent-compare-foreground)] shadow-[0_12px_24px_-16px_var(--accent-compare)]";

function getNumber(value) {
  if (value == null || String(value).trim() === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isEmptyPaidMetric(metric) {
  return metric?.key === "danmaku_uid_count"
    && getNumber(metric.fromValue) === 0
    && getNumber(metric.toValue) === 0;
}

function formatDelta(metric, compact = false) {
  if (metric?.emptyPaidEpisodes || isEmptyPaidMetric(metric)) {
    return "暂无付费集";
  }
  const delta = metric?.available ? getNumber(metric.delta) : null;
  if (delta == null) {
    return "暂无数据";
  }
  const prefix = delta > 0 ? "+" : delta < 0 ? "-" : "";
  const value = compact
    ? formatRankCompactCount(Math.abs(delta))
    : formatPlainNumber(Math.abs(delta));
  return `${prefix}${value}`;
}

export function formatRankTrendCompactDelta(metric) {
  return formatDelta(metric, true);
}

export function formatRankTrendDelta(metric) {
  return formatDelta(metric);
}

export function canShowRankTrend({ platform, rankKey, item, isMissevanPeak, detailIdText }) {
  if (!detailIdText) {
    return false;
  }
  if (platform === "missevan") {
    return isMissevanPeak || (rankKey !== "peak" && item?.type !== "peak");
  }
  return platform === "manbo" && item?.type !== "peak";
}

export function RankTrendDeltaBadge({ metric, children, className = "" }) {
  const delta = getNumber(metric?.delta);
  const hasDelta = !isEmptyPaidMetric(metric) && metric?.available && delta != null;
  const color = trendMetricColors[metric?.key] || trendMetricColors.view_count;
  return (
    <Badge
      variant="outline"
      className={`${hasDelta ? "h-6 border-transparent px-2 text-xs shadow-none" : "h-6 px-2 text-xs"} ${className}`.trim()}
      style={hasDelta ? { backgroundColor: color, borderColor: color, color: "white" } : undefined}
    >
      {children ?? formatDelta(metric)}
    </Badge>
  );
}

function ActionButton({ kind, density = "default", className = "", ...props }) {
  const isTrend = kind === "trend";
  const Icon = isTrend ? TrendingUpIcon : ArrowLeftRightIcon;
  return (
    <Button
      type="button"
      variant="ghost"
      data-touch="compact"
      className={`${density === "inline" ? actionInline : actionHitArea} ${className}`.trim()}
      {...props}
    >
      <span className={`${actionVisual} ${isTrend ? trendVisual : compareVisual}`}>
        <Icon data-icon="inline-start" />
        {isTrend ? "趋势" : "对比"}
      </span>
    </Button>
  );
}

export function RankTrendButton(props) {
  return <ActionButton kind="trend" {...props} />;
}

export function CompareActionButton(props) {
  return <ActionButton kind="compare" {...props} />;
}
