function getAbortReason(signal) {
  return signal?.reason || new DOMException("Aborted", "AbortError");
}

function waitForSharedEntry(entry, signal, onIdle) {
  if (signal?.aborted) {
    return Promise.reject(getAbortReason(signal));
  }

  entry.waiters += 1;
  return new Promise((resolve, reject) => {
    let released = false;

    function release() {
      if (released) {
        return;
      }
      released = true;
      entry.waiters = Math.max(0, entry.waiters - 1);
      if (entry.waiters === 0 && !entry.settled) {
        onIdle?.();
        entry.controller.abort(getAbortReason(signal));
      }
    }

    function cleanup() {
      signal?.removeEventListener("abort", onAbort);
      release();
    }

    function onAbort() {
      cleanup();
      reject(getAbortReason(signal));
    }

    signal?.addEventListener("abort", onAbort, { once: true });
    entry.promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      }
    );
  });
}

export function createSharedRequestRegistry() {
  const entries = new Map();

  return {
    run(key, signal, factory) {
      if (typeof factory !== "function") {
        throw new TypeError("Shared request registry requires a factory");
      }
      if (signal?.aborted) {
        return Promise.reject(getAbortReason(signal));
      }

      const normalizedKey = String(key);
      let entry = entries.get(normalizedKey);
      if (!entry) {
        const controller = new AbortController();
        entry = {
          controller,
          promise: null,
          settled: false,
          waiters: 0,
        };
        try {
          entry.promise = Promise.resolve(factory(controller.signal));
        } catch (error) {
          entry.promise = Promise.reject(error);
        }
        entries.set(normalizedKey, entry);
        void entry.promise
          .finally(() => {
            entry.settled = true;
            if (entries.get(normalizedKey) === entry) {
              entries.delete(normalizedKey);
            }
          })
          .catch(() => {});
      }

      return waitForSharedEntry(entry, signal, () => {
        if (entries.get(normalizedKey) === entry) {
          entries.delete(normalizedKey);
        }
      });
    },
  };
}
