import { ChevronDownIcon, ChevronRightIcon, CoinsIcon, ListChecksIcon, PlayCircleIcon, RadioTowerIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { formatPlainNumber } from "@/app/app-utils";
import { isMainEpisode, isMemberEpisode, isPaidEpisode } from "@/utils/episodeRules";

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

  const metricToneClasses = [
    "border-[rgba(30,32,41,0.1)] bg-[rgba(255,252,247,0.94)] text-foreground",
    "border-[rgba(59,62,122,0.18)] bg-[rgba(59,62,122,0.94)] text-white",
    "border-[rgba(239,131,95,0.18)] bg-[rgba(239,131,95,0.96)] text-white",
    "border-[rgba(30,32,41,0.1)] bg-[rgba(255,252,247,0.94)] text-foreground",
  ];

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

  function selectAllPaidEpisodes() {
    if (!dramas.length) {
      toast.warning("没有所选分集。");
      return;
    }
    let hasPaidEpisode = false;
    setDramasMutator((nextDramas) => {
      nextDramas.forEach((drama) => {
        let dramaHasPaidEpisode = false;
        const episodes = Array.isArray(drama?.episodes?.episode) ? drama.episodes.episode : [];
        episodes.forEach((episode) => {
          const selected = isPaidEpisode(platform, episode) || isMemberEpisode(platform, episode);
          if (selected) {
            hasPaidEpisode = true;
            dramaHasPaidEpisode = true;
          }
          episode.selected = selected;
        });
        drama.expanded = dramaHasPaidEpisode;
      });
    });
    if (!hasPaidEpisode) {
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
    return metricToneClasses[index % metricToneClasses.length];
  }

  return (
    <Card className="bg-[rgba(255,252,247,0.98)] shadow-[0_24px_52px_-40px_rgba(30,32,41,0.18)]">
      <CardHeader className="gap-4 border-b border-border/75 bg-muted/30 pb-5">
        <div className="flex flex-col gap-4 rounded-[calc(var(--radius)+0.08rem)] border border-border/70 bg-[rgba(255,250,244,0.86)] p-4 sm:p-5">
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div className="min-w-0 rounded-[calc(var(--radius)-0.12rem)] border border-[rgba(59,62,122,0.2)] bg-[rgba(59,62,122,0.96)] px-2.5 py-2.5 text-white shadow-[0_14px_26px_-24px_rgba(59,62,122,0.28)] sm:px-3">
              <div className="text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-white/72 sm:text-[0.68rem] sm:tracking-[0.18em]">已选作品</div>
              <div className="mt-1 truncate font-semibold text-white">{selectedDramaCount}</div>
            </div>
            <div className="min-w-0 rounded-[calc(var(--radius)-0.12rem)] border border-[rgba(239,131,95,0.2)] bg-[rgba(239,131,95,0.96)] px-2.5 py-2.5 text-white shadow-[0_14px_26px_-24px_rgba(239,131,95,0.24)] sm:px-3">
              <div className="text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-white/72 sm:text-[0.68rem] sm:tracking-[0.18em]">已导入</div>
              <div className="mt-1 truncate font-semibold text-white">{importedDramaCount}</div>
            </div>
            <div className="min-w-0 rounded-[calc(var(--radius)-0.12rem)] border border-[rgba(30,32,41,0.12)] bg-[rgba(255,252,247,0.94)] px-2.5 py-2.5 shadow-[0_14px_26px_-24px_rgba(30,32,41,0.14)] sm:px-3">
              <div className="text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground sm:text-[0.68rem] sm:tracking-[0.18em]">已选分集</div>
              <div className="mt-1 truncate font-semibold">{selectedEpisodeCount}</div>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-[calc(var(--radius)-0.02rem)] border border-border/70 bg-[rgba(255,252,247,0.82)] p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" onClick={selectAllResults}>
                  全选作品
                </Button>
                <Button variant="secondary" size="sm" onClick={clearAllResults}>
                  清空作品
                </Button>
                <Button variant="secondary" size="sm" onClick={selectAllPaidEpisodes}>
                  付费分集
                </Button>
              </div>
            </div>
            <div className="rounded-[calc(var(--radius)-0.02rem)] border border-border/70 bg-[rgba(255,252,247,0.82)] p-3.5">
              <div className="flex flex-wrap gap-2 lg:justify-end">
                <Button variant="secondary" size="sm" onClick={() => onAddDramas?.(getSelectedDramaIds())}>
                  <ListChecksIcon data-icon="inline-start" />
                  导入分集
                </Button>
                <Button size="sm" onClick={() => onStartRevenueEstimate?.(getSelectedDramaIds())}>
                  <CoinsIcon data-icon="inline-start" />
                  收益预估
                </Button>
                {platform !== "manbo" ? (
                  <Button size="sm" onClick={() => onStartPlayCountStatistics?.(getSelectedEpisodeIds())}>
                    <PlayCircleIcon data-icon="inline-start" />
                    统计播放量
                  </Button>
                ) : null}
                <Button size="sm" onClick={() => onStartIdStatistics?.(getSelectedEpisodeIds())}>
                  <RadioTowerIcon data-icon="inline-start" />
                  统计弹幕 ID
                </Button>
              </div>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-5">
        {results.length ? (
          <div className="grid gap-3 sm:gap-4">
            {visibleResults.map((item) => {
              const importedDrama = getImportedDrama(item.id);
              const coverUrl = buildProxyImageUrl(item.cover);
              const mainCvText = item.main_cv_text || "";

              return (
                <div key={item.id} className="rounded-[calc(var(--radius)+0.08rem)] border border-border/72 bg-[rgba(255,252,247,0.97)] p-4 shadow-[0_18px_36px_-30px_rgba(30,32,41,0.12)] sm:p-5">
                  <div className="flex flex-col gap-3">
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
                        <div className="size-[4.25rem] shrink-0 self-start overflow-hidden rounded-[calc(var(--radius)-0.05rem)] border border-border/70 bg-muted/50">
                          {coverUrl ? (
                            <img alt={item.name} className="aspect-square size-[4.25rem] object-cover" src={coverUrl} />
                          ) : (
                            <div className="flex aspect-square size-[4.25rem] items-center justify-center text-xs text-muted-foreground">
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
                        <div className="flex flex-wrap gap-1.5 lg:max-w-[18rem] lg:justify-end">
                          <Button variant="secondary" size="sm" className="px-3" onClick={() => setSelectedEpisodes(item.id, () => true)}>
                            全选
                          </Button>
                          <Button variant="secondary" size="sm" className="px-3" onClick={() => setSelectedEpisodes(item.id, () => false)}>
                            清空
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="px-3"
                            onClick={() => setSelectedEpisodes(item.id, (episode) => isPaidEpisode(platform, episode) || isMemberEpisode(platform, episode))}
                          >
                            付费
                          </Button>
                          <Button variant="secondary" size="sm" className="px-3" onClick={() => setSelectedEpisodes(item.id, (episode) => isMainEpisode(platform, episode))}>
                            正片
                          </Button>
                        </div>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-sm xl:grid-cols-4">
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
                        .map((metric, index) => {
                          const toneClass = getMetricToneClass(index);
                          const isInverted = index % metricToneClasses.length === 1 || index % metricToneClasses.length === 2;
                          return (
                            <div key={`${item.id}-${metric.label}`} className={`rounded-[calc(var(--radius)-0.12rem)] border px-3 py-3 ${toneClass}`}>
                              <div className={`text-[0.68rem] font-semibold uppercase tracking-[0.18em] ${isInverted ? "text-white/72" : "text-muted-foreground"}`}>
                                {metric.label}
                              </div>
                              <div className={`mt-1 font-medium ${isInverted ? "text-white" : ""}`}>{metric.value}</div>
                            </div>
                          );
                        })}
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
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="break-words text-sm font-medium leading-5">{episode.name}</div>
                                    {getEpisodeTagText(episode) ? (
                                      <Badge variant={isMemberEpisode(platform, episode) ? "info" : "coral"} className="shrink-0">
                                        {getEpisodeTagText(episode)}
                                      </Badge>
                                    ) : null}
                                  </div>
                                  <div className="mt-0.5 text-xs text-muted-foreground sm:text-[0.82rem]">
                                    {episodeIdLabel}: {episode.sound_id}
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
  );
}
