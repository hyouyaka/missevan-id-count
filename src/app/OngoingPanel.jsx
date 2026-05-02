import { useEffect, useMemo, useRef, useState } from "react";
import {
  HashIcon,
  HeartIcon,
  MicIcon,
  PlayCircleIcon,
  RefreshCwIcon,
  ShoppingCartIcon,
  UsersRoundIcon,
} from "lucide-react";

import {
  buildVersionedUrl,
  formatPlainNumber,
  getBackendVersionFromResponse,
} from "@/app/app-utils";
import { PlatformTabLabel } from "@/app/platformTabLabel";
import { RankBadge } from "@/app/RankBadge";
import {
  fetchRankTrendData,
  logRankTrendOpen,
  RankTrendButton,
  RankTrendDialog,
} from "@/app/rankTrendUi";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  isOngoingEmptyPaidDanmakuMetric,
  sortOngoingItemsByWindowDelta,
} from "../../shared/ongoingUtils.js";

const ongoingClientCache = new Map();
const ONGOING_CLIENT_SCHEMA_VERSION = 3;

const platformLabels = {
  missevan: "猫耳",
  manbo: "漫播",
};

const mobileMenuTabsListClassName =
  "grid w-full justify-stretch rounded-none border-0! bg-transparent! shadow-none!";

const tagVariants = {
  猫耳: "missevanPlatform",
  漫播: "manboPlatform",
  免费: "free",
  会员: "member",
  付费: "paid",
  广播剧: "radioDrama",
  有声剧: "audioDrama",
  有声漫: "audioComic",
};

const metricIconMap = {
  播放量: PlayCircleIcon,
  付费ID数: UsersRoundIcon,
  追剧人数: HeartIcon,
  "付费/收听人数": ShoppingCartIcon,
};

const coverPaymentBadgeClassName =
  "absolute bottom-0 right-0 h-4 rounded-none rounded-tl-[calc(var(--radius)-0.18rem)] border-0! px-1 text-[0.54rem] leading-none shadow-none! lg:h-[1.05rem] lg:px-1.5 lg:text-[0.58rem]";

function buildProxyImageUrl(url) {
  return url ? `/image-proxy?url=${encodeURIComponent(url)}` : "";
}

function formatOngoingDate(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "未知";
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return normalized.slice(0, 10) || "未知";
  }

  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(date)
    .reduce((map, part) => {
      map[part.type] = part.value;
      return map;
    }, {});

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatOngoingUpdatedAt(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "未知";
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return normalized;
  }

  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .formatToParts(date)
    .reduce((map, part) => {
      map[part.type] = part.value;
      return map;
    }, {});

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function formatWanNumber(value, options = {}) {
  const { forceWanDecimal = false } = options;
  const count = Number(value);
  if (!Number.isFinite(count)) {
    return "暂无";
  }
  if (Math.abs(count) >= 10000) {
    const wan = count / 10000;
    const digits = forceWanDecimal ? 1 : Math.abs(wan) >= 1000 ? 0 : 1;
    return `${wan.toFixed(digits)}万`;
  }
  return formatPlainNumber(count);
}

function formatDelta(value, options = {}) {
  const delta = Number(value);
  if (!Number.isFinite(delta)) {
    return "暂无";
  }
  const prefix = delta > 0 ? "+" : "";
  return `${prefix}${formatWanNumber(delta, options)}`;
}

function getMetricValue(item, metricKey) {
  return item?.metrics?.[metricKey]?.value ?? null;
}

function getMetricDelta(item, windowKey, metricKey) {
  return item?.windows?.[windowKey]?.metrics?.[metricKey]?.delta ?? null;
}

async function fetchOngoingData({ platform, frontendVersion }) {
  const normalizedVersion = String(frontendVersion ?? "").trim();
  const cacheKey = `${ONGOING_CLIENT_SCHEMA_VERSION}:${normalizedVersion}:${platform}`;
  const cached = ongoingClientCache.get(cacheKey);
  if (cached?.promise) {
    return cached.promise;
  }

  const params = new URLSearchParams({
    platform,
    schema: String(ONGOING_CLIENT_SCHEMA_VERSION),
    _: String(Date.now()),
  });
  const promise = (async () => {
    try {
      const response = await fetch(buildVersionedUrl(`/ongoing?${params.toString()}`, frontendVersion), {
        cache: "no-store",
      });
      const data = await response.json();
      return { response, data };
    } finally {
      const current = ongoingClientCache.get(cacheKey);
      if (current?.promise === promise) {
        ongoingClientCache.delete(cacheKey);
      }
    }
  })();

  ongoingClientCache.set(cacheKey, { promise });
  return promise;
}

function MetricIcon({ label }) {
  const Icon = metricIconMap[label] || PlayCircleIcon;
  return <Icon aria-hidden="true" className="size-3.5 text-muted-foreground" />;
}

function OngoingMetric({ item, windowKey, metricKey }) {
  const metric = item?.metrics?.[metricKey] || item?.windows?.[windowKey]?.metrics?.[metricKey];
  const windowMetric = item?.windows?.[windowKey]?.metrics?.[metricKey];
  const delta = getMetricDelta(item, windowKey, metricKey);
  const showEmptyPaidDanmaku = isOngoingEmptyPaidDanmakuMetric(windowMetric);
  const showMissingDelta = !showEmptyPaidDanmaku && (windowMetric?.available === false || windowMetric?.delta == null);
  const numberOptions = metricKey === "view_count" ? { forceWanDecimal: true } : {};
  return (
    <div className="min-w-0 border-l border-border/70 px-2 text-center first:border-l-0 sm:px-3">
      <div className="flex min-w-0 items-center justify-center gap-1 text-[0.68rem] text-muted-foreground">
        <MetricIcon label={metric?.label} />
        <span className="truncate">{metric?.label || "指标"}</span>
      </div>
      <div className={`mt-1 text-[0.92rem] leading-5 tabular-nums text-foreground ${showEmptyPaidDanmaku ? "font-normal" : "font-semibold"}`}>
        {showEmptyPaidDanmaku ? "暂无付费集" : formatWanNumber(getMetricValue(item, metricKey), numberOptions)}
      </div>
      <div className="text-[0.74rem] font-medium leading-5 tabular-nums text-[rgb(20,137,111)]">
        {showEmptyPaidDanmaku ? "\u00a0" : showMissingDelta ? "暂无" : formatDelta(delta, numberOptions)}
      </div>
    </div>
  );
}

function OngoingCard({ item, rank, windowKey, platform, frontendVersion = "0.0.0", handleVersionResponse, onOpenSearchResult }) {
  const coverUrl = buildProxyImageUrl(item.cover);
  const baseMetricKeys = platform === "missevan"
    ? ["view_count", "subscription_num", "danmaku_uid_count"]
    : ["view_count", "pay_count", "danmaku_uid_count"];
  const metricKeys = baseMetricKeys.filter((metricKey) => item?.metrics?.[metricKey]?.visible !== false);
  const titleTags = [item.content_type_label].filter(Boolean);
  const paymentTag = item.payment_label;
  const metricGridClassName = metricKeys.length >= 3 ? "grid-cols-3" : "grid-cols-2";
  const canOpenTrend = Boolean(platform && item?.id);
  const [isTrendOpen, setIsTrendOpen] = useState(false);
  const [trendState, setTrendState] = useState({
    isLoading: false,
    error: "",
    data: null,
  });

  async function openTrendDialog() {
    if (!canOpenTrend || isTrendOpen) {
      return;
    }
    setIsTrendOpen(true);
    logRankTrendOpen({
      platform,
      id: item.id,
      name: item.name,
      source: "ongoing",
      rankKey: "ongoing",
      frontendVersion,
    });
    setTrendState((current) => ({
      ...current,
      isLoading: !current.data,
      error: "",
    }));
    try {
      const { response, data } = await fetchRankTrendData({
        platform,
        id: item.id,
        frontendVersion,
      });
      handleVersionResponse?.({
        ...data,
        backendVersion: getBackendVersionFromResponse(response, data),
        frontendVersion,
      });
      if (!response.ok || !data?.success) {
        setTrendState({
          isLoading: false,
          error: data?.message || "趋势数据暂不可用。",
          data: null,
        });
        return;
      }
      setTrendState({
        isLoading: false,
        error: "",
        data,
      });
    } catch (error) {
      console.error("Failed to load ongoing rank trend", error);
      setTrendState({
        isLoading: false,
        error: "趋势数据暂不可用。",
        data: null,
      });
    }
  }

  function openSearchResult() {
    if (!platform || !item?.id) {
      return;
    }
    onOpenSearchResult?.({
      platform,
      id: item.id,
      name: item.name,
      paymentLabel: item.payment_label,
      contentTypeLabel: item.content_type_label,
      usageAction: "ongoing_open_search_result",
    });
  }

  return (
    <>
      <Card
        className="overflow-hidden border-border/75 bg-card py-0 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.22)] transition-shadow hover:shadow-[0_22px_48px_-34px_rgba(15,23,42,0.34)]"
      >
        <CardContent className="p-0">
          <div className="flex h-[9.5rem] gap-3 overflow-hidden p-3.5 sm:h-[10.25rem]">
            <RankBadge rank={rank} />
            <div className="flex w-[5.35rem] shrink-0 flex-col items-center gap-1.5 sm:w-24">
              <div className="relative size-[5.35rem] overflow-hidden rounded-md border border-border/70 bg-muted/50 sm:size-24">
                {coverUrl ? (
                  <img alt={item.name} className="size-full object-cover" src={coverUrl} />
                ) : (
                  <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
                    暂无封面
                  </div>
                )}
                {paymentTag ? (
                  <Badge variant={tagVariants[paymentTag] || "outline"} className={coverPaymentBadgeClassName}>
                    {paymentTag}
                  </Badge>
                ) : null}
              </div>
              {canOpenTrend ? (
                <RankTrendButton
                  onClick={openTrendDialog}
                  aria-label={`查看${item.name}趋势`}
                  title="查看趋势"
                />
              ) : null}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  className="line-clamp-2 min-w-0 break-words rounded-sm text-left text-lg! font-semibold! leading-6! text-foreground underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  onClick={openSearchResult}
                >
                  {item.name || "未命名剧集"}
                </button>
                {titleTags.map((label) => (
                  <Badge
                    key={`${item.id}-${label}`}
                    variant={tagVariants[label] || "outline"}
                    className="h-[1.05rem] px-1.5 text-[0.6rem] leading-none"
                  >
                    {label}
                  </Badge>
                ))}
              </div>
              <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <HashIcon aria-label="作品ID" className="size-3.5 shrink-0" />
                <span className="min-w-0 break-all">{item.id}</span>
              </div>
              <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <MicIcon aria-label="主要CV" className="size-3.5 shrink-0" />
                <span className="line-clamp-2 min-w-0 break-words">{String(item.main_cv_text || "").replace(/^主要CV：/, "") || "暂无"}</span>
              </div>
              <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <RefreshCwIcon aria-label="最近更新" className="size-3.5 shrink-0" />
                <span className="min-w-0 break-all">{formatOngoingDate(item.updated_at)}</span>
              </div>
            </div>
          </div>
          <div className={`grid ${metricGridClassName} border-t border-border/70 bg-background/54 py-2`}>
            {metricKeys.map((metricKey) => (
              <OngoingMetric key={metricKey} item={item} metricKey={metricKey} windowKey={windowKey} />
            ))}
          </div>
        </CardContent>
      </Card>
      {canOpenTrend ? (
        <RankTrendDialog
          open={isTrendOpen}
          onOpenChange={setIsTrendOpen}
          item={item}
          platform={platform}
          trendState={trendState}
        />
      ) : null}
    </>
  );
}

export function OngoingPanel({ frontendVersion = "0.0.0", handleVersionResponse, onOpenSearchResult }) {
  const [selectedPlatform, setSelectedPlatform] = useState("missevan");
  const [selectedWindow, setSelectedWindow] = useState("3d");
  const [ongoingData, setOngoingData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const loggedOngoingRef = useRef(new Set());

  useEffect(() => {
    let cancelled = false;

    async function loadOngoing() {
      setIsLoading(true);
      setErrorMessage("");
      try {
        const { response, data } = await fetchOngoingData({
          platform: selectedPlatform,
          frontendVersion,
        });
        handleVersionResponse?.({
          ...data,
          backendVersion: getBackendVersionFromResponse(response, data),
          frontendVersion,
        });
        if (cancelled) {
          return;
        }
        if (!response.ok || !data?.success) {
          setOngoingData(null);
          setErrorMessage("连载中数据暂不可用，请稍后重试。");
          return;
        }
        setOngoingData(data);
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load ongoing dramas", error);
          setOngoingData(null);
          setErrorMessage("连载中数据暂不可用，请稍后重试。");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadOngoing();
    return () => {
      cancelled = true;
    };
  }, [frontendVersion, selectedPlatform]);

  useEffect(() => {
    if (isLoading || errorMessage || !ongoingData?.success) {
      return;
    }

    const logKey = selectedPlatform;
    if (loggedOngoingRef.current.has(logKey)) {
      return;
    }
    loggedOngoingRef.current.add(logKey);

    const platformLabel = platformLabels[selectedPlatform] || selectedPlatform;
    fetch(buildVersionedUrl("/usage-log", frontendVersion), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: selectedPlatform,
        action: "ongoing",
        keyword: `${platformLabel}一周内更新`,
        success: true,
      }),
    }).catch((error) => {
      console.error("Failed to log ongoing view", error);
    });
  }, [errorMessage, frontendVersion, isLoading, ongoingData?.success, selectedPlatform]);

  const windows = ongoingData?.windows || {};
  const availableWindows = ["3d", "7d", "30d"].filter((key) => windows[key]);
  const activeWindow = availableWindows.includes(selectedWindow)
    ? selectedWindow
    : availableWindows[0] || "7d";
  const sortedItems = useMemo(
    () => sortOngoingItemsByWindowDelta(ongoingData?.items || [], activeWindow),
    [activeWindow, ongoingData?.items]
  );
  const platformLabel = platformLabels[selectedPlatform] || selectedPlatform;

  return (
    <div className="grid gap-4 sm:gap-5">
      <div className="px-1 py-1">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-base font-normal leading-6 tracking-tight">
              {platformLabel}一周内更新：共{sortedItems.length}部
            </h1>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              数据更新：{formatOngoingUpdatedAt(ongoingData?.updatedAt)}
            </div>
          </div>
          <div className="grid gap-0 overflow-hidden rounded-lg border border-border/80 bg-card/80 shadow-sm sm:hidden">
            <div className="flex h-10 items-center gap-1.5 px-1.5">
              <Tabs value={selectedPlatform} onValueChange={setSelectedPlatform} className="min-w-0 flex-[1.35] gap-0">
                <TabsList aria-label="选择平台" className={`${mobileMenuTabsListClassName} grid-cols-2`}>
                  {["missevan", "manbo"].map((platform) => (
                    <TabsTrigger key={platform} className="min-w-0 px-1.5" value={platform}>
                      <PlatformTabLabel platform={platform} />
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <div className="h-6 w-px shrink-0 bg-border/80" />
              <Tabs value={activeWindow} onValueChange={setSelectedWindow} className="min-w-0 flex-[0.85] gap-0">
                <TabsList aria-label="选择增量周期" className={`${mobileMenuTabsListClassName} grid-cols-3`}>
                  {["3d", "7d", "30d"].map((key) => (
                    <TabsTrigger key={key} className="min-w-0 px-1 text-[12px]! leading-none" value={key}>
                      {{ "3d": "3日", "7d": "7日", "30d": "30日" }[key]}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          </div>
          <div className="hidden flex-col gap-1 sm:flex sm:flex-row sm:items-center sm:justify-end lg:flex-row">
            <Tabs value={selectedPlatform} onValueChange={setSelectedPlatform}>
              <TabsList aria-label="选择平台" className="grid w-full grid-cols-2 sm:w-fit">
                {["missevan", "manbo"].map((platform) => (
                  <TabsTrigger key={platform} className="px-4" value={platform}>
                    <PlatformTabLabel platform={platform} />
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Tabs value={activeWindow} onValueChange={setSelectedWindow}>
              <TabsList aria-label="选择增量周期" className="grid w-full grid-cols-3 sm:w-fit">
                {["3d", "7d", "30d"].map((key) => (
                  <TabsTrigger key={key} className="px-3" value={key}>
                    {{ "3d": "3日", "7d": "7日", "30d": "30日" }[key]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </div>
      </div>

      {isLoading ? (
        <Alert>
          <RefreshCwIcon className="size-4 animate-spin" />
          <AlertTitle>正在读取连载中</AlertTitle>
          <AlertDescription>正在读取连载剧集数据。</AlertDescription>
        </Alert>
      ) : null}

      {!isLoading && errorMessage ? (
        <Alert className="border-destructive/30 bg-destructive/10">
          <AlertTitle>连载中暂不可用</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {!isLoading && !errorMessage && !sortedItems.length ? (
        <div className="rounded-lg border border-dashed border-border/80 bg-muted/30 px-6 py-10 text-center">
          <div className="text-base font-semibold">还没有连载中数据</div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">请稍后重试。</p>
        </div>
      ) : null}

      {!isLoading && !errorMessage && sortedItems.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sortedItems.map((item, index) => (
            <OngoingCard
              key={`${selectedPlatform}-${item.id}`}
              item={item}
              platform={selectedPlatform}
              rank={index + 1}
              windowKey={activeWindow}
              frontendVersion={frontendVersion}
              handleVersionResponse={handleVersionResponse}
              onOpenSearchResult={onOpenSearchResult}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
