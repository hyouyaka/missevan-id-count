import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";

import { formatDeviceDateTime } from "@/app/app-utils";
import {
  FAVORITE_DELTA_METRICS,
  getSnapshotsForFavorite,
  resolveFavoriteMetricKey,
} from "@/app/favoritesStorage";

const SNAPSHOT_HISTORY_BATCH_SIZE = 5;

function MetricHeaderLabel({ label, subLabel, className = "", headerClassName = "" }) {
  return (
    <div className={`min-w-0 leading-4 ${className}`} title={subLabel ? `${label} / ${subLabel}` : label}>
      <div className={`truncate ${headerClassName}`}>{label}</div>
      {subLabel ? <div className={`mt-0.5 truncate ${headerClassName || "text-muted-foreground/85"}`}>{subLabel}</div> : null}
    </div>
  );
}

function getDeltaMetricLabel(deltaMetric, metricLabels) {
  return FAVORITE_DELTA_METRICS.find((item) => item.key === deltaMetric)?.label || metricLabels[deltaMetric] || "增量";
}

function getHistoryMetricColumns(platform, deltaMetric, metricLabels) {
  return [
    {
      type: "time",
      key: "time",
      label: "时间",
      columnClassName: "w-[8.75rem] whitespace-nowrap",
      cellClassName: "text-left",
    },
    {
      type: "metric",
      key: "viewCount",
      label: metricLabels.viewCount,
    },
    {
      type: "metric",
      key: "subscriptionCount",
      label: "追剧人数",
      subLabel: "收藏人数",
    },
    {
      type: "metric",
      key: platform === "missevan" ? "rewardCount" : "paidOrListenCount",
      label: "打赏人数",
      subLabel: "付费/收听人数",
    },
    {
      type: "metric",
      key: platform === "missevan" ? "rewardTotal" : "giftTotal",
      label: "打赏榜总和",
      subLabel: "总投喂",
    },
    {
      type: "metric",
      key: "paidIdCount",
      label: "付费ID",
    },
    {
      type: "delta",
      key: deltaMetric,
      label: `+${getDeltaMetricLabel(deltaMetric, metricLabels)}`,
      headerClassName: "favorite-history-delta text-[color-mix(in_oklch,var(--accent-success)_88%,var(--foreground))]",
      cellClassName: "favorite-history-delta font-medium text-[color-mix(in_oklch,var(--accent-success)_88%,var(--foreground))]",
    },
  ];
}

const favoriteSnapshotStatusMeta = {
  success: {
    label: "成功",
    dotClassName: "bg-[var(--accent-success)]",
  },
  partial: {
    label: "部分成功",
    dotClassName: "bg-secondary",
  },
  failed: {
    label: "失败",
    dotClassName: "bg-destructive",
  },
};

function getFavoriteFocusMetricKey(platform, deltaMetric) {
  const visibleMetricKeys = getVisibleMetricKeys(platform);
  const resolvedMetricKey = resolveFavoriteMetricKey(platform, deltaMetric);
  return visibleMetricKeys.includes(resolvedMetricKey) ? resolvedMetricKey : "viewCount";
}

function getVisibleMetricKeys(platform) {
  return platform === "missevan"
    ? ["viewCount", "subscriptionCount", "rewardCount", "rewardTotal", "paidIdCount"]
    : ["viewCount", "subscriptionCount", "paidOrListenCount", "giftTotal", "paidIdCount"];
}

function getOlderMetricReading(rows, startIndex, metricKey) {
  for (let index = startIndex + 1; index < rows.length; index += 1) {
    const value = rows[index]?.metrics?.[metricKey];
    if (value != null) {
      return { snapshot: rows[index], value: Number(value) };
    }
  }
  return { snapshot: null, value: null };
}

function getSnapshotMetricDelta(rows, index, metricKey) {
  const currentValue = rows[index]?.metrics?.[metricKey];
  if (currentValue == null) {
    return null;
  }
  const previous = getOlderMetricReading(rows, index, metricKey);
  return previous.value == null ? null : Number(currentValue) - previous.value;
}

function FavoriteSnapshotStatus({ status }) {
  const meta = favoriteSnapshotStatusMeta[status] || favoriteSnapshotStatusMeta.success;
  return (
    <span className="inline-flex items-center gap-1.5 text-[0.68rem] font-medium text-foreground">
      <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${meta.dotClassName}`} />
      {meta.label}
    </span>
  );
}

function FavoriteHistoryTimeline({
  favorite,
  rows,
  deltaMetric,
  expandedSnapshotId,
  formatDeltaValue,
  formatMetricValue,
  metricLabels,
  onExpandedSnapshotChange,
  regionId,
  visibleCount,
  onShowMore,
}) {
  const focusMetricKey = getFavoriteFocusMetricKey(favorite.platform, deltaMetric);
  const visibleMetricKeys = getVisibleMetricKeys(favorite.platform);
  const secondaryMetricKeys = visibleMetricKeys.filter((key) => key !== focusMetricKey);
  const visibleRows = rows.slice(0, visibleCount);
  const formatHistoryMetricValue = (value, metricKey) => value == null
    ? "未获取"
    : formatMetricValue(value, metricKey, favorite.platform);

  if (!visibleRows.length) {
    return <div className="px-3 py-4 text-xs text-muted-foreground">暂无快照数据</div>;
  }

  return (
    <div className="favorite-history-timeline">
      <ol className="divide-y divide-border/60">
        {visibleRows.map((snapshot, index) => {
          const expanded = expandedSnapshotId === snapshot.id;
          const detailId = `${regionId}-snapshot-${String(snapshot.id).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
          const focusValue = snapshot.metrics?.[focusMetricKey];
          const delta = getSnapshotMetricDelta(rows, index, focusMetricKey);
          const metricErrorEntries = Object.entries(snapshot.metricErrors || {});
          const metricErrorMessages = new Set(metricErrorEntries.map(([, message]) => message));
          const generalErrors = (snapshot.errors || []).filter((message) => !metricErrorMessages.has(message));

          return (
            <li key={snapshot.id} className="min-w-0 odd:bg-background even:bg-muted/45">
              <div className="grid gap-2 px-3 py-3">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <time className="min-w-0 text-xs text-muted-foreground" dateTime={new Date(snapshot.capturedAt).toISOString()}>
                    {formatDeviceDateTime(snapshot.capturedAt)}
                  </time>
                  <FavoriteSnapshotStatus status={snapshot.status} />
                </div>
                <div className="flex min-w-0 items-end justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[0.68rem] text-muted-foreground">{metricLabels[focusMetricKey]}</div>
                    <div className="mt-0.5 text-base font-semibold tabular-nums text-foreground">
                      {formatHistoryMetricValue(focusValue, focusMetricKey)}
                    </div>
                  </div>
                  <div className="favorite-history-delta shrink-0 text-sm font-medium tabular-nums text-[color-mix(in_oklch,var(--accent-success)_88%,var(--foreground))]">
                    {formatDeltaValue(delta, focusMetricKey, favorite.platform)}
                  </div>
                </div>
                <button
                  type="button"
                  className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  aria-controls={detailId}
                  aria-expanded={expanded}
                  onClick={() => onExpandedSnapshotChange(expanded ? "" : snapshot.id)}
                >
                  <span>{expanded ? "收起指标" : snapshot.status === "failed" ? "查看失败详情" : "查看全部指标"}</span>
                  <ChevronDownIcon
                    aria-hidden="true"
                    className={`size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
                  />
                </button>
              </div>

              {expanded ? (
                <div id={detailId} className="border-t border-border/55 px-3 py-3">
                  <dl className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-x-4 gap-y-3">
                    {secondaryMetricKeys.map((metricKey) => (
                      <div key={`${snapshot.id}-${metricKey}`} className="min-w-0">
                        <dt className="text-[0.68rem] leading-4 text-muted-foreground">{metricLabels[metricKey]}</dt>
                        <dd className="mt-0.5 break-words text-sm font-semibold tabular-nums text-foreground">
                          {formatHistoryMetricValue(snapshot.metrics?.[metricKey], metricKey)}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  {metricErrorEntries.length || generalErrors.length ? (
                    <div className="mt-3 grid gap-2 border-t border-border/55 pt-3 text-xs leading-5 text-foreground">
                      {metricErrorEntries.map(([metricKey, message]) => {
                        const fallback = getOlderMetricReading(rows, index, metricKey);
                        return (
                          <div key={`${snapshot.id}-error-${metricKey}`}>
                            <div>{metricLabels[metricKey] || metricKey}：{message}</div>
                            <div className="text-muted-foreground">
                              {fallback.snapshot
                                ? `卡片摘要沿用 ${formatDeviceDateTime(fallback.snapshot.capturedAt)} 的有效值`
                                : "暂无可沿用的有效值"}
                            </div>
                          </div>
                        );
                      })}
                      {generalErrors.map((message, errorIndex) => (
                        <div key={`${snapshot.id}-general-error-${errorIndex}`}>{message}</div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {visibleCount < rows.length ? (
        <button
          type="button"
          className="flex min-h-11 w-full cursor-pointer items-center justify-center border-t border-border/60 px-3 text-xs font-medium text-primary transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={onShowMore}
        >
          再显示 {Math.min(SNAPSHOT_HISTORY_BATCH_SIZE, rows.length - visibleCount)} 条
        </button>
      ) : null}
    </div>
  );
}

function FavoriteHistoryTable({ favorite, rows, deltaMetric, formatDeltaValue, formatMetricValue, metricLabels }) {
  const columns = getHistoryMetricColumns(favorite.platform, deltaMetric, metricLabels);
  const resolvedDeltaMetric = getFavoriteFocusMetricKey(favorite.platform, deltaMetric);
  const formatHistoryMetricValue = (value, metricKey) => value == null
    ? "未获取"
    : formatMetricValue(value, metricKey, favorite.platform);

  return (
    <div className="favorite-history-table max-h-44 overflow-y-auto">
      <table className="w-full table-fixed border-collapse text-[0.68rem]">
        <thead className="sticky top-0 z-10 bg-background/95 text-muted-foreground">
          <tr className="border-b border-border/70">
            {columns.map((column, index) => (
              <th
                key={`header-${column.type}-${column.key}`}
                className={`px-2 py-1.5 font-medium ${column.key === "time" ? "text-left" : "text-right"} ${column.columnClassName || ""}`}
              >
                <div className={`flex min-w-0 items-center gap-1 ${column.key === "time" ? "justify-start" : "justify-end"}`}>
                  <MetricHeaderLabel
                    label={column.label}
                    subLabel={column.subLabel}
                    className={column.key === "time" ? "text-left" : "text-right"}
                    headerClassName={column.headerClassName}
                  />
                  {index === columns.length - 1 ? (
                    <ChevronDownIcon aria-hidden="true" className="size-3.5 shrink-0 rotate-180 text-muted-foreground" />
                  ) : null}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((snapshot, index) => {
            const delta = getSnapshotMetricDelta(rows, index, resolvedDeltaMetric);
            return (
              <tr key={snapshot.id} className="border-b border-border/45 odd:bg-background even:bg-muted/45 last:border-b-0">
                {columns.map((column) => {
                  let value = "";
                  if (column.type === "time") {
                    value = formatDeviceDateTime(snapshot.capturedAt);
                  } else if (column.type === "delta") {
                    value = formatDeltaValue(delta, resolvedDeltaMetric, favorite.platform);
                  } else {
                    value = formatHistoryMetricValue(snapshot.metrics?.[column.key], column.key);
                  }

                  return (
                    <td
                      key={`${snapshot.id}-${column.type}-${column.key}`}
                      className={`px-2 py-1.5 tabular-nums ${column.key === "time" ? "text-left text-muted-foreground" : "text-right text-foreground"} ${column.columnClassName || ""} ${column.cellClassName || ""}`}
                    >
                      {column.type === "time" ? (
                        <div className="grid gap-0.5">
                          <span>{value}</span>
                          <FavoriteSnapshotStatus status={snapshot.status} />
                        </div>
                      ) : value}
                    </td>
                  );
                })}
              </tr>
            );
          }) : (
            <tr>
              <td colSpan={columns.length} className="px-2.5 py-3 text-xs text-muted-foreground">
                暂无快照数据
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function FavoriteHistoryDetails({
  favorite,
  snapshots,
  deltaMetric,
  expanded,
  formatDeltaValue,
  formatMetricValue,
  metricLabels,
  onToggle,
}) {
  const rows = getSnapshotsForFavorite(favorite.key, snapshots).slice(0, 30);
  const [visibleCount, setVisibleCount] = useState(SNAPSHOT_HISTORY_BATCH_SIZE);
  const [expandedSnapshotId, setExpandedSnapshotId] = useState("");
  const regionId = `favorite-history-${String(favorite.key).replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  if (!expanded) {
    return (
      <div className="min-w-0 overflow-hidden rounded-lg border border-border/70 bg-background/82">
        <button
          type="button"
          className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 px-2.5 py-2 text-left text-[0.78rem] font-medium text-foreground transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-controls={regionId}
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <span>历史记录（{rows.length}）</span>
          <ChevronDownIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground transition-transform" />
        </button>
      </div>
    );
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border/70 bg-background/82">
      <button
        type="button"
        className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 border-b border-border/70 px-2.5 py-2 text-left text-[0.78rem] font-medium text-foreground transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-controls={regionId}
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span>收起历史记录（{rows.length}）</span>
        <ChevronDownIcon aria-hidden="true" className="size-3.5 shrink-0 rotate-180 text-muted-foreground" />
      </button>
      <div id={regionId} className="favorite-history-responsive min-w-0">
        <FavoriteHistoryTimeline
          favorite={favorite}
          rows={rows}
          deltaMetric={deltaMetric}
          expandedSnapshotId={expandedSnapshotId}
          formatDeltaValue={formatDeltaValue}
          formatMetricValue={formatMetricValue}
          metricLabels={metricLabels}
          onExpandedSnapshotChange={setExpandedSnapshotId}
          regionId={regionId}
          visibleCount={visibleCount}
          onShowMore={() => setVisibleCount((current) => Math.min(rows.length, current + SNAPSHOT_HISTORY_BATCH_SIZE))}
        />
        <FavoriteHistoryTable
          favorite={favorite}
          rows={rows}
          deltaMetric={deltaMetric}
          formatDeltaValue={formatDeltaValue}
          formatMetricValue={formatMetricValue}
          metricLabels={metricLabels}
        />
      </div>
    </div>
  );
}
