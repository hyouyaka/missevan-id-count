import test from "node:test";
import assert from "node:assert/strict";
import {
  createRenderKeepAliveService, resolveRenderKeepAliveConfig, resolveRenderKeepAliveState,
} from "./renderKeepAliveService.js";

async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

function clock() {
  let time = 0;
  let id = 0;
  const timers = new Map();
  return {
    now: () => time,
    setTimer(callback, delay) {
      const key = ++id;
      timers.set(key, { callback, at: time + delay });
      return key;
    },
    clearTimer: (key) => timers.delete(key),
    async advance(ms) {
      const target = time + ms;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        time = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
        await flush();
      }
      time = target;
      await flush();
    },
    timers,
  };
}

function setup(fetchImpl = async () => new Response(null, { status: 204 })) {
  const time = clock();
  const requests = [];
  const logs = [];
  const service = createRenderKeepAliveService({
    ...time, healthUrl: "https://proxy.test/healthz", intervalMs: 300_000, timeoutMs: 90_000,
    fetchImpl: (url, options) => {
      requests.push({ url, options, at: time.now() });
      return fetchImpl(url, options);
    },
    log: (event, fields, level) => logs.push({ event, ...fields, level }),
  });
  return { time, requests, logs, service };
}

test("configuration gates hosted Render use and validates independent timing budgets", () => {
  const input = { env: {}, hosted: true, desktop: false, missevanEnabled: true,
    renderConfigured: true, baseUrl: "https://proxy.test/missevan?ignored=1" };
  const config = resolveRenderKeepAliveConfig(input);
  assert.deepEqual(config, { enabled: true, healthUrl: "https://proxy.test/healthz",
    forceMode: "0", intervalMs: 300_000, timeoutMs: 90_000 });
  for (const override of [{ hosted: false }, { desktop: true }, { missevanEnabled: false },
    { renderConfigured: false }, { baseUrl: "invalid" }, { baseUrl: "ftp://proxy.test" },
    { baseUrl: "https://user:secret@proxy.test/missevan" },
    { env: { MISSEVAN_RENDER_KEEPALIVE_ENABLED: "false" } }]) {
    assert.equal(resolveRenderKeepAliveConfig({ ...input, ...override }).enabled, false);
  }
  for (const value of ["", "invalid", "0", "-1", "1.5"]) {
    const result = resolveRenderKeepAliveConfig({ ...input, env: {
      MISSEVAN_RENDER_KEEPALIVE_INTERVAL_MS: value, MISSEVAN_RENDER_KEEPALIVE_TIMEOUT_MS: value,
    } });
    assert.equal(result.intervalMs, 300_000);
    assert.equal(result.timeoutMs, 90_000);
  }
  assert.equal(resolveRenderKeepAliveConfig({ ...input, env: { MISSEVAN_RENDER_KEEPALIVE_INTERVAL_MS: "1" } }).intervalMs, 60_000);
  assert.equal(resolveRenderKeepAliveConfig({ ...input, env: { MISSEVAN_RENDER_KEEPALIVE_INTERVAL_MS: "900000" } }).intervalMs, 600_000);
  assert.equal(resolveRenderKeepAliveConfig({ ...input, env: { MISSEVAN_RENDER_KEEPALIVE_TIMEOUT_MS: "1" } }).timeoutMs, 1000);
  assert.equal(resolveRenderKeepAliveConfig({ ...input, env: { MISSEVAN_RENDER_KEEPALIVE_TIMEOUT_MS: "150000" } }).timeoutMs, 120_000);
  assert.deepEqual(resolveRenderKeepAliveState(config, 1000, 0), { active: true, until: 1000 });
  assert.equal(resolveRenderKeepAliveState(config, 1000, 1000).active, false);
  assert.deepEqual(resolveRenderKeepAliveState({ ...config, forceMode: "1" }, 0), { active: true, until: Infinity });
  assert.equal(resolveRenderKeepAliveState({ ...config, forceMode: "2" }, 1000, 0).active, false);
  assert.equal(resolveRenderKeepAliveState({ ...config, enabled: false, forceMode: "1" }, 0).active, false);
});

test("immediate warming, repeat sync, and periodic pings use only unauthenticated health GET", async () => {
  const { service, time, requests, logs } = setup();
  service.sync({ active: true, until: 1_200_000 });
  for (let i = 0; i < 10; i++) service.sync({ active: true, until: 1_200_000 });
  assert.equal(requests.length, 1);
  await flush();
  await time.advance(900_000);
  assert.deepEqual(requests.map(x => x.at), [0, 300_000, 600_000, 900_000]);
  assert.deepEqual(logs.map(x => x.event), ["render_keepalive_started"]);
  for (const { url, options } of requests) {
    assert.equal(url, "https://proxy.test/healthz");
    assert.equal(options.method, "GET");
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    assert.deepEqual(Object.keys(options.headers).sort(), ["Cache-Control", "Pragma"]);
  }
  await time.advance(300_000);
  assert.equal(requests.length, 4);
  assert.equal(time.timers.size, 0);
  assert.equal(logs.at(-1).reason, "cooldown_expired");
});

test("slow pings never overlap and interval starts after completion", async () => {
  let resolve;
  const { service, time, requests } = setup(() => new Promise(r => { resolve = r; }));
  service.sync({ active: true, until: 1_200_000 });
  await time.advance(50_000);
  service.sync({ active: true, until: 1_500_000 });
  assert.equal(requests.length, 1);
  resolve(new Response(null, { status: 204 }));
  await flush();
  await time.advance(299_999);
  assert.equal(requests.length, 1);
  await time.advance(1);
  assert.equal(requests.length, 2);
  service.dispose();
});

test("cooldown can be extended or shortened without another immediate request", async () => {
  const { service, time, requests, logs } = setup();
  service.sync({ active: true, until: 100_000 });
  await flush();
  await time.advance(50_000);
  service.sync({ active: true, until: 600_000 });
  await time.advance(250_000);
  assert.equal(requests.length, 2);
  service.sync({ active: true, until: 350_000 });
  await time.advance(50_000);
  assert.equal(time.timers.size, 0);
  assert.equal(logs.filter(x => x.event === "render_keepalive_started").length, 1);
  assert.equal(logs.at(-1).reason, "cooldown_expired");
});

function abortingFetch(_url, { signal }) {
  return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
}

test("early recovery and disposal abort health requests without failure logs", async () => {
  for (const action of ["recover", "dispose", "expire"]) {
    const { service, time, requests, logs } = setup(abortingFetch);
    service.sync({ active: true, until: 10_000 });
    if (action === "recover") service.sync({ active: false });
    else if (action === "dispose") service.dispose();
    else await time.advance(10_000);
    await flush();
    assert.equal(requests[0].options.signal.aborted, true);
    assert.equal(time.timers.size, 0);
    assert.equal(logs.some(x => x.event === "render_keepalive_failed"), false);
    await time.advance(1_000_000);
    assert.equal(requests.length, 1);
  }
});

test("timeout and repeated failures log once, retry normally, and log recovery", async () => {
  let mode = "timeout";
  const { service, time, requests, logs } = setup((url, options) => {
    if (mode === "timeout") return abortingFetch(url, options);
    if (mode === "http") return Promise.resolve(new Response(null, { status: 503 }));
    if (mode === "network") return Promise.reject(new Error("network unavailable"));
    return Promise.resolve(new Response(null, { status: 204 }));
  });
  service.sync({ active: true, until: Infinity });
  await time.advance(90_000);
  assert.equal(logs.at(-1).failureKind, "timeout");
  mode = "http";
  await time.advance(300_000);
  mode = "network";
  await time.advance(300_000);
  assert.equal(logs.filter(x => x.event === "render_keepalive_failed").length, 1);
  mode = "healthy";
  await time.advance(300_000);
  assert.equal(logs.at(-1).event, "render_keepalive_recovered");
  mode = "http";
  await time.advance(300_000);
  assert.equal(logs.filter(x => x.event === "render_keepalive_failed").length, 2);
  assert.equal(requests.length, 5);
  service.dispose();
  await flush();
  assert.equal(time.timers.size, 0);
});

test("stop then restart waits for an aborted request to settle", async () => {
  let reject;
  const { service, requests } = setup(() => new Promise((_, r) => { reject = r; }));
  service.sync({ active: true, until: Infinity });
  service.sync({ active: false });
  service.sync({ active: true, until: Infinity });
  assert.equal(requests.length, 1);
  reject(new Error("old request stopped"));
  await flush();
  assert.equal(requests.length, 2);
  service.dispose();
  reject(new Error("closed"));
  await flush();
});

test("disabled and disposed services never start, and rejected logging is isolated", async () => {
  let called = false;
  const disabled = createRenderKeepAliveService({ enabled: false, fetchImpl: () => { called = true; } });
  disabled.sync({ active: true });
  assert.equal(called, false);
  const { service, requests } = setup();
  service.dispose();
  service.sync({ active: true });
  assert.equal(requests.length, 0);
  const logging = createRenderKeepAliveService({ healthUrl: "https://proxy.test/healthz",
    fetchImpl: async () => new Response(null, { status: 204 }),
    log: () => Promise.reject(new Error("log unavailable")) });
  logging.sync({ active: true });
  await flush();
  logging.dispose();
});
