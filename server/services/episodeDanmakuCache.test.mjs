import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { TtlLruCache } from "../../shared/ttlLruCache.js";
import { createEpisodeDanmakuCache } from "./episodeDanmakuCache.js";

function fixture(maxEntries = 100) {
  let time = 0;
  const cache = new TtlLruCache({ maxEntries, ttlMs: 15 * 60 * 1000, now: () => time });
  const service = createEpisodeDanmakuCache({ cache, now: () => time });
  const logs = [];
  let calls = 0;
  const load = async () => {
    calls++;
    return { success: true, sound_id: "1", danmaku: 0, users: [], drama_title: "first caller", source: "first task" };
  };
  return { cache, service, logs, load, advance: (ms) => { time += ms; }, calls: () => calls,
    get: (id, overrides = {}) => service.get(id, { load, log: (fields) => logs.push(fields), ...overrides }) };
}

test("successful zero results are retained, hits do not renew TTL, and expiry refetches", async () => {
  const f = fixture();
  const fresh = await f.get("1");
  assert.equal(fresh.cached, false);
  assert.equal(fresh.fetchedAt, "1970-01-01T00:00:00.000Z");
  assert.equal(fresh.drama_title, undefined);
  assert.equal(fresh.source, undefined);
  f.advance(14 * 60 * 1000);
  const hit = await f.get("1");
  assert.equal(hit.cached, true);
  assert.equal(hit.fetchedAt, fresh.fetchedAt);
  assert.equal(f.logs.at(-1).cacheAgeMs, 14 * 60 * 1000);
  f.advance(60 * 1000);
  assert.equal((await f.get("1")).cached, false);
  assert.equal(f.calls(), 2);
  f.advance(15 * 60 * 1000);
  f.cache.pruneExpired();
  assert.equal(f.cache.size, 0);
});

test("platform caches independently retain 100 entries and evict the least recently used", async () => {
  const a = fixture(), b = fixture();
  for (let i = 0; i < 100; i++) { await a.get(i); await b.get(i); }
  await a.get(0);
  await a.get(100);
  assert.equal(a.cache.size, 100);
  assert.equal(b.cache.size, 100);
  assert.equal(a.cache.has("1"), false);
  assert.equal(b.cache.has("1"), true);
  const disabled = fixture(0);
  await disabled.get(1); await disabled.get(1);
  assert.equal(disabled.cache.size, 0);
  assert.equal(disabled.calls(), 2);
});

test("concurrent waiters share a fetch and retain independent logs and cancellation", async () => {
  const f = fixture();
  let resolve;
  let calls = 0;
  let underlying;
  const load = (signal, report) => {
    calls++;
    underlying = signal;
    report({ source: "owner", dramaTitle: "owner", totalPages: 2 });
    return new Promise((done) => { resolve = done; });
  };
  const controller = new AbortController();
  const first = f.get("1", { load, signal: controller.signal });
  const second = f.get("1", { load });
  const third = f.get("1", { load });
  controller.abort();
  await assert.rejects(first, { name: "AbortError" });
  assert.equal(underlying.aborted, false);
  resolve({ success: true, danmaku: 2, users: ["same", "other"] });
  const [r2, r3] = await Promise.all([second, third]);
  assert.equal(calls, 1);
  assert.equal(r2.cached, false);
  assert.deepEqual(r3.users, ["same", "other"]);
  assert.equal(f.logs.length, 3);
  assert.equal(f.logs.filter((l) => l.sharedWait).length, 2);
  assert.ok(f.logs.every((l) => !l.source && !l.dramaTitle && !l.users));
  assert.equal((await f.get("1")).cached, true);
});

test("all waiters cancelling aborts the load and never populates cache", async () => {
  const f = fixture();
  const controller = new AbortController();
  let underlying;
  const wait = f.get("1", { signal: controller.signal, load: (signal) => {
    underlying = signal;
    return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  } });
  controller.abort();
  await assert.rejects(wait, { name: "AbortError" });
  assert.equal(underlying.aborted, true);
  assert.equal(f.cache.size, 0);
  assert.equal((await f.get("1")).success, true);
});

test("418, timeout, cancellation and thrown failures are never cached and can retry", async () => {
  for (const failure of [
    { success: false, accessDenied: true, error: "HTTP 418" },
    { success: false, error: "timeout" },
    { success: false, cancelled: true },
  ]) {
    const f = fixture();
    await f.get("1", { load: async () => failure });
    assert.equal(f.cache.size, 0);
    assert.equal((await f.get("1")).success, true);
  }
  const f = fixture();
  await assert.rejects(f.get("1", { load: async () => { throw new Error("network"); } }), /network/);
  assert.equal(f.cache.size, 0);
  assert.equal((await f.get("1")).success, true);
});

test("the production cache writer preserves default capacity and respects an explicit zero", () => {
  const source = readFileSync(new URL("../application.js", import.meta.url), "utf8");
  const start = source.indexOf("function setCachedValue(");
  const end = source.indexOf("\n}", start) + 2;
  const write = runInNewContext(`(${source.slice(start, end)})`);
  const cache = new TtlLruCache({ maxEntries: 2 });
  write(cache, "drama", { title: "one" });
  write(cache, "sound", { view_count: 42 });
  assert.equal(cache.size, 2);
  assert.equal(cache.get("sound").value.view_count, 42);
  write(cache, "reward", { reward: 5 }, 1);
  assert.equal(cache.size, 1);
  write(cache, "disabled", {}, 0);
  assert.equal(cache.size, 0);
});
