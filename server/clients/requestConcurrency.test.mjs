import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import test from "node:test";

import {
  createRequestConcurrencyGate,
  normalizeRequestConcurrency,
} from "./requestConcurrency.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}

test("request concurrency normalization clamps unsafe values", () => {
  assert.equal(normalizeRequestConcurrency(undefined, 32), 32);
  assert.equal(normalizeRequestConcurrency("", 32), 32);
  assert.equal(normalizeRequestConcurrency(0, 32), 1);
  assert.equal(normalizeRequestConcurrency(100, 32), 64);
  assert.equal(normalizeRequestConcurrency("12.9", 32), 12);
});

test("request concurrency gate caps work across three task groups", async () => {
  const gate = createRequestConcurrencyGate(32);
  let active = 0;
  let peak = 0;
  const started = [];
  const release = deferred();
  const jobs = Array.from({ length: 3 }, (_, groupIndex) =>
    Array.from({ length: 40 }, (_, itemIndex) => groupIndex * 40 + itemIndex)
  ).flat().map((index) => gate.run(undefined, async () => {
    active += 1;
    peak = Math.max(peak, active);
    started.push(index);
    await release.promise;
    active -= 1;
    return index;
  }));

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(gate.getState(), { activeCount: 32, concurrency: 32, queuedCount: 88 });
  release.resolve();

  assert.deepEqual(await Promise.all(jobs), Array.from({ length: 120 }, (_, index) => index));
  assert.deepEqual(started, Array.from({ length: 120 }, (_, index) => index));
  assert.equal(peak, 32);
  assert.deepEqual(gate.getState(), { activeCount: 0, concurrency: 32, queuedCount: 0 });
});

test("request concurrency gate removes an aborted queued request", async () => {
  const gate = createRequestConcurrencyGate(1);
  const release = deferred();
  const active = gate.run(undefined, () => release.promise);
  const controller = new AbortController();
  let queuedFactoryCalls = 0;
  const queued = gate.run(controller.signal, () => {
    queuedFactoryCalls += 1;
  });

  controller.abort();
  await assert.rejects(queued, (error) => error?.name === "AbortError");
  assert.equal(queuedFactoryCalls, 0);
  assert.equal(gate.getState().queuedCount, 0);
  release.resolve("done");
  assert.equal(await active, "done");
});

test("request concurrency gate releases slots after failures", async () => {
  const gate = createRequestConcurrencyGate(1);
  const planned = new Error("planned failure");
  const failed = gate.run(undefined, async () => {
    throw planned;
  });
  const next = gate.run(undefined, async () => "recovered");

  await assert.rejects(failed, planned);
  assert.equal(await next, "recovered");
  assert.equal(gate.getState().activeCount, 0);
});

test("request concurrency gate preserves queued async-local log context", async () => {
  const storage = new AsyncLocalStorage();
  const gate = createRequestConcurrencyGate(1);
  const release = deferred();
  const seen = [];
  const first = storage.run("first", () => gate.run(undefined, async () => {
    seen.push(storage.getStore());
    await release.promise;
  }));
  const second = storage.run("second", () => gate.run(undefined, async () => {
    seen.push(storage.getStore());
  }));

  release.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(seen, ["first", "second"]);
});
