import { buildCvSeriesIndex } from "../../shared/cvSeriesUtils.js";

export function createCvSeriesStore({ readSnapshot, ttlMs, onUpdate = () => {}, onError = () => {} }) {
  let index = new Map();
  let checkedAt = null;
  let pending = null;
  return {
    get index() { return index; },
    async read({ force = false, now = Date.now() } = {}) {
      if (pending) return pending;
      if (!force && checkedAt !== null && now - checkedAt < ttlMs) return index;
      pending = (async () => {
        try {
          const snapshot = await readSnapshot();
          if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new Error("Series snapshot is unavailable");
          index = buildCvSeriesIndex(snapshot);
          onUpdate();
        } catch (error) {
          onError(error);
        } finally {
          checkedAt = now;
        }
        return index;
      })();
      try { return await pending; } finally { pending = null; }
    },
  };
}
