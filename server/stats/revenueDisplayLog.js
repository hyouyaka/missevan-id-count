import { applyPaidCoefficient, normalizePaidCoefficient } from "../../shared/paidCoefficient.js";
import { aggregateRevenueFinancials } from "../../shared/revenueSummaryUtils.js";

export function shouldDeferRevenueLog(snapshot) {
  return snapshot?.logOnFirstDisplay === true && snapshot.taskType === "revenue"
    && ["completed", "cancelled"].includes(snapshot.status)
    && Boolean(snapshot.result?.revenueResults?.some((item) => !item.failed));
}

export function buildRevenueDisplayLog(snapshot, payload) {
  if (!shouldDeferRevenueLog(snapshot) || snapshot.platform !== payload.platform
    || !["completed", "cancelled", "failed"].includes(snapshot.status)
    || !snapshot.result?.revenueResults?.length) return null;
  const coefficient = payload.paidCoefficient;
  const options = snapshot.platform === "manbo" ? { max: Number.MAX_SAFE_INTEGER, allowDecimal: true } : {};
  if (typeof coefficient !== "number" || normalizePaidCoefficient(coefficient, options) !== coefficient) return null;
  const revenueResults = snapshot.result.revenueResults.map((result) => applyPaidCoefficient(result, coefficient));
  const revenueSummary = {
    ...snapshot.result.revenueSummary,
    ...aggregateRevenueFinancials(revenueResults, snapshot.platform),
  };
  return {
    action: "calculate",
    taskId: snapshot.taskId,
    taskType: "revenue",
    platform: snapshot.platform,
    source: snapshot.source,
    status: snapshot.status,
    success: snapshot.status === "completed" && !snapshot.accessDenied && !snapshot.failedCount && !revenueResults.some((result) => result.failed),
    revenueStage: "first_display",
    requestedPaidCoefficient: coefficient,
    paidCoefficient: coefficient,
    result: { ...snapshot.result, revenueResults, revenueSummary },
  };
}

export function createRevenueDisplayLogRecorder({ getSnapshot, writeLog, buildCompletedLog = () => ({}) }) {
  const recorded = new Map();
  return async (payload) => {
    if (typeof payload.taskId !== "string" || !payload.taskId || payload.taskId.length > 100) return false;
    const snapshot = getSnapshot(payload.taskId);
    const entry = buildRevenueDisplayLog(snapshot, payload);
    if (!entry) return false;
    for (const taskId of recorded.keys()) {
      if (!getSnapshot(taskId)) recorded.delete(taskId);
    }
    if (!recorded.has(payload.taskId)) {
      // Reserve before writing so concurrent deliveries cannot duplicate the event.
      const pending = Promise.resolve().then(() => writeLog({
        ...buildCompletedLog({ ...snapshot, result: entry.result }),
        ...entry,
      }));
      recorded.set(payload.taskId, pending);
      pending.catch(() => { recorded.delete(payload.taskId); });
    }
    await recorded.get(payload.taskId);
    return true;
  };
}
