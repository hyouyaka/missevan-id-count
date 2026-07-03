import assert from "node:assert/strict";
import test from "node:test";

import { createTaskMetrics } from "./taskMetrics.js";

test("task metrics expose aggregate timing without client or task payload data", () => {
  let now = 1000;
  const metrics = createTaskMetrics({ now: () => now });
  const task = { taskId: "secret-task", platform: "missevan", clientKey: "secret-ip" };

  metrics.queued(task);
  now = 1100;
  metrics.started(task);
  now = 1400;
  metrics.finished(task, "completed");

  assert.deepEqual(metrics.snapshot(), {
    platforms: {
      missevan: {
        active: 0,
        queued: 0,
        started: 1,
        completed: 1,
        failed: 0,
        cancelled: 0,
        averageWaitMs: 100,
        averageRunMs: 300,
      },
    },
  });
  assert.doesNotMatch(JSON.stringify(metrics.snapshot()), /secret/);
});

test("average run time only divides by tasks that have finished running", () => {
  let now = 1000;
  const metrics = createTaskMetrics({ now: () => now });
  const completedTask = { taskId: "completed", platform: "missevan" };
  const activeTask = { taskId: "active", platform: "missevan" };

  metrics.queued(completedTask);
  metrics.started(completedTask);
  now = 1300;
  metrics.finished(completedTask, "completed");
  metrics.queued(activeTask);
  metrics.started(activeTask);
  now = 1500;

  assert.equal(metrics.snapshot().platforms.missevan.averageRunMs, 300);
});
