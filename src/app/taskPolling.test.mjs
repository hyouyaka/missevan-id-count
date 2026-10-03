import assert from "node:assert/strict";
import test from "node:test";

import {
  pollStatsTaskSnapshot,
  TaskPollingExhaustedError,
  TaskSnapshotInvalidResponseError,
  TaskSnapshotRequestError,
} from "./taskPolling.js";

test("task polling retries network failures with bounded exponential backoff and clears retry state on success", async () => {
  let now = 1000;
  let attempts = 0;
  const connectionStates = [];
  const retryTimes = [];
  const snapshot = await pollStatsTaskSnapshot({
    taskId: "task-1",
    now: () => now,
    sleepImpl: async (delayMs) => {
      retryTimes.push(delayMs);
      now += delayMs;
    },
    onConnectionState: (state) => connectionStates.push(state),
    getSnapshot: async () => {
      attempts += 1;
      if (attempts <= 4) throw new TypeError("network unavailable");
      return { taskId: "task-1", status: "running", progress: 47 };
    },
  });

  assert.equal(snapshot.progress, 47);
  assert.equal(attempts, 5);
  assert.deepEqual(retryTimes, [2000, 4000, 8000, 10000]);
  assert.deepEqual(connectionStates.map((state) => state.retrying), [true, true, true, true, false]);
});

test("Retry-After is bounded by the remaining failure budget without another request", async () => {
  let now = 0;
  let attempts = 0;
  let waited = 0;

  await assert.rejects(
    pollStatsTaskSnapshot({
      taskId: "task-2",
      now: () => now,
      sleepImpl: async (delayMs) => {
        waited += delayMs;
        now += delayMs;
      },
      getSnapshot: async () => {
        attempts += 1;
        throw new TaskSnapshotRequestError("rate limited", { status: 429, retryAfterMs: 120000 });
      },
    }),
    (error) => error instanceof TaskPollingExhaustedError && error.taskId === "task-2"
  );

  assert.equal(waited, 60000);
  assert.equal(attempts, 1);
});

test("non-retryable HTTP errors and invalid successful snapshots fail immediately", async () => {
  let attempts = 0;
  await assert.rejects(
    pollStatsTaskSnapshot({
      taskId: "task-3",
      getSnapshot: async () => {
        attempts += 1;
        throw new TaskSnapshotRequestError("not found", { status: 404 });
      },
    }),
    (error) => error.status === 404
  );
  assert.equal(attempts, 1);

  await assert.rejects(
    pollStatsTaskSnapshot({
      taskId: "task-3",
      getSnapshot: async () => ({ taskId: "task-3", status: "unknown" }),
    }),
    TaskSnapshotInvalidResponseError
  );
});

test("request timeout aborts the GET and exhausts at the configured budget", async () => {
  let requestSignal;
  await assert.rejects(
    pollStatsTaskSnapshot({
      taskId: "task-4",
      requestTimeoutMs: 10,
      failureBudgetMs: 10,
      getSnapshot: ({ signal }) => {
        requestSignal = signal;
        return new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        });
      },
    }),
    TaskPollingExhaustedError
  );
  assert.equal(requestSignal.aborted, true);
});

test("caller cancellation aborts a pending GET immediately", async () => {
  const controller = new AbortController();
  let requestSignal;
  const pending = pollStatsTaskSnapshot({
    taskId: "task-5",
    signal: controller.signal,
    getSnapshot: ({ signal }) => {
      requestSignal = signal;
      return new Promise(() => {});
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, (error) => error.name === "AbortError");
  assert.equal(requestSignal.aborted, true);
});
