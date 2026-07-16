import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAggregatedRankTrendResponse,
  buildCvTrendResponse,
  buildMetricSnapshotsFromRankTrendAggregate,
  buildPeakSeriesTrendResponse,
  buildRankTrendAvailabilityResponse,
  buildRankTrendResponse,
  getPeakSeriesDailyViewDelta,
} from "./ranksTrendUtils.js";
import { isSkippedDanmakuMetricValue } from "./rankMetricUtils.js";

const sampleIndex = {
  version: 1,
  dates: ["2026-04-24", "2026-04-26"],
  updated_at: "2026-04-26T01:06:48.925778+00:00",
};

test("buildRankTrendResponse uses available snapshots for every window", () => {
  const response = buildRankTrendResponse({
    platform: "missevan",
    id: "15861",
    indexSnapshot: sampleIndex,
    metricSnapshotsByDate: {
      "2026-04-24": {
        date: "2026-04-24",
        platform: "missevan",
        dramas: {
          "15861": {
            name: "魔道祖师 第一季",
            view_count: 100,
            danmaku_uid_count: 10,
            subscription_num: 1000,
            generated_at: "2026-04-24T01:00:00.000Z",
          },
        },
      },
      "2026-04-26": {
        date: "2026-04-26",
        platform: "missevan",
        dramas: {
          "15861": {
            name: "魔道祖师 第一季",
            view_count: 150,
            danmaku_uid_count: 14,
            subscription_num: 1200,
            generated_at: "2026-04-26T01:06:48.925Z",
          },
        },
      },
    },
  });

  assert.equal(response.success, true);
  assert.equal(response.id, "15861");
  assert.equal(response.name, "魔道祖师 第一季");
  assert.equal(response.latestDate, "2026-04-26");

  for (const windowKey of ["3d", "7d", "30d"]) {
    assert.equal(
      response.windows[windowKey].label,
      {
        "3d": "3日",
        "7d": "7日",
        "30d": "30日",
      }[windowKey]
    );
    assert.equal(response.windows[windowKey].fromDate, "2026-04-24");
    assert.equal(response.windows[windowKey].toDate, "2026-04-26");
    assert.equal(response.windows[windowKey].generatedAt, "2026-04-26T01:06:48.925Z");
    assert.equal(response.windows[windowKey].insufficientData, false);
    assert.equal(response.windows[windowKey].metrics[0].history.at(-1).generatedAt, "2026-04-26T01:06:48.925Z");
    assert.deepEqual(
      response.windows[windowKey].metrics.map((metric) => ({
        key: metric.key,
        label: metric.label,
        toValue: metric.toValue,
        delta: metric.delta,
        deltaPercent: metric.deltaPercent,
        available: metric.available,
      })),
      [
        {
          key: "view_count",
          label: "播放量",
          toValue: 150,
          delta: 50,
          deltaPercent: 0.5,
          available: true,
        },
        {
          key: "danmaku_uid_count",
          label: "付费ID数",
          toValue: 14,
          delta: 4,
          deltaPercent: 0.4,
          available: true,
        },
        {
          key: "subscription_num",
          label: "追剧人数",
          toValue: 1200,
          delta: 200,
          deltaPercent: 0.2,
          available: true,
        },
      ]
    );
  }
});

test("buildRankTrendResponse preserves Manbo big integer ids and pay count metric", () => {
  const response = buildRankTrendResponse({
    platform: "manbo",
    id: "2087206604062588962",
    indexSnapshot: sampleIndex,
    listSnapshotsByDate: {
      "2026-04-24": {
        ranks: {
          hot: {
            name: "热播榜",
            items: [{ position: 2, drama_id: "2087206604062588962" }],
          },
        },
      },
      "2026-04-26": {
        ranks: {
          hot: {
            name: "热播榜",
            items: [{ position: 1, drama_id: "2087206604062588962" }],
          },
        },
      },
    },
    metricSnapshotsByDate: {
      "2026-04-24": {
        dramas: {
          "2087206604062588962": {
            name: "囚于永夜",
            view_count: 3000,
            danmaku_uid_count: 20,
            pay_count: 100,
          },
        },
      },
      "2026-04-26": {
        dramas: {
          "2087206604062588962": {
            name: "囚于永夜",
            view_count: 3300,
            danmaku_uid_count: 26,
            pay_count: 130,
          },
        },
      },
    },
  });

  assert.equal(response.id, "2087206604062588962");
  assert.deepEqual(response.rankHistory, [
    {
      date: "2026-04-24",
      ranks: [{ key: "hot", name: "热播榜", position: 2 }],
    },
    {
      date: "2026-04-26",
      ranks: [{ key: "hot", name: "热播榜", position: 1 }],
    },
  ]);
  assert.deepEqual(
    response.windows["3d"].metrics.map((metric) => [metric.key, metric.label, metric.delta]),
    [
      ["view_count", "播放量", 300],
      ["danmaku_uid_count", "付费ID数", 6],
      ["pay_count", "付费/收听人数", 30],
    ]
  );
});

test("buildRankTrendResponse marks missing metric fields as unavailable", () => {
  const response = buildRankTrendResponse({
    platform: "manbo",
    id: "2182687618293039383",
    indexSnapshot: sampleIndex,
    metricSnapshotsByDate: {
      "2026-04-24": {
        dramas: {
          "2182687618293039383": {
            name: "干涸地",
            view_count: 100,
          },
        },
      },
      "2026-04-26": {
        dramas: {
          "2182687618293039383": {
            name: "干涸地",
            view_count: 130,
            danmaku_uid_count: 0,
          },
        },
      },
    },
  });

  const danmakuMetric = response.windows["3d"].metrics.find(
    (metric) => metric.key === "danmaku_uid_count"
  );
  assert.equal(danmakuMetric.available, false);
  assert.equal(danmakuMetric.delta, null);
  assert.equal(danmakuMetric.deltaPercent, null);
});

test("buildRankTrendResponse preserves explicit null and zero metric values", () => {
  const response = buildRankTrendResponse({
    platform: "manbo",
    id: "2106168395048157341",
    indexSnapshot: {
      ...sampleIndex,
      dates: ["2026-04-22", "2026-04-24", "2026-04-26"],
    },
    metricSnapshotsByDate: {
      "2026-04-22": {
        dramas: {
          "2106168395048157341": {
            name: "缺失点测试",
            view_count: 1000,
            danmaku_uid_count: 0,
            pay_count: 20,
          },
        },
      },
      "2026-04-24": {
        dramas: {
          "2106168395048157341": {
            name: "缺失点测试",
            view_count: 1100,
            danmaku_uid_count: 10,
            pay_count: 25,
          },
        },
      },
      "2026-04-26": {
        dramas: {
          "2106168395048157341": {
            name: "缺失点测试",
            view_count: 1200,
            danmaku_uid_count: null,
            pay_count: 30,
          },
        },
      },
    },
  });

  const danmakuMetric = response.windows["7d"].metrics.find(
    (metric) => metric.key === "danmaku_uid_count"
  );

  assert.deepEqual(
    danmakuMetric.history.map((point) => [point.date, point.value]),
    [
      ["2026-04-22", 0],
      ["2026-04-24", 10],
      ["2026-04-26", null],
    ]
  );
  assert.equal(danmakuMetric.fromValue, 0);
  assert.equal(danmakuMetric.toValue, 10);
  assert.equal(danmakuMetric.available, true);
  assert.equal(danmakuMetric.delta, 10);
  assert.equal(danmakuMetric.deltaPercent, null);
});

test("skipped danmaku capture keeps history gaps and makes the latest metric unavailable", () => {
  assert.equal(isSkippedDanmakuMetricValue("无需抓取"), true);
  assert.equal(isSkippedDanmakuMetricValue("  无需抓取  "), true);
  assert.equal(isSkippedDanmakuMetricValue(0), false);

  const buildResponse = (latestDanmakuValue) => buildRankTrendResponse({
    platform: "missevan",
    id: "93038",
    indexSnapshot: { dates: ["2026-07-14", "2026-07-15", "2026-07-16"] },
    metricSnapshotsByDate: {
      "2026-07-14": {
        dramas: {
          93038: {
            name: "一屋暗灯",
            view_count: 100,
            subscription_num: 10,
            danmaku_uid_count: 20,
          },
        },
      },
      "2026-07-15": {
        dramas: {
          93038: {
            name: "一屋暗灯",
            view_count: 120,
            subscription_num: 12,
            danmaku_uid_count: "无需抓取",
          },
        },
      },
      "2026-07-16": {
        dramas: {
          93038: {
            name: "一屋暗灯",
            view_count: 150,
            subscription_num: 15,
            danmaku_uid_count: latestDanmakuValue,
          },
        },
      },
    },
  });

  const recoveredMetric = buildResponse(26).windows["3d"].metrics.find(
    (metric) => metric.key === "danmaku_uid_count"
  );
  assert.deepEqual(recoveredMetric.history.map((point) => point.value), [20, null, 26]);
  assert.equal(recoveredMetric.available, true);
  assert.equal(recoveredMetric.toValue, 26);
  assert.equal(recoveredMetric.delta, 6);

  const skippedLatestMetric = buildResponse("  无需抓取  ").windows["3d"].metrics.find(
    (metric) => metric.key === "danmaku_uid_count"
  );
  assert.deepEqual(skippedLatestMetric.history.map((point) => point.value), [20, null, null]);
  assert.equal(skippedLatestMetric.fromValue, 20);
  assert.equal(skippedLatestMetric.toValue, null);
  assert.equal(skippedLatestMetric.available, false);
  assert.equal(skippedLatestMetric.delta, null);
  assert.equal(skippedLatestMetric.deltaPercent, null);
});

test("skipped danmaku capture remains the latest point when replacing an ordinary null", () => {
  const response = buildRankTrendResponse({
    platform: "missevan",
    id: "93038",
    indexSnapshot: { dates: ["2026-07-14", "2026-07-15", "2026-07-16"] },
    metricSnapshotsByDate: {
      "2026-07-14": {
        dramas: {
          93038: {
            name: "一屋暗灯",
            view_count: 100,
            subscription_num: 10,
            danmaku_uid_count: 20,
          },
        },
      },
      "2026-07-15": {
        dramas: {
          93038: {
            name: "一屋暗灯",
            view_count: 120,
            subscription_num: 12,
            danmaku_uid_count: null,
          },
        },
      },
      "2026-07-16": {
        dramas: {
          93038: {
            name: "一屋暗灯",
            view_count: 120,
            subscription_num: 12,
            danmaku_uid_count: "无需抓取",
          },
        },
      },
    },
  });
  const metrics = response.windows["3d"].metrics;
  const viewMetric = metrics.find((metric) => metric.key === "view_count");
  const danmakuMetric = metrics.find((metric) => metric.key === "danmaku_uid_count");

  assert.equal(response.latestDate, "2026-07-16");
  assert.equal(viewMetric.toValue, 120);
  assert.equal(danmakuMetric.toValue, null);
  assert.equal(danmakuMetric.available, false);
});

test("buildCvTrendResponse combines cross-platform weekly playback metrics", () => {
  const response = buildCvTrendResponse({
    id: "路知行",
    trendSnapshots: {
      missevan: {
        platform: "missevan",
        updated_at: "2026-06-19T04:04:53+00:00",
        dates: ["2026-06-13", "2026-06-19"],
        cvs: {
          "路知行": {
            cvName: "路知行",
            samples: {
              "2026-06-13": {
                generated_at: "2026-06-13T02:38:36+00:00",
                metrics: {
                  totalViewCount: 1189097577,
                  paidViewCount: null,
                },
                ranks: {
                  total: 1,
                  paid: null,
                },
              },
              "2026-06-19": {
                generated_at: "2026-06-19T04:04:53+00:00",
                metrics: {
                  totalViewCount: 1190603800,
                  paidViewCount: 1183878183,
                },
                ranks: {
                  total: 1,
                  paid: 1,
                },
              },
            },
          },
        },
      },
      manbo: {
        platform: "manbo",
        updated_at: "2026-06-19T04:04:53+00:00",
        dates: ["2026-06-13", "2026-06-19"],
        cvs: {
          "路知行": {
            cvName: "路知行",
            samples: {
              "2026-06-13": {
                generated_at: "2026-06-13T02:38:36+00:00",
                metrics: {
                  totalViewCount: 1000,
                  paidViewCount: null,
                },
                ranks: {
                  total: 5,
                  paid: null,
                },
              },
              "2026-06-19": {
                generated_at: "2026-06-19T04:04:53+00:00",
                metrics: {
                  totalViewCount: 2000,
                  paidViewCount: 1500,
                },
                ranks: {
                  total: 3,
                  paid: 4,
                },
              },
            },
          },
        },
      },
    },
  });

  assert.equal(response.success, true);
  assert.equal(response.kind, "cv");
  assert.equal(response.id, "路知行");
  assert.equal(response.name, "路知行");
  assert.equal(response.latestDate, "2026-06-19");
  assert.deepEqual(
    Object.values(response.windows).map((window) => window.label),
    ["3周", "7周", "30周"]
  );
  assert.deepEqual(
    response.windows["3w"].metrics.map((metric) => [metric.key, metric.label, metric.delta, metric.available]),
    [
      ["missevan_total_view_count", "猫耳总播放量", 1506223, true],
      ["missevan_paid_view_count", "猫耳付费播放量", null, false],
      ["manbo_total_view_count", "漫播总播放量", 1000, true],
      ["manbo_paid_view_count", "漫播付费播放量", null, false],
    ]
  );
  assert.deepEqual(response.rankHistory, [
    {
      date: "2026-06-13",
      ranks: [
        { key: "missevan-cv", name: "猫耳CV总榜", position: 1 },
        { key: "manbo-cv", name: "漫播CV总榜", position: 5 },
      ],
    },
    {
      date: "2026-06-19",
      ranks: [
        { key: "missevan-cv", name: "猫耳CV总榜", position: 1 },
        { key: "missevan-cv-paid", name: "猫耳CV付费榜", position: 1 },
        { key: "manbo-cv", name: "漫播CV总榜", position: 3 },
        { key: "manbo-cv-paid", name: "漫播CV付费榜", position: 4 },
      ],
    },
  ]);
});

test("buildCvTrendResponse rejects an incomplete cross-platform aggregate pair", () => {
  const response = buildCvTrendResponse({
    id: "路知行",
    trendSnapshots: {
      missevan: {
        platform: "missevan",
        dates: ["2026-06-19"],
        cvs: {
          "路知行": {
            samples: {
              "2026-06-19": {
                metrics: { totalViewCount: 100 },
                ranks: { total: 1 },
              },
            },
          },
        },
      },
      manbo: null,
    },
  });

  assert.deepEqual(response, {
    success: false,
    status: 503,
    kind: "cv",
    id: "路知行",
    message: "CV rank trend aggregate is unavailable",
  });
});

test("buildCvTrendResponse returns not found only after both CV aggregates validate", () => {
  const response = buildCvTrendResponse({
    id: "不存在",
    trendSnapshots: {
      missevan: { platform: "missevan", cvs: {} },
      manbo: { platform: "manbo", cvs: {} },
    },
  });

  assert.equal(response.success, false);
  assert.equal(response.status, 404);
});

test("buildRankTrendResponse keeps one pre-window history point for increment charts without changing window deltas", () => {
  const response = buildRankTrendResponse({
    platform: "missevan",
    id: "15861",
    indexSnapshot: {
      version: 1,
      dates: ["2026-05-30", "2026-05-31", "2026-06-01", "2026-06-02", "2026-06-03"],
      updated_at: "2026-06-03T01:00:00.000Z",
    },
    metricSnapshotsByDate: {
      "2026-05-30": {
        date: "2026-05-30",
        platform: "missevan",
        dramas: {
          "15861": {
            name: "魔道祖师 第一季",
            view_count: 900,
            danmaku_uid_count: 90,
            subscription_num: 9000,
            generated_at: "2026-05-30T01:00:00.000Z",
          },
        },
      },
      "2026-05-31": {
        date: "2026-05-31",
        platform: "missevan",
        dramas: {
          "15861": {
            name: "魔道祖师 第一季",
            view_count: 1000,
            danmaku_uid_count: 100,
            subscription_num: 10000,
            generated_at: "2026-05-31T01:00:00.000Z",
          },
        },
      },
      "2026-06-01": {
        date: "2026-06-01",
        platform: "missevan",
        dramas: {
          "15861": {
            name: "魔道祖师 第一季",
            view_count: 1300,
            danmaku_uid_count: 130,
            subscription_num: 10300,
            generated_at: "2026-06-01T01:00:00.000Z",
          },
        },
      },
      "2026-06-02": {
        date: "2026-06-02",
        platform: "missevan",
        dramas: {
          "15861": {
            name: "魔道祖师 第一季",
            view_count: 1500,
            danmaku_uid_count: 140,
            subscription_num: 10600,
            generated_at: "2026-06-02T01:00:00.000Z",
          },
        },
      },
      "2026-06-03": {
        date: "2026-06-03",
        platform: "missevan",
        dramas: {
          "15861": {
            name: "魔道祖师 第一季",
            view_count: 1800,
            danmaku_uid_count: 150,
            subscription_num: 11000,
            generated_at: "2026-06-03T01:00:00.000Z",
          },
        },
      },
    },
  });

  const viewMetric = response.windows["3d"].metrics.find((metric) => metric.key === "view_count");

  assert.equal(response.windows["3d"].fromDate, "2026-05-31");
  assert.equal(response.windows["3d"].toDate, "2026-06-03");
  assert.equal(viewMetric.delta, 800);
  assert.deepEqual(
    viewMetric.history.map((point) => [point.date, point.value, Boolean(point.isPreWindow)]),
    [
      ["2026-05-30", 900, true],
      ["2026-05-31", 1000, false],
      ["2026-06-01", 1300, false],
      ["2026-06-02", 1500, false],
      ["2026-06-03", 1800, false],
    ]
  );
});

test("buildRankTrendResponse keeps missing drama dates as null points without filling calendar gaps", () => {
  const response = buildRankTrendResponse({
    platform: "missevan",
    id: "93038",
    indexSnapshot: {
      version: 1,
      dates: ["2026-04-24", "2026-04-25", "2026-05-01", "2026-05-09"],
    },
    metricSnapshotsByDate: {
      "2026-04-24": {
        dramas: {
          "93038": {
            name: "一屋暗灯",
            view_count: 100,
            danmaku_uid_count: null,
            subscription_num: 10,
          },
        },
      },
      "2026-04-25": {
        dramas: {
          other: {
            name: "其他作品",
            view_count: 999,
            danmaku_uid_count: 99,
            subscription_num: 99,
          },
        },
      },
      "2026-05-01": {
        dramas: {
          "93038": {
            name: "一屋暗灯",
            view_count: 150,
            danmaku_uid_count: 10,
            subscription_num: 15,
          },
        },
      },
      "2026-05-09": {
        dramas: {
          "93038": {
            name: "一屋暗灯",
            view_count: 260,
            danmaku_uid_count: 25,
            subscription_num: 30,
          },
        },
      },
    },
  });

  assert.equal(response.success, true);
  assert.equal(response.windows["30d"].fromDate, "2026-04-24");
  assert.equal(response.windows["30d"].toDate, "2026-05-09");

  const viewMetric = response.windows["30d"].metrics.find((metric) => metric.key === "view_count");
  assert.deepEqual(
    viewMetric.history.map((point) => [point.date, point.value]),
    [
      ["2026-04-24", 100],
      ["2026-04-25", null],
      ["2026-05-01", 150],
      ["2026-05-09", 260],
    ]
  );
  assert.equal(viewMetric.delta, 160);
  assert.equal(viewMetric.deltaPercent, 1.6);

  const paidIdMetric = response.windows["30d"].metrics.find(
    (metric) => metric.key === "danmaku_uid_count"
  );
  assert.deepEqual(
    paidIdMetric.history.map((point) => [point.date, point.value]),
    [
      ["2026-04-24", null],
      ["2026-04-25", null],
      ["2026-05-01", 10],
      ["2026-05-09", 25],
    ]
  );
  assert.equal(paidIdMetric.fromValue, 10);
  assert.equal(paidIdMetric.toValue, 25);
  assert.equal(paidIdMetric.delta, 15);
  assert.equal(paidIdMetric.deltaPercent, 1.5);
});

test("buildRankTrendResponse treats repeated Missevan display metrics as missing data", () => {
  const response = buildRankTrendResponse({
    platform: "missevan",
    id: "88696",
    indexSnapshot: {
      version: 1,
      dates: ["2026-05-06", "2026-05-07", "2026-05-08", "2026-05-29", "2026-05-30"],
    },
    metricSnapshotsByDate: {
      "2026-05-06": {
        dramas: {
          "88696": {
            name: "顽石 全一季",
            view_count: 3826067,
            danmaku_uid_count: 4891,
            subscription_num: 60506,
          },
        },
      },
      "2026-05-07": {
        dramas: {
          "88696": {
            name: "顽石 全一季",
            view_count: 3826067,
            danmaku_uid_count: 4891,
            subscription_num: 60506,
          },
        },
      },
      "2026-05-08": {
        dramas: {
          "88696": {
            name: "顽石 全一季",
            view_count: 3826067,
            danmaku_uid_count: 4891,
            subscription_num: 60506,
          },
        },
      },
      "2026-05-29": {
        dramas: {
          "88696": {
            name: "顽石 全一季",
            view_count: 3826067,
            danmaku_uid_count: 4891,
            subscription_num: 60506,
          },
        },
      },
      "2026-05-30": {
        dramas: {
          "88696": {
            name: "顽石 全一季",
            view_count: 4027349,
            danmaku_uid_count: 5145,
            subscription_num: 62124,
          },
        },
      },
    },
  });

  const thirtyDayWindow = response.windows["30d"];
  const viewMetric = thirtyDayWindow.metrics.find((metric) => metric.key === "view_count");
  const paidIdMetric = thirtyDayWindow.metrics.find((metric) => metric.key === "danmaku_uid_count");
  const subscriptionMetric = thirtyDayWindow.metrics.find((metric) => metric.key === "subscription_num");

  assert.deepEqual(
    viewMetric.history.map((point) => [point.date, point.value]),
    [
      ["2026-05-06", 3826067],
      ["2026-05-07", null],
      ["2026-05-08", null],
      ["2026-05-29", null],
      ["2026-05-30", 4027349],
    ]
  );
  assert.equal(viewMetric.delta, 201282);
  assert.equal(paidIdMetric.delta, 254);
  assert.equal(subscriptionMetric.delta, 1618);

  assert.equal(response.windows["3d"].insufficientData, true);
  assert.equal(response.windows["3d"].metrics[0].available, false);
  assert.deepEqual(
    response.windows["3d"].metrics[0].history.map((point) => [point.date, point.value]),
    [
      ["2026-05-29", null],
      ["2026-05-30", 4027349],
    ]
  );
  assert.equal(response.windows["7d"].insufficientData, true);
});

test("buildRankTrendResponse includes Manbo pay count when detecting repeated display metrics", () => {
  const response = buildRankTrendResponse({
    platform: "manbo",
    id: "2087206604062588962",
    indexSnapshot: {
      version: 1,
      dates: ["2026-05-01", "2026-05-02", "2026-05-03"],
    },
    metricSnapshotsByDate: {
      "2026-05-01": {
        dramas: {
          "2087206604062588962": {
            name: "囚于永夜",
            view_count: 100,
            danmaku_uid_count: 10,
            pay_count: 5,
          },
        },
      },
      "2026-05-02": {
        dramas: {
          "2087206604062588962": {
            name: "囚于永夜",
            view_count: 100,
            danmaku_uid_count: 10,
            pay_count: 5,
          },
        },
      },
      "2026-05-03": {
        dramas: {
          "2087206604062588962": {
            name: "囚于永夜",
            view_count: 100,
            danmaku_uid_count: 10,
            pay_count: 6,
          },
        },
      },
    },
  });

  const window = response.windows["3d"];
  assert.equal(window.insufficientData, false);
  assert.deepEqual(
    window.metrics.map((metric) => [metric.key, metric.delta, metric.history.map((point) => point.value)]),
    [
      ["view_count", 0, [100, null, 100]],
      ["danmaku_uid_count", 0, [10, null, 10]],
      ["pay_count", 1, [5, null, 6]],
    ]
  );
});

test("buildRankTrendResponse returns not found when a drama has no metric snapshots", () => {
  const response = buildRankTrendResponse({
    platform: "missevan",
    id: "999",
    indexSnapshot: sampleIndex,
    metricSnapshotsByDate: {
      "2026-04-24": { dramas: {} },
      "2026-04-26": { dramas: {} },
    },
  });

  assert.equal(response.success, false);
  assert.equal(response.status, 404);
});

test("buildAggregatedRankTrendResponse builds ordinary trend response from platform aggregate", () => {
  const response = buildAggregatedRankTrendResponse({
    platform: "missevan",
    id: "93038",
    aggregateSnapshot: {
      version: 1,
      platform: "missevan",
      updated_at: "2026-05-17T01:00:00.000Z",
      dates: ["2026-05-15", "2026-05-16", "2026-05-17"],
      dramas: {
        "93038": {
          id: "93038",
          name: "一屋暗灯 全一季",
          samples: {
            "2026-05-15": {
              generated_at: "2026-05-15T01:00:00.000Z",
              metrics: {
                view_count: 100,
                danmaku_uid_count: 10,
                subscription_num: 50,
              },
              ranks: [{ key: "new_daily", name: "新品日榜", position: 5 }],
            },
            "2026-05-17": {
              metrics: {
                view_count: 160,
                danmaku_uid_count: 16,
                subscription_num: 60,
              },
              ranks: [
                { key: "new_daily", name: "新品日榜", position: 2 },
                { key: "bestseller_weekly", name: "畅销周榜", position: 9 },
              ],
            },
          },
        },
      },
    },
  });

  assert.equal(response.success, true);
  assert.equal(response.platform, "missevan");
  assert.equal(response.id, "93038");
  assert.equal(response.name, "一屋暗灯 全一季");
  assert.equal(response.latestDate, "2026-05-17");
  assert.deepEqual(response.rankHistory, [
    {
      date: "2026-05-15",
      ranks: [{ key: "new_daily", name: "新品日榜", position: 5 }],
    },
    {
      date: "2026-05-17",
      ranks: [
        { key: "new_daily", name: "新品日榜", position: 2 },
        { key: "bestseller_weekly", name: "畅销周榜", position: 9 },
      ],
    },
  ]);

  assert.equal(response.windows["3d"].fromDate, "2026-05-15");
  assert.equal(response.windows["3d"].toDate, "2026-05-17");
  assert.equal(response.windows["3d"].generatedAt, "2026-05-17T01:00:00.000Z");
  assert.deepEqual(
    response.windows["3d"].metrics.map((metric) => [metric.key, metric.delta, metric.history.at(-1).generatedAt]),
    [
      ["view_count", 60, "2026-05-17T01:00:00.000Z"],
      ["danmaku_uid_count", 6, "2026-05-17T01:00:00.000Z"],
      ["subscription_num", 10, "2026-05-17T01:00:00.000Z"],
    ]
  );
});

test("buildRankTrendAvailabilityResponse returns ids with historical metric samples", () => {
  const response = buildRankTrendAvailabilityResponse({
    platform: "missevan",
    ids: ["93038", "rank-only", "missing"],
    aggregateSnapshot: {
      version: 1,
      platform: "missevan",
      updated_at: "2026-05-17T01:00:00.000Z",
      dates: ["2026-05-13", "2026-05-14", "2026-05-15", "2026-05-16", "2026-05-17"],
      dramas: {
        "93038": {
          id: "93038",
          name: "一屋暗灯 全一季",
          samples: {
            "2026-05-13": {
              metrics: {
                view_count: 98,
                danmaku_uid_count: 9,
                subscription_num: 48,
              },
            },
            "2026-05-14": {
              metrics: {
                view_count: 99,
                danmaku_uid_count: 9,
                subscription_num: 49,
              },
            },
            "2026-05-15": {
              metrics: {
                view_count: 100,
                danmaku_uid_count: 10,
                subscription_num: 50,
              },
            },
            "2026-05-16": {
              metrics: {
                view_count: 101,
                danmaku_uid_count: 10,
                subscription_num: 51,
              },
            },
            "2026-05-17": {
              metrics: {
                view_count: 102,
                danmaku_uid_count: 10,
                subscription_num: 52,
              },
            },
          },
        },
        "rank-only": {
          id: "rank-only",
          name: "只有榜单样本",
          samples: {
            "2026-05-17": {
              ranks: [{ key: "new_daily", name: "新品日榜", position: 1 }],
            },
          },
        },
      },
    },
  });

  assert.equal(response.success, true);
  assert.equal(response.platform, "missevan");
  assert.deepEqual(response.ids, ["93038"]);
  assert.deepEqual(response.kinds, { "93038": "metric" });
  assert.equal(response.latestDate, "2026-05-17");
  assert.equal(response.updatedAt, "2026-05-17T01:00:00.000Z");
});

test("buildRankTrendAvailabilityResponse preserves Manbo big integer ids", () => {
  const response = buildRankTrendAvailabilityResponse({
    platform: "manbo",
    ids: ["1467142227078676553"],
    aggregateSnapshot: {
      version: 1,
      platform: "manbo",
      dates: ["2026-05-13", "2026-05-14", "2026-05-15", "2026-05-16", "2026-05-17"],
      dramas: {
        "1467142227078676553": {
          id: "1467142227078676553",
          samples: {
            "2026-05-13": {
              metrics: {
                view_count: 996,
                danmaku_uid_count: 29,
                pay_count: 19,
              },
            },
            "2026-05-14": {
              metrics: {
                view_count: 997,
                danmaku_uid_count: 29,
                pay_count: 19,
              },
            },
            "2026-05-15": {
              metrics: {
                view_count: 998,
                danmaku_uid_count: 30,
                pay_count: 20,
              },
            },
            "2026-05-16": {
              metrics: {
                view_count: 999,
                danmaku_uid_count: 30,
                pay_count: 20,
              },
            },
            "2026-05-17": {
              metrics: {
                view_count: 1000,
                danmaku_uid_count: 30,
                pay_count: 20,
              },
            },
          },
        },
      },
    },
  });

  assert.deepEqual(response.ids, ["1467142227078676553"]);
  assert.deepEqual(response.kinds, { "1467142227078676553": "metric" });
});

test("buildRankTrendAvailabilityResponse falls back to weekly playback after fewer than five metric samples", () => {
  const response = buildRankTrendAvailabilityResponse({
    platform: "missevan",
    ids: ["93038", "metric-only"],
    aggregateSnapshot: {
      platform: "missevan",
      dates: ["2026-05-15", "2026-05-16", "2026-05-17"],
      dramas: {
        "93038": {
          samples: {
            "2026-05-15": { metrics: { view_count: 100 } },
            "2026-05-16": { metrics: { view_count: 101 } },
            "2026-05-17": { metrics: { view_count: 102 } },
          },
        },
        "metric-only": {
          samples: {
            "2026-05-15": { metrics: { view_count: 100 } },
          },
        },
      },
    },
    weeklyPlaybackSnapshot: {
      platform: "missevan",
      dates: ["2026-05-03", "2026-05-10", "2026-05-17"],
      snapshotsByDate: {
        "2026-05-03": { platform: "missevan", dramas: { "93038": { view_count: 90 } } },
        "2026-05-10": { platform: "missevan", dramas: { "93038": { view_count: 95 } } },
        "2026-05-17": { platform: "missevan", dramas: { "93038": { view_count: 102 } } },
      },
    },
  });

  assert.deepEqual(response.ids, ["93038"]);
  assert.deepEqual(response.kinds, { "93038": "weekly_playback" });
  assert.equal(response.latestDate, "2026-05-17");
});

test("buildRankTrendAvailabilityResponse hides weekly playback with fewer than two points", () => {
  const response = buildRankTrendAvailabilityResponse({
    platform: "missevan",
    ids: ["93038"],
    aggregateSnapshot: {
      platform: "missevan",
      dates: ["2026-05-17"],
      dramas: { "93038": { samples: { "2026-05-17": { metrics: { view_count: 100 } } } } },
    },
    weeklyPlaybackSnapshot: {
      platform: "missevan",
      dates: ["2026-05-17"],
      snapshotsByDate: {
        "2026-05-17": { platform: "missevan", dramas: { "93038": { view_count: 100 } } },
      },
    },
  });

  assert.deepEqual(response.ids, []);
  assert.deepEqual(response.kinds, {});
});

test("buildRankTrendAvailabilityResponse does not count a duplicate weekly date twice", () => {
  const response = buildRankTrendAvailabilityResponse({
    platform: "missevan",
    ids: ["93038"],
    aggregateSnapshot: { platform: "missevan", dates: [], dramas: {} },
    weeklyPlaybackSnapshot: {
      platform: "missevan",
      dates: ["2026-05-17", "2026-05-17"],
      snapshotsByDate: {
        "2026-05-17": { platform: "missevan", dramas: { "93038": { view_count: 100 } } },
      },
    },
  });

  assert.deepEqual(response.ids, []);
});

test("buildRankTrendAvailabilityResponse uses weekly playback when five metric samples are older than thirty days", () => {
  const metricDates = [
    "2026-04-01",
    "2026-04-02",
    "2026-04-03",
    "2026-04-04",
    "2026-04-05",
    "2026-05-16",
    "2026-05-17",
  ];
  const response = buildRankTrendAvailabilityResponse({
    platform: "missevan",
    ids: ["73221"],
    aggregateSnapshot: {
      platform: "missevan",
      dates: metricDates,
      dramas: {
        "73221": {
          samples: Object.fromEntries(metricDates.map((date, index) => [date, {
            metrics: { view_count: index + 1 },
          }])),
        },
      },
    },
    weeklyPlaybackSnapshot: {
      platform: "missevan",
      dates: ["2026-05-03", "2026-05-10", "2026-05-17"],
      snapshotsByDate: {
        "2026-05-03": { platform: "missevan", dramas: { "73221": { view_count: 90 } } },
        "2026-05-10": { platform: "missevan", dramas: { "73221": { view_count: 95 } } },
        "2026-05-17": { platform: "missevan", dramas: { "73221": { view_count: 102 } } },
      },
    },
  });

  assert.deepEqual(response.ids, ["73221"]);
  assert.deepEqual(response.kinds, { "73221": "weekly_playback" });
});

test("ordinary trend and availability reject missing or mismatched aggregates", () => {
  const trendResponse = buildAggregatedRankTrendResponse({
    platform: "missevan",
    id: "93038",
    aggregateSnapshot: null,
  });
  assert.equal(trendResponse.success, false);
  assert.equal(trendResponse.status, 503);

  const availabilityResponse = buildRankTrendAvailabilityResponse({
    platform: "missevan",
    ids: ["93038"],
    aggregateSnapshot: {
      platform: "manbo",
      dates: ["2026-05-17"],
      dramas: {},
    },
  });
  assert.equal(availabilityResponse.success, false);
  assert.equal(availabilityResponse.status, 503);
});

test("aggregate validators reject array-shaped drama and CV maps", () => {
  const ordinaryResponse = buildAggregatedRankTrendResponse({
    platform: "missevan",
    id: "93038",
    aggregateSnapshot: {
      platform: "missevan",
      dates: ["2026-05-17"],
      dramas: [],
    },
  });
  assert.equal(ordinaryResponse.status, 503);

  const cvResponse = buildCvTrendResponse({
    id: "路知行",
    trendSnapshots: {
      missevan: { platform: "missevan", cvs: [] },
      manbo: { platform: "manbo", cvs: {} },
    },
  });
  assert.equal(cvResponse.status, 503);
});

test("buildAggregatedRankTrendResponse anchors all windows to the drama latest metric sample", () => {
  const response = buildAggregatedRankTrendResponse({
    platform: "missevan",
    id: "93038",
    aggregateSnapshot: {
      version: 1,
      platform: "missevan",
      dates: ["2026-05-10", "2026-05-11", "2026-05-20", "2026-05-30"],
      dramas: {
        "93038": {
          id: "93038",
          name: "一屋暗灯 全一季",
          samples: {
            "2026-05-10": {
              metrics: {
                view_count: 100,
                danmaku_uid_count: 10,
                subscription_num: 50,
              },
            },
            "2026-05-20": {
              metrics: {
                view_count: 180,
                danmaku_uid_count: 18,
                subscription_num: 58,
              },
            },
          },
        },
      },
    },
  });

  assert.equal(response.success, true);
  assert.equal(response.latestDate, "2026-05-20");
  assert.equal(response.rankHistoryLatestDate, "2026-05-30");
  assert.equal(response.windows["3d"].toDate, "2026-05-20");
  assert.equal(response.windows["7d"].toDate, "2026-05-20");
  assert.equal(response.windows["30d"].toDate, "2026-05-20");
});

test("buildAggregatedRankTrendResponse anchors windows to the latest non-repeated metric sample", () => {
  const response = buildAggregatedRankTrendResponse({
    platform: "missevan",
    id: "93038",
    aggregateSnapshot: {
      version: 1,
      platform: "missevan",
      dates: ["2026-05-01", "2026-05-20", "2026-05-30"],
      dramas: {
        "93038": {
          id: "93038",
          name: "一屋暗灯 全一季",
          samples: {
            "2026-05-01": {
              metrics: {
                view_count: 100,
                danmaku_uid_count: 10,
                subscription_num: 50,
              },
            },
            "2026-05-20": {
              metrics: {
                view_count: 100,
                danmaku_uid_count: 10,
                subscription_num: 50,
              },
            },
            "2026-05-30": {
              metrics: {
                view_count: 100,
                danmaku_uid_count: 10,
                subscription_num: 50,
              },
            },
          },
        },
      },
    },
  });

  assert.equal(response.success, true);
  assert.equal(response.latestDate, "2026-05-01");
  assert.equal(response.windows["3d"].toDate, "2026-05-01");
  assert.equal(response.windows["7d"].toDate, "2026-05-01");
  assert.equal(response.windows["30d"].toDate, "2026-05-01");
});

test("buildAggregatedRankTrendResponse returns not found without falling back semantics", () => {
  const response = buildAggregatedRankTrendResponse({
    platform: "manbo",
    id: "missing",
    aggregateSnapshot: {
      version: 1,
      platform: "manbo",
      updated_at: "2026-05-17T01:00:00.000Z",
      dates: ["2026-05-17"],
      dramas: {},
    },
  });

  assert.equal(response.success, false);
  assert.equal(response.status, 404);
});

test("buildMetricSnapshotsFromRankTrendAggregate converts platform trend aggregate for ongoing responses", () => {
  const result = buildMetricSnapshotsFromRankTrendAggregate(
    {
      version: 1,
      platform: "manbo",
      updated_at: "2026-05-17T01:00:00.000Z",
      dates: ["2026-05-15", "bad-date", "2026-05-17"],
      dramas: {
        "2087206604062588962": {
          name: "囚于永夜",
          samples: {
            "2026-05-15": {
              generated_at: "2026-05-15T01:00:00.000Z",
              metrics: {
                view_count: 3000,
                danmaku_uid_count: 20,
                pay_count: 100,
              },
            },
            "2026-05-17": {
              metrics: {
                view_count: 3300,
                danmaku_uid_count: 26,
                pay_count: 130,
              },
            },
          },
        },
        "2182687618293039383": {
          name: "干涸地",
          samples: {
            "2026-05-17": {
              metrics: {
                view_count: 900,
                danmaku_uid_count: 8,
                pay_count: 0,
              },
            },
          },
        },
      },
    },
    "manbo"
  );

  assert.deepEqual(result.indexSnapshot, {
    version: 1,
    platform: "manbo",
    dates: ["2026-05-15", "2026-05-17"],
    updated_at: "2026-05-17T01:00:00.000Z",
  });
  assert.deepEqual(
    Object.keys(result.metricSnapshotsByDate),
    ["2026-05-15", "2026-05-17"]
  );
  assert.deepEqual(
    result.metricSnapshotsByDate["2026-05-17"].dramas["2087206604062588962"],
    {
      view_count: 3300,
      danmaku_uid_count: 26,
      pay_count: 130,
      name: "囚于永夜",
      generated_at: "2026-05-17T01:00:00.000Z",
    }
  );
  assert.equal(
    result.metricSnapshotsByDate["2026-05-15"].dramas["2087206604062588962"].generated_at,
    "2026-05-15T01:00:00.000Z"
  );
});

test("buildPeakSeriesTrendResponse builds playback-only windows from series samples", () => {
  const response = buildPeakSeriesTrendResponse({
    id: "魔道祖师",
    peakSnapshot: {
      dates: ["2026-05-02", "2026-05-04"],
      series: {
        魔道祖师: {
          name: "魔道祖师",
          dramaIds: ["15861", "19059", "22602"],
          samples: {
            "2026-05-02": {
              view_count: 722137429,
              position: 1,
            },
            "2026-05-04": {
              view_count: 722208818,
              position: 1,
            },
          },
        },
      },
    },
  });

  assert.equal(response.success, true);
  assert.equal(response.platform, "missevan");
  assert.equal(response.id, "魔道祖师");
  assert.equal(response.name, "系列：魔道祖师");
  assert.deepEqual(response.dramaIds, ["15861", "19059", "22602"]);
  assert.equal(response.latestDate, "2026-05-04");
  assert.deepEqual(response.rankHistory, [
    {
      date: "2026-05-02",
      ranks: [{ key: "peak", name: "巅峰榜", position: 1 }],
    },
    {
      date: "2026-05-04",
      ranks: [{ key: "peak", name: "巅峰榜", position: 1 }],
    },
  ]);

  for (const windowKey of ["3d", "7d", "30d"]) {
    const window = response.windows[windowKey];
    assert.equal(window.fromDate, "2026-05-02");
    assert.equal(window.toDate, "2026-05-04");
    assert.equal(window.insufficientData, false);
    assert.deepEqual(
      window.metrics.map((metric) => ({
        key: metric.key,
        label: metric.label,
        fromValue: metric.fromValue,
        toValue: metric.toValue,
        delta: metric.delta,
        available: metric.available,
        history: metric.history,
      })),
      [
        {
          key: "view_count",
          label: "系列总播放量",
          fromValue: 722137429,
          toValue: 722208818,
          delta: 71389,
          available: true,
          history: [
            { date: "2026-05-02", value: 722137429 },
            { date: "2026-05-04", value: 722208818 },
          ],
        },
      ]
    );
  }
});

test("buildPeakSeriesTrendResponse keeps one pre-window history point for increment charts", () => {
  const response = buildPeakSeriesTrendResponse({
    id: "魔道祖师",
    peakSnapshot: {
      dates: ["2026-05-30", "2026-05-31", "2026-06-01", "2026-06-02", "2026-06-03"],
      series: {
        魔道祖师: {
          name: "魔道祖师",
          samples: {
            "2026-05-30": { view_count: 9000, position: 1 },
            "2026-05-31": { view_count: 10000, position: 1 },
            "2026-06-01": { view_count: 13000, position: 1 },
            "2026-06-02": { view_count: 15000, position: 1 },
            "2026-06-03": { view_count: 18000, position: 1 },
          },
        },
      },
    },
  });

  const viewMetric = response.windows["3d"].metrics[0];

  assert.equal(response.windows["3d"].fromDate, "2026-05-31");
  assert.equal(response.windows["3d"].toDate, "2026-06-03");
  assert.equal(viewMetric.delta, 8000);
  assert.deepEqual(
    viewMetric.history.map((point) => [point.date, point.value, Boolean(point.isPreWindow)]),
    [
      ["2026-05-30", 9000, true],
      ["2026-05-31", 10000, false],
      ["2026-06-01", 13000, false],
      ["2026-06-02", 15000, false],
      ["2026-06-03", 18000, false],
    ]
  );
});

test("buildPeakSeriesTrendResponse keeps missing peak dates as null points", () => {
  const response = buildPeakSeriesTrendResponse({
    id: "魔道祖师",
    peakSnapshot: {
      dates: ["2026-04-24", "2026-05-01", "2026-05-05", "2026-05-09"],
      series: {
        魔道祖师: {
          name: "魔道祖师",
          dramaIds: ["15861", "19059", "22602"],
          samples: {
            "2026-04-24": {
              view_count: 1000,
              position: 1,
            },
            "2026-05-01": {
              view_count: 1200,
              position: 1,
            },
            "2026-05-09": {
              view_count: 1600,
              position: 1,
            },
          },
        },
      },
    },
  });

  assert.equal(response.success, true);
  assert.deepEqual(
    response.windows["30d"].metrics[0].history.map((point) => [point.date, point.value]),
    [
      ["2026-04-24", 1000],
      ["2026-05-01", 1200],
      ["2026-05-05", null],
      ["2026-05-09", 1600],
    ]
  );
  assert.equal(response.windows["30d"].metrics[0].delta, 600);
  assert.equal(response.windows["30d"].metrics[0].deltaPercent, 0.6);
});

test("buildPeakSeriesTrendResponse treats repeated playback samples as missing data", () => {
  const response = buildPeakSeriesTrendResponse({
    id: "魔道祖师",
    peakSnapshot: {
      dates: ["2026-05-01", "2026-05-02", "2026-05-03"],
      series: {
        魔道祖师: {
          name: "魔道祖师",
          samples: {
            "2026-05-01": {
              view_count: 1000,
              position: 1,
            },
            "2026-05-02": {
              view_count: 1000,
              position: 1,
            },
            "2026-05-03": {
              view_count: 1100,
              position: 1,
            },
          },
        },
      },
    },
  });

  assert.deepEqual(
    response.windows["3d"].metrics[0].history.map((point) => [point.date, point.value]),
    [
      ["2026-05-01", 1000],
      ["2026-05-02", null],
      ["2026-05-03", 1100],
    ]
  );
  assert.equal(response.windows["3d"].metrics[0].delta, 100);
  assert.equal(response.windows["3d"].metrics[0].deltaPercent, 0.1);
});

test("buildPeakSeriesTrendResponse anchors windows to the latest non-repeated sample", () => {
  const response = buildPeakSeriesTrendResponse({
    id: "魔道祖师",
    peakSnapshot: {
      dates: ["2026-05-01", "2026-05-20", "2026-05-30"],
      series: {
        魔道祖师: {
          name: "魔道祖师",
          samples: {
            "2026-05-01": {
              view_count: 1000,
              position: 1,
            },
            "2026-05-20": {
              view_count: 1000,
              position: 1,
            },
            "2026-05-30": {
              view_count: 1000,
              position: 1,
            },
          },
        },
      },
    },
  });

  assert.equal(response.latestDate, "2026-05-01");
  assert.equal(response.windows["3d"].toDate, "2026-05-01");
  assert.equal(response.windows["7d"].toDate, "2026-05-01");
  assert.equal(response.windows["30d"].toDate, "2026-05-01");
});

test("getPeakSeriesDailyViewDelta uses latest minus previous available sample", () => {
  const delta = getPeakSeriesDailyViewDelta({
    name: "虚拟偶像声音综艺系列",
    samples: {
      "2026-05-02": {
        view_count: 360655306,
      },
      "2026-05-04": {
        view_count: 361012978,
      },
    },
  });

  assert.deepEqual(delta, {
    available: true,
    fromDate: "2026-05-02",
    toDate: "2026-05-04",
    fromValue: 360655306,
    toValue: 361012978,
    delta: 357672,
  });
});

test("buildPeakSeriesTrendResponse matches by series display name and reports missing series", () => {
  const peakSnapshot = {
    dates: ["2026-05-02", "2026-05-04"],
    series: {
      mdzs: {
        name: "魔道祖师",
        samples: {
          "2026-05-02": { view_count: 100, position: 2 },
          "2026-05-04": { view_count: 130, position: 1 },
        },
      },
    },
  };

  const matched = buildPeakSeriesTrendResponse({
    id: "魔道祖师",
    peakSnapshot,
  });
  assert.equal(matched.success, true);
  assert.equal(matched.id, "魔道祖师");
  assert.equal(matched.windows["3d"].metrics[0].delta, 30);

  const missing = buildPeakSeriesTrendResponse({
    id: "不存在的系列",
    peakSnapshot,
  });
  assert.equal(missing.success, false);
  assert.equal(missing.status, 404);
});

test("buildPeakSeriesTrendResponse keeps the v2 last-rank summary", () => {
  const response = buildPeakSeriesTrendResponse({
    id: "测试系列",
    peakSnapshot: {
      dates: ["2026-06-01", "2026-06-08"],
      series: {
        测试系列: {
          name: "测试系列",
          lastRank: {
            date: "2026-05-10",
            ranks: [{ key: "peak", name: "巅峰榜", position: 3 }],
          },
          samples: {
            "2026-06-01": { view_count: 100 },
            "2026-06-08": { view_count: 120 },
          },
        },
      },
    },
  });

  assert.equal(response.success, true);
  assert.deepEqual(response.rankHistory, [
    {
      date: "2026-05-10",
      ranks: [{ key: "peak", name: "巅峰榜", position: 3 }],
    },
  ]);
});
