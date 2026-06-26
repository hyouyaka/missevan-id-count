import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClockIcon,
  ChevronRightIcon,
  MicIcon,
  PlayCircleIcon,
  RefreshCwIcon,
  SignalHighIcon,
} from "lucide-react";

import { formatPlainNumber, getBackendVersionFromResponse } from "@/app/app-utils";
import { fetchOngoingData, getCachedOngoingData } from "@/app/ongoingData";
import { PlatformTabLabel } from "@/app/platformTabLabel";
import { RankBadge } from "@/app/RankBadge";
import { fetchRanksData, getCachedRanksData } from "@/app/ranksData";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LazyImage } from "@/components/ui/lazy-image";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { sortOngoingItemsByWindowDelta } from "../../shared/ongoingUtils.js";

const platformMeta = {
  missevan: { label: "猫耳" },
  manbo: { label: "漫播" },
};

const HOME_RANK_CONFIG = {
  missevan: [
    { title: "猫耳新品日榜", displayTitle: "新品日榜", categoryKey: "new", rankKey: "new_daily" },
    { title: "猫耳人气周榜", displayTitle: "人气周榜", categoryKey: "popular", rankKey: "popular_weekly" },
    { title: "猫耳畅销周榜", displayTitle: "畅销周榜", categoryKey: "bestseller", rankKey: "bestseller_weekly" },
    { title: "猫耳巅峰榜", displayTitle: "巅峰榜", categoryKey: "peak", rankKey: "peak" },
    { title: "猫耳CV榜总榜", displayTitle: "CV总榜", categoryKey: "cv", rankKey: "cv", itemType: "cv" },
  ],
  manbo: [
    { title: "漫播热播榜", displayTitle: "热播榜", categoryKey: "hot", rankKey: "hot" },
    { title: "漫播票房总榜", displayTitle: "票房总榜", categoryKey: "box_office", rankKey: "box_office_total" },
    { title: "漫播钻石榜", displayTitle: "钻石榜", categoryKey: "diamond", rankKey: "diamond_monthly" },
    { title: "漫播巅峰榜", displayTitle: "巅峰榜", categoryKey: "peak", rankKey: "peak" },
    { title: "漫播CV总榜", displayTitle: "CV总榜", categoryKey: "cv", rankKey: "cv", itemType: "cv" },
  ],
};

const homeTextTabsListClassName =
  "inline-flex h-8 min-h-8 w-fit justify-start rounded-none border-0! bg-transparent! p-0 shadow-none!";
const homeTextTabClassName =
  "h-8 min-h-8 min-w-0 rounded-none border-0! bg-transparent! px-2 text-sm! font-medium text-muted-foreground shadow-none! hover:bg-transparent hover:text-primary data-[state=active]:border-transparent data-[state=active]:bg-transparent data-[state=active]:font-bold data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=active]:[&_.platform-tab-label-text]:font-bold data-[state=active]:[text-shadow:0_1px_6px_color-mix(in_srgb,var(--primary)_28%,transparent)] data-active:border-transparent data-active:bg-transparent data-active:font-bold data-active:text-primary data-active:shadow-none data-active:[&_.platform-tab-label-text]:font-bold data-active:[text-shadow:0_1px_6px_color-mix(in_srgb,var(--primary)_28%,transparent)] after:hidden";
const homeSelectedTextTabClassName =
  "font-bold! text-primary! [text-shadow:0_1px_6px_color-mix(in_srgb,var(--primary)_28%,transparent)] [&_.platform-tab-label-text]:font-bold!";

function buildProxyImageUrl(url) {
  return url ? `/image-proxy?url=${encodeURIComponent(url)}` : "";
}

function formatHomeDate(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "未知";
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return normalized.slice(0, 10) || "未知";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .replaceAll("/", "-");
}

function formatCompactCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count)) {
    return "暂无";
  }
  if (Math.abs(count) >= 10000) {
    const wan = count / 10000;
    return `${wan.toFixed(Math.abs(wan) >= 1000 ? 0 : 1)}万`;
  }
  return formatPlainNumber(count);
}

function formatDelta(value) {
  const delta = Number(value);
  if (!Number.isFinite(delta)) {
    return "暂无";
  }
  return `${delta > 0 ? "+" : ""}${formatCompactCount(delta)}`;
}

function getMainCvText(item) {
  return String(item?.main_cv_text ?? "").replace(/^主要CV：/, "").trim() || "暂无";
}

function getSevenDayViewDelta(item) {
  const metric = item?.windows?.["7d"]?.metrics?.view_count;
  return metric?.available === false ? null : metric?.delta ?? null;
}

function getViewCountValue(item) {
  return item?.metrics?.view_count?.value ?? item?.view_count ?? item?.viewCount ?? null;
}

function getPlatformRanks(data, platform) {
  return data?.platforms?.[platform]?.categories || [];
}

function getRankByConfig(data, platform, rankConfig) {
  const category = getPlatformRanks(data, platform).find((item) => item?.key === rankConfig.categoryKey);
  return (category?.ranks || []).find((rank) => rank?.key === rankConfig.rankKey) || null;
}

function getSettledPayload(result) {
  return result?.status === "fulfilled" ? result.value : null;
}

function logRejectedHomePayload(label, result) {
  if (result?.status === "rejected") {
    console.error(`Failed to load home ${label}`, result.reason);
  }
}

function SectionHeader({ title, sectionIcon: SectionIcon }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {SectionIcon ? <SectionIcon aria-hidden="true" className="size-5 shrink-0 text-primary" /> : null}
      <h2 className="min-w-0 text-xl leading-7 font-semibold tracking-tight">{title}</h2>
    </div>
  );
}

function PlatformTabs({ value, onValueChange, ariaLabel, counts = null }) {
  return (
    <Tabs value={value} onValueChange={onValueChange} className="shrink-0 gap-0">
      <TabsList aria-label={ariaLabel} variant="line" className={`${homeTextTabsListClassName} grid-cols-2 gap-3`}>
        {["missevan", "manbo"].map((platform) => (
          <TabsTrigger
            key={platform}
            data-touch="compact"
            className={`${homeTextTabClassName} ${platform === value ? homeSelectedTextTabClassName : ""}`}
            value={platform}
          >
            <PlatformTabLabel platform={platform} />
            {counts ? <span className="ml-0.5 tabular-nums">{counts[platform] ?? 0}</span> : null}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

function HomeTextLink({ children, ariaLabel, onClick }) {
  return (
    <Button
      type="button"
      variant="link"
      className="mx-auto h-8 px-2 text-sm! font-semibold"
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {children}
      <ChevronRightIcon aria-hidden="true" data-icon="inline-end" />
    </Button>
  );
}

function OngoingMiniItem({ item, platform, onOpenSearchResult }) {
  const coverUrl = buildProxyImageUrl(item?.cover);
  const delta = getSevenDayViewDelta(item);

  function openSearchResult() {
    if (!platform || !item?.id) {
      return;
    }
    onOpenSearchResult?.({
      platform,
      id: item.id,
      titles: [item.name],
      name: item.name,
      paymentLabel: item.payment_label,
      contentTypeLabel: item.content_type_label,
      usageAction: "ongoing_open_search_result",
    });
  }

  return (
    <div className="grid min-w-0 grid-cols-[4.25rem_minmax(0,1fr)] gap-3 rounded-md p-2 transition-colors hover:bg-muted/45">
      <div className="size-[4.25rem] overflow-hidden rounded-md border border-border/70 bg-muted/55">
        {coverUrl ? (
          <LazyImage alt={item?.name || "剧集封面"} className="size-full object-cover" src={coverUrl} />
        ) : (
          <div className="flex size-full items-center justify-center text-xs text-muted-foreground">暂无封面</div>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <button
          type="button"
          className="line-clamp-1 rounded-sm text-left text-sm font-semibold! leading-5 text-foreground underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:text-base"
          title={item?.name || "未命名剧集"}
          onClick={openSearchResult}
        >
          {item?.name || "未命名剧集"}
        </button>
        <div className="flex min-w-0 items-start gap-1.5 text-xs leading-5 text-muted-foreground">
          <MicIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span className="line-clamp-1 min-w-0">{getMainCvText(item)}</span>
        </div>
        <div className="grid min-w-0 grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)] gap-2 text-xs leading-5 text-muted-foreground">
          <span className="inline-flex min-w-0 items-center gap-1">
            <RefreshCwIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{formatHomeDate(item?.updated_at)}</span>
          </span>
          <span className="inline-flex min-w-0 items-center gap-1">
            <PlayCircleIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate tabular-nums">
              {formatCompactCount(getViewCountValue(item))}
              <span className="text-[rgb(20,137,111)]">（{formatDelta(delta)}）</span>
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

function OngoingPlatformList({ platform, items, totalCount, onNavigateRoute, onOpenSearchResult }) {
  return (
    <Card className="w-full min-w-[min(370px,100%)] border-border/75 bg-card/96 py-0 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.22)]">
      <CardContent className="flex min-w-0 flex-col gap-2 p-3 sm:p-4">
        <div className="flex items-center gap-2 px-1 text-sm font-semibold text-primary">
          <PlatformTabLabel platform={platform} />
          <span className="tabular-nums">{totalCount}</span>
        </div>
        <div className="grid gap-1">
          {items.length ? (
            items.map((item) => (
              <OngoingMiniItem
                key={`${platform}-${item.id}`}
                item={item}
                platform={platform}
                onOpenSearchResult={onOpenSearchResult}
              />
            ))
          ) : (
            <div className="rounded-md border border-dashed border-border/75 px-4 py-8 text-center text-sm text-muted-foreground">
              暂无更新数据
            </div>
          )}
        </div>
        <HomeTextLink
          ariaLabel={`查看更多${platformMeta[platform].label}一周内更新`}
          onClick={() => onNavigateRoute({
            view: "ongoing",
            platform,
            window: "7d",
          })}
        >
          查看更多
        </HomeTextLink>
      </CardContent>
    </Card>
  );
}

function RankDramaItem({ item, platform, onOpenSearchResult }) {
  const coverUrl = buildProxyImageUrl(item?.cover);
  const isMissevanPeak = platform === "missevan" && item?.type === "peak";
  const searchDramaIds = isMissevanPeak
    ? (Array.isArray(item.drama_ids) ? item.drama_ids : [])
    : item?.id != null
      ? [item.id]
      : [];

  function openSearchResult() {
    if (!platform || !searchDramaIds.length) {
      return;
    }
    onOpenSearchResult?.({
      platform,
      id: searchDramaIds[0],
      ids: searchDramaIds,
      titles: searchDramaIds.map(() => item.name),
      name: item.name,
      paymentLabel: item?.payment_label || item?.paymentLabel || item?.payStatus || "",
      contentTypeLabel: item?.content_type_label || item?.contentTypeLabel || "",
      usageAction: "ranks_open_search_result",
    });
  }

  return (
    <div className="grid min-w-0 grid-cols-[auto_3.5rem_minmax(0,1fr)] items-center gap-2">
      <RankBadge rank={item?.rank} className="size-6 text-[0.68rem]" />
      <div className="size-14 overflow-hidden rounded-md border border-border/70 bg-muted/55">
        {coverUrl ? (
          <LazyImage alt={item?.name || "剧集封面"} className="size-full object-cover" src={coverUrl} />
        ) : (
          <div className="flex size-full items-center justify-center text-[0.62rem] text-muted-foreground">暂无</div>
        )}
      </div>
      <div className="min-w-0">
        {searchDramaIds.length ? (
          <button
            type="button"
            className="line-clamp-1 rounded-sm text-left text-sm font-semibold! leading-5 text-foreground underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            title={item?.name || "未命名剧集"}
            onClick={openSearchResult}
          >
            {item?.name || "未命名剧集"}
          </button>
        ) : (
          <div className="line-clamp-1 text-sm font-semibold leading-5 text-foreground">{item?.name || "未命名剧集"}</div>
        )}
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs leading-5 text-muted-foreground">
          <MicIcon aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate">{getMainCvText(item)}</span>
        </div>
      </div>
    </div>
  );
}

function RankCvItem({ item }) {
  const avatarUrl = buildProxyImageUrl(item?.avatar);
  return (
    <div className="grid min-w-0 grid-cols-[auto_3.5rem_minmax(0,1fr)] items-center gap-2">
      <RankBadge rank={item?.rank} className="size-6 text-[0.68rem]" />
      <div className="size-14 overflow-hidden rounded-full border border-border/70 bg-muted/55">
        {avatarUrl ? (
          <LazyImage alt={item?.cvName || "CV头像"} className="size-full object-cover" src={avatarUrl} />
        ) : (
          <div className="flex size-full items-center justify-center text-xs font-semibold text-muted-foreground">CV</div>
        )}
      </div>
      <div className="min-w-0">
        <div className="line-clamp-1 text-sm font-semibold leading-5 text-foreground">{item?.cvName || "未命名CV"}</div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs leading-5 text-muted-foreground">
          <PlayCircleIcon aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate tabular-nums">{formatCompactCount(item?.totalViewCount)}</span>
        </div>
      </div>
    </div>
  );
}

function HomeRankCard({ platform, rankConfig, rank, onNavigateRoute, onOpenSearchResult }) {
  const items = (rank?.items || []).slice(0, 3);
  const isCvRank = rankConfig.itemType === "cv";
  return (
    <Card className="w-[320px] min-w-0 border-border/75 bg-card/96 py-0 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.22)]">
      <CardContent className="flex min-h-[17rem] flex-col gap-3 p-4">
        <h3 className="line-clamp-1 text-base font-semibold leading-6 text-primary">{rankConfig.displayTitle || rankConfig.title}</h3>
        <div className="grid flex-1 gap-3">
          {items.length ? (
            items.map((item) =>
              isCvRank ? (
                <RankCvItem key={`${rankConfig.rankKey}-${item.rank}-${item.cvName}`} item={item} />
              ) : (
                <RankDramaItem
                  key={`${rankConfig.rankKey}-${item.rank}-${item.id || item.name}`}
                  item={item}
                  platform={platform}
                  onOpenSearchResult={onOpenSearchResult}
                />
              )
            )
          ) : (
            <div className="rounded-md border border-dashed border-border/75 px-4 py-8 text-center text-sm text-muted-foreground">
              暂无榜单数据
            </div>
          )}
        </div>
        <HomeTextLink
          ariaLabel={`查看更多${rankConfig.title}`}
          onClick={() => onNavigateRoute({
            view: "ranks",
            platform,
            category: rankConfig.categoryKey,
            rank: rankConfig.rankKey,
          })}
        >
          查看更多
        </HomeTextLink>
      </CardContent>
    </Card>
  );
}

export function HomeView({ frontendVersion = "0.0.0", handleVersionResponse, onNavigateRoute, onOpenSearchResult }) {
  const handleVersionResponseRef = useRef(handleVersionResponse);
  const [selectedRankPlatform, setSelectedRankPlatform] = useState("missevan");
  const [ongoingByPlatform, setOngoingByPlatform] = useState({ missevan: null, manbo: null });
  const [rankData, setRankData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    handleVersionResponseRef.current = handleVersionResponse;
  }, [handleVersionResponse]);

  useEffect(() => {
    let cancelled = false;

    async function loadHomeData() {
      const cachedMissevan = getCachedOngoingData({ platform: "missevan", frontendVersion });
      const cachedManbo = getCachedOngoingData({ platform: "manbo", frontendVersion });
      const cachedRanks = getCachedRanksData(frontendVersion);
      if (cachedMissevan?.data?.success || cachedManbo?.data?.success || cachedRanks?.data?.success) {
        setOngoingByPlatform({
          missevan: cachedMissevan?.data || null,
          manbo: cachedManbo?.data || null,
        });
        setRankData(cachedRanks?.data || null);
      }
      setIsLoading(!(cachedMissevan || cachedManbo || cachedRanks));
      setErrorMessage("");

      try {
        const [missevanOngoingResult, manboOngoingResult, ranksResult] = await Promise.allSettled([
          fetchOngoingData({ platform: "missevan", frontendVersion, revalidate: true }),
          fetchOngoingData({ platform: "manbo", frontendVersion, revalidate: true }),
          fetchRanksData(frontendVersion, { revalidate: true }),
        ]);
        logRejectedHomePayload("missevan ongoing", missevanOngoingResult);
        logRejectedHomePayload("manbo ongoing", manboOngoingResult);
        logRejectedHomePayload("ranks", ranksResult);

        const missevanOngoing = getSettledPayload(missevanOngoingResult);
        const manboOngoing = getSettledPayload(manboOngoingResult);
        const ranks = getSettledPayload(ranksResult);

        [missevanOngoing, manboOngoing, ranks].filter(Boolean).forEach((payload) => {
          handleVersionResponseRef.current?.({
            ...payload.data,
            backendVersion: getBackendVersionFromResponse(payload.response, payload.data),
            frontendVersion,
          });
        });
        if (cancelled) {
          return;
        }
        const nextOngoingByPlatform = {
          missevan: missevanOngoing?.response?.ok && missevanOngoing?.data?.success
            ? missevanOngoing.data
            : cachedMissevan?.data?.success
              ? cachedMissevan.data
              : null,
          manbo: manboOngoing?.response?.ok && manboOngoing?.data?.success
            ? manboOngoing.data
            : cachedManbo?.data?.success
              ? cachedManbo.data
              : null,
        };
        const nextRankData = ranks?.response?.ok && ranks?.data?.success ? ranks.data : cachedRanks?.data?.success ? cachedRanks.data : null;
        setOngoingByPlatform(nextOngoingByPlatform);
        setRankData(nextRankData);
        if (!nextOngoingByPlatform.missevan && !nextOngoingByPlatform.manbo && !nextRankData) {
          setErrorMessage("首页数据暂不可用，请稍后重试。");
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load home data", error);
          if (!cachedMissevan?.data?.success && !cachedManbo?.data?.success && !cachedRanks?.data?.success) {
            setErrorMessage("首页数据暂不可用，请稍后重试。");
          }
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadHomeData();
    return () => {
      cancelled = true;
    };
  }, [frontendVersion]);

  const ongoingItems = useMemo(() => {
    return {
      missevan: sortOngoingItemsByWindowDelta(ongoingByPlatform.missevan?.items || [], "7d").slice(0, 3),
      manbo: sortOngoingItemsByWindowDelta(ongoingByPlatform.manbo?.items || [], "7d").slice(0, 3),
    };
  }, [ongoingByPlatform.missevan?.items, ongoingByPlatform.manbo?.items]);

  const ongoingCounts = useMemo(() => ({
    missevan: ongoingByPlatform.missevan?.items?.length || 0,
    manbo: ongoingByPlatform.manbo?.items?.length || 0,
  }), [ongoingByPlatform.missevan?.items, ongoingByPlatform.manbo?.items]);

  const activeRankConfigs = HOME_RANK_CONFIG[selectedRankPlatform] || [];

  return (
    <div className="grid gap-4 sm:gap-5">
      {isLoading ? (
        <Alert>
          <RefreshCwIcon className="size-4 animate-spin" />
          <AlertTitle>正在读取首页</AlertTitle>
          <AlertDescription>正在读取一周内更新和榜单数据。</AlertDescription>
        </Alert>
      ) : null}

      {!isLoading && errorMessage ? (
        <Alert className="border-destructive/30 bg-destructive/10">
          <AlertTitle>首页暂不可用</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      <section className="min-w-0 max-w-full overflow-hidden rounded-lg border border-border/75 bg-background/76 p-3 shadow-[0_20px_46px_-38px_rgba(15,23,42,0.26)] sm:p-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <SectionHeader title="一周内更新" sectionIcon={CalendarClockIcon} />
        </div>

        <div className="min-w-0 max-w-full overflow-x-auto overflow-y-hidden overscroll-x-contain pb-1 [scrollbar-width:thin]">
          <div className="grid w-max min-w-full auto-cols-[minmax(min(370px,100%),1fr)] grid-flow-col gap-3 sm:auto-cols-auto sm:grid-cols-[repeat(2,minmax(370px,1fr))]">
            <OngoingPlatformList
              platform="missevan"
              items={ongoingItems.missevan}
              totalCount={ongoingCounts.missevan}
              onNavigateRoute={onNavigateRoute}
              onOpenSearchResult={onOpenSearchResult}
            />
            <OngoingPlatformList
              platform="manbo"
              items={ongoingItems.manbo}
              totalCount={ongoingCounts.manbo}
              onNavigateRoute={onNavigateRoute}
              onOpenSearchResult={onOpenSearchResult}
            />
          </div>
        </div>
      </section>

      <section className="min-w-0 max-w-full overflow-hidden rounded-lg border border-border/75 bg-background/76 p-3 shadow-[0_20px_46px_-38px_rgba(15,23,42,0.26)] sm:p-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <SectionHeader title="榜单" sectionIcon={SignalHighIcon} />
          <PlatformTabs value={selectedRankPlatform} onValueChange={setSelectedRankPlatform} ariaLabel="选择榜单平台" />
        </div>
        <div className="min-w-0 max-w-full overflow-x-auto overflow-y-hidden overscroll-x-contain pb-2 [scrollbar-width:thin]">
          <div className="grid w-max min-w-full auto-cols-[320px] grid-flow-col gap-3">
            {activeRankConfigs.map((rankConfig) => (
              <div key={`${selectedRankPlatform}-${rankConfig.categoryKey}-${rankConfig.rankKey}`} className="w-[320px] min-w-0 scroll-ml-1 snap-start">
                <HomeRankCard
                  platform={selectedRankPlatform}
                  rankConfig={rankConfig}
                  rank={getRankByConfig(rankData, selectedRankPlatform, rankConfig)}
                  onNavigateRoute={onNavigateRoute}
                  onOpenSearchResult={onOpenSearchResult}
                />
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
