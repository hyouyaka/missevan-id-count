import assert from "node:assert/strict";

const nativeFetch = globalThis.fetch;
const counts = { missevan: 0, manbo: 0 };
const metricCounts = new Map();
let useLegacySetDetail = false;
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
  const next = (key) => {
    const count = (metricCounts.get(key) || 0) + 1;
    metricCounts.set(key, count);
    return count;
  };
  if (url.pathname === "/sound/getsound") {
    return Response.json({ info: { sound: { view_count: next("sound"), comment_count: 20 } } });
  }
  if (url.pathname.startsWith("/dramaapi/getdrama")) {
    const value = next("missevanDrama");
    return Response.json({ success: true, info: { drama: { id: 123, name: "test", view_count: value, subscription_num: value, updated_at: "2026-10-06" }, episodes: { episode: [{ sound_id: 123 }] } } });
  }
  if (url.pathname === "/reward/user-reward-rank") {
    return Response.json({ info: { list: [{ coin: next("reward") }] } });
  }
  if (url.pathname === "/reward/drama-reward-detail") {
    return Response.json({ info: { reward_num: next("rewardMeta") } });
  }
  if (url.pathname.endsWith("/dramaDetail")) {
    const value = next("manboDrama");
    return Response.json({ code: 200, data: { radioDramaId: 123, title: "test", payType: 1, watchCount: value, favoriteCount: value, diamondValue: value, payCount: value, memberListenCount: value, setRespList: [{ setId: 123, watchCount: 999 }] } });
  }
  if (url.pathname.endsWith("/set/detail/new")) {
    if (useLegacySetDetail) return Response.json({ h: { code: 404 } });
    return Response.json({ h: { code: 200 }, b: { watchCount: next("manboSet") } });
  }
  if (url.pathname.endsWith("/dramaSetDetail")) {
    return Response.json({ code: 200, data: { watchCount: next("manboLegacySet") } });
  }
  throw new Error(`Unexpected external request: ${url.hostname}${url.pathname}`);
};
const { startServer, fetchSearchCardMetrics } = await import("../application.js");
const server = await startServer(0, { host: "127.0.0.1" });
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  const post = async (route, body) => {
    const response = await nativeFetch(`${origin}${route}`, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  // Requests for the same IDs must observe changing upstream metrics without force_refresh.
  for (let value = 1; value <= 2; value++) {
    const sound = await post("/getsoundsummary", { sound_ids: [123] });
    assert.equal(sound[0].view_count, value);
    assert.equal(sound[0].cached, false);
    assert.equal((await post("/getrewardsummary", { drama_id: 123 })).rewardCoinTotal, value);
    for (const [platform, route] of [["missevan", "/getdramas"], ["manbo", "/manbo/getdramas"]]) {
      const drama = await post(route, { drama_ids: [123] });
      assert.equal(drama[0].info.drama.view_count, value);
      assert.equal(drama[0].info.drama.subscription_num, value);
      if (platform === "manbo") {
        assert.equal(drama[0].info.drama.diamond_value, value);
        assert.equal(drama[0].info.drama.pay_count, value);
      }
    }
    const set = await post("/manbo/getsetsummary", { set_ids: [123] });
    assert.equal(set[0].view_count, value, "must not reuse the drama episode's 999 plays");
    assert.equal((await post("/getrewardmeta", { drama_id: 123 })).reward_num, value);
  }
  useLegacySetDetail = true;
  for (let value = 1; value <= 2; value++) {
    assert.equal((await post("/manbo/getsetsummary", { set_ids: [456] }))[0].view_count, value);
  }
  for (let value = 3; value <= 4; value++) {
    for (const platform of ["missevan", "manbo"]) {
      const result = await fetchSearchCardMetrics(platform, "123", null);
      assert.equal(result.cached, false);
      assert.equal(result.metrics.view_count, value);
      assert.equal(result.metrics.subscription_num, value);
      if (platform === "missevan") assert.equal(result.metrics.reward_num, value);
      else {
        assert.equal(result.metrics.diamond_value, value);
        assert.equal(result.metrics.pay_count, value);
        assert.equal(result.metrics.member_listen_count, value);
      }
    }
  }
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
