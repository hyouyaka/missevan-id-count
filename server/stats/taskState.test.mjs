import assert from "node:assert/strict";
import test from "node:test";

import {
  applyTaskProgress,
  mergeCancelledTaskResult,
  transitionTask,
} from "./taskState.js";

test("task state allows only declared lifecycle transitions", () => {
  const task = { status: "queued", progress: 0 };

  assert.equal(transitionTask(task, "running"), true);
  assert.equal(task.status, "running");
  assert.equal(transitionTask(task, "completed", { progress: 100 }), true);
  assert.equal(task.status, "completed");
  assert.equal(task.progress, 100);
  assert.equal(transitionTask(task, "failed"), false);
  assert.equal(task.status, "completed");
});

test("late progress cannot mutate a terminal task or inject status", () => {
  const task = { status: "cancelled", progress: 20, currentAction: "统计已取消" };

  assert.equal(applyTaskProgress(task, {
    status: "completed",
    progress: 90,
    currentAction: "统计中",
  }), false);
  assert.deepEqual(task, {
    status: "cancelled",
    progress: 20,
    currentAction: "统计已取消",
  });
});

test("cancelled tasks may receive one partial result without changing status", () => {
  const task = { status: "cancelled", result: null };

  assert.equal(mergeCancelledTaskResult(task, {
    result: { idResults: [{ dramaId: "1" }] },
    totalUsers: 3,
  }), true);
  assert.equal(task.status, "cancelled");
  assert.deepEqual(task.result, { idResults: [{ dramaId: "1" }] });
  assert.equal(task.totalUsers, 3);
  assert.equal(task.resultIncomplete, true);
});
