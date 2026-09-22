import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFeedbackEmailText,
  registerFeedbackRoutes,
} from "./routes/feedbackRoutes.js";

function createResponse() {
  return {
    payload: undefined,
    statusCode: 200,
    json(payload) {
      this.payload = payload;
      return this;
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
  };
}

function createHarness(options = {}) {
  let route;
  let routeHandlers;
  const sent = [];
  const logs = [];
  const router = {
    post(path, ...handlers) {
      route = path;
      routeHandlers = handlers;
    },
  };
  registerFeedbackRoutes(router, {
    feedbackEnabled: options.feedbackEnabled ?? true,
    feedbackFromEmail: options.feedbackFromEmail ?? "MMToolkit Feedback <feedback@example.com>",
    feedbackRecipientEmail: options.feedbackRecipientEmail ?? "admin@example.com",
    feedbackLimiter: options.feedbackLimiter,
    logger: {
      info(event, fields) {
        logs.push({ level: "info", event, fields });
      },
      error(event, error, fields) {
        logs.push({ level: "error", event, error, fields });
      },
    },
    sendEmail: async (payload) => {
      sent.push(payload);
      if (options.sendEmail) {
        return options.sendEmail(payload);
      }
      return { data: { id: "resend-message-id" } };
    },
    now: () => new Date("2026-09-21T12:34:56.000Z"),
  });
  return {
    handler: routeHandlers.at(-1),
    route,
    sent,
    logs,
    middleware: routeHandlers.length > 1 ? routeHandlers[0] : null,
  };
}

test("valid feedback sends one text-only Resend message", async () => {
  const harness = createHarness();
  const response = createResponse();

  await harness.handler({
    requestId: "request-42",
    body: {
      type: "bug",
      message: "页面加载后统计结果不正确",
      website: "",
      frontendVersion: "1.8.3",
    },
  }, response);

  assert.equal(harness.route, "/feedback");
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, { success: true });
  assert.equal(harness.sent.length, 1);
  assert.deepEqual(harness.sent[0], {
    from: "MMToolkit Feedback <feedback@example.com>",
    to: "admin@example.com",
    subject: "[MMToolkit 反馈] Bug",
    text: buildFeedbackEmailText({
      type: "bug",
      message: "页面加载后统计结果不正确",
      frontendVersion: "1.8.3",
      requestId: "request-42",
      now: new Date("2026-09-21T12:34:56.000Z"),
    }),
  });
  assert.deepEqual(harness.logs[0], {
    level: "info",
    event: "feedback_sent",
    fields: { requestId: "request-42", type: "bug", resendMessageId: "resend-message-id" },
  });
  assert.equal(harness.logs.some((entry) => JSON.stringify(entry).includes("页面加载后统计结果不正确")), false);
});

test("invalid type and message lengths return 400 before calling Resend", async () => {
  for (const body of [
    { type: "unknown", message: "这是一个足够长的反馈内容" },
    { type: "bug", message: "1234" },
    { type: "bug", message: "x".repeat(3001) },
    { type: "bug", message: {} },
  ]) {
    const harness = createHarness();
    const response = createResponse();
    await harness.handler({ body }, response);
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.payload, { success: false, message: "请检查反馈内容后重试。" });
    assert.equal(harness.sent.length, 0);
  }
});

test("five-character feedback is accepted after trimming", async () => {
  const harness = createHarness();
  const response = createResponse();

  await harness.handler({ body: { type: "bug", message: " 12345 " } }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, { success: true });
  assert.equal(harness.sent.length, 1);
  assert.match(harness.sent[0].text, /反馈内容：\n\n12345$/);
});

test("honeypot returns success without sending a message", async () => {
  const harness = createHarness();
  const response = createResponse();

  await harness.handler({
    body: {
      type: "feature",
      message: "希望增加一个新的筛选功能",
      website: "filled-by-bot",
      frontendVersion: "1.8.3",
    },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, { success: true });
  assert.equal(harness.sent.length, 0);
  assert.equal(harness.logs.length, 0);
});

test("Resend failure returns a generic 503 and logs only its category", async () => {
  const harness = createHarness({
    sendEmail: async () => {
      throw new Error("provider error containing no user text");
    },
  });
  const response = createResponse();

  await harness.handler({
    requestId: "request-failure",
    body: { type: "data", message: "数据异常反馈内容足够长", website: "" },
  }, response);

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.payload, {
    success: false,
    message: "反馈暂时无法发送，请稍后再试。",
  });
  assert.equal(harness.logs.length, 1);
  assert.deepEqual(harness.logs[0], {
    level: "error",
    event: "feedback_send_failed",
    error: null,
    fields: {
      requestId: "request-failure",
      type: "data",
      provider: "resend",
      errorCategory: "provider_error",
    },
  });
});

test("unconfigured feedback endpoint never calls its sender", async () => {
  const harness = createHarness({ feedbackEnabled: false });
  const response = createResponse();

  await harness.handler({
    body: { type: "other", message: "未配置服务时也不应泄露配置", website: "" },
  }, response);

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.payload, {
    success: false,
    message: "反馈暂时无法发送，请稍后再试。",
  });
  assert.equal(harness.sent.length, 0);
});

test("feedback limiter is registered before the route handler", () => {
  const limiter = () => undefined;
  const harness = createHarness({ feedbackLimiter: limiter });
  assert.equal(harness.middleware, limiter);
});
