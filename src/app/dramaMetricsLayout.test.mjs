import assert from "node:assert/strict";
import test from "node:test";
import { getDramaMetricsGridColumns } from "./dramaMetricsLayout.js";

test("all metric minima share one row whenever they fit, including the exact boundary", () => {
  assert.deepEqual(getDramaMetricsGridColumns([80, 64, 48], 224), [80, 64, 48]);
  assert.deepEqual(getDramaMetricsGridColumns([128, 48, 140, 64], 428), [128, 48, 140, 64]);
  assert.deepEqual(getDramaMetricsGridColumns([80, 64, 48], 223), [80, 64]);
});

test("four metrics balance into aligned pairs rather than a three-plus-one layout", () => {
  assert.deepEqual(getDramaMetricsGridColumns([100, 50, 100, 50], 300), [100, 50]);
});

test("columns accommodate both rows' longest values without imposing equal minimum widths", () => {
  assert.deepEqual(getDramaMetricsGridColumns([180, 48, 200, 64], 300), [200, 64]);
  assert.deepEqual(getDramaMetricsGridColumns([180, 48, 200, 64], 279), [200]);
});

test("empty, fractional-width and narrower-than-one-metric layouts remain defined", () => {
  assert.deepEqual(getDramaMetricsGridColumns([], 300), []);
  assert.deepEqual(getDramaMetricsGridColumns([70.2, 64], 151), [71, 64]);
  assert.deepEqual(getDramaMetricsGridColumns([400, 60], 280), [400]);
});
