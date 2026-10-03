// Desktop calculations use platform APIs and memory only, regardless of old
// credentials left in .env or the parent process environment.
export function createRuntimePolicy(desktopApp) {
  return Object.freeze({
    desktopApp: Boolean(desktopApp),
    cloudData: !desktopApp,
    taskPersistence: !desktopApp,
    cloudProxy: !desktopApp,
  });
}

export function isRemovedDesktopEndpoint(pathname) {
  return /^\/(?:desktop\/favorites-data|favorites|cv-profile|search-suggestions|ranks|ongoing|admin|feedback|usage-log|register-new-drama-ids)(?:\/|$)/.test(pathname);
}

const DESKTOP_LOG_FIELDS = new Set([
  "level", "message", "category", "event", "logSchemaVersion", "requestId",
  "taskId", "operationId", "platform", "route", "httpStatus", "durationMs",
  "errorCode", "timestamp", "method", "service", "port", "host",
]);

export function filterDesktopLogPayload(payload) {
  if (payload.category !== "operation") return null;
  // Allow only diagnostic metadata; upstream messages and traces can contain
  // a query, a share link, or complete result data.
  const safe = Object.fromEntries(Object.entries(payload).filter(([key]) => DESKTOP_LOG_FIELDS.has(key)));
  if (payload.error) safe.error = { name: payload.error.name, code: payload.error.code ?? null };
  return safe;
}
