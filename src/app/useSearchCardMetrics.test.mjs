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

function createControllerHarness({ initialState = createSearchState(), platform: expectedPlatform = "missevan", ...overrides } = {}) {
  let platformState = initialState;
  const controller = createSearchCardMetricsController({
    activeBrowsePlatform: expectedPlatform,
    getPlatformState: () => platformState,
    updatePlatformState(platformName, updater) {
      assert.equal(platformName, expectedPlatform);
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

test("terminal metric failures clear stale fields in both platform result stores", async () => {
  for (const platform of ["missevan", "manbo"]) {
    const staleItem = {
      id: platform === "missevan" ? "1001" : "100000000000000001",
      metrics_status: "pending",
      view_count: 100,
      subscription_num: 20,
      reward_num: 3,
      diamond_value: 400,
      pay_count: 5,
      member_listen_count: 6,
      playCountWan: "0.0万",
      title: "保留标题",
    };
    const initialState = createSearchState({ items: [staleItem] });
    initialState.searchPageCache = {
      0: [{ ...staleItem }],
      1: [{ ...staleItem }],
    };
    const harness = createControllerHarness({
      initialState,
      platform,
      requestSearchCardMetrics: () => Promise.resolve({
        response: createResponse(false),
        payload: { code: "UPSTREAM_ERROR" },
      }),
    });

    const session = harness.controller.startRefresh(
      platform,
      harness.getPlatformState().searchResults,
      1,
      "search"
    );
    await session.promise;

    const state = harness.getPlatformState();
    for (const item of [
      state.searchResults[0],
      state.searchPageCache[0][0],
      state.searchPageCache[1][0],
    ]) {
      assert.equal(item.metrics_status, "error");
      assert.equal(item.metrics_error_code, "UPSTREAM_ERROR");
      assert.equal(item.view_count, null);
      assert.equal(item.subscription_num, null);
      assert.equal(item.reward_num, null);
      assert.equal(item.diamond_value, null);
      assert.equal(item.pay_count, null);
      assert.equal(item.member_listen_count, null);
      assert.equal(item.playCountWan, "");
      assert.equal(item.title, "保留标题");
    }
  }
});

test("access-denied metric failures clear stale fields and keep the retry state", async () => {
  const staleItem = {
    id: "item-1",
    metrics_status: "pending",
    view_count: 100,
    subscription_num: 20,
    reward_num: 3,
    playCountWan: "0.0万",
  };
  const harness = createControllerHarness({
    initialState: createSearchState({ items: [staleItem] }),
    requestSearchCardMetrics: () => Promise.resolve({
      response: createResponse(false),
      payload: { code: "ACCESS_DENIED" },
    }),
  });

  const session = harness.controller.startRefresh(
    "missevan",
    harness.getPlatformState().searchResults,
    1,
    "search"
  );
  await session.promise;

  const item = harness.getPlatformState().searchResults[0];
  assert.equal(item.metrics_status, "access_denied");
  assert.equal(item.metrics_error_code, "ACCESS_DENIED");
  assert.equal(item.view_count, null);
  assert.equal(item.subscription_num, null);
  assert.equal(item.reward_num, null);
  assert.equal(item.playCountWan, "");
});

test("an aborted same-generation session cannot overwrite a newer terminal state", async () => {
  const firstRequest = createDeferred();
  const secondRequest = createDeferred();
  let requestCount = 0;
  const harness = createControllerHarness({
    initialState: createSearchState({
      items: [{
        id: "item-1",
        metrics_status: "pending",
        view_count: 100,
        subscription_num: 20,
        playCountWan: "0.0万",
      }],
    }),
    requestSearchCardMetrics: () => {
      requestCount += 1;
      return requestCount === 1 ? firstRequest.promise : secondRequest.promise;
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

  const secondSession = harness.controller.startRefresh(
    "missevan",
    harness.getPlatformState().searchResults,
    1,
    "search"
  );
  await flushAsyncWork();
  secondRequest.resolve({
    response: createResponse(false),
    payload: { code: "UPSTREAM_ERROR" },
  });
  await secondSession.promise;

  firstRequest.resolve({
    response: createResponse(true),
    payload: { success: true, metrics: { view_count: 999 } },
  });
  await firstSession.promise;

  const item = harness.getPlatformState().searchResults[0];
  assert.equal(item.metrics_status, "error");
  assert.equal(item.metrics_error_code, "UPSTREAM_ERROR");
  assert.equal(item.view_count, null);
  assert.equal(item.subscription_num, null);
  assert.equal(item.playCountWan, "");
});

test("a failed card can retry and restore the latest metrics", async () => {
  const harness = createControllerHarness({
    initialState: createSearchState({
      items: [{
        id: "item-1",
        metrics_status: "error",
        metrics_error_code: "UPSTREAM_ERROR",
        view_count: null,
        subscription_num: null,
        playCountWan: "",
      }],
    }),
    requestSearchCardMetrics: () => Promise.resolve({
      response: createResponse(true),
      payload: {
        success: true,
        metrics: {
          view_count: 321,
          subscription_num: 45,
          reward_num: 6,
        },
      },
    }),
  });

  const session = harness.controller.retrySearchCardMetrics(
    harness.getPlatformState().searchResults[0]
  );
  assert.ok(session);
  await session.promise;

  assert.deepEqual(harness.getPlatformState().searchResults[0], {
    id: "item-1",
    metrics_status: "ready",
    metrics_error_code: "",
    view_count: 321,
    subscription_num: 45,
    playCountWan: "",
    reward_num: 6,
  });
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
