import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRevenueSummary,
  createStatsHistoryEntry,
  loadPersistedHistoryEntries,
  resolveRevenueSummaryForHistory,
  savePersistedHistoryEntries,
  selectDramaEpisodesByMode,
  STATS_HISTORY_STORAGE_KEY,
} from "./app-utils.js";

function createRevenueDrama(overrides = {}) {
  return {
    platform: "missevan",
    title: "示例作品",
    paidUserCount: 12,
    paidUserIds: [101, 202, 303],
    rewardCoinTotal: 180,
    viewCount: 56000,
    estimatedRevenueYuan: 88,
    includeInSummaryPrice: true,
    titlePrice: 24,
    ...overrides,
  };
}

function createStorageMock() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

test("resolveRevenueSummaryForHistory rebuilds underpopulated summaries from results", () => {
  const revenueResults = [createRevenueDrama()];
  const staleSummary = {
    platform: "missevan",
    failed: false,
    estimatedRevenueYuan: 0,
    minRevenueYuan: null,
    maxRevenueYuan: null,
    totalPaidUserCount: 0,
    totalPayCount: 0,
    totalDanmakuPaidUserCount: 0,
    paidCountSourceSummary: "danmaku_ids",
    selectedDramaCount: 1,
    totalViewCount: 0,
    rewardTotal: 0,
    rewardNum: null,
    hasSummaryPrice: false,
    summaryTitle: "汇总 / 已选 1 部",
  };

  const resolvedSummary = resolveRevenueSummaryForHistory(revenueResults, "missevan", staleSummary);

  assert.equal(resolvedSummary.estimatedRevenueYuan, 88);
  assert.equal(resolvedSummary.totalViewCount, 56000);
  assert.equal(resolvedSummary.rewardTotal, 180);
});

test("createStatsHistoryEntry keeps successful revenue items when some dramas fail", () => {
  const successfulDrama = createRevenueDrama({ title: "成功作品" });
  const failedDrama = createRevenueDrama({
    title: "失败作品",
    failed: true,
    paidUserCount: 0,
    paidUserIds: [],
    rewardCoinTotal: 0,
    viewCount: 0,
    estimatedRevenueYuan: 0,
    includeInSummaryPrice: false,
    titlePrice: 0,
  });

  const stats = {
    activeTaskType: "revenue",
    revenueResults: [successfulDrama, failedDrama],
    revenueSummary: buildRevenueSummary([successfulDrama, failedDrama], "missevan"),
  };

  const historyEntry = createStatsHistoryEntry("missevan", stats, {
    taskType: "revenue",
    createdAt: 1710000000000,
  });

  assert.ok(historyEntry, "expected a history entry for partial-success revenue results");
  assert.equal(historyEntry.items.length, 1);
  assert.equal(historyEntry.items[0].title, "成功作品");
});

test("createStatsHistoryEntry includes total danmaku in id summary for multi-drama results", () => {
  const stats = {
    activeTaskType: "id",
    totalDanmaku: 12345,
    totalUsers: 23,
    idResults: [
      { dramaId: 101, title: "作品一", danmaku: 6000, users: 10 },
      { dramaId: 202, title: "作品二", danmaku: 6345, users: 13 },
    ],
  };

  const historyEntry = createStatsHistoryEntry("missevan", stats, {
    taskType: "id",
    createdAt: 1710000000000,
  });

  assert.ok(historyEntry, "expected an id history entry");
  assert.deepEqual(historyEntry.summaryMetrics, [
    { key: "danmakuCount", label: "总弹幕数", value: "12345" },
    { key: "uniqueUsers", label: "去重 ID", value: "23" },
  ]);
});

test("loadPersistedHistoryEntries returns empty platform histories when storage is unavailable", () => {
  assert.deepEqual(loadPersistedHistoryEntries(null), {
    missevan: [],
    manbo: [],
  });
});

test("loadPersistedHistoryEntries ignores blocked browser storage", () => {
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      get localStorage() {
        throw new DOMException("Blocked", "SecurityError");
      },
    },
  });

  try {
    assert.deepEqual(loadPersistedHistoryEntries(), {
      missevan: [],
      manbo: [],
    });
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: previousWindow,
      });
    }
  }
});

test("savePersistedHistoryEntries persists versioned per-platform histories", () => {
  const storage = createStorageMock();
  const historyEntry = {
    id: "missevan-id-1",
    platform: "missevan",
    createdAt: 1710000000000,
    createdAtLabel: "2024-03-09 16:00",
    taskType: "id",
    summaryMetrics: [{ key: "uniqueUsers", label: "去重 ID", value: "12" }],
    items: [
      {
        id: "123",
        title: "示例作品",
        segments: [{ key: "uniqueUsers", metricKey: "uniqueUsers", label: "去重 ID", value: "12", unit: "ID" }],
      },
    ],
  };

  savePersistedHistoryEntries(
    {
      missevan: [historyEntry],
      manbo: [],
    },
    storage
  );

  const raw = JSON.parse(storage.getItem(STATS_HISTORY_STORAGE_KEY));
  assert.equal(raw.version, 1);
  assert.equal(raw.missevan.length, 1);
  assert.equal(raw.missevan[0].id, "missevan-id-1");
  assert.equal(raw.missevan[0].items[0].segments[0].metricKey, "uniqueUsers");
  assert.deepEqual(loadPersistedHistoryEntries(storage), {
    missevan: [historyEntry],
    manbo: [],
  });
});

test("loadPersistedHistoryEntries restores segment key for icon mapping", () => {
  const storage = createStorageMock();
  storage.setItem(
    STATS_HISTORY_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      missevan: [
        {
          id: "missevan-id-2",
          platform: "missevan",
          createdAt: 1710000000001,
          createdAtLabel: "2024/3/9 16:00:01",
          taskType: "id",
          summaryMetrics: [],
          items: [
            {
              id: "456",
              title: "恢复作品",
              segments: [{ metricKey: "danmakuCount", label: "总弹幕数", value: "18" }],
            },
          ],
        },
      ],
      manbo: [],
    })
  );

  const restored = loadPersistedHistoryEntries(storage);
  assert.equal(restored.missevan[0].items[0].segments[0].metricKey, "danmakuCount");
  assert.equal(restored.missevan[0].items[0].segments[0].key, "danmakuCount");
});

test("loadPersistedHistoryEntries falls back to empty histories for corrupted data", () => {
  const storage = createStorageMock();
  storage.setItem(STATS_HISTORY_STORAGE_KEY, "{not-json");

  assert.deepEqual(loadPersistedHistoryEntries(storage), {
    missevan: [],
    manbo: [],
  });
});

test("selectDramaEpisodesByMode selects all or matching episodes and expands selected dramas", () => {
  const dramas = [
    {
      drama: { id: "101", name: "作品一" },
      expanded: false,
      episodes: {
        episode: [
          { sound_id: "1", selected: false, need_pay: true },
          { sound_id: "2", selected: false, need_pay: false },
        ],
      },
    },
    {
      drama: { id: "202", name: "作品二" },
      expanded: false,
      episodes: {
        episode: [{ sound_id: "3", selected: false, need_pay: true }],
      },
    },
  ];

  const allResult = selectDramaEpisodesByMode(dramas, ["101"], {
    mode: "all",
    checked: true,
    expand: true,
    isSelectableEpisode: (episode) => episode.need_pay === true,
  });

  assert.equal(allResult.hasMatchingEpisode, true);
  assert.equal(dramas[0].expanded, true);
  assert.deepEqual(dramas[0].episodes.episode.map((episode) => episode.selected), [true, true]);
  assert.deepEqual(dramas[1].episodes.episode.map((episode) => episode.selected), [false]);

  const paidResult = selectDramaEpisodesByMode(dramas, ["101", "202"], {
    mode: "paid",
    checked: false,
    expand: false,
    isSelectableEpisode: (episode) => episode.need_pay === true,
  });

  assert.equal(paidResult.hasMatchingEpisode, true);
  assert.deepEqual(dramas[0].episodes.episode.map((episode) => episode.selected), [false, true]);
  assert.deepEqual(dramas[1].episodes.episode.map((episode) => episode.selected), [false]);
});
