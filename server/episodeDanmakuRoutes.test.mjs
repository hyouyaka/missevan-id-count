import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

test("real episode routes reuse cached data and merge concurrent fetches with caller titles", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mm-episode-cache-"));
  try {
    const { stdout } = await promisify(execFile)(process.execPath, ["server/testFixtures/episodeCacheScenario.mjs"], {
      cwd: process.cwd(), timeout: 30000, maxBuffer: 1024 * 1024,
      env: { ...process.env, APP_DATA_DIR: directory, DESKTOP_EXE_DIR: directory,
        DESKTOP_APP: "true", DESKTOP_PACKAGED_APP: "true", START_SERVER_ON_IMPORT: "false",
        MISSEVAN_DANMAKU_CACHE_MAX_ENTRIES: "100", MANBO_DANMAKU_CACHE_MAX_ENTRIES: "100",
      },
    });
    assert.match(stdout, /EPISODE_CACHE_ROUTES_PASSED/);
  } finally {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`));
    assert.ok(path.basename(resolved).startsWith("mm-episode-cache-"));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});
