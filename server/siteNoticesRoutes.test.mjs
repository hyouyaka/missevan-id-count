import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { registerSiteNoticesRoutes } from "./routes/siteNoticesRoutes.js";
import { createSiteNoticesStore } from "./services/siteNoticesStore.js";
import { createRequestSecurityMiddleware } from "./httpSecurity.js";

async function setup(t, { token = "test-admin-secret", enabled = true, limiter = null } = {}) {
  const calls = [];
  let fail = false;
  const store = createSiteNoticesStore({ client: { enabled, async command(args) {
    calls.push(args);
    if (fail) throw new Error("secret upstream details");
    return args[0] === "GET" ? null : "OK";
  } } });
  const app = express();
  app.use(createRequestSecurityMiddleware());
  app.use(express.json());
  registerSiteNoticesRoutes(app, { store, adminToken: token, adminLimiter: limiter });
  const server = await new Promise((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const request = async (url, { auth = true, ...options } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      ...options,
      headers: { ...(auth ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
    });
    return { status: response.status, headers: response.headers, payload: await response.json() };
  };
  return { request, calls, fail: () => { fail = true; } };
}

test("public and authenticated reads use memory; publishing is one SET and immediately visible", async (t) => {
  const h = await setup(t);
  const initial = await h.request("/feedback/notices", { auth: false });
  assert.equal(initial.status, 200);
  assert.equal(initial.headers.get("cache-control"), "no-store");
  assert.equal(Object.hasOwn(initial.payload, "managementEnabled"), false);
  assert.doesNotMatch(JSON.stringify(initial.payload), /test-admin-secret/);
  for (let i = 0; i < 10; i++) await h.request("/admin/site-notices");
  assert.equal(h.calls.length, 1);
  const entry = { id: "update-1", title: "资料库更新", date: "2026-11-02", body: "补充资料" };
  const result = await h.request("/admin/site-notices", { method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revision: initial.payload.revision, entries: [entry] }) });
  assert.equal(result.status, 200);
  assert.deepEqual((await h.request("/feedback/notices", { auth: false })).payload.entries, [entry]);
  assert.deepEqual(h.calls.map(([command]) => command), ["GET", "SET"]);
});

test("missing/wrong tokens and cross-origin requests cannot write or reload", async (t) => {
  const h = await setup(t);
  for (const [url, method] of [["/admin/site-notices", "GET"], ["/admin/site-notices", "PUT"], ["/admin/site-notices/reload", "POST"]]) {
    assert.equal((await h.request(url, { method, auth: false })).status, 401);
    assert.equal((await h.request(url, { method, headers: { Authorization: "Bearer wrong" } })).status, 401);
  }
  assert.equal((await h.request("/admin/site-notices/reload", { method: "POST", headers: { Origin: "https://other.example" } })).status, 403);
  assert.equal(h.calls.length, 1);
});

test("validation/conflict errors issue no writes and storage failures expose no upstream secrets", async (t) => {
  const h = await setup(t);
  const put = (body) => h.request("/admin/site-notices", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await put({})).status, 400);
  assert.equal((await put({ revision: "stale", entries: [] })).status, 409);
  assert.equal(h.calls.length, 1);
  h.fail();
  const failed = await h.request("/admin/site-notices/reload", { method: "POST" });
  assert.equal(failed.status, 503);
  assert.doesNotMatch(JSON.stringify(failed.payload), /secret upstream details/);
  assert.equal((await h.request("/feedback/notices")).status, 200);
  assert.equal(h.calls.length, 2);
});

test("unconfigured manager is disabled and rate limiter runs before authentication", async (t) => {
  const unconfigured = await setup(t, { token: "" });
  assert.equal((await unconfigured.request("/feedback/notices")).status, 200);
  assert.equal((await unconfigured.request("/admin/site-notices")).status, 503);
  const disabled = await setup(t, { enabled: false });
  assert.equal((await disabled.request("/feedback/notices")).status, 503);
  assert.equal(disabled.calls.length, 0);
  const limited = await setup(t, { limiter: (_req, res) => res.status(429).json({ success: false }) });
  assert.equal((await limited.request("/admin/site-notices", { auth: false })).status, 429);
  assert.equal(limited.calls.length, 1);
});
