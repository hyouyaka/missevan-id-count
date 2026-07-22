import test from "node:test";
import assert from "node:assert/strict";

import {
  extractSearchSeasonNumber,
  extractSearchSortKey,
  isCompleteSearchTermPrefix,
  isSearchKeywordLongEnough,
  parseMissevanInputToken,
  normalizeSearchText,
  stripSearchSeasonSuffix,
} from "./searchUtils.js";

test("normalizeSearchText removes common symbols", () => {
  assert.equal(normalizeSearchText("彼得·潘"), normalizeSearchText("彼得潘"));
  assert.equal(normalizeSearchText("A•B・C…D—E"), "abcde");
});

test("isSearchKeywordLongEnough requires two Han chars or three normalized non-Han chars", () => {
  assert.equal(isSearchKeywordLongEnough("猫"), false);
  assert.equal(isSearchKeywordLongEnough("猫耳"), true);
  assert.equal(isSearchKeywordLongEnough("a猫"), false);
  assert.equal(isSearchKeywordLongEnough("ab"), false);
  assert.equal(isSearchKeywordLongEnough("abc"), true);
  assert.equal(isSearchKeywordLongEnough("12"), false);
  assert.equal(isSearchKeywordLongEnough("123"), true);
});

test("parseMissevanInputToken extracts drama IDs from mdrama share links", () => {
  assert.deepEqual(
    parseMissevanInputToken("https://www.missevan.com/mdrama/93420?share_channel=wechat"),
    {
      raw: "https://www.missevan.com/mdrama/93420?share_channel=wechat",
      type: "drama",
      id: "93420",
    }
  );
  assert.deepEqual(parseMissevanInputToken("https://missevan.com/mdrama/93420#share"), {
    raw: "https://missevan.com/mdrama/93420#share",
    type: "drama",
    id: "93420",
  });
});

test("parseMissevanInputToken extracts sound IDs from sound share links", () => {
  assert.deepEqual(
    parseMissevanInputToken("https://www.missevan.com/sound/12681701?share_channel=copy"),
    {
      raw: "https://www.missevan.com/sound/12681701?share_channel=copy",
      type: "sound",
      id: "12681701",
    }
  );
});

test("parseMissevanInputToken treats short bare numeric tokens as drama IDs", () => {
  assert.deepEqual(parseMissevanInputToken("93420"), {
    raw: "93420",
    type: "drama",
    id: "93420",
  });
});

test("parseMissevanInputToken treats 6-8 digit bare numeric tokens as sound IDs", () => {
  assert.deepEqual(parseMissevanInputToken("12681701"), {
    raw: "12681701",
    type: "sound",
    id: "12681701",
  });
  assert.deepEqual(parseMissevanInputToken("123456"), {
    raw: "123456",
    type: "sound",
    id: "123456",
  });
});

test("parseMissevanInputToken rejects unsupported hosts, paths, and IDs", () => {
  assert.equal(parseMissevanInputToken("https://example.com/mdrama/93420"), null);
  assert.equal(parseMissevanInputToken("https://www.missevan.com/sound/0?share_channel=copy"), null);
  assert.equal(parseMissevanInputToken("https://www.missevan.com/users/93420"), null);
  assert.equal(parseMissevanInputToken("https://www.missevan.com/mdrama/93420/extra"), null);
  assert.equal(parseMissevanInputToken("123456789"), null);
  assert.equal(parseMissevanInputToken("not-a-link"), null);
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

test("stripSearchSeasonSuffix removes only trailing season and special markers", () => {
  assert.equal(stripSearchSeasonSuffix("洄天 第一季"), "洄天");
  assert.equal(stripSearchSeasonSuffix("洄天 第二季（上）"), "洄天");
  assert.equal(stripSearchSeasonSuffix("洄天 上季"), "洄天");
  assert.equal(stripSearchSeasonSuffix("洄天 全一季"), "洄天");
  assert.equal(stripSearchSeasonSuffix("奇洛李维斯回信 番外篇"), "奇洛李维斯回信");
  assert.equal(stripSearchSeasonSuffix("第一季"), "");
  assert.equal(stripSearchSeasonSuffix("洄天 第一季 主题曲"), "洄天 第一季 主题曲");
});
