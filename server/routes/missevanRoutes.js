export function registerMissevanRoutes(router, {
  buildMissevanDramaCardFromInput,
  buildMissevanSearchFallbackCard,
  dedupeMissevanDramaCardResults,
  ensureInfoStoreLoaded,
  ensureMissevanEnabled,
  expensiveDataLimiter,
  fetchDanmakuSummary,
  fetchDramaInfo,
  fetchRewardDetailMeta,
  fetchRewardSummary,
  fetchSoundSummary,
  filterUntrackedNewDramaIds,
  fireAndForget,
  isAccessDeniedError,
  isMissevanAccessDenied,
  missevanInfoStore,
  normalizeDramaCardUsageAction,
  normalizeIds,
  normalizeDramaIds,
  normalizeMissevanDramaCardItems,
  normalizeStatsTaskSource,
  normalizeStringArray,
  queueNewDramaIdsAppend,
  refreshMissevanCooldownState,
  sleep,
  writeUsageLog,
}) {
  router.post("/getdramacards", expensiveDataLimiter, async (req, res) => {
    if (!ensureMissevanEnabled(res)) {
      return;
    }
    const inputItems = normalizeMissevanDramaCardItems({
      dramaIds: req.body?.drama_ids || [],
      items: req.body?.items || [],
    });
    const usageAction = normalizeDramaCardUsageAction(req.body.usageAction);
    const usageTitles = normalizeStringArray(req.body?.titles, inputItems.length);
    const usageSource = normalizeStatsTaskSource(req.body?.source);
    const results = [];
    const failedIds = [];
    const failedItems = [];
    let accessDenied = false;

    if (inputItems.length) {
      void writeUsageLog({
        platform: "missevan",
        action: usageAction,
        dramaIds: inputItems
          .filter((item) => item.type === "drama")
          .map((item) => Number(item.id)),
        soundIds: inputItems
          .filter((item) => item.type === "sound")
          .map((item) => Number(item.id)),
        ...(usageTitles.length ? { titles: usageTitles } : {}),
        ...(usageSource ? { source: usageSource } : {}),
        count: inputItems.length,
      });
    }

    await ensureInfoStoreLoaded(missevanInfoStore);
    await refreshMissevanCooldownState();
    const newDramaIds = [];
    for (const item of inputItems) {
      if (item.type === "invalid") {
        failedItems.push(item.raw);
        continue;
      }

      const localRecord = item.type === "drama"
        ? missevanInfoStore.byDramaId.get(String(item.id))
        : null;
      if (localRecord) {
        results.push({
          ...buildMissevanSearchFallbackCard(localRecord),
          checked: true,
        });
        continue;
      }

      try {
        const resolved = await buildMissevanDramaCardFromInput(item);

        if (resolved?.card) {
          if (resolved.isNewDrama) {
            newDramaIds.push(resolved.dramaId);
          }
          results.push(resolved.card);
        } else {
          if (item.type === "drama") {
            failedIds.push(Number(item.id));
          }
          failedItems.push(item.raw);
        }
      } catch (error) {
        accessDenied =
          accessDenied ||
          isMissevanAccessDenied(error);
        console.error(`Failed to fetch Missevan drama card item=${item.raw}`, error);
        if (item.type === "drama") {
          failedIds.push(Number(item.id));
        }
        failedItems.push(item.raw);
        if (accessDenied) {
          break;
        }
      }
    }

    if (newDramaIds.length > 0) {
      fireAndForget("Failed to append new Missevan drama ids", async () => {
        const missingDramaIds = await filterUntrackedNewDramaIds("missevan", newDramaIds);
        if (missingDramaIds.length > 0) {
          await queueNewDramaIdsAppend("missevan", missingDramaIds);
        }
      });
    }

    const dedupedResults = dedupeMissevanDramaCardResults(results);

    return res.json({
      success: dedupedResults.length > 0,
      results: dedupedResults,
      failedIds,
      failedItems,
      accessDenied,
    });
  });

  router.post("/getdramas", expensiveDataLimiter, async (req, res) => {
    if (!ensureMissevanEnabled(res)) {
      return;
    }
    const ids = normalizeDramaIds(req.body.drama_ids || []);
    const soundIdMap = req.body.sound_id_map || {};
    const results = [];

    await refreshMissevanCooldownState();
    let stoppedByAccessDenied = false;
    let stopIndex = ids.length;
    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index];
      try {
        const soundId = Number(soundIdMap[String(id)] ?? soundIdMap[id] ?? 0);
        const info = await fetchDramaInfo(id, soundId > 0 ? soundId : null);

        if (info) {
          results.push({
            success: true,
            id,
            info,
          });
        } else {
          results.push({ success: false, id, accessDenied: false });
        }
      } catch (error) {
        const accessDenied = isMissevanAccessDenied(error);
        console.error(`Failed to fetch Missevan drama drama_id=${id}`, error);
        results.push({ success: false, id, accessDenied });
        if (accessDenied) {
          stoppedByAccessDenied = true;
          stopIndex = index + 1;
          break;
        }
      }
    }

    if (stoppedByAccessDenied) {
      ids.slice(stopIndex).forEach((id) => {
        results.push({ success: false, id, accessDenied: true });
      });
    }

    return res.json(results);
  });

  router.post("/getsoundsummary", expensiveDataLimiter, async (req, res) => {
    if (!ensureMissevanEnabled(res)) {
      return;
    }
    const soundIds = normalizeIds(req.body.sound_ids || []);
    const results = [];

    await refreshMissevanCooldownState();
    let stoppedByAccessDenied = false;
    let stopIndex = soundIds.length;
    for (let index = 0; index < soundIds.length; index += 1) {
      const soundId = soundIds[index];
      try {
        results.push(await fetchSoundSummary(soundId));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to fetch Missevan sound summary sound_id=${soundId}`, error);
        results.push({
          sound_id: Number(soundId),
          success: false,
          view_count: null,
          viewCountWan: "",
          playCountFailed: true,
          accessDenied:
            isMissevanAccessDenied(error),
          error: message,
        });
        if (isMissevanAccessDenied(error)) {
          stoppedByAccessDenied = true;
          stopIndex = index + 1;
          break;
        }
      }

      await sleep(350);
    }

    if (stoppedByAccessDenied) {
      soundIds.slice(stopIndex).forEach((soundId) => {
        results.push({
          sound_id: Number(soundId),
          success: false,
          view_count: null,
          viewCountWan: "",
          playCountFailed: true,
          accessDenied: true,
          error: "ACCESS_DENIED_COOLDOWN",
        });
      });
    }

    return res.json(results);
  });

  router.post("/getrewardsummary", expensiveDataLimiter, async (req, res) => {
    if (!ensureMissevanEnabled(res)) {
      return;
    }
    const dramaId = Number(req.body.drama_id ?? 0);

    if (!dramaId) {
      return res.json({
        success: false,
        drama_id: 0,
        rewardCoinTotal: 0,
        accessDenied: false,
        error: "Missing drama_id",
      });
    }

    try {
      await refreshMissevanCooldownState();
      const result = await fetchRewardSummary(dramaId);
      return res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to fetch reward summary drama_id=${dramaId}`, error);
      return res.json({
        success: false,
        drama_id: dramaId,
        rewardCoinTotal: 0,
        accessDenied:
          isAccessDeniedError(error) ||
          String(message).startsWith("ACCESS_DENIED_COOLDOWN:"),
        error: message,
      });
    }
  });

  router.post("/getrewardmeta", expensiveDataLimiter, async (req, res) => {
    if (!ensureMissevanEnabled(res)) {
      return;
    }
    const dramaId = Number(req.body.drama_id ?? 0);

    if (!dramaId) {
      return res.json({
        success: false,
        drama_id: 0,
        reward_num: null,
        accessDenied: false,
        error: "Missing drama_id",
      });
    }

    try {
      await refreshMissevanCooldownState();
      const result = await fetchRewardDetailMeta(dramaId);
      return res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to fetch reward meta drama_id=${dramaId}`, error);
      return res.json({
        success: false,
        drama_id: dramaId,
        reward_num: null,
        accessDenied:
          isAccessDeniedError(error) ||
          String(message).startsWith("ACCESS_DENIED_COOLDOWN:"),
        error: message,
      });
    }
  });

  router.post("/getsounddanmaku", expensiveDataLimiter, async (req, res) => {
    if (!ensureMissevanEnabled(res)) {
      return;
    }
    const {
      sound_id: soundId,
      drama_title: dramaTitle = "",
      episode_title: episodeTitle = "",
    } = req.body;

    if (!soundId) {
      return res.json({
        success: false,
        sound_id: 0,
        drama_title: dramaTitle,
        episode_title: episodeTitle,
        danmaku: 0,
        users: [],
        accessDenied: false,
        error: "Missing sound_id",
      });
    }

    await refreshMissevanCooldownState();
    const result = await fetchDanmakuSummary(soundId, dramaTitle, episodeTitle);
    return res.json(result);
  });
}
