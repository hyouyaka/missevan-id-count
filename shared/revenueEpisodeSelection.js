import { resolveMissevanRevenueType } from "./missevanRevenueUtils.js";

function isManboRevenueMemberDrama(info) {
  const drama = info?.drama || {};
  const episodes = Array.isArray(info?.episodes?.episode) ? info.episodes.episode : [];
  const hasVipMarker = [info, drama, ...episodes].some((item) => Number(item?.vipFree ?? item?.vip_free ?? 0) === 1);
  return Number(drama.pay_type ?? 0) === 0
    && Number(drama.price ?? 0) === 0
    && Number(drama.member_price ?? 0) === 0
    && hasVipMarker;
}

export function getManboRevenueType(info, isMemberDramaInfo = isManboRevenueMemberDrama) {
  const drama = info?.drama || {};
  const episodes = Array.isArray(info?.episodes?.episode) ? info.episodes.episode : [];
  if (isMemberDramaInfo(info)) return "member";
  const hasEpisodePricing = Number(drama.pay_type ?? 0) !== 1
    && (Number(drama.price ?? 0) > 0 || Number(drama.member_price ?? 0) > 0);
  if (Number(drama.pay_type ?? 0) !== 1
    && (episodes.some((episode) => Number(episode?.price ?? 0) > 0) || hasEpisodePricing)) return "episode";
  return Number(drama.pay_type ?? 0) === 1 ? "season" : "unknown";
}

export function getRevenueEpisodesForDrama(platform, info, options = {}) {
  const drama = info?.drama || {};
  const episodes = Array.isArray(info?.episodes?.episode) ? info.episodes.episode : [];
  if (platform === "manbo") {
    const revenueType = options.revenueType ?? getManboRevenueType(info);
    if (revenueType === "member") return episodes.filter((episode) => Number(episode?.vip_free ?? 0) === 1);
    if (revenueType === "season") return episodes.filter((episode) => Number(episode?.pay_type ?? 0) === 1);
    if (revenueType === "episode") return episodes.filter((episode) => Number(episode?.price ?? 0) > 0);
    return [];
  }
  const revenueType = options.revenueType ?? resolveMissevanRevenueType({
    payTypeRaw: drama.pay_type ?? drama.payType,
    vip: drama.vip,
    isMember: Boolean(drama.is_member) || Number(drama.vip ?? 0) === 1,
  }).revenueType;
  return revenueType === "reward_only" ? []
    : episodes.filter((episode) => Number(episode?.need_pay ?? 0) === 1 || Number(episode?.price ?? 0) > 0);
}
