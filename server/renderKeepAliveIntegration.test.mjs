import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

test("hosted startup restores cooldown without waiting for health, refresh stops it, close cleans up", async () => {
  const script = `
    import assert from "node:assert/strict";
    const realFetch = globalThis.fetch;
    const commands = [];
    const healthSignals = [];
    const events = [];
    let cooldownUntil = Date.now() + 60_000;
    console.log = console.error = line => {
      try { events.push(JSON.parse(line).event); } catch {}
    };
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.startsWith("http://127.0.0.1:")) return realFetch(url, options);
      if (target === "https://proxy.test/healthz") {
        assert.equal(options.headers["x-proxy-token"], undefined);
        healthSignals.push(options.signal);
        return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new Error("stopped")), { once: true }));
      }
      assert.equal(target, "https://redis.test");
      const parts = JSON.parse(options.body);
      commands.push(parts);
      if (parts[0] === "GET" && parts[1] === "missevan:cooldown:v1") {
        return Response.json({ result: JSON.stringify({ accessDeniedUntil: cooldownUntil }) });
      }
      if (parts[0] === "MGET") return Response.json({ result: parts.slice(1).map(() => null) });
      if (parts[0] === "HGETALL" || parts[0] === "SMEMBERS") return Response.json({ result: [] });
      return Response.json({ result: "OK" });
    };
    const { startServer } = await import("./server/application.js");
    let server = await startServer(0, { host: "127.0.0.1" });
    await new Promise(r => setImmediate(r));
    assert.equal(healthSignals.length, 1);
    assert.equal(healthSignals[0].aborted, false);
    assert.equal(commands.filter(x => x[0] === "GET" && x[1] === "missevan:cooldown:v1").length, 1);
    assert.equal(commands.filter(x => x[0] === "SET" && x[1] === "missevan:cooldown:v1").length, 1);
    cooldownUntil = 0;
    const response = await realFetch("http://127.0.0.1:" + server.address().port + "/getdramas", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ drama_ids: [] }),
    });
    assert.equal(response.status, 200);
    await response.arrayBuffer();
    await new Promise(r => setImmediate(r));
    assert.equal(healthSignals[0].aborted, true);
    assert.equal(events.includes("render_keepalive_failed"), false);
    assert.equal(commands.filter(x => x[0] === "GET" && x[1] === "missevan:cooldown:v1").length, 2);
    assert.equal(commands.filter(x => x[0] === "SET" && x[1] === "missevan:cooldown:v1").length, 1);
    await new Promise(r => server.close(r));
    cooldownUntil = Date.now() + 60_000;
    server = await startServer(0, { host: "127.0.0.1" });
    assert.equal(healthSignals.length, 2);
    await new Promise(r => server.close(r));
    await new Promise(r => setImmediate(r));
    assert.equal(healthSignals[1].aborted, true);
    assert.equal(events.filter(x => x === "render_keepalive_started").length, 2);
    assert.equal(events.filter(x => x === "render_keepalive_stopped").length, 2);
    process.stdout.write("verified");
  `;
  const { stdout } = await execute(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(), timeout: 15_000,
    env: {
      ...process.env, NODE_TEST_CONTEXT: "child-v8", START_SERVER_ON_IMPORT: "false",
      DESKTOP_APP: "false", ENABLE_MISSEVAN: "true", RAILWAY_ENVIRONMENT: "test",
      UPSTASH_REDIS_REST_URL: "https://redis.test", UPSTASH_REDIS_REST_TOKEN: "test",
      MISSEVAN_COOLDOWN_KEY: "missevan:cooldown:v1", MISSEVAN_PERSISTENT_COOLDOWN: "true",
      MISSEVAN_FALLBACK_BASE_URL: "https://proxy.test/missevan", MISSEVAN_FALLBACK_PROXY_TOKEN: "test",
      MISSEVAN_FORCE_FALLBACK: "0", MISSEVAN_RENDER_KEEPALIVE_ENABLED: "true",
    },
  });
  assert.equal(stdout, "verified");
});
