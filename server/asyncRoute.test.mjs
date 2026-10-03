import assert from "node:assert/strict";
import express from "express";
import test from "node:test";

import { installAsyncRouteSupport } from "./asyncRoute.js";

test("async route support forwards rejection once, wraps nested handlers, and preserves app settings", async () => {
  const app = express();
  app.set("feature flag", "enabled");
  assert.equal(installAsyncRouteSupport(app), true);
  assert.equal(installAsyncRouteSupport(app), false);
  assert.equal(app.get("feature flag"), "enabled");

  let rejectedHandlerCalls = 0;
  app.get("/sync", (req, res) => res.json({ ok: true }));
  app.route("/chain").get((req, res) => res.json({ mode: "chain" }));
  app.get("/rejected", [[async () => {
    rejectedHandlerCalls += 1;
    throw new Error("private stack text");
  }]]);
  app.use(express.json());
  app.post("/rejected-post", async () => {
    rejectedHandlerCalls += 1;
    throw new Error("private post stack text");
  });
  app.route("/rejected-chain")
    .all(async () => {
      rejectedHandlerCalls += 1;
      throw new Error("private chained stack text");
    })
    .get(async () => {
      rejectedHandlerCalls += 1;
    });
  app.use((error, req, res, next) => {
    if (res.headersSent) {
      return next(error);
    }
    return res.status(500).json({ code: "INTERNAL_SERVER_ERROR" });
  });

  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    listener.once("error", reject);
  });
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const sync = await fetch(`${origin}/sync`);
    assert.equal(sync.status, 200);
    assert.deepEqual(await sync.json(), { ok: true });

    const chained = await fetch(`${origin}/chain`);
    assert.equal(chained.status, 200);
    assert.deepEqual(await chained.json(), { mode: "chain" });

    const rejected = await fetch(`${origin}/rejected`);
    assert.equal(rejected.status, 500);
    assert.deepEqual(await rejected.json(), { code: "INTERNAL_SERVER_ERROR" });
    assert.equal(rejectedHandlerCalls, 1);

    const rejectedChain = await fetch(`${origin}/rejected-chain`);
    assert.equal(rejectedChain.status, 500);
    assert.deepEqual(await rejectedChain.json(), { code: "INTERNAL_SERVER_ERROR" });
    assert.equal(rejectedHandlerCalls, 2);

    const rejectedPost = await fetch(`${origin}/rejected-post`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(rejectedPost.status, 500);
    assert.deepEqual(await rejectedPost.json(), { code: "INTERNAL_SERVER_ERROR" });
    assert.equal(rejectedHandlerCalls, 3);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
