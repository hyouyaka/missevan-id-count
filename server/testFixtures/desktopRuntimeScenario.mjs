import assert from "node:assert/strict";
import fs from "node:fs/promises";

const readFile = fs.readFile.bind(fs);
fs.readFile = async (file, ...args) => {
  assert.doesNotMatch(String(file), /(?:mm-toolkit-favorites|stats-tasks|new-drama-ids|manbo-drama-info|missevan-drama-info)\.json|usage\.log/);
  return readFile(file, ...args);
};
const nativeFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(input);
  if (url.hostname === "127.0.0.1") return nativeFetch(input, init);
  calls.push(url);
  assert.ok(["www.missevan.com", "api.kilamanbo.com"].includes(url.hostname), `Forbidden desktop host: ${url.hostname}`);
  if (url.pathname === "/dramaapi/search") {
    return Response.json({ success: false, code: 100010007, info: "木有找到" });
  }
  if (url.pathname.includes("search/page/content/new")) {
    if (url.searchParams.get("keyWord")?.endsWith("failure")) return Response.json({ h: { code: 503 } });
    return Response.json({ h: { code: 200 }, b: { searchStructureNewRespList: [{ timelineItemResp: [
      { radioDramaResp: { radioDramaIdStr: "123456", title: "API drama", category: "广播剧" } },
    ] }] } });
  }
  if (url.pathname === "/sound/getdm") return new Response('<i><d p="0,1,25,0,0,0,user1,0">test</d></i>');
  throw new Error(`Unexpected platform request: ${url.pathname}`);
};

const { startServer, isMissevanFallbackEnabled } = await import("../application.js");
assert.equal(isMissevanFallbackEnabled({ baseUrl: "https://proxy.invalid", proxyToken: "secret" }), false);
const server = await startServer(0, { host: "127.0.0.1" });
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  const request = (route, init) => nativeFetch(`${origin}${route}`, {
    ...init, headers: { Origin: origin, ...init?.headers }, signal: AbortSignal.timeout(10000),
  });
  const json = async (route, init) => (await request(route, init)).json();
  const config = await json("/app-config");
  assert.equal(config.desktopApp, true);
  assert.equal(config.missevanEnabled, true);
  assert.equal(config.feedbackEnabled, false);
  for (const route of ["/desktop/favorites-data", "/favorites/meta", "/cv-profile", "/search-suggestions?keyword=测试", "/ranks", "/ranks/trends/availability", "/ongoing", "/admin/task-metrics", "/feedback", "/usage-log", "/register-new-drama-ids"]) {
    const response = await request(route);
    assert.equal(response.status, 404, route);
    assert.equal((await response.json()).code, "NOT_FOUND");
  }
  const search = await json("/unified-search?keyword=private-search-token");
  assert.equal(search.results.missevan.results.length, 0);
  assert.equal(search.results.manbo.results[0].id, "123456");
  assert.equal(search.results.cv.results.length, 0);
  assert.equal((await json("/search?keyword=private-search-token&apiFallback=0")).meta.source, "missevan_api");
  assert.equal((await json("/manbo/search?keyword=private-search-token&apiFallback=0")).results[0].id, "123456");
  const partial = await json("/unified-search?keyword=private-search-token-failure");
  assert.ok(partial.results.manbo.error);
  assert.equal(partial.results.missevan.error, undefined);
  const created = await json("/stat-tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform: "missevan", taskType: "id", episodes: [{ sound_id: 123 }] }) });
  assert.ok(created.taskId);
  let task;
  for (let index = 0; index < 100; index += 1) {
    task = await json(`/stat-tasks/${created.taskId}`);
    if (["completed", "failed", "cancelled"].includes(task.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(task.status, "completed");
  assert.equal((await request("/stat-tasks/old-snapshot-task")).status, 404);
  assert.ok(calls.some((url) => url.pathname === "/sound/getdm"));
  assert.ok(calls.some((url) => url.hostname === "api.kilamanbo.com"));
  process.stdout.write("DESKTOP_ISOLATION_PASSED\n");
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
