import assert from "node:assert/strict";
import test from "node:test";
import { createSiteNoticesStore, SITE_NOTICES_KEY } from "./siteNoticesStore.js";

const entry = { id: "notice-1", date: "2026-11-02", title: "部分资料缺失", body: "正在核实来源。" };
const saved = { version: 1, revision: "saved", updatedAt: "2026-11-02T12:00:00.000Z", entries: [entry] };

function harness(raw = null) {
  const calls = [];
  let failure = false;
  let writeResult = "OK";
  let revision = 0;
  const client = { enabled: true, async command(args) {
    calls.push(args);
    if (failure) throw new Error("remote unavailable");
    if (args[0] === "GET") return raw;
    if (writeResult === "OK") raw = args[2];
    return writeResult;
  } };
  const store = createSiteNoticesStore({ client, now: () => new Date("2026-11-02T14:00:00Z"), makeRevision: () => `revision-${++revision}` });
  return { store, calls, fail: (value) => { failure = value; }, unacknowledge: () => { writeResult = null; } };
}

test("startup coalesces one GET; repeated public/admin reads never access Redis", async () => {
  const h = harness(JSON.stringify(saved));
  await Promise.all([h.store.initialize(), ...Array.from({ length: 50 }, () => h.store.read())]);
  assert.deepEqual(h.calls, [["GET", SITE_NOTICES_KEY]]);
  assert.deepEqual(await h.store.read(), saved);
  assert.ok(Object.isFrozen((await h.store.read()).entries[0]));
});

test("publish persists one complete snapshot then swaps memory; no-op publish has no SET", async () => {
  const h = harness();
  const initial = await h.store.read();
  assert.deepEqual(initial.entries, []);
  const next = await h.store.publish({ revision: initial.revision, entries: [entry] });
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1][0], "SET");
  assert.equal(h.calls[1][1], SITE_NOTICES_KEY);
  assert.deepEqual(JSON.parse(h.calls[1][2]), next);
  assert.equal(await h.store.read(), next);
  assert.equal(await h.store.publish({ revision: next.revision, entries: [entry] }), next);
  assert.equal(h.calls.length, 2);
  const removed = await h.store.publish({ revision: next.revision, entries: [] });
  assert.deepEqual(removed.entries, []);
  assert.equal(h.calls.length, 3);
});

test("failed or unacknowledged writes preserve the published revision and content", async () => {
  const h = harness(saved);
  const original = await h.store.read();
  h.fail(true);
  await assert.rejects(h.store.publish({ revision: original.revision, entries: [] }));
  assert.equal(await h.store.read(), original);
  h.fail(false);
  h.unacknowledge();
  await assert.rejects(h.store.publish({ revision: original.revision, entries: [] }));
  assert.equal(await h.store.read(), original);
  assert.equal(h.calls.filter(([command]) => command === "GET").length, 1);
});

test("simultaneous editors cannot overwrite a newer publish and conflicts issue no SET", async () => {
  const h = harness(saved);
  const results = await Promise.allSettled([
    h.store.publish({ revision: "saved", entries: [] }),
    h.store.publish({ revision: "saved", entries: [{ ...entry, title: "旧窗口的修改" }] }),
  ]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  assert.equal(results[1].reason.status, 409);
  assert.equal(h.calls.length, 2);
  assert.deepEqual((await h.store.read()).entries, []);
});

test("startup failure is not retried by visitors; explicit admin reload recovers", async () => {
  const h = harness(saved);
  h.fail(true);
  await assert.rejects(h.store.initialize());
  for (let i = 0; i < 10; i++) await assert.rejects(h.store.read(), { status: 503 });
  assert.equal(h.calls.length, 1);
  h.fail(false);
  await h.store.reload();
  assert.deepEqual(await h.store.read(), saved);
  assert.equal(h.calls.length, 2);
  h.fail(true);
  await assert.rejects(h.store.reload());
  assert.deepEqual(await h.store.read(), saved);
  assert.equal(h.calls.length, 3);
});

test("malformed stored data is not silently replaced by an empty snapshot", async () => {
  for (const raw of ["{bad", { ...saved, version: 2 }, { ...saved, entries: [{ ...entry, date: "2026-02-30" }] }]) {
    const h = harness(raw);
    await assert.rejects(h.store.initialize());
    await assert.rejects(h.store.publish({ revision: "empty", entries: [] }), { status: 503 });
    assert.equal(h.calls.length, 1);
  }
});

test("invalid and oversized input is rejected before issuing any storage commands", async () => {
  const invalid = [null, [], {}, { revision: "empty", entries: null },
    ...[
      [{ ...entry, body: " " }], [{ ...entry, title: "x".repeat(121) }],
      [{ ...entry, body: "x".repeat(6001) }], [{ ...entry, date: "2026-02-30" }],
      [entry, entry], Array.from({ length: 101 }, (_, i) => ({ ...entry, id: `id-${i}` })),
      Array.from({ length: 25 }, (_, i) => ({ ...entry, id: `id-${i}`, body: "x".repeat(6000) })),
    ].map((entries) => ({ revision: "empty", entries }))];
  for (const payload of invalid) {
    const h = harness();
    await assert.rejects(h.store.publish(payload), { status: 400 });
    assert.equal(h.calls.length, 0);
  }
});

test("legacy categorized records load without a migration write and title-free posts can be published", async () => {
  const h = harness({ ...saved, entries: [{ ...entry, type: "issue", status: "in_progress" }] });
  assert.deepEqual(await h.store.read(), saved);
  assert.deepEqual(h.calls, [["GET", SITE_NOTICES_KEY]]);
  const next = await h.store.publish({ revision: "saved", entries: [{ ...entry, title: "" }] });
  assert.equal(next.entries[0].title, "");
  assert.equal(Object.hasOwn(next.entries[0], "type"), false);
  assert.equal(Object.hasOwn(next.entries[0], "status"), false);
  assert.equal(h.calls.length, 2);
});

test("disabled storage never calls the client", async () => {
  const store = createSiteNoticesStore({ client: { enabled: false, command: () => assert.fail("unexpected Redis command") } });
  await assert.rejects(store.read(), { status: 503 });
});

test("publishing waits for startup load and keeps the old content visible until SET succeeds", async () => {
  let resolveRead;
  let resolveWrite;
  const calls = [];
  const store = createSiteNoticesStore({ client: { enabled: true, command(args) {
    calls.push(args);
    return new Promise((resolve) => { if (args[0] === "GET") resolveRead = resolve; else resolveWrite = resolve; });
  } } });
  const loading = store.initialize();
  const publishing = store.publish({ revision: "saved", entries: [] });
  await new Promise((resolve) => setImmediate(resolve));
  resolveRead(JSON.stringify(saved));
  await loading;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await store.read(), saved);
  resolveWrite("OK");
  assert.deepEqual((await publishing).entries, []);
  assert.deepEqual(calls.map(([command]) => command), ["GET", "SET"]);
});
