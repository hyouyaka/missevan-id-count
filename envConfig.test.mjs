import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadLocalEnv } from "./envConfig.js";

test("loadLocalEnv reads local server env keys from project .env", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "missevan-env-"));
  const previousAdminCacheRefreshToken = process.env.ADMIN_CACHE_REFRESH_TOKEN;
  const previousEnableMissevan = process.env.ENABLE_MISSEVAN;
  const previousFallbackBaseUrl = process.env.MISSEVAN_FALLBACK_BASE_URL;
  const previousFallbackProxyToken = process.env.MISSEVAN_FALLBACK_PROXY_TOKEN;
  const previousFallbackTimeoutMs = process.env.MISSEVAN_FALLBACK_TIMEOUT_MS;
  const previousSecondaryFallbackBaseUrl = process.env.MISSEVAN_SECONDARY_FALLBACK_BASE_URL;
  const previousSecondaryFallbackProxyToken = process.env.MISSEVAN_SECONDARY_FALLBACK_PROXY_TOKEN;
  const previousSecondaryFallbackTimeoutMs = process.env.MISSEVAN_SECONDARY_FALLBACK_TIMEOUT_MS;
  const previousForceFallback = process.env.MISSEVAN_FORCE_FALLBACK;
  const previousPort = process.env.PORT;

  delete process.env.ADMIN_CACHE_REFRESH_TOKEN;
  delete process.env.ENABLE_MISSEVAN;
  delete process.env.MISSEVAN_FALLBACK_BASE_URL;
  delete process.env.MISSEVAN_FALLBACK_PROXY_TOKEN;
  delete process.env.MISSEVAN_FALLBACK_TIMEOUT_MS;
  delete process.env.MISSEVAN_SECONDARY_FALLBACK_BASE_URL;
  delete process.env.MISSEVAN_SECONDARY_FALLBACK_PROXY_TOKEN;
  delete process.env.MISSEVAN_SECONDARY_FALLBACK_TIMEOUT_MS;
  delete process.env.MISSEVAN_FORCE_FALLBACK;
  delete process.env.PORT;

  try {
    await fs.writeFile(
      path.join(projectRoot, ".env"),
      [
        "ADMIN_CACHE_REFRESH_TOKEN=secret",
        "ENABLE_MISSEVAN=false",
        "MISSEVAN_FALLBACK_BASE_URL=https://msbackup.onrender.com/missevan",
        "MISSEVAN_FALLBACK_PROXY_TOKEN=fallback-secret",
        "MISSEVAN_FALLBACK_TIMEOUT_MS=90000",
        "MISSEVAN_SECONDARY_FALLBACK_BASE_URL=https://msbackup.mmtoolkit.deno.net/missevan",
        "MISSEVAN_SECONDARY_FALLBACK_PROXY_TOKEN=secondary-secret",
        "MISSEVAN_SECONDARY_FALLBACK_TIMEOUT_MS=15000",
        "MISSEVAN_FORCE_FALLBACK=2",
        "PORT=3901",
        "UNSUPPORTED_KEY=ignored",
      ].join("\n")
    );

    await loadLocalEnv({ projectRoot });

    assert.equal(process.env.ADMIN_CACHE_REFRESH_TOKEN, "secret");
    assert.equal(process.env.ENABLE_MISSEVAN, "false");
    assert.equal(process.env.MISSEVAN_FALLBACK_BASE_URL, "https://msbackup.onrender.com/missevan");
    assert.equal(process.env.MISSEVAN_FALLBACK_PROXY_TOKEN, "fallback-secret");
    assert.equal(process.env.MISSEVAN_FALLBACK_TIMEOUT_MS, "90000");
    assert.equal(process.env.MISSEVAN_SECONDARY_FALLBACK_BASE_URL, "https://msbackup.mmtoolkit.deno.net/missevan");
    assert.equal(process.env.MISSEVAN_SECONDARY_FALLBACK_PROXY_TOKEN, "secondary-secret");
    assert.equal(process.env.MISSEVAN_SECONDARY_FALLBACK_TIMEOUT_MS, "15000");
    assert.equal(process.env.MISSEVAN_FORCE_FALLBACK, "2");
    assert.equal(process.env.PORT, "3901");
    assert.equal(process.env.UNSUPPORTED_KEY, undefined);
  } finally {
    if (previousAdminCacheRefreshToken == null) {
      delete process.env.ADMIN_CACHE_REFRESH_TOKEN;
    } else {
      process.env.ADMIN_CACHE_REFRESH_TOKEN = previousAdminCacheRefreshToken;
    }
    if (previousEnableMissevan == null) {
      delete process.env.ENABLE_MISSEVAN;
    } else {
      process.env.ENABLE_MISSEVAN = previousEnableMissevan;
    }
    if (previousFallbackBaseUrl == null) {
      delete process.env.MISSEVAN_FALLBACK_BASE_URL;
    } else {
      process.env.MISSEVAN_FALLBACK_BASE_URL = previousFallbackBaseUrl;
    }
    if (previousFallbackProxyToken == null) {
      delete process.env.MISSEVAN_FALLBACK_PROXY_TOKEN;
    } else {
      process.env.MISSEVAN_FALLBACK_PROXY_TOKEN = previousFallbackProxyToken;
    }
    if (previousFallbackTimeoutMs == null) {
      delete process.env.MISSEVAN_FALLBACK_TIMEOUT_MS;
    } else {
      process.env.MISSEVAN_FALLBACK_TIMEOUT_MS = previousFallbackTimeoutMs;
    }
    if (previousSecondaryFallbackBaseUrl == null) {
      delete process.env.MISSEVAN_SECONDARY_FALLBACK_BASE_URL;
    } else {
      process.env.MISSEVAN_SECONDARY_FALLBACK_BASE_URL = previousSecondaryFallbackBaseUrl;
    }
    if (previousSecondaryFallbackProxyToken == null) {
      delete process.env.MISSEVAN_SECONDARY_FALLBACK_PROXY_TOKEN;
    } else {
      process.env.MISSEVAN_SECONDARY_FALLBACK_PROXY_TOKEN = previousSecondaryFallbackProxyToken;
    }
    if (previousSecondaryFallbackTimeoutMs == null) {
      delete process.env.MISSEVAN_SECONDARY_FALLBACK_TIMEOUT_MS;
    } else {
      process.env.MISSEVAN_SECONDARY_FALLBACK_TIMEOUT_MS = previousSecondaryFallbackTimeoutMs;
    }
    if (previousForceFallback == null) {
      delete process.env.MISSEVAN_FORCE_FALLBACK;
    } else {
      process.env.MISSEVAN_FORCE_FALLBACK = previousForceFallback;
    }
    if (previousPort == null) {
      delete process.env.PORT;
    } else {
      process.env.PORT = previousPort;
    }
  }
});
