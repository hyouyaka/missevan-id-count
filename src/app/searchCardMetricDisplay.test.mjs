import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSearchCardMetricDisplay,
  getSearchCardMetricDefinitions,
  hasSearchCardMetricFailure,
} from "./searchCardMetricDisplay.js";

function labels(metrics) {
  return metrics.map((metric) => metric.label);
}

test("search-card metric definitions keep platform and payment applicability stable", () => {
  assert.deepEqual(labels(getSearchCardMetricDefinitions("missevan")), [
    "总播放量",
    "追剧人数",
    "打赏人数",
  ]);
  assert.deepEqual(labels(getSearchCardMetricDefinitions("manbo", {
    is_member: false,
    revenue_type: "episode",
  })), [
    "总播放量",
    "收藏数",
    "投喂总数",
  ]);
  assert.deepEqual(labels(getSearchCardMetricDefinitions("manbo", {
    is_member: false,
    revenue_type: "season",
  })), [
    "总播放量",
    "收藏数",
    "付费人数",
    "投喂总数",
  ]);
  assert.deepEqual(labels(getSearchCardMetricDefinitions("manbo", {
    is_member: true,
    revenue_type: "season",
  })), [
    "总播放量",
    "收藏数",
    "收听人数",
    "投喂总数",
  ]);
});

test("pending and loading keep every applicable metric visible as loading", () => {
  for (const status of [undefined, "pending", "loading"]) {
    const metrics = buildSearchCardMetricDisplay("missevan", {
      metrics_status: status,
      view_count: 1,
      subscription_num: 2,
      reward_num: 3,
    });
    assert.deepEqual(labels(metrics), ["总播放量", "追剧人数", "打赏人数"]);
    assert.deepEqual(metrics.map((metric) => metric.value), ["正在获取", "正在获取", "正在获取"]);
    assert.ok(metrics.every((metric) => metric.loading));
    assert.equal(hasSearchCardMetricFailure("missevan", { metrics_status: status }), false);
  }
});

test("error and access denial keep every applicable metric visible with their state copy", () => {
  const errorMetrics = buildSearchCardMetricDisplay("manbo", {
    metrics_status: "error",
    is_member: false,
    revenue_type: "season",
  });
  assert.deepEqual(errorMetrics.map((metric) => metric.value), [
    "获取失败",
    "获取失败",
    "获取失败",
    "获取失败",
  ]);
  assert.equal(hasSearchCardMetricFailure("manbo", { metrics_status: "error" }), true);

  const deniedMetrics = buildSearchCardMetricDisplay("manbo", {
    metrics_status: "access_denied",
    is_member: true,
    revenue_type: "season",
  });
  assert.deepEqual(deniedMetrics.map((metric) => metric.value), [
    "暂不可用",
    "暂不可用",
    "暂不可用",
    "暂不可用",
  ]);
  assert.equal(hasSearchCardMetricFailure("manbo", { metrics_status: "access_denied" }), true);
});

test("ready Missevan cards retain partial failures and expose retry", () => {
  const metrics = buildSearchCardMetricDisplay("missevan", {
    metrics_status: "ready",
    view_count: 123,
    subscription_num: "456",
    reward_num: null,
  });
  assert.deepEqual(metrics.map((metric) => metric.value), ["123", "456", "获取失败"]);
  assert.deepEqual(metrics.map((metric) => metric.failed), [false, false, true]);
  assert.equal(hasSearchCardMetricFailure("missevan", {
    metrics_status: "ready",
    view_count: 123,
    subscription_num: "456",
    reward_num: null,
  }), true);
});

test("ready cards keep base zero values and reject missing or non-finite values", () => {
  const missevanMetrics = buildSearchCardMetricDisplay("missevan", {
    metrics_status: "ready",
    view_count: 0,
    subscription_num: 0,
    reward_num: 0,
  });
  assert.deepEqual(missevanMetrics.map((metric) => metric.value), ["0", "0", "0"]);
  assert.equal(hasSearchCardMetricFailure("missevan", {
    metrics_status: "ready",
    view_count: 0,
    subscription_num: 0,
    reward_num: 0,
  }), false);

  const manboMetrics = buildSearchCardMetricDisplay("manbo", {
    metrics_status: "ready",
    is_member: false,
    revenue_type: "season",
    view_count: 0,
    subscription_num: "",
    pay_count: Infinity,
    diamond_value: NaN,
  });
  assert.deepEqual(manboMetrics.map((metric) => metric.value), [
    "0",
    "获取失败",
    "获取失败",
    "获取失败",
  ]);
  assert.equal(hasSearchCardMetricFailure("manbo", {
    metrics_status: "ready",
    is_member: false,
    revenue_type: "season",
    view_count: 0,
    subscription_num: "",
    pay_count: Infinity,
    diamond_value: NaN,
  }), true);

  const memberMetrics = buildSearchCardMetricDisplay("manbo", {
    metrics_status: "ready",
    is_member: true,
    revenue_type: "season",
    view_count: 0,
    subscription_num: 0,
    member_listen_count: null,
    diamond_value: 0,
  });
  assert.deepEqual(memberMetrics.map((metric) => metric.value), ["0", "0", "获取失败", "0"]);
  assert.equal(hasSearchCardMetricFailure("manbo", {
    metrics_status: "ready",
    is_member: true,
    revenue_type: "season",
    view_count: 0,
    subscription_num: 0,
    member_listen_count: null,
    diamond_value: 0,
  }), true);
});

test("ready Manbo cards hide zero paid and member-listen counts only", () => {
  const paidMetrics = buildSearchCardMetricDisplay("manbo", {
    metrics_status: "ready",
    is_member: false,
    revenue_type: "season",
    view_count: 0,
    subscription_num: 0,
    pay_count: 0,
    diamond_value: 0,
  });
  assert.deepEqual(labels(paidMetrics), ["总播放量", "收藏数", "投喂总数"]);
  assert.deepEqual(paidMetrics.map((metric) => metric.value), ["0", "0", "0"]);
  assert.equal(hasSearchCardMetricFailure("manbo", {
    metrics_status: "ready",
    is_member: false,
    revenue_type: "season",
    view_count: 0,
    subscription_num: 0,
    pay_count: 0,
    diamond_value: 0,
  }), false);

  const memberMetrics = buildSearchCardMetricDisplay("manbo", {
    metrics_status: "ready",
    is_member: true,
    revenue_type: "season",
    view_count: 0,
    subscription_num: 0,
    member_listen_count: "0",
    diamond_value: 0,
  });
  assert.deepEqual(labels(memberMetrics), ["总播放量", "收藏数", "投喂总数"]);
  assert.deepEqual(memberMetrics.map((metric) => metric.value), ["0", "0", "0"]);
  assert.equal(hasSearchCardMetricFailure("manbo", {
    metrics_status: "ready",
    is_member: true,
    revenue_type: "season",
    view_count: 0,
    subscription_num: 0,
    member_listen_count: "0",
    diamond_value: 0,
  }), false);
});
