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
