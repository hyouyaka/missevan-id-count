const EPISODE_NUMBER_PATTERN =
  "[0-9零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]+";

const MISSEVAN_MAIN_INCLUDE_PATTERNS = [
  new RegExp(`第\\s*${EPISODE_NUMBER_PATTERN}\\s*[集话期章节卷]`, "u"),
  /(?:^|\s)ep\.?\s*[0-9]+/i,
  /(?:^|\s)e[0-9]{1,3}(?:\D|$)/i,
  /番外/u,
  /ova/i,
];

const MISSEVAN_MAIN_EXCLUDE_PATTERNS = [
  /预告/u,
  /花絮/u,
  /采访/u,
  /主题曲/u,
  /片头曲/u,
  /片尾曲/u,
  /福利/u,
  /彩蛋/u,
  /PV/i,
  /CM/i,
  /OST/i,
  /OP/i,
  /ED/i,
];

const MANBO_MAIN_INCLUDE_PATTERNS = [
  /(?:^|[^\w])EP\s*0*[0-9]+/i,
  new RegExp(`第\\s*${EPISODE_NUMBER_PATTERN}\\s*[期集话章节卷]`, "u"),
  /番外/u,
];

const MANBO_MAIN_EXCLUDE_PATTERNS = [
  /预告/u,
  /花絮/u,
  /采访/u,
  /FT/i,
  /倒计时/u,
  /主题曲/u,
  /小剧场/u,
];

export function isMainEpisode(platform, episode) {
  const name = String(episode?.name || "").trim();
  const includes = platform === "manbo"
    ? MANBO_MAIN_INCLUDE_PATTERNS
    : MISSEVAN_MAIN_INCLUDE_PATTERNS;
  const excludes = platform === "manbo"
    ? MANBO_MAIN_EXCLUDE_PATTERNS
    : MISSEVAN_MAIN_EXCLUDE_PATTERNS;

  return (
    includes.some((pattern) => pattern.test(name))
    && !excludes.some((pattern) => pattern.test(name))
  );
}

export function getMissevanDanmakuCapByDurationMs(durationMs) {
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
  return 35000;
}

export function isMissevanLikelyDanmakuOverflow({ durationMs, danmaku }) {
  const expectedCap = getMissevanDanmakuCapByDurationMs(durationMs);
  return expectedCap > 0 && Number(danmaku ?? 0) === expectedCap;
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
