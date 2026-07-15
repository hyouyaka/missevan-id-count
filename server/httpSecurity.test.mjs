import test from "node:test";
import assert from "node:assert/strict";

import {
  buildContentSecurityPolicy,
  createRequestId,
  getOriginRejectionReason,
  isAllowedDesktopHost,
  isLoopbackAddress,
  isSameOriginRequest,
} from "./httpSecurity.js";

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
