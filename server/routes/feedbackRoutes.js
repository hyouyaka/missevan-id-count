const FEEDBACK_TYPE_LABELS = Object.freeze({
  bug: "Bug",
  data: "数据异常",
  feature: "功能建议",
  other: "其他",
});

const FEEDBACK_TYPES = new Set(Object.keys(FEEDBACK_TYPE_LABELS));
const FEEDBACK_MESSAGE_MIN_LENGTH = 5;
const FEEDBACK_MESSAGE_MAX_LENGTH = 3000;
const FEEDBACK_FRONTEND_VERSION_MAX_LENGTH = 100;
const INVALID_FEEDBACK_MESSAGE = "请检查反馈内容后重试。";
const FEEDBACK_UNAVAILABLE_MESSAGE = "反馈暂时无法发送，请稍后再试。";

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replaceAll("\u0000", "")
    .trim();
}

function normalizeFrontendVersion(value) {
  return Array.from(normalizeText(value))
    .filter((character) => {
      const codePoint = character.codePointAt(0) || 0;
      return codePoint > 0x1f && codePoint !== 0x7f;
    })
    .join("")
    .slice(0, FEEDBACK_FRONTEND_VERSION_MAX_LENGTH);
}

export function validateFeedbackPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, message: INVALID_FEEDBACK_MESSAGE };
  }

  if (typeof payload.type !== "string" || !FEEDBACK_TYPES.has(payload.type.trim())) {
    return { ok: false, message: INVALID_FEEDBACK_MESSAGE };
  }

  if (typeof payload.message !== "string") {
    return { ok: false, message: INVALID_FEEDBACK_MESSAGE };
  }

  const type = payload.type.trim();
  const message = normalizeText(payload.message);
  if (
    message.length < FEEDBACK_MESSAGE_MIN_LENGTH ||
    message.length > FEEDBACK_MESSAGE_MAX_LENGTH
  ) {
    return { ok: false, message: INVALID_FEEDBACK_MESSAGE };
  }

  return {
    ok: true,
    type,
    message,
    website: normalizeText(payload.website),
    frontendVersion: normalizeFrontendVersion(payload.frontendVersion),
  };
}

export function buildFeedbackEmailText({
  type,
  message,
  frontendVersion = "",
  requestId = "",
  now = new Date(),
}) {
  const timestamp = new Date(now)
    .toISOString()
    .replace(/\.\d{3}Z$/, " UTC")
    .replace("T", " ");
  return [
    "MMToolkit 收到新的匿名反馈",
    "",
    `类型：${FEEDBACK_TYPE_LABELS[type] || FEEDBACK_TYPE_LABELS.other}`,
    `时间：${timestamp}`,
    `前端版本：${frontendVersion || "未知"}`,
    `Request ID：${requestId || "未知"}`,
    "",
    "反馈内容：",
    "",
    message,
  ].join("\n");
}

export function getFeedbackTypeLabel(type) {
  return FEEDBACK_TYPE_LABELS[type] || "其他";
}

function getResendMessageId(result) {
  return String(result?.data?.id || result?.id || "").trim().slice(0, 200);
}

function resolveSendEmail({ sendEmail, resend }) {
  if (typeof sendEmail === "function") {
    return sendEmail;
  }
  if (typeof resend?.emails?.send === "function") {
    return (payload) => resend.emails.send(payload);
  }
  return null;
}

/**
 * Register the anonymous feedback endpoint.
 *
 * The email sender is injected so this route remains easy to test without
 * making a provider request. The production application passes Resend's
 * `emails.send` implementation.
 */
export function registerFeedbackRoutes(router, {
  feedbackEnabled = false,
  feedbackFromEmail = "",
  feedbackRecipientEmail = "",
  feedbackLimiter = null,
  logger = null,
  resend = null,
  sendEmail = null,
  now = () => new Date(),
} = {}) {
  const handlers = ["/feedback"];
  if (typeof feedbackLimiter === "function") {
    handlers.push(feedbackLimiter);
  }

  handlers.push(async (req, res) => {
    const validation = validateFeedbackPayload(req.body);
    if (!validation.ok) {
      return res.status(400).json({
        success: false,
        message: validation.message,
      });
    }

    if (validation.website) {
      return res.json({ success: true });
    }

    if (!feedbackEnabled) {
      return res.status(503).json({
        success: false,
        message: FEEDBACK_UNAVAILABLE_MESSAGE,
      });
    }

    const send = resolveSendEmail({ sendEmail, resend });
    if (!send || !feedbackFromEmail || !feedbackRecipientEmail) {
      return res.status(503).json({
        success: false,
        message: FEEDBACK_UNAVAILABLE_MESSAGE,
      });
    }

    const requestId = String(req.requestId || "").trim().slice(0, 128);
    const emailPayload = {
      from: feedbackFromEmail,
      to: feedbackRecipientEmail,
      subject: `[MMToolkit 反馈] ${getFeedbackTypeLabel(validation.type)}`,
      text: buildFeedbackEmailText({
        type: validation.type,
        message: validation.message,
        frontendVersion: validation.frontendVersion,
        requestId,
        now: now(),
      }),
    };

    try {
      const result = await send(emailPayload);
      if (result?.error) {
        throw result.error;
      }

      if (typeof logger?.info === "function") {
        void logger.info("feedback_sent", {
          requestId,
          type: validation.type,
          resendMessageId: getResendMessageId(result),
        });
      }
      return res.json({ success: true });
    } catch (_) {
      if (typeof logger?.error === "function") {
        void logger.error("feedback_send_failed", null, {
          requestId,
          type: validation.type,
          provider: "resend",
          errorCategory: "provider_error",
        });
      }
      return res.status(503).json({
        success: false,
        message: FEEDBACK_UNAVAILABLE_MESSAGE,
      });
    }
  });

  router.post(...handlers);
}

export {
  FEEDBACK_FRONTEND_VERSION_MAX_LENGTH,
  FEEDBACK_MESSAGE_MAX_LENGTH,
  FEEDBACK_MESSAGE_MIN_LENGTH,
  FEEDBACK_TYPE_LABELS,
  FEEDBACK_UNAVAILABLE_MESSAGE,
  INVALID_FEEDBACK_MESSAGE,
};
