import test from "node:test";
import assert from "node:assert/strict";

import { createLogger } from "./logger.js";

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
  assert.equal(payload.requestId, "req-1");
  assert.equal(payload.route, "/health");
  assert.equal(payload.token, "[REDACTED]");
  assert.equal(payload.status, 200);
  assert.equal(payload.service, "test");
  assert.ok(payload.timestamp);
});
