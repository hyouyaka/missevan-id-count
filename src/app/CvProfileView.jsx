import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  CalendarDaysIcon,
  ChevronDownIcon,
  ImageIcon,
  MicIcon,
  RefreshCwIcon,
  SearchIcon,
  UsersIcon,
} from "lucide-react";

import {
  buildVersionedUrl,
  formatCompactMetricValue,
  getBackendVersionFromResponse,
  getInlineTaggedTitleDisplayText,
} from "@/app/app-utils";
import {
  PlatformDramaLink,
  PlatformGlyph,
} from "@/app/platformTabLabel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { LazyImage } from "@/components/ui/lazy-image";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const INITIAL_RENDER_COUNT = 24;
const PROGRESSIVE_RENDER_THRESHOLD = 50;
const WORK_CATEGORY_LABELS = {
  radio_drama: "广播剧",
  audio_drama: "有声剧",
};
const WORK_CATEGORY_VARIANTS = {
  radio_drama: "radioDrama",
  audio_drama: "audioDrama",
};
const COMPACT_BADGE_CLASS_NAME = "h-[1.05rem] px-1.5 text-[0.6rem] leading-none";
const UNKNOWN_RELEASE_KEY = "unknown";
const NO_PARTNER_KEY = "__none__";

function formatPlayback(value) {
  return Number.isFinite(value) ? formatCompactMetricValue(value) : "暂无数据";
}

function buildProxyImageUrl(url) {
  const normalized = String(url ?? "").trim();
  return normalized ? `/image-proxy?url=${encodeURIComponent(normalized)}` : "";
}

function ResilientImage({
  alt,
  src,
  className,
  fallback,
  loading = "lazy",
}) {
  const normalizedSrc = buildProxyImageUrl(src);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [normalizedSrc]);

  if (!normalizedSrc || failed) {
    return fallback;
  }
  return (
    <LazyImage
      alt={alt}
      className={className}
      loading={loading}
      src={normalizedSrc}
      onError={() => setFailed(true)}
    />
  );
}

function CvAvatar({ name, avatar }) {
  return (
    <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/80 bg-muted/55 sm:size-24">
      <ResilientImage
        alt={`${name}头像`}
        className="size-full object-cover"
        loading="eager"
        src={avatar}
        fallback={<MicIcon aria-hidden="true" className="size-8 text-muted-foreground sm:size-9" />}
      />
    </div>
  );
}

function PlatformStatCard({ platform, stats }) {
  const label = platform === "manbo" ? "漫播" : "猫耳";
  const dateText = stats?.dataUpdatedAt ? stats.dataUpdatedAt : "暂无数据";
  return (
    <article
      aria-label={`${label}平台数据`}
      className="grid grid-cols-[3.25rem_minmax(3.75rem,0.75fr)_1px_minmax(6.5rem,1.25fr)] items-center gap-x-2 gap-y-2 rounded-xl border border-border/80 bg-background px-3 py-4 shadow-xs sm:gap-x-3 sm:px-4"
    >
      <div className="row-span-2 flex size-12 items-center justify-center rounded-xl bg-muted/55">
        <PlatformGlyph platform={platform} className="size-7" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">作品总数</div>
        <strong className="mt-1 block text-xl font-semibold tabular-nums">
          {Number(stats?.workCount ?? 0) || 0}
        </strong>
      </div>
      <div aria-hidden="true" className="h-10 w-px bg-border" />
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">总播放量</div>
        <strong className="mt-1 block whitespace-nowrap text-[clamp(0.875rem,4.4vw,1.25rem)] leading-tight font-semibold tabular-nums">
          {formatPlayback(stats?.playback)}
        </strong>
      </div>
      <time className="col-start-2 col-span-3 text-xs text-muted-foreground">
        播放量更新 {dateText}
      </time>
    </article>
  );
}

function CvProfileSkeleton() {
  return (
    <div aria-label="正在加载 CV 主页" className="grid animate-pulse gap-4 sm:gap-5">
      <Card>
        <CardHeader className="gap-5">
          <div className="h-8 w-28 rounded-md bg-muted" />
          <div className="grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)]">
            <div className="flex items-center gap-3 lg:flex-col lg:items-start">
              <div className="size-20 rounded-full bg-muted sm:size-24" />
              <div className="h-8 w-32 rounded-md bg-muted" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="h-28 rounded-xl bg-muted" />
              <div className="h-28 rounded-xl bg-muted" />
            </div>
          </div>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <div className="h-8 w-full max-w-xl rounded-md bg-muted" />
        </CardHeader>
        <CardContent className="grid md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-32 border-b border-border/75 bg-muted/45" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function WorkCover({ work }) {
  return (
    <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/75 bg-muted/55 sm:size-24">
      <ResilientImage
        alt={`${work.title}封面`}
        className="size-full object-cover"
        src={work.cover}
        fallback={<ImageIcon aria-hidden="true" className="size-6 text-muted-foreground" />}
      />
    </div>
  );
}

function WorkRow({ work, frontendVersion, onOpenSearchResult }) {
  const platformLabel = work.platform === "manbo" ? "漫播" : "猫耳";
  const categoryLabel = WORK_CATEGORY_LABELS[work.category] || "";
  const partnersText = work.partners?.length ? work.partners.join("、") : "—";
  const mobileDisplayTitle = getInlineTaggedTitleDisplayText(work.title, {
    hasTags: Boolean(categoryLabel),
    viewport: "mobile",
  });
  const desktopDisplayTitle = getInlineTaggedTitleDisplayText(work.title, {
    hasTags: Boolean(categoryLabel),
    viewport: "desktop",
  });
  const categoryBadge = categoryLabel ? (
    <Badge
      variant={WORK_CATEGORY_VARIANTS[work.category]}
      className={`${COMPACT_BADGE_CLASS_NAME} ml-1 inline-flex shrink-0 align-[0.12em]`}
    >
      {categoryLabel}
    </Badge>
  ) : null;
  function openSearchResult() {
    onOpenSearchResult?.({
      platform: work.platform,
      id: work.id,
      titles: [work.title],
      name: work.title,
      paymentLabel: work.needpay ? "付费" : "免费",
      contentTypeLabel: categoryLabel,
      usageAction: "cv_profile_open_search_result",
      usageSource: "cv_profile",
    });
  }
  return (
    <article className="relative grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] gap-3 py-4 sm:grid-cols-[6rem_minmax(0,1fr)] sm:gap-4">
      <WorkCover work={work} />
      <div className="flex min-w-0 flex-col pr-10">
        {onOpenSearchResult ? (
          <button
            type="button"
            className="min-w-0 break-words rounded-sm text-left text-base! font-semibold! leading-5! text-foreground underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label={work.title}
            title={work.title}
            onClick={openSearchResult}
          >
            <span className="sm:hidden">{mobileDisplayTitle}</span>
            <span className="hidden sm:inline">{desktopDisplayTitle}</span>
            {categoryBadge}
          </button>
        ) : (
          <h4 className="min-w-0 break-words text-base! font-semibold! leading-5!" title={work.title}>
            <span className="sm:hidden">{mobileDisplayTitle}</span>
            <span className="hidden sm:inline">{desktopDisplayTitle}</span>
            {categoryBadge}
          </h4>
        )}
        <div className="mt-2">
          <PlatformDramaLink
            platform={work.platform}
            dramaId={work.id}
            idLabel="作品ID"
            source="cv_profile"
            dramaTitle={work.title}
            frontendVersion={frontendVersion}
            className="my-0 py-0"
          />
        </div>
        <div
          className="mt-2 flex min-w-0 items-start gap-1.5 text-xs text-muted-foreground"
          title={`时间：${work.createTime || "暂无"}`}
        >
          <CalendarDaysIcon
            aria-label="时间"
            className="size-3.5 shrink-0"
            title="时间"
          />
          <span className="min-w-0 break-words">{work.createTime || "暂无"}</span>
        </div>
        <div
          className="mt-2 flex min-w-0 items-start gap-1.5 whitespace-normal text-xs text-muted-foreground"
          title={`搭档：${partnersText}`}
        >
          <UsersIcon
            aria-label="搭档"
            className="size-3.5 shrink-0"
            title="搭档"
          />
          <span className="min-w-0 break-words">{partnersText}</span>
        </div>
        <strong className="mt-auto self-end pt-3 text-base font-semibold whitespace-nowrap tabular-nums">
          {formatPlayback(work.playCount)}
        </strong>
      </div>
      <span
        aria-label={`${platformLabel}平台`}
        className="absolute top-3.5 right-2 inline-flex"
        role="img"
      >
        <PlatformGlyph platform={work.platform} className="size-5" />
      </span>
    </article>
  );
}

function decodeFilterSelection(value, keys) {
  if (value === "all") {
    return new Set(keys);
  }
  if (keys.includes(value)) {
    return new Set([value]);
  }
  return new Set();
}

function encodeFilterSelection(selection, keys) {
  if (keys.every((key) => selection.has(key))) {
    return "all";
  }
  return keys.find((key) => selection.has(key)) || "none";
}

function getReleaseYear(createTime) {
  return String(createTime || "").match(/(?:19|20)\d{2}/)?.[0] || UNKNOWN_RELEASE_KEY;
}

function getWorkPartnerKeys(work) {
  const partners = [...new Set(
    (Array.isArray(work?.partners) ? work.partners : [])
      .map((name) => String(name || "").trim())
      .filter(Boolean)
  )];
  return partners.length ? partners : [NO_PARTNER_KEY];
}

function matchesWorkSelections(work, selections, omittedGroup = "") {
  if (
    omittedGroup !== "platform" &&
    !selections.platform.has(work.platform)
  ) {
    return false;
  }
  if (
    omittedGroup !== "payment" &&
    !selections.payment.has(work.needpay ? "paid" : "free")
  ) {
    return false;
  }
  if (
    omittedGroup !== "release" &&
    !selections.release.has(getReleaseYear(work.createTime))
  ) {
    return false;
  }
  return omittedGroup === "partners" ||
    getWorkPartnerKeys(work).some((name) => selections.partners.has(name));
}

function decodeReleaseSelection(value, keys) {
  if (value === "all") {
    return new Set(keys);
  }
  if (!value || value === "none") {
    return new Set();
  }
  const available = new Set(keys);
  return new Set(String(value).split(",").filter((key) => available.has(key)));
}

function encodeReleaseSelection(selection, keys) {
  if (keys.every((key) => selection.has(key))) {
    return "all";
  }
  if (!selection.size) {
    return "none";
  }
  return keys.filter((key) => selection.has(key)).join(",");
}

function decodePartnerSelection(value, keys) {
  if (value === "all") {
    return new Set(keys);
  }
  if (!value || value === "none") {
    return new Set();
  }
  try {
    const available = new Set(keys);
    const parsed = JSON.parse(value);
    return new Set(
      (Array.isArray(parsed) ? parsed : []).filter((key) => available.has(key))
    );
  } catch {
    return new Set(keys);
  }
}

function encodePartnerSelection(selection, keys) {
  if (keys.every((key) => selection.has(key))) {
    return "all";
  }
  if (!selection.size) {
    return "none";
  }
  return JSON.stringify(
    [...selection].sort((left, right) => left.localeCompare(right, "zh-Hans-CN"))
  );
}

function selectionsEqual(left, right) {
  return left.size === right.size && [...left].every((key) => right.has(key));
}

function MultiSelectFilter({
  label,
  options,
  selection,
  onCommit,
  searchable = false,
}) {
  const baseId = useId();
  const selectionKey = [...selection].sort().join("\u0000");
  const [open, setOpen] = useState(false);
  const [draftSelection, setDraftSelection] = useState(() => new Set(selection));
  const [query, setQuery] = useState("");

  useEffect(() => {
    setOpen(false);
    setDraftSelection(new Set(selection));
    setQuery("");
  }, [selection, selectionKey]);

  const normalizedQuery = query.trim().toLocaleLowerCase("zh-Hans-CN");
  const visibleOptions = normalizedQuery
    ? options.filter((option) =>
        option.label.toLocaleLowerCase("zh-Hans-CN").includes(normalizedQuery)
      )
    : options;
  const selectedCount = selection.size;
  const summary = options.length === 0
    ? "无选项"
    : selectedCount === options.length
      ? "全部"
      : selectedCount === 0
        ? "未选择"
        : `${selectedCount}/${options.length}`;

  function commitDraftSelection() {
    if (!selectionsEqual(draftSelection, selection)) {
      onCommit(new Set(draftSelection));
    }
  }

  function handleOpenChange(nextOpen) {
    if (nextOpen) {
      setDraftSelection(new Set(selection));
      setQuery("");
      setOpen(true);
      return;
    }
    setOpen(false);
    setQuery("");
    commitDraftSelection();
  }

  function applyDraftSelection() {
    setOpen(false);
    setQuery("");
    commitDraftSelection();
  }

  function toggleOption(key, checked) {
    setDraftSelection((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-touch="compact"
          className="h-8 min-h-8 w-full justify-between rounded-full px-3 text-sm! leading-none sm:w-auto sm:min-w-28"
          aria-label={`${label}筛选，${summary}`}
        >
          <span className="truncate">{label} · {summary}</span>
          <ChevronDownIcon data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(20rem,calc(100vw-2rem))] gap-2 p-3"
        aria-label={`${label}筛选选项`}
        onOpenAutoFocus={searchable
          ? (event) => event.preventDefault()
          : undefined}
      >
        {searchable ? (
          <div className="relative">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={query}
              className="h-8 pl-8"
              placeholder="搜索搭档"
              aria-label="搜索搭档"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        ) : null}
        <div className="max-h-64 overflow-y-auto overscroll-contain py-1">
          {visibleOptions.length ? (
            <div className="flex flex-col gap-1">
              {visibleOptions.map((option) => {
                const optionId = `${baseId}-${option.key}`;
                return (
                  <label
                    key={option.key}
                    htmlFor={optionId}
                    className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
                  >
                    <Checkbox
                      id={optionId}
                      aria-label={option.label}
                      checked={draftSelection.has(option.key)}
                      onCheckedChange={(checked) => toggleOption(option.key, checked === true)}
                    />
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {option.count}
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <div className="px-2 py-6 text-center text-sm text-muted-foreground">
              未找到匹配的搭档
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t pt-2">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-touch="compact"
              className="h-7 min-h-7 rounded-full px-2.5"
              onClick={() => setDraftSelection(new Set(options.map((option) => option.key)))}
            >
              全选
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-touch="compact"
              className="h-7 min-h-7 rounded-full px-2.5"
              onClick={() => setDraftSelection(new Set())}
            >
              清空
            </Button>
          </div>
          <Button
            type="button"
            variant="default"
            size="sm"
            data-touch="compact"
            className="h-7 min-h-7 rounded-full px-3"
            onClick={applyDraftSelection}
          >
            应用
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function WorksToolbar({
  groups,
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
      {groups.map((group) => (
        <MultiSelectFilter
          key={group.key}
          label={group.label}
          options={group.options}
          selection={group.selection}
          onCommit={group.onCommit}
          searchable={group.searchable}
        />
      ))}
    </div>
  );
}

export function CvProfileView({
  cvName,
  profileId = "",
  frontendVersion,
  handleVersionResponse,
  onBack,
  platformFilter = "all",
  paymentFilter = "all",
  releaseFilter = "all",
  partnersFilter = "all",
  onRouteStateChange,
  onOpenSearchResult,
}) {
  const [requestRevision, setRequestRevision] = useState(0);
  const [state, setState] = useState({
    status: "loading",
    data: null,
    error: "",
  });
  const [visibleCount, setVisibleCount] = useState(INITIAL_RENDER_COUNT);
  const handleVersionResponseRef = useRef(handleVersionResponse);

  useEffect(() => {
    handleVersionResponseRef.current = handleVersionResponse;
  }, [handleVersionResponse]);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading", data: null, error: "" });
    const profileQuery = new URLSearchParams({ name: cvName || "" });
    if (profileId) {
      profileQuery.set("profileId", profileId);
    }
    fetch(
      buildVersionedUrl(
        `/cv-profile?${profileQuery.toString()}`,
        frontendVersion
      ),
      { signal: controller.signal, cache: "no-store" }
    )
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        handleVersionResponseRef.current?.({
          frontendVersion,
          backendVersion: getBackendVersionFromResponse(response, data),
        });
        if (!response.ok || !data?.success) {
          throw new Error(data?.message || "CV 主页加载失败");
        }
        return data;
      })
      .then((data) => setState({ status: "ready", data, error: "" }))
      .catch((error) => {
        if (error?.name !== "AbortError") {
          setState({
            status: "error",
            data: null,
            error: error?.message || "CV 主页加载失败",
          });
        }
      });
    return () => controller.abort();
  }, [cvName, frontendVersion, profileId, requestRevision]);

  useEffect(() => {
    setVisibleCount(INITIAL_RENDER_COUNT);
  }, [partnersFilter, paymentFilter, platformFilter, releaseFilter]);

  const works = useMemo(
    () => Array.isArray(state.data?.works) ? state.data.works : [],
    [state.data]
  );
  const filterOptions = useMemo(() => {
    const platformCounts = { missevan: 0, manbo: 0 };
    const paymentCounts = { paid: 0, free: 0 };
    const releaseCounts = new Map();
    const partnerCounts = new Map();

    works.forEach((work) => {
      const platform = work.platform === "manbo" ? "manbo" : "missevan";
      const payment = work.needpay === true ? "paid" : "free";
      const release = getReleaseYear(work.createTime);
      platformCounts[platform] += 1;
      paymentCounts[payment] += 1;
      releaseCounts.set(release, (releaseCounts.get(release) || 0) + 1);

      const partners = [...new Set(
        (Array.isArray(work.partners) ? work.partners : [])
          .map((name) => String(name || "").trim())
          .filter(Boolean)
      )];
      if (!partners.length) {
        partnerCounts.set(NO_PARTNER_KEY, (partnerCounts.get(NO_PARTNER_KEY) || 0) + 1);
      } else {
        partners.forEach((name) => {
          partnerCounts.set(name, (partnerCounts.get(name) || 0) + 1);
        });
      }
    });

    const releaseKeys = [...releaseCounts.keys()].sort((left, right) => {
      if (left === UNKNOWN_RELEASE_KEY) {
        return 1;
      }
      if (right === UNKNOWN_RELEASE_KEY) {
        return -1;
      }
      return Number(right) - Number(left);
    });
    const partnerKeys = [...partnerCounts.keys()].sort((left, right) => {
      if (left === NO_PARTNER_KEY) {
        return 1;
      }
      if (right === NO_PARTNER_KEY) {
        return -1;
      }
      return (partnerCounts.get(right) || 0) - (partnerCounts.get(left) || 0) ||
        left.localeCompare(right, "zh-Hans-CN");
    });

    return {
      platform: [
        { key: "missevan", label: "猫耳", count: platformCounts.missevan },
        { key: "manbo", label: "漫播", count: platformCounts.manbo },
      ],
      payment: [
        { key: "paid", label: "付费", count: paymentCounts.paid },
        { key: "free", label: "免费", count: paymentCounts.free },
      ],
      release: releaseKeys.map((key) => ({
        key,
        label: key === UNKNOWN_RELEASE_KEY ? "暂无" : key,
        count: releaseCounts.get(key) || 0,
      })),
      partners: partnerKeys.map((key) => ({
        key,
        label: key === NO_PARTNER_KEY ? "无搭档" : key,
        count: partnerCounts.get(key) || 0,
      })),
    };
  }, [works]);

  const platformKeys = useMemo(
    () => filterOptions.platform.map((option) => option.key),
    [filterOptions.platform]
  );
  const paymentKeys = useMemo(
    () => filterOptions.payment.map((option) => option.key),
    [filterOptions.payment]
  );
  const releaseKeys = useMemo(
    () => filterOptions.release.map((option) => option.key),
    [filterOptions.release]
  );
  const partnerKeys = useMemo(
    () => filterOptions.partners.map((option) => option.key),
    [filterOptions.partners]
  );
  const platformSelection = useMemo(
    () => decodeFilterSelection(platformFilter, platformKeys),
    [platformFilter, platformKeys]
  );
  const paymentSelection = useMemo(
    () => decodeFilterSelection(paymentFilter, paymentKeys),
    [paymentFilter, paymentKeys]
  );
  const releaseSelection = useMemo(
    () => decodeReleaseSelection(releaseFilter, releaseKeys),
    [releaseFilter, releaseKeys]
  );
  const partnerSelection = useMemo(
    () => decodePartnerSelection(partnersFilter, partnerKeys),
    [partnerKeys, partnersFilter]
  );
  const appliedSelections = useMemo(() => ({
    platform: platformSelection,
    payment: paymentSelection,
    release: releaseSelection,
    partners: partnerSelection,
  }), [
    partnerSelection,
    paymentSelection,
    platformSelection,
    releaseSelection,
  ]);

  const facetedOptions = useMemo(() => {
    const counts = Object.fromEntries(
      Object.entries(filterOptions).map(([group, options]) => [
        group,
        new Map(options.map((option) => [option.key, 0])),
      ])
    );
    function increment(group, key) {
      const groupCounts = counts[group];
      if (groupCounts.has(key)) {
        groupCounts.set(key, groupCounts.get(key) + 1);
      }
    }

    works.forEach((work) => {
      if (matchesWorkSelections(work, appliedSelections, "platform")) {
        increment("platform", work.platform);
      }
      if (matchesWorkSelections(work, appliedSelections, "payment")) {
        increment("payment", work.needpay ? "paid" : "free");
      }
      if (matchesWorkSelections(work, appliedSelections, "release")) {
        increment("release", getReleaseYear(work.createTime));
      }
      if (matchesWorkSelections(work, appliedSelections, "partners")) {
        getWorkPartnerKeys(work).forEach((name) => increment("partners", name));
      }
    });

    return Object.fromEntries(
      Object.entries(filterOptions).map(([group, options]) => [
        group,
        options.map((option) => ({
          ...option,
          count: counts[group].get(option.key) || 0,
        })),
      ])
    );
  }, [appliedSelections, filterOptions, works]);

  const filteredWorks = useMemo(() => {
    const filtered = works.filter((work) =>
      matchesWorkSelections(work, appliedSelections)
    );
    return filtered.sort((left, right) => {
      const leftMissing = !Number.isFinite(left.playCount);
      const rightMissing = !Number.isFinite(right.playCount);
      if (leftMissing !== rightMissing) {
        return leftMissing ? 1 : -1;
      }
      return Number(right.playCount ?? 0) - Number(left.playCount ?? 0) ||
        String(left.title).localeCompare(String(right.title), "zh-Hans-CN");
    });
  }, [
    appliedSelections,
    works,
  ]);

  if (state.status === "loading") {
    return <CvProfileSkeleton />;
  }

  if (state.status === "error") {
    return (
      <Card>
        <CardContent className="flex min-h-56 flex-col items-center justify-center gap-3 text-center">
          <div className="font-semibold">CV 数据加载失败</div>
          <div className="text-sm text-muted-foreground">{state.error}</div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onBack}>
              <ArrowLeftIcon data-icon="inline-start" />
              返回搜索
            </Button>
            <Button onClick={() => setRequestRevision((value) => value + 1)}>
              <RefreshCwIcon data-icon="inline-start" />
              重新加载
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const data = state.data;
  const fallbackStats = {
    missevan: {
      workCount: works.filter((work) => work.platform === "missevan").length,
      playback: data?.totals?.missevanPlayback,
      dataUpdatedAt: data?.freshness?.missevan?.latestDate || "",
    },
    manbo: {
      workCount: works.filter((work) => work.platform === "manbo").length,
      playback: data?.totals?.manboPlayback,
      dataUpdatedAt: data?.freshness?.manbo?.latestDate || "",
    },
  };
  const sourceStats = {
    missevan: data?.stats?.missevan || fallbackStats.missevan,
    manbo: data?.stats?.manbo || fallbackStats.manbo,
  };
  const stats = Object.fromEntries(
    ["missevan", "manbo"].map((platform) => {
      const platformWorks = filteredWorks.filter((work) => work.platform === platform);
      const playbackValues = platformWorks
        .map((work) => work.playCount)
        .filter(Number.isFinite);
      return [
        platform,
        {
          workCount: platformWorks.length,
          playback: playbackValues.length
            ? playbackValues.reduce((sum, value) => sum + value, 0)
            : null,
          dataUpdatedAt: sourceStats[platform]?.dataUpdatedAt || "",
        },
      ];
    })
  );
  const renderedWorks = filteredWorks.length > PROGRESSIVE_RENDER_THRESHOLD
    ? filteredWorks.slice(0, visibleCount)
    : filteredWorks;
  const hasMore = renderedWorks.length < filteredWorks.length;
  const emptyLabel = works.length ? "当前筛选下暂无作品" : "暂无作品数据";

  function commitPlatform(selection) {
    setVisibleCount(INITIAL_RENDER_COUNT);
    onRouteStateChange?.({
      platform: encodeFilterSelection(selection, platformKeys),
    });
  }

  function commitPayment(selection) {
    setVisibleCount(INITIAL_RENDER_COUNT);
    onRouteStateChange?.({
      payment: encodeFilterSelection(selection, paymentKeys),
    });
  }

  function commitRelease(selection) {
    setVisibleCount(INITIAL_RENDER_COUNT);
    onRouteStateChange?.({
      release: encodeReleaseSelection(selection, releaseKeys),
    });
  }

  function commitPartners(selection) {
    setVisibleCount(INITIAL_RENDER_COUNT);
    onRouteStateChange?.({
      partners: encodePartnerSelection(selection, partnerKeys),
    });
  }

  function resetFilters() {
    setVisibleCount(INITIAL_RENDER_COUNT);
    onRouteStateChange?.({
      platform: "all",
      payment: "all",
      release: "all",
      partners: "all",
    });
  }

  const filterGroups = [
    {
      key: "platform",
      label: "平台",
      options: facetedOptions.platform,
      selection: platformSelection,
      onCommit: commitPlatform,
    },
    {
      key: "payment",
      label: "付费",
      options: facetedOptions.payment,
      selection: paymentSelection,
      onCommit: commitPayment,
    },
    {
      key: "release",
      label: "时间",
      options: facetedOptions.release,
      selection: releaseSelection,
      onCommit: commitRelease,
    },
    {
      key: "partners",
      label: "搭档",
      options: facetedOptions.partners,
      selection: partnerSelection,
      onCommit: commitPartners,
      searchable: true,
    },
  ];

  return (
    <div className="grid gap-4 sm:gap-5">
      <Card>
        <CardHeader className="gap-5">
          <div className="grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-center lg:gap-6">
            <div className="flex min-w-0 items-center gap-4 lg:flex-col lg:items-center">
              <CvAvatar name={data.cv?.name || cvName} avatar={data.cv?.avatar} />
              <h2 className="min-w-0 truncate text-2xl font-semibold tracking-tight sm:text-3xl lg:text-center">
                {data.cv?.name}
              </h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <PlatformStatCard platform="missevan" stats={stats.missevan} />
              <PlatformStatCard platform="manbo" stats={stats.manbo} />
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card className="py-0">
        <CardHeader className="border-b py-4">
          <WorksToolbar
            groups={filterGroups}
          />
        </CardHeader>
        <CardContent className="p-4">
          {renderedWorks.length ? (
            <div className="cv-profile-work-grid grid md:grid-cols-2 xl:grid-cols-3">
              {renderedWorks.map((work) => (
                <WorkRow
                  key={`${work.platform}:${work.id}`}
                  work={work}
                  frontendVersion={frontendVersion}
                  onOpenSearchResult={onOpenSearchResult}
                />
              ))}
            </div>
          ) : (
            <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-center">
              <div className="font-medium">{emptyLabel}</div>
              {works.length && (
                platformFilter !== "all" ||
                paymentFilter !== "all" ||
                releaseFilter !== "all" ||
                partnersFilter !== "all"
              ) ? (
                <Button variant="outline" onClick={resetFilters}>
                  恢复全部筛选
                </Button>
              ) : null}
            </div>
          )}
          {hasMore ? (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                data-touch="compact"
                className="h-8 min-h-8 rounded-full px-4 text-sm! leading-none"
                onClick={() => setVisibleCount((count) => count + INITIAL_RENDER_COUNT)}
              >
                加载更多
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
