import assert from "node:assert/strict";
import test from "node:test";

import { createStatsTaskEngine } from "./taskEngine.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("task engine passes one abort signal to an executor and cancels it", async () => {
  const started = deferred();
  const finish = deferred();
  let receivedSignal;
  const engine = createStatsTaskEngine({
    limits: {
      missevan: { maxActive: 1, maxActivePerClient: 1, maxQueued: 2, maxQueuedPerClient: 2 },
    },
    async execute(task, { signal }) {
      receivedSignal = signal;
      started.resolve();
      await finish.promise;
      task.status = "cancelled";
    },
  });
  const task = {
    taskId: "task-1",
    platform: "missevan",
    clientKey: "ip-1",
    status: "queued",
  };

  engine.enqueue(task);
  await started.promise;
  assert.equal(receivedSignal.aborted, false);
  assert.equal(engine.cancel(task.taskId).changed, true);
  assert.equal(receivedSignal.aborted, true);
  finish.resolve();
});

test("executor completion cannot overwrite an accepted cancellation", async () => {
  const started = deferred();
  const finish = deferred();
  const engine = createStatsTaskEngine({
    limits: {
      missevan: { maxActive: 1, maxActivePerClient: 1, maxQueued: 2, maxQueuedPerClient: 2 },
    },
    async execute(_task, { report }) {
      started.resolve();
      await finish.promise;
      report({ progress: 90, currentAction: "迟到进度" });
      return {
        status: "completed",
        patch: { progress: 100, result: { partial: true } },
      };
    },
  });
  const task = {
    taskId: "cancel-wins",
    platform: "missevan",
    clientKey: "ip-1",
    status: "queued",
    progress: 0,
  };

  engine.enqueue(task);
  await started.promise;
  assert.equal(engine.cancel(task.taskId).changed, true);
  finish.resolve();
  await new Promise((resolve) => setImmediate(resolve));

  const snapshot = engine.getSnapshot(task.taskId);
  assert.equal(snapshot.status, "cancelled");
  assert.equal(snapshot.progress, 100);
  assert.deepEqual(snapshot.result, { partial: true });
  assert.equal(snapshot.resultIncomplete, true);
});

test("immediate cancellation prevents a scheduled executor from starting", async () => {
  let executeCalls = 0;
  const engine = createStatsTaskEngine({
    limits: {
      missevan: { maxActive: 1, maxActivePerClient: 1, maxQueued: 1, maxQueuedPerClient: 1 },
    },
    async execute() {
      executeCalls += 1;
      return { status: "completed" };
    },
  });
  const task = {
    taskId: "cancel-before-start",
    platform: "missevan",
    clientKey: "ip-early",
    status: "queued",
  };

  engine.enqueue(task);
  const cancellation = engine.cancel(task.taskId);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(cancellation.changed, true);
  assert.equal(executeCalls, 0);
  assert.equal(engine.getSnapshot(task.taskId).status, "cancelled");
});

test("executor failure cannot overwrite an accepted cancellation", async () => {
  const started = deferred();
  const finish = deferred();
  const engine = createStatsTaskEngine({
    limits: {
      manbo: { maxActive: 1, maxActivePerClient: 1, maxQueued: 1, maxQueuedPerClient: 1 },
    },
    async execute() {
      started.resolve();
      await finish.promise;
      throw new Error("late failure");
    },
  });
  const task = {
    taskId: "cancel-before-failure",
    platform: "manbo",
    clientKey: "ip-2",
    status: "queued",
  };

  engine.enqueue(task);
  await started.promise;
  engine.cancel(task.taskId);
  finish.resolve();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(engine.getSnapshot(task.taskId).status, "cancelled");
});

test("direct executor mutations are ignored after cancellation", async () => {
  const started = deferred();
  const finish = deferred();
  const engine = createStatsTaskEngine({
    limits: {
      manbo: { maxActive: 1, maxActivePerClient: 1, maxQueued: 1, maxQueuedPerClient: 1 },
    },
    async execute(task) {
      started.resolve();
      await finish.promise;
      task.completedCount = 99;
      task.currentAction = "迟到写入";
      task.status = "completed";
      return { status: "completed" };
    },
  });
  const task = {
    taskId: "direct-late-write",
    platform: "manbo",
    clientKey: "ip-direct",
    status: "queued",
    completedCount: 0,
  };

  engine.enqueue(task);
  await started.promise;
  engine.cancel(task.taskId);
  finish.resolve();
  await new Promise((resolve) => setImmediate(resolve));

  const snapshot = engine.getSnapshot(task.taskId);
  assert.equal(snapshot.status, "cancelled");
  assert.equal(snapshot.completedCount, 0);
  assert.equal(snapshot.currentAction, "统计已取消");
});

test("pruning an active expired task does not persist it again after removal", async () => {
  let now = 0;
  const started = deferred();
  const finish = deferred();
  const persistenceEvents = [];
  const engine = createStatsTaskEngine({
    limits: {
      missevan: { maxActive: 1, maxActivePerClient: 1, maxQueued: 1, maxQueuedPerClient: 1 },
    },
    retentionMs: 10,
    now: () => now,
    store: {
      async save(task) {
        persistenceEvents.push({ type: "save", status: task.status });
      },
      async remove(taskId) {
        persistenceEvents.push({ type: "remove", taskId });
      },
    },
    async execute() {
      started.resolve();
      await finish.promise;
      return { status: "completed", patch: { result: { ok: true } } };
    },
  });
  const task = {
    taskId: "expired-active",
    platform: "missevan",
    clientKey: "ip-expired",
    status: "queued",
    createdAt: now,
    updatedAt: now,
  };

  engine.enqueue(task);
  await started.promise;
  now = 20;
  engine.pruneExpired();
  finish.resolve();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(engine.getSnapshot(task.taskId), null);
  assert.deepEqual(persistenceEvents.at(-1), {
    type: "remove",
    taskId: task.taskId,
  });
});

test("cancelling terminal tasks is idempotent", async () => {
  const completed = deferred();
  const engine = createStatsTaskEngine({
    limits: {
      missevan: { maxActive: 1, maxActivePerClient: 1, maxQueued: 1, maxQueuedPerClient: 1 },
    },
    async execute() {
      return { status: "completed", patch: { result: { ok: true } } };
    },
  });
  const task = {
    taskId: "already-complete",
    platform: "missevan",
    clientKey: "ip-3",
    status: "queued",
  };

  engine.enqueue(task);
  setImmediate(completed.resolve);
  await completed.promise;
  await new Promise((resolve) => setImmediate(resolve));

  const result = engine.cancel(task.taskId);
  assert.equal(result.changed, false);
  assert.equal(engine.getSnapshot(task.taskId).status, "completed");
});

test("task engine restores nonterminal tasks with the same id and a clean attempt", async () => {
  const recovered = {
    taskId: "task-2",
    platform: "missevan",
    clientKey: "ip-2",
    status: "running",
    attempt: 1,
    progress: 80,
    completedCount: 8,
    result: { partial: true },
  };
  const executed = deferred();
  const engine = createStatsTaskEngine({
    limits: {
      missevan: { maxActive: 1, maxActivePerClient: 1, maxQueued: 2, maxQueuedPerClient: 2 },
    },
    store: {
      async loadTasks() {
        return [recovered];
      },
      async save() {},
    },
    async execute(task) {
      executed.resolve(task);
    },
  });

  const [restored] = await engine.restore();
  const running = await executed.promise;
  assert.equal(restored.taskId, "task-2");
  assert.equal(running.resumed, true);
  assert.equal(running.attempt, 2);
  assert.equal(running.progress, 0);
  assert.equal(running.completedCount, 0);
  assert.equal(running.result, null);
  assert.ok(running.lastSeenAt > 0);
  assert.ok(running.updatedAt >= running.lastSeenAt);
});

test("task engine does not expose restored tasks that cannot be re-enqueued", async () => {
  const release = deferred();
  const restoredToLiveStore = [];
  const engine = createStatsTaskEngine({
    limits: {
      missevan: { maxActive: 1, maxActivePerClient: 1, maxQueued: 0, maxQueuedPerClient: 0 },
    },
    store: {
      async loadTasks() {
        return [
          { taskId: "task-a", platform: "missevan", clientKey: "ip-a", status: "running" },
          { taskId: "task-b", platform: "missevan", clientKey: "ip-b", status: "queued" },
        ];
      },
      async save() {},
    },
    onRestore(task) {
      restoredToLiveStore.push(task.taskId);
    },
    async execute() {
      await release.promise;
    },
  });

  const restored = await engine.restore();

  assert.deepEqual(restored.map((task) => task.taskId), ["task-a"]);
  assert.deepEqual(restoredToLiveStore, ["task-a"]);
  release.resolve();
});

test("task engine exposes retained terminal tasks without executing them", async () => {
  let executeCalls = 0;
  const engine = createStatsTaskEngine({
    limits: {
      missevan: { maxActive: 1, maxActivePerClient: 1, maxQueued: 1, maxQueuedPerClient: 1 },
    },
    store: {
      async loadTasks() {
        return [{
          taskId: "retained",
          platform: "missevan",
          clientKey: "ip-4",
          status: "completed",
          result: { ok: true },
        }];
      },
      async save() {},
    },
    async execute() {
      executeCalls += 1;
    },
  });

  await engine.restore();

  assert.equal(executeCalls, 0);
  assert.deepEqual(engine.getSnapshot("retained").result, { ok: true });
});

test("whenReady waits for asynchronous restore", async () => {
  const loaded = deferred();
  const engine = createStatsTaskEngine({
    limits: {},
    store: {
      async loadTasks() {
        await loaded.promise;
        return [];
      },
      async save() {},
    },
    async execute() {},
  });

  const restorePromise = engine.restore();
  let ready = false;
  const readyPromise = engine.whenReady().then(() => {
    ready = true;
  });
  await Promise.resolve();
  assert.equal(ready, false);
  loaded.resolve();
  await restorePromise;
  await readyPromise;
  assert.equal(ready, true);
});

test("whenReady is closed before restore is started", async () => {
  const engine = createStatsTaskEngine({
    limits: {},
    store: {
      async loadTasks() {
        return [];
      },
      async save() {},
    },
    async execute() {},
  });
  let ready = false;
  const waiting = engine.whenReady().then(() => {
    ready = true;
  });

  await Promise.resolve();
  assert.equal(ready, false);
  await engine.restore();
  await waiting;
  assert.equal(ready, true);
});
