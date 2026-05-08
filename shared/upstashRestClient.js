import fetch from "node-fetch";

export function createUpstashRestClient({
  upstashRestUrl = (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/+$/, ""),
  upstashRestToken = process.env.UPSTASH_REDIS_REST_TOKEN || "",
} = {}) {
  const enabled = Boolean(upstashRestUrl && upstashRestToken);

  return {
    enabled,
    async command(args) {
      if (!enabled) {
        throw new Error("Upstash Redis is not configured");
      }

      const response = await fetch(upstashRestUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${upstashRestToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
      });
      const payload = await response.json();
      if (!response.ok || payload?.error) {
        throw new Error(payload?.error || `Upstash request failed: ${response.status}`);
      }
      return payload.result;
    },
  };
}
