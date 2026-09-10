import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import express from "express";

import { registerStatsRoutes } from "./routes/statsRoutes.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function createStatsRouteHarness(overrides = {}) {
  const createCalls = [];
  const cancelCalls = [];
  const routes = new Map();
  const ready = overrides.ready || Promise.resolve();
  const router = overrides.router || {
    get() {},
    post(path, ...handlers) {
      routes.set(path, handlers.at(-1));
    },
  };
  const statsTaskEngine = {
    cancel(taskId) {
      cancelCalls.push(taskId);
      return { snapshot: { taskId, status: "cancelled" } };
    },
    getMetrics() {
      return {};
    },
    whenReady() {
      return ready;
    },
    ...(overrides.statsTaskEngine || {}),
  };
  const options = {
    adminCacheRefreshToken: "",
    buildRanksResponseMeta: () => ({}),
    buildRankTrendAvailabilityResponse: () => ({ success: true, ids: [] }),
    buildStatsTaskSnapshot: (task) => ({ taskId: task.taskId, status: task.status }),
    createStatsTaskFromRequest(req, _res, forcedPlatform = null, defaultTaskType = null) {
      createCalls.push({ forcedPlatform, defaultTaskType, req });
      return {
        taskId: `task-${createCalls.length}`,
        status: "queued",
      };
    },
    executeAdminCacheRefresh: async () => ({ status: 200, payload: {} }),
    getCachedCvRankTrendResponse: async () => ({ success: true }),
    getCachedOngoingResponse: async () => ({ success: true }),
    getCachedRankTrendAggregateSnapshot: async () => null,
    getCachedWeeklyPlaybackSnapshot: async () => null,
    getCachedRankTrendResponse: async () => ({ success: true }),
    getCachedRanksResponse: async () => ({ response: {}, cacheStatus: "hit" }),
    getRanksResponseCacheValidator: () => "",
    getStatsTaskSnapshotOr404: () => null,
    isNumericId: (value) => /^\d+$/.test(String(value ?? "")),
    isRankTrendAggregateSnapshot: () => false,
    logger: { error() {} },
    ongoingResponseSchemaVersion: 1,
    rankTrendsResponseSchemaVersion: 1,
    refreshMissevanCooldownState: async () => {},
    statsTaskCreationLimiter: (_req, _res, next) => next(),
    statsTaskEngine,
    ...overrides.options,
  };
  registerStatsRoutes(router, options);
  return { cancelCalls, createCalls, routes, statsTaskEngine };
}

function createRequest(body = {}) {
  const req = new EventEmitter();
  req.aborted = false;
  req.body = body;
  req.destroyed = false;
  req.get = () => "";
  req.query = {};
  return req;
}

function createResponse() {
  const res = new EventEmitter();
  res.destroyed = false;
  res.writableEnded = false;
  res.writableFinished = false;
  res.headers = {};
  res.json = function json(payload) {
    this.payload = payload;
    return this;
  };
  res.setHeader = function setHeader(name, value) {
    this.headers[name] = value;
  };
  res.status = function status(code) {
    this.statusCode = code;
    return this;
  };
  return res;
}

async function startTestServer(app, t) {
  const listener = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    listener.once("listening", resolve);
    listener.once("error", reject);
  });
  t.after(() => new Promise((resolve) => listener.close(resolve)));
  return listener;
}

test("a client abort during task recovery does not create a stats task", async (t) => {
  const recovery = createDeferred();
  const recoveryStarted = createDeferred();
  const app = express();
  app.use(express.json());
  const harness = createStatsRouteHarness({
    router: app,
    statsTaskEngine: {
      whenReady() {
        recoveryStarted.resolve();
        return recovery.promise;
      },
    },
  });
  const listener = await startTestServer(app, t);
  const controller = new AbortController();
  const request = fetch(`http://127.0.0.1:${listener.address().port}/stat-tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform: "manbo", taskType: "id", episodes: [{ sound_id: "1" }] }),
    signal: controller.signal,
  });

  await recoveryStarted.promise;
  controller.abort();
  await request.catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 30));
  recovery.resolve();
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(harness.createCalls.length, 0);
  assert.deepEqual(harness.cancelCalls, []);
});

test("created task cancellation follows an unfinished response close but not normal response completion", async () => {
  const harness = createStatsRouteHarness();
  const createRoute = harness.routes.get("/stat-tasks");

  const disconnectedRequest = createRequest({ platform: "manbo" });
  const disconnectedResponse = createResponse();
  await createRoute(disconnectedRequest, disconnectedResponse);
  disconnectedResponse.emit("close");

  assert.equal(harness.createCalls.length, 1);
  assert.deepEqual(harness.cancelCalls, ["task-1"]);

  const completedRequest = createRequest({ platform: "manbo" });
  const completedResponse = createResponse();
  await createRoute(completedRequest, completedResponse);
  completedResponse.writableEnded = true;
  completedResponse.writableFinished = true;
  completedResponse.emit("finish");
  completedResponse.emit("close");

  assert.equal(harness.createCalls.length, 2);
  assert.deepEqual(harness.cancelCalls, ["task-1"]);
});

test("both creation routes stop before enqueue when an awaited prerequisite observes a disconnect", async () => {
  const cooldown = createDeferred();
  const cooldownStarted = createDeferred();
  const harness = createStatsRouteHarness({
    options: {
      refreshMissevanCooldownState: () => {
        cooldownStarted.resolve();
        return cooldown.promise;
      },
    },
  });
  const standardRoute = harness.routes.get("/stat-tasks");
  const standardRequest = createRequest({ platform: "missevan" });
  const standardResponse = createResponse();
  const standardPending = standardRoute(standardRequest, standardResponse);
  await cooldownStarted.promise;
  standardRequest.aborted = true;
  cooldown.resolve();
  await standardPending;

  const manboRoute = harness.routes.get("/manbo/stat-tasks");
  const manboRequest = createRequest({});
  const manboResponse = createResponse();
  manboResponse.destroyed = true;
  await manboRoute(manboRequest, manboResponse);

  assert.deepEqual(harness.createCalls, []);
});

test("both creation routes return normally without cancelling their completed response", async (t) => {
  const app = express();
  app.use(express.json());
  const harness = createStatsRouteHarness({ router: app });
  const listener = await startTestServer(app, t);
  const origin = `http://127.0.0.1:${listener.address().port}`;

  const standard = await fetch(`${origin}/stat-tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform: "manbo", taskType: "id", episodes: [{ sound_id: "1" }] }),
  });
  const manbo = await fetch(`${origin}/manbo/stat-tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ episodes: [{ sound_id: "2" }] }),
  });

  assert.equal(standard.status, 200);
  assert.equal(manbo.status, 200);
  assert.deepEqual(await standard.json(), { taskId: "task-1", status: "queued" });
  assert.deepEqual(await manbo.json(), { taskId: "task-2", status: "queued" });
  assert.deepEqual(harness.createCalls.map(({ forcedPlatform, defaultTaskType }) => ({ forcedPlatform, defaultTaskType })), [
    { forcedPlatform: null, defaultTaskType: null },
    { forcedPlatform: "manbo", defaultTaskType: "id" },
  ]);
  assert.deepEqual(harness.cancelCalls, []);
});
