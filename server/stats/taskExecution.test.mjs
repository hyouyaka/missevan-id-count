import assert from "node:assert/strict";
import test from "node:test";

import {
  isMissevanLikelyDanmakuOverflow,
  orderDetectedOverflowEpisodeKeys,
} from "../../shared/episodeRules.js";
import { createStatsTaskExecutor } from "./taskExecution.js";

function buildIdDramaMap(episodes) {
  const dramas = new Map();
  episodes.forEach((episode) => {
    const dramaId = String(episode.drama_id);
    if (!dramas.has(dramaId)) {
      dramas.set(dramaId, {
        dramaId,
        title: episode.drama_title,
        selectedEpisodeCount: 0,
        danmaku: 0,
        userSet: new Set(),
      });
    }
    dramas.get(dramaId).selectedEpisodeCount += 1;
  });
  return dramas;
}

function createIdTask(platform, episodes) {
  return {
    platform,
    taskType: "id",
    episodes,
    source: "test",
    totalCount: episodes.length,
    completedCount: 0,
    failedCount: 0,
    totalDanmaku: 0,
    totalUsers: 0,
    accessDenied: false,
    cancelled: false,
    abortSignal: new AbortController().signal,
  };
}

function createDependencies(overrides = {}) {
  return {
    buildIdDramaMap,
    buildOverflowEpisodeKey(dramaId, episodeTitle) {
      return `${String(dramaId)}-${String(episodeTitle)}`;
    },
    isAccessDeniedError: () => false,
    isManboMemberDramaInfo: () => false,
    isMissevanAccessDenied: () => false,
    isMissevanLikelyDanmakuOverflow,
    MANBO_STATS_EPISODE_CONCURRENCY: 4,
    normalizeOptionalFiniteNumber: () => null,
    orderDetectedOverflowEpisodeKeys,
    refreshMissevanCooldownState: async () => {},
    reportStatsTask(task, patch) {
      Object.assign(task, patch);
      return patch;
    },
    runWithConcurrency: async (items, _limit, worker) => {
      await Promise.all(items.map(worker));
    },
    shouldBlockMissevanAccessForCooldown: () => false,
    statsTaskReporters: new WeakMap(),
    ...overrides,
  };
}

test("Missevan overflow totals are requested only for capped episodes", async () => {
  const episodes = [
    {
      sound_id: 1,
      drama_id: "9",
      drama_title: "测试剧",
      episode_title: "未溢出",
      duration: 30_000,
    },
    {
      sound_id: 2,
      drama_id: "9",
      drama_title: "测试剧",
      episode_title: "溢出",
      duration: 30_000,
    },
    {
      sound_id: 3,
      drama_id: "9",
      drama_title: "测试剧",
      episode_title: "总数失败",
      duration: 30_000,
    },
    {
      sound_id: 4,
      drama_id: "9",
      drama_title: "测试剧",
      episode_title: "总数缺失",
      duration: 30_000,
    },
  ];
  const soundSummaryCalls = [];
  const executor = createStatsTaskExecutor(createDependencies({
    missevanClient: {
      async getDanmakuSummary(soundId) {
        return {
          success: true,
          danmaku: soundId === 1 ? 499 : 500,
          users: [],
        };
      },
      async getSoundSummary(soundId, options) {
        soundSummaryCalls.push({ soundId, options });
        if (soundId === 3) {
          throw new Error("unavailable");
        }
        if (soundId === 4) {
          return { success: true, comment_count: null };
        }
        return { success: true, comment_count: 1_234_567 };
      },
    },
  }));
  const task = createIdTask("missevan", episodes);

  await executor(task, { report() {} });

  assert.deepEqual(soundSummaryCalls.map((call) => call.soundId), [2, 3, 4]);
  soundSummaryCalls.forEach((call) => {
    assert.equal(call.options.forceRefresh, true);
    assert.equal(call.options.signal, task.abortSignal);
  });
  assert.deepEqual(task.result.suspectedOverflowEpisodes, [
    {
      key: "9-溢出",
      dramaId: "9",
      title: "溢出",
      totalDanmaku: 1_234_567,
      fetchedDanmaku: 500,
    },
    {
      key: "9-总数失败",
      dramaId: "9",
      title: "总数失败",
      totalDanmaku: null,
      fetchedDanmaku: 500,
    },
    {
      key: "9-总数缺失",
      dramaId: "9",
      title: "总数缺失",
      totalDanmaku: null,
      fetchedDanmaku: 500,
    },
  ]);
  assert.equal(task.failedCount, 0);
});

test("Missevan ID cancellation preserves completed overflow details", async () => {
  const episodes = [
    {
      sound_id: 1,
      drama_id: "9",
      drama_title: "测试剧",
      episode_title: "已完成",
      duration: 30_000,
    },
    {
      sound_id: 2,
      drama_id: "9",
      drama_title: "测试剧",
      episode_title: "取消中",
      duration: 30_000,
    },
  ];
  const task = createIdTask("missevan", episodes);
  const executor = createStatsTaskExecutor(createDependencies({
    runWithConcurrency: async (items, _limit, worker) => {
      for (const item of items) {
        await worker(item);
      }
    },
    missevanClient: {
      async getDanmakuSummary(soundId) {
        if (soundId === 2) {
          task.cancelled = true;
          return {
            success: false,
            cancelled: true,
            danmaku: 0,
            users: [],
          };
        }
        return {
          success: true,
          danmaku: 500,
          users: ["user-1"],
        };
      },
      async getSoundSummary() {
        return { success: true, comment_count: 1_234 };
      },
    },
  }));

  const completion = await executor(task, { report() {} });

  assert.equal(completion.status, "cancelled");
  assert.equal(completion.patch.totalUsers, 1);
  assert.deepEqual(completion.patch.result, {
    idResults: [
      {
        dramaId: "9",
        title: "测试剧",
        selectedEpisodeCount: 2,
        danmaku: 500,
        users: 1,
      },
    ],
    suspectedOverflowEpisodes: [
      {
        key: "9-已完成",
        dramaId: "9",
        title: "已完成",
        totalDanmaku: 1_234,
        fetchedDanmaku: 500,
      },
    ],
    totalDanmaku: 500,
    totalUsers: 1,
    idSelectedEpisodeCount: 2,
  });
});

test("Manbo overflow details reuse assessment totals and preserve episode order", async () => {
  const episodes = [
    {
      sound_id: "11",
      drama_id: "8",
      drama_title: "测试剧",
      episode_title: "第一集",
    },
    {
      sound_id: "12",
      drama_id: "8",
      drama_title: "测试剧",
      episode_title: "第二集",
    },
  ];
  const assessmentCalls = [];
  const executor = createStatsTaskExecutor(createDependencies({
    isLikelyManboDanmakuOverflow: async (setId, fetchedDanmaku) => {
      assessmentCalls.push({ setId, fetchedDanmaku });
      return {
        overflow: true,
        totalDanmaku: setId === "11" ? 1_000_001 : 2_000_002,
      };
    },
    manboClient: {
      async getDanmakuSummary(setId) {
        if (setId === "11") {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        return {
          success: true,
          danmaku: setId === "11" ? 100 : 200,
          users: [],
        };
      },
    },
  }));
  const task = createIdTask("manbo", episodes);

  await executor(task, { report() {} });

  assert.equal(assessmentCalls.length, 2);
  assert.deepEqual(
    task.result.suspectedOverflowEpisodes.map((item) => item.title),
    ["第一集", "第二集"]
  );
  assert.deepEqual(
    task.result.suspectedOverflowEpisodes.map((item) => [
      item.totalDanmaku,
      item.fetchedDanmaku,
    ]),
    [
      [1_000_001, 100],
      [2_000_002, 200],
    ]
  );
});
