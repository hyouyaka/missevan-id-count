import assert from "node:assert/strict";
import test from "node:test";
import { createRevenueDisplayReporter } from "./revenueDisplayLog.js";

test("retries capture the initial display coefficient and later slider changes do not log", async () => {
  const sent = [];
  const report = createRevenueDisplayReporter(async (entry) => {
    sent.push(entry);
    if (sent.length === 1) throw new Error("network");
  });
  await Promise.all([
    report({ taskId: "one", platform: "manbo", paidCoefficient: 7.6 }),
    report({ taskId: "one", platform: "manbo", paidCoefficient: 3 }),
  ]);
  assert.deepEqual(sent.map((item) => item.paidCoefficient), [7.6, 7.6]);
  await report({ taskId: "one", platform: "manbo", paidCoefficient: 4 });
  assert.equal(sent.length, 2);
  await report({ taskId: "two", platform: "manbo", paidCoefficient: 4 });
  assert.equal(sent.length, 3);
});
