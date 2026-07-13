import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleRequest, MAX_POST_BODY_BYTES } from "../src/index";

function createRateLimiter(limit = Number.POSITIVE_INFINITY) {
  const counts = new Map<string, number>();

  return {
    async limit({ key }: { key: string }) {
      const count = (counts.get(key) || 0) + 1;
      counts.set(key, count);
      return { success: count <= limit };
    },
  };
}

function createEnv(rateLimit = Number.POSITIVE_INFINITY) {
  return {
    TWIKOO_RATE_LIMITER: createRateLimiter(rateLimit),
    UPSTREAM_ORIGIN: "",
  } as Env;
}

function createRequest(body?: unknown, ip = "203.0.113.42") {
  return new Request("https://twikoo.mmtoolkit.app/", {
    method: "POST",
    headers: {
      "CF-Connecting-IP": ip,
      "CF-Ray": "test-ray",
      "Content-Type": "application/json",
    },
    body: typeof body === "string" ? body : body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("Twikoo guard", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  for (const event of ["COMMENT_GET", "COMMENT_SUBMIT", "LOGIN", "GET_CONFIG"]) {
    it(`forwards a valid ${event} request without consuming its body`, async () => {
      const originFetch = vi.fn(async (request: Request) => {
        expect(await request.json()).toEqual({ event });
        return new Response("origin", { status: 200 });
      });

      const response = await handleRequest(createRequest({ event }), createEnv(), originFetch);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("origin");
      expect(originFetch).toHaveBeenCalledOnce();
    });
  }

  it.each([
    ["empty body", undefined],
    ["empty object", {}],
    ["missing event", { path: "/feedback" }],
    ["empty event", { event: "   " }],
    ["array", []],
    ["primitive", "null"],
    ["invalid JSON", "{"],
  ])("rejects %s", async (_name, body) => {
    const originFetch = vi.fn();
    const response = await handleRequest(createRequest(body), createEnv(), originFetch);

    expect(response.status).toBe(400);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ code: 400, message: "请求参数不完整" });
    expect(originFetch).not.toHaveBeenCalled();
  });

  it("returns 429 on the 61st request from the same IP", async () => {
    const env = createEnv(60);
    const originFetch = vi.fn(async () => new Response("origin"));

    for (let index = 0; index < 60; index += 1) {
      const response = await handleRequest(createRequest({ event: "COMMENT_GET" }), env, originFetch);
      expect(response.status).toBe(200);
    }

    const response = await handleRequest(createRequest({ event: "COMMENT_GET" }), env, originFetch);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      code: 429,
      message: "请求过于频繁，请稍后再试",
    });
    expect(originFetch).toHaveBeenCalledTimes(60);
  });

  it("counts different IP addresses independently", async () => {
    const env = createEnv(1);
    const originFetch = vi.fn(async () => new Response("origin"));

    const first = await handleRequest(
      createRequest({ event: "COMMENT_GET" }, "203.0.113.1"),
      env,
      originFetch
    );
    const second = await handleRequest(
      createRequest({ event: "COMMENT_GET" }, "203.0.113.2"),
      env,
      originFetch
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it("fails closed with a safe 503 response when the rate limiter is unavailable", async () => {
    const env = createEnv();
    env.TWIKOO_RATE_LIMITER.limit = vi.fn(async () => {
      throw new Error("rate limiter unavailable");
    });
    const originFetch = vi.fn();

    const response = await handleRequest(createRequest({ event: "COMMENT_GET" }), env, originFetch);

    expect(response.status).toBe(503);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ code: 503, message: "反馈服务暂不可用" });
    expect(originFetch).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('"reason":"rate_limiter_unavailable"')
    );
  });

  it.each(["GET", "HEAD", "OPTIONS"])("forwards %s requests", async (method) => {
    const request = new Request("https://twikoo.mmtoolkit.app/", {
      method,
      headers: { "CF-Connecting-IP": "203.0.113.42" },
    });
    const originFetch = vi.fn(async () => new Response(null, { status: 204 }));

    const response = await handleRequest(request, createEnv(), originFetch);

    expect(response.status).toBe(204);
    expect(originFetch).toHaveBeenCalledOnce();
  });

  it("returns a safe 502 response when the origin is unavailable", async () => {
    const response = await handleRequest(createRequest({ event: "COMMENT_GET" }), createEnv(), async () => {
      throw new Error("origin unavailable");
    });

    expect(response.status).toBe(502);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    await expect(response.json()).resolves.toEqual({ code: 502, message: "反馈服务暂不可用" });
  });

  it("rejects a declared oversized body before reading it", async () => {
    const request = createRequest({ event: "COMMENT_GET" });
    request.headers.set("Content-Length", String(MAX_POST_BODY_BYTES + 1));
    const originFetch = vi.fn();

    const response = await handleRequest(request, createEnv(), originFetch);

    expect(response.status).toBe(413);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    await expect(response.json()).resolves.toEqual({ code: 413, message: "请求内容过大" });
    expect(originFetch).not.toHaveBeenCalled();
  });

  it("stops reading a chunked body when it crosses the configured limit", async () => {
    const request = createRequest({ event: "COMMENT_GET", padding: "x".repeat(64) });
    request.headers.delete("Content-Length");
    const originFetch = vi.fn();

    const response = await handleRequest(request, createEnv(), originFetch, 32);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ code: 413, message: "请求内容过大" });
    expect(originFetch).not.toHaveBeenCalled();
  });

  it("returns a safe 400 response when the request body stream fails", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("client disconnected"));
      },
    });
    const request = new Request("https://twikoo.mmtoolkit.app/", {
      method: "POST",
      headers: {
        "CF-Connecting-IP": "203.0.113.42",
        "CF-Ray": "test-ray",
        "Content-Type": "application/json",
      },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const originFetch = vi.fn();

    const response = await handleRequest(request, createEnv(), originFetch);

    expect(response.status).toBe(400);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ code: 400, message: "请求参数不完整" });
    expect(originFetch).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"reason":"post_body_read_error"'));
  });

  it("accepts a request exactly at the configured body limit", async () => {
    const body = JSON.stringify({ event: "COMMENT_GET" });
    const originFetch = vi.fn(async (request: Request) => {
      expect(await request.text()).toBe(body);
      return new Response("origin");
    });

    const response = await handleRequest(
      createRequest(body),
      createEnv(),
      originFetch,
      new TextEncoder().encode(body).byteLength
    );

    expect(response.status).toBe(200);
    expect(originFetch).toHaveBeenCalledOnce();
  });

  it("rewrites staging requests to the configured upstream origin", async () => {
    const env = createEnv();
    env.UPSTREAM_ORIGIN = "https://twikoo.mmtoolkit.app";
    const originFetch = vi.fn(async (request: Request) => {
      expect(request.url).toBe("https://twikoo.mmtoolkit.app/api?source=staging");
      expect(await request.json()).toEqual({ event: "COMMENT_GET" });
      return new Response("origin");
    });
    const request = new Request(
      "https://twikoo-guard-staging.mmtoolkit.workers.dev/api?source=staging",
      {
        method: "POST",
        headers: { "CF-Connecting-IP": "203.0.113.42" },
        body: JSON.stringify({ event: "COMMENT_GET" }),
      }
    );

    const response = await handleRequest(request, env, originFetch);

    expect(response.status).toBe(200);
    expect(originFetch).toHaveBeenCalledOnce();
  });
});
