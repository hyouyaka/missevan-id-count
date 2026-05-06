import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPeakSeriesTrendResponse,
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
    assert.equal(response.windows[windowKey].insufficientData, false);
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
  assert.equal(danmakuMetric.toValue, null);
  assert.equal(danmakuMetric.available, false);
  assert.equal(danmakuMetric.delta, null);
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
