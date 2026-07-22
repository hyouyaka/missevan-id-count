const SENSITIVE_FIELD_PATTERN = /(token|authorization|cookie|password|secret|proxy|ip|query|input)/i;

/**
 * @param {any} value
 * @param {string} [key]
 * @returns {any}
 */
function sanitizeValue(value, key = "") {
  if (SENSITIVE_FIELD_PATTERN.test(key)) {
    return "[REDACTED]";
  }
  if (value instanceof Error) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeValue(item, key));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 40)
        .map(([entryKey, entryValue]) => [entryKey, sanitizeValue(entryValue, entryKey)])
        .filter(([, entryValue]) => entryValue !== undefined)
    );
  }
  if (typeof value === "string" && value.length > 512) {
    return `${value.slice(0, 512)}…`;
  }
  return value ?? null;
}

/**
 * @param {string} level
 * @param {string} event
 * @param {Record<string, any>} [fields]
 * @param {(Error & { code?: unknown }) | null} [error]
 * @param {Record<string, any>} [baseFields]
 */
function createLogPayload(level, event, fields = {}, error = null, baseFields = {}) {
  const normalizedError = error instanceof Error
    ? {
        name: error.name || "Error",
        message: String(error.message || "Error").slice(0, 512),
        code: error.code || null,
        ...(process.env.NODE_ENV === "production" ? {} : { stack: error.stack || null }),
      }
    : null;

  return {
    timestamp: new Date().toISOString(),
    level,
    event,
    requestId: fields.requestId ?? baseFields.requestId ?? null,
    taskId: fields.taskId ?? baseFields.taskId ?? null,
    platform: fields.platform ?? baseFields.platform ?? null,
    route: fields.route ?? baseFields.route ?? null,
    status: fields.status ?? baseFields.status ?? null,
    durationMs: fields.durationMs ?? baseFields.durationMs ?? null,
    errorCode: fields.errorCode ?? normalizedError?.code ?? baseFields.errorCode ?? null,
    ...Object.fromEntries(
      Object.entries({ ...baseFields, ...fields })
        .filter(([key]) => ![
          "requestId",
          "taskId",
          "platform",
          "route",
          "status",
          "durationMs",
          "errorCode",
        ].includes(key))
        .map(([key, value]) => [key, sanitizeValue(value, key)])
        .filter(([, value]) => value !== undefined)
    ),
    ...(normalizedError ? { error: normalizedError } : {}),
  };
}

/** @param {Record<string, any>} [baseFields] */
export function createLogger(baseFields = {}) {
  const write = (level, event, fields, error) => {
    const payload = createLogPayload(level, event, fields, error, baseFields);
    const line = JSON.stringify(payload);
    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
  };

  return {
    info(event, fields = {}) {
      write("info", event, fields, null);
    },
    warn(event, fields = {}) {
      write("warn", event, fields, null);
    },
    error(event, error, fields = {}) {
      write("error", event, fields, error);
    },
    child(fields = {}) {
      return createLogger({ ...baseFields, ...fields });
    },
  };
}

export function createRequestLoggerMiddleware({ logger }) {
  return (req, res, next) => {
    const startedAt = Date.now();
    res.on("finish", () => {
      logger.info("http_request_completed", {
        requestId: req.requestId,
        route: req.route?.path || req.path || null,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
        method: req.method,
      });
    });
    next();
  };
}
