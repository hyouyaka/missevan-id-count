import test from "node:test";
import assert from "node:assert/strict";

test("peak trend cache coalesces reads, expires, and recovers from unavailable data", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  process.env.START_SERVER_ON_IMPORT = "false";
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "test";
  let now = Date.parse("2026-07-10T10:00:00Z");
  t.mock.method(Date, "now", () => now);
  let meta = { normal: { updatedAt: "v1", publishedAt: "2026-07-10T00:00:00Z" } };
  let metaReads = 0;
  let entityReads = 0;
  let failMeta = false;
  let failEntity = false;
  let latestDate = "2026-07-10";
  globalThis.fetch = async (_url, options) => {
    const [command, key, , name] = JSON.parse(options.body);
    if (command === "GET" && key === "ranks:meta") {
      metaReads += 1;
      await Promise.resolve();
      if (failMeta) throw new Error("meta unavailable");
      return Response.json({ result: JSON.stringify(meta) });
    }
    if (command === "HMGET") {
      entityReads += 1;
      await Promise.resolve();
      if (failEntity) throw new Error("entity unavailable");
      return Response.json({ result: [
        JSON.stringify({ version: 2, platform: "missevan", dates: [latestDate] }),
        JSON.stringify({ name, dramaIds: ["1"], samples: { [latestDate]: { view_count: 100, position: 1 } } }),
      ] });
    }
    return Response.json({ result: null });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const key of ["START_SERVER_ON_IMPORT", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });
  const { getCachedRankTrendResponse, __setRanksCacheForTest } = await import("./application.js");
  const resetMeta = () => __setRanksCacheForTest({ meta: null, metaLoadedAt: 0, metaLoadPromise: null });
  resetMeta();
  const read = (name = "测试系列") => getCachedRankTrendResponse("missevan", name);
  const initial = await Promise.all([read(), read(), read()]);
  assert.equal(initial[0].success, true);
  assert.equal(initial[0], initial[1]);
  assert.equal(metaReads, 1);
  assert.equal(entityReads, 1);
  assert.equal(await read(), initial[0]);
  assert.equal(entityReads, 1);

  now += 11 * 60 * 1000;
  meta = { normal: { updatedAt: "v2", publishedAt: "2026-07-11T00:00:00Z" } };
  const updated = await read();
  assert.equal(updated.windowEndDate, "2026-07-11");
  assert.equal(metaReads, 2);
  assert.equal(entityReads, 2);

  now += 24 * 60 * 60 * 1000;
  failEntity = true;
  assert.equal(await read(), updated);
  failEntity = false;
  latestDate = "2026-07-11";
  assert.equal((await read()).latestDate, latestDate);
  assert.equal(entityReads, 4);
  failEntity = true;
  assert.equal((await read("冷启动恢复")).status, 503);
  failEntity = false;
  assert.equal((await read("冷启动恢复")).success, true);

  resetMeta();
  meta = null;
  const beforeEmpty = metaReads;
  latestDate = "2026-07-09";
  const emptyFirst = await read("空元数据一");
  latestDate = "2026-07-10";
  const emptySecond = await read("空元数据二");
  assert.equal(metaReads, beforeEmpty + 1);
  assert.equal(emptyFirst.windowEndDate, "2026-07-09");
  assert.equal(emptySecond.windowEndDate, "2026-07-10");
  now += 11 * 60 * 1000;
  await read("空元数据三");
  assert.equal(metaReads, beforeEmpty + 2);

  resetMeta();
  failMeta = true;
  const beforeFailure = metaReads;
  await Promise.all([read("失败一"), read("失败二")]);
  await read("失败三");
  assert.equal(metaReads, beforeFailure + 1);
  now += 11 * 60 * 1000;
  failMeta = false;
  meta = { normal: { publishedAt: "2026-07-12T00:00:00Z" } };
  assert.equal((await read("失败三")).windowEndDate, "2026-07-12");
  assert.equal(metaReads, beforeFailure + 2);
});
