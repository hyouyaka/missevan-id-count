import assert from "node:assert/strict";
import test from "node:test";
import { createStatsTaskScheduler } from "./statsTaskScheduler.js";

function createDeferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function waitForTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createTask(taskId, platform, clientKey) {
  return {
    taskId,
    platform,
    clientKey,
    status: "queued",
    queuePosition: 0,
  };
}

function createScheduler(execute, overrides = {}) {
  return createStatsTaskScheduler({
    execute,
    limits: {
      missevan: {
        maxActive: 2,
        maxActivePerClient: 1,
        maxQueued: 3,
        maxQueuedPerClient: 2,
      },
      manbo: {
        maxActive: 3,
        maxActivePerClient: 2,
        maxQueued: 3,
        maxQueuedPerClient: 2,
      },
      ...overrides,
    },
  });
}

test("scheduler isolates platform concurrency and starts eligible tasks", async () => {
  const pending = new Map();
  const started = [];
  const scheduler = createScheduler((task) => {
    started.push(task.taskId);
    const deferred = createDeferred();
    pending.set(task.taskId, deferred);
    return deferred.promise;
  });

  scheduler.enqueue(createTask("m1", "missevan", "a"));
  scheduler.enqueue(createTask("m2", "missevan", "b"));
  const queued = scheduler.enqueue(createTask("m3", "missevan", "c"));
  scheduler.enqueue(createTask("b1", "manbo", "a"));

  await Promise.resolve();
  assert.deepEqual(started, ["m1", "m2", "b1"]);
  assert.equal(queued.accepted, true);
  assert.equal(queued.queuePosition, 1);

  pending.get("m1").resolve();
  await waitForTurn();
  assert.deepEqual(started, ["m1", "m2", "b1", "m3"]);
});

test("scheduler skips a blocked client while preserving FIFO among eligible tasks", async () => {
  const pending = new Map();
  const started = [];
  const scheduler = createScheduler((task) => {
    started.push(task.taskId);
    const deferred = createDeferred();
    pending.set(task.taskId, deferred);
    return deferred.promise;
  }, {
    missevan: {
      maxActive: 2,
      maxActivePerClient: 1,
      maxQueued: 3,
      maxQueuedPerClient: 2,
    },
  });

  scheduler.enqueue(createTask("a1", "missevan", "a"));
  scheduler.enqueue(createTask("a2", "missevan", "a"));
  scheduler.enqueue(createTask("b1", "missevan", "b"));

  await Promise.resolve();
  assert.deepEqual(started, ["a1", "b1"]);
  assert.equal(scheduler.getQueuePosition("a2"), 1);

  pending.get("a1").resolve();
  await waitForTurn();
  assert.deepEqual(started, ["a1", "b1", "a2"]);
});

test("scheduler enforces platform and per-client queue limits", () => {
  const scheduler = createScheduler(() => new Promise(() => {}), {
    missevan: {
      maxActive: 1,
      maxActivePerClient: 1,
      maxQueued: 2,
      maxQueuedPerClient: 1,
    },
  });

  scheduler.enqueue(createTask("active", "missevan", "a"));
  assert.equal(scheduler.enqueue(createTask("queued-a", "missevan", "a")).accepted, true);
  assert.deepEqual(
    scheduler.enqueue(createTask("rejected-a", "missevan", "a")),
    { accepted: false, code: "TASK_CLIENT_QUEUE_FULL" }
  );
  assert.equal(scheduler.enqueue(createTask("queued-b", "missevan", "b")).accepted, true);
  assert.deepEqual(
    scheduler.enqueue(createTask("rejected-c", "missevan", "c")),
    { accepted: false, code: "TASK_QUEUE_FULL" }
  );
});

test("scheduler removes cancelled queued tasks", () => {
  const scheduler = createScheduler(() => new Promise(() => {}), {
    missevan: {
      maxActive: 1,
      maxActivePerClient: 1,
      maxQueued: 3,
      maxQueuedPerClient: 2,
    },
  });

  scheduler.enqueue(createTask("active", "missevan", "a"));
  scheduler.enqueue(createTask("queued", "missevan", "b"));

  assert.deepEqual(scheduler.cancelQueued("queued"), {
    cancelled: true,
    taskId: "queued",
  });
  assert.equal(scheduler.getQueuePosition("queued"), 0);
});

test("scheduler releases capacity after executor rejection", async () => {
  const started = [];
  const scheduler = createScheduler(async (task) => {
    started.push(task.taskId);
    if (task.taskId === "first") {
      throw new Error("boom");
    }
  }, {
    missevan: {
      maxActive: 1,
      maxActivePerClient: 1,
      maxQueued: 3,
      maxQueuedPerClient: 2,
    },
  });

  scheduler.enqueue(createTask("first", "missevan", "a"));
  scheduler.enqueue(createTask("second", "missevan", "b"));
  await waitForTurn();
  await waitForTurn();

  assert.deepEqual(started, ["first", "second"]);
});
