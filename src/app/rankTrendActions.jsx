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
const actionButton =
  "relative h-8 min-h-8 min-w-11 shrink-0 justify-center gap-1 overflow-visible rounded-[calc(var(--radius)-0.12rem)] px-2 text-xs! after:absolute after:inset-x-0 after:-inset-y-1.5 after:rounded-md after:content-[''] active:translate-y-0";
const trendButton =
  "border-[color-mix(in_oklch,var(--accent-success)_32%,transparent)] bg-[var(--accent-success)] text-[var(--accent-success-foreground)] shadow-[0_12px_24px_-16px_var(--accent-success)] hover:bg-[color-mix(in_oklch,var(--accent-success)_88%,var(--foreground))] hover:text-[var(--accent-success-foreground)]";
const compareButton =
  "border-[color-mix(in_oklch,var(--accent-compare)_34%,transparent)] bg-[var(--accent-compare)] text-[var(--accent-compare-foreground)] shadow-[0_12px_24px_-16px_var(--accent-compare)] hover:bg-[var(--accent-compare-hover)] hover:text-[var(--accent-compare-foreground)]";
const actionLink =
  "border-0 bg-transparent px-1.5 shadow-none underline-offset-4 hover:border-0 hover:bg-transparent hover:underline focus-visible:border-0 focus-visible:bg-transparent disabled:border-0 disabled:bg-transparent";
const trendLink = "text-[var(--accent-success)] hover:text-[var(--accent-success)]";
const compareLink = "text-[var(--accent-compare)] hover:text-[var(--accent-compare)]";

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

function ActionButton({ kind, density: _density = "default", appearance = "button", className = "", ...props }) {
  const isTrend = kind === "trend";
  const isLink = appearance === "link";
  const Icon = isTrend ? TrendingUpIcon : ArrowLeftRightIcon;
  return (
    <Button
      type="button"
      variant={isLink ? "ghost" : "outline"}
      data-touch="compact"
      className={`${actionButton} ${isLink ? actionLink : ""} ${isLink ? (isTrend ? trendLink : compareLink) : (isTrend ? trendButton : compareButton)} ${className}`.trim()}
      {...props}
    >
      <Icon data-icon="inline-start" />
      <span className="whitespace-nowrap">{isTrend ? "趋势" : "对比"}</span>
    </Button>
  );
}

export function RankTrendButton(props) {
  return <ActionButton kind="trend" {...props} />;
}

export function CompareActionButton(props) {
  return <ActionButton kind="compare" {...props} />;
}
