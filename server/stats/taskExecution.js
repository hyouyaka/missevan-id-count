export function getManboRevenueType(info, isMemberDramaInfo) {
  const drama = info?.drama || {};
  const episodes = Array.isArray(info?.episodes?.episode) ? info.episodes.episode : [];
  const isMemberDrama = typeof isMemberDramaInfo === "function"
    ? isMemberDramaInfo(info)
    : false;
  const hasPaidEpisodes = episodes.some((episode) => Number(episode?.price ?? 0) > 0);
  if (isMemberDrama) {
    return "member";
  }
  if (Number(drama.pay_type ?? 0) !== 1 && hasPaidEpisodes) {
    return "episode";
  }
  if (Number(drama.pay_type ?? 0) === 1) {
    return "season";
  }
  return "unknown";
}

export function createStatsTaskExecutor(dependencies = {}) {
  const {
    aggregateRevenueFinancials,
    buildIdDramaMap,
    buildOverflowEpisodeKey,
    buildPlayCountDramaMap,
    buildMissevanPlayCountWorkPlan,
    computeMissevanRevenueMetrics,
    fetchManboSetSummary,
    isAccessDeniedError,
    isLikelyManboDanmakuOverflow,
    isManboMemberDramaInfo,
    isMissevanAccessDenied,
    isMissevanLikelyDanmakuOverflow,
    manboClient,
    MANBO_STATS_EPISODE_CONCURRENCY,
    missevanClient,
    normalizeMissevanPayType,
    normalizeOptionalFiniteNumber,
    orderDetectedOverflowEpisodeKeys,
    refreshMissevanCooldownState,
    reportStatsTask,
    resolveMissevanPlayCountDramaTotal,
    resolveMissevanRevenueType,
    runWithConcurrency,
    shouldBlockMissevanAccessForCooldown,
    statsTaskReporters,
    writeWatchCountUsageLog,
  } = dependencies;
  function createRevenueSummary(results) {
    const safeResults = Array.isArray(results) ? results : [];
    const totalPaidUserSet = new Set();
    let totalPaidCount = 0;
    let totalDanmakuPaidUserCount = 0;
    let totalViewCount = 0;
    let rewardTotal = 0;
    let rewardNum = 0;
    let hasRewardNum = false;
    let failed = false;
    let platform = safeResults[0]?.platform || "";
    let currencyUnit = platform === "manbo" ? "红豆" : "钻石";
    let allPayCount = safeResults.length > 0;
    let hasPayCount = false;
    let hasDanmakuIds = false;

    safeResults.forEach((item) => {
      platform = platform || item?.platform || "";
      currencyUnit = platform === "manbo" ? "红豆" : "钻石";
      const paidCountSource = String(item?.paidCountSource || "");
      if (paidCountSource === "pay_count") {
        hasPayCount = true;
        totalPaidCount += Number(item?.payCount ?? item?.paidUserCount ?? 0);
      } else {
        allPayCount = false;
        hasDanmakuIds = true;
      }
      (Array.isArray(item?.paidUserIds) ? item.paidUserIds : []).forEach((uid) => {
        if (uid != null && uid !== "") {
          totalPaidUserSet.add(String(uid));
        }
      });
      totalViewCount += Number(item?.viewCount ?? 0);
      rewardTotal += platform === "manbo"
        ? Number(item?.diamondValue ?? 0)
        : Number(item?.rewardCoinTotal ?? 0);
      const normalizedRewardNum = normalizeOptionalFiniteNumber(item?.rewardNum);
      if (normalizedRewardNum != null) {
        rewardNum += normalizedRewardNum;
        hasRewardNum = true;
      }
      failed = failed || Boolean(item?.failed);
    });

    const financials = aggregateRevenueFinancials(safeResults, platform);
    const {
      estimatedRevenueYuan,
      minRevenueYuan,
      maxRevenueYuan,
      hasSummaryPrice,
      titlePriceTotal,
      titleMemberPriceTotal,
    } = financials;

    const baseTitle = `汇总 / 已选 ${safeResults.length} 部`;
    let summaryTitle = baseTitle;
    if (hasSummaryPrice) {
      summaryTitle = titleMemberPriceTotal != null
        ? `${baseTitle}，总价 ${titlePriceTotal}（会员 ${titleMemberPriceTotal}）${currencyUnit}`
        : `${baseTitle}，总价 ${titlePriceTotal} ${currencyUnit}`;
    }

    totalDanmakuPaidUserCount = totalPaidUserSet.size;
    const paidCountSourceSummary = allPayCount
      ? "pay_count"
      : hasPayCount
        ? "mixed"
        : "danmaku_ids";

    return {
      platform,
      currencyUnit,
      selectedDramaCount: safeResults.length,
      totalPaidUserCount: paidCountSourceSummary === "pay_count"
        ? totalPaidCount
        : paidCountSourceSummary === "danmaku_ids"
          ? totalDanmakuPaidUserCount
          : null,
      totalPayCount: hasPayCount ? totalPaidCount : null,
      totalDanmakuPaidUserCount: hasDanmakuIds ? totalDanmakuPaidUserCount : null,
      paidCountSourceSummary,
      totalViewCount,
      rewardTotal,
      rewardNum: platform === "missevan" && hasRewardNum ? rewardNum : null,
      hasSummaryPrice,
      titlePriceTotal,
      titleMemberPriceTotal,
      estimatedRevenueYuan,
      minRevenueYuan,
      maxRevenueYuan,
      failed,
      summaryTitle,
    };
  }

  function compactRevenueResults(results) {
    return (Array.isArray(results) ? results : []).map((item) => {
      const { paidUserIds: _paidUserIds, ...compactItem } = item || {};
      return compactItem;
    });
  }

  function getManboRevenueType(info) {
    const drama = info?.drama || {};
    const episodes = Array.isArray(info?.episodes?.episode) ? info.episodes.episode : [];
    const isMemberDrama = isManboMemberDramaInfo(info);
    const hasPaidEpisodes = episodes.some((episode) => Number(episode?.price ?? 0) > 0);
    if (isMemberDrama) {
      return "member";
    }
    if (
      Number(drama.pay_type ?? 0) !== 1 &&
      hasPaidEpisodes
    ) {
      return "episode";
    }
    if (
      Number(drama.pay_type ?? 0) === 1
    ) {
      return "season";
    }
    return "unknown";
  }

  function getManboRevenueEpisodes(info, revenueType) {
    const episodes = Array.isArray(info?.episodes?.episode) ? info.episodes.episode : [];
    if (revenueType === "member") {
      return episodes.filter((episode) => Number(episode?.vip_free ?? 0) === 1);
    }
    if (revenueType === "season") {
      return episodes.filter((episode) => Number(episode?.pay_type ?? 0) === 1);
    }
    if (revenueType === "episode") {
      return episodes.filter((episode) => Number(episode?.price ?? 0) > 0);
    }
    return [];
  }

  function resolveManboSeasonPricing(dramaInfo) {
    const drama = dramaInfo?.drama || {};
    const titlePrice = Math.max(0, Number(drama.price ?? 0));
    const memberPriceCandidate = Math.max(0, Number(drama.member_price ?? 0));
    const titleMemberPrice = memberPriceCandidate > 0
      ? memberPriceCandidate
      : titlePrice;
    const hasDiscountRange = titlePrice > 0 && memberPriceCandidate > 0 && titleMemberPrice < titlePrice;

    return {
      titlePrice,
      titleMemberPrice,
      hasDiscountRange,
      includeInSummaryPrice: titlePrice > 0,
    };
  }

  function getManboRevenueSubtitle(title, dramaInfo, revenueType, episodes) {
    if (revenueType === "member") {
      return `${title} / 会员剧（仅计算投喂）`;
    }
    if (revenueType === "season") {
      const seasonPricing = resolveManboSeasonPricing(dramaInfo);
      if (seasonPricing.hasDiscountRange) {
        return `${title} / 全季${seasonPricing.titlePrice}（折后${seasonPricing.titleMemberPrice}）红豆`;
      }
      return `${title} / 全季${seasonPricing.titlePrice}红豆`;
    }
    if (revenueType === "episode") {
      const prices = [...new Set(
        episodes.map((episode) => Number(episode?.price ?? 0)).filter((price) => price > 0)
      )];
      return prices.length === 1
        ? `${title} / 每集${prices[0]}红豆`
        : `${title} / 分集付费红豆`;
    }
    return `${title} / 暂不支持收益预估`;
  }

  function getManboPayCount(info) {
    return normalizeOptionalFiniteNumber(info?.drama?.pay_count);
  }

  function shouldUseManboOfficialPayCount(info, revenueType) {
    const payCount = getManboPayCount(info);
    return revenueType !== "episode" && revenueType !== "member" && Number(payCount ?? 0) > 0;
  }

  function finalizeCancelledTask(task, patch = {}) {
    return {
      status: "cancelled",
      patch: {
      currentAction: patch.currentAction || "统计已取消",
      result: patch.result ?? task.result ?? null,
      ...patch,
      },
    };
  }

  function initializeRevenueProgress(task, dramaIds) {
    const normalizedDramaIds = Array.isArray(dramaIds) ? dramaIds : [];
    task.progressTotalUnits = Math.max(1, normalizedDramaIds.length);
    task.progressCompletedUnits = 0;
  }

  function setRevenueProgress(task, completedUnits, currentAction) {
    task.progressCompletedUnits = Math.max(
      0,
      Math.min(Number(completedUnits ?? 0) || 0, Number(task.progressTotalUnits ?? 0) || 0)
    );
    reportStatsTask(task, {
      progress: task.progressTotalUnits > 0
        ? Math.floor((task.progressCompletedUnits / task.progressTotalUnits) * 100)
        : 100,
      currentAction,
    });
  }

  function advanceRevenueProgress(task, units, currentAction) {
    const nextCompletedUnits = (Number(task.progressCompletedUnits ?? 0) || 0)
      + Math.max(0, Number(units ?? 0) || 0);
    setRevenueProgress(task, nextCompletedUnits, currentAction);
  }

  function createRevenueDramaUnit(task, title, episodeCount, stageUnits = 2) {
    const normalizedEpisodeCount = Math.max(0, Number(episodeCount ?? 0) || 0);
    const normalizedStageUnits = Math.max(1, Number(stageUnits ?? 0) || 0);
    return {
      title,
      totalEpisodes: normalizedEpisodeCount,
      stageUnits: normalizedStageUnits,
      totalUnits: normalizedStageUnits + normalizedEpisodeCount,
      startCompletedUnits: Number(task.progressCompletedUnits ?? 0) || 0,
    };
  }

  function completeRevenueDramaUnits(task, dramaUnit, currentAction) {
    if (!dramaUnit) {
      return;
    }
    const consumedUnits = (Number(task.progressCompletedUnits ?? 0) || 0)
      - Number(dramaUnit.startCompletedUnits ?? 0);
    const remainingUnits = Math.max(0, Number(dramaUnit.totalUnits ?? 0) - consumedUnits);
    if (remainingUnits > 0) {
      advanceRevenueProgress(task, remainingUnits, currentAction);
      return;
    }
    reportStatsTask(task, {
      currentAction,
    });
  }

  async function executeMissevanIdTask(task) {
    const episodes = Array.isArray(task.episodes) ? task.episodes : [];
    const dramaMap = buildIdDramaMap(episodes);
    const allUsers = new Set();
    const suspectedOverflowEpisodes = new Set();

    reportStatsTask(task, {
      status: "running",
      currentAction: "开始统计弹幕与去重 ID",
      progress: 0,
      totalDanmaku: 0,
      totalUsers: 0,
    });

    await refreshMissevanCooldownState();
    if (shouldBlockMissevanAccessForCooldown()) {
      task.accessDenied = true;
      return reportStatsTask(task, {
        status: "completed",
        progress: 100,
        currentAction: "访问受限",
        totalUsers: 0,
        result: {
          idResults: Array.from(dramaMap.values()).map((drama) => ({
            dramaId: drama.dramaId,
            title: drama.title,
            selectedEpisodeCount: drama.selectedEpisodeCount,
            danmaku: drama.danmaku,
            users: drama.userSet.size,
          })),
          suspectedOverflowEpisodes: [],
          totalDanmaku: 0,
          totalUsers: 0,
          idSelectedEpisodeCount: task.totalCount,
        },
      });
    }

    await runWithConcurrency(episodes, 1, async (episode) => {
      if (task.cancelled || task.accessDenied) {
        return;
      }
      const soundId = Number(episode?.sound_id ?? 0);
      const dramaId = String(episode?.drama_id ?? "").trim();
      const dramaTitle = String(episode?.drama_title ?? "").trim() || "Unknown";
      const episodeTitle = String(episode?.episode_title ?? episode?.name ?? "").trim();
      const durationMs = Number(episode?.duration ?? 0);
      try {
        const result = await missevanClient.getDanmakuSummary(
          soundId,
          dramaTitle,
          episodeTitle,
          task.source,
          { signal: task.abortSignal }
        );
        if (result.cancelled || task.cancelled || task.abortSignal?.aborted) {
          return;
        }
        if (result.success) {
          const drama = dramaMap.get(dramaId || dramaTitle);
          if (drama) {
            drama.danmaku += Number(result.danmaku ?? 0);
            result.users.forEach((uid) => {
              drama.userSet.add(uid);
              allUsers.add(uid);
            });
          }
          task.totalDanmaku += Number(result.danmaku ?? 0);
          if (isMissevanLikelyDanmakuOverflow({
            durationMs,
            danmaku: result.danmaku,
          })) {
            suspectedOverflowEpisodes.add(
              buildOverflowEpisodeKey(dramaId, episodeTitle)
            );
          }
        } else {
          task.failedCount += 1;
          if (result.accessDenied) {
            task.accessDenied = true;
            return;
          }
        }
      } catch (error) {
        if (task.cancelled || task.abortSignal?.aborted) {
          return;
        }
        task.failedCount += 1;
        if (isMissevanAccessDenied(error)) {
          task.accessDenied = true;
          return;
        }
      }
      task.completedCount += 1;
      reportStatsTask(task, {
        progress: task.totalCount > 0
          ? Math.floor((task.completedCount / task.totalCount) * 100)
          : 100,
        currentAction: `统计 ID ${task.completedCount}/${task.totalCount}`,
        totalUsers: allUsers.size,
      });
    });

    if (task.cancelled) {
      return finalizeCancelledTask(task, {
        totalUsers: allUsers.size,
      });
    }

    return reportStatsTask(task, {
      status: "completed",
      progress: 100,
      currentAction: task.accessDenied
        ? "访问受限"
        : task.failedCount > 0
          ? `统计完成，跳过 ${task.failedCount} 个分集`
          : "统计完成",
      totalUsers: allUsers.size,
      result: {
        idResults: Array.from(dramaMap.values()).map((drama) => ({
          dramaId: drama.dramaId,
          title: drama.title,
          selectedEpisodeCount: drama.selectedEpisodeCount,
          danmaku: drama.danmaku,
          users: drama.userSet.size,
        })),
        suspectedOverflowEpisodes: Array.from(suspectedOverflowEpisodes),
        totalDanmaku: task.totalDanmaku,
        totalUsers: allUsers.size,
        idSelectedEpisodeCount: task.totalCount,
      },
    });
  }

  async function executeManboIdTask(task) {
    const episodes = Array.isArray(task.episodes) ? task.episodes : [];
    const dramaMap = buildIdDramaMap(episodes);
    const allUsers = new Set();
    const suspectedOverflowEpisodes = new Set();
    const overflowEpisodeOrder = episodes.map((episode) => buildOverflowEpisodeKey(
      episode?.drama_id,
      episode?.episode_title ?? episode?.name
    ));

    reportStatsTask(task, {
      status: "running",
      currentAction: "开始统计弹幕与去重 ID",
      progress: 0,
      totalDanmaku: 0,
      totalUsers: 0,
    });

    await runWithConcurrency(
      episodes,
      MANBO_STATS_EPISODE_CONCURRENCY,
      async (episode) => {
        if (task.cancelled) {
          return;
        }
        const setId = String(episode?.sound_id ?? "").trim();
        const dramaId = String(episode?.drama_id ?? "").trim();
        const dramaTitle = String(episode?.drama_title ?? "").trim() || "Unknown";
        const episodeTitle = String(episode?.episode_title ?? episode?.name ?? "").trim();
        try {
          const result = await manboClient.getDanmakuSummary(
            setId,
            dramaTitle,
            episodeTitle,
            task.source,
            { signal: task.abortSignal }
          );
          if (result.cancelled || task.cancelled || task.abortSignal?.aborted) {
            return;
          }
          if (result.success) {
            const drama = dramaMap.get(dramaId || dramaTitle);
            if (drama) {
              drama.danmaku += Number(result.danmaku ?? 0);
              result.users.forEach((uid) => {
                drama.userSet.add(uid);
                allUsers.add(uid);
              });
            }
            task.totalDanmaku += Number(result.danmaku ?? 0);
            if (await isLikelyManboDanmakuOverflow(setId, result.danmaku)) {
              suspectedOverflowEpisodes.add(
                buildOverflowEpisodeKey(dramaId, episodeTitle)
              );
            }
          } else {
            task.failedCount += 1;
            if (result.accessDenied) {
              task.accessDenied = true;
            }
          }
        } catch (error) {
          if (task.cancelled || task.abortSignal?.aborted) {
            return;
          }
          task.failedCount += 1;
          if (isAccessDeniedError(error)) {
            task.accessDenied = true;
          }
        }
        task.completedCount += 1;
        reportStatsTask(task, {
          progress: task.totalCount > 0
            ? Math.floor((task.completedCount / task.totalCount) * 100)
            : 100,
          currentAction: `统计 ID ${task.completedCount}/${task.totalCount}`,
          totalUsers: allUsers.size,
        });
      }
    );

    if (task.cancelled) {
      return finalizeCancelledTask(task, {
        totalUsers: allUsers.size,
        result: {
          idResults: Array.from(dramaMap.values()).map((drama) => ({
            dramaId: drama.dramaId,
            title: drama.title,
            selectedEpisodeCount: drama.selectedEpisodeCount,
            danmaku: drama.danmaku,
            users: drama.userSet.size,
          })),
          suspectedOverflowEpisodes: orderDetectedOverflowEpisodeKeys(
            Array.from(suspectedOverflowEpisodes),
            overflowEpisodeOrder
          ),
          totalDanmaku: task.totalDanmaku,
          totalUsers: allUsers.size,
          idSelectedEpisodeCount: task.totalCount,
        },
      });
    }

    return reportStatsTask(task, {
      status: "completed",
      progress: 100,
      currentAction: task.accessDenied
        ? "访问受限"
        : task.failedCount > 0
          ? `统计完成，跳过 ${task.failedCount} 个分集`
          : "统计完成",
      totalUsers: allUsers.size,
      result: {
        idResults: Array.from(dramaMap.values()).map((drama) => ({
          dramaId: drama.dramaId,
          title: drama.title,
          selectedEpisodeCount: drama.selectedEpisodeCount,
          danmaku: drama.danmaku,
          users: drama.userSet.size,
        })),
        suspectedOverflowEpisodes: orderDetectedOverflowEpisodeKeys(
          Array.from(suspectedOverflowEpisodes),
          overflowEpisodeOrder
        ),
        totalDanmaku: task.totalDanmaku,
        totalUsers: allUsers.size,
        idSelectedEpisodeCount: task.totalCount,
      },
    });
  }

  async function executeMissevanPlayCountTask(task) {
    const episodes = Array.isArray(task.episodes) ? task.episodes : [];
    const workPlan = buildMissevanPlayCountWorkPlan({
      selectedEpisodes: episodes,
      playCountDramas: task.playCountDramas,
    });

    reportStatsTask(task, {
      status: "running",
      currentAction: "开始统计播放量",
      progress: 0,
    });

    await refreshMissevanCooldownState();
    if (shouldBlockMissevanAccessForCooldown()) {
      task.accessDenied = true;
      return reportStatsTask(task, {
        status: "completed",
        progress: 100,
        currentAction: "访问受限",
        result: {
          playCountResults: workPlan.dramas.map((drama) => ({
            dramaId: drama.dramaId,
            title: drama.title,
            selectedEpisodeCount: drama.selectedEpisodeCount,
            totalEpisodeCount: drama.totalEpisodeCount,
            requestEpisodeCount: drama.requestEpisodeCount,
            calculationMode: drama.calculationMode,
            playCountTotal: drama.playCountTotal,
            playCountFailed: true,
          })),
          playCountSelectedEpisodeCount: task.totalCount,
          playCountTotal: 0,
          playCountFailed: true,
        },
      });
    }

    const requestTotal = Math.max(1, Number(workPlan.totalRequestCount ?? 0) || 0);
    for (const drama of workPlan.dramas) {
      if (task.cancelled || task.accessDenied) {
        break;
      }
      let requestedPlayCountTotal = 0;

      for (const episode of drama.requestEpisodes) {
        if (task.cancelled || task.accessDenied) {
          break;
        }
        const soundId = Number(episode?.sound_id ?? 0);
        try {
          const summary = await missevanClient.getSoundSummary(soundId, {
            signal: task.abortSignal,
          });
          writeWatchCountUsageLog({
            episode,
            summary,
            calculationMode: drama.calculationMode,
            success: Boolean(summary && !summary.playCountFailed),
          });
          if (!summary || summary.playCountFailed) {
            drama.playCountFailed = true;
            if (summary?.accessDenied) {
              task.accessDenied = true;
              break;
            }
          } else {
            requestedPlayCountTotal += Number(summary.view_count ?? 0);
          }
        } catch (error) {
          drama.playCountFailed = true;
          writeWatchCountUsageLog({
            episode,
            calculationMode: drama.calculationMode,
            success: false,
            error,
          });
          if (isMissevanAccessDenied(error)) {
            task.accessDenied = true;
            break;
          }
          task.failedCount += 1;
        }
        task.completedCount += 1;
        reportStatsTask(task, {
          progress: Math.floor((task.completedCount / requestTotal) * 100),
          currentAction: `统计播放量 ${task.completedCount}/${requestTotal}`,
        });
      }

      Object.assign(
        drama,
        resolveMissevanPlayCountDramaTotal(drama, requestedPlayCountTotal, drama.playCountFailed)
      );
    }

    if (task.cancelled) {
      return finalizeCancelledTask(task);
    }

    const playCountResults = workPlan.dramas.map((drama) => ({
      dramaId: drama.dramaId,
      title: drama.title,
      selectedEpisodeCount: drama.selectedEpisodeCount,
      totalEpisodeCount: drama.totalEpisodeCount,
      requestEpisodeCount: drama.requestEpisodeCount,
      calculationMode: drama.calculationMode,
      playCountTotal: drama.playCountTotal,
      playCountFailed: drama.playCountFailed,
    }));
    const playCountTotal = playCountResults.reduce((sum, episode) => {
      return episode.playCountFailed ? sum : sum + Number(episode.playCountTotal ?? 0);
    }, 0);
    const playCountFailed = playCountResults.some((item) => item.playCountFailed);

    return reportStatsTask(task, {
      status: "completed",
      progress: 100,
      currentAction: task.accessDenied
        ? "访问受限"
        : "播放量统计完成",
      result: {
        playCountResults,
        playCountSelectedEpisodeCount: task.totalCount,
        playCountTotal,
        playCountFailed,
      },
    });
  }

  async function executeManboPlayCountTask(task) {
    const episodes = Array.isArray(task.episodes) ? task.episodes : [];
    const dramaMap = buildPlayCountDramaMap(episodes);

    reportStatsTask(task, {
      status: "running",
      currentAction: "开始统计播放量",
      progress: 0,
    });

    for (const episode of episodes) {
      if (task.cancelled) {
        break;
      }
      const setId = String(episode?.sound_id ?? "").trim();
      const dramaTitle = String(episode?.drama_title ?? "").trim() || "Unknown";
      try {
        const summary = await fetchManboSetSummary(setId);
        const drama = dramaMap.get(dramaTitle);
        if (drama) {
          if (!summary || summary.playCountFailed) {
            drama.playCountFailed = true;
          } else {
            drama.playCountTotal += Number(summary.view_count ?? 0);
          }
        }
      } catch (error) {
        const drama = dramaMap.get(dramaTitle);
        if (drama) {
          drama.playCountFailed = true;
        }
        task.failedCount += 1;
      }
      task.completedCount += 1;
      reportStatsTask(task, {
        progress: task.totalCount > 0
          ? Math.floor((task.completedCount / task.totalCount) * 100)
          : 100,
        currentAction: `统计播放量 ${task.completedCount}/${task.totalCount}`,
      });
    }

    if (task.cancelled) {
      return finalizeCancelledTask(task);
    }

    const playCountResults = Array.from(dramaMap.values()).map((drama) => ({
      title: drama.title,
      selectedEpisodeCount: drama.selectedEpisodeCount,
      playCountTotal: drama.playCountTotal,
      playCountFailed: drama.playCountFailed,
    }));
    const playCountTotal = playCountResults.reduce((sum, episode) => {
      return episode.playCountFailed ? sum : sum + Number(episode.playCountTotal ?? 0);
    }, 0);
    const playCountFailed = playCountResults.some((item) => item.playCountFailed);

    return reportStatsTask(task, {
      status: "completed",
      progress: 100,
      currentAction: task.failedCount > 0
        ? `统计完成，跳过 ${task.failedCount} 个分集`
        : "播放量统计完成",
      result: {
        playCountResults,
        playCountSelectedEpisodeCount: task.totalCount,
        playCountTotal,
        playCountFailed,
      },
    });
  }

  async function executeMissevanRevenueTask(task) {
    const dramaIds = Array.isArray(task.dramaIds) ? task.dramaIds : [];
    const results = [];
    const suspectedOverflowEpisodes = new Set();
    initializeRevenueProgress(task, dramaIds);

    reportStatsTask(task, {
      status: "running",
      currentAction: "开始最低收益预估",
      progress: 0,
    });

    await refreshMissevanCooldownState();
    if (shouldBlockMissevanAccessForCooldown()) {
      task.accessDenied = true;
      return reportStatsTask(task, {
        status: "completed",
        progress: 100,
        currentAction: "访问受限",
        result: {
          revenueResults: results,
          revenueSummary: {
            ...createRevenueSummary(results),
            suspectedOverflowEpisodes: [],
          },
        },
      });
    }

    for (const dramaIdValue of dramaIds) {
      if (task.cancelled || task.accessDenied) {
        break;
      }
      const dramaId = Number(dramaIdValue);
      let title = `Drama ${dramaId}`;
      let dramaUnit = null;
      try {
        const dramaInfo = await missevanClient.getDramaInfo(dramaId, null, {
          signal: task.abortSignal,
        });
        title = dramaInfo?.drama?.name || title;
        const viewCount = Number(dramaInfo?.drama?.view_count ?? 0);
        const price = Number(dramaInfo?.drama?.price ?? 0);
        const memberPrice = Number(dramaInfo?.drama?.member_price ?? 0);
        const rewardMeta = await missevanClient
          .getRewardDetailMeta(dramaId, { signal: task.abortSignal })
          .catch(() => null);
        const rewardNum = normalizeOptionalFiniteNumber(rewardMeta?.reward_num);
        const isMember = Boolean(dramaInfo?.drama?.is_member) || Number(dramaInfo?.drama?.vip ?? 0) === 1;
        const payType = normalizeMissevanPayType(dramaInfo?.drama?.pay_type ?? dramaInfo?.drama?.payType);
        const revenueInfo = resolveMissevanRevenueType({
          payTypeRaw: payType,
          vip: dramaInfo?.drama?.vip,
          isMember,
        });
        const shouldCollectPaidEpisodeUsers = revenueInfo.revenueType !== "reward_only";
        const paidEpisodes = shouldCollectPaidEpisodeUsers
          ? dramaInfo?.episodes?.episode?.filter((episode) => {
              return Number(episode.need_pay ?? 0) === 1 || Number(episode.price ?? 0) > 0;
            }) || []
          : [];
        dramaUnit = createRevenueDramaUnit(task, title, paidEpisodes.length, 2);
        task.progressTotalUnits += Math.max(0, dramaUnit.totalUnits - 1);
        advanceRevenueProgress(task, 1, `正在统计收益：${title} / 详情`);

        const userSet = new Set();
        let episodePaidUserCountTotal = 0;
        let failed = false;
        let accessDenied = false;
        let rewardCoinTotal = 0;

        for (let episodeIndex = 0; episodeIndex < paidEpisodes.length; episodeIndex += 1) {
          const episode = paidEpisodes[episodeIndex];
          if (task.cancelled) {
            break;
          }
          const danmakuResult = await missevanClient.getDanmakuSummary(
            episode.sound_id,
            title,
            String(episode?.name ?? "").trim(),
            task.source,
            { signal: task.abortSignal }
          );
          if (!danmakuResult.success) {
            failed = true;
            accessDenied = accessDenied || Boolean(danmakuResult.accessDenied);
            advanceRevenueProgress(
              task,
              1,
              `正在统计收益：${title} / 分集 ${episodeIndex + 1}/${paidEpisodes.length}`
            );
            if (accessDenied) {
              task.accessDenied = true;
            }
            break;
          }
          const episodeUserSet = new Set();
          (Array.isArray(danmakuResult.users) ? danmakuResult.users : []).forEach((uid) => {
            userSet.add(uid);
            episodeUserSet.add(uid);
          });
          episodePaidUserCountTotal += episodeUserSet.size;
          if (isMissevanLikelyDanmakuOverflow({
            durationMs: Number(episode?.duration ?? 0),
            danmaku: danmakuResult.danmaku,
          })) {
            suspectedOverflowEpisodes.add(
              buildOverflowEpisodeKey(dramaId, String(episode?.name ?? "").trim())
            );
          }
          advanceRevenueProgress(
            task,
            1,
            `正在统计收益：${title} / 分集 ${episodeIndex + 1}/${paidEpisodes.length}`
          );
        }

        if (task.cancelled) {
          break;
        }

        if (!failed && !task.cancelled) {
          reportStatsTask(task, {
            currentAction: `正在统计收益：${title} / 打赏汇总`,
          });
          const rewardSummary = await missevanClient.getRewardSummary(dramaId, {
            signal: task.abortSignal,
          });
          if (!rewardSummary?.success) {
            failed = true;
            accessDenied = accessDenied || Boolean(rewardSummary?.accessDenied);
            if (accessDenied) {
              task.accessDenied = true;
            }
          } else {
            rewardCoinTotal = Number(rewardSummary.rewardCoinTotal ?? 0);
          }
        }
        if (task.cancelled) {
          break;
        }
        advanceRevenueProgress(task, 1, `正在统计收益：${title} / 打赏汇总`);

        const revenueMetrics = computeMissevanRevenueMetrics({
          payTypeRaw: payType,
          vip: dramaInfo?.drama?.vip,
          isMember,
          price,
          rewardCoinTotal,
          seasonPaidUserCount: userSet.size,
          episodePaidUserCountTotal,
          paidEpisodeCount: paidEpisodes.length,
        });
        const summaryPriceMultiplier = revenueMetrics.revenueType === "episode"
          ? revenueMetrics.paidEpisodeCount
          : 1;

        results.push({
          dramaId,
          platform: "missevan",
          title,
          subtitle: revenueMetrics.revenueType === "reward_only"
            ? `${title} / 仅计算打赏`
            : revenueMetrics.revenueType === "episode"
              ? `${title} / 单集付费 ${price} 钻石`
              : isMember
                ? `${title} / ${price}（会员${memberPrice}）钻石`
                : `${title} / ${price} 钻石`,
          viewCount,
          price,
          memberPrice,
          titlePrice: price > 0 ? price * summaryPriceMultiplier : null,
          titleMemberPrice: memberPrice > 0 ? memberPrice * summaryPriceMultiplier : null,
          includeInSummaryPrice: price > 0 && revenueMetrics.revenueType !== "reward_only",
          currencyUnit: "钻石",
          summaryRevenueMode: revenueMetrics.summaryRevenueMode,
          payType: revenueMetrics.payType,
          revenueType: revenueMetrics.revenueType,
          paidUserIds: Array.from(userSet),
          paidUserCount: revenueMetrics.paidUserCount,
          episodePaidUserCountTotal: revenueMetrics.episodePaidUserCountTotal,
          seasonPaidUserCount: revenueMetrics.seasonPaidUserCount,
          paidEpisodeCount: revenueMetrics.paidEpisodeCount,
          rewardCoinTotal,
          rewardNum,
          vipOnlyReward: revenueMetrics.vipOnlyReward,
          estimatedRevenueYuan: revenueMetrics.estimatedRevenueYuan,
          minRevenueYuan: revenueMetrics.minRevenueYuan,
          maxRevenueYuan: revenueMetrics.maxRevenueYuan,
          failed,
          accessDenied,
        });
        task.accessDenied = task.accessDenied || accessDenied;
        if (failed) {
          task.failedCount += 1;
        }
        completeRevenueDramaUnits(task, dramaUnit, `正在统计收益：${title} / 已完成`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const accessDenied =
          isMissevanAccessDenied(error);
        task.accessDenied = task.accessDenied || accessDenied;
        task.failedCount += 1;
        results.push({
          dramaId,
          platform: "missevan",
          title,
          subtitle: `${title} / 统计失败`,
          viewCount: 0,
          price: 0,
          memberPrice: 0,
          titlePrice: null,
          titleMemberPrice: null,
          includeInSummaryPrice: false,
          currencyUnit: "钻石",
          summaryRevenueMode: "single",
          payType: null,
          revenueType: "legacy",
          paidUserIds: [],
          paidUserCount: 0,
          episodePaidUserCountTotal: 0,
          seasonPaidUserCount: 0,
          paidEpisodeCount: 0,
          rewardCoinTotal: 0,
          rewardNum: null,
          vipOnlyReward: false,
          estimatedRevenueYuan: 0,
          minRevenueYuan: null,
          maxRevenueYuan: null,
          failed: true,
          accessDenied,
        });
        if (dramaUnit) {
          completeRevenueDramaUnits(task, dramaUnit, `正在统计收益：${title} / 统计失败`);
        } else {
          advanceRevenueProgress(task, 1, `正在统计收益：${title} / 统计失败`);
        }
      }

      task.completedCount += 1;
      if (task.accessDenied) {
        break;
      }
    }

    if (task.cancelled) {
      const revenueSummary = createRevenueSummary(results);
      return finalizeCancelledTask(task, {
        result: {
          revenueResults: compactRevenueResults(results),
          revenueSummary: {
            ...revenueSummary,
            suspectedOverflowEpisodes: Array.from(suspectedOverflowEpisodes),
          },
        },
      });
    }

    const revenueSummary = createRevenueSummary(results);
    return reportStatsTask(task, {
      status: "completed",
      progress: 100,
      currentAction: results.some((item) => item.failed)
        ? "收益预估完成，部分失败"
        : "收益预估完成",
      result: {
        revenueResults: compactRevenueResults(results),
        revenueSummary: {
          ...revenueSummary,
          suspectedOverflowEpisodes: Array.from(suspectedOverflowEpisodes),
        },
      },
    });
  }

  async function executeManboRevenueTask(task) {
    const dramaIds = Array.isArray(task.dramaIds) ? task.dramaIds : [];
    const results = [];
    const suspectedOverflowEpisodes = new Set();
    const overflowEpisodeOrder = [];
    initializeRevenueProgress(task, dramaIds);

    reportStatsTask(task, {
      status: "running",
      currentAction: "开始最低收益预估",
      progress: 0,
    });

    for (const dramaIdValue of dramaIds) {
      if (task.cancelled) {
        break;
      }
      const dramaId = String(dramaIdValue);
      let title = `Drama ${dramaId}`;
      let dramaUnit = null;
      try {
        const dramaInfo = await manboClient.getDramaDetail(dramaId, {
          signal: task.abortSignal,
        });
        title = dramaInfo?.drama?.name || title;
        const viewCount = Number(dramaInfo?.drama?.view_count ?? 0);
        const diamondValue = Number(dramaInfo?.drama?.diamond_value ?? 0);
        const revenueType = getManboRevenueType(dramaInfo);
        const revenueEpisodes = getManboRevenueEpisodes(dramaInfo, revenueType);
        revenueEpisodes.forEach((episode) => {
          overflowEpisodeOrder.push(
            buildOverflowEpisodeKey(dramaId, String(episode?.name ?? "").trim())
          );
        });
        const seasonPricing = revenueType === "season" ? resolveManboSeasonPricing(dramaInfo) : null;
        const payCount = getManboPayCount(dramaInfo);
        const subtitle = getManboRevenueSubtitle(title, dramaInfo, revenueType, revenueEpisodes);
        dramaUnit = createRevenueDramaUnit(task, title, revenueEpisodes.length, 1);
        task.progressTotalUnits += Math.max(0, dramaUnit.totalUnits - 1);
        advanceRevenueProgress(task, 1, `正在统计收益：${title} / 详情`);

        if (
          revenueType === "unknown"
          || (revenueType !== "season" && revenueType !== "member" && revenueEpisodes.length === 0)
        ) {
          results.push({
            dramaId,
            platform: "manbo",
            revenueType,
            title,
            subtitle,
            viewCount,
            diamondValue,
            titlePrice: null,
            titleMemberPrice: null,
            includeInSummaryPrice: false,
            currencyUnit: "红豆",
            summaryRevenueMode: "single",
            payCount,
            paidCountSource: "danmaku_ids",
            paidUserIds: [],
            paidUserCount: 0,
            estimatedRevenueYuan: 0,
            failed: true,
            accessDenied: false,
          });
          completeRevenueDramaUnits(task, dramaUnit, `正在统计收益：${title} / 已完成`);
        } else if (shouldUseManboOfficialPayCount(dramaInfo, revenueType)) {
          const normalizedPayCount = Number(payCount ?? 0);
          const estimatedRevenueYuan = (
            normalizedPayCount * Number(seasonPricing?.titleMemberPrice ?? 0) + diamondValue
          ) / 100;
          const maxRevenueYuan = seasonPricing?.hasDiscountRange
            ? (normalizedPayCount * Number(seasonPricing?.titlePrice ?? 0) + diamondValue) / 100
            : null;

          results.push({
            dramaId,
            platform: "manbo",
            revenueType,
            title,
            subtitle,
            viewCount,
            diamondValue,
            titlePrice: seasonPricing?.includeInSummaryPrice ? seasonPricing.titlePrice : null,
            titleMemberPrice: seasonPricing?.includeInSummaryPrice ? seasonPricing.titleMemberPrice : null,
            includeInSummaryPrice: Boolean(seasonPricing?.includeInSummaryPrice),
            currencyUnit: "红豆",
            summaryRevenueMode: seasonPricing?.hasDiscountRange ? "range" : "single",
            payCount: normalizedPayCount,
            paidCountSource: "pay_count",
            paidUserIds: [],
            paidUserCount: normalizedPayCount,
            estimatedRevenueYuan,
            minRevenueYuan: seasonPricing?.hasDiscountRange ? estimatedRevenueYuan : null,
            maxRevenueYuan,
            failed: false,
            accessDenied: false,
          });
          completeRevenueDramaUnits(task, dramaUnit, `正在统计收益：${title} / 已完成`);
        } else {
          const paidUserSet = new Set();
          const episodePrices = new Set();
          let paidEpisodeCount = 0;
          let episodeRevenue = 0;
          let failed = false;
          let accessDenied = false;
          for (let episodeIndex = 0; episodeIndex < revenueEpisodes.length; episodeIndex += 1) {
            const episode = revenueEpisodes[episodeIndex];
            if (task.cancelled) {
              break;
            }
            const danmakuResult = await manboClient.getDanmakuSummary(
              episode.sound_id,
              title,
              String(episode?.name ?? "").trim(),
              task.source,
              { signal: task.abortSignal }
            );
            if (!danmakuResult.success) {
              failed = true;
              accessDenied = accessDenied || Boolean(danmakuResult.accessDenied);
              advanceRevenueProgress(
                task,
                1,
                `正在统计收益：${title} / 分集 ${episodeIndex + 1}/${revenueEpisodes.length}`
              );
              break;
            }
            const users = Array.isArray(danmakuResult.users) ? danmakuResult.users : [];
            const episodePrice = Number(episode?.price ?? 0);
            users.forEach((uid) => {
              if (uid != null && uid !== "") {
                paidUserSet.add(String(uid));
              }
            });
            paidEpisodeCount += 1;
            episodeRevenue += users.length * episodePrice;
            if (episodePrice > 0) {
              episodePrices.add(episodePrice);
            }
            if (await isLikelyManboDanmakuOverflow(episode.sound_id, danmakuResult.danmaku)) {
              suspectedOverflowEpisodes.add(
                buildOverflowEpisodeKey(dramaId, String(episode?.name ?? "").trim())
              );
            }
            advanceRevenueProgress(
              task,
              1,
            `正在统计收益：${title} / 分集 ${episodeIndex + 1}/${revenueEpisodes.length}`
            );
          }

          if (task.cancelled) {
            break;
          }

          if (failed) {
            task.failedCount += 1;
          }
          task.accessDenied = task.accessDenied || accessDenied;
          const paidUserIds = Array.from(paidUserSet);
          const paidUserCount = paidUserIds.length;

          if (revenueType === "member") {
            results.push({
              dramaId,
              platform: "manbo",
              revenueType,
              title,
              subtitle,
              viewCount,
              diamondValue,
              titlePrice: null,
              titleMemberPrice: null,
              includeInSummaryPrice: false,
              currencyUnit: "红豆",
              summaryRevenueMode: "member_reward",
              payCount,
              paidCountSource: "danmaku_ids",
              paidUserIds,
              paidUserCount,
              estimatedRevenueYuan: diamondValue / 100,
              failed,
              accessDenied,
            });
          } else if (revenueType === "season") {
            const estimatedRevenueYuan = (
              paidUserCount * Number(seasonPricing?.titleMemberPrice ?? 0) + diamondValue
            ) / 100;
            const maxRevenueYuan = seasonPricing?.hasDiscountRange
              ? (paidUserCount * Number(seasonPricing?.titlePrice ?? 0) + diamondValue) / 100
              : null;
            results.push({
              dramaId,
              platform: "manbo",
              revenueType,
              title,
              subtitle,
              viewCount,
              diamondValue,
              titlePrice: seasonPricing?.includeInSummaryPrice ? seasonPricing.titlePrice : null,
              titleMemberPrice: seasonPricing?.includeInSummaryPrice ? seasonPricing.titleMemberPrice : null,
              includeInSummaryPrice: Boolean(seasonPricing?.includeInSummaryPrice),
              currencyUnit: "红豆",
              summaryRevenueMode: seasonPricing?.hasDiscountRange ? "range" : "single",
              payCount,
              paidCountSource: "danmaku_ids",
              paidUserIds,
              paidUserCount,
              minRevenueYuan: seasonPricing?.hasDiscountRange ? estimatedRevenueYuan : null,
              maxRevenueYuan,
              estimatedRevenueYuan,
              failed,
              accessDenied,
            });
          } else {
            const uniqueEpisodePrices = Array.from(episodePrices);
            const minRevenueYuan = (episodeRevenue + diamondValue) / 100;
            const hasUniformEpisodePrice = uniqueEpisodePrices.length === 1;
            const maxRevenueYuan = hasUniformEpisodePrice
              ? (paidUserCount * uniqueEpisodePrices[0] * paidEpisodeCount + diamondValue) / 100
              : null;
            results.push({
              dramaId,
              platform: "manbo",
              revenueType,
              title,
              subtitle,
              viewCount,
              diamondValue,
              titlePrice: hasUniformEpisodePrice
                ? Number(uniqueEpisodePrices[0] ?? 0) * paidEpisodeCount
                : null,
              titleMemberPrice: null,
              includeInSummaryPrice: hasUniformEpisodePrice,
              currencyUnit: "红豆",
              summaryRevenueMode: hasUniformEpisodePrice ? "range" : "single",
              payCount,
              paidCountSource: "danmaku_ids",
              paidUserIds,
              paidUserCount,
              estimatedRevenueYuan: minRevenueYuan,
              minRevenueYuan,
              maxRevenueYuan,
              failed,
              accessDenied,
            });
          }
          completeRevenueDramaUnits(task, dramaUnit, `正在统计收益：${title} / 已完成`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const accessDenied =
          isAccessDeniedError(error) ||
          String(message).startsWith("ACCESS_DENIED_COOLDOWN:");
        task.accessDenied = task.accessDenied || accessDenied;
        task.failedCount += 1;
        results.push({
          dramaId,
          platform: "manbo",
          title,
          subtitle: `${title} / 统计失败`,
          viewCount: 0,
          diamondValue: 0,
          titlePrice: null,
          titleMemberPrice: null,
          includeInSummaryPrice: false,
          currencyUnit: "红豆",
          summaryRevenueMode: "single",
          payCount: null,
          paidCountSource: "danmaku_ids",
          paidUserIds: [],
          paidUserCount: 0,
          estimatedRevenueYuan: 0,
          failed: true,
          accessDenied,
        });
        if (dramaUnit) {
          completeRevenueDramaUnits(task, dramaUnit, `正在统计收益：${title} / 统计失败`);
        } else {
          advanceRevenueProgress(task, 1, `正在统计收益：${title} / 统计失败`);
        }
      }

      task.completedCount += 1;
    }

    if (task.cancelled) {
      const revenueSummary = createRevenueSummary(results);
      return finalizeCancelledTask(task, {
        result: {
          revenueResults: compactRevenueResults(results),
          revenueSummary: {
            ...revenueSummary,
            suspectedOverflowEpisodes: orderDetectedOverflowEpisodeKeys(
              Array.from(suspectedOverflowEpisodes),
              overflowEpisodeOrder
            ),
          },
        },
      });
    }

    const revenueSummary = createRevenueSummary(results);
    return reportStatsTask(task, {
      status: "completed",
      progress: 100,
      currentAction: results.some((item) => item.failed)
        ? "收益预估完成，部分失败"
        : "收益预估完成",
      result: {
        revenueResults: compactRevenueResults(results),
        revenueSummary: {
          ...revenueSummary,
          suspectedOverflowEpisodes: orderDetectedOverflowEpisodeKeys(
            Array.from(suspectedOverflowEpisodes),
            overflowEpisodeOrder
          ),
        },
      },
    });
  }

  async function executeStatsTask(task, { report }) {
    statsTaskReporters.set(task, report);
    try {
      if (task.taskType === "id") {
        if (task.platform === "manbo") {
          return await executeManboIdTask(task);
        }
        return await executeMissevanIdTask(task);
      }

      if (task.taskType === "play_count") {
        if (task.platform === "manbo") {
          return await executeManboPlayCountTask(task);
        }
        return await executeMissevanPlayCountTask(task);
      }

      if (task.taskType === "revenue") {
        if (task.platform === "manbo") {
          return await executeManboRevenueTask(task);
        }
        return await executeMissevanRevenueTask(task);
      }

      throw new Error(`Unsupported task type: ${task.taskType}`);
    } finally {
      statsTaskReporters.delete(task);
    }
  }

  return executeStatsTask;
}
