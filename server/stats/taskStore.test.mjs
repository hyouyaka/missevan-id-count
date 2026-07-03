import assert from "node:assert/strict";
import test from "node:test";

import { createStatsTaskStore } from "./taskStore.js";

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
