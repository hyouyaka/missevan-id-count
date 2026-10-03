import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import test from "node:test";

async function waitForReady(child, lines) {
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Application did not start: ${lines.join("\n")}`)), 15_000);
    const output = readline.createInterface({ input: child.stdout });
    output.on("line", (line) => {
      lines.push(line);
      const match = line.match(/^__READY__(\d+)$/);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Application exited before listening (${code}): ${lines.join("\n")}`));
    });
  });
}

test("malformed search and import input returns JSON errors while the real application stays healthy", async () => {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "mm-toolkit-app-process-"));
  const childEnv = { ...process.env };
  [
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "RESEND_API_KEY",
    "FEEDBACK_FROM_EMAIL",
    "FEEDBACK_RECIPIENT_EMAIL",
    "MISSEVAN_FALLBACK_BASE_URL",
    "MISSEVAN_FALLBACK_PROXY_TOKEN",
    "MISSEVAN_SECONDARY_FALLBACK_BASE_URL",
    "MISSEVAN_SECONDARY_FALLBACK_PROXY_TOKEN",
  ].forEach((key) => delete childEnv[key]);
  Object.assign(childEnv, {
    APP_DATA_DIR: tempDirectory,
    DESKTOP_APP: "true",
    DESKTOP_EXE_DIR: tempDirectory,
    DESKTOP_PACKAGED_APP: "true",
    ENABLE_MISSEVAN: "true",
    START_SERVER_ON_IMPORT: "false",
    JSON_BODY_LIMIT: "1kb",
  });

  const child = spawn(process.execPath, [
    "--input-type=module",
    "-e",
    "import { startServer } from './server/application.js'; const server = await startServer(0, { host: '127.0.0.1' }); process.stdout.write(`__READY__${server.address().port}\\n`);",
  ], {
    cwd: path.resolve("."),
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const childExit = new Promise((resolve) => child.once("exit", resolve));
  const childLines = [];

  try {
    const port = await waitForReady(child, childLines);
    const origin = `http://127.0.0.1:${port}`;
    const request = async (url, init) => {
      const headers = { ...(init?.headers || {}) };
      if (String(init?.method || "GET").toUpperCase() !== "GET") {
        headers.origin = origin;
      }
      const response = await fetch(`${origin}${url}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(5000),
      });
      return { status: response.status, text: await response.text() };
    };

    for (const endpoint of [
      "/unified-search?keyword%5BtoString%5D=x",
      "/search?keyword%5BtoString%5D=x",
      "/manbo/search?keyword%5BtoString%5D=x",
    ]) {
      const result = await request(endpoint);
      assert.equal(result.status, 400, endpoint);
      assert.match(result.text, /INVALID_REQUEST_QUERY/);
      assert.doesNotMatch(result.text, /TypeError|stack/i);
    }

    const emptySearch = await request("/unified-search");
    assert.equal(emptySearch.status, 200);

    const unsafeImport = await request("/manbo/resolve-input", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [{ raw: { toString: "x", valueOf: "x" } }] }),
    });
    assert.equal(unsafeImport.status, 500);
    assert.match(unsafeImport.text, /INTERNAL_SERVER_ERROR/);
    assert.doesNotMatch(unsafeImport.text, /TypeError|stack|toString/);

    const invalidJson = await request("/manbo/resolve-input", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assert.equal(invalidJson.status, 400);
    assert.match(invalidJson.text, /INVALID_JSON_BODY/);

    for (const endpoint of ["/manbo/resolve-input", "/feedback"]) {
      const oversized = await request(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "x".repeat(2048) }),
      });
      assert.equal(oversized.status, 413, endpoint);
      assert.equal(JSON.parse(oversized.text).code, "REQUEST_BODY_TOO_LARGE");
    }

    const health = await request("/health");
    assert.equal(health.status, 200);
    assert.deepEqual(JSON.parse(health.text), { ok: true });
    assert.equal(child.exitCode, null);
  } finally {
    if (child.exitCode == null && child.signalCode == null) {
      child.kill();
    }
    await childExit;
    const tempRoot = path.resolve(os.tmpdir());
    const resolvedTempDirectory = path.resolve(tempDirectory);
    assert.ok(resolvedTempDirectory.startsWith(`${tempRoot}${path.sep}`));
    assert.ok(path.basename(resolvedTempDirectory).startsWith("mm-toolkit-app-process-"));
    await fs.rm(resolvedTempDirectory, { recursive: true, force: true });
  }
});
