export function captureSeriesScrollAnchor(target) {
  if (!(target instanceof Element)) return null;
  const element = target.closest("button, a, input, select, textarea, [role='button']") || target;
  if (element === document.body || element === document.documentElement) return null;
  const top = element.getBoundingClientRect().top;
  const containers = [];
  for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    if (parent.scrollHeight > parent.clientHeight && /auto|scroll/.test(getComputedStyle(parent).overflowY)) {
      containers.push({ element: parent, offset: top - parent.getBoundingClientRect().top });
    }
  }
  return { element, top, containers };
}

export function restoreSeriesScrollAnchor(anchor) {
  if (!anchor?.element.isConnected) return;
  // Restore inner scrolling first, then compensate any remaining page movement.
  for (const container of anchor.containers) {
    if (!container.element.isConnected) continue;
    const offset = anchor.element.getBoundingClientRect().top - container.element.getBoundingClientRect().top;
    const delta = offset - container.offset;
    if (Math.abs(delta) > 0.5) container.element.scrollBy({ top: delta, left: 0, behavior: "instant" });
  }
  const delta = anchor.element.getBoundingClientRect().top - anchor.top;
  if (Math.abs(delta) > 0.5) window.scrollBy({ top: delta, left: 0, behavior: "instant" });
}
