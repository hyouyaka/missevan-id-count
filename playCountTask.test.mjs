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
  buildMissevanFallbackUrl,
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
