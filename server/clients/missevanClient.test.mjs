import assert from "node:assert/strict";
import test from "node:test";

import { createMissevanClient } from "./missevanClient.js";

test("Missevan client forwards the task cancellation signal", async () => {
  const controller = new AbortController();
  let received;
  const client = createMissevanClient({
    soundSummary(id, options) {
      received = { id, options };
      return { success: true };
    },
  });

  await client.getSoundSummary(12, { signal: controller.signal });
  assert.equal(received.id, 12);
  assert.equal(received.options.signal, controller.signal);
});
