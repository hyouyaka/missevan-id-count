function getMissevanDanmakuCapByDurationMs(durationMs) {
  const normalizedDuration = Number(durationMs ?? 0);
  if (!Number.isFinite(normalizedDuration) || normalizedDuration <= 0) {
    return 0;
  }

  const minuteMs = 60 * 1000;
  if (normalizedDuration <= minuteMs) {
    return 500;
  }
  if (normalizedDuration <= 3 * minuteMs) {
    return 2500;
  }
  if (normalizedDuration <= 10 * minuteMs) {
    return 8500;
  }
  if (normalizedDuration <= 25 * minuteMs) {
    return 12000;
  }
  if (normalizedDuration <= 40 * minuteMs) {
    return 25000;
  }
  if (normalizedDuration <= 60 * minuteMs) {
    return 35000;
  }
  return 50000;
}

export function isMissevanLikelyDanmakuOverflow({ durationMs, danmaku }) {
  const expectedCap = getMissevanDanmakuCapByDurationMs(durationMs);
  return expectedCap > 0 && Number(danmaku ?? 0) === expectedCap;
}

export function orderDetectedOverflowEpisodeKeys(detectedKeys = [], orderedKeys = []) {
  const detected = Array.from(
    new Set(
      (Array.isArray(detectedKeys) ? detectedKeys : [])
        .map((key) => String(key ?? "").trim())
        .filter(Boolean)
    )
  );
  if (detected.length < 2) {
    return detected;
  }

  const detectedSet = new Set(detected);
  const emitted = new Set();
  const ordered = [];

  (Array.isArray(orderedKeys) ? orderedKeys : []).forEach((key) => {
    const normalizedKey = String(key ?? "").trim();
    if (!normalizedKey || !detectedSet.has(normalizedKey) || emitted.has(normalizedKey)) {
      return;
    }
    emitted.add(normalizedKey);
    ordered.push(normalizedKey);
  });

  detected.forEach((key) => {
    if (!emitted.has(key)) {
      emitted.add(key);
      ordered.push(key);
    }
  });

  return ordered;
}

export function isPaidEpisode(platform, episode) {
  if (platform === "manbo") {
    return Number(episode?.pay_type ?? 0) === 1 || Number(episode?.price ?? 0) > 0;
  }

  return (
    episode?.need_pay === true
    || episode?.need_pay === 1
    || episode?.need_pay === "1"
    || Number(episode?.price ?? 0) > 0
  );
}

export function isMemberEpisode(platform, episode) {
  if (platform === "manbo") {
    return Number(episode?.vip_free ?? 0) === 1;
  }

  return (
    episode?.vip_free === true
    || episode?.vip_free === 1
    || episode?.vip_free === "1"
  );
}
