import assert from "node:assert/strict";

const nativeFetch = globalThis.fetch;
const counts = { missevan: 0, manbo: 0 };
globalThis.fetch = async (input, init) => {
  const url = new URL(input);
  if (url.hostname === "127.0.0.1") return nativeFetch(input, init);
  await new Promise((resolve) => setTimeout(resolve, 30));
  if (url.pathname === "/sound/getdm") {
    counts.missevan++;
    return new Response('<i>\n<d p="0,1,25,0,0,0,user1,0">test</d>\n</i>');
  }
  if (url.pathname.endsWith("/getDanmaKuPgList")) {
    counts.manbo++;
    return Response.json({ code: 200, data: { count: 1, list: [{ eid: "user1" }] } });
  }
  throw new Error(`Unexpected external request: ${url.hostname}${url.pathname}`);
};
const { startServer } = await import("../application.js");
const server = await startServer(0, { host: "127.0.0.1" });
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  for (const [platform, route] of [["missevan", "/getsounddanmaku"], ["manbo", "/manbo/getsetdanmaku"]]) {
    const request = async (title) => {
      const response = await nativeFetch(`${origin}${route}`, {
        method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ sound_id: 123, drama_title: title, episode_title: title }),
        signal: AbortSignal.timeout(10000),
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    const [a, b] = await Promise.all([request("first"), request("second")]);
    assert.equal(a.success, true, JSON.stringify(a));
    assert.equal(b.success, true, JSON.stringify(b));
    assert.equal(a.cached, false);
    assert.equal(b.cached, false);
    assert.equal(a.fetchedAt, b.fetchedAt);
    assert.ok(Number.isFinite(Date.parse(a.fetchedAt)));
    assert.equal(a.drama_title, "first");
    assert.equal(b.drama_title, "second");
    assert.equal(b.episode_title, "second");
    assert.deepEqual(a.users, ["user1"]);
    const hit = await request("third");
    assert.equal(hit.cached, true);
    assert.equal(hit.drama_title, "third");
    assert.equal(hit.fetchedAt, a.fetchedAt);
    assert.equal(counts[platform], 1);
  }
  process.stdout.write("EPISODE_CACHE_ROUTES_PASSED\n");
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
