import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStatsTaskSnapshotUrl,
  createStatsTask,
  getStatsTaskSnapshot,
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
