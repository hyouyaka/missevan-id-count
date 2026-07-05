import assert from "node:assert/strict";
import test from "node:test";

import { createUpstashRestClient } from "./upstashRestClient.js";

test("task-scoped Upstash commands abort after their requested timeout", async () => {
  const fetchImpl = (_url, options) =>
    new Promise((_resolve, reject) => {
      const watchdog = setTimeout(
        () => reject(new Error("abort signal did not fire")),
        1_000
      );
      options.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(watchdog);
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        },
        { once: true }
      );
    });
  const client = createUpstashRestClient({
    upstashRestUrl: "https://unused.invalid",
    upstashRestToken: "token",
    fetchImpl,
  });

  await assert.rejects(
    client.command(["SET", "task", "value"], { timeoutMs: 10 }),
    /Upstash request timed out after 10ms/
  );
});
