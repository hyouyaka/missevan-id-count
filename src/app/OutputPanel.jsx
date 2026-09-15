import { useEffect, useId, useRef, useState } from "react";
import { ChevronDownIcon, CoinsIcon, GemIcon, HandCoinsIcon, PauseCircleIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { StatsHistoryList } from "@/app/StatsHistoryList";
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

function formatEpisodeCount(value) {
  if (value == null || value === "") {
    return "-";
  }
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? formatPlainNumber(count) : "-";
}

function formatFetchedEpisodeCount(item, field) {
  if (item?.status === "failed") {
    return "失败";
  }
  return formatEpisodeCount(item?.[field]);
}

function formatEpisodeTotalCount(item, platform) {
  if (item?.status === "failed") {
    return "-";
  }
  if (platform === "manbo") {
    const totalDanmaku = Number(item?.totalDanmaku);
    const fetchedDanmaku = Number(item?.fetchedDanmaku);
    const isOverflow =
      Number.isFinite(totalDanmaku)
      && totalDanmaku > 0
      && Number.isFinite(fetchedDanmaku)
      && fetchedDanmaku >= 0
      && fetchedDanmaku <= totalDanmaku * 0.9;
    if (!isOverflow) {
      return "-";
    }
  }
  return formatEpisodeCount(item?.totalDanmaku);
}

function EpisodeDetailList({ episodes = [], platform }) {
  const [expanded, setExpanded] = useState(false);
  const regionId = useId();

  if (!episodes?.length) {
    return null;
  }

  return (
    <div className="rounded-md border border-border/75 bg-background/75 px-2.5 py-1.5 text-foreground">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        data-touch="compact"
        className="relative h-7 max-w-full overflow-visible px-1.5 after:absolute after:inset-x-0 after:-inset-y-2 after:rounded-md after:content-['']"
        aria-expanded={expanded}
        aria-controls={regionId}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="shrink-0">分集明细 {episodes.length} 集</span>
          <span className="truncate text-[10px] font-normal text-muted-foreground">
            （弹幕溢出时额外显示总弹幕）
          </span>
        </span>
        <ChevronDownIcon
          data-icon="inline-end"
          aria-hidden="true"
          className={cn("transition-transform", expanded && "rotate-180")}
        />
      </Button>
      {expanded ? (
        <div
          id={regionId}
          className="max-h-[28rem] w-full max-w-full overflow-y-auto overscroll-contain border-t border-border/65"
        >
          <table className="w-full max-w-full table-fixed border-collapse text-xs sm:table-auto">
            <caption className="sr-only">弹幕 ID 统计分集明细</caption>
            <colgroup>
              <col />
              <col style={{ width: "calc(7ch + 1rem)" }} />
              <col style={{ width: "calc(7ch + 1rem)" }} />
              <col style={{ width: "calc(7ch + 1rem)" }} />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
              <tr>
                <th scope="col" className="px-2 py-1.5 text-left font-medium">
                  分集标题
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  去重ID
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  抓取弹幕
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  总弹幕
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/65 text-foreground/80">
              {episodes.map((item) => (
                <tr key={item.key}>
                  <td className="min-w-0 px-2 py-1.5 text-left align-top leading-5 [overflow-wrap:anywhere]">
                    {item.title}
                  </td>
                  <td className="break-all px-2 py-1.5 text-right align-top leading-5 tabular-nums">
                    {formatFetchedEpisodeCount(item, "uniqueUsers")}
                  </td>
                  <td className="break-all px-2 py-1.5 text-right align-top leading-5 tabular-nums">
                    {formatFetchedEpisodeCount(item, "fetchedDanmaku")}
                  </td>
                  <td className="break-all px-2 py-1.5 text-right align-top leading-5 tabular-nums">
                    {formatEpisodeTotalCount(item, platform)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function getEpisodeDetailsForDrama(dramaId, details = []) {
  const normalizedDramaId = String(dramaId ?? "").trim();
  if (!normalizedDramaId || !Array.isArray(details) || details.length === 0) {
    return [];
  }

  const prefix = `${normalizedDramaId}-`;
  const filteredTitles = details.flatMap((item) => {
    const isLegacyKey = typeof item === "string";
    const itemDramaId = isLegacyKey
      ? ""
      : String(item?.dramaId ?? "").trim();
    const normalizedKey = String(isLegacyKey ? item : item?.key ?? "").trim();
    if (!normalizedKey || (!itemDramaId && !normalizedKey.startsWith(prefix))) {
      return [];
    }
    if (itemDramaId && itemDramaId !== normalizedDramaId) {
      return [];
    }
    const episodeTitle = isLegacyKey
      ? normalizedKey.slice(prefix.length).trim()
      : String(item?.title ?? normalizedKey.slice(prefix.length)).trim();
    return [{
      key: normalizedKey,
      title: episodeTitle || "未知分集",
      status: isLegacyKey ? "success" : item?.status,
      totalDanmaku: isLegacyKey ? null : item?.totalDanmaku,
      fetchedDanmaku: isLegacyKey ? null : item?.fetchedDanmaku,
      uniqueUsers: isLegacyKey ? null : item?.uniqueUsers,
    }];
  });

  return filteredTitles;
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
  episodeDetails = [],
  idSelectedEpisodeCount,
  totalDanmaku,
  totalUsers,
  revenueResults,
  revenueSummary,
  isRunning,
  onCancelStatistics,
  onDeleteHistoryEntry,
  onClearHistory,
  onReplayHistoryEntry,
  isReplayPreparing = false,
  replayPreparingEntryIds = [],
  historyActionsDisabled = false,
  onCancelReplayPreparation,
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

  if (!isRunning && !isReplayPreparing && !hasAnyResults && !hasHistoryEntries) {
    return null;
  }

  return (
    <div className="grid gap-3">
      {isRunning || isReplayPreparing ? (
        <div role="status" aria-live="polite" className="grid gap-2 rounded-lg border border-border/80 bg-card p-3 shadow-[var(--shadow-card)]">
          <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-3">
            <div className="min-w-0 break-words text-sm font-semibold leading-5 text-foreground">
              {isReplayPreparing && !isRunning ? "正在重新加载作品当前数据" : currentAction || "等待执行操作"}
            </div>
            <div className="flex min-w-0 items-center justify-between gap-2 sm:justify-end">
              <span className="mr-auto shrink-0 text-[11px] text-muted-foreground sm:mr-0">{isReplayPreparing && !isRunning ? "正在准备" : `处理用时：${formatElapsed(elapsedMs)}`}</span>
              {isReplayPreparing && !isRunning ? null : <span className="text-sm font-semibold text-foreground tabular-nums">{progress}%</span>}
              <Badge>进行中</Badge>
              <Button
                variant="secondary"
                size="sm"
                data-touch="compact"
                className="relative overflow-visible after:absolute after:inset-x-0 after:-inset-y-1.5 after:rounded-md after:content-['']"
                onClick={isReplayPreparing && !isRunning ? onCancelReplayPreparation : onCancelStatistics}
              >
                <PauseCircleIcon data-icon="inline-start" />
                取消
              </Button>
            </div>
          </div>
          <Progress value={isReplayPreparing && !isRunning ? 0 : progress} aria-label="统计进度" className="h-2 rounded-full bg-muted" indicatorClassName="bg-primary" />
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
                  { label: "抓取弹幕", value: formatPlainNumber(totalDanmaku) },
                  { label: "总去重", value: formatPlainNumber(totalUsers) },
                ]}
              />
            ) : null}
            {idResults.map((drama) => (
              <ResultCard
                key={`id-${drama.dramaId || drama.title}`}
                title={`${drama.title} / 已选 ${drama.selectedEpisodeCount} 集`}
                metrics={[
                  { label: "抓取弹幕", value: formatPlainNumber(drama.danmaku) },
                  { label: "去重 ID 数", value: formatPlainNumber(drama.users) },
                ]}
                footer={
                  <EpisodeDetailList
                    episodes={getEpisodeDetailsForDrama(drama.dramaId, episodeDetails)}
                    platform={platform}
                  />
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
              const dramaEpisodeDetails = getEpisodeDetailsForDrama(drama.dramaId, episodeDetails);

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
                  footer={<EpisodeDetailList episodes={dramaEpisodeDetails} platform={platform} />}
                />
              );
            })}
          </div>
        ) : null}

      <StatsHistoryList
        entries={visibleHistoryEntries}
        onDeleteHistoryEntry={onDeleteHistoryEntry}
        onClearHistory={onClearHistory}
        onReplayHistoryEntry={onReplayHistoryEntry}
        isReplayPreparing={isReplayPreparing}
        replayPreparingEntryIds={replayPreparingEntryIds}
        actionsDisabled={historyActionsDisabled || isRunning}
      />
    </div>
  );
}
