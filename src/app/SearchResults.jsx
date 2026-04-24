import { useState } from "react";
import {
  BeanIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ChevronsDownIcon,
  EraserIcon,
  GemIcon,
  HandCoinsIcon,
  HashIcon,
  HeartIcon,
  ImportIcon,
  ListChecksIcon,
  MicIcon,
  PlayCircleIcon,
  ShoppingCartIcon,
  StarIcon,
  UserSearchIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { formatPlainNumber, selectDramaEpisodesByMode } from "@/app/app-utils";
import { isMemberEpisode, isPaidEpisode } from "@/utils/episodeRules";

function buildProxyImageUrl(url) {
  return url ? `/image-proxy?url=${encodeURIComponent(url)}` : "";
}

function collectSelectedEpisodes(dramas = []) {
  const selectedEpisodes = [];
  dramas.forEach((drama) => {
    const dramaId = String(drama?.drama?.id ?? "").trim();
    const dramaTitle = drama?.drama?.name || "";
    const episodes = Array.isArray(drama?.episodes?.episode) ? drama.episodes.episode : [];
    episodes.forEach((episode) => {
      if (episode.selected) {
        selectedEpisodes.push({
          drama_id: dramaId,
          sound_id: episode.sound_id,
          drama_title: dramaTitle,
          episode_title: episode.name,
          duration: Number(episode.duration ?? 0),
        });
      }
    });
  });
  return selectedEpisodes;
}

const metricLegendItems = [
  { label: "导入分集", icon: ImportIcon },
  { label: "播放", icon: PlayCircleIcon },
  { label: "追剧", icon: HeartIcon },
  { label: "收藏", icon: StarIcon },
  { label: "打赏人数", icon: GemIcon },
  { label: "投喂", icon: BeanIcon },
  { label: "付费/收听", icon: ShoppingCartIcon },
];

const metricIconMap = {
  总播放量: PlayCircleIcon,
  追剧人数: HeartIcon,
  收藏人数: StarIcon,
  收藏数: StarIcon,
  打赏人数: GemIcon,
  投喂总数: BeanIcon,
  付费人数: ShoppingCartIcon,
  收听人数: ShoppingCartIcon,
};

function MetricIcon({ label, className = "size-3.5" }) {
  const Icon = metricIconMap[label] || PlayCircleIcon;
  return <Icon aria-hidden="true" className={className} />;
}

function MetricLegend({ className = "" }) {
  return (
    <div
      className={`rounded-lg border border-border/75 bg-card/96 px-3 py-2 shadow-[0_18px_38px_-34px_rgba(15,23,42,0.28)] ${className}`}
      aria-label="统计图标图例"
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

const searchResultTagVariants = {
  免费: "free",
  会员: "member",
  付费: "paid",
  广播剧: "radioDrama",
  有声剧: "audioDrama",
  有声漫: "audioComic",
};

function getFallbackPaymentLabel(item) {
  if (item?.is_member) {
    return "会员";
  }
  if (item?.platform === "manbo") {
    if (Number(item?.price ?? 0) === 100) {
      return "免费";
    }
    return ["season", "episode"].includes(String(item?.revenue_type ?? "")) ? "付费" : "免费";
  }
  return Number(item?.price ?? 0) > 0 || Number(item?.member_price ?? 0) > 0 ? "付费" : "免费";
}

function getSearchResultPaymentTag(item) {
  return String(item?.payment_label || getFallbackPaymentLabel(item)).trim();
}

function getSearchResultTitleTags(item) {
  return [item?.content_type_label]
    .map((label) => String(label ?? "").trim())
    .filter(Boolean);
}

const metaBadgeClassName = "h-[1.05rem] px-1.5 text-[0.6rem] leading-none";
const mobileInlineBadgeClassName = `${metaBadgeClassName} ml-1 -translate-y-px align-middle`;
const coverPaymentBadgeClassName =
  "absolute bottom-0 right-0 h-4 rounded-none rounded-tl-[calc(var(--radius)-0.18rem)] border-0! px-1 text-[0.54rem] leading-none shadow-none! lg:h-[1.05rem] lg:px-1.5 lg:text-[0.58rem]";
const metaIconClassName = "size-3.5 shrink-0 text-muted-foreground";

export function SearchResults({
  platform = "missevan",
  resultSource = "search",
  results = [],
  dramas = [],
  selectedEpisodes = [],
  onSetResults,
  onSetDramas,
  onSelectionChange,
  onAddDramas,
  onStartRevenueEstimate,
  onStartDramaPaidIdStatistics,
  onStartPlayCountStatistics,
  onStartIdStatistics,
  onLoadMoreResults,
  hasMoreResults = false,
  loadedResultCount = 0,
  allResults = [],
  isLoadingMoreResults = false,
  totalResults = 0,
}) {
  const idLabel = "作品ID";
  const episodeIdLabel = platform === "manbo" ? "Set ID" : "Sound ID";
  const extraMetaLabel = platform === "manbo" ? "收藏数" : "追剧人数";
  const actionResults = allResults.length ? allResults : results;
  const selectedDramaCount = actionResults.filter((result) => result.checked).length;
  const importedDramaCount = dramas.length;
  const selectedEpisodeCount = selectedEpisodes.length;
  const visibleResults = results;
  const showLoadMore = resultSource === "search" && Boolean(hasMoreResults);
  const loadedCount = Number(loadedResultCount || visibleResults.length || 0);
  const totalCount = Number(totalResults || 0);
  const selectedDramaIdSet = new Set(actionResults.filter((result) => result.checked).map((result) => String(result.id)));
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);

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

  function getImportedDrama(dramaId) {
    return dramas.find((drama) => String(drama?.drama?.id) === String(dramaId)) || null;
  }

  function getEpisodes(dramaId) {
    const drama = getImportedDrama(dramaId);
    return Array.isArray(drama?.episodes?.episode) ? drama.episodes.episode : [];
  }

  function isPaidOrMemberEpisode(episode) {
    return isPaidEpisode(platform, episode) || isMemberEpisode(platform, episode);
  }

  function areAllEpisodesSelected(dramaId) {
    const episodes = getEpisodes(dramaId);
    return episodes.length > 0 && episodes.every((episode) => episode.selected);
  }

  function arePaidEpisodesSelected(dramaId) {
    let hasPaidEpisode = false;
    let allPaidSelected = true;
    getEpisodes(dramaId).forEach((episode) => {
      if (!isPaidOrMemberEpisode(episode)) {
        return;
      }
      hasPaidEpisode = true;
      if (!episode.selected) {
        allPaidSelected = false;
      }
    });
    return hasPaidEpisode && allPaidSelected;
  }

  function areAllResultsSelected() {
    return results.length > 0 && results.every((result) => result.checked);
  }

  function areSelectedDramaPaidEpisodesSelected() {
    if (!selectedDramaIdSet.size) {
      return false;
    }
    for (const dramaId of selectedDramaIdSet) {
      if (!getImportedDrama(dramaId)) {
        return false;
      }
    }
    let hasPaidEpisode = false;
    let allPaidSelected = true;
    dramas.forEach((drama) => {
      if (!selectedDramaIdSet.has(String(drama?.drama?.id))) {
        return;
      }
      const episodes = Array.isArray(drama?.episodes?.episode) ? drama.episodes.episode : [];
      episodes.forEach((episode) => {
        if (!isPaidOrMemberEpisode(episode)) {
          return;
        }
        hasPaidEpisode = true;
        if (!episode.selected) {
          allPaidSelected = false;
        }
      });
    });
    return hasPaidEpisode && allPaidSelected;
  }

  function emitSelectionChange(nextDramas) {
    onSelectionChange?.(collectSelectedEpisodes(nextDramas));
  }

  function setResultsMutator(mutator) {
    const nextResults = results.map((item) => ({ ...item }));
    mutator(nextResults);
    onSetResults?.(nextResults);
  }

  function setDramasMutator(mutator) {
    const nextDramas = dramas.map((drama) => ({
      ...drama,
      episodes: {
        ...drama.episodes,
        episode: Array.isArray(drama?.episodes?.episode)
          ? drama.episodes.episode.map((episode) => ({ ...episode }))
          : [],
      },
    }));
    mutator(nextDramas);
    onSetDramas?.(nextDramas);
    emitSelectionChange(nextDramas);
  }

  function getSelectedDramaIds() {
    return actionResults
      .filter((result) => result.checked)
      .map((result) => (platform === "manbo" ? String(result.id) : Number(result.id)));
  }

  function getFirstSelectedDramaId() {
    const firstSelected = actionResults.find((result) => result.checked);
    return firstSelected ? getResultDramaId(firstSelected) : null;
  }

  function getResultDramaId(item) {
    return platform === "manbo" ? String(item.id) : Number(item.id);
  }

  function getSelectedEpisodeIds() {
    return selectedEpisodes.map((episode) => episode.sound_id);
  }

  function selectAllResults() {
    setResultsMutator((nextResults) => {
      nextResults.forEach((result) => {
        result.checked = true;
      });
    });
  }

  function clearAllResults() {
    setResultsMutator((nextResults) => {
      nextResults.forEach((result) => {
        result.checked = false;
      });
    });
  }

  function clearAllSelections() {
    clearAllResults();
    setDramasMutator((nextDramas) => {
      nextDramas.forEach((drama) => {
        const episodes = Array.isArray(drama?.episodes?.episode) ? drama.episodes.episode : [];
        episodes.forEach((episode) => {
          episode.selected = false;
        });
      });
    });
  }

  function setAllResultsChecked(checked) {
    if (checked) {
      selectAllResults();
    } else {
      clearAllResults();
    }
  }

  function updateResultChecked(id, checked) {
    setResultsMutator((nextResults) => {
      nextResults.forEach((result) => {
        if (String(result.id) === String(id)) {
          result.checked = checked;
        }
      });
    });
  }

  function toggleDrama(dramaId) {
    setDramasMutator((nextDramas) => {
      nextDramas.forEach((drama) => {
        if (String(drama?.drama?.id) === String(dramaId)) {
          drama.expanded = !drama.expanded;
        }
      });
    });
  }

  function setSelectedEpisodes(dramaId, checked) {
    setDramasMutator((nextDramas) => {
      selectDramaEpisodesByMode(nextDramas, [dramaId], {
        mode: "all",
        checked,
        expand: true,
      });
    });
  }

  function updateEpisodeChecked(dramaId, episodeId, checked) {
    setDramasMutator((nextDramas) => {
      nextDramas.forEach((drama) => {
        if (String(drama?.drama?.id) !== String(dramaId)) {
          return;
        }
        const episodes = Array.isArray(drama?.episodes?.episode) ? drama.episodes.episode : [];
        episodes.forEach((episode) => {
          if (String(episode.sound_id) === String(episodeId)) {
            episode.selected = checked;
          }
        });
      });
    });
  }

  function setPaidEpisodesSelected(dramaId, checked) {
    setDramasMutator((nextDramas) => {
      selectDramaEpisodesByMode(nextDramas, [dramaId], {
        mode: "paid",
        checked,
        expand: true,
        isSelectableEpisode: isPaidOrMemberEpisode,
      });
    });
  }

  function restoreWindowScroll(scrollY) {
    if (typeof window === "undefined" || !Number.isFinite(scrollY)) {
      return;
    }
    const restore = () => window.scrollTo({ top: scrollY, left: window.scrollX, behavior: "auto" });
    restore();
    window.requestAnimationFrame(() => {
      restore();
      window.requestAnimationFrame(restore);
    });
    window.setTimeout(restore, 120);
    window.setTimeout(restore, 420);
  }

  function setSelectedDramaPaidEpisodesSelected(checked, options = {}) {
    const scrollY = options?.preserveViewport && typeof window !== "undefined" ? window.scrollY : NaN;
    if (!selectedDramaIdSet.size) {
      if (checked) {
        toast.warning("请先选择作品。");
      }
      return;
    }
    if (checked) {
      onAddDramas?.(getSelectedDramaIds(), {
        autoCheck: true,
        expandImported: true,
        selectMode: "paid",
        preserveScroll: true,
      })?.finally?.(() => restoreWindowScroll(scrollY));
      restoreWindowScroll(scrollY);
      return;
    }
    setDramasMutator((nextDramas) => {
      selectDramaEpisodesByMode(nextDramas, Array.from(selectedDramaIdSet), {
        mode: "paid",
        checked: false,
        expand: false,
        isSelectableEpisode: isPaidOrMemberEpisode,
      });
    });
    restoreWindowScroll(scrollY);
  }

  function setResultAllEpisodesSelected(item, checked) {
    if (getImportedDrama(item.id)) {
      setSelectedEpisodes(item.id, Boolean(checked));
      return;
    }
    if (checked) {
      onAddDramas?.([item.id], {
        autoCheck: true,
        expandImported: true,
        selectMode: "all",
        preserveScroll: true,
      });
    }
  }

  function setResultPaidEpisodesSelected(item, checked) {
    if (getImportedDrama(item.id)) {
      setPaidEpisodesSelected(item.id, Boolean(checked));
      return;
    }
    if (checked) {
      onAddDramas?.([item.id], {
        autoCheck: true,
        expandImported: true,
        selectMode: "paid",
        preserveScroll: true,
      });
    }
  }

  function getEpisodeTagText(episode) {
    if (isMemberEpisode(platform, episode)) {
      return "会员";
    }
    return isPaidEpisode(platform, episode) ? "付费" : "";
  }

  function getResultMetrics(item) {
    return [
      {
        label: "总播放量",
        value: formatPlainNumber(item.view_count),
      },
      item?.subscription_num != null
        ? {
            label: extraMetaLabel,
            value: formatPlainNumber(item.subscription_num),
          }
        : null,
      platform === "manbo" && !item?.is_member && item?.revenue_type !== "episode" && Number.isFinite(Number(item?.pay_count)) && Number(item.pay_count) > 0
        ? {
            label: "付费人数",
            value: formatPlainNumber(item.pay_count),
          }
        : null,
      platform === "manbo" && item?.is_member && Number.isFinite(Number(item?.member_listen_count)) && Number(item.member_listen_count) > 0
        ? {
            label: "收听人数",
            value: formatPlainNumber(item.member_listen_count),
          }
        : null,
      platform === "missevan" && item?.reward_num != null && Number.isFinite(Number(item.reward_num))
        ? {
            label: "打赏人数",
            value: formatPlainNumber(item.reward_num),
          }
        : null,
      platform === "manbo"
        ? {
            label: "投喂总数",
            value: formatPlainNumber(item.diamond_value),
          }
        : null,
    ].filter(Boolean);
  }

  const actionButtonBaseClass = "h-9 w-full justify-start px-2.5 text-[14px]!";
  const mobileBatchTextClass = "text-[14px]! font-medium";
  const mobileActionButtonClass = `h-9 min-w-fit gap-1 px-2 ${mobileBatchTextClass}`;
  const batchSwitchControlClass = "flex h-8 min-w-fit items-center gap-1.5 rounded-[calc(var(--radius)-0.12rem)] border border-border/70 bg-background/84 px-1.5 text-[0.7rem] font-medium text-foreground sm:gap-2 sm:px-2.5 sm:text-xs";
  const desktopBatchControlClass = "flex h-9 w-full items-center justify-start gap-2 rounded-md border border-border/75 bg-background px-2.5 text-[14px]! font-medium";
  const resultActionControlClass = "flex h-8 items-center gap-1.5 rounded-[calc(var(--radius)-0.12rem)] border border-border/70 bg-background/84 px-1.5 text-[0.7rem] font-medium text-foreground sm:gap-2 sm:px-2.5 sm:text-xs";
  const resultActionButtonClass = "h-8 gap-1 rounded-[calc(var(--radius)-0.12rem)] px-1.5 text-[0.7rem] sm:gap-1.5 sm:px-2.5 sm:text-xs";

  function runMobileAction(callback) {
    setMobileActionsOpen(false);
    callback?.();
  }

  function ActionPanel({ variant = "desktop" }) {
    if (variant === "mobile") {
      return (
        <div className="grid gap-2 rounded-lg border border-border/80 bg-card/98 p-2 shadow-[0_18px_48px_-30px_rgba(15,23,42,0.42)] backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <label className={batchSwitchControlClass}>
              <Switch
                aria-label="切换全选作品"
                size="sm"
                checked={areAllResultsSelected()}
                onCheckedChange={(checked) => setAllResultsChecked(Boolean(checked))}
                className="data-checked:bg-primary data-unchecked:bg-muted dark:data-unchecked:bg-muted"
              />
              <span>作品</span>
            </label>
            <label className={batchSwitchControlClass}>
              <Switch
                aria-label="切换全选付费"
                size="sm"
                checked={areSelectedDramaPaidEpisodesSelected()}
                onCheckedChange={(checked) => setSelectedDramaPaidEpisodesSelected(Boolean(checked), { preserveViewport: true })}
                className="data-checked:bg-primary data-unchecked:bg-muted dark:data-unchecked:bg-muted"
              />
              <span>付费</span>
            </label>
            <Button
              variant="outline"
              className={mobileActionButtonClass}
              onClick={clearAllSelections}
            >
              <EraserIcon data-icon="inline-start" />
              清空
            </Button>
            <Button
              variant="outline"
              className={mobileActionButtonClass}
              onClick={() => runMobileAction(() => onAddDramas?.(getSelectedDramaIds(), { scrollToDramaId: getFirstSelectedDramaId() }))}
            >
              <ListChecksIcon data-icon="inline-start" />
              批量导入
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              variant="secondary"
              className={mobileActionButtonClass}
              onClick={() => runMobileAction(() => onStartRevenueEstimate?.(getSelectedDramaIds()))}
            >
              <HandCoinsIcon data-icon="inline-start" />
              收益预估
            </Button>
            <Button
              variant="secondary"
              className={mobileActionButtonClass}
              onClick={() => runMobileAction(() => onStartPlayCountStatistics?.(getSelectedEpisodeIds()))}
            >
              <PlayCircleIcon data-icon="inline-start" />
              统计播放量
            </Button>
            <Button
              variant="secondary"
              className={mobileActionButtonClass}
              onClick={() => runMobileAction(() => onStartIdStatistics?.(getSelectedEpisodeIds()))}
            >
              <UserSearchIcon data-icon="inline-start" />
              统计弹幕ID
            </Button>
          </div>
        </div>
      );
    }

    const statClass = "flex min-h-9 items-center justify-between gap-2 rounded-md border border-border/75 bg-background px-2.5 py-1.5";

    return (
      <div className="grid gap-3">
        <div className="grid grid-cols-3 gap-2 lg:grid-cols-1">
          {[
            { label: "作品", value: selectedDramaCount },
            { label: "导入", value: importedDramaCount },
            { label: "分集", value: selectedEpisodeCount },
          ].map((item) => (
            <div key={item.label} className={statClass}>
              <div className="text-[0.68rem] text-muted-foreground">{item.label}</div>
              <div className="text-sm font-semibold text-foreground">{item.value}</div>
            </div>
          ))}
        </div>

        <div className="grid gap-2">
          <label className={desktopBatchControlClass}>
            <Switch
              aria-label="切换全选作品"
              checked={areAllResultsSelected()}
              onCheckedChange={(checked) => setAllResultsChecked(Boolean(checked))}
              className="data-checked:bg-primary data-unchecked:bg-muted dark:data-unchecked:bg-muted"
            />
            <span>作品全选</span>
          </label>
          <label className={desktopBatchControlClass}>
            <Switch
              aria-label="切换全选付费"
              checked={areSelectedDramaPaidEpisodesSelected()}
              onCheckedChange={(checked) => setSelectedDramaPaidEpisodesSelected(Boolean(checked))}
              className="data-checked:bg-primary data-unchecked:bg-muted dark:data-unchecked:bg-muted"
            />
            <span>付费全选</span>
          </label>
        </div>

        <div className="grid gap-2">
          <Button
            variant="outline"
            className={actionButtonBaseClass}
            onClick={() => {
              setMobileActionsOpen(false);
              clearAllSelections();
            }}
          >
            <EraserIcon data-icon="inline-start" />
            清空选择
          </Button>
          <Button
            variant="outline"
            className={actionButtonBaseClass}
            onClick={() => {
              setMobileActionsOpen(false);
              onAddDramas?.(getSelectedDramaIds());
            }}
          >
            <ListChecksIcon data-icon="inline-start" />
            批量导入
          </Button>
        </div>

        <div className="grid gap-2">
          <Button
            variant="secondary"
            className={actionButtonBaseClass}
            onClick={() => {
              setMobileActionsOpen(false);
              onStartRevenueEstimate?.(getSelectedDramaIds());
            }}
          >
            <HandCoinsIcon data-icon="inline-start" />
            收益预估
          </Button>
          <Button
            variant="secondary"
            className={actionButtonBaseClass}
            onClick={() => {
              setMobileActionsOpen(false);
              onStartPlayCountStatistics?.(getSelectedEpisodeIds());
            }}
          >
            <PlayCircleIcon data-icon="inline-start" />
            统计播放量
          </Button>
          <Button
            variant="secondary"
            className={actionButtonBaseClass}
            onClick={() => {
              setMobileActionsOpen(false);
              onStartIdStatistics?.(getSelectedEpisodeIds());
            }}
          >
            <UserSearchIcon data-icon="inline-start" />
            统计弹幕 ID
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_11rem] lg:items-start">
      {results.length ? <MetricLegend className="lg:hidden" /> : null}
      <Card className="min-w-0 border-border/80 bg-card shadow-[0_24px_52px_-42px_rgba(15,23,42,0.24)]">
        <CardContent className="pt-5">
        {results.length ? (
          <div className="divide-y divide-border/75">
            {visibleResults.map((item) => {
              const importedDrama = getImportedDrama(item.id);
              const coverUrl = buildProxyImageUrl(item.cover);
              const mainCvText = item.main_cv_text || "";
              const paymentTag = getSearchResultPaymentTag(item);
              const titleTags = getSearchResultTitleTags(item);
              const metrics = getResultMetrics(item);

              return (
                <div key={item.id} data-search-result-id={String(item.id)} className="px-0 py-3.5 first:pt-0 last:pb-0 sm:py-4">
                  <div className="flex flex-col gap-2.5">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="flex min-w-0 gap-3">
                        <div className="flex w-8 shrink-0 flex-col items-center gap-2 pt-0.5">
                          <Checkbox checked={Boolean(item.checked)} onCheckedChange={(checked) => updateResultChecked(item.id, Boolean(checked))} />
                          {importedDrama ? (
                            <Button variant="ghost" size="icon-sm" className="bg-background/84" onClick={() => toggleDrama(item.id)}>
                              {importedDrama.expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                            </Button>
                          ) : (
                            <Button
                              aria-label="导入分集"
                              title="导入分集"
                              variant="ghost"
                              size="icon-sm"
                              className="bg-background/84"
                              onClick={() => onAddDramas?.([item.id], { autoCheck: true, expandImported: true, preserveScroll: true })}
                            >
                              <ImportIcon />
                            </Button>
                          )}
                        </div>
                        <div className="relative size-20 shrink-0 self-start overflow-hidden rounded-[calc(var(--radius)-0.05rem)] border border-border/70 bg-muted/50 lg:size-[6rem]">
                          {coverUrl ? (
                            <img alt={item.name} className="aspect-square size-20 object-cover lg:size-[6rem]" src={coverUrl} />
                          ) : (
                            <div className="flex aspect-square size-20 items-center justify-center text-xs text-muted-foreground lg:size-[6rem]">
                              暂无封面
                            </div>
                          )}
                          {paymentTag ? (
                            <Badge variant={searchResultTagVariants[paymentTag] || "outline"} className={coverPaymentBadgeClassName}>
                              {paymentTag}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col gap-1 lg:h-24 lg:justify-between lg:gap-0">
                          <div className="hidden min-w-0 flex-wrap items-center gap-1.5 lg:flex">
                            <span className={`min-w-0 break-words ${getTitleClassName(item.name)}`}>{item.name}</span>
                            {titleTags.map((label) => (
                              <Badge key={`${item.id}-desktop-${label}`} variant={searchResultTagVariants[label] || "outline"} className={metaBadgeClassName}>
                                {label}
                              </Badge>
                            ))}
                            {importedDrama ? <Badge variant="imported" className={metaBadgeClassName}>已导入</Badge> : null}
                          </div>
                          <div className="min-w-0 lg:hidden">
                            <span className={`break-words ${getTitleClassName(item.name)}`}>{item.name}</span>
                            {titleTags.map((label) => (
                              <Badge key={`${item.id}-${label}`} variant={searchResultTagVariants[label] || "outline"} className={mobileInlineBadgeClassName}>
                                {label}
                              </Badge>
                            ))}
                            {importedDrama ? <Badge variant="imported" className={mobileInlineBadgeClassName}>已导入</Badge> : null}
                          </div>
                          <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                            <HashIcon aria-label={idLabel} className={metaIconClassName} title={idLabel} />
                            <span className="min-w-0 break-all">{item.id}</span>
                          </div>
                          <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                            <MicIcon aria-label="主要CV" className={metaIconClassName} title="主要CV" />
                            <span className="min-w-0 break-words">{mainCvText.replace(/^主要CV：/, "") || "暂无"}</span>
                          </div>
                          <div className="mt-1 hidden min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm lg:flex">
                            {metrics.map((metric) => (
                              <div
                                key={`${item.id}-desktop-${metric.label}`}
                                aria-label={`${metric.label}: ${metric.value}`}
                                title={`${metric.label}: ${metric.value}`}
                                className="max-w-full text-foreground"
                              >
                                <span className="inline-flex w-fit max-w-full items-center gap-1">
                                  <MetricIcon label={metric.label} className="size-3.5 shrink-0 text-muted-foreground" />
                                  <span className="min-w-0 break-all text-[0.74rem] font-medium tabular-nums sm:text-sm">{metric.value}</span>
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="hidden flex-nowrap gap-2 lg:flex lg:justify-end">
                        <div className={resultActionControlClass}>
                          <Switch
                            aria-label="切换当前作品全选"
                            size="sm"
                            checked={areAllEpisodesSelected(item.id)}
                            onCheckedChange={(checked) => setResultAllEpisodesSelected(item, Boolean(checked))}
                            className="data-checked:bg-primary data-unchecked:bg-muted dark:data-unchecked:bg-muted"
                          />
                          <span>全选</span>
                        </div>
                        <div className={resultActionControlClass}>
                          <Switch
                            aria-label="切换当前作品付费分集"
                            size="sm"
                            checked={arePaidEpisodesSelected(item.id)}
                            onCheckedChange={(checked) => setResultPaidEpisodesSelected(item, Boolean(checked))}
                            className="data-checked:bg-primary data-unchecked:bg-muted dark:data-unchecked:bg-muted"
                          />
                          <span>付费</span>
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          className={resultActionButtonClass}
                          onClick={() => onStartDramaPaidIdStatistics?.(getResultDramaId(item))}
                        >
                          <UserSearchIcon data-icon="inline-start" />
                          付费ID
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          className={resultActionButtonClass}
                          onClick={() => onStartRevenueEstimate?.([getResultDramaId(item)])}
                        >
                          <HandCoinsIcon data-icon="inline-start" />
                          收益
                        </Button>
                      </div>
                    </div>

                    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-sm lg:hidden">
                      {metrics.map((metric) => (
                          <div
                            key={`${item.id}-${metric.label}`}
                            aria-label={`${metric.label}: ${metric.value}`}
                            title={`${metric.label}: ${metric.value}`}
                            className="max-w-full text-foreground"
                          >
                            <span className="inline-flex w-fit max-w-full items-center gap-1">
                              <MetricIcon label={metric.label} className="size-3.5 shrink-0 text-muted-foreground" />
                              <span className="min-w-0 break-all text-[0.74rem] font-medium tabular-nums sm:text-sm">{metric.value}</span>
                            </span>
                          </div>
                        ))}
                    </div>

                    <div className="flex flex-wrap gap-1.5 lg:hidden">
                      <div className={resultActionControlClass}>
                        <Switch
                          aria-label="切换当前作品全选"
                          size="sm"
                          checked={areAllEpisodesSelected(item.id)}
                          onCheckedChange={(checked) => setResultAllEpisodesSelected(item, Boolean(checked))}
                          className="data-checked:bg-primary data-unchecked:bg-muted dark:data-unchecked:bg-muted"
                        />
                        <span>全选</span>
                      </div>
                      <div className={resultActionControlClass}>
                        <Switch
                          aria-label="切换当前作品付费分集"
                          size="sm"
                          checked={arePaidEpisodesSelected(item.id)}
                          onCheckedChange={(checked) => setResultPaidEpisodesSelected(item, Boolean(checked))}
                          className="data-checked:bg-primary data-unchecked:bg-muted dark:data-unchecked:bg-muted"
                        />
                        <span>付费</span>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        className={resultActionButtonClass}
                        onClick={() => onStartDramaPaidIdStatistics?.(getResultDramaId(item))}
                      >
                        <UserSearchIcon data-icon="inline-start" />
                        付费ID
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className={resultActionButtonClass}
                        onClick={() => onStartRevenueEstimate?.([getResultDramaId(item)])}
                      >
                        <HandCoinsIcon data-icon="inline-start" />
                        收益
                      </Button>
                    </div>

                    {importedDrama?.expanded ? (
                      <>
                        <div className="border-t border-dotted border-border/80" />
                        <div className="border-y border-border/70 lg:rounded-[calc(var(--radius)-0.05rem)] lg:border lg:bg-muted/12">
                          <div className="max-h-[22rem] divide-y divide-border overflow-y-auto sm:max-h-[28rem] lg:grid lg:gap-px lg:divide-y-0 lg:bg-border">
                            {getEpisodes(item.id).map((episode) => (
                            <div
                              key={episode.sound_id}
                              className="flex flex-col gap-2 bg-background px-1 py-2.5 sm:flex-row sm:items-center sm:justify-between lg:bg-background/94 lg:px-3"
                            >
                              <label className="flex min-w-0 flex-1 items-start gap-3">
                                <Checkbox
                                  checked={Boolean(episode.selected)}
                                  onCheckedChange={(checked) => updateEpisodeChecked(item.id, episode.sound_id, Boolean(checked))}
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium leading-5">
                                      <span className="break-words">{episode.name}</span>
                                      {getEpisodeTagText(episode) ? (
                                        <Badge variant={isMemberEpisode(platform, episode) ? "info" : "coral"} className={`${metaBadgeClassName} shrink-0`}>
                                          {getEpisodeTagText(episode)}
                                        </Badge>
                                      ) : null}
                                      <span className="inline-flex min-w-0 items-center gap-1 text-xs font-normal text-muted-foreground sm:text-[0.82rem]">
                                        <HashIcon aria-label={episodeIdLabel} className="size-3.5 shrink-0" title={episodeIdLabel} />
                                        <span className="min-w-0 break-all">{episode.sound_id}</span>
                                      </span>
                                  </div>
                                </div>
                              </label>
                            </div>
                          ))}
                        </div>
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {showLoadMore ? (
              <div className="flex flex-row flex-wrap items-center justify-center gap-2 pt-2 text-sm">
                <Button
                  aria-label="加载更多搜索结果"
                  variant="outline"
                  className="h-9 min-w-36 gap-2 px-4 text-sm"
                  disabled={isLoadingMoreResults}
                  onClick={() => onLoadMoreResults?.()}
                >
                  {isLoadingMoreResults ? "加载中" : "加载更多"}
                  <ChevronsDownIcon data-icon="inline-end" />
                </Button>
                {totalCount > 0 ? (
                  <div className="whitespace-nowrap text-xs text-muted-foreground">
                    已显示 {Math.min(loadedCount, totalCount)} / {totalCount}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border/80 bg-muted/30 px-6 py-10 text-center">
            <div className="text-base font-semibold">还没有导入结果</div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {platform === "manbo"
                ? "先搜索已收录的漫播信息库，或继续粘贴作品ID / 链接导入。"
                : "先搜索关键词，或直接输入作品ID后将结果导入到这里。"}
            </p>
          </div>
        )}
        </CardContent>
      </Card>
      {results.length ? (
        <aside className="hidden lg:sticky lg:top-36 lg:block">
          <div className="grid gap-3">
            <MetricLegend />
            <div className="rounded-lg border border-border/80 bg-card p-3 shadow-[0_20px_46px_-38px_rgba(15,23,42,0.32)]">
              <div className="mb-3 text-xs font-semibold text-muted-foreground">批量操作</div>
              <ActionPanel />
            </div>
          </div>
        </aside>
      ) : null}
      {results.length ? (
        <>
          {mobileActionsOpen ? (
            <button
              aria-label="收起批量操作"
              className="fixed inset-0 z-30 cursor-default bg-transparent lg:hidden"
              type="button"
              onClick={() => setMobileActionsOpen(false)}
            />
          ) : null}
          <div className="fixed inset-x-3 bottom-3 z-40 lg:hidden">
            {mobileActionsOpen ? (
              <div>
                <ActionPanel variant="mobile" />
              </div>
            ) : null}
            <div className="rounded-lg border border-border/80 bg-card/96 p-2 shadow-[0_18px_48px_-28px_rgba(15,23,42,0.42)] backdrop-blur-xl">
            <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_auto] items-center gap-2">
              {[
                { label: "作品", value: selectedDramaCount },
                { label: "导入", value: importedDramaCount },
                { label: "分集", value: selectedEpisodeCount },
              ].map((item) => (
                <div key={item.label} className="min-w-0 rounded-md bg-muted/55 px-2 py-1 text-center">
                  <div className="truncate text-[0.62rem] text-muted-foreground">{item.label}</div>
                  <div className="text-sm font-semibold">{item.value}</div>
                </div>
              ))}
              <Button size="sm" className="h-10 px-3 text-[14px]!" onClick={() => setMobileActionsOpen((current) => !current)}>
                批量
                <ChevronUpIcon className={mobileActionsOpen ? "rotate-180 transition-transform" : "transition-transform"} data-icon="inline-end" />
              </Button>
            </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
