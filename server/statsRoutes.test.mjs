import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import express from "express";

import { registerStatsRoutes } from "./routes/statsRoutes.js";
import { COMPACT_CV_RANKS_FORMAT, expandCvRanks } from "../shared/cvRanksWire.js";

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

test("ranks conditional requests return recovered labor enrichment with a new ETag on either platform", async (t) => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { buildNormalizedRanksResponse, getRanksResponseCacheValidator } = await import("../server.js");
  const cvKey = "person:00000000-0000-0000-0000-000000000001";
  const snapshot = {
    generated_at: "2026-11-06T00:00:00Z",
    publicationId: "edition",
    seriesCountMeta: {},
    seriesCountRankings: {},
  };
  for (const platform of ["missevan", "manbo"]) {
    snapshot.seriesCountMeta[platform] = { generated_at: "2026-11-13T00:00:00Z" };
    snapshot.seriesCountRankings[platform] = [{ cvName: "恢复CV", cvKey, rank: 1, seriesCount: 1,
      works: [{ seriesKey: "series", title: "备用标题", dramaIds: ["101"] }] }];
  }
  const trends = { publicationId: snapshot.publicationId };
  const build = () => buildNormalizedRanksResponse({ _meta: { updated_at: snapshot.generated_at } }, null, snapshot, { cvTrendSnapshots: trends });
  let response = build();
  const originalSummary = structuredClone(response.cvSummary);
  const app = express();
  createStatsRouteHarness({ router: app, options: {
    getCachedRanksResponse: async () => ({ response, cacheStatus: "hit" }),
    getRanksResponseCacheValidator,
  } });
  const listener = await startTestServer(app, t);
  const url = `http://127.0.0.1:${listener.address().port}/ranks`;
  const initial = await fetch(url);
  assert.equal(initial.status, 200);
  let etag = initial.headers.get("etag");
  assert.ok(etag);
  const initialBody = await initial.json();
  const compactUrl = `${url}?format=${COMPACT_CV_RANKS_FORMAT}`;
  const compact = await fetch(compactUrl, { headers: { "If-None-Match": etag } });
  assert.equal(compact.status, 200);
  const compactEtag = compact.headers.get("etag");
  assert.notEqual(compactEtag, etag);
  const compactBody = await compact.json();
  assert.ok(compactBody.cvData.works.length);
  assert.equal(compactBody.platforms.cv.categories.find(({ key }) => key === "labor").ranks[1].useLegacyItems, true);
  assert.deepEqual(expandCvRanks(compactBody), initialBody);
  assert.equal((await fetch(compactUrl, { cache: "no-cache", headers: { "If-None-Match": compactEtag } })).status, 304);
  const item = (body, platform) => body.platforms[platform].categories.find(({ key }) => key === "cv").ranks.at(-1).items[0];
  for (const platform of ["missevan", "manbo"]) {
    assert.equal(item(initialBody, platform).totalViewCount, null);
    trends[platform] = { updated_at: snapshot.generated_at, cvs: { [cvKey]: {
      samples: { "2026-11-06": { generated_at: snapshot.generated_at, publicationId: snapshot.publicationId, metrics: { totalViewCount: 123456 } } },
      works: [{ dramaId: "101", title: "恢复的作品标题", cover: "https://example.com/recovered.jpg" }],
    } } };
    response = build();
    assert.deepEqual(response.cvSummary, originalSummary);
    const recovered = await fetch(url, { cache: "no-cache", headers: { "If-None-Match": etag } });
    assert.equal(recovered.status, 200, `${platform}: stale ETag must not yield 304`);
    assert.notEqual(recovered.headers.get("etag"), etag);
    etag = recovered.headers.get("etag");
    const restored = item(await recovered.json(), platform);
    assert.equal(restored.totalViewCount, 123456);
    assert.equal(restored.works[0].title, "恢复的作品标题");
    assert.equal(restored.works[0].cover, "https://example.com/recovered.jpg");
    response = build();
    const unchanged = await fetch(url, { cache: "no-cache", headers: { "If-None-Match": etag } });
    assert.equal(unchanged.status, 304);
    assert.equal(unchanged.headers.get("etag"), etag);
    assert.equal(await unchanged.text(), "");
  }
});

test("both rank response formats revalidate when CV or growth summary counts change", async (t) => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { buildNormalizedRanksResponse, getRanksResponseCacheValidator } = await import("../server.js");
  const updatedAt = "2026-11-20T00:00:00Z";
  const original = buildNormalizedRanksResponse({ _meta: { updated_at: updatedAt } }, null, {
    generated_at: updatedAt, missevanDramaCount: 100,
  }, {}, { generated_at: updatedAt, manboDramaCount: 200 });
  let response = original;
  const app = express();
  createStatsRouteHarness({ router: app, options: {
    getCachedRanksResponse: async () => ({ response, cacheStatus: "hit" }),
    getRanksResponseCacheValidator,
  } });
  const listener = await startTestServer(app, t);
  for (const suffix of ["", `?format=${COMPACT_CV_RANKS_FORMAT}`]) {
    response = original;
    const url = `http://127.0.0.1:${listener.address().port}/ranks${suffix}`;
    const initial = await fetch(url);
    assert.equal(initial.status, 200);
    await initial.json();
    let etag = initial.headers.get("etag");
    for (const [summary, field, value] of [
      ["cvSummary", "missevanDramaCount", 150],
      ["growthSummary", "manboDramaCount", 250],
    ]) {
      response = { ...response, [summary]: { ...response[summary], [field]: value } };
      const updated = await fetch(url, { cache: "no-cache", headers: { "If-None-Match": etag } });
      assert.equal(updated.status, 200);
      assert.equal((await updated.json())[summary][field], value);
      assert.notEqual(updated.headers.get("etag"), etag);
      etag = updated.headers.get("etag");
    }
    const unchanged = await fetch(url, { cache: "no-cache", headers: { "If-None-Match": etag } });
    assert.equal(unchanged.status, 304);
  }
});

test("CV trend requests preserve identity and invalidate the ETag when badges change on the same date", async (t) => {
  const app = express();
  let rank = 6;
  createStatsRouteHarness({ router: app, options: {
    getCachedCvRankTrendResponse: async (name, profileId) => {
      assert.equal(name, "同名CV");
      assert.equal(profileId, "rank-work:missevan:101");
      return { success: true, latestDate: "2026-11-20", cvRanks: { items: [{ rank }] } };
    },
  } });
  const listener = await startTestServer(app, t);
  const query = new URLSearchParams({ kind: "cv", id: "同名CV", profileId: "rank-work:missevan:101" });
  const url = `http://127.0.0.1:${listener.address().port}/ranks/trends?${query}`;
  const initial = await fetch(url);
  assert.equal((await initial.json()).cvRanks.items[0].rank, 6);
  const etag = initial.headers.get("etag");
  assert.ok(etag);
  rank = 5;
  const updated = await fetch(url, { cache: "no-cache", headers: { "If-None-Match": etag } });
  assert.equal(updated.status, 200);
  assert.notEqual(updated.headers.get("etag"), etag);
  assert.equal((await updated.json()).cvRanks.items[0].rank, 5);
});

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
