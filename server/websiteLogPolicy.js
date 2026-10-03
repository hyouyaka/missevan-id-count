function numberOption(value, fallback, valid) {
  if (value == null || String(value).trim() === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) && valid(number) ? number : fallback;
}

// Return the original payload unchanged, or suppress it before either sink.
export function createWebsiteLogPolicy({
  sampleRate = process.env.HTTP_SUCCESS_LOG_SAMPLE_RATE,
  slowMs = process.env.OPERATION_LOG_SLOW_MS,
  random = Math.random,
} = {}) {
  const rate = numberOption(sampleRate, 0.01, (value) => value >= 0 && value <= 1);
  const threshold = numberOption(slowMs, 5000, (value) => value > 0);
  return (payload) => {
    if (payload.level === "error" || ["user_action", "task_summary"].includes(payload.category)) return payload;
    if (payload.category !== "operation" || payload.event === "danmaku_summary") return payload;
    // These attempts are also embedded in the corresponding danmaku summary.
    if (payload.event === "external_request_attempt" && payload.operation === "danmaku_summary") return null;
    if (payload.level !== "info") return payload;
    const duration = payload.durationMs;
    const knownDuration = typeof duration === "number" && Number.isFinite(duration) && duration >= 0;
    if (!knownDuration || duration >= threshold) return payload;
    if (payload.event === "http_request_completed") {
      const status = payload.httpStatus;
      if (typeof status !== "number" || !Number.isFinite(status) || status < 200 || status >= 400) return payload;
      return rate === 1 || (rate > 0 && random() < rate) ? payload : null;
    }
    if (payload.event === "image_proxy_fetch") {
      return payload.success === true && payload.attempts === 1 ? null : payload;
    }
    if (payload.event === "datastore_read") {
      return payload.success === true && !payload.fallbackReason && !payload.fallbackUsed ? null : payload;
    }
    return payload;
  };
}
