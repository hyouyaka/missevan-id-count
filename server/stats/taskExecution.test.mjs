import assert from "node:assert/strict";
import test from "node:test";

import {
  isMissevanLikelyDanmakuOverflow,
} from "../../shared/episodeRules.js";
import { aggregateRevenueFinancials } from "../../shared/revenueSummaryUtils.js";
import {
  computeMissevanRevenueMetrics,
  normalizeMissevanPayType,
  resolveMissevanRevenueType,
} from "../../shared/missevanRevenueUtils.js";
import { createStatsTaskExecutor, getManboRevenueType } from "./taskExecution.js";

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

function createRevenueTask(dramaIds = ["8"]) {
  return {
    platform: "manbo",
    taskType: "revenue",
    dramaIds,
    source: "test",
    completedCount: 0,
    failedCount: 0,
    accessDenied: false,
    cancelled: false,
    abortSignal: new AbortController().signal,
  };
}

function createDependencies(overrides = {}) {
  return {
    buildIdDramaMap,
    isAccessDeniedError: () => false,
    isManboMemberDramaInfo: () => false,
    isMissevanAccessDenied: () => false,
    isMissevanLikelyDanmakuOverflow,
    MANBO_STATS_EPISODE_CONCURRENCY: 4,
    normalizeOptionalFiniteNumber: () => null,
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

async function runManboRevenueTask(dramaInfo, usersBySetId = {}) {
  const executor = createStatsTaskExecutor(createDependencies({
    aggregateRevenueFinancials,
    isLikelyManboDanmakuOverflow: async () => ({
      overflow: false,
      totalDanmaku: null,
    }),
    normalizeOptionalFiniteNumber(value) {
      if (value == null || value === "") {
        return null;
      }
      const normalized = Number(value);
      return Number.isFinite(normalized) ? normalized : null;
    },
    manboClient: {
      async getDramaDetail() {
        return dramaInfo;
      },
      async getDanmakuSummary(setId) {
        const users = usersBySetId[String(setId)] || [];
        return {
          success: true,
          danmaku: users.length,
          users,
        };
      },
    },
  }));
  const task = createRevenueTask([dramaInfo.drama.id]);

  await executor(task, { report() {} });

  return {
    result: task.result.revenueResults[0],
    summary: task.result.revenueSummary,
    episodeDetails: task.result.episodeDetails,
  };
}

test("Missevan episode details cover every successful episode and request totals only for capped episodes", async () => {
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
  assert.deepEqual(task.result.episodeDetails, [
    {
      key: "missevan:9:1",
      dramaId: "9",
      episodeId: "1",
      title: "未溢出",
      status: "success",
      totalDanmaku: null,
      fetchedDanmaku: 499,
      uniqueUsers: 0,
    },
    {
      key: "missevan:9:2",
      dramaId: "9",
      episodeId: "2",
      title: "溢出",
      status: "success",
      totalDanmaku: 1_234_567,
      fetchedDanmaku: 500,
      uniqueUsers: 0,
    },
    {
      key: "missevan:9:3",
      dramaId: "9",
      episodeId: "3",
      title: "总数失败",
      status: "success",
      totalDanmaku: null,
      fetchedDanmaku: 500,
      uniqueUsers: 0,
    },
    {
      key: "missevan:9:4",
      dramaId: "9",
      episodeId: "4",
      title: "总数缺失",
      status: "success",
      totalDanmaku: null,
      fetchedDanmaku: 500,
      uniqueUsers: 0,
    },
  ]);
  assert.equal(task.failedCount, 0);
});

test("Missevan ID cancellation preserves only attempted episode details", async () => {
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
    episodeDetails: [
      {
        key: "missevan:9:1",
        dramaId: "9",
        episodeId: "1",
        title: "已完成",
        status: "success",
        totalDanmaku: 1_234,
        fetchedDanmaku: 500,
        uniqueUsers: 1,
      },
    ],
    totalDanmaku: 500,
    totalUsers: 1,
    idSelectedEpisodeCount: 2,
  });
});

test("failed danmaku attempts remain in episode details without numeric metrics", async () => {
  const episodes = [
    {
      sound_id: 7,
      drama_id: "9",
      drama_title: "测试剧",
      episode_title: "失败分集",
      duration: 30_000,
    },
  ];
  const executor = createStatsTaskExecutor(createDependencies({
    missevanClient: {
      async getDanmakuSummary() {
        return {
          success: false,
          accessDenied: false,
          users: [],
        };
      },
    },
  }));
  const task = createIdTask("missevan", episodes);

  await executor(task, { report() {} });

  assert.deepEqual(task.result.episodeDetails, [
    {
      key: "missevan:9:7",
      dramaId: "9",
      episodeId: "7",
      title: "失败分集",
      status: "failed",
      totalDanmaku: null,
      fetchedDanmaku: null,
      uniqueUsers: null,
    },
  ]);
});

test("Manbo episode details reuse assessment totals for all successful episodes and preserve order", async () => {
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
        overflow: setId === "11",
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
          users: setId === "11" ? ["a", "a", "b"] : ["c"],
        };
      },
    },
  }));
  const task = createIdTask("manbo", episodes);

  await executor(task, { report() {} });

  assert.equal(assessmentCalls.length, 2);
  assert.deepEqual(
    task.result.episodeDetails.map((item) => item.title),
    ["第一集", "第二集"]
  );
  assert.deepEqual(
    task.result.episodeDetails.map((item) => [
      item.totalDanmaku,
      item.fetchedDanmaku,
      item.uniqueUsers,
    ]),
    [
      [1_000_001, 100, 2],
      [2_000_002, 200, 1],
    ]
  );
});

test("Manbo episode revenue uses the lowest set price and both paid ID counts", async () => {
  const { result, summary, episodeDetails } = await runManboRevenueTask(
    {
      drama: {
        id: "8",
        name: "分集付费剧",
        view_count: 1000,
        diamond_value: 500,
        pay_type: 0,
        price: 100,
        member_price: 80,
        pay_count: 2,
      },
      episodes: {
        episode: [
          { sound_id: "11", name: "第一集", price: 20 },
          { sound_id: "12", name: "第二集", price: 30 },
        ],
      },
    },
    {
      11: ["a", "b"],
      12: ["b", "c", "d"],
    }
  );

  assert.equal(result.summaryRevenueMode, "range");
  assert.equal(result.paidCountSource, "pay_count_and_danmaku_ids");
  assert.equal(result.payCount, 2);
  assert.equal(result.episodePaidUserCountTotal, 5);
  assert.equal(result.seasonPaidUserCount, 4);
  assert.equal(result.paidUserCount, 4);
  assert.equal(result.titlePrice, 100);
  assert.equal(result.titleMemberPrice, 80);
  assert.equal(result.estimatedRevenueYuan, 6);
  assert.equal(result.minRevenueYuan, 6);
  assert.equal(result.maxRevenueYuan, 9);
  assert.equal(summary.paidCountSourceSummary, "mixed");
  assert.equal(summary.totalPayCount, 2);
  assert.equal(summary.totalDanmakuPaidUserCount, 4);
  assert.deepEqual(episodeDetails.map((item) => [item.key, item.uniqueUsers]), [
    ["manbo:8:11", 2],
    ["manbo:8:12", 3],
  ]);
});

test("Manbo official pay-count revenue does not create empty episode details", async () => {
  const { result, episodeDetails } = await runManboRevenueTask({
    drama: {
      id: "8",
      name: "全季付费剧",
      view_count: 1000,
      diamond_value: 500,
      pay_type: 1,
      price: 100,
      member_price: 80,
      pay_count: 10,
    },
    episodes: {
      episode: [
        { sound_id: "11", name: "第一集", pay_type: 1 },
        { sound_id: "12", name: "第二集", pay_type: 1 },
      ],
    },
  });

  assert.equal(result.paidCountSource, "pay_count");
  assert.deepEqual(episodeDetails, []);
});

test("Missevan paid revenue exposes episode details without querying totals for non-capped episodes", async () => {
  const soundSummaryCalls = [];
  const executor = createStatsTaskExecutor(createDependencies({
    aggregateRevenueFinancials,
    computeMissevanRevenueMetrics,
    normalizeMissevanPayType,
    resolveMissevanRevenueType,
    normalizeOptionalFiniteNumber(value) {
      if (value == null || value === "") {
        return null;
      }
      const normalized = Number(value);
      return Number.isFinite(normalized) ? normalized : null;
    },
    missevanClient: {
      async getDramaInfo() {
        return {
          drama: {
            id: 9,
            name: "猫耳分集付费剧",
            view_count: 1000,
            price: 10,
            member_price: 8,
            pay_type: 1,
            vip: 0,
          },
          episodes: {
            episode: [
              { sound_id: 71, name: "第一集", need_pay: 1, price: 10, duration: 30_000 },
            ],
          },
        };
      },
      async getRewardDetailMeta() {
        return null;
      },
      async getDanmakuSummary() {
        return { success: true, danmaku: 499, users: ["a", "a", "b"] };
      },
      async getSoundSummary(soundId) {
        soundSummaryCalls.push(soundId);
        return { success: true, comment_count: 900 };
      },
      async getRewardSummary() {
        return { success: true, rewardCoinTotal: 0 };
      },
    },
  }));
  const task = createRevenueTask([9]);
  task.platform = "missevan";

  await executor(task, { report() {} });

  assert.deepEqual(soundSummaryCalls, []);
  assert.deepEqual(task.result.episodeDetails, [
    {
      key: "missevan:9:71",
      dramaId: "9",
      episodeId: "71",
      title: "第一集",
      status: "success",
      totalDanmaku: null,
      fetchedDanmaku: 499,
      uniqueUsers: 2,
    },
  ]);
});

test("Manbo episode revenue lets official pay count win both bounds", async () => {
  const { result } = await runManboRevenueTask(
    {
      drama: {
        id: "8",
        name: "分集付费剧",
        view_count: 1000,
        diamond_value: 500,
        pay_type: 0,
        price: 100,
        member_price: 0,
        pay_count: 10,
      },
      episodes: {
        episode: [
          { sound_id: "11", name: "第一集", price: 20 },
          { sound_id: "12", name: "第二集", price: 30 },
        ],
      },
    },
    {
      11: ["a"],
      12: ["b"],
    }
  );

  assert.equal(result.minRevenueYuan, 7);
  assert.equal(result.maxRevenueYuan, 15);
});

test("Manbo episode revenue sums paid set prices when the title price is missing", async () => {
  const { result, summary } = await runManboRevenueTask(
    {
      drama: {
        id: "8",
        name: "缺少总价的分集付费剧",
        view_count: 1000,
        diamond_value: 500,
        pay_type: 0,
        price: 0,
        member_price: 0,
        pay_count: 2,
      },
      episodes: {
        episode: [
          { sound_id: "11", name: "第一集", price: 20 },
          { sound_id: "12", name: "第二集", price: 30 },
        ],
      },
    },
    {
      11: ["a", "b"],
      12: ["b", "c"],
    }
  );

  assert.equal(result.titlePrice, 50);
  assert.equal(result.minRevenueYuan, 5.8);
  assert.equal(result.maxRevenueYuan, 6.5);
  assert.equal(summary.titlePriceTotal, 50);
});

test("Manbo zero-paid-set episode drama uses title member range", async () => {
  const dramaInfo = {
    drama: {
      id: "8",
      name: "暂无付费集",
      view_count: 1000,
      diamond_value: 500,
      pay_type: 0,
      price: 100,
      member_price: 80,
      pay_count: 2,
    },
    episodes: {
      episode: [{ sound_id: "11", name: "预告", price: 0 }],
    },
  };

  assert.equal(getManboRevenueType(dramaInfo, () => false), "episode");

  const { result } = await runManboRevenueTask(dramaInfo);

  assert.equal(result.summaryRevenueMode, "range");
  assert.equal(result.episodePaidUserCountTotal, 0);
  assert.equal(result.seasonPaidUserCount, 0);
  assert.equal(result.estimatedRevenueYuan, 6.6);
  assert.equal(result.minRevenueYuan, 6.6);
  assert.equal(result.maxRevenueYuan, 7);
});

test("Manbo episode revenue ignores a member price that is not a discount", async () => {
  const { result } = await runManboRevenueTask({
    drama: {
      id: "8",
      name: "会员价异常",
      view_count: 1000,
      diamond_value: 500,
      pay_type: 0,
      price: 100,
      member_price: 120,
      pay_count: 2,
    },
    episodes: {
      episode: [],
    },
  });

  assert.equal(result.summaryRevenueMode, "single");
  assert.equal(result.titleMemberPrice, null);
  assert.equal(result.estimatedRevenueYuan, 7);
  assert.equal(result.minRevenueYuan, null);
  assert.equal(result.maxRevenueYuan, null);
});

test("Manbo zero-paid-set episode drama without member price uses one value", async () => {
  const { result } = await runManboRevenueTask({
    drama: {
      id: "8",
      name: "暂无付费集",
      view_count: 1000,
      diamond_value: 500,
      pay_type: 0,
      price: 100,
      member_price: 0,
      pay_count: null,
    },
    episodes: {
      episode: [],
    },
  });

  assert.equal(result.summaryRevenueMode, "single");
  assert.equal(result.payCount, 0);
  assert.equal(result.estimatedRevenueYuan, 5);
  assert.equal(result.minRevenueYuan, null);
  assert.equal(result.maxRevenueYuan, null);
});
