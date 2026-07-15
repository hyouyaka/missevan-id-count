export function registerManboRoutes(router, {
  buildCompatibilitySearchUsageLog,
  buildKeywordTooShortSearchResponse,
  buildMainCvText,
  buildManboApiSearchFallbackCard,
  buildManboContentTypeLabel,
  buildManboSearchFallbackCard,
  buildSearchPageMeta,
  dramaService,
  ensureInfoStoreLoaded,
  expensiveDataLimiter,
  fetchManboDanmakuSummary,
  fetchManboSearchApiRecords,
  fetchManboSetSummary,
  filterUntrackedNewDramaIds,
  fireAndForget,
  getManboMainCvNames,
  hydrateManboSearchRecord,
  isAccessDeniedError,
  manboInfoStore,
  mapWithConcurrency,
  normalizeDramaCardUsageAction,
  normalizeKeyword,
  normalizeManboCardFromDramaInfo,
  normalizeRawInputItems,
  normalizeSearchLimit,
  normalizeSearchOffset,
  normalizeStatsTaskSource,
  normalizeStringIds,
  normalizeStringArray,
  normalizeTextValue,
  queueNewDramaIdsAppend,
  resolveManboItem,
  searchLibraryWithFallback,
  searchManboLibraryRecords,
  selectManboSearchSourceRecords,
  shouldUseMissevanApiFallback,
  sleep,
  writeUsageLog,
  SEARCH_RESULT_LIMIT,
  isSearchKeywordLongEnough,
}) {
  router.post("/manbo/resolve-input", expensiveDataLimiter, async (req, res) => {
    const items = normalizeRawInputItems(req.body.items || []);
    const results = [];

    for (const item of items) {
      try {
        const localRecord = /^\d+$/.test(String(item.raw ?? ""))
          ? manboInfoStore.byDramaId.get(String(item.raw))
          : null;
        if (localRecord) {
          results.push({
            ...buildManboSearchFallbackCard(localRecord),
            checked: true,
          });
          continue;
        }
        const resolved = await resolveManboItem(item);
        results.push({
          raw: item.raw,
          success: Boolean(resolved),
          resolved: resolved || null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          raw: item.raw,
          success: false,
          resolved: null,
          accessDenied:
            isAccessDeniedError(error) ||
            String(message).startsWith("ACCESS_DENIED_COOLDOWN:"),
          error: message,
        });
      }
    }

    return res.json({ success: true, results });
  });

  router.get("/manbo/search", expensiveDataLimiter, async (req, res) => {
    const keyword = normalizeKeyword(req.query.keyword);
    const offset = normalizeSearchOffset(req.query.offset);
    const limit = normalizeSearchLimit(req.query.limit, 5, 5);
    const useApiFallback = shouldUseMissevanApiFallback(req.query.apiFallback);
    if (!keyword) {
      return res.json({
        success: false,
        results: [],
        meta: {
          keyword: "",
          recordCount: 0,
        },
      });
    }

    if (!isSearchKeywordLongEnough(keyword)) {
      return res.json(
        buildKeywordTooShortSearchResponse(keyword, offset, limit, {
          hydratedCount: 0,
        })
      );
    }

    void writeUsageLog({
      platform: "manbo",
      action: "search",
      keyword,
    });

    try {
      await ensureInfoStoreLoaded(manboInfoStore);
      const librarySearch = await searchLibraryWithFallback({
        keyword,
        libraryOnly: true,
        searchLibrary(searchKeyword, mode) {
          if (mode === "compatible") {
            void writeUsageLog(buildCompatibilitySearchUsageLog("manbo", keyword));
          }
          return searchManboLibraryRecords(
            manboInfoStore.records,
            searchKeyword,
            SEARCH_RESULT_LIMIT,
            mode
          );
        },
      });
      const matchedRecords = librarySearch.items;
      if (!matchedRecords.length && !useApiFallback) {
        return res.json({
          success: false,
          results: [],
          meta: {
            ...buildSearchPageMeta(keyword, 0, offset, limit),
            source: "library_only",
            hydratedCount: 0,
          },
        });
      }

      if (!matchedRecords.length) {
        const apiRecords = await fetchManboSearchApiRecords(keyword, { logApiCall: true });
        const sourceSelection = selectManboSearchSourceRecords(matchedRecords, apiRecords);
        const apiResults = sourceSelection.records.map(buildManboApiSearchFallbackCard);
        return res.json({
          success: apiResults.length > 0,
          results: apiResults,
          meta: {
            ...buildSearchPageMeta(keyword, apiResults.length, 0, 20),
            source: sourceSelection.source,
            offset: 0,
            limit: 20,
            nextOffset: apiResults.length,
            hasMore: false,
            hydratedCount: apiResults.length,
          },
        });
      }

      const pagedRecords = matchedRecords.slice(offset, offset + limit);
      const hydratedResults = await mapWithConcurrency(
        pagedRecords,
        4,
        hydrateManboSearchRecord
      );
      const meta = buildSearchPageMeta(
        keyword,
        matchedRecords.length,
        offset,
        limit
      );

      return res.json({
        success: matchedRecords.length > 0,
        results: hydratedResults,
        meta: {
          ...meta,
          source: "library",
          hydratedCount: hydratedResults.length,
        },
      });
    } catch (error) {
      console.error(`Failed to search Manbo library keyword=${keyword}`, error);
      return res.status(500).json({
        success: false,
        results: [],
        meta: {
          keyword,
          matchedCount: 0,
          hydratedCount: 0,
        },
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post("/manbo/getdramacards", expensiveDataLimiter, async (req, res) => {
    const items = normalizeRawInputItems(req.body.items || []);
    const usageAction = normalizeDramaCardUsageAction(req.body.usageAction);
    const usageTitles = normalizeStringArray(req.body?.titles, items.length);
    const usageSource = normalizeStatsTaskSource(req.body?.source);
    const results = [];
    const failedItems = [];
    let accessDenied = false;

    if (items.length) {
      void writeUsageLog({
        platform: "manbo",
        action: usageAction,
        items: items.map((item) => item.raw),
        ...(usageTitles.length ? { titles: usageTitles } : {}),
        ...(usageSource ? { source: usageSource } : {}),
        count: items.length,
      });
    }

    await ensureInfoStoreLoaded(manboInfoStore);
    const newDramaIds = [];
    for (const item of items) {
      const localRecord = /^\d+$/.test(String(item.raw ?? ""))
        ? manboInfoStore.byDramaId.get(String(item.raw))
        : null;
      if (localRecord) {
        results.push({
          ...buildManboSearchFallbackCard(localRecord),
          checked: true,
        });
        continue;
      }

      try {
        const resolved = await resolveManboItem(item);
        if (!resolved?.dramaId) {
          failedItems.push(item.raw);
          continue;
        }

        const info = await dramaService.getManboDrama(resolved.dramaId);
        const card = normalizeManboCardFromDramaInfo(info);
        if (card) {
          const libraryRecord = manboInfoStore.byDramaId.get(String(card.id));
          const mainCvs = getManboMainCvNames(libraryRecord);
          const nextCard = {
            ...card,
          };
          if (libraryRecord) {
            nextCard.content_type_label = buildManboContentTypeLabel(libraryRecord) || nextCard.content_type_label;
            nextCard.author = normalizeTextValue(libraryRecord.author) || nextCard.author;
          }
          if (libraryRecord && mainCvs.length > 0) {
            nextCard.main_cvs = mainCvs;
            nextCard.main_cv_text = buildMainCvText(mainCvs);
          } else if (!libraryRecord) {
            newDramaIds.push(String(resolved.dramaId));
          }
          results.push(nextCard);
        } else {
          failedItems.push(item.raw);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        accessDenied =
          accessDenied ||
          isAccessDeniedError(error) ||
          String(message).startsWith("ACCESS_DENIED_COOLDOWN:");
        console.error(`Failed to fetch Manbo drama card input=${item.raw}`, error);
        failedItems.push(item.raw);
      }
    }

    const dedupedResults = Array.from(
      new Map(results.map((item) => [String(item.id), item])).values()
    );

    if (newDramaIds.length > 0) {
      fireAndForget("Failed to append new Manbo drama ids", async () => {
        const missingDramaIds = await filterUntrackedNewDramaIds("manbo", newDramaIds);
        if (missingDramaIds.length > 0) {
          await queueNewDramaIdsAppend("manbo", missingDramaIds);
        }
      });
    }

    return res.json({
      success: dedupedResults.length > 0,
      results: dedupedResults,
      failedItems,
      accessDenied,
    });
  });

  router.post("/manbo/getdramas", expensiveDataLimiter, async (req, res) => {
    const ids = normalizeStringIds(req.body.drama_ids || []);
    const results = [];

    for (const id of ids) {
      try {
        const info = await dramaService.getManboDrama(id);
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
        const accessDenied =
          isAccessDeniedError(error) ||
          String(error?.message || error).startsWith("ACCESS_DENIED_COOLDOWN:");
        console.error(`Failed to fetch Manbo drama drama_id=${id}`, error);
        results.push({ success: false, id, accessDenied });
      }
    }

    return res.json(results);
  });

  router.post("/manbo/getsetsummary", expensiveDataLimiter, async (req, res) => {
    const setIds = normalizeStringIds(req.body.set_ids || req.body.sound_ids || []);
    const results = [];

    for (const setId of setIds) {
      try {
        results.push(await fetchManboSetSummary(setId));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to fetch Manbo set summary set_id=${setId}`, error);
        results.push({
          sound_id: Number(setId),
          success: false,
          view_count: null,
          viewCountWan: "",
          playCountFailed: true,
          accessDenied:
            isAccessDeniedError(error) ||
            String(message).startsWith("ACCESS_DENIED_COOLDOWN:"),
          error: message,
        });
      }

      await sleep(200);
    }

    return res.json(results);
  });

  router.post("/manbo/getsetdanmaku", expensiveDataLimiter, async (req, res) => {
    const {
      sound_id: setId,
      drama_title: dramaTitle = "",
      episode_title: episodeTitle = "",
    } = req.body;

    if (!setId) {
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

    const result = await fetchManboDanmakuSummary(setId, dramaTitle, episodeTitle);
    return res.json(result);
  });
}
