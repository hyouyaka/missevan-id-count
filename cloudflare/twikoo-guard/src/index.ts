const JSON_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
} as const;

export const MAX_POST_BODY_BYTES = 16 * 1024 * 1024;

type OriginFetch = (request: Request) => Promise<Response>;

function jsonResponse(status: number, body: Record<string, unknown>, extraHeaders?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...extraHeaders,
    },
  });
}

function maskIp(ip: string) {
  if (ip.includes(".")) {
    const parts = ip.split(".");
    return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.x` : "unknown";
  }

  if (ip.includes(":")) {
    return `${ip.split(":").slice(0, 4).join(":")}::`;
  }

  return "unknown";
}

function logRejection(request: Request, reason: string, status: number, clientIp: string) {
  console.warn(
    JSON.stringify({
      event: "twikoo_guard_rejection",
      status,
      reason,
      rayId: request.headers.get("CF-Ray") || "unknown",
      clientIp: maskIp(clientIp),
    })
  );
}

function logServiceError(request: Request, reason: string, status: number, clientIp: string) {
  console.error(
    JSON.stringify({
      event: "twikoo_guard_service_error",
      status,
      reason,
      rayId: request.headers.get("CF-Ray") || "unknown",
      clientIp: maskIp(clientIp),
    })
  );
}

function clientIpFor(request: Request) {
  return request.headers.get("CF-Connecting-IP")?.trim() || "unknown";
}

function upstreamRequest(request: Request, upstreamOrigin: string) {
  if (!upstreamOrigin) {
    return request;
  }

  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, upstreamOrigin);
  return new Request(upstreamUrl, request);
}

type PostValidationResult =
  | { ok: true; request: Request }
  | {
      ok: false;
      reason: "invalid_post_body" | "post_body_too_large" | "post_body_read_error";
      status: 400 | 413;
    };

async function readBoundedBody(request: Request, maxBytes: number) {
  if (!request.body) {
    return { body: null, tooLarge: false };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel("request body too large");
        } catch {
          // The size decision is already final; a failed cancellation must not turn 413 into 400.
        }
        return { body: null, tooLarge: true };
      }
      chunks.push(value);
    }
  } catch {
    return { body: null, tooLarge: false, readError: true };
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body, tooLarge: false, readError: false };
}

async function validateTwikooPost(
  request: Request,
  maxBytes: number
): Promise<PostValidationResult> {
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false, reason: "post_body_too_large", status: 413 };
  }

  const bodyResult = await readBoundedBody(request, maxBytes);
  if (!bodyResult.body) {
    if (bodyResult.readError) {
      return { ok: false, reason: "post_body_read_error", status: 400 };
    }
    return {
      ok: false,
      reason: bodyResult.tooLarge ? "post_body_too_large" : "invalid_post_body",
      status: bodyResult.tooLarge ? 413 : 400,
    };
  }
  const body = bodyResult.body;

  let payload: unknown;

  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return { ok: false, reason: "invalid_post_body", status: 400 };
  }

  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, reason: "invalid_post_body", status: 400 };
  }

  const event = Reflect.get(payload, "event");
  if (typeof event !== "string" || event.trim().length === 0) {
    return { ok: false, reason: "invalid_post_body", status: 400 };
  }

  return {
    ok: true,
    request: new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body,
      redirect: request.redirect,
    }),
  };
}

export async function handleRequest(
  request: Request,
  env: Env,
  originFetch: OriginFetch = fetch,
  maxPostBodyBytes = MAX_POST_BODY_BYTES
) {
  const clientIp = clientIpFor(request);
  let rateLimitResult: Awaited<ReturnType<Env["TWIKOO_RATE_LIMITER"]["limit"]>>;

  try {
    rateLimitResult = await env.TWIKOO_RATE_LIMITER.limit({ key: clientIp });
  } catch {
    logServiceError(request, "rate_limiter_unavailable", 503, clientIp);
    return jsonResponse(503, { code: 503, message: "反馈服务暂不可用" });
  }

  if (!rateLimitResult.success) {
    logRejection(request, "rate_limited", 429, clientIp);
    return jsonResponse(
      429,
      { code: 429, message: "请求过于频繁，请稍后再试" },
      { "Retry-After": "60" }
    );
  }

  let forwardRequest = request;
  if (request.method === "POST") {
    const validation = await validateTwikooPost(request, maxPostBodyBytes);
    if (!validation.ok) {
      logRejection(request, validation.reason, validation.status, clientIp);
      return jsonResponse(
        validation.status,
        validation.status === 413
          ? { code: 413, message: "请求内容过大" }
          : { code: 400, message: "请求参数不完整" }
      );
    }
    forwardRequest = validation.request;
  }

  try {
    return await originFetch(upstreamRequest(forwardRequest, env.UPSTREAM_ORIGIN));
  } catch {
    logServiceError(request, "origin_unavailable", 502, clientIp);
    return jsonResponse(502, { code: 502, message: "反馈服务暂不可用" });
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
