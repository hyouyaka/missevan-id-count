import assert from "node:assert/strict";
import test from "node:test";
import { buildPaidCoefficientBasis } from "../../shared/paidCoefficient.js";
import { setPaidCoefficient } from "./paidCoefficientStore.js";

import {
  createPlatformState,
  createRuntimeMeta,
  createStatsState,
  createStatsHistoryEntry,
  savePersistedHistoryEntries,
  loadPersistedHistoryEntries,
} from "./app-utils.js";
import {
  createPlatformStatesWithHistory,
  createStatsHistoryController,
  getMergedStatsHistoryEntries,
  persistStatsHistoryEntries,
} from "./useStatsHistory.js";

test("completed revenue freezes the current platform coefficient and survives history persistence", () => {
  const harness = createHistoryHarness({ createStatsHistoryEntry });
  const base = { dramaId: "10", title: "测试", platform: "missevan", revenueType: "season", paidUserCount: 10, rewardCoinTotal: 50, estimatedRevenueYuan: 15 };
  const result = { ...base, paidCoefficientBasis: buildPaidCoefficientBasis(base) };
  const snapshot = { result: { revenueResults: [result] } };
  setPaidCoefficient("missevan", 4);
  harness.controller.recordCompletedStatsHistory("missevan", "revenue", "first", snapshot);
  const entry = harness.getPlatformStates().missevan.historyEntries[0];
  assert.equal(entry.items[0].paidCoefficient, 4);
  assert.equal(entry.items[0].segments.find((item) => item.metricKey === "revenue").value, "45");
  setPaidCoefficient("missevan", 8);
  assert.equal(entry.items[0].paidCoefficient, 4);
  assert.equal(entry.items[0].segments.find((item) => item.metricKey === "revenue").value, "45");
  harness.controller.recordCompletedStatsHistory("missevan", "revenue", "second", snapshot);
  assert.equal(harness.getPlatformStates().missevan.historyEntries[0].items[0].paidCoefficient, 8);
  assert.equal(result.estimatedRevenueYuan, 15);
  let serialized;
  const storage = { setItem(_key, value) { serialized = value; }, getItem() { return serialized; } };
  savePersistedHistoryEntries({ missevan: [entry], manbo: [] }, storage);
  const restored = loadPersistedHistoryEntries(storage);
  assert.equal(restored.missevan[0].items[0].paidCoefficient, 4);
  setPaidCoefficient("missevan", 1);
});

test("Manbo history freezes each drama's effective fractional or integer coefficient", () => {
  const harness = createHistoryHarness({ createStatsHistoryEntry });
  const base = { dramaId: "special", title: "特殊单集", platform: "manbo", revenueType: "episode", payCount: 76, seasonPaidUserCount: 10, episodePaidUserCountTotal: 20, paidEpisodeCount: 2, minimumEpisodePrice: 10, diamondValue: 500, estimatedRevenueYuan: 12.6, minRevenueYuan: 12.6, maxRevenueYuan: 81 };
  const ordinary = { ...base, dramaId: "ordinary", title: "普通单集", payCount: 0 };
  setPaidCoefficient("manbo", 9);
  harness.controller.recordCompletedStatsHistory("manbo", "revenue", "fractional", {
    result: { revenueResults: [base, ordinary].map((result) => ({ ...result, paidCoefficientBasis: buildPaidCoefficientBasis(result) })) },
  });
  const entry = harness.getPlatformStates().manbo.historyEntries[0];
  assert.deepEqual(entry.items.map((item) => item.paidCoefficient), [7.6, 9]);
  setPaidCoefficient("manbo", 1);
  assert.deepEqual(entry.items.map((item) => item.paidCoefficient), [7.6, 9]);
});

function createHistoryHarness(overrides = {}) {
  let platformStates = {
    missevan: {
      ...createPlatformState(),
      stats: {
        ...createStatsState(),
        idResults: [{ dramaId: "base" }],
        totalDanmaku: 3,
      },
    },
    manbo: createPlatformState(),
  };
  const runtimeMetas = {
    missevan: createRuntimeMeta(),
    manbo: createRuntimeMeta(),
  };
  const createdEntries = [];
  const controller = createStatsHistoryController({
    createStatsHistoryEntry(platform, stats, options) {
      createdEntries.push({ platform, stats, options });
      return {
        id: `${platform}-${options.taskType}-${options.createdAt}`,
        platform,
        createdAt: options.createdAt,
        taskType: options.taskType,
        items: [{ id: "entry" }],
      };
    },
    getPlatformStates: () => platformStates,
    getRuntimeMeta: (platform) => runtimeMetas[platform],
    now: () => 1710000000000,
    updatePlatformState(platform, updater) {
      platformStates = {
        ...platformStates,
        [platform]: updater(platformStates[platform]),
      };
    },
    ...overrides,
  });

  return {
    controller,
    createdEntries,
    getPlatformStates: () => platformStates,
    runtimeMetas,
  };
}

test("history state initialization restores each platform independently", () => {
  let stateCalls = 0;
  const states = createPlatformStatesWithHistory({
    createPlatformState: () => ({ marker: ++stateCalls, historyEntries: ["discarded"] }),
    loadHistoryEntries: () => ({
      missevan: [{ id: "m-1" }],
      manbo: [{ id: "b-1" }],
    }),
  });

  assert.deepEqual(states.missevan.historyEntries, [{ id: "m-1" }]);
  assert.deepEqual(states.manbo.historyEntries, [{ id: "b-1" }]);
  assert.equal(states.missevan.marker, 1);
  assert.equal(states.manbo.marker, 2);
});

test("history persistence normalizes missing platform arrays", () => {
  let saved = null;
  persistStatsHistoryEntries(
    {
      missevan: [{ id: "m-1" }],
      manbo: "not-an-array",
    },
    (nextHistory) => {
      saved = nextHistory;
    }
  );

  assert.deepEqual(saved, {
    missevan: [{ id: "m-1" }],
    manbo: [],
  });
});

test("completed stats history keeps completion data and records each task once", () => {
  const harness = createHistoryHarness();
  const snapshot = {
    taskId: "task-1",
    totalDanmaku: 101,
    totalUsers: 12,
    result: {
      idResults: [{ dramaId: "fresh" }],
      idSelectedEpisodeCount: 4,
    },
  };

  const entryId = harness.controller.recordCompletedStatsHistory("missevan", "id", "task-1", snapshot);
  const duplicateEntryId = harness.controller.recordCompletedStatsHistory("missevan", "id", "task-1", snapshot);
  const state = harness.getPlatformStates().missevan;

  assert.equal(entryId, "missevan-id-1710000000000");
  assert.equal(duplicateEntryId, "");
  assert.equal(state.historyEntries.length, 1);
  assert.equal(state.stats.currentHistoryEntryId, entryId);
  assert.equal(harness.createdEntries[0].stats.totalDanmaku, 101);
  assert.equal(harness.createdEntries[0].stats.totalUsers, 12);
  assert.deepEqual(harness.createdEntries[0].stats.idResults, [{ dramaId: "fresh" }]);
  assert.equal(harness.createdEntries[0].stats.idSelectedEpisodeCount, 4);
});

test("completed history carries the replay snapshot bound to its run", () => {
  const harness = createHistoryHarness();
  const replay = { version: 1, operation: "revenue", dramaIds: ["100", "200"] };
  harness.controller.recordCompletedStatsHistory("missevan", "revenue", "task-replay", {
    taskId: "task-replay",
    result: { revenueResults: [{ dramaId: "100" }] },
  }, replay);

  assert.deepEqual(harness.createdEntries[0].options.replay, replay);
});

test("history entries respect the cap and can be deleted or cleared", () => {
  const harness = createHistoryHarness({ historyLimit: 2 });

  harness.controller.appendHistoryEntry("missevan", { id: "old", createdAt: 1 }, "task-old");
  harness.controller.appendHistoryEntry("missevan", { id: "middle", createdAt: 2 }, "task-middle");
  harness.controller.appendHistoryEntry("missevan", { id: "new", createdAt: 3 }, "task-new");
  harness.controller.appendHistoryEntry("manbo", { id: "manbo", createdAt: 4 }, "task-manbo");

  assert.deepEqual(
    harness.getPlatformStates().missevan.historyEntries.map((entry) => entry.id),
    ["new", "middle"]
  );

  harness.controller.deleteHistoryEntry("missevan", "middle");
  assert.deepEqual(
    harness.getPlatformStates().missevan.historyEntries.map((entry) => entry.id),
    ["new"]
  );

  harness.controller.clearAllHistoryEntries();
  assert.deepEqual(harness.getPlatformStates().missevan.historyEntries, []);
  assert.deepEqual(harness.getPlatformStates().manbo.historyEntries, []);
});

test("merged history uses render state for display and labels each platform", () => {
  const renderStates = {
    missevan: {
      historyEntries: [{ id: "m-render", createdAt: 30 }],
    },
    manbo: {
      historyEntries: [{ id: "b-render", createdAt: 20, platform: "manbo" }],
    },
  };
  const latestStates = {
    missevan: {
      historyEntries: [{ id: "m-latest", createdAt: 10 }],
    },
    manbo: { historyEntries: [] },
  };
  const controller = createStatsHistoryController({
    getPlatformStates: () => latestStates,
    platformStates: renderStates,
  });

  assert.deepEqual(
    controller.getMergedHistoryEntries().map((entry) => [entry.id, entry.platformLabel]),
    [
      ["m-render", "猫耳"],
      ["b-render", "漫播"],
    ]
  );
  assert.deepEqual(
    getMergedStatsHistoryEntries(renderStates).map((entry) => entry.id),
    ["m-render", "b-render"]
  );
});
