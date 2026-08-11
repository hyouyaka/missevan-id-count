import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownUpIcon,
  BeanIcon,
  CheckIcon,
  ChevronDownIcon,
  CoinsIcon,
  DownloadIcon,
  FileDownIcon,
  FilterIcon,
  GemIcon,
  HeartIcon,
  MicIcon,
  MoreHorizontalIcon,
  PlayCircleIcon,
  RefreshCwIcon,
  SearchIcon,
  ShoppingCartIcon,
  StarIcon,
  TrendingUpIcon,
  Trash2Icon,
  UploadIcon,
  UsersRoundIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  buildVersionedUrl,
  extractResponseItems,
  formatCompactMetricValue,
  formatDeviceDateTime,
  getMissevanAccessDeniedMessage,
  getRemainingCooldownMinutes,
  formatPlainNumber,
  formatSignedCompactMetricValue,
  getBackendVersionFromResponse,
  MISSEVAN_DESKTOP_ACCESS_HINT,
} from "@/app/app-utils";
import {
  buildFavoritesBackup,
  buildFavoritesHistoryCsvRows,
  exportFavoritesData,
  FAVORITE_DELTA_METRICS,
  FAVORITE_FILTER_OPTIONS,
  FAVORITE_SORT_OPTIONS,
  filterFavorites,
  getFavoriteByKey,
  getLatestMetricReading,
  getLatestSnapshot,
  getSnapshotsForFavorite,
  importFavoritesData,
  listSnapshots,
  loadFavoriteSettings,
  normalizeFavoriteSettings,
  saveFavoriteSettings,
  saveSnapshot,
  resolveFavoriteMetricKey,
  serializeFavoritesHistoryCsv,
  sortFavoritesWithSnapshots,
  updateFavoriteIfExists,
} from "@/app/favoritesStorage";
import { PlatformGlyph } from "@/app/platformTabLabel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { LazyImage } from "@/components/ui/lazy-image";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { isMemberEpisode, isPaidEpisode } from "../../shared/episodeRules.js";

const metricIconMap = {
  viewCount: PlayCircleIcon,
  subscriptionCount: HeartIcon,
  rewardCount: GemIcon,
  rewardTotal: CoinsIcon,
  giftTotal: BeanIcon,
  paidOrListenCount: ShoppingCartIcon,
  paidIdCount: UsersRoundIcon,
};

const metricLabels = {
  viewCount: "播放量",
  subscriptionCount: "追剧/收藏人数",
  rewardCount: "打赏人数",
  rewardTotal: "打赏榜总和",
  giftTotal: "总投喂",
  paidOrListenCount: "付费/收听人数",
  paidIdCount: "付费 ID",
};

const SNAPSHOT_HISTORY_BATCH_SIZE = 5;
const EMPTY_FAVORITE_FILTERS = {
  query: "",
  platforms: [],
  contentTypes: [],
  payments: [],
};
const favoriteCoverPaymentBadgeClassName =
  "absolute bottom-0 right-0 h-4 rounded-none rounded-tl-[calc(var(--radius)-0.18rem)] border-0! px-1 text-[0.54rem] leading-none shadow-none! lg:h-[1.05rem] lg:px-1.5 lg:text-[0.58rem]";

const favoriteTagVariants = {
  猫耳: "missevanPlatform",
  漫播: "manboPlatform",
  免费: "free",
  会员: "member",
  付费: "paid",
  广播剧: "radioDrama",
  有声剧: "audioDrama",
  有声漫: "audioComic",
};

const favoriteFilterVisualMeta = {
  missevan: {
    badgeVariant: "missevanPlatform",
    platform: "missevan",
    softClassName:
      "border-[color-mix(in_oklch,var(--platform-missevan)_28%,transparent)] bg-[var(--platform-missevan-soft)] text-[var(--platform-missevan)]",
  },
  manbo: {
    badgeVariant: "manboPlatform",
    platform: "manbo",
    softClassName:
      "border-[color-mix(in_oklch,var(--platform-manbo)_28%,transparent)] bg-[var(--platform-manbo-soft)] text-[var(--platform-manbo)]",
  },
  radioDrama: {
    badgeVariant: "radioDrama",
    softClassName:
      "border-[color-mix(in_oklch,var(--accent-cool)_28%,transparent)] bg-[var(--accent-cool-soft)] text-[color-mix(in_oklch,var(--accent-cool)_84%,var(--foreground))]",
  },
  audioDrama: {
    badgeVariant: "audioDrama",
    softClassName:
      "border-[color-mix(in_oklch,var(--accent-rose)_28%,transparent)] bg-[var(--accent-rose-soft)] text-[color-mix(in_oklch,var(--accent-rose)_84%,var(--foreground))]",
  },
  paid: {
    badgeVariant: "paid",
    softClassName:
      "border-[color-mix(in_oklch,var(--accent-warm)_28%,transparent)] bg-[var(--accent-warm-soft)] text-[color-mix(in_oklch,var(--accent-warm)_82%,var(--foreground))]",
  },
  free: {
    badgeVariant: "free",
    softClassName:
      "border-[color-mix(in_oklch,var(--accent-success)_28%,transparent)] bg-[var(--accent-success-soft)] text-[color-mix(in_oklch,var(--accent-success)_82%,var(--foreground))]",
  },
  member: {
    badgeVariant: "member",
    softClassName:
      "border-[color-mix(in_oklch,var(--accent-gold)_45%,transparent)] bg-[var(--accent-gold-soft)] text-[var(--accent-gold-foreground)]",
  },
};

function buildProxyImageUrl(url) {
  return url ? `/image-proxy?url=${encodeURIComponent(url)}` : "";
}

function isFavoriteMoneyMetric(metricKey) {
  return metricKey === "rewardTotal" || metricKey === "giftTotal";
}

function getNullableFavoriteMetric(value) {
  if (value == null || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function addFavoriteMetricError(errors, metricErrors, metricKeys, message) {
  const normalizedMessage = String(message ?? "").trim() || "指标未获取";
  (Array.isArray(metricKeys) ? metricKeys : [metricKeys]).forEach((metricKey) => {
    metricErrors[metricKey] = normalizedMessage;
  });
  if (!errors.includes(normalizedMessage)) {
    errors.push(normalizedMessage);
  }
}

function formatFavoriteMoneyYuan(value, platform) {
  if (value == null || value === "") {
    return "暂无";
  }
  const rawAmount = Number(value);
  if (!Number.isFinite(rawAmount)) {
    return "暂无";
  }
  const divisor = platform === "missevan" ? 10 : 100;
  const amount = rawAmount / divisor;
  const sign = amount < 0 ? "-" : "";
  const absoluteAmount = Math.abs(amount);
  if (absoluteAmount >= 100000000) {
    return `${sign}${(absoluteAmount / 100000000).toFixed(1)}亿元`;
  }
  if (absoluteAmount >= 10000) {
    return `${sign}${(absoluteAmount / 10000).toFixed(1)}万元`;
  }
  if (Number.isInteger(absoluteAmount)) {
    return `${sign}${absoluteAmount}元`;
  }
  return `${sign}${absoluteAmount.toFixed(2).replace(/\.?0+$/, "")}元`;
}

function formatMetricValue(value, metricKey = "", platform = "") {
  if (value == null || value === "") {
    return "暂无";
  }
  if (isFavoriteMoneyMetric(metricKey)) {
    return formatFavoriteMoneyYuan(value, platform);
  }
  return metricKey === "paidIdCount" ? formatPlainNumber(value) : formatCompactMetricValue(value);
}

function formatDeltaValue(value, metricKey = "", platform = "") {
  if (value == null) {
    return "暂无";
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "暂无";
  }
  if (isFavoriteMoneyMetric(metricKey)) {
    return `${number > 0 ? "+" : ""}${formatFavoriteMoneyYuan(number, platform)}`;
  }
  if (metricKey === "paidIdCount") {
    return `${number > 0 ? "+" : ""}${formatPlainNumber(number)}`;
  }
  return formatSignedCompactMetricValue(number);
}

function getVisibleMetricKeys(platform) {
  return platform === "missevan"
    ? ["viewCount", "subscriptionCount", "rewardCount", "rewardTotal", "paidIdCount"]
    : ["viewCount", "subscriptionCount", "paidOrListenCount", "giftTotal", "paidIdCount"];
}

function formatFavoriteMainCvText(value) {
  return String(value ?? "").replace(/^主要CV：/, "").trim() || "暂无";
}

function countFavoriteMainCvNames(value) {
  const normalized = String(value ?? "").replace(/^主要CV：/, "").trim();
  if (!normalized || normalized === "暂无") {
    return 0;
  }
  return normalized.split(/[，,、/]/).map((item) => item.trim()).filter(Boolean).length;
}

function MetricPill({ metricKey, value, platform }) {
  const Icon = metricIconMap[metricKey] || PlayCircleIcon;
  return (
    <div className="min-w-0 text-center text-foreground">
      <div className="flex min-w-0 items-center justify-center gap-1 text-[0.68rem] text-muted-foreground">
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate">{metricLabels[metricKey]}</span>
      </div>
      <div className="mt-1 text-sm font-semibold tabular-nums leading-5">{formatMetricValue(value, metricKey, platform)}</div>
    </div>
  );
}

function MetricHeaderLabel({ label, subLabel, className = "", headerClassName = "" }) {
  return (
    <div className={`min-w-0 leading-4 ${className}`} title={subLabel ? `${label} / ${subLabel}` : label}>
      <div className={`truncate ${headerClassName}`}>{label}</div>
      {subLabel ? <div className={`mt-0.5 truncate ${headerClassName || "text-muted-foreground/85"}`}>{subLabel}</div> : null}
    </div>
  );
}

function getDeltaMetricLabel(deltaMetric) {
  return FAVORITE_DELTA_METRICS.find((item) => item.key === deltaMetric)?.label || metricLabels[deltaMetric] || "增量";
}

function getHistoryMetricColumns(platform, deltaMetric) {
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
      label: `+${getDeltaMetricLabel(deltaMetric)}`,
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

function formatHistoryMetricValue(value, metricKey, platform) {
  return value == null ? "未获取" : formatMetricValue(value, metricKey, platform);
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
  onExpandedSnapshotChange,
  regionId,
  visibleCount,
  onShowMore,
}) {
  const focusMetricKey = getFavoriteFocusMetricKey(favorite.platform, deltaMetric);
  const visibleMetricKeys = getVisibleMetricKeys(favorite.platform);
  const secondaryMetricKeys = visibleMetricKeys.filter((key) => key !== focusMetricKey);
  const visibleRows = rows.slice(0, visibleCount);

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
                      {formatHistoryMetricValue(focusValue, focusMetricKey, favorite.platform)}
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
                          {formatHistoryMetricValue(snapshot.metrics?.[metricKey], metricKey, favorite.platform)}
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

function FavoriteHistoryTable({ favorite, rows, deltaMetric }) {
  const columns = getHistoryMetricColumns(favorite.platform, deltaMetric);
  const resolvedDeltaMetric = getFavoriteFocusMetricKey(favorite.platform, deltaMetric);

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
                    value = formatHistoryMetricValue(snapshot.metrics?.[column.key], column.key, favorite.platform);
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

function SnapshotDetailsDisclosure({ favorite, snapshots, deltaMetric, expanded, onToggle }) {
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
          onExpandedSnapshotChange={setExpandedSnapshotId}
          regionId={regionId}
          visibleCount={visibleCount}
          onShowMore={() => setVisibleCount((current) => Math.min(rows.length, current + SNAPSHOT_HISTORY_BATCH_SIZE))}
        />
        <FavoriteHistoryTable favorite={favorite} rows={rows} deltaMetric={deltaMetric} />
      </div>
    </div>
  );
}

async function parseVersionedJson(response, frontendVersion, handleVersionResponse) {
  const data = await response.json();
  handleVersionResponse?.({
    ...data,
    frontendVersion,
    backendVersion: getBackendVersionFromResponse(response, data),
  });
  return data;
}

async function postJson(path, payload, frontendVersion, handleVersionResponse) {
  const response = await fetch(buildVersionedUrl(path, frontendVersion), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await parseVersionedJson(response, frontendVersion, handleVersionResponse);
  if (data?.accessDenied) {
    throw createFavoriteAccessDeniedError(data?.message || data?.error || "猫耳访问受限");
  }
  if (!response.ok) {
    throw new Error(data?.message || `请求失败：${response.status}`);
  }
  return data;
}

async function getJson(path, frontendVersion, handleVersionResponse) {
  const response = await fetch(buildVersionedUrl(path, frontendVersion), {
    cache: "no-store",
  });
  const data = await parseVersionedJson(response, frontendVersion, handleVersionResponse);
  if (data?.accessDenied) {
    throw createFavoriteAccessDeniedError(data?.message || data?.error || "猫耳访问受限");
  }
  if (!response.ok) {
    throw new Error(data?.message || `请求失败：${response.status}`);
  }
  return data;
}

async function wait(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

class FavoriteAccessDeniedError extends Error {
  constructor(message = "猫耳访问受限") {
    super(message);
    this.name = "FavoriteAccessDeniedError";
    this.accessDenied = true;
  }
}

function isFavoriteAccessDeniedError(error) {
  return error?.accessDenied === true || error?.name === "FavoriteAccessDeniedError";
}

function createFavoriteAccessDeniedError(message) {
  return new FavoriteAccessDeniedError(message);
}

function clampFavoriteProgress(value, maximum = 100) {
  const number = Number(value ?? 0);
  return Math.max(0, Math.min(Number.isFinite(number) ? number : 0, maximum));
}

function getStatsTaskProgressSnapshot(snapshot) {
  const queuePosition = Number(snapshot?.queuePosition ?? 0);
  return {
    ...snapshot,
    progress: clampFavoriteProgress(snapshot?.progress),
    currentAction: snapshot?.status === "queued" && queuePosition > 0
      ? `任务排队中，前方 ${queuePosition} 个任务`
      : snapshot?.currentAction || "统计中",
  };
}

function getFavoriteBatchProgress(favoriteIndex, favoriteCount, favoriteProgress) {
  const count = Math.max(1, Number(favoriteCount ?? 0) || 1);
  const index = Math.max(0, Number(favoriteIndex ?? 0) || 0);
  const itemProgress = clampFavoriteProgress(favoriteProgress);
  return Math.min(99, Math.floor(((index + itemProgress / 100) / count) * 100));
}

async function runStatsTask({ platform, taskType, payload, frontendVersion, handleVersionResponse, onProgress }) {
  const created = await postJson("/stat-tasks", { platform, taskType, ...payload }, frontendVersion, handleVersionResponse);
  const taskId = String(created?.taskId ?? "").trim();
  if (!taskId) {
    throw new Error("统计任务创建失败");
  }

  let snapshot = created;
  for (let index = 0; index < 240; index += 1) {
    const progressSnapshot = getStatsTaskProgressSnapshot(snapshot);
    onProgress?.(progressSnapshot);
    if (platform === "missevan" && snapshot?.accessDenied) {
      throw createFavoriteAccessDeniedError(progressSnapshot.currentAction || snapshot.error || "猫耳访问受限");
    }
    if (snapshot.status === "completed") {
      return snapshot;
    }
    if (snapshot.status === "failed") {
      throw new Error(snapshot.error || "统计任务失败");
    }
    if (snapshot.status === "cancelled") {
      throw new Error("统计任务已取消");
    }
    await wait(1200);
    snapshot = await getJson(`/stat-tasks/${taskId}?_ts=${Date.now()}`, frontendVersion, handleVersionResponse);
  }
  throw new Error("统计任务超时");
}

function buildPaidEpisodePayload(platform, dramaInfo) {
  const drama = dramaInfo?.drama || {};
  const dramaId = String(drama.id ?? "").trim();
  const dramaTitle = String(drama.name ?? "").trim();
  const episodes = Array.isArray(dramaInfo?.episodes?.episode) ? dramaInfo.episodes.episode : [];
  return episodes
    .filter((episode) => isPaidEpisode(platform, episode) || isMemberEpisode(platform, episode))
    .map((episode) => ({
      drama_id: dramaId,
      sound_id: episode.sound_id,
      drama_title: dramaTitle,
      episode_title: episode.name,
      duration: Number(episode.duration ?? 0),
    }));
}

function getDramaCover(dramaInfo, fallback = "") {
  const drama = dramaInfo?.drama || {};
  return String(drama.cover ?? drama.cover_url ?? drama.coverUrl ?? fallback ?? "").trim();
}

async function fetchFavoriteDramaInfo(favorite, frontendVersion, handleVersionResponse) {
  const path = favorite.platform === "manbo" ? "/manbo/getdramas" : "/getdramas";
  const data = await postJson(
    path,
    { drama_ids: [favorite.platform === "manbo" ? String(favorite.dramaId) : Number(favorite.dramaId)] },
    frontendVersion,
    handleVersionResponse
  );
  const result = extractResponseItems(data)[0];
  if (favorite.platform === "missevan" && (data?.accessDenied || result?.accessDenied)) {
    throw createFavoriteAccessDeniedError(data?.message || result?.message || "猫耳访问受限");
  }
  if (!result?.success || !result?.info) {
    throw new Error(result?.message || "作品详情读取失败");
  }
  return result.info;
}

async function fetchFavoriteMainCvText(favorite, frontendVersion, handleVersionResponse) {
  const params = new URLSearchParams({
    platform: favorite.platform,
    dramaId: String(favorite.dramaId ?? ""),
  });
  const data = await getJson(`/favorites/meta?${params.toString()}`, frontendVersion, handleVersionResponse);
  return String(data?.mainCvText ?? data?.main_cv_text ?? "").trim();
}

async function refreshFavoriteSnapshot({ favorite, frontendVersion, handleVersionResponse, isDesktopApp = false, onProgress }) {
  const capturedAt = Date.now();
  const errors = [];
  const metricErrors = {};
  onProgress?.({ progress: 0, currentAction: "读取作品详情" });
  const dramaInfo = await fetchFavoriteDramaInfo(favorite, frontendVersion, handleVersionResponse);
  onProgress?.({ progress: 10, currentAction: "整理作品信息" });
  const drama = dramaInfo?.drama || {};
  const paidEpisodes = buildPaidEpisodePayload(favorite.platform, dramaInfo);
  let refreshedMainCvText = "";
  if (!isDesktopApp && countFavoriteMainCvNames(favorite.mainCvText) <= 2) {
    try {
      const fetchedMainCvText = await fetchFavoriteMainCvText(favorite, frontendVersion, handleVersionResponse);
      if (countFavoriteMainCvNames(fetchedMainCvText) >= countFavoriteMainCvNames(favorite.mainCvText)) {
        refreshedMainCvText = fetchedMainCvText;
      }
    } catch (error) {
      if (isFavoriteAccessDeniedError(error)) {
        throw error;
      }
      console.warn("Failed to refresh favorite main CV", error);
    }
  }
  onProgress?.({ progress: 15, currentAction: "准备统计指标" });
  let paidIdCount = favorite.platform === "manbo" && paidEpisodes.length === 0 ? 0 : null;

  if (favorite.platform !== "missevan" && paidEpisodes.length > 0) {
    try {
      const idTask = await runStatsTask({
        platform: favorite.platform,
        taskType: "id",
        payload: { episodes: paidEpisodes, source: "favorite" },
        frontendVersion,
        handleVersionResponse,
        onProgress: (snapshot) => onProgress?.({
          progress: 15 + Math.floor(clampFavoriteProgress(snapshot.progress) * 0.8),
          currentAction: snapshot.currentAction,
        }),
      });
      if (Number(idTask?.failedCount ?? 0) > 0) {
        throw new Error(idTask.currentAction || "付费 ID 统计部分失败");
      }
      if (!Array.isArray(idTask?.result?.idResults)) {
        throw new Error("付费 ID 统计未返回结果");
      }
      const userCounts = idTask.result.idResults.map((item) => getNullableFavoriteMetric(item?.users));
      if (userCounts.some((value) => value == null)) {
        throw new Error("付费 ID 统计结果不完整");
      }
      paidIdCount = userCounts.reduce((sum, value) => sum + value, 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addFavoriteMetricError(errors, metricErrors, "paidIdCount", message);
    }
  }

  let rewardCount = null;
  let rewardTotal = null;
  let giftTotal = getNullableFavoriteMetric(drama.diamond_value);
  let paidOrListenCount = null;

  if (favorite.platform === "missevan") {
    try {
      const revenueTask = await runStatsTask({
        platform: favorite.platform,
        taskType: "revenue",
        payload: { dramaIds: [Number(favorite.dramaId)], source: "favorite" },
        frontendVersion,
        handleVersionResponse,
        onProgress: (snapshot) => onProgress?.({
          progress: 15 + Math.floor(clampFavoriteProgress(snapshot.progress) * 0.8),
          currentAction: snapshot.currentAction,
        }),
      });
      if (!Array.isArray(revenueTask?.result?.revenueResults)) {
        throw new Error("收益统计未返回结果");
      }
      const revenueResult = revenueTask.result.revenueResults
        .find((item) => String(item?.dramaId) === String(favorite.dramaId));
      if (!revenueResult) {
        throw new Error("收益统计未返回当前作品数据");
      }
      if (revenueResult.failed || Number(revenueTask?.failedCount ?? 0) > 0) {
        throw new Error(revenueResult.error || revenueTask.currentAction || "收益统计失败");
      }
      rewardCount = getNullableFavoriteMetric(revenueResult.rewardNum);
      rewardTotal = getNullableFavoriteMetric(revenueResult.rewardCoinTotal);
      paidIdCount = getNullableFavoriteMetric(
        revenueResult.seasonPaidUserCount ?? revenueResult.paidUserCount
      );
      if (rewardCount == null) {
        addFavoriteMetricError(errors, metricErrors, "rewardCount", "打赏人数未获取");
      }
      if (rewardTotal == null) {
        addFavoriteMetricError(errors, metricErrors, "rewardTotal", "打赏榜总和未获取");
      }
      if (paidIdCount == null) {
        addFavoriteMetricError(errors, metricErrors, "paidIdCount", "付费 ID 未获取");
      }
    } catch (error) {
      if (isFavoriteAccessDeniedError(error)) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      addFavoriteMetricError(errors, metricErrors, ["rewardCount", "rewardTotal", "paidIdCount"], message);
    }
  } else {
    const payCount = getNullableFavoriteMetric(drama.pay_count);
    const listenCount = getNullableFavoriteMetric(drama.member_listen_count);
    paidOrListenCount = payCount != null && payCount > 0
      ? payCount
      : listenCount != null && listenCount > 0
        ? listenCount
        : payCount === 0 || listenCount === 0
          ? 0
          : null;
    if (giftTotal == null) {
      addFavoriteMetricError(errors, metricErrors, "giftTotal", "总投喂未获取");
    }
    if (paidOrListenCount == null) {
      addFavoriteMetricError(errors, metricErrors, "paidOrListenCount", "付费/收听人数未获取");
    }
  }

  const viewCount = getNullableFavoriteMetric(drama.view_count);
  const subscriptionCount = getNullableFavoriteMetric(drama.subscription_num);
  if (viewCount == null) {
    addFavoriteMetricError(errors, metricErrors, "viewCount", "播放量未获取");
  }
  if (subscriptionCount == null) {
    addFavoriteMetricError(errors, metricErrors, "subscriptionCount", "追剧/收藏人数未获取");
  }

  const metrics = {
    viewCount,
    subscriptionCount,
    rewardCount,
    rewardTotal,
    giftTotal,
    paidOrListenCount,
    paidIdCount,
  };

  onProgress?.({ progress: 95, currentAction: "保存收藏历史" });
  const nextFavorite = await updateFavoriteIfExists(favorite.key, (activeFavorite) => ({
    ...activeFavorite,
    title: String(drama.name ?? activeFavorite.title ?? "").trim() || activeFavorite.title,
    cover: getDramaCover(dramaInfo, activeFavorite.cover),
    dramaUpdatedAt: String(drama.updated_at ?? drama.updatedAt ?? activeFavorite.dramaUpdatedAt ?? "").trim(),
    mainCvText: refreshedMainCvText || activeFavorite.mainCvText || "",
    updatedAt: capturedAt,
  }));
  if (!nextFavorite) {
    return null;
  }

  const snapshot = await saveSnapshot({
    id: `${favorite.key}:${capturedAt}`,
    favoriteKey: favorite.key,
    platform: favorite.platform,
    dramaId: favorite.dramaId,
    capturedAt,
    status: errors.length ? "partial" : "success",
    metrics,
    metricErrors,
    errors,
  });
  if (!snapshot) {
    return null;
  }
  onProgress?.({ progress: 100, currentAction: "收藏历史已保存" });
  return { favorite: nextFavorite, snapshot };
}

function FavoriteSearchControl({ value, onChange, className = "" }) {
  return (
    <label className={`relative block h-11 min-w-0 p-1 ${className}`}>
      <span className="flex h-9 min-w-0 items-center gap-2 rounded-md border border-input bg-background px-2.5 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40">
        <SearchIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <input
          aria-label="搜索收藏"
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          placeholder="搜索收藏"
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </span>
    </label>
  );
}

function FavoriteMobileSearchControl({ value, onChange }) {
  return (
    <div className="relative h-11 min-w-11 flex-1 p-1" data-testid="favorite-mobile-search-control">
      <div className="flex h-9 min-w-0 items-center overflow-hidden rounded-md border border-input bg-background pl-2 pr-11 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40">
        <input
          aria-label="搜索收藏"
          className="h-full min-w-0 flex-1 appearance-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
          placeholder="搜索收藏"
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      <button
        type="button"
        aria-label="清除搜索"
        title="清除搜索"
        disabled={!String(value ?? "").length}
        className="absolute right-0 top-0 flex size-11 items-center justify-center rounded-md bg-transparent text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-40"
        onClick={() => onChange("")}
      >
        <XIcon aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}

function FavoriteSingleSelect({
  label,
  value,
  options,
  onValueChange,
  icon: Icon = null,
  className = "",
  visualClassName = "",
  sizeToOptions = false,
  fluidWidth = false,
}) {
  const selectedLabel = options.find((option) => option.key === value)?.label || options[0]?.label || "";
  const longestLabelLength = Math.max(1, ...options.map((option) => Array.from(option.label).length));
  const compactStyle = sizeToOptions && !fluidWidth
    ? { width: `calc(${longestLabelLength}em + 1.625rem)` }
    : undefined;
  const compactContentStyle = sizeToOptions && fluidWidth
    ? { minWidth: `max(var(--radix-select-trigger-width), calc(${longestLabelLength * 0.68}rem + 1.625rem))` }
    : undefined;
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        aria-label={`${label}：${selectedLabel}`}
        title={`${label}：${selectedLabel}`}
        style={compactStyle}
        className={`relative h-11 min-w-0 border-0 bg-transparent p-1 shadow-none! hover:bg-transparent! focus-visible:ring-0 [&>svg]:pointer-events-none [&>svg]:absolute [&>svg]:top-1/2 [&>svg]:-translate-y-1/2 ${sizeToOptions ? `${fluidWidth ? "w-full" : "shrink-0"} text-[0.68rem] [&>svg]:right-1.5` : "[&>svg]:right-2.5"} ${className}`}
      >
        <span className={`pointer-events-none flex h-9 min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-md border border-input bg-background shadow-xs ${sizeToOptions ? "pl-1.5 pr-5 text-[0.68rem]" : "pl-2 pr-7 text-sm"} ${visualClassName}`}>
          {Icon ? <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" /> : null}
          <SelectValue className="block min-w-0 truncate whitespace-nowrap" />
        </span>
      </SelectTrigger>
      <SelectContent
        align="end"
        style={compactContentStyle}
        className={sizeToOptions ? `w-[var(--radix-select-trigger-width)]! ${fluidWidth ? "max-w-none!" : "min-w-0!"}` : "min-w-48"}
      >
        {options.map((option) => (
          <SelectItem key={option.key} value={option.key} className={`min-h-11 ${sizeToOptions ? "text-[0.68rem]" : ""}`}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function FavoriteFilterGroup({ label, options, selectedValues, onToggle }) {
  const selected = new Set(selectedValues);
  return (
    <fieldset className="grid gap-1.5">
      <legend className="px-1 text-xs font-semibold text-muted-foreground">{label}</legend>
      <div className={`grid gap-1 ${options.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
        {options.map((option) => {
          const active = selected.has(option.key);
          const visualMeta = favoriteFilterVisualMeta[option.key];
          return (
            <button
              key={option.key}
              type="button"
              aria-pressed={active}
              className="relative h-11 min-w-0 rounded-md bg-transparent p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              onClick={() => onToggle(option.key)}
            >
              <span
                data-variant={active ? visualMeta?.badgeVariant : undefined}
                className={cn(
                  active && visualMeta?.badgeVariant ? badgeVariants({ variant: visualMeta.badgeVariant }) : visualMeta?.softClassName,
                  "pointer-events-none relative flex h-9 w-full min-w-0 items-center justify-center rounded-md border px-2 text-xs font-medium"
                )}
              >
                <span className="flex min-w-0 items-center justify-center gap-1.5">
                  {visualMeta?.platform ? (
                    <PlatformGlyph platform={visualMeta.platform} tone="inherit" className="size-3.5" />
                  ) : null}
                  <span className="truncate">{option.label}</span>
                </span>
                {active ? <CheckIcon aria-hidden="true" className="absolute right-1.5 size-3.5 shrink-0" /> : null}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function FavoriteFilterPanel({ filters, onToggle, onReset, id, className = "", panelRef = null }) {
  const activeCount = filters.platforms.length + filters.contentTypes.length + filters.payments.length;
  return (
    <div ref={panelRef} id={id} className={`grid gap-2.5 rounded-lg border border-border/80 bg-surface-floating p-2.5 shadow-[var(--shadow-panel)] ${className}`}>
      <div className="flex min-h-9 items-center justify-between gap-3 px-1">
        <div className="text-sm font-semibold">筛选收藏{activeCount ? `（${activeCount}）` : ""}</div>
        <Button type="button" variant="ghost" size="sm" className="h-11" disabled={!activeCount} onClick={onReset}>重置</Button>
      </div>
      <FavoriteFilterGroup label="平台" options={FAVORITE_FILTER_OPTIONS.platforms} selectedValues={filters.platforms} onToggle={(key) => onToggle("platforms", key)} />
      <FavoriteFilterGroup label="类型" options={FAVORITE_FILTER_OPTIONS.contentTypes} selectedValues={filters.contentTypes} onToggle={(key) => onToggle("contentTypes", key)} />
      <FavoriteFilterGroup label="付费" options={FAVORITE_FILTER_OPTIONS.payments} selectedValues={filters.payments} onToggle={(key) => onToggle("payments", key)} />
    </div>
  );
}

function MobileToolbarButton({ variant = "outline", children, visualClassName = "", ...props }) {
  const visualVariantClassName = variant === "primary"
    ? "border-[color-mix(in_oklch,var(--primary)_24%,transparent)] bg-primary text-primary-foreground shadow-[var(--shadow-control)] group-hover/button:bg-[var(--primary-hover)] group-aria-expanded/button:bg-[var(--primary-hover)]"
    : variant === "secondary"
      ? "border-secondary/35 bg-[color-mix(in_oklch,var(--secondary)_18%,var(--background))] text-foreground"
      : "border-border/75 bg-background text-foreground";
  return (
    <Button
      type="button"
      variant="ghost"
      data-touch="compact"
      className="relative h-11 min-h-11 w-full min-w-0 bg-transparent! p-0 shadow-none! hover:bg-transparent! active:translate-y-0"
      {...props}
    >
      <span className={`pointer-events-none absolute inset-x-1 top-1/2 flex h-9 min-w-0 -translate-y-1/2 items-center justify-center gap-1 rounded-md border px-1.5 text-xs font-medium ${visualVariantClassName} ${visualClassName}`}>
        {children}
      </span>
    </Button>
  );
}

function FavoriteFilterPopover({ label, group, filters, onToggle }) {
  const options = FAVORITE_FILTER_OPTIONS[group];
  const selectedLabels = options.filter((option) => filters[group].includes(option.key)).map((option) => option.label);
  const summary = selectedLabels.length ? selectedLabels.join("、") : label;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          data-touch="compact"
          aria-label={`${label}：${selectedLabels.length ? summary : "不限"}`}
          title={`${label}：${selectedLabels.length ? summary : "不限"}`}
          className="relative h-11 min-w-0 bg-transparent! p-1 shadow-none! hover:bg-transparent!"
        >
          <span className={`pointer-events-none flex h-9 min-w-0 flex-1 items-center justify-between gap-2 rounded-md border px-2.5 text-sm ${selectedLabels.length ? "border-primary/35 bg-accent/70 text-accent-foreground" : "border-border/75 bg-background text-foreground"}`}>
            <span className="truncate">{summary}</span>
            {selectedLabels.length > 1 ? <span className="shrink-0 text-xs tabular-nums">{selectedLabels.length}</span> : <ChevronDownIcon aria-hidden="true" className="size-3.5 shrink-0 opacity-60" />}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <FavoriteFilterGroup label={label} options={options} selectedValues={filters[group]} onToggle={(key) => onToggle(group, key)} />
      </PopoverContent>
    </Popover>
  );
}

function FavoriteMoreActions({ layout = "grid", disabled = false, downloadDisabled = false, onImport, onExport, onDownload }) {
  return (
    <div className={layout === "grid" ? "grid grid-cols-3 gap-1" : "grid gap-1"}>
      <MobileToolbarButton disabled={disabled} onClick={onImport}>
        <DownloadIcon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate">导入历史</span>
      </MobileToolbarButton>
      <MobileToolbarButton onClick={onExport}>
        <UploadIcon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate">导出历史</span>
      </MobileToolbarButton>
      <MobileToolbarButton disabled={downloadDisabled} onClick={onDownload}>
        <FileDownIcon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate">下载数据</span>
      </MobileToolbarButton>
    </div>
  );
}

function FavoriteMoreMenu({ disabled, downloadDisabled, onImport, onExport, onDownload }) {
  const [open, setOpen] = useState(false);
  function run(action) {
    setOpen(false);
    action();
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" data-touch="compact" className="relative h-11 bg-transparent! p-1 shadow-none! hover:bg-transparent!" aria-label="更多收藏操作">
          <span className="pointer-events-none flex h-9 items-center gap-1.5 rounded-md border border-border/75 bg-background px-3 text-sm text-foreground">
            <MoreHorizontalIcon aria-hidden="true" className="size-4" />
            更多
            <ChevronDownIcon aria-hidden="true" className="size-3.5 opacity-60" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-40 p-1.5">
        <FavoriteMoreActions
          layout="list"
          disabled={disabled}
          downloadDisabled={downloadDisabled}
          onImport={() => run(onImport)}
          onExport={() => run(onExport)}
          onDownload={() => run(onDownload)}
        />
      </PopoverContent>
    </Popover>
  );
}

export function FavoritesPanel({
  favorites = [],
  favoriteActionsDisabled = false,
  statisticsActionsDisabled = false,
  cooldownHours = 4,
  cooldownUntil = 0,
  desktopAppUrl = "",
  frontendVersion = "0.0.0",
  handleVersionResponse,
  isDesktopApp = false,
  onBackgroundTaskChange = () => {},
  onFavoritesChange,
  onRefreshSettled,
  onRefreshStateChange = () => {},
  onToggleFavorite,
  refreshRevision = 0,
  refreshState = {
    isRunning: false,
    progress: 0,
    currentTitle: "",
    currentAction: "",
  },
}) {
  const [snapshots, setSnapshots] = useState([]);
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [expandedKeys, setExpandedKeys] = useState(new Set());
  const [settings, setSettings] = useState(() => normalizeFavoriteSettings());
  const [filters, setFilters] = useState(EMPTY_FAVORITE_FILTERS);
  const [mobilePanel, setMobilePanel] = useState(null);
  const fileInputRef = useRef(null);
  const mobileFilterTriggerRef = useRef(null);
  const mobileFilterPanelRef = useRef(null);
  const mobileMoreTriggerRef = useRef(null);
  const mobileMorePanelRef = useRef(null);
  const backfilledCvKeysRef = useRef(new Set());
  const refreshLockRef = useRef(false);
  const mountedRef = useRef(true);

  async function reloadSnapshots() {
    try {
      const nextSnapshots = await listSnapshots();
      if (mountedRef.current) {
        setSnapshots(nextSnapshots);
      }
    } catch (error) {
      console.error("Failed to load favorite snapshots", error);
      toast.error("读取收藏统计记录失败。");
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    reloadSnapshots();
  }, [refreshRevision]);

  useEffect(() => {
    loadFavoriteSettings()
      .then(setSettings)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (isDesktopApp) {
      return undefined;
    }
    const queue = favorites.filter((favorite) => {
      const key = String(favorite?.key ?? "").trim();
      return key && !String(favorite?.mainCvText ?? "").trim() && !backfilledCvKeysRef.current.has(key);
    });
    if (!queue.length) {
      return undefined;
    }

    queue.forEach((favorite) => {
      backfilledCvKeysRef.current.add(favorite.key);
    });

    let cancelled = false;
    async function backfillMissingMainCvText() {
      let changed = false;
      for (const favorite of queue) {
        try {
          const mainCvText = await fetchFavoriteMainCvText(favorite, frontendVersion, handleVersionResponse);
          if (mainCvText) {
            const updatedFavorite = await updateFavoriteIfExists(favorite.key, (activeFavorite) => ({
              ...activeFavorite,
              mainCvText,
              updatedAt: Date.now(),
            }));
            if (updatedFavorite) {
              changed = true;
            }
          }
        } catch (error) {
          console.warn("Failed to backfill favorite main CV", error);
        }
      }
      if (changed && !cancelled) {
        await onFavoritesChange?.();
      }
    }

    void backfillMissingMainCvText();
    return () => {
      cancelled = true;
    };
  }, [favorites, frontendVersion, handleVersionResponse, isDesktopApp, onFavoritesChange]);

  const sortedFavorites = useMemo(
    () => sortFavoritesWithSnapshots(favorites, snapshots, settings.sortBy),
    [favorites, snapshots, settings.sortBy]
  );
  const filteredFavorites = useMemo(
    () => filterFavorites(sortedFavorites, filters),
    [filters, sortedFavorites]
  );
  const filteredFavoriteKeys = useMemo(
    () => new Set(filteredFavorites.map((favorite) => favorite.key)),
    [filteredFavorites]
  );
  const selectedFavorites = useMemo(
    () => filteredFavorites.filter((favorite) => selectedKeys.has(favorite.key)),
    [filteredFavorites, selectedKeys]
  );
  const activeFilterCount = filters.platforms.length + filters.contentTypes.length + filters.payments.length;
  const hasActiveSearchOrFilters = Boolean(filters.query.trim()) || activeFilterCount > 0;
  const allFilteredSelected = filteredFavorites.length > 0 && selectedFavorites.length === filteredFavorites.length;

  useEffect(() => {
    setSelectedKeys((current) => {
      const next = new Set(Array.from(current).filter((key) => filteredFavoriteKeys.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [filteredFavoriteKeys]);

  useEffect(() => {
    if (!mobilePanel) {
      return undefined;
    }
    const triggerRef = mobilePanel === "filters" ? mobileFilterTriggerRef : mobileMoreTriggerRef;
    const panelRef = mobilePanel === "filters" ? mobileFilterPanelRef : mobileMorePanelRef;
    function closeOnOutsidePointer(event) {
      if (panelRef.current?.contains(event.target) || triggerRef.current?.contains(event.target)) {
        return;
      }
      setMobilePanel(null);
    }
    function closeOnEscape(event) {
      if (event.key === "Escape") {
        setMobilePanel(null);
        window.requestAnimationFrame(() => triggerRef.current?.querySelector("button")?.focus());
      }
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobilePanel]);

  function toggleSelected(key, checked) {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }

  function toggleAllFiltered(checked) {
    setSelectedKeys(checked ? new Set(filteredFavorites.map((favorite) => favorite.key)) : new Set());
  }

  function toggleFilter(group, key) {
    setFilters((current) => {
      const values = new Set(current[group]);
      if (values.has(key)) {
        values.delete(key);
      } else {
        values.add(key);
      }
      return { ...current, [group]: Array.from(values) };
    });
  }

  function resetFilters() {
    setFilters((current) => ({ ...EMPTY_FAVORITE_FILTERS, query: current.query }));
  }

  function clearSearchAndFilters() {
    setFilters(EMPTY_FAVORITE_FILTERS);
  }

  function toggleExpanded(key) {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  async function updateSettings(patch) {
    const nextSettings = normalizeFavoriteSettings({ ...settings, ...patch });
    setSettings(nextSettings);
    await saveFavoriteSettings(nextSettings);
  }

  function getFavoriteAccessDeniedText() {
    return isDesktopApp
      ? MISSEVAN_DESKTOP_ACCESS_HINT
      : getMissevanAccessDeniedMessage({ cooldownHours, cooldownUntil }, cooldownHours);
  }

  function renderFavoriteAccessDeniedMessage() {
    if (isDesktopApp) {
      return MISSEVAN_DESKTOP_ACCESS_HINT;
    }
    return (
      <span aria-label={getFavoriteAccessDeniedText()}>
        当前所有备份节点都在冷却中，请{getRemainingCooldownMinutes({ cooldownHours, cooldownUntil }, cooldownHours)}分钟之后再来，或使用
        {desktopAppUrl ? (
          <a className="font-medium text-primary underline underline-offset-4" href={desktopAppUrl} rel="noreferrer" target="_blank">
            桌面版
          </a>
        ) : (
          "桌面版"
        )}
        。
      </span>
    );
  }

  async function refreshMany(targetFavorites) {
    if (refreshLockRef.current) {
      return;
    }
    if (statisticsActionsDisabled) {
      toast.warning("后台任务运行中，请等待完成后再刷新收藏。");
      return;
    }
    const queue = (Array.isArray(targetFavorites) ? targetFavorites : []).filter(Boolean);
    if (!queue.length) {
      toast.warning("请先选择收藏作品。");
      return;
    }
    refreshLockRef.current = true;
    let failedCount = 0;
    let partialCount = 0;
    let stoppedByAccessDenied = false;
    let unexpectedFailure = false;
    let latestProgress = 0;
    let finalAction = "收藏刷新完成";
    function reportFavoriteProgress(index, favorite, itemProgress, currentAction) {
      latestProgress = Math.max(latestProgress, getFavoriteBatchProgress(index, queue.length, itemProgress));
      const favoriteTitle = favorite.title || "收藏作品";
      const action = currentAction || "正在刷新";
      const description = action.includes(favoriteTitle) ? action : `${favoriteTitle} · ${action}`;
      onRefreshStateChange({
        isRunning: true,
        progress: latestProgress,
        currentTitle: favoriteTitle,
        currentAction: action,
      });
      onBackgroundTaskChange({
        isRunning: true,
        status: "running",
        type: "favorites_refresh",
        title: "收藏刷新",
        description,
        progress: latestProgress,
        action: description,
        resultTarget: "favorites",
        highlighted: true,
      });
    }
    try {
      onRefreshStateChange({ isRunning: true, progress: 0, currentTitle: "", currentAction: "正在准备刷新收藏" });
      onBackgroundTaskChange({
        isRunning: true,
        status: "running",
        type: "favorites_refresh",
        title: "收藏刷新",
        description: "正在准备刷新收藏",
        progress: 0,
        action: "正在准备刷新收藏",
        resultTarget: "favorites",
        highlighted: true,
      });
      for (let index = 0; index < queue.length; index += 1) {
        const favorite = queue[index];
        reportFavoriteProgress(index, favorite, 0, "读取作品详情");
        try {
          const refreshed = await refreshFavoriteSnapshot({
            favorite,
            frontendVersion,
            handleVersionResponse,
            isDesktopApp,
            onProgress: ({ progress, currentAction }) => reportFavoriteProgress(index, favorite, progress, currentAction),
          });
          if (!refreshed) {
            reportFavoriteProgress(index, favorite, 100, "收藏已移除，跳过保存");
          } else if (refreshed.snapshot?.status === "partial") {
            partialCount += 1;
          }
        } catch (error) {
          if (isFavoriteAccessDeniedError(error)) {
            stoppedByAccessDenied = true;
            finalAction = getFavoriteAccessDeniedText();
            console.warn("Stopped favorite refresh because Missevan access is denied", error);
            break;
          }
          const activeFavorite = await getFavoriteByKey(favorite.key).catch(() => null);
          if (!activeFavorite) {
            reportFavoriteProgress(index, favorite, 100, "收藏已移除，跳过保存");
            continue;
          }
          failedCount += 1;
          console.error("Failed to refresh favorite", error);
          const failedCapturedAt = Date.now();
          const failedSnapshot = await saveSnapshot({
            id: `${favorite.key}:${failedCapturedAt}`,
            favoriteKey: favorite.key,
            platform: favorite.platform,
            dramaId: favorite.dramaId,
            capturedAt: failedCapturedAt,
            status: "failed",
            metrics: {},
            metricErrors: {},
            errors: [error instanceof Error ? error.message : String(error)],
          }).catch((saveError) => {
            console.error("Failed to save favorite failure snapshot", saveError);
            return null;
          });
          reportFavoriteProgress(
            index,
            favorite,
            100,
            failedSnapshot ? "刷新失败，已保存失败记录" : "刷新失败，失败记录未能保存"
          );
        }
      }
      await reloadSnapshots();
      await onFavoritesChange?.();
      if (stoppedByAccessDenied) {
        toast.error(renderFavoriteAccessDeniedMessage());
      } else if (failedCount > 0 || partialCount > 0) {
        const issueParts = [
          failedCount > 0 ? `${failedCount} 部作品刷新失败` : "",
          partialCount > 0 ? `${partialCount} 部作品部分指标未获取` : "",
        ].filter(Boolean);
        finalAction = `${issueParts.join("，")}。`;
        toast.warning(`刷新完成，${finalAction}`);
      } else {
        finalAction = "收藏统计记录已更新。";
        toast.success("收藏刷新完成。");
      }
      if (!stoppedByAccessDenied) {
        setSelectedKeys(new Set());
      }
      const terminalProgress = stoppedByAccessDenied ? latestProgress : 100;
      onBackgroundTaskChange({
        isRunning: false,
        status: stoppedByAccessDenied || failedCount > 0 ? "failed" : "completed",
        type: "favorites_refresh",
        title: stoppedByAccessDenied
          ? "收藏刷新已停止"
          : failedCount > 0
            ? "收藏刷新完成，部分失败"
            : partialCount > 0
              ? "收藏刷新完成，部分指标未获取"
              : "收藏刷新完成",
        description: stoppedByAccessDenied ? getFavoriteAccessDeniedText() : finalAction,
        progress: terminalProgress,
        action: stoppedByAccessDenied ? getFavoriteAccessDeniedText() : finalAction,
        resultTarget: "favorites",
        highlighted: true,
      });
      await onRefreshSettled?.();
    } catch (error) {
      unexpectedFailure = true;
      finalAction = error instanceof Error ? error.message : "收藏刷新未能完成";
      console.error("Favorite refresh queue stopped unexpectedly", error);
      toast.error(`收藏刷新异常中止：${finalAction}`);
      onBackgroundTaskChange({
        isRunning: false,
        status: "failed",
        type: "favorites_refresh",
        title: "收藏刷新异常中止",
        description: finalAction,
        progress: latestProgress,
        action: finalAction,
        resultTarget: "favorites",
        highlighted: true,
      });
    } finally {
      refreshLockRef.current = false;
      onRefreshStateChange({
        isRunning: false,
        progress: stoppedByAccessDenied || unexpectedFailure ? latestProgress : 100,
        currentTitle: "",
        currentAction: finalAction,
      });
    }
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function logFavoriteHistoryUsage(action, fields = {}) {
    void fetch(buildVersionedUrl("/usage-log", frontendVersion), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...fields }),
    }).catch((error) => {
      console.warn(`Failed to log ${action}`, error);
    });
  }

  async function exportData() {
    try {
      const backup = await exportFavoritesData();
      const normalizedBackup = buildFavoritesBackup(backup);
      const blob = new Blob([JSON.stringify(normalizedBackup, null, 2)], {
        type: "application/json",
      });
      downloadBlob(blob, `mm-toolkit-favorites-${new Date().toISOString().slice(0, 10)}.json`);
      logFavoriteHistoryUsage("favorite_history_export", {
        favoriteCount: normalizedBackup.favorites.length,
        snapshotCount: normalizedBackup.snapshots.length,
      });
      toast.success("收藏数据已导出。");
    } catch (error) {
      console.error("Failed to export favorites", error);
      toast.error("导出收藏数据失败。");
    }
  }

  function downloadSelectedHistory() {
    const rows = buildFavoritesHistoryCsvRows(selectedFavorites, snapshots);
    if (!rows.length) {
      toast.warning("所选作品暂无可下载的成功历史记录。");
      return;
    }
    const csv = serializeFavoritesHistoryCsv(rows);
    downloadBlob(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
      `mm-toolkit-favorites-history-${new Date().toISOString().slice(0, 10)}.csv`
    );
    logFavoriteHistoryUsage("favorite_history_download", {
      favoriteCount: selectedFavorites.length,
      rowCount: rows.length,
    });
    toast.success(`已下载 ${selectedFavorites.length} 部作品的历史数据。`);
  }

  async function importFile(file) {
    if (!file) {
      return;
    }
    try {
      const payload = JSON.parse(await file.text());
      const imported = await importFavoritesData(payload);
      setSettings(normalizeFavoriteSettings(imported?.settings));
      await reloadSnapshots();
      await onFavoritesChange?.();
      logFavoriteHistoryUsage("favorite_history_import", {
        favoriteCount: imported.favorites.length,
        snapshotCount: imported.snapshots.length,
      });
      toast.success("收藏数据导入完成。");
    } catch (error) {
      console.error("Failed to import favorites", error);
      toast.error(error instanceof Error ? error.message : "导入收藏数据失败。");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 px-1">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-2xl font-semibold tracking-tight">收藏</h2>
          <Badge variant="outline" className="h-6 px-2 text-xs">已收藏 {favorites.length} 部</Badge>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">查看已收藏剧集的最近统计和历史记录</p>
      </div>

      <Alert className="border-primary/20 bg-accent/80">
        <StarIcon className="size-4" />
        <AlertTitle>本地收藏说明</AlertTitle>
        <AlertDescription className="![text-wrap:wrap] md:![text-wrap:wrap]">
          收藏数据保存在当前浏览器，清除浏览器数据后可能丢失。如需备份或与其他浏览器同步，请使用导出和导入数据功能。
        </AlertDescription>
      </Alert>

      <div
        className={`favorite-mobile-toolbar relative lg:hidden ${mobilePanel ? "z-40" : ""}`}
        data-testid="favorite-mobile-toolbar"
      >
        <div
          className="grid overflow-visible rounded-lg border border-border/80 bg-card shadow-[var(--shadow-card)]"
          data-testid="favorite-mobile-toolbar-rows"
        >
          <div className="flex h-11 min-w-0 flex-nowrap items-center" data-testid="favorite-mobile-toolbar-primary">
            <FavoriteMobileSearchControl
              value={filters.query}
              onChange={(query) => setFilters((current) => ({ ...current, query }))}
            />
            <label className="relative block h-11 w-[4.6rem] shrink-0 p-1">
              <span className="absolute inset-x-1 top-1/2 flex h-9 min-w-0 -translate-y-1/2 items-center justify-center gap-1.5 rounded-md border border-border/75 bg-background px-1 text-xs font-medium text-foreground">
                <Switch
                  aria-label="全选当前筛选结果"
                  size="sm"
                  checked={allFilteredSelected}
                  disabled={!filteredFavorites.length}
                  onCheckedChange={(checked) => toggleAllFiltered(Boolean(checked))}
                />
                <span>全选</span>
              </span>
            </label>
            <div ref={mobileFilterTriggerRef} className="h-11 w-11 shrink-0">
              <MobileToolbarButton
                variant="primary"
                aria-expanded={mobilePanel === "filters"}
                aria-controls="favorite-mobile-filter-panel"
                aria-label={activeFilterCount ? `筛选，已启用 ${activeFilterCount} 项` : "筛选"}
                title={activeFilterCount ? `筛选，已启用 ${activeFilterCount} 项` : "筛选"}
                onClick={() => setMobilePanel((current) => current === "filters" ? null : "filters")}
              >
                <FilterIcon aria-hidden="true" className="size-4 shrink-0" />
              </MobileToolbarButton>
            </div>
          </div>
          <div
            className="favorite-mobile-toolbar-secondary grid h-11 min-w-0 items-center gap-0 border-t border-border/60"
            data-testid="favorite-mobile-toolbar-secondary"
          >
            <div className="h-11 min-w-11">
              <MobileToolbarButton
                variant="secondary"
                aria-label={refreshState.isRunning
                  ? `刷新中 ${refreshState.progress}%${refreshState.currentAction ? `：${refreshState.currentAction}` : ""}`
                  : `刷新所选 ${selectedFavorites.length} 部`}
                title={refreshState.isRunning
                  ? `刷新中 ${refreshState.progress}%${refreshState.currentAction ? `：${refreshState.currentAction}` : ""}`
                  : `刷新所选 ${selectedFavorites.length} 部`}
                disabled={refreshState.isRunning || favoriteActionsDisabled || statisticsActionsDisabled || selectedFavorites.length === 0}
                onClick={() => refreshMany(selectedFavorites)}
              >
                <RefreshCwIcon aria-hidden="true" className={refreshState.isRunning ? "size-3.5 shrink-0 animate-spin" : "size-3.5 shrink-0"} />
                <span className="favorite-mobile-refresh-label">刷新</span>
                <span className="tabular-nums">{refreshState.isRunning ? `${refreshState.progress}%` : selectedFavorites.length}</span>
              </MobileToolbarButton>
            </div>
            <FavoriteSingleSelect
              label="关注指标"
              value={settings.deltaMetric}
              options={FAVORITE_DELTA_METRICS}
              sizeToOptions
              fluidWidth
              onValueChange={(deltaMetric) => updateSettings({ deltaMetric })}
            />
            <FavoriteSingleSelect
              label="排序"
              value={settings.sortBy}
              options={FAVORITE_SORT_OPTIONS}
              sizeToOptions
              fluidWidth
              onValueChange={(sortBy) => updateSettings({ sortBy })}
            />
            <div ref={mobileMoreTriggerRef} className="h-11 w-11 shrink-0">
              <MobileToolbarButton
                variant="primary"
                aria-expanded={mobilePanel === "more"}
                aria-controls="favorite-mobile-more-panel"
                aria-label="更多收藏操作"
                title="更多收藏操作"
                onClick={() => setMobilePanel((current) => current === "more" ? null : "more")}
              >
                <MoreHorizontalIcon aria-hidden="true" className="size-4 shrink-0" />
              </MobileToolbarButton>
            </div>
          </div>
        </div>
        {mobilePanel === "filters" ? (
          <FavoriteFilterPanel
            id="favorite-mobile-filter-panel"
            panelRef={mobileFilterPanelRef}
            className="absolute right-0 top-11 z-20 w-[16.875rem]"
            filters={filters}
            onToggle={toggleFilter}
            onReset={resetFilters}
          />
        ) : null}
        {mobilePanel === "more" ? (
          <div
            ref={mobileMorePanelRef}
            id="favorite-mobile-more-panel"
            className="absolute right-0 top-[calc(100%+0.25rem)] z-20 w-40 rounded-lg border border-border/80 bg-surface-floating p-1.5 shadow-[var(--shadow-panel)]"
          >
            <FavoriteMoreActions
              layout="list"
              disabled={favoriteActionsDisabled}
              downloadDisabled={!selectedFavorites.length}
              onImport={() => {
                setMobilePanel(null);
                fileInputRef.current?.click();
              }}
              onExport={() => {
                setMobilePanel(null);
                exportData();
              }}
              onDownload={() => {
                setMobilePanel(null);
                downloadSelectedHistory();
              }}
            />
          </div>
        ) : null}
      </div>

      <div className="hidden gap-2 rounded-lg border border-border/75 bg-card p-2 lg:grid" data-testid="favorite-desktop-toolbar">
        <div className="grid min-w-0 grid-cols-[minmax(12rem,1.4fr)_repeat(3,minmax(6rem,.7fr))_repeat(2,minmax(8rem,1fr))] items-center gap-1">
          <FavoriteSearchControl
            value={filters.query}
            onChange={(query) => setFilters((current) => ({ ...current, query }))}
          />
          <FavoriteFilterPopover label="平台" group="platforms" filters={filters} onToggle={toggleFilter} />
          <FavoriteFilterPopover label="类型" group="contentTypes" filters={filters} onToggle={toggleFilter} />
          <FavoriteFilterPopover label="付费" group="payments" filters={filters} onToggle={toggleFilter} />
          <FavoriteSingleSelect
            label="关注指标"
            value={settings.deltaMetric}
            options={FAVORITE_DELTA_METRICS}
            icon={TrendingUpIcon}
            onValueChange={(deltaMetric) => updateSettings({ deltaMetric })}
          />
          <FavoriteSingleSelect
            label="排序"
            value={settings.sortBy}
            options={FAVORITE_SORT_OPTIONS}
            icon={ArrowDownUpIcon}
            onValueChange={(sortBy) => updateSettings({ sortBy })}
          />
        </div>
        <div className="flex min-h-11 items-center gap-2 border-t border-border/60 px-1 pt-2">
          <label className="relative flex h-11 items-center p-1">
            <span className="flex h-9 items-center gap-2 rounded-md border border-border/75 bg-background px-2.5 text-sm font-medium">
              <Switch
                aria-label="全选当前筛选结果"
                checked={allFilteredSelected}
                disabled={!filteredFavorites.length}
                onCheckedChange={(checked) => toggleAllFiltered(Boolean(checked))}
              />
              全选当前结果
            </span>
          </label>
          <span className="text-xs text-muted-foreground tabular-nums">已选 {selectedFavorites.length} / 当前 {filteredFavorites.length}</span>
          {hasActiveSearchOrFilters ? (
            <Button type="button" variant="ghost" className="h-11 px-2 text-xs" onClick={clearSearchAndFilters}>清除搜索和筛选</Button>
          ) : null}
          <div className="flex-1" />
          <Button
            type="button"
            variant="ghost"
            data-touch="compact"
            className="relative h-11 bg-transparent! p-1 shadow-none! hover:bg-transparent!"
            disabled={refreshState.isRunning || favoriteActionsDisabled || statisticsActionsDisabled || selectedFavorites.length === 0}
            onClick={() => refreshMany(selectedFavorites)}
          >
            <span className="pointer-events-none flex h-9 items-center gap-1.5 rounded-md border border-secondary/35 bg-[color-mix(in_oklch,var(--secondary)_18%,var(--background))] px-3 text-sm font-medium text-foreground">
              <RefreshCwIcon aria-hidden="true" className={refreshState.isRunning ? "size-4 animate-spin" : "size-4"} />
              {refreshState.isRunning ? `刷新中 ${refreshState.progress}%` : `刷新所选${selectedFavorites.length ? `（${selectedFavorites.length}）` : ""}`}
            </span>
          </Button>
          <FavoriteMoreMenu
            disabled={favoriteActionsDisabled}
            downloadDisabled={!selectedFavorites.length}
            onImport={() => fileInputRef.current?.click()}
            onExport={exportData}
            onDownload={downloadSelectedHistory}
          />
        </div>
      </div>

      <input
        ref={fileInputRef}
        className="hidden"
        type="file"
        accept="application/json,.json"
        onChange={(event) => importFile(event.target.files?.[0])}
      />

      {refreshState.isRunning ? (
        <div className="grid gap-2 rounded-lg border border-border/80 bg-card p-3">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium">正在刷新：{refreshState.currentTitle || "收藏作品"}</span>
            <span className="tabular-nums">{refreshState.progress}%</span>
          </div>
          <Progress value={refreshState.progress} className="h-3 rounded-full bg-muted" indicatorClassName="bg-primary" />
        </div>
      ) : null}

      {filteredFavorites.length ? (
        <div className="grid gap-3">
          {filteredFavorites.map((favorite) => {
            const latest = getLatestSnapshot(favorite.key, snapshots);
            const expanded = expandedKeys.has(favorite.key);
            const coverUrl = buildProxyImageUrl(favorite.cover);
            const metricKeys = getVisibleMetricKeys(favorite.platform);
            const platformLabel = favorite.platform === "missevan" ? "猫耳" : "漫播";
            const paymentTag = favorite.paymentLabel;
            const titleTags = [platformLabel, favorite.contentTypeLabel].filter(Boolean);
            const metricReadings = Object.fromEntries(
              metricKeys.map((key) => [key, getLatestMetricReading(favorite.key, snapshots, key)])
            );
            const hasFallbackMetrics = Boolean(latest) && metricKeys.some((key) => {
              const readingSnapshot = metricReadings[key]?.snapshot;
              return readingSnapshot && readingSnapshot.id !== latest.id;
            });
            const latestRefreshIncomplete = latest?.status === "failed" || latest?.status === "partial";

            return (
              <Card key={favorite.key}>
                <CardContent className="grid gap-3 p-3 sm:p-4">
                  <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
                    <div className="flex flex-col items-center gap-2 pt-1">
                      <Checkbox
                        aria-label={`选择${favorite.title}`}
                        className="after:-inset-3.5"
                        checked={selectedKeys.has(favorite.key)}
                        onCheckedChange={(checked) => toggleSelected(favorite.key, Boolean(checked))}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => onToggleFavorite?.({ ...favorite, source: "favorites" })}
                        aria-label="取消收藏"
                        title="取消收藏"
                        disabled={favoriteActionsDisabled}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                    <div className="contents">
                      <div className="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-3 lg:grid-cols-[5.5rem_minmax(0,1.1fr)_minmax(25rem,1.6fr)]">
                        <div className="relative size-[4.5rem] overflow-hidden rounded-md border border-border/70 bg-muted/50 lg:size-[5.5rem]">
                          {coverUrl ? (
                            <LazyImage alt={favorite.title} className="size-full object-cover" src={coverUrl} />
                          ) : (
                            <div className="flex size-full items-center justify-center text-xs text-muted-foreground">暂无封面</div>
                          )}
                          {paymentTag ? (
                            <Badge variant={favoriteTagVariants[paymentTag] || "outline"} className={favoriteCoverPaymentBadgeClassName}>
                              {paymentTag}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="min-w-0">
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <div className="min-w-0 break-words text-base font-semibold leading-6 sm:text-lg">{favorite.title}</div>
                            {titleTags.map((label) => (
                              <Badge key={`${favorite.key}-${label}`} variant={favoriteTagVariants[label] || "outline"} className="h-[1.05rem] px-1.5 text-[0.6rem] leading-none">
                                {label}
                              </Badge>
                            ))}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground"># {favorite.dramaId}</div>
                          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                            <MicIcon aria-label="主役CV" className="size-3.5 shrink-0" title="主役CV" />
                            <span className="min-w-0 truncate">{formatFavoriteMainCvText(favorite.mainCvText)}</span>
                          </div>
                        </div>
                        <div className="hidden grid-cols-5 gap-3 lg:grid">
                          {metricKeys.map((key) => (
                            <MetricPill key={`${favorite.key}-${key}`} metricKey={key} value={metricReadings[key]?.value} platform={favorite.platform} />
                          ))}
                        </div>
                      </div>

                      <div className="col-span-2 grid grid-cols-3 gap-2 lg:hidden">
                        {metricKeys.slice(0, 5).map((key) => (
                          <MetricPill key={`${favorite.key}-mobile-${key}`} metricKey={key} value={metricReadings[key]?.value} platform={favorite.platform} />
                        ))}
                      </div>

                      {latestRefreshIncomplete ? (
                        <div className="col-span-2 rounded-md bg-muted/45 px-2.5 py-2 text-xs leading-5 text-muted-foreground" role="status">
                          {latest.status === "failed" ? "最近一次刷新失败" : "最近一次刷新部分成功"}
                          {hasFallbackMetrics ? "，部分指标沿用上次有效数据。" : "，缺失指标暂不显示。"}
                        </div>
                      ) : null}

                      <div className="col-span-2">
                        <SnapshotDetailsDisclosure
                          favorite={favorite}
                          snapshots={snapshots}
                          deltaMetric={settings.deltaMetric}
                          expanded={expanded}
                          onToggle={() => toggleExpanded(favorite.key)}
                        />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : hasActiveSearchOrFilters && favorites.length ? (
        <div className="grid justify-items-center gap-3 rounded-lg border border-dashed border-border/80 bg-card/72 px-4 py-10 text-center">
          <div className="grid gap-1">
            <div className="text-sm font-medium text-foreground">没有符合条件的收藏</div>
            <div className="text-xs text-muted-foreground">调整关键词或筛选条件后再试。</div>
          </div>
          <Button type="button" variant="outline" className="h-11 px-4" onClick={clearSearchAndFilters}>清除搜索和筛选</Button>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border/80 bg-card/72 px-4 py-10 text-center text-sm text-muted-foreground">
          暂无收藏作品。可以在搜索结果、更新页或榜单页点击星标加入收藏。
        </div>
      )}

    </div>
  );
}
