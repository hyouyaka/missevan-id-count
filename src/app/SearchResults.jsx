import { useEffect, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon, CoinsIcon, ListChecksIcon, PlayCircleIcon, RadioTowerIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
    const dramaTitle = drama?.drama?.name || "";
    const episodes = Array.isArray(drama?.episodes?.episode) ? drama.episodes.episode : [];
    episodes.forEach((episode) => {
      if (episode.selected) {
        selectedEpisodes.push({
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
  onLoadMoreResults,
  hasMoreResults = false,
  isLoadingMoreResults = false,
}) {
  const idLabel = platform === "manbo" ? "Drama ID" : "作品 ID";
  const episodeIdLabel = platform === "manbo" ? "Set ID" : "Sound ID";
  const extraMetaLabel = platform === "manbo" ? "收藏数" : "追剧人数";
  const selectedDramaCount = results.filter((result) => result.checked).length;
  const importedDramaCount = dramas.length;
  const selectedEpisodeCount = selectedEpisodes.length;
  const visibleResults = results;
  const canLoadMore = resultSource === "search" && hasMoreResults;
  const selectedDramaIdSet = new Set(results.filter((result) => result.checked).map((result) => String(result.id)));
  const [toolbarScale, setToolbarScale] = useState(1);

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) {
      return undefined;
    }
    const viewport = window.visualViewport;
    const desktopQuery = window.matchMedia("(min-width: 1024px)");
    const syncToolbarScale = () => {
      const nextScale = Number(viewport.scale ?? 1);
      setToolbarScale(!desktopQuery.matches && Number.isFinite(nextScale) && nextScale > 0 ? nextScale : 1);
    };
    syncToolbarScale();
    viewport.addEventListener("resize", syncToolbarScale);
    viewport.addEventListener("scroll", syncToolbarScale);
    if (typeof desktopQuery.addEventListener === "function") {
      desktopQuery.addEventListener("change", syncToolbarScale);
    } else {
      desktopQuery.addListener?.(syncToolbarScale);
    }
    return () => {
      viewport.removeEventListener("resize", syncToolbarScale);
      viewport.removeEventListener("scroll", syncToolbarScale);
      if (typeof desktopQuery.removeEventListener === "function") {
        desktopQuery.removeEventListener("change", syncToolbarScale);
      } else {
        desktopQuery.removeListener?.(syncToolbarScale);
      }
    };
  }, []);

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
    return results
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

  function getMetricToneClass(index) {
    const variants = [
      "border-[rgba(33,41,67,0.14)] bg-[rgba(248,242,234,0.98)] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.62),0_8px_18px_-16px_rgba(33,41,67,0.22)]",
      "border-[rgba(239,131,95,0.22)] bg-[rgb(239,131,95)] text-white",
      "border-[rgba(59,62,122,0.18)] bg-[rgba(59,62,122,0.96)] text-white",
    ];
    return variants[index % variants.length];
  }

  const actionButtonBaseClass = "h-8 min-w-[4.25rem] gap-1 px-2 text-[10px] whitespace-nowrap sm:h-9 sm:min-w-[7rem] sm:gap-1.5 sm:px-2.5 sm:text-[11px] lg:h-6 lg:w-full lg:min-w-0 lg:justify-start lg:px-1.5 lg:text-[9px]";
  const toolbarTransform = toolbarScale > 1 ? `scale(${1 / toolbarScale})` : undefined;

  return (
    <div className="grid gap-4">
      {results.length ? (
        <Card
          className="fixed inset-x-3 top-[10vh] z-40 w-auto overflow-visible border-[rgba(33,41,67,0.18)] bg-[rgba(33,41,67,0.72)] text-white shadow-[0_22px_48px_-34px_rgba(33,41,67,0.42)] backdrop-blur-xl lg:inset-x-auto lg:left-[min(calc(50%+40rem+0.75rem),calc(100vw-9.75rem))] lg:top-1/2 lg:z-30 lg:w-36 lg:-translate-y-1/2 lg:bg-[rgba(33,41,67,0.88)]"
          style={{
            transform: toolbarTransform,
            transformOrigin: "top center",
          }}
        >
          <CardHeader className="gap-2.5 p-3 sm:p-3 lg:p-2.5">
            <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap text-[10px] sm:text-xs lg:grid lg:w-full lg:grid-cols-1 lg:gap-1.5 lg:overflow-visible lg:whitespace-normal">
              <div className="rounded-[calc(var(--radius)-0.12rem)] bg-white/10 px-1.5 py-1 text-white/80 sm:px-2">
                已选作品 <span className="font-semibold text-[rgb(239,131,95)]">{selectedDramaCount}</span>
              </div>
              <div className="rounded-[calc(var(--radius)-0.12rem)] bg-white/10 px-1.5 py-1 text-white/80 sm:px-2">
                已导入 <span className="font-semibold text-[rgb(239,131,95)]">{importedDramaCount}</span>
              </div>
              <div className="rounded-[calc(var(--radius)-0.12rem)] bg-white/10 px-1.5 py-1 text-white/80 sm:px-2">
                已选分集 <span className="font-semibold text-[rgb(239,131,95)]">{selectedEpisodeCount}</span>
              </div>
              <div className="flex items-center gap-1 rounded-[calc(var(--radius)-0.08rem)] border border-white/14 bg-[rgba(255,252,247,0.96)] px-1.5 py-1 text-[rgb(33,41,67)] shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] sm:px-2">
                <Switch
                  aria-label="切换全选作品"
                  checked={areAllResultsSelected()}
                  onCheckedChange={(checked) => setAllResultsChecked(Boolean(checked))}
                  className="data-checked:bg-[rgb(239,131,95)] data-unchecked:bg-[rgba(59,62,122,0.24)] dark:data-unchecked:bg-[rgba(59,62,122,0.24)]"
                />
                <span className="text-[10px] font-medium sm:text-xs">作品</span>
              </div>
              <div className="flex items-center gap-1 rounded-[calc(var(--radius)-0.08rem)] border border-white/14 bg-[rgba(255,252,247,0.96)] px-1.5 py-1 text-[rgb(33,41,67)] shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] sm:px-2">
                <Switch
                  aria-label="切换全选付费"
                  checked={areSelectedDramaPaidEpisodesSelected()}
                  onCheckedChange={(checked) => setSelectedDramaPaidEpisodesSelected(Boolean(checked))}
                  className="data-checked:bg-[rgb(239,131,95)] data-unchecked:bg-[rgba(59,62,122,0.24)] dark:data-unchecked:bg-[rgba(59,62,122,0.24)]"
                />
                <span className="text-[10px] font-medium sm:text-xs">付费</span>
              </div>
            </div>

            <div className={`grid gap-1.5 lg:w-full lg:gap-1 ${platform !== "manbo" ? "grid-cols-4 lg:grid-cols-1" : "grid-cols-3 lg:grid-cols-1"}`}>
              <Button
                variant="outline"
                className={`${actionButtonBaseClass} justify-center border-white/18 bg-[rgba(255,252,247,0.96)] text-[rgb(33,41,67)] hover:bg-white hover:text-[rgb(33,41,67)] lg:justify-start`}
                onClick={() => onAddDramas?.(getSelectedDramaIds())}
              >
                <ListChecksIcon data-icon="inline-start" />
                <span className="sm:hidden">导入</span>
                <span className="hidden sm:inline">导入分集</span>
              </Button>
              <Button variant="secondary" className={`${actionButtonBaseClass} justify-center lg:justify-start`} onClick={() => onStartRevenueEstimate?.(getSelectedDramaIds())}>
                <CoinsIcon data-icon="inline-start" />
                <span className="sm:hidden">收益</span>
                <span className="hidden sm:inline">收益预估</span>
              </Button>
              {platform !== "manbo" ? (
                <Button variant="secondary" className={`${actionButtonBaseClass} justify-center lg:justify-start`} onClick={() => onStartPlayCountStatistics?.(getSelectedEpisodeIds())}>
                  <PlayCircleIcon data-icon="inline-start" />
                  <span className="sm:hidden">播放</span>
                  <span className="hidden sm:inline">统计播放量</span>
                </Button>
              ) : null}
              <Button variant="secondary" className={`${actionButtonBaseClass} justify-center lg:justify-start`} onClick={() => onStartIdStatistics?.(getSelectedEpisodeIds())}>
                <RadioTowerIcon data-icon="inline-start" />
                <span className="sm:hidden">弹幕</span>
                <span className="hidden sm:inline">统计弹幕 ID</span>
              </Button>
            </div>
          </CardHeader>
        </Card>
      ) : null}

      <Card className="bg-[rgba(255,252,247,0.98)] shadow-[0_24px_52px_-40px_rgba(30,32,41,0.18)]">
        <CardContent className="pt-5">
        {results.length ? (
          <div className="grid gap-3 sm:gap-4">
            {visibleResults.map((item) => {
              const importedDrama = getImportedDrama(item.id);
              const coverUrl = buildProxyImageUrl(item.cover);
              const mainCvText = item.main_cv_text || "";

              return (
                <div key={item.id} className="rounded-[calc(var(--radius)+0.08rem)] border border-border/72 bg-[rgba(255,252,247,0.97)] p-3.5 shadow-[0_18px_36px_-30px_rgba(30,32,41,0.12)] sm:p-4">
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
                            <div className={`min-w-0 break-words ${getTitleClassName(item.name)}`}>{item.name}</div>
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
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {item.is_member ? <Badge variant="info">会员</Badge> : null}
                          </div>
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
                              className="data-checked:bg-[rgb(239,131,95)] data-unchecked:bg-[rgba(59,62,122,0.16)] dark:data-unchecked:bg-[rgba(59,62,122,0.16)]"
                            />
                            <span>全选</span>
                          </div>
                          <div className="flex h-8 items-center gap-2 rounded-[calc(var(--radius)-0.12rem)] border border-border/70 bg-background/84 px-2.5 text-xs font-medium text-foreground">
                            <Switch
                              aria-label="切换当前作品付费分集"
                              size="sm"
                              checked={arePaidEpisodesSelected(item.id)}
                              onCheckedChange={(checked) => setPaidEpisodesSelected(item.id, Boolean(checked))}
                              className="data-checked:bg-[rgb(239,131,95)] data-unchecked:bg-[rgba(59,62,122,0.16)] dark:data-unchecked:bg-[rgba(59,62,122,0.16)]"
                            />
                            <span>付费</span>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-sm">
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
                        .map((metric, index) => (
                          <div
                            key={`${item.id}-${metric.label}`}
                            className={`min-w-fit rounded-[calc(var(--radius)-0.12rem)] border px-3 py-1.5 ${getMetricToneClass(index)}`}
                          >
                            <span className="opacity-78">{metric.label}: </span>
                            <span className="font-medium">{metric.value}</span>
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
            {canLoadMore ? (
              <div className="flex justify-center pt-1">
                <Button
                  className="px-5"
                  disabled={isLoadingMoreResults}
                  onClick={() => onLoadMoreResults?.()}
                >
                  {isLoadingMoreResults ? "加载中" : "加载更多结果"}
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="rounded-[calc(var(--radius)+0.08rem)] border border-dashed border-border/80 bg-muted/15 px-6 py-10 text-center">
            <div className="text-base font-semibold">还没有导入结果</div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {platform === "manbo"
                ? "先搜索已收录的漫播信息库，或继续粘贴 Manbo 的 ID / 链接导入。"
                : "先搜索关键词，或直接输入作品 ID 后将结果导入到这里。"}
            </p>
          </div>
        )}
        </CardContent>
      </Card>

    </div>
  );
}
