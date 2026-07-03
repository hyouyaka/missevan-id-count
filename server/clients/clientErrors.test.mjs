import assert from "node:assert/strict";
import test from "node:test";

import { normalizePlatformClientError } from "./clientErrors.js";

test("platform client error preserves abort and access denied categories", () => {
  assert.equal(
    normalizePlatformClientError(Object.assign(new Error("aborted"), { name: "AbortError" })).code,
    "REQUEST_ABORTED"
  );
  assert.equal(
    normalizePlatformClientError(Object.assign(new Error("forbidden"), { status: 403 })).code,
    "ACCESS_DENIED"
  );
});
