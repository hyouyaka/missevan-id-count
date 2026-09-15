import { useId, useState } from "react";
import { BeanIcon, ChevronDownIcon, ChevronUpIcon, CoinsIcon, GemIcon, HandCoinsIcon, MessagesSquareIcon, PlayCircleIcon, RotateCwIcon, ShoppingCartIcon, Trash2Icon, UsersRoundIcon, XIcon } from "lucide-react";

import { getHistoryMetricIconKey } from "@/app/app-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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

function getHistoryTaskLabel(entry) {
  const operation = entry?.replay?.operation;
  if (operation === "paid_id") return "付费ID";
  if (operation === "revenue" || entry?.taskType === "revenue") return "收益计算";
  if (operation === "play_count" || entry?.taskType === "play_count") return "播放量统计";
  return "ID统计";
}

export function StatsHistoryList({ entries = [], onDeleteHistoryEntry, onClearHistory, onReplayHistoryEntry, isReplayPreparing = false, replayPreparingEntryIds = [], actionsDisabled = false, constrainHeight = false }) {
  const [collapsed, setCollapsed] = useState(true);
  const historyRegionId = useId();

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
            data-touch="compact"
            className="relative h-7 overflow-visible px-1.5 text-[10px] text-muted-foreground after:absolute after:inset-x-0 after:-inset-y-2 after:rounded-md after:content-['']"
            aria-expanded={!collapsed}
            aria-controls={historyRegionId}
            onClick={() => setCollapsed((current) => !current)}
          >
            {collapsed ? <ChevronDownIcon data-icon="inline-start" /> : <ChevronUpIcon data-icon="inline-start" />}
            {collapsed ? "展开" : "收起"}
          </Button>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-touch="compact"
          className="relative h-7 overflow-visible px-1.5 text-[10px] text-muted-foreground after:absolute after:inset-x-0 after:-inset-y-2 after:rounded-md after:content-['']"
          onClick={onClearHistory}
        >
          <Trash2Icon data-icon="inline-start" />
          清空
        </Button>
      </div>

      {!collapsed ? <div
        id={historyRegionId}
        className={cn(
          "grid gap-2 border-t border-border/70 pt-2",
          constrainHeight && "max-h-[30vh] overflow-y-auto overscroll-contain pr-1"
        )}
      >
        {entries.map((entry, index) => (
          <div
            key={entry.id}
            className={cn("grid gap-1.5", index > 0 && "border-t border-border/70 pt-2")}
          >
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
              <div className="min-w-0 flex-1 break-words text-[11px] font-medium text-foreground/78">
                <span className="inline-block whitespace-nowrap">{entry.createdAtLabel}</span>{" "}
                <span aria-hidden="true">·</span>{" "}
                <span className="inline-block whitespace-nowrap">{getHistoryPlatformLabel(entry)}</span>{" "}
                <span aria-hidden="true">·</span>{" "}
                <span className="inline-block whitespace-nowrap">{getHistoryTaskLabel(entry)}</span>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-1">
                <span title={!entry.replay ? "旧记录未保存刷新参数，无法刷新" : undefined}>
                  <Button
                    type="button"
                    variant="secondary"
                    data-touch="compact"
                    className="relative h-8 min-w-11 shrink justify-center gap-1 rounded-[calc(var(--radius)-0.12rem)] px-1.5 text-center text-[0.7rem] after:absolute after:inset-x-0 after:-inset-y-1.5 after:rounded-md after:content-[''] sm:gap-1.5 sm:px-2.5 sm:text-xs lg:min-w-0"
                    disabled={actionsDisabled || isReplayPreparing || replayPreparingEntryIds.includes(entry.id) || !entry.replay}
                    title={entry.replay ? "按当前作品数据刷新" : undefined}
                    aria-label={entry.replay ? `刷新 ${getHistoryTaskLabel(entry)}` : "旧记录未保存刷新参数，无法刷新"}
                    onClick={() => onReplayHistoryEntry?.(entry)}
                  >
                    <RotateCwIcon data-icon="inline-start" />
                    刷新
                  </Button>
                </span>
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
