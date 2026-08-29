import assert from "node:assert/strict";
import test from "node:test";

import {
  ManboDanmakuPageBatchError,
  fetchRequiredManboDanmakuPages,
} from "./manboDanmakuPages.js";

test("Manbo pagination rescues only pages that failed the primary batch", async () => {
  const calls = [];
  const accepted = [];
  const result = await fetchRequiredManboDanmakuPages({
    pageNumbers: [2, 3, 4],
    primaryConcurrency: 3,
    rescueConcurrency: 2,
    async fetchPage(pageNo, phase) {
      calls.push(`${phase}:${pageNo}`);
      if (phase === "primary" && (pageNo === 3 || pageNo === 4)) {
        throw Object.assign(new Error("Request timeout"), { requestTimedOut: true });
      }
      return { pageNo };
    },
    onPage(pageNo) {
      accepted.push(pageNo);
    },
  });

  assert.deepEqual(calls, ["primary:2", "primary:3", "primary:4", "rescue:3", "rescue:4"]);
  assert.deepEqual(accepted.sort((left, right) => left - right), [2, 3, 4]);
  assert.deepEqual(result, { rescueAttempted: true, rescuedPageCount: 2 });
});

test("Manbo pagination can rescue the required first page before expansion", async () => {
  const phases = [];
  let firstPage;
  const result = await fetchRequiredManboDanmakuPages({
    pageNumbers: [1],
    primaryConcurrency: 1,
    rescueConcurrency: 1,
    async fetchPage(_pageNo, phase) {
      phases.push(phase);
      if (phase === "primary") {
        throw Object.assign(new Error("Request timeout"), { requestTimedOut: true });
      }
      return { data: { count: 400 } };
    },
    onPage(_pageNo, data) {
      firstPage = data;
    },
  });

  assert.deepEqual(phases, ["primary", "rescue"]);
  assert.equal(firstPage.data.count, 400);
  assert.deepEqual(result, { rescueAttempted: true, rescuedPageCount: 1 });
});

test("Manbo pagination waits for all workers and reports pages that rescue cannot recover", async () => {
  const completed = [];
  await assert.rejects(
    fetchRequiredManboDanmakuPages({
      pageNumbers: [2, 3, 4],
      primaryConcurrency: 3,
      rescueConcurrency: 1,
      async fetchPage(pageNo, phase) {
        if (pageNo === 3) {
          throw Object.assign(new Error("Request timeout"), { requestTimedOut: true });
        }
        await new Promise((resolve) => setImmediate(resolve));
        completed.push(`${phase}:${pageNo}`);
        return { pageNo };
      },
    }),
    (error) => {
      assert.ok(error instanceof ManboDanmakuPageBatchError);
      assert.deepEqual(error.failedPages, [3]);
      assert.equal(error.outcome, "timeout");
      return true;
    }
  );
  assert.deepEqual(completed.sort(), ["primary:2", "primary:4"]);
});

test("Manbo pagination stops before rescue when the user cancels", async () => {
  const controller = new AbortController();
  const calls = [];
  await assert.rejects(
    fetchRequiredManboDanmakuPages({
      pageNumbers: [2, 3, 4],
      primaryConcurrency: 1,
      signal: controller.signal,
      async fetchPage(pageNo, phase) {
        calls.push(`${phase}:${pageNo}`);
        controller.abort();
        throw controller.signal.reason;
      },
    }),
    (error) => error?.name === "AbortError"
  );
  assert.deepEqual(calls, ["primary:2"]);
});
