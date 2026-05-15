import test from "node:test";
import assert from "node:assert/strict";

import {
  CHANGELOG_ENTRIES,
  CHANGELOG_SEEN_VERSION_STORAGE_KEY,
  getShouldAutoOpenChangelog,
  markChangelogVersionSeen,
} from "./changelog.js";

function createStorageMock(initialEntries = []) {
  const store = new Map(initialEntries);
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
  };
}

test("getShouldAutoOpenChangelog opens when current version has not been seen", () => {
  const storage = createStorageMock([[CHANGELOG_SEEN_VERSION_STORAGE_KEY, "1.5.4"]]);

  assert.equal(getShouldAutoOpenChangelog("1.5.5", storage), true);
});

test("getShouldAutoOpenChangelog stays closed after current version is marked seen", () => {
  const storage = createStorageMock();

  markChangelogVersionSeen("1.5.5", storage);

  assert.equal(storage.getItem(CHANGELOG_SEEN_VERSION_STORAGE_KEY), "1.5.5");
  assert.equal(getShouldAutoOpenChangelog("1.5.5", storage), false);
});

test("getShouldAutoOpenChangelog tolerates unavailable storage", () => {
  const blockedStorage = {
    getItem() {
      throw new DOMException("Blocked", "SecurityError");
    },
    setItem() {
      throw new DOMException("Blocked", "SecurityError");
    },
  };

  assert.equal(getShouldAutoOpenChangelog("1.5.5", blockedStorage), false);
  assert.doesNotThrow(() => markChangelogVersionSeen("1.5.5", blockedStorage));
});

test("changelog contains 1.5.5 search and trend entry", () => {
  assert.deepEqual(CHANGELOG_ENTRIES[0], {
    version: "1.5.5",
    changes: [
      "优化搜索：支持全拼和首字母搜索，疑似搜错平台会提示跳转",
      "优化趋势页面",
    ],
  });
});

test("changelog keeps 1.5.4 merged search entry", () => {
  const entry = CHANGELOG_ENTRIES.find((item) => item.version === "1.5.4");

  assert.deepEqual(entry, {
    version: "1.5.4",
    changes: [
      "合并搜索和导入输入，新版输入框支持各类关键词，分享链接，剧集和分集ID搜索和导入",
      "优化搜索逻辑",
    ],
  });
});

test("changelog keeps 1.5.3 summary entry", () => {
  const entry = CHANGELOG_ENTRIES.find((item) => item.version === "1.5.3");

  assert.deepEqual(entry, {
    version: "1.5.3",
    changes: [
      "优化猫耳单集付费剧集的收益预估",
      "优化搜索结果排序",
      "清理旧版本残留bug",
    ],
  });
});

test("changelog keeps 1.5.2 peak rank title jump entry", () => {
  const entry = CHANGELOG_ENTRIES.find((item) => item.version === "1.5.2");

  assert.deepEqual(entry, {
    version: "1.5.2",
    changes: ["增加巅峰榜标题跳转。"],
  });
});

test("changelog contains expanded 1.5.0 update and trend entries", () => {
  const entry = CHANGELOG_ENTRIES.find((item) => item.version === "1.5.0");

  assert.deepEqual(entry?.changes, [
    "增加“更新”界面，列出猫耳和漫播近一周内更新的剧集",
    "增加“趋势”功能，展示剧集在过去3/7/30日内的播放量，追剧人数，购买/收听人数，付费ID数的趋势，数据不足时自动展示所有可用日期数据。该功能仅对“更新”和“榜单”中出现的剧集有效",
  ]);
});
