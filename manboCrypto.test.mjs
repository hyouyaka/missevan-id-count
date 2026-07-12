import assert from "node:assert/strict";
import test from "node:test";

import { canParseShareUrl, extractResolvedId } from "./src/utils/manboCrypto.js";

const shareUrls = [
  "https://manbo.kilaaudio.com/Activecard/radioplay?_specific_parameter=QXwCTwKLWwC-6N0jFFYgn6zFtvgqmDd39v5WuXm4zh4kRO7NQ24WWS23LMRu4d9gq0StFmBBqxTO6z5G5LYEgYWkm7FMzJ3Y5bxXDy9Ry0A=",
  "https://manbo.kilaaudio.com/Activecard/radioplay?_specific_parameter=hzMM0wJbYjdxA8ZZ-HOOEYJWxWKa3lAqB8RMnyCCqp0A87_ac6WWJiLh4Nm_Hd1Gw9Y6UMaGK4TE74635hIbnD2heCdUitNWsDdduxtwzhA=",
];

test("recognizes encrypted Manbo share URLs on kilaaudio.com", () => {
  assert.equal(canParseShareUrl(shareUrls[0]), true);
  assert.equal(canParseShareUrl("https://manbo.kilaaudio.com/Activecard/radioplay"), false);
  assert.equal(
    canParseShareUrl("https://manbo.kilaaudio.com.example.com/Activecard/radioplay?_specific_parameter=x"),
    false
  );
});

test("extracts long radioplay drama ids without numeric coercion", () => {
  const ids = ["2235647356781461610", "2235627191910006844"];
  ids.forEach((id, index) => {
    const resolved = extractResolvedId({ id, sign: "test", t: "1783846800995" }, shareUrls[index]);
    assert.equal(resolved?.resolvedType, "drama");
    assert.equal(resolved?.dramaId, id);
    assert.equal(typeof resolved?.dramaId, "string");
  });
});
