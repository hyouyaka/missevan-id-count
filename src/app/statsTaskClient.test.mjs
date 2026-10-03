import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStatsTaskSnapshotUrl,
  cancelStatsTask,
  createStatsTask,
  getStatsTaskSnapshot,
  getStatsTaskSnapshotWithRetry,
  notifyStatsTaskCancel,
} from "./statsTaskClient.js";

function createJsonResponse(data, { ok = true, status = 200, backendVersion = "1.2.4" } = {}) {
  return {
    ok,
    status,
    headers: {
      get(name) {
        return name === "X-Backend-Version" ? backendVersion : null;
      },
    },
    json: async () => data,
  };
}

test("stats task client creates versioned task requests and reports the backend version", async () => {
  const requests = [];
  const versionUpdates = [];
  const signal = new AbortController().signal;

  const task = await createStatsTask({
    platform: "manbo",
    taskType: "id",
    payload: { episodes: [{ sound_id: "42" }] },
    signal,
    frontendVersion: "1.2.3",
    onVersionStatus: (value) => versionUpdates.push(value),
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return createJsonResponse({ taskId: "task-1", taskType: "id", status: "queued" });
    },
  });

  assert.equal(task.taskId, "task-1");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/stat-tasks?frontendVersion=1.2.3");
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.signal, signal);
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    platform: "manbo",
    taskType: "id",
    episodes: [{ sound_id: "42" }],
  });
  assert.deepEqual(versionUpdates, [{ frontendVersion: "1.2.3", backendVersion: "1.2.4" }]);
});

test("snapshot transport retries transient status and body failures without recreating a task", async () => {
  for (const failure of [408, 429, 503, "body-network"]) {
    let clock = 0;
    const requests = [];
    const snapshot = await getStatsTaskSnapshotWithRetry("same-task", {
      now: () => clock,
      sleepImpl: async (delay) => { clock += delay; },
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        if (requests.length === 1) {
          if (failure === "body-network") {
            return { ...createJsonResponse({}), json: async () => { throw new TypeError("body stream disconnected"); } };
          }
          return createJsonResponse({}, { ok: false, status: failure });
        }
        return createJsonResponse({ taskId: "same-task", status: "running", progress: 61 });
      },
    });
    assert.equal(snapshot.progress, 61, String(failure));
    assert.equal(requests.length, 2);
    assert.equal(clock, 2000);
    assert.ok(requests.every(({ url, init }) => url.startsWith("/stat-tasks/same-task?") && init.method !== "POST"));
  }
});

test("successful malformed JSON, invalid snapshots and permanent statuses are not retried", async () => {
  for (const response of [
    { ...createJsonResponse({}), json: async () => { throw new SyntaxError("invalid JSON"); } },
    createJsonResponse({ taskId: "other-task", status: "running" }),
    createJsonResponse({ status: "unknown" }),
    createJsonResponse({}, { ok: false, status: 404 }),
  ]) {
    let calls = 0;
    await assert.rejects(getStatsTaskSnapshotWithRetry("task", {
      fetchImpl: async () => { calls += 1; return response; },
      sleepImpl: async () => assert.fail("non-retryable response must not back off"),
    }));
    assert.equal(calls, 1);
  }
});

test("a successful poll resets the outage budget for the next poll", async () => {
  let clock = 0;
  let attempts = 0;
  const options = {
    now: () => clock,
    retryDelays: [40000],
    sleepImpl: async (delay) => { clock += delay; },
    fetchImpl: async () => {
      attempts += 1;
      if (attempts % 2) throw new TypeError("offline");
      return createJsonResponse({ taskId: "task", status: "running" });
    },
  };
  await getStatsTaskSnapshotWithRetry("task", options);
  await getStatsTaskSnapshotWithRetry("task", options);
  assert.equal(attempts, 4);
  assert.equal(clock, 80000);
});

test("task creation never retries a failed POST", async () => {
  let calls = 0;
  await assert.rejects(createStatsTask({
    platform: "missevan",
    taskType: "id",
    fetchImpl: async () => { calls += 1; throw new TypeError("connection lost after POST"); },
  }), /connection lost/);
  assert.equal(calls, 1);
});

test("cancellation confirms only the requested task and does not send a pre-aborted request", async () => {
  for (const [response, confirmed] of [
    [createJsonResponse({ taskId: "task", status: "cancelled" }), true],
    [createJsonResponse({ taskId: "other-task", status: "cancelled" }), false],
    [createJsonResponse({ taskId: "task", status: "running" }), false],
    [createJsonResponse({}, { ok: false, status: 404 }), false],
  ]) {
    const outcome = await cancelStatsTask("task", { fetchImpl: async () => response });
    assert.equal(outcome.confirmed, confirmed);
  }
  const abort = new AbortController();
  abort.abort();
  const outcome = await cancelStatsTask("task", {
    signal: abort.signal,
    fetchImpl: async () => assert.fail("pre-aborted cancellation must not send a request"),
  });
  assert.equal(outcome.confirmed, false);
});

test("stats task client polls an uncached versioned snapshot and preserves request errors", async () => {
  const requests = [];
  const snapshot = await getStatsTaskSnapshot("task-2", {
    frontendVersion: "1.2.3",
    now: () => 123,
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return createJsonResponse({ taskId: "task-2", status: "running" });
    },
  });

  assert.equal(buildStatsTaskSnapshotUrl("task-2", () => 123), "/stat-tasks/task-2?_ts=123");
  assert.equal(snapshot.status, "running");
  assert.equal(requests[0].url, "/stat-tasks/task-2?_ts=123&frontendVersion=1.2.3");
  assert.deepEqual(requests[0].init, { signal: undefined, cache: "no-store" });

  await assert.rejects(
    getStatsTaskSnapshot("task-2", {
      frontendVersion: "1.2.3",
      fetchImpl: async () => createJsonResponse({}, { ok: false, status: 503 }),
    }),
    /Failed to fetch stats task: 503/
  );
});

test("stats task cancellation uses a successful beacon without a keepalive request", async () => {
  const beaconCalls = [];
  let fallbackCalls = 0;

  notifyStatsTaskCancel("task-3", {
    navigatorLike: {
      sendBeacon(url) {
        beaconCalls.push(url);
        return true;
      },
    },
    fetchImpl: async () => {
      fallbackCalls += 1;
    },
  });

  await Promise.resolve();
  assert.deepEqual(beaconCalls, ["/stat-tasks/task-3/cancel"]);
  assert.equal(fallbackCalls, 0);
});

test("stats task cancellation falls back when beacon declines, throws, or is unavailable", async () => {
  const fallbackRequests = [];
  const fetchImpl = async (url, init) => {
    fallbackRequests.push({ url, init });
  };

  notifyStatsTaskCancel("task-4", {
    navigatorLike: { sendBeacon: () => false },
    fetchImpl,
  });
  notifyStatsTaskCancel("task-5", {
    navigatorLike: { sendBeacon: () => { throw new Error("beacon unavailable"); } },
    fetchImpl,
  });
  notifyStatsTaskCancel("task-6", {
    navigatorLike: null,
    fetchImpl,
  });

  await Promise.resolve();
  assert.deepEqual(
    fallbackRequests,
    ["task-4", "task-5", "task-6"].map((taskId) => ({
      url: `/stat-tasks/${taskId}/cancel`,
      init: { method: "POST", keepalive: true },
    }))
  );
});
