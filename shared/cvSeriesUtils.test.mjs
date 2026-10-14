import assert from "node:assert/strict";
import test from "node:test";
import { attachCvSeries, buildCvSeriesIndex, groupCvSeries } from "./cvSeriesUtils.js";

test("CV series use authoritative membership, platform identity and exact long IDs", () => {
  const index = buildCvSeriesIndex({
    cat: { platform: "猫耳", "series title": "同名系列", dramaIds: ["1", "2", "3"] },
    manbo: { platform: "漫播", "series title": "同名系列", dramaIds: ["2235647356781461610", "2235647356781461611"] },
  });
  const works = attachCvSeries([
    { platform: "missevan", id: "1", title: "第二季", playCount: 40 },
    { platform: "missevan", id: "2", title: "第一季", playCount: 70 },
    { platform: "missevan", id: "99", title: "同名系列第三季", playCount: 100 },
    { platform: "manbo", id: "2235647356781461610", title: "漫播一", playCount: 120 },
    { platform: "manbo", id: "2235647356781461611", title: "漫播二", playCount: null },
    { platform: "manbo", id: "404", title: "未知播放", playCount: null },
  ], index);
  const groups = groupCvSeries(works);
  assert.deepEqual(groups.map((group) => group.playCount), [120, 110, 100, null]);
  assert.deepEqual(groups[1].works.map((work) => work.id), ["2", "1"]);
  assert.notEqual(groups[0].id, groups[1].id);
  assert.equal(groups[0].works[0].id, "2235647356781461610");
  assert.equal(groups[2].works.length, 1);
  const filtered = groupCvSeries(works.filter((work) => work.id === "1"));
  assert.equal(filtered[0].works.length, 1);
  assert.equal(filtered[0].playCount, 40);
});

test("rank series aggregate viewCount, retain zero and sort ties by title", () => {
  const groups = groupCvSeries([
    { platform: "missevan", dramaId: "1", title: "乙", viewCount: 0 },
    { platform: "missevan", dramaId: "2", title: "甲", viewCount: 0 },
    { platform: "missevan", dramaId: "3", title: "丙", viewCount: null },
  ]);
  assert.deepEqual(groups.map(({ title, playCount }) => [title, playCount]), [["甲", 0], ["乙", 0], ["丙", null]]);
});
