import assert from "node:assert/strict";
import test from "node:test";

import { createSharedRequestRegistry } from "./sharedRequest.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

test("cancelling one waiter does not abort a request shared with another waiter", async () => {
  const registry = createSharedRequestRegistry();
  const result = deferred();
  const first = new AbortController();
  const second = new AbortController();
  let sharedSignal;
  let factoryCalls = 0;
  const factory = (signal) => {
    factoryCalls += 1;
    sharedSignal = signal;
    return result.promise;
  };

  const firstWait = registry.run("set-1", first.signal, factory);
  const secondWait = registry.run("set-1", second.signal, factory);
  first.abort();

  await assert.rejects(firstWait, (error) => error?.name === "AbortError");
  assert.equal(sharedSignal.aborted, false);
  result.resolve({ success: true });
  assert.deepEqual(await secondWait, { success: true });
  assert.equal(factoryCalls, 1);
});

test("cancelling the only waiter aborts the underlying shared request", async () => {
  const registry = createSharedRequestRegistry();
  const caller = new AbortController();
  let sharedSignal;
  const wait = registry.run("set-2", caller.signal, (signal) => {
    sharedSignal = signal;
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });

  caller.abort();

  await assert.rejects(wait, (error) => error?.name === "AbortError");
  assert.equal(sharedSignal.aborted, true);
});

test("a new waiter starts a fresh request after the previous only waiter cancels", async () => {
  const registry = createSharedRequestRegistry();
  const first = new AbortController();
  let firstFactoryCalls = 0;
  let secondFactoryCalls = 0;
  const firstWait = registry.run("set-3", first.signal, (signal) => {
    firstFactoryCalls += 1;
    return new Promise((resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => setTimeout(() => reject(signal.reason), 10),
        { once: true }
      );
    });
  });

  first.abort();
  await assert.rejects(firstWait, (error) => error?.name === "AbortError");
  const secondResult = await registry.run("set-3", undefined, async () => {
    secondFactoryCalls += 1;
    return "fresh";
  });

  assert.equal(secondResult, "fresh");
  assert.equal(firstFactoryCalls, 1);
  assert.equal(secondFactoryCalls, 1);
});
