import { expect, test } from "vitest";

import {
  getRankTrendModePreference,
  isRankTrendWeeklyUnavailable,
  mapRankTrendWindowKey,
  markRankTrendWeeklyUnavailable,
  resolveRankTrendAvailabilityIds,
  setRankTrendModePreference,
} from "@/app/rankTrendData";

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
