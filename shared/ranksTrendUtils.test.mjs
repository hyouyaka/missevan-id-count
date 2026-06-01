import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAggregatedRankTrendResponse,
  buildMetricSnapshotsFromRankTrendAggregate,
  buildPeakSeriesTrendResponse,
  buildRankTrendAvailabilityResponse,
  buildRankTrendResponse,
  getPeakSeriesDailyViewDelta,
} from "./ranksTrendUtils.js";

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
      dates: ["2026-05-15", "2026-05-16", "2026-05-17"],
      dramas: {
        "93038": {
          id: "93038",
          name: "一屋暗灯 全一季",
          samples: {
            "2026-05-15": {
              metrics: {
                view_count: 100,
                danmaku_uid_count: 10,
                subscription_num: 50,
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
      dates: ["2026-05-17"],
      dramas: {
        "1467142227078676553": {
          id: "1467142227078676553",
          samples: {
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
