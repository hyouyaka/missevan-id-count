import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { getSearchSuggestionKeyword } from "../../shared/searchSuggestionUtils.js";
import { buildSearchSuggestionIndex, matchSearchSuggestions, createSearchSuggestionService } from "./searchSuggestionService.js";
import { registerSearchSuggestionRoutes } from "../routes/searchSuggestionRoutes.js";

test("suggestion eligibility is independent of search length and rejects imports and compound input", () => {
  for (const value of ["魔", "lu", "lzx", "魔2", " 魔 "]) assert.ok(getSearchSuggestionKeyword(value), value);
  for (const value of ["", "l", "123", "1467142227078676553", "https://www.missevan.com/mdrama/123", "魔道 天官", "魔道，天官", "魔道,天官", "分享：魔道", "魔\n道", {}, "a".repeat(201)]) {
    assert.equal(getSearchSuggestionKeyword(value), "", String(value));
  }
});

const sources = {
  missevanRecords: [
    { dramaId: 1, title: "魔道", catalog: 1 },
    { dramaId: 1, title: "魔道重复" },
    { dramaId: 2, title: "魔道祖师" },
    { dramaId: 3, title: "新魔道" },
    { dramaId: 4, title: "魔道祖师 第二季" },
    { dramaId: 5, title: "魔道祖师 第三季" },
    { dramaId: 6, title: "乔苏" },
  ],
  manboRecords: [{ dramaId: "1000000000000000001", name: "魔道", catalogName: "有声剧" }],
  cvCatalog: [
    { profileId: "cv:1", name: "魔道", aliases: ["魔老师"] },
    { profileId: "cv:2", name: "路知行", aliases: ["路老师"] },
    { profileId: "cv:3", name: "路知行", aliases: [] },
  ],
  getMissevanContentTypeLabel: (record) => record.catalog === 1 ? "广播剧" : "",
  getManboContentTypeLabel: (record) => record.catalogName || "",
};

test("ranking prioritizes exact, prefix, contains and pinyin with five stable distinct candidates", () => {
  const index = buildSearchSuggestionIndex(sources);
  const items = matchSearchSuggestions(index, "魔道");
  assert.equal(items.length, 5);
  assert.deepEqual(items.slice(0, 3).map((item) => item.key), ["cv:cv:1", "missevan:1", "manbo:1000000000000000001"]);
  assert.equal(items[1].contentTypeLabel, "广播剧");
  assert.equal(items[2].contentTypeLabel, "有声剧");
  assert.equal(items[0].contentTypeLabel, undefined);
  assert.equal(items[3].name, "魔道祖师");
  assert.equal(items[4].name, "魔道祖师 第二季");
  assert.equal(matchSearchSuggestions(index, "新魔")[0].name, "新魔道");
  assert.equal(matchSearchSuggestions(index, "路老师")[0].profileId, "cv:2");
  assert.deepEqual(matchSearchSuggestions(index, "lzx").map((item) => item.profileId), ["cv:2", "cv:3"]);
  assert.equal(matchSearchSuggestions(index, "luzhixing").length, 2);
  assert.equal(matchSearchSuggestions(index, "乔素").length, 0);
  assert.equal(matchSearchSuggestions(index, "无匹配").length, 0);
});

test("query cache expires, evicts at 200, and invalidates when a source snapshot changes", () => {
  let now = 0;
  const service = createSearchSuggestionService({ now: () => now });
  const first = service.search("魔道", sources);
  assert.equal(service.search("魔道", sources), first);
  now = 60_001;
  assert.notEqual(service.search("魔道", sources), first);
  const current = service.search("魔道", sources);
  for (let i = 0; i < 200; i++) service.search(`不存在${i}`, sources);
  assert.notEqual(service.search("魔道", sources), current);
  assert.deepEqual(service.search("魔道", { ...sources, missevanRecords: [], manboRecords: [], cvCatalog: [] }), []);
  assert.equal(service.search("路", { ...sources, missevanRecords: [] }).length, 2);
});

test("drama aliases match text and pinyin while candidates retain covers, main cast and CV avatars", () => {
  const index = buildSearchSuggestionIndex({
    missevanRecords: [
      { dramaId: 87409, title: "City of Angels 全一季", alias: "天使之城", aliases: ["天使城"], cover: "https://example.com/cover.jpg", maincvs: [1851, 7431], cvnames: { 1851: "张福正", 7431: "孙睿扬", 9: "非主役" } },
      { dramaId: 2, title: "无主役", cvnames: { 9: "非主役" } },
      { dramaId: 3, title: "City of Angels 第二季", seriesTitle: "天使之城 第二季" },
    ],
    manboRecords: [
      { dramaId: "1000000000000000001", name: "英文剧名", aliases: ["别名测试"], mainCvNames: ["主要演员", ""], mainCvNicknames: ["昵称", "第二昵称"] },
      { dramaId: "3", name: "昵称备用", mainCvNames: [], mainCvNicknames: ["备用主役"] },
    ],
    cvCatalog: [{ profileId: "cv:1", name: "张福正", aliases: [], avatar: "https://example.com/avatar.jpg" }],
  });
  for (const query of ["天使之城", "天使城", "天使", "tianshizhicheng", "tszc"]) {
    const item = matchSearchSuggestions(index, query).find((item) => item.id === "87409");
    assert.ok(item, query);
    assert.equal(item.id, "87409", query);
    assert.equal(item.name, "City of Angels 全一季");
    assert.equal(item.cover, "https://example.com/cover.jpg");
    assert.deepEqual(item.mainCvNames, ["张福正", "孙睿扬"]);
  }
  assert.deepEqual(matchSearchSuggestions(index, "无主役")[0].mainCvNames, []);
  assert.deepEqual(matchSearchSuggestions(index, "别名测试")[0].mainCvNames, ["主要演员"]);
  assert.deepEqual(matchSearchSuggestions(index, "昵称备用")[0].mainCvNames, ["备用主役"]);
  assert.equal(matchSearchSuggestions(index, "张福正")[0].avatar, "https://example.com/avatar.jpg");
  assert.equal(matchSearchSuggestions(index, "天使之城第二季")[0].name, "City of Angels 第二季");
  assert.equal(matchSearchSuggestions(index, "tianshizhichengdierji")[0].id, "3");
});

test("HTTP suggestions validate input and stay library-only even on empty and failed lookup", async () => {
  const app = express();
  let loads = 0;
  let fail = false;
  registerSearchSuggestionRoutes(app, {
    limiter: (_req, _res, next) => next(),
    service: createSearchSuggestionService(),
    async loadSources() { loads++; if (fail) throw new Error("offline"); return sources; },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const nativeFetch = globalThis.fetch;
  let unexpectedFetches = 0;
  globalThis.fetch = () => { unexpectedFetches++; throw new Error("No platform calls allowed"); };
  const get = (keyword) => nativeFetch(`http://127.0.0.1:${server.address().port}/search-suggestions?${keyword}`);
  try {
    assert.equal((await get("keyword%5Ba%5D=x")).status, 400);
    assert.deepEqual(await (await get("keyword=123")).json(), { suggestions: [] });
    assert.equal(loads, 0);
    assert.equal((await (await get(`keyword=${encodeURIComponent("魔")}`)).json()).suggestions.length, 5);
    assert.deepEqual(await (await get(`keyword=${encodeURIComponent("没有匹配")}`)).json(), { suggestions: [] });
    fail = true;
    assert.equal((await get(`keyword=${encodeURIComponent("魔")}`)).status, 503);
    assert.equal(unexpectedFetches, 0);
  } finally {
    globalThis.fetch = nativeFetch;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
