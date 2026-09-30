import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOngoingCvOptions,
  buildOngoingResponse,
  filterOngoingItemsByCvNames,
  isOngoingNewDrama,
  isOngoingEmptyPaidDanmakuMetric,
  normalizeOngoingIdList,
  sortOngoingItemsByMetricDelta,
  sortOngoingItemsByWindowDelta,
} from "./ongoingUtils.js";
import {
  buildMetricSnapshotsFromRankTrendAggregate,
  buildRankTrendResponse,
} from "./ranksTrendUtils.js";

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

test("ongoing CV options count each main role once per drama and sort predictably", () => {
  const options = buildOngoingCvOptions([
    { id: "1", main_cvs: [" 阿杰 ", "边江", "阿杰"] },
    { id: "2", main_cvs: ["边江", "锦鲤"] },
    { id: "3", main_cvs: ["阿杰", "", null] },
    { id: "4", main_cvs: null },
  ]);

  assert.deepEqual(options, [
    { name: "阿杰", count: 2 },
    { name: "边江", count: 2 },
    { name: "锦鲤", count: 1 },
  ]);
});

test("ongoing CV filtering uses immediate OR matching without reordering source items", () => {
  const items = [
    { id: "3", main_cvs: ["甲"] },
    { id: "1", main_cvs: ["乙", "丙"] },
    { id: "2", main_cvs: ["丁"] },
    { id: "4", main_cvs: [] },
  ];

  assert.equal(filterOngoingItemsByCvNames(items, new Set()), items);
  assert.deepEqual(
    filterOngoingItemsByCvNames(items, new Set([" 丙 ", "甲"])).map((item) => item.id),
    ["3", "1"]
  );
  assert.deepEqual(filterOngoingItemsByCvNames(items, new Set(["不存在"])), []);
});

test("buildOngoingResponse keeps listed dramas when the current snapshot is missing", () => {
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
  assert.equal(response.items.length, 3);
  assert.deepEqual(response.items.map((item) => item.id), ["101", "404", "202"]);
  assert.equal(response.items[0].name, "四面佛");
  assert.equal(response.items[0].payment_label, "付费");
  assert.equal(response.items[2].payment_label, "会员");
  assert.equal(response.items[0].main_cv_text, "袁铭喆，赵成晨");
  assert.equal(response.items[0].windows["3d"].metrics.view_count.delta, 400);
  assert.equal(response.items[0].windows["30d"].metrics.view_count.delta, 900);
  assert.equal(response.items[0].windows["3d"].metrics.subscription_num.label, "追剧人数");
  assert.equal(response.items[1].name, "404");
  assert.equal(response.items[1].metrics.view_count.value, null);
  assert.equal(response.items[1].windows["7d"].metrics.view_count.delta, null);
  assert.equal(response.items[1].windows["7d"].metrics.view_count.available, false);
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

test("buildOngoingResponse anchors the current day and preserves static metadata without a current sample", () => {
  const id = "90878";
  const response = buildOngoingResponse({
    platform: "missevan",
    ongoingIds: [id],
    indexSnapshot: { dates: ["2026-06-08", "2026-06-10"] },
    windowEndDate: "2026-06-10",
    staticDramasById: {
      [id]: {
        name: "静态剧名",
        cover: "https://example.com/static.jpg",
        main_cvs: ["甲"],
        payment_label: "付费",
      },
    },
    createTimesById: { [id]: "2026.01" },
    currentMonth: "2026.06",
    metricSnapshotsByDate: {
      "2026-06-08": {
        dramas: {
          [id]: {
            name: "旧剧名",
            view_count: 100,
            danmaku_uid_count: 10,
            subscription_num: 20,
          },
        },
      },
    },
  });

  assert.equal(response.latestDate, "2026-06-10");
  assert.equal(response.windowEndDate, "2026-06-10");
  assert.equal(response.items.length, 1);
  assert.equal(response.items[0].name, "静态剧名");
  assert.equal(response.items[0].cover, "https://example.com/static.jpg");
  assert.deepEqual(response.items[0].main_cvs, ["甲"]);
  assert.equal(response.items[0].metrics.view_count.value, null);
  for (const windowKey of ["3d", "7d", "30d"]) {
    const window = response.items[0].windows[windowKey];
    assert.equal(window.toDate, "2026-06-10");
    assert.equal(window.metrics.view_count.toValue, null);
    assert.equal(window.metrics.view_count.delta, null);
    assert.equal(window.metrics.view_count.available, false);
  }
});

test("buildOngoingResponse keeps other current metrics when one field is missing", () => {
  const id = "90878";
  const response = buildOngoingResponse({
    platform: "missevan",
    ongoingIds: [id],
    indexSnapshot: { dates: ["2026-06-07", "2026-06-10"] },
    windowEndDate: "2026-06-10",
    metricSnapshotsByDate: {
      "2026-06-07": {
        dramas: {
          [id]: { view_count: 100, danmaku_uid_count: 10, subscription_num: 20 },
        },
      },
      "2026-06-10": {
        dramas: {
          [id]: { name: "当前剧", view_count: 140, danmaku_uid_count: 15, subscription_num: null },
        },
      },
    },
  });

  const item = response.items[0];
  assert.equal(item.metrics.view_count.value, 140);
  assert.equal(item.metrics.subscription_num.value, null);
  assert.equal(item.windows["3d"].metrics.view_count.delta, 40);
  assert.equal(item.windows["3d"].metrics.view_count.available, true);
  assert.equal(item.windows["3d"].metrics.subscription_num.delta, null);
  assert.equal(item.windows["3d"].metrics.subscription_num.available, false);
});

test("buildOngoingResponse matches rank trend stale-sample handling for repeated current snapshots", () => {
  const id = "90878";
  const repeatedDrama = {
    name: "重复剧",
    view_count: 100,
    danmaku_uid_count: 10,
    subscription_num: 20,
  };
  const indexSnapshot = {
    dates: ["2026-06-07", "2026-06-08", "2026-06-09", "2026-06-10"],
  };
  const metricSnapshotsByDate = {
    "2026-06-07": { dramas: { [id]: repeatedDrama } },
    "2026-06-08": { dramas: { [id]: { ...repeatedDrama } } },
    "2026-06-09": { dramas: { [id]: { ...repeatedDrama } } },
    "2026-06-10": { dramas: { [id]: { ...repeatedDrama } } },
  };
  const trend = buildRankTrendResponse({
    platform: "missevan",
    id,
    indexSnapshot,
    metricSnapshotsByDate,
    windowEndDate: "2026-06-10",
  });
  const ongoing = buildOngoingResponse({
    platform: "missevan",
    ongoingIds: [id],
    indexSnapshot,
    metricSnapshotsByDate,
    windowEndDate: "2026-06-10",
  });

  assert.equal(trend.latestDate, "2026-06-07");
  assert.equal(trend.windows["3d"].metrics.find((metric) => metric.key === "view_count").toValue, null);
  assert.equal(ongoing.items[0].metrics.view_count.value, null);
  assert.equal(ongoing.items[0].metrics.subscription_num.value, null);
  assert.equal(ongoing.items[0].metrics.danmaku_uid_count.value, null);
  assert.equal(ongoing.items[0].windows["3d"].metrics.view_count.delta, null);
  assert.equal(ongoing.items[0].windows["7d"].metrics.view_count.delta, null);
  assert.equal(ongoing.items[0].windows["30d"].metrics.view_count.delta, null);
});

test("buildOngoingResponse treats a repeated sample after a missing date as stale", () => {
  const id = "90878";
  const sample = { name: "间断剧", view_count: 200, danmaku_uid_count: 12, subscription_num: 30 };
  const indexSnapshot = {
    dates: ["2026-06-07", "2026-06-08", "2026-06-09", "2026-06-10"],
  };
  const metricSnapshotsByDate = {
    "2026-06-07": { dramas: { [id]: sample } },
    "2026-06-08": { dramas: { [id]: { ...sample } } },
    "2026-06-09": { dramas: {} },
    "2026-06-10": { dramas: { [id]: { ...sample } } },
  };
  const trend = buildRankTrendResponse({
    platform: "missevan",
    id,
    indexSnapshot,
    metricSnapshotsByDate,
    windowEndDate: "2026-06-10",
  });
  const ongoing = buildOngoingResponse({
    platform: "missevan",
    ongoingIds: [id],
    indexSnapshot,
    metricSnapshotsByDate,
    windowEndDate: "2026-06-10",
  });

  assert.equal(trend.latestDate, "2026-06-07");
  assert.equal(trend.windows["3d"].metrics.find((metric) => metric.key === "view_count").toValue, null);
  assert.equal(ongoing.items[0].metrics.view_count.value, null);
  assert.equal(ongoing.items[0].windows["3d"].metrics.view_count.available, false);
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

  assert.equal(currentlyMissingPayCountResponse.items[0].metrics.pay_count.visible, true);

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

test("ongoing sort capsules use the platform metric, put unavailable values last, and tie-break by name", () => {
  const createItem = (id, name, metrics) => ({
    id,
    name,
    windows: {
      "7d": {
        metrics: Object.fromEntries(Object.entries(metrics).map(([key, delta]) => [key, {
          delta,
          available: delta != null,
        }])),
      },
    },
  });
  const missevanItems = [
    createItem("1", "猫乙", { view_count: 100, subscription_num: 40, danmaku_uid_count: 90 }),
    createItem("2", "猫甲", { view_count: 100, subscription_num: 40, danmaku_uid_count: 10 }),
    createItem("3", "猫丙", { view_count: 10, subscription_num: 5, danmaku_uid_count: 5 }),
    createItem("4", "猫缺乙", { view_count: null, subscription_num: null, danmaku_uid_count: null }),
    createItem("5", "猫缺甲", { view_count: null, subscription_num: null, danmaku_uid_count: null }),
  ];

  assert.deepEqual(sortOngoingItemsByMetricDelta(missevanItems, "missevan", "playback").map((item) => item.id), ["2", "1", "3", "5", "4"]);
  assert.deepEqual(sortOngoingItemsByMetricDelta(missevanItems, "missevan", "secondary").map((item) => item.id), ["2", "1", "3", "5", "4"]);
  assert.deepEqual(sortOngoingItemsByMetricDelta(missevanItems, "missevan", "paid-id").map((item) => item.id), ["1", "2", "3", "5", "4"]);

  const manboItems = [
    createItem("11", "漫乙", { view_count: 10, subscription_num: 999, pay_count: 20, danmaku_uid_count: 4 }),
    createItem("12", "漫甲", { view_count: 30, subscription_num: 1, pay_count: 80, danmaku_uid_count: 9 }),
    createItem("13", "漫缺", { view_count: null, subscription_num: null, pay_count: null, danmaku_uid_count: null }),
  ];

  assert.deepEqual(sortOngoingItemsByMetricDelta(manboItems, "manbo", "playback").map((item) => item.id), ["12", "11", "13"]);
  assert.deepEqual(sortOngoingItemsByMetricDelta(manboItems, "manbo", "secondary").map((item) => item.id), ["12", "11", "13"]);
  assert.deepEqual(sortOngoingItemsByMetricDelta(manboItems, "manbo", "paid-id").map((item) => item.id), ["12", "11", "13"]);
});
