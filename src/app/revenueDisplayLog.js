export function createRevenueDisplayReporter(send) {
  const reported = new Set();
  return async ({ taskId, platform, paidCoefficient }) => {
    if (!taskId || reported.has(taskId)) return;
    reported.add(taskId);
    // Capture the first render's value. Retries must never read the live slider.
    const payload = { action: "stats_task_displayed", taskId, platform, paidCoefficient };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await send(payload);
        return;
      } catch (error) {
        if (attempt === 2) console.error("Failed to log displayed revenue", error);
      }
    }
  };
}
