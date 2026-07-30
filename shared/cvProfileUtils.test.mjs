import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCvCatalog,
  buildCvProfileResponse,
  collectCvWorks,
  normalizeCvPlatformId,
  parseCvIdMapSnapshot,
  parseManboInfoSnapshotPreservingCvIds,
  resolveCvCatalogEntry,
  searchCvCatalog,
} from "./cvProfileUtils.js";

const missevanRecords = [
  {
    dramaId: 101,
    title: "甲剧",
    maincvs: [1, 2],
    cvnames: { 1: "路知行", 2: "魏超", 3: "非主役" },
    cover: "https://example.com/a.jpg",
    catalog: 89,
    needpay: true,
    createTime: "2026.01",
  },
  {
    dramaId: 102,
    title: "独角戏",
    maincvs: [1],
    cvnames: { 1: "路知行" },
  },
];

const manboRecords = [
  {
    dramaId: "201",
    name: "乙剧",
    mainCvNames: ["路知行", "张福正"],
    mainCvNicknames: ["路老师", "张福正"],
    mainCvIds: [11, 12],
    mainCvRoleNames: ["角色甲", "角色乙"],
    cover: "https://example.com/b.jpg",
    catalogName: "有声剧",
    needpay: false,
    createTime: "",
  },
];

const cvInfoRecords = [
  {
    name: "路知行",
    avatar: "https://example.com/cv.jpg",
    aliases: ["路老师"],
    platformIds: {
      missevan: [1],
      manbo: [11],
    },
  },
];

test("CV ID map parsing preserves aliases, fallback names and unsafe Manbo IDs", () => {
  const snapshot = parseCvIdMapSnapshot(JSON.stringify({
    "映射键名": {
      cvId: 9,
      missevanCvId: 9,
      manboCvId: 19,
      displayName: "统一姓名",
      aliases: ["明确别名"],
      avatar: "avatar.jpg",
    },
  }).replace('"manboCvId":19', '"manboCvId":2028968973537640401'));
  assert.deepEqual(snapshot.records[0], {
    profileId: "mapped:missevan:9",
    identityKeys: [
      "mapped:missevan:9",
      "mapped:manbo:2028968973537640401",
    ],
    name: "统一姓名",
    avatar: "avatar.jpg",
    aliases: ["明确别名"],
    platformIds: {
      missevan: ["9"],
      manbo: ["2028968973537640401"],
    },
  });

  const fallback = parseCvIdMapSnapshot('{"映射键名":{"missevanCvId":1}}');
  assert.equal(fallback.records[0].name, "映射键名");
  assert.equal(fallback.records[0].profileId, "mapped:missevan:1");
});

test("CV platform IDs preserve raw JSON integers and reject unsafe Numbers", () => {
  const rawId = "2028968973537640401";
  const snapshot = parseManboInfoSnapshotPreservingCvIds(
    `{"records":[{"dramaId":"1","mainCvIds":[${rawId},2]}]}`
  );
  assert.deepEqual(snapshot.records[0].mainCvIds, [rawId, "2"]);
  assert.equal(normalizeCvPlatformId(Number(rawId)), "");
  assert.equal(normalizeCvPlatformId(rawId), rawId);
  assert.equal(normalizeCvPlatformId(42), "42");
});

test("Manbo actor identities preserve array positions and fallback to nicknames", () => {
  const catalog = buildCvCatalog({
    manboRecords: [{
      dramaId: "401",
      name: "位置映射",
      mainCvNames: ["甲", "", "同名"],
      mainCvNicknames: ["甲昵称", "乙昵称", "同名"],
      mainCvIds: ["11", "22", "33"],
    }, {
      dramaId: "402",
      name: "重复昵称但不同身份",
      mainCvNames: ["同名", "同名"],
      mainCvNicknames: ["同名", "同名"],
      mainCvIds: ["33", "44"],
    }],
  });

  assert.deepEqual(
    catalog.find((entry) => entry.platformIds.manbo.includes("22"))?.workIds.manbo,
    ["401"]
  );
  assert.equal(
    catalog.find((entry) => entry.platformIds.manbo.includes("22"))?.name,
    "乙昵称"
  );
  assert.equal(
    catalog.filter((entry) => entry.name === "同名").length,
    2
  );
});

test("shared platform IDs merge mapped records without merging aliases alone", () => {
  const snapshot = parseCvIdMapSnapshot(JSON.stringify({
    "吕书君": {
      displayName: "吕书君",
      aliases: ["阿君归来🎧单向波形"],
      missevanCvId: 3737,
      manboCvId: "2253903237133",
      avatar: "canonical.jpg",
    },
    "阿君归来": {
      displayName: "阿君归来🎧单向波形",
      aliases: [],
      manboCvId: "2253903237133",
      avatar: "secondary.jpg",
    },
    "别名碰撞": {
      displayName: "另一个人",
      aliases: ["阿君归来🎧单向波形"],
      manboCvId: "999",
    },
  }));

  assert.equal(snapshot.records.length, 2);
  const merged = snapshot.records.find((record) => record.name === "吕书君");
  assert.deepEqual(merged.platformIds, {
    missevan: ["3737"],
    manbo: ["2253903237133"],
  });
  assert.ok(merged.aliases.includes("阿君归来🎧单向波形"));
  assert.ok(merged.identityKeys.includes("mapped:manbo:2253903237133"));
  assert.equal(snapshot.diagnostics.duplicatePlatformIdCount, 1);
});

test("duplicate mapped Manbo IDs produce one searchable cross-platform profile", () => {
  const cvSnapshot = parseCvIdMapSnapshot(JSON.stringify({
    "吕书君": {
      displayName: "吕书君",
      aliases: ["阿君归来🎧单向波形"],
      missevanCvId: 3737,
      manboCvId: "2253903237133",
    },
    "阿君归来": {
      displayName: "阿君归来🎧单向波形",
      manboCvId: "2253903237133",
    },
  }));
  const catalog = buildCvCatalog({
    cvInfoRecords: cvSnapshot.records,
    missevanRecords: [{
      dramaId: "501",
      title: "猫耳作品",
      maincvs: ["3737"],
      cvnames: { 3737: "吕书君" },
    }],
    manboRecords: [{
      dramaId: "502",
      name: "漫播作品",
      mainCvNames: ["阿君归来🎧单向波形"],
      mainCvNicknames: ["阿君归来🎧单向波形"],
      mainCvIds: ["2253903237133"],
    }],
  });

  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].name, "吕书君");
  assert.deepEqual(catalog[0].workIds, {
    missevan: ["501"],
    manbo: ["502"],
  });
  assert.equal(searchCvCatalog(catalog, "吕书君").results.length, 1);
  assert.equal(searchCvCatalog(catalog, "阿君归来🎧单向波形").results.length, 1);
  assert.equal(
    resolveCvCatalogEntry(
      catalog,
      "阿君归来🎧单向波形",
      "mapped:manbo:2253903237133"
    ).entry,
    catalog[0]
  );
});

test("CV catalog searches canonical names, aliases, full pinyin and initials", () => {
  const catalog = buildCvCatalog({ missevanRecords, manboRecords, cvInfoRecords });
  assert.equal(searchCvCatalog(catalog, "路知行").results[0].workCount, 3);
  assert.equal(searchCvCatalog(catalog, "路知行").results[0].avatar, "https://example.com/cv.jpg");
  assert.equal(searchCvCatalog(catalog, "路老师").results[0].name, "路知行");
  assert.equal(searchCvCatalog(catalog, "luzhixing").exactMatch, true);
  assert.equal(searchCvCatalog(catalog, "lzx").exactMatch, true);
  assert.equal(searchCvCatalog(catalog, "角色甲").matchedCount, 0);
  assert.equal(searchCvCatalog(catalog, "非主役").matchedCount, 0);
});

test("CV catalog matches a Han query to a homophonic canonical name without weakening literal ranking", () => {
  const catalog = buildCvCatalog({
    missevanRecords: [
      {
        dramaId: 401,
        title: "同音姓名作品",
        maincvs: [1],
        cvnames: { 1: "乔苏" },
      },
      {
        dramaId: 402,
        title: "字面姓名作品",
        maincvs: [2],
        cvnames: { 2: "乔素" },
      },
    ],
  });

  const homophoneOnly = searchCvCatalog([catalog.find((entry) => entry.name === "乔苏")], "乔素");
  assert.equal(homophoneOnly.results[0].name, "乔苏");
  assert.equal(homophoneOnly.exactMatch, true);

  const literalFirst = searchCvCatalog(catalog, "乔素");
  assert.deepEqual(literalFirst.results.map((entry) => entry.name), ["乔素", "乔苏"]);
});

test("CV info platform IDs merge explicit identities and preserve unrelated same-name records", () => {
  const catalog = buildCvCatalog({
    missevanRecords: [{
      dramaId: 301,
      title: "平台甲",
      maincvs: [9],
      cvnames: { 9: "平台昵称" },
    }],
    manboRecords: [{
      dramaId: 302,
      name: "平台乙",
      mainCvIds: [19],
      mainCvNames: ["本名"],
      mainCvNicknames: ["另一个昵称"],
    }],
    cvInfoRecords: [{
      name: "统一姓名",
      avatar: "avatar.jpg",
      aliases: ["明确别名"],
      platformIds: { missevan: [9], manbo: [19] },
    }],
  });
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].name, "统一姓名");
  assert.equal(catalog[0].avatar, "avatar.jpg");
  assert.equal(catalog[0].workCount, 2);
  assert.deepEqual(
    new Set(catalog[0].aliases),
    new Set(["明确别名", "平台昵称", "本名", "另一个昵称"])
  );
});

test("CV catalog does not infer a cross-platform identity by name without a platform ID", () => {
  const catalog = buildCvCatalog({
    missevanRecords: [{
      dramaId: 311,
      title: "猫耳作品",
      maincvs: [9],
      cvnames: { 9: "同名演员" },
    }],
    manboRecords: [{
      dramaId: "312",
      name: "漫播作品",
      mainCvNames: ["同名演员"],
      mainCvIds: [],
    }],
    cvInfoRecords: [{
      name: "同名演员",
      aliases: ["明确别名"],
      platformIds: { missevan: [9], manbo: [] },
    }],
  });

  assert.equal(catalog.length, 2);
  const mapped = catalog.find((entry) => entry.profileId === "mapped:missevan:9");
  const manboOnly = catalog.find((entry) => entry.profileId.startsWith("manbo:name:"));
  assert.deepEqual(mapped.workIds, { missevan: ["311"], manbo: [] });
  assert.deepEqual(manboOnly.workIds, { missevan: [], manbo: ["312"] });
});

test("CV catalog does not infer main actors from the full Missevan CV name map", () => {
  const catalog = buildCvCatalog({
    missevanRecords: [{
      dramaId: 303,
      title: "缺少主役信息",
      cvnames: { 9: "非主役演员" },
    }],
  });

  assert.deepEqual(catalog, []);
});

test("CV catalog isolates identical names with different platform IDs and profiles collect assigned works", () => {
  const records = [
    {
      dramaId: 304,
      title: "映射作品",
      maincvs: [9],
      cvnames: { 9: "同名演员" },
    },
    {
      dramaId: 305,
      title: "未映射作品",
      maincvs: [10],
      cvnames: { 10: "同名演员" },
    },
  ];
  const catalog = buildCvCatalog({
    missevanRecords: records,
    cvInfoRecords: [{
      name: "同名演员",
      avatar: "mapped.jpg",
      aliases: [],
      platformIds: { missevan: [9], manbo: [] },
    }],
  });

  assert.equal(catalog.length, 2);
  const mappedEntry = catalog.find((entry) =>
    entry.platformIds.missevan.includes("9")
  );
  const unmappedEntry = catalog.find((entry) =>
    entry.platformIds.missevan.includes("10")
  );
  assert.deepEqual(mappedEntry.workIds.missevan, ["304"]);
  assert.deepEqual(unmappedEntry.workIds.missevan, ["305"]);
  assert.notEqual(mappedEntry.profileId, unmappedEntry.profileId);
  assert.equal(
    resolveCvCatalogEntry(catalog, "同名演员", unmappedEntry.profileId).entry,
    unmappedEntry
  );
  assert.deepEqual(resolveCvCatalogEntry([...catalog].reverse(), "同名演员"), {
    entry: null,
    status: 409,
    code: "CV_IDENTITY_AMBIGUOUS",
  });
  assert.deepEqual(
    searchCvCatalog(catalog, "同名演员").results.map((entry) => entry.profileId),
    [mappedEntry.profileId, unmappedEntry.profileId]
  );
  assert.deepEqual(
    collectCvWorks({ ...mappedEntry, missevanRecords: records }).map((work) => work.id),
    ["304"]
  );
  assert.deepEqual(
    collectCvWorks({ ...unmappedEntry, missevanRecords: records }).map((work) => work.id),
    ["305"]
  );
});

test("mapped CV profile IDs isolate duplicate display names and survive display-name changes", () => {
  const records = [
    {
      dramaId: 306,
      title: "同名作品甲",
      maincvs: [11],
      cvnames: { 11: "同名演员" },
    },
    {
      dramaId: 307,
      title: "同名作品乙",
      maincvs: [22],
      cvnames: { 22: "同名演员" },
    },
  ];
  const cvInfoRecords = [
    {
      name: "同名演员",
      aliases: [],
      platformIds: { missevan: [11], manbo: [] },
    },
    {
      name: "同名演员",
      aliases: [],
      platformIds: { missevan: [22], manbo: [] },
    },
  ];
  const catalog = buildCvCatalog({
    missevanRecords: records,
    cvInfoRecords,
  });

  assert.equal(catalog.length, 2);
  assert.deepEqual(
    new Set(catalog.map((entry) => entry.profileId)),
    new Set(["mapped:missevan:11", "mapped:missevan:22"])
  );
  assert.deepEqual(
    catalog.map((entry) => entry.workCount),
    [1, 1]
  );
  assert.equal(
    resolveCvCatalogEntry(catalog, "同名演员", "rank-work:missevan:307").entry?.profileId,
    "mapped:missevan:22"
  );

  const renamedCatalog = buildCvCatalog({
    missevanRecords: records,
    cvInfoRecords: [{
      ...cvInfoRecords[0],
      name: "演员新名字",
    }],
  });
  assert.equal(
    renamedCatalog.find((entry) => entry.name === "演员新名字").profileId,
    "mapped:missevan:11"
  );
});

test("rank-work identity resolution uses the CV name within a multi-actor work", () => {
  const catalog = buildCvCatalog({
    missevanRecords: [{
      dramaId: "308",
      title: "双主役作品",
      maincvs: ["31", "32"],
      cvnames: { 31: "演员甲", 32: "演员乙" },
    }],
  });

  assert.equal(
    resolveCvCatalogEntry(
      catalog,
      "演员乙",
      "rank-work:missevan:308"
    ).entry?.name,
    "演员乙"
  );
  assert.deepEqual(
    resolveCvCatalogEntry(
      catalog,
      "不存在的演员",
      "rank-work:missevan:308"
    ),
    { entry: null, status: 404, code: "CV_IDENTITY_NOT_FOUND" }
  );
});

test("CV catalog keeps only ten sorted matches", () => {
  const records = Array.from({ length: 14 }, (_, index) => ({
    dramaId: index + 1,
    title: `作品${index}`,
    maincvs: [index + 1],
    cvnames: { [index + 1]: `测试CV${index}` },
  }));
  const result = searchCvCatalog(buildCvCatalog({ missevanRecords: records }), "测试", 50);
  assert.equal(result.matchedCount, 14);
  assert.equal(result.results.length, 10);
});

test("CV works preserve platform rows and exclude the current CV from partners", () => {
  const catalog = buildCvCatalog({ missevanRecords, manboRecords, cvInfoRecords });
  const entry = resolveCvCatalogEntry(catalog, "路老师").entry;
  const works = collectCvWorks({
    ...entry,
    missevanRecords,
    manboRecords,
  });
  assert.equal(works.length, 3);
  assert.deepEqual(works.find((work) => work.id === "101").partners, ["魏超"]);
  assert.deepEqual(works.find((work) => work.id === "102").partners, []);
  assert.deepEqual(works.find((work) => work.id === "201").partners, ["张福正"]);
  assert.equal(works.find((work) => work.id === "101").category, "radio_drama");
  assert.equal(works.find((work) => work.id === "101").cover, "https://example.com/a.jpg");
  assert.equal(works.find((work) => work.id === "101").needpay, true);
  assert.equal(works.find((work) => work.id === "101").createTime, "2026.01");
  assert.equal(works.find((work) => work.id === "201").category, "audio_drama");
  assert.equal(works.find((work) => work.id === "201").needpay, false);
  assert.equal(works.find((work) => work.id === "201").createTime, "");
});

test("CV identity resolution is strict for explicit keys and compatible for unique names", () => {
  const catalog = buildCvCatalog({ missevanRecords, manboRecords, cvInfoRecords });
  const legacy = resolveCvCatalogEntry(catalog, "路老师");
  assert.equal(legacy.status, 200);
  assert.equal(legacy.entry.name, "路知行");
  assert.deepEqual(
    resolveCvCatalogEntry(catalog, "路老师", "mapped:manbo:11").entry,
    legacy.entry
  );
  assert.deepEqual(
    resolveCvCatalogEntry(catalog, "路老师", "mapped:manbo:999"),
    { entry: null, status: 404, code: "CV_IDENTITY_NOT_FOUND" }
  );
});

test("CV work collection requires catalog-assigned work IDs", () => {
  assert.deepEqual(collectCvWorks({
    name: "路知行",
    aliases: ["路老师"],
    missevanRecords,
    manboRecords,
  }), []);
});

test("CV profile uses each work latest point, discloses stale dates and excludes missing values", () => {
  const response = buildCvProfileResponse({
    name: "路知行",
    works: [
      { platform: "missevan", id: "101", title: "同名作品", needpay: true, createTime: "2026.01", partners: ["魏超"] },
      { platform: "missevan", id: "102", title: "无数据", partners: [] },
      { platform: "manbo", id: "201", title: "同名作品", partners: ["张福正"] },
    ],
    playbackBundles: {
      missevan: {
        dates: ["2026-07-20", "2026-07-27"],
        snapshotsByDate: {
          "2026-07-20": { dramas: { 101: { view_count: 10 } } },
          "2026-07-27": { dramas: {} },
        },
      },
      manbo: {
        dates: ["2026-07-27"],
        snapshotsByDate: {
          "2026-07-27": { dramas: { 201: { view_count: 20 } } },
        },
      },
    },
  });
  assert.equal(response.totals.playback, 30);
  assert.equal(response.totals.missingWorkCount, 1);
  assert.equal(response.freshness.missevan.latestDate, "2026-07-20");
  assert.deepEqual(response.stats.missevan, {
    workCount: 2,
    playback: 10,
    dataUpdatedAt: "2026-07-20",
    staleWorkCount: 0,
  });
  assert.deepEqual(response.stats.manbo, {
    workCount: 1,
    playback: 20,
    dataUpdatedAt: "2026-07-27",
    staleWorkCount: 0,
  });
  assert.equal(response.works.length, 3);
  assert.equal(response.works.find((work) => work.id === "101").needpay, true);
  assert.equal(response.works.find((work) => work.id === "101").createTime, "2026.01");
  assert.equal(response.works.find((work) => work.id === "102").createTime, "");
  assert.equal(response.works.at(-1).playCount, null);
});

test("CV profile returns null totals when no watchcount data exists", () => {
  const response = buildCvProfileResponse({
    name: "路知行",
    works: [{ platform: "missevan", id: "101", title: "甲剧", partners: [] }],
  });
  assert.equal(response.totals.playback, null);
  assert.equal(response.totals.missevanPlayback, null);
});
