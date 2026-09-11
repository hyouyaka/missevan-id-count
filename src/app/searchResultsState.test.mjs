import assert from "node:assert/strict";
import test from "node:test";

import {
  appendSearchResultsPage,
  getAllSearchResults,
  getSearchResultCount,
  mergeSearchResults,
  resetSearchResultsState,
  setManualSearchResultsState,
  setSearchResultsState,
  setVisibleSearchResults,
  updateSearchResultsPage,
} from "./searchResultsState.js";

function createSearchState(overrides = {}) {
  return {
    customValue: "kept",
    dramas: [{ drama: { id: "drama-1" } }],
    isLoadingMoreResults: true,
    searchForm: { keyword: " initial keyword " },
    searchGeneration: 3,
    searchHasMore: true,
    searchKeyword: "old keyword",
    searchNextOffset: 5,
    searchPageCache: {
      1: [{ id: "old", checked: true }],
    },
    searchCurrentPage: 1,
    searchPageSize: 5,
    searchResultSource: "search",
    searchResults: [{ id: "old", checked: true }],
    searchTotalMatched: 9,
    selectedEpisodesSnapshot: [{ sound_id: "sound-1" }],
    ...overrides,
  };
}

test("search result setup keeps generic and manual-import semantics separate", () => {
  const base = createSearchState();
  const results = [{ id: "one", title: "first" }];
  const searchState = setSearchResultsState(base, results, "search", {
    hasMore: true,
    keyword: "  next keyword  ",
    limit: 2,
    matchedCount: 9,
    nextOffset: 4,
    offset: 2,
  }, { now: () => 101 });

  assert.equal(searchState.searchResultSource, "search");
  assert.equal(searchState.searchKeyword, "next keyword");
  assert.equal(searchState.searchCurrentPage, 2);
  assert.equal(searchState.searchPageSize, 2);
  assert.equal(searchState.searchNextOffset, 4);
  assert.equal(searchState.searchHasMore, true);
  assert.equal(searchState.searchTotalMatched, 9);
  assert.equal(searchState.searchGeneration, 101);
  assert.deepEqual(searchState.searchPageCache, { 2: [{ id: "one", title: "first" }] });
  assert.notStrictEqual(searchState.searchResults[0], results[0]);
  results[0].title = "mutated after setup";
  assert.equal(searchState.searchResults[0].title, "first");

  const genericManualState = setSearchResultsState(base, [], "manual", {}, { now: () => 102 });
  assert.equal(genericManualState.searchResultSource, "manual");
  assert.equal(genericManualState.searchPageSize, 5);
  assert.equal(genericManualState.searchGeneration, 102);
  assert.deepEqual(genericManualState.dramas, base.dramas);
  assert.deepEqual(genericManualState.selectedEpisodesSnapshot, base.selectedEpisodesSnapshot);

  const manualImportState = setManualSearchResultsState(base, [], {}, { now: () => 103 });
  assert.equal(manualImportState.searchResultSource, "manual");
  assert.equal(manualImportState.searchPageSize, 1);
  assert.equal(manualImportState.searchGeneration, 103);
  assert.deepEqual(manualImportState.dramas, []);
  assert.deepEqual(manualImportState.selectedEpisodesSnapshot, []);
  assert.deepEqual(manualImportState.searchPageCache, {});
});

test("search result collection sorts pages, updates duplicate payloads, and counts results", () => {
  const state = createSearchState({
    searchPageCache: {
      2: [
        { id: "two", title: "page two" },
        { id: "shared", checked: true, title: "old shared" },
      ],
      10: [
        { id: "shared", checked: false, title: "new shared" },
        { id: "ten", title: "page ten" },
      ],
      ignored: [{ id: "ignored" }],
    },
    searchTotalMatched: 0,
  });

  assert.deepEqual(getAllSearchResults(state), [
    { id: "two", title: "page two" },
    { id: "shared", checked: false, title: "new shared" },
    { id: "ten", title: "page ten" },
  ]);
  assert.equal(getSearchResultCount(state), 3);
  assert.equal(getSearchResultCount({ ...state, searchTotalMatched: 12 }), 12);
  assert.equal(getSearchResultCount({
    ...state,
    searchResultSource: "manual",
    searchResults: [{ id: "manual-one" }, { id: "manual-two" }],
  }), 2);
});

test("page updates preserve checked state while visible edits stay on the active search page", () => {
  const state = createSearchState({
    searchCurrentPage: 2,
    searchPageCache: {
      2: [{ id: "kept", checked: true, title: "old title" }],
    },
  });
  const incoming = [
    { id: "kept", checked: false, title: "new title" },
    { id: "new", checked: true, title: "new item" },
  ];
  const updated = updateSearchResultsPage(state, 2, incoming, {
    hasMore: true,
    limit: 5,
    matchedCount: 13,
    nextOffset: 10,
  });

  assert.equal(updated.searchNextOffset, 10);
  assert.equal(updated.searchHasMore, true);
  assert.equal(updated.searchPageSize, 5);
  assert.equal(updated.searchTotalMatched, 13);
  assert.equal(updated.searchResults[0].checked, true);
  assert.equal(updated.searchPageCache[2][0].checked, true);
  assert.notStrictEqual(updated.searchResults, updated.searchPageCache[2]);
  incoming[0].title = "mutated after update";
  assert.equal(updated.searchResults[0].title, "new title");

  const visible = setVisibleSearchResults(updated, [{ id: "visible", checked: true }]);
  assert.deepEqual(visible.searchPageCache[2], [{ id: "visible", checked: true }]);
  const manualState = { ...updated, searchResultSource: "manual" };
  const manualVisible = setVisibleSearchResults(manualState, [{ id: "manual-visible" }]);
  assert.strictEqual(manualVisible.searchPageCache, manualState.searchPageCache);
});

test("loading another page merges stable selection state and stops at the matched total", () => {
  const existing = [
    { id: "one", checked: true, title: "old one" },
    { id: "two", checked: false, title: "two" },
  ];
  const incoming = [
    { id: "one", checked: false, title: "updated one" },
    { id: "three", checked: true, title: "three" },
  ];

  assert.deepEqual(mergeSearchResults(existing, incoming), [
    { id: "one", checked: true, title: "updated one" },
    { id: "two", checked: false, title: "two" },
    { id: "three", checked: true, title: "three" },
  ]);

  const appended = appendSearchResultsPage(createSearchState({
    searchPageCache: { 1: existing },
    searchResults: existing,
  }), incoming, {
    hasMore: true,
    nextOffset: 4,
    page: 2,
    pageSize: 2,
    totalMatched: 3,
  });

  assert.equal(appended.searchCurrentPage, 2);
  assert.equal(appended.searchPageSize, 2);
  assert.equal(appended.searchNextOffset, 4);
  assert.equal(appended.searchTotalMatched, 3);
  assert.equal(appended.searchHasMore, false);
  assert.equal(appended.searchResults[0].checked, true);
  assert.equal(appended.searchPageCache[2][0].checked, true);
  assert.equal(appended.isLoadingMoreResults, false);
});

test("resetting search state clears result flow while retaining unrelated state", () => {
  const reset = resetSearchResultsState(createSearchState());

  assert.equal(reset.customValue, "kept");
  assert.equal(reset.searchResultSource, "search");
  assert.equal(reset.searchKeyword, "");
  assert.equal(reset.searchCurrentPage, 1);
  assert.equal(reset.searchPageSize, 5);
  assert.equal(reset.searchTotalMatched, 0);
  assert.equal(reset.searchHasMore, false);
  assert.deepEqual(reset.searchResults, []);
  assert.deepEqual(reset.searchPageCache, {});
  assert.deepEqual(reset.dramas, []);
  assert.deepEqual(reset.selectedEpisodesSnapshot, []);
});
