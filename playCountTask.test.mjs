import test from "node:test";
import assert from "node:assert/strict";

process.env.START_SERVER_ON_IMPORT = "false";

const {
  buildPlayCountDramasFromDramas,
} = await import("./src/app/app-utils.js");

const {
  buildMissevanPlayCountWorkPlan,
  resolveMissevanPlayCountDramaTotal,
  normalizePlayCountDramas,
  buildFetchOptions,
  buildManboWebApiUrls,
  classifyRequestFailureOutcome,
  fetchManboWebJsonWithFallback,
  buildMissevanFallbackUrl,
  fetchMissevanJsonWithFallbackChain,
  fetchSearchCardMetrics,
  buildMissevanRouteCooldownStateAfterAccessDenied,
  createTimeoutSignal,
  getNearestMissevanAccessUntil,
  getStatsTaskItemCounts,
  isStatsTaskItemLimitExceeded,
  parseMissevanCooldownStatePayload,
  selectMissevanRequestRoute,
  shouldPersistAccessDeniedCooldownForEnv,
} = await import("./server.js");

test("request timeout signal also follows task cancellation", () => {
  const taskController = new AbortController();
  const timeout = createTimeoutSignal(10_000, taskController.signal);

  taskController.abort();
  assert.equal(timeout.signal.aborted, true);
  assert.equal(timeout.timedOut, false);
  timeout.cleanup();
});

test("request timeout signal distinguishes its own deadline", async () => {
  const timeout = createTimeoutSignal(10);
  await new Promise((resolve) => timeout.signal.addEventListener("abort", resolve, { once: true }));
  assert.equal(timeout.signal.aborted, true);
  assert.equal(timeout.timedOut, true);
  timeout.cleanup();
});

function createTestMissevanFallbackRoutes() {
  return [
    {
      key: "primary",
      fallbackRoute: "render",
      baseUrl: "https://render.test/missevan",
      proxyToken: "render-token",
      timeoutMs: 100,
    },
    {
      key: "secondary",
      fallbackRoute: "deno",
      baseUrl: "https://deno.test/missevan",
      proxyToken: "deno-token",
      timeoutMs: 100,
    },
  ];
}

test("Missevan fallback gives Deno an independent window after Render times out", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), signal: options.signal });
    if (String(url).includes("render.test")) {
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      });
    }
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const parent = new AbortController();
    const result = await fetchMissevanJsonWithFallbackChain(
      "https://www.missevan.com/sound/getsound?soundid=1",
      {
        signal: parent.signal,
        fallbackRoutes: createTestMissevanFallbackRoutes(),
        fallbackTimeoutMsByRoute: { primary: 10, secondary: 100 },
      }
    );

    assert.equal(result.success, true);
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /render\.test/);
    assert.match(calls[1].url, /deno\.test/);
    assert.equal(parent.signal.aborted, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Missevan fallback does not call Deno when Render succeeds", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };

  try {
    await fetchMissevanJsonWithFallbackChain(
      "https://www.missevan.com/sound/getsound?soundid=2",
      {
        fallbackRoutes: createTestMissevanFallbackRoutes(),
        fallbackTimeoutMsByRoute: { primary: 100, secondary: 100 },
      }
    );
    assert.equal(calls.length, 1);
    assert.match(calls[0], /render\.test/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Missevan fallback stops immediately on client cancellation", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const controller = new AbortController();
  globalThis.fetch = async (url, options = {}) => {
    calls.push(String(url));
    return new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    });
  };

  try {
    const request = fetchMissevanJsonWithFallbackChain(
      "https://www.missevan.com/sound/getsound?soundid=3",
      {
        signal: controller.signal,
        fallbackRoutes: createTestMissevanFallbackRoutes(),
        fallbackTimeoutMsByRoute: { primary: 100, secondary: 100 },
      }
    );
    setTimeout(() => controller.abort(new DOMException("Client disconnected", "AbortError")), 5);
    await assert.rejects(request, (error) => error?.name === "AbortError");
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Missevan single fallback preserves invalid JSON cause and failure kind", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{", { status: 200 });

  try {
    await assert.rejects(
      fetchMissevanJsonWithFallbackChain(
        "https://www.missevan.com/sound/getsound?soundid=3",
        {
          fallbackRoutes: [createTestMissevanFallbackRoutes()[0]],
          fallbackTimeoutMsByRoute: { primary: 100 },
        }
      ),
      (error) => {
        assert.equal(error.failureKind, "invalid_payload");
        assert.equal(error.status, 200);
        assert.equal(error.cause?.name, "SyntaxError");
        assert.equal(classifyRequestFailureOutcome({ error }), "invalid_payload");
        assert.doesNotMatch(JSON.stringify(error), /render-token|https:\/\//);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Missevan Render and Deno invalid JSON failures remain invalid_payload", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response("{", { status: 200 });
  };

  try {
    await assert.rejects(
      fetchMissevanJsonWithFallbackChain(
        "https://www.missevan.com/sound/getsound?soundid=4",
        {
          fallbackRoutes: createTestMissevanFallbackRoutes(),
          fallbackTimeoutMsByRoute: { primary: 100, secondary: 100 },
        }
      ),
      (error) => {
        assert.equal(error.failureKind, "invalid_payload");
        assert.equal(error.status, 200);
        assert.equal(error.cause?.name, "SyntaxError");
        assert.equal(classifyRequestFailureOutcome({ error }), "invalid_payload");
        return true;
      }
    );
    assert.equal(calls.length, 2);
    assert.match(calls[0], /render\.test/);
    assert.match(calls[1], /deno\.test/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Missevan fallback skips Deno after the parent budget is exhausted", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const controller = new AbortController();
  globalThis.fetch = async (url, options = {}) => {
    calls.push(String(url));
    return new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    });
  };

  try {
    const request = fetchMissevanJsonWithFallbackChain(
      "https://www.missevan.com/sound/getsound?soundid=4",
      {
        signal: controller.signal,
        fallbackRoutes: createTestMissevanFallbackRoutes(),
        fallbackTimeoutMsByRoute: { primary: 100, secondary: 100 },
      }
    );
    setTimeout(() => controller.abort(new Error("Search-card budget exhausted")), 5);
    await assert.rejects(request);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /render\.test/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("search-card reward timeout degrades to a null reward metric", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes("getdrama")) {
      return new Response(JSON.stringify({
        success: true,
        info: {
          drama: {
            id: 991234,
            name: "测试剧",
            cover: "",
            vip: 0,
            price: 0,
            view_count: 10,
            subscription_num: 2,
          },
          episodes: { episode: [] },
          cvs: [],
        },
      }), { status: 200 });
    }
    setTimeout(() => controller.abort(new Error("Request timeout after 20ms")), 5);
    return new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    });
  };

  try {
    const result = await fetchSearchCardMetrics("missevan", 991234, null, controller.signal);
    assert.equal(result.metrics.reward_num, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("search-card reward client cancellation is still propagated", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes("getdrama")) {
      return new Response(JSON.stringify({
        success: true,
        info: {
          drama: { id: 991235, name: "测试剧", cover: "", vip: 0, price: 0, view_count: 10 },
          episodes: { episode: [] },
          cvs: [],
        },
      }), { status: 200 });
    }
    setTimeout(() => controller.abort(new DOMException("Client disconnected", "AbortError")), 5);
    return new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    });
  };

  try {
    await assert.rejects(
      fetchSearchCardMetrics("missevan", 991235, null, controller.signal),
      (error) => error?.name === "AbortError"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Missevan play count plan requests selected episodes when selected is no larger", () => {
  const playCountDramas = normalizePlayCountDramas([
    {
      drama_id: 101,
      drama_title: "测试剧",
      total_view_count: 1000,
      total_episode_count: 4,
      episodes: [
        { sound_id: 11, episode_title: "第一集", selected: true },
        { sound_id: 12, episode_title: "第二集", selected: true },
        { sound_id: 13, episode_title: "第三集", selected: false },
        { sound_id: 14, episode_title: "第四集", selected: false },
      ],
    },
  ]);

  const plan = buildMissevanPlayCountWorkPlan({
    selectedEpisodes: [
      { drama_id: "101", sound_id: "11", drama_title: "测试剧", episode_title: "第一集" },
      { drama_id: "101", sound_id: "12", drama_title: "测试剧", episode_title: "第二集" },
    ],
    playCountDramas,
  });

  assert.equal(plan.totalRequestCount, 2);
  assert.equal(plan.dramas[0].calculationMode, "selected_sum");
  assert.deepEqual(plan.dramas[0].requestEpisodes.map((episode) => episode.sound_id), ["11", "12"]);
});

test("Missevan play count plan requests unselected episodes when they are fewer", () => {
  const playCountDramas = normalizePlayCountDramas([
    {
      drama_id: 101,
      drama_title: "测试剧",
      total_view_count: 1000,
      total_episode_count: 4,
      episodes: [
        { sound_id: 11, episode_title: "第一集", selected: true },
        { sound_id: 12, episode_title: "第二集", selected: true },
        { sound_id: 13, episode_title: "第三集", selected: true },
        { sound_id: 14, episode_title: "第四集", selected: false },
      ],
    },
  ]);

  const plan = buildMissevanPlayCountWorkPlan({
    selectedEpisodes: [
      { drama_id: "101", sound_id: "11", drama_title: "测试剧", episode_title: "第一集" },
      { drama_id: "101", sound_id: "12", drama_title: "测试剧", episode_title: "第二集" },
      { drama_id: "101", sound_id: "13", drama_title: "测试剧", episode_title: "第三集" },
    ],
    playCountDramas,
  });

  assert.equal(plan.totalRequestCount, 1);
  assert.equal(plan.dramas[0].calculationMode, "total_minus_unselected");
  assert.equal(plan.dramas[0].totalEpisodeCount, 4);
  assert.equal(plan.dramas[0].selectedEpisodeCount, 3);
  assert.deepEqual(plan.dramas[0].requestEpisodes.map((episode) => episode.sound_id), ["14"]);
});

test("Missevan play count plan falls back to selected episodes without a valid drama total", () => {
  const playCountDramas = normalizePlayCountDramas([
    {
      drama_id: 101,
      drama_title: "测试剧",
      total_view_count: "",
      total_episode_count: 4,
      episodes: [
        { sound_id: 11, episode_title: "第一集", selected: true },
        { sound_id: 12, episode_title: "第二集", selected: true },
        { sound_id: 13, episode_title: "第三集", selected: true },
        { sound_id: 14, episode_title: "第四集", selected: false },
      ],
    },
  ]);

  const plan = buildMissevanPlayCountWorkPlan({
    selectedEpisodes: [
      { drama_id: "101", sound_id: "11", drama_title: "测试剧", episode_title: "第一集" },
      { drama_id: "101", sound_id: "12", drama_title: "测试剧", episode_title: "第二集" },
      { drama_id: "101", sound_id: "13", drama_title: "测试剧", episode_title: "第三集" },
    ],
    playCountDramas,
  });

  assert.equal(plan.totalRequestCount, 3);
  assert.equal(plan.dramas[0].calculationMode, "selected_sum");
  assert.deepEqual(plan.dramas[0].requestEpisodes.map((episode) => episode.sound_id), ["11", "12", "13"]);
});

test("Missevan play count plan falls back when frontend context has missing drama total", () => {
  const playCountDramas = buildPlayCountDramasFromDramas([
    {
      drama: {
        id: 101,
        name: "缺播放量剧",
      },
      episodes: {
        episode: [
          { sound_id: 11, name: "第一集", selected: true },
          { sound_id: 12, name: "第二集", selected: true },
          { sound_id: 13, name: "第三集", selected: true },
          { sound_id: 14, name: "第四集", selected: false },
        ],
      },
    },
  ]);

  const plan = buildMissevanPlayCountWorkPlan({
    selectedEpisodes: [
      { drama_id: "101", sound_id: "11", drama_title: "缺播放量剧", episode_title: "第一集" },
      { drama_id: "101", sound_id: "12", drama_title: "缺播放量剧", episode_title: "第二集" },
      { drama_id: "101", sound_id: "13", drama_title: "缺播放量剧", episode_title: "第三集" },
    ],
    playCountDramas,
  });

  assert.equal(plan.totalRequestCount, 3);
  assert.equal(plan.dramas[0].calculationMode, "selected_sum");
  assert.deepEqual(plan.dramas[0].requestEpisodes.map((episode) => episode.sound_id), ["11", "12", "13"]);
});

test("Missevan play count subtract mode does not produce a deducted total after request failure", () => {
  const result = resolveMissevanPlayCountDramaTotal(
    {
      calculationMode: "total_minus_unselected",
      totalViewCount: 1000,
      playCountTotal: 0,
      playCountFailed: false,
    },
    120,
    true
  );

  assert.equal(result.playCountTotal, 0);
  assert.equal(result.playCountFailed, true);
});

test("stats task item counts include nested play count episodes", () => {
  assert.deepEqual(
    getStatsTaskItemCounts({
      taskType: "play_count",
      episodes: [{ sound_id: "1" }, { sound_id: "2" }],
      dramaIds: [1],
      playCountDramas: [
        { episodes: [{ sound_id: "1" }, { sound_id: "2" }, { sound_id: "3" }] },
        { episodes: [{ sound_id: "4" }] },
      ],
    }),
    {
      primary: 2,
      playCountDramas: 2,
      playCountEpisodes: 4,
    }
  );

  assert.equal(
    getStatsTaskItemCounts({
      taskType: "revenue",
      episodes: [{ sound_id: "1" }],
      dramaIds: [1, 2, 3],
      playCountDramas: [],
    }).primary,
    3
  );
});

test("stats task item limit accepts 1000 items and rejects 1001", () => {
  assert.equal(
    isStatsTaskItemLimitExceeded({
      primary: 1000,
      playCountDramas: 0,
      playCountEpisodes: 0,
    }),
    false
  );
  assert.equal(
    isStatsTaskItemLimitExceeded({
      primary: 1001,
      playCountDramas: 0,
      playCountEpisodes: 0,
    }),
    true
  );
});

test("stats task item limit accepts drama 81979 total and paid episode counts", () => {
  for (const episodeCount of [669, 603]) {
    assert.equal(
      isStatsTaskItemLimitExceeded({
        primary: episodeCount,
        playCountDramas: 1,
        playCountEpisodes: episodeCount,
      }),
      false
    );
  }
});

test("Missevan fetch options attach browser-like headers without Cookie", () => {
  const options = buildFetchOptions("https://www.missevan.com/sound/getsound?soundid=11", {
    missevan: true,
  });

  assert.equal(options.headers["Referer"], "https://www.missevan.com/");
  assert.match(options.headers["User-Agent"], /Mozilla\/5\.0/);
  assert.equal(options.headers.Cookie, undefined);
});

test("Manbo fetch options use a native-fetch dispatcher", () => {
  const options = buildFetchOptions("https://www.kilamanbo.com/api/v1/test");

  assert.equal(typeof options.dispatcher?.dispatch, "function");
  assert.equal("agent" in options, false);
});

test("Manbo Web APIs prefer kilaaudio and fall back to kilamanbo", async () => {
  assert.deepEqual(buildManboWebApiUrls("/getDanmaKuPgList?pageNo=1"), [
    "https://manbo.kilaaudio.com/web_manbo/getDanmaKuPgList?pageNo=1",
    "https://www.kilamanbo.com/web_manbo/getDanmaKuPgList?pageNo=1",
  ]);

  const requestedUrls = [];
  const data = await fetchManboWebJsonWithFallback("dramaDetail?dramaId=1", async (url) => {
    requestedUrls.push(url);
    if (url.includes("manbo.kilaaudio.com")) {
      throw new Error("primary unavailable");
    }
    return { code: 200, data: { radioDramaId: "1" } };
  });

  assert.equal(data.data.radioDramaId, "1");
  assert.deepEqual(requestedUrls, [
    "https://manbo.kilaaudio.com/web_manbo/dramaDetail?dramaId=1",
    "https://www.kilamanbo.com/web_manbo/dramaDetail?dramaId=1",
  ]);
});

test("Manbo Web API fallback stays idle when the primary succeeds", async () => {
  const requestedUrls = [];
  const data = await fetchManboWebJsonWithFallback("dramaSetDetail?dramaSetId=2", async (url) => {
    requestedUrls.push(url);
    return { code: 200, data: { setId: "2" } };
  });

  assert.equal(data.data.setId, "2");
  assert.deepEqual(requestedUrls, [
    "https://manbo.kilaaudio.com/web_manbo/dramaSetDetail?dramaSetId=2",
  ]);
});

test("Manbo parent timeout records only the primary host and skips legacy fallback", async () => {
  const controller = new AbortController();
  const requestedUrls = [];

  await assert.rejects(
    fetchManboWebJsonWithFallback(
      "dramaDetail?dramaId=3",
      async (url, { signal } = {}) => {
        requestedUrls.push(url);
        controller.abort(new Error("parent budget exhausted"));
        throw signal?.reason || new Error("parent budget exhausted");
      },
      { signal: controller.signal }
    ),
    (error) => {
      assert.deepEqual(error.failureKinds, ["timeout"]);
      assert.deepEqual(error.failedHosts, ["manbo.kilaaudio.com"]);
      assert.equal(error.failureSamples[0].failureKind, "timeout");
      return true;
    }
  );

  assert.deepEqual(requestedUrls, [
    "https://manbo.kilaaudio.com/web_manbo/dramaDetail?dramaId=3",
  ]);
});

test("Manbo client cancellation records cancelled and skips legacy fallback", async () => {
  const controller = new AbortController();
  const requestedUrls = [];

  await assert.rejects(
    fetchManboWebJsonWithFallback(
      "dramaDetail?dramaId=4",
      async (url, { signal } = {}) => {
        requestedUrls.push(url);
        controller.abort(new DOMException("client disconnected", "AbortError"));
        throw signal?.reason || new DOMException("client disconnected", "AbortError");
      },
      { signal: controller.signal }
    ),
    (error) => {
      assert.deepEqual(error.failureKinds, ["cancelled"]);
      assert.deepEqual(error.failedHosts, ["manbo.kilaaudio.com"]);
      assert.equal(error.failureSamples[0].failureKind, "cancelled");
      return true;
    }
  );

  assert.deepEqual(requestedUrls, [
    "https://manbo.kilaaudio.com/web_manbo/dramaDetail?dramaId=4",
  ]);
});

test("Manbo pre-aborted timeout does not request a host and keeps failed hosts empty", async () => {
  const controller = new AbortController();
  controller.abort(new Error("parent budget exhausted before Manbo request"));
  let requestCount = 0;

  await assert.rejects(
    fetchManboWebJsonWithFallback(
      "dramaDetail?dramaId=5",
      async () => {
        requestCount += 1;
        return { code: 200, data: { radioDramaId: "5" } };
      },
      { signal: controller.signal }
    ),
    (error) => {
      assert.deepEqual(error.failureKinds, ["timeout"]);
      assert.deepEqual(error.failedHosts, []);
      assert.deepEqual(error.hostFailures, []);
      assert.equal(error.manboFailureKind, "timeout");
      return true;
    }
  );

  assert.equal(requestCount, 0);
});

test("Manbo pre-aborted client cancellation does not request a host and keeps failed hosts empty", async () => {
  const controller = new AbortController();
  controller.abort(new DOMException("client disconnected", "AbortError"));
  let requestCount = 0;

  await assert.rejects(
    fetchManboWebJsonWithFallback(
      "dramaDetail?dramaId=6",
      async () => {
        requestCount += 1;
        return { code: 200, data: { radioDramaId: "6" } };
      },
      { signal: controller.signal }
    ),
    (error) => {
      assert.deepEqual(error.failureKinds, ["cancelled"]);
      assert.deepEqual(error.failedHosts, []);
      assert.deepEqual(error.hostFailures, []);
      assert.equal(error.manboFailureKind, "cancelled");
      return true;
    }
  );

  assert.equal(requestCount, 0);
});

test("Manbo local timeout or network failure still falls back when the parent is active", async () => {
  for (const failureKind of ["timeout", "network"]) {
    const controller = new AbortController();
    const requestedUrls = [];
    const data = await fetchManboWebJsonWithFallback(
      `dramaDetail?dramaId=${failureKind}`,
      async (url) => {
        requestedUrls.push(url);
        if (url.includes("manbo.kilaaudio.com")) {
          throw Object.assign(new Error(`${failureKind} at primary`), { failureKind });
        }
        return { code: 200, data: { radioDramaId: failureKind } };
      },
      { signal: controller.signal }
    );

    assert.equal(data.data.radioDramaId, failureKind);
    assert.equal(requestedUrls.length, 2);
    assert.match(requestedUrls[1], /www\.kilamanbo\.com/);
    assert.equal(controller.signal.aborted, false);
  }
});

test("Manbo Web API failure aggregates safe host summaries", async () => {
  await assert.rejects(
    fetchManboWebJsonWithFallback("dramaDetail?visitor_id=secret-value", async (url) => {
      if (url.includes("manbo.kilaaudio.com")) {
        throw Object.assign(
          new Error("fetch failed for https://manbo.kilaaudio.com/web_manbo?visitor_id=secret-value"),
          { code: "ENOTFOUND" }
        );
      }
      return { code: 503, data: null };
    }),
    (error) => {
      assert.deepEqual(error.failureKinds, ["network", "invalid_payload"]);
      assert.deepEqual(error.failedHosts, ["manbo.kilaaudio.com", "www.kilamanbo.com"]);
      assert.equal(error.failureSamples.length, 2);
      assert.equal(error.hostFailures[0].error, undefined);
      const serialized = JSON.stringify(error);
      assert.doesNotMatch(serialized, /visitor_id|secret-value|https:\/\//);
      return true;
    }
  );
});

test("Manbo Web API host failures classify HTTP status separately from network errors", async () => {
  await assert.rejects(
    fetchManboWebJsonWithFallback("dramaDetail?dramaId=1", async (url) => {
      if (url.includes("manbo.kilaaudio.com")) {
        throw Object.assign(new Error("upstream HTTP 503"), {
          name: "HttpStatusError",
          status: 503,
          code: "HTTP_503",
        });
      }
      throw Object.assign(new Error("socket unavailable"), { code: "ECONNRESET" });
    }),
    (error) => {
      assert.deepEqual(error.failureKinds, ["http_status", "network"]);
      assert.equal(error.failureSamples[0].httpStatus, 503);
      assert.equal(error.failureSamples[0].errorCode, "HTTP_503");
      return true;
    }
  );
});

test("Manbo HTTP 200 JSON parse failures are invalid payloads without httpStatus", async () => {
  await assert.rejects(
    fetchManboWebJsonWithFallback("dramaDetail?dramaId=7", async () => {
      const response = new Response("{", { status: 200 });
      try {
        await response.json();
      } catch (error) {
        error.status = response.status;
        throw error;
      }
    }),
    (error) => {
      assert.deepEqual(error.failureKinds, ["invalid_payload"]);
      assert.ok(error.failureSamples.every((sample) => sample.httpStatus === undefined));
      return true;
    }
  );
});

test("Manbo HTTP 200 body timeouts are timeout failures without httpStatus", async () => {
  await assert.rejects(
    fetchManboWebJsonWithFallback("dramaDetail?dramaId=8", async () => {
      throw Object.assign(new Error("response body timed out"), {
        name: "TimeoutError",
        status: 200,
      });
    }),
    (error) => {
      assert.deepEqual(error.failureKinds, ["timeout"]);
      assert.ok(error.failureSamples.every((sample) => sample.httpStatus === undefined));
      return true;
    }
  );
});

test("Manbo HTTP 200 client cancellation is cancelled without httpStatus", async () => {
  const controller = new AbortController();
  const requestedUrls = [];

  await assert.rejects(
    fetchManboWebJsonWithFallback(
      "dramaDetail?dramaId=9",
      async (url) => {
        requestedUrls.push(url);
        const error = Object.assign(new Error("client disconnected"), {
          name: "AbortError",
          status: 200,
        });
        controller.abort(error);
        throw error;
      },
      { signal: controller.signal }
    ),
    (error) => {
      assert.deepEqual(error.failureKinds, ["cancelled"]);
      assert.deepEqual(error.failedHosts, ["manbo.kilaaudio.com"]);
      assert.ok(error.failureSamples.every((sample) => sample.httpStatus === undefined));
      return true;
    }
  );

  assert.equal(requestedUrls.length, 1);
});

test("Manbo HTTP 500 remains http_status with httpStatus 500", async () => {
  await assert.rejects(
    fetchManboWebJsonWithFallback("dramaDetail?dramaId=10", async () => {
      throw Object.assign(new Error("upstream HTTP 500"), {
        name: "HttpStatusError",
        status: 500,
        code: "HTTP_500",
      });
    }),
    (error) => {
      assert.deepEqual(error.failureKinds, ["http_status"]);
      assert.ok(error.failureSamples.every((sample) => sample.httpStatus === 500));
      return true;
    }
  );
});

test("Missevan fallback URL maps upstream URLs to Render proxy", () => {
  assert.equal(
    buildMissevanFallbackUrl(
      "https://www.missevan.com/sound/getsound?soundid=11",
      "https://msbackup.onrender.com/missevan"
    ),
    "https://msbackup.onrender.com/missevan/sound/getsound?soundid=11"
  );
  assert.equal(
    buildMissevanFallbackUrl(
      "https://www.missevan.com/dramaapi/getdrama?drama_id=22",
      "https://msbackup.onrender.com/missevan/"
    ),
    "https://msbackup.onrender.com/missevan/dramaapi/getdrama?drama_id=22"
  );
  assert.equal(
    buildMissevanFallbackUrl(
      "https://www.missevan.com/dramaapi/getdramabysound?sound_id=33",
      "https://msbackup.mmtoolkit.deno.net/missevan"
    ),
    "https://msbackup.mmtoolkit.deno.net/missevan/dramaapi/getdramabysound?sound_id=33"
  );
});

test("Missevan route cooldown uses base duration first and repeat duration after expiry", () => {
  const now = 1_000_000;
  const baseState = buildMissevanRouteCooldownStateAfterAccessDenied(
    { accessUntil: 0, useShortCooldown: false, cooldownMode: "none" },
    { now, baseCooldownMs: 4 * 60 * 60 * 1000, repeatCooldownMs: 60 * 60 * 1000 }
  );

  assert.equal(baseState.accessUntil, now + 4 * 60 * 60 * 1000);
  assert.equal(baseState.cooldownMode, "base");
  assert.equal(baseState.useShortCooldown, false);

  const repeatReadyState = buildMissevanRouteCooldownStateAfterAccessDenied(
    { accessUntil: 0, useShortCooldown: true, cooldownMode: "repeat_ready" },
    { now, baseCooldownMs: 4 * 60 * 60 * 1000, repeatCooldownMs: 60 * 60 * 1000 }
  );

  assert.equal(repeatReadyState.accessUntil, now + 60 * 60 * 1000);
  assert.equal(repeatReadyState.cooldownMode, "repeat");
  assert.equal(repeatReadyState.useShortCooldown, true);
});

test("Missevan all-node retry time uses the nearest active route cooldown", () => {
  const now = 1_000_000;
  assert.equal(
    getNearestMissevanAccessUntil(
      [
        { accessUntil: now + 4 * 60 * 1000 },
        { accessUntil: now + 2 * 60 * 1000 },
        { accessUntil: now + 9 * 60 * 1000 },
      ],
      now
    ),
    now + 2 * 60 * 1000
  );
  assert.equal(
    getNearestMissevanAccessUntil(
      [
        { accessUntil: now - 1 },
        { accessUntil: 0 },
      ],
      now
    ),
    0
  );
});

test("Missevan request route priority is direct, Render, Deno, then blocked", () => {
  const now = 1_000_000;
  const activeUntil = now + 60_000;
  const route = (key, accessUntil, enabled = true) => ({
    key,
    enabled,
    state: { accessUntil },
  });

  assert.deepEqual(
    selectMissevanRequestRoute({
      now,
      directState: { accessUntil: 0 },
      fallbackRoutes: [
        route("primary", activeUntil),
        route("secondary", activeUntil),
      ],
    }),
    { type: "direct", routeKey: "direct", cooldownUntil: 0 }
  );
  assert.deepEqual(
    selectMissevanRequestRoute({
      now,
      directState: { accessUntil: activeUntil },
      fallbackRoutes: [
        route("primary", 0),
        route("secondary", 0),
      ],
    }),
    { type: "fallback", routeKey: "primary", cooldownUntil: 0 }
  );
  assert.deepEqual(
    selectMissevanRequestRoute({
      now,
      directState: { accessUntil: activeUntil },
      fallbackRoutes: [
        route("primary", now + 30_000),
        route("secondary", 0),
      ],
    }),
    { type: "fallback", routeKey: "secondary", cooldownUntil: 0 }
  );
  assert.deepEqual(
    selectMissevanRequestRoute({
      now,
      directState: { accessUntil: activeUntil },
      fallbackRoutes: [
        route("primary", now + 30_000),
        route("secondary", now + 90_000),
      ],
    }),
    { type: "blocked", routeKey: "", cooldownUntil: now + 30_000 }
  );
  assert.deepEqual(
    selectMissevanRequestRoute({
      now,
      directState: { accessUntil: 0 },
      fallbackRoutes: [
        route("primary", activeUntil),
        route("secondary", activeUntil),
      ],
    }),
    { type: "direct", routeKey: "direct", cooldownUntil: 0 }
  );
});

test("Missevan cooldown payload restores direct, Render, and Deno states", () => {
  assert.deepEqual(
    parseMissevanCooldownStatePayload({
      appVersion: "1.7.0",
      accessDeniedUntil: 11,
      accessDeniedCooldownMode: "base",
      accessDeniedUseShortCooldown: false,
      primaryAccessDeniedUntil: 22,
      primaryAccessDeniedCooldownMode: "repeat",
      primaryAccessDeniedUseShortCooldown: true,
      secondaryAccessDeniedUntil: 33,
      secondaryAccessDeniedCooldownMode: "repeat_ready",
      secondaryAccessDeniedUseShortCooldown: true,
    }),
    {
      appVersion: "1.7.0",
      direct: {
        accessUntil: 11,
        cooldownMode: "base",
        useShortCooldown: false,
      },
      primary: {
        accessUntil: 22,
        cooldownMode: "repeat",
        useShortCooldown: true,
      },
      secondary: {
        accessUntil: 33,
        cooldownMode: "repeat_ready",
        useShortCooldown: true,
      },
    }
  );
});

test("local runs ignore persistent Missevan cooldown even when local env opts in", () => {
  assert.equal(
    shouldPersistAccessDeniedCooldownForEnv({
      ENABLE_MISSEVAN: "true",
      MISSEVAN_PERSISTENT_COOLDOWN: "true",
      UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "token",
    }),
    false
  );
});

test("hosted runs can persist Missevan cooldown by default", () => {
  assert.equal(
    shouldPersistAccessDeniedCooldownForEnv({
      ENABLE_MISSEVAN: "true",
      RAILWAY_PROJECT_ID: "project-id",
      UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "token",
    }),
    true
  );
});
