import assert from "node:assert/strict";
import test from "node:test";

import { createSearchCardMetricsController } from "./useSearchCardMetrics.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function createResponse(ok, retryAfter = "") {
  return {
    ok,
    headers: {
      get(name) {
        return name === "Retry-After" ? retryAfter : null;
      },
    },
  };
}

function createSearchState({
  generation = 1,
  items = [{ id: "item-1", metrics_status: "pending" }],
  resultSource = "search",
} = {}) {
  return {
    searchGeneration: generation,
    searchPageCache: { 0: items.map((item) => ({ ...item })) },
    searchResultSource: resultSource,
    searchResults: items.map((item) => ({ ...item })),
  };
}

function createControllerHarness({ initialState = createSearchState(), ...overrides } = {}) {
  let platformState = initialState;
  const controller = createSearchCardMetricsController({
    activeBrowsePlatform: "missevan",
    getPlatformState: () => platformState,
    updatePlatformState(platform, updater) {
      assert.equal(platform, "missevan");
      platformState = updater(platformState);
    },
    ...overrides,
  });

  return {
    controller,
    getPlatformState: () => platformState,
    replacePlatformState(nextState) {
      platformState = nextState;
    },
  };
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test("a stale search-card response cannot overwrite the next search generation", async () => {
  const firstResponse = createDeferred();
  const harness = createControllerHarness({
    requestSearchCardMetrics: () => firstResponse.promise,
  });
  const firstSession = harness.controller.startRefresh(
    "missevan",
    harness.getPlatformState().searchResults,
    1,
    "search"
  );

  await flushAsyncWork();
  assert.equal(harness.getPlatformState().searchResults[0].metrics_status, "loading");
  assert.equal(harness.getPlatformState().searchPageCache[0][0].metrics_status, "loading");

  harness.replacePlatformState(createSearchState({
    generation: 2,
    items: [{ id: "item-2", metrics_status: "pending", title: "new search" }],
  }));
  firstResponse.resolve({
    response: createResponse(true),
    payload: {
      success: true,
      card_patch: { cover: "old-cover" },
      metrics: { play_count: 99 },
    },
  });
  await firstSession.promise;

  const nextState = harness.getPlatformState();
  assert.deepEqual(nextState.searchResults, [{
    id: "item-2",
    metrics_status: "pending",
    title: "new search",
  }]);
  assert.deepEqual(nextState.searchPageCache[0], nextState.searchResults);
});

test("aborting a metric refresh restores pending state and a manual retry can finish it", async () => {
  const cancelledRequest = createDeferred();
  let requestCount = 0;
  const harness = createControllerHarness({
    requestSearchCardMetrics: ({ signal }) => {
      requestCount += 1;
      if (requestCount === 1) {
        signal.addEventListener("abort", () => {
          cancelledRequest.reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
        return cancelledRequest.promise;
      }
      return Promise.resolve({
        response: createResponse(true),
        payload: {
          success: true,
          card_patch: { cover: "filled-cover", title: "do not replace" },
          metrics: { play_count: 7 },
        },
      });
    },
  });
  const firstSession = harness.controller.startRefresh(
    "missevan",
    harness.getPlatformState().searchResults,
    1,
    "search"
  );

  await flushAsyncWork();
  harness.controller.abortRefresh(firstSession, "missevan", 1);
  await firstSession.promise;
  assert.equal(firstSession.controller.signal.aborted, true);
  assert.equal(harness.controller.getActiveControllerCount(), 0);
  assert.equal(harness.getPlatformState().searchResults[0].metrics_status, "pending");
  assert.equal(harness.getPlatformState().searchPageCache[0][0].metrics_status, "pending");

  harness.replacePlatformState(createSearchState({
    items: [{ id: "item-1", metrics_status: "access_denied", title: "keep title" }],
  }));
  const retrySession = harness.controller.retrySearchCardMetrics(harness.getPlatformState().searchResults[0]);
  assert.ok(retrySession);
  await retrySession.promise;

  assert.equal(requestCount, 2);
  assert.deepEqual(harness.getPlatformState().searchResults[0], {
    id: "item-1",
    metrics_status: "ready",
    metrics_error_code: "",
    title: "keep title",
    cover: "filled-cover",
    play_count: 7,
  });
  assert.deepEqual(harness.getPlatformState().searchPageCache[0], harness.getPlatformState().searchResults);
});

test("manual metric refresh waits for rate limiting and retries the same item", async () => {
  const calls = [];
  const waits = [];
  const harness = createControllerHarness({
    initialState: createSearchState({ resultSource: "manual" }),
    requestSearchCardMetrics: () => {
      calls.push("request");
      if (calls.length === 1) {
        return Promise.resolve({
          response: createResponse(false, "1"),
          payload: { code: "METRICS_RATE_LIMITED", retryAfterSeconds: 1 },
        });
      }
      return Promise.resolve({
        response: createResponse(true),
        payload: { success: true, metrics: { reward_count: 3 } },
      });
    },
    waitForRetry: async (signal, delayMs) => {
      assert.equal(signal.aborted, false);
      waits.push(delayMs);
    },
  });

  const session = harness.controller.startRefresh(
    "missevan",
    harness.getPlatformState().searchResults,
    1,
    "manual"
  );
  await session.promise;

  assert.deepEqual(calls, ["request", "request"]);
  assert.deepEqual(waits, [1250]);
  assert.equal(harness.getPlatformState().searchResults[0].metrics_status, "ready");
  assert.equal(harness.getPlatformState().searchResults[0].reward_count, 3);
});
