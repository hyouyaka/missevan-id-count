import { AsyncLocalStorage } from "node:async_hooks";

function getAbortReason(signal) {
  return signal?.reason || new DOMException("Aborted", "AbortError");
}

export function normalizeRequestConcurrency(value, fallback = 1, maximum = 64) {
  const normalizedMaximum = Math.max(1, Math.floor(Number(maximum) || 1));
  const normalizedFallback = Math.min(
    normalizedMaximum,
    Math.max(1, Math.floor(Number(fallback) || 1))
  );
  if (value == null || String(value).trim() === "") {
    return normalizedFallback;
  }
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed)
    ? Math.min(normalizedMaximum, Math.max(1, parsed))
    : normalizedFallback;
}

export function createRequestConcurrencyGate(limit) {
  const concurrency = normalizeRequestConcurrency(limit);
  const queue = [];
  let activeCount = 0;

  function pump() {
    while (activeCount < concurrency && queue.length > 0) {
      const entry = queue.shift();
      entry.signal?.removeEventListener("abort", entry.onAbort);
      if (entry.signal?.aborted) {
        entry.reject(getAbortReason(entry.signal));
        continue;
      }

      activeCount += 1;
      const release = () => {
        activeCount = Math.max(0, activeCount - 1);
        pump();
      };
      Promise.resolve()
        .then(() => entry.runInAsyncScope(entry.factory, entry.signal))
        .then(
          (value) => {
            release();
            entry.resolve(value);
          },
          (error) => {
            release();
            entry.reject(error);
          }
        );
    }
  }

  return {
    run(signal, factory) {
      if (typeof factory !== "function") {
        return Promise.reject(new TypeError("Request concurrency gate requires a factory"));
      }
      if (signal?.aborted) {
        return Promise.reject(getAbortReason(signal));
      }

      return new Promise((resolve, reject) => {
        const entry = {
          factory,
          onAbort: null,
          reject,
          resolve,
          runInAsyncScope: AsyncLocalStorage.snapshot(),
          signal,
        };
        entry.onAbort = () => {
          const index = queue.indexOf(entry);
          if (index < 0) {
            return;
          }
          queue.splice(index, 1);
          signal.removeEventListener("abort", entry.onAbort);
          reject(getAbortReason(signal));
        };
        signal?.addEventListener("abort", entry.onAbort, { once: true });
        queue.push(entry);
        pump();
      });
    },

    getState() {
      return {
        activeCount,
        concurrency,
        queuedCount: queue.length,
      };
    },
  };
}
