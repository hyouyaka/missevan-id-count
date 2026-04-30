import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOngoingResponse,
  isOngoingEmptyPaidDanmakuMetric,
  normalizeOngoingIdList,
  sortOngoingItemsByWindowDelta,
} from "./ongoingUtils.js";

const sampleIndex = {
  dates: ["2026-04-01", "2026-04-26", "2026-04-29"],
  updated_at: "2026-04-29T10:00:00.000Z",
};

test("normalizeOngoingIdList accepts arrays, maps, and delimited strings", () => {
  assert.deepEqual(normalizeOngoingIdList(["101", 202, "", "abc"]), ["101", "202"]);
  assert.deepEqual(normalizeOngoingIdList({ 101: true, 202: false, abc: true }), ["101"]);
  assert.deepEqual(normalizeOngoingIdList("101, 202\n303 abc"), ["101", "202", "303"]);
});

test("normalizeOngoingIdList accepts Upstash ongoing record snapshots", () => {
  assert.deepEqual(
    normalizeOngoingIdList({
      version: 1,
      updatedAt: "2026-04-28T16:34:27.373957+00:00",
      platform: "missevan",
      records: {
        85562: { name: "连载一" },
        86684: true,
        86686: false,
        86723: null,
        abc: { name: "无效" },
      },
    }),
    ["85562", "86684"]
  );
});

test("buildOngoingResponse filters listed dramas and computes window deltas", () => {
  const response = buildOngoingResponse({
    platform: "missevan",
    ongoingIds: ["101", "404", "202"],
    indexSnapshot: sampleIndex,
    metricSnapshotsByDate: {
      "2026-04-01": {
        dramas: {
          101: { name: "旧值", view_count: 100, danmaku_uid_count: 1, subscription_num: 10 },
          202: { name: "旧值二", view_count: 300, danmaku_uid_count: 3, subscription_num: 30 },
        },
      },
      "2026-04-26": {
        dramas: {
          101: { name: "四面佛", view_count: 500, danmaku_uid_count: 5, subscription_num: 50 },
          202: { name: "奇洛李维斯回信", view_count: 700, danmaku_uid_count: 7, subscription_num: 70 },
        },
      },
      "2026-04-29": {
        dramas: {
          101: {
            name: "四面佛",
            cover: "https://example.com/101.jpg",
            view_count: 900,
            danmaku_uid_count: 9,
            subscription_num: 90,
            updated_at: "2026-04-28T01:00:00Z",
            main_cvs: ["袁铭喆", "赵成晨"],
            content_type_label: "广播剧",
            payStatus: "付费",
          },
          202: {
            name: "奇洛李维斯回信",
            view_count: 760,
            danmaku_uid_count: 8,
            subscription_num: 72,
            payStatus: "未知",
            payment_label: "会员",
          },
        },
      },
    },
  });

  assert.equal(response.success, true);
  assert.equal(response.platform, "missevan");
  assert.equal(response.latestDate, "2026-04-29");
  assert.equal(response.items.length, 2);
  assert.deepEqual(response.items.map((item) => item.id), ["101", "202"]);
  assert.equal(response.items[0].name, "四面佛");
  assert.equal(response.items[0].payment_label, "付费");
  assert.equal(response.items[1].payment_label, "会员");
  assert.equal(response.items[0].main_cv_text, "袁铭喆，赵成晨");
  assert.equal(response.items[0].windows["3d"].metrics.view_count.delta, 400);
  assert.equal(response.items[0].windows["30d"].metrics.view_count.delta, 800);
  assert.equal(response.items[0].windows["3d"].metrics.subscription_num.label, "追剧人数");
});

test("buildOngoingResponse normalizes paystatus payment labels", () => {
  const response = buildOngoingResponse({
    platform: "missevan",
    ongoingIds: ["101", "202", "303", "404"],
    indexSnapshot: sampleIndex,
    metricSnapshotsByDate: {
      "2026-04-29": {
        dramas: {
          101: { name: "付费剧", view_count: 1, danmaku_uid_count: 1, subscription_num: 1, payStatus: "付费" },
          202: { name: "会员剧", view_count: 1, danmaku_uid_count: 1, subscription_num: 1, paystatus: "会员" },
          303: { name: "免费剧", view_count: 1, danmaku_uid_count: 1, subscription_num: 1, paystatus: "免费" },
          404: { name: "旧字段", view_count: 1, danmaku_uid_count: 1, subscription_num: 1, paystatus: "无效", payment_label: "付费" },
        },
      },
    },
  });

  assert.deepEqual(
    response.items.map((item) => item.payment_label),
    ["付费", "会员", "免费", "付费"]
  );
});

test("buildOngoingResponse marks missing previous data unavailable without hiding current card", () => {
  const response = buildOngoingResponse({
    platform: "manbo",
    ongoingIds: ["2087206604062588962"],
    indexSnapshot: sampleIndex,
    metricSnapshotsByDate: {
      "2026-04-29": {
        dramas: {
          "2087206604062588962": {
            name: "漫播连载",
            view_count: 1000,
            danmaku_uid_count: 10,
            pay_count: 20,
          },
        },
      },
    },
  });

  assert.equal(response.items.length, 1);
  assert.equal(response.items[0].metrics.pay_count.label, "付费/收听人数");
  assert.equal(response.items[0].metrics.pay_count.visible, true);
  assert.equal(response.items[0].windows["7d"].insufficientData, true);
  assert.equal(response.items[0].windows["7d"].metrics.view_count.delta, null);
  assert.equal(response.items[0].windows["7d"].metrics.view_count.available, false);
});

test("buildOngoingResponse hides Manbo pay count when missing or always zero", () => {
  const missingPayCountResponse = buildOngoingResponse({
    platform: "manbo",
    ongoingIds: ["2087206604062588962"],
    indexSnapshot: sampleIndex,
    metricSnapshotsByDate: {
      "2026-04-26": {
        dramas: {
          "2087206604062588962": {
            name: "漫播连载",
            view_count: 900,
            danmaku_uid_count: 8,
          },
        },
      },
      "2026-04-29": {
        dramas: {
          "2087206604062588962": {
            name: "漫播连载",
            view_count: 1000,
            danmaku_uid_count: 10,
          },
        },
      },
    },
  });

  assert.equal(missingPayCountResponse.items[0].metrics.pay_count.visible, false);

  const currentlyMissingPayCountResponse = buildOngoingResponse({
    platform: "manbo",
    ongoingIds: ["2087206604062588962"],
    indexSnapshot: sampleIndex,
    metricSnapshotsByDate: {
      "2026-04-26": {
        dramas: {
          "2087206604062588962": {
            name: "漫播连载",
            view_count: 900,
            danmaku_uid_count: 8,
            pay_count: 12,
          },
        },
      },
      "2026-04-29": {
        dramas: {
          "2087206604062588962": {
            name: "漫播连载",
            view_count: 1000,
            danmaku_uid_count: 10,
          },
        },
      },
    },
  });

  assert.equal(currentlyMissingPayCountResponse.items[0].metrics.pay_count.visible, false);

  const zeroPayCountResponse = buildOngoingResponse({
    platform: "manbo",
    ongoingIds: ["2087206604062588962"],
    indexSnapshot: sampleIndex,
    metricSnapshotsByDate: {
      "2026-04-26": {
        dramas: {
          "2087206604062588962": {
            name: "漫播连载",
            view_count: 900,
            danmaku_uid_count: 8,
            pay_count: 0,
          },
        },
      },
      "2026-04-29": {
        dramas: {
          "2087206604062588962": {
            name: "漫播连载",
            view_count: 1000,
            danmaku_uid_count: 10,
            pay_count: 0,
          },
        },
      },
    },
  });

  assert.equal(zeroPayCountResponse.items[0].metrics.pay_count.visible, false);
});

test("isOngoingEmptyPaidDanmakuMetric detects unpaid windows for display", () => {
  assert.equal(
    isOngoingEmptyPaidDanmakuMetric({
      key: "danmaku_uid_count",
      fromValue: 0,
      toValue: 0,
      delta: 0,
    }),
    true
  );
  assert.equal(
    isOngoingEmptyPaidDanmakuMetric({
      key: "danmaku_uid_count",
      fromValue: 0,
      toValue: 12,
      delta: 12,
    }),
    false
  );
  assert.equal(
    isOngoingEmptyPaidDanmakuMetric({
      key: "view_count",
      fromValue: 0,
      toValue: 0,
      delta: 0,
    }),
    false
  );
});

test("sortOngoingItemsByWindowDelta orders playback growth descending", () => {
  const items = [
    { id: "1", windows: { "7d": { metrics: { view_count: { delta: 10 } } } } },
    { id: "2", windows: { "7d": { metrics: { view_count: { delta: 90 } } } } },
    { id: "3", windows: { "7d": { metrics: { view_count: { delta: null } } } } },
    { id: "4", windows: { "7d": { metrics: { view_count: { delta: 0, available: true } } } } },
    { id: "5", windows: { "7d": { metrics: { view_count: { delta: 999, available: false } } } } },
  ];

  assert.deepEqual(sortOngoingItemsByWindowDelta(items, "7d").map((item) => item.id), ["2", "1", "4", "3", "5"]);
});
