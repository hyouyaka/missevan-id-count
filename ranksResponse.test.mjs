import test from "node:test";
import assert from "node:assert/strict";

test("rank response appends normalized CV ranks per platform", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { buildNormalizedRanksResponse } = await import("./server.js");

  const snapshot = {
    _meta: { updated_at: "2026-06-10T08:00:00+00:00" },
    missevan: { ranks: {}, dramas: {} },
    manbo: { ranks: {}, dramas: {} },
  };
  const cvSnapshot = {
    version: 2,
    date: "2026-06-10",
    generated_at: "2026-06-10T09:30:00+00:00",
    missevanDramaCount: 842,
    manboDramaCount: 331,
    rankings: {
      missevan: [
        {
          cvName: "路知行",
          avatar: "https://avatar.test/missevan.jpg",
          totalViewCount: 1188561622,
          rank: 1,
          workCount: 2,
          works: [
            {
              platform: "missevan",
              dramaId: "22602",
              title: "魔道祖师 第三季",
              cover: "https://cover.test/missevan.jpg",
              mainCvs: ["路知行", "魏超"],
              viewCount: 295782463,
            },
          ],
        },
      ],
      manbo: [
        {
          cvName: "张福正",
          avatar: "https://avatar.test/manbo.jpg",
          totalViewCount: 248362571,
          rank: 1,
          works: [
            {
              platform: "manbo",
              dramaId: "1697533863498088523",
              title: "人鱼陷落·第一季",
              cover: "https://cover.test/manbo.jpg",
              mainCvs: ["张福正", "马正阳"],
              viewCount: 58396828,
            },
          ],
        },
      ],
    },
  };

  const response = buildNormalizedRanksResponse(snapshot, null, cvSnapshot);

  assert.equal(response.schemaVersion, 4);
  assert.deepEqual(response.cvSummary, {
    updatedAt: "2026-06-10T09:30:00+00:00",
    missevanDramaCount: 842,
    manboDramaCount: 331,
  });

  const missevanCvCategory = response.platforms.missevan.categories.find((category) => category.key === "cv");
  assert.equal(missevanCvCategory.label, "CV榜");
  assert.equal(missevanCvCategory.ranks[0].fetchedAt, "2026-06-10T09:30:00+00:00");
  assert.equal(missevanCvCategory.ranks[0].items[0].cvName, "路知行");
  assert.equal(missevanCvCategory.ranks[0].items[0].workCount, 2);
  assert.equal(missevanCvCategory.ranks[0].items[0].topWorks[0].title, "魔道祖师 第三季");
  assert.equal(missevanCvCategory.ranks[0].items[0].works[0].dramaId, "22602");

  const manboCvCategory = response.platforms.manbo.categories.find((category) => category.key === "cv");
  assert.equal(manboCvCategory.ranks[0].items[0].works[0].platform, "manbo");
});

test("rank response keeps ordinary ranks when CV snapshot is unavailable", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { buildNormalizedRanksResponse } = await import("./server.js");

  const response = buildNormalizedRanksResponse(
    {
      _meta: { updated_at: "2026-06-10T08:00:00+00:00" },
      missevan: { ranks: {}, dramas: {} },
      manbo: { ranks: {}, dramas: {} },
    },
    null,
    null
  );

  assert.equal(response.schemaVersion, 4);
  assert.equal(response.cvSummary.updatedAt, "");
  assert.equal(response.platforms.missevan.categories.some((category) => category.key === "cv"), false);
  assert.equal(response.platforms.manbo.categories.some((category) => category.key === "cv"), false);
});

test("rank meta probe schedule uses fixed UTC-04 ordinary script phases", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { getRanksMetaProbePlan } = await import("./server.js");

  assert.deepEqual(
    getRanksMetaProbePlan(new Date("2026-06-12T23:05:00.000Z")).normal,
    { active: false, phase: "idle", ttlMs: Infinity }
  );
  assert.deepEqual(
    getRanksMetaProbePlan(new Date("2026-06-12T23:06:00.000Z")).normal,
    { active: true, phase: "normal-warmup", ttlMs: 10 * 60 * 1000 }
  );
  assert.deepEqual(
    getRanksMetaProbePlan(new Date("2026-06-13T00:36:00.000Z")).normal,
    { active: true, phase: "normal-expected", ttlMs: 2 * 60 * 1000 }
  );
  assert.deepEqual(
    getRanksMetaProbePlan(new Date("2026-06-13T01:36:00.000Z")).normal,
    { active: true, phase: "normal-fallback", ttlMs: 10 * 60 * 1000 }
  );
  assert.deepEqual(
    getRanksMetaProbePlan(new Date("2026-06-13T04:00:00.000Z")).normal,
    { active: false, phase: "idle", ttlMs: Infinity }
  );
});

test("rank meta probe schedule uses fixed UTC-04 Thursday CV script phases", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { getRanksMetaProbePlan } = await import("./server.js");

  assert.deepEqual(
    getRanksMetaProbePlan(new Date("2026-06-19T03:05:00.000Z")).cv,
    { active: false, phase: "idle", ttlMs: Infinity }
  );
  assert.deepEqual(
    getRanksMetaProbePlan(new Date("2026-06-19T03:06:00.000Z")).cv,
    { active: true, phase: "cv-warmup", ttlMs: 10 * 60 * 1000 }
  );
  assert.deepEqual(
    getRanksMetaProbePlan(new Date("2026-06-19T04:16:00.000Z")).cv,
    { active: true, phase: "cv-expected", ttlMs: 2 * 60 * 1000 }
  );
  assert.deepEqual(
    getRanksMetaProbePlan(new Date("2026-06-19T05:06:00.000Z")).cv,
    { active: true, phase: "cv-fallback", ttlMs: 10 * 60 * 1000 }
  );
  assert.deepEqual(
    getRanksMetaProbePlan(new Date("2026-06-19T08:00:00.000Z")).cv,
    { active: false, phase: "idle", ttlMs: Infinity }
  );
});

test("rank meta refresh decision reads no big keys when versions are unchanged", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { buildRanksMetaRefreshDecision } = await import("./server.js");

  assert.deepEqual(
    buildRanksMetaRefreshDecision(
      { normalUpdatedAt: "2026-06-12T21:20:00-04:00", cvUpdatedAt: "2026-06-13T00:44:24-04:00" },
      {
        normal: { updatedAt: "2026-06-12T21:20:00-04:00" },
        cv: { updatedAt: "2026-06-13T00:44:24-04:00" },
      }
    ),
    {
      normalUpdatedAt: "2026-06-12T21:20:00-04:00",
      cvUpdatedAt: "2026-06-13T00:44:24-04:00",
      refreshNormal: false,
      refreshCv: false,
    }
  );
});

test("rank meta refresh decision refreshes only changed sources", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { buildRanksMetaRefreshDecision } = await import("./server.js");

  assert.deepEqual(
    buildRanksMetaRefreshDecision(
      { normalUpdatedAt: "old-normal", cvUpdatedAt: "same-cv" },
      { normal: { updatedAt: "new-normal" }, cv: { updatedAt: "same-cv" } }
    ),
    {
      normalUpdatedAt: "new-normal",
      cvUpdatedAt: "same-cv",
      refreshNormal: true,
      refreshCv: false,
    }
  );

  assert.deepEqual(
    buildRanksMetaRefreshDecision(
      { normalUpdatedAt: "same-normal", cvUpdatedAt: "old-cv" },
      { normal: { updatedAt: "same-normal" }, cv: { updatedAt: "new-cv" } }
    ),
    {
      normalUpdatedAt: "same-normal",
      cvUpdatedAt: "new-cv",
      refreshNormal: false,
      refreshCv: true,
    }
  );
});

test("rank meta probe TTL backs off successful normal refresh for the current cycle", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const {
    getRanksMetaProbeCycleIds,
    getRanksMetaProbePlan,
    getRanksMetaProbeTtlForState,
  } = await import("./server.js");

  const now = new Date("2026-06-13T00:36:00.000Z");
  const probePlan = getRanksMetaProbePlan(now);
  const cycleIds = getRanksMetaProbeCycleIds(now);

  assert.equal(cycleIds.normal, "normal:2026-06-12");
  assert.equal(getRanksMetaProbeTtlForState(probePlan, cycleIds, {}), 2 * 60 * 1000);
  assert.equal(
    getRanksMetaProbeTtlForState(probePlan, cycleIds, {
      normal: { cycleId: "normal:2026-06-12" },
    }),
    30 * 60 * 1000
  );
  assert.equal(
    getRanksMetaProbeTtlForState(probePlan, cycleIds, {
      normal: { cycleId: "normal:2026-06-11" },
    }),
    2 * 60 * 1000
  );
});

test("rank meta probe TTL uses the smaller active source TTL after one source backs off", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const {
    getRanksMetaProbeCycleIds,
    getRanksMetaProbePlan,
    getRanksMetaProbeTtlForState,
  } = await import("./server.js");

  const now = new Date("2026-06-19T03:30:00.000Z");
  const probePlan = getRanksMetaProbePlan(now);
  const cycleIds = getRanksMetaProbeCycleIds(now);

  assert.deepEqual(cycleIds, {
    normal: "normal:2026-06-18",
    cv: "cv:2026-06-18",
  });
  assert.equal(
    getRanksMetaProbeTtlForState(probePlan, cycleIds, {
      normal: { cycleId: "normal:2026-06-18" },
    }),
    10 * 60 * 1000
  );
});

test("rank meta CV cycle id keeps the Thursday date after midnight", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const {
    getRanksMetaProbeCycleIds,
    getRanksMetaProbePlan,
    getRanksMetaProbeTtlForState,
  } = await import("./server.js");

  const now = new Date("2026-06-19T04:16:00.000Z");
  const probePlan = getRanksMetaProbePlan(now);
  const cycleIds = getRanksMetaProbeCycleIds(now);

  assert.equal(cycleIds.cv, "cv:2026-06-18");
  assert.equal(getRanksMetaProbeTtlForState(probePlan, cycleIds, {}), 2 * 60 * 1000);
  assert.equal(
    getRanksMetaProbeTtlForState(probePlan, cycleIds, {
      cv: { cycleId: "cv:2026-06-18" },
    }),
    30 * 60 * 1000
  );
});

test("admin cache refresh executor requires a configured token", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { executeAdminCacheRefresh } = await import("./server.js");

  const result = await executeAdminCacheRefresh(
    {
      authorization: "Bearer secret",
      body: { target: "ranks", force: true },
    },
    { adminToken: "" }
  );

  assert.equal(result.status, 404);
  assert.equal(result.payload.success, false);
});

test("admin cache refresh executor rejects invalid bearer tokens", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { executeAdminCacheRefresh } = await import("./server.js");

  const result = await executeAdminCacheRefresh(
    {
      authorization: "Bearer wrong",
      body: { target: "ranks", force: true },
    },
    { adminToken: "secret" }
  );

  assert.equal(result.status, 403);
  assert.equal(result.payload.success, false);
});

test("admin cache refresh executor refreshes requested targets and writes a usage log", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { executeAdminCacheRefresh } = await import("./server.js");
  const calls = [];
  const logs = [];

  const result = await executeAdminCacheRefresh(
    {
      authorization: "Bearer secret",
      body: { target: "ranks", force: true, reason: "manual patch" },
    },
    {
      adminToken: "secret",
      refreshRanks: async (options) => {
        calls.push(["ranks", options]);
        return {
          target: "ranks",
          success: true,
          cacheStatus: "normal-refresh+cv-refresh",
          normalUpdatedAt: "normal-new",
          cvUpdatedAt: "cv-new",
        };
      },
      refreshOngoing: async (platform) => {
        calls.push(["ongoing", platform]);
        return { target: `ongoing:${platform}`, success: true };
      },
      writeLog: async (entry) => {
        logs.push(entry);
      },
    }
  );

  assert.equal(result.status, 200);
  assert.equal(result.payload.success, true);
  assert.deepEqual(calls, [["ranks", { target: "ranks", force: true }]]);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].action, "cache_refresh");
  assert.equal(logs[0].target, "ranks");
  assert.equal(logs[0].force, true);
  assert.equal(logs[0].reason, "manual patch");
  assert.equal(logs[0].normalUpdatedAt, "normal-new");
  assert.equal(logs[0].cvUpdatedAt, "cv-new");
  assert.deepEqual(logs[0].errors, []);
});

test("admin cache refresh executor refreshes ongoing platforms and logs failures without throwing", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { executeAdminCacheRefresh } = await import("./server.js");
  const calls = [];
  const logs = [];

  const result = await executeAdminCacheRefresh(
    {
      authorization: "Bearer secret",
      body: { target: "ongoing", force: true },
    },
    {
      adminToken: "secret",
      refreshOngoing: async (platform) => {
        calls.push(platform);
        if (platform === "manbo") {
          throw new Error("upstash unavailable");
        }
        return { target: `ongoing:${platform}`, success: true };
      },
      writeLog: async (entry) => {
        logs.push(entry);
      },
    }
  );

  assert.equal(result.status, 207);
  assert.equal(result.payload.success, false);
  assert.deepEqual(calls, ["missevan", "manbo"]);
  assert.equal(logs[0].action, "cache_refresh");
  assert.equal(logs[0].success, false);
  assert.deepEqual(logs[0].errors, ["ongoing:manbo: upstash unavailable"]);
});

test("admin ranks force refresh does not partially mutate cache when a requested source fails", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { __getRanksCacheForTest, __setRanksCacheForTest, refreshAdminRanksCacheTarget } = await import("./server.js");

  __setRanksCacheForTest({
    normalSnapshot: { _meta: { updated_at: "old-normal" }, ranks: [] },
    peakTrendSnapshot: { old: true },
    cvSnapshot: { generated_at: "old-cv", items: [] },
    normalUpdatedAt: "old-normal",
    cvUpdatedAt: "old-cv",
    response: {
      success: true,
      schemaVersion: 4,
      updatedAt: "old-normal",
      cvSummary: { updatedAt: "old-cv" },
    },
    loadedAt: Date.now(),
  });

  await assert.rejects(
    () =>
      refreshAdminRanksCacheTarget({
        target: "ranks",
        force: true,
        readNormalRanksBundle: async () => ({
          snapshot: { _meta: { updated_at: "new-normal" }, ranks: [] },
          peakTrendSnapshot: { new: true },
          updatedAt: "new-normal",
        }),
        readCvRanksBundle: async () => {
          throw new Error("cv unavailable");
        },
      }),
    /cv unavailable/
  );

  const cache = __getRanksCacheForTest();
  assert.equal(cache.normalUpdatedAt, "old-normal");
  assert.deepEqual(cache.normalSnapshot, { _meta: { updated_at: "old-normal" }, ranks: [] });
  assert.deepEqual(cache.peakTrendSnapshot, { old: true });
  assert.equal(cache.response.updatedAt, "old-normal");
});

test("admin ranks CV force refresh on a cold cache reads only the CV bundle", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { __getRanksCacheForTest, __setRanksCacheForTest, refreshAdminRanksCacheTarget } = await import("./server.js");
  let normalCalls = 0;
  let cvCalls = 0;

  __setRanksCacheForTest({
    normalSnapshot: null,
    peakTrendSnapshot: null,
    cvSnapshot: null,
    normalUpdatedAt: "",
    cvUpdatedAt: "",
    response: null,
    loadedAt: 0,
  });

  const result = await refreshAdminRanksCacheTarget({
    target: "ranks:cv",
    force: true,
    readNormalRanksBundle: async () => {
      normalCalls += 1;
      throw new Error("normal bundle should not be read");
    },
    readCvRanksBundle: async () => {
      cvCalls += 1;
      return {
        cvSnapshot: {
          generated_at: "new-cv",
          rankings: {},
        },
        updatedAt: "new-cv",
      };
    },
  });

  assert.equal(normalCalls, 0);
  assert.equal(cvCalls, 1);
  assert.equal(result.success, true);
  assert.equal(result.cvUpdatedAt, "new-cv");
  assert.equal(__getRanksCacheForTest().response, null);
});

test("admin ranks normal force refresh on a cold cache reads only the normal bundle", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { __setRanksCacheForTest, refreshAdminRanksCacheTarget } = await import("./server.js");
  let normalCalls = 0;
  let cvCalls = 0;

  __setRanksCacheForTest({
    normalSnapshot: null,
    peakTrendSnapshot: null,
    cvSnapshot: null,
    normalUpdatedAt: "",
    cvUpdatedAt: "",
    response: null,
    loadedAt: 0,
  });

  const result = await refreshAdminRanksCacheTarget({
    target: "ranks:normal",
    force: true,
    readNormalRanksBundle: async () => {
      normalCalls += 1;
      return {
        snapshot: {
          _meta: { updated_at: "new-normal" },
          missevan: { ranks: {}, dramas: {} },
          manbo: { ranks: {}, dramas: {} },
        },
        peakTrendSnapshot: null,
        updatedAt: "new-normal",
      };
    },
    readCvRanksBundle: async () => {
      cvCalls += 1;
      throw new Error("CV bundle should not be read");
    },
  });

  assert.equal(normalCalls, 1);
  assert.equal(cvCalls, 0);
  assert.equal(result.success, true);
  assert.equal(result.normalUpdatedAt, "new-normal");
});

test("admin ranks non-force refresh does not poison a cold cache when meta is unavailable", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { __getRanksCacheForTest, __setRanksCacheForTest, refreshAdminRanksCacheTarget } = await import("./server.js");

  __setRanksCacheForTest({
    normalSnapshot: null,
    peakTrendSnapshot: null,
    cvSnapshot: null,
    normalUpdatedAt: "",
    cvUpdatedAt: "",
    response: null,
    loadedAt: 0,
  });

  const result = await refreshAdminRanksCacheTarget({
    target: "ranks",
    force: false,
    readRanksMeta: async () => null,
    readNormalRanksBundle: async () => {
      throw new Error("normal bundle should not be read without meta change");
    },
    readCvRanksBundle: async () => {
      throw new Error("CV bundle should not be read without meta change");
    },
  });

  assert.equal(result.success, true);
  assert.equal(__getRanksCacheForTest().response, null);
});

test("rank response cache validator changes when only CV ranks update", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { getRanksResponseCacheValidator } = await import("./server.js");

  const normalVersion = "2026-06-12T23:10:00+00:00";
  const firstValidator = getRanksResponseCacheValidator({
    schemaVersion: 4,
    updatedAt: normalVersion,
    cvSummary: { updatedAt: "2026-06-12T04:04:24+00:00" },
  });
  const secondValidator = getRanksResponseCacheValidator({
    schemaVersion: 4,
    updatedAt: normalVersion,
    cvSummary: { updatedAt: "2026-06-13T04:04:24+00:00" },
  });

  assert.notEqual(firstValidator, secondValidator);
  assert.match(secondValidator, /2026-06-12T23:10:00\+00:00/);
  assert.match(secondValidator, /2026-06-13T04:04:24\+00:00/);
});
