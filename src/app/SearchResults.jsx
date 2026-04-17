import { useState } from "react";
import {
  BeanIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  CoinsIcon,
  GemIcon,
  HeartIcon,
  ListChecksIcon,
  PlayCircleIcon,
  RadioTowerIcon,
  ShoppingCartIcon,
  StarIcon,
  StepBackIcon,
  StepForwardIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { formatPlainNumber } from "@/app/app-utils";
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
  onStartPlayCountStatistics,
  onStartIdStatistics,
  onLoadSearchPage,
  allResults = [],
  currentPage = 1,
  isLoadingMoreResults = false,
  pageSize = 5,
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
  const totalPages = resultSource === "search" ? Math.max(1, Math.ceil(Number(totalResults || results.length) / Math.max(1, Number(pageSize || 5)))) : 1;
  const showPagination = resultSource === "search" && totalPages > 1;
  const safeCurrentPage = Math.min(totalPages, Math.max(1, Number(currentPage) || 1));
  const selectedDramaIdSet = new Set(actionResults.filter((result) => result.checked).map((result) => String(result.id)));
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const isFirstPage = safeCurrentPage <= 1;
  const isLastPage = safeCurrentPage >= totalPages;

  function goToPage(page) {
    const safeTargetPage = Math.min(totalPages, Math.max(1, Number(page) || 1));
    if (isLoadingMoreResults || safeTargetPage === safeCurrentPage) {
      return;
    }
    onLoadSearchPage?.(safeTargetPage);
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

  function setSelectedEpisodes(dramaId, predicate) {
    setDramasMutator((nextDramas) => {
      nextDramas.forEach((drama) => {
        if (String(drama?.drama?.id) !== String(dramaId)) {
          return;
        }
        const episodes = Array.isArray(drama?.episodes?.episode) ? drama.episodes.episode : [];
        episodes.forEach((episode) => {
          episode.selected = Boolean(predicate(episode));
        });
        drama.expanded = true;
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
      nextDramas.forEach((drama) => {
        if (String(drama?.drama?.id) !== String(dramaId)) {
          return;
        }
        const episodes = Array.isArray(drama?.episodes?.episode) ? drama.episodes.episode : [];
        episodes.forEach((episode) => {
          if (isPaidOrMemberEpisode(episode)) {
            episode.selected = checked;
          }
        });
        drama.expanded = true;
      });
    });
  }

  function setSelectedDramaPaidEpisodesSelected(checked) {
    if (!selectedDramaIdSet.size) {
      if (checked) {
        toast.warning("请先选择作品。");
      }
      return;
    }
    let hasPaidEpisode = false;
    setDramasMutator((nextDramas) => {
      nextDramas.forEach((drama) => {
        let dramaHasPaidEpisode = false;
        if (!selectedDramaIdSet.has(String(drama?.drama?.id))) {
          return;
        }
        const episodes = Array.isArray(drama?.episodes?.episode) ? drama.episodes.episode : [];
        episodes.forEach((episode) => {
          if (isPaidOrMemberEpisode(episode)) {
            hasPaidEpisode = true;
            dramaHasPaidEpisode = true;
            episode.selected = checked;
          }
        });
        drama.expanded = dramaHasPaidEpisode;
      });
    });
    if (checked && !hasPaidEpisode) {
      toast.warning("没有所选分集。");
    }
  }

  function getEpisodeTagText(episode) {
    if (isMemberEpisode(platform, episode)) {
      return "会员";
    }
    return isPaidEpisode(platform, episode) ? "付费" : "";
  }

  const actionButtonBaseClass = "h-9 w-full justify-start px-2.5 text-xs";
  const mobileActionButtonClass = "h-9 min-w-0 gap-1 px-1.5 text-[0.64rem] sm:px-2 sm:text-xs";

  function runMobileAction(callback) {
    setMobileActionsOpen(false);
    callback?.();
  }

  function ActionPanel({ variant = "desktop" }) {
    if (variant === "mobile") {
      return (
        <div className="grid gap-2 rounded-lg border border-border/80 bg-card/98 p-2 shadow-[0_18px_48px_-30px_rgba(15,23,42,0.42)] backdrop-blur-xl">
          <div className="grid grid-cols-3 gap-2">
            <label className="flex h-9 min-w-0 items-center justify-between gap-1 rounded-md border border-border/75 bg-background px-2 text-[0.68rem] font-medium">
              <span className="truncate">作品全选</span>
              <Switch
                aria-label="切换全选作品"
                checked={areAllResultsSelected()}
                onCheckedChange={(checked) => setAllResultsChecked(Boolean(checked))}
                className="data-checked:bg-primary data-unchecked:bg-muted dark:data-unchecked:bg-muted"
              />
            </label>
            <label className="flex h-9 min-w-0 items-center justify-between gap-1 rounded-md border border-border/75 bg-background px-2 text-[0.68rem] font-medium">
              <span className="truncate">付费全选</span>
              <Switch
                aria-label="切换全选付费"
                checked={areSelectedDramaPaidEpisodesSelected()}
                onCheckedChange={(checked) => setSelectedDramaPaidEpisodesSelected(Boolean(checked))}
                className="data-checked:bg-primary data-unchecked:bg-muted dark:data-unchecked:bg-muted"
              />
            </label>
            <Button
              variant="outline"
              className={mobileActionButtonClass}
              onClick={() => runMobileAction(() => onAddDramas?.(getSelectedDramaIds()))}
            >
              <ListChecksIcon data-icon="inline-start" />
              导入分集
            </Button>
          </div>
          <div className="grid gap-2 grid-cols-3">
            <Button
              variant="secondary"
              className={mobileActionButtonClass}
              onClick={() => runMobileAction(() => onStartRevenueEstimate?.(getSelectedDramaIds()))}
            >
              <CoinsIcon data-icon="inline-start" />
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
              <RadioTowerIcon data-icon="inline-start" />
              统计弹幕ID
            </Button>
          </div>
        </div>
      );
    }

    const statClass = "rounded-md border border-border/75 bg-background px-2.5 py-2";

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
              <div className="mt-0.5 text-base font-semibold text-foreground">{item.value}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
          <label className="flex h-9 items-center justify-between gap-2 rounded-md border border-border/75 bg-background px-2.5 text-xs font-medium">
            <span>作品全选</span>
            <Switch
              aria-label="切换全选作品"
              checked={areAllResultsSelected()}
              onCheckedChange={(checked) => setAllResultsChecked(Boolean(checked))}
              className="data-checked:bg-primary data-unchecked:bg-muted dark:data-unchecked:bg-muted"
            />
          </label>
          <label className="flex h-9 items-center justify-between gap-2 rounded-md border border-border/75 bg-background px-2.5 text-xs font-medium">
            <span>付费全选</span>
            <Switch
              aria-label="切换全选付费"
              checked={areSelectedDramaPaidEpisodesSelected()}
              onCheckedChange={(checked) => setSelectedDramaPaidEpisodesSelected(Boolean(checked))}
              className="data-checked:bg-primary data-unchecked:bg-muted dark:data-unchecked:bg-muted"
            />
          </label>
        </div>

        <div className={`grid gap-2 ${platform !== "manbo" ? "grid-cols-2 lg:grid-cols-1" : "grid-cols-1"}`}>
          <Button
            variant="outline"
            className={actionButtonBaseClass}
            onClick={() => {
              setMobileActionsOpen(false);
              onAddDramas?.(getSelectedDramaIds());
            }}
          >
            <ListChecksIcon data-icon="inline-start" />
            导入分集
          </Button>
          <Button
            variant="secondary"
            className={actionButtonBaseClass}
            onClick={() => {
              setMobileActionsOpen(false);
              onStartRevenueEstimate?.(getSelectedDramaIds());
            }}
          >
            <CoinsIcon data-icon="inline-start" />
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
            <RadioTowerIcon data-icon="inline-start" />
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
          <div className="grid gap-3 sm:gap-4">
            {visibleResults.map((item) => {
              const importedDrama = getImportedDrama(item.id);
              const coverUrl = buildProxyImageUrl(item.cover);
              const mainCvText = item.main_cv_text || "";

              return (
                <div key={item.id} className="rounded-lg border border-border/75 bg-card p-3.5 shadow-[0_18px_36px_-32px_rgba(15,23,42,0.18)] sm:p-4">
                  <div className="flex flex-col gap-2.5">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="flex min-w-0 gap-3">
                        <div className="flex w-8 shrink-0 flex-col items-center gap-2 pt-0.5">
                          <Checkbox checked={Boolean(item.checked)} onCheckedChange={(checked) => updateResultChecked(item.id, Boolean(checked))} />
                          {importedDrama ? (
                            <Button variant="ghost" size="icon-sm" className="bg-background/84" onClick={() => toggleDrama(item.id)}>
                              {importedDrama.expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                            </Button>
                          ) : null}
                        </div>
                        <div className="size-[4rem] shrink-0 self-start overflow-hidden rounded-[calc(var(--radius)-0.05rem)] border border-border/70 bg-muted/50">
                          {coverUrl ? (
                            <img alt={item.name} className="aspect-square size-[4rem] object-cover" src={coverUrl} />
                          ) : (
                            <div className="flex aspect-square size-[4rem] items-center justify-center text-xs text-muted-foreground">
                              暂无封面
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                <span className={`min-w-0 break-words ${getTitleClassName(item.name)}`}>{item.name}</span>
                                {item.is_member ? <Badge variant="info" className="shrink-0">会员</Badge> : null}
                              </div>
                            </div>
                            {importedDrama ? <Badge variant="coral" className="shrink-0">已导入分集</Badge> : null}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {idLabel}: {item.id}
                          </div>
                          {mainCvText ? (
                            <div className="mt-1 text-xs text-muted-foreground">
                              {mainCvText}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      {importedDrama ? (
                        <div className="flex flex-wrap gap-2 lg:max-w-[14rem] lg:justify-end">
                          <div className="flex h-8 items-center gap-2 rounded-[calc(var(--radius)-0.12rem)] border border-border/70 bg-background/84 px-2.5 text-xs font-medium text-foreground">
                            <Switch
                              aria-label="切换当前作品全选"
                              size="sm"
                              checked={areAllEpisodesSelected(item.id)}
                              onCheckedChange={(checked) => setSelectedEpisodes(item.id, () => Boolean(checked))}
                              className="data-checked:bg-primary data-unchecked:bg-muted dark:data-unchecked:bg-muted"
                            />
                            <span>全选</span>
                          </div>
                          <div className="flex h-8 items-center gap-2 rounded-[calc(var(--radius)-0.12rem)] border border-border/70 bg-background/84 px-2.5 text-xs font-medium text-foreground">
                            <Switch
                              aria-label="切换当前作品付费分集"
                              size="sm"
                              checked={arePaidEpisodesSelected(item.id)}
                              onCheckedChange={(checked) => setPaidEpisodesSelected(item.id, Boolean(checked))}
                              className="data-checked:bg-primary data-unchecked:bg-muted dark:data-unchecked:bg-muted"
                            />
                            <span>付费</span>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-4 gap-x-2 gap-y-1 text-sm sm:flex sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-1.5">
                      {[
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
                      ]
                        .filter(Boolean)
                        .map((metric) => (
                          <div
                            key={`${item.id}-${metric.label}`}
                            aria-label={`${metric.label}: ${metric.value}`}
                            title={`${metric.label}: ${metric.value}`}
                            className="min-w-0 text-foreground"
                          >
                            <span className="flex min-w-0 items-center justify-center gap-1 sm:justify-start">
                              <MetricIcon label={metric.label} className="size-3.5 shrink-0 text-muted-foreground" />
                              <span className="min-w-0 text-[0.74rem] font-medium tabular-nums sm:text-sm">{metric.value}</span>
                            </span>
                          </div>
                        ))}
                    </div>

                    {importedDrama?.expanded ? (
                      <>
                        <Separator className="my-0" />
                        <div className="rounded-[calc(var(--radius)-0.05rem)] border border-border/70 bg-muted/12">
                          <div className="grid max-h-[22rem] gap-px overflow-y-auto bg-border sm:max-h-[28rem]">
                            {getEpisodes(item.id).map((episode) => (
                            <div
                              key={episode.sound_id}
                              className="flex flex-col gap-2 bg-background/94 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <label className="flex min-w-0 flex-1 items-start gap-3">
                                <Checkbox
                                  checked={Boolean(episode.selected)}
                                  onCheckedChange={(checked) => updateEpisodeChecked(item.id, episode.sound_id, Boolean(checked))}
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                                    <div className="min-w-0 text-sm font-medium leading-5 sm:flex sm:flex-wrap sm:items-center sm:gap-2">
                                      <span className="break-words">{episode.name}</span>
                                      <span className="text-xs font-normal text-muted-foreground sm:text-[0.82rem]">
                                        {episodeIdLabel}: {episode.sound_id}
                                      </span>
                                    </div>
                                    {getEpisodeTagText(episode) ? (
                                      <Badge variant={isMemberEpisode(platform, episode) ? "info" : "coral"} className="shrink-0">
                                        {getEpisodeTagText(episode)}
                                      </Badge>
                                    ) : null}
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
            {showPagination ? (
              <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1 text-sm">
                <Button
                  aria-label="跳到第一页"
                  variant="outline"
                  size="icon-sm"
                  disabled={isLoadingMoreResults || isFirstPage}
                  onClick={() => goToPage(1)}
                >
                  <StepBackIcon />
                </Button>
                <Button
                  aria-label="跳到上一页"
                  variant="outline"
                  size="icon-sm"
                  disabled={isLoadingMoreResults || isFirstPage}
                  onClick={() => goToPage(safeCurrentPage - 1)}
                >
                  <ChevronsLeftIcon />
                </Button>
                <label className="sr-only" htmlFor="search-result-page-select">
                  选择搜索结果页码
                </label>
                <select
                  id="search-result-page-select"
                  className="h-8 min-w-24 rounded-[calc(var(--radius)-0.12rem)] border border-input bg-background px-2 text-sm text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isLoadingMoreResults}
                  value={safeCurrentPage}
                  onChange={(event) => goToPage(Number(event.target.value) || 1)}
                >
                  {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
                    <option key={`search-page-option-${page}`} value={page}>
                      第 {page} 页
                    </option>
                  ))}
                </select>
                <Button
                  aria-label="跳到下一页"
                  variant="outline"
                  size="icon-sm"
                  disabled={isLoadingMoreResults || isLastPage}
                  onClick={() => goToPage(safeCurrentPage + 1)}
                >
                  <ChevronsRightIcon />
                </Button>
                <Button
                  aria-label="跳到最后一页"
                  variant="outline"
                  size="icon-sm"
                  disabled={isLoadingMoreResults || isLastPage}
                  onClick={() => goToPage(totalPages)}
                >
                  <StepForwardIcon />
                </Button>
                {isLoadingMoreResults ? (
                  <span className="text-xs text-muted-foreground">加载中</span>
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
              <div className="mb-2">
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
              <Button size="sm" className="h-10 px-3" onClick={() => setMobileActionsOpen((current) => !current)}>
                统计
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
