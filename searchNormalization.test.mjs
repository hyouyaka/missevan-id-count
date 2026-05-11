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
