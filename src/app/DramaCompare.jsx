import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftRightIcon,
  ChevronDownIcon,
  HeartIcon,
  MicIcon,
  PlayCircleIcon,
  RefreshCwIcon,
  ShoppingCartIcon,
  Trash2Icon,
  UsersRoundIcon,
  XIcon,
} from "lucide-react";

import { fetchRankTrendData } from "@/app/rankTrendData";
import {
  getBackendVersionFromResponse,
} from "@/app/app-utils";
import { PlatformIdIcon } from "@/app/platformTabLabel";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { LazyImage } from "@/components/ui/lazy-image";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  buildCompareChartMetrics,
  buildProxyImageUrl,
  clampCompareTooltipPercent,
  comparePalette,
  formatComparePercent,
  formatCompareWindowLabel,
  formatOptionalPlainNumber,
  formatSignedPlainNumber,
  formatTrendDate,
  getCompareAxisTick,
  getMetricFromTrend,
  getMetricLatestValue,
  isCompareMetricAvailableForItem,
  MAX_COMPARE_ITEMS,
} from "@/app/dramaCompareUtils";

const COMPARE_WINDOWS = ["3d", "7d", "30d"];
const COMPARE_WEEKLY_WINDOWS = ["3w", "7w", "30w"];
const COMPARE_CHART_MODES = [
  { key: "absolute", label: "绝对值" },
  { key: "increment", label: "增量" },
];
const COMPARE_METRICS = [
  { key: "view_count", label: "播放量", icon: PlayCircleIcon },
  { key: "subscription_num", label: "追剧人数", icon: HeartIcon },
  { key: "danmaku_uid_count", label: "付费ID数", icon: UsersRoundIcon },
  { key: "pay_count", label: "付费/收听人数", icon: ShoppingCartIcon },
];

function CompareTrendChart({ items, windowKey, metricOption, chartMode, chartUtils }) {
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [selectedPoint, setSelectedPoint] = useState(null);
  const {
    buildTrendChartLines,
    filterNonZeroTrendMetrics,
    getTrendAxisLabelMarkers,
    getTrendAxisY,
  } = chartUtils || {};
  const rawChartMetrics = buildCompareChartMetrics(items, windowKey, metricOption);
  const chartMetricSignature = rawChartMetrics
    .map((metric) => `${metric.key}:${(Array.isArray(metric.history) ? metric.history : []).map((point) => `${point.date}:${point.value ?? ""}`).join(",")}`)
    .join("|");
  const activeTooltipPoint = selectedPoint || hoveredPoint;

  useEffect(() => {
    setHoveredPoint(null);
    setSelectedPoint(null);
  }, [windowKey, metricOption?.key, chartMode, chartMetricSignature]);

  if (
    typeof buildTrendChartLines !== "function" ||
    typeof filterNonZeroTrendMetrics !== "function" ||
    typeof getTrendAxisLabelMarkers !== "function" ||
    typeof getTrendAxisY !== "function"
  ) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-border bg-card text-sm text-muted-foreground">
        正在加载趋势图
      </div>
    );
  }

  const chartMetrics = filterNonZeroTrendMetrics(rawChartMetrics);
  const chartData = buildTrendChartLines(chartMetrics, { chartMode });
  const axis = chartData?.axis || chartData?.axes?.left;
  const axisLabelMarkers = getTrendAxisLabelMarkers(
    chartData?.dateMarkers || chartData?.lines?.[0]?.markers || [],
    windowKey
  );
  const tooltipPlacement = activeTooltipPoint?.position?.y < 44 ? "below" : "above";
  const tooltipLeft = activeTooltipPoint
    ? clampCompareTooltipPercent((activeTooltipPoint.position.x / 320) * 100)
    : 50;
  const tooltipTop = activeTooltipPoint
    ? clampCompareTooltipPercent(
        ((activeTooltipPoint.position.y + (tooltipPlacement === "below" ? 18 : -12)) / 170) * 100
      )
    : 50;

  if (!metricOption?.key || !chartMetrics.length || !axis?.domain || !Array.isArray(chartData?.lines) || !chartData.lines.length) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-border bg-card text-sm text-muted-foreground">
        当前指标暂无可对比趋势
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-2.5 shadow-[var(--shadow-card)]">
      <div
        className="relative h-56 overflow-visible rounded-md bg-background"
        role="group"
        tabIndex={0}
        aria-label="剧集对比趋势图交互区域"
        onClick={() => setSelectedPoint(null)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setSelectedPoint(null);
          }
        }}
        onPointerLeave={() => setHoveredPoint(null)}
      >
        <svg aria-label="剧集对比趋势图" className="size-full" preserveAspectRatio="none" viewBox="0 0 320 170">
          {(axis.ticks || []).map((tick) => (
            <line
              key={`compare-grid-${tick}`}
              x1="44"
              x2="302"
              y1={getTrendAxisY(tick, axis.domain)}
              y2={getTrendAxisY(tick, axis.domain)}
              stroke="var(--border)"
              strokeDasharray="4 6"
              strokeWidth="1"
            />
          ))}
          {chartData.lines.map((line) => (
            <g key={line.metric.key}>
              {(line.segments || []).map((segment, index) => (
                <polyline
                  key={`${line.metric.key}-${index}`}
                  fill="none"
                  points={segment.map(({ position }) => `${position.x},${position.y}`).join(" ")}
                  stroke={line.metric.color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2.5"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-y-0 left-1 top-0 w-12 text-[0.52rem] font-medium text-muted-foreground">
          {(axis.ticks || []).map((tick) => {
            const y = getTrendAxisY(tick, axis.domain);
            return (
              <span
                key={`compare-axis-${tick}`}
                className="absolute right-1 -translate-y-1/2 tabular-nums"
                style={{ top: `${(y / 170) * 100}%` }}
              >
                {getCompareAxisTick(tick, metricOption.key)}
              </span>
            );
          })}
        </div>
        {chartData.lines.flatMap((line) =>
          (line.markers || []).map(({ point, position }) => (
              <span
                key={`${line.metric.key}-${point.date}`}
                aria-hidden="true"
                className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-card"
                style={{
                  borderColor: line.metric.color,
                  left: `${(position.x / 320) * 100}%`,
                  top: `${(position.y / 170) * 100}%`,
                }}
              />
            ))
        )}
        {chartData.lines.flatMap((line) =>
          (line.markers || []).map(({ point, position }) => {
            const tooltipPoint = {
              key: `${line.metric.key}-${point.date}`,
              label: line.metric.label,
              date: formatTrendDate(point.date),
              value: chartMode === "increment"
                ? formatSignedPlainNumber(point.displayValue)
                : formatOptionalPlainNumber(point.value),
              color: line.metric.color,
              position,
            };
            return (
              <button
                key={`compare-target-${tooltipPoint.key}`}
                type="button"
                aria-label={`${tooltipPoint.label} ${tooltipPoint.date} ${tooltipPoint.value}`}
                className="absolute size-7 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                style={{
                  left: `${(position.x / 320) * 100}%`,
                  top: `${(position.y / 170) * 100}%`,
                }}
                onFocus={() => setHoveredPoint(tooltipPoint)}
                onBlur={() => setHoveredPoint(null)}
                onPointerEnter={() => setHoveredPoint(tooltipPoint)}
                onPointerLeave={() => setHoveredPoint(null)}
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedPoint(tooltipPoint);
                }}
              />
            );
          })
        )}
        {activeTooltipPoint ? (
          <div
            className={`pointer-events-none absolute z-20 min-w-12 -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-center text-[0.62rem] font-medium leading-tight text-popover-foreground shadow-md ${
              tooltipPlacement === "below" ? "" : "-translate-y-full"
            }`}
            style={{
              borderColor: activeTooltipPoint.color,
              left: `${tooltipLeft}%`,
              top: `${tooltipTop}%`,
            }}
          >
            <div>{activeTooltipPoint.date}</div>
            <div className="mt-0.5">{activeTooltipPoint.label}</div>
            <div className="mt-0.5 tabular-nums">{activeTooltipPoint.value}</div>
          </div>
        ) : null}
        <div className="pointer-events-none absolute inset-x-0 bottom-1 text-[0.58rem] text-muted-foreground">
          {axisLabelMarkers.map(({ point, position }) => (
            <span
              key={`compare-date-${point.date}`}
              className="absolute -translate-x-1/2 whitespace-nowrap"
              style={{ left: `${(position.x / 320) * 100}%` }}
            >
              {formatTrendDate(point.date)}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[0.68rem] text-muted-foreground">
        {chartData.lines.map((line) => (
          <span key={`compare-legend-${line.metric.key}`} className="inline-flex min-w-0 items-center gap-1">
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: line.metric.color }} />
            <span className="max-w-28 truncate">{line.metric.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function DramaCompareDialog({ open, onOpenChange, items, frontendVersion, handleVersionResponse }) {
  const [selectedMetric, setSelectedMetric] = useState("view_count");
  const [selectedWindow, setSelectedWindow] = useState("7d");
  const [selectedChartMode, setSelectedChartMode] = useState("absolute");
  const [trendItems, setTrendItems] = useState([]);
  const [trendChartUtils, setTrendChartUtils] = useState(null);
  const [selectedCompareItemKeys, setSelectedCompareItemKeys] = useState(() => new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const handleVersionResponseRef = useRef(handleVersionResponse);
  const compareItemsKey = items.map((item) => item.key).join("|");

  useEffect(() => {
    handleVersionResponseRef.current = handleVersionResponse;
  }, [handleVersionResponse]);

  useEffect(() => {
    if (open) {
      setSelectedMetric("view_count");
      setSelectedWindow("7d");
      setSelectedChartMode("absolute");
      setSelectedCompareItemKeys(new Set(items.map((item) => item.key)));
    }
  }, [open, compareItemsKey, items]);

  useEffect(() => {
    if (!open || !items.length) {
      setTrendItems([]);
      return;
    }
    let cancelled = false;
    async function loadCompareTrends() {
      setIsLoading(true);
      setErrorMessage("");
      try {
        const chartUtils = await import("@/app/rankTrendChartUtils");
        async function loadTrend(item, kind = "") {
          const { response, data } = await fetchRankTrendData({
            platform: item.platform,
            id: item.id,
            kind,
            frontendVersion,
          });
          handleVersionResponseRef.current?.({
            ...data,
            backendVersion: getBackendVersionFromResponse(response, data),
            frontendVersion,
          });
          if (!response.ok || !data?.success) {
            return null;
          }
          return { ...item, trendData: data };
        }
        let loaded = (await Promise.all(items.map((item) => loadTrend(item)))).filter(Boolean);
        const hasPeakSeries = items.some((item) => item.compareKind === "peak_series");
        const hasWeeklyPlayback = !hasPeakSeries && loaded.some(
          (item) => item.trendData?.kind === "weekly_playback"
        );
        const hasMetricTrend = loaded.some((item) => item.trendData?.kind === "metric");
        if (hasWeeklyPlayback && hasMetricTrend) {
          const weeklyMetricItems = loaded.filter((item) => item.trendData?.kind === "metric");
          const weeklyMetricResults = (await Promise.all(
            weeklyMetricItems.map((item) => loadTrend(item, "weekly_playback"))
          )).filter(Boolean);
          const weeklyByKey = new Map(weeklyMetricResults.map((item) => [item.key, item]));
          loaded = loaded
            .map((item) => weeklyByKey.get(item.key) || item)
            .filter((item) => item.trendData?.kind === "weekly_playback");
        }
        if (!cancelled) {
          setTrendChartUtils(chartUtils);
          setTrendItems(loaded);
          setErrorMessage(loaded.length ? "" : "对比趋势数据暂不可用。");
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load compare trends", error);
          setTrendItems([]);
          setErrorMessage("对比趋势数据暂不可用。");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }
    loadCompareTrends();
    return () => {
      cancelled = true;
    };
  }, [open, compareItemsKey, frontendVersion, items]);

  const isPeakSeriesCompare = trendItems.some((item) => item.compareKind === "peak_series") ||
    (!trendItems.length && items.some((item) => item.compareKind === "peak_series"));
  const isWeeklyPlaybackCompare = !isPeakSeriesCompare && trendItems.length > 0 &&
    trendItems.every((item) => item.trendData?.kind === "weekly_playback");
  const availableCompareWindows = isWeeklyPlaybackCompare ? COMPARE_WEEKLY_WINDOWS : COMPARE_WINDOWS;
  const availableMetricOptions = COMPARE_METRICS.filter((option) => {
    if (!trendItems.length) {
      return isPeakSeriesCompare ? option.key === "view_count" : true;
    }
    if (isPeakSeriesCompare) {
      return option.key === "view_count" && trendItems.every((item) => isCompareMetricAvailableForItem(item, selectedWindow, option.key));
    }
    if (isWeeklyPlaybackCompare) {
      return option.key === "view_count" && trendItems.every((item) => isCompareMetricAvailableForItem(item, selectedWindow, option.key));
    }
    return trendItems.every((item) => isCompareMetricAvailableForItem(item, selectedWindow, option.key));
  });
  const selectedMetricOption =
    availableMetricOptions.find((option) => option.key === selectedMetric) ||
    availableMetricOptions[0] ||
    null;
  const hasSelectedMetricOption = Boolean(selectedMetricOption);
  const coloredCompareItems = items.map((item, index) => ({
    ...item,
    compareColor: comparePalette[index % comparePalette.length],
  }));
  const colorByCompareKey = new Map(coloredCompareItems.map((item) => [item.key, item.compareColor]));
  const coloredTrendItems = trendItems.map((item) => ({
    ...item,
    compareColor: colorByCompareKey.get(item.key) || item.compareColor,
  }));
  const visibleTrendItems = coloredTrendItems.filter((item) => selectedCompareItemKeys.has(item.key));

  useEffect(() => {
    if (selectedMetricOption?.key && selectedMetricOption.key !== selectedMetric) {
      setSelectedMetric(selectedMetricOption.key);
    }
  }, [selectedMetric, selectedMetricOption?.key]);

  useEffect(() => {
    setSelectedWindow((current) => {
      const windowOptions = isWeeklyPlaybackCompare ? COMPARE_WEEKLY_WINDOWS : COMPARE_WINDOWS;
      if (windowOptions.includes(current)) {
        return current;
      }
      return isWeeklyPlaybackCompare ? "7w" : "7d";
    });
  }, [isWeeklyPlaybackCompare]);

  function toggleCompareItemLine(itemKey) {
    setSelectedCompareItemKeys((current) => {
      const next = new Set(current);
      if (next.has(itemKey)) {
        next.delete(itemKey);
      } else {
        next.add(itemKey);
      }
      return next;
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        scrollable
        className="w-[calc(100vw-1.5rem)] max-w-[58rem] gap-3 overflow-x-hidden p-3 pt-4 sm:p-4"
      >
        <AlertDialogCancel
          aria-label="关闭剧集对比"
          className="absolute right-3 top-3"
          size="icon-xs"
          title="关闭"
          variant="secondary"
        >
          <XIcon />
        </AlertDialogCancel>
        <AlertDialogHeader className="gap-1 place-items-start pr-8 text-left">
          <AlertDialogTitle className="text-base">剧集对比</AlertDialogTitle>
          <AlertDialogDescription className="sr-only">
            查看已选剧集的历史趋势对比。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid min-w-0 gap-3 w-full">
          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap">
            {availableMetricOptions.length > 1 ? (
              <Tabs value={selectedMetric} onValueChange={setSelectedMetric} className="min-w-0 w-full sm:flex-1">
                <TabsList
                  className="grid h-auto w-full min-w-0 items-center justify-stretch text-xs!"
                  style={{ gridTemplateColumns: `repeat(${availableMetricOptions.length}, minmax(0, 1fr))` }}
                >
                  {availableMetricOptions.map((option) => {
                    const Icon = option.icon;
                    return (
                      <TabsTrigger
                        key={option.key}
                        className="h-[26px] min-w-0 px-1.5 text-xs! sm:px-2.5"
                        title={option.label}
                        value={option.key}
                      >
                        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                        <span className="min-w-0 truncate">{option.label}</span>
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
              </Tabs>
            ) : null}
            <Tabs value={selectedWindow} onValueChange={setSelectedWindow} className="w-fit shrink-0">
              <TabsList className="inline-flex h-[34px] w-fit items-center justify-center text-xs!">
                {availableCompareWindows.map((key) => (
                  <TabsTrigger key={key} data-touch="compact" className="h-[26px] min-w-0 px-3 text-xs!" value={key}>
                    {formatCompareWindowLabel(key)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Tabs value={selectedChartMode} onValueChange={setSelectedChartMode} className="w-fit shrink-0">
              <TabsList className="inline-flex h-[34px] w-fit items-center justify-center text-xs!">
                {COMPARE_CHART_MODES.map((mode) => (
                  <TabsTrigger key={mode.key} data-touch="compact" className="h-[26px] min-w-0 px-3 text-xs!" value={mode.key}>
                    {mode.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          <div className="flex min-w-0 gap-2 overflow-x-auto pb-1">
            {coloredCompareItems.map((item) => {
              const lineColor = item.compareColor;
              const trendItem = trendItems.find((entry) => entry.key === item.key);
              const itemIdText = item.compareKind === "peak_series"
                ? (
                    Array.isArray(item.dramaIds) && item.dramaIds.length
                      ? item.dramaIds.join("，")
                      : Array.isArray(trendItem?.trendData?.dramaIds) && trendItem.trendData.dramaIds.length
                        ? trendItem.trendData.dramaIds.join("，")
                        : item.id
                  )
                : item.id;
              return (
                <div
                  key={item.key}
                className="relative flex w-[120px] shrink-0 flex-col items-center gap-2 rounded-lg border border-border/80 bg-card p-2 text-center sm:w-48 sm:flex-row sm:pr-7 sm:text-left"
              >
                <div className="size-16 shrink-0 overflow-hidden rounded-md border border-border/70 bg-muted/50">
                  {item.cover ? (
                    <LazyImage alt={item.title} className="size-full object-cover" src={buildProxyImageUrl(item.cover)} />
                  ) : (
                    <div className="flex size-full items-center justify-center text-[0.65rem] text-muted-foreground">暂无封面</div>
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col items-center sm:items-start">
                  <div className="line-clamp-2 text-xs font-semibold leading-4 text-foreground">{item.title}</div>
                  <div className="mt-1 flex min-w-0 items-start justify-start gap-1 text-left text-[0.68rem] leading-4 text-muted-foreground">
                    <PlatformIdIcon platform={item.platform} className="size-3.5 shrink-0" />
                    <span className="line-clamp-2 min-w-0 break-all text-left">{itemIdText}</span>
                  </div>
                  <div className="mt-0.5 flex min-w-0 items-start justify-start gap-1 text-left text-[0.68rem] leading-4 text-muted-foreground">
                    <MicIcon aria-hidden="true" className="size-3.5 shrink-0" />
                    <span className="line-clamp-2 min-w-0 break-words text-left">{item.mainCvText || "CV 暂无"}</span>
                  </div>
                </div>
                <label className="absolute right-2 top-2 inline-flex items-center gap-1" title="显示/隐藏曲线">
                  <input
                    type="checkbox"
                    aria-label={`显示${item.title}曲线`}
                    checked={selectedCompareItemKeys.has(item.key)}
                    className="size-3.5 rounded border-border"
                    style={{ accentColor: lineColor }}
                    onChange={() => toggleCompareItemLine(item.key)}
                  />
                </label>
              </div>
              );
            })}
          </div>
          {isLoading || (!errorMessage && hasSelectedMetricOption && !trendChartUtils) ? (
            <Alert>
              <RefreshCwIcon className="size-4 animate-spin" />
              <AlertTitle>正在读取对比趋势</AlertTitle>
              <AlertDescription>正在读取已选剧集的历史数据</AlertDescription>
            </Alert>
          ) : errorMessage || !hasSelectedMetricOption ? (
            <Alert className="border-destructive/30 bg-destructive/10">
              <AlertTitle>对比暂不可用</AlertTitle>
              <AlertDescription>{errorMessage || "对比趋势数据暂不可用。"}</AlertDescription>
            </Alert>
          ) : (
            <CompareTrendChart
              items={visibleTrendItems}
              windowKey={selectedWindow}
              metricOption={selectedMetricOption}
              chartMode={selectedChartMode}
              chartUtils={trendChartUtils}
            />
          )}
          {hasSelectedMetricOption ? (
          <div className="w-full min-w-0 overflow-hidden rounded-lg border border-border/80 bg-card">
            <table className="w-full table-fixed text-[0.68rem] sm:text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="w-[36%] px-2 py-2 text-left font-medium sm:px-3">剧集</th>
                  <th className="px-2 py-2 text-right font-medium sm:px-3">{selectedMetricOption.label}</th>
                  <th className="px-2 py-2 text-right font-medium sm:px-3">{formatCompareWindowLabel(selectedWindow)}变化</th>
                  <th className="px-2 py-2 text-right font-medium sm:px-3">{formatCompareWindowLabel(selectedWindow)}增幅</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {coloredCompareItems.map((item) => {
                  const trendItem = coloredTrendItems.find((entry) => entry.key === item.key);
                  const metric = getMetricFromTrend(trendItem?.trendData, selectedWindow, selectedMetricOption.key);
                  return (
                    <tr key={`compare-row-${item.key}`}>
                      <td className="px-2 py-2 sm:px-3">
                        <span className="flex w-full min-w-0 items-center gap-1.5">
                          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: item.compareColor }} />
                          <span className="min-w-0 truncate font-medium text-foreground">{item.title}</span>
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums sm:px-3">{formatOptionalPlainNumber(getMetricLatestValue(trendItem?.trendData, selectedWindow, selectedMetricOption.key))}</td>
                      <td className="px-2 py-2 text-right tabular-nums sm:px-3">{formatSignedPlainNumber(metric?.delta)}</td>
                      <td className="px-2 py-2 text-right tabular-nums sm:px-3">{formatComparePercent(metric?.deltaPercent)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          ) : null}
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DramaCompareBasket({ items, open, onOpenChange, onOpenCompare, onRemoveItem, onClear }) {
  if (!items.length) {
    return null;
  }
  const latestItem = items.at(-1);
  const compareBasketTitleSummary = items.map((item) => item.title).filter(Boolean).join("，");
  const previewItems = items.slice(-4);

  if (!open) {
    return (
      <div className="fixed mobile-compare-basket right-3 z-30 sm:bottom-3 sm:left-3 sm:right-auto">
        <button
          type="button"
          className="hidden max-w-72 items-center gap-2 rounded-lg border border-border/80 bg-surface-floating p-2 text-left shadow-[var(--shadow-panel)] backdrop-blur-xl sm:flex"
          aria-label="展开对比"
          onClick={() => onOpenChange(true)}
        >
          <div className="flex shrink-0 items-center pl-2">
            {previewItems.map((item, index) => (
              <div
                key={`compare-preview-${item.key}`}
                className={`size-9 overflow-hidden rounded-md border border-background bg-muted shadow-sm ${index === 0 ? "" : "-ml-2"}`}
              >
                {item.cover ? (
                  <LazyImage alt={item.title} className="size-full object-cover" src={buildProxyImageUrl(item.cover)} />
                ) : (
                  <ArrowLeftRightIcon aria-hidden="true" className="m-2 size-5 text-muted-foreground" />
                )}
              </div>
            ))}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-foreground">对比 {items.length}/{MAX_COMPARE_ITEMS}</div>
            <div className="truncate text-xs text-muted-foreground">{compareBasketTitleSummary || latestItem.title}</div>
          </div>
        </button>
        <Button
          type="button"
          variant="compare"
          size="icon-lg"
          className="relative shadow-[var(--shadow-panel)] sm:hidden"
          aria-label="展开对比"
          onClick={() => onOpenChange(true)}
        >
          <ArrowLeftRightIcon aria-hidden="true" className="size-4" />
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-primary px-1.5 py-0.5 text-center text-[0.58rem] font-semibold leading-none text-primary-foreground tabular-nums">
            {items.length}
          </span>
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed mobile-compare-basket right-3 z-30 w-[min(60vw,18rem)] sm:bottom-3 sm:left-3 sm:right-auto sm:w-80">
      <div className="grid gap-2 rounded-lg border border-border/80 bg-surface-floating p-2 shadow-[var(--shadow-panel)] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 truncate text-sm font-semibold text-foreground">对比 {items.length}/{MAX_COMPARE_ITEMS}</div>
          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" size="icon-xs" variant="ghost" aria-label="清空对比" title="清空" onClick={onClear}>
              <Trash2Icon />
            </Button>
            <Button
              type="button"
              size="xs"
              variant="compare"
              data-touch="compact"
              onClick={onOpenCompare}
              className="relative overflow-visible text-sm! after:absolute after:inset-x-0 after:-inset-y-2 after:rounded-md after:content-['']"
            >
              <ArrowLeftRightIcon data-icon="inline-start" />
              对比
            </Button>
            <Button type="button" size="icon-xs" variant="ghost" aria-label="收起对比" title="收起" onClick={() => onOpenChange(false)}>
              <ChevronDownIcon />
            </Button>
          </div>
        </div>
        <div className="grid max-h-[13.5rem] overflow-y-auto gap-1.5 pr-0.5">
          {items.map((item) => (
            <div key={`basket-row-${item.key}`} className="flex min-w-0 items-center gap-2 rounded-md bg-muted/45 p-1.5">
              <div className="size-12 shrink-0 overflow-hidden rounded-md border border-border/70 bg-muted">
              {item.cover ? (
                <LazyImage alt={item.title} className="size-full object-cover" src={buildProxyImageUrl(item.cover)} />
              ) : null}
              </div>
              <div className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{item.title}</div>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label={`移出${item.title}`}
                title={`移出${item.title}`}
                onClick={() => onRemoveItem(item.key)}
              >
                <XIcon />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

