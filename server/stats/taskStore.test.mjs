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

test("Upstash task adapter refreshes Hash TTL only when it is due", async () => {
  const commands = [];
  let now = 0;
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
    ttlRefreshIntervalMs: 5000,
    now: () => now,
  });

  await adapter.saveTask({ taskId: "task-a", status: "running", progress: 10 });
  now = 4999;
  await adapter.saveTask({ taskId: "task-a", status: "running", progress: 20 });
  now = 5000;
  await adapter.saveTask({ taskId: "task-a", status: "running", progress: 30 });

  assert.deepEqual(
    commands.map(({ args }) => args),
    [
      [
        "HSET",
        "stats:tasks:v2:replica-1",
        "task-a",
        JSON.stringify({ taskId: "task-a", status: "running", progress: 10 }),
      ],
      ["EXPIRE", "stats:tasks:v2:replica-1", 900],
      [
        "HSET",
        "stats:tasks:v2:replica-1",
        "task-a",
        JSON.stringify({ taskId: "task-a", status: "running", progress: 20 }),
      ],
      [
        "HSET",
        "stats:tasks:v2:replica-1",
        "task-a",
        JSON.stringify({ taskId: "task-a", status: "running", progress: 30 }),
      ],
      ["EXPIRE", "stats:tasks:v2:replica-1", 900],
    ]
  );
  assert.ok(commands.every(({ options }) => options.timeoutMs === 10_000));
});

test("Upstash task adapter removes with HDEL and refreshes TTL on the next save", async () => {
  const commands = [];
  const client = {
    async command(args) {
      commands.push(args);
      return 1;
    },
  };
  const adapter = createUpstashTaskStoreAdapter({
    client,
    instanceId: "replica-delete",
    ttlSeconds: 900,
    now: () => 100,
  });

  await adapter.saveTask({ taskId: "task-a", status: "queued" });
  await adapter.remove("task-a");
  await adapter.saveTask({ taskId: "task-b", status: "queued" });

  assert.deepEqual(
    commands.map((args) => args[0]),
    ["HSET", "EXPIRE", "HDEL", "HSET", "EXPIRE"]
  );
  assert.deepEqual(commands[2], [
    "HDEL",
    "stats:tasks:v2:replica-delete",
    "task-a",
  ]);
});

test("Upstash task adapter loads with HGETALL and cleans malformed Hash fields", async () => {
  const validTask = {
    taskId: "valid",
    status: "running",
    updatedAt: 900,
  };
  const commands = [];
  const client = {
    async command(args) {
      commands.push(args);
      if (args[0] === "HGETALL") {
        return [
          "valid",
          JSON.stringify(validTask),
          "malformed",
          "{",
        ];
      }
      if (args[0] === "SMEMBERS") {
        return [];
      }
      return 1;
    },
  };
  const store = createStatsTaskStore({
    adapter: createUpstashTaskStoreAdapter({
      client,
      instanceId: "replica-load",
      ttlSeconds: 900,
      now: () => 1000,
    }),
  });

  assert.deepEqual(
    await store.loadTasks({ now: 1000, retentionMs: 1000 }),
    [validTask]
  );
  assert.deepEqual(
    commands.map((args) => args[0]),
    ["HGETALL", "SMEMBERS", "EXPIRE", "HDEL"]
  );
  assert.deepEqual(commands.at(-1), [
    "HDEL",
    "stats:tasks:v2:replica-load",
    "malformed",
  ]);
});

test("Upstash task adapter migrates v1 only after Hash write and TTL succeed", async () => {
  const v2Tie = {
    taskId: "tie",
    status: "running",
    progress: 60,
    updatedAt: 100,
  };
  const v2Older = {
    taskId: "newer",
    status: "running",
    progress: 20,
    updatedAt: 100,
  };
  const legacyTie = {
    ...v2Tie,
    status: "queued",
    progress: 10,
  };
  const legacyNewer = {
    ...v2Older,
    status: "completed",
    progress: 100,
    updatedAt: 101,
  };
  const legacyOnly = {
    taskId: "legacy-only",
    status: "queued",
    progress: 0,
    updatedAt: 90,
  };
  const repairedFromLegacy = {
    taskId: "repaired",
    status: "running",
    progress: 40,
    updatedAt: 95,
  };
  const commands = [];
  const client = {
    async command(args) {
      commands.push(args);
      if (args[0] === "HGETALL") {
        return {
          tie: JSON.stringify(v2Tie),
          newer: JSON.stringify(v2Older),
          repaired: "{",
        };
      }
      if (args[0] === "SMEMBERS") {
        return ["tie", "newer", "legacy-only", "repaired", "invalid"];
      }
      if (args[0] === "MGET") {
        return [
          JSON.stringify(legacyTie),
          JSON.stringify(legacyNewer),
          JSON.stringify(legacyOnly),
          JSON.stringify(repairedFromLegacy),
          "{",
        ];
      }
      return 1;
    },
  };
  const adapter = createUpstashTaskStoreAdapter({
    client,
    instanceId: "replica-migrate",
    ttlSeconds: 900,
    now: () => 1000,
  });

  const loaded = await adapter.load();

  assert.deepEqual(loaded.tasks, [
    v2Tie,
    legacyNewer,
    legacyOnly,
    repairedFromLegacy,
  ]);
  assert.deepEqual(loaded.staleIds, []);
  assert.deepEqual(
    commands.map((args) => args[0]),
    ["HGETALL", "SMEMBERS", "MGET", "HSET", "EXPIRE", "DEL"]
  );
  assert.deepEqual(commands.at(-1), [
    "DEL",
    "stats:tasks:v1:replica-migrate",
    "stats:tasks:v1:replica-migrate:tie",
    "stats:tasks:v1:replica-migrate:newer",
    "stats:tasks:v1:replica-migrate:legacy-only",
    "stats:tasks:v1:replica-migrate:repaired",
    "stats:tasks:v1:replica-migrate:invalid",
  ]);
  const migratedPairs = Object.fromEntries(
    Array.from(
      { length: (commands[3].length - 2) / 2 },
      (_, index) => [
        commands[3][index * 2 + 2],
        JSON.parse(commands[3][index * 2 + 3]),
      ]
    )
  );
  assert.deepEqual(migratedPairs, {
    tie: v2Tie,
    newer: legacyNewer,
    "legacy-only": legacyOnly,
    repaired: repairedFromLegacy,
  });
});

test("Upstash task adapter keeps all v1 keys when migration TTL fails", async () => {
  const commands = [];
  const legacyTask = {
    taskId: "legacy",
    status: "running",
    updatedAt: 100,
  };
  const client = {
    async command(args) {
      commands.push(args);
      if (args[0] === "HGETALL") {
        return [];
      }
      if (args[0] === "SMEMBERS") {
        return ["legacy"];
      }
      if (args[0] === "MGET") {
        return [JSON.stringify(legacyTask)];
      }
      if (args[0] === "EXPIRE") {
        throw new Error("expire failed");
      }
      return 1;
    },
  };
  const adapter = createUpstashTaskStoreAdapter({
    client,
    instanceId: "replica-failed-migrate",
    ttlSeconds: 900,
  });

  await assert.rejects(() => adapter.load(), /expire failed/);
  assert.deepEqual(
    commands.map((args) => args[0]),
    ["HGETALL", "SMEMBERS", "MGET", "HSET", "EXPIRE"]
  );
  assert.equal(commands.some((args) => args[0] === "DEL"), false);
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
