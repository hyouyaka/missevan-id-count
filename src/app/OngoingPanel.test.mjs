import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./OngoingPanel.jsx", import.meta.url), "utf8");

test("ongoing title content-type badge is rendered inside the title button", () => {
  const titleButtonStart = source.indexOf('<button\n                  type="button"');
  assert.notEqual(titleButtonStart, -1, "title button markup should exist");

  const titleButtonEnd = source.indexOf("</button>", titleButtonStart);
  assert.notEqual(titleButtonEnd, -1, "title button should have a closing tag");

  const titleButtonMarkup = source.slice(titleButtonStart, titleButtonEnd);
  assert.match(titleButtonMarkup, /titleTags\.map/, "title tags should be part of the title button inline flow");
});
