import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTrendChartLines,
  buildTrendDeltaPoints,
  filterNonZeroTrendMetrics,
  getTrendAxisLabelMarkers,
} from "./rankTrendChartUtils.js";

const baseMetrics = [
  {
    key: "view_count",
    label: "播放量",
    history: [
      { date: "2026-06-01", value: 10000 },
      { date: "2026-06-02", value: 15000 },
      { date: "2026-06-03", value: null },
      { date: "2026-06-04", value: 30000 },
      { date: "2026-06-05", value: 36000 },
    ],
  },
  {
    key: "danmaku_uid_count",
    label: "付费ID数",
    history: [
      { date: "2026-06-01", value: 100 },
      { date: "2026-06-02", value: 140 },
      { date: "2026-06-03", value: null },
      { date: "2026-06-04", value: 190 },
      { date: "2026-06-05", value: 260 },
    ],
  },
  {
    key: "subscription_num",
    label: "追剧人数",
    history: [
      { date: "2026-06-01", value: 500 },
      { date: "2026-06-02", value: 520 },
      { date: "2026-06-03", value: 540 },
      { date: "2026-06-04", value: 560 },
      { date: "2026-06-05", value: 590 },
    ],
  },
];

test("absolute trend chart uses a single axis for the selected metric", () => {
  const chart = buildTrendChartLines([baseMetrics[1]], { chartMode: "absolute" });
  const sidesByKey = Object.fromEntries(chart.lines.map((line) => [line.metric.key, line.axisSide]));

  assert.equal(sidesByKey.danmaku_uid_count, "left");
  assert.equal(chart.axis.unit, "付费ID数");
  assert.equal(chart.axes.left.unit, "付费ID数");
  assert.equal(chart.axes.right, undefined);
});

test("trend chart keeps missing samples as gaps instead of connecting across them", () => {
  const chart = buildTrendChartLines(baseMetrics, { chartMode: "absolute" });
  const playbackLine = chart.lines.find((line) => line.metric.key === "view_count");

  assert.equal(playbackLine.segments.length, 2);
  assert.deepEqual(
    playbackLine.segments.map((segment) => segment.map(({ point }) => point.date)),
    [
      ["2026-06-01", "2026-06-02"],
      ["2026-06-04", "2026-06-05"],
    ]
  );
});

test("trend chart exposes valid isolated samples as markers without connecting gaps", () => {
  const chart = buildTrendChartLines([
    {
      key: "view_count",
      label: "播放量",
      history: [
        { date: "2026-06-01", value: 10000 },
        { date: "2026-06-02", value: 12000 },
        { date: "2026-06-03", value: null },
        { date: "2026-06-04", value: 16000 },
      ],
    },
  ], { chartMode: "absolute" });
  const line = chart.lines[0];

  assert.deepEqual(
    line.segments.map((segment) => segment.map(({ point }) => point.date)),
    [["2026-06-01", "2026-06-02"]]
  );
  assert.deepEqual(
    line.markers.map(({ point }) => point.date),
    ["2026-06-01", "2026-06-02", "2026-06-04"]
  );
});

test("daily increment points require adjacent continuous samples", () => {
  const points = buildTrendDeltaPoints(baseMetrics[0]);

  assert.deepEqual(
    points.map((point) => [point.date, point.axisValue]),
    [
      ["2026-06-01", null],
      ["2026-06-02", 5000],
      ["2026-06-03", null],
      ["2026-06-04", null],
      ["2026-06-05", 6000],
    ]
  );
});

test("daily increment uses a pre-window sample without adding it to chart dates", () => {
  const points = buildTrendDeltaPoints({
    key: "view_count",
    label: "播放量",
    history: [
      { date: "2026-05-31", value: 900, isPreWindow: true },
      { date: "2026-06-01", value: 1000 },
      { date: "2026-06-02", value: 1300 },
    ],
  });

  assert.deepEqual(
    points.map((point) => [point.date, point.axisValue]),
    [
      ["2026-06-01", 100],
      ["2026-06-02", 300],
    ]
  );

  const chart = buildTrendChartLines([
    {
      key: "view_count",
      label: "播放量",
      history: [
        { date: "2026-05-31", value: 900, isPreWindow: true },
        { date: "2026-06-01", value: 1000 },
        { date: "2026-06-02", value: 1300 },
      ],
    },
  ], { chartMode: "increment" });

  assert.deepEqual(
    chart.lines[0].markers.map(({ point }) => point.date),
    ["2026-06-01", "2026-06-02"]
  );
});

test("axis labels use visible marker positions and skip pre-window samples", () => {
  const chart = buildTrendChartLines([
    {
      key: "view_count",
      label: "播放量",
      history: [
        { date: "2026-05-26", value: 900, isPreWindow: true },
        { date: "2026-05-27", value: 1000 },
        { date: "2026-05-28", value: 1100 },
        { date: "2026-05-29", value: 1200 },
        { date: "2026-05-30", value: 1300 },
        { date: "2026-05-31", value: 1400 },
        { date: "2026-06-01", value: 1500 },
        { date: "2026-06-02", value: 1600 },
        { date: "2026-06-03", value: 1700 },
      ],
    },
  ], { chartMode: "increment" });

  const labelMarkers = getTrendAxisLabelMarkers(chart.lines[0].markers, "7d");

  assert.deepEqual(
    labelMarkers.map(({ point }) => point.date),
    ["2026-05-27", "2026-05-29", "2026-05-31", "2026-06-02", "2026-06-03"]
  );
  assert.equal(labelMarkers[0].position.x, chart.lines[0].markers[0].position.x);
  assert.equal(labelMarkers.at(-1).position.x, chart.lines[0].markers.at(-1).position.x);
});

test("daily increment keeps first window point empty without a pre-window sample", () => {
  const points = buildTrendDeltaPoints({
    key: "view_count",
    label: "播放量",
    history: [
      { date: "2026-06-01", value: 1000 },
      { date: "2026-06-02", value: 1300 },
    ],
  });

  assert.deepEqual(
    points.map((point) => [point.date, point.axisValue]),
    [
      ["2026-06-01", null],
      ["2026-06-02", 300],
    ]
  );
});

test("compare chart helper filters all-zero metrics but tolerates all hidden metrics", () => {
  const metrics = [
    {
      key: "drama-a:view_count",
      label: "剧集 A",
      history: [
        { date: "2026-06-01", value: 0 },
        { date: "2026-06-02", value: 0 },
      ],
    },
    {
      key: "drama-b:view_count",
      label: "剧集 B",
      history: [
        { date: "2026-06-01", value: 0 },
        { date: "2026-06-02", value: 12 },
      ],
    },
  ];

  assert.deepEqual(
    filterNonZeroTrendMetrics(metrics).map((metric) => metric.label),
    ["剧集 B"]
  );
  assert.equal(buildTrendChartLines(filterNonZeroTrendMetrics([metrics[0]])).lines.length, 0);
});

test("hidden compare series keep the remaining series color identity", () => {
  const metrics = [
    {
      key: "drama-a:view_count",
      label: "剧集 A",
      color: "#28559A",
      history: [
        { date: "2026-06-01", value: 100 },
        { date: "2026-06-02", value: 120 },
      ],
    },
    {
      key: "drama-b:view_count",
      label: "剧集 B",
      color: "#E86A4A",
      history: [
        { date: "2026-06-01", value: 200 },
        { date: "2026-06-02", value: 260 },
      ],
    },
  ];

  const chart = buildTrendChartLines([metrics[1]], { chartMode: "absolute" });

  assert.equal(chart.lines[0].metric.color, "#E86A4A");
});

test("compare lines share real-date x positions across different weekly ranges", () => {
  const chart = buildTrendChartLines([
    {
      key: "drama-a:view_count",
      label: "剧集 A",
      history: [
        { date: "2026-06-01", value: 100 },
        { date: "2026-06-08", value: 120 },
        { date: "2026-06-15", value: 140 },
      ],
    },
    {
      key: "drama-b:view_count",
      label: "剧集 B",
      history: [
        { date: "2026-06-08", value: 200 },
        { date: "2026-06-15", value: 240 },
        { date: "2026-06-22", value: 280 },
      ],
    },
  ]);

  const [left, right] = chart.lines;
  const positionByDate = (line) => new Map(
    line.markers.map(({ point, position }) => [point.date, position.x])
  );
  const leftPositions = positionByDate(left);
  const rightPositions = positionByDate(right);

  assert.equal(leftPositions.get("2026-06-08"), rightPositions.get("2026-06-08"));
  assert.equal(leftPositions.get("2026-06-15"), rightPositions.get("2026-06-15"));
  assert.deepEqual(
    chart.dateMarkers.map(({ point }) => point.date),
    ["2026-06-01", "2026-06-08", "2026-06-15", "2026-06-22"]
  );
});
