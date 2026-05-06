import fs from "fs/promises";
import cors from "cors";
import express from "express";
import fetch from "node-fetch";
import https from "https";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import {
  createManboIndexStore,
  createUpstashRestClient,
  normalizeManboIndexName,
} from "./manboIndexStore.js";
import { loadLocalEnv } from "./envConfig.js";
import { isMissevanLikelyDanmakuOverflow } from "./shared/episodeRules.js";
import {
  buildOngoingResponse,
  normalizeOngoingIdList,
} from "./shared/ongoingUtils.js";
import {
  buildPeakSeriesTrendResponse,
  buildRankTrendResponse,
  getPeakSeriesDailyViewDelta,
  normalizeRankTrendDates,
} from "./shared/ranksTrendUtils.js";
import { normalizeVersion } from "./shared/versionUtils.js";

const require = createRequire(import.meta.url);
const packageJson = require("./package.json");
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const desktopPackagedApp = process.env.DESKTOP_PACKAGED_APP === "true";
await loadLocalEnv({
  desktopApp: process.env.DESKTOP_APP === "true",
  projectRoot: desktopPackagedApp ? "" : __dirname,
  appDataDir: process.env.APP_DATA_DIR || "",
  exeDir: process.env.DESKTOP_EXE_DIR || "",
});

const app = express();
const defaultPort = Number(process.env.PORT) || 3000;
const appDataDir = process.env.APP_DATA_DIR
  ? path.resolve(process.env.APP_DATA_DIR)
  : __dirname;
const logsDir = path.join(appDataDir, "logs");
const runtimeDir = path.join(appDataDir, "runtime");
const usageLogPath = path.join(logsDir, "usage.log");
const APP_VERSION = String(packageJson.version || "0.0.0").trim() || "0.0.0";
const JSON_BODY_LIMIT = String(process.env.JSON_BODY_LIMIT || "1mb").trim() || "1mb";
const MISSEVAN_ENABLED = process.env.ENABLE_MISSEVAN !== "false";
const DESKTOP_APP = process.env.DESKTOP_APP === "true";
const MISSEVAN_COOLDOWN_HOURS = Math.max(
  1,
  Number(process.env.MISSEVAN_COOLDOWN_HOURS ?? 4) || 4
);
const MISSEVAN_REPEAT_COOLDOWN_HOURS = 1;
const MISSEVAN_DESKTOP_APP_URL = String(
  process.env.MISSEVAN_DESKTOP_APP_URL || ""
).trim();
const FEATURE_SUGGESTION_URL = String(
  process.env.FEATURE_SUGGESTION_URL || ""
).trim();
const MISSEVAN_COOLDOWN_KEY = String(
  process.env.MISSEVAN_COOLDOWN_KEY || "missevan:cooldown:v1"
).trim() || "missevan:cooldown:v1";
const LANDING_REGION_COOLDOWN_KEYS = Object.freeze([
  {
    key: "area1",
    label: "节点1",
    cooldownKey: "missevan:cooldown:render:area1",
  },
  {
    key: "area2",
    label: "节点2",
    cooldownKey: "missevan:cooldown:render:area2",
  },
  {
    key: "area3",
    label: "节点3",
    cooldownKey: "missevan:cooldown:render:area3",
  },
]);
const MISSEVAN_COOLDOWN_MS = MISSEVAN_COOLDOWN_HOURS * 60 * 60 * 1000;
const MISSEVAN_REPEAT_COOLDOWN_MS =
  MISSEVAN_REPEAT_COOLDOWN_HOURS * 60 * 60 * 1000;

const MANBO_API_BASE = "https://www.kilamanbo.com/web_manbo";
const MANBO_API_V530_BASE = "https://api.kilamanbo.com/api/v530/radio/drama";
const MANBO_API_HOST = "www.kilamanbo.com";
const MANBO_INFO_KEY = "manbo:info:v1";
const MISSEVAN_INFO_KEY = "missevan:info:v1";
const NEW_DRAMA_IDS_KEY = "new:dramaIDs";
const RANKS_KEY = "ranks:latest";
const RANKS_INDEX_KEY = "ranks:index";
const MISSEVAN_PEAK_SERIES_TREND_KEY = "ranks:trend:peak:missevan";
const ONGOING_KEY_PREFIX = "ongoing";
const INFO_STORE_SYNC_INTERVAL_MS = Math.max(
  5000,
  Number(process.env.INFO_STORE_SYNC_INTERVAL_MS ?? 30000) || 30000
);
const MANBO_INFO_FALLBACK_PATH = path.join(runtimeDir, "manbo-drama-info.json");
const MISSEVAN_INFO_FALLBACK_PATH = path.join(runtimeDir, "missevan-drama-info.json");
const NEW_DRAMA_IDS_FALLBACK_PATH = path.join(runtimeDir, "new-drama-ids.json");

const danmakuCache = new Map();
const dramaCache = new Map();
const soundSummaryCache = new Map();
const rewardSummaryCache = new Map();
const rewardDetailCache = new Map();
const missevanSearchApiCache = new Map();
const manboDramaCache = new Map();
const manboSetCache = new Map();
const manboSetV530Cache = new Map();
const manboDanmakuCache = new Map();
const manboDanmakuInFlight = new Map();
const manboStatsTaskStore = new Map();
const manboIndexStore = createManboIndexStore({ runtimeDir });
const upstashClient = createUpstashRestClient();
const manboInfoStore = {
  platform: "manbo",
  key: MANBO_INFO_KEY,
  fallbackPath: MANBO_INFO_FALLBACK_PATH,
  snapshot: null,
  records: [],
  byDramaId: new Map(),
  loaded: false,
  remoteAvailable: false,
  lastLoadedAt: 0,
  loadPromise: null,
};
const missevanInfoStore = {
  platform: "missevan",
  key: MISSEVAN_INFO_KEY,
  fallbackPath: MISSEVAN_INFO_FALLBACK_PATH,
  snapshot: null,
  records: [],
  byDramaId: new Map(),
  loaded: false,
  remoteAvailable: false,
  lastLoadedAt: 0,
  loadPromise: null,
};
const newDramaIdsStore = {
  key: NEW_DRAMA_IDS_KEY,
  fallbackPath: NEW_DRAMA_IDS_FALLBACK_PATH,
  snapshot: null,
  loaded: false,
  loadPromise: null,
  writePromise: Promise.resolve(),
};
const ranksCache = {
  response: null,
  loadedAt: 0,
  loadPromise: null,
};
const rankTrendsCache = new Map();
const ongoingCache = new Map();
const RANKS_RESPONSE_SCHEMA_VERSION = 3;
const RANK_TRENDS_RESPONSE_SCHEMA_VERSION = 4;
const ONGOING_RESPONSE_SCHEMA_VERSION = 3;

function getFiniteNumberEnv(name, fallbackValue) {
  const rawValue = process.env[name];
  if (rawValue == null || rawValue === "") {
    return fallbackValue;
  }
  const normalizedValue = Number(rawValue);
  return Number.isFinite(normalizedValue) ? normalizedValue : fallbackValue;
}

const DRAMA_CACHE_TTL_MS = 30 * 60 * 1000;
const SOUND_SUMMARY_CACHE_TTL_MS = 30 * 60 * 1000;
const REWARD_SUMMARY_CACHE_TTL_MS = 30 * 60 * 1000;
const REWARD_DETAIL_CACHE_TTL_MS = 30 * 60 * 1000;
const MISSEVAN_SEARCH_API_CACHE_TTL_MS = 10 * 60 * 1000;
const MANBO_DRAMA_CACHE_TTL_MS = 30 * 60 * 1000;
const MANBO_SET_CACHE_TTL_MS = 30 * 60 * 1000;
const MANBO_DANMAKU_CACHE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MANBO_STATS_TASK_TTL_MS = isHostedDeployment()
  ? 15 * 60 * 1000
  : 60 * 60 * 1000;
const MANBO_STATS_TASK_TTL_MS = Math.max(
  60 * 1000,
  getFiniteNumberEnv("MANBO_STATS_TASK_TTL_MS", DEFAULT_MANBO_STATS_TASK_TTL_MS)
);
const MANBO_STATS_TASK_HEARTBEAT_TIMEOUT_MS = 5 * 60 * 1000;
const MANBO_DANMAKU_CACHE_MAX_ENTRIES = Math.max(
  0,
  Math.floor(
    getFiniteNumberEnv(
      "MANBO_DANMAKU_CACHE_MAX_ENTRIES",
      isHostedDeployment() ? 20 : 200
    )
  )
);
const RANKS_CACHE_TTL_MS = Math.max(
  60 * 1000,
  Number(process.env.RANKS_CACHE_TTL_MS ?? 30 * 60 * 1000) || 30 * 60 * 1000
);
const ONGOING_CACHE_TTL_MS = Math.max(
  10 * 1000,
  Number(process.env.ONGOING_CACHE_TTL_MS ?? 60 * 1000) || 60 * 1000
);
const MANBO_DANMAKU_PAGE_CONCURRENCY = Math.max(
  1,
  Number(process.env.MANBO_DANMAKU_PAGE_CONCURRENCY ?? 12) || 12
);
const MANBO_STATS_EPISODE_CONCURRENCY = Math.max(
  1,
  Number(process.env.MANBO_STATS_EPISODE_CONCURRENCY ?? 4) || 4
);
const MANBO_FETCH_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.MANBO_FETCH_TIMEOUT_MS ?? 10000) || 10000
);
const manboHttpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: Math.max(
    8,
    MANBO_DANMAKU_PAGE_CONCURRENCY * MANBO_STATS_EPISODE_CONCURRENCY * 2
  ),
});

let accessDeniedUntil = 0;
let accessDeniedUseShortCooldown = false;
let accessDeniedCooldownMode = "none";
let cooldownStateLoaded = false;
let cooldownPersistenceWarningLogged = false;
let cooldownRefreshPromise = null;
let lastCooldownRefreshAt = 0;
let lastCooldownRefreshSucceeded = false;

app.use(cors());
app.use(express.json({ limit: JSON_BODY_LIMIT }));

app.use((error, req, res, next) => {
  if (error?.type !== "entity.too.large") {
    return next(error);
  }

  console.error("Request payload too large", {
    method: req.method,
    url: req.originalUrl || req.url,
    contentLength: req.get("content-length") || "",
    limit: JSON_BODY_LIMIT,
  });

  return res.status(413).json({
    success: false,
    message: "Request payload too large",
  });
});

function getFrontendVersionFromRequest(req) {
  return normalizeVersion(
    req.query?.frontendVersion
      ?? req.headers["x-frontend-version"]
      ?? "0.0.0"
  );
}

app.use((req, res, next) => {
  res.setHeader("X-Backend-Version", APP_VERSION);
  next();
});

app.get("/app-config", (req, res) => {
  const frontendVersion = getFrontendVersionFromRequest(req);
  res.json({
    missevanEnabled: MISSEVAN_ENABLED,
    desktopApp: DESKTOP_APP,
    hostedDeployment: isHostedDeployment(),
    brandName: MISSEVAN_ENABLED ? "M&M Toolkit" : "Manbo Toolkit",
    titleZh: MISSEVAN_ENABLED ? "小猫小狐数据分析" : "小狐分析",
    description: MISSEVAN_ENABLED
      ? "支持 Missevan 与 Manbo 的作品导入、分集筛选、弹幕统计和数据汇总。"
      : "支持 Manbo 平台的作品导入、分集筛选、弹幕统计和去重 ID 汇总。",
    cooldownHours: MISSEVAN_COOLDOWN_HOURS,
    cooldownUntil: isInAccessDeniedCooldown() ? accessDeniedUntil : 0,
    desktopAppUrl: MISSEVAN_DESKTOP_APP_URL,
    featureSuggestionUrl: FEATURE_SUGGESTION_URL,
    frontendVersion,
    versionMismatch: frontendVersion !== APP_VERSION,
  });
});

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createTaskId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function cleanupExpiredStatsTasks() {
  const now = Date.now();
  for (const [taskId, task] of manboStatsTaskStore.entries()) {
    const updatedAt = Number(task?.updatedAt ?? task?.createdAt ?? 0);
    if (now - updatedAt > MANBO_STATS_TASK_TTL_MS) {
      manboStatsTaskStore.delete(taskId);
    }
  }
}

function buildStatsTaskSnapshot(task) {
  return {
    taskId: task.taskId,
    platform: task.platform,
    taskType: task.taskType,
    status: task.status,
    progress: task.progress,
    currentAction: task.currentAction,
    totalCount: task.totalCount,
    completedCount: task.completedCount,
    failedCount: task.failedCount,
    totalDanmaku: task.totalDanmaku,
    totalUsers: task.totalUsers,
    accessDenied: task.accessDenied,
    result:
      task.status === "completed" || task.status === "cancelled"
        ? task.result
        : null,
    error: task.error || "",
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    lastSeenAt: task.lastSeenAt,
  };
}

function updateStatsTask(task, patch) {
  Object.assign(task, patch, { updatedAt: Date.now() });
}

function refreshStatsTaskHeartbeat(task) {
  task.lastSeenAt = Date.now();
  task.updatedAt = task.lastSeenAt;
}

function hasManboTaskHeartbeatExpired(task) {
  return Date.now() - Number(task?.lastSeenAt ?? task?.createdAt ?? 0) >
    MANBO_STATS_TASK_HEARTBEAT_TIMEOUT_MS;
}

function formatPlayCountWan(value) {
  const count = Number(value);

  if (!Number.isFinite(count) || count <= 0) {
    return "0";
  }

  if (count < 10000) {
    return `${count}`;
  }

  if (count < 100000000) {
    return `${(count / 10000).toFixed(1)}\u4e07`;
  }

  return `${(count / 100000000).toFixed(2)}\u4ebf`;
}

function isAllowedImageHost(hostname) {
  return (
    hostname === "maoercdn.com" ||
    hostname.endsWith(".maoercdn.com") ||
    hostname === "img.kilamanbo.com" ||
    hostname.endsWith(".kilamanbo.com")
  );
}

function isAccessDeniedError(error) {
  return String(error?.message || error).includes("HTTP 418");
}

function isTruthyEnvValue(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function isFalsyEnvValue(value) {
  return ["0", "false", "no", "off"].includes(String(value ?? "").trim().toLowerCase());
}

function isHostedDeployment() {
  return (
    isTruthyEnvValue(process.env.RENDER)
    || Boolean(process.env.RENDER_SERVICE_ID)
    || Boolean(process.env.RAILWAY_ENVIRONMENT)
    || Boolean(process.env.RAILWAY_PROJECT_ID)
    || Boolean(process.env.RAILWAY_SERVICE_ID)
  );
}

function shouldPersistAccessDeniedCooldown() {
  if (!MISSEVAN_ENABLED || DESKTOP_APP) {
    return false;
  }

  const explicitValue = process.env.MISSEVAN_PERSISTENT_COOLDOWN;
  if (isTruthyEnvValue(explicitValue)) {
    return true;
  }
  if (isFalsyEnvValue(explicitValue)) {
    return false;
  }

  return isHostedDeployment();
}

function logCooldownPersistenceUnavailable(message, error = null) {
  if (cooldownPersistenceWarningLogged) {
    return;
  }

  cooldownPersistenceWarningLogged = true;
  if (error) {
    console.error(message, error);
    return;
  }
  console.error(message);
}

function getCooldownStatePayload() {
  return {
    appVersion: APP_VERSION,
    accessDeniedUntil,
    accessDeniedCooldownMode,
    accessDeniedUseShortCooldown,
  };
}

function getSerializedCooldownState() {
  return JSON.stringify(getCooldownStatePayload());
}

function applyLoadedCooldownState(payload) {
  const until = Number(payload?.accessDeniedUntil ?? 0);
  accessDeniedUntil = Number.isFinite(until) ? until : 0;
  accessDeniedCooldownMode =
    payload?.accessDeniedCooldownMode === "base"
      ? "base"
      : payload?.accessDeniedCooldownMode === "repeat"
        ? "repeat"
        : payload?.accessDeniedCooldownMode === "repeat_ready"
          ? "repeat_ready"
          : "none";
  accessDeniedUseShortCooldown = payload?.accessDeniedUseShortCooldown === true;
}

function armRepeatCooldownIfNeeded() {
  const shouldUseRepeatCooldown =
    accessDeniedUseShortCooldown
    || ["base", "repeat", "repeat_ready"].includes(accessDeniedCooldownMode);

  accessDeniedUntil = 0;
  accessDeniedUseShortCooldown = shouldUseRepeatCooldown;
  accessDeniedCooldownMode = shouldUseRepeatCooldown ? "repeat_ready" : "none";
}

function buildLandingRegionSnapshot(region, raw, fallbackVersion, options = {}) {
  let payload = null;
  let statusKnown = options.statusKnown !== false;

  if (typeof raw === "string" && raw) {
    try {
      payload = JSON.parse(raw);
    } catch (_) {
      payload = null;
      statusKnown = false;
    }
  }

  const resolvedFallbackVersion = normalizeVersion(fallbackVersion);
  const appVersion = normalizeVersion(payload?.appVersion ?? resolvedFallbackVersion);
  const cooldownUntil = Number(payload?.accessDeniedUntil ?? 0);

  return {
    key: region.key,
    label: region.label,
    version: appVersion === "0.0.0" ? resolvedFallbackVersion : appVersion,
    cooldownUntil:
      statusKnown && Number.isFinite(cooldownUntil) && cooldownUntil > Date.now()
        ? cooldownUntil
        : 0,
    cooldownHours: MISSEVAN_COOLDOWN_HOURS,
    statusKnown,
  };
}

async function writeCooldownStateToUpstash(payload = null) {
  if (!shouldPersistAccessDeniedCooldown()) {
    return;
  }

  if (!upstashClient.enabled) {
    logCooldownPersistenceUnavailable(
      "Persistent Missevan cooldown is enabled, but Upstash Redis is not configured."
    );
    return;
  }

  try {
    const serializedState = JSON.stringify(payload ?? getCooldownStatePayload());
    await upstashClient.command(["SET", MISSEVAN_COOLDOWN_KEY, serializedState]);
  } catch (error) {
    console.error("Failed to persist Missevan cooldown state to Upstash", error);
  }
}

async function clearCooldownStateFromUpstash() {
  if (!shouldPersistAccessDeniedCooldown()) {
    return;
  }

  if (!upstashClient.enabled) {
    logCooldownPersistenceUnavailable(
      "Persistent Missevan cooldown is enabled, but Upstash Redis is not configured."
    );
    return;
  }

  try {
    await writeCooldownStateToUpstash({
      ...getCooldownStatePayload(),
      accessDeniedUntil: 0,
      accessDeniedCooldownMode: "none",
      accessDeniedUseShortCooldown: false,
    });
  } catch (error) {
    console.error("Failed to clear Missevan cooldown state from Upstash", error);
  }
}

async function persistAccessDeniedCooldown() {
  await writeCooldownStateToUpstash();
}

async function clearPersistedAccessDeniedCooldown() {
  await clearCooldownStateFromUpstash();
}

async function loadAccessDeniedCooldown() {
  if (!shouldPersistAccessDeniedCooldown()) {
    cooldownStateLoaded = true;
    lastCooldownRefreshSucceeded = true;
    return;
  }

  if (!upstashClient.enabled) {
    cooldownStateLoaded = false;
    lastCooldownRefreshSucceeded = false;
    logCooldownPersistenceUnavailable(
      "Persistent Missevan cooldown is enabled, but Upstash Redis is not configured."
    );
    return;
  }

  try {
    const raw = await upstashClient.command(["GET", MISSEVAN_COOLDOWN_KEY]);
    cooldownStateLoaded = true;
    lastCooldownRefreshSucceeded = true;
    lastCooldownRefreshAt = Date.now();
    if (!raw) {
      accessDeniedUntil = 0;
      accessDeniedCooldownMode = "none";
      accessDeniedUseShortCooldown = false;
      await persistAccessDeniedCooldown();
      return;
    }

    applyLoadedCooldownState(JSON.parse(raw));
  } catch (error) {
    cooldownStateLoaded = false;
    lastCooldownRefreshSucceeded = false;
    console.error("Failed to read Missevan cooldown state from Upstash", error);
    return;
  }

  if (accessDeniedUntil <= Date.now()) {
    armRepeatCooldownIfNeeded();
    await persistAccessDeniedCooldown();
  }
}

async function refreshMissevanCooldownState(force = false) {
  if (!shouldPersistAccessDeniedCooldown()) {
    return;
  }

  if (!force && cooldownRefreshPromise) {
    return cooldownRefreshPromise;
  }

  cooldownRefreshPromise = loadAccessDeniedCooldown()
    .finally(() => {
      cooldownRefreshPromise = null;
    });
  return cooldownRefreshPromise;
}

async function persistCurrentAppVersionToCooldownState() {
  if (!shouldPersistAccessDeniedCooldown()) {
    return;
  }

  if (!upstashClient.enabled) {
    return;
  }

  if (!cooldownStateLoaded || !lastCooldownRefreshSucceeded) {
    return;
  }

  await writeCooldownStateToUpstash();
}

function buildMissevanAccessDeniedResponse(error, fallbackMessage = "Missevan request failed") {
  const message = error instanceof Error ? error.message : String(error);
  return {
    success: false,
    accessDenied: isMissevanAccessDenied(error),
    message: fallbackMessage,
    error: message,
  };
}

function isInAccessDeniedCooldown() {
  if (accessDeniedUntil > 0 && accessDeniedUntil <= Date.now()) {
    armRepeatCooldownIfNeeded();
    void persistAccessDeniedCooldown();
    return false;
  }

  return Date.now() < accessDeniedUntil;
}

function markAccessDeniedCooldown() {
  const useShortCooldown = accessDeniedUseShortCooldown;
  accessDeniedUntil = Date.now() + (
    useShortCooldown
      ? MISSEVAN_REPEAT_COOLDOWN_MS
      : MISSEVAN_COOLDOWN_MS
  );
  accessDeniedCooldownMode = useShortCooldown ? "repeat" : "base";
  accessDeniedUseShortCooldown = useShortCooldown;
  cooldownStateLoaded = true;
  lastCooldownRefreshSucceeded = true;
  lastCooldownRefreshAt = Date.now();
  void persistAccessDeniedCooldown();
}

function markSuccessfulMissevanRequest() {
  if (accessDeniedUntil === 0 && accessDeniedUseShortCooldown === false) {
    return;
  }

  accessDeniedUntil = 0;
  accessDeniedCooldownMode = "none";
  accessDeniedUseShortCooldown = false;
  cooldownStateLoaded = true;
  lastCooldownRefreshSucceeded = true;
  lastCooldownRefreshAt = Date.now();
  void clearPersistedAccessDeniedCooldown();
}

function isCooldownError(error) {
  return String(error?.message || error).startsWith("ACCESS_DENIED_COOLDOWN:");
}

function isMissevanAccessDenied(error) {
  return isAccessDeniedError(error) || isCooldownError(error);
}

function getCooldownRemainingMs() {
  return Math.max(0, accessDeniedUntil - Date.now());
}

function createCooldownError() {
  const seconds = Math.ceil(getCooldownRemainingMs() / 1000);
  return new Error(`ACCESS_DENIED_COOLDOWN:${seconds}`);
}

function ensureMissevanEnabled(res) {
  if (MISSEVAN_ENABLED) {
    return true;
  }

  res.status(403).json({
    success: false,
    accessDenied: false,
    message: "Missevan disabled",
  });
  return false;
}

function getCachedValue(cache, key, ttlMs) {
  const cached = cache.get(String(key));
  if (!cached) {
    return null;
  }

  if (Date.now() - cached.createdAt > ttlMs) {
    cache.delete(String(key));
    return null;
  }

  return cached.value;
}

function setCachedValue(cache, key, value, maxEntries = null) {
  const cacheKey = String(key);
  if (cache.has(cacheKey)) {
    cache.delete(cacheKey);
  }

  cache.set(cacheKey, {
    value,
    createdAt: Date.now(),
  });

  if (!Number.isFinite(Number(maxEntries))) {
    return;
  }

  const normalizedMaxEntries = Math.max(0, Math.floor(Number(maxEntries)));
  while (cache.size > normalizedMaxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey == null) {
      break;
    }
    cache.delete(oldestKey);
  }
}

function normalizeKeyword(keyword) {
  return String(keyword ?? "").trim().slice(0, 200);
}

function isSameHostUsageLogRequest(req) {
  const requestHost = String(req.get("host") || "")
    .trim()
    .toLowerCase();
  if (!requestHost) {
    return false;
  }

  const origin = String(req.get("origin") || "").trim();
  if (origin) {
    try {
      return new URL(origin).host.toLowerCase() === requestHost;
    } catch (_) {
      return false;
    }
  }

  const referer = String(req.get("referer") || "").trim();
  if (referer) {
    try {
      return new URL(referer).host.toLowerCase() === requestHost;
    } catch (_) {
      return false;
    }
  }

  return false;
}

function normalizeSearchOffset(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0
    ? Math.floor(normalized)
    : 0;
}

function normalizeSearchLimit(value, defaultLimit = 5, maxLimit = 5) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return defaultLimit;
  }
  return Math.min(Math.floor(normalized), maxLimit);
}

const SEARCH_RESULT_LIMIT = 70;

function normalizeIds(values, limit = 200) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item) && item > 0)
    )
  ).slice(0, limit);
}

function normalizeDramaIds(ids) {
  return normalizeIds(ids, 200);
}

function normalizeStringIds(values, limit = 200) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((item) => String(item ?? "").trim())
        .filter((item) => /^\d+$/.test(item))
    )
  ).slice(0, limit);
}

function isNumericId(value) {
  return /^\d+$/.test(String(value ?? "").trim());
}

const CHINESE_DIGIT_MAP = {
  ["\u96f6"]: 0,
  ["\u4e00"]: 1,
  ["\u4e8c"]: 2,
  ["\u4e24"]: 2,
  ["\u4e09"]: 3,
  ["\u56db"]: 4,
  ["\u4e94"]: 5,
  ["\u516d"]: 6,
  ["\u4e03"]: 7,
  ["\u516b"]: 8,
  ["\u4e5d"]: 9,
};

function parseChineseInteger(raw) {
  const text = String(raw ?? "").trim();
  if (!text) {
    return null;
  }

  if (/^\d+$/.test(text)) {
    return Number(text);
  }

  if (text === "\u5341") {
    return 10;
  }

  let total = 0;
  let section = 0;
  let current = 0;

  for (const char of text) {
    if (char in CHINESE_DIGIT_MAP) {
      current = CHINESE_DIGIT_MAP[char];
      continue;
    }

    if (char === "\u5341") {
      section += (current || 1) * 10;
      current = 0;
      continue;
    }

    if (char === "\u767e") {
      section += (current || 1) * 100;
      current = 0;
      continue;
    }

    if (char === "\u5343") {
      section += (current || 1) * 1000;
      current = 0;
      continue;
    }

    if (char === "\u4e07") {
      total += (section + current || 1) * 10000;
      section = 0;
      current = 0;
      continue;
    }

    return null;
  }

  const value = total + section + current;
  return Number.isFinite(value) && value > 0 ? value : null;
}

function extractManboFreeMainCount(text) {
  const match = String(text ?? "").match(
    /\u524d\s*([0-9\u96f6\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07]+)\s*[\u96c6\u671f][^\uff0c\u3002\n]{0,12}\u514d\u8d39/u
  );
  return match ? parseChineseInteger(match[1]) : null;
}

function extractManboMainEpisodeNumber(title) {
  const text = String(title ?? "").trim();
  if (!text) {
    return null;
  }

  const epMatch = text.match(/(?:^|[^\w])EP\s*0*([0-9]{1,3})(?:[^\d]|$)/i);
  if (epMatch) {
    return Number(epMatch[1]);
  }

  const cnMatch = text.match(/\u7b2c\s*([0-9\u96f6\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07]+)\s*[\u671f\u96c6\u8bdd\u7ae0\u8282\u5377]/u);
  if (cnMatch) {
    return parseChineseInteger(cnMatch[1]);
  }

  return null;
}

function inferManboEpisodeNeedPay(set, dramaMeta) {
  void dramaMeta;

  return (
    Number(set?.payType ?? set?.setPayType ?? 0) === 1 ||
    Number(set?.vipFree ?? 0) === 1 ||
    Number(set?.price ?? 0) > 0 ||
    Number(set?.memberPrice ?? 0) > 0
  ) ? 1 : 0;
}

function normalizeRawInputItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      if (typeof item === "string") {
        return { raw: item.trim() };
      }

      if (item && typeof item === "object") {
        return {
          raw: String(item.raw ?? "").trim(),
          resolvedShareData:
            item.resolvedShareData && typeof item.resolvedShareData === "object"
              ? item.resolvedShareData
              : null,
        };
      }

      return { raw: "" };
    })
    .filter((item) => item.raw)
    .slice(0, 200);
}

function normalizeTextValue(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeStringArray(values, limit = 100) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((item) => normalizeTextValue(item))
    .filter((item) => {
      if (!item || seen.has(item)) {
        return false;
      }
      seen.add(item);
      return true;
    })
    .slice(0, limit);
}

function normalizeNumericArray(values, limit = 100) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((item) => Number(item))
    .filter((item) => {
      if (!Number.isFinite(item) || item <= 0 || seen.has(item)) {
        return false;
      }
      seen.add(item);
      return true;
    })
    .slice(0, limit);
}

function normalizeStringIdArray(values, limit = 1000) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((item) => String(item ?? "").trim())
    .filter((item) => {
      if (!/^\d+$/.test(item) || seen.has(item)) {
        return false;
      }
      seen.add(item);
      return true;
    })
    .slice(0, limit);
}

function normalizeStringMap(mapLike) {
  const result = {};
  if (!mapLike || typeof mapLike !== "object") {
    return result;
  }
  Object.entries(mapLike).forEach(([key, value]) => {
    const normalizedKey = String(key ?? "").trim();
    const normalizedValue = normalizeTextValue(value);
    if (normalizedKey && normalizedValue) {
      result[normalizedKey] = normalizedValue;
    }
  });
  return result;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function createEmptyManboInfoSnapshot() {
  return {
    version: 1,
    updatedAt: 0,
    records: [],
  };
}

function createEmptyMissevanInfoSnapshot() {
  return {};
}

function createEmptyNewDramaIdsSnapshot() {
  return {
    manbo: [],
    missevan: [],
  };
}

function getInfoStore(platform) {
  return platform === "manbo" ? manboInfoStore : missevanInfoStore;
}

function normalizeNewDramaIdsSnapshot(snapshot) {
  const nextSnapshot =
    snapshot && typeof snapshot === "object"
      ? snapshot
      : createEmptyNewDramaIdsSnapshot();
  return {
    manbo: normalizeStringIdArray(nextSnapshot.manbo, 5000),
    missevan: normalizeStringIdArray(nextSnapshot.missevan, 5000),
  };
}

async function readJsonFileIfExists(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function normalizeManboLibraryRecord(record) {
  const dramaId = String(record?.dramaId ?? "").trim();
  if (!isNumericId(dramaId)) {
    return null;
  }

  const name = normalizeTextValue(record?.name);
  return {
    dramaId,
    name,
    normalizedName: normalizeManboIndexName(record?.normalizedName || name),
    aliases: normalizeStringArray(record?.aliases, 30),
    cover: normalizeTextValue(record?.cover),
    mainCvNicknames: normalizeStringArray(record?.mainCvNicknames, 20),
    mainCvNames: normalizeStringArray(record?.mainCvNames, 20),
    catalog: normalizeOptionalFiniteNumber(record?.catalog),
    createTime: normalizeTextValue(record?.createTime),
    catalogName: normalizeTextValue(record?.catalogName),
    type: normalizeOptionalFiniteNumber(record?.type),
    genre: normalizeTextValue(record?.genre),
    mainCvIds: normalizeNumericArray(record?.mainCvIds, 20),
    mainCvRoleNames: normalizeStringArray(record?.mainCvRoleNames, 20),
    seriesTitle: normalizeTextValue(record?.seriesTitle),
    author: normalizeTextValue(record?.author),
  };
}

const RANK_CATEGORY_CONFIG = Object.freeze({
  missevan: [
    {
      key: "new",
      label: "新品榜",
      ranks: [
        { key: "new_daily", label: "日榜" },
        { key: "new_weekly", label: "周榜" },
      ],
    },
    {
      key: "popular",
      label: "人气榜",
      ranks: [
        { key: "popular_weekly", label: "周榜" },
        { key: "popular_monthly", label: "月榜" },
      ],
    },
    {
      key: "bestseller",
      label: "畅销榜",
      ranks: [
        { key: "bestseller_weekly", label: "周榜" },
        { key: "bestseller_monthly", label: "月榜" },
      ],
    },
    {
      key: "peak",
      label: "巅峰榜",
      ranks: [{ key: "peak", label: "巅峰榜" }],
    },
  ],
  manbo: [
    {
      key: "hot",
      label: "热播榜",
      ranks: [{ key: "hot", label: "热播榜" }],
    },
    {
      key: "box_office",
      label: "票房榜",
      ranks: [
        { key: "box_office_total", label: "总榜" },
        { key: "box_office_member", label: "会员剧" },
        { key: "box_office_paid", label: "付费剧" },
      ],
    },
    {
      key: "diamond",
      label: "钻石榜",
      ranks: [{ key: "diamond_monthly", label: "月榜" }],
    },
    {
      key: "peak",
      label: "巅峰榜",
      ranks: [{ key: "peak", label: "巅峰榜" }],
    },
  ],
});

function normalizeRankNumber(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function buildRankMainCvText(mainCvs) {
  return buildMainCvText(mainCvs);
}

function normalizeRankCatalogName(drama) {
  const catalogName = normalizeTextValue(
    drama?.catalogName ??
      drama?.catalog_name ??
      drama?.categoryName ??
      drama?.category_name
  );
  if (catalogName === "有声书") {
    return "有声剧";
  }
  return ["广播剧", "有声剧", "有声漫"].includes(catalogName) ? catalogName : "";
}

function getRankContentTypeLabel(drama) {
  return normalizeRankCatalogName(drama);
}

function getRankPaymentLabel(drama) {
  const payStatus = normalizeTextValue(
    drama?.payStatus ?? drama?.paystatus ?? drama?.pay_status
  );
  if (["免费", "付费", "会员"].includes(payStatus)) {
    return payStatus;
  }
  const paymentLabel = normalizeTextValue(drama?.payment_label);
  if (["免费", "付费", "会员"].includes(paymentLabel)) {
    return paymentLabel;
  }
  if (drama?.isVIP === true || drama?.is_member === true) {
    return "会员";
  }
  return "";
}

function getMissevanPeakSeriesRecord(peakTrendSnapshot, seriesName) {
  const normalizedName = normalizeTextValue(seriesName);
  const series = peakTrendSnapshot?.series && typeof peakTrendSnapshot.series === "object"
    ? peakTrendSnapshot.series
    : {};
  if (!normalizedName) {
    return null;
  }
  if (series[normalizedName] && typeof series[normalizedName] === "object") {
    return series[normalizedName];
  }
  return Object.values(series).find((record) =>
    record && typeof record === "object" && normalizeTextValue(record.name) === normalizedName
  ) || null;
}

function normalizeDramaCardUsageAction(value) {
  const action = normalizeTextValue(value);
  return ["ranks_open_search_result", "ongoing_open_search_result"].includes(action)
    ? action
    : "manual_import";
}

function buildMissevanRankCard(rankKey, item, index, dramas, peakTrendSnapshot = null) {
  if (rankKey === "peak") {
    const name = normalizeTextValue(item?.name);
    if (!name) {
      return null;
    }
    const dramaIds = normalizeStringIds(item?.dramaIds, 100);
    const mainCvs = normalizeStringArray(item?.cvs, 20);
    const peakSeriesRecord = getMissevanPeakSeriesRecord(peakTrendSnapshot, name);
    return {
      rank: index + 1,
      name,
      cover: normalizeTextValue(item?.cover),
      view_count: normalizeRankNumber(item?.view_count) ?? 0,
      daily_view_delta: getPeakSeriesDailyViewDelta(peakSeriesRecord),
      drama_ids: dramaIds,
      main_cvs: mainCvs,
      main_cv_text: buildRankMainCvText(mainCvs),
      platform: "missevan",
      type: "peak",
    };
  }

  const dramaId = String(item ?? "").trim();
  if (!isNumericId(dramaId)) {
    return null;
  }

  const drama = dramas?.[dramaId];
  if (!drama || typeof drama !== "object") {
    return null;
  }

  const mainCvs = normalizeStringArray(drama.maincvs, 20);
  const rankCatalogName = normalizeRankCatalogName({
    ...drama,
    catalogName: normalizeTextValue(item?.catalogName) || drama.catalogName,
  });

  return {
    rank: index + 1,
    id: Number(dramaId),
    name: normalizeTextValue(drama.name),
    cover: normalizeTextValue(drama.cover),
    view_count: normalizeRankNumber(drama.view_count) ?? 0,
    subscription_num: normalizeRankNumber(drama.subscription_num),
    reward_num: normalizeRankNumber(drama.reward_num),
    reward_total: normalizeRankNumber(drama.reward_total),
    updated_at: normalizeTextValue(drama.updated_at),
    is_member: drama.isVIP === true,
    payment_label: getRankPaymentLabel({
      ...drama,
      isVIP: item?.isVIP ?? drama.isVIP,
      payStatus: item?.payStatus ?? drama.payStatus,
    }),
    content_type_label: getRankContentTypeLabel({
      ...drama,
      catalogName: normalizeTextValue(item?.catalogName) || drama.catalogName,
    }),
    catalogName: rankCatalogName,
    main_cvs: mainCvs,
    main_cv_text: buildRankMainCvText(mainCvs),
    platform: "missevan",
    type: "drama",
    danmaku_uid_count: normalizeRankNumber(drama.danmaku_uid_count),
  };
}

function buildManboRankCard(rankKey, rank, item, index, dramas) {
  const dramaId = String(item?.dramaId ?? "").trim();
  if (!isNumericId(dramaId)) {
    return null;
  }

  const drama = dramas?.[dramaId];
  if (!drama || typeof drama !== "object") {
    return null;
  }

  const unitName = normalizeTextValue(rank?.unitName || "排行值");
  const rankValue =
    item?.diamondValue != null
      ? normalizeRankNumber(item.diamondValue)
      : normalizeRankNumber(item?.hotValue);
  const mainCvs = normalizeStringArray(drama.maincvs, 20);

  const rankCatalogName = normalizeRankCatalogName({
    ...drama,
    catalogName: normalizeTextValue(item?.catalogName) || drama.catalogName,
  });

  return {
    rank: index + 1,
    id: dramaId,
    name: normalizeTextValue(drama.name),
    cover: normalizeTextValue(drama.cover),
    view_count: normalizeRankNumber(drama.view_count) ?? 0,
    subscription_num: normalizeRankNumber(drama.favorite_count),
    pay_count: normalizeRankNumber(drama.pay_count),
    diamond_value: normalizeRankNumber(drama.diamond_value),
    updated_at: normalizeTextValue(drama.updated_at),
    is_member: drama.isVIP === true,
    payment_label: getRankPaymentLabel({
      ...drama,
      isVIP: item?.isVIP ?? drama.isVIP,
      payStatus: item?.payStatus ?? drama.payStatus,
    }),
    content_type_label: getRankContentTypeLabel({
      ...drama,
      catalogName: normalizeTextValue(item?.catalogName) || drama.catalogName,
    }),
    catalogName: rankCatalogName,
    rank_value_label: unitName,
    rank_value: rankValue,
    main_cvs: mainCvs,
    main_cv_text: buildRankMainCvText(mainCvs),
    platform: "manbo",
    ...(rankKey !== "peak" ? { danmaku_uid_count: normalizeRankNumber(drama.danmaku_uid_count) } : {}),
  };
}

function buildNormalizedRank(rankKey, rankConfig, rank, platformPayload, platform, peakTrendSnapshot = null) {
  if (!rank || typeof rank !== "object") {
    return null;
  }

  const sourceItems = Array.isArray(rank.items) ? rank.items : [];
  const dramas =
    platformPayload?.dramas && typeof platformPayload.dramas === "object"
      ? platformPayload.dramas
      : {};
  const items = sourceItems
    .map((item, index) =>
      platform === "missevan"
        ? buildMissevanRankCard(rankKey, item, index, dramas, peakTrendSnapshot)
        : buildManboRankCard(rankKey, rank, item, index, dramas)
    )
    .filter(Boolean);

  return {
    key: rankKey,
    label: rankConfig.label,
    name: normalizeTextValue(rank.name || rankConfig.label),
    fetchedAt: normalizeTextValue(rank.fetched_at),
    unitName: normalizeTextValue(rank.unitName),
    items,
  };
}

function buildNormalizedRankPlatform(snapshot, platform, peakTrendSnapshot = null) {
  const platformPayload =
    snapshot?.[platform] && typeof snapshot[platform] === "object"
      ? snapshot[platform]
      : {};
  const ranks =
    platformPayload?.ranks && typeof platformPayload.ranks === "object"
      ? platformPayload.ranks
      : {};

  const categories = (RANK_CATEGORY_CONFIG[platform] || [])
    .map((category) => {
      const normalizedRanks = category.ranks
        .map((rankConfig) =>
          buildNormalizedRank(
            rankConfig.key,
            rankConfig,
            ranks[rankConfig.key],
            platformPayload,
            platform,
            peakTrendSnapshot
          )
        )
        .filter(Boolean);

      if (!normalizedRanks.length) {
        return null;
      }

      return {
        key: category.key,
        label: category.label,
        ranks: normalizedRanks,
      };
    })
    .filter(Boolean);

  return {
    key: platform,
    label: platform === "missevan" ? "猫耳" : "漫播",
    categories,
  };
}

function buildNormalizedRanksResponse(snapshot, peakTrendSnapshot = null) {
  const safeSnapshot =
    snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
      ? snapshot
      : {};

  return {
    success: true,
    schemaVersion: RANKS_RESPONSE_SCHEMA_VERSION,
    updatedAt: normalizeTextValue(safeSnapshot?._meta?.updated_at),
    platforms: {
      missevan: buildNormalizedRankPlatform(safeSnapshot, "missevan", peakTrendSnapshot),
      manbo: buildNormalizedRankPlatform(safeSnapshot, "manbo"),
    },
  };
}

async function readRanksSnapshot() {
  if (!upstashClient.enabled) {
    throw new Error("Upstash Redis is not configured");
  }

  const raw = await upstashClient.command(["GET", RANKS_KEY]);
  if (!raw) {
    return {};
  }
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function readRanksJsonKey(key) {
  if (!upstashClient.enabled) {
    throw new Error("Upstash Redis is not configured");
  }

  const raw = await upstashClient.command(["GET", key]);
  if (!raw) {
    return null;
  }
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function readOngoingIds(platform) {
  if (!upstashClient.enabled) {
    throw new Error("Upstash Redis is not configured");
  }

  const raw = await upstashClient.command(["GET", `${ONGOING_KEY_PREFIX}:${platform}`]);
  if (!raw) {
    return [];
  }
  if (typeof raw !== "string") {
    return normalizeOngoingIdList(raw);
  }
  try {
    return normalizeOngoingIdList(JSON.parse(raw));
  } catch (_) {
    return normalizeOngoingIdList(raw);
  }
}

async function getCachedRanksResponse() {
  const now = Date.now();
  if (
    ranksCache.response &&
    ranksCache.response.schemaVersion === RANKS_RESPONSE_SCHEMA_VERSION &&
    now - ranksCache.loadedAt < RANKS_CACHE_TTL_MS
  ) {
    return ranksCache.response;
  }

  if (ranksCache.loadPromise) {
    return ranksCache.loadPromise;
  }

  ranksCache.loadPromise = (async () => {
    try {
      const [snapshot, peakTrendSnapshot] = await Promise.all([
        readRanksSnapshot(),
        readRanksJsonKey(MISSEVAN_PEAK_SERIES_TREND_KEY).catch(() => null),
      ]);
      const response = buildNormalizedRanksResponse(snapshot, peakTrendSnapshot);
      ranksCache.response = response;
      ranksCache.loadedAt = Date.now();
      return response;
    } finally {
      ranksCache.loadPromise = null;
    }
  })();

  return ranksCache.loadPromise;
}

function getRankTrendCacheKey(platform, dramaId) {
  return `${RANK_TRENDS_RESPONSE_SCHEMA_VERSION}:${platform}:${dramaId}`;
}

function getOngoingCacheKey(platform) {
  return `${ONGOING_RESPONSE_SCHEMA_VERSION}:${platform}`;
}

async function getCachedOngoingResponse(platform) {
  const normalizedPlatform = String(platform ?? "").trim();
  const cacheKey = getOngoingCacheKey(normalizedPlatform);
  const now = Date.now();
  const cached = ongoingCache.get(cacheKey);
  if (cached?.response && now - cached.loadedAt < ONGOING_CACHE_TTL_MS) {
    return cached.response;
  }
  if (cached?.loadPromise) {
    return cached.loadPromise;
  }

  const loadPromise = (async () => {
    const indexSnapshot = await readRanksJsonKey(RANKS_INDEX_KEY);
    const dates = normalizeRankTrendDates(indexSnapshot);
    const [ongoingIds, metricEntries] = await Promise.all([
      readOngoingIds(normalizedPlatform),
      Promise.all(
        dates.map(async (date) => [
          date,
          await readRanksJsonKey(`ranks:metrics:${date}:${normalizedPlatform}`),
        ])
      ),
    ]);
    const metricSnapshotsByDate = Object.fromEntries(
      metricEntries.filter(([, snapshot]) => snapshot && typeof snapshot === "object")
    );
    const response = buildOngoingResponse({
      platform: normalizedPlatform,
      ongoingIds,
      indexSnapshot,
      metricSnapshotsByDate,
    });
    if (response && typeof response === "object") {
      response.schemaVersion = ONGOING_RESPONSE_SCHEMA_VERSION;
    }
    ongoingCache.set(cacheKey, {
      response,
      loadedAt: Date.now(),
      loadPromise: null,
    });
    return response;
  })();

  ongoingCache.set(cacheKey, {
    response: null,
    loadedAt: 0,
    loadPromise,
  });

  try {
    return await loadPromise;
  } catch (error) {
    ongoingCache.delete(cacheKey);
    throw error;
  }
}

async function getCachedRankTrendResponse(platform, dramaId) {
  const normalizedPlatform = String(platform ?? "").trim();
  const normalizedDramaId = String(dramaId ?? "").trim();
  const cacheKey = getRankTrendCacheKey(normalizedPlatform, normalizedDramaId);
  const now = Date.now();
  const cached = rankTrendsCache.get(cacheKey);
  if (cached?.response && now - cached.loadedAt < RANKS_CACHE_TTL_MS) {
    return cached.response;
  }
  if (cached?.loadPromise) {
    return cached.loadPromise;
  }

  const loadPromise = (async () => {
    if (normalizedPlatform === "missevan" && !isNumericId(normalizedDramaId)) {
      const peakSnapshot = await readRanksJsonKey(MISSEVAN_PEAK_SERIES_TREND_KEY);
      const response = buildPeakSeriesTrendResponse({
        id: normalizedDramaId,
        peakSnapshot,
      });
      if (response && typeof response === "object") {
        response.schemaVersion = RANK_TRENDS_RESPONSE_SCHEMA_VERSION;
      }
      rankTrendsCache.set(cacheKey, {
        response,
        loadedAt: Date.now(),
        loadPromise: null,
      });
      return response;
    }

    const indexSnapshot = await readRanksJsonKey(RANKS_INDEX_KEY);
    const dates = normalizeRankTrendDates(indexSnapshot);
    const [metricEntries, listEntries] = await Promise.all([
      dates.map(async (date) => [
        date,
        await readRanksJsonKey(`ranks:metrics:${date}:${normalizedPlatform}`),
      ]),
      dates.map(async (date) => [
        date,
        await readRanksJsonKey(`ranks:list:${date}:${normalizedPlatform}`),
      ]),
    ].map((commands) => Promise.all(commands)));
    const metricSnapshotsByDate = Object.fromEntries(
      metricEntries.filter(([, snapshot]) => snapshot && typeof snapshot === "object")
    );
    const listSnapshotsByDate = Object.fromEntries(
      listEntries.filter(([, snapshot]) => snapshot && typeof snapshot === "object")
    );

    const response = buildRankTrendResponse({
      platform: normalizedPlatform,
      id: normalizedDramaId,
      indexSnapshot,
      metricSnapshotsByDate,
      listSnapshotsByDate,
    });
    if (response && typeof response === "object") {
      response.schemaVersion = RANK_TRENDS_RESPONSE_SCHEMA_VERSION;
    }
    rankTrendsCache.set(cacheKey, {
      response,
      loadedAt: Date.now(),
      loadPromise: null,
    });
    return response;
  })();

  rankTrendsCache.set(cacheKey, {
    response: null,
    loadedAt: 0,
    loadPromise,
  });

  try {
    return await loadPromise;
  } catch (error) {
    rankTrendsCache.delete(cacheKey);
    throw error;
  }
}

function normalizeMissevanSeasonRecord(node, fallbackSeriesTitle = "", seasonKey = "") {
  const dramaId = Number(node?.dramaId ?? 0);
  if (!Number.isFinite(dramaId) || dramaId <= 0) {
    return null;
  }

  const title = normalizeTextValue(node?.title);
  const seriesTitle = normalizeTextValue(node?.seriesTitle || fallbackSeriesTitle || title);
  return {
    title,
    dramaId,
    soundIds: normalizeStringIdArray(node?.soundIds, 500),
    maincvs: normalizeNumericArray(node?.maincvs, 20),
    type: normalizeOptionalFiniteNumber(node?.type),
    cvroles: normalizeStringMap(node?.cvroles),
    cvnames: normalizeStringMap(node?.cvnames),
    catalog: normalizeOptionalFiniteNumber(node?.catalog),
    createTime: normalizeTextValue(node?.createTime),
    author: normalizeTextValue(node?.author),
    seriesTitle,
    needpay: Boolean(node?.needpay),
    seasonKey: normalizeTextValue(seasonKey),
  };
}

function isMissevanFlatSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return false;
  }

  const entries = Object.entries(snapshot);
  if (!entries.length) {
    return true;
  }

  return entries.some(([key, node]) => {
    const normalized = normalizeMissevanSeasonRecord(node, "", key);
    return normalized && String(normalized.dramaId) === String(key).trim();
  });
}

function getMissevanLibraryRecordsFromSnapshot(snapshot) {
  const safeSnapshot =
    snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
      ? snapshot
      : createEmptyMissevanInfoSnapshot();
  const flatRecords = [];
  const byDramaId = new Map();

  if (isMissevanFlatSnapshot(safeSnapshot)) {
    Object.entries(safeSnapshot).forEach(([dramaId, node]) => {
      const normalized = normalizeMissevanSeasonRecord(
        node,
        node?.seriesTitle || node?.title || "",
        dramaId
      );
      if (!normalized) {
        return;
      }
      flatRecords.push(normalized);
      byDramaId.set(String(normalized.dramaId), normalized);
    });
    return { flatRecords, byDramaId };
  }

  Object.entries(safeSnapshot).forEach(([seriesTitle, seasons]) => {
    Object.entries(seasons || {}).forEach(([seasonKey, node]) => {
      const normalized = normalizeMissevanSeasonRecord(node, seriesTitle, seasonKey);
      if (!normalized) {
        return;
      }
      flatRecords.push(normalized);
      byDramaId.set(String(normalized.dramaId), normalized);
    });
  });

  return { flatRecords, byDramaId };
}

function applyInfoStoreSnapshot(store, snapshot) {
  const safeSnapshot =
    snapshot && typeof snapshot === "object"
      ? snapshot
      : store.platform === "manbo"
        ? createEmptyManboInfoSnapshot()
        : createEmptyMissevanInfoSnapshot();

  if (store.platform === "manbo") {
    const records = (Array.isArray(safeSnapshot.records) ? safeSnapshot.records : [])
      .map((record) => normalizeManboLibraryRecord(record))
      .filter(Boolean);
    store.snapshot = {
      version: Number(safeSnapshot.version ?? 1) || 1,
      updatedAt: Number(safeSnapshot.updatedAt ?? 0) || Date.now(),
      records,
    };
    store.records = records;
    store.byDramaId = new Map(records.map((record) => [record.dramaId, record]));
  } else {
    const { flatRecords, byDramaId } = getMissevanLibraryRecordsFromSnapshot(safeSnapshot);
    store.snapshot = safeSnapshot;
    store.records = flatRecords;
    store.byDramaId = byDramaId;
  }

  store.loaded = true;
  store.lastLoadedAt = Date.now();
}

async function readInfoStoreSnapshot(store) {
  if (upstashClient.enabled) {
    try {
      const raw = await upstashClient.command(["GET", store.key]);
      store.remoteAvailable = true;
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (error) {
      store.remoteAvailable = false;
      console.error(`Failed to read Upstash info snapshot key=${store.key}`, error);
    }
  } else {
    store.remoteAvailable = false;
  }

  return store.platform === "manbo"
    ? createEmptyManboInfoSnapshot()
    : createEmptyMissevanInfoSnapshot();
}

async function ensureInfoStoreLoaded(store, forceRefresh = false) {
  if (
    store.loaded &&
    !forceRefresh &&
    Date.now() - store.lastLoadedAt < INFO_STORE_SYNC_INTERVAL_MS
  ) {
    return store;
  }

  if (store.loadPromise) {
    await store.loadPromise;
    return store;
  }

  store.loadPromise = (async () => {
    try {
      const snapshot = await readInfoStoreSnapshot(store);
      applyInfoStoreSnapshot(store, snapshot);
    } catch (error) {
      if (!store.loaded) {
        applyInfoStoreSnapshot(
          store,
          store.platform === "manbo"
            ? createEmptyManboInfoSnapshot()
            : createEmptyMissevanInfoSnapshot()
        );
      }
      console.error(`Failed to load info store platform=${store.platform}`, error);
    } finally {
      store.loadPromise = null;
    }
  })();

  await store.loadPromise;
  return store;
}

async function readNewDramaIdsSnapshot() {
  if (upstashClient.enabled) {
    try {
      const raw = await upstashClient.command(["GET", newDramaIdsStore.key]);
      if (raw) {
        return normalizeNewDramaIdsSnapshot(JSON.parse(raw));
      }
    } catch (error) {
      console.error(`Failed to read Upstash new drama id snapshot key=${newDramaIdsStore.key}`, error);
    }
  }

  const localSnapshot = await readJsonFileIfExists(newDramaIdsStore.fallbackPath);
  if (localSnapshot) {
    return normalizeNewDramaIdsSnapshot(localSnapshot);
  }

  return createEmptyNewDramaIdsSnapshot();
}

function applyNewDramaIdsSnapshot(snapshot) {
  newDramaIdsStore.snapshot = normalizeNewDramaIdsSnapshot(snapshot);
  newDramaIdsStore.loaded = true;
}

async function ensureNewDramaIdsLoaded(forceRefresh = false) {
  if (newDramaIdsStore.loaded && !forceRefresh) {
    return newDramaIdsStore.snapshot;
  }

  if (newDramaIdsStore.loadPromise) {
    await newDramaIdsStore.loadPromise;
    return newDramaIdsStore.snapshot;
  }

  newDramaIdsStore.loadPromise = (async () => {
    try {
      applyNewDramaIdsSnapshot(await readNewDramaIdsSnapshot());
    } catch (error) {
      if (!newDramaIdsStore.loaded) {
        applyNewDramaIdsSnapshot(createEmptyNewDramaIdsSnapshot());
      }
      console.error("Failed to load new drama id snapshot", error);
    } finally {
      newDramaIdsStore.loadPromise = null;
    }
  })();

  await newDramaIdsStore.loadPromise;
  return newDramaIdsStore.snapshot;
}

async function persistNewDramaIdsSnapshot(snapshot) {
  const normalizedSnapshot = normalizeNewDramaIdsSnapshot(snapshot);
  const payload = JSON.stringify(normalizedSnapshot);
  if (upstashClient.enabled) {
    await upstashClient.command(["SET", newDramaIdsStore.key, payload]);
  } else {
    await fs.mkdir(path.dirname(newDramaIdsStore.fallbackPath), { recursive: true });
    await fs.writeFile(newDramaIdsStore.fallbackPath, payload, "utf8");
  }
  applyNewDramaIdsSnapshot(normalizedSnapshot);
}

function queueNewDramaIdsAppend(platform, ids) {
  const normalizedIds = normalizeStringIdArray(ids, 5000);
  if (!normalizedIds.length || !["manbo", "missevan"].includes(platform)) {
    return Promise.resolve();
  }

  newDramaIdsStore.writePromise = newDramaIdsStore.writePromise
    .catch(() => {})
    .then(async () => {
      const snapshot = cloneJson(await ensureNewDramaIdsLoaded(true));
      const merged = {
        ...createEmptyNewDramaIdsSnapshot(),
        ...snapshot,
      };
      merged[platform] = normalizeStringIdArray(
        []
          .concat(Array.isArray(merged[platform]) ? merged[platform] : [])
          .concat(normalizedIds),
        5000
      );
      await persistNewDramaIdsSnapshot(merged);
    });

  return newDramaIdsStore.writePromise;
}

async function filterUntrackedNewDramaIds(platform, ids) {
  const normalizedIds = normalizeStringIdArray(ids, 5000);
  if (!normalizedIds.length || !["manbo", "missevan"].includes(platform)) {
    return [];
  }

  const store = getInfoStore(platform);
  await ensureInfoStoreLoaded(store, true);
  return normalizedIds.filter((id) => !store.byDramaId.has(String(id)));
}

function fireAndForget(label, task) {
  setTimeout(() => {
    Promise.resolve()
      .then(task)
      .catch((error) => {
        console.error(label, error);
      });
  }, 0);
}

async function mapWithConcurrency(items, limit, mapper) {
  const source = Array.isArray(items) ? items : [];
  const results = new Array(source.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(Number(limit) || 1, source.length || 1));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < source.length) {
        const currentIndex = cursor;
        cursor += 1;
        results[currentIndex] = await mapper(source[currentIndex], currentIndex);
      }
    })
  );

  return results;
}

function getSearchFieldScore(value, rawKeyword, normalizedKeyword) {
  const rawValue = normalizeTextValue(value);
  if (!rawValue) {
    return 0;
  }
  if (rawValue === rawKeyword) {
    return 900;
  }

  const normalizedValue = normalizeManboIndexName(rawValue);
  if (!normalizedValue || !normalizedKeyword) {
    return 0;
  }
  if (normalizedValue === normalizedKeyword) {
    return 780;
  }
  if (normalizedValue.startsWith(normalizedKeyword)) {
    return 620;
  }
  if (normalizedValue.includes(normalizedKeyword)) {
    return 460;
  }
  return 0;
}

function getWeightedSearchScore(entries, rawKeyword, normalizedKeyword) {
  let bestScore = 0;
  entries.forEach(({ value, boost = 0 }) => {
    const values = Array.isArray(value) ? value : [value];
    values.forEach((item) => {
      const score = getSearchFieldScore(item, rawKeyword, normalizedKeyword);
      if (score > 0) {
        bestScore = Math.max(bestScore, score + boost);
      }
    });
  });
  return bestScore;
}

const SEARCH_CATEGORY_TERMS = Object.freeze([
  { key: "audio_comic", terms: ["有声漫画", "有声漫"] },
  { key: "audio_drama", terms: ["有声剧"] },
  { key: "radio_drama", terms: ["广播剧"] },
]);

const MANBO_CATEGORY_ALIASES = Object.freeze({
  radio_drama: ["广播剧"],
  audio_drama: ["有声剧", "有声书"],
  audio_comic: ["有声漫", "有声漫画"],
});

const MISSEVAN_CATEGORY_CATALOGS = Object.freeze({
  radio_drama: [89, 90],
  audio_drama: 93,
  audio_comic: 96,
});

const CONTENT_TYPE_LABEL_BY_CATEGORY = Object.freeze({
  radio_drama: "广播剧",
  audio_drama: "有声剧",
  audio_comic: "有声漫",
});

const MISSEVAN_CONTENT_TYPE_BY_CATALOG = Object.freeze(
  Object.fromEntries(
    Object.entries(MISSEVAN_CATEGORY_CATALOGS).flatMap(([category, catalogs]) =>
      (Array.isArray(catalogs) ? catalogs : [catalogs]).map((catalog) => [
        catalog,
        CONTENT_TYPE_LABEL_BY_CATEGORY[category],
      ])
    )
  )
);

function getMissevanContentTypeLabel(record) {
  return MISSEVAN_CONTENT_TYPE_BY_CATALOG[Number(record?.catalog ?? 0)] || "";
}

function getManboContentTypeLabel(record) {
  const catalogName = normalizeTextValue(record?.catalogName);
  if (recordTextIncludesAny(catalogName, MANBO_CATEGORY_ALIASES.radio_drama)) {
    return CONTENT_TYPE_LABEL_BY_CATEGORY.radio_drama;
  }
  if (recordTextIncludesAny(catalogName, MANBO_CATEGORY_ALIASES.audio_drama)) {
    return CONTENT_TYPE_LABEL_BY_CATEGORY.audio_drama;
  }
  if (
    recordTextIncludesAny(catalogName, MANBO_CATEGORY_ALIASES.audio_comic) ||
    recordTextIncludesAny(
      [record?.genre, record?.name, record?.seriesTitle],
      MANBO_CATEGORY_ALIASES.audio_comic
    )
  ) {
    return CONTENT_TYPE_LABEL_BY_CATEGORY.audio_comic;
  }
  return "";
}

function getMissevanPaymentLabel(card) {
  if (card?.is_member) {
    return "会员";
  }
  return Number(card?.price ?? 0) > 0 || Number(card?.member_price ?? 0) > 0
    ? "付费"
    : "免费";
}

function getManboPaymentLabel(card) {
  if (card?.is_member) {
    return "会员";
  }
  if (Number(card?.price ?? 0) === 100) {
    return "免费";
  }
  return ["season", "episode"].includes(String(card?.revenue_type ?? ""))
    ? "付费"
    : "免费";
}

function escapeRegExp(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSearchBranches(keyword) {
  const rawKeyword = normalizeTextValue(keyword);
  const branches = [{ keyword: rawKeyword, category: null }];
  if (!rawKeyword) {
    return branches;
  }

  const normalizedKeyword = normalizeManboIndexName(rawKeyword);
  for (const category of SEARCH_CATEGORY_TERMS) {
    for (const term of category.terms) {
      const normalizedTerm = normalizeManboIndexName(term);
      if (!normalizedTerm || !normalizedKeyword.includes(normalizedTerm)) {
        continue;
      }

      const splitKeyword = normalizeTextValue(
        rawKeyword.replace(new RegExp(escapeRegExp(term), "g"), "")
      );
      if (!splitKeyword || normalizeManboIndexName(splitKeyword) === normalizedKeyword) {
        continue;
      }

      branches.push({
        keyword: splitKeyword,
        category: category.key,
      });
      return branches;
    }
  }

  return branches;
}

function recordTextIncludesAny(values, terms) {
  const normalizedTerms = (Array.isArray(terms) ? terms : [])
    .map((term) => normalizeManboIndexName(term))
    .filter(Boolean);
  if (!normalizedTerms.length) {
    return false;
  }

  return (Array.isArray(values) ? values : [values]).some((value) => {
    const normalizedValue = normalizeManboIndexName(value);
    return normalizedValue && normalizedTerms.some((term) => normalizedValue.includes(term));
  });
}

function matchesManboSearchCategory(record, category) {
  if (!category) {
    return true;
  }

  const aliases = MANBO_CATEGORY_ALIASES[category] || [];
  if (recordTextIncludesAny(record?.catalogName, aliases)) {
    return true;
  }

  if (category === "audio_comic") {
    return recordTextIncludesAny(
      [record?.genre, record?.name, record?.seriesTitle],
      aliases
    );
  }

  return false;
}

function matchesMissevanSearchCategory(record, category) {
  if (!category) {
    return true;
  }

  const expectedCatalog = MISSEVAN_CATEGORY_CATALOGS[category];
  const expectedCatalogs = Array.isArray(expectedCatalog) ? expectedCatalog : [expectedCatalog];
  return expectedCatalogs.includes(Number(record?.catalog ?? 0));
}

function scoreManboLibraryRecord(record, keyword) {
  const rawKeyword = normalizeTextValue(keyword);
  const normalizedKeyword = normalizeManboIndexName(rawKeyword);
  if (!rawKeyword) {
    return 0;
  }
  if (record.dramaId === rawKeyword) {
    return 1200;
  }
  return getWeightedSearchScore(
    [
      { value: record.name, boost: 220 },
      { value: record.aliases, boost: 180 },
      { value: record.mainCvNicknames, boost: 150 },
      { value: record.mainCvNames, boost: 140 },
      { value: record.mainCvRoleNames, boost: 120 },
      { value: record.seriesTitle, boost: 100 },
      { value: record.author, boost: 90 },
    ],
    rawKeyword,
    normalizedKeyword
  );
}

function scoreMissevanLibraryRecord(record, keyword) {
  const rawKeyword = normalizeTextValue(keyword);
  const normalizedKeyword = normalizeManboIndexName(rawKeyword);
  if (!rawKeyword) {
    return 0;
  }
  if (String(record.dramaId) === rawKeyword) {
    return 1200;
  }
  if (record.soundIds.includes(rawKeyword)) {
    return 1120;
  }
  return getWeightedSearchScore(
    [
      { value: record.title, boost: 220 },
      { value: record.seriesTitle, boost: 170 },
      { value: Object.values(record.cvnames), boost: 150 },
      { value: Object.values(record.cvroles), boost: 130 },
      { value: record.author, boost: 90 },
    ],
    rawKeyword,
    normalizedKeyword
  );
}

function buildScoredManboLibraryMatches(records, keyword, category = null) {
  return sortScoredDramaRecords(records
    .filter((record) => matchesManboSearchCategory(record, category))
    .map((record) => ({
      record,
      score: scoreManboLibraryRecord(record, keyword),
    }))
    .filter((item) => item.score > 0));
}

function buildScoredMissevanLibraryMatches(records, keyword, category = null) {
  return sortScoredDramaRecords(records
    .filter((record) => matchesMissevanSearchCategory(record, category))
    .map((record) => ({
      record,
      score: scoreMissevanLibraryRecord(record, keyword),
    }))
    .filter((item) => item.score > 0));
}

function applyOptionalSearchLimit(records, limit) {
  const normalizedLimit = Number(limit);
  if (!Number.isFinite(normalizedLimit) || normalizedLimit <= 0) {
    return records;
  }
  return records.slice(0, Math.floor(normalizedLimit));
}

function compareDramaIdsDesc(left, right) {
  const leftId = Number(left?.dramaId ?? 0);
  const rightId = Number(right?.dramaId ?? 0);
  if (Number.isFinite(leftId) && Number.isFinite(rightId)) {
    return rightId - leftId;
  }
  return String(right?.dramaId ?? "").localeCompare(String(left?.dramaId ?? ""));
}

function sortScoredDramaRecords(items) {
  return [...(Array.isArray(items) ? items : [])].sort((left, right) => {
    const scoreDelta = Number(right?.score ?? 0) - Number(left?.score ?? 0);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return compareDramaIdsDesc(left?.record, right?.record);
  });
}

function searchManboLibraryRecords(records, keyword, limit = null) {
  const branches = buildSearchBranches(keyword);
  const matchedRecords = Array.from(
    branches
      .flatMap((branch) => buildScoredManboLibraryMatches(
        records,
        branch.keyword,
        branch.category
      ))
      .reduce((map, item) => {
      const key = String(item.record?.dramaId ?? "");
      if (!key || map.has(key)) {
        return map;
      }
      map.set(key, item);
      return map;
      }, new Map())
      .values()
  ).map((item) => item.record);
  return applyOptionalSearchLimit(matchedRecords, limit);
}

function searchMissevanLibraryRecords(records, keyword, limit = null) {
  const branches = buildSearchBranches(keyword);
  const matchedRecords = Array.from(
    branches
      .flatMap((branch) => buildScoredMissevanLibraryMatches(
        records,
        branch.keyword,
        branch.category
      ))
      .reduce((map, item) => {
      const key = String(item.record?.dramaId ?? "");
      if (!key || map.has(key)) {
        return map;
      }
      map.set(key, item);
      return map;
      }, new Map())
      .values()
  ).map((item) => item.record);
  return applyOptionalSearchLimit(matchedRecords, limit);
}

function buildMainCvText(mainCvs) {
  const names = normalizeStringArray(mainCvs, 20);
  return names.length ? `主要CV：${names.join("，")}` : "";
}

function getMissevanMainCvNames(record) {
  const byMainIds = record.maincvs
    .map((cvId) => record.cvnames[String(cvId)] || "")
    .filter(Boolean);
  const fallback = Object.values(record.cvnames);
  return normalizeStringArray(byMainIds.length ? byMainIds : fallback, 20);
}

function getManboMainCvNames(record) {
  const names = normalizeStringArray(record?.mainCvNames, 20);
  const nicknames = normalizeStringArray(record?.mainCvNicknames, 20);
  if (names.length > 0 && names.length === nicknames.length) {
    return names;
  }
  return nicknames;
}

function buildManboSearchFallbackCard(record) {
  const mainCvs = getManboMainCvNames(record);
  const card = {
    id: String(record?.dramaId ?? ""),
    name: record?.name || "",
    cover: record?.cover || "",
    view_count: 0,
    playCountWan: "0",
    price: 0,
    sound_id: null,
    subscription_num: null,
    pay_count: null,
    diamond_value: 0,
    is_member: false,
    checked: false,
    platform: "manbo",
    content_type_label: getManboContentTypeLabel(record),
    main_cvs: mainCvs,
    main_cv_text: buildMainCvText(mainCvs),
  };
  return {
    ...card,
    payment_label: getManboPaymentLabel(card),
  };
}

function buildMissevanSearchFallbackCard(record) {
  const mainCvs = getMissevanMainCvNames(record);
  const primarySoundId = normalizeStringIdArray(record?.soundIds, 1)[0] || null;
  const card = {
    id: Number(record?.dramaId ?? 0),
    name: record?.title || "",
    cover: "",
    view_count: 0,
    playCountWan: "0",
    vip: 0,
    price: 0,
    member_price: 0,
    is_member: false,
    sound_id: primarySoundId ? Number(primarySoundId) : null,
    subscription_num: null,
    reward_num: null,
    checked: false,
    platform: "missevan",
    search_source: "library",
    content_type_label: getMissevanContentTypeLabel(record),
    main_cvs: mainCvs,
    main_cv_text: buildMainCvText(mainCvs),
  };
  return {
    ...card,
    payment_label: getMissevanPaymentLabel(card),
  };
}

function getMissevanPrimarySoundIdFromRecord(record) {
  const primarySoundId = normalizeStringIdArray(record?.soundIds, 1)[0] || "";
  return Number(primarySoundId) || null;
}

function normalizeMissevanApiSearchCandidate(item) {
  const source = item && typeof item === "object" ? item : {};
  const drama = source?.drama && typeof source.drama === "object" ? source.drama : {};
  const info = source?.info && typeof source.info === "object" ? source.info : {};
  const candidate = source?.drama_info && typeof source.drama_info === "object"
    ? source.drama_info
    : source;

  const dramaId = Number(
    candidate?.drama_id ??
      candidate?.dramaId ??
      candidate?.id ??
      drama?.drama_id ??
      drama?.dramaId ??
      drama?.id ??
      info?.drama_id ??
      info?.id ??
      0
  );
  if (!Number.isFinite(dramaId) || dramaId <= 0) {
    return null;
  }

  const title = normalizeTextValue(
    candidate?.title ??
      candidate?.name ??
      candidate?.drama_name ??
      drama?.title ??
      drama?.name ??
      info?.title ??
      info?.name
  );
  if (!title) {
    return null;
  }

  const soundId = Number(
    source?.sound_id ??
      source?.soundid ??
      source?.soundId ??
      candidate?.sound_id ??
      candidate?.soundid ??
      candidate?.soundId ??
      drama?.sound_id ??
      drama?.soundId ??
      0
  );

  return {
    dramaId,
    title,
    cover: normalizeTextValue(
      candidate?.cover ??
        candidate?.small_cover ??
        drama?.cover ??
        drama?.small_cover ??
        info?.cover ??
        ""
    ),
    soundId: Number.isFinite(soundId) && soundId > 0 ? soundId : null,
  };
}

function collectMissevanSearchCandidateArrays(payload) {
  const queue = [payload?.info, payload?.data, payload?.result, payload?.results];
  const arrays = [];
  const visited = new Set();

  while (queue.length) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);

    if (Array.isArray(current)) {
      arrays.push(current);
      continue;
    }

    if (typeof current !== "object") {
      continue;
    }

    Object.values(current).forEach((value) => {
      if (!value || visited.has(value)) {
        return;
      }
      if (Array.isArray(value)) {
        arrays.push(value);
        visited.add(value);
        return;
      }
      if (typeof value === "object") {
        queue.push(value);
      }
    });
  }

  return arrays;
}

async function searchMissevanApiRecords(keyword, limit = 70) {
  const cacheKey = normalizeTextValue(keyword);
  const cached = getCachedValue(
    missevanSearchApiCache,
    cacheKey,
    MISSEVAN_SEARCH_API_CACHE_TTL_MS
  );
  if (cached) {
    return cached;
  }

  const payload = await fetchJsonWithRetry(
    `https://www.missevan.com/dramaapi/search?s=${encodeURIComponent(cacheKey)}`,
    2,
    250,
    { missevan: true }
  );

  if (!payload?.success) {
    const infoMessage = normalizeTextValue(payload?.info);
    if (payload?.code === 100010007 || infoMessage.includes("木有找到")) {
      setCachedValue(missevanSearchApiCache, cacheKey, []);
      return [];
    }
  }

  const normalized = Array.from(
    collectMissevanSearchCandidateArrays(payload)
      .flat()
      .map(normalizeMissevanApiSearchCandidate)
      .filter(Boolean)
      .reduce((map, item) => {
        const key = String(item.dramaId);
        if (!map.has(key)) {
          map.set(key, item);
        }
        return map;
      }, new Map())
      .values()
  ).slice(0, limit);

  setCachedValue(missevanSearchApiCache, cacheKey, normalized);
  return normalized;
}

function getMissevanApiCvNames(info, limit = 2) {
  return normalizeStringArray(
    (Array.isArray(info?.cvs) ? info.cvs : [])
      .map((entry) => normalizeTextValue(entry?.displayName ?? entry?.name))
      .filter(Boolean),
    limit
  );
}

function buildMissevanApiSearchFallbackCard(record, mainCvs = []) {
  const card = {
    id: Number(record?.dramaId ?? 0),
    name: record?.title || "",
    cover: record?.cover || "",
    view_count: 0,
    playCountWan: "0",
    vip: 0,
    price: 0,
    member_price: 0,
    is_member: false,
    sound_id: Number(record?.soundId ?? 0) || null,
    subscription_num: null,
    reward_num: null,
    checked: false,
    platform: "missevan",
    search_source: "missevan_api",
    content_type_label: "",
    main_cvs: mainCvs,
    main_cv_text: buildMainCvText(mainCvs),
  };
  return {
    ...card,
    payment_label: getMissevanPaymentLabel(card),
  };
}

function buildSearchPageMeta(keyword, totalMatched, offset, limit) {
  const safeTotalMatched = Math.max(0, Number(totalMatched ?? 0));
  const safeOffset = Math.max(0, Number(offset ?? 0));
  const safeLimit = Math.max(1, Number(limit ?? 5));
  const nextOffset = Math.min(safeTotalMatched, safeOffset + safeLimit);
  return {
    keyword,
    matchedCount: safeTotalMatched,
    totalMatched: safeTotalMatched,
    offset: safeOffset,
    limit: safeLimit,
    nextOffset,
    hasMore: nextOffset < safeTotalMatched,
  };
}

async function hydrateMissevanSearchRecord(record) {
  const fallbackCard = buildMissevanSearchFallbackCard(record);
  try {
    const soundId = Number(fallbackCard.sound_id ?? 0);
    const info = await fetchDramaInfo(
      record.dramaId,
      soundId > 0 ? soundId : null
    );
    if (!info?.drama) {
      return fallbackCard;
    }

    let rewardNum = null;
    try {
      const rewardMeta = await fetchRewardDetailMeta(record.dramaId);
      rewardNum = normalizeOptionalFiniteNumber(rewardMeta?.reward_num);
    } catch (error) {
      if (!isMissevanAccessDenied(error)) {
        console.error(
          `Failed to fetch Missevan reward detail drama_id=${record.dramaId}`,
          error
        );
      }
    }

    const viewCount = Number(info.drama.view_count ?? 0);
    const card = {
      ...fallbackCard,
      cover: info.drama.cover || fallbackCard.cover,
      view_count: viewCount,
      playCountWan: formatPlayCountWan(viewCount),
      vip: Number(info.drama.vip ?? 0),
      price: Number(info.drama.price ?? 0),
      member_price: Number(info.drama.member_price ?? 0),
      is_member: Boolean(info.drama.is_member),
      sound_id:
        Number(
          fallbackCard.sound_id ??
            info?.episodes?.episode?.[0]?.sound_id ??
            0
        ) || null,
      subscription_num: normalizeOptionalFiniteNumber(
        info.drama.subscription_num
      ),
      reward_num: rewardNum,
    };
    return {
      ...card,
      payment_label: getMissevanPaymentLabel(card),
      content_type_label: getMissevanContentTypeLabel(info.drama) || fallbackCard.content_type_label,
    };
  } catch (error) {
    if (isMissevanAccessDenied(error)) {
      throw error;
    }
    if (!isMissevanAccessDenied(error)) {
      console.error(
        `Failed to hydrate Missevan search result drama_id=${record.dramaId}`,
        error
      );
    }
    return fallbackCard;
  }
}

async function hydrateMissevanApiSearchRecord(record) {
  const fallbackCard = buildMissevanApiSearchFallbackCard(record);

  try {
    const info = await fetchDramaInfo(record.dramaId);
    if (!info?.drama) {
      return fallbackCard;
    }

    let rewardNum = null;
    try {
      const rewardMeta = await fetchRewardDetailMeta(record.dramaId);
      rewardNum = normalizeOptionalFiniteNumber(rewardMeta?.reward_num);
    } catch (error) {
      if (!isMissevanAccessDenied(error)) {
        console.error(
          `Failed to fetch Missevan reward detail drama_id=${record.dramaId}`,
          error
        );
      }
    }

    const mainCvs = getMissevanApiCvNames(info, 2);
    const viewCount = Number(info.drama.view_count ?? 0);
    const card = {
      ...fallbackCard,
      cover: info.drama.cover || fallbackCard.cover,
      view_count: viewCount,
      playCountWan: formatPlayCountWan(viewCount),
      vip: Number(info.drama.vip ?? 0),
      price: Number(info.drama.price ?? 0),
      member_price: Number(info.drama.member_price ?? 0),
      is_member: Boolean(info.drama.is_member),
      sound_id:
        Number(
          fallbackCard.sound_id ??
            info?.episodes?.episode?.[0]?.sound_id ??
            0
        ) || null,
      subscription_num: normalizeOptionalFiniteNumber(
        info.drama.subscription_num
      ),
      reward_num: rewardNum,
      main_cvs: mainCvs,
      main_cv_text: buildMainCvText(mainCvs),
    };
    return {
      ...card,
      payment_label: getMissevanPaymentLabel(card),
      content_type_label: getMissevanContentTypeLabel(info.drama),
    };
  } catch (error) {
    if (isMissevanAccessDenied(error)) {
      throw error;
    }
    if (!isMissevanAccessDenied(error)) {
      console.error(
        `Failed to hydrate Missevan API search result drama_id=${record.dramaId}`,
        error
      );
    }
    return fallbackCard;
  }
}

async function hydrateManboSearchRecord(record) {
  const fallbackCard = buildManboSearchFallbackCard(record);
  try {
    const info = await fetchManboDramaDetail(record.dramaId);
    const card = normalizeManboCardFromDramaInfo(info);
    if (!card) {
      return fallbackCard;
    }
    return {
      ...card,
      checked: false,
      payment_label: getManboPaymentLabel(card),
      content_type_label: card.content_type_label || fallbackCard.content_type_label,
      main_cvs: fallbackCard.main_cvs,
      main_cv_text: fallbackCard.main_cv_text,
    };
  } catch (error) {
    console.error(
      `Failed to hydrate Manbo search result dramaId=${record.dramaId}`,
      error
    );
    return fallbackCard;
  }
}

function extractMissevanCvEntries(info) {
  const entries = [];
  const seen = new Set();
  const cvs = Array.isArray(info?.cvs) ? info.cvs : [];
  cvs.forEach((item, index) => {
    const cvId = Number(item?.cv_info?.id ?? 0);
    const displayName = normalizeTextValue(item?.cv_info?.name);
    if (!cvId || !displayName || seen.has(cvId)) {
      return;
    }
    seen.add(cvId);
    entries.push({
      index,
      cvId,
      displayName,
      roleName: normalizeTextValue(item?.character),
    });
  });
  return entries;
}

async function writeUsageLog(entry) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    ...entry,
  };

  console.log("[usage]", JSON.stringify(logEntry));

  try {
    await fs.mkdir(logsDir, { recursive: true });
    await fs.appendFile(usageLogPath, `${JSON.stringify(logEntry)}\n`, "utf8");
  } catch (error) {
    console.error("Failed to write usage log", error);
  }
}

function createTimeoutSignal(timeoutMs) {
  const normalizedTimeout = Number(timeoutMs);
  if (!Number.isFinite(normalizedTimeout) || normalizedTimeout <= 0) {
    return { signal: undefined, cleanup: () => {} };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Request timeout after ${normalizedTimeout}ms`));
  }, normalizedTimeout);

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  };
}

function buildFetchOptions(url, options = {}) {
  const targetUrl = typeof url === "string" ? new URL(url) : url;
  const fetchOptions = {
    headers: options.headers,
    signal: options.signal,
    agent: options.agent,
  };

  if (!fetchOptions.agent && targetUrl.hostname === MANBO_API_HOST) {
    fetchOptions.agent = manboHttpsAgent;
  }

  return fetchOptions;
}

async function fetchJsonWithRetry(url, retries = 2, delayMs = 250, options = {}) {
  if (options.missevan && isInAccessDeniedCooldown()) {
    throw createCooldownError();
  }

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const { signal, cleanup } = createTimeoutSignal(options.timeoutMs);

    try {
      const response = await fetch(
        url,
        buildFetchOptions(url, {
          ...options,
          signal,
        })
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      if (options.missevan) {
        markSuccessfulMissevanRequest();
      }
      return data;
    } catch (error) {
      if (options.missevan && isAccessDeniedError(error)) {
        markAccessDeniedCooldown();
      }

      lastError = error;
      if (attempt < retries) {
        await sleep(delayMs * (attempt + 1));
      }
    } finally {
      cleanup();
    }
  }

  throw lastError;
}

async function fetchTextWithRetry(url, retries = 2, delayMs = 250, options = {}) {
  if (options.missevan && isInAccessDeniedCooldown()) {
    throw createCooldownError();
  }

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const { signal, cleanup } = createTimeoutSignal(options.timeoutMs);

    try {
      const response = await fetch(
        url,
        buildFetchOptions(url, {
          ...options,
          signal,
        })
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const text = await response.text();
      if (options.missevan) {
        markSuccessfulMissevanRequest();
      }
      return text;
    } catch (error) {
      if (options.missevan && isAccessDeniedError(error)) {
        markAccessDeniedCooldown();
      }

      lastError = error;
      if (attempt < retries) {
        await sleep(delayMs * (attempt + 1));
      }
    } finally {
      cleanup();
    }
  }

  throw lastError;
}

function normalizeMissevanDramaInfo(info) {
  if (!info?.drama) {
    return null;
  }

  const drama = info.drama;
  const episodes = Array.isArray(info?.episodes?.episode) ? info.episodes.episode : [];
  const price = Number(drama.price ?? 0);

  return {
    drama: {
      ...drama,
      id: Number(drama.id),
      name: drama.name || "",
      cover: drama.cover || "",
      vip: Number(drama.vip ?? 0),
      price,
      member_price: resolveMissevanMemberPrice(price, drama?.vip_discount?.price),
      is_member: Number(drama.vip ?? 0) === 1,
      view_count: Number(drama.view_count ?? 0),
      subscription_num: Number(drama.subscription_num ?? 0),
      platform: "missevan",
    },
    episodes: {
      episode: episodes.map((episode) => ({
        ...episode,
        sound_id: Number(episode.sound_id),
        name: episode.name || "",
        duration: Number(episode.duration ?? 0),
        need_pay: Number(episode.need_pay ?? 0),
        price: Number(episode.price ?? 0),
      })),
    },
    cvs: extractMissevanCvEntries(info).map((entry) => ({
      cvId: entry.cvId,
      displayName: entry.displayName,
      roleName: entry.roleName,
    })),
    platform: "missevan",
  };
}

async function fetchSoundSummary(soundId) {
  const cached = getCachedValue(
    soundSummaryCache,
    soundId,
    SOUND_SUMMARY_CACHE_TTL_MS
  );
  if (cached) {
    return cached;
  }

  const data = await fetchJsonWithRetry(
    `https://www.missevan.com/sound/getsound?soundid=${soundId}`,
    2,
    250,
    { missevan: true }
  );
  const sound = data?.info?.sound || data?.info || {};
  const viewCount = Number(sound.view_count ?? 0);
  const duration = Number(sound.duration ?? 0);

  const summary = {
    sound_id: Number(soundId),
    success: true,
    view_count: viewCount,
    viewCountWan: sound.view_count_formatted || formatPlayCountWan(viewCount),
    duration,
    playCountFailed: false,
    accessDenied: false,
    error: "",
  };

  setCachedValue(soundSummaryCache, soundId, summary);
  return summary;
}

async function fetchDramaInfo(dramaId, soundId = null) {
  const cacheKey = soundId ? `sound:${soundId}` : `drama:${dramaId}`;
  const cached = getCachedValue(dramaCache, cacheKey, DRAMA_CACHE_TTL_MS);
  if (cached) {
    return cached;
  }

  const data = await fetchJsonWithRetry(
    soundId
      ? `https://www.missevan.com/dramaapi/getdramabysound?sound_id=${soundId}`
      : `https://www.missevan.com/dramaapi/getdrama?drama_id=${dramaId}`,
    2,
    250,
    { missevan: true }
  );

  if (data.success && data.info) {
    let normalized = normalizeMissevanDramaInfo(data.info);
    const resolvedSoundId = Number(
      soundId ?? normalized?.episodes?.episode?.[0]?.sound_id
    );

    if (
      !soundId
      && normalized
      && Number(normalized?.drama?.subscription_num ?? 0) <= 0
      && resolvedSoundId > 0
    ) {
      try {
        const bySoundData = await fetchJsonWithRetry(
          `https://www.missevan.com/dramaapi/getdramabysound?sound_id=${resolvedSoundId}`,
          2,
          250,
          { missevan: true }
        );
        if (bySoundData?.success && bySoundData?.info) {
          const bySoundNormalized = normalizeMissevanDramaInfo(bySoundData.info);
          const bySoundSubscriptionNum = Number(bySoundNormalized?.drama?.subscription_num ?? 0);
          if (bySoundSubscriptionNum > 0) {
            normalized = {
              ...normalized,
              drama: {
                ...normalized.drama,
                subscription_num: bySoundSubscriptionNum,
              },
            };
          }
        }
      } catch (error) {
        console.error(
          `Failed to backfill Missevan subscription_num drama_id=${dramaId} sound_id=${resolvedSoundId}`,
          error
        );
      }
    }

    setCachedValue(dramaCache, cacheKey, normalized);

    const resolvedDramaId = Number(normalized?.drama?.id ?? dramaId);
    if (resolvedDramaId > 0) {
      setCachedValue(dramaCache, `drama:${resolvedDramaId}`, normalized);
    }

    if (resolvedSoundId > 0) {
      setCachedValue(dramaCache, `sound:${resolvedSoundId}`, normalized);
    }

    return normalized;
  }

  return null;
}

async function fetchRewardSummary(dramaId) {
  const cached = getCachedValue(
    rewardSummaryCache,
    dramaId,
    REWARD_SUMMARY_CACHE_TTL_MS
  );
  if (cached) {
    return cached;
  }

  const data = await fetchJsonWithRetry(
    `https://www.missevan.com/reward/user-reward-rank?period=3&drama_id=${dramaId}`,
    2,
    250,
    { missevan: true }
  );
  const rankList = data?.info?.list || data?.info?.data || data?.list || [];
  const rewardCoinTotal = rankList.reduce((sum, item) => {
    return sum + Number(item?.coin ?? 0);
  }, 0);

  const summary = {
    success: true,
    drama_id: Number(dramaId),
    rewardCoinTotal,
    accessDenied: false,
    error: "",
  };

  setCachedValue(rewardSummaryCache, dramaId, summary);
  return summary;
}

async function fetchRewardDetailMeta(dramaId) {
  const cached = getCachedValue(
    rewardDetailCache,
    dramaId,
    REWARD_DETAIL_CACHE_TTL_MS
  );
  if (cached) {
    return cached;
  }

  const data = await fetchJsonWithRetry(
    `https://www.missevan.com/reward/drama-reward-detail?drama_id=${dramaId}`,
    2,
    250,
    { missevan: true }
  );
  const rewardNum = Number(data?.info?.reward_num ?? data?.info?.data?.reward_num);
  const summary = {
    success: true,
    drama_id: Number(dramaId),
    reward_num: Number.isFinite(rewardNum) ? rewardNum : null,
    accessDenied: false,
    error: "",
  };

  setCachedValue(rewardDetailCache, dramaId, summary);
  return summary;
}

function normalizeOptionalFiniteNumber(value) {
  if (value == null || value === "") {
    return null;
  }

  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function pickFirstDefined(...values) {
  for (const value of values) {
    if (value != null && value !== "") {
      return value;
    }
  }
  return null;
}

function hasManboVipFreeMarker(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  if (Number(pickFirstDefined(payload.vipFree, payload.vip_free) ?? 0) === 1) {
    return true;
  }

  const drama = payload.drama;
  if (
    drama &&
    typeof drama === "object" &&
    Number(pickFirstDefined(drama.vipFree, drama.vip_free) ?? 0) === 1
  ) {
    return true;
  }

  const episodes = Array.isArray(payload.setRespList)
    ? payload.setRespList
    : Array.isArray(payload?.episodes?.episode)
      ? payload.episodes.episode
      : [];
  return episodes.some((episode) => {
    return Number(pickFirstDefined(episode?.vipFree, episode?.vip_free) ?? 0) === 1;
  });
}

function shouldFetchManboMemberSupplement(legacyPayload) {
  if (!legacyPayload || typeof legacyPayload !== "object") {
    return false;
  }

  const payType = Number(
    pickFirstDefined(legacyPayload.payType, legacyPayload.setPayType) ?? 0
  );
  const price = Number(legacyPayload.price ?? 0);
  const memberPrice = Number(
    pickFirstDefined(legacyPayload.memberPrice, legacyPayload.member_price) ?? 0
  );

  return (
    payType === 0
    && price === 0
    && memberPrice === 0
    && hasManboVipFreeMarker(legacyPayload)
  );
}

function mergeManboDramaMemberSupplement(legacyPayload, v530Payload) {
  if (!legacyPayload) {
    return v530Payload ?? null;
  }
  if (!v530Payload) {
    return legacyPayload;
  }

  return {
    ...legacyPayload,
    vipFree: pickFirstDefined(
      v530Payload.vipFree,
      v530Payload.vip_free,
      legacyPayload.vipFree,
      legacyPayload.vip_free
    ),
    memberListenCount: pickFirstDefined(
      v530Payload.memberListenCount,
      v530Payload.member_listen_count,
      legacyPayload.memberListenCount,
      legacyPayload.member_listen_count
    ),
    setRespList:
      Array.isArray(legacyPayload.setRespList) && legacyPayload.setRespList.length > 0
        ? legacyPayload.setRespList
        : v530Payload.setRespList,
  };
}

async function fetchManboLegacyDramaPayload(dramaId) {
  const normalizedDramaId = String(dramaId ?? "").trim();
  if (!isNumericId(normalizedDramaId)) {
    return null;
  }

  const data = await fetchJsonWithRetry(
    `${MANBO_API_BASE}/dramaDetail?dramaId=${normalizedDramaId}`
  );

  if (Number(data?.code) !== 200 || !data?.data) {
    return null;
  }

  return data.data;
}

async function fetchManboV530DramaPayload(dramaId) {
  const normalizedDramaId = String(dramaId ?? "").trim();
  if (!isNumericId(normalizedDramaId)) {
    return null;
  }

  try {
    const v530Data = await fetchJsonWithRetry(
      `${MANBO_API_V530_BASE}/detail?radioDramaId=${normalizedDramaId}`
    );
    if (Number(v530Data?.h?.code) === 200 && v530Data?.b) {
      return v530Data.b;
    }
  } catch (_v530Err) {
    return null;
  }

  return null;
}

async function fetchDanmakuSummary(soundId, dramaTitle, episodeTitle = "") {
  const cacheKey = String(soundId);
  const cached = getCachedValue(danmakuCache, cacheKey, SOUND_SUMMARY_CACHE_TTL_MS);
  if (cached) {
    void writeUsageLog({
      platform: "missevan",
      action: "danmaku_summary",
      soundId: Number(soundId),
      dramaTitle,
      episodeTitle,
      success: Boolean(cached.success),
      danmaku: Number(cached.danmaku ?? 0),
      userCount: Array.isArray(cached.users) ? cached.users.length : 0,
      accessDenied: Boolean(cached.accessDenied),
      cached: true,
      ...(cached.error ? { error: cached.error } : {}),
    });
    return {
      ...cached,
      drama_title: dramaTitle,
      episode_title: episodeTitle,
    };
  }

  try {
    const text = await fetchTextWithRetry(
      `https://www.missevan.com/sound/getdm?soundid=${soundId}`,
      2,
      250,
      { missevan: true }
    );
    const lines = text.split("\n").filter((line) => line.includes('<d p='));
    const users = new Set();

    lines.forEach((line) => {
      const match = line.match(/<d p="([^"]+)"/);
      if (match) {
        const uid = match[1].split(",")[6];
        if (uid) {
          users.add(uid);
        }
      }
    });

    const cachedResult = {
      success: true,
      sound_id: Number(soundId),
      danmaku: lines.length,
      users: [...users],
      accessDenied: false,
      error: "",
    };

    setCachedValue(danmakuCache, cacheKey, cachedResult);
    void writeUsageLog({
      platform: "missevan",
      action: "danmaku_summary",
      soundId: Number(soundId),
      dramaTitle,
      episodeTitle,
      success: true,
      danmaku: lines.length,
      userCount: users.size,
      accessDenied: false,
      cached: false,
    });

    return {
      ...cachedResult,
      drama_title: dramaTitle,
      episode_title: episodeTitle,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to fetch Missevan danmaku sound_id=${soundId}: ${message}`);
    const accessDenied =
      isAccessDeniedError(error) ||
      String(message).startsWith("ACCESS_DENIED_COOLDOWN:");
    void writeUsageLog({
      platform: "missevan",
      action: "danmaku_summary",
      soundId: Number(soundId),
      dramaTitle,
      episodeTitle,
      success: false,
      danmaku: 0,
      userCount: 0,
      accessDenied,
      cached: false,
      error: message,
    });

    return {
      success: false,
      sound_id: Number(soundId),
      drama_title: dramaTitle,
      episode_title: episodeTitle,
      danmaku: 0,
      users: [],
      accessDenied,
      error: message,
    };
  }
}

function normalizeManboDramaInfo(raw) {
  if (!raw) {
    return null;
  }

  const dramaId = String(raw.radioDramaIdStr ?? raw.radioDramaId ?? "").trim();
  const sets = Array.isArray(raw.setRespList) ? raw.setRespList : [];
  const viewCount = Number(pickFirstDefined(raw.watchCount, raw.watch_count) ?? 0);
  const price = Number(raw.price ?? 0);
  const memberPrice = Number(
    pickFirstDefined(raw.memberPrice, raw.member_price) ?? 0
  );
  const subscriptionCount = Number(
    pickFirstDefined(raw.favoriteCount, raw.favorite_count) ?? 0
  );
  const diamondValue = Number(
    pickFirstDefined(raw.diamondValue, raw.diamond_value) ?? 0
  );
  const vipFree = Number(pickFirstDefined(raw.vipFree, raw.vip_free) ?? 0);
  const dramaMeta = {
    isPaidDrama:
      Number(raw.payType ?? raw.setPayType ?? 0) === 1 ||
      price > 0 ||
      memberPrice > 0,
    freeMainCount: extractManboFreeMainCount(raw.desc) ?? 0,
  };
  const normalizedEpisodes = sets
    .map((set) => ({
      sound_id: String(set.setIdStr ?? set.setId ?? "").trim(),
      name: set.setTitle || set.setName || `Episode ${set.setNo ?? ""}`,
      need_pay: inferManboEpisodeNeedPay(set, dramaMeta),
      pay_type: Number(set.payType ?? set.setPayType ?? 0),
      vip_free: Number(set.vipFree ?? 0),
      price: Number(set.price ?? 0),
      member_price: Number(set.memberPrice ?? 0),
      set_no: Number(set.setNo ?? 0),
      play_count: Number(pickFirstDefined(set.watchCount, set.watch_count) ?? 0),
      comment_count: Number(
        pickFirstDefined(set.commentCount, set.comment_count) ?? 0
      ),
      type: Number(set.type ?? 0),
      is_buy: Number(set.isBuy ?? raw.isBuy ?? 0),
      platform: "manbo",
    }))
    .filter((episode) => isNumericId(episode.sound_id))
    .sort((a, b) => a.set_no - b.set_no);
  const isMember = isManboMemberDramaInfo({
    drama: {
      pay_type: Number(raw.payType ?? raw.setPayType ?? 0),
      price,
      member_price: memberPrice,
      vip_free: vipFree,
    },
    episodes: {
      episode: normalizedEpisodes,
    },
  });

  return {
    drama: {
      id: dramaId,
      name: raw.title || "",
      cover: raw.coverPic || raw.largePic || raw.sharePicUrl || "",
      price,
      view_count: viewCount,
      subscription_num: subscriptionCount,
      pay_count: normalizeOptionalFiniteNumber(raw.payCount),
      diamond_value: diamondValue,
      pay_type: Number(raw.payType ?? raw.setPayType ?? 0),
      member_price: memberPrice,
      vip_free: vipFree,
      is_member: isMember,
      member_listen_count: normalizeOptionalFiniteNumber(
        pickFirstDefined(raw.memberListenCount, raw.member_listen_count)
      ),
      free_main_count: dramaMeta.freeMainCount,
      platform: "manbo",
      source_type: "drama",
    },
    episodes: {
      episode: normalizedEpisodes,
    },
    platform: "manbo",
    dm_count: Number(raw.dmCount ?? 0),
  };
}

function normalizeManboCardFromDramaInfo(info) {
  const drama = info?.drama;
  if (!isNumericId(drama?.id)) {
    return null;
  }
  const revenueType = getManboRevenueType(info);

  const card = {
    id: drama.id,
    name: drama.name,
    cover: drama.cover,
    view_count: Number(drama.view_count ?? 0),
    playCountWan: formatPlayCountWan(drama.view_count),
    price: Number(drama.price ?? 0),
    sound_id: info?.episodes?.episode?.[0]?.sound_id || null,
    subscription_num: Number(drama.subscription_num ?? 0),
    pay_count: normalizeOptionalFiniteNumber(drama.pay_count),
    diamond_value: Number(drama.diamond_value ?? 0),
    is_member: Boolean(drama.is_member),
    member_listen_count: normalizeOptionalFiniteNumber(drama.member_listen_count),
    revenue_type: revenueType,
    checked: true,
    platform: "manbo",
  };
  return {
    ...card,
    payment_label: getManboPaymentLabel(card),
    content_type_label: getManboContentTypeLabel(drama),
  };
}

function resolveMissevanMemberPrice(priceValue, vipDiscountPriceValue) {
  const price = Number(priceValue ?? 0);
  const vipDiscountPrice = Number(vipDiscountPriceValue);
  if (Number.isFinite(vipDiscountPrice) && vipDiscountPrice > 0) {
    return vipDiscountPrice;
  }
  if (Number.isFinite(price) && price > 0) {
    return price;
  }
  return 0;
}

function buildManboIndexRecordFromDramaInfo(info) {
  const drama = info?.drama || {};
  if (!isNumericId(drama?.id)) {
    return null;
  }

  const name = String(drama.name ?? "").trim();
  if (!name) {
    return null;
  }

  return {
    dramaId: String(drama.id),
    name,
    normalizedName: normalizeManboIndexName(name),
    aliases: [],
    cover: String(drama.cover ?? "").trim(),
  };
}

function buildManboIndexSearchCard(record) {
  return {
    id: String(record.dramaId),
    name: record.name,
    cover: record.cover || "",
    checked: true,
    platform: "manbo",
    source_type: "index",
  };
}

function isManboMemberDramaInfo(info) {
  const drama = info?.drama || {};
  return (
    Number(drama.pay_type ?? 0) === 0 &&
    Number(drama.price ?? 0) === 0 &&
    Number(drama.member_price ?? 0) === 0 &&
    hasManboVipFreeMarker(info)
  );
}

function findCachedManboEpisodeBySetId(setId) {
  const normalizedSetId = String(setId ?? "").trim();
  if (!normalizedSetId) {
    return null;
  }

  for (const entry of manboDramaCache.values()) {
    const info = entry?.value;
    const drama = info?.drama;
    const episode = info?.episodes?.episode?.find(
      (item) => String(item?.sound_id ?? "").trim() === normalizedSetId
    );

    if (episode) {
      return {
        drama,
        episode,
      };
    }
  }

  return null;
}

function resolveManboEpisodeTitle(setId, episodeTitle = "") {
  const normalizedTitle = String(episodeTitle ?? "").trim();
  if (normalizedTitle) {
    return normalizedTitle;
  }

  const cachedEntry = findCachedManboEpisodeBySetId(setId);
  const cachedTitle = String(cachedEntry?.episode?.name ?? "").trim();
  return cachedTitle;
}

async function fetchManboDramaDetail(dramaId) {
  const normalizedDramaId = String(dramaId ?? "").trim();
  const cached = getCachedValue(
    manboDramaCache,
    normalizedDramaId,
    MANBO_DRAMA_CACHE_TTL_MS
  );
  if (cached) {
    return cached;
  }

  const payload = await fetchManboDramaPayload(normalizedDramaId);
  if (!payload) {
    return null;
  }

  const normalized = normalizeManboDramaInfo(payload);
  if (normalized?.drama?.id) {
    setCachedValue(manboDramaCache, normalized.drama.id, normalized);
  }

  return normalized;
}

async function fetchManboDramaPayload(dramaId) {
  const normalizedDramaId = String(dramaId ?? "").trim();
  if (!isNumericId(normalizedDramaId)) {
    return null;
  }

  let legacyPayload = null;
  try {
    legacyPayload = await fetchManboLegacyDramaPayload(normalizedDramaId);
  } catch (legacyErr) {
    const v530Fallback = await fetchManboV530DramaPayload(normalizedDramaId);
    if (v530Fallback) {
      return v530Fallback;
    }
    throw legacyErr;
  }

  if (!legacyPayload) {
    return await fetchManboV530DramaPayload(normalizedDramaId);
  }

  if (!shouldFetchManboMemberSupplement(legacyPayload)) {
    return legacyPayload;
  }

  const v530Payload = await fetchManboV530DramaPayload(normalizedDramaId);
  return mergeManboDramaMemberSupplement(legacyPayload, v530Payload);
}

async function fetchManboSetDetail(setId) {
  const normalizedSetId = String(setId ?? "").trim();
  if (!isNumericId(normalizedSetId)) {
    return null;
  }

  const cached = getCachedValue(manboSetCache, normalizedSetId, MANBO_SET_CACHE_TTL_MS);
  if (cached) {
    return cached;
  }

  const data = await fetchJsonWithRetry(
    `${MANBO_API_BASE}/dramaSetDetail?dramaSetId=${normalizedSetId}`
  );
  if (Number(data?.code) !== 200 || !data?.data) {
    return null;
  }

  setCachedValue(manboSetCache, normalizedSetId, data.data);
  return data.data;
}

async function fetchManboV530SetDetail(setId) {
  const normalizedSetId = String(setId ?? "").trim();
  if (!isNumericId(normalizedSetId)) {
    return null;
  }

  const cached = getCachedValue(manboSetV530Cache, normalizedSetId, MANBO_SET_CACHE_TTL_MS);
  if (cached) {
    return cached;
  }

  try {
    const v530Data = await fetchJsonWithRetry(
      `${MANBO_API_V530_BASE}/set/detail/new?radioDramaSetId=${normalizedSetId}`
    );
    if (Number(v530Data?.h?.code) === 200 && v530Data?.b) {
      setCachedValue(manboSetV530Cache, normalizedSetId, v530Data.b);
      return v530Data.b;
    }
  } catch (_v530Err) {
    return null;
  }

  return null;
}

async function fetchManboStatsSetDetail(setId) {
  const v530Detail = await fetchManboV530SetDetail(setId);
  if (v530Detail) {
    return v530Detail;
  }
  return fetchManboSetDetail(setId);
}

async function resolveManboDramaIdFromSetId(setId) {
  const setDetail = await fetchManboSetDetail(setId);
  const dramaId = String(
    setDetail?.radioDramaResp?.radioDramaIdStr ??
      setDetail?.radioDramaResp?.radioDramaId ??
      setDetail?.radioDramaId ??
      ""
  ).trim();

  if (!isNumericId(dramaId)) {
    return null;
  }

  const dramaInfo = await fetchManboDramaDetail(dramaId);
  return {
    dramaId,
    setId: String(setId),
    setDetail,
    dramaInfo,
  };
}

function isLikelyManboUrl(raw) {
  try {
    const url = new URL(raw);
    return /(^|\.)kilamanbo\.(com|world)$/i.test(url.hostname);
  } catch (error) {
    return false;
  }
}

function isLikelyManboShareUrl(raw) {
  try {
    const url = new URL(raw);
    return (
      (
        /(^|\.)hongdoulive\.com$/i.test(url.hostname) ||
        /(^|\.)kilamanbo\.(com|world)$/i.test(url.hostname)
      ) &&
      url.searchParams.has("_specific_parameter")
    );
  } catch (error) {
    return false;
  }
}

function parseManboUrl(raw) {
  try {
    const url = new URL(raw);

    if (!/(^|\.)kilamanbo\.(com|world)$/i.test(url.hostname)) {
      return null;
    }

    if (url.pathname.includes("/dramaDetail")) {
      const dramaId = String(url.searchParams.get("dramaId") ?? "").trim();
      if (isNumericId(dramaId)) {
        return {
          inputType: "drama_url",
          resolvedType: "drama",
          dramaId,
          sourceUrl: raw,
        };
      }
    }

    if (url.pathname.includes("/dramaSetDetail")) {
      const setId = String(url.searchParams.get("dramaSetId") ?? "").trim();
      if (isNumericId(setId)) {
        return {
          inputType: "set_url",
          resolvedType: "set",
          setId,
          sourceUrl: raw,
        };
      }
    }

    if (url.pathname.includes("/manbo/pc/detail")) {
      const dramaId = String(url.searchParams.get("id") ?? "").trim();
      if (isNumericId(dramaId)) {
        return {
          inputType: "drama_url",
          resolvedType: "drama",
          dramaId,
          sourceUrl: raw,
        };
      }
    }
  } catch (error) {
    return null;
  }

  return null;
}

function parseResolvedSharePayload(payload, raw) {
  const data = payload && typeof payload === "object" ? payload : null;
  if (!data) {
    return null;
  }

  let pathname = "";
  try {
    pathname = new URL(String(raw || "").trim()).pathname;
  } catch (error) {
    pathname = "";
  }

  const radioDramaId = String(data.radioDramaId ?? "").trim();
  if (isNumericId(radioDramaId)) {
    const setId = String(
      data.id ?? data.radioDramaSetId ?? data.dramaSetId ?? data.setId ?? ""
    ).trim();

    return {
      inputType: "share_url",
      resolvedType: "set",
      dramaId: radioDramaId,
      setId: isNumericId(setId) ? setId : "",
      sourceUrl: raw,
      payload: data,
    };
  }

  const collectId = String(data.collectId ?? "").trim();
  const directDramaId = String(data.id ?? "").trim();
  if (isNumericId(directDramaId) && isNumericId(collectId)) {
    return {
      inputType: "share_url",
      resolvedType: "drama",
      dramaId: directDramaId,
      setId: collectId,
      sourceUrl: raw,
      payload: data,
    };
  }

  const explicitDramaId = String(
    data.radioDramaIdStr ?? data.radioDramaId ?? data.dramaId ?? ""
  ).trim();
  if (isNumericId(explicitDramaId)) {
    return {
      inputType: "share_url",
      resolvedType: "drama",
      dramaId: explicitDramaId,
      setId: isNumericId(collectId) ? collectId : "",
      sourceUrl: raw,
      payload: data,
    };
  }

  const explicitSetId = String(
    data.radioDramaSetId ??
      data.dramaSetId ??
      data.setId ??
      data.dramaSetIdStr ??
      ""
  ).trim();
  if (isNumericId(explicitSetId)) {
    return {
      inputType: "share_url",
      resolvedType: "set",
      setId: explicitSetId,
      sourceUrl: raw,
      payload: data,
    };
  }

  const genericId = String(data.id ?? "").trim();
  const bizType = Number(data.bizType ?? 0);
  if (isNumericId(genericId) && /\/Activecard\/radioplay$/i.test(pathname)) {
    return {
      inputType: "share_url",
      resolvedType: "drama",
      dramaId: genericId,
      setId: isNumericId(collectId) ? collectId : "",
      sourceUrl: raw,
      payload: data,
    };
  }

  if (isNumericId(genericId)) {
    if (bizType === 105) {
      return {
        inputType: "share_url",
        resolvedType: "drama",
        dramaId: genericId,
        sourceUrl: raw,
        payload: data,
      };
    }

    if (bizType === 108 || bizType === 109) {
      return {
        inputType: "share_url",
        resolvedType: "set",
        setId: genericId,
        sourceUrl: raw,
        payload: data,
      };
    }

    return {
      inputType: "share_url",
      resolvedType: "unknown",
      id: genericId,
      sourceUrl: raw,
      payload: data,
    };
  }

  return null;
}

async function resolveManboItem(item) {
  const raw = String(item?.raw ?? "").trim();
  if (!raw) {
    return null;
  }

  const fromUrl = parseManboUrl(raw);
  if (fromUrl) {
    if (fromUrl.resolvedType === "drama") {
      return fromUrl;
    }

    const setResolution = await resolveManboDramaIdFromSetId(fromUrl.setId);
    if (setResolution?.dramaId) {
      return {
        ...fromUrl,
        dramaId: setResolution.dramaId,
      };
    }
  }

  if (isLikelyManboShareUrl(raw)) {
    const directShareData =
      item.resolvedShareData && typeof item.resolvedShareData === "object"
        ? item.resolvedShareData
        : null;
    const directShareDramaId = String(
      directShareData?.radioDramaId ??
        directShareData?.radioDramaIdStr ??
        directShareData?.dramaId ??
        ""
    ).trim();
    const directShareSetId = String(
      directShareData?.id ??
        directShareData?.radioDramaSetId ??
        directShareData?.dramaSetId ??
        directShareData?.setId ??
        ""
    ).trim();

    if (isNumericId(directShareDramaId)) {
      return {
        inputType: "share_url",
        resolvedType: "drama",
        dramaId: directShareDramaId,
        setId: isNumericId(directShareSetId) ? directShareSetId : "",
        sourceUrl: raw,
        payload: directShareData,
      };
    }

    const shareResult = parseResolvedSharePayload(item.resolvedShareData, raw);
    if (shareResult) {
      if (shareResult.resolvedType === "drama") {
        return shareResult;
      }

      if (shareResult.resolvedType === "set") {
        if (shareResult.dramaId && isNumericId(shareResult.dramaId)) {
          return {
            ...shareResult,
            resolvedType: "drama",
            dramaId: String(shareResult.dramaId),
          };
        }

        const setResolution = await resolveManboDramaIdFromSetId(shareResult.setId);
        if (setResolution?.dramaId) {
          return {
            ...shareResult,
            dramaId: setResolution.dramaId,
          };
        }
      }

      if (shareResult.resolvedType === "unknown") {
        const setResolution = await resolveManboDramaIdFromSetId(shareResult.id);
        if (setResolution?.dramaId) {
          return {
            ...shareResult,
            resolvedType: "set",
            setId: Number(shareResult.id),
            dramaId: setResolution.dramaId,
          };
        }

        const dramaInfo = await fetchManboDramaDetail(shareResult.id);
        if (dramaInfo?.drama?.id) {
          return {
            ...shareResult,
            resolvedType: "drama",
            dramaId: dramaInfo.drama.id,
          };
        }
      }
    }

    return null;
  }

  if (isNumericId(raw)) {
    const numericId = raw;
    const dramaInfo = await fetchManboDramaDetail(numericId);
    if (dramaInfo?.drama?.id) {
      return {
        inputType: "drama_id",
        resolvedType: "drama",
        dramaId: dramaInfo.drama.id,
        sourceUrl: raw,
      };
    }

    const setResolution = await resolveManboDramaIdFromSetId(numericId);
    if (setResolution?.dramaId) {
      return {
        inputType: "set_id",
        resolvedType: "set",
        setId: numericId,
        dramaId: setResolution.dramaId,
        sourceUrl: raw,
      };
    }
  }

  if (isLikelyManboUrl(raw)) {
    return null;
  }

  return null;
}

async function fetchManboSetSummary(setId) {
  const cachedEpisode = findCachedManboEpisodeBySetId(setId);
  if (cachedEpisode) {
    const watchCount = Number(cachedEpisode.episode?.play_count ?? 0);
    if (watchCount > 0) {
      return {
        sound_id: String(setId),
        success: true,
        view_count: watchCount,
        viewCountWan: formatPlayCountWan(watchCount),
        playCountFailed: false,
        accessDenied: false,
        error: "",
      };
    }
  }

  const detail = await fetchManboStatsSetDetail(setId);
  const watchCount = Number(detail?.watchCount ?? 0);

  return {
    sound_id: String(setId),
    success: Boolean(detail),
    view_count: watchCount,
    viewCountWan: formatPlayCountWan(watchCount),
    playCountFailed: !detail,
    accessDenied: false,
    error: detail ? "" : "Set not found",
  };
}

async function fetchManboDanmakuSummary(setId, dramaTitle, episodeTitle = "") {
  const resolvedEpisodeTitle = resolveManboEpisodeTitle(setId, episodeTitle);
  const cached = getCachedValue(
    manboDanmakuCache,
    setId,
    MANBO_DANMAKU_CACHE_TTL_MS
  );
  if (cached) {
    void writeUsageLog({
      platform: "manbo",
      action: "danmaku_summary",
      soundId: String(setId),
      dramaTitle,
      episodeTitle: resolvedEpisodeTitle,
      success: Boolean(cached.success),
      danmaku: Number(cached.danmaku ?? 0),
      userCount: Array.isArray(cached.users) ? cached.users.length : 0,
      accessDenied: Boolean(cached.accessDenied),
      cached: true,
      ...(cached.error ? { error: cached.error } : {}),
    });
    return {
      ...cached,
      drama_title: dramaTitle,
      episode_title: resolvedEpisodeTitle,
    };
  }

  const inFlight = manboDanmakuInFlight.get(String(setId));
  if (inFlight) {
    const result = await inFlight;
    return {
      ...result,
      drama_title: dramaTitle,
      episode_title: resolvedEpisodeTitle || String(result?.episode_title ?? "").trim(),
    };
  }

  const summaryPromise = (async () => {
    const startedAt = Date.now();

    try {
      const pageSize = 200;
      const users = new Set();
      const pageFetchOptions = {
        timeoutMs: MANBO_FETCH_TIMEOUT_MS,
      };
      const firstPageData = await fetchJsonWithRetry(
        `${MANBO_API_BASE}/getDanmaKuPgList?pageSize=${pageSize}&dramaSetId=${setId}&pageNo=1`,
        2,
        250,
        pageFetchOptions
      );
      const firstPayload = firstPageData?.data || {};
      const firstList = Array.isArray(firstPayload.list) ? firstPayload.list : [];
      const totalDanmaku = Math.max(
        0,
        Number(firstPayload.count ?? firstList.length ?? 0)
      );
      const totalPages =
        totalDanmaku > 0 ? Math.ceil(totalDanmaku / pageSize) : 1;

      firstList.forEach((item) => {
        if (item?.eid) {
          users.add(String(item.eid));
        }
      });

      const remainingPages = Array.from(
        { length: Math.max(0, totalPages - 1) },
        (_, index) => index + 2
      );

      await runWithConcurrency(
        remainingPages,
        MANBO_DANMAKU_PAGE_CONCURRENCY,
        async (pageNo) => {
          const data = await fetchJsonWithRetry(
            `${MANBO_API_BASE}/getDanmaKuPgList?pageSize=${pageSize}&dramaSetId=${setId}&pageNo=${pageNo}`,
            2,
            250,
            pageFetchOptions
          );
          const payload = data?.data || {};
          const list = Array.isArray(payload.list) ? payload.list : [];
          list.forEach((item) => {
            if (item?.eid) {
              users.add(String(item.eid));
            }
          });
        }
      );

      const summary = {
        success: true,
        sound_id: String(setId),
        danmaku: totalDanmaku,
        users: [...users],
        accessDenied: false,
        error: "",
      };

      setCachedValue(
        manboDanmakuCache,
        setId,
        summary,
        MANBO_DANMAKU_CACHE_MAX_ENTRIES
      );
      void writeUsageLog({
        platform: "manbo",
        action: "danmaku_summary",
        soundId: String(setId),
        dramaTitle,
        episodeTitle: resolvedEpisodeTitle,
        success: true,
        danmaku: totalDanmaku,
        userCount: users.size,
        accessDenied: false,
        cached: false,
        pageConcurrency: MANBO_DANMAKU_PAGE_CONCURRENCY,
        totalPages,
        durationMs: Date.now() - startedAt,
      });

      return {
        ...summary,
        drama_title: dramaTitle,
        episode_title: resolvedEpisodeTitle,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to fetch Manbo danmaku set_id=${setId}: ${message}`);
      const accessDenied =
        isAccessDeniedError(error) ||
        String(message).startsWith("ACCESS_DENIED_COOLDOWN:");
      void writeUsageLog({
        platform: "manbo",
        action: "danmaku_summary",
        soundId: String(setId),
        dramaTitle,
        episodeTitle: resolvedEpisodeTitle,
        success: false,
        danmaku: 0,
        userCount: 0,
        accessDenied,
        cached: false,
        error: message,
        pageConcurrency: MANBO_DANMAKU_PAGE_CONCURRENCY,
        durationMs: Date.now() - startedAt,
      });

      return {
        success: false,
        sound_id: String(setId),
        drama_title: dramaTitle,
        episode_title: resolvedEpisodeTitle,
        danmaku: 0,
        users: [],
        accessDenied,
        error: message,
      };
    } finally {
      manboDanmakuInFlight.delete(String(setId));
    }
  })();

  manboDanmakuInFlight.set(String(setId), summaryPromise);
  return summaryPromise;
}

async function runWithConcurrency(items, limit, worker) {
  const queue = Array.isArray(items) ? items : [];
  const concurrency = Math.max(1, Number(limit) || 1);
  let nextIndex = 0;

  const runners = Array.from(
    { length: Math.min(concurrency, queue.length) },
    async () => {
      while (nextIndex < queue.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        await worker(queue[currentIndex], currentIndex);
      }
    }
  );

  await Promise.all(runners);
}

function buildIdDramaMap(episodes) {
  const dramaMap = new Map();
  episodes.forEach((episode) => {
    const dramaId = String(episode?.drama_id ?? "").trim();
    const title = String(episode?.drama_title ?? "").trim() || "Unknown";
    const key = dramaId || title;
    if (!dramaMap.has(key)) {
      dramaMap.set(key, {
        dramaId,
        title,
        selectedEpisodeCount: 0,
        danmaku: 0,
        userSet: new Set(),
      });
    }
    dramaMap.get(key).selectedEpisodeCount += 1;
  });
  return dramaMap;
}

function buildOverflowEpisodeKey(dramaId, episodeTitle) {
  const normalizedDramaId = String(dramaId ?? "").trim();
  const normalizedEpisodeTitle = String(episodeTitle ?? "").trim();
  return `${normalizedDramaId}-${normalizedEpisodeTitle}`;
}

async function isLikelyManboDanmakuOverflow(setId, danmakuCount) {
  const normalizedSetId = String(setId ?? "").trim();
  if (!normalizedSetId) {
    return false;
  }

  try {
    const setDetail = await fetchManboStatsSetDetail(normalizedSetId);
    const apiCommentCount = Number(setDetail?.commentCount ?? 0);
    return apiCommentCount > 0 && Number(danmakuCount ?? 0) < apiCommentCount * 0.8;
  } catch (_detailErr) {
    return false;
  }
}

function buildPlayCountDramaMap(episodes) {
  const dramaMap = new Map();
  episodes.forEach((episode) => {
    const title = String(episode?.drama_title ?? "").trim() || "Unknown";
    if (!dramaMap.has(title)) {
      dramaMap.set(title, {
        title,
        selectedEpisodeCount: 0,
        playCountTotal: 0,
        playCountFailed: false,
      });
    }
    dramaMap.get(title).selectedEpisodeCount += 1;
  });
  return dramaMap;
}

function createRevenueSummary(results) {
  const safeResults = Array.isArray(results) ? results : [];
  const totalPaidUserSet = new Set();
  let totalPaidCount = 0;
  let totalDanmakuPaidUserCount = 0;
  let totalViewCount = 0;
  let rewardTotal = 0;
  let rewardNum = 0;
  let hasRewardNum = false;
  let estimatedRevenueYuan = 0;
  let minRevenueYuan = null;
  let maxRevenueYuan = null;
  let hasRange = false;
  let failed = false;
  let platform = safeResults[0]?.platform || "";
  let currencyUnit = platform === "manbo" ? "红豆" : "钻石";
  let allPayCount = safeResults.length > 0;
  let hasPayCount = false;
  let hasDanmakuIds = false;

  safeResults.forEach((item) => {
    platform = platform || item?.platform || "";
    currencyUnit = platform === "manbo" ? "红豆" : "钻石";
    const paidCountSource = String(item?.paidCountSource || "");
    if (paidCountSource === "pay_count") {
      hasPayCount = true;
      totalPaidCount += Number(item?.payCount ?? item?.paidUserCount ?? 0);
    } else {
      allPayCount = false;
      hasDanmakuIds = true;
    }
    (Array.isArray(item?.paidUserIds) ? item.paidUserIds : []).forEach((uid) => {
      if (uid != null && uid !== "") {
        totalPaidUserSet.add(String(uid));
      }
    });
    totalViewCount += Number(item?.viewCount ?? 0);
    rewardTotal += platform === "manbo"
      ? Number(item?.diamondValue ?? 0)
      : Number(item?.rewardCoinTotal ?? 0);
    const normalizedRewardNum = normalizeOptionalFiniteNumber(item?.rewardNum);
    if (normalizedRewardNum != null) {
      rewardNum += normalizedRewardNum;
      hasRewardNum = true;
    }
    failed = failed || Boolean(item?.failed);
    const estimatedAmount = Number(item?.estimatedRevenueYuan ?? 0);
    estimatedRevenueYuan += estimatedAmount;

    const itemHasRange =
      Number.isFinite(Number(item?.minRevenueYuan)) &&
      Number.isFinite(Number(item?.maxRevenueYuan));
    if (itemHasRange) {
      if (!hasRange) {
        minRevenueYuan = estimatedRevenueYuan - estimatedAmount;
        maxRevenueYuan = estimatedRevenueYuan - estimatedAmount;
      }
      hasRange = true;
      minRevenueYuan = Number(minRevenueYuan ?? 0) + Number(item.minRevenueYuan ?? 0);
      maxRevenueYuan = Number(maxRevenueYuan ?? 0) + Number(item.maxRevenueYuan ?? 0);
    } else if (hasRange) {
      minRevenueYuan = Number(minRevenueYuan ?? 0) + estimatedAmount;
      maxRevenueYuan = Number(maxRevenueYuan ?? 0) + estimatedAmount;
    }
  });

  const priceItems = safeResults.filter((item) => item?.includeInSummaryPrice);
  const hasSummaryPrice = !failed && priceItems.length > 0;
  const titlePriceTotal = hasSummaryPrice
    ? priceItems.reduce((sum, item) => sum + Number(item?.titlePrice ?? 0), 0)
    : null;
  const memberPriceItems = priceItems.filter((item) => {
    return Number.isFinite(Number(item?.titleMemberPrice))
      && Number(item?.titleMemberPrice) > 0;
  });
  const titleMemberPriceTotal = hasSummaryPrice && memberPriceItems.length > 0
    ? memberPriceItems.reduce((sum, item) => sum + Number(item?.titleMemberPrice ?? 0), 0)
    : null;

  const baseTitle = `汇总 / 已选 ${safeResults.length} 部`;
  let summaryTitle = baseTitle;
  if (hasSummaryPrice) {
    summaryTitle = titleMemberPriceTotal != null
      ? `${baseTitle}，总价 ${titlePriceTotal}（会员 ${titleMemberPriceTotal}）${currencyUnit}`
      : `${baseTitle}，总价 ${titlePriceTotal} ${currencyUnit}`;
  }

  totalDanmakuPaidUserCount = totalPaidUserSet.size;
  const paidCountSourceSummary = allPayCount
    ? "pay_count"
    : hasPayCount
      ? "mixed"
      : "danmaku_ids";

  return {
    platform,
    currencyUnit,
    selectedDramaCount: safeResults.length,
    totalPaidUserCount: paidCountSourceSummary === "pay_count"
      ? totalPaidCount
      : paidCountSourceSummary === "danmaku_ids"
        ? totalDanmakuPaidUserCount
        : null,
    totalPayCount: hasPayCount ? totalPaidCount : null,
    totalDanmakuPaidUserCount: hasDanmakuIds ? totalDanmakuPaidUserCount : null,
    paidCountSourceSummary,
    totalViewCount,
    rewardTotal,
    rewardNum: platform === "missevan" && hasRewardNum ? rewardNum : null,
    hasSummaryPrice,
    titlePriceTotal,
    titleMemberPriceTotal,
    estimatedRevenueYuan,
    minRevenueYuan: hasRange ? minRevenueYuan : null,
    maxRevenueYuan: hasRange ? maxRevenueYuan : null,
    failed,
    summaryTitle,
  };
}

function compactRevenueResults(results) {
  return (Array.isArray(results) ? results : []).map((item) => {
    const { paidUserIds: _paidUserIds, ...compactItem } = item || {};
    return compactItem;
  });
}

function getManboRevenueType(info) {
  const drama = info?.drama || {};
  const episodes = Array.isArray(info?.episodes?.episode) ? info.episodes.episode : [];
  const isMemberDrama = isManboMemberDramaInfo(info);
  const hasPaidEpisodes = episodes.some((episode) => Number(episode?.price ?? 0) > 0);
  if (isMemberDrama) {
    return "member";
  }
  if (
    Number(drama.pay_type ?? 0) !== 1 &&
    hasPaidEpisodes
  ) {
    return "episode";
  }
  if (
    Number(drama.pay_type ?? 0) === 1
  ) {
    return "season";
  }
  return "unknown";
}

function getManboRevenueEpisodes(info, revenueType) {
  const episodes = Array.isArray(info?.episodes?.episode) ? info.episodes.episode : [];
  if (revenueType === "member") {
    return episodes.filter((episode) => Number(episode?.vip_free ?? 0) === 1);
  }
  if (revenueType === "season") {
    return episodes.filter((episode) => Number(episode?.pay_type ?? 0) === 1);
  }
  if (revenueType === "episode") {
    return episodes.filter((episode) => Number(episode?.price ?? 0) > 0);
  }
  return [];
}

function resolveManboSeasonPricing(dramaInfo) {
  const drama = dramaInfo?.drama || {};
  const titlePrice = Math.max(0, Number(drama.price ?? 0));
  const memberPriceCandidate = Math.max(0, Number(drama.member_price ?? 0));
  const titleMemberPrice = memberPriceCandidate > 0
    ? memberPriceCandidate
    : titlePrice;
  const hasDiscountRange = titlePrice > 0 && memberPriceCandidate > 0 && titleMemberPrice < titlePrice;

  return {
    titlePrice,
    titleMemberPrice,
    hasDiscountRange,
    includeInSummaryPrice: titlePrice > 0,
  };
}

function getManboRevenueSubtitle(title, dramaInfo, revenueType, episodes) {
  if (revenueType === "member") {
    return `${title} / 会员剧（仅计算投喂）`;
  }
  if (revenueType === "season") {
    const seasonPricing = resolveManboSeasonPricing(dramaInfo);
    if (seasonPricing.hasDiscountRange) {
      return `${title} / 全季${seasonPricing.titlePrice}（折后${seasonPricing.titleMemberPrice}）红豆`;
    }
    return `${title} / 全季${seasonPricing.titlePrice}红豆`;
  }
  if (revenueType === "episode") {
    const prices = [...new Set(
      episodes.map((episode) => Number(episode?.price ?? 0)).filter((price) => price > 0)
    )];
    return prices.length === 1
      ? `${title} / 每集${prices[0]}红豆`
      : `${title} / 分集付费红豆`;
  }
  return `${title} / 暂不支持收益预估`;
}

function getManboPayCount(info) {
  return normalizeOptionalFiniteNumber(info?.drama?.pay_count);
}

function shouldUseManboOfficialPayCount(info, revenueType) {
  const payCount = getManboPayCount(info);
  return revenueType !== "episode" && revenueType !== "member" && Number(payCount ?? 0) > 0;
}

async function finalizeCancelledTask(task, patch = {}) {
  updateStatsTask(task, {
    status: "cancelled",
    currentAction: patch.currentAction || "统计已取消",
    result: patch.result ?? task.result ?? null,
    ...patch,
  });
}

function initializeRevenueProgress(task, dramaIds) {
  const normalizedDramaIds = Array.isArray(dramaIds) ? dramaIds : [];
  task.progressTotalUnits = Math.max(1, normalizedDramaIds.length);
  task.progressCompletedUnits = 0;
}

function setRevenueProgress(task, completedUnits, currentAction) {
  task.progressCompletedUnits = Math.max(
    0,
    Math.min(Number(completedUnits ?? 0) || 0, Number(task.progressTotalUnits ?? 0) || 0)
  );
  updateStatsTask(task, {
    progress: task.progressTotalUnits > 0
      ? Math.floor((task.progressCompletedUnits / task.progressTotalUnits) * 100)
      : 100,
    currentAction,
  });
}

function advanceRevenueProgress(task, units, currentAction) {
  const nextCompletedUnits = (Number(task.progressCompletedUnits ?? 0) || 0)
    + Math.max(0, Number(units ?? 0) || 0);
  setRevenueProgress(task, nextCompletedUnits, currentAction);
}

function createRevenueDramaUnit(task, title, episodeCount, stageUnits = 2) {
  const normalizedEpisodeCount = Math.max(0, Number(episodeCount ?? 0) || 0);
  const normalizedStageUnits = Math.max(1, Number(stageUnits ?? 0) || 0);
  return {
    title,
    totalEpisodes: normalizedEpisodeCount,
    stageUnits: normalizedStageUnits,
    totalUnits: normalizedStageUnits + normalizedEpisodeCount,
    startCompletedUnits: Number(task.progressCompletedUnits ?? 0) || 0,
  };
}

function completeRevenueDramaUnits(task, dramaUnit, currentAction) {
  if (!dramaUnit) {
    return;
  }
  const consumedUnits = (Number(task.progressCompletedUnits ?? 0) || 0)
    - Number(dramaUnit.startCompletedUnits ?? 0);
  const remainingUnits = Math.max(0, Number(dramaUnit.totalUnits ?? 0) - consumedUnits);
  if (remainingUnits > 0) {
    advanceRevenueProgress(task, remainingUnits, currentAction);
    return;
  }
  updateStatsTask(task, {
    currentAction,
  });
}

async function executeMissevanIdTask(task) {
  const episodes = Array.isArray(task.episodes) ? task.episodes : [];
  const dramaMap = buildIdDramaMap(episodes);
  const allUsers = new Set();
  const suspectedOverflowEpisodes = new Set();

  updateStatsTask(task, {
    status: "running",
    currentAction: "开始统计弹幕与去重 ID",
    progress: 0,
    totalDanmaku: 0,
    totalUsers: 0,
  });

  await refreshMissevanCooldownState();
  if (isInAccessDeniedCooldown()) {
    task.accessDenied = true;
    return updateStatsTask(task, {
      status: "completed",
      progress: 100,
      currentAction: "访问受限",
      totalUsers: 0,
      result: {
        idResults: Array.from(dramaMap.values()).map((drama) => ({
          dramaId: drama.dramaId,
          title: drama.title,
          selectedEpisodeCount: drama.selectedEpisodeCount,
          danmaku: drama.danmaku,
          users: drama.userSet.size,
        })),
        suspectedOverflowEpisodes: [],
        totalDanmaku: 0,
        totalUsers: 0,
        idSelectedEpisodeCount: task.totalCount,
      },
    });
  }

  await runWithConcurrency(episodes, 1, async (episode) => {
    if (task.cancelled || task.accessDenied) {
      return;
    }
    const soundId = Number(episode?.sound_id ?? 0);
    const dramaId = String(episode?.drama_id ?? "").trim();
    const dramaTitle = String(episode?.drama_title ?? "").trim() || "Unknown";
    const episodeTitle = String(episode?.episode_title ?? episode?.name ?? "").trim();
    const durationMs = Number(episode?.duration ?? 0);
    try {
      const result = await fetchDanmakuSummary(soundId, dramaTitle, episodeTitle);
      if (result.success) {
        const drama = dramaMap.get(dramaId || dramaTitle);
        if (drama) {
          drama.danmaku += Number(result.danmaku ?? 0);
          result.users.forEach((uid) => {
            drama.userSet.add(uid);
            allUsers.add(uid);
          });
        }
        task.totalDanmaku += Number(result.danmaku ?? 0);
        if (isMissevanLikelyDanmakuOverflow({
          durationMs,
          danmaku: result.danmaku,
        })) {
          suspectedOverflowEpisodes.add(
            buildOverflowEpisodeKey(dramaId, episodeTitle)
          );
        }
      } else {
        task.failedCount += 1;
        if (result.accessDenied) {
          task.accessDenied = true;
          return;
        }
      }
    } catch (error) {
      task.failedCount += 1;
      if (isMissevanAccessDenied(error)) {
        task.accessDenied = true;
        return;
      }
    }
    task.completedCount += 1;
    updateStatsTask(task, {
      progress: task.totalCount > 0
        ? Math.floor((task.completedCount / task.totalCount) * 100)
        : 100,
      currentAction: `统计 ID ${task.completedCount}/${task.totalCount}`,
      totalUsers: allUsers.size,
    });
  });

  if (task.cancelled) {
    return finalizeCancelledTask(task, {
      totalUsers: allUsers.size,
    });
  }

  updateStatsTask(task, {
    status: "completed",
    progress: 100,
    currentAction: task.accessDenied
      ? "访问受限"
      : task.failedCount > 0
        ? `统计完成，跳过 ${task.failedCount} 个分集`
        : "统计完成",
    totalUsers: allUsers.size,
    result: {
      idResults: Array.from(dramaMap.values()).map((drama) => ({
        dramaId: drama.dramaId,
        title: drama.title,
        selectedEpisodeCount: drama.selectedEpisodeCount,
        danmaku: drama.danmaku,
        users: drama.userSet.size,
      })),
      suspectedOverflowEpisodes: Array.from(suspectedOverflowEpisodes),
      totalDanmaku: task.totalDanmaku,
      totalUsers: allUsers.size,
      idSelectedEpisodeCount: task.totalCount,
    },
  });
}

async function executeManboIdTask(task) {
  const episodes = Array.isArray(task.episodes) ? task.episodes : [];
  const dramaMap = buildIdDramaMap(episodes);
  const allUsers = new Set();
  const suspectedOverflowEpisodes = new Set();

  updateStatsTask(task, {
    status: "running",
    currentAction: "开始统计弹幕与去重 ID",
    progress: 0,
    totalDanmaku: 0,
    totalUsers: 0,
  });

  await runWithConcurrency(
    episodes,
    MANBO_STATS_EPISODE_CONCURRENCY,
    async (episode) => {
      if (task.cancelled) {
        return;
      }
      const setId = String(episode?.sound_id ?? "").trim();
      const dramaId = String(episode?.drama_id ?? "").trim();
      const dramaTitle = String(episode?.drama_title ?? "").trim() || "Unknown";
      const episodeTitle = String(episode?.episode_title ?? episode?.name ?? "").trim();
      try {
        const result = await fetchManboDanmakuSummary(setId, dramaTitle, episodeTitle);
        if (result.success) {
          const drama = dramaMap.get(dramaId || dramaTitle);
          if (drama) {
            drama.danmaku += Number(result.danmaku ?? 0);
            result.users.forEach((uid) => {
              drama.userSet.add(uid);
              allUsers.add(uid);
            });
          }
          task.totalDanmaku += Number(result.danmaku ?? 0);
          if (await isLikelyManboDanmakuOverflow(setId, result.danmaku)) {
            suspectedOverflowEpisodes.add(
              buildOverflowEpisodeKey(dramaId, episodeTitle)
            );
          }
        } else {
          task.failedCount += 1;
          if (result.accessDenied) {
            task.accessDenied = true;
          }
        }
      } catch (error) {
        task.failedCount += 1;
        if (isAccessDeniedError(error)) {
          task.accessDenied = true;
        }
      }
      task.completedCount += 1;
      updateStatsTask(task, {
        progress: task.totalCount > 0
          ? Math.floor((task.completedCount / task.totalCount) * 100)
          : 100,
        currentAction: `统计 ID ${task.completedCount}/${task.totalCount}`,
        totalUsers: allUsers.size,
      });
    }
  );

  if (task.cancelled) {
    return finalizeCancelledTask(task, {
      totalUsers: allUsers.size,
    });
  }

  updateStatsTask(task, {
    status: "completed",
    progress: 100,
    currentAction: task.accessDenied
      ? "访问受限"
      : task.failedCount > 0
        ? `统计完成，跳过 ${task.failedCount} 个分集`
        : "统计完成",
    totalUsers: allUsers.size,
    result: {
      idResults: Array.from(dramaMap.values()).map((drama) => ({
        dramaId: drama.dramaId,
        title: drama.title,
        selectedEpisodeCount: drama.selectedEpisodeCount,
        danmaku: drama.danmaku,
        users: drama.userSet.size,
      })),
      suspectedOverflowEpisodes: Array.from(suspectedOverflowEpisodes),
      totalDanmaku: task.totalDanmaku,
      totalUsers: allUsers.size,
      idSelectedEpisodeCount: task.totalCount,
    },
  });
}

async function executeMissevanPlayCountTask(task) {
  const episodes = Array.isArray(task.episodes) ? task.episodes : [];
  const dramaMap = buildPlayCountDramaMap(episodes);

  updateStatsTask(task, {
    status: "running",
    currentAction: "开始统计播放量",
    progress: 0,
  });

  await refreshMissevanCooldownState();
  if (isInAccessDeniedCooldown()) {
    task.accessDenied = true;
    return updateStatsTask(task, {
      status: "completed",
      progress: 100,
      currentAction: "访问受限",
      result: {
        playCountResults: Array.from(dramaMap.values()).map((drama) => ({
          title: drama.title,
          selectedEpisodeCount: drama.selectedEpisodeCount,
          playCountTotal: drama.playCountTotal,
          playCountFailed: true,
        })),
        playCountSelectedEpisodeCount: task.totalCount,
        playCountTotal: 0,
        playCountFailed: true,
      },
    });
  }

  for (const episode of episodes) {
    if (task.cancelled || task.accessDenied) {
      break;
    }
    const soundId = Number(episode?.sound_id ?? 0);
    const dramaTitle = String(episode?.drama_title ?? "").trim() || "Unknown";
    try {
      const summary = await fetchSoundSummary(soundId);
      const drama = dramaMap.get(dramaTitle);
      if (drama) {
        if (!summary || summary.playCountFailed) {
          drama.playCountFailed = true;
          if (summary?.accessDenied) {
            task.accessDenied = true;
            break;
          }
        } else {
          drama.playCountTotal += Number(summary.view_count ?? 0);
        }
      }
    } catch (error) {
      const drama = dramaMap.get(dramaTitle);
      if (drama) {
        drama.playCountFailed = true;
      }
      if (isMissevanAccessDenied(error)) {
        task.accessDenied = true;
        break;
      }
      task.failedCount += 1;
    }
    task.completedCount += 1;
    updateStatsTask(task, {
      progress: task.totalCount > 0
        ? Math.floor((task.completedCount / task.totalCount) * 100)
        : 100,
      currentAction: `统计播放量 ${task.completedCount}/${task.totalCount}`,
    });
  }

  if (task.cancelled) {
    return finalizeCancelledTask(task);
  }

  const playCountResults = Array.from(dramaMap.values()).map((drama) => ({
    title: drama.title,
    selectedEpisodeCount: drama.selectedEpisodeCount,
    playCountTotal: drama.playCountTotal,
    playCountFailed: drama.playCountFailed,
  }));
  const playCountTotal = playCountResults.reduce((sum, episode) => {
    return episode.playCountFailed ? sum : sum + Number(episode.playCountTotal ?? 0);
  }, 0);
  const playCountFailed = playCountResults.some((item) => item.playCountFailed);

  updateStatsTask(task, {
    status: "completed",
    progress: 100,
    currentAction: task.accessDenied
      ? "访问受限"
      : "播放量统计完成",
    result: {
      playCountResults,
      playCountSelectedEpisodeCount: task.totalCount,
      playCountTotal,
      playCountFailed,
    },
  });
}

async function executeManboPlayCountTask(task) {
  const episodes = Array.isArray(task.episodes) ? task.episodes : [];
  const dramaMap = buildPlayCountDramaMap(episodes);

  updateStatsTask(task, {
    status: "running",
    currentAction: "开始统计播放量",
    progress: 0,
  });

  for (const episode of episodes) {
    if (task.cancelled) {
      break;
    }
    const setId = String(episode?.sound_id ?? "").trim();
    const dramaTitle = String(episode?.drama_title ?? "").trim() || "Unknown";
    try {
      const summary = await fetchManboSetSummary(setId);
      const drama = dramaMap.get(dramaTitle);
      if (drama) {
        if (!summary || summary.playCountFailed) {
          drama.playCountFailed = true;
        } else {
          drama.playCountTotal += Number(summary.view_count ?? 0);
        }
      }
    } catch (error) {
      const drama = dramaMap.get(dramaTitle);
      if (drama) {
        drama.playCountFailed = true;
      }
      task.failedCount += 1;
    }
    task.completedCount += 1;
    updateStatsTask(task, {
      progress: task.totalCount > 0
        ? Math.floor((task.completedCount / task.totalCount) * 100)
        : 100,
      currentAction: `统计播放量 ${task.completedCount}/${task.totalCount}`,
    });
  }

  if (task.cancelled) {
    return finalizeCancelledTask(task);
  }

  const playCountResults = Array.from(dramaMap.values()).map((drama) => ({
    title: drama.title,
    selectedEpisodeCount: drama.selectedEpisodeCount,
    playCountTotal: drama.playCountTotal,
    playCountFailed: drama.playCountFailed,
  }));
  const playCountTotal = playCountResults.reduce((sum, episode) => {
    return episode.playCountFailed ? sum : sum + Number(episode.playCountTotal ?? 0);
  }, 0);
  const playCountFailed = playCountResults.some((item) => item.playCountFailed);

  updateStatsTask(task, {
    status: "completed",
    progress: 100,
    currentAction: task.failedCount > 0
      ? `统计完成，跳过 ${task.failedCount} 个分集`
      : "播放量统计完成",
    result: {
      playCountResults,
      playCountSelectedEpisodeCount: task.totalCount,
      playCountTotal,
      playCountFailed,
    },
  });
}

async function executeUnsupportedPlayCountTask(task) {
  updateStatsTask(task, {
    status: "completed",
    progress: 100,
    currentAction: "Manbo 暂不支持播放量统计",
    failedCount: task.totalCount,
    result: {
      playCountResults: [],
      playCountSelectedEpisodeCount: task.totalCount,
      playCountTotal: 0,
      playCountFailed: true,
    },
  });
}

async function executeMissevanRevenueTask(task) {
  const dramaIds = Array.isArray(task.dramaIds) ? task.dramaIds : [];
  const results = [];
  const suspectedOverflowEpisodes = new Set();
  initializeRevenueProgress(task, dramaIds);

  updateStatsTask(task, {
    status: "running",
    currentAction: "开始最低收益预估",
    progress: 0,
  });

  await refreshMissevanCooldownState();
  if (isInAccessDeniedCooldown()) {
    task.accessDenied = true;
    return updateStatsTask(task, {
      status: "completed",
      progress: 100,
      currentAction: "访问受限",
      result: {
        revenueResults: results,
        revenueSummary: {
          ...createRevenueSummary(results),
          suspectedOverflowEpisodes: [],
        },
      },
    });
  }

  for (const dramaIdValue of dramaIds) {
    if (task.cancelled || task.accessDenied) {
      break;
    }
    const dramaId = Number(dramaIdValue);
    let title = `Drama ${dramaId}`;
    let dramaUnit = null;
    try {
      const dramaInfo = await fetchDramaInfo(dramaId);
      title = dramaInfo?.drama?.name || title;
      const viewCount = Number(dramaInfo?.drama?.view_count ?? 0);
      const price = Number(dramaInfo?.drama?.price ?? 0);
      const memberPrice = Number(dramaInfo?.drama?.member_price ?? 0);
      const rewardMeta = await fetchRewardDetailMeta(dramaId).catch(() => null);
      const rewardNum = normalizeOptionalFiniteNumber(rewardMeta?.reward_num);
      const isMember = Boolean(dramaInfo?.drama?.is_member) || Number(dramaInfo?.drama?.vip ?? 0) === 1;
      const vipOnlyReward = isMember;
      const paidEpisodes = dramaInfo?.episodes?.episode?.filter((episode) => {
        return Number(episode.need_pay ?? 0) === 1 || Number(episode.price ?? 0) > 0;
      }) || [];
      dramaUnit = createRevenueDramaUnit(task, title, paidEpisodes.length, 2);
      task.progressTotalUnits += Math.max(0, dramaUnit.totalUnits - 1);
      advanceRevenueProgress(task, 1, `正在统计收益：${title} / 详情`);

      const userSet = new Set();
      let failed = false;
      let accessDenied = false;
      let rewardCoinTotal = 0;

      for (let episodeIndex = 0; episodeIndex < paidEpisodes.length; episodeIndex += 1) {
        const episode = paidEpisodes[episodeIndex];
        if (task.cancelled) {
          break;
        }
        const danmakuResult = await fetchDanmakuSummary(
          episode.sound_id,
          title,
          String(episode?.name ?? "").trim()
        );
        if (!danmakuResult.success) {
          failed = true;
          accessDenied = accessDenied || Boolean(danmakuResult.accessDenied);
          advanceRevenueProgress(
            task,
            1,
            `正在统计收益：${title} / 分集 ${episodeIndex + 1}/${paidEpisodes.length}`
          );
          if (accessDenied) {
            task.accessDenied = true;
          }
          break;
        }
        (Array.isArray(danmakuResult.users) ? danmakuResult.users : []).forEach((uid) => {
          userSet.add(uid);
        });
        if (isMissevanLikelyDanmakuOverflow({
          durationMs: Number(episode?.duration ?? 0),
          danmaku: danmakuResult.danmaku,
        })) {
          suspectedOverflowEpisodes.add(
            buildOverflowEpisodeKey(dramaId, String(episode?.name ?? "").trim())
          );
        }
        advanceRevenueProgress(
          task,
          1,
          `正在统计收益：${title} / 分集 ${episodeIndex + 1}/${paidEpisodes.length}`
        );
      }

      if (task.cancelled) {
        break;
      }

      if (!failed && !task.cancelled) {
        updateStatsTask(task, {
          currentAction: `正在统计收益：${title} / 打赏汇总`,
        });
        const rewardSummary = await fetchRewardSummary(dramaId);
        if (!rewardSummary?.success) {
          failed = true;
          accessDenied = accessDenied || Boolean(rewardSummary?.accessDenied);
          if (accessDenied) {
            task.accessDenied = true;
          }
        } else {
          rewardCoinTotal = Number(rewardSummary.rewardCoinTotal ?? 0);
        }
      }
      if (task.cancelled) {
        break;
      }
      advanceRevenueProgress(task, 1, `正在统计收益：${title} / 打赏汇总`);

      results.push({
        dramaId,
        platform: "missevan",
        title,
        subtitle: isMember
          ? `${title} / ${price}（会员${memberPrice}）钻石`
          : `${title} / ${price} 钻石`,
        viewCount,
        price,
        memberPrice,
        titlePrice: price > 0 ? price : null,
        titleMemberPrice: memberPrice > 0 ? memberPrice : null,
        includeInSummaryPrice: price > 0,
        currencyUnit: "钻石",
        summaryRevenueMode: vipOnlyReward ? "member_reward" : "single",
        paidUserIds: Array.from(userSet),
        paidUserCount: userSet.size,
        rewardCoinTotal,
        rewardNum,
        vipOnlyReward,
        estimatedRevenueYuan: vipOnlyReward
          ? rewardCoinTotal / 10
          : (userSet.size * price + rewardCoinTotal) / 10,
        failed,
        accessDenied,
      });
      task.accessDenied = task.accessDenied || accessDenied;
      if (failed) {
        task.failedCount += 1;
      }
      completeRevenueDramaUnits(task, dramaUnit, `正在统计收益：${title} / 已完成`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const accessDenied =
        isMissevanAccessDenied(error);
      task.accessDenied = task.accessDenied || accessDenied;
      task.failedCount += 1;
      results.push({
        dramaId,
        platform: "missevan",
        title,
        subtitle: `${title} / 统计失败`,
        viewCount: 0,
        price: 0,
        memberPrice: 0,
        titlePrice: null,
        titleMemberPrice: null,
        includeInSummaryPrice: false,
        currencyUnit: "钻石",
        summaryRevenueMode: "single",
        paidUserIds: [],
        paidUserCount: 0,
        rewardCoinTotal: 0,
        rewardNum: null,
        vipOnlyReward: false,
        estimatedRevenueYuan: 0,
        failed: true,
        accessDenied,
      });
      if (dramaUnit) {
        completeRevenueDramaUnits(task, dramaUnit, `正在统计收益：${title} / 统计失败`);
      } else {
        advanceRevenueProgress(task, 1, `正在统计收益：${title} / 统计失败`);
      }
    }

    task.completedCount += 1;
    if (task.accessDenied) {
      break;
    }
  }

  if (task.cancelled) {
    const revenueSummary = createRevenueSummary(results);
    return finalizeCancelledTask(task, {
      result: {
        revenueResults: compactRevenueResults(results),
        revenueSummary: {
          ...revenueSummary,
          suspectedOverflowEpisodes: Array.from(suspectedOverflowEpisodes),
        },
      },
    });
  }

  const revenueSummary = createRevenueSummary(results);
  updateStatsTask(task, {
    status: "completed",
    progress: 100,
    currentAction: results.some((item) => item.failed)
      ? "收益预估完成，部分失败"
      : "收益预估完成",
    result: {
      revenueResults: compactRevenueResults(results),
      revenueSummary: {
        ...revenueSummary,
        suspectedOverflowEpisodes: Array.from(suspectedOverflowEpisodes),
      },
    },
  });
}

async function executeManboRevenueTask(task) {
  const dramaIds = Array.isArray(task.dramaIds) ? task.dramaIds : [];
  const results = [];
  const suspectedOverflowEpisodes = new Set();
  initializeRevenueProgress(task, dramaIds);

  updateStatsTask(task, {
    status: "running",
    currentAction: "开始最低收益预估",
    progress: 0,
  });

  for (const dramaIdValue of dramaIds) {
    if (task.cancelled) {
      break;
    }
    const dramaId = String(dramaIdValue);
    let title = `Drama ${dramaId}`;
    let dramaUnit = null;
    try {
      const dramaInfo = await fetchManboDramaDetail(dramaId);
      title = dramaInfo?.drama?.name || title;
      const viewCount = Number(dramaInfo?.drama?.view_count ?? 0);
      const diamondValue = Number(dramaInfo?.drama?.diamond_value ?? 0);
      const revenueType = getManboRevenueType(dramaInfo);
      const revenueEpisodes = getManboRevenueEpisodes(dramaInfo, revenueType);
      const seasonPricing = revenueType === "season" ? resolveManboSeasonPricing(dramaInfo) : null;
      const payCount = getManboPayCount(dramaInfo);
      const subtitle = getManboRevenueSubtitle(title, dramaInfo, revenueType, revenueEpisodes);
      dramaUnit = createRevenueDramaUnit(task, title, revenueEpisodes.length, 1);
      task.progressTotalUnits += Math.max(0, dramaUnit.totalUnits - 1);
      advanceRevenueProgress(task, 1, `正在统计收益：${title} / 详情`);

      if (
        revenueType === "unknown"
        || (revenueType !== "season" && revenueType !== "member" && revenueEpisodes.length === 0)
      ) {
        results.push({
          dramaId,
          platform: "manbo",
          revenueType,
          title,
          subtitle,
          viewCount,
          diamondValue,
          titlePrice: null,
          titleMemberPrice: null,
          includeInSummaryPrice: false,
          currencyUnit: "红豆",
          summaryRevenueMode: "single",
          payCount,
          paidCountSource: "danmaku_ids",
          paidUserIds: [],
          paidUserCount: 0,
          estimatedRevenueYuan: 0,
          failed: true,
          accessDenied: false,
        });
        completeRevenueDramaUnits(task, dramaUnit, `正在统计收益：${title} / 已完成`);
      } else if (shouldUseManboOfficialPayCount(dramaInfo, revenueType)) {
        const normalizedPayCount = Number(payCount ?? 0);
        const estimatedRevenueYuan = (
          normalizedPayCount * Number(seasonPricing?.titleMemberPrice ?? 0) + diamondValue
        ) / 100;
        const maxRevenueYuan = seasonPricing?.hasDiscountRange
          ? (normalizedPayCount * Number(seasonPricing?.titlePrice ?? 0) + diamondValue) / 100
          : null;

        results.push({
          dramaId,
          platform: "manbo",
          revenueType,
          title,
          subtitle,
          viewCount,
          diamondValue,
          titlePrice: seasonPricing?.includeInSummaryPrice ? seasonPricing.titlePrice : null,
          titleMemberPrice: seasonPricing?.includeInSummaryPrice ? seasonPricing.titleMemberPrice : null,
          includeInSummaryPrice: Boolean(seasonPricing?.includeInSummaryPrice),
          currencyUnit: "红豆",
          summaryRevenueMode: seasonPricing?.hasDiscountRange ? "range" : "single",
          payCount: normalizedPayCount,
          paidCountSource: "pay_count",
          paidUserIds: [],
          paidUserCount: normalizedPayCount,
          estimatedRevenueYuan,
          minRevenueYuan: seasonPricing?.hasDiscountRange ? estimatedRevenueYuan : null,
          maxRevenueYuan,
          failed: false,
          accessDenied: false,
        });
        completeRevenueDramaUnits(task, dramaUnit, `正在统计收益：${title} / 已完成`);
      } else {
        const paidUserSet = new Set();
        const episodePrices = new Set();
        let paidEpisodeCount = 0;
        let episodeRevenue = 0;
        let failed = false;
        let accessDenied = false;
        for (let episodeIndex = 0; episodeIndex < revenueEpisodes.length; episodeIndex += 1) {
          const episode = revenueEpisodes[episodeIndex];
          if (task.cancelled) {
            break;
          }
          const danmakuResult = await fetchManboDanmakuSummary(
            episode.sound_id,
            title,
            String(episode?.name ?? "").trim()
          );
          if (!danmakuResult.success) {
            failed = true;
            accessDenied = accessDenied || Boolean(danmakuResult.accessDenied);
            advanceRevenueProgress(
              task,
              1,
              `正在统计收益：${title} / 分集 ${episodeIndex + 1}/${revenueEpisodes.length}`
            );
            break;
          }
          const users = Array.isArray(danmakuResult.users) ? danmakuResult.users : [];
          const episodePrice = Number(episode?.price ?? 0);
          users.forEach((uid) => {
            if (uid != null && uid !== "") {
              paidUserSet.add(String(uid));
            }
          });
          paidEpisodeCount += 1;
          episodeRevenue += users.length * episodePrice;
          if (episodePrice > 0) {
            episodePrices.add(episodePrice);
          }
          if (await isLikelyManboDanmakuOverflow(episode.sound_id, danmakuResult.danmaku)) {
            suspectedOverflowEpisodes.add(
              buildOverflowEpisodeKey(dramaId, String(episode?.name ?? "").trim())
            );
          }
          advanceRevenueProgress(
            task,
            1,
          `正在统计收益：${title} / 分集 ${episodeIndex + 1}/${revenueEpisodes.length}`
          );
        }

        if (task.cancelled) {
          break;
        }

        if (failed) {
          task.failedCount += 1;
        }
        task.accessDenied = task.accessDenied || accessDenied;
        const paidUserIds = Array.from(paidUserSet);
        const paidUserCount = paidUserIds.length;

        if (revenueType === "member") {
          results.push({
            dramaId,
            platform: "manbo",
            revenueType,
            title,
            subtitle,
            viewCount,
            diamondValue,
            titlePrice: null,
            titleMemberPrice: null,
            includeInSummaryPrice: false,
            currencyUnit: "红豆",
            summaryRevenueMode: "member_reward",
            payCount,
            paidCountSource: "danmaku_ids",
            paidUserIds,
            paidUserCount,
            estimatedRevenueYuan: diamondValue / 100,
            failed,
            accessDenied,
          });
        } else if (revenueType === "season") {
          const estimatedRevenueYuan = (
            paidUserCount * Number(seasonPricing?.titleMemberPrice ?? 0) + diamondValue
          ) / 100;
          const maxRevenueYuan = seasonPricing?.hasDiscountRange
            ? (paidUserCount * Number(seasonPricing?.titlePrice ?? 0) + diamondValue) / 100
            : null;
          results.push({
            dramaId,
            platform: "manbo",
            revenueType,
            title,
            subtitle,
            viewCount,
            diamondValue,
            titlePrice: seasonPricing?.includeInSummaryPrice ? seasonPricing.titlePrice : null,
            titleMemberPrice: seasonPricing?.includeInSummaryPrice ? seasonPricing.titleMemberPrice : null,
            includeInSummaryPrice: Boolean(seasonPricing?.includeInSummaryPrice),
            currencyUnit: "红豆",
            summaryRevenueMode: seasonPricing?.hasDiscountRange ? "range" : "single",
            payCount,
            paidCountSource: "danmaku_ids",
            paidUserIds,
            paidUserCount,
            minRevenueYuan: seasonPricing?.hasDiscountRange ? estimatedRevenueYuan : null,
            maxRevenueYuan,
            estimatedRevenueYuan,
            failed,
            accessDenied,
          });
        } else {
          const uniqueEpisodePrices = Array.from(episodePrices);
          const minRevenueYuan = (episodeRevenue + diamondValue) / 100;
          const hasUniformEpisodePrice = uniqueEpisodePrices.length === 1;
          const maxRevenueYuan = hasUniformEpisodePrice
            ? (paidUserCount * uniqueEpisodePrices[0] * paidEpisodeCount + diamondValue) / 100
            : null;
          results.push({
            dramaId,
            platform: "manbo",
            revenueType,
            title,
            subtitle,
            viewCount,
            diamondValue,
            titlePrice: hasUniformEpisodePrice
              ? Number(uniqueEpisodePrices[0] ?? 0) * paidEpisodeCount
              : null,
            titleMemberPrice: null,
            includeInSummaryPrice: hasUniformEpisodePrice,
            currencyUnit: "红豆",
            summaryRevenueMode: hasUniformEpisodePrice ? "range" : "single",
            payCount,
            paidCountSource: "danmaku_ids",
            paidUserIds,
            paidUserCount,
            estimatedRevenueYuan: minRevenueYuan,
            minRevenueYuan,
            maxRevenueYuan,
            failed,
            accessDenied,
          });
        }
        completeRevenueDramaUnits(task, dramaUnit, `正在统计收益：${title} / 已完成`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const accessDenied =
        isAccessDeniedError(error) ||
        String(message).startsWith("ACCESS_DENIED_COOLDOWN:");
      task.accessDenied = task.accessDenied || accessDenied;
      task.failedCount += 1;
      results.push({
        dramaId,
        platform: "manbo",
        title,
        subtitle: `${title} / 统计失败`,
        viewCount: 0,
        diamondValue: 0,
        titlePrice: null,
        titleMemberPrice: null,
        includeInSummaryPrice: false,
        currencyUnit: "红豆",
        summaryRevenueMode: "single",
        payCount: null,
        paidCountSource: "danmaku_ids",
        paidUserIds: [],
        paidUserCount: 0,
        estimatedRevenueYuan: 0,
        failed: true,
        accessDenied,
      });
      if (dramaUnit) {
        completeRevenueDramaUnits(task, dramaUnit, `正在统计收益：${title} / 统计失败`);
      } else {
        advanceRevenueProgress(task, 1, `正在统计收益：${title} / 统计失败`);
      }
    }

    task.completedCount += 1;
  }

  if (task.cancelled) {
    const revenueSummary = createRevenueSummary(results);
    return finalizeCancelledTask(task, {
      result: {
        revenueResults: compactRevenueResults(results),
        revenueSummary: {
          ...revenueSummary,
          suspectedOverflowEpisodes: Array.from(suspectedOverflowEpisodes),
        },
      },
    });
  }

  const revenueSummary = createRevenueSummary(results);
  updateStatsTask(task, {
    status: "completed",
    progress: 100,
    currentAction: results.some((item) => item.failed)
      ? "收益预估完成，部分失败"
      : "收益预估完成",
    result: {
      revenueResults: compactRevenueResults(results),
      revenueSummary: {
        ...revenueSummary,
        suspectedOverflowEpisodes: Array.from(suspectedOverflowEpisodes),
      },
    },
  });
}

async function executeStatsTask(task) {
  try {
    if (task.taskType === "id") {
      if (task.platform === "manbo") {
        await executeManboIdTask(task);
        return;
      }
      await executeMissevanIdTask(task);
      return;
    }

    if (task.taskType === "play_count") {
      if (task.platform === "manbo") {
        await executeManboPlayCountTask(task);
        return;
      }
      await executeMissevanPlayCountTask(task);
      return;
    }

    if (task.taskType === "revenue") {
      if (task.platform === "manbo") {
        await executeManboRevenueTask(task);
        return;
      }
      await executeMissevanRevenueTask(task);
      return;
    }

    updateStatsTask(task, {
      status: "failed",
      currentAction: "统计失败",
      error: `Unsupported task type: ${task.taskType}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateStatsTask(task, {
      status: "failed",
      currentAction: "统计失败",
      error: message,
    });
  }
}

app.get("/ranks/trends", async (req, res) => {
  const platform = String(req.query.platform ?? "").trim();
  const dramaId = String(req.query.id ?? "").trim();
  const isValidDramaId =
    (platform === "missevan" && dramaId) ||
    (platform === "manbo" && isNumericId(dramaId));
  if (!["missevan", "manbo"].includes(platform) || !isValidDramaId) {
    return res.status(400).json({
      success: false,
      message: "Invalid rank trend request",
    });
  }

  try {
    const response = await getCachedRankTrendResponse(platform, dramaId);
    if (!response.success) {
      return res.status(response.status || 404).json(response);
    }
    res.setHeader("Cache-Control", `public, max-age=${Math.floor(RANKS_CACHE_TTL_MS / 1000)}`);
    if (response.latestDate) {
      res.setHeader("X-Ranks-Trend-Latest-Date", response.latestDate);
      res.setHeader(
        "ETag",
        `"ranks-trend-${platform}-${Buffer.from(`${dramaId}:${response.latestDate}`).toString("base64url")}"`
      );
    }
    return res.json(response);
  } catch (error) {
    console.error("Failed to read ranks trend", error);
    return res.status(503).json({
      success: false,
      message: "Rank trends are unavailable",
    });
  }
});

app.get("/ongoing", async (req, res) => {
  const platform = String(req.query.platform ?? "").trim();
  if (!["missevan", "manbo"].includes(platform)) {
    return res.status(400).json({
      success: false,
      message: "Invalid ongoing platform",
    });
  }

  try {
    const response = await getCachedOngoingResponse(platform);
    if (!response.success) {
      return res.status(response.status || 404).json(response);
    }
    res.setHeader("Cache-Control", "no-store");
    if (response.latestDate) {
      res.setHeader("X-Ongoing-Latest-Date", response.latestDate);
      const etagSource = [
        ONGOING_RESPONSE_SCHEMA_VERSION,
        platform,
        response.latestDate,
        response.updatedAt || "",
        Array.isArray(response.items) ? response.items.length : 0,
      ].join(":");
      res.setHeader(
        "ETag",
        `"ongoing-${Buffer.from(etagSource).toString("base64url")}"`
      );
    }
    return res.json(response);
  } catch (error) {
    console.error("Failed to read ongoing dramas", error);
    return res.status(503).json({
      success: false,
      platform,
      updatedAt: "",
      latestDate: "",
      windows: {},
      items: [],
      message: "Ongoing dramas are unavailable",
    });
  }
});

app.get("/ranks", async (req, res) => {
  try {
    const response = await getCachedRanksResponse();
    res.setHeader("Cache-Control", `public, max-age=${Math.floor(RANKS_CACHE_TTL_MS / 1000)}`);
    if (response.updatedAt) {
      res.setHeader("X-Ranks-Updated-At", response.updatedAt);
      res.setHeader("ETag", `"ranks-${Buffer.from(response.updatedAt).toString("base64url")}"`);
    }
    return res.json(response);
  } catch (error) {
    console.error("Failed to read ranks snapshot", error);
    return res.status(503).json({
      success: false,
      updatedAt: "",
      platforms: {
        missevan: { key: "missevan", label: "猫耳", categories: [] },
        manbo: { key: "manbo", label: "漫播", categories: [] },
      },
      message: "Ranks are unavailable",
    });
  }
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/image-proxy", async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).send("Missing url");
  }

  try {
    const targetUrl = new URL(url);

    if (
      targetUrl.protocol !== "https:" ||
      !isAllowedImageHost(targetUrl.hostname)
    ) {
      return res.status(400).send("Invalid image host");
    }

    const response = await fetch(targetUrl.toString());
    if (!response.ok) {
      return res.status(response.status).send("Failed to fetch image");
    }

    const arrayBuffer = await response.arrayBuffer();
    res.setHeader(
      "Content-Type",
      response.headers.get("content-type") || "image/jpeg"
    );
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.send(Buffer.from(arrayBuffer));
  } catch (error) {
    console.error(error);
    return res.status(500).send("Image proxy failed");
  }
});

app.get("/search", async (req, res) => {
  if (!ensureMissevanEnabled(res)) {
    return;
  }
  const { keyword } = req.query;
  const normalizedKeyword = normalizeKeyword(keyword);
  const offset = normalizeSearchOffset(req.query.offset);
  const limit = normalizeSearchLimit(req.query.limit, 5, 5);

  if (!normalizedKeyword) {
    return res.json({ success: false, message: "Missing keyword" });
  }

  void writeUsageLog({
    platform: "missevan",
    action: "search",
    keyword: normalizedKeyword,
  });

  try {
    await ensureInfoStoreLoaded(missevanInfoStore);
    await refreshMissevanCooldownState();

    let source = "missevan_api";
    let totalMatched = 0;
    let results = [];

    if (missevanInfoStore.remoteAvailable) {
      const matchedRecords = searchMissevanLibraryRecords(
        missevanInfoStore.records,
        normalizedKeyword,
        SEARCH_RESULT_LIMIT
      );
      source = "library";
      totalMatched = matchedRecords.length;

      if (matchedRecords.length > 0) {
        const pagedRecords = matchedRecords.slice(offset, offset + limit);
        results = await mapWithConcurrency(
          pagedRecords,
          4,
          hydrateMissevanSearchRecord
        );
      }
    }

    if (!results.length && totalMatched === 0) {
      source = "missevan_api";
      const apiRecords = await searchMissevanApiRecords(
        normalizedKeyword,
        SEARCH_RESULT_LIMIT
      );
      totalMatched = apiRecords.length;
      const pagedRecords = apiRecords.slice(offset, offset + limit);
      results = await mapWithConcurrency(
        pagedRecords,
        4,
        hydrateMissevanApiSearchRecord
      );
    }

    const meta = {
      ...buildSearchPageMeta(
        normalizedKeyword,
        totalMatched,
        offset,
        limit
      ),
      source,
    };

    return res.json({
      success: totalMatched > 0,
      results,
      meta,
    });
  } catch (error) {
    console.error(error);
    return res.json(buildMissevanAccessDeniedResponse(error));
  }
});

app.post("/register-new-drama-ids", async (req, res) => {
  const platform = req.body?.platform;
  const dramaIds = normalizeDramaIds(req.body?.drama_ids || []).map((id) => String(id));

  if (!["missevan", "manbo"].includes(platform)) {
    return res.status(400).json({
      success: false,
      message: "Invalid platform",
    });
  }

  if (!dramaIds.length) {
    return res.json({
      success: true,
      count: 0,
    });
  }

  try {
    const missingDramaIds = await filterUntrackedNewDramaIds(platform, dramaIds);
    if (missingDramaIds.length > 0) {
      await queueNewDramaIdsAppend(platform, missingDramaIds);
    }
    return res.json({
      success: true,
      count: missingDramaIds.length,
    });
  } catch (error) {
    console.error(`Failed to register new drama ids for ${platform}`, error);
    return res.status(500).json({
      success: false,
      message: "Failed to register drama ids",
    });
  }
});

app.post("/usage-log", async (req, res) => {
  try {
    if (!isSameHostUsageLogRequest(req)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden usage log request",
      });
    }

    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const platform = String(payload.platform ?? "").trim();
    const action = String(payload.action ?? "").trim();
    const error = String(payload.error ?? "").trim();

    if (action === "trend") {
      if (!["missevan", "manbo"].includes(platform)) {
        return res.status(400).json({
          success: false,
          message: "Invalid usage log payload",
        });
      }

      const dramaId = String(payload.dramaId ?? payload.id ?? "").trim().slice(0, 80);
      const rankKey = normalizeTextValue(payload.rankKey).slice(0, 80);
      const isPeakSeriesTrend = platform === "missevan" && rankKey === "peak" && dramaId;
      if (!isNumericId(dramaId) && !isPeakSeriesTrend) {
        return res.status(400).json({
          success: false,
          message: "Missing trend drama id",
        });
      }

      const source = normalizeTextValue(payload.source).slice(0, 40);
      await writeUsageLog({
        platform,
        action,
        dramaId,
        ...(normalizeTextValue(payload.dramaName).slice(0, 200)
          ? { dramaName: normalizeTextValue(payload.dramaName).slice(0, 200) }
          : {}),
        ...(source ? { source } : {}),
        ...(rankKey
          ? { rankKey }
          : {}),
        success: true,
      });
      return res.json({ success: true });
    }

    if (action === "ranks") {
      if (!["missevan", "manbo"].includes(platform)) {
        return res.status(400).json({
          success: false,
          message: "Invalid usage log payload",
        });
      }

      const keyword = normalizeKeyword(payload.keyword);
      if (!keyword) {
        return res.status(400).json({
          success: false,
          message: "Missing ranks keyword",
        });
      }

      await writeUsageLog({
        platform,
        action,
        keyword,
        success: true,
      });
      return res.json({ success: true });
    }

    if (action === "ongoing") {
      if (!["missevan", "manbo"].includes(platform)) {
        return res.status(400).json({
          success: false,
          message: "Invalid usage log payload",
        });
      }

      const keyword = normalizeKeyword(payload.keyword);
      if (!keyword) {
        return res.status(400).json({
          success: false,
          message: "Missing ongoing keyword",
        });
      }

      await writeUsageLog({
        platform,
        action,
        keyword,
        success: true,
      });
      return res.json({ success: true });
    }

    if (
      platform !== "missevan" ||
      !["search", "manual_import"].includes(action) ||
      error !== "ACCESS_DENIED_COOLDOWN:frontend_precheck"
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid usage log payload",
      });
    }

    const sanitizedEntry = {
      platform,
      action,
      accessDenied: true,
      success: false,
      error,
      cooldownUntil: Math.max(0, Number(payload.cooldownUntil ?? 0) || 0),
    };

    if (action === "search") {
      const keyword = normalizeKeyword(payload.keyword);
      if (!keyword) {
        return res.status(400).json({
          success: false,
          message: "Missing search keyword",
        });
      }
      sanitizedEntry.keyword = keyword;
    }

    if (action === "manual_import") {
      sanitizedEntry.manualInputCount = Math.max(
        0,
        Math.min(200, Math.floor(Number(payload.manualInputCount ?? 0) || 0))
      );
    }

    await writeUsageLog(sanitizedEntry);
    return res.json({ success: true });
  } catch (error) {
    console.error("Failed to write usage log from client payload", error);
    return res.status(500).json({
      success: false,
      message: "Failed to write usage log",
    });
  }
});

app.post("/getdramacards", async (req, res) => {
  if (!ensureMissevanEnabled(res)) {
    return;
  }
  const ids = normalizeDramaIds(req.body.drama_ids || []);
  const usageAction = normalizeDramaCardUsageAction(req.body.usageAction);
  const results = [];
  const failedIds = [];
  let accessDenied = false;

  if (ids.length) {
    void writeUsageLog({
      platform: "missevan",
      action: usageAction,
      dramaIds: ids,
      count: ids.length,
    });
  }

  await ensureInfoStoreLoaded(missevanInfoStore);
  await refreshMissevanCooldownState();
  const newDramaIds = [];
  for (const id of ids) {
    try {
      const libraryRecord = missevanInfoStore.byDramaId.get(String(id));
      const preferredSoundId = getMissevanPrimarySoundIdFromRecord(libraryRecord);
      const info = await fetchDramaInfo(id, preferredSoundId);

      if (info?.drama) {
        const resolvedLibraryRecord = libraryRecord || missevanInfoStore.byDramaId.get(String(info.drama.id));
        const primarySoundId =
          preferredSoundId ||
          Number(info?.episodes?.episode?.[0]?.sound_id ?? 0) ||
          null;
        const mainCvs = resolvedLibraryRecord ? getMissevanMainCvNames(resolvedLibraryRecord) : [];
        let rewardNum = null;
        try {
          const rewardMeta = await fetchRewardDetailMeta(id);
          rewardNum = normalizeOptionalFiniteNumber(rewardMeta?.reward_num);
        } catch (error) {
          if (isMissevanAccessDenied(error)) {
            accessDenied = true;
            throw error;
          }
          console.error(`Failed to fetch Missevan reward detail drama_id=${id}`, error);
        }

        const nextCard = {
          id: info.drama.id,
          name: info.drama.name,
          cover: info.drama.cover || "",
          view_count: Number(info.drama.view_count ?? 0),
          playCountWan: formatPlayCountWan(info.drama.view_count),
          vip: Number(info.drama.vip ?? 0),
          price: Number(info.drama.price ?? 0),
          member_price: Number(info.drama.member_price ?? 0),
          is_member: Boolean(info.drama.is_member),
          sound_id: primarySoundId,
          subscription_num: normalizeOptionalFiniteNumber(info.drama.subscription_num),
          reward_num: rewardNum,
          checked: true,
          platform: "missevan",
        };
        if (resolvedLibraryRecord && mainCvs.length > 0) {
          nextCard.main_cvs = mainCvs;
          nextCard.main_cv_text = buildMainCvText(mainCvs);
        } else if (!resolvedLibraryRecord) {
          newDramaIds.push(String(info.drama.id));
        }
        results.push(nextCard);
      } else {
        failedIds.push(Number(id));
      }
    } catch (error) {
      accessDenied =
        accessDenied ||
        isMissevanAccessDenied(error);
      console.error(`Failed to fetch Missevan drama card drama_id=${id}`, error);
      failedIds.push(Number(id));
      if (accessDenied) {
        break;
      }
    }
  }

  if (newDramaIds.length > 0) {
    fireAndForget("Failed to append new Missevan drama ids", async () => {
      const missingDramaIds = await filterUntrackedNewDramaIds("missevan", newDramaIds);
      if (missingDramaIds.length > 0) {
        await queueNewDramaIdsAppend("missevan", missingDramaIds);
      }
    });
  }

  return res.json({
    success: results.length > 0,
    results,
    failedIds,
    accessDenied,
  });
});

app.post("/getdramas", async (req, res) => {
  if (!ensureMissevanEnabled(res)) {
    return;
  }
  const ids = normalizeDramaIds(req.body.drama_ids || []);
  const soundIdMap = req.body.sound_id_map || {};
  const results = [];

  await refreshMissevanCooldownState();
  let stoppedByAccessDenied = false;
  let stopIndex = ids.length;
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index];
    try {
      const soundId = Number(soundIdMap[String(id)] ?? soundIdMap[id] ?? 0);
      const info = await fetchDramaInfo(id, soundId > 0 ? soundId : null);

      if (info) {
        results.push({
          success: true,
          id,
          info,
        });
      } else {
        results.push({ success: false, id, accessDenied: false });
      }
    } catch (error) {
      const accessDenied = isMissevanAccessDenied(error);
      console.error(`Failed to fetch Missevan drama drama_id=${id}`, error);
      results.push({ success: false, id, accessDenied });
      if (accessDenied) {
        stoppedByAccessDenied = true;
        stopIndex = index + 1;
        break;
      }
    }
  }

  if (stoppedByAccessDenied) {
    ids.slice(stopIndex).forEach((id) => {
      results.push({ success: false, id, accessDenied: true });
    });
  }

  return res.json(results);
});

app.post("/getsoundsummary", async (req, res) => {
  if (!ensureMissevanEnabled(res)) {
    return;
  }
  const soundIds = normalizeIds(req.body.sound_ids || []);
  const results = [];

  await refreshMissevanCooldownState();
  let stoppedByAccessDenied = false;
  let stopIndex = soundIds.length;
  for (let index = 0; index < soundIds.length; index += 1) {
    const soundId = soundIds[index];
    try {
      results.push(await fetchSoundSummary(soundId));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to fetch Missevan sound summary sound_id=${soundId}`, error);
      results.push({
        sound_id: Number(soundId),
        success: false,
        view_count: null,
        viewCountWan: "",
        playCountFailed: true,
        accessDenied:
          isMissevanAccessDenied(error),
        error: message,
      });
      if (isMissevanAccessDenied(error)) {
        stoppedByAccessDenied = true;
        stopIndex = index + 1;
        break;
      }
    }

    await sleep(350);
  }

  if (stoppedByAccessDenied) {
    soundIds.slice(stopIndex).forEach((soundId) => {
      results.push({
        sound_id: Number(soundId),
        success: false,
        view_count: null,
        viewCountWan: "",
        playCountFailed: true,
        accessDenied: true,
        error: "ACCESS_DENIED_COOLDOWN",
      });
    });
  }

  return res.json(results);
});

app.post("/getrewardsummary", async (req, res) => {
  if (!ensureMissevanEnabled(res)) {
    return;
  }
  const dramaId = Number(req.body.drama_id ?? 0);

  if (!dramaId) {
    return res.json({
      success: false,
      drama_id: 0,
      rewardCoinTotal: 0,
      accessDenied: false,
      error: "Missing drama_id",
    });
  }

  try {
    await refreshMissevanCooldownState();
    const result = await fetchRewardSummary(dramaId);
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to fetch reward summary drama_id=${dramaId}`, error);
    return res.json({
      success: false,
      drama_id: dramaId,
      rewardCoinTotal: 0,
      accessDenied:
        isAccessDeniedError(error) ||
        String(message).startsWith("ACCESS_DENIED_COOLDOWN:"),
      error: message,
    });
  }
});

app.post("/getrewardmeta", async (req, res) => {
  if (!ensureMissevanEnabled(res)) {
    return;
  }
  const dramaId = Number(req.body.drama_id ?? 0);

  if (!dramaId) {
    return res.json({
      success: false,
      drama_id: 0,
      reward_num: null,
      accessDenied: false,
      error: "Missing drama_id",
    });
  }

  try {
    await refreshMissevanCooldownState();
    const result = await fetchRewardDetailMeta(dramaId);
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to fetch reward meta drama_id=${dramaId}`, error);
    return res.json({
      success: false,
      drama_id: dramaId,
      reward_num: null,
      accessDenied:
        isAccessDeniedError(error) ||
        String(message).startsWith("ACCESS_DENIED_COOLDOWN:"),
      error: message,
    });
  }
});

app.post("/getsounddanmaku", async (req, res) => {
  if (!ensureMissevanEnabled(res)) {
    return;
  }
  const {
    sound_id: soundId,
    drama_title: dramaTitle = "",
    episode_title: episodeTitle = "",
  } = req.body;

  if (!soundId) {
    return res.json({
      success: false,
      sound_id: 0,
      drama_title: dramaTitle,
      episode_title: episodeTitle,
      danmaku: 0,
      users: [],
      accessDenied: false,
      error: "Missing sound_id",
    });
  }

  await refreshMissevanCooldownState();
  const result = await fetchDanmakuSummary(soundId, dramaTitle, episodeTitle);
  return res.json(result);
});

app.post("/manbo/resolve-input", async (req, res) => {
  const items = normalizeRawInputItems(req.body.items || []);
  const results = [];

  for (const item of items) {
    try {
      const resolved = await resolveManboItem(item);
      results.push({
        raw: item.raw,
        success: Boolean(resolved),
        resolved: resolved || null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        raw: item.raw,
        success: false,
        resolved: null,
        accessDenied:
          isAccessDeniedError(error) ||
          String(message).startsWith("ACCESS_DENIED_COOLDOWN:"),
        error: message,
      });
    }
  }

  return res.json({ success: true, results });
});

app.get("/manbo/search", async (req, res) => {
  const keyword = normalizeKeyword(req.query.keyword);
  const offset = normalizeSearchOffset(req.query.offset);
  const limit = normalizeSearchLimit(req.query.limit, 5, 5);
  if (!keyword) {
    return res.json({
      success: false,
      results: [],
      meta: {
        keyword: "",
        recordCount: 0,
      },
    });
  }

  void writeUsageLog({
    platform: "manbo",
    action: "search",
    keyword,
  });

  try {
    await ensureInfoStoreLoaded(manboInfoStore);
    if (!manboInfoStore.remoteAvailable) {
      return res.status(503).json({
        success: false,
        unavailable: true,
        results: [],
        message: "Manbo search is unavailable while Upstash is not available. Please import by ID or link.",
        meta: {
          keyword,
          matchedCount: 0,
          hydratedCount: 0,
        },
      });
    }

    const matchedRecords = searchManboLibraryRecords(
      manboInfoStore.records,
      keyword,
      SEARCH_RESULT_LIMIT
    );
    const pagedRecords = matchedRecords.slice(offset, offset + limit);
    const hydratedResults = await mapWithConcurrency(
      pagedRecords,
      4,
      hydrateManboSearchRecord
    );
    const meta = buildSearchPageMeta(
      keyword,
      matchedRecords.length,
      offset,
      limit
    );

    return res.json({
      success: matchedRecords.length > 0,
      results: hydratedResults,
      meta: {
        ...meta,
        hydratedCount: hydratedResults.length,
      },
    });
  } catch (error) {
    console.error(`Failed to search Manbo index keyword=${keyword}`, error);
    return res.status(500).json({
      success: false,
      results: [],
      meta: {
        keyword,
        matchedCount: 0,
        hydratedCount: 0,
      },
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.get("/manbo/index/meta", async (req, res) => {
  try {
    const meta = await manboIndexStore.getMeta();
    return res.json({
      success: true,
      ...meta,
    });
  } catch (error) {
    console.error("Failed to load Manbo index meta", error);
    return res.status(500).json({
      success: false,
      version: 0,
      updatedAt: 0,
      recordCount: 0,
      persistence: "unknown",
    });
  }
});

app.post("/manbo/getdramacards", async (req, res) => {
  const items = normalizeRawInputItems(req.body.items || []);
  const usageAction = normalizeDramaCardUsageAction(req.body.usageAction);
  const results = [];
  const failedItems = [];
  let accessDenied = false;

  if (items.length) {
    void writeUsageLog({
      platform: "manbo",
      action: usageAction,
      items: items.map((item) => item.raw),
      count: items.length,
    });
  }

  await ensureInfoStoreLoaded(manboInfoStore);
  const newDramaIds = [];
  for (const item of items) {
    try {
      const resolved = await resolveManboItem(item);
      if (!resolved?.dramaId) {
        failedItems.push(item.raw);
        continue;
      }

      const info = await fetchManboDramaDetail(resolved.dramaId);
      const card = normalizeManboCardFromDramaInfo(info);
      if (card) {
        const libraryRecord = manboInfoStore.byDramaId.get(String(card.id));
        const mainCvs = getManboMainCvNames(libraryRecord);
        const nextCard = {
          ...card,
        };
        if (libraryRecord) {
          nextCard.content_type_label = getManboContentTypeLabel(libraryRecord) || nextCard.content_type_label;
        }
        if (libraryRecord && mainCvs.length > 0) {
          nextCard.main_cvs = mainCvs;
          nextCard.main_cv_text = buildMainCvText(mainCvs);
        } else if (!libraryRecord) {
          newDramaIds.push(String(resolved.dramaId));
        }
        results.push(nextCard);
      } else {
        failedItems.push(item.raw);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      accessDenied =
        accessDenied ||
        isAccessDeniedError(error) ||
        String(message).startsWith("ACCESS_DENIED_COOLDOWN:");
      console.error(`Failed to fetch Manbo drama card input=${item.raw}`, error);
      failedItems.push(item.raw);
    }
  }

  const dedupedResults = Array.from(
    new Map(results.map((item) => [String(item.id), item])).values()
  );

  if (newDramaIds.length > 0) {
    fireAndForget("Failed to append new Manbo drama ids", async () => {
      const missingDramaIds = await filterUntrackedNewDramaIds("manbo", newDramaIds);
      if (missingDramaIds.length > 0) {
        await queueNewDramaIdsAppend("manbo", missingDramaIds);
      }
    });
  }

  return res.json({
    success: dedupedResults.length > 0,
    results: dedupedResults,
    failedItems,
    accessDenied,
  });
});

app.post("/manbo/getdramas", async (req, res) => {
  const ids = normalizeStringIds(req.body.drama_ids || []);
  const results = [];

  for (const id of ids) {
    try {
      const info = await fetchManboDramaDetail(id);
      if (info) {
        const indexRecord = buildManboIndexRecordFromDramaInfo(info);
        if (indexRecord) {
          await manboIndexStore.upsert(indexRecord);
        }
        results.push({
          success: true,
          id,
          info,
        });
      } else {
        results.push({ success: false, id, accessDenied: false });
      }
    } catch (error) {
      const accessDenied =
        isAccessDeniedError(error) ||
        String(error?.message || error).startsWith("ACCESS_DENIED_COOLDOWN:");
      console.error(`Failed to fetch Manbo drama drama_id=${id}`, error);
      results.push({ success: false, id, accessDenied });
    }
  }

  return res.json(results);
});

app.post("/manbo/getsetsummary", async (req, res) => {
  const setIds = normalizeStringIds(req.body.set_ids || req.body.sound_ids || []);
  const results = [];

  for (const setId of setIds) {
    try {
      results.push(await fetchManboSetSummary(setId));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to fetch Manbo set summary set_id=${setId}`, error);
      results.push({
        sound_id: Number(setId),
        success: false,
        view_count: null,
        viewCountWan: "",
        playCountFailed: true,
        accessDenied:
          isAccessDeniedError(error) ||
          String(message).startsWith("ACCESS_DENIED_COOLDOWN:"),
        error: message,
      });
    }

    await sleep(200);
  }

  return res.json(results);
});

app.post("/manbo/getsetdanmaku", async (req, res) => {
  const {
    sound_id: setId,
    drama_title: dramaTitle = "",
    episode_title: episodeTitle = "",
  } = req.body;

  if (!setId) {
    return res.json({
      success: false,
      sound_id: 0,
      drama_title: dramaTitle,
      episode_title: episodeTitle,
      danmaku: 0,
      users: [],
      accessDenied: false,
      error: "Missing sound_id",
    });
  }

  const result = await fetchManboDanmakuSummary(setId, dramaTitle, episodeTitle);
  return res.json(result);
});

function normalizeTaskEpisodes(rawEpisodes = []) {
  return (Array.isArray(rawEpisodes) ? rawEpisodes : [])
    .map((episode) => ({
      drama_id: String(episode?.drama_id ?? "").trim(),
      sound_id: String(episode?.sound_id ?? "").trim(),
      drama_title: String(episode?.drama_title ?? "").trim(),
      episode_title: String(episode?.episode_title ?? "").trim(),
      duration: Number(episode?.duration ?? 0),
    }))
    .filter((episode) => episode.sound_id);
}

function normalizeTaskDramaIds(rawDramaIds = [], platform = "missevan") {
  const values = Array.isArray(rawDramaIds) ? rawDramaIds : [];
  return Array.from(
    new Set(
      values
        .map((value) => String(value ?? "").trim())
        .filter((value) => /^\d+$/.test(value))
        .map((value) => (platform === "manbo" ? value : Number(value)))
    )
  );
}

function createStatsTask({ platform, taskType, episodes = [], dramaIds = [] }) {
  const taskId = createTaskId();
  const task = {
    taskId,
    platform,
    taskType,
    status: "queued",
    progress: 0,
    currentAction: "任务已创建",
    totalCount: taskType === "revenue" ? dramaIds.length : episodes.length,
    completedCount: 0,
    failedCount: 0,
    totalDanmaku: 0,
    totalUsers: 0,
    accessDenied: false,
    episodes,
    dramaIds,
    result: null,
    error: "",
    cancelled: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastSeenAt: Date.now(),
  };

  cleanupExpiredStatsTasks();
  manboStatsTaskStore.set(taskId, task);
  executeStatsTask(task);
  return task;
}

function getStatsTaskOr404(taskId, res) {
  cleanupExpiredStatsTasks();
  const task = manboStatsTaskStore.get(String(taskId));
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return null;
  }
  return task;
}

function createStatsTaskFromRequest(req, res, forcedPlatform = null, defaultTaskType = null) {
  const platform =
    forcedPlatform || (req.body?.platform === "manbo" ? "manbo" : "missevan");
  const taskType = String(req.body?.taskType ?? "").trim();
  const normalizedTaskType = taskType || defaultTaskType || "";
  const episodes = normalizeTaskEpisodes(req.body?.episodes);
  const dramaIds = normalizeTaskDramaIds(req.body?.dramaIds, platform);

  if (!["play_count", "id", "revenue"].includes(normalizedTaskType)) {
    res.status(400).json({ error: "Invalid taskType" });
    return null;
  }

  if (normalizedTaskType === "revenue" && !dramaIds.length) {
    res.status(400).json({ error: "Missing dramaIds" });
    return null;
  }

  if (normalizedTaskType !== "revenue" && !episodes.length) {
    res.status(400).json({ error: "Missing episodes" });
    return null;
  }

  return createStatsTask({
    platform,
    taskType: normalizedTaskType,
    episodes,
    dramaIds,
  });
}

app.post("/stat-tasks", async (req, res) => {
  if ((req.body?.platform === "manbo" ? "manbo" : "missevan") === "missevan") {
    await refreshMissevanCooldownState();
  }
  const task = createStatsTaskFromRequest(req, res);
  if (!task) {
    return;
  }
  return res.json(buildStatsTaskSnapshot(task));
});

function setNoStoreHeaders(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

app.get("/landing/regions", async (req, res) => {
  setNoStoreHeaders(res);
  const frontendVersion = getFrontendVersionFromRequest(req);

  if (!upstashClient.enabled) {
    return res.json({
      regions: LANDING_REGION_COOLDOWN_KEYS.map((region) =>
        buildLandingRegionSnapshot(region, null, frontendVersion, { statusKnown: false })
      ),
    });
  }

  try {
    const snapshots = await Promise.all(
      LANDING_REGION_COOLDOWN_KEYS.map(async (region) => {
        const raw = await upstashClient.command(["GET", region.cooldownKey]);
        return buildLandingRegionSnapshot(region, raw, frontendVersion);
      })
    );

    return res.json({ regions: snapshots });
  } catch (error) {
    console.error("Failed to read landing region snapshots from Upstash", error);
    return res.status(500).json({
      error: "Failed to read landing region snapshots",
      regions: LANDING_REGION_COOLDOWN_KEYS.map((region) =>
        buildLandingRegionSnapshot(region, null, frontendVersion, { statusKnown: false })
      ),
    });
  }
});

app.get("/stat-tasks/:taskId", async (req, res) => {
  const task = getStatsTaskOr404(req.params.taskId, res);
  if (!task) {
    return;
  }
  setNoStoreHeaders(res);
  refreshStatsTaskHeartbeat(task);
  return res.json(buildStatsTaskSnapshot(task));
});

app.post("/stat-tasks/:taskId/cancel", async (req, res) => {
  const task = getStatsTaskOr404(req.params.taskId, res);
  if (!task) {
    return;
  }
  task.cancelled = true;
  updateStatsTask(task, {
    status: task.status === "completed" ? "completed" : "cancelled",
    currentAction: task.status === "completed" ? task.currentAction : "统计已取消",
  });
  return res.json(buildStatsTaskSnapshot(task));
});

app.post("/manbo/stat-tasks", async (req, res) => {
  const task = createStatsTaskFromRequest(req, res, "manbo", "id");
  if (!task) {
    return;
  }
  return res.json(buildStatsTaskSnapshot(task));
});

app.get("/manbo/stat-tasks/:taskId", async (req, res) => {
  const task = getStatsTaskOr404(req.params.taskId, res);
  if (!task) {
    return;
  }
  setNoStoreHeaders(res);
  refreshStatsTaskHeartbeat(task);
  return res.json(buildStatsTaskSnapshot(task));
});

app.post("/manbo/stat-tasks/:taskId/cancel", async (req, res) => {
  const task = getStatsTaskOr404(req.params.taskId, res);
  if (!task) {
    return;
  }
  task.cancelled = true;
  updateStatsTask(task, {
    status: task.status === "completed" ? "completed" : "cancelled",
    currentAction: task.status === "completed" ? task.currentAction : "统计已取消",
  });
  return res.json(buildStatsTaskSnapshot(task));
});

app.use(express.static(path.join(__dirname, "dist")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

let serverInstance = null;

export async function startServer(port = defaultPort) {
  if (serverInstance) {
    return serverInstance;
  }

  await loadAccessDeniedCooldown();
  await persistCurrentAppVersionToCooldownState();
  await manboIndexStore.ensureLoaded();

  serverInstance = await new Promise((resolve, reject) => {
    const listener = app.listen(port, () => {
      resolve(listener);
    });

    listener.once("error", (error) => {
      serverInstance = null;
      reject(error);
    });
  });

  const actualPort = serverInstance.address()?.port ?? port;
  console.log(`server running on ${actualPort}`);
  return serverInstance;
}

if (process.env.START_SERVER_ON_IMPORT !== "false") {
  startServer().catch((error) => {
    console.error("Failed to start server", error);
    process.exitCode = 1;
  });
}
