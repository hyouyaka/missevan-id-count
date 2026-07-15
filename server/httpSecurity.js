import { randomUUID } from "node:crypto";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const DEFAULT_PERMISSION_POLICY = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "notifications=()",
  "midi=()",
  "usb=()",
  "serial=()",
  "bluetooth=()",
  "clipboard-read=()",
].join(", ");

function normalizeHostHeader(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeRemoteAddress(value) {
  const address = String(value || "").trim().toLowerCase();
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

function parseAuthority(value) {
  const raw = normalizeHostHeader(value);
  if (!raw || raw.includes("/") || raw.includes("\\")) {
    return null;
  }

  try {
    const url = new URL(`http://${raw}`);
    return {
      hostname: url.hostname.replace(/^\[|\]$/g, ""),
      host: url.host,
      port: url.port || "",
    };
  } catch (_) {
    return null;
  }
}

export function isLoopbackAddress(value) {
  return LOOPBACK_HOSTS.has(normalizeRemoteAddress(value));
}

export function isAllowedDesktopHost(hostHeader, localPort) {
  const authority = parseAuthority(hostHeader);
  if (!authority || !LOOPBACK_HOSTS.has(authority.hostname)) {
    return false;
  }
  return authority.port === String(localPort || "");
}

export function isSameOriginRequest(originHeader, hostHeader) {
  const origin = String(originHeader || "").trim();
  if (!origin || origin === "null") {
    return false;
  }

  try {
    const originUrl = new URL(origin);
    if (!/^https?:$/.test(originUrl.protocol)) {
      return false;
    }
    const originAuthority = parseAuthority(originUrl.host);
    const requestAuthority = parseAuthority(hostHeader);
    return Boolean(
      originAuthority &&
      requestAuthority &&
      originAuthority.host === requestAuthority.host
    );
  } catch (_) {
    return false;
  }
}

export function getOriginRejectionReason(req, { desktopApp = false } = {}) {
  const origin = req?.headers?.origin;
  const host = req?.headers?.host;
  const method = String(req?.method || "GET").toUpperCase();

  if (origin && !isSameOriginRequest(origin, host)) {
    return "origin";
  }

  if (desktopApp) {
    const remoteAddress = req?.socket?.remoteAddress;
    const localPort = req?.socket?.localPort;
    if (!isLoopbackAddress(remoteAddress)) {
      return "remote-address";
    }
    if (!isAllowedDesktopHost(host, localPort)) {
      return "host";
    }
    if (UNSAFE_METHODS.has(method) && !isSameOriginRequest(origin, host)) {
      return "missing-origin";
    }
  }

  return null;
}

export function createRequestId(value = "") {
  const supplied = String(value || "").trim();
  return supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : randomUUID();
}

export function buildContentSecurityPolicy({ twikooUrl = "" } = {}) {
  const connectOrigins = ["'self'"];
  try {
    const url = new URL(String(twikooUrl || "").trim());
    if (url.protocol === "https:") {
      connectOrigins.push(url.origin);
    }
  } catch (_) {
    // Invalid optional configuration must not weaken the default policy.
  }

  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob: https:",
    `connect-src ${connectOrigins.join(" ")}`,
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
  ].join("; ");
}

export function applySecurityHeaders(res, { twikooUrl = "" } = {}) {
  res.setHeader("Content-Security-Policy", buildContentSecurityPolicy({ twikooUrl }));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", DEFAULT_PERMISSION_POLICY);
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
}

/**
 * @param {{
 *   desktopApp?: boolean,
 *   twikooUrl?: string,
 *   logger?: { warn: (event: string, fields?: Record<string, unknown>) => void } | null,
 * }} [options]
 */
export function createRequestSecurityMiddleware({ desktopApp = false, twikooUrl = "", logger = null } = {}) {
  return (req, res, next) => {
    const requestId = createRequestId(req.headers["x-request-id"]);
    req.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);
    applySecurityHeaders(res, { twikooUrl });

    const reason = getOriginRejectionReason(req, { desktopApp });
    if (reason) {
      logger?.warn("security_request_rejected", {
        requestId,
        route: req.path || null,
        method: req.method,
        status: 403,
        reason,
      });
      return res.status(403).json({
        success: false,
        code: "CROSS_ORIGIN_REQUEST_REJECTED",
        message: "Cross-origin request rejected",
      });
    }

    return next();
  };
}

export { DEFAULT_PERMISSION_POLICY, LOOPBACK_HOSTS, UNSAFE_METHODS };
