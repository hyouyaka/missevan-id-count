import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeMeta } from "./app-utils.js";
import { createStatsTaskRunController } from "./useStatsTaskRun.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function createTimerHarness() {
  const intervals = new Set();
  const timeouts = new Set();
  let nextTimerId = 0;
  return {
    clearIntervalFn(timer) {
      intervals.delete(timer);
    },
    clearTimeoutFn(timer) {
      timeouts.delete(timer);
    },
    intervals,
    setIntervalFn() {
      const timer = nextTimerId++;
      intervals.add(timer);
      return timer;
    },
    setTimeoutFn() {
      const timer = nextTimerId++;
      timeouts.add(timer);
      return timer;
    },
    timeouts,
  };
}

function createControllerHarness(overrides = {}) {
  const metas = {
    missevan: createRuntimeMeta(),
    manbo: createRuntimeMeta(),
  };
  const timers = createTimerHarness();
  const events = {
    cancelled: [],
    completed: [],
    created: [],
    elapsed: [],
    finished: [],
    snapshots: [],
    started: [],
  };
  const controller = createStatsTaskRunController({
    ...timers,
    createTask: async () => ({ taskId: "task", taskType: "id", status: "queued" }),
    getRuntimeMeta: (platform) => metas[platform],
    getTaskSnapshot: async () => ({ status: "completed" }),
    getActiveTaskIds: () => [],
    isRunMarkedRunning: () => false,
    now: () => 1000,
    notifyTaskCancel: (taskId) => events.cancelled.push(taskId),
    onCompleted: (event) => events.completed.push(event),
    onElapsed: (event) => events.elapsed.push(event),
    onRunCancelled: (event) => events.cancelled.push(`run:${event.taskId}`),
    onRunFinished: (event) => events.finished.push(event),
    onRunStarted: (event) => events.started.push(event),
    onSnapshot: (event) => events.snapshots.push(event),
    onTaskCreated: (event) => events.created.push(event),
    ...overrides,
  });
  return { controller, events, metas, timers };
}

test("cancelling during task creation cancels the late server task without applying stale state", async () => {
  const creation = createDeferred();
  const { controller, events, metas, timers } = createControllerHarness({
    createTask: () => creation.promise,
  });
  const run = controller.beginRun("missevan");
  const pending = controller.startStatsTask("missevan", "id", { episodes: [] }, run.runId, run.signal);

  controller.cancelRun("missevan");
  creation.resolve({ taskId: "late-task", taskType: "id", status: "queued" });
  await assert.rejects(pending, (error) => error?.name === "AbortError");

  assert.deepEqual(events.created, []);
  assert.deepEqual(events.snapshots, []);
  assert.deepEqual(events.completed, []);
  assert.ok(events.cancelled.includes("late-task"));
  assert.equal(metas.missevan.activeElapsedTimer, null);
  assert.equal(timers.intervals.size, 0);
  assert.deepEqual(controller.getContextCounts(), { active: 0, total: 0 });
});

test("an old run cannot clear a newer run timer or apply a late task response", async () => {
  const firstCreation = createDeferred();
  const { controller, events, metas, timers } = createControllerHarness({
    createTask: ({ payload }) => payload.creation,
  });
  const first = controller.beginRun("missevan");
  const firstPending = controller.startStatsTask(
    "missevan",
    "id",
    { creation: firstCreation.promise },
    first.runId,
    first.signal
  );
  const second = controller.beginRun("missevan");
  const secondTimer = metas.missevan.activeElapsedTimer;

  assert.equal(controller.finishRun("missevan", first.runId, "failed"), false);
  assert.equal(metas.missevan.activeElapsedTimer, secondTimer);
  assert.equal(timers.intervals.has(secondTimer), true);

  firstCreation.resolve({ taskId: "old-task", taskType: "id", status: "queued" });
  await assert.rejects(firstPending, (error) => error?.name === "AbortError");

  assert.equal(controller.isRunActive("missevan", second.runId), true);
  assert.deepEqual(events.created, []);
  assert.ok(events.cancelled.includes("old-task"));
  controller.finishRun("missevan", second.runId, "idle");
  assert.deepEqual(controller.getContextCounts(), { active: 0, total: 0 });
});

test("completed snapshots record once and failed snapshots reject the task run", async () => {
  const completed = createControllerHarness({
    getTaskSnapshot: async () => ({ status: "completed", result: { idResults: [] } }),
  });
  const completedRun = completed.controller.beginRun("manbo");
  await completed.controller.startStatsTask("manbo", "id", {}, completedRun.runId, completedRun.signal);
  assert.equal(completed.events.completed.length, 1);
  assert.equal(completed.events.completed[0].taskId, "task");
  completed.controller.finishRun("manbo", completedRun.runId, "completed");

  const failed = createControllerHarness({
    getTaskSnapshot: async () => ({ status: "failed", error: "backend failed" }),
  });
  const failedRun = failed.controller.beginRun("manbo");
  await assert.rejects(
    failed.controller.startStatsTask("manbo", "id", {}, failedRun.runId, failedRun.signal),
    /backend failed/
  );
  assert.equal(failed.events.completed.length, 0);
  failed.controller.finishRun("manbo", failedRun.runId, "failed");
});

test("completion receives an immutable copy of the run replay context", async () => {
  const harness = createControllerHarness({
    getTaskSnapshot: async () => ({ status: "completed", result: { idResults: [] } }),
  });
  const replay = {
    version: 1,
    operation: "id",
    dramas: [{ dramaId: "100", episodeIds: ["10"] }],
  };
  const run = harness.controller.beginRun("missevan", { replay });
  replay.dramas[0].episodeIds.push("changed-after-start");
  await harness.controller.startStatsTask("missevan", "id", {}, run.runId, run.signal);

  assert.deepEqual(harness.events.completed[0].runData, {
    replay: {
      version: 1,
      operation: "id",
      dramas: [{ dramaId: "100", episodeIds: ["10"] }],
    },
  });
  harness.controller.finishRun("missevan", run.runId, "completed");
});

test("cancellation and disposal clear elapsed and pending poll timers", async () => {
  const snapshots = [
    { status: "running" },
  ];
  const harness = createControllerHarness({
    getTaskSnapshot: async () => snapshots.shift(),
  });
  const run = harness.controller.beginRun("missevan");
  const pending = harness.controller.startStatsTask("missevan", "id", {}, run.runId, run.signal);

  for (let index = 0; index < 4 && harness.timers.timeouts.size === 0; index += 1) {
    await Promise.resolve();
  }
  assert.equal(harness.timers.intervals.size, 1);
  assert.equal(harness.timers.timeouts.size, 1);
  harness.controller.cancelRun("missevan");
  await assert.rejects(pending, (error) => error?.name === "AbortError");
  assert.equal(harness.timers.intervals.size, 0);
  assert.equal(harness.timers.timeouts.size, 0);

  const second = harness.controller.beginRun("missevan");
  assert.equal(harness.timers.intervals.size, 1);
  harness.controller.dispose();
  assert.equal(harness.timers.intervals.size, 0);
  assert.equal(harness.metas.missevan.activeElapsedTimer, null);
  assert.equal(harness.controller.isRunActive("missevan", second.runId), false);
  assert.deepEqual(harness.controller.getContextCounts(), { active: 0, total: 0 });
});

test("cancelled snapshots and repeated replacement retire every inactive run context", async () => {
  const cancelled = createControllerHarness({
    getTaskSnapshot: async () => ({ status: "cancelled" }),
  });
  const run = cancelled.controller.beginRun("missevan");
  await assert.rejects(
    cancelled.controller.startStatsTask("missevan", "id", {}, run.runId, run.signal),
    (error) => error?.name === "AbortError"
  );
  cancelled.controller.finishRun("missevan", run.runId, "cancelled");
  assert.deepEqual(cancelled.controller.getContextCounts(), { active: 0, total: 0 });

  const repeated = createControllerHarness();
  for (let index = 0; index < 4; index += 1) {
    repeated.controller.beginRun("missevan");
    repeated.controller.cancelRun("missevan");
    assert.deepEqual(repeated.controller.getContextCounts(), { active: 0, total: 0 });
  }
  repeated.controller.beginRun("missevan");
  repeated.controller.beginRun("manbo");
  assert.deepEqual(repeated.controller.getContextCounts(), { active: 2, total: 2 });
  repeated.controller.dispose();
  assert.deepEqual(repeated.controller.getContextCounts(), { active: 0, total: 0 });
});
