import assert from "node:assert/strict";
import test from "node:test";

import { createTaskCancellationRegistry } from "./taskCancellation.js";

test("task cancellation aborts an active task and releases its controller", () => {
  const registry = createTaskCancellationRegistry();
  const signal = registry.create("task-1");

  assert.equal(signal.aborted, false);
  assert.equal(registry.cancel("task-1"), true);
  assert.equal(signal.aborted, true);
  registry.release("task-1");
  assert.equal(registry.cancel("task-1"), false);
});
