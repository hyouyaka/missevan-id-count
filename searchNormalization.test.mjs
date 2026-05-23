import test from "node:test";
import assert from "node:assert/strict";

test("library search matches Missevan titles when query omits common symbols", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { searchMissevanLibraryRecords } = await import("./server.js");
  const records = [
    {
      dramaId: "101",
      soundIds: [],
      title: "彼得·潘与辛德瑞拉 第一季",
      seriesTitle: "",
      cvnames: {},
      cvroles: {},
      author: "",
      catalog: 89,
    },
  ];

  const results = searchMissevanLibraryRecords(records, "彼得潘");

  assert.equal(results.length, 1);
  assert.equal(results[0].dramaId, "101");
});

test("library search matches Manbo names when query omits common symbols", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { searchManboLibraryRecords } = await import("./server.js");
  const records = [
    {
      dramaId: "202",
      name: "A・B",
      aliases: [],
      mainCvNicknames: [],
      mainCvNames: [],
      mainCvRoleNames: [],
      seriesTitle: "",
      author: "",
      catalogName: "",
    },
  ];

  const results = searchManboLibraryRecords(records, "AB");

  assert.equal(results.length, 1);
  assert.equal(results[0].dramaId, "202");
});

test("library search matches Missevan titles by pinyin initials", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { searchMissevanLibraryRecords } = await import("./server.js");
  const records = [
    {
      dramaId: "301",
      soundIds: [],
      title: "再世权臣",
      seriesTitle: "",
      cvnames: {},
      cvroles: {},
      author: "",
      catalog: 89,
      searchPinyinTokens: ["zaishiquanchen", "zsqc"],
    },
  ];

  const results = searchMissevanLibraryRecords(records, "zsqc");

  assert.equal(results.length, 1);
  assert.equal(results[0].dramaId, "301");
});

test("library search matches Missevan titles by homophone pinyin", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { searchMissevanLibraryRecords } = await import("./server.js");
  const records = [
    {
      dramaId: "302",
      soundIds: [],
      title: "再世权臣",
      seriesTitle: "",
      cvnames: {},
      cvroles: {},
      author: "",
      catalog: 89,
      searchPinyinTokens: ["zaishiquanchen", "zsqc"],
    },
  ];

  const results = searchMissevanLibraryRecords(records, "再试权臣");

  assert.equal(results.length, 1);
  assert.equal(results[0].dramaId, "302");
});

test("library search matches Manbo titles by full pinyin", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { searchManboLibraryRecords } = await import("./server.js");
  const records = [
    {
      dramaId: "303",
      name: "魔道祖师",
      aliases: [],
      mainCvNicknames: [],
      mainCvNames: [],
      mainCvRoleNames: [],
      seriesTitle: "",
      author: "",
      catalogName: "",
      searchPinyinTokens: ["modaozushi", "mdzs"],
    },
    {
      dramaId: "304",
      name: "奇洛李维斯回信",
      aliases: [],
      mainCvNicknames: [],
      mainCvNames: [],
      mainCvRoleNames: [],
      seriesTitle: "",
      author: "",
      catalogName: "",
      searchPinyinTokens: ["qiluoliweisihuixin", "qllwshx"],
    },
  ];

  assert.equal(searchManboLibraryRecords(records, "modaozushi")[0]?.dramaId, "303");
  assert.equal(searchManboLibraryRecords(records, "huixin")[0]?.dramaId, "304");
});

test("Missevan Han homophone queries rank full pinyin title matches above broad initials matches", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { searchMissevanLibraryRecords } = await import("./server.js");
  const records = [
    {
      dramaId: "401",
      soundIds: [],
      title: "洄天 第一季",
      seriesTitle: "",
      cvnames: {},
      cvroles: {},
      author: "淮上",
      catalog: 89,
      searchPinyinTokens: ["huitiandiyiji", "htdyj", "huaishang", "hs"],
    },
    {
      dramaId: "402",
      soundIds: [],
      title: "无关标题",
      seriesTitle: "",
      cvnames: {},
      cvroles: {},
      author: "壶鱼辣椒",
      catalog: 89,
      searchPinyinTokens: ["wuguanbiaoti", "wgbt", "huyulajiao", "hylj", "ht"],
    },
  ];

  assert.equal(searchMissevanLibraryRecords(records, "洄天")[0]?.dramaId, "401");
  assert.equal(searchMissevanLibraryRecords(records, "回填")[0]?.dramaId, "401");
  assert.equal(searchMissevanLibraryRecords(records, "汇天")[0]?.dramaId, "401");
});

test("library search does not match across pinyin syllable or word boundaries", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { searchMissevanLibraryRecords } = await import("./server.js");

  const results = searchMissevanLibraryRecords([
    {
      dramaId: "85974",
      soundIds: [],
      title: "奇洛李维斯回信",
      seriesTitle: "",
      cvnames: {},
      cvroles: {},
      author: "",
      catalog: 89,
    },
    {
      dramaId: "91100",
      soundIds: [],
      title: "束缚厄剌托",
      seriesTitle: "束缚厄剌托",
      cvnames: { 4581: "瀚墨" },
      cvroles: { 4581: "林在水 / 星河Bunny" },
      author: "仿生犬",
      catalog: 93,
      searchPinyinTokens: [
        "shufuelatuo",
        "sfelt",
        "hanmo",
        "hm",
        "linzaishuixinghebunny",
        "lzsxhbunny",
        "fangshengquan",
        "fsq",
      ],
    },
  ], "回信").map((item) => item.title);

  assert.deepEqual(results, ["奇洛李维斯回信"]);
});

test("library search ignores season suffixes during matching", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { searchMissevanLibraryRecords } = await import("./server.js");
  const records = [
    {
      dramaId: "401",
      soundIds: [],
      title: "洄天 第一季",
      seriesTitle: "",
      cvnames: {},
      cvroles: {},
      author: "淮上",
      catalog: 89,
    },
  ];

  assert.equal(searchMissevanLibraryRecords(records, "洄天")[0]?.dramaId, "401");
  assert.equal(searchMissevanLibraryRecords(records, "回填")[0]?.dramaId, "401");
  assert.equal(searchMissevanLibraryRecords(records, "huitian")[0]?.dramaId, "401");
  assert.equal(searchMissevanLibraryRecords(records, "tiandi").length, 0);
  assert.equal(searchMissevanLibraryRecords(records, "第一季").length, 0);
});

test("library search keeps numeric Missevan drama and sound ID matching", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { searchMissevanLibraryRecords } = await import("./server.js");
  const records = [
    {
      dramaId: "101",
      soundIds: ["9001"],
      title: "无符号标题",
      seriesTitle: "",
      cvnames: {},
      cvroles: {},
      author: "",
      catalog: 89,
    },
  ];

  assert.equal(searchMissevanLibraryRecords(records, "101")[0]?.dramaId, "101");
  assert.equal(searchMissevanLibraryRecords(records, "9001")[0]?.dramaId, "101");
});

test("library search does not partially match numeric Missevan drama or sound IDs", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { searchMissevanLibraryRecords } = await import("./server.js");
  const records = [
    {
      dramaId: "60282",
      soundIds: ["7039650"],
      title: "无符号标题",
      seriesTitle: "",
      cvnames: {},
      cvroles: {},
      author: "",
      catalog: 89,
    },
  ];

  assert.equal(searchMissevanLibraryRecords(records, "602").length, 0);
  assert.equal(searchMissevanLibraryRecords(records, "703").length, 0);
});

test("library search keeps numeric Manbo drama ID matching exact only", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { searchManboLibraryRecords } = await import("./server.js");
  const records = [
    {
      dramaId: "1467142227078676553",
      name: "神明今夜想你",
      aliases: [],
      mainCvNicknames: [],
      mainCvNames: [],
      mainCvRoleNames: [],
      seriesTitle: "",
      author: "",
      catalogName: "",
    },
  ];

  assert.equal(searchManboLibraryRecords(records, "1467142227078676553")[0]?.dramaId, "1467142227078676553");
  assert.equal(searchManboLibraryRecords(records, "146714").length, 0);
});

test("Missevan manual input normalization preserves drama and sound link intent", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { normalizeMissevanDramaCardItems } = await import("./server.js");

  const items = normalizeMissevanDramaCardItems({
    dramaIds: [101],
    items: [
      { raw: "https://www.missevan.com/mdrama/93420?share_channel=wechat" },
      { raw: "https://www.missevan.com/sound/12681701?share_channel=copy" },
      { raw: "123456" },
      { raw: "bad-link" },
    ],
  });

  assert.deepEqual(items, [
    { raw: "101", type: "drama", id: "101" },
    {
      raw: "https://www.missevan.com/mdrama/93420?share_channel=wechat",
      type: "drama",
      id: "93420",
    },
    {
      raw: "https://www.missevan.com/sound/12681701?share_channel=copy",
      type: "sound",
      id: "12681701",
    },
    { raw: "123456", type: "sound", id: "123456" },
    { raw: "bad-link", type: "invalid", id: "" },
  ]);
});

test("Missevan drama card result dedupe keeps one card per resolved drama ID", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { dedupeMissevanDramaCardResults } = await import("./server.js");

  assert.deepEqual(
    dedupeMissevanDramaCardResults([
      { id: 93420, name: "撒野" },
      { id: "93420", name: "撒野 分集链接重复" },
      { id: 101, name: "其他作品" },
    ]),
    [
      { id: 93420, name: "撒野" },
      { id: 101, name: "其他作品" },
    ]
  );
});

test("Missevan direct search normalization detects share links before keyword search", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { normalizeMissevanDirectSearchInput } = await import("./server.js");

  assert.deepEqual(
    normalizeMissevanDirectSearchInput("https://www.missevan.com/mdrama/93420?share_channel=wechat"),
    {
      raw: "https://www.missevan.com/mdrama/93420?share_channel=wechat",
      type: "drama",
      id: "93420",
    }
  );
  assert.deepEqual(
    normalizeMissevanDirectSearchInput("https://www.missevan.com/sound/12681701?share_channel=copy"),
    {
      raw: "https://www.missevan.com/sound/12681701?share_channel=copy",
      type: "sound",
      id: "12681701",
    }
  );
  assert.equal(normalizeMissevanDirectSearchInput("普通关键词"), null);
});

test("Missevan API fallback option is disabled only by apiFallback=0", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { shouldUseMissevanApiFallback } = await import("./server.js");

  assert.equal(shouldUseMissevanApiFallback(undefined), true);
  assert.equal(shouldUseMissevanApiFallback(""), true);
  assert.equal(shouldUseMissevanApiFallback("1"), true);
  assert.equal(shouldUseMissevanApiFallback("false"), true);
  assert.equal(shouldUseMissevanApiFallback("0"), false);
  assert.equal(shouldUseMissevanApiFallback(0), false);
});

test("Missevan API search usage log entries describe real external calls", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { buildMissevanSearchApiUsageLog } = await import("./server.js");

  assert.deepEqual(buildMissevanSearchApiUsageLog("撒野", { matchedCount: 2 }), {
    platform: "missevan",
    action: "missevan_search_api",
    keyword: "撒野",
    success: true,
    matchedCount: 2,
    cached: false,
  });
  assert.deepEqual(
    buildMissevanSearchApiUsageLog("撒野", {
      matchedCount: 0,
      error: new Error("ACCESS_DENIED_COOLDOWN:test"),
    }),
    {
      platform: "missevan",
      action: "missevan_search_api",
      keyword: "撒野",
      success: false,
      matchedCount: 0,
      cached: false,
      accessDenied: true,
      error: "ACCESS_DENIED_COOLDOWN:test",
    }
  );
});

test("Manbo API search usage log entries describe real external calls", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { buildManboSearchApiUsageLog } = await import("./server.js");

  assert.deepEqual(buildManboSearchApiUsageLog("心眼", { matchedCount: 2 }), {
    platform: "manbo",
    action: "manbo_search_api",
    keyword: "心眼",
    success: true,
    matchedCount: 2,
    cached: false,
  });
  assert.deepEqual(
    buildManboSearchApiUsageLog("心眼", {
      matchedCount: 0,
      error: new Error("HTTP 500"),
    }),
    {
      platform: "manbo",
      action: "manbo_search_api",
      keyword: "心眼",
      success: false,
      matchedCount: 0,
      cached: false,
      error: "HTTP 500",
    }
  );
});

test("favorite usage log entries are accepted and sanitized", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { buildFavoriteUsageLog } = await import("./server.js");

  assert.deepEqual(
    buildFavoriteUsageLog({
      platform: "missevan",
      action: "favorite_add",
      dramaId: "93038",
      dramaName: "一屋暗灯",
      source: "search",
    }),
    {
      platform: "missevan",
      action: "favorite_add",
      dramaId: "93038",
      dramaName: "一屋暗灯",
      source: "search",
      success: true,
    }
  );
  assert.equal(buildFavoriteUsageLog({ platform: "manbo", action: "favorite_remove", dramaId: "1467142227078676553" }).action, "favorite_remove");
  assert.equal(buildFavoriteUsageLog({ platform: "missevan", action: "favorite_add", dramaId: "" }), null);
});

test("stats task source is normalized for favorite refresh logs", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { normalizeStatsTaskSource } = await import("./server.js");

  assert.equal(normalizeStatsTaskSource(" favorite "), "favorite");
  assert.equal(normalizeStatsTaskSource("x".repeat(80)), "x".repeat(40));
  assert.equal(normalizeStatsTaskSource(""), "");
});

test("desktop favorites read errors keep a JSON response payload with file path", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { buildDesktopFavoritesReadErrorPayload } = await import("./server.js");
  const payload = buildDesktopFavoritesReadErrorPayload("C:\\portable\\mm-toolkit-favorites.json");

  assert.equal(payload.success, false);
  assert.equal(payload.message, "桌面收藏 JSON 读取失败");
  assert.equal(payload.exists, false);
  assert.equal(payload.filePath, "C:\\portable\\mm-toolkit-favorites.json");
  assert.deepEqual(payload.data.favorites, []);
  assert.deepEqual(payload.data.snapshots, []);
  assert.deepEqual(payload.data.settings, {
    deltaMetric: "viewCount",
    sortBy: "lastSnapshotAt",
  });
});

test("Manbo API search candidates normalize to search result cards", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { normalizeManboSearchApiCandidate, buildManboApiSearchFallbackCard } = await import("./server.js");

  const record = normalizeManboSearchApiCandidate({
    radioDramaId: 1653424609497710600,
    radioDramaIdStr: "1653424609497710659",
    title: "心眼·第一季",
    coverPic: "https://img.kilamanbo.com/h5/1701189900396700.jpg",
    watchCount: 15140036,
    collectionFormatText: "超过19万人追剧",
    cvNameStr: "陈张太康 & 文森",
    category: "有声剧",
    categoryLabels: [{ name: "广播剧" }],
    author: "耳东兔子",
    price: 188,
    vipFree: 1,
  });
  const card = buildManboApiSearchFallbackCard(record);

  assert.deepEqual(
    {
      id: card.id,
      name: card.name,
      cover: card.cover,
      view_count: card.view_count,
      playCountWan: card.playCountWan,
      platform: card.platform,
      checked: card.checked,
      search_source: card.search_source,
      content_type_label: card.content_type_label,
      payment_label: card.payment_label,
      main_cvs: card.main_cvs,
      main_cv_text: card.main_cv_text,
      author: card.author,
    },
    {
      id: "1653424609497710659",
      name: "心眼·第一季",
      cover: "https://img.kilamanbo.com/h5/1701189900396700.jpg",
      view_count: 15140036,
      playCountWan: "1514.0万",
      platform: "manbo",
      checked: false,
      search_source: "manbo_api",
      content_type_label: "有声剧",
      payment_label: "会员",
      main_cvs: ["陈张太康", "文森"],
      main_cv_text: "主要CV：陈张太康，文森",
      author: "耳东兔子",
    }
  );
});

test("Manbo API search payment labels follow price and vipFree", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { normalizeManboSearchApiCandidate, buildManboApiSearchFallbackCard } = await import("./server.js");

  const buildCard = (overrides) =>
    buildManboApiSearchFallbackCard(
      normalizeManboSearchApiCandidate({
        radioDramaIdStr: String(overrides.id),
        title: `测试剧${overrides.id}`,
        category: "广播剧",
        ...overrides,
      })
    );

  assert.equal(buildCard({ id: 1, price: 999, vipFree: 1 }).payment_label, "会员");
  assert.equal(buildCard({ id: 2, price: 101, vipFree: 0 }).payment_label, "付费");
  assert.equal(buildCard({ id: 3, price: 100, vipFree: 0 }).payment_label, "免费");
  assert.equal(buildCard({ id: 4, price: 0, vipFree: 0 }).payment_label, "免费");
});

test("Manbo search source chooses library records before API fallback", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { selectManboSearchSourceRecords } = await import("./server.js");

  const libraryRecords = [{ dramaId: "1", name: "本地结果" }];
  const apiRecords = [{ dramaId: "2", name: "接口结果" }];

  assert.deepEqual(selectManboSearchSourceRecords(libraryRecords, apiRecords), {
    source: "library",
    records: libraryRecords,
  });
  assert.deepEqual(selectManboSearchSourceRecords([], apiRecords), {
    source: "manbo_api",
    records: apiRecords,
  });
});

test("Manbo API search payload parser rejects business error responses", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { normalizeManboSearchApiPayloadRecords } = await import("./server.js");

  assert.throws(
    () =>
      normalizeManboSearchApiPayloadRecords({
        h: { code: 429, msg: "too many requests" },
        b: { searchStructureNewRespList: [] },
      }),
    /Manbo search API error 429: too many requests/
  );
});

test("Missevan drama detail exposes lastupdate_time as updated_at", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { normalizeMissevanDramaInfo } = await import("./server.js");

  const info = normalizeMissevanDramaInfo({
    drama: {
      id: 29187,
      name: "吞海 第一季",
      lastupdate_time: "2026-05-18 12:34:56",
    },
    episodes: { episode: [] },
  });

  assert.equal(info.drama.updated_at, "2026-05-18 12:34:56");
});

test("Manbo drama detail exposes updateTime as updated_at", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { normalizeManboDramaInfo } = await import("./server.js");

  const info = normalizeManboDramaInfo({
    radioDramaIdStr: "123456789012345678",
    title: "测试漫播剧",
    updateTime: "2026-05-18T12:34:56+08:00",
    setRespList: [],
  });

  assert.equal(info.drama.updated_at, "2026-05-18T12:34:56+08:00");
});

test("Missevan library search ranks complete term prefixes above ordinary prefixes", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { searchMissevanLibraryRecords } = await import("./server.js");
  const records = [
    {
      dramaId: "3004",
      soundIds: [],
      title: "魔道祖师日语版 第一季",
      seriesTitle: "",
      cvnames: {},
      cvroles: {},
      author: "",
      catalog: 89,
    },
    {
      dramaId: "3003",
      soundIds: [],
      title: "魔道祖师第三季",
      seriesTitle: "",
      cvnames: {},
      cvroles: {},
      author: "",
      catalog: 89,
    },
    {
      dramaId: "3002",
      soundIds: [],
      title: "魔道祖师 第二季",
      seriesTitle: "",
      cvnames: {},
      cvroles: {},
      author: "",
      catalog: 89,
    },
    {
      dramaId: "3001",
      soundIds: [],
      title: "魔道祖师 第一季",
      seriesTitle: "",
      cvnames: {},
      cvroles: {},
      author: "",
      catalog: 89,
    },
  ];

  const results = searchMissevanLibraryRecords(records, "魔道祖师").map((item) => item.title);

  assert.deepEqual(results, [
    "魔道祖师 第一季",
    "魔道祖师 第二季",
    "魔道祖师第三季",
    "魔道祖师日语版 第一季",
  ]);
});

test("Manbo library search ranks complete term prefixes above ordinary prefixes", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { searchManboLibraryRecords } = await import("./server.js");
  const records = [
    {
      dramaId: "4002",
      name: "魔道祖师日语版 第一季",
      aliases: [],
      mainCvNicknames: [],
      mainCvNames: [],
      mainCvRoleNames: [],
      seriesTitle: "",
      author: "",
      catalogName: "",
    },
    {
      dramaId: "4001",
      name: "魔道祖师 第一季",
      aliases: [],
      mainCvNicknames: [],
      mainCvNames: [],
      mainCvRoleNames: [],
      seriesTitle: "",
      author: "",
      catalogName: "",
    },
  ];

  const results = searchManboLibraryRecords(records, "魔道祖师").map((item) => item.name);

  assert.deepEqual(results, ["魔道祖师 第一季", "魔道祖师日语版 第一季"]);
});

test("library search sorts ordinary prefix matches by season when they share a title base", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { searchMissevanLibraryRecords } = await import("./server.js");
  const records = [
    {
      dramaId: "5001",
      soundIds: [],
      title: "魔道祖师日语版 第一季",
      seriesTitle: "",
      cvnames: {},
      cvroles: {},
      author: "",
      catalog: 89,
    },
    {
      dramaId: "5002",
      soundIds: [],
      title: "魔道祖师日语版 第二季",
      seriesTitle: "",
      cvnames: {},
      cvroles: {},
      author: "",
      catalog: 89,
    },
  ];

  const results = searchMissevanLibraryRecords(records, "魔道祖师日").map((item) => item.title);

  assert.deepEqual(results, [
    "魔道祖师日语版 第一季",
    "魔道祖师日语版 第二季",
  ]);
});

test("library search ranks regular seasons before special entries for the same title base", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { searchMissevanLibraryRecords } = await import("./server.js");
  const records = [
    {
      dramaId: "6006",
      soundIds: [],
      title: "撒野 粤语版",
      seriesTitle: "",
      cvnames: {},
      cvroles: {},
      author: "",
      catalog: 89,
    },
    {
      dramaId: "6005",
      soundIds: [],
      title: "撒野 独家番外",
      seriesTitle: "",
      cvnames: {},
      cvroles: {},
      author: "",
      catalog: 89,
    },
    {
      dramaId: "6004",
      soundIds: [],
      title: "撒野 小剧场",
      seriesTitle: "",
      cvnames: {},
      cvroles: {},
      author: "",
      catalog: 89,
    },
    {
      dramaId: "6003",
      soundIds: [],
      title: "撒野 番外篇",
      seriesTitle: "",
      cvnames: {},
      cvroles: {},
      author: "",
      catalog: 89,
    },
    {
      dramaId: "6002",
      soundIds: [],
      title: "撒野 第二季",
      seriesTitle: "",
      cvnames: {},
      cvroles: {},
      author: "",
      catalog: 89,
    },
    {
      dramaId: "6001",
      soundIds: [],
      title: "撒野 第一季",
      seriesTitle: "",
      cvnames: {},
      cvroles: {},
      author: "",
      catalog: 89,
    },
  ];

  const results = searchMissevanLibraryRecords(records, "撒野").map((item) => item.title);

  assert.deepEqual(results, [
    "撒野 第一季",
    "撒野 第二季",
    "撒野 粤语版",
    "撒野 独家番外",
    "撒野 小剧场",
    "撒野 番外篇",
  ]);
});

test("library search sorts partial title seasons and parts before later seasons", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { searchMissevanLibraryRecords } = await import("./server.js");
  const records = [
    {
      dramaId: "7003",
      soundIds: [],
      title: "魔道祖师日语版 第二季（上）",
      seriesTitle: "",
      cvnames: {},
      cvroles: {},
      author: "",
      catalog: 89,
    },
    {
      dramaId: "7002",
      soundIds: [],
      title: "魔道祖师日语版 第一季（下）",
      seriesTitle: "",
      cvnames: {},
      cvroles: {},
      author: "",
      catalog: 89,
    },
    {
      dramaId: "7001",
      soundIds: [],
      title: "魔道祖师日语版 第一季（上）",
      seriesTitle: "",
      cvnames: {},
      cvroles: {},
      author: "",
      catalog: 89,
    },
  ];

  const results = searchMissevanLibraryRecords(records, "魔道祖师").map((item) => item.title);

  assert.deepEqual(results, [
    "魔道祖师日语版 第一季（上）",
    "魔道祖师日语版 第一季（下）",
    "魔道祖师日语版 第二季（上）",
  ]);
});

test("library search keeps a plain partial title before its special entry", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { searchMissevanLibraryRecords } = await import("./server.js");
  const records = [
    {
      dramaId: "8002",
      soundIds: [],
      title: "奇洛李维斯回信 番外篇",
      seriesTitle: "",
      cvnames: {},
      cvroles: {},
      author: "",
      catalog: 89,
    },
    {
      dramaId: "8001",
      soundIds: [],
      title: "奇洛李维斯回信",
      seriesTitle: "",
      cvnames: {},
      cvroles: {},
      author: "",
      catalog: 89,
    },
  ];

  const results = searchMissevanLibraryRecords(records, "回信").map((item) => item.title);

  assert.deepEqual(results, ["奇洛李维斯回信", "奇洛李维斯回信 番外篇"]);
});

test("library search orders title-base groups by ID then sorts entries inside each group", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { searchMissevanLibraryRecords } = await import("./server.js");
  const records = [
    {
      dramaId: "9004",
      soundIds: [],
      title: "aaamykeyword 番外篇",
      seriesTitle: "",
      cvnames: {},
      cvroles: {},
      author: "",
      catalog: 89,
    },
    {
      dramaId: "9003",
      soundIds: [],
      title: "bbbmykeywordccc 第一季",
      seriesTitle: "",
      cvnames: {},
      cvroles: {},
      author: "",
      catalog: 89,
    },
    {
      dramaId: "9002",
      soundIds: [],
      title: "dddmykeyword",
      seriesTitle: "",
      cvnames: {},
      cvroles: {},
      author: "",
      catalog: 89,
    },
    {
      dramaId: "9001",
      soundIds: [],
      title: "aaamykeyword 全一季",
      seriesTitle: "",
      cvnames: {},
      cvroles: {},
      author: "",
      catalog: 89,
    },
  ];

  const results = searchMissevanLibraryRecords(records, "mykeyword").map((item) => item.title);

  assert.deepEqual(results, [
    "aaamykeyword 全一季",
    "aaamykeyword 番外篇",
    "bbbmykeywordccc 第一季",
    "dddmykeyword",
  ]);
});

test("info store read failure preserves an already loaded snapshot", async () => {
  process.env.START_SERVER_ON_IMPORT = "false";
  const { getInfoStoreReadFailureSnapshot } = await import("./server.js");
  const store = {
    loaded: true,
    snapshot: {
      version: 1,
      updatedAt: 1710000000000,
      records: [
        {
          dramaId: "101",
          name: "已加载作品",
        },
      ],
    },
  };

  const fallbackSnapshot = getInfoStoreReadFailureSnapshot(store);

  assert.deepEqual(fallbackSnapshot, store.snapshot);
  assert.notEqual(fallbackSnapshot, store.snapshot);
  fallbackSnapshot.records[0].name = "修改副本";
  assert.equal(store.snapshot.records[0].name, "已加载作品");
});
