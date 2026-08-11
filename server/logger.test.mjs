import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createCategoryFileSink,
  createLogger,
  runWithLogContext,
} from "./logger.js";

test("logger emits stable JSON fields and redacts sensitive values", () => {
  const originalLog = console.log;
  const lines = [];
  console.log = (line) => lines.push(line);
  try {
    createLogger({ service: "test" }).info("sample", {
      requestId: "req-1",
      token: "secret-value",
      route: "/health",
      status: 200,
    });
  } finally {
    console.log = originalLog;
  }

  assert.equal(lines.length, 1);
  const payload = JSON.parse(lines[0]);
  assert.equal(payload.event, "sample");
  assert.equal(payload.message, "sample");
  assert.equal(payload.category, "operation");
  assert.equal(payload.logSchemaVersion, 1);
  assert.equal(payload.requestId, "req-1");
  assert.equal(payload.route, "/health");
  assert.equal(payload.token, "[REDACTED]");
  assert.equal(payload.status, 200);
  assert.equal(payload.service, "test");
  assert.ok(payload.timestamp);
});

test("logger serializes primary behavior fields before correlation and detail fields", () => {
  const originalLog = console.log;
  const lines = [];
  console.log = (line) => lines.push(line);
  try {
    createLogger().userAction("trend_open", {
      requestId: "req-order",
      source: "ranks",
      dramaName: "剑名不奈何 第一季",
      dramaId: "93038",
      platform: "missevan",
      durationMs: 12,
    });
  } finally {
    console.log = originalLog;
  }

  const keys = Object.keys(JSON.parse(lines[0]));
  assert.deepEqual(keys.slice(0, 9), [
    "level",
    "message",
    "category",
    "event",
    "platform",
    "dramaId",
    "dramaName",
    "source",
    "logSchemaVersion",
  ]);
  assert.equal(keys.at(-1), "timestamp");
  assert.ok(keys.indexOf("source") < keys.indexOf("requestId"));
  assert.ok(keys.indexOf("source") < keys.indexOf("durationMs"));
});

test("logger emits keyword columns at the front and applies the normal text limit", () => {
  const originalLog = console.log;
  const lines = [];
  console.log = (line) => lines.push(line);
  try {
    createLogger().taskSummary("stats_task_finished", {
      platform: "missevan",
      keywordText: "剧".repeat(600),
      keyResultText: "120.50\u2013168.00",
      taskType: "revenue",
      result: { revenueResults: [] },
    });
  } finally {
    console.log = originalLog;
  }

  const payload = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(payload).slice(0, 9), [
    "level",
    "message",
    "category",
    "event",
    "platform",
    "keywordText",
    "keyResultText",
    "taskType",
    "logSchemaVersion",
  ]);
  assert.equal(payload.keywordText, `${"剧".repeat(512)}…`);
  assert.equal(payload.keyResultText, "120.50\u2013168.00");
  assert.equal(payload.result.revenueResults.length, 0);
  assert.equal(Object.keys(payload).at(-1), "timestamp");
});

test("logger preserves explicit warn level on stdout and inherits correlation context", async () => {
  const originalLog = console.log;
  const originalError = console.error;
  const stdout = [];
  const stderr = [];
  console.log = (line) => stdout.push(line);
  console.error = (line) => stderr.push(line);
  try {
    await runWithLogContext({ requestId: "req-2", taskId: "task-2" }, () =>
      createLogger().operation("fallback_request", { fallbackUsed: true }, "warn")
    );
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  assert.equal(stdout.length, 1);
  assert.equal(stderr.length, 0);
  const payload = JSON.parse(stdout[0]);
  assert.equal(payload.level, "warn");
  assert.equal(payload.requestId, "req-2");
  assert.equal(payload.taskId, "task-2");
  assert.equal(payload.fallbackUsed, true);
});

test("task summaries keep complete trusted results while redacting secrets", async () => {
  const originalLog = console.log;
  const lines = [];
  console.log = (line) => lines.push(line);
  try {
    await createLogger().taskSummary("stats_task_finished", {
      outcome: "completed",
      manualInputCount: 3,
      proxyToken: "secret",
      result: {
        items: Array.from({ length: 30 }, (_, index) => ({ index, title: `item-${index}` })),
      },
    });
  } finally {
    console.log = originalLog;
  }

  const payload = JSON.parse(lines[0]);
  assert.equal(payload.category, "task_summary");
  assert.equal(payload.manualInputCount, 3);
  assert.equal(payload.proxyToken, "[REDACTED]");
  assert.equal(payload.result.items.length, 30);
});

test("category file sink archives legacy usage and routes NDJSON by category", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "missevan-logger-"));
  const originalLog = console.log;
  console.log = () => {};
  try {
    await fs.writeFile(
      path.join(tempDir, "usage.log"),
      `${JSON.stringify({ timestamp: "legacy", action: "search" })}\n`,
      "utf8"
    );
    const logger = createLogger({}, { sink: createCategoryFileSink({ logsDir: tempDir }) });
    await logger.userAction("search", { keyword: "测试" });
    await logger.taskSummary("stats_task_finished", { outcome: "completed", result: { ok: true } });
    await logger.operation("datastore_read", { source: "test" });

    const usageLines = (await fs.readFile(path.join(tempDir, "usage.log"), "utf8"))
      .trim()
      .split(/\r?\n/)
      .map(JSON.parse);
    const operationLines = (await fs.readFile(path.join(tempDir, "operations.log"), "utf8"))
      .trim()
      .split(/\r?\n/)
      .map(JSON.parse);
    const legacyFiles = (await fs.readdir(tempDir)).filter((name) => name.startsWith("usage.legacy-"));

    assert.deepEqual(usageLines.map((item) => item.category), ["user_action", "task_summary"]);
    assert.deepEqual(operationLines.map((item) => item.category), ["operation"]);
    assert.equal(legacyFiles.length, 1);
  } finally {
    console.log = originalLog;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("category file sink preserves a large current-format first line across restart", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "missevan-logger-large-"));
  const originalLog = console.log;
  console.log = () => {};
  try {
    const firstLogger = createLogger({}, {
      sink: createCategoryFileSink({ logsDir: tempDir }),
    });
    await firstLogger.taskSummary("stats_task_finished", {
      outcome: "completed",
      result: {
        items: Array.from({ length: 300 }, (_, index) => ({
          index,
          title: `large-result-${index}-${"x".repeat(30)}`,
        })),
      },
    });

    const usagePath = path.join(tempDir, "usage.log");
    const firstSize = (await fs.stat(usagePath)).size;
    assert.ok(firstSize > 4096);

    const restartedLogger = createLogger({}, {
      sink: createCategoryFileSink({ logsDir: tempDir }),
    });
    await restartedLogger.userAction("trend_open", { platform: "missevan" });

    const files = await fs.readdir(tempDir);
    const usageLines = (await fs.readFile(usagePath, "utf8"))
      .trim()
      .split(/\r?\n/)
      .map(JSON.parse);
    assert.equal(files.some((name) => name.startsWith("usage.legacy-")), false);
    assert.deepEqual(
      usageLines.map((item) => item.category),
      ["task_summary", "user_action"]
    );
  } finally {
    console.log = originalLog;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("category file sink retries preparation after an initialization failure", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "missevan-logger-retry-"));
  const logsDir = path.join(tempDir, "logs");
  try {
    await fs.writeFile(logsDir, "directory is temporarily blocked", "utf8");
    const sink = createCategoryFileSink({ logsDir });
    const payload = {
      level: "info",
      message: "favorite_history_export",
      category: "user_action",
      event: "favorite_history_export",
      timestamp: new Date().toISOString(),
    };

    await assert.rejects(sink.write(payload));
    await fs.unlink(logsDir);
    await sink.write(payload);

    const usageLines = (await fs.readFile(path.join(logsDir, "usage.log"), "utf8"))
      .trim()
      .split(/\r?\n/)
      .map(JSON.parse);
    assert.deepEqual(usageLines, [payload]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
