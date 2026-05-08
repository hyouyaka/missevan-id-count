import test from "node:test";
import assert from "node:assert/strict";

import {
  extractSearchSeasonNumber,
  extractSearchSortKey,
  isCompleteSearchTermPrefix,
  normalizeManboIndexName,
  normalizeSearchText,
} from "./searchUtils.js";

test("normalizeSearchText removes common symbols and keeps compatibility alias", () => {
  assert.equal(normalizeSearchText("彼得·潘"), normalizeSearchText("彼得潘"));
  assert.equal(normalizeSearchText("A•B・C…D—E"), "abcde");
  assert.equal(normalizeManboIndexName("彼得·潘"), normalizeSearchText("彼得潘"));
});

test("isCompleteSearchTermPrefix distinguishes season prefixes from version prefixes", () => {
  assert.equal(isCompleteSearchTermPrefix("魔道祖师 第一季", "魔道祖师"), true);
  assert.equal(isCompleteSearchTermPrefix("魔道祖师第三季", "魔道祖师"), true);
  assert.equal(isCompleteSearchTermPrefix("魔道祖师日语版 第一季", "魔道祖师"), false);
});

test("extractSearchSeasonNumber parses common season markers only for complete term prefixes", () => {
  assert.equal(extractSearchSeasonNumber("魔道祖师 第一季", "魔道祖师"), 1);
  assert.equal(extractSearchSeasonNumber("魔道祖师 第二季", "魔道祖师"), 2);
  assert.equal(extractSearchSeasonNumber("魔道祖师第三季", "魔道祖师"), 3);
  assert.equal(extractSearchSeasonNumber("魔道祖师第10季", "魔道祖师"), 10);
  assert.equal(extractSearchSeasonNumber("魔道祖师全一季", "魔道祖师"), 1);
  assert.equal(extractSearchSeasonNumber("魔道祖师日语版 第一季", "魔道祖师"), null);
});

test("extractSearchSortKey ranks regular seasons before special entries", () => {
  assert.deepEqual(extractSearchSortKey("撒野 第一季", "撒野"), {
    baseKey: "撒野",
    kind: 0,
    seasonNumber: 1,
    partRank: 0,
  });
  assert.deepEqual(extractSearchSortKey("撒野 番外篇", "撒野"), {
    baseKey: "撒野",
    kind: 1,
    seasonNumber: null,
    partRank: 0,
  });
  assert.deepEqual(extractSearchSortKey("撒野 独家番外", "撒野"), {
    baseKey: "撒野",
    kind: 1,
    seasonNumber: null,
    partRank: 0,
  });
  assert.deepEqual(extractSearchSortKey("撒野 粤语版", "撒野"), {
    baseKey: "撒野",
    kind: 1,
    seasonNumber: null,
    partRank: 0,
  });
});

test("extractSearchSortKey parses season parts after matched partial titles", () => {
  assert.deepEqual(extractSearchSortKey("魔道祖师日语版 第一季（上）", "魔道祖师"), {
    baseKey: "魔道祖师日语版",
    kind: 0,
    seasonNumber: 1,
    partRank: 1,
  });
  assert.deepEqual(extractSearchSortKey("魔道祖师日语版 第一季（下）", "魔道祖师"), {
    baseKey: "魔道祖师日语版",
    kind: 0,
    seasonNumber: 1,
    partRank: 3,
  });
  assert.deepEqual(extractSearchSortKey("魔道祖师日语版 第二季（上）", "魔道祖师"), {
    baseKey: "魔道祖师日语版",
    kind: 0,
    seasonNumber: 2,
    partRank: 1,
  });
});

test("extractSearchSortKey groups plain titles with their special entries", () => {
  assert.deepEqual(extractSearchSortKey("奇洛李维斯回信", "回信"), {
    baseKey: "奇洛李维斯回信",
    kind: 2,
    seasonNumber: null,
    partRank: 0,
  });
  assert.deepEqual(extractSearchSortKey("奇洛李维斯回信 番外篇", "回信"), {
    baseKey: "奇洛李维斯回信",
    kind: 1,
    seasonNumber: null,
    partRank: 0,
  });
});

test("extractSearchSortKey groups full-season and special entries for infix keywords", () => {
  assert.deepEqual(extractSearchSortKey("aaamykeyword 全一季", "mykeyword"), {
    baseKey: "aaamykeyword",
    kind: 0,
    seasonNumber: 1,
    partRank: 0,
  });
  assert.deepEqual(extractSearchSortKey("aaamykeyword 番外篇", "mykeyword"), {
    baseKey: "aaamykeyword",
    kind: 1,
    seasonNumber: null,
    partRank: 0,
  });
});
