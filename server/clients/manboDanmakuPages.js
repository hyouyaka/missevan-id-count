function getAbortReason(signal) {
  return signal?.reason || new DOMException("Aborted", "AbortError");
}

function normalizeConcurrency(value, fallback) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function runSettled(items, concurrency, signal, worker) {
  const queue = Array.isArray(items) ? items : [];
  const failures = [];
  let nextIndex = 0;
  const runners = Array.from(
    { length: Math.min(normalizeConcurrency(concurrency, 1), queue.length) },
    async () => {
      while (nextIndex < queue.length && !signal?.aborted) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        const item = queue[currentIndex];
        try {
          await worker(item);
        } catch (error) {
          failures.push({ error, item });
        }
      }
    }
  );
  await Promise.all(runners);
  if (signal?.aborted) {
    throw getAbortReason(signal);
  }
  return failures;
}

function isTimeoutError(error) {
  return error?.requestTimedOut === true ||
    error?.name === "TimeoutError" ||
    /timeout/i.test(String(error?.message || ""));
}

export class ManboDanmakuPageBatchError extends Error {
  constructor(failures, { rescuedPageCount = 0 } = {}) {
    const failedPages = failures.map(({ item }) => Number(item));
    super(`Manbo danmaku pages failed: ${failedPages.join(", ")}`);
    this.name = "ManboDanmakuPageBatchError";
    this.failedPages = failedPages;
    this.failedPageCount = failedPages.length;
    this.rescueAttempted = true;
    this.rescuedPageCount = rescuedPageCount;
    this.outcome = failures.every(({ error }) => isTimeoutError(error)) ? "timeout" : "error";
    this.cause = failures[0]?.error;
  }
}

export async function fetchRequiredManboDanmakuPages({
  fetchPage,
  onPage,
  pageNumbers,
  primaryConcurrency,
  rescueConcurrency = 2,
  signal,
}) {
  if (typeof fetchPage !== "function") {
    throw new TypeError("Manbo danmaku pagination requires fetchPage");
  }
  const pages = Array.from(new Set(
    (Array.isArray(pageNumbers) ? pageNumbers : [])
      .map((pageNo) => Number(pageNo))
      .filter((pageNo) => Number.isInteger(pageNo) && pageNo > 0)
  ));
  let rescuedPageCount = 0;
  const acceptPage = async (pageNo, phase) => {
    const data = await fetchPage(pageNo, phase);
    await onPage?.(pageNo, data, phase);
  };

  const primaryFailures = await runSettled(
    pages,
    primaryConcurrency,
    signal,
    (pageNo) => acceptPage(pageNo, "primary")
  );
  if (primaryFailures.length === 0) {
    return {
      rescueAttempted: false,
      rescuedPageCount: 0,
    };
  }

  const failedPages = primaryFailures.map(({ item }) => item);
  const rescueFailures = await runSettled(
    failedPages,
    rescueConcurrency,
    signal,
    async (pageNo) => {
      await acceptPage(pageNo, "rescue");
      rescuedPageCount += 1;
    }
  );
  if (rescueFailures.length > 0) {
    throw new ManboDanmakuPageBatchError(rescueFailures, { rescuedPageCount });
  }
  return {
    rescueAttempted: true,
    rescuedPageCount,
  };
}
