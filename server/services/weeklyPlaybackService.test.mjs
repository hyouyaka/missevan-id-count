import assert from "node:assert/strict";
import test from "node:test";
import { createWeeklyPlaybackStore } from "./weeklyPlaybackService.js";

test("weekly playback store reads one index and one batch of snapshots, then serves the cache", async () => {
  const calls = [];
  let now = 1000;
  const store = createWeeklyPlaybackStore({
    now: () => now,
    cacheTtlMs: 300000,
    command: async (args) => {
      calls.push(args);
      if (args[0] === "GET") {
        return JSON.stringify({
          version: 1,
          platform: "missevan",
          granularity: "weekly",
          dates: ["2026-05-03", "2026-05-10"],
        });
      }
      if (args[0] === "MGET") {
        return args.slice(1).map((key) => JSON.stringify({
          date: key.endsWith("05-03") ? "2026-05-03" : "2026-05-10",
          dramas: { "93038": { view_count: key.endsWith("05-03") ? 100 : 110 } },
        }));
      }
      throw new Error(`Unexpected command: ${args[0]}`);
    },
  });

  const first = await store.getSnapshot("missevan");
  const second = await store.getSnapshot("missevan");

  assert.equal(first, second);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], ["GET", "missevan:watchcount:index"]);
  assert.equal(calls[1][0], "MGET");
  assert.deepEqual(first.dates, ["2026-05-03", "2026-05-10"]);
  assert.equal(first.snapshotsByDate["2026-05-10"].dramas["93038"].view_count, 110);
  now += 300001;
  await store.getSnapshot("missevan");
  assert.equal(calls.length, 4);
});

test("weekly playback store reads requested drama history with one HMGET", async () => {
  const calls = [];
  const store = createWeeklyPlaybackStore({
    command: async (args) => {
      calls.push(args);
      if (args[0] === "HMGET") {
        return [JSON.stringify({
          name: "测试剧",
          points: [["2026-06-19", 100], ["2026-06-26", 125]],
        })];
      }
      throw new Error(`Unexpected command: ${args[0]}`);
    },
  });

  const bundle = await store.getSnapshot("missevan", { ids: ["93038"] });
  const cached = await store.getSnapshot("missevan", { ids: ["93038"] });

  assert.equal(cached, bundle);
  assert.deepEqual(calls, [["HMGET", "missevan:watchcount:history", "93038"]]);
  assert.equal(bundle.source, "watchcount_history");
  assert.equal(bundle.snapshotsByDate["2026-06-26"].dramas["93038"].view_count, 125);
});

test("weekly playback history-only reads do not fall back when the hash has no record", async () => {
  const calls = [];
  const store = createWeeklyPlaybackStore({
    command: async (args) => {
      calls.push(args);
      if (args[0] === "HMGET") {
        return [null];
      }
      throw new Error(`Unexpected fallback command: ${args[0]}`);
    },
  });

  const bundle = await store.getSnapshot("missevan", {
    ids: ["93038"],
    historyOnly: true,
  });
  const cachedBundle = await store.getSnapshot("missevan", {
    ids: ["93038"],
    historyOnly: true,
  });

  assert.equal(bundle, null);
  assert.equal(cachedBundle, null);
  assert.deepEqual(calls, [["HMGET", "missevan:watchcount:history", "93038"]]);
});

test("weekly playback history-only cache stays isolated from ordinary snapshot fallback", async () => {
  const calls = [];
  const store = createWeeklyPlaybackStore({
    command: async (args) => {
      calls.push(args);
      if (args[0] === "HMGET") {
        return [null];
      }
      if (args[0] === "GET") {
        return JSON.stringify({
          platform: "missevan",
          granularity: "weekly",
          dates: ["2026-05-10"],
        });
      }
      if (args[0] === "MGET") {
        return [JSON.stringify({
          date: "2026-05-10",
          dramas: { "93038": { view_count: 110 } },
        })];
      }
      throw new Error(`Unexpected command: ${args[0]}`);
    },
  });

  const historyOnly = await store.getSnapshot("missevan", {
    ids: ["93038"],
    historyOnly: true,
  });
  const ordinary = await store.getSnapshot("missevan", { ids: ["93038"] });

  assert.equal(historyOnly, null);
  assert.equal(ordinary.snapshotsByDate["2026-05-10"].dramas["93038"].view_count, 110);
  assert.deepEqual(calls.map(([command]) => command), ["HMGET", "GET", "MGET"]);
});

test("weekly playback history version changes when same-date values are corrected", async () => {
  let latestValue = 125;
  const store = createWeeklyPlaybackStore({
    command: async () => [JSON.stringify({
      name: "测试剧",
      points: [["2026-06-19", 100], ["2026-06-26", latestValue]],
    })],
  });

  const initial = await store.getSnapshot("missevan", { ids: ["93038"] });
  latestValue = 130;
  const corrected = await store.getSnapshot("missevan", { ids: ["93038"], force: true });

  assert.notEqual(corrected.version, initial.version);
  assert.equal(corrected.dates.at(-1), initial.dates.at(-1));
  assert.equal(corrected.snapshotsByDate["2026-06-26"].dramas["93038"].view_count, 130);
});

test("weekly playback store keeps partial history hits without downloading legacy snapshots", async () => {
  const calls = [];
  const store = createWeeklyPlaybackStore({
    command: async (args) => {
      calls.push(args);
      if (args[0] === "HMGET") {
        return [
          JSON.stringify({ name: "一屋暗灯", points: [["2026-05-10", 100], ["2026-05-17", 120]] }),
          null,
        ];
      }
      throw new Error(`Unexpected command: ${args.join(" ")}`);
    },
  });

  const bundle = await store.getSnapshot("missevan", { ids: ["93038", "94789"] });

  assert.deepEqual(calls, [["HMGET", "missevan:watchcount:history", "93038", "94789"]]);
  assert.equal(bundle.snapshotsByDate["2026-05-17"].dramas["93038"].view_count, 120);
  assert.equal(bundle.snapshotsByDate["2026-05-17"].dramas["94789"], undefined);
});

test("weekly playback store merges concurrent forced reads for the same ids", async () => {
  let callCount = 0;
  let resolveHistory;
  const historyPromise = new Promise((resolve) => {
    resolveHistory = resolve;
  });
  const store = createWeeklyPlaybackStore({
    command: async () => {
      callCount += 1;
      return historyPromise;
    },
  });

  const first = store.getSnapshot("missevan", { ids: ["93038"], force: true });
  const second = store.getSnapshot("missevan", { ids: ["93038"], force: true });
  resolveHistory([
    JSON.stringify({ name: "一屋暗灯", points: [["2026-05-10", 100], ["2026-05-17", 120]] }),
  ]);

  const [firstBundle, secondBundle] = await Promise.all([first, second]);
  assert.equal(callCount, 1);
  assert.equal(firstBundle, secondBundle);
});

test("weekly playback store reuses each drama history across overlapping batches", async () => {
  const calls = [];
  let resolveFirst;
  const firstHistory = new Promise((resolve) => {
    resolveFirst = resolve;
  });
  const store = createWeeklyPlaybackStore({
    command: async (args) => {
      calls.push(args);
      if (args[0] !== "HMGET") {
        throw new Error(`Unexpected command: ${args[0]}`);
      }
      if (args.includes("93038")) {
        return firstHistory;
      }
      return [
        JSON.stringify({ name: "剧 C", points: [["2026-05-10", 300], ["2026-05-17", 330]] }),
      ];
    },
  });

  const first = store.getSnapshot("missevan", { ids: ["93038", "94789"] });
  const second = store.getSnapshot("missevan", { ids: ["94789", "94893"] });
  resolveFirst([
    JSON.stringify({ name: "剧 A", points: [["2026-05-10", 100], ["2026-05-17", 120]] }),
    JSON.stringify({ name: "剧 B", points: [["2026-05-10", 200], ["2026-05-17", 220]] }),
  ]);

  const [firstBundle, secondBundle] = await Promise.all([first, second]);
  assert.deepEqual(calls, [
    ["HMGET", "missevan:watchcount:history", "93038", "94789"],
    ["HMGET", "missevan:watchcount:history", "94893"],
  ]);
  assert.equal(firstBundle.snapshotsByDate["2026-05-17"].dramas["94789"].view_count, 220);
  assert.equal(secondBundle.snapshotsByDate["2026-05-17"].dramas["94789"].view_count, 220);
  assert.equal(secondBundle.snapshotsByDate["2026-05-17"].dramas["94893"].view_count, 330);

  await store.getSnapshot("missevan", { ids: ["93038", "94893"] });
  assert.equal(calls.length, 2);
});

test("weekly playback store bounds completed caches without dropping an oversized batch", async () => {
  const calls = [];
  const store = createWeeklyPlaybackStore({
    cacheMaxEntries: 2,
    command: async (args) => {
      calls.push(args);
      if (args[0] !== "HMGET") {
        throw new Error(`Unexpected command: ${args[0]}`);
      }
      return args.slice(2).map((id, index) => JSON.stringify({
        name: `剧 ${id}`,
        points: [["2026-05-10", 100 + index], ["2026-05-17", 120 + index]],
      }));
    },
  });
  const ids = ["93038", "94789", "94893"];

  const batch = await store.getSnapshot("missevan", { ids });

  ids.forEach((id) => {
    assert.ok(batch.snapshotsByDate["2026-05-17"].dramas[id]);
  });
  assert.ok(Object.keys(store.getCacheSnapshot()).length <= 2);

  await store.getSnapshot("missevan", { ids: ["93038"] });
  assert.equal(calls.length, 2, "the oldest per-id history should be evicted at capacity");
  assert.ok(Object.keys(store.getCacheSnapshot()).length <= 2);
});

test("weekly playback store scans legacy daily keys when the weekly index is absent", async () => {
  const calls = [];
  const store = createWeeklyPlaybackStore({
    command: async (args) => {
      calls.push(args);
      if (args[0] === "GET") {
        return null;
      }
      if (args[0] === "SCAN") {
        return ["0", [
          "missevan:watchcount:2026-05-01",
          "missevan:watchcount:2026-05-08",
          "missevan:watchcount:metadata",
        ]];
      }
      if (args[0] === "MGET") {
        return [
          JSON.stringify({ dramas: { "93038": { watch_count: 90 } } }),
          JSON.stringify({ dramas: { "93038": { watch_count: 95 } } }),
        ];
      }
      throw new Error(`Unexpected command: ${args[0]}`);
    },
  });

  const bundle = await store.getSnapshot("missevan");
  const cachedBundle = await store.getSnapshot("missevan");

  assert.equal(cachedBundle, bundle);
  assert.deepEqual(bundle.dates, ["2026-05-01", "2026-05-08"]);
  assert.equal(bundle.source, "watchcount_scan");
  assert.equal(bundle.snapshotsByDate["2026-05-08"].dramas["93038"].view_count, 95);
  assert.equal(calls.filter(([command]) => command === "SCAN").length, 1);
  assert.equal(calls.at(-1)[0], "MGET");
});
