class PlatformClientError extends Error {
  constructor(message, { code = "PLATFORM_REQUEST_FAILED", status = 0, cause } = {}) {
    super(message, { cause });
    this.name = "PlatformClientError";
    this.code = code;
    this.status = status;
  }
}

export function normalizePlatformClientError(error) {
  if (error instanceof PlatformClientError) {
    return error;
  }
  const status = Number(error?.status ?? error?.response?.status ?? 0);
  const code = error?.name === "AbortError"
    ? "REQUEST_ABORTED"
    : status === 401 || status === 403
      ? "ACCESS_DENIED"
      : status >= 500
        ? "UPSTREAM_UNAVAILABLE"
        : "PLATFORM_REQUEST_FAILED";
  return new PlatformClientError(String(error?.message || "Platform request failed"), {
    code,
    status,
    cause: error,
  });
}
