import assert from "node:assert/strict";
import test from "node:test";
import { applyPaidCoefficient, buildPaidCoefficientBasis, normalizePaidCoefficient } from "./paidCoefficient.js";

test("coefficient validates integer bounds", () => {
  for (const value of [undefined, null, 0, 11, 1.5, "bad"]) assert.equal(normalizePaidCoefficient(value), 1);
  assert.equal(normalizePaidCoefficient("10"), 10);
});

for (const platform of ["missevan", "manbo"]) {
  for (const revenueType of ["season", "episode", ...(platform === "missevan" ? ["legacy"] : [])]) {
    test(`${platform} ${revenueType}: scales only paid revenue, including both bounds`, () => {
      const base = { platform, revenueType, paidUserCount: 4, rewardCoinTotal: 50, diamondValue: 500, estimatedRevenueYuan: 15, minRevenueYuan: 15, maxRevenueYuan: 25 };
      const raw = { ...base, paidCoefficientBasis: buildPaidCoefficientBasis(base) };
      assert.equal(applyPaidCoefficient(raw, 1).estimatedRevenueYuan, 15);
      const adjusted = applyPaidCoefficient(raw, 10);
      assert.equal(adjusted.estimatedRevenueYuan, 105);
      assert.equal(adjusted.minRevenueYuan, 105);
      assert.equal(adjusted.maxRevenueYuan, 205);
      assert.equal(adjusted.paidUserCount, 4);
      assert.equal(adjusted.rewardCoinTotal, 50);
      assert.equal(adjusted.diamondValue, 500);
      assert.equal(applyPaidCoefficient(raw, 2).estimatedRevenueYuan, 25);
      assert.equal(raw.estimatedRevenueYuan, 15);
    });
  }
}

test("official counts, members, unsupported and failed results never scale", () => {
  for (const patch of [
    { platform: "manbo", revenueType: "season", payCount: 1 },
    { platform: "manbo", revenueType: "episode", payCount: 1 },
    { revenueType: "member" }, { revenueType: "reward_only" },
    { revenueType: "unknown" }, { failed: true },
  ]) {
    const base = { platform: "missevan", revenueType: "season", estimatedRevenueYuan: 20, ...patch };
    const result = applyPaidCoefficient({ ...base, paidCoefficientBasis: buildPaidCoefficientBasis(base) }, 10);
    assert.equal(result.estimatedRevenueYuan, 20);
    assert.equal(result.paidCoefficient, 1);
    assert.equal(result.paidCoefficientApplicable, false);
  }
  assert.equal(applyPaidCoefficient({ estimatedRevenueYuan: 20 }, 10).estimatedRevenueYuan, 20);
});

test("official Manbo episode adjusts only the ID branch of the minimum and caps each result", () => {
  const base = { platform: "manbo", revenueType: "episode", payCount: 76, seasonPaidUserCount: 10, episodePaidUserCountTotal: 20, paidEpisodeCount: 2, minimumEpisodePrice: 10, diamondValue: 500, estimatedRevenueYuan: 12.6, minRevenueYuan: 12.6, maxRevenueYuan: 81 };
  const raw = { ...base, paidCoefficientBasis: buildPaidCoefficientBasis(base) };
  assert.equal(raw.paidCoefficientBasis.maxCoefficient, 7.6);
  assert.equal(applyPaidCoefficient(raw, 2).minRevenueYuan, 12.6);
  assert.equal(applyPaidCoefficient(raw, 5).minRevenueYuan, 15);
  const capped = applyPaidCoefficient(raw, 10);
  assert.equal(capped.paidCoefficient, 7.6);
  assert.equal(capped.minRevenueYuan, 20.2);
  assert.equal(capped.estimatedRevenueYuan, 20.2);
  assert.equal(capped.maxRevenueYuan, 81);
  assert.equal(applyPaidCoefficient(raw, 6.9).paidCoefficient, 6);
  assert.equal(applyPaidCoefficient(raw, 1).minRevenueYuan, base.minRevenueYuan);
  for (const [users, maximum] of [[0, 1], [100, 1], [3, 25.3]]) {
    assert.equal(buildPaidCoefficientBasis({ ...base, seasonPaidUserCount: users }).maxCoefficient, maximum);
  }
  const ordinary = { ...base, payCount: 0, paidCoefficientBasis: buildPaidCoefficientBasis({ ...base, payCount: 0 }) };
  assert.equal(applyPaidCoefficient(ordinary, 7.6).paidCoefficient, 7);
  assert.equal(applyPaidCoefficient(ordinary, 25.3).paidCoefficient, 10);
});
