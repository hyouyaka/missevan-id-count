import assert from "node:assert/strict";
import test from "node:test";
import { createWeeklyPlaybackStore } from "./weeklyPlaybackService.js";

test("weekly playback store requires requested drama ids without reading Upstash", async () => {
  const calls = [];
  const store = createWeeklyPlaybackStore({
    command: async (args) => {
      calls.push(args);
      throw new Error(`Unexpected command: ${args.join(" ")}`);
    },
  });

  assert.equal(await store.getSnapshot("missevan"), null);
  assert.equal(await store.getSnapshot("missevan", { ids: [] }), null);
  assert.deepEqual(calls, []);
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

test("weekly playback reads do not fall back when the history hash has no record", async () => {
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

  const bundle = await store.getSnapshot("missevan", { ids: ["93038"] });
  const cachedBundle = await store.getSnapshot("missevan", { ids: ["93038"] });

  assert.equal(bundle, null);
  assert.equal(cachedBundle, null);
  assert.deepEqual(calls, [["HMGET", "missevan:watchcount:history", "93038"]]);
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
