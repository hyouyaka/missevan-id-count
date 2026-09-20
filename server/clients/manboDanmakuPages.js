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
  if (Array.isArray(error?.failureKinds) && error.failureKinds.length > 0) {
    return error.failureKinds.every((kind) => kind === "timeout");
  }
  return error?.requestTimedOut === true ||
    error?.name === "TimeoutError" ||
    /timeout/i.test(String(error?.message || ""));
}

function collectFailureSummary(failures = []) {
  const samples = [];
  const failureKinds = new Set();
  const failedHosts = new Set();
  for (const failure of failures) {
    const error = failure?.error || failure;
    if (Array.isArray(error?.failureKinds)) {
      error.failureKinds.forEach((kind) => failureKinds.add(String(kind)));
    }
    if (Array.isArray(error?.failedHosts)) {
      error.failedHosts.forEach((host) => failedHosts.add(String(host)));
    }
    if (Array.isArray(error?.failureSamples)) {
      samples.push(...error.failureSamples);
    } else if (error?.failureKind || error?.manboFailureKind || error?.upstreamHost) {
      samples.push({
        ...(error.upstreamHost ? { upstreamHost: String(error.upstreamHost).slice(0, 120) } : {}),
        ...(error.upstreamRoute ? { upstreamRoute: String(error.upstreamRoute).slice(0, 40) } : {}),
        failureKind: String(error.failureKind || error.manboFailureKind || "network").slice(0, 40),
        ...(error.errorName ? { errorName: String(error.errorName).slice(0, 80) } : {}),
        ...(error.errorCode || error.code ? { errorCode: String(error.errorCode || error.code).slice(0, 80) } : {}),
        ...(error.errorMessage || error.message
          ? { errorMessage: String(error.errorMessage || error.message).replace(/https?:\/\/[^\s]+/gi, "[upstream-url]").slice(0, 200) }
          : {}),
        ...(Number.isFinite(Number(error.httpStatus || error.status))
          ? { httpStatus: Number(error.httpStatus || error.status) }
          : {}),
        ...(error.upstreamCode || error.manboCode
          ? { upstreamCode: String(error.upstreamCode || error.manboCode).slice(0, 80) }
          : {}),
      });
    }
  }
  const normalizedSamples = samples
    .filter((sample) => sample && typeof sample === "object")
    .map((sample) => ({
      ...(sample.upstreamHost ? { upstreamHost: String(sample.upstreamHost).slice(0, 120) } : {}),
      ...(sample.upstreamRoute ? { upstreamRoute: String(sample.upstreamRoute).slice(0, 40) } : {}),
      ...(sample.failureKind ? { failureKind: String(sample.failureKind).slice(0, 40) } : {}),
      ...(sample.errorName ? { errorName: String(sample.errorName).slice(0, 80) } : {}),
      ...(sample.errorCode ? { errorCode: String(sample.errorCode).slice(0, 80) } : {}),
      ...(sample.errorMessage
        ? { errorMessage: String(sample.errorMessage).replace(/https?:\/\/[^\s]+/gi, "[upstream-url]").slice(0, 200) }
        : {}),
      ...(Number.isFinite(Number(sample.httpStatus)) ? { httpStatus: Number(sample.httpStatus) } : {}),
      ...(sample.upstreamCode ? { upstreamCode: String(sample.upstreamCode).slice(0, 80) } : {}),
    }));
  normalizedSamples.forEach((sample) => {
    if (sample.failureKind) {
      failureKinds.add(sample.failureKind);
    }
    if (sample.upstreamHost) {
      failedHosts.add(sample.upstreamHost);
    }
  });
  return {
    failureKinds: [...failureKinds],
    failedHosts: [...failedHosts],
    failureSamples: normalizedSamples.slice(0, 3),
  };
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
    const failureSummary = collectFailureSummary(failures);
    this.failureKinds = failureSummary.failureKinds;
    this.failedHosts = failureSummary.failedHosts;
    this.failureSamples = failureSummary.failureSamples;
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
