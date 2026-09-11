function cloneSearchResults(results) {
  return Array.isArray(results) ? results.map((item) => ({ ...item })) : [];
}

function resolveSearchGeneration(meta, now) {
  const nowFn = typeof now === "function" ? now : Date.now;
  const generation = Number(meta?.searchGeneration ?? nowFn());
  return generation || nowFn();
}

function preservePageCheckedResults(state, page, results) {
  return results.map((item) => {
    const previous = (state.searchPageCache?.[page] || []).find((cached) => String(cached.id) === String(item.id));
    return {
      ...item,
      checked: previous?.checked ?? item.checked,
    };
  });
}

function preserveCurrentCheckedResults(state, results) {
  return results.map((item) => {
    const previous = (state.searchResults || []).find((cached) => String(cached.id) === String(item.id));
    return {
      ...item,
      checked: previous?.checked ?? item.checked,
    };
  });
}

export function resetSearchResultsState(state) {
  return {
    ...state,
    searchResultSource: "search",
    searchKeyword: "",
    searchNextOffset: 0,
    searchHasMore: false,
    searchCurrentPage: 1,
    searchPageSize: 5,
    searchTotalMatched: 0,
    searchPageCache: {},
    isLoadingMoreResults: false,
    searchResults: [],
    dramas: [],
    selectedEpisodesSnapshot: [],
  };
}

export function setSearchResultsState(state, results, source = "search", meta = {}, options = {}) {
  const normalizedResults = cloneSearchResults(results);
  const pageSize = Number(meta?.limit ?? normalizedResults.length ?? 5) || 5;
  const offset = Number(meta?.offset ?? 0) || 0;
  const page = source === "search" ? Math.floor(offset / Math.max(1, pageSize)) + 1 : 1;
  const totalMatched = source === "search"
    ? Number(meta?.matchedCount ?? meta?.totalMatched ?? normalizedResults.length) || 0
    : 0;

  return {
    ...state,
    searchResultSource: source === "manual" ? "manual" : "search",
    searchKeyword: source === "search" ? String(meta?.keyword ?? state.searchForm.keyword ?? "").trim() : "",
    searchNextOffset: source === "search" ? Number(meta?.nextOffset ?? normalizedResults.length) || 0 : 0,
    searchHasMore: source === "search" ? Boolean(meta?.hasMore) : false,
    searchCurrentPage: page,
    searchPageSize: Math.max(1, pageSize),
    searchTotalMatched: totalMatched,
    searchGeneration: resolveSearchGeneration(meta, options.now),
    searchPageCache: source === "search" ? { [page]: normalizedResults } : {},
    isLoadingMoreResults: false,
    searchResults: normalizedResults,
  };
}

export function setManualSearchResultsState(state, results, meta = {}, options = {}) {
  const normalizedResults = cloneSearchResults(results);
  return {
    ...state,
    searchResultSource: "manual",
    searchKeyword: "",
    searchNextOffset: 0,
    searchHasMore: false,
    searchCurrentPage: 1,
    searchPageSize: Math.max(1, Number(meta?.limit ?? normalizedResults.length ?? 1) || 1),
    searchTotalMatched: 0,
    searchGeneration: resolveSearchGeneration(meta, options.now),
    searchPageCache: {},
    isLoadingMoreResults: false,
    searchResults: normalizedResults,
    dramas: [],
    selectedEpisodesSnapshot: [],
  };
}

export function setVisibleSearchResults(state, nextResults) {
  return {
    ...state,
    searchResults: nextResults,
    searchPageCache:
      state.searchResultSource === "search"
        ? {
            ...state.searchPageCache,
            [state.searchCurrentPage || 1]: nextResults,
          }
        : state.searchPageCache,
  };
}

export function getAllSearchResults(state) {
  if (state?.searchResultSource !== "search") {
    return state?.searchResults || [];
  }
  const pageCache = state?.searchPageCache || {};
  const merged = new Map();
  Object.keys(pageCache)
    .map((key) => Number(key))
    .filter((key) => Number.isFinite(key))
    .sort((left, right) => left - right)
    .forEach((page) => {
      (Array.isArray(pageCache[page]) ? pageCache[page] : []).forEach((item) => {
        merged.set(String(item.id), item);
      });
    });
  return Array.from(merged.values());
}

export function getSearchResultCount(state) {
  if (!state) {
    return 0;
  }
  if (state.searchResultSource === "search") {
    return Number(state.searchTotalMatched || getAllSearchResults(state).length || state.searchResults?.length || 0) || 0;
  }
  return Number(state.searchResults?.length ?? 0) || 0;
}

export function updateSearchResultsPage(state, page, results, meta = {}) {
  const normalizedResults = cloneSearchResults(results);
  return {
    ...state,
    searchNextOffset: Number(meta?.nextOffset ?? state.searchNextOffset) || 0,
    searchHasMore: Boolean(meta?.hasMore),
    searchCurrentPage: page,
    searchPageSize: Number(meta?.limit ?? state.searchPageSize ?? 5) || 5,
    searchTotalMatched: Number(meta?.matchedCount ?? meta?.totalMatched ?? state.searchTotalMatched ?? normalizedResults.length) || 0,
    searchPageCache: {
      ...state.searchPageCache,
      [page]: preservePageCheckedResults(state, page, normalizedResults),
    },
    isLoadingMoreResults: false,
    searchResults: preservePageCheckedResults(state, page, normalizedResults),
  };
}

export function mergeSearchResults(existingResults = [], incomingResults = []) {
  const existingById = new Map(existingResults.map((item) => [String(item.id), item]));
  const mergedById = new Map();
  existingResults.forEach((item) => {
    mergedById.set(String(item.id), item);
  });
  incomingResults.forEach((item) => {
    const previous = existingById.get(String(item.id));
    mergedById.set(String(item.id), {
      ...item,
      checked: previous?.checked ?? item.checked,
    });
  });
  return Array.from(mergedById.values());
}

export function appendSearchResultsPage(state, incomingResults, meta = {}) {
  const mergedResults = mergeSearchResults(state.searchResults || [], incomingResults);
  const totalMatched = Number(meta.totalMatched) || 0;
  const page = meta.page;
  return {
    ...state,
    searchNextOffset: Number(meta.nextOffset) || 0,
    searchHasMore: Boolean(meta.hasMore) && (!totalMatched || mergedResults.length < totalMatched),
    searchCurrentPage: page,
    searchPageSize: meta.pageSize,
    searchTotalMatched: totalMatched,
    searchPageCache: {
      ...state.searchPageCache,
      [page]: preserveCurrentCheckedResults(state, incomingResults),
    },
    isLoadingMoreResults: false,
    searchResults: mergedResults,
  };
}
