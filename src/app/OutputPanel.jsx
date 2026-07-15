import { useEffect, useId, useRef, useState } from "react";
import { BeanIcon, ChevronDownIcon, ChevronUpIcon, CoinsIcon, GemIcon, HandCoinsIcon, MessagesSquareIcon, PauseCircleIcon, PlayCircleIcon, ShoppingCartIcon, Trash2Icon, UsersRoundIcon, XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  buildRevenueSummary,
  buildRevenuePaidMetricSegments,
  calculateResultMetricGridLayout,
  formatCompactMetricValue,
  formatElapsed,
  formatPlainNumber,
  formatPlayCountDisplay,
  formatPlayCountWanFixed,
  getHistoryMetricIconKey,
  getRevenueDisplayLabel,
  formatRevenueDisplayValue,
  resolveRevenueSummaryForDisplay,
} from "@/app/app-utils";

function formatUnitlessMetricValue(value) {
  return formatCompactMetricValue(value);
}

function formatUnitlessMetricRange(minValue, maxValue) {
  return `${formatUnitlessMetricValue(minValue)} - ${formatUnitlessMetricValue(maxValue)}`;
}

function ResultStrip({ metrics, compact = false }) {
  const containerRef = useRef(null);
  const [layout, setLayout] = useState(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const updateLayout = (width) => {
      setLayout(calculateResultMetricGridLayout(width, metrics.length));
    };
    const observer = new ResizeObserver(([entry]) => updateLayout(entry.contentRect.width));
    updateLayout(container.getBoundingClientRect().width);
    observer.observe(container);
    return () => observer.disconnect();
  }, [metrics.length]);

  if (compact && metrics.length === 1) {
    const metric = metrics[0];
    return (
      <dl className="min-w-0">
        <div className="flex min-w-0 items-baseline gap-2 sm:justify-end">
          <dt className="shrink-0 text-[0.68rem] text-muted-foreground sm:text-xs">{metric.label}</dt>
          <dd className="min-w-0 break-words text-base font-semibold leading-tight text-foreground tabular-nums sm:text-lg">
            {metric.value}
          </dd>
        </div>
      </dl>
    );
  }

  return (
    <div ref={containerRef} className="min-w-0 w-full">
      <dl
        className="grid overflow-hidden rounded-md"
        style={{
          gridTemplateColumns: layout
            ? `repeat(${layout.columns}, ${layout.columnWidth}px)`
            : "minmax(0, 1fr)",
          width: layout ? `${layout.gridWidth}px` : "100%",
          maxWidth: "100%",
        }}
      >
        {metrics.map((metric, index) => {
          const columns = layout?.columns || 1;
          const columnIndex = index % columns;
          const rowIndex = Math.floor(index / columns);
          return (
          <div
            key={`${metric.label}-${index}`}
            className="min-w-0 border border-border/70 bg-muted/35 px-2.5 py-2 text-center"
            style={{
              marginLeft: columnIndex > 0 ? "-1px" : 0,
              marginTop: rowIndex > 0 ? "-1px" : 0,
            }}
          >
            <dt className="text-[0.65rem] leading-4 text-muted-foreground sm:text-xs">{metric.label}</dt>
            <dd className="mt-0.5 break-words text-sm font-semibold leading-tight text-foreground tabular-nums sm:text-base">
              {metric.value}
            </dd>
          </div>
          );
        })}
      </dl>
    </div>
  );
}

function ResultCard({ title, metrics, emphasized = false, footer = null }) {
  const compact = metrics?.length === 1 && !footer;

  return (
    <Card
      size="sm"
      className={cn(
        "w-full min-w-0 gap-0 py-0 shadow-none hover:bg-card",
        emphasized && "border-primary/20 bg-accent/45 hover:bg-accent/45"
      )}
    >
      <CardHeader
        className={cn(
          "px-3 py-2 sm:px-4",
          compact && "flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"
        )}
      >
        <CardTitle className="min-w-0 break-words text-xs font-medium leading-5 text-foreground/80">
          {title}
        </CardTitle>
        {compact ? <ResultStrip metrics={metrics} compact /> : null}
      </CardHeader>
      {!compact && (metrics?.length || footer) ? (
        <CardContent className="grid gap-2 px-3 pb-3 sm:px-4">
          {metrics?.length ? <ResultStrip metrics={metrics} /> : null}
          {footer}
        </CardContent>
      ) : null}
    </Card>
  );
}

function OverflowEpisodeList({ titles = [] }) {
  const [expanded, setExpanded] = useState(false);
  const regionId = useId();

  if (!titles?.length) {
    return null;
  }

  return (
    <div className="rounded-md border border-border/75 bg-background/75 px-2.5 py-1.5 text-foreground">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="h-7 max-w-full px-1.5"
        aria-expanded={expanded}
        aria-controls={regionId}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="truncate">疑似弹幕溢出 {titles.length} 集</span>
        <ChevronDownIcon
          data-icon="inline-end"
          aria-hidden="true"
          className={cn("transition-transform", expanded && "rotate-180")}
        />
      </Button>
      {expanded ? (
        <div id={regionId} role="list" className="grid gap-1 border-t border-border/65 px-1.5 pb-1 pt-2">
          {titles.map((item) => (
            <div key={item.key} role="listitem" className="break-words text-xs leading-5 text-foreground/80">
              {item.title}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function getOverflowEpisodesForDrama(dramaId, keys = []) {
  const normalizedDramaId = String(dramaId ?? "").trim();
  if (!normalizedDramaId || !Array.isArray(keys) || keys.length === 0) {
    return [];
  }

  const prefix = `${normalizedDramaId}-`;
  const filteredTitles = keys.flatMap((key) => {
    const normalizedKey = String(key ?? "").trim();
    if (!normalizedKey || !normalizedKey.startsWith(prefix)) {
      return [];
    }
    const episodeTitle = normalizedKey.slice(prefix.length).trim();
    return [{ key: normalizedKey, title: episodeTitle || "未知分集" }];
  });

  return filteredTitles;
}

const HISTORY_METRIC_ICON_MAP = {
  playCount: PlayCircleIcon,
  danmakuCount: MessagesSquareIcon,
  uniqueUsers: UsersRoundIcon,
  paidCount: ShoppingCartIcon,
  rewardNum: GemIcon,
  revenue: HandCoinsIcon,
};

function getHistoryMetricIcon(metric, platform) {
  if (metric?.key === "rewardTotal") {
    return platform === "manbo" ? BeanIcon : CoinsIcon;
  }
  return HISTORY_METRIC_ICON_MAP[getHistoryMetricIconKey(metric)] || null;
}

function HistoryMetric({ metric, platform }) {
  const Icon = getHistoryMetricIcon(metric, platform);

  return (
    <div className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      {Icon ? <Icon className="size-3.5 shrink-0 text-foreground/72" aria-hidden="true" /> : null}
      <span className="sr-only">{metric.label}</span>
      <span className="font-medium text-foreground">{metric.value}</span>
    </div>
  );
}

function getHistoryPlatformLabel(entry) {
  return entry?.platformLabel || (entry?.platform === "manbo" ? "漫播" : "猫耳");
}

function ResultHistory({ entries = [], onDeleteHistoryEntry, onClearHistory }) {
  const [collapsed, setCollapsed] = useState(true);

  if (!entries?.length) {
    return null;
  }

  return (
    <div className="grid gap-2 rounded-lg border border-border/80 bg-background/55 p-2.5 sm:px-3">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="shrink-0 text-xs font-semibold text-foreground/80">查询历史</div>
          <Badge variant="secondary" className="h-5 min-w-5 px-1.5 text-[0.62rem] tabular-nums">
            {entries.length}
          </Badge>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-1.5 text-[10px] text-muted-foreground"
            aria-expanded={!collapsed}
            aria-controls="stats-result-history"
            onClick={() => setCollapsed((current) => !current)}
          >
            {collapsed ? <ChevronDownIcon data-icon="inline-start" /> : <ChevronUpIcon data-icon="inline-start" />}
            {collapsed ? "展开" : "收起"}
          </Button>
        </div>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-1.5 text-[10px] text-muted-foreground" onClick={onClearHistory}>
          <Trash2Icon data-icon="inline-start" />
          清空
        </Button>
      </div>

      {!collapsed ? <div id="stats-result-history" className="grid gap-2 border-t border-border/70 pt-2">
        {entries.map((entry, index) => (
          <div
            key={entry.id}
            className={cn("grid gap-1.5", index > 0 && "border-t border-border/70 pt-2")}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="text-[11px] font-medium text-foreground/78">{entry.createdAtLabel} {getHistoryPlatformLabel(entry)}</div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground"
                onClick={() => onDeleteHistoryEntry?.(entry)}
                aria-label={`删除 ${entry.createdAtLabel} ${getHistoryPlatformLabel(entry)} 这条历史`}
              >
                <XIcon />
              </Button>
            </div>

            {entry.summaryMetrics?.length ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <div className="text-[11px] font-medium text-foreground/78">汇总：</div>
                <div className="flex flex-wrap gap-1.5">
                  {entry.summaryMetrics.map((metric) => (
                    <HistoryMetric key={`${entry.id}-${metric.key}`} metric={metric} platform={entry.platform} />
                  ))}
                </div>
              </div>
            ) : null}

            <div className="grid gap-1 text-[11px] leading-5 text-foreground/76">
              {entry.items?.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center gap-1.5 break-words">
                  <span className="font-medium text-foreground/82">{item.title}：</span>
                  {item.segments?.map((segment) => (
                    <HistoryMetric
                      key={`${item.id}-${segment.metricKey}-${segment.value}-${segment.unit || "none"}`}
                      metric={segment}
                      platform={entry.platform}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div> : null}
    </div>
  );
}

export function OutputPanel({
  platform,
  progress,
  currentAction,
  elapsedMs,
  historyEntries = [],
  currentHistoryEntryId = "",
  playCountResults,
  playCountSelectedEpisodeCount,
  playCountTotal,
  playCountFailed,
  idResults,
  suspectedOverflowEpisodes = [],
  idSelectedEpisodeCount,
  totalDanmaku,
  totalUsers,
  revenueResults,
  revenueSummary,
  isRunning,
  onCancelStatistics,
  onDeleteHistoryEntry,
  onClearHistory,
}) {
  const resolvedRevenueSummary = resolveRevenueSummaryForDisplay(
    revenueResults,
    platform,
    revenueSummary || null
  ) || buildRevenueSummary(revenueResults, platform);

  function getSummaryPaidCountLabel(summary) {
    if (summary?.platform === "manbo" && summary?.paidCountSourceSummary === "pay_count") {
      return "总付费人次";
    }
    return "总和去重 ID";
  }

  function getRewardLabel(drama, isSummary = false) {
    if (drama?.platform === "manbo") {
      return "投喂总数（红豆）";
    }
    return isSummary ? "打赏榜总和（钻石）" : "打赏榜累计（钻石）";
  }

  function formatRewardMetricValue(drama) {
    if (drama?.platform === "manbo") {
      return formatUnitlessMetricValue(drama?.diamondValue ?? drama?.rewardTotal);
    }
    return formatUnitlessMetricValue(drama?.rewardCoinTotal ?? drama?.rewardTotal);
  }

  function hasRewardNum(drama) {
    return drama?.platform === "missevan" && drama?.rewardNum != null && Number.isFinite(Number(drama?.rewardNum));
  }

  function getRevenueLabel(drama) {
    return getRevenueDisplayLabel(drama);
  }

  const hasAnyResults = Boolean(
    playCountResults?.length || idResults?.length || revenueResults?.length
  );
  const visibleHistoryEntries =
    hasAnyResults && currentHistoryEntryId
      ? historyEntries.filter((entry) => entry.id !== currentHistoryEntryId)
      : historyEntries;
  const hasHistoryEntries = Boolean(visibleHistoryEntries?.length);

  if (!isRunning && !hasAnyResults && !hasHistoryEntries) {
    return null;
  }

  return (
    <div className="grid gap-3">
      {isRunning ? (
        <div role="status" aria-live="polite" className="grid gap-2 rounded-lg border border-border/80 bg-card p-3 shadow-[var(--shadow-card)]">
          <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-3">
            <div className="min-w-0 break-words text-sm font-semibold leading-5 text-foreground">
              {currentAction || "等待执行操作"}
            </div>
            <div className="flex min-w-0 items-center justify-between gap-2 sm:justify-end">
              <span className="mr-auto shrink-0 text-[11px] text-muted-foreground sm:mr-0">处理用时：{formatElapsed(elapsedMs)}</span>
              <span className="text-sm font-semibold text-foreground tabular-nums">{progress}%</span>
              <Badge>进行中</Badge>
              <Button
                variant="secondary"
                size="sm"
                data-touch="compact"
                className="relative overflow-visible after:absolute after:inset-x-0 after:-inset-y-1.5 after:rounded-md after:content-['']"
                onClick={onCancelStatistics}
              >
                <PauseCircleIcon data-icon="inline-start" />
                取消
              </Button>
            </div>
          </div>
          <Progress value={progress} aria-label="统计进度" className="h-2 rounded-full bg-muted" indicatorClassName="bg-primary" />
        </div>
      ) : null}

      {!isRunning && hasAnyResults ? (
        <div role="status" aria-live="polite" className="flex min-h-10 items-center justify-between gap-3 rounded-lg border border-border/80 bg-card px-3 py-2">
          <div className="min-w-0 truncate text-sm font-semibold text-foreground">
            {currentAction || "统计完成"}
            <span className="ml-2 font-normal text-muted-foreground">· 用时 {formatElapsed(elapsedMs)}</span>
          </div>
          <Badge variant="secondary" className="shrink-0">已完成</Badge>
        </div>
      ) : null}

      {playCountResults?.length ? (
          <div className="grid gap-2">
            {playCountResults.length > 1 ? (
              <ResultCard
                title={`汇总 / 已选 ${playCountSelectedEpisodeCount} 集`}
                emphasized
                metrics={[
                  {
                    label: "总播放量",
                    value: formatPlayCountDisplay(playCountTotal, playCountFailed),
                  },
                ]}
              />
            ) : null}
            {playCountResults.map((drama) => (
              <ResultCard
                key={`play-${drama.title}`}
                title={`${drama.title} / 已选 ${drama.selectedEpisodeCount} 集`}
                insetInverted={false}
                metrics={[
                  {
                    label: "总播放量",
                    value: formatPlayCountDisplay(drama.playCountTotal, drama.playCountFailed),
                  },
                ]}
              />
            ))}
          </div>
        ) : null}

      {idResults?.length ? (
          <div className="grid gap-2">
            {idResults.length > 1 ? (
              <ResultCard
                title={`汇总 / 已选 ${idSelectedEpisodeCount} 集`}
                emphasized
                metrics={[
                  { label: "总弹幕数", value: formatPlainNumber(totalDanmaku) },
                  { label: "总去重", value: formatPlainNumber(totalUsers) },
                ]}
              />
            ) : null}
            {idResults.map((drama) => (
              <ResultCard
                key={`id-${drama.dramaId || drama.title}`}
                title={`${drama.title} / 已选 ${drama.selectedEpisodeCount} 集`}
                metrics={[
                  { label: "总弹幕数", value: formatPlainNumber(drama.danmaku) },
                  { label: "去重 ID 数", value: formatPlainNumber(drama.users) },
                ]}
                footer={
                  <OverflowEpisodeList titles={getOverflowEpisodesForDrama(drama.dramaId, suspectedOverflowEpisodes)} />
                }
              />
            ))}
          </div>
        ) : null}

      {revenueResults?.length ? (
          <div className="grid gap-2">
            {resolvedRevenueSummary && revenueResults.length > 1 ? (
              <ResultCard
                title={resolvedRevenueSummary.summaryTitle || `汇总 / 已选 ${resolvedRevenueSummary.selectedDramaCount} 部`}
                emphasized
                metrics={[
                  ...(resolvedRevenueSummary.paidCountSourceSummary === "mixed"
                    ? [
                        { label: "总付费人次", value: resolvedRevenueSummary.failed ? "访问失败" : formatPlainNumber(resolvedRevenueSummary.totalPayCount) },
                        { label: "总和去重 ID", value: resolvedRevenueSummary.failed ? "访问失败" : formatPlainNumber(resolvedRevenueSummary.totalDanmakuPaidUserCount) },
                      ]
                    : [
                        {
                          label: getSummaryPaidCountLabel(resolvedRevenueSummary),
                          value: resolvedRevenueSummary.failed ? "访问失败" : formatPlainNumber(resolvedRevenueSummary.totalPaidUserCount),
                        },
                      ]),
                  {
                    label: "总播放量",
                    value: resolvedRevenueSummary.failed ? "访问失败" : formatPlayCountWanFixed(resolvedRevenueSummary.totalViewCount),
                  },
                  {
                    label: getRewardLabel(resolvedRevenueSummary, true),
                    value: resolvedRevenueSummary.failed
                      ? "访问失败"
                      : formatRewardMetricValue(resolvedRevenueSummary),
                  },
                  ...(hasRewardNum(resolvedRevenueSummary)
                    ? [{ label: "打赏人次", value: formatPlainNumber(resolvedRevenueSummary.rewardNum) }]
                    : []),
                  {
                    label: getRevenueLabel(resolvedRevenueSummary),
                    value: resolvedRevenueSummary.failed
                      ? "预估失败"
                      : formatRevenueDisplayValue(
                          resolvedRevenueSummary,
                          formatUnitlessMetricValue,
                          (minValue, maxValue) => formatUnitlessMetricRange(minValue, maxValue)
                        ),
                  },
                ]}
              />
            ) : null}

            {revenueResults.map((drama) => {
              const overflowTitles = getOverflowEpisodesForDrama(drama.dramaId, suspectedOverflowEpisodes);

              return (
                <ResultCard
                  key={`revenue-${drama.dramaId}`}
                  title={drama.subtitle || `${drama.title} / 单价 ${drama.price || 0} 钻石`}
                  metrics={[
                    ...buildRevenuePaidMetricSegments(drama).map((segment) => ({
                      label: segment.label,
                      value: drama.failed ? "访问失败" : segment.value,
                    })),
                    {
                      label: getRewardLabel(drama),
                      value: drama.failed ? "访问失败" : formatRewardMetricValue(drama),
                    },
                    ...(hasRewardNum(drama)
                      ? [{ label: "打赏人数", value: formatPlainNumber(drama.rewardNum) }]
                      : []),
                    {
                      label: getRevenueLabel(drama),
                      value: drama.failed
                        ? "预估失败"
                        : formatRevenueDisplayValue(
                            drama,
                            formatUnitlessMetricValue,
                            (minValue, maxValue) => formatUnitlessMetricRange(minValue, maxValue)
                          ),
                    },
                  ]}
                  footer={<OverflowEpisodeList titles={overflowTitles} />}
                />
              );
            })}
          </div>
        ) : null}

      <ResultHistory entries={visibleHistoryEntries} onDeleteHistoryEntry={onDeleteHistoryEntry} onClearHistory={onClearHistory} />
    </div>
  );
}
