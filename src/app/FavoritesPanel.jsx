import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownUpIcon,
  BeanIcon,
  CheckIcon,
  ChevronDownIcon,
  CoinsIcon,
  DownloadIcon,
  FileDownIcon,
  SlidersHorizontalIcon,
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
  formatCompactMetricValue,
  getMissevanAccessDeniedMessage,
  getRemainingCooldownMinutes,
  formatPlainNumber,
  formatSignedCompactMetricValue,
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
  getLatestMetricReading,
  getLatestSnapshot,
  importFavoritesData,
  listSnapshots,
  loadFavoriteSettings,
  normalizeFavoriteSettings,
  saveFavoriteSettings,
  serializeFavoritesHistoryCsv,
  sortFavoritesWithSnapshots,
  updateFavoriteIfExists,
} from "@/app/favoritesStorage";
import { PlatformGlyph, PlatformIdIcon } from "@/app/platformTabLabel";
import { FavoriteHistoryDetails } from "@/app/FavoriteHistory";
import { fetchFavoriteMainCvText } from "@/app/favoritesRefreshService";
import { useFavoriteRefresh } from "@/app/useFavoriteRefresh";
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

  const { refreshMany } = useFavoriteRefresh({
    frontendVersion,
    getAccessDeniedText: getFavoriteAccessDeniedText,
    handleVersionResponse,
    isDesktopApp,
    onBackgroundTaskChange,
    onClearSelection: () => setSelectedKeys(new Set()),
    onFavoritesChange,
    onRefreshSettled,
    onRefreshStateChange,
    onReloadSnapshots: reloadSnapshots,
    renderAccessDeniedMessage: renderFavoriteAccessDeniedMessage,
    statisticsActionsDisabled,
  });

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
          className="grid overflow-visible"
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
                <SlidersHorizontalIcon aria-hidden="true" className="size-4 shrink-0" />
              </MobileToolbarButton>
            </div>
          </div>
          <div
            className="favorite-mobile-toolbar-secondary grid h-11 min-w-0 items-center gap-0"
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
                          <div
                            className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
                            aria-label={`作品ID：${favorite.dramaId}`}
                            title={`作品ID：${favorite.dramaId}`}
                          >
                            <PlatformIdIcon aria-hidden="true" className="size-3.5 shrink-0" platform={favorite.platform} tone="inherit" />
                            <span className="min-w-0 break-all">{favorite.dramaId}</span>
                          </div>
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
                        <FavoriteHistoryDetails
                          favorite={favorite}
                          snapshots={snapshots}
                          deltaMetric={settings.deltaMetric}
                          expanded={expanded}
                          onToggle={() => toggleExpanded(favorite.key)}
                          formatDeltaValue={formatDeltaValue}
                          formatMetricValue={formatMetricValue}
                          metricLabels={metricLabels}
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
