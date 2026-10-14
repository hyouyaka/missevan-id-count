function positiveInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(maximum, Math.max(minimum, parsed))
    : fallback;
}

export function resolveRenderKeepAliveConfig({
  env = process.env, hosted = false, desktop = false, missevanEnabled = false,
  renderConfigured = false, baseUrl = "",
} = {}) {
  let healthUrl = "";
  try {
    const url = new URL("/healthz", baseUrl);
    if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) {
      healthUrl = url.href;
    }
  } catch {}
  return {
    enabled: hosted && !desktop && missevanEnabled && renderConfigured && Boolean(healthUrl)
      && !["false", "0", "off", "no"].includes(String(env.MISSEVAN_RENDER_KEEPALIVE_ENABLED ?? "true").trim().toLowerCase()),
    healthUrl,
    forceMode: String(env.MISSEVAN_FORCE_FALLBACK ?? "0").trim(),
    intervalMs: positiveInteger(env.MISSEVAN_RENDER_KEEPALIVE_INTERVAL_MS, 300_000, 60_000, 600_000),
    timeoutMs: positiveInteger(env.MISSEVAN_RENDER_KEEPALIVE_TIMEOUT_MS, 90_000, 1000, 120_000),
  };
}

export function resolveRenderKeepAliveState(config, until, now = Date.now()) {
  if (!config.enabled || config.forceMode === "2") return { active: false, until: 0 };
  if (config.forceMode === "1") return { active: true, until: Infinity };
  return { active: Number(until) > now, until: Number(until) || 0 };
}

export function createRenderKeepAliveService({
  enabled = true, healthUrl, intervalMs = 300_000, timeoutMs = 90_000,
  fetchImpl = fetch, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
  log = () => {},
} = {}) {
  let active = false;
  let disposed = false;
  let deadline = 0;
  let generation = 0;
  let nextTimer = null;
  let expiryTimer = null;
  let flight = null;
  let failing = false;

  function emit(event, fields = {}, level = "info") {
    try { void Promise.resolve(log(event, fields, level)).catch(() => {}); } catch {}
  }

  function timer(callback, delay) {
    const handle = setTimer(callback, delay);
    handle?.unref?.();
    return handle;
  }

  function stop(reason) {
    if (nextTimer !== null) clearTimer(nextTimer);
    if (expiryTimer !== null) clearTimer(expiryTimer);
    nextTimer = expiryTimer = null;
    if (!active) return;
    active = false;
    generation += 1;
    flight?.controller.abort();
    emit("render_keepalive_stopped", { reason });
  }

  function isActive() {
    if (active && now() >= deadline) stop("cooldown_expired");
    return active && !disposed;
  }

  async function ping() {
    if (!isActive() || flight) return;
    const currentGeneration = generation;
    const controller = new AbortController();
    flight = { controller };
    let timedOut = false;
    const timeout = timer(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const response = await fetchImpl(healthUrl, {
        method: "GET", signal: controller.signal, cache: "no-store", redirect: "error",
        headers: { "Cache-Control": "no-cache, no-store", Pragma: "no-cache" },
      });
      await response.body?.cancel();
      if (timedOut) throw new Error("Health request timed out");
      if (!response.ok) throw new Error(`Health request returned HTTP ${response.status}`);
      if (isActive() && generation === currentGeneration && failing) {
        failing = false;
        emit("render_keepalive_recovered");
      }
    } catch (error) {
      if (isActive() && generation === currentGeneration && !failing) {
        failing = true;
        emit("render_keepalive_failed", {
          failureKind: timedOut ? "timeout" : "request_failed",
          errorMessage: String(error?.message || error).slice(0, 200),
        }, "warn");
      }
    } finally {
      clearTimer(timeout);
      flight = null;
      if (isActive()) {
        if (generation !== currentGeneration) void ping();
        else nextTimer = timer(() => { nextTimer = null; void ping(); }, intervalMs);
      }
    }
  }

  return {
    sync({ active: requested, until = Infinity }) {
      if (disposed) return;
      if (!enabled || !requested || !(until > now())) {
        stop("inactive");
        return;
      }
      if (deadline !== until || expiryTimer === null) {
        deadline = until;
        if (expiryTimer !== null) clearTimer(expiryTimer);
        expiryTimer = Number.isFinite(until)
          ? timer(() => { expiryTimer = null; stop("cooldown_expired"); }, until - now())
          : null;
      }
      if (active) return;
      active = true;
      generation += 1;
      failing = false;
      emit("render_keepalive_started", { until: Number.isFinite(until) ? until : null });
      void ping();
    },
    dispose() {
      stop("service_closed");
      disposed = true;
    },
  };
}
