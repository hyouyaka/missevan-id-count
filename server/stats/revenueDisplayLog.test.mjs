import assert from "node:assert/strict";
import test from "node:test";
import { buildPaidCoefficientBasis } from "../../shared/paidCoefficient.js";
import { buildRevenueDisplayLog, createRevenueDisplayLogRecorder, shouldDeferRevenueLog } from "./revenueDisplayLog.js";

function snapshot() {
  const special = { dramaId: "1", title: "单集", platform: "manbo", revenueType: "episode", payCount: 76, seasonPaidUserCount: 10, episodePaidUserCountTotal: 20, paidEpisodeCount: 2, minimumEpisodePrice: 10, diamondValue: 500, estimatedRevenueYuan: 12.6, minRevenueYuan: 12.6, maxRevenueYuan: 81, summaryRevenueMode: "range" };
  const member = { dramaId: "2", platform: "manbo", revenueType: "member", summaryRevenueMode: "member_reward", diamondValue: 500, estimatedRevenueYuan: 5 };
  return { taskId: "task-1", logOnFirstDisplay: true, platform: "manbo", taskType: "revenue", status: "completed", result: { revenueResults: [special, member].map((item) => ({ ...item, paidCoefficientBasis: buildPaidCoefficientBasis(item) })) } };
}

test("display log uses effective coefficients and recalculated revenues, not client-supplied amounts", () => {
  const raw = snapshot();
  const entry = buildRevenueDisplayLog(raw, { platform: "manbo", paidCoefficient: 9, estimatedRevenueYuan: 999 });
  assert.equal(entry.action, "calculate");
  assert.deepEqual(entry.result.revenueResults.map((item) => item.paidCoefficient), [7.6, 1]);
  assert.equal(entry.result.revenueResults[0].minRevenueYuan, 20.2);
  assert.equal(entry.result.revenueResults[0].maxRevenueYuan, 81);
  assert.equal(entry.result.revenueSummary.minRevenueYuan, 25.2);
  assert.equal(entry.result.revenueSummary.maxRevenueYuan, 86);
  assert.equal(raw.result.revenueResults[0].minRevenueYuan, 12.6);
  for (const patch of [{ platform: "missevan" }, { paidCoefficient: 0 }, { paidCoefficient: 1.25 }, { paidCoefficient: "9" }]) {
    assert.equal(buildRevenueDisplayLog(raw, { platform: "manbo", paidCoefficient: 9, ...patch }), null);
  }
  assert.equal(buildRevenueDisplayLog({ ...raw, status: "running" }, { platform: "manbo", paidCoefficient: 9 }), null);
});

test("display log preserves original result fields while replacing only adjusted revenue data", () => {
  for (const status of ["completed", "cancelled"]) {
    const raw = snapshot();
    raw.status = status;
    raw.result.episodeDetails = [
      { key: "manbo:1:101", dramaId: "1", episodeId: "101", title: "第一集", status: "success", totalDanmaku: 25, fetchedDanmaku: 24, uniqueUsers: 8, cached: true },
      { key: "manbo:1:102", dramaId: "1", episodeId: "102", title: "第二集", status: "failed", totalDanmaku: null, fetchedDanmaku: 0, uniqueUsers: 0, cached: false },
    ];
    raw.result.diagnostics = { cachedEpisodeCount: 1, failedEpisodeCount: 1 };
    raw.result.revenueSummary = { minRevenueYuan: 17.6, maxRevenueYuan: 86, dramaCount: 2 };
    const original = structuredClone(raw);
    const entry = buildRevenueDisplayLog(raw, { platform: "manbo", paidCoefficient: 9 });

    const { revenueResults, revenueSummary, ...originalFields } = entry.result;
    assert.deepEqual(originalFields, {
      episodeDetails: original.result.episodeDetails,
      diagnostics: original.result.diagnostics,
    });
    assert.equal(revenueResults[0].minRevenueYuan, 20.2);
    assert.equal(revenueSummary.minRevenueYuan, 25.2);
    assert.equal(revenueSummary.dramaCount, 2);
    assert.notEqual(entry.result, raw.result);
    assert.deepEqual(raw, original, "building a display log must not mutate the task snapshot");
  }
});

test("first-display recorder preserves the complete result in completion metadata and serialized logs", async () => {
  const raw = snapshot();
  raw.result.episodeDetails = [
    { episodeId: "101", status: "success", fetchedDanmaku: 24, uniqueUsers: 8 },
    { episodeId: "102", status: "failed", fetchedDanmaku: 0, uniqueUsers: 0 },
  ];
  raw.result.diagnostics = { failedEpisodeCount: 1 };
  const original = structuredClone(raw);
  let completedSnapshot;
  let logged;
  const recorder = createRevenueDisplayLogRecorder({
    getSnapshot: () => raw,
    buildCompletedLog: (task) => {
      completedSnapshot = task;
      return { episodeCount: task.result.episodeDetails?.length || 0 };
    },
    writeLog: async (entry) => { logged = JSON.parse(JSON.stringify(entry)); },
  });
  assert.equal(await recorder({ taskId: raw.taskId, platform: "manbo", paidCoefficient: 9 }), true);
  assert.deepEqual(completedSnapshot.result.episodeDetails, original.result.episodeDetails);
  assert.deepEqual(logged.result.episodeDetails, original.result.episodeDetails);
  assert.deepEqual(logged.result.diagnostics, original.result.diagnostics);
  assert.equal(logged.episodeCount, 2);
  assert.equal(logged.result.revenueResults[0].minRevenueYuan, 20.2);
  assert.equal(logged.result.revenueSummary.minRevenueYuan, 25.2);
  assert.deepEqual(raw, original);
});

test("concurrent and later display deliveries log once without changing the first coefficient", async () => {
  const entries = [];
  const recorder = createRevenueDisplayLogRecorder({ getSnapshot: (id) => id === "task-1" ? snapshot() : null, writeLog: async (entry) => entries.push(entry) });
  const payload = { taskId: "task-1", platform: "manbo", paidCoefficient: 7.6 };
  await Promise.all([recorder(payload), recorder(payload)]);
  await recorder({ ...payload, paidCoefficient: 2 });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].requestedPaidCoefficient, 7.6);
  assert.equal(await recorder({ ...payload, taskId: "missing" }), false);
});

test("a failed write can retry the same first-display payload", async () => {
  let calls = 0;
  const recorder = createRevenueDisplayLogRecorder({ getSnapshot: snapshot, writeLog: async () => { if (++calls === 1) throw new Error("disk"); } });
  const payload = { taskId: "task-1", platform: "manbo", paidCoefficient: 7.6 };
  await assert.rejects(recorder(payload));
  assert.equal(await recorder(payload), true);
  assert.equal(calls, 2);
});

test("only opted-in revenue tasks with displayable results defer their single completion log", () => {
  const raw = snapshot();
  assert.equal(shouldDeferRevenueLog(raw), true);
  assert.equal(shouldDeferRevenueLog({ ...raw, logOnFirstDisplay: false, source: "favorite" }), false);
  assert.equal(shouldDeferRevenueLog({ ...raw, logOnFirstDisplay: undefined }), false);
  assert.equal(shouldDeferRevenueLog({ ...raw, status: "failed", result: null }), false);
  assert.equal(shouldDeferRevenueLog({ ...raw, result: { revenueResults: [{ failed: true }] } }), false);
});

test("completion log metadata and key result are built from the displayed revenues", async () => {
  let logged;
  const recorder = createRevenueDisplayLogRecorder({
    getSnapshot: snapshot,
    buildCompletedLog: (task) => ({ keyResultText: `${task.result.revenueSummary.minRevenueYuan}–${task.result.revenueSummary.maxRevenueYuan}`, durationMs: 100, paidCoefficient: 1 }),
    writeLog: async (entry) => { logged = entry; },
  });
  await recorder({ taskId: "task-1", platform: "manbo", paidCoefficient: 9 });
  assert.equal(logged.action, "calculate");
  assert.equal(logged.keyResultText, "25.2–86");
  assert.equal(logged.durationMs, 100);
  assert.equal(logged.paidCoefficient, 9);
  assert.equal(logged.result.revenueResults[0].paidCoefficient, 7.6);
});
