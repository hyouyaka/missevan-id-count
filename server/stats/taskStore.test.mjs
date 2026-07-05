import assert from "node:assert/strict";
import test from "node:test";

import {
  createStatsTaskStore,
  createUpstashTaskStoreAdapter,
} from "./taskStore.js";

test("task store round-trips recoverable tasks through an injected adapter", async () => {
  let snapshot = [];
  const store = createStatsTaskStore({
    adapter: {
      async load() {
        return snapshot;
      },
      async save(tasks) {
        snapshot = structuredClone(tasks);
      },
    },
  });

  await store.save({ taskId: "a", status: "running", clientKey: "hidden" });
  await store.save({ taskId: "b", status: "completed" });

  assert.deepEqual(
    await store.loadTasks({ now: 1000, retentionMs: 10000 }),
    [
      { taskId: "a", status: "running", clientKey: "hidden" },
      { taskId: "b", status: "completed" },
    ]
  );
});

test("task store serializes writes after an adapter failure", async () => {
  let attempts = 0;
  const store = createStatsTaskStore({
    onError() {},
    adapter: {
      async load() {
        return [];
      },
      async save() {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("write failed");
        }
      },
    },
  });

  await store.save({ taskId: "a", status: "queued" });
  await store.save({ taskId: "b", status: "queued" });
  assert.equal(attempts, 2);
});

test("task store prefers incremental writes for only the changed task", async () => {
  const incrementalWrites = [];
  const fullWrites = [];
  const store = createStatsTaskStore({
    adapter: {
      async load() {
        return [];
      },
      async save(tasks) {
        fullWrites.push(structuredClone(tasks));
      },
      async saveTask(task) {
        incrementalWrites.push(structuredClone(task));
      },
    },
  });

  await store.save({ taskId: "a", status: "queued", progress: 0 });
  await store.save({ taskId: "b", status: "running", progress: 25 });
  await store.save({ taskId: "a", status: "running", progress: 50 });

  assert.deepEqual(
    incrementalWrites.map((task) => `${task.taskId}:${task.progress}`),
    ["a:0", "b:25", "a:50"]
  );
  assert.deepEqual(fullWrites, []);
});

test("task store rejects saveTask-only adapters that cannot remove tasks", () => {
  assert.throws(
    () =>
      createStatsTaskStore({
        adapter: {
          async load() {
            return [];
          },
          async saveTask() {},
        },
      }),
    /remove/
  );
});

test("Upstash task adapter saves one task with a fixed three-command sequence", async () => {
  const commands = [];
  const client = {
    async command(args, options) {
      commands.push({ args, options });
      return 1;
    },
  };
  const adapter = createUpstashTaskStoreAdapter({
    client,
    instanceId: "replica-1",
    ttlSeconds: 900,
    commandTimeoutMs: 10_000,
  });

  if (typeof adapter.saveTask === "function") {
    await adapter.saveTask({ taskId: "task-a", status: "running", progress: 50 });
  }

  assert.deepEqual(
    commands.map(({ args }) => args),
    [
      ["SET", "stats:tasks:v1:replica-1:task-a", JSON.stringify({ taskId: "task-a", status: "running", progress: 50 }), "EX", 900],
      ["SADD", "stats:tasks:v1:replica-1", "task-a"],
      ["EXPIRE", "stats:tasks:v1:replica-1", 900],
    ]
  );
  assert.deepEqual(
    commands.map(({ options }) => options),
    [
      { timeoutMs: 10_000 },
      { timeoutMs: 10_000 },
      { timeoutMs: 10_000 },
    ]
  );
});

test("task store removes expired tasks from persisted snapshots", async () => {
  let snapshot = [];
  const store = createStatsTaskStore({
    adapter: {
      async load() {
        return snapshot;
      },
      async save(tasks) {
        snapshot = structuredClone(tasks);
      },
    },
  });

  await store.save({ taskId: "a", status: "completed" });
  await store.remove("a");
  assert.deepEqual(snapshot, []);
});

test("task store prunes expired and malformed snapshots before the next save", async () => {
  let snapshot = [
    { taskId: "expired", status: "completed", updatedAt: 1 },
    { taskId: "live", status: "running", updatedAt: 900 },
    { taskId: "invalid", status: "mystery", updatedAt: 900 },
  ];
  const store = createStatsTaskStore({
    adapter: {
      async load() {
        return snapshot;
      },
      async save(tasks) {
        snapshot = structuredClone(tasks);
      },
    },
  });

  assert.deepEqual(
    await store.loadTasks({ now: 1000, retentionMs: 500 }),
    [{ taskId: "live", status: "running", updatedAt: 900 }]
  );
  await store.save({ taskId: "live", status: "running", updatedAt: 950 });
  assert.deepEqual(snapshot.map((task) => task.taskId), ["live"]);
});

test("task store removes stale adapter ids discovered during load", async () => {
  const removed = [];
  const store = createStatsTaskStore({
    adapter: {
      async load() {
        return {
          tasks: [{ taskId: "live", status: "queued", updatedAt: 900 }],
          staleIds: ["missing"],
        };
      },
      async save() {},
      async remove(taskId) {
        removed.push(taskId);
      },
    },
  });

  await store.loadTasks({ now: 1000, retentionMs: 500 });
  assert.deepEqual(removed, ["missing"]);
});
