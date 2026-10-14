import assert from "node:assert/strict";
import test from "node:test";
import { createCvSeriesStore } from "./cvSeriesStore.js";

test("series cache merges reads, expires independently and retains valid data on failure", async () => {
  let reads = 0;
  let updates = 0;
  const errors = [];
  const store = createCvSeriesStore({
    ttlMs: 100,
    readSnapshot: async () => {
      reads += 1;
      if (reads === 2) throw new Error("offline");
      return { sample: { platform: "猫耳", "series title": `系列${reads}`, dramaIds: ["1", "2"] } };
    },
    onUpdate: () => { updates += 1; },
    onError: (error) => errors.push(error),
  });
  const [first, concurrent] = await Promise.all([store.read({ now: 0 }), store.read({ now: 0 })]);
  assert.equal(reads, 1);
  assert.equal(first, concurrent);
  assert.equal(await store.read({ now: 99 }), first);
  assert.equal(await store.read({ now: 100 }), first);
  assert.equal(errors.length, 1);
  assert.equal(updates, 1);
  await store.read({ now: 101 });
  assert.equal(reads, 2);
  const next = await store.read({ force: true, now: 101 });
  assert.equal(next.get("missevan:1").seriesTitle, "系列3");
  assert.equal(updates, 2);
});

test("initial missing or malformed series data falls back to standalone works", async () => {
  for (const snapshot of [null, []]) {
    let failures = 0;
    const store = createCvSeriesStore({ readSnapshot: async () => snapshot, ttlMs: 100, onError: () => { failures += 1; } });
    assert.equal((await store.read()).size, 0);
    assert.equal(failures, 1);
  }
});
