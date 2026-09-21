import { formatPlainNumber } from "./app-utils.js";

const SEARCH_CARD_METRIC_DEFINITIONS = {
  missevan: [
    { field: "view_count", label: "总播放量" },
    { field: "subscription_num", label: "追剧人数" },
    { field: "reward_num", label: "打赏人数" },
  ],
  manbo: [
    { field: "view_count", label: "总播放量" },
    { field: "subscription_num", label: "收藏数" },
    { field: "diamond_value", label: "投喂总数" },
  ],
};

function normalizeSearchCardPlatform(platform) {
  return platform === "manbo" ? "manbo" : "missevan";
}

export function getSearchCardMetricStatus(item) {
  return String(item?.metrics_status || "pending");
}

export function getSearchCardMetricDefinitions(platform, item = {}) {
  const normalizedPlatform = normalizeSearchCardPlatform(platform);
  const definitions = SEARCH_CARD_METRIC_DEFINITIONS[normalizedPlatform].map((metric) => ({ ...metric }));

  if (normalizedPlatform !== "manbo") {
    return definitions;
  }

  if (item?.is_member) {
    definitions.splice(2, 0, { field: "member_listen_count", label: "收听人数" });
  } else if (item?.revenue_type !== "episode") {
    definitions.splice(2, 0, { field: "pay_count", label: "付费人数" });
  }
  return definitions;
}

export function isValidSearchCardMetricNumber(value) {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    return false;
  }
  if (typeof value !== "number" && typeof value !== "string") {
    return false;
  }
  return Number.isFinite(Number(value));
}

function buildUniformMetricDisplay(definitions, value, loading = false) {
  return definitions.map(({ label }) => ({
    label,
    value,
    loading,
    failed: false,
  }));
}

function shouldHideReadySearchCardMetric(field, value) {
  return (
    (field === "pay_count" || field === "member_listen_count")
    && isValidSearchCardMetricNumber(value)
    && Number(value) === 0
  );
}

export function buildSearchCardMetricDisplay(platform, item = {}) {
  const status = getSearchCardMetricStatus(item);
  const definitions = getSearchCardMetricDefinitions(platform, item);

  if (status === "pending" || status === "loading") {
    return buildUniformMetricDisplay(definitions, "正在获取", true);
  }
  if (status === "access_denied") {
    return buildUniformMetricDisplay(definitions, "暂不可用");
  }
  if (status !== "ready") {
    return buildUniformMetricDisplay(definitions, "获取失败");
  }

  return definitions.flatMap(({ field, label }) => {
    const value = item?.[field];
    if (shouldHideReadySearchCardMetric(field, value)) {
      return [];
    }
    const valid = isValidSearchCardMetricNumber(value);
    return [{
      label,
      value: valid ? formatPlainNumber(value) : "获取失败",
      loading: false,
      failed: !valid,
    }];
  });
}

export function hasSearchCardMetricFailure(platform, item = {}) {
  const status = getSearchCardMetricStatus(item);
  if (status === "error" || status === "access_denied") {
    return true;
  }
  return status === "ready" && buildSearchCardMetricDisplay(platform, item).some((metric) => metric.failed);
}
