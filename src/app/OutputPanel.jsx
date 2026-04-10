import { PauseCircleIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  buildRevenueSummary,
  formatElapsed,
  formatPlainNumber,
  formatPlayCountDisplay,
  formatPlayCountWanFixed,
  formatRevenue,
  formatRevenueRange,
  formatRewardValue,
} from "@/app/app-utils";

function SectionCard({ title, children }) {
  return (
    <Card className="bg-[rgba(255,252,247,0.98)] shadow-[0_22px_50px_-40px_rgba(30,32,41,0.14)]">
      <CardHeader className="border-b border-border/75 bg-muted/30 pb-4">
        <CardTitle className="text-base sm:text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-5">{children}</CardContent>
    </Card>
  );
}

function MetricPair({ label, value }) {
  return (
    <div className="rounded-[calc(var(--radius)-0.12rem)] border border-[rgba(30,32,41,0.08)] bg-[rgba(255,252,247,0.92)] px-3.5 py-3">
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
      <div className="mt-2 min-w-0 whitespace-nowrap text-base font-semibold leading-none tracking-tight sm:text-lg lg:text-xl">
        {value}
      </div>
    </div>
  );
}

export function OutputPanel({
  platform,
  progress,
  currentAction,
  elapsedMs,
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
      return "投喂总数";
    }
    return isSummary ? "打赏榜总和（钻石）" : "打赏榜累计（钻石）";
  }

  function formatRewardMetricValue(drama) {
    if (drama?.platform === "manbo") {
      return formatRewardValue(drama.platform, drama.diamondValue);
    }
    return formatPlainNumber(drama?.rewardCoinTotal);
  }

  function hasRewardNum(drama) {
    return drama?.platform === "missevan" && drama?.rewardNum != null && Number.isFinite(Number(drama?.rewardNum));
  }

  function shouldShowRevenueRange(drama) {
    if (!drama || drama.failed) {
      return false;
    }
    if (drama.minRevenueYuan == null || drama.maxRevenueYuan == null) {
      return false;
    }
    return Number.isFinite(Number(drama.minRevenueYuan)) && Number.isFinite(Number(drama.maxRevenueYuan));
  }

  function getRevenueLabel(drama) {
    return drama?.vipOnlyReward ? "预估收益（仅计算打赏）" : "预估收益";
  }

  const hasAnyResults = Boolean(
    playCountResults?.length || idResults?.length || revenueResults?.length
  );

  if (!isRunning && !hasAnyResults) {
    return null;
  }

  return (
    <div className="grid gap-4">
      <Card className="bg-[linear-gradient(180deg,rgba(43,46,92,0.98),rgba(59,62,122,0.96))] text-white shadow-[0_24px_52px_-40px_rgba(59,62,122,0.4)]">
        <CardContent className="flex flex-col gap-5 p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-white/70">
                运行状态
              </div>
              <div className="text-xl font-semibold">{currentAction || "等待执行操作"}</div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-white/78">
                <div>处理用时：{formatElapsed(elapsedMs)}</div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {isRunning ? (
                    <Badge className="border-white/18 bg-white/16 px-3 py-1 text-white">进行中</Badge>
                  ) : (
                    <Badge variant="secondary" className="border border-white/16 bg-[rgba(255,240,233,0.92)] px-3 py-1 text-[rgb(126,75,67)]">空闲</Badge>
                  )}
                  {isRunning ? (
                    <Button variant="secondary" size="sm" onClick={onCancelStatistics}>
                      <PauseCircleIcon data-icon="inline-start" />
                      取消
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="text-2xl font-semibold sm:pt-8">{progress}%</div>
          </div>
          <Progress value={progress} className="h-2.5 rounded-full bg-white/18" indicatorClassName="bg-[rgba(255,245,236,0.96)]" />
        </CardContent>
      </Card>

      {playCountResults?.length ? (
        <SectionCard title="播放量统计">
          <div className="grid gap-3 sm:grid-cols-2">
            {playCountResults.map((drama) => (
              <div key={`play-${drama.title}`} className="rounded-[calc(var(--radius)+0.05rem)] border border-[rgba(30,32,41,0.08)] bg-[rgba(255,252,247,0.94)] p-4">
                <div className="text-sm font-medium text-muted-foreground">{drama.title} / 已选 {drama.selectedEpisodeCount} 集</div>
                <div className="mt-3 text-3xl font-semibold">{formatPlayCountDisplay(drama.playCountTotal, drama.playCountFailed)}</div>
              </div>
            ))}
            <div className="rounded-[calc(var(--radius)+0.05rem)] border border-[rgba(59,62,122,0.18)] bg-[rgba(59,62,122,0.94)] p-4 text-white">
              <div className="text-sm font-medium text-white/76">汇总 / 已选 {playCountSelectedEpisodeCount} 集</div>
              <div className="mt-3 text-3xl font-semibold">{formatPlayCountDisplay(playCountTotal, playCountFailed)}</div>
            </div>
          </div>
        </SectionCard>
      ) : null}

      {idResults?.length ? (
        <SectionCard title="弹幕与去重 ID 统计">
          <div className="grid gap-3 sm:grid-cols-2">
            {idResults.map((drama) => (
              <div key={`id-${drama.title}`} className="rounded-[calc(var(--radius)+0.05rem)] border border-[rgba(30,32,41,0.08)] bg-[rgba(255,252,247,0.94)] p-4">
                <div className="text-sm font-medium text-muted-foreground">{drama.title} / 已选 {drama.selectedEpisodeCount} 集</div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <MetricPair label="总弹幕数" value={formatPlainNumber(drama.danmaku)} />
                  <MetricPair label="去重 ID 数" value={formatPlainNumber(drama.users)} />
                </div>
              </div>
            ))}
            <div className="rounded-[calc(var(--radius)+0.05rem)] border border-[rgba(239,131,95,0.22)] bg-[rgba(255,240,233,0.9)] p-4 sm:col-span-2">
              <div className="text-sm font-medium text-muted-foreground">汇总 / 已选 {idSelectedEpisodeCount} 集</div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <MetricPair label="总弹幕数" value={formatPlainNumber(totalDanmaku)} />
                <MetricPair label="去重 ID 数" value={formatPlainNumber(totalUsers)} />
              </div>
              {suspectedOverflowEpisodes?.length ? (
                <div className="mt-4 grid gap-2 rounded-[calc(var(--radius)-0.08rem)] border border-dashed border-[rgba(239,131,95,0.26)] bg-[rgba(255,252,247,0.94)] p-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    疑似弹幕溢出分集
                  </div>
                  {suspectedOverflowEpisodes.map((title) => (
                    <div key={`overflow-${title}`} className="text-sm">
                      {title}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </SectionCard>
      ) : null}

      {revenueResults?.length ? (
        <SectionCard title="最低收益预估">
          <div className="grid gap-3 sm:grid-cols-2">
            {revenueResults.map((drama) => (
              <div key={`revenue-${drama.dramaId}`} className="rounded-[calc(var(--radius)+0.05rem)] border border-[rgba(30,32,41,0.08)] bg-[rgba(255,252,247,0.94)] p-4">
                <div className="text-sm font-medium text-muted-foreground">
                  {drama.subtitle || `${drama.title} / 单价 ${drama.price || 0} 钻石`}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
                  <MetricPair label={getPaidCountLabel(drama)} value={drama.failed ? "访问失败" : formatPlainNumber(drama.paidUserCount)} />
                  <MetricPair
                    label={getRewardLabel(drama)}
                    value={drama.failed ? "访问失败" : formatRewardMetricValue(drama)}
                  />
                  {hasRewardNum(drama) ? <MetricPair label="打赏人数" value={formatPlainNumber(drama.rewardNum)} /> : null}
                </div>
                <div className="mt-4 rounded-[calc(var(--radius)-0.08rem)] border border-[rgba(59,62,122,0.18)] bg-[rgba(59,62,122,0.92)] p-4 text-white">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-white/72">{getRevenueLabel(drama)}</div>
                  <div className="mt-2 text-2xl font-semibold">
                    {drama.failed
                      ? "预估失败"
                      : shouldShowRevenueRange(drama)
                        ? formatRevenueRange(drama.minRevenueYuan, drama.maxRevenueYuan)
                        : formatRevenue(drama.estimatedRevenueYuan)}
                  </div>
                </div>
              </div>
            ))}

            {resolvedRevenueSummary ? (
              <div className="rounded-[calc(var(--radius)+0.05rem)] border border-[rgba(239,131,95,0.18)] bg-[rgba(255,248,243,0.95)] p-4 sm:col-span-2">
                <div className="text-sm font-medium text-muted-foreground">
                  {resolvedRevenueSummary.summaryTitle || `汇总 / 已选 ${resolvedRevenueSummary.selectedDramaCount} 部`}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {resolvedRevenueSummary.paidCountSourceSummary === "mixed" ? (
                    <>
                      <MetricPair label="总付费人次" value={resolvedRevenueSummary.failed ? "访问失败" : formatPlainNumber(resolvedRevenueSummary.totalPayCount)} />
                      <MetricPair label="总和去重 ID" value={resolvedRevenueSummary.failed ? "访问失败" : formatPlainNumber(resolvedRevenueSummary.totalDanmakuPaidUserCount)} />
                    </>
                  ) : (
                    <MetricPair
                      label={getSummaryPaidCountLabel(resolvedRevenueSummary)}
                      value={resolvedRevenueSummary.failed ? "访问失败" : formatPlainNumber(resolvedRevenueSummary.totalPaidUserCount)}
                    />
                  )}
                  <MetricPair label="总播放量" value={resolvedRevenueSummary.failed ? "访问失败" : formatPlayCountWanFixed(resolvedRevenueSummary.totalViewCount)} />
                  <MetricPair
                    label={getRewardLabel(resolvedRevenueSummary, true)}
                    value={resolvedRevenueSummary.failed ? "访问失败" : resolvedRevenueSummary.platform === "manbo" ? formatRewardValue(resolvedRevenueSummary.platform, resolvedRevenueSummary.rewardTotal) : formatPlainNumber(resolvedRevenueSummary.rewardTotal)}
                  />
                  {hasRewardNum(resolvedRevenueSummary) ? <MetricPair label="打赏人次" value={formatPlainNumber(resolvedRevenueSummary.rewardNum)} /> : null}
                </div>
                <div className="mt-4 rounded-[calc(var(--radius)-0.08rem)] border border-[rgba(59,62,122,0.18)] bg-[rgba(59,62,122,0.92)] p-4 text-white">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-white/72">收益预估</div>
                  <div className="mt-2 text-2xl font-semibold">
                    {resolvedRevenueSummary.failed
                      ? "预估失败"
                      : shouldShowRevenueRange(resolvedRevenueSummary)
                        ? formatRevenueRange(resolvedRevenueSummary.minRevenueYuan, resolvedRevenueSummary.maxRevenueYuan)
                        : formatRevenue(resolvedRevenueSummary.estimatedRevenueYuan)}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}
