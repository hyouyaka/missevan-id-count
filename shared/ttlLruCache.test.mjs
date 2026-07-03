import assert from "node:assert/strict";
import test from "node:test";
import { TtlLruCache } from "./ttlLruCache.js";

test("TTL LRU promotes hits and evicts the least recently used entry", () => {
  let now = 0;
  const cache = new TtlLruCache({
    maxEntries: 2,
    ttlMs: 100,
    now: () => now,
  });

  cache.set("first", 1);
  now = 1;
  cache.set("second", 2);
  assert.equal(cache.get("first"), 1);
  cache.set("third", 3);

  assert.equal(cache.get("second"), undefined);
  assert.equal(cache.get("first"), 1);
  assert.equal(cache.get("third"), 3);
});

test("TTL LRU removes expired entries on reads and writes", () => {
  let now = 0;
  const cache = new TtlLruCache({
    maxEntries: 2,
    ttlMs: 10,
    now: () => now,
  });

  cache.set("expired", "old");
  now = 11;
  assert.equal(cache.get("expired"), undefined);

  cache.set("fresh", "new");
  assert.equal(cache.size, 1);
  assert.equal(cache.get("fresh"), "new");
});

test("TTL LRU overwrites existing keys without evicting another entry", () => {
  const cache = new TtlLruCache({ maxEntries: 2 });
  cache.set("first", 1);
  cache.set("second", 2);
  cache.set("first", 3);

  assert.equal(cache.size, 2);
  assert.equal(cache.get("first"), 3);
  assert.equal(cache.get("second"), 2);
});

test("TTL LRU with zero capacity does not retain values", () => {
  const cache = new TtlLruCache({ maxEntries: 0 });
  cache.set("value", 1);

  assert.equal(cache.size, 0);
  assert.equal(cache.get("value"), undefined);
});

test("TTL LRU exposes live values for Map-compatible cache scans", () => {
  let now = 0;
  const cache = new TtlLruCache({
    maxEntries: 3,
    ttlMs: 10,
    now: () => now,
  });
  cache.set("expired", 1);
  now = 11;
  cache.set("fresh", 2);

  assert.deepEqual(Array.from(cache.values()), [2]);
});
