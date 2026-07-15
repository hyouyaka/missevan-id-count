import test from "node:test";
import assert from "node:assert/strict";

import { aggregateRevenueFinancials } from "./revenueSummaryUtils.js";

function createSeason(overrides = {}) {
  return {
    platform: "missevan",
    payType: 2,
    revenueType: "season",
    summaryRevenueMode: "single",
    price: 200,
    memberPrice: 180,
    titlePrice: 200,
    titleMemberPrice: 180,
    includeInSummaryPrice: true,
    estimatedRevenueYuan: 1000,
    minRevenueYuan: null,
    maxRevenueYuan: null,
    failed: false,
    ...overrides,
  };
}

function createEpisode(overrides = {}) {
  return {
    platform: "missevan",
    payType: 1,
    revenueType: "episode",
    summaryRevenueMode: "range",
    price: 20,
    memberPrice: 15,
    paidEpisodeCount: 4,
    titlePrice: 20,
    titleMemberPrice: 15,
    includeInSummaryPrice: true,
    estimatedRevenueYuan: 300,
    minRevenueYuan: 300,
    maxRevenueYuan: 500,
    failed: false,
    ...overrides,
  };
}

test("fixed Missevan revenue totals keep null range values", () => {
  const results = [843278.7, 625424.4, 457805.4, 449039.5]
    .map((estimatedRevenueYuan) => createSeason({ estimatedRevenueYuan }));

  const summary = aggregateRevenueFinancials(results, "missevan");

  assert.equal(summary.summaryRevenueMode, "single");
  assert.equal(summary.estimatedRevenueYuan, 2375548);
  assert.equal(summary.minRevenueYuan, null);
  assert.equal(summary.maxRevenueYuan, null);
  assert.equal(summary.titlePriceTotal, 800);
});

test("mixed fixed and range revenue includes fixed amount regardless of item order", () => {
  const season = createSeason();
  const episode = createEpisode();

  for (const results of [
    [season, episode],
    [episode, season],
    [createSeason({ estimatedRevenueYuan: 400 }), episode, season],
  ]) {
    const summary = aggregateRevenueFinancials(results, "missevan");
    const fixedTotal = results
      .filter((item) => item.summaryRevenueMode === "single")
      .reduce((sum, item) => sum + item.estimatedRevenueYuan, 0);

    assert.equal(summary.summaryRevenueMode, "range");
    assert.equal(summary.minRevenueYuan, fixedTotal + episode.minRevenueYuan);
    assert.equal(summary.maxRevenueYuan, fixedTotal + episode.maxRevenueYuan);
  }
});

test("mixed Missevan payment modes total season and paid episode prices", () => {
  const summary = aggregateRevenueFinancials(
    [createSeason(), createEpisode()],
    "missevan"
  );

  assert.equal(summary.estimatedRevenueYuan, 1300);
  assert.equal(summary.minRevenueYuan, 1300);
  assert.equal(summary.maxRevenueYuan, 1500);
  assert.equal(summary.titlePriceTotal, 280);
  assert.equal(summary.titleMemberPriceTotal, 240);
});

test("multiple Missevan episode prices use each paid episode count", () => {
  const summary = aggregateRevenueFinancials(
    [createEpisode(), createEpisode({ price: 30, memberPrice: 25, paidEpisodeCount: 3 })],
    "missevan"
  );

  assert.equal(summary.titlePriceTotal, 170);
  assert.equal(summary.titleMemberPriceTotal, 135);
});

test("null range bounds are never converted into a zero-value range", () => {
  const summary = aggregateRevenueFinancials(
    [createSeason({ summaryRevenueMode: "range" })],
    "missevan"
  );

  assert.equal(summary.summaryRevenueMode, "single");
  assert.equal(summary.estimatedRevenueYuan, 1000);
  assert.equal(summary.minRevenueYuan, null);
  assert.equal(summary.maxRevenueYuan, null);
});
