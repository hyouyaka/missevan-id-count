import test from "node:test";
import assert from "node:assert/strict";

test("ongoing new-drama month uses the Beijing calendar boundary", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { getBeijingYearMonth } = await import("./server.js");

  assert.equal(getBeijingYearMonth("2026-06-30T15:59:59.999Z"), "2026.06");
  assert.equal(getBeijingYearMonth("2026-06-30T16:00:00.000Z"), "2026.07");
  assert.equal(getBeijingYearMonth("2026-12-31T16:00:00.000Z"), "2027.01");
});

test("cold ranks batch parser tolerates malformed optional JSON only when requested", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { parseRanksBatchJson } = await import("./server.js");

  assert.equal(parseRanksBatchJson("{broken", null, { tolerateError: true }), null);
  assert.throws(() => parseRanksBatchJson("{broken"), SyntaxError);
});

test("CV v2 reconstruction keeps both aggregate shells when one platform has no matching field", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { buildCvRankTrendV2Snapshots } = await import("./server.js");
  const snapshots = buildCvRankTrendV2Snapshots([
    JSON.stringify({
      version: 2,
      kind: "cv",
      platforms: {
        missevan: { updated_at: "2026-07-10", dates: ["2026-07-10"] },
        manbo: { updated_at: "2026-07-10", dates: ["2026-07-10"] },
      },
    }),
    JSON.stringify({ cvName: "路知行", samples: { "2026-07-10": { metrics: { totalViewCount: 10 } } } }),
    null,
  ], "路知行");

  assert.deepEqual(Object.keys(snapshots.missevan.cvs), ["路知行"]);
  assert.deepEqual(snapshots.manbo.cvs, {});
});

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

  const response = buildNormalizedRanksResponse(snapshot, null, cvSnapshot, {
    meta: {
      normal: {
        updatedAt: "2026-06-10T08:00:00+00:00",
        publishedAt: "2026-06-10T08:05:00+00:00",
      },
      cv: {
        updatedAt: "2026-06-10T09:30:00+00:00",
        publishedAt: "2026-06-10T09:35:00+00:00",
      },
    },
  });

  assert.equal(response.schemaVersion, 6);
  assert.deepEqual(response.meta, {
    normal: { publishedAt: "2026-06-10T08:05:00+00:00" },
    cv: { publishedAt: "2026-06-10T09:35:00+00:00" },
    growth: { publishedAt: "" },
  });
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

test("rank response exposes CV total and paid ranks with playback deltas", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { buildNormalizedRanksResponse } = await import("./server.js");

  const snapshot = {
    _meta: { updated_at: "2026-06-19T08:00:00+00:00" },
    missevan: { ranks: {}, dramas: {} },
    manbo: { ranks: {}, dramas: {} },
  };
  const cvSnapshot = {
    generated_at: "2026-06-19T04:04:53+00:00",
    rankings: {
      missevan: [
        {
          cvName: "路知行",
          totalViewCount: 1190603800,
          rank: 1,
          works: [{ dramaId: "22602", title: "魔道祖师 第三季", viewCount: 295982382 }],
        },
      ],
    },
    paidRankings: {
      missevan: [
        {
          cvName: "路知行",
          totalViewCount: 1183878183,
          rank: 1,
          works: [{ dramaId: "22602", title: "魔道祖师 第三季", viewCount: 295982382, isPaid: true }],
        },
      ],
    },
  };
  const cvTrendSnapshots = {
    missevan: {
      platform: "missevan",
      dates: ["2026-06-13"],
      cvs: {
        "路知行": {
          cvName: "路知行",
          samples: {
            "2026-06-13": {
              generated_at: "2026-06-13T02:38:36+00:00",
              metrics: {
                totalViewCount: 1189097577,
              },
              ranks: {
                total: 1,
              },
            },
            "2026-06-19": {
              generated_at: "2026-06-19T01:00:00+00:00",
              metrics: {
                totalViewCount: 1190000000,
              },
              ranks: {
                total: 1,
              },
            },
          },
        },
      },
    },
  };

  const response = buildNormalizedRanksResponse(snapshot, null, cvSnapshot, {
    cvTrendSnapshots,
  });
  const cvCategory = response.platforms.missevan.categories.find((category) => category.key === "cv");

  assert.deepEqual(
    cvCategory.ranks.map((rank) => [rank.key, rank.label, rank.name]),
    [
      ["cv", "总榜", "CV总榜"],
      ["cv-paid", "付费榜", "CV付费榜"],
    ]
  );
  assert.equal(cvCategory.ranks[0].items[0].trendKind, "cv");
  assert.equal(cvCategory.ranks[0].items[0].trendScope, "total");
  assert.equal(cvCategory.ranks[0].items[0].playbackDelta.available, true);
  assert.equal(cvCategory.ranks[0].items[0].playbackDelta.delta, 1506223);
  assert.equal(cvCategory.ranks[1].items[0].trendKind, "cv");
  assert.equal(cvCategory.ranks[1].items[0].trendScope, "paid");
  assert.equal(cvCategory.ranks[1].items[0].playbackDelta.available, false);
  assert.equal(cvCategory.ranks[1].items[0].playbackDelta.delta, null);
});

test("rank response inserts weekly growth ranks before CV with periods and string ids", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { buildNormalizedRanksResponse } = await import("./server.js");
  const snapshot = {
    _meta: { updated_at: "2026-08-31T08:00:00+00:00" },
    missevan: { ranks: {}, dramas: {} },
    manbo: { ranks: {}, dramas: {} },
  };
  const cvSnapshot = {
    generated_at: "2026-09-03T04:00:00+00:00",
    missevanDramaCount: 842,
    manboDramaCount: 331,
    rankings: {
      missevan: [{ cvName: "甲", rank: 1, works: [] }],
      manbo: [{ cvName: "乙", rank: 1, works: [] }],
    },
  };
  const growthSnapshot = {
    version: 1,
    kind: "weeklyViewGrowth",
    date: "2026-09-03",
    generated_at: "2026-09-03T05:00:00+00:00",
    missevanDramaCount: 901,
    manboDramaCount: 402,
    statisticsPeriods: {
      weekly: {
        missevan: { startDate: "2026-08-27", endDate: "2026-09-03" },
        manbo: { startDate: "2026-08-27", endDate: "2026-09-03" },
      },
      fourWeek: {
        missevan: { startDate: "2026-08-06", endDate: "2026-09-03" },
        manbo: { startDate: "2026-08-06", endDate: "2026-09-03" },
      },
    },
    rankings: {
      weekly: {
        missevan: [{ rank: 1, platform: "missevan", dramaId: "22602", title: "猫耳测试剧", viewCount: 295782463, viewCountIncrease: 123456, mainCvs: ["甲", "乙"], catalogName: "广播剧", payStatus: "付费", createTime: "2024-01-02" }],
        manbo: [{ rank: 1, platform: "manbo", dramaId: "1697533863498088523", title: "漫播测试剧", viewCount: 58396828, viewCountIncrease: 654321, mainCvs: ["乙"], catalogName: "有声书", payStatus: "会员", createTime: "2025-02-03" }],
      },
      fourWeek: {
        missevan: [],
        manbo: [],
      },
    },
  };

  const response = buildNormalizedRanksResponse(
    snapshot,
    null,
    cvSnapshot,
    {
      meta: {
        cv: {
          resources: {
            "ranks:cv:latest": { updatedAt: "cv-version", publishedAt: "cv-published" },
          },
        },
        watchcountGrowth: {
          updatedAt: "growth-version",
          publishedAt: "growth-published",
          resources: {
            "ranks:weekly-growth:latest": { updatedAt: "growth-version", publishedAt: "growth-published" },
          },
        },
      },
    },
    growthSnapshot,
    {
      missevan: { "22602": "https://cover.test/missevan.jpg" },
      manbo: { "1697533863498088523": "https://cover.test/manbo.jpg" },
    }
  );

  assert.deepEqual(response.growthSummary, {
    updatedAt: "2026-09-03T05:00:00+00:00",
    date: "2026-09-03",
    missevanDramaCount: 901,
    manboDramaCount: 402,
  });
  assert.equal(response.meta.growth.publishedAt, "growth-published");
  assert.equal(response.meta.cv.publishedAt, "cv-published");
  for (const platform of ["missevan", "manbo"]) {
    assert.deepEqual(
      response.platforms[platform].categories.map((category) => category.key),
      ["growth", "cv"]
    );
    const growth = response.platforms[platform].categories[0];
    assert.equal(growth.label, "飙升榜");
    assert.deepEqual(growth.ranks.map((rank) => [rank.key, rank.label, rank.name]), [
      ["growth_weekly", "周榜", "7日飙升榜"],
      ["growth_monthly", "月榜", "4周飙升榜"],
    ]);
    assert.deepEqual(growth.ranks[0].statisticsPeriod, {
      startDate: "2026-08-27",
      endDate: "2026-09-03",
    });
  }
  const missevanItem = response.platforms.missevan.categories[0].ranks[0].items[0];
  assert.equal(missevanItem.id, "22602");
  assert.equal(missevanItem.cover, "https://cover.test/missevan.jpg");
  assert.equal(missevanItem.view_count_increase, 123456);
  assert.equal(missevanItem.main_cv_text, "主要CV：甲，乙");
  assert.equal(missevanItem.payment_label, "付费");
  assert.equal(missevanItem.create_time, "2024-01-02");
  const manboItem = response.platforms.manbo.categories[0].ranks[0].items[0];
  assert.equal(manboItem.id, "1697533863498088523");
  assert.equal(typeof manboItem.id, "string");
  assert.equal(manboItem.content_type_label, "有声剧");

  const growthWithoutMissevanCount = { ...growthSnapshot };
  delete growthWithoutMissevanCount.missevanDramaCount;
  const responseWithoutGrowthCounts = buildNormalizedRanksResponse(
    snapshot,
    null,
    cvSnapshot,
    {},
    { ...growthWithoutMissevanCount, manboDramaCount: null }
  );
  assert.equal(responseWithoutGrowthCounts.growthSummary.missevanDramaCount, null);
  assert.equal(responseWithoutGrowthCounts.growthSummary.manboDramaCount, null);
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

  assert.equal(response.schemaVersion, 6);
  assert.deepEqual(response.meta, {
    normal: { publishedAt: "" },
    cv: { publishedAt: "" },
    growth: { publishedAt: "" },
  });
  assert.equal(response.cvSummary.updatedAt, "");
  assert.equal(response.platforms.missevan.categories.some((category) => category.key === "cv"), false);
  assert.equal(response.platforms.manbo.categories.some((category) => category.key === "cv"), false);
});

test("rank response preserves 30-item and 50-item Missevan popular and bestseller ranks", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { buildNormalizedRanksResponse } = await import("./server.js");
  const rankKeys = [
    "popular_weekly",
    "popular_monthly",
    "bestseller_weekly",
    "bestseller_monthly",
  ];

  for (const itemCount of [30, 50]) {
    const ids = Array.from({ length: itemCount }, (_, index) => String(10000 + index));
    const dramas = Object.fromEntries(ids.map((id, index) => [
      id,
      {
        name: `测试剧集 ${index + 1}`,
        view_count: 1000 + index,
        subscription_num: 100 + index,
        danmaku_uid_count: index >= 30 ? "  无需抓取  " : index,
      },
    ]));
    const ranks = Object.fromEntries(rankKeys.map((key) => [
      key,
      { name: key, items: ids },
    ]));

    const response = buildNormalizedRanksResponse({
      missevan: { ranks, dramas },
      manbo: { ranks: {}, dramas: {} },
    });
    const ordinaryRanks = response.platforms.missevan.categories
      .filter((category) => ["popular", "bestseller"].includes(category.key))
      .flatMap((category) => category.ranks);

    assert.deepEqual(ordinaryRanks.map((rank) => rank.key), rankKeys);
    ordinaryRanks.forEach((rank) => {
      assert.equal(rank.items.length, itemCount);
      assert.equal(rank.items.at(-1).rank, itemCount);
      assert.equal(rank.items.at(-1).id, 10000 + itemCount - 1);
      assert.equal(rank.items[29].danmaku_uid_count, 29);
      if (itemCount === 50) {
        assert.equal(rank.items[30].danmaku_uid_count, null);
        assert.equal(rank.items[49].danmaku_uid_count, null);
      }
    });
  }
});

test("cold ranks response reads and exposes published times from ranks meta", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { __setRanksCacheForTest, getCachedRanksResponse } = await import("./server.js");
  let metaCalls = 0;

  __setRanksCacheForTest({
    normalSnapshot: null,
    peakTrendSnapshot: null,
    cvSnapshot: null,
    cvTrendSnapshots: null,
    cvBaselineSnapshot: null,
    normalUpdatedAt: "",
    cvUpdatedAt: "",
    response: null,
    loadedAt: 0,
    loadPromise: null,
    meta: null,
    metaLoadedAt: 0,
    metaLoadFailedAt: 0,
    metaLoadPromise: null,
    metaPostRefreshBackoff: {},
  });

  const result = await getCachedRanksResponse({
    now: Date.parse("2026-06-20T12:00:00.000Z"),
    readNormalRanksBundle: async () => ({
      snapshot: {
        _meta: { updated_at: "normal-version" },
        missevan: { ranks: {}, dramas: {} },
        manbo: { ranks: {}, dramas: {} },
      },
      peakTrendSnapshot: null,
      updatedAt: "normal-version",
    }),
    readCvRanksBundle: async () => ({
      cvSnapshot: { generated_at: "cv-version", rankings: {} },
      cvTrendSnapshots: null,
      cvBaselineSnapshot: null,
      updatedAt: "cv-version",
    }),
    readGrowthRanksBundle: async () => ({
      weeklyGrowthSnapshot: null,
      weeklyGrowthCovers: { missevan: {}, manbo: {} },
      weeklyGrowthUpdatedAt: "",
    }),
    readRanksMeta: async () => {
      metaCalls += 1;
      return {
        normal: {
          updatedAt: "normal-version",
          publishedAt: "2026-06-20T08:05:00+00:00",
        },
        cv: {
          updatedAt: "cv-version",
          publishedAt: "2026-06-19T04:10:00+00:00",
        },
      };
    },
  });

  assert.equal(result.cacheStatus, "cold-refresh");
  assert.equal(metaCalls, 1);
  assert.deepEqual(result.response.meta, {
    normal: { publishedAt: "2026-06-20T08:05:00+00:00" },
    cv: { publishedAt: "2026-06-19T04:10:00+00:00" },
    growth: { publishedAt: "" },
  });
});

test("cold ranks response keeps rank data when ranks meta is unavailable", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { __setRanksCacheForTest, getCachedRanksResponse } = await import("./server.js");

  __setRanksCacheForTest({
    normalSnapshot: null,
    peakTrendSnapshot: null,
    cvSnapshot: null,
    cvTrendSnapshots: null,
    cvBaselineSnapshot: null,
    normalUpdatedAt: "",
    cvUpdatedAt: "",
    response: null,
    loadedAt: 0,
    loadPromise: null,
    meta: null,
    metaLoadedAt: 0,
    metaLoadFailedAt: 0,
    metaLoadPromise: null,
    metaPostRefreshBackoff: {},
  });

  const warn = console.warn;
  console.warn = () => {};
  try {
    const result = await getCachedRanksResponse({
      now: Date.parse("2026-06-20T12:00:00.000Z"),
      readNormalRanksBundle: async () => ({
        snapshot: {
          _meta: { updated_at: "normal-version" },
          missevan: { ranks: {}, dramas: {} },
          manbo: { ranks: {}, dramas: {} },
        },
        peakTrendSnapshot: null,
        updatedAt: "normal-version",
      }),
      readCvRanksBundle: async () => ({
        cvSnapshot: null,
        cvTrendSnapshots: null,
        cvBaselineSnapshot: null,
        updatedAt: "",
      }),
      readGrowthRanksBundle: async () => ({
        weeklyGrowthSnapshot: null,
        weeklyGrowthCovers: { missevan: {}, manbo: {} },
        weeklyGrowthUpdatedAt: "",
      }),
      readRanksMeta: async () => {
        throw new Error("meta unavailable");
      },
    });

    assert.equal(result.response.success, true);
    assert.deepEqual(result.response.meta, {
      normal: { publishedAt: "" },
      cv: { publishedAt: "" },
      growth: { publishedAt: "" },
    });
  } finally {
    console.warn = warn;
  }
});

test("cached ranks response syncs published times when meta versions are unchanged", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { __setRanksCacheForTest, getCachedRanksResponse } = await import("./server.js");

  __setRanksCacheForTest({
    normalSnapshot: {
      _meta: { updated_at: "normal-version" },
      missevan: { ranks: {}, dramas: {} },
      manbo: { ranks: {}, dramas: {} },
    },
    peakTrendSnapshot: null,
    cvSnapshot: { generated_at: "cv-version", rankings: {} },
    cvTrendSnapshots: null,
    cvBaselineSnapshot: null,
    normalUpdatedAt: "normal-version",
    cvUpdatedAt: "cv-version",
    response: {
      success: true,
      schemaVersion: 6,
      updatedAt: "normal-version",
      cvSummary: { updatedAt: "cv-version" },
      meta: {
        normal: { updatedAt: "normal-version", publishedAt: "old-normal-published" },
        cv: { updatedAt: "cv-version", publishedAt: "old-cv-published" },
      },
      platforms: {
        missevan: { key: "missevan", label: "猫耳", categories: [] },
        manbo: { key: "manbo", label: "漫播", categories: [] },
      },
    },
    loadedAt: Date.parse("2026-06-15T02:34:00.000Z"),
    loadPromise: null,
    meta: null,
    metaLoadedAt: 0,
    metaLoadFailedAt: 0,
    metaLoadPromise: null,
    metaPostRefreshBackoff: {},
  });

  const result = await getCachedRanksResponse({
    now: Date.parse("2026-06-15T02:35:00.000Z"),
    readRanksMeta: async () => ({
      normal: {
        updatedAt: "normal-version",
        publishedAt: "2026-06-15T00:40:00+00:00",
      },
      cv: {
        updatedAt: "cv-version",
        publishedAt: "2026-06-12T04:10:00+00:00",
      },
    }),
    readNormalRanksBundle: async () => {
      throw new Error("normal bundle should not be refreshed");
    },
    readCvRanksBundle: async () => {
      throw new Error("CV bundle should not be refreshed");
    },
  });

  assert.equal(result.cacheStatus, "meta-refresh");
  assert.deepEqual(result.response.meta, {
    normal: { publishedAt: "2026-06-15T00:40:00+00:00" },
    cv: { publishedAt: "2026-06-12T04:10:00+00:00" },
    growth: { publishedAt: "" },
  });
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
      weeklyGrowthUpdatedAt: "",
      refreshNormal: false,
      refreshCv: false,
      refreshGrowth: false,
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
      weeklyGrowthUpdatedAt: "",
      refreshNormal: true,
      refreshCv: false,
      refreshGrowth: false,
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
      weeklyGrowthUpdatedAt: "",
      refreshNormal: false,
      refreshCv: true,
      refreshGrowth: false,
    }
  );
});

test("rank meta refresh decision distinguishes CV and growth resources", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { buildRanksMetaRefreshDecision } = await import("./server.js");
  const meta = {
    normal: {
      updatedAt: "normal-top-level",
      resources: {
        "ranks:latest": { updatedAt: "normal-version", publishedAt: "normal-published" },
      },
    },
    cv: {
      resources: {
        "ranks:cv:latest": { updatedAt: "cv-version", publishedAt: "cv-published" },
      },
    },
    watchcountGrowth: {
      updatedAt: "growth-top-level",
      resources: {
        "ranks:weekly-growth:latest": { updatedAt: "growth-version", publishedAt: "growth-published" },
      },
    },
  };

  assert.deepEqual(
    buildRanksMetaRefreshDecision(
      {
        normalUpdatedAt: "normal-version",
        cvUpdatedAt: "cv-version",
        weeklyGrowthUpdatedAt: "old-growth",
      },
      meta
    ),
    {
      normalUpdatedAt: "normal-version",
      cvUpdatedAt: "cv-version",
      weeklyGrowthUpdatedAt: "growth-version",
      refreshNormal: false,
      refreshCv: false,
      refreshGrowth: true,
    }
  );

  assert.deepEqual(
    buildRanksMetaRefreshDecision(
      {
        normalUpdatedAt: "normal-version",
        cvUpdatedAt: "cv-version",
        weeklyGrowthUpdatedAt: "old-growth",
      },
      {
        cv: {
          resources: {
            "ranks:weekly-growth:latest": {
              updatedAt: "legacy-cv-growth-version",
              publishedAt: "legacy-cv-growth-published",
            },
          },
        },
      }
    ),
    {
      normalUpdatedAt: "normal-version",
      cvUpdatedAt: "cv-version",
      weeklyGrowthUpdatedAt: "old-growth",
      refreshNormal: false,
      refreshCv: false,
      refreshGrowth: false,
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

test("cached ranks response refreshes normal snapshot when meta normal version advances", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { __setRanksCacheForTest, getCachedRanksResponse } = await import("./server.js");
  let normalCalls = 0;
  let cvCalls = 0;

  __setRanksCacheForTest({
    normalSnapshot: {
      _meta: { updated_at: "2026-06-12T20:46:43-04:00" },
      missevan: { ranks: {}, dramas: {} },
      manbo: { ranks: {}, dramas: {} },
    },
    peakTrendSnapshot: null,
    cvSnapshot: { generated_at: "same-cv", rankings: {} },
    normalUpdatedAt: "2026-06-12T20:46:43-04:00",
    cvUpdatedAt: "same-cv",
    response: {
      success: true,
      schemaVersion: 6,
      updatedAt: "2026-06-12T20:46:43-04:00",
      cvSummary: { updatedAt: "same-cv" },
      platforms: {
        missevan: { key: "missevan", label: "猫耳", categories: [] },
        manbo: { key: "manbo", label: "漫播", categories: [] },
      },
    },
    loadedAt: Date.parse("2026-06-15T02:34:00.000Z"),
    meta: null,
    metaLoadedAt: 0,
    metaLoadPromise: null,
    loadPromise: null,
    metaPostRefreshBackoff: {},
  });

  const result = await getCachedRanksResponse({
    now: Date.parse("2026-06-15T02:35:00.000Z"),
    readRanksMeta: async () => ({
      normal: { updatedAt: "2026-06-14T20:37:24-04:00" },
      cv: { updatedAt: "same-cv" },
    }),
    readNormalRanksBundle: async () => {
      normalCalls += 1;
      return {
        snapshot: {
          _meta: { updated_at: "2026-06-14T20:37:24-04:00" },
          missevan: { ranks: {}, dramas: {} },
          manbo: { ranks: {}, dramas: {} },
        },
        peakTrendSnapshot: null,
        updatedAt: "2026-06-14T20:37:24-04:00",
      };
    },
    readCvRanksBundle: async () => {
      cvCalls += 1;
      throw new Error("CV bundle should not be read");
    },
  });

  assert.equal(result.cacheStatus, "normal-refresh");
  assert.equal(result.response.updatedAt, "2026-06-14T20:37:24-04:00");
  assert.equal(normalCalls, 1);
  assert.equal(cvCalls, 0);
});

test("cached ranks response throttles stale fallback meta probes outside active window", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { __setRanksCacheForTest, getCachedRanksResponse } = await import("./server.js");
  let metaCalls = 0;
  let normalCalls = 0;

  __setRanksCacheForTest({
    normalSnapshot: {
      _meta: { updated_at: "2026-06-12T20:46:43-04:00" },
      missevan: { ranks: {}, dramas: {} },
      manbo: { ranks: {}, dramas: {} },
    },
    peakTrendSnapshot: null,
    cvSnapshot: { generated_at: "same-cv", rankings: {} },
    normalUpdatedAt: "2026-06-12T20:46:43-04:00",
    cvUpdatedAt: "same-cv",
    response: {
      success: true,
      schemaVersion: 6,
      updatedAt: "2026-06-12T20:46:43-04:00",
      cvSummary: { updatedAt: "same-cv" },
      platforms: {
        missevan: { key: "missevan", label: "猫耳", categories: [] },
        manbo: { key: "manbo", label: "漫播", categories: [] },
      },
    },
    loadedAt: Date.parse("2026-06-15T09:59:00.000Z"),
    meta: null,
    metaLoadedAt: 0,
    metaLoadPromise: null,
    loadPromise: null,
    metaPostRefreshBackoff: {},
  });

  const options = {
    now: Date.parse("2026-06-15T10:00:00.000Z"),
    readRanksMeta: async () => {
      metaCalls += 1;
      return {
        normal: { updatedAt: "2026-06-12T20:46:43-04:00" },
        cv: { updatedAt: "same-cv" },
      };
    },
    readNormalRanksBundle: async () => {
      normalCalls += 1;
      throw new Error("normal bundle should not be read when meta is unchanged");
    },
  };

  const first = await getCachedRanksResponse(options);
  const second = await getCachedRanksResponse(options);

  assert.equal(first.cacheStatus, "meta-refresh");
  assert.equal(second.cacheStatus, "meta-hit");
  assert.equal(metaCalls, 1);
  assert.equal(normalCalls, 0);
});

test("cached ranks response periodically probes meta even when idle response is not old", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { __setRanksCacheForTest, getCachedRanksResponse } = await import("./server.js");
  let metaCalls = 0;
  let normalCalls = 0;

  __setRanksCacheForTest({
    normalSnapshot: {
      _meta: { updated_at: "2026-06-15T00:37:24+00:00" },
      missevan: { ranks: {}, dramas: {} },
      manbo: { ranks: {}, dramas: {} },
    },
    peakTrendSnapshot: null,
    cvSnapshot: { generated_at: "same-cv", rankings: {} },
    normalUpdatedAt: "2026-06-15T00:37:24+00:00",
    cvUpdatedAt: "same-cv",
    response: {
      success: true,
      schemaVersion: 6,
      updatedAt: "2026-06-15T00:37:24+00:00",
      cvSummary: { updatedAt: "same-cv" },
      platforms: {
        missevan: { key: "missevan", label: "猫耳", categories: [] },
        manbo: { key: "manbo", label: "漫播", categories: [] },
      },
    },
    loadedAt: Date.parse("2026-06-15T08:59:00.000Z"),
    meta: null,
    metaLoadedAt: 0,
    metaLoadPromise: null,
    loadPromise: null,
    metaPostRefreshBackoff: {},
  });

  const result = await getCachedRanksResponse({
    now: Date.parse("2026-06-15T09:00:00.000Z"),
    readRanksMeta: async () => {
      metaCalls += 1;
      return {
        normal: { updatedAt: "2026-06-15T04:37:24+00:00" },
        cv: { updatedAt: "same-cv" },
      };
    },
    readNormalRanksBundle: async () => {
      normalCalls += 1;
      return {
        snapshot: {
          _meta: { updated_at: "2026-06-15T04:37:24+00:00" },
          missevan: { ranks: {}, dramas: {} },
          manbo: { ranks: {}, dramas: {} },
        },
        peakTrendSnapshot: null,
        updatedAt: "2026-06-15T04:37:24+00:00",
      };
    },
  });

  assert.equal(result.cacheStatus, "normal-refresh");
  assert.equal(result.response.updatedAt, "2026-06-15T04:37:24+00:00");
  assert.equal(metaCalls, 1);
  assert.equal(normalCalls, 1);
});

test("cached ranks response backs off fallback meta probe failures", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { __setRanksCacheForTest, getCachedRanksResponse } = await import("./server.js");
  let metaCalls = 0;

  __setRanksCacheForTest({
    normalSnapshot: {
      _meta: { updated_at: "2026-06-15T00:37:24+00:00" },
      missevan: { ranks: {}, dramas: {} },
      manbo: { ranks: {}, dramas: {} },
    },
    peakTrendSnapshot: null,
    cvSnapshot: { generated_at: "same-cv", rankings: {} },
    normalUpdatedAt: "2026-06-15T00:37:24+00:00",
    cvUpdatedAt: "same-cv",
    response: {
      success: true,
      schemaVersion: 6,
      updatedAt: "2026-06-15T00:37:24+00:00",
      cvSummary: { updatedAt: "same-cv" },
      platforms: {
        missevan: { key: "missevan", label: "猫耳", categories: [] },
        manbo: { key: "manbo", label: "漫播", categories: [] },
      },
    },
    loadedAt: Date.parse("2026-06-15T08:59:00.000Z"),
    meta: null,
    metaLoadedAt: 0,
    metaLoadFailedAt: 0,
    metaLoadPromise: null,
    loadPromise: null,
    metaPostRefreshBackoff: {},
  });

  const options = {
    now: Date.parse("2026-06-15T09:00:00.000Z"),
    readRanksMeta: async () => {
      metaCalls += 1;
      throw new Error("Upstash timeout");
    },
  };

  const warn = console.warn;
  console.warn = () => {};
  try {
    const first = await getCachedRanksResponse(options);
    const second = await getCachedRanksResponse({
      ...options,
      now: Date.parse("2026-06-15T09:05:00.000Z"),
    });

    assert.equal(first.cacheStatus, "stale");
    assert.equal(second.cacheStatus, "stale");
    assert.equal(metaCalls, 1);
  } finally {
    console.warn = warn;
  }
});

test("cached ranks response reports meta-refresh when active probe reads unchanged meta", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { __setRanksCacheForTest, getCachedRanksResponse } = await import("./server.js");

  __setRanksCacheForTest({
    normalSnapshot: {
      _meta: { updated_at: "2026-06-14T20:37:24-04:00" },
      missevan: { ranks: {}, dramas: {} },
      manbo: { ranks: {}, dramas: {} },
    },
    peakTrendSnapshot: null,
    cvSnapshot: { generated_at: "same-cv", rankings: {} },
    normalUpdatedAt: "2026-06-14T20:37:24-04:00",
    cvUpdatedAt: "same-cv",
    response: {
      success: true,
      schemaVersion: 6,
      updatedAt: "2026-06-14T20:37:24-04:00",
      cvSummary: { updatedAt: "same-cv" },
      platforms: {
        missevan: { key: "missevan", label: "猫耳", categories: [] },
        manbo: { key: "manbo", label: "漫播", categories: [] },
      },
    },
    loadedAt: Date.parse("2026-06-15T02:34:00.000Z"),
    meta: null,
    metaLoadedAt: 0,
    metaLoadPromise: null,
    loadPromise: null,
    metaPostRefreshBackoff: {},
  });

  const result = await getCachedRanksResponse({
    now: Date.parse("2026-06-15T02:35:00.000Z"),
    readRanksMeta: async () => ({
      normal: { updatedAt: "2026-06-14T20:37:24-04:00" },
      cv: { updatedAt: "same-cv" },
    }),
  });

  assert.equal(result.cacheStatus, "meta-refresh");
});

test("cached ranks response records meta versions after refresh to avoid repeated bundle reads", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { __setRanksCacheForTest, getCachedRanksResponse } = await import("./server.js");
  let normalCalls = 0;
  let cvCalls = 0;

  __setRanksCacheForTest({
    normalSnapshot: {
      _meta: { updated_at: "old-normal" },
      missevan: { ranks: {}, dramas: {} },
      manbo: { ranks: {}, dramas: {} },
    },
    peakTrendSnapshot: null,
    cvSnapshot: { generated_at: "old-cv", rankings: {} },
    normalUpdatedAt: "old-normal",
    cvUpdatedAt: "old-cv",
    response: {
      success: true,
      schemaVersion: 6,
      updatedAt: "old-normal",
      cvSummary: { updatedAt: "old-cv" },
      platforms: {
        missevan: { key: "missevan", label: "猫耳", categories: [] },
        manbo: { key: "manbo", label: "漫播", categories: [] },
      },
    },
    loadedAt: Date.parse("2026-06-15T02:34:00.000Z"),
    meta: null,
    metaLoadedAt: 0,
    metaLoadPromise: null,
    loadPromise: null,
    metaPostRefreshBackoff: {},
  });

  const options = {
    now: Date.parse("2026-06-15T02:35:00.000Z"),
    readRanksMeta: async () => ({
      normal: { updatedAt: "meta-normal" },
      cv: { updatedAt: "meta-cv" },
    }),
    readNormalRanksBundle: async () => {
      normalCalls += 1;
      return {
        snapshot: {
          _meta: { updated_at: "snapshot-normal" },
          missevan: { ranks: {}, dramas: {} },
          manbo: { ranks: {}, dramas: {} },
        },
        peakTrendSnapshot: null,
        updatedAt: "snapshot-normal",
      };
    },
    readCvRanksBundle: async () => {
      cvCalls += 1;
      return {
        cvSnapshot: { generated_at: "snapshot-cv", rankings: {} },
        updatedAt: "snapshot-cv",
      };
    },
  };

  const first = await getCachedRanksResponse(options);
  const second = await getCachedRanksResponse(options);

  assert.equal(first.cacheStatus, "normal-refresh+cv-refresh");
  assert.equal(second.cacheStatus, "meta-hit");
  assert.equal(normalCalls, 1);
  assert.equal(cvCalls, 1);
});

test("cached ranks response reads and commits only the independently refreshed CV or growth resource", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { __getRanksCacheForTest, __setRanksCacheForTest, getCachedRanksResponse } = await import("./server.js");
  const normalSnapshot = {
    _meta: { updated_at: "same-normal" },
    missevan: { ranks: {}, dramas: {} },
    manbo: { ranks: {}, dramas: {} },
  };
  const response = {
    success: true,
    schemaVersion: 6,
    updatedAt: "same-normal",
    cvSummary: { updatedAt: "same-cv" },
    growthSummary: { updatedAt: "old-growth" },
    platforms: {
      missevan: { key: "missevan", label: "猫耳", categories: [] },
      manbo: { key: "manbo", label: "漫播", categories: [] },
    },
  };
  const oldCvSnapshot = { generated_at: "same-cv", rankings: { stable: true } };
  const oldGrowthSnapshot = { generated_at: "old-growth", weekly: { stable: true } };
  const oldGrowthCovers = { missevan: { 1: "old-cover" }, manbo: {} };
  const baseCache = {
    normalSnapshot,
    peakTrendSnapshot: null,
    normalUpdatedAt: "same-normal",
    response,
    loadedAt: Date.parse("2026-06-15T02:34:00.000Z"),
    meta: null,
    metaLoadedAt: 0,
    metaLoadPromise: null,
    loadPromise: null,
    metaPostRefreshBackoff: {},
  };

  __setRanksCacheForTest({
    ...baseCache,
    cvSnapshot: oldCvSnapshot,
    cvTrendSnapshots: { stable: true },
    weeklyGrowthSnapshot: oldGrowthSnapshot,
    weeklyGrowthCovers: oldGrowthCovers,
    cvUpdatedAt: "same-cv",
    weeklyGrowthUpdatedAt: "old-growth",
  });

  const growthResult = await getCachedRanksResponse({
    now: Date.parse("2026-06-15T02:35:00.000Z"),
    readRanksMeta: async () => ({
      normal: { updatedAt: "same-normal" },
      cv: { updatedAt: "same-cv" },
      growth: { updatedAt: "new-growth" },
    }),
    readGrowthRanksBundle: async () => {
      return {
        weeklyGrowthSnapshot: { generated_at: "new-growth", weekly: { fresh: true } },
        weeklyGrowthCovers: { missevan: { 2: "new-cover" }, manbo: {} },
        updatedAt: "",
        weeklyGrowthUpdatedAt: "new-growth",
      };
    },
  });

  assert.equal(growthResult.cacheStatus, "growth-refresh");
  assert.deepEqual(__getRanksCacheForTest().cvSnapshot, oldCvSnapshot);
  assert.deepEqual(__getRanksCacheForTest().weeklyGrowthSnapshot, {
    generated_at: "new-growth",
    weekly: { fresh: true },
  });

  __setRanksCacheForTest({
    ...baseCache,
    cvSnapshot: oldCvSnapshot,
    cvTrendSnapshots: { stable: true },
    weeklyGrowthSnapshot: oldGrowthSnapshot,
    weeklyGrowthCovers: oldGrowthCovers,
    cvUpdatedAt: "old-cv",
    weeklyGrowthUpdatedAt: "same-growth",
  });

  const cvResult = await getCachedRanksResponse({
    now: Date.parse("2026-06-15T02:35:00.000Z"),
    readRanksMeta: async () => ({
      normal: { updatedAt: "same-normal" },
      cv: { updatedAt: "new-cv" },
      growth: { updatedAt: "same-growth" },
    }),
    readCvRanksBundle: async () => {
      return {
        cvSnapshot: { generated_at: "new-cv", rankings: { fresh: true } },
        cvTrendSnapshots: { fresh: true },
        weeklyGrowthSnapshot: null,
        weeklyGrowthCovers: { missevan: {}, manbo: {} },
        updatedAt: "new-cv",
        weeklyGrowthUpdatedAt: "",
      };
    },
  });

  assert.equal(cvResult.cacheStatus, "cv-refresh");
  assert.deepEqual(__getRanksCacheForTest().cvSnapshot, {
    generated_at: "new-cv",
    rankings: { fresh: true },
  });
  assert.deepEqual(__getRanksCacheForTest().weeklyGrowthSnapshot, oldGrowthSnapshot);
  assert.deepEqual(__getRanksCacheForTest().weeklyGrowthCovers, oldGrowthCovers);
});

test("cached ranks response preserves and retries CV or growth when the refreshed snapshot is missing", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { __getRanksCacheForTest, __setRanksCacheForTest, getCachedRanksResponse } = await import("./server.js");
  const normalSnapshot = {
    _meta: { updated_at: "same-normal" },
    missevan: { ranks: {}, dramas: {} },
    manbo: { ranks: {}, dramas: {} },
  };
  const oldCvSnapshot = { generated_at: "old-cv", rankings: { stable: true } };
  const oldGrowthSnapshot = { generated_at: "old-growth", rankings: { stable: true } };
  const oldGrowthCovers = { missevan: { 1: "old-cover" }, manbo: {} };
  const baseCache = {
    normalSnapshot,
    peakTrendSnapshot: null,
    cvSnapshot: oldCvSnapshot,
    cvTrendSnapshots: { stable: true },
    weeklyGrowthSnapshot: oldGrowthSnapshot,
    weeklyGrowthCovers: oldGrowthCovers,
    normalUpdatedAt: "same-normal",
    response: {
      success: true,
      schemaVersion: 6,
      updatedAt: "same-normal",
      cvSummary: { updatedAt: "old-cv" },
      growthSummary: { updatedAt: "old-growth" },
      platforms: {
        missevan: { key: "missevan", label: "猫耳", categories: [] },
        manbo: { key: "manbo", label: "漫播", categories: [] },
      },
    },
    loadedAt: Date.parse("2026-06-15T02:34:00.000Z"),
    meta: null,
    metaLoadedAt: 0,
    metaLoadPromise: null,
    loadPromise: null,
    metaPostRefreshBackoff: {},
  };
  let growthCalls = 0;

  __setRanksCacheForTest({
    ...baseCache,
    cvSnapshot: { generated_at: "same-cv", rankings: { stable: true } },
    cvUpdatedAt: "same-cv",
    weeklyGrowthUpdatedAt: "old-growth",
  });
  const growthOptions = {
    now: Date.parse("2026-06-15T02:35:00.000Z"),
    readRanksMeta: async () => ({
      normal: { updatedAt: "same-normal" },
      cv: { updatedAt: "same-cv" },
      growth: { updatedAt: "new-growth" },
    }),
    readGrowthRanksBundle: async () => {
      growthCalls += 1;
      return {
        weeklyGrowthSnapshot: null,
        weeklyGrowthCovers: { missevan: {}, manbo: {} },
        weeklyGrowthUpdatedAt: "",
      };
    },
  };

  assert.equal((await getCachedRanksResponse(growthOptions)).cacheStatus, "stale");
  assert.equal((await getCachedRanksResponse(growthOptions)).cacheStatus, "stale");
  assert.equal(growthCalls, 2);
  assert.deepEqual(__getRanksCacheForTest().weeklyGrowthSnapshot, oldGrowthSnapshot);
  assert.deepEqual(__getRanksCacheForTest().weeklyGrowthCovers, oldGrowthCovers);
  assert.equal(__getRanksCacheForTest().weeklyGrowthUpdatedAt, "old-growth");

  let cvCalls = 0;
  __setRanksCacheForTest({
    ...baseCache,
    weeklyGrowthSnapshot: { generated_at: "same-growth", rankings: { stable: true } },
    cvUpdatedAt: "old-cv",
    weeklyGrowthUpdatedAt: "same-growth",
  });
  const cvOptions = {
    now: Date.parse("2026-06-15T02:35:00.000Z"),
    readRanksMeta: async () => ({
      normal: { updatedAt: "same-normal" },
      cv: { updatedAt: "new-cv" },
      growth: { updatedAt: "same-growth" },
    }),
    readCvRanksBundle: async () => {
      cvCalls += 1;
      return {
        cvSnapshot: null,
        cvTrendSnapshots: null,
        updatedAt: "",
      };
    },
  };

  assert.equal((await getCachedRanksResponse(cvOptions)).cacheStatus, "stale");
  assert.equal((await getCachedRanksResponse(cvOptions)).cacheStatus, "stale");
  assert.equal(cvCalls, 2);
  assert.deepEqual(__getRanksCacheForTest().cvSnapshot, oldCvSnapshot);
  assert.equal(__getRanksCacheForTest().cvUpdatedAt, "old-cv");
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
          weeklyGrowthUpdatedAt: "growth-new",
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
  assert.equal(logs[0].weeklyGrowthUpdatedAt, "growth-new");
  assert.equal(result.payload.weeklyGrowthUpdatedAt, "growth-new");
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
    weeklyGrowthSnapshot: { generated_at: "old-growth", rankings: {} },
    normalUpdatedAt: "old-normal",
    cvUpdatedAt: "old-cv",
    weeklyGrowthUpdatedAt: "old-growth",
    meta: {
      normal: { updatedAt: "old-normal", publishedAt: "old-normal-published" },
      cv: { updatedAt: "old-cv", publishedAt: "old-cv-published" },
      growth: { updatedAt: "old-growth", publishedAt: "old-growth-published" },
    },
    response: {
      success: true,
      schemaVersion: 6,
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
        readRanksMeta: async () => ({
          normal: { updatedAt: "new-normal", publishedAt: "new-normal-published" },
          cv: { updatedAt: "new-cv", publishedAt: "new-cv-published" },
          growth: { updatedAt: "new-growth", publishedAt: "new-growth-published" },
        }),
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
  assert.deepEqual(cache.meta, {
    normal: { updatedAt: "old-normal", publishedAt: "old-normal-published" },
    cv: { updatedAt: "old-cv", publishedAt: "old-cv-published" },
    growth: { updatedAt: "old-growth", publishedAt: "old-growth-published" },
  });
});

test("admin ranks force refresh leaves cache untouched when meta cannot be read", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { __getRanksCacheForTest, __setRanksCacheForTest, refreshAdminRanksCacheTarget } = await import("./server.js");
  const oldSnapshot = {
    _meta: { updated_at: "old-normal" },
    missevan: { ranks: {}, dramas: {} },
    manbo: { ranks: {}, dramas: {} },
  };
  const oldMeta = {
    normal: { updatedAt: "old-normal", publishedAt: "old-normal-published" },
    cv: { updatedAt: "old-cv", publishedAt: "old-cv-published" },
  };

  __setRanksCacheForTest({
    normalSnapshot: oldSnapshot,
    peakTrendSnapshot: null,
    cvSnapshot: { generated_at: "old-cv", rankings: {} },
    normalUpdatedAt: "old-normal",
    cvUpdatedAt: "old-cv",
    meta: oldMeta,
    response: null,
  });

  await assert.rejects(
    () => refreshAdminRanksCacheTarget({
      target: "ranks",
      force: true,
      readRanksMeta: async () => {
        throw new Error("meta unavailable");
      },
      readNormalRanksBundle: async () => {
        throw new Error("bundle reads must wait for meta");
      },
      readCvRanksBundle: async () => {
        throw new Error("bundle reads must wait for meta");
      },
    }),
    /meta unavailable/
  );

  const cache = __getRanksCacheForTest();
  assert.deepEqual(cache.normalSnapshot, oldSnapshot);
  assert.equal(cache.normalUpdatedAt, "old-normal");
  assert.equal(cache.cvUpdatedAt, "old-cv");
  assert.deepEqual(cache.meta, oldMeta);
});

test("admin ranks force refresh rejects incomplete target meta before reading bundles", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { __getRanksCacheForTest, __setRanksCacheForTest, refreshAdminRanksCacheTarget } = await import("./server.js");
  const oldSnapshot = {
    _meta: { updated_at: "old-normal" },
    missevan: { ranks: {}, dramas: {} },
    manbo: { ranks: {}, dramas: {} },
  };
  const oldMeta = {
    normal: { updatedAt: "old-normal", publishedAt: "old-normal-published" },
    cv: { updatedAt: "old-cv", publishedAt: "old-cv-published" },
  };
  let bundleCalls = 0;

  __setRanksCacheForTest({
    normalSnapshot: oldSnapshot,
    peakTrendSnapshot: null,
    cvSnapshot: { generated_at: "old-cv", rankings: {} },
    normalUpdatedAt: "old-normal",
    cvUpdatedAt: "old-cv",
    meta: oldMeta,
    response: null,
  });

  await assert.rejects(
    () => refreshAdminRanksCacheTarget({
      target: "ranks",
      force: true,
      readRanksMeta: async () => ({
        normal: { updatedAt: "new-normal", publishedAt: "new-normal-published" },
      }),
      readNormalRanksBundle: async () => {
        bundleCalls += 1;
        return {};
      },
      readCvRanksBundle: async () => {
        bundleCalls += 1;
        return {};
      },
    }),
    /Ranks meta is unavailable/
  );

  const cache = __getRanksCacheForTest();
  assert.equal(bundleCalls, 0);
  assert.deepEqual(cache.normalSnapshot, oldSnapshot);
  assert.equal(cache.normalUpdatedAt, "old-normal");
  assert.equal(cache.cvUpdatedAt, "old-cv");
  assert.deepEqual(cache.meta, oldMeta);
});

test("admin ranks non-force partial refresh ignores meta missing the requested branch", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { __getRanksCacheForTest, __setRanksCacheForTest, refreshAdminRanksCacheTarget } = await import("./server.js");
  const oldMeta = {
    normal: { updatedAt: "old-normal", publishedAt: "old-normal-published" },
    cv: { updatedAt: "old-cv", publishedAt: "old-cv-published" },
  };

  __setRanksCacheForTest({
    normalSnapshot: {
      _meta: { updated_at: "old-normal" },
      missevan: { ranks: {}, dramas: {} },
      manbo: { ranks: {}, dramas: {} },
    },
    peakTrendSnapshot: null,
    cvSnapshot: { generated_at: "old-cv", rankings: {} },
    normalUpdatedAt: "old-normal",
    cvUpdatedAt: "old-cv",
    meta: oldMeta,
    response: null,
  });

  const result = await refreshAdminRanksCacheTarget({
    target: "ranks:normal",
    force: false,
    readRanksMeta: async () => ({
      cv: { updatedAt: "new-cv", publishedAt: "new-cv-published" },
    }),
    readNormalRanksBundle: async () => {
      throw new Error("bundle must not be read for incomplete meta");
    },
  });

  assert.equal(result.success, true);
  assert.deepEqual(__getRanksCacheForTest().meta, oldMeta);
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
    readRanksMeta: async () => ({
      normal: { updatedAt: "", publishedAt: "" },
      cv: { updatedAt: "new-cv", publishedAt: "new-cv-published" },
    }),
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

test("admin ranks growth force refresh reads only the growth bundle", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { __getRanksCacheForTest, __setRanksCacheForTest, refreshAdminRanksCacheTarget } = await import("./server.js");
  const oldCvSnapshot = { generated_at: "old-cv", rankings: { stable: true } };
  let bundleCalls = 0;

  __setRanksCacheForTest({
    normalSnapshot: null,
    cvSnapshot: oldCvSnapshot,
    weeklyGrowthSnapshot: { generated_at: "old-growth", rankings: {} },
    cvUpdatedAt: "old-cv",
    weeklyGrowthUpdatedAt: "old-growth",
    response: null,
  });

  const result = await refreshAdminRanksCacheTarget({
    target: "ranks:growth",
    force: true,
    readRanksMeta: async () => ({
      growth: { updatedAt: "new-growth", publishedAt: "new-growth-published" },
    }),
    readGrowthRanksBundle: async () => {
      bundleCalls += 1;
      return {
        weeklyGrowthSnapshot: { generated_at: "new-growth", rankings: { fresh: true } },
        weeklyGrowthCovers: { missevan: { 2: "new-cover" }, manbo: {} },
        weeklyGrowthUpdatedAt: "new-growth",
      };
    },
  });

  assert.equal(bundleCalls, 1);
  assert.equal(result.cacheStatus, "cold-refresh+growth-refresh");
  assert.equal(result.weeklyGrowthUpdatedAt, "new-growth");
  assert.deepEqual(__getRanksCacheForTest().cvSnapshot, oldCvSnapshot);
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
    readRanksMeta: async () => ({
      normal: { updatedAt: "new-normal", publishedAt: "new-normal-published" },
      cv: { updatedAt: "", publishedAt: "" },
    }),
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

test("admin ranks force refresh publishes matching bundles and meta in the first response", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const {
    __getRanksCacheForTest,
    __setRanksCacheForTest,
    getCachedRanksResponse,
    getRanksMetaProbeCycleIds,
    refreshAdminRanksCacheTarget,
  } = await import("./server.js");
  const now = Date.parse("2026-06-13T00:36:00.000Z");

  __setRanksCacheForTest({
    normalSnapshot: {
      _meta: { updated_at: "old-normal" },
      missevan: { ranks: {}, dramas: {} },
      manbo: { ranks: {}, dramas: {} },
    },
    peakTrendSnapshot: { old: true },
    cvSnapshot: { generated_at: "old-cv", rankings: {} },
    cvTrendSnapshots: { old: true },
    weeklyGrowthSnapshot: { generated_at: "old-growth", rankings: {} },
    weeklyGrowthCovers: { missevan: {}, manbo: {} },
    normalUpdatedAt: "old-normal",
    cvUpdatedAt: "old-cv",
    weeklyGrowthUpdatedAt: "old-growth",
    meta: {
      normal: { updatedAt: "old-normal", publishedAt: "old-normal-published" },
      cv: { updatedAt: "old-cv", publishedAt: "old-cv-published" },
      growth: { updatedAt: "old-growth", publishedAt: "old-growth-published" },
    },
    metaLoadedAt: now - 60_000,
    metaPostRefreshBackoff: {},
  });

  const result = await refreshAdminRanksCacheTarget({
    target: "ranks",
    force: true,
    now,
    readRanksMeta: async () => ({
      normal: { updatedAt: "new-normal", publishedAt: "new-normal-published" },
      cv: { updatedAt: "new-cv", publishedAt: "new-cv-published" },
      growth: { updatedAt: "new-growth", publishedAt: "new-growth-published" },
    }),
    readNormalRanksBundle: async () => ({
      snapshot: {
        _meta: { updated_at: "new-normal" },
        missevan: { ranks: {}, dramas: {} },
        manbo: { ranks: {}, dramas: {} },
      },
      peakTrendSnapshot: { new: true },
      updatedAt: "new-normal",
    }),
    readCvRanksBundle: async () => ({
      cvSnapshot: { generated_at: "new-cv", rankings: {} },
      cvTrendSnapshots: { new: true },
      updatedAt: "new-cv",
    }),
    readGrowthRanksBundle: async () => ({
        weeklyGrowthSnapshot: { generated_at: "new-growth", rankings: {} },
        weeklyGrowthCovers: { missevan: {}, manbo: {} },
        weeklyGrowthUpdatedAt: "new-growth",
    }),
  });

  assert.equal(result.normalUpdatedAt, "new-normal");
  assert.equal(result.cvUpdatedAt, "new-cv");
  assert.deepEqual(__getRanksCacheForTest().meta, {
    normal: { updatedAt: "new-normal", publishedAt: "new-normal-published" },
    cv: { updatedAt: "new-cv", publishedAt: "new-cv-published" },
    growth: { updatedAt: "new-growth", publishedAt: "new-growth-published" },
  });
  assert.deepEqual(__getRanksCacheForTest().response.meta, {
    normal: { publishedAt: "new-normal-published" },
    cv: { publishedAt: "new-cv-published" },
    growth: { publishedAt: "new-growth-published" },
  });

  __setRanksCacheForTest({
    metaPostRefreshBackoff: {
      normal: { cycleId: getRanksMetaProbeCycleIds(now).normal },
    },
  });
  let metaCalls = 0;
  const cached = await getCachedRanksResponse({
    now: now + 10 * 60 * 1000,
    readRanksMeta: async () => {
      metaCalls += 1;
      throw new Error("fresh admin meta should remain valid during backoff");
    },
  });
  assert.equal(metaCalls, 0);
  assert.equal(cached.response.meta.normal.publishedAt, "new-normal-published");
});

test("admin ranks non-force refresh commits published times without rereading unchanged bundles", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { __getRanksCacheForTest, __setRanksCacheForTest, refreshAdminRanksCacheTarget } = await import("./server.js");
  const normalSnapshot = {
    _meta: { updated_at: "same-normal" },
    missevan: { ranks: {}, dramas: {} },
    manbo: { ranks: {}, dramas: {} },
  };
  const cvSnapshot = { generated_at: "same-cv", rankings: {} };
  const growthSnapshot = { generated_at: "same-growth", rankings: {} };

  __setRanksCacheForTest({
    normalSnapshot,
    peakTrendSnapshot: null,
    cvSnapshot,
    cvTrendSnapshots: null,
    weeklyGrowthSnapshot: growthSnapshot,
    weeklyGrowthCovers: { missevan: {}, manbo: {} },
    normalUpdatedAt: "same-normal",
    cvUpdatedAt: "same-cv",
    weeklyGrowthUpdatedAt: "same-growth",
    meta: {
      normal: { updatedAt: "same-normal", publishedAt: "old-normal-published" },
      cv: { updatedAt: "same-cv", publishedAt: "old-cv-published" },
      growth: { updatedAt: "same-growth", publishedAt: "old-growth-published" },
    },
    response: null,
    metaPostRefreshBackoff: {},
  });

  const result = await refreshAdminRanksCacheTarget({
    target: "ranks",
    force: false,
    now: Date.parse("2026-06-13T00:36:00.000Z"),
    readRanksMeta: async () => ({
      normal: { updatedAt: "same-normal", publishedAt: "new-normal-published" },
      cv: { updatedAt: "same-cv", publishedAt: "new-cv-published" },
      growth: { updatedAt: "same-growth", publishedAt: "new-growth-published" },
    }),
    readNormalRanksBundle: async () => {
      throw new Error("unchanged normal bundle should not be read");
    },
    readCvRanksBundle: async () => {
      throw new Error("unchanged CV bundle should not be read");
    },
  });

  assert.equal(result.cacheStatus, "cold-refresh");
  assert.deepEqual(__getRanksCacheForTest().response.meta, {
    normal: { publishedAt: "new-normal-published" },
    cv: { publishedAt: "new-cv-published" },
    growth: { publishedAt: "new-growth-published" },
  });
});

test("admin non-force refresh reads and commits only the independently refreshed CV or growth resource", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { __getRanksCacheForTest, __setRanksCacheForTest, refreshAdminRanksCacheTarget } = await import("./server.js");
  const oldGrowthSnapshot = { generated_at: "same-growth", weekly: { stable: true } };
  const oldGrowthCovers = { missevan: { 1: "old-cover" }, manbo: {} };

  __setRanksCacheForTest({
    normalSnapshot: {
      _meta: { updated_at: "same-normal" },
      missevan: { ranks: {}, dramas: {} },
      manbo: { ranks: {}, dramas: {} },
    },
    peakTrendSnapshot: null,
    cvSnapshot: { generated_at: "old-cv", rankings: {} },
    cvTrendSnapshots: { old: true },
    weeklyGrowthSnapshot: oldGrowthSnapshot,
    weeklyGrowthCovers: oldGrowthCovers,
    normalUpdatedAt: "same-normal",
    cvUpdatedAt: "old-cv",
    weeklyGrowthUpdatedAt: "same-growth",
    meta: {
      normal: { updatedAt: "same-normal", publishedAt: "same-normal-published" },
      cv: { updatedAt: "old-cv", publishedAt: "old-cv-published" },
      growth: { updatedAt: "same-growth", publishedAt: "same-growth-published" },
    },
    response: null,
  });

  const result = await refreshAdminRanksCacheTarget({
    target: "ranks:cv",
    force: false,
    readRanksMeta: async () => ({
      normal: { updatedAt: "same-normal", publishedAt: "same-normal-published" },
      cv: { updatedAt: "new-cv", publishedAt: "new-cv-published" },
      growth: { updatedAt: "same-growth", publishedAt: "same-growth-published" },
    }),
    readCvRanksBundle: async () => {
      return {
        cvSnapshot: { generated_at: "new-cv", rankings: { fresh: true } },
        cvTrendSnapshots: { fresh: true },
        weeklyGrowthSnapshot: null,
        weeklyGrowthCovers: { missevan: {}, manbo: {} },
        updatedAt: "new-cv",
        weeklyGrowthUpdatedAt: "",
      };
    },
  });

  const cache = __getRanksCacheForTest();
  assert.equal(result.cacheStatus, "cold-refresh+cv-refresh");
  assert.deepEqual(cache.weeklyGrowthSnapshot, oldGrowthSnapshot);
  assert.deepEqual(cache.weeklyGrowthCovers, oldGrowthCovers);

  const oldCvSnapshot = { generated_at: "same-cv", rankings: { stable: true } };
  __setRanksCacheForTest({
    normalSnapshot: {
      _meta: { updated_at: "same-normal" },
      missevan: { ranks: {}, dramas: {} },
      manbo: { ranks: {}, dramas: {} },
    },
    peakTrendSnapshot: null,
    cvSnapshot: oldCvSnapshot,
    cvTrendSnapshots: { stable: true },
    weeklyGrowthSnapshot: oldGrowthSnapshot,
    weeklyGrowthCovers: oldGrowthCovers,
    normalUpdatedAt: "same-normal",
    cvUpdatedAt: "same-cv",
    weeklyGrowthUpdatedAt: "old-growth",
    meta: {
      normal: { updatedAt: "same-normal", publishedAt: "same-normal-published" },
      cv: { updatedAt: "same-cv", publishedAt: "same-cv-published" },
      growth: { updatedAt: "old-growth", publishedAt: "old-growth-published" },
    },
    response: null,
  });

  const growthResult = await refreshAdminRanksCacheTarget({
    target: "ranks:growth",
    force: false,
    readRanksMeta: async () => ({
      normal: { updatedAt: "same-normal", publishedAt: "same-normal-published" },
      cv: { updatedAt: "same-cv", publishedAt: "same-cv-published" },
      growth: { updatedAt: "new-growth", publishedAt: "new-growth-published" },
    }),
    readGrowthRanksBundle: async () => {
      return {
        cvSnapshot: null,
        cvTrendSnapshots: null,
        weeklyGrowthSnapshot: { generated_at: "new-growth", weekly: { fresh: true } },
        weeklyGrowthCovers: { missevan: { 2: "new-cover" }, manbo: {} },
        updatedAt: "",
        weeklyGrowthUpdatedAt: "new-growth",
      };
    },
  });

  const growthCache = __getRanksCacheForTest();
  assert.equal(growthResult.cacheStatus, "cold-refresh+growth-refresh");
  assert.deepEqual(growthCache.cvSnapshot, oldCvSnapshot);
  assert.deepEqual(growthCache.weeklyGrowthSnapshot, {
    generated_at: "new-growth",
    weekly: { fresh: true },
  });
});

test("admin non-force refresh rejects missing CV or growth snapshots without mutating cache", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { __getRanksCacheForTest, __setRanksCacheForTest, refreshAdminRanksCacheTarget } = await import("./server.js");
  const oldCvSnapshot = { generated_at: "old-cv", rankings: { stable: true } };
  const oldGrowthSnapshot = { generated_at: "old-growth", rankings: { stable: true } };
  const oldMeta = {
    normal: { updatedAt: "same-normal", publishedAt: "same-normal-published" },
    cv: { updatedAt: "old-cv", publishedAt: "old-cv-published" },
    growth: { updatedAt: "old-growth", publishedAt: "old-growth-published" },
  };
  const baseCache = {
    normalSnapshot: {
      _meta: { updated_at: "same-normal" },
      missevan: { ranks: {}, dramas: {} },
      manbo: { ranks: {}, dramas: {} },
    },
    peakTrendSnapshot: null,
    cvSnapshot: oldCvSnapshot,
    cvTrendSnapshots: { stable: true },
    weeklyGrowthSnapshot: oldGrowthSnapshot,
    weeklyGrowthCovers: { missevan: { 1: "old-cover" }, manbo: {} },
    normalUpdatedAt: "same-normal",
    meta: oldMeta,
    response: null,
  };

  __setRanksCacheForTest({
    ...baseCache,
    cvUpdatedAt: "old-cv",
    weeklyGrowthUpdatedAt: "same-growth",
  });
  await assert.rejects(
    () => refreshAdminRanksCacheTarget({
      target: "ranks:cv",
      force: false,
      readRanksMeta: async () => ({
        normal: { updatedAt: "same-normal" },
        cv: { updatedAt: "new-cv" },
        growth: { updatedAt: "same-growth" },
      }),
      readCvRanksBundle: async () => {
        return { cvSnapshot: null, updatedAt: "" };
      },
    }),
    /CV ranks snapshot is unavailable/
  );
  assert.deepEqual(__getRanksCacheForTest().cvSnapshot, oldCvSnapshot);
  assert.equal(__getRanksCacheForTest().cvUpdatedAt, "old-cv");
  assert.deepEqual(__getRanksCacheForTest().meta, oldMeta);

  __setRanksCacheForTest({
    ...baseCache,
    cvUpdatedAt: "same-cv",
    weeklyGrowthUpdatedAt: "old-growth",
  });
  await assert.rejects(
    () => refreshAdminRanksCacheTarget({
      target: "ranks:growth",
      force: false,
      readRanksMeta: async () => ({
        normal: { updatedAt: "same-normal" },
        cv: { updatedAt: "same-cv" },
        growth: { updatedAt: "new-growth" },
      }),
      readGrowthRanksBundle: async () => {
        return { weeklyGrowthSnapshot: null, weeklyGrowthUpdatedAt: "" };
      },
    }),
    /Weekly growth ranks snapshot is unavailable/
  );
  assert.deepEqual(__getRanksCacheForTest().weeklyGrowthSnapshot, oldGrowthSnapshot);
  assert.equal(__getRanksCacheForTest().weeklyGrowthUpdatedAt, "old-growth");
  assert.deepEqual(__getRanksCacheForTest().meta, oldMeta);
});

test("admin ranks partial refresh updates only the requested meta branch", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { __getRanksCacheForTest, __setRanksCacheForTest, refreshAdminRanksCacheTarget } = await import("./server.js");

  __setRanksCacheForTest({
    normalSnapshot: {
      _meta: { updated_at: "old-normal" },
      missevan: { ranks: {}, dramas: {} },
      manbo: { ranks: {}, dramas: {} },
    },
    peakTrendSnapshot: null,
    cvSnapshot: { generated_at: "old-cv", rankings: {} },
    cvTrendSnapshots: { old: true },
    normalUpdatedAt: "old-normal",
    cvUpdatedAt: "old-cv",
    meta: {
      normal: { updatedAt: "old-normal", publishedAt: "old-normal-published" },
      cv: { updatedAt: "old-cv", publishedAt: "old-cv-published" },
    },
    response: null,
  });

  await refreshAdminRanksCacheTarget({
    target: "ranks:normal",
    force: true,
    readRanksMeta: async () => ({
      normal: { updatedAt: "new-normal", publishedAt: "new-normal-published" },
      cv: { updatedAt: "unrequested-cv", publishedAt: "unrequested-cv-published" },
    }),
    readNormalRanksBundle: async () => ({
      snapshot: {
        _meta: { updated_at: "new-normal" },
        missevan: { ranks: {}, dramas: {} },
        manbo: { ranks: {}, dramas: {} },
      },
      peakTrendSnapshot: null,
      updatedAt: "new-normal",
    }),
    readCvRanksBundle: async () => {
      throw new Error("unrequested CV bundle should not be read");
    },
  });

  const cache = __getRanksCacheForTest();
  assert.equal(cache.normalUpdatedAt, "new-normal");
  assert.equal(cache.cvUpdatedAt, "old-cv");
  assert.deepEqual(cache.cvSnapshot, { generated_at: "old-cv", rankings: {} });
  assert.deepEqual(cache.meta, {
    normal: { updatedAt: "new-normal", publishedAt: "new-normal-published" },
    cv: { updatedAt: "old-cv", publishedAt: "old-cv-published" },
    growth: { updatedAt: "", publishedAt: "" },
  });
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

test("rank response cache validator changes when rank versions or published times update", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { getRanksResponseCacheValidator } = await import("./server.js");

  const normalVersion = "2026-06-12T23:10:00+00:00";
  const firstValidator = getRanksResponseCacheValidator({
    schemaVersion: 6,
    updatedAt: normalVersion,
    cvSummary: { updatedAt: "2026-06-12T04:04:24+00:00" },
    meta: {
      normal: { publishedAt: "2026-06-12T23:15:00+00:00" },
      cv: { publishedAt: "2026-06-12T04:10:00+00:00" },
    },
  });
  const secondValidator = getRanksResponseCacheValidator({
    schemaVersion: 6,
    updatedAt: normalVersion,
    cvSummary: { updatedAt: "2026-06-13T04:04:24+00:00" },
    meta: {
      normal: { publishedAt: "2026-06-13T23:15:00+00:00" },
      cv: { publishedAt: "2026-06-13T04:10:00+00:00" },
    },
  });

  assert.notEqual(firstValidator, secondValidator);
  assert.match(secondValidator, /2026-06-12T23:10:00\+00:00/);
  assert.match(secondValidator, /2026-06-13T04:04:24\+00:00/);
  assert.match(secondValidator, /2026-06-13T23:15:00\+00:00/);
  assert.match(secondValidator, /2026-06-13T04:10:00\+00:00/);
});

test("rank-derived caches expire by daily update cycle", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const {
    getRankDerivedCacheCycleIdForConfig,
    isRankDerivedCacheEntryFreshForConfig,
  } = await import("./server.js");
  const config = {
    timeZone: "Asia/Shanghai",
    startHour: 7,
    endHour: 10,
    ttlMs: 10 * 60 * 1000,
  };

  assert.equal(
    getRankDerivedCacheCycleIdForConfig(Date.parse("2026-06-18T22:50:00.000Z"), config),
    "2026-06-18"
  );
  assert.equal(
    getRankDerivedCacheCycleIdForConfig(Date.parse("2026-06-19T00:40:00.000Z"), config),
    "2026-06-19"
  );

  assert.equal(
    isRankDerivedCacheEntryFreshForConfig(
      Date.parse("2026-06-18T22:50:00.000Z"),
      Date.parse("2026-06-19T02:10:00.000Z"),
      config
    ),
    false
  );

  assert.equal(
    isRankDerivedCacheEntryFreshForConfig(
      Date.parse("2026-06-19T00:40:00.000Z"),
      Date.parse("2026-06-19T02:10:00.000Z"),
      config
    ),
    true
  );

  assert.equal(
    isRankDerivedCacheEntryFreshForConfig(
      Date.parse("2026-06-19T00:40:00.000Z"),
      Date.parse("2026-06-19T00:55:00.000Z"),
      config
    ),
    false
  );

  assert.equal(
    isRankDerivedCacheEntryFreshForConfig(
      Date.parse("2026-06-19T00:40:00.000Z"),
      Date.parse("2026-06-19T22:00:00.000Z"),
      config
    ),
    true
  );

  assert.equal(
    isRankDerivedCacheEntryFreshForConfig(
      Date.parse("2026-06-19T00:40:00.000Z"),
      Date.parse("2026-06-19T23:01:00.000Z"),
      config
    ),
    false
  );
});
