import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createCategoryFileSink, createLogger, createLogPayload } from "./logger.js";
import { createWebsiteLogPolicy } from "./websiteLogPolicy.js";

function entry(event, fields = {}) {
  return { category: "operation", level: "info", event, durationMs: 10, ...fields };
}

test("the production datastore reader marks resolved null as success and rejected reads as failures", async () => {
  const source = readFileSync(new URL("./application.js", import.meta.url), "utf8");
  const start = source.indexOf("async function readUpstashData(");
  const end = source.indexOf("\n}", start) + 2;
  for (const reject of [false, true]) {
    const logs = [];
    const failure = new Error("upstream rejected");
    const reader = runInNewContext(`(${source.slice(start, end)})`, {
      upstashClient: { command: async () => { if (reject) throw failure; return null; } },
      getStructuredReadBytes: () => 0,
      logger: { info: (_event, fields) => logs.push(fields) },
    });
    if (reject) await assert.rejects(reader(["GET", "key"], { source: "test", key: "key" }), /upstream rejected/);
    else assert.equal(await reader(["GET", "key"], { source: "test", key: "key" }), null);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].success, !reject);
    assert.equal(logs[0].bytes, 0);
  }
});

test("protected payloads retain their exact object, full results and errors before every reduction rule", () => {
  const policy = createWebsiteLogPolicy({ sampleRate: 0 });
  for (const event of ["http_request_completed", "image_proxy_fetch", "datastore_read", "external_request_attempt"]) {
    for (const category of ["user_action", "task_summary", "operation"]) {
      const payload = createLogPayload({ event, category,
        level: category === "operation" ? "error" : "warn",
        fields: { operation: "danmaku_summary", operationId: "op", source: "favorite", keyword: "作品", durationMs: 1,
          result: { episodes: Array.from({ length: 100 }, (_,id) => ({ id, text: "x".repeat(600) })) } },
        error: new Error("original failure"),
      });
      assert.strictEqual(policy(payload), payload);
      if (category === "task_summary") assert.equal(payload.result.episodes.length, 100);
    }
  }
});

test("HTTP sampling has exact boundaries while errors and slow requests never sample", () => {
  const ordinary = entry("http_request_completed", { httpStatus: 200 });
  assert.strictEqual(createWebsiteLogPolicy({ sampleRate: 0.01, random: () => 0.009 })(ordinary), ordinary);
  assert.equal(createWebsiteLogPolicy({ sampleRate: 0.01, random: () => 0.01 })(ordinary), null);
  const noSample = createWebsiteLogPolicy({ sampleRate: 0, random: () => { throw new Error("unexpected sampling"); } });
  assert.equal(noSample(ordinary), null);
  for (const fields of [{ httpStatus: 400 }, { httpStatus: 500 }, { durationMs: 5000 }, { durationMs: null }, { httpStatus: null }]) {
    const payload = { ...ordinary, ...fields };
    assert.strictEqual(noSample(payload), payload);
  }
  assert.strictEqual(createWebsiteLogPolicy({ sampleRate: 1 })(ordinary), ordinary);
});

test("invalid configuration falls back and valid custom thresholds apply", () => {
  for (const invalid of ["", " ", "bad", -1, 2, Infinity]) {
    const policy = createWebsiteLogPolicy({ sampleRate: invalid, slowMs: "invalid", random: () => 0.02 });
    assert.equal(policy(entry("http_request_completed", { httpStatus: 200 })), null);
    const slow = entry("http_request_completed", { httpStatus: 200, durationMs: 5000 });
    assert.strictEqual(policy(slow), slow);
  }
  for (const invalid of [0, -1, "", "bad", Infinity]) {
    const policy = createWebsiteLogPolicy({ sampleRate: 0, slowMs: invalid });
    assert.equal(policy(entry("http_request_completed", { httpStatus: 200, durationMs: 4999 })), null);
  }
  const custom = createWebsiteLogPolicy({ sampleRate: "0", slowMs: "100" });
  const payload = entry("http_request_completed", { httpStatus: 304, durationMs: 100 });
  assert.strictEqual(custom(payload), payload);
});

test("normal image and datastore operations shrink but retries, failures, fallback and missing markers remain", () => {
  const policy = createWebsiteLogPolicy();
  assert.equal(policy(entry("image_proxy_fetch", { success: true, attempts: 1 })), null);
  assert.equal(policy(entry("datastore_read", { success: true, fallbackReason: "" })), null);
  for (const payload of [
    entry("image_proxy_fetch", { success: false, attempts: 1 }),
    entry("image_proxy_fetch", { success: true, attempts: 2 }),
    entry("image_proxy_fetch", { success: true, attempts: 1, durationMs: 5000 }),
    entry("datastore_read", { success: false }),
    entry("datastore_read"),
    entry("datastore_read", { success: true, fallbackReason: "legacy" }),
    entry("datastore_read", { success: true, fallbackUsed: true }),
    entry("datastore_read", { success: true, durationMs: 5000 }),
    entry("image_proxy_fetch", { success: true, attempts: 1, level: "warn" }),
    entry("unknown_event"), entry("security_request_rejected", { level: "warn" }),
  ]) assert.strictEqual(policy(payload), payload);
});

test("only duplicated danmaku attempt records shrink; summaries and other attempts remain", () => {
  const policy = createWebsiteLogPolicy();
  for (const level of ["info", "warn"]) {
    assert.equal(policy(entry("external_request_attempt", { operation: "danmaku_summary", level })), null);
  }
  for (const payload of [
    entry("external_request_attempt", { operation: "danmaku_summary", level: "error" }),
    entry("external_request_attempt", { operation: "other", level: "warn" }),
    entry("external_request_attempt", { level: "warn" }),
    ...["info", "warn", "error"].map((level) => entry("danmaku_summary", { level, cached: true, sharedWait: true,
      fetchedAt: "2026-10-03T00:00:00.000Z", cacheAgeMs: 1000, cacheEntries: 100,
      attempts: [{ httpStatus: 418, fallbackUsed: true }, { outcome: "cancelled" }] })),
  ]) assert.strictEqual(policy(payload), payload);
});

test("one website policy controls both console and file sinks without altering generic loggers", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mm-log-policy-"));
  const originalLog = console.log, originalError = console.error;
  const output = [];
  console.log = (line) => output.push(JSON.parse(line));
  console.error = (line) => output.push(JSON.parse(line));
  try {
    const logger = createLogger({}, { sink: createCategoryFileSink({ logsDir: directory }),
      filterPayload: createWebsiteLogPolicy({ sampleRate: 0 }) });
    await logger.info("http_request_completed", { httpStatus: 200, durationMs: 1 });
    await logger.info("image_proxy_fetch", { success: true, attempts: 1, durationMs: 1 });
    await logger.info("datastore_read", { success: true, durationMs: 1 });
    assert.equal(output.length, 0);
    await logger.info("danmaku_summary", { cached: true, fetchedAt: "stamp" });
    await logger.error("http_request_completed", new Error("protected"), { httpStatus: 500 });
    await logger.userAction("search", { keyword: "作品" });
    await logger.taskSummary("stats_task_finished", { result: { users: 10 } });
    const operations = (await fs.readFile(path.join(directory, "operations.log"), "utf8")).trim().split("\n").map(JSON.parse);
    const usage = (await fs.readFile(path.join(directory, "usage.log"), "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual([...operations, ...usage], output);
    await createLogger().info("http_request_completed", { httpStatus: 200, durationMs: 1 });
    assert.equal(output.length, 5);
  } finally {
    console.log = originalLog;
    console.error = originalError;
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`));
    assert.ok(path.basename(resolved).startsWith("mm-log-policy-"));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});
