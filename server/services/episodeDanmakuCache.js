import { createSharedRequestRegistry } from "../clients/sharedRequest.js";

// Cache only episode data; caller titles, task sources and logs remain per call.
export function createEpisodeDanmakuCache({ cache, now = Date.now }) {
  const requests = createSharedRequestRegistry();
  return {
    async get(id, { signal, load, log }) {
      const key = String(id);
      let sharedWait = false;
      let diagnostics = {};
      try {
        if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
        const hit = cache.get(key);
        let result;
        if (hit) {
          result = { ...hit, cached: true };
        } else {
          sharedWait = requests.has(key);
          result = await requests.run(key, signal, async (sharedSignal) => {
            const loaded = await load(sharedSignal, (fields) => { diagnostics = fields; });
            const summary = {
              success: loaded.success,
              sound_id: loaded.sound_id,
              danmaku: loaded.danmaku,
              users: loaded.users,
              accessDenied: loaded.accessDenied,
              error: loaded.error,
              ...(loaded.cancelled ? { cancelled: true } : {}),
              ...(loaded.success ? { fetchedAt: new Date(now()).toISOString() } : {}),
            };
            if (summary.success && !sharedSignal.aborted) cache.set(key, summary);
            return summary;
          });
          result = { ...result, cached: false };
        }
        const callerIndependent = Object.fromEntries(Object.entries(diagnostics).filter(
          ([field]) => !["platform", "action", "soundId", "dramaTitle", "episodeTitle", "source", "users"].includes(field)
        ));
        void log({
          ...callerIndependent,
          success: Boolean(result.success),
          danmaku: Number(result.danmaku ?? 0),
          userCount: Array.isArray(result.users) ? result.users.length : 0,
          accessDenied: Boolean(result.accessDenied),
          cached: result.cached,
          sharedWait,
          fetchedAt: result.fetchedAt || null,
          cacheAgeMs: result.fetchedAt ? Math.max(0, now() - Date.parse(result.fetchedAt)) : null,
          cacheEntries: cache.size,
          ...(!result.success ? {
            status: callerIndependent.status || (result.cancelled ? "cancelled" : "failed"),
            ...(result.cancelled ? { cancelled: true } : {}),
          } : {}),
          ...(result.error ? { error: result.error } : {}),
        });
        return result;
      } catch (error) {
        void log({
          success: false,
          cached: false,
          sharedWait,
          fetchedAt: null,
          cacheAgeMs: null,
          cacheEntries: cache.size,
          cancelled: Boolean(signal?.aborted),
          status: signal?.aborted ? "cancelled" : "failed",
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  };
}
