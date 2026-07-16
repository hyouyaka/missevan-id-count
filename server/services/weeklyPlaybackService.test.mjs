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
  assert.equal(calls[0][0], "GET");
  assert.equal(calls[1][0], "MGET");
  assert.deepEqual(first.dates, ["2026-05-03", "2026-05-10"]);
  assert.equal(first.snapshotsByDate["2026-05-10"].dramas["93038"].view_count, 110);
  now += 300001;
  await store.getSnapshot("missevan");
  assert.equal(calls.length, 4);
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
