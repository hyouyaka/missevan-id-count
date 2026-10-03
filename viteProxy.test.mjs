import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { createServer } from "vite";

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => {
      server.removeListener("error", reject);
      resolve(server.address().port);
    });
  });
}

test("Vite proxies feedback and favorite metadata requests to the backend", async () => {
  const previousPort = process.env.PORT;
  const backend = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ path: req.url, method: req.method }));
  });
  let vite;

  try {
    const backendPort = await listen(backend);
    process.env.PORT = String(backendPort);
    vite = await createServer({
      configFile: path.resolve("vite.config.js"),
      clearScreen: false,
      logLevel: "silent",
      server: { host: "127.0.0.1", port: 0, strictPort: false },
    });
    await vite.listen();
    const frontendPort = vite.httpServer.address().port;

    const feedbackResponse = await fetch(`http://127.0.0.1:${frontendPort}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "feature", message: "test feedback" }),
    });
    const feedbackPayload = await feedbackResponse.json();
    assert.equal(feedbackResponse.status, 200);
    assert.deepEqual(feedbackPayload, { path: "/feedback", method: "POST" });

    const metaResponse = await fetch(
      `http://127.0.0.1:${frontendPort}/favorites/meta?platform=manbo&dramaId=42`
    );
    const metaPayload = await metaResponse.json();
    assert.equal(metaResponse.status, 200);
    assert.deepEqual(metaPayload, {
      path: "/favorites/meta?platform=manbo&dramaId=42",
      method: "GET",
    });
  } finally {
    await vite?.close();
    await new Promise((resolve) => backend.close(resolve));
    if (previousPort == null) {
      delete process.env.PORT;
    } else {
      process.env.PORT = previousPort;
    }
  }
});
