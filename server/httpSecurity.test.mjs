import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import express from "express";

import {
  buildContentSecurityPolicy,
  createRequestId,
  createSensitiveProbePathMiddleware,
  getOriginRejectionReason,
  isAllowedDesktopHost,
  isLoopbackAddress,
  isSameOriginRequest,
  isSensitiveProbePath,
  MANBO_CRYPTO_SCRIPT_ORIGIN,
} from "./httpSecurity.js";

const applicationSource = fs.readFileSync(new URL("./application.js", import.meta.url), "utf8");
const sensitiveProbePaths = [
  "/.env",
  "/.ENV",
  "/.env.local",
  "/.env.production",
  "/.env.old",
  "/src/.env",
  "/api/.env",
  "/foo/.env.test",
  "/.git",
  "/.git/config",
  "/foo/.git/config",
  "/.svn/entries",
  "/.hg/store",
  "/.htpasswd",
  "/private/.htpasswd",
  "/.htaccess",
  "/%2Eenv",
  "/%2eenv",
  "/%2Egit/config",
];

function request(overrides = {}) {
  return {
    method: "GET",
    headers: { host: "127.0.0.1:43210" },
    socket: {
      remoteAddress: "127.0.0.1",
      localPort: 43210,
    },
    ...overrides,
  };
}

test("same-origin validation compares the origin authority with request host", () => {
  assert.equal(isSameOriginRequest("http://127.0.0.1:43210", "127.0.0.1:43210"), true);
  assert.equal(isSameOriginRequest("http://127.0.0.1:43211", "127.0.0.1:43210"), false);
  assert.equal(isSameOriginRequest("https://evil.example", "127.0.0.1:43210"), false);
  assert.equal(isSameOriginRequest("null", "127.0.0.1:43210"), false);
});

test("desktop requests require loopback, matching port, and same-origin writes", () => {
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("192.168.1.10"), false);
  assert.equal(isAllowedDesktopHost("localhost:43210", 43210), true);
  assert.equal(isAllowedDesktopHost("[::1]:43210", 43210), true);
  assert.equal(isAllowedDesktopHost("127.0.0.1:43211", 43210), false);

  assert.equal(getOriginRejectionReason(request(), { desktopApp: true }), null);
  assert.equal(
    getOriginRejectionReason(
      request({ method: "PUT", headers: { host: "127.0.0.1:43210", origin: "http://127.0.0.1:43210" } }),
      { desktopApp: true }
    ),
    null
  );
  assert.equal(
    getOriginRejectionReason(request({ method: "PUT" }), { desktopApp: true }),
    "missing-origin"
  );
  assert.equal(
    getOriginRejectionReason(request({ socket: { remoteAddress: "192.168.1.10", localPort: 43210 } }), { desktopApp: true }),
    "remote-address"
  );
  assert.equal(
    getOriginRejectionReason(request({ headers: { host: "127.0.0.1:43211" } }), { desktopApp: true }),
    "host"
  );
});

test("content security policy only includes a valid HTTPS Twikoo origin", () => {
  const policy = buildContentSecurityPolicy({ twikooUrl: "https://twikoo.example.com/" });
  assert.match(policy, /default-src 'self'/);
  assert.match(policy, new RegExp(`script-src 'self' ${MANBO_CRYPTO_SCRIPT_ORIGIN.replaceAll(".", "\\.")}`));
  assert.doesNotMatch(policy, /script-src[^;]*\*/);
  assert.doesNotMatch(policy, /script-src[^;]*https:(?:;|$)/);
  assert.match(policy, /connect-src 'self' https:\/\/twikoo\.example\.com/);
  assert.doesNotMatch(policy, /upgrade-insecure-requests/);
  assert.doesNotMatch(
    buildContentSecurityPolicy({ twikooUrl: "javascript:alert(1)" }),
    /javascript:/
  );
});

test("request ids accept safe caller ids and replace unsafe values", () => {
  assert.equal(createRequestId("request-42"), "request-42");
  assert.match(createRequestId("<script>"), /^[0-9a-f-]{36}$/);
});

test("sensitive probe detection is case-insensitive, segment-aware, and decodes once", () => {
  const legitimatePaths = [
    "/",
    "/robots.txt",
    "/sitemap.xml",
    "/.well-known/security.txt",
    "/.well-known/acme-challenge/example",
    "/assets/example.js",
    "/foo/environment",
    "/file.env.example.html",
  ];

  for (const pathname of sensitiveProbePaths) {
    assert.equal(isSensitiveProbePath(pathname), true, pathname);
  }
  for (const pathname of legitimatePaths) {
    assert.equal(isSensitiveProbePath(pathname), false, pathname);
  }
  assert.doesNotThrow(() => isSensitiveProbePath("/%not-valid"));
});

test("sensitive probe middleware returns a minimal 404 before an SPA fallback", async (t) => {
  const testApp = express();
  testApp.use(createSensitiveProbePathMiddleware());
  testApp.use((req, res) => res.status(200).send("小猫小狐工具箱"));

  const listener = testApp.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    listener.once("listening", resolve);
    listener.once("error", reject);
  });
  t.after(() => new Promise((resolve) => listener.close(resolve)));

  const port = listener.address().port;
  for (const pathname of sensitiveProbePaths) {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`);
    const body = await response.text();
    assert.equal(response.status, 404, pathname);
    assert.match(response.headers.get("content-type") || "", /^text\/plain/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(body, "Not Found");
    assert.doesNotMatch(body, /小猫小狐工具箱/);
  }

  const headResponse = await fetch(`http://127.0.0.1:${port}/.htpasswd`, {
    method: "HEAD",
  });
  assert.equal(headResponse.status, 404);
  assert.equal(await headResponse.text(), "");

  const postResponse = await fetch(`http://127.0.0.1:${port}/.svn/entries`, {
    method: "POST",
  });
  assert.equal(postResponse.status, 404);

  const wellKnownResponse = await fetch(
    `http://127.0.0.1:${port}/.well-known/security.txt`
  );
  assert.equal(wellKnownResponse.status, 200);
  assert.equal(await wellKnownResponse.text(), "小猫小狐工具箱");
});

test("HTTP delivery enables negotiated compression and orders immutable assets before SPA fallback", () => {
  assert.match(applicationSource, /app\.use\(compression\(\{[\s\S]*threshold: 1024/);
  assert.doesNotMatch(applicationSource, /type\.includes\("application\/json"\)/);

  const assetsIndex = applicationSource.indexOf('app.use("/assets", express.static');
  const generalStaticIndex = applicationSource.indexOf("app.use(express.static(distDirectory");
  const fallbackIndex = applicationSource.indexOf('app.get("*"');
  const probeMiddlewareIndex = applicationSource.indexOf("app.use(createSensitiveProbePathMiddleware())");
  assert.ok(
    probeMiddlewareIndex >= 0 &&
    probeMiddlewareIndex < assetsIndex &&
    assetsIndex < generalStaticIndex &&
    generalStaticIndex < fallbackIndex
  );
  assert.match(applicationSource, /immutable: true/);
  assert.match(applicationSource, /maxAge: "1y"/);
  assert.match(applicationSource, /path\.basename\(filePath\)[\s\S]*index\.html[\s\S]*Cache-Control", "no-store"/);
  assert.match(applicationSource.slice(fallbackIndex), /Cache-Control", "no-store"/);
});
