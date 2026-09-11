import { useEffect, useRef, useState } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { useSearchCardMetrics } from "@/app/useSearchCardMetrics";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function createSearchState(generation, items) {
  return {
    searchGeneration: generation,
    searchPageCache: { 0: items.map((item) => ({ ...item })) },
    searchResultSource: "search",
    searchResults: items.map((item) => ({ ...item })),
  };
}

function createResponse() {
  return {
    ok: true,
    headers: { get: () => null },
  };
}

function useSearchCardMetricsHarness(requestSearchCardMetrics) {
  const [platformState, setPlatformState] = useState(() => createSearchState(1, [
    { id: "first", metrics_status: "pending" },
  ]));
  const platformStateRef = useRef(platformState);
  const metrics = useSearchCardMetrics({
    activeBrowsePlatform: "missevan",
    activeSearchCategory: "missevan",
    currentBrowseState: platformState,
    currentPlatform: "search",
    getPlatformState: () => platformStateRef.current,
    requestSearchCardMetrics,
    updatePlatformState(platform, updater) {
      expect(platform).toBe("missevan");
      setPlatformState((current) => updater(current));
    },
  });
  useEffect(() => {
    platformStateRef.current = platformState;
  }, [platformState]);

  return {
    metrics,
    platformState,
    replaceSearch(items) {
      setPlatformState((current) => createSearchState(current.searchGeneration + 1, items));
    },
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("a new search generation aborts its old queue and starts a queue for new results", async () => {
  const first = createDeferred();
  const second = createDeferred();
  const requests = [];
  const requestSearchCardMetrics = vi.fn(({ item, signal }) => {
    requests.push({ item, signal });
    return item.id === "first" ? first.promise : second.promise;
  });
  const { result } = renderHook(() => useSearchCardMetricsHarness(requestSearchCardMetrics));

  await waitFor(() => expect(requests).toHaveLength(1));
  expect(result.current.platformState.searchResults[0].metrics_status).toBe("loading");

  act(() => {
    result.current.replaceSearch([{ id: "second", metrics_status: "pending" }]);
  });

  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[0].signal.aborted).toBe(true);
  expect(requests[1].item.id).toBe("second");
  expect(result.current.platformState.searchResults[0]).toMatchObject({
    id: "second",
    metrics_status: "loading",
  });

  await act(async () => {
    first.resolve({
      response: createResponse(),
      payload: { success: true, metrics: { play_count: 100 } },
    });
    await Promise.resolve();
  });
  expect(result.current.platformState.searchResults[0]).not.toHaveProperty("play_count");

  await act(async () => {
    second.resolve({
      response: createResponse(),
      payload: { success: true, metrics: { play_count: 200 } },
    });
    await Promise.resolve();
  });
  await waitFor(() => expect(result.current.platformState.searchResults[0]).toMatchObject({
    id: "second",
    metrics_status: "ready",
    play_count: 200,
  }));
  expect(result.current.platformState.searchPageCache[0][0]).toMatchObject({
    id: "second",
    metrics_status: "ready",
    play_count: 200,
  });
});
