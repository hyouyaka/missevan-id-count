import { useEffect, useMemo, useState } from "react";
import {
  BeanIcon,
  CoinsIcon,
  GemIcon,
  HeartIcon,
  PlayCircleIcon,
  RefreshCwIcon,
  ShoppingCartIcon,
  StarIcon,
  TrophyIcon,
} from "lucide-react";

import { buildVersionedUrl, formatPlainNumber, getBackendVersionFromResponse } from "@/app/app-utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

function buildProxyImageUrl(url) {
  return url ? `/image-proxy?url=${encodeURIComponent(url)}` : "";
}

const RANKS_CLIENT_CACHE_TTL_MS = 30 * 60 * 1000;
const ranksClientCache = {
  data: null,
  loadedAt: 0,
  frontendVersion: "",
  promise: null,
};

function formatRankUpdatedAt(value) {
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

function formatRankUpdatedDate(value) {
  const formatted = formatRankUpdatedAt(value);
  return formatted === "未知" ? "" : formatted.slice(0, 10);
}

function getTitleClassName(title) {
  const length = String(title ?? "").trim().length;
  if (length >= 34) {
    return "text-sm font-semibold leading-5 sm:text-[15px]";
  }
  if (length >= 22) {
    return "text-[15px] font-semibold leading-5 sm:text-base";
  }
  return "text-base font-semibold leading-6 sm:text-lg";
}

const metricLegendItems = [
  { label: "播放", icon: PlayCircleIcon },
  { label: "追剧", icon: HeartIcon },
  { label: "收藏", icon: StarIcon },
  { label: "打赏人数", icon: GemIcon },
  { label: "打赏榜总和", icon: CoinsIcon },
  { label: "投喂", icon: BeanIcon },
  { label: "购买人数/收听人数", icon: ShoppingCartIcon },
  { label: "排行值", icon: TrophyIcon },
];

const metricIconMap = {
  总播放量: PlayCircleIcon,
  追剧数: HeartIcon,
  收藏数: StarIcon,
  打赏人数: GemIcon,
  打赏榜总和: CoinsIcon,
  投喂总数: BeanIcon,
  "购买人数/收听人数": ShoppingCartIcon,
  排行值: TrophyIcon,
};

function MetricIcon({ label, className = "size-3.5" }) {
  const Icon = metricIconMap[label] || PlayCircleIcon;
  return <Icon aria-hidden="true" className={className} />;
}

function MetricLegend() {
  return (
    <div
      aria-label="榜单图标图例"
      className="rounded-lg border border-border/75 bg-card/96 px-3 py-2 shadow-[0_18px_38px_-34px_rgba(15,23,42,0.28)]"
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.68rem] leading-5 text-muted-foreground">
        {metricLegendItems.map((item) => {
          const Icon = item.icon;
          return (
            <span key={item.label} className="inline-flex min-w-fit items-center gap-1">
              <Icon aria-hidden="true" className="size-3.5 text-foreground/74" />
              <span>{item.label}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function getRankMetrics(platform, item) {
  const metrics = [
    {
      label: "总播放量",
      value: formatPlainNumber(item.view_count),
    },
  ];

  if (platform === "missevan") {
    if (item.type !== "peak" && item.subscription_num != null) {
      metrics.push({ label: "追剧数", value: formatPlainNumber(item.subscription_num) });
    }
    if (item.type !== "peak" && item.reward_num != null) {
      metrics.push({ label: "打赏人数", value: formatPlainNumber(item.reward_num) });
    }
    if (item.type !== "peak" && item.reward_total != null) {
      metrics.push({ label: "打赏榜总和", value: formatPlainNumber(item.reward_total) });
    }
    return metrics;
  }

  if (item.subscription_num != null) {
    metrics.push({ label: "收藏数", value: formatPlainNumber(item.subscription_num) });
  }
  if (item.diamond_value != null) {
    metrics.push({ label: "投喂总数", value: formatPlainNumber(item.diamond_value) });
  }
  if (Number(item.pay_count) > 0) {
    metrics.push({ label: "购买人数/收听人数", value: formatPlainNumber(item.pay_count) });
  }
  if (item.rank_value != null) {
    metrics.push({
      label: item.rank_value_label || "排行值",
      iconLabel: "排行值",
      value: formatPlainNumber(item.rank_value),
    });
  }
  return metrics;
}

function RankItemCard({ item, platform }) {
  const coverUrl = buildProxyImageUrl(item.cover);
  const metrics = getRankMetrics(platform, item);
  const isMissevanPeak = platform === "missevan" && item.type === "peak";
  const dramaIdText = Array.isArray(item.drama_ids) && item.drama_ids.length ? item.drama_ids.join("，") : "";
  const recentUpdatedDate = isMissevanPeak ? "" : formatRankUpdatedDate(item.updated_at);

  return (
    <Card className="border-border/75 bg-card py-3 shadow-[0_18px_36px_-32px_rgba(15,23,42,0.18)]">
      <CardContent className="px-3.5">
        <div className="flex gap-3">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background text-xs font-semibold tabular-nums text-foreground">
            {item.rank}
          </div>
          <div className="size-[4rem] shrink-0 overflow-hidden rounded-[calc(var(--radius)-0.05rem)] border border-border/70 bg-muted/50">
            {coverUrl ? (
              <img alt={item.name} className="aspect-square size-[4rem] object-cover" src={coverUrl} />
            ) : (
              <div className="flex aspect-square size-[4rem] items-center justify-center text-xs text-muted-foreground">
                暂无封面
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className={`min-w-0 break-words ${getTitleClassName(item.name)}`}>{item.name}</span>
            </div>
            {item.id && !isMissevanPeak ? (
              <div className="mt-1 text-xs text-muted-foreground">
                {platform === "manbo" ? "Drama ID" : "作品 ID"}: {item.id}
              </div>
            ) : null}
            {isMissevanPeak && dramaIdText ? (
              <div className="mt-1 text-xs text-muted-foreground">包含剧集ID：{dramaIdText}</div>
            ) : null}
            {item.main_cv_text ? <div className="mt-1 text-xs text-muted-foreground">{item.main_cv_text}</div> : null}
            {recentUpdatedDate ? (
              <div className="mt-1 text-xs text-muted-foreground">最近更新：{recentUpdatedDate}</div>
            ) : null}
          </div>
        </div>

        {isMissevanPeak ? (
          <div className="mt-3 text-sm font-medium text-foreground">
            系列总播放量：{formatPlainNumber(item.view_count)}
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
            {metrics.map((metric) => (
              <div
                key={`${item.id}-${metric.label}`}
                aria-label={`${metric.label}: ${metric.value}`}
                title={`${metric.label}: ${metric.value}`}
                className="max-w-full text-foreground"
              >
                <span className="flex max-w-full items-center gap-1">
                  <MetricIcon label={metric.iconLabel || metric.label} className="size-3.5 shrink-0 text-muted-foreground" />
                  {metric.iconLabel === "排行值" && metric.label !== "排行值" ? (
                    <span className="shrink-0 text-[0.68rem] text-muted-foreground">{metric.label}</span>
                  ) : null}
                  <span className="max-w-full break-all text-[0.74rem] font-medium tabular-nums sm:text-sm">{metric.value}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RankColumn({ rank, platform }) {
  return (
    <section className="min-w-0 rounded-lg border border-border/80 bg-background/76 p-3 shadow-[0_20px_46px_-38px_rgba(15,23,42,0.26)]">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold leading-6">{rank.name}</h2>
          <div className="text-xs text-muted-foreground">{rank.items.length} 项</div>
        </div>
        {rank.fetchedAt ? <div className="text-xs text-muted-foreground">更新：{formatRankUpdatedAt(rank.fetchedAt)}</div> : null}
      </div>
      {rank.items.length ? (
        <div className="grid gap-3">
          {rank.items.map((item) => (
            <RankItemCard key={`${rank.key}-${item.rank}-${item.id}`} item={item} platform={platform} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border/80 bg-muted/30 px-5 py-8 text-center text-sm text-muted-foreground">
          该榜单暂无数据
        </div>
      )}
    </section>
  );
}

function getPlatformData(data, platform) {
  return data?.platforms?.[platform] || null;
}

function getFirstCategory(platformData) {
  return platformData?.categories?.[0] || null;
}

function getCategory(platformData, categoryKey) {
  return platformData?.categories?.find((category) => category.key === categoryKey) || getFirstCategory(platformData);
}

function getRank(category, rankKey) {
  return category?.ranks?.find((rank) => rank.key === rankKey) || category?.ranks?.[0] || null;
}

async function fetchRanksData(frontendVersion) {
  const normalizedVersion = String(frontendVersion ?? "").trim();
  const now = Date.now();
  if (
    ranksClientCache.data &&
    ranksClientCache.frontendVersion === normalizedVersion &&
    now - ranksClientCache.loadedAt < RANKS_CLIENT_CACHE_TTL_MS
  ) {
    return ranksClientCache.data;
  }

  if (ranksClientCache.promise && ranksClientCache.frontendVersion === normalizedVersion) {
    return ranksClientCache.promise;
  }

  ranksClientCache.frontendVersion = normalizedVersion;
  ranksClientCache.promise = (async () => {
    try {
      const response = await fetch(buildVersionedUrl("/ranks", frontendVersion));
      const data = await response.json();
      const payload = {
        response,
        data,
      };
      if (response.ok && data?.success) {
        ranksClientCache.data = payload;
        ranksClientCache.loadedAt = Date.now();
      }
      return payload;
    } finally {
      ranksClientCache.promise = null;
    }
  })();

  return ranksClientCache.promise;
}

export function RanksPanel({ frontendVersion = "0.0.0", handleVersionResponse }) {
  const [rankData, setRankData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedPlatform, setSelectedPlatform] = useState("missevan");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedRank, setSelectedRank] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadRanks() {
      setIsLoading(true);
      setErrorMessage("");
      try {
        const { response, data } = await fetchRanksData(frontendVersion);
        handleVersionResponse?.({
          ...data,
          backendVersion: getBackendVersionFromResponse(response, data),
          frontendVersion,
        });
        if (cancelled) {
          return;
        }
        if (!response.ok || !data?.success) {
          setRankData(null);
          setErrorMessage("Ranks 暂不可用，请稍后重试。");
          return;
        }
        setRankData(data);
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load ranks", error);
          setRankData(null);
          setErrorMessage("Ranks 暂不可用，请稍后重试。");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadRanks();
    return () => {
      cancelled = true;
    };
  }, [frontendVersion]);

  const platformData = getPlatformData(rankData, selectedPlatform);
  const category = getCategory(platformData, selectedCategory);
  const activeRank = getRank(category, selectedRank);
  const availablePlatforms = useMemo(() => {
    return ["missevan", "manbo"]
      .map((platform) => getPlatformData(rankData, platform))
      .filter((platform) => platform?.categories?.length);
  }, [rankData]);

  useEffect(() => {
    if (!availablePlatforms.length) {
      return;
    }

    if (!availablePlatforms.some((platform) => platform.key === selectedPlatform)) {
      setSelectedPlatform(availablePlatforms[0].key);
    }
  }, [availablePlatforms, selectedPlatform]);

  useEffect(() => {
    if (!platformData?.categories?.length) {
      return;
    }

    const nextCategory = getCategory(platformData, selectedCategory);
    if (nextCategory?.key && nextCategory.key !== selectedCategory) {
      setSelectedCategory(nextCategory.key);
      setSelectedRank(nextCategory.ranks?.[0]?.key || "");
      return;
    }

    const nextRank = getRank(nextCategory, selectedRank);
    if (nextRank?.key && nextRank.key !== selectedRank) {
      setSelectedRank(nextRank.key);
    }
  }, [platformData, selectedCategory, selectedRank]);

  function updatePlatform(platform) {
    const nextPlatform = getPlatformData(rankData, platform);
    const nextCategory = getFirstCategory(nextPlatform);
    setSelectedPlatform(platform);
    setSelectedCategory(nextCategory?.key || "");
    setSelectedRank(nextCategory?.ranks?.[0]?.key || "");
  }

  function updateCategory(categoryKey) {
    const nextCategory = getCategory(platformData, categoryKey);
    setSelectedCategory(nextCategory?.key || "");
    setSelectedRank(nextCategory?.ranks?.[0]?.key || "");
  }

  const hasRanks = availablePlatforms.length > 0;

  return (
    <div className="grid gap-4 sm:gap-5">
      <div className="px-1 text-sm leading-6 text-muted-foreground">
        榜单刷新时间：{formatRankUpdatedAt(rankData?.updatedAt)}
      </div>

      {isLoading ? (
        <Alert>
          <RefreshCwIcon className="size-4 animate-spin" />
          <AlertTitle>正在读取榜单</AlertTitle>
          <AlertDescription>榜单数据加载中。</AlertDescription>
        </Alert>
      ) : null}

      {!isLoading && errorMessage ? (
        <Alert className="border-destructive/30 bg-destructive/10">
          <AlertTitle>Ranks 暂不可用</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {!isLoading && !errorMessage && !hasRanks ? (
        <div className="rounded-lg border border-dashed border-border/80 bg-muted/30 px-6 py-10 text-center">
          <div className="text-base font-semibold">还没有榜单数据</div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">请稍后重试。</p>
        </div>
      ) : null}

      {!isLoading && !errorMessage && hasRanks ? (
        <>
          <div className="grid gap-3">
            <MetricLegend />
            <Tabs value={selectedPlatform} onValueChange={updatePlatform}>
              <TabsList className="inline-flex w-full justify-start overflow-x-auto sm:w-fit">
                {availablePlatforms.map((platform) => (
                  <TabsTrigger key={platform.key} className="px-3" value={platform.key}>
                    {platform.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            {platformData?.categories?.length ? (
              <Tabs value={category?.key || ""} onValueChange={updateCategory}>
                <TabsList className="inline-flex w-full justify-start overflow-x-auto sm:w-fit">
                  {platformData.categories.map((item) => (
                    <TabsTrigger key={item.key} className="px-3" value={item.key}>
                      {item.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            ) : null}
            {category?.ranks?.length > 1 ? (
              <Tabs value={activeRank?.key || ""} onValueChange={setSelectedRank}>
                <TabsList className="inline-flex w-full justify-start overflow-x-auto sm:w-fit lg:hidden">
                  {category.ranks.map((rank) => (
                    <TabsTrigger key={rank.key} className="px-3" value={rank.key}>
                      {rank.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            ) : null}
          </div>

          <div className="hidden gap-3 lg:grid lg:grid-cols-[repeat(auto-fit,minmax(21rem,1fr))]">
            {(category?.ranks || []).map((rank) => (
              <RankColumn key={rank.key} platform={selectedPlatform} rank={rank} />
            ))}
          </div>

          <div className="grid gap-3 lg:hidden">
            {activeRank ? <RankColumn platform={selectedPlatform} rank={activeRank} /> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
