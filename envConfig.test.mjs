import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadLocalEnv } from "./envConfig.js";

test("loadLocalEnv reads local server env keys from project .env", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "missevan-env-"));
  const previousEnableMissevan = process.env.ENABLE_MISSEVAN;
  const previousPort = process.env.PORT;

  delete process.env.ENABLE_MISSEVAN;
  delete process.env.PORT;

  try {
    await fs.writeFile(
      path.join(projectRoot, ".env"),
      ["ENABLE_MISSEVAN=false", "PORT=3901", "UNSUPPORTED_KEY=ignored"].join("\n")
    );

    await loadLocalEnv({ projectRoot });

    assert.equal(process.env.ENABLE_MISSEVAN, "false");
    assert.equal(process.env.PORT, "3901");
    assert.equal(process.env.UNSUPPORTED_KEY, undefined);
  } finally {
    if (previousEnableMissevan == null) {
      delete process.env.ENABLE_MISSEVAN;
    } else {
      process.env.ENABLE_MISSEVAN = previousEnableMissevan;
    }
    if (previousPort == null) {
      delete process.env.PORT;
    } else {
      process.env.PORT = previousPort;
    }
  }
});
