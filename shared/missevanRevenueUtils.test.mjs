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
import { getRevenueEpisodesForDrama } from "./revenueEpisodeSelection.js";

test("revenue search selections follow the executor's platform revenue rules", () => {
  const episode = [
    { sound_id: "paid", price: 1, need_pay: 1, pay_type: 1 },
    { sound_id: "member", price: 0, vip_free: 1 },
    { sound_id: "free", price: 0 },
  ];
  const cases = [
    ["missevan", { pay_type: 0 }, []],
    ["missevan", { pay_type: 1, vip: 1 }, []],
    ["missevan", { pay_type: 1 }, ["paid"]],
    ["missevan", { pay_type: 2 }, ["paid"]],
    ["missevan", {}, ["paid"]],
    ["manbo", { pay_type: 0, price: 0, member_price: 0 }, ["member"]],
    ["manbo", { pay_type: 1, price: 5 }, ["paid"]],
    ["manbo", { pay_type: 0, price: 5 }, ["paid"]],
  ];
  for (const [platform, drama, expectedIds] of cases) {
    assert.deepEqual(getRevenueEpisodesForDrama(platform, { drama, episodes: { episode } }).map((item) => item.sound_id), expectedIds);
  }
  assert.deepEqual(getRevenueEpisodesForDrama("manbo", { drama: {}, episodes: { episode: [episode[2]] } }), []);
});
