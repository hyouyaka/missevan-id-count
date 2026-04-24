import { useState } from "react";
import { BeanIcon, ChevronDownIcon, ChevronUpIcon, CoinsIcon, GemIcon, HandCoinsIcon, MessagesSquareIcon, PauseCircleIcon, PlayCircleIcon, ShoppingCartIcon, Trash2Icon, UsersRoundIcon, XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  buildRevenueSummary,
  formatElapsed,
  formatPlainNumber,
  formatPlayCountDisplay,
  formatPlayCountWanFixed,
  formatRevenueDisplayValue,
  shouldShowRevenueRange,
} from "@/app/app-utils";

function getMetricToneClass(index) {
  const variants = [
    "border-border/80 bg-background text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.62),0_8px_18px_-16px_rgba(15,23,42,0.18)]",
    "border-secondary/20 bg-secondary/12 text-foreground",
    "border-primary/20 bg-accent text-accent-foreground",
  ];
  return variants[index % variants.length];
}

function getMetricLabelClass(index) {
  return index % 3 === 0 ? "text-foreground/72" : "opacity-72";
}

function trimTrailingZero(value) {
  return value.replace(/\.?0+$/, "");
}

function formatUnitlessMetricValue(value) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return "0";
  }
  if (amount >= 100000000) {
    return `${trimTrailingZero((amount / 100000000).toFixed(2))}亿`;
  }
  if (amount >= 10000) {
    return `${trimTrailingZero((amount / 10000).toFixed(1))}万`;
  }
  if (Number.isInteger(amount)) {
    return `${amount}`;
  }
  return trimTrailingZero(amount.toFixed(2));
}

function formatUnitlessMetricRange(minValue, maxValue) {
  return `${formatUnitlessMetricValue(minValue)} - ${formatUnitlessMetricValue(maxValue)}`;
}

function ResultStrip({ metrics, inverted = false }) {
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {metrics.map((metric, index) => {
        const toneIndex = inverted ? index + 2 : index;
        return (
          <div
            key={`${metric.label}-${index}`}
            className={`min-w-0 rounded-[calc(var(--radius)-0.12rem)] border px-2 py-2.5 text-center sm:px-3 ${getMetricToneClass(toneIndex)}`}
          >
            <div className={`text-[10px] sm:text-xs ${getMetricLabelClass(toneIndex)}`}>{metric.label}</div>
            <div className="mt-1 break-words text-sm font-semibold leading-tight sm:text-lg">{metric.value}</div>
          </div>
        );
      })}
    </div>
  );
}

function ResultCard({ title, metrics, insetInverted = false, footer = null }) {
  return (
    <div className="w-full min-w-0 rounded-lg border border-border/80 bg-card p-3 shadow-[0_16px_34px_-30px_rgba(15,23,42,0.16)] sm:p-4">
      <div className="break-words text-[11px] font-medium leading-5 text-foreground/78 sm:text-xs">{title}</div>
      {metrics?.length ? (
        <div className="mt-3">
          <ResultStrip metrics={metrics} inverted={insetInverted} />
        </div>
      ) : null}
      {footer ? <div className="mt-3">{footer}</div> : null}
    </div>
  );
}

function OverflowEpisodeList({ titles = [] }) {
  if (!titles?.length) {
    return null;
  }

  return (
    <div className="grid gap-2 rounded-[calc(var(--radius)-0.08rem)] border border-border/80 bg-background/96 p-3 text-foreground">
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        疑似弹幕溢出分集
      </div>
      {titles.map((item) => (
        <div key={item.key} className="text-sm">
          {item.title}
        </div>
      ))}
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
  return HISTORY_METRIC_ICON_MAP[metric?.key] || null;
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

function ResultHistory({ entries = [], onDeleteHistoryEntry, onClearHistory }) {
  const [collapsed, setCollapsed] = useState(true);

  if (!entries?.length) {
    return null;
  }

  return (
    <div className="grid gap-3 rounded-lg border border-border/80 bg-background/55 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">查询历史</div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px] text-muted-foreground"
            onClick={() => setCollapsed((current) => !current)}
          >
            {collapsed ? <ChevronDownIcon className="size-3.5" /> : <ChevronUpIcon className="size-3.5" />}
            {collapsed ? "展开" : "收起"}
          </Button>
        </div>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-muted-foreground" onClick={onClearHistory}>
          <Trash2Icon className="size-3.5" />
          清空
        </Button>
      </div>

      {!collapsed ? <div className="grid gap-3">
        {entries.map((entry, index) => (
          <div
            key={entry.id}
            className={`${index > 0 ? "border-t border-border/70 pt-3" : ""} grid gap-2`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="text-[11px] font-medium text-foreground/78">{entry.createdAtLabel}</div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground"
                onClick={() => onDeleteHistoryEntry?.(entry.id)}
                aria-label={`删除 ${entry.createdAtLabel} 这条历史`}
              >
                <XIcon className="size-3.5" />
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
  const resolvedRevenueSummary = revenueSummary || buildRevenueSummary(revenueResults, platform);

  function getPaidCountLabel(drama) {
    if (drama?.platform === "manbo" && drama?.paidCountSource === "pay_count") {
      return "付费人数";
    }
    return "付费用户 ID 数";
  }

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

  function isManboRewardOnlyRevenue(drama) {
    if (drama?.platform !== "manbo") {
      return false;
    }
    if (drama?.summaryRevenueMode === "member_reward" || drama?.revenueType === "member") {
      return true;
    }
    const rewardValue = Number(drama?.diamondValue ?? drama?.rewardTotal ?? 0);
    const titlePrice = Number(drama?.titlePrice ?? drama?.titlePriceTotal ?? 0);
    return rewardValue > 0 && titlePrice <= 0 && !shouldShowRevenueRange(drama);
  }

  function isMissevanRewardOnlyRevenue(drama) {
    if (drama?.platform !== "missevan") {
      return false;
    }
    return Boolean(
      drama?.vipOnlyReward ||
        drama?.summaryRevenueMode === "member_reward" ||
        (!drama?.failed && !drama?.hasSummaryPrice && Number(drama?.rewardTotal ?? 0) > 0)
    );
  }

  function getRevenueLabel(drama) {
    if (isManboRewardOnlyRevenue(drama)) {
      return "收益预估（仅计算投喂，元）";
    }
    if (isMissevanRewardOnlyRevenue(drama)) {
      return "收益预估（仅计算打赏，元）";
    }
    return "收益预估（元）";
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
    <Card className="border-border/80 bg-card shadow-[0_24px_52px_-42px_rgba(15,23,42,0.22)]">
      <CardContent className="flex flex-col gap-5 p-4 sm:p-5">
        {isRunning || hasAnyResults ? (
          <div className="grid gap-3 rounded-lg border border-border/80 bg-background/70 p-3 sm:p-4">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="text-base font-semibold text-foreground sm:text-lg">{currentAction || "等待执行操作"}</div>
                <div className="text-[11px] text-muted-foreground sm:text-xs">
                  <div>处理用时：{formatElapsed(elapsedMs)}</div>
                </div>
              </div>
              <div className="flex shrink-0 items-center justify-end gap-2 text-right">
                <div className="text-lg font-semibold text-foreground sm:text-xl">{progress}%</div>
                {isRunning ? (
                  <Badge className="px-3 py-1 text-[11px] sm:text-xs">进行中</Badge>
                ) : (
                  <Badge variant="secondary" className="px-3 py-1 text-[11px] sm:text-xs">空闲</Badge>
                )}
                {isRunning ? (
                  <Button variant="secondary" size="sm" className="text-[11px] sm:text-xs" onClick={onCancelStatistics}>
                    <PauseCircleIcon data-icon="inline-start" />
                    取消
                  </Button>
                ) : null}
              </div>
            </div>
            <Progress value={progress} className="h-3 rounded-full bg-muted" indicatorClassName="bg-primary" />
          </div>
        ) : null}

        {playCountResults?.length ? (
          <div className="grid gap-3">
            {playCountResults.length > 1 ? (
              <ResultCard
                title={`汇总 / 已选 ${playCountSelectedEpisodeCount} 集`}
                insetInverted
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
          <div className="grid gap-3">
            {idResults.length > 1 ? (
              <ResultCard
                title={`汇总 / 已选 ${idSelectedEpisodeCount} 集`}
                metrics={[]}
                footer={
                  <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                    {[
                      { label: "总弹幕数", value: formatPlainNumber(totalDanmaku) },
                      { label: "总去重", value: formatPlainNumber(totalUsers) },
                    ].map((metric, metricIndex) => (
                      <div key={`summary-${metric.label}`} className={`min-w-0 rounded-[calc(var(--radius)-0.12rem)] border px-2 py-2 text-center sm:px-3 ${getMetricToneClass(metricIndex + idResults.length)}`}>
                        <div className={`text-[10px] sm:text-xs ${getMetricLabelClass(metricIndex + idResults.length)}`}>{metric.label}</div>
                        <div className="mt-1 break-words text-sm font-semibold leading-tight sm:text-lg">{metric.value}</div>
                      </div>
                    ))}
                  </div>
                }
              />
            ) : null}
            {idResults.map((drama) => (
              <ResultCard
                key={`id-${drama.dramaId || drama.title}`}
                title={`${drama.title} / 已选 ${drama.selectedEpisodeCount} 集`}
                metrics={[]}
                footer={
                  <div className="grid gap-3">
                    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                      {[
                        { label: "总弹幕数", value: formatPlainNumber(drama.danmaku) },
                        { label: "去重 ID 数", value: formatPlainNumber(drama.users) },
                      ].map((metric, metricIndex) => (
                        <div
                          key={`${drama.dramaId || drama.title}-${metric.label}`}
                          className={`min-w-0 rounded-md border px-2 py-2 text-center sm:px-3 ${getMetricToneClass(metricIndex)}`}
                        >
                          <div className={`text-[10px] sm:text-xs ${getMetricLabelClass(metricIndex)}`}>{metric.label}</div>
                          <div className="mt-1 break-words text-sm font-semibold leading-tight sm:text-lg">{metric.value}</div>
                        </div>
                      ))}
                    </div>
                    <OverflowEpisodeList titles={getOverflowEpisodesForDrama(drama.dramaId, suspectedOverflowEpisodes)} />
                  </div>
                }
              />
            ))}
          </div>
        ) : null}

        {revenueResults?.length ? (
          <div className="grid gap-3">
            {resolvedRevenueSummary && revenueResults.length > 1 ? (
              <ResultCard
                title={resolvedRevenueSummary.summaryTitle || `汇总 / 已选 ${resolvedRevenueSummary.selectedDramaCount} 部`}
                insetInverted={false}
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
                  insetInverted={false}
                  metrics={[
                    {
                      label: getPaidCountLabel(drama),
                      value: drama.failed ? "访问失败" : formatPlainNumber(drama.paidUserCount),
                    },
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
      </CardContent>
    </Card>
  );
}
