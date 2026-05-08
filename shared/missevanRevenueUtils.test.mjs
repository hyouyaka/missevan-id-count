import test from "node:test";
import assert from "node:assert/strict";

import {
  computeMissevanRevenueMetrics,
} from "./missevanRevenueUtils.js";

test("Missevan pay_type=0 revenue only counts rewards", () => {
  const result = computeMissevanRevenueMetrics({
    payTypeRaw: 0,
    vip: 0,
    isMember: false,
    price: 20,
    rewardCoinTotal: 100,
    seasonPaidUserCount: 4,
    episodePaidUserCountTotal: 5,
  });

  assert.equal(result.payType, 0);
  assert.equal(result.revenueType, "reward_only");
  assert.equal(result.vipOnlyReward, true);
  assert.equal(result.paidUserCount, 0);
  assert.equal(result.estimatedRevenueYuan, 10);
});

test("Missevan vip=1 overrides pay_type and only counts rewards", () => {
  const episodeResult = computeMissevanRevenueMetrics({
    payTypeRaw: 1,
    vip: 1,
    isMember: true,
    price: 20,
    rewardCoinTotal: 100,
    seasonPaidUserCount: 4,
    episodePaidUserCountTotal: 5,
  });
  const seasonResult = computeMissevanRevenueMetrics({
    payTypeRaw: 2,
    vip: 1,
    isMember: true,
    price: 20,
    rewardCoinTotal: 100,
    seasonPaidUserCount: 4,
    episodePaidUserCountTotal: 5,
  });

  assert.equal(episodeResult.revenueType, "reward_only");
  assert.equal(episodeResult.estimatedRevenueYuan, 10);
  assert.equal(seasonResult.revenueType, "reward_only");
  assert.equal(seasonResult.estimatedRevenueYuan, 10);
});

test("Missevan pay_type=1 uses revenue range from summed and deduped paid episode IDs", () => {
  const result = computeMissevanRevenueMetrics({
    payTypeRaw: 1,
    vip: 0,
    isMember: false,
    price: 20,
    rewardCoinTotal: 100,
    seasonPaidUserCount: 4,
    episodePaidUserCountTotal: 5,
    paidEpisodeCount: 2,
  });

  assert.equal(result.payType, 1);
  assert.equal(result.revenueType, "episode");
  assert.equal(result.paidUserCount, 5);
  assert.equal(result.episodePaidUserCountTotal, 5);
  assert.equal(result.seasonPaidUserCount, 4);
  assert.equal(result.paidEpisodeCount, 2);
  assert.equal(result.summaryRevenueMode, "range");
  assert.equal(result.estimatedRevenueYuan, 20);
  assert.equal(result.minRevenueYuan, 20);
  assert.equal(result.maxRevenueYuan, 26);
});

test("Missevan pay_type=2 uses whole-drama deduped paid ID count", () => {
  const result = computeMissevanRevenueMetrics({
    payTypeRaw: 2,
    vip: 0,
    isMember: false,
    price: 20,
    rewardCoinTotal: 100,
    seasonPaidUserCount: 4,
    episodePaidUserCountTotal: 5,
  });

  assert.equal(result.payType, 2);
  assert.equal(result.revenueType, "season");
  assert.equal(result.paidUserCount, 4);
  assert.equal(result.estimatedRevenueYuan, 18);
});

test("Missevan missing pay_type keeps legacy whole-drama deduped formula", () => {
  const result = computeMissevanRevenueMetrics({
    payTypeRaw: undefined,
    vip: 0,
    isMember: false,
    price: 20,
    rewardCoinTotal: 100,
    seasonPaidUserCount: 4,
    episodePaidUserCountTotal: 5,
  });

  assert.equal(result.payType, null);
  assert.equal(result.revenueType, "legacy");
  assert.equal(result.paidUserCount, 4);
  assert.equal(result.estimatedRevenueYuan, 18);
});
