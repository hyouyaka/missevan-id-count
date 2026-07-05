import fetch from "node-fetch";

export function createUpstashRestClient({
  upstashRestUrl = (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/+$/, ""),
  upstashRestToken = process.env.UPSTASH_REDIS_REST_TOKEN || "",
  fetchImpl = fetch,
} = {}) {
  const enabled = Boolean(upstashRestUrl && upstashRestToken);

  return {
    enabled,
    async command(args, options = {}) {
      if (!enabled) {
        throw new Error("Upstash Redis is not configured");
      }

      const timeoutMs = Math.max(0, Number(options.timeoutMs ?? 0) || 0);
      const controller = timeoutMs > 0 ? new AbortController() : null;
      const timer = controller
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null;
      timer?.unref?.();

      try {
        const response = await fetchImpl(upstashRestUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${upstashRestToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(args),
          signal: controller?.signal,
        });
        const payload = await response.json();
        if (!response.ok || payload?.error) {
          throw new Error(payload?.error || `Upstash request failed: ${response.status}`);
        }
        return payload.result;
      } catch (error) {
        if (controller?.signal.aborted) {
          throw new Error(`Upstash request timed out after ${timeoutMs}ms`);
        }
        throw error;
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }
    },
  };
}
