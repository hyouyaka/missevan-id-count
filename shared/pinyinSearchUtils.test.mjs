import test from "node:test";
import assert from "node:assert/strict";

import { buildPinyinSearchUnits } from "./pinyinSearchUtils.js";

test("buildPinyinSearchUnits keeps Latin words intact inside mixed Chinese words", () => {
  assert.deepEqual(buildPinyinSearchUnits("林在水 / 星河Bunny"), [
    {
      syllables: ["lin", "zai", "shui"],
      full: "linzaishui",
      initials: "lzs",
    },
    {
      syllables: ["xing", "he", "bunny"],
      full: "xinghebunny",
      initials: "xhb",
    },
  ]);

  assert.deepEqual(buildPinyinSearchUnits("寻找Erato"), [
    {
      syllables: ["xun", "zhao", "erato"],
      full: "xunzhaoerato",
      initials: "xze",
    },
  ]);
});
