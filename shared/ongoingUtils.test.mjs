import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOngoingResponse,
  isOngoingNewDrama,
  isOngoingEmptyPaidDanmakuMetric,
  normalizeOngoingIdList,
  sortOngoingItemsByWindowDelta,
} from "./ongoingUtils.js";
import { buildMetricSnapshotsFromRankTrendAggregate } from "./ranksTrendUtils.js";

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
  assert.equal(response.items[0].windows["30d"].metrics.view_count.delta, 900);
  assert.equal(response.items[0].windows["3d"].metrics.subscription_num.label, "追剧人数");
});

test("buildOngoingResponse accepts metric snapshots converted from rank trend aggregate", () => {
  const { indexSnapshot, metricSnapshotsByDate } = buildMetricSnapshotsFromRankTrendAggregate(
    {
      version: 1,
      platform: "missevan",
      updated_at: "2026-05-17T01:00:00.000Z",
      dates: ["2026-05-14", "2026-05-17"],
      dramas: {
        101: {
          name: "四面佛",
          cover: "https://example.com/101.jpg",
          payStatus: "付费",
          samples: {
            "2026-05-14": {
              metrics: {
                view_count: 100,
                danmaku_uid_count: 1,
                subscription_num: 10,
              },
            },
            "2026-05-17": {
              generated_at: "2026-05-17T01:00:00.000Z",
              metrics: {
                view_count: 500,
                danmaku_uid_count: 5,
                subscription_num: 50,
              },
            },
          },
        },
      },
    },
    "missevan"
  );
  const response = buildOngoingResponse({
    platform: "missevan",
    ongoingIds: ["101"],
    indexSnapshot,
    metricSnapshotsByDate,
  });

  assert.equal(response.success, true);
  assert.equal(response.latestDate, "2026-05-17");
  assert.equal(response.updatedAt, "2026-05-17T01:00:00.000Z");
  assert.equal(response.items[0].id, "101");
  assert.equal(response.items[0].cover, "https://example.com/101.jpg");
  assert.equal(response.items[0].payment_label, "付费");
  assert.equal(response.items[0].windows["3d"].metrics.view_count.delta, 400);
  assert.equal(response.items[0].metrics.subscription_num.value, 50);
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
    createTimesById: { "2087206604062588962": "2026.01" },
    currentMonth: "2026.04",
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

test("isOngoingNewDrama compares YYYY.MM values by calendar month", () => {
  assert.equal(isOngoingNewDrama("2026.07", "2026.07"), true);
  assert.equal(isOngoingNewDrama("2026.06", "2026.07"), true);
  assert.equal(isOngoingNewDrama("2026.05", "2026.07"), false);
  assert.equal(isOngoingNewDrama("2026.12", "2027.01"), true);
  assert.equal(isOngoingNewDrama("", "2026.07"), true);
  assert.equal(isOngoingNewDrama(undefined, "2026.07"), true);
  assert.equal(isOngoingNewDrama("2026.13", "2026.07"), false);
  assert.equal(isOngoingNewDrama("2026-06", "2026.07"), false);
  assert.equal(isOngoingNewDrama("2026.08", "2026.07"), false);
});

test("buildOngoingResponse uses the exact target date before new-drama zero or weekly history", () => {
  const id = "2087206604062588962";
  const response = buildOngoingResponse({
    platform: "manbo",
    ongoingIds: [id],
    indexSnapshot: { dates: ["2026-07-19", "2026-07-22"] },
    createTimesById: { [id]: "2026.07" },
    currentMonth: "2026.07",
    metricSnapshotsByDate: {
      "2026-07-19": {
        dramas: {
          [id]: { view_count: 800, pay_count: 30, danmaku_uid_count: 4 },
        },
      },
      "2026-07-22": {
        dramas: {
          [id]: { name: "新剧", view_count: 1000, pay_count: 40, danmaku_uid_count: 7 },
        },
      },
    },
    weeklyPlaybackSnapshot: {
      dates: ["2026-07-19"],
      snapshotsByDate: {
        "2026-07-19": { dramas: { [id]: { view_count: 850 } } },
      },
    },
  });

  const window = response.items[0].windows["3d"];
  assert.equal(window.fromDate, "2026-07-19");
  assert.equal(window.metrics.view_count.delta, 200);
  assert.equal(window.metrics.pay_count.delta, 10);
  assert.equal(window.metrics.danmaku_uid_count.delta, 3);
});

test("buildOngoingResponse treats missing new-drama baselines as zero for every metric", () => {
  const id = "2087206604062588962";
  const response = buildOngoingResponse({
    platform: "manbo",
    ongoingIds: [id],
    indexSnapshot: { dates: ["2026-07-22"] },
    createTimesById: { [id]: "" },
    currentMonth: "2026.07",
    metricSnapshotsByDate: {
      "2026-07-22": {
        dramas: {
          [id]: { name: "新剧", view_count: 1000, pay_count: 40, danmaku_uid_count: 7 },
        },
      },
    },
  });

  const window = response.items[0].windows["7d"];
  assert.equal(window.fromDate, "2026-07-15");
  assert.equal(window.insufficientData, false);
  assert.deepEqual(
    Object.fromEntries(Object.entries(window.metrics).map(([key, metric]) => [key, [metric.fromValue, metric.delta, metric.available]])),
    {
      view_count: [0, 1000, true],
      danmaku_uid_count: [0, 7, true],
      pay_count: [0, 40, true],
    }
  );
});

test("buildOngoingResponse uses the nearest weekly playback point for old dramas and prefers earlier ties", () => {
  const id = "2087206604062588962";
  const response = buildOngoingResponse({
    platform: "manbo",
    ongoingIds: [id],
    indexSnapshot: { dates: ["2026-07-22"] },
    createTimesById: { [id]: "2026.05" },
    currentMonth: "2026.07",
    metricSnapshotsByDate: {
      "2026-07-22": {
        dramas: {
          [id]: { name: "老剧", view_count: 1000, pay_count: 40, danmaku_uid_count: 7 },
        },
      },
    },
    weeklyPlaybackSnapshot: {
      dates: ["2026-07-16", "2026-07-22", "2026-07-23"],
      snapshotsByDate: {
        "2026-07-16": { dramas: { [id]: { view_count: 600 } } },
        "2026-07-22": { dramas: { [id]: { view_count: 900 } } },
        "2026-07-23": { dramas: { [id]: { view_count: 950 } } },
      },
    },
  });

  const window = response.items[0].windows["3d"];
  assert.equal(window.fromDate, "2026-07-16");
  assert.equal(window.metrics.view_count.delta, 400);
  assert.equal(window.metrics.view_count.available, true);
  assert.equal(window.metrics.pay_count.delta, null);
  assert.equal(window.metrics.pay_count.available, false);
  assert.equal(window.metrics.danmaku_uid_count.delta, null);
  assert.equal(window.metrics.danmaku_uid_count.available, false);
});

test("buildOngoingResponse leaves old-drama deltas unavailable without weekly playback history", () => {
  const id = "2087206604062588962";
  const response = buildOngoingResponse({
    platform: "manbo",
    ongoingIds: [id],
    indexSnapshot: { dates: ["2026-07-22"] },
    createTimesById: { [id]: "2026.05" },
    currentMonth: "2026.07",
    metricSnapshotsByDate: {
      "2026-07-22": {
        dramas: {
          [id]: { name: "老剧", view_count: 1000, pay_count: 40, danmaku_uid_count: 7 },
        },
      },
    },
  });

  const window = response.items[0].windows["30d"];
  assert.equal(window.fromDate, "");
  assert.equal(window.insufficientData, true);
  assert.equal(window.metrics.view_count.delta, null);
  assert.equal(window.metrics.view_count.available, false);
});

test("buildOngoingResponse excludes weekly playback points after the latest ongoing date", () => {
  const id = "2087206604062588962";
  const response = buildOngoingResponse({
    platform: "manbo",
    ongoingIds: [id],
    indexSnapshot: { dates: ["2026-07-22"] },
    createTimesById: { [id]: "2026.05" },
    currentMonth: "2026.07",
    metricSnapshotsByDate: {
      "2026-07-22": {
        dramas: { [id]: { name: "老剧", view_count: 1000 } },
      },
    },
    weeklyPlaybackSnapshot: {
      dates: ["2026-07-10", "2026-07-23"],
      snapshotsByDate: {
        "2026-07-10": { dramas: { [id]: { view_count: 500 } } },
        "2026-07-23": { dramas: { [id]: { view_count: 990 } } },
      },
    },
  });

  const window = response.items[0].windows["3d"];
  assert.equal(window.fromDate, "2026-07-10");
  assert.equal(window.metrics.view_count.delta, 500);
});

test("buildOngoingResponse does not fill a missing current metric for new dramas", () => {
  const id = "2087206604062588962";
  const response = buildOngoingResponse({
    platform: "manbo",
    ongoingIds: [id],
    indexSnapshot: { dates: ["2026-07-22"] },
    createTimesById: { [id]: "2026.07" },
    currentMonth: "2026.07",
    metricSnapshotsByDate: {
      "2026-07-22": {
        dramas: { [id]: { name: "新剧", view_count: 1000, danmaku_uid_count: 7 } },
      },
    },
  });

  const metric = response.items[0].windows["7d"].metrics.pay_count;
  assert.equal(metric.fromValue, 0);
  assert.equal(metric.toValue, null);
  assert.equal(metric.delta, null);
  assert.equal(metric.available, false);
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

test("buildOngoingResponse hides only explicitly skipped danmaku metrics", () => {
  const buildResponse = (danmakuValue) => buildOngoingResponse({
    platform: "missevan",
    ongoingIds: ["93038"],
    indexSnapshot: { dates: ["2026-07-16"] },
    metricSnapshotsByDate: {
      "2026-07-16": {
        dramas: {
          93038: {
            name: "一屋暗灯",
            view_count: 100,
            subscription_num: 10,
            danmaku_uid_count: danmakuValue,
          },
        },
      },
    },
  });

  assert.equal(buildResponse("  无需抓取  ").items[0].metrics.danmaku_uid_count.visible, false);
  assert.equal(buildResponse(null).items[0].metrics.danmaku_uid_count.visible, undefined);
  assert.equal(buildResponse(0).items[0].metrics.danmaku_uid_count.visible, undefined);
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
