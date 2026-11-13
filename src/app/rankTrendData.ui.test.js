import { expect, test } from "vitest";
import { resolveRankRefreshAt } from "@/app/ranksData";

import {
  getRankTrendModePreference,
  isRankTrendWeeklyUnavailable,
  mapRankTrendWindowKey,
  markRankTrendWeeklyUnavailable,
  resolveRankTrendAvailabilityIds,
  setRankTrendModePreference,
} from "@/app/rankTrendData";

test("labor ranks keep independent timestamps while playback ranks retain their sample time", () => {
  const data = { cvSummary: { updatedAt: "2026-11-06", resourceUpdatedAt: "2026-11-13" } };
  expect(resolveRankRefreshAt(data, "cv", { key: "cv-series-count", fetchedAt: "2026-11-12" })).toBe("2026-11-12");
  expect(resolveRankRefreshAt(data, "cv", { key: "cv-series-count", fetchedAt: "" })).toBe("");
  expect(resolveRankRefreshAt(data, "cv", { key: "cv", fetchedAt: "2026-11-13" })).toBe("2026-11-06");
});

test("trend windows keep their 3, 7, and 30 size when sampling mode changes", () => {
  expect(mapRankTrendWindowKey("3d", "weekly_playback")).toBe("3w");
  expect(mapRankTrendWindowKey("7w", "metric")).toBe("7d");
  expect(mapRankTrendWindowKey("30d", "weekly_playback")).toBe("30w");
  expect(mapRankTrendWindowKey("unknown", "metric")).toBe("7d");
});

test("trend mode preference and weekly availability stay isolated by platform and id", () => {
  const id = `session-${Date.now()}-${Math.random()}`;
  expect(getRankTrendModePreference({ platform: "missevan", id })).toBe("metric");

  setRankTrendModePreference({ platform: "missevan", id, kind: "weekly_playback" });
  expect(getRankTrendModePreference({ platform: "missevan", id })).toBe("weekly_playback");
  expect(getRankTrendModePreference({ platform: "manbo", id })).toBe("metric");

  markRankTrendWeeklyUnavailable({ platform: "missevan", id });
  expect(isRankTrendWeeklyUnavailable({ platform: "missevan", id })).toBe(true);
  expect(isRankTrendWeeklyUnavailable({ platform: "manbo", id })).toBe(false);
});

test("trend availability filters only successful responses and fails open", () => {
  const requestedIds = ["100", "200"];

  expect([...resolveRankTrendAvailabilityIds({
    response: { ok: true },
    data: { success: true, ids: ["200", "unexpected"] },
    requestedIds,
  })]).toEqual(["200"]);
  expect([...resolveRankTrendAvailabilityIds({
    response: { ok: false },
    data: { success: false, ids: [] },
    requestedIds,
  })]).toEqual(requestedIds);
  expect([...resolveRankTrendAvailabilityIds({ requestedIds })]).toEqual(requestedIds);
});
