import assert from "node:assert/strict";
import test from "node:test";

import { registerNewDramaRoutes } from "./routes/newDramaRoutes.js";

function createRouteHarness(options = {}) {
  let route = null;
  const errors = [];
  const normalizedRequests = [];
  const filteredRequests = [];
  const queuedRequests = [];
  const router = {
    post(path, handler) {
      route = { path, handler };
    },
  };
  registerNewDramaRoutes(router, {
    filterUntrackedNewDramaIds: async (platform, ids) => {
      filteredRequests.push({ platform, ids });
      return options.filterUntrackedNewDramaIds
        ? options.filterUntrackedNewDramaIds(platform, ids)
        : options.missingDramaIds ?? ids;
    },
    logger: {
      error(...args) {
        errors.push(args);
      },
    },
    normalizeNewDramaIdsForPlatform: (platform, ids) => {
      normalizedRequests.push({ platform, ids });
      return options.normalizeNewDramaIdsForPlatform
        ? options.normalizeNewDramaIdsForPlatform(platform, ids)
        : ids;
    },
    queueNewDramaIdsAppend: async (platform, ids) => {
      queuedRequests.push({ platform, ids });
      return options.queueNewDramaIdsAppend?.(platform, ids);
    },
  });
  return { errors, filteredRequests, normalizedRequests, queuedRequests, route };
}

function createResponse() {
  return {
    payload: undefined,
    statusCode: 200,
    json(payload) {
      this.payload = payload;
      return this;
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
  };
}

test("new drama registration rejects unsupported platforms before normalization", async () => {
  const { filteredRequests, normalizedRequests, queuedRequests, route } = createRouteHarness();
  const response = createResponse();

  await route.handler({ body: { platform: "other", drama_ids: ["1"] } }, response);

  assert.equal(route.path, "/register-new-drama-ids");
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.payload, {
    success: false,
    message: "Invalid platform",
  });
  assert.deepEqual(normalizedRequests, []);
  assert.deepEqual(filteredRequests, []);
  assert.deepEqual(queuedRequests, []);
});

test("new drama registration skips storage work when normalization yields no identifiers", async () => {
  const { filteredRequests, normalizedRequests, queuedRequests, route } = createRouteHarness({
    normalizeNewDramaIdsForPlatform: () => [],
  });
  const response = createResponse();

  await route.handler({ body: { platform: "manbo", drama_ids: ["unusable"] } }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, { success: true, count: 0 });
  assert.deepEqual(normalizedRequests, [{ platform: "manbo", ids: ["unusable"] }]);
  assert.deepEqual(filteredRequests, []);
  assert.deepEqual(queuedRequests, []);
});

test("new drama registration only queues untracked normalized identifiers", async () => {
  const { filteredRequests, normalizedRequests, queuedRequests, route } = createRouteHarness({
    missingDramaIds: ["new-2"],
    normalizeNewDramaIdsForPlatform: (platform, ids) => [platform, ...ids.map(String)],
  });
  const response = createResponse();

  await route.handler({ body: { platform: "missevan", drama_ids: [1, 2] } }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, { success: true, count: 1 });
  assert.deepEqual(normalizedRequests, [{ platform: "missevan", ids: [1, 2] }]);
  assert.deepEqual(filteredRequests, [{ platform: "missevan", ids: ["missevan", "1", "2"] }]);
  assert.deepEqual(queuedRequests, [{ platform: "missevan", ids: ["new-2"] }]);
});

test("new drama registration reports persistence failures and logs their platform", async () => {
  const failure = new Error("store unavailable");
  const { errors, filteredRequests, queuedRequests, route } = createRouteHarness({
    normalizeNewDramaIdsForPlatform: () => ["42"],
    queueNewDramaIdsAppend: async () => {
      throw failure;
    },
  });
  const response = createResponse();

  await route.handler({ body: { platform: "manbo", drama_ids: ["42"] } }, response);

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.payload, {
    success: false,
    message: "Failed to register drama ids",
  });
  assert.deepEqual(filteredRequests, [{ platform: "manbo", ids: ["42"] }]);
  assert.deepEqual(queuedRequests, [{ platform: "manbo", ids: ["42"] }]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0][0], "new_drama_ids_register_failed");
  assert.equal(errors[0][1], failure);
  assert.deepEqual(errors[0][2], { platform: "manbo" });
});
