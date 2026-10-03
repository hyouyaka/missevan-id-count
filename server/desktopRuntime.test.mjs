import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

test("desktop ignores legacy credentials and files while serving platform API searches and memory tasks", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mm-desktop-isolation-"));
  const files = ["mm-toolkit-favorites.json", "runtime/stats-tasks.json", "runtime/new-drama-ids.json", "runtime/manbo-drama-info.json", "runtime/missevan-drama-info.json", "logs/usage.log"];
  const sentinel = "private legacy data must remain untouched";
  for (const file of files) {
    await fs.mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await fs.writeFile(path.join(directory, file), sentinel);
  }
  await fs.writeFile(path.join(directory, ".env"), [
    "UPSTASH_REDIS_REST_URL=https://old.upstash.io",
    "UPSTASH_REDIS_REST_TOKEN=old-secret",
    "MISSEVAN_FALLBACK_PROXY_TOKEN=old-proxy",
    "MISSEVAN_SECONDARY_FALLBACK_PROXY_TOKEN=old-secondary",
    "MISSEVAN_FORCE_FALLBACK=2",
  ].join("\n"));
  try {
    const { stdout } = await promisify(execFile)(process.execPath, ["server/testFixtures/desktopRuntimeScenario.mjs"], {
      cwd: process.cwd(), timeout: 30000, maxBuffer: 1024 * 1024,
      env: { ...process.env, APP_DATA_DIR: directory, DESKTOP_EXE_DIR: directory,
        DESKTOP_APP: "true", DESKTOP_PACKAGED_APP: "true", START_SERVER_ON_IMPORT: "false",
        ENABLE_MISSEVAN: "false", NODE_TEST_CONTEXT: "",
        UPSTASH_REDIS_REST_URL: "https://system.upstash.io", UPSTASH_REDIS_REST_TOKEN: "system-secret",
        MISSEVAN_FALLBACK_PROXY_TOKEN: "system-proxy", MISSEVAN_SECONDARY_FALLBACK_PROXY_TOKEN: "system-secondary",
        MISSEVAN_FORCE_FALLBACK: "1",
      },
    });
    assert.match(stdout, /DESKTOP_ISOLATION_PASSED/);
    assert.doesNotMatch(stdout, /private-search-token|private legacy data/);
    for (const file of files) assert.equal(await fs.readFile(path.join(directory, file), "utf8"), sentinel, file);
    const logs = await fs.readFile(path.join(directory, "logs/operations.log"), "utf8");
    assert.doesNotMatch(logs, /private-search-token|private legacy data|old-secret|system-secret/);
    assert.deepEqual((await fs.readdir(path.join(directory, "runtime"))).sort(), files.filter((file) => file.startsWith("runtime/")).map((file) => path.basename(file)).sort());
  } finally {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`));
    assert.ok(path.basename(resolved).startsWith("mm-desktop-isolation-"));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});
