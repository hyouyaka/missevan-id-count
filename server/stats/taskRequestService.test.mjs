import assert from "node:assert/strict";
import test from "node:test";

import {
  createStatsTaskRequestService,
  getStatsTaskItemCounts,
  isStatsTaskItemLimitExceeded,
  normalizeTaskDramaIds,
  normalizeTaskEpisodes,
} from "./taskRequestService.js";

function createResponse() {
  return {
    headers: {},
    statusCode: 200,
    payload: null,
    json(payload) {
      this.payload = payload;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
  };
}

function createRequestServiceHarness(overrides = {}) {
  const calls = {
    cleanup: 0,
    enqueued: [],
    getSnapshot: [],
    reports: [],
    touched: [],
  };
  let taskNumber = 0;
  const snapshots = new Map();
  const statsTaskEngine = {
    enqueue(task) {
      calls.enqueued.push(task);
      return { accepted: true, queuePosition: 0 };
    },
    getSnapshot(taskId) {
      calls.getSnapshot.push(taskId);
      return snapshots.get(taskId) || null;
    },
    report(taskId, patch) {
      calls.reports.push({ taskId, patch });
    },
    touch(taskId) {
      calls.touched.push(taskId);
      return snapshots.get(taskId) || null;
    },
    ...(overrides.statsTaskEngine || {}),
  };
  const service = createStatsTaskRequestService({
    cleanupExpiredStatsTasks() {
      calls.cleanup += 1;
    },
    createTaskId() {
      taskNumber += 1;
      return `task-${taskNumber}`;
    },
    itemLimit: 3,
    normalizePlayCountDramas: (dramas) => Array.isArray(dramas) ? dramas : [],
    normalizeSource: (value) => String(value ?? "").trim(),
    now: () => 1710000000000,
    statsTaskEngine,
    ...overrides.options,
  });

  return { calls, service, snapshots };
}

test("task request normalizers preserve platform ID and episode rules", () => {
  assert.deepEqual(
    normalizeTaskEpisodes([
      { drama_id: 1, sound_id: 2, drama_title: " A ", episode_title: " B ", duration: "5" },
      { drama_id: 3, sound_id: "  " },
    ]),
    [{
      drama_id: "1",
      sound_id: "2",
      drama_title: "A",
      episode_title: "B",
      duration: 5,
    }]
  );
  assert.deepEqual(normalizeTaskDramaIds(["01", "1", "bad", 2], "missevan"), [1, 2]);
  assert.deepEqual(normalizeTaskDramaIds(["01", "1", "bad", 2], "manbo"), ["01", "1", "2"]);
});

test("item-count helpers cover both primary and nested play-count limits", () => {
  const counts = getStatsTaskItemCounts({
    taskType: "play_count",
    episodes: [{ sound_id: "1" }],
    playCountDramas: [
      { episodes: [{ sound_id: "1" }, { sound_id: "2" }] },
      { episodes: [{ sound_id: "3" }] },
    ],
  });

  assert.deepEqual(counts, {
    primary: 1,
    playCountDramas: 2,
    playCountEpisodes: 3,
  });
  assert.equal(isStatsTaskItemLimitExceeded(counts, 2), true);
  assert.equal(isStatsTaskItemLimitExceeded(counts, 3), false);
});

test("accepted requests retain normalized input and report their queue position", () => {
  const harness = createRequestServiceHarness({
    statsTaskEngine: {
      enqueue(task) {
        harness.calls.enqueued.push(task);
        return { accepted: true, queuePosition: 2 };
      },
    },
  });
  const response = createResponse();
  const task = harness.service.createStatsTaskFromRequest({
    body: {
      platform: "missevan",
      taskType: "play_count",
      source: " home ",
      episodes: [{ drama_id: 1, sound_id: 2, duration: 3 }],
      playCountDramas: [{ episodes: [{ sound_id: "2" }] }],
    },
    ip: "127.0.0.1",
  }, response);

  assert.equal(task.taskId, "task-1");
  assert.equal(task.platform, "missevan");
  assert.equal(task.source, "home");
  assert.equal(task.clientKey, "127.0.0.1");
  assert.equal(task.queuePosition, 2);
  assert.equal(task.totalCount, 1);
  assert.equal(harness.calls.cleanup, 1);
  assert.deepEqual(harness.calls.reports, [{
    taskId: "task-1",
    patch: { currentAction: "任务排队中，前方 2 个任务" },
  }]);
});

test("request validation preserves item-limit and queue-full responses", () => {
  const limited = createRequestServiceHarness({
    options: { itemLimit: 2 },
  });
  const limitedResponse = createResponse();
  const limitedTask = limited.service.createStatsTaskFromRequest({
    body: {
      platform: "missevan",
      taskType: "play_count",
      episodes: [{ sound_id: "1" }],
      playCountDramas: [{ episodes: [{ sound_id: "1" }, { sound_id: "2" }, { sound_id: "3" }] }],
    },
  }, limitedResponse);

  assert.equal(limitedTask, null);
  assert.equal(limitedResponse.statusCode, 400);
  assert.deepEqual(limitedResponse.payload, {
    success: false,
    code: "TASK_ITEM_LIMIT_EXCEEDED",
    message: "单次统计最多处理 2 个条目。",
    limit: 2,
  });
  assert.deepEqual(limited.calls.enqueued, []);

  const queued = createRequestServiceHarness({
    statsTaskEngine: {
      enqueue(task) {
        queued.calls.enqueued.push(task);
        return { accepted: false, code: "TASK_CLIENT_QUEUE_FULL" };
      },
    },
  });
  const queueResponse = createResponse();
  const queueTask = queued.service.createStatsTaskFromRequest({
    body: {
      platform: "manbo",
      taskType: "id",
      episodes: [{ sound_id: "1" }],
    },
  }, queueResponse);

  assert.equal(queueTask, null);
  assert.equal(queueResponse.statusCode, 429);
  assert.equal(queueResponse.headers["Retry-After"], "30");
  assert.deepEqual(queueResponse.payload, {
    success: false,
    code: "TASK_CLIENT_QUEUE_FULL",
    message: "当前设备排队中的统计任务已达上限，请稍后重试。",
    platform: "manbo",
    retryAfterSeconds: 30,
  });
});

test("snapshot lookup touches active tasks and reports missing tasks", () => {
  const harness = createRequestServiceHarness();
  harness.snapshots.set("task-1", { taskId: "task-1", status: "queued" });

  const touchedResponse = createResponse();
  assert.deepEqual(
    harness.service.getStatsTaskSnapshotOr404("task-1", touchedResponse, { touch: true }),
    { taskId: "task-1", status: "queued" }
  );
  assert.deepEqual(harness.calls.touched, ["task-1"]);

  const missingResponse = createResponse();
  assert.equal(harness.service.getStatsTaskSnapshotOr404("missing", missingResponse), null);
  assert.equal(missingResponse.statusCode, 404);
  assert.deepEqual(missingResponse.payload, { error: "Task not found" });
  assert.equal(harness.calls.cleanup, 2);
});

test("forced Manbo requests retain the ID default without play-count payloads", () => {
  const harness = createRequestServiceHarness();
  const task = harness.service.createStatsTaskFromRequest({
    body: {
      taskType: "",
      episodes: [{ sound_id: 1 }],
      playCountDramas: [{ episodes: [{ sound_id: "1" }] }],
    },
    ip: "client",
  }, createResponse(), "manbo", "id");

  assert.equal(task.platform, "manbo");
  assert.equal(task.taskType, "id");
  assert.deepEqual(task.playCountDramas, []);
});

