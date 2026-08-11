import fs from "fs/promises";
import path from "path";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export const LOG_CATEGORIES = Object.freeze({
  USER_ACTION: "user_action",
  TASK_SUMMARY: "task_summary",
  OPERATION: "operation",
});

/** @type {Set<string>} */
const LOG_CATEGORY_VALUES = new Set(Object.values(LOG_CATEGORIES));
const logContextStorage = new AsyncLocalStorage();
const EXACT_SENSITIVE_FIELDS = new Set([
  "authorization",
  "client_key",
  "cookie",
  "input",
  "ip",
  "password",
  "query",
  "secret",
  "token",
  "url",
]);
const PRIMARY_DISPLAY_FIELDS = Object.freeze([
  "dramaId",
  "dramaIds",
  "dramaName",
  "dramaTitle",
  "dramaTitles",
  "source",
  "soundId",
  "episodeTitle",
  "cvName",
  "taskType",
  "keyword",
]);

function normalizeFieldName(key) {
  return String(key || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function isSensitiveField(key) {
  const normalized = normalizeFieldName(key);
  return EXACT_SENSITIVE_FIELDS.has(normalized) ||
    normalized.endsWith("_authorization") ||
    normalized.endsWith("_cookie") ||
    normalized.endsWith("_ip") ||
    normalized.endsWith("_password") ||
    normalized.endsWith("_secret") ||
    normalized.endsWith("_token");
}

/**
 * @param {any} value
 * @param {string} [key]
 * @param {{ preserveSize?: boolean }} [options]
 * @returns {any}
 */
function sanitizeValue(value, key = "", options = {}) {
  if (isSensitiveField(key)) {
    return "[REDACTED]";
  }
  if (value instanceof Error) {
    return undefined;
  }
  if (Array.isArray(value)) {
    const items = options.preserveSize ? value : value.slice(0, 20);
    return items.map((item) => sanitizeValue(item, key, options));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    const selectedEntries = options.preserveSize ? entries : entries.slice(0, 40);
    return Object.fromEntries(
      selectedEntries
        .map(([entryKey, entryValue]) => [
          entryKey,
          sanitizeValue(entryValue, entryKey, options),
        ])
        .filter(([, entryValue]) => entryValue !== undefined)
    );
  }
  if (!options.preserveSize && typeof value === "string" && value.length > 512) {
    return `${value.slice(0, 512)}…`;
  }
  return value ?? null;
}

/** @param {(Error & { code?: unknown }) | null} error */
function normalizeError(error) {
  if (!(error instanceof Error)) {
    return null;
  }
  return {
    name: error.name || "Error",
    message: String(error.message || "Error").slice(0, 512),
    code: error.code || null,
    ...(process.env.NODE_ENV === "production" ? {} : { stack: error.stack || null }),
  };
}

/**
 * @param {{
 *   level: string,
 *   category: string,
 *   event: string,
 *   fields?: Record<string, any>,
 *   error?: Error | null,
 *   baseFields?: Record<string, any>,
 * }} options
 */
export function createLogPayload({
  level,
  category,
  event,
  fields = {},
  error = null,
  baseFields = {},
}) {
  const normalizedCategory = LOG_CATEGORY_VALUES.has(category)
    ? category
    : LOG_CATEGORIES.OPERATION;
  const normalizedEvent = String(event || "log_event").trim() || "log_event";
  const normalizedError = normalizeError(error);
  const contextFields = logContextStorage.getStore() || {};
  const mergedFields = { ...baseFields, ...contextFields, ...fields };
  const reservedKeys = new Set([
    "requestId",
    "taskId",
    "operationId",
    "platform",
    "route",
    "httpStatus",
    "outcome",
    "durationMs",
    "errorCode",
    ...PRIMARY_DISPLAY_FIELDS,
  ]);
  const primaryFields = Object.fromEntries(
    PRIMARY_DISPLAY_FIELDS
      .filter((key) => {
        const value = mergedFields[key];
        return value !== undefined && value !== null && value !== "";
      })
      .map((key) => [key, sanitizeValue(mergedFields[key], key)])
      .filter(([, value]) => value !== undefined)
  );
  const sanitizedFields = Object.fromEntries(
    Object.entries(mergedFields)
      .filter(([key]) => !reservedKeys.has(key) && key !== "category" && key !== "event" && key !== "level" && key !== "message")
      .map(([key, value]) => [
        key,
        sanitizeValue(value, key, {
          preserveSize: normalizedCategory === LOG_CATEGORIES.TASK_SUMMARY && key === "result",
        }),
      ])
      .filter(([, value]) => value !== undefined)
  );

  return {
    level,
    message: normalizedEvent,
    category: normalizedCategory,
    event: normalizedEvent,
    platform: mergedFields.platform ?? null,
    ...primaryFields,
    logSchemaVersion: 1,
    requestId: mergedFields.requestId ?? null,
    taskId: mergedFields.taskId ?? null,
    operationId: mergedFields.operationId ?? (
      normalizedCategory === LOG_CATEGORIES.OPERATION ? randomUUID() : null
    ),
    route: mergedFields.route ?? null,
    httpStatus: mergedFields.httpStatus ?? null,
    outcome: mergedFields.outcome ?? null,
    durationMs: mergedFields.durationMs ?? null,
    errorCode: mergedFields.errorCode ?? normalizedError?.code ?? null,
    ...sanitizedFields,
    ...(normalizedError ? { error: normalizedError } : {}),
    timestamp: new Date().toISOString(),
  };
}

function getLegacyUsagePath(logsDir, now = new Date()) {
  const suffix = now.toISOString().replace(/[:.]/g, "-");
  return path.join(logsDir, `usage.legacy-${suffix}.log`);
}

async function readFirstLogLine(filePath) {
  let handle;
  try {
    handle = await fs.open(filePath, "r");
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8").split(/\r?\n/, 1)[0].trim();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return "";
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

async function archiveLegacyUsageLog(logsDir, usageLogPath) {
  const firstLine = await readFirstLogLine(usageLogPath);
  if (!firstLine) {
    return;
  }
  const currentCategoryPattern = new RegExp(
    `"category"\\s*:\\s*"(?:${[...LOG_CATEGORY_VALUES].join("|")})"`
  );
  if (currentCategoryPattern.test(firstLine)) {
    return;
  }
  try {
    const payload = JSON.parse(firstLine);
    if (LOG_CATEGORY_VALUES.has(payload?.category)) {
      return;
    }
  } catch (_) {
    // A non-JSON or prefixed first line belongs to the legacy format.
  }
  await fs.rename(usageLogPath, getLegacyUsagePath(logsDir));
}

/**
 * @param {{ logsDir: string }} options
 */
export function createCategoryFileSink({ logsDir }) {
  const usageLogPath = path.join(logsDir, "usage.log");
  const operationsLogPath = path.join(logsDir, "operations.log");
  /** @type {Promise<void> | null} */
  let preparation = null;
  let writeQueue = Promise.resolve();

  function prepare() {
    if (!preparation) {
      preparation = (async () => {
        try {
          await fs.mkdir(logsDir, { recursive: true });
          await archiveLegacyUsageLog(logsDir, usageLogPath);
        } catch (error) {
          preparation = null;
          throw error;
        }
      })();
    }
    return preparation;
  }

  return {
    write(payload) {
      const filePath = payload.category === LOG_CATEGORIES.OPERATION
        ? operationsLogPath
        : payload.category === LOG_CATEGORIES.USER_ACTION || payload.category === LOG_CATEGORIES.TASK_SUMMARY
          ? usageLogPath
          : null;
      if (!filePath) {
        return Promise.resolve();
      }
      writeQueue = writeQueue
        .catch(() => {})
        .then(async () => {
          await prepare();
          await fs.appendFile(filePath, `${JSON.stringify(payload)}\n`, "utf8");
        });
      return writeQueue;
    },
  };
}

export function runWithLogContext(fields, callback) {
  const current = logContextStorage.getStore() || {};
  return logContextStorage.run({ ...current, ...fields }, callback);
}

/**
 * @param {Record<string, any>} [baseFields]
 * @param {{ sink?: { write: (payload: Record<string, any>) => Promise<void> | void } | null }} [options]
 */
export function createLogger(baseFields = {}, options = {}) {
  const sink = options.sink || null;

  /**
   * @param {{
   *   level: string,
   *   category?: string,
   *   event: string,
   *   fields?: Record<string, any>,
   *   error?: (Error & { code?: unknown }) | null,
   * }} entry
   */
  const write = ({ level, category = LOG_CATEGORIES.OPERATION, event, fields = {}, error = null }) => {
    const payload = createLogPayload({ level, category, event, fields, error, baseFields });
    const line = JSON.stringify(payload);
    if (level === "error") {
      console.error(line);
    } else {
      console.log(line);
    }
    return Promise.resolve(sink?.write(payload)).catch((sinkError) => {
      const failure = createLogPayload({
        level: "error",
        category: LOG_CATEGORIES.OPERATION,
        event: "operation_log_file_write_failed",
        error: sinkError,
        baseFields,
      });
      console.error(JSON.stringify(failure));
    });
  };

  return {
    emit(options) {
      return write(options);
    },
    info(event, fields = {}) {
      return write({ level: "info", event, fields });
    },
    warn(event, fields = {}) {
      return write({ level: "warn", event, fields });
    },
    error(event, error, fields = {}) {
      return write({ level: "error", event, fields, error });
    },
    userAction(event, fields = {}, level = "info") {
      return write({ level, category: LOG_CATEGORIES.USER_ACTION, event, fields });
    },
    taskSummary(event, fields = {}, level = "info", error = null) {
      return write({ level, category: LOG_CATEGORIES.TASK_SUMMARY, event, fields, error });
    },
    operation(event, fields = {}, level = "info", error = null) {
      return write({ level, category: LOG_CATEGORIES.OPERATION, event, fields, error });
    },
    child(fields = {}) {
      return createLogger({ ...baseFields, ...fields }, options);
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
        httpStatus: res.statusCode,
        durationMs: Date.now() - startedAt,
        method: req.method,
        success: res.statusCode < 500,
      });
    });
    runWithLogContext({ requestId: req.requestId }, next);
  };
}
