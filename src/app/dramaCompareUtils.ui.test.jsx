import { expect, test } from "vitest";

import {
  alignCompareTrendItems,
  formatComparePercent,
  formatSignedPlainNumber,
  getMetricLatestValue,
  isCompareMetricAvailableForItem,
} from "@/app/dramaCompareUtils";

function metricHistory(values) {
  return values.map(([date, value]) => ({ date, value }));
}

function trendData(windowEndDate, values) {
  return {
    success: true,
    kind: "metric",
    windowEndDate,
    windows: {
      "3d": {
        key: "3d",
        days: 3,
        fromDate: "2026-06-07",
        toDate: windowEndDate,
        metrics: [{
          key: "view_count",
          available: true,
          history: metricHistory(values),
        }],
      },
    },
  };
}

test("compare alignment keeps missing endpoint data while retaining other curves", () => {
  const aligned = alignCompareTrendItems([
    {
      key: "drama-a",
      trendData: trendData("2026-06-10", [
        ["2026-06-07", 100],
        ["2026-06-08", 110],
        ["2026-06-09", 120],
        ["2026-06-10", 130],
      ]),
    },
    {
      key: "drama-b",
      trendData: trendData("2026-06-08", [
        ["2026-06-05", 80],
        ["2026-06-06", 90],
        ["2026-06-07", 100],
        ["2026-06-08", 110],
      ]),
    },
  ]);

  const missingMetric = aligned[1].trendData.windows["3d"].metrics[0];
  expect(aligned[1].trendData.windowEndDate).toBe("2026-06-10");
  expect(missingMetric.history.at(-2)).toEqual({ date: "2026-06-09", value: null, isPreWindow: false });
  expect(missingMetric.history.at(-1)).toEqual({ date: "2026-06-10", value: null, isPreWindow: false });
  expect(missingMetric.toValue).toBeNull();
  expect(missingMetric.delta).toBeNull();
  expect(isCompareMetricAvailableForItem(aligned[1], "3d", "view_count")).toBe(true);
  expect(getMetricLatestValue(aligned[1].trendData, "3d", "view_count")).toBeNull();
});

test("compare summaries show no data for null endpoint values", () => {
  expect(formatSignedPlainNumber(null)).toBe("暂无");
  expect(formatComparePercent(null)).toBe("暂无");
});
