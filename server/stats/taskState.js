export const TERMINAL_TASK_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
]);

export const VALID_TASK_STATUSES = new Set([
  "queued",
  "running",
  ...TERMINAL_TASK_STATUSES,
]);

const ALLOWED_TRANSITIONS = {
  queued: new Set(["running", "cancelled", "failed"]),
  running: new Set(["completed", "cancelled", "failed"]),
};

function applyPatch(task, patch = {}) {
  const { status: _status, ...safePatch } = patch || {};
  Object.assign(task, safePatch);
}

export function transitionTask(task, nextStatus, patch = {}) {
  const currentStatus = String(task?.status ?? "");
  if (!ALLOWED_TRANSITIONS[currentStatus]?.has(nextStatus)) {
    return false;
  }
  applyPatch(task, patch);
  task.status = nextStatus;
  return true;
}

export function applyTaskProgress(task, patch = {}) {
  if (!task || TERMINAL_TASK_STATUSES.has(task.status)) {
    return false;
  }
  applyPatch(task, patch);
  return true;
}

export function mergeCancelledTaskResult(task, patch = {}) {
  if (!task || task.status !== "cancelled") {
    return false;
  }
  applyPatch(task, patch);
  task.resultIncomplete = task.result != null;
  return true;
}
