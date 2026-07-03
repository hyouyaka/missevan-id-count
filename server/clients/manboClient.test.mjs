import assert from "node:assert/strict";
import test from "node:test";

import { createManboClient } from "./manboClient.js";

test("Manbo client forwards the task cancellation signal", async () => {
  const controller = new AbortController();
  let received;
  const client = createManboClient({
    danmakuSummary(id, title, episode, source, options) {
      received = { id, title, episode, source, options };
      return { success: true };
    },
  });

  await client.getDanmakuSummary("12", "剧", "集", "stats", {
    signal: controller.signal,
  });
  assert.equal(received.options.signal, controller.signal);
});
