import assert from "node:assert/strict";
import test from "node:test";

import { searchLibraryWithFallback } from "./searchService.js";

test("search service prefers strict then compatible library matches", async () => {
  const calls = [];
  const result = await searchLibraryWithFallback({
    keyword: "测试",
    searchLibrary(_keyword, mode) {
      calls.push(mode);
      return mode === "compatible" ? [{ id: 1 }] : [];
    },
    async searchApi() {
      calls.push("api");
      return [{ id: 2 }];
    },
  });

  assert.deepEqual(result, { items: [{ id: 1 }], source: "library-compatible" });
  assert.deepEqual(calls, ["strict", "compatible"]);
});

test("cross-platform library-only search never calls the external API", async () => {
  let apiCalls = 0;
  const result = await searchLibraryWithFallback({
    keyword: "猫耳内容",
    libraryOnly: true,
    searchLibrary() {
      return [];
    },
    async searchApi() {
      apiCalls += 1;
      return [];
    },
  });

  assert.deepEqual(result, { items: [], source: "library" });
  assert.equal(apiCalls, 0);
});
