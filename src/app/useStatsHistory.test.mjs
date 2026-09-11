import assert from "node:assert/strict";
import test from "node:test";

import {
  createPlatformState,
  createRuntimeMeta,
  createStatsState,
} from "./app-utils.js";
import {
  createPlatformStatesWithHistory,
  createStatsHistoryController,
  getMergedStatsHistoryEntries,
  persistStatsHistoryEntries,
} from "./useStatsHistory.js";

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
