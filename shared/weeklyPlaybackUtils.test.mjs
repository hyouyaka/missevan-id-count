import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWeeklyPlaybackTrendResponse,
  countValidMetricSamples,
} from "./weeklyPlaybackUtils.js";

test("weekly playback trend prefers watchcount and fills missing dates from metric view counts", () => {
  const response = buildWeeklyPlaybackTrendResponse({
    platform: "missevan",
    id: "93038",
    weeklyPlaybackSnapshot: {
      platform: "missevan",
      dates: ["2026-05-03", "2026-05-10", "2026-05-17"],
      snapshotsByDate: {
        "2026-05-03": { platform: "missevan", dramas: { "93038": { view_count: 100 } } },
        "2026-05-10": { platform: "missevan", dramas: {} },
        "2026-05-17": { platform: "missevan", dramas: { "93038": { view_count: 115 } } },
      },
    },
    metricAggregateSnapshot: {
      platform: "missevan",
      dates: ["2026-05-10"],
      dramas: {
        "93038": {
          name: "一屋暗灯",
          samples: { "2026-05-10": { metrics: { view_count: 108 } } },
        },
      },
    },
    allowMetricFallback: true,
  });

  assert.equal(response.success, true);
  assert.equal(response.kind, "weekly_playback");
  assert.equal(response.dataSource, "watchcount+metric_fallback");
  assert.equal(response.windows["3w"].metrics[0].delta, 15);
  assert.deepEqual(
    response.windows["3w"].metrics[0].history.map((point) => [point.date, point.value, point.deltaValue ?? null]),
    [
      ["2026-05-03", 100, null],
      ["2026-05-10", 108, 8],
      ["2026-05-17", 115, 7],
    ]
  );
});

test("weekly playback trend requires at least two valid data points", () => {
  const response = buildWeeklyPlaybackTrendResponse({
    platform: "missevan",
    id: "93038",
    weeklyPlaybackSnapshot: {
      platform: "missevan",
      dates: ["2026-05-17"],
      snapshotsByDate: {
        "2026-05-17": { platform: "missevan", dramas: { "93038": { view_count: 115 } } },
      },
    },
  });

  assert.equal(response.success, false);
  assert.equal(response.status, 404);
  assert.equal(response.kind, "weekly_playback");
});

test("metric classification counts five distinct dates with finite configured metrics", () => {
  const aggregateSnapshot = {
    dates: ["2026-05-01", "2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05", "2026-05-06"],
    dramas: {
      "93038": {
        samples: {
          "2026-05-01": { metrics: { view_count: 100 } },
          "2026-05-02": { metrics: { view_count: "NaN" } },
          "2026-05-03": { metrics: { subscription_num: 2 } },
          "2026-05-04": { metrics: { danmaku_uid_count: 3 } },
          "2026-05-05": { metrics: { view_count: 0 } },
          "2026-05-06": { metrics: { view_count: 106 } },
        },
      },
    },
  };

  assert.equal(countValidMetricSamples({ platform: "missevan", aggregateSnapshot, id: "93038" }), 5);
});

test("metric classification only counts the latest thirty calendar days", () => {
  const dates = [
    "2026-04-01",
    "2026-04-02",
    "2026-04-03",
    "2026-04-04",
    "2026-04-05",
    "2026-05-16",
    "2026-05-17",
  ];
  const aggregateSnapshot = {
    dates,
    dramas: {
      "73221": {
        samples: Object.fromEntries(dates.map((date, index) => [date, { metrics: { view_count: index + 1 } }])),
      },
    },
  };

  assert.equal(countValidMetricSamples({ platform: "missevan", aggregateSnapshot, id: "73221" }), 2);
});

test("metric classification ignores repeated metric snapshots", () => {
  const dates = [
    "2026-05-20",
    "2026-05-21",
    "2026-05-22",
    "2026-05-23",
    "2026-05-24",
    "2026-05-25",
  ];
  const aggregateSnapshot = {
    dates,
    dramas: {
      "73221": {
        samples: Object.fromEntries(dates.map((date, index) => [date, {
          metrics: { view_count: index < 2 ? 100 : 101 },
        }])),
      },
    },
  };

  assert.equal(countValidMetricSamples({ platform: "missevan", aggregateSnapshot, id: "73221" }), 2);
});

test("rank-only dates do not make an unchanged metric snapshot look new", () => {
  const aggregateSnapshot = {
    dates: ["2026-05-20", "2026-05-21", "2026-05-22"],
    dramas: {
      "73221": {
        samples: {
          "2026-05-20": { metrics: { view_count: 100 } },
          "2026-05-21": { ranks: [{ key: "new_daily", position: 1 }] },
          "2026-05-22": { metrics: { view_count: 100 } },
        },
      },
    },
  };

  assert.equal(countValidMetricSamples({ platform: "missevan", aggregateSnapshot, id: "73221" }), 1);
});

test("empty metric dates do not make an unchanged metric snapshot look new", () => {
  const aggregateSnapshot = {
    dates: ["2026-05-20", "2026-05-21", "2026-05-22"],
    dramas: {
      "73221": {
        samples: {
          "2026-05-20": { metrics: { view_count: 100 } },
          "2026-05-21": { metrics: { view_count: null, subscription_num: "NaN" } },
          "2026-05-22": { metrics: { view_count: 100 } },
        },
      },
    },
  };

  assert.equal(countValidMetricSamples({ platform: "missevan", aggregateSnapshot, id: "73221" }), 1);
});

test("weekly playback trend reports not found when no weekly record exists", () => {
  const response = buildWeeklyPlaybackTrendResponse({
    platform: "manbo",
    id: "1467142227078676553",
    weeklyPlaybackSnapshot: {
      platform: "manbo",
      dates: ["2026-05-17"],
      snapshotsByDate: { "2026-05-17": { platform: "manbo", dramas: {} } },
    },
  });

  assert.equal(response.success, false);
  assert.equal(response.status, 404);
});

test("weekly playback trend never relabels daily metric dates as weekly samples", () => {
  const response = buildWeeklyPlaybackTrendResponse({
    platform: "missevan",
    id: "93038",
    weeklyPlaybackSnapshot: null,
    metricAggregateSnapshot: {
      platform: "missevan",
      dates: ["2026-05-16", "2026-05-17"],
      dramas: {
        "93038": {
          samples: {
            "2026-05-16": { metrics: { view_count: 100 } },
            "2026-05-17": { metrics: { view_count: 110 } },
          },
        },
      },
    },
    allowMetricFallback: true,
  });

  assert.equal(response.success, false);
  assert.equal(response.status, 404);
});
