import test from "node:test";
import assert from "node:assert/strict";

import { normalizeManboIndexName } from "./shared/searchUtils.js";

test("normalizeManboIndexName removes common middle-dot and separator symbols", () => {
  assert.equal(normalizeManboIndexName("彼得·潘"), normalizeManboIndexName("彼得潘"));
  assert.equal(normalizeManboIndexName("A•B"), "ab");
  assert.equal(normalizeManboIndexName("A・B"), "ab");
  assert.equal(normalizeManboIndexName("A…B"), "ab");
  assert.equal(normalizeManboIndexName("A—B"), "ab");
});

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
