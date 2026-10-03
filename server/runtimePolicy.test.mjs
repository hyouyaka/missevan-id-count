import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimePolicy, filterDesktopLogPayload, isRemovedDesktopEndpoint } from "./runtimePolicy.js";

test("desktop policy disables cloud data, task snapshots and cloud proxies independently of credentials", () => {
  assert.deepEqual(createRuntimePolicy(true), {
    desktopApp: true, cloudData: false, taskPersistence: false, cloudProxy: false,
  });
  assert.deepEqual(createRuntimePolicy(false), {
    desktopApp: false, cloudData: true, taskPersistence: true, cloudProxy: true,
  });
  assert.equal(isRemovedDesktopEndpoint("/ranks/trends/availability"), true);
  assert.equal(isRemovedDesktopEndpoint("/stat-tasks/task/cancel"), false);
});

test("desktop diagnostics omit query data and upstream error messages", () => {
  assert.equal(filterDesktopLogPayload({ category: "user_action", keyword: "private" }), null);
  assert.equal(filterDesktopLogPayload({ category: "task_summary", result: { private: true } }), null);
  assert.deepEqual(filterDesktopLogPayload({
    category: "operation", level: "error", event: "upstream_failed", requestId: "r1",
    keyword: "private", input: "private", result: { private: true },
    error: { name: "TypeError", code: "ETIMEDOUT", message: "private", stack: "private" },
  }), {
    category: "operation", level: "error", event: "upstream_failed", requestId: "r1",
    error: { name: "TypeError", code: "ETIMEDOUT" },
  });
});
