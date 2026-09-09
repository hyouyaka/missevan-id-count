import assert from "node:assert/strict";
import { test } from "node:test";

import { ImageProxyPolicyError } from "../shared/imageProxyPolicy.js";
import { registerImageProxyRoutes } from "./routes/imageProxyRoutes.js";

function createRouteHarness(options = {}) {
  let route = null;
  const operations = [];
  const router = {
    get(path, limiter, handler) {
      route = { path, limiter, handler };
    },
  };
  registerImageProxyRoutes(router, {
    fetchImageBufferWithRetry: options.fetchImageBufferWithRetry,
    formatImageProxyError: (error) => error?.message || String(error),
    imageProxyLimiter: options.imageProxyLimiter ?? "image-limiter",
    isAllowedImageHost: (hostname) => hostname === "img.kilamanbo.com",
    logger: {
      operation(...args) {
        operations.push(args);
      },
    },
  });
  return { operations, route };
}

function createResponse() {
  return {
    headers: new Map(),
    payload: undefined,
    statusCode: 200,
    sent: undefined,
    json(payload) {
      this.payload = payload;
      return this;
    },
    send(payload) {
      this.sent = payload;
      return this;
    },
    setHeader(name, value) {
      this.headers.set(name, value);
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
  };
}

test("image proxy route preserves validation and success response contracts", async () => {
  const buffer = Buffer.from([1, 2, 3]);
  const { operations, route } = createRouteHarness({
    fetchImageBufferWithRetry: async () => ({
      attempts: 2,
      buffer,
      contentType: "image/png",
    }),
  });
  const response = createResponse();

  await route.handler({ query: { url: "https://img.kilamanbo.com/cover.png" } }, response);

  assert.equal(route.path, "/image-proxy");
  assert.equal(route.limiter, "image-limiter");
  assert.equal(response.statusCode, 200);
  assert.equal(response.sent, buffer);
  assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600");
  assert.equal(operations.length, 1);
  assert.equal(operations[0][0], "image_proxy_fetch");
  assert.equal(operations[0][1].attempts, 2);
  assert.equal(operations[0][1].responseBytes, 3);
  assert.equal(operations[0][1].success, true);
});

test("image proxy route keeps invalid and policy errors distinguishable", async () => {
  const { operations, route } = createRouteHarness({
    fetchImageBufferWithRetry: async () => {
      throw new ImageProxyPolicyError("too large", {
        status: 413,
        code: "IMAGE_TOO_LARGE",
      });
    },
  });
  const missingUrlResponse = createResponse();
  const policyErrorResponse = createResponse();

  await route.handler({ query: {} }, missingUrlResponse);
  await route.handler({ query: { url: "https://img.kilamanbo.com/cover.png" } }, policyErrorResponse);

  assert.equal(missingUrlResponse.statusCode, 400);
  assert.deepEqual(missingUrlResponse.payload, {
    success: false,
    code: "INVALID_IMAGE_URL",
    message: "缺少图片地址。",
  });
  assert.equal(policyErrorResponse.statusCode, 413);
  assert.deepEqual(policyErrorResponse.payload, {
    success: false,
    code: "IMAGE_TOO_LARGE",
    message: "图片大小超过 10 MiB 限制。",
  });
  assert.equal(operations.length, 1);
  assert.equal(operations[0][2], "warn");
});
