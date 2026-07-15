import fs from "fs/promises";
import compression from "compression";
import express from "express";
import { rateLimit } from "express-rate-limit";
import fetch from "node-fetch";
import https from "https";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import {
  extractSearchSortKey,
  isCompleteSearchTermPrefix,
  isSearchKeywordLongEnough,
  parseMissevanInputToken,
  normalizeSearchText,
  stripSearchSeasonSuffix,
} from "../shared/searchUtils.js";
import {
  buildCombinedPinyinSearchUnits,
  buildCombinedPinyinSearchTokens,
  buildPinyinFullSearchTokens,
  buildPinyinSearchTokens,
  buildPinyinSearchUnits,
} from "../shared/pinyinSearchUtils.js";
import { canonicalizeCompatibleSearchText } from "../shared/searchCompatibility.js";
import { createUpstashRestClient } from "../shared/upstashRestClient.js";
import { loadLocalEnv } from "../envConfig.js";
import {
  isMissevanLikelyDanmakuOverflow,
  orderDetectedOverflowEpisodeKeys,
} from "../shared/episodeRules.js";
import {
  buildOngoingResponse,
  normalizeOngoingIdList,
} from "../shared/ongoingUtils.js";
import {
  computeMissevanRevenueMetrics,
  normalizeMissevanPayType,
  resolveMissevanRevenueType,
} from "../shared/missevanRevenueUtils.js";
import { aggregateRevenueFinancials } from "../shared/revenueSummaryUtils.js";
import {
  buildAggregatedRankTrendResponse,
  buildCvTrendResponse,
  buildMetricSnapshotsFromRankTrendAggregate,
  buildPeakSeriesTrendResponse,
  buildRankTrendAvailabilityResponse,
  getPeakSeriesDailyViewDelta,
  isCvRankTrendAggregateSnapshot,
  isRankTrendAggregateSnapshot,
  normalizeRankTrendDates,
} from "../shared/ranksTrendUtils.js";
import { normalizeVersion } from "../shared/versionUtils.js";
import {
  ImageProxyPolicyError,
  assertImageContentLength,
  detectImageContentType,
  readImageBodyWithLimit,
  validateImageProxyUrl,
} from "../shared/imageProxyPolicy.js";
import { TtlLruCache } from "../shared/ttlLruCache.js";
import { createStatsTaskEngine } from "./stats/taskEngine.js";
import {
  createStatsTaskExecutor,
  getManboRevenueType,
} from "./stats/taskExecution.js";
import {
  createJsonTaskStoreAdapter,
  createStatsTaskStore,
  createUpstashTaskStoreAdapter,
} from "./stats/taskStore.js";
import { createMissevanClient } from "./clients/missevanClient.js";
import { createManboClient } from "./clients/manboClient.js";
import { createSharedRequestRegistry } from "./clients/sharedRequest.js";
import { createDramaService } from "./services/dramaService.js";
import { searchLibraryWithFallback } from "./services/searchService.js";
import { createRequestSecurityMiddleware } from "./httpSecurity.js";
import { createLogger, createRequestLoggerMiddleware } from "./logger.js";
import { registerSystemRoutes } from "./routes/systemRoutes.js";
import { registerStatsRoutes } from "./routes/statsRoutes.js";
import { registerMissevanRoutes } from "./routes/missevanRoutes.js";
import { registerManboRoutes } from "./routes/manboRoutes.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");
const __filename = fileURLToPath(import.meta.url);
const __moduleDirname = path.dirname(__filename);
const __dirname = path.resolve(__moduleDirname, "..");
const desktopPackagedApp = process.env.DESKTOP_PACKAGED_APP === "true";
await loadLocalEnv({
  desktopApp: process.env.DESKTOP_APP === "true",
  projectRoot: desktopPackagedApp ? "" : __dirname,
  appDataDir: process.env.APP_DATA_DIR || "",
  exeDir: process.env.DESKTOP_EXE_DIR || "",
});

const app = express();
if (isHostedDeployment()) {
  app.set("trust proxy", 1);
}
const defaultPort = Number(process.env.PORT) || 3000;
const appDataDir = process.env.APP_DATA_DIR
  ? path.resolve(process.env.APP_DATA_DIR)
  : __dirname;
const logsDir = path.join(appDataDir, "logs");
const runtimeDir = path.join(appDataDir, "runtime");
const usageLogPath = path.join(logsDir, "usage.log");
const APP_VERSION = String(packageJson.version || "0.0.0").trim() || "0.0.0";
const logger = createLogger({ service: "missevan-counter" });
const JSON_BODY_LIMIT = String(process.env.JSON_BODY_LIMIT || "1mb").trim() || "1mb";
const ADMIN_CACHE_REFRESH_TOKEN = String(process.env.ADMIN_CACHE_REFRESH_TOKEN || "").trim();
const MISSEVAN_ENABLED = process.env.ENABLE_MISSEVAN !== "false";
const DESKTOP_APP = process.env.DESKTOP_APP === "true";
const DESKTOP_EXE_DIR = String(process.env.DESKTOP_EXE_DIR || "").trim();
const DESKTOP_FAVORITES_FILE_NAME = "mm-toolkit-favorites.json";
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
const MISSEVAN_COOLDOWN_MS = MISSEVAN_COOLDOWN_HOURS * 60 * 60 * 1000;
const MISSEVAN_REPEAT_COOLDOWN_MS =
  MISSEVAN_REPEAT_COOLDOWN_HOURS * 60 * 60 * 1000;

const MANBO_API_BASE = "https://www.kilamanbo.com/web_manbo";
const MANBO_API_V530_BASE = "https://api.kilamanbo.com/api/v530/radio/drama";
const MANBO_SEARCH_API_BASE = "https://api.kilamanbo.com/api/v530/search/page/content/new";
const MANBO_API_HOST = "www.kilamanbo.com";
const MANBO_INFO_KEY = "manbo:info:v1";
const MISSEVAN_INFO_KEY = "missevan:info:v1";
const NEW_DRAMA_IDS_KEY = "new:dramaIDs";
const RANKS_KEY = "ranks:latest";
const CV_RANKS_KEY = "ranks:cv:latest";
const MISSEVAN_PEAK_SERIES_TREND_KEY = "ranks:trend:peak:missevan";
const RANK_TREND_AGGREGATE_KEYS = Object.freeze({
  missevan: "ranks:trend:missevan",
  manbo: "ranks:trend:manbo",
});
const CV_RANK_TREND_AGGREGATE_KEYS = Object.freeze({
  missevan: "ranks:trend:cv:missevan",
  manbo: "ranks:trend:cv:manbo",
});
const ONGOING_KEY_PREFIX = "ongoing";
const INFO_STORE_SYNC_INTERVAL_MS = Math.max(
  5000,
  Number(process.env.INFO_STORE_SYNC_INTERVAL_MS ?? 30000) || 30000
);
const MANBO_INFO_FALLBACK_PATH = path.join(runtimeDir, "manbo-drama-info.json");
const MISSEVAN_INFO_FALLBACK_PATH = path.join(runtimeDir, "missevan-drama-info.json");
const NEW_DRAMA_IDS_FALLBACK_PATH = path.join(runtimeDir, "new-drama-ids.json");

const CACHE_MAX_ENTRIES = Math.max(
  0,
  Math.floor(
    getFiniteNumberEnv("CACHE_MAX_ENTRIES", isHostedDeployment() ? 500 : 1000)
  )
);
const MISSEVAN_DANMAKU_CACHE_MAX_ENTRIES = Math.max(
  0,
  Math.floor(
    getFiniteNumberEnv(
      "MISSEVAN_DANMAKU_CACHE_MAX_ENTRIES",
      isHostedDeployment() ? 20 : 200
    )
  )
);
const MANBO_DANMAKU_CACHE_MAX_ENTRIES = Math.max(
  0,
  Math.floor(
    getFiniteNumberEnv(
      "MANBO_DANMAKU_CACHE_MAX_ENTRIES",
      isHostedDeployment() ? 20 : 200
    )
  )
);
const danmakuCache = new TtlLruCache({
  maxEntries: MISSEVAN_DANMAKU_CACHE_MAX_ENTRIES,
});
const dramaCache = new TtlLruCache({ maxEntries: CACHE_MAX_ENTRIES });
const soundSummaryCache = new TtlLruCache({ maxEntries: CACHE_MAX_ENTRIES });
const rewardSummaryCache = new TtlLruCache({ maxEntries: CACHE_MAX_ENTRIES });
const rewardDetailCache = new TtlLruCache({ maxEntries: CACHE_MAX_ENTRIES });
const missevanSearchApiCache = new TtlLruCache({ maxEntries: CACHE_MAX_ENTRIES });
const manboSearchApiCache = new TtlLruCache({ maxEntries: CACHE_MAX_ENTRIES });
const manboDramaCache = new TtlLruCache({ maxEntries: CACHE_MAX_ENTRIES });
const manboSetCache = new TtlLruCache({ maxEntries: CACHE_MAX_ENTRIES });
const manboSetV530Cache = new TtlLruCache({ maxEntries: CACHE_MAX_ENTRIES });
const manboDanmakuCache = new TtlLruCache({
  maxEntries: MANBO_DANMAKU_CACHE_MAX_ENTRIES,
});
const manboDanmakuRequests = createSharedRequestRegistry();
const searchCardMetricRequests = createSharedRequestRegistry();
let activeSearchCardMetricRequests = 0;
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
  normalSnapshot: null,
  peakTrendSnapshot: null,
  cvSnapshot: null,
  cvTrendSnapshots: null,
  normalUpdatedAt: "",
  cvUpdatedAt: "",
  response: null,
  loadedAt: 0,
  loadPromise: null,
  meta: null,
  metaLoadedAt: 0,
  metaLoadFailedAt: 0,
  metaLoadPromise: null,
  metaPostRefreshBackoff: {
    normal: null,
    cv: null,
  },
};
const rankTrendAggregateCache = new TtlLruCache({ maxEntries: CACHE_MAX_ENTRIES });
const rankTrendsCache = new TtlLruCache({ maxEntries: CACHE_MAX_ENTRIES });
const ongoingCache = new TtlLruCache({ maxEntries: CACHE_MAX_ENTRIES });
const RANKS_RESPONSE_SCHEMA_VERSION = 5;
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
const RANKS_CACHE_TTL_MS = Math.max(
  60 * 1000,
  Number(process.env.RANKS_CACHE_TTL_MS ?? 30 * 60 * 1000) || 30 * 60 * 1000
);
const RANKS_EXPECTED_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;
const ONGOING_CACHE_TTL_MS = Math.max(
  10 * 1000,
  Number(process.env.ONGOING_CACHE_TTL_MS ?? 60 * 1000) || 60 * 1000
);
const RANKS_CACHE_TIME_ZONE = String(process.env.RANKS_CACHE_TIME_ZONE ?? "Asia/Shanghai").trim() || "Asia/Shanghai";
const RANKS_UPDATE_WINDOW_START_HOUR = 7;
const RANKS_UPDATE_WINDOW_END_HOUR = 10;
const RANKS_UPDATE_WINDOW_TTL_MS = Math.max(
  60 * 1000,
  getFiniteNumberEnv("RANKS_UPDATE_WINDOW_TTL_MS", 10 * 60 * 1000)
);
const RANKS_META_KEY = "ranks:meta";
const RANKS_META_PROBE_EXPECTED_TTL_MS = 2 * 60 * 1000;
const RANKS_META_PROBE_FALLBACK_TTL_MS = 10 * 60 * 1000;
const RANKS_META_POST_REFRESH_TTL_MS = 30 * 60 * 1000;
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
const SEARCH_CARD_METRICS_TIMEOUT_MS = 12_000;
const SEARCH_CARD_METRICS_MAX_ACTIVE = 20;
const MISSEVAN_GETDM_MIN_INTERVAL_MS = 200;
const MISSEVAN_GETDM_MAX_INTERVAL_MS = 400;
const MISSEVAN_HOSTED_REQUEST_MIN_INTERVAL_MS = 800;
const MISSEVAN_HOSTED_REQUEST_MAX_INTERVAL_MS = 1400;
const MISSEVAN_LOCAL_REQUEST_MIN_INTERVAL_MS = 250;
const MISSEVAN_LOCAL_REQUEST_MAX_INTERVAL_MS = 500;
const MISSEVAN_FALLBACK_DEFAULT_BASE_URL = "https://msbackup.onrender.com/missevan";
const MISSEVAN_FALLBACK_BASE_URL = normalizeMissevanFallbackBaseUrl(
  process.env.MISSEVAN_FALLBACK_BASE_URL || MISSEVAN_FALLBACK_DEFAULT_BASE_URL,
  MISSEVAN_FALLBACK_DEFAULT_BASE_URL
);
const MISSEVAN_FALLBACK_PROXY_TOKEN = String(
  process.env.MISSEVAN_FALLBACK_PROXY_TOKEN || ""
).trim();
const MISSEVAN_FALLBACK_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.MISSEVAN_FALLBACK_TIMEOUT_MS ?? 90000) || 90000
);
const MISSEVAN_SECONDARY_FALLBACK_DEFAULT_BASE_URL = "https://msbackup.mmtoolkit.deno.net/missevan";
const MISSEVAN_SECONDARY_FALLBACK_BASE_URL = normalizeMissevanFallbackBaseUrl(
  process.env.MISSEVAN_SECONDARY_FALLBACK_BASE_URL || MISSEVAN_SECONDARY_FALLBACK_DEFAULT_BASE_URL,
  MISSEVAN_SECONDARY_FALLBACK_DEFAULT_BASE_URL
);
const MISSEVAN_SECONDARY_FALLBACK_PROXY_TOKEN = String(
  process.env.MISSEVAN_SECONDARY_FALLBACK_PROXY_TOKEN || ""
).trim();
const MISSEVAN_SECONDARY_FALLBACK_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.MISSEVAN_SECONDARY_FALLBACK_TIMEOUT_MS ?? 15000) || 15000
);
const MISSEVAN_FORCE_FALLBACK = String(process.env.MISSEVAN_FORCE_FALLBACK ?? "0").trim();
const MISSEVAN_FALLBACK_ROUTES = Object.freeze([
  Object.freeze({
    key: "primary",
    fallbackRoute: "render",
    baseUrl: MISSEVAN_FALLBACK_BASE_URL,
    proxyToken: MISSEVAN_FALLBACK_PROXY_TOKEN,
    timeoutMs: MISSEVAN_FALLBACK_TIMEOUT_MS,
  }),
  Object.freeze({
    key: "secondary",
    fallbackRoute: "deno",
    baseUrl: MISSEVAN_SECONDARY_FALLBACK_BASE_URL,
    proxyToken: MISSEVAN_SECONDARY_FALLBACK_PROXY_TOKEN,
    timeoutMs: MISSEVAN_SECONDARY_FALLBACK_TIMEOUT_MS,
  }),
]);
const IMAGE_PROXY_TIMEOUT_MS = 8000;
const IMAGE_PROXY_RETRIES = 2;
const IMAGE_PROXY_RETRY_DELAY_MS = 250;
const IMAGE_PROXY_MAX_REDIRECTS = 3;
const IMAGE_PROXY_MAX_BYTES = Math.max(
  1024,
  Math.floor(
    getFiniteNumberEnv("IMAGE_PROXY_MAX_BYTES", 10 * 1024 * 1024)
  )
);
const STATS_TASK_MAX_ITEMS = Math.max(
  1,
  Math.floor(getFiniteNumberEnv("STATS_TASK_MAX_ITEMS", 1000))
);
const MISSEVAN_STATS_MAX_CONCURRENCY = Math.max(
  1,
  Math.floor(getFiniteNumberEnv("MISSEVAN_STATS_MAX_CONCURRENCY", 2))
);
const MANBO_STATS_MAX_CONCURRENCY = Math.max(
  1,
  Math.floor(getFiniteNumberEnv("MANBO_STATS_MAX_CONCURRENCY", 3))
);
const STATS_TASK_QUEUE_MAX = Math.max(
  0,
  Math.floor(getFiniteNumberEnv("STATS_TASK_QUEUE_MAX", 20))
);
const STATS_TASK_CLIENT_QUEUE_MAX = Math.max(
  0,
  Math.floor(getFiniteNumberEnv("STATS_TASK_CLIENT_QUEUE_MAX", 3))
);
const MISSEVAN_BROWSER_HEADERS = Object.freeze({
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept": "application/json,text/plain,*/*",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  "Referer": "https://www.missevan.com/",
  "Origin": "https://www.missevan.com",
});
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
const fallbackAccessDeniedCooldowns = {
  primary: {
    accessUntil: 0,
    useShortCooldown: false,
    cooldownMode: "none",
  },
  secondary: {
    accessUntil: 0,
    useShortCooldown: false,
    cooldownMode: "none",
  },
};
let cooldownStateLoaded = false;
let cooldownPersistenceWarningLogged = false;
let cooldownRefreshPromise = null;
let lastCooldownRefreshSucceeded = false;
let nextMissevanRequestAt = 0;
let missevanRequestThrottleTail = Promise.resolve();

function getRateLimitRetryAfterSeconds(req, fallbackSeconds = 60) {
  const resetTime = req.rateLimit?.resetTime;
  const resetAt = resetTime instanceof Date ? resetTime.getTime() : Number(resetTime ?? 0);
  if (!Number.isFinite(resetAt) || resetAt <= Date.now()) {
    return fallbackSeconds;
  }
  return Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
}

function createJsonRateLimitHandler(code, message, fallbackSeconds) {
  return (req, res) => {
    const retryAfterSeconds = getRateLimitRetryAfterSeconds(req, fallbackSeconds);
    res.setHeader("Retry-After", String(retryAfterSeconds));
    return res.status(429).json({
      success: false,
      code,
      message,
      retryAfterSeconds,
    });
  };
}

const statsTaskCreationLimiter = rateLimit({
  windowMs: 2 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: createJsonRateLimitHandler(
    "TASK_RATE_LIMITED",
    "统计任务创建过于频繁，请稍后重试。",
    120
  ),
});
const expensiveDataLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: createJsonRateLimitHandler(
    "DATA_RATE_LIMITED",
    "数据请求过于频繁，请稍后重试。",
    60
  ),
});
const searchCardMetricsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: createJsonRateLimitHandler(
    "METRICS_RATE_LIMITED",
    "动态指标请求过于频繁，请稍后重试。",
    60
  ),
});
const imageProxyLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: createJsonRateLimitHandler(
    "IMAGE_RATE_LIMITED",
    "图片请求过于频繁，请稍后重试。",
    60
  ),
});

const statsTaskInstanceId = String(
  process.env.RAILWAY_REPLICA_ID ||
  process.env.HOSTNAME ||
  "local"
).trim() || "local";
const statsTaskStore = createStatsTaskStore({
  adapter: upstashClient.enabled
    ? createUpstashTaskStoreAdapter({
        client: upstashClient,
        instanceId: statsTaskInstanceId,
        ttlSeconds: Math.ceil(MANBO_STATS_TASK_TTL_MS / 1000),
      })
    : createJsonTaskStoreAdapter(path.join(runtimeDir, "stats-tasks.json")),
  onError(error) {
    console.warn(`Stats task snapshot failed: ${formatImageProxyError(error)}`);
  },
});
const statsTaskReporters = new WeakMap();
let statsTaskExecutor = null;
const statsTaskEngine = createStatsTaskEngine({
  limits: {
    missevan: {
      maxActive: MISSEVAN_STATS_MAX_CONCURRENCY,
      maxActivePerClient: 1,
      maxQueued: STATS_TASK_QUEUE_MAX,
      maxQueuedPerClient: STATS_TASK_CLIENT_QUEUE_MAX,
    },
    manbo: {
      maxActive: MANBO_STATS_MAX_CONCURRENCY,
      maxActivePerClient: 2,
      maxQueued: STATS_TASK_QUEUE_MAX,
      maxQueuedPerClient: STATS_TASK_CLIENT_QUEUE_MAX,
    },
  },
  execute: (...args) => statsTaskExecutor(...args),
  store: statsTaskStore,
  retentionMs: MANBO_STATS_TASK_TTL_MS,
  onCompleted: async (snapshot) => {
    const entry = buildStatsTaskCompletedUsageLog(snapshot);
    if (entry) {
      await writeUsageLog(entry);
    }
  },
});
const missevanClient = createMissevanClient({
  soundSummary: fetchSoundSummary,
  dramaInfo: fetchDramaInfo,
  danmakuSummary: fetchDanmakuSummary,
  rewardSummary: fetchRewardSummary,
  rewardDetailMeta: fetchRewardDetailMeta,
});
const manboClient = createManboClient({
  dramaDetail: fetchManboDramaDetail,
  setDetail: fetchManboStatsSetDetail,
  danmakuSummary: fetchManboDanmakuSummary,
});
const dramaService = createDramaService({ missevanClient, manboClient });
statsTaskExecutor = createStatsTaskExecutor({
  aggregateRevenueFinancials,
  buildIdDramaMap,
  buildMissevanPlayCountWorkPlan,
  buildOverflowEpisodeKey,
  buildPlayCountDramaMap,
  computeMissevanRevenueMetrics,
  fetchManboSetSummary,
  isAccessDeniedError,
  isLikelyManboDanmakuOverflow,
  isManboMemberDramaInfo,
  isMissevanAccessDenied,
  isMissevanLikelyDanmakuOverflow,
  manboClient,
  MANBO_STATS_EPISODE_CONCURRENCY,
  missevanClient,
  normalizeMissevanPayType,
  normalizeOptionalFiniteNumber,
  orderDetectedOverflowEpisodeKeys,
  refreshMissevanCooldownState,
  reportStatsTask,
  resolveMissevanPlayCountDramaTotal,
  resolveMissevanRevenueType,
  runWithConcurrency,
  shouldBlockMissevanAccessForCooldown,
  statsTaskReporters,
  writeWatchCountUsageLog,
});

app.use(createRequestSecurityMiddleware({
  desktopApp: DESKTOP_APP,
  twikooUrl: FEATURE_SUGGESTION_URL,
  logger,
}));
app.use(createRequestLoggerMiddleware({ logger }));
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    const type = String(res.getHeader("Content-Type") || "").toLowerCase();
    return type.includes("application/json") && compression.filter(req, res);
  },
}));

app.use((error, req, res, next) => {
  if (error?.type === "request.aborted" || error?.code === "ECONNABORTED") {
    console.warn("Request body aborted before parsing completed", {
      method: req.method,
      url: req.originalUrl || req.url,
      contentLength: req.get("content-length") || "",
      expected: error?.expected ?? "",
      received: error?.received ?? "",
      userAgent: req.get("user-agent") || "",
    });

    if (!res.headersSent) {
      return res.status(400).json({
        success: false,
        message: "Request aborted",
      });
    }
    return;
  }

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

function getDesktopFavoritesFilePath() {
  return path.join(DESKTOP_EXE_DIR || appDataDir, DESKTOP_FAVORITES_FILE_NAME);
}

function normalizeDesktopFavoriteString(value) {
  return String(value ?? "").trim();
}

function normalizeDesktopFavoriteTimestamp(value, fallback = 0) {
  const timestamp = Number(value ?? fallback);
  return Number.isFinite(timestamp) && timestamp > 0 ? Math.trunc(timestamp) : fallback;
}

function normalizeDesktopFavoriteRecord(record = {}) {
  const platform = normalizeDesktopFavoriteString(record.platform);
  const dramaId = normalizeDesktopFavoriteString(record.dramaId ?? record.id);
  if (!["missevan", "manbo"].includes(platform) || !dramaId) {
    return null;
  }
  const key = `${platform}:${dramaId}`;
  const now = Date.now();
  const createdAt = normalizeDesktopFavoriteTimestamp(record.createdAt, now);
  const updatedAt = normalizeDesktopFavoriteTimestamp(record.updatedAt, createdAt);
  return {
    key,
    platform,
    dramaId,
    title: normalizeDesktopFavoriteString(record.title ?? record.name) || key,
    cover: normalizeDesktopFavoriteString(record.cover),
    paymentLabel: normalizeDesktopFavoriteString(record.paymentLabel ?? record.payment_label),
    contentTypeLabel: normalizeDesktopFavoriteString(record.contentTypeLabel ?? record.content_type_label),
    dramaUpdatedAt: normalizeDesktopFavoriteString(record.dramaUpdatedAt ?? record.drama_updated_at ?? record.updated_at),
    mainCvText: normalizeDesktopFavoriteString(record.mainCvText ?? record.main_cv_text),
    createdAt,
    updatedAt,
    lastSnapshotAt: normalizeDesktopFavoriteTimestamp(record.lastSnapshotAt, 0),
  };
}

function normalizeDesktopFavoriteMetricNumber(value, fallback = 0) {
  if (value == null || value === "") {
    return fallback;
  }
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function normalizeDesktopFavoriteSnapshot(record = {}) {
  const platform = normalizeDesktopFavoriteString(record.platform);
  const dramaId = normalizeDesktopFavoriteString(record.dramaId ?? record.id);
  const favoriteKey = normalizeDesktopFavoriteString(record.favoriteKey) || `${platform}:${dramaId}`;
  if (!["missevan", "manbo"].includes(platform) || !dramaId || !favoriteKey) {
    return null;
  }
  const capturedAt = normalizeDesktopFavoriteTimestamp(record.capturedAt, Date.now());
  const sourceMetrics = record.metrics && typeof record.metrics === "object" ? record.metrics : {};
  const errors = Array.isArray(record.errors)
    ? record.errors.map((item) => normalizeDesktopFavoriteString(item)).filter(Boolean)
    : [];
  return {
    id: normalizeDesktopFavoriteString(record.id) || `${favoriteKey}:${capturedAt}`,
    favoriteKey,
    platform,
    dramaId,
    capturedAt,
    status: normalizeDesktopFavoriteString(record.status) || (errors.length ? "partial" : "success"),
    metrics: {
      viewCount: normalizeDesktopFavoriteMetricNumber(sourceMetrics.viewCount, 0),
      subscriptionCount: normalizeDesktopFavoriteMetricNumber(sourceMetrics.subscriptionCount, 0),
      rewardCount: sourceMetrics.rewardCount == null ? null : normalizeDesktopFavoriteMetricNumber(sourceMetrics.rewardCount, 0),
      rewardTotal: sourceMetrics.rewardTotal == null ? null : normalizeDesktopFavoriteMetricNumber(sourceMetrics.rewardTotal, 0),
      giftTotal: sourceMetrics.giftTotal == null ? null : normalizeDesktopFavoriteMetricNumber(sourceMetrics.giftTotal, 0),
      paidOrListenCount: sourceMetrics.paidOrListenCount == null ? null : normalizeDesktopFavoriteMetricNumber(sourceMetrics.paidOrListenCount, 0),
      paidIdCount: normalizeDesktopFavoriteMetricNumber(sourceMetrics.paidIdCount, 0),
    },
    errors,
  };
}

function normalizeDesktopFavoriteSettings(settings = {}) {
  const deltaMetric = ["viewCount", "subscriptionCount", "rewardCount", "rewardTotal", "paidOrListenCount", "paidIdCount"].includes(settings?.deltaMetric)
    ? settings.deltaMetric
    : "viewCount";
  const sortBy = ["lastSnapshotAt", "viewCount", "subscriptionCount", "rewardTotal", "paidIdCount"].includes(settings?.sortBy)
    ? settings.sortBy
    : "lastSnapshotAt";
  return { deltaMetric, sortBy };
}

function normalizeDesktopFavoritesBackup(payload = {}) {
  const favoritesByKey = new Map();
  (Array.isArray(payload?.favorites) ? payload.favorites : []).forEach((item) => {
    const favorite = normalizeDesktopFavoriteRecord(item);
    if (!favorite) {
      return;
    }
    const previous = favoritesByKey.get(favorite.key);
    if (!previous || Number(favorite.updatedAt) >= Number(previous.updatedAt)) {
      favoritesByKey.set(favorite.key, favorite);
    }
  });
  const snapshotsById = new Map();
  (Array.isArray(payload?.snapshots) ? payload.snapshots : []).forEach((item) => {
    const snapshot = normalizeDesktopFavoriteSnapshot(item);
    if (snapshot) {
      snapshotsById.set(snapshot.id, snapshot);
    }
  });
  return {
    app: "mm-toolkit",
    type: "favorites-backup",
    version: 1,
    exportedAt: normalizeDesktopFavoriteString(payload?.exportedAt) || new Date().toISOString(),
    favorites: Array.from(favoritesByKey.values()),
    snapshots: Array.from(snapshotsById.values()),
    settings: normalizeDesktopFavoriteSettings(payload?.settings),
  };
}

function ensureDesktopFavoritesRequest(res) {
  if (!DESKTOP_APP) {
    res.status(404).json({ success: false, message: "Desktop favorites are unavailable" });
    return false;
  }
  return true;
}

export function buildDesktopFavoritesReadErrorPayload(filePath = getDesktopFavoritesFilePath()) {
  return {
    success: false,
    message: "桌面收藏 JSON 读取失败",
    exists: false,
    data: normalizeDesktopFavoritesBackup({}),
    filePath,
  };
}

async function writeDesktopFavoritesFile(data) {
  const filePath = getDesktopFavoritesFilePath();
  const payload = `${JSON.stringify(normalizeDesktopFavoritesBackup(data), null, 2)}\n`;
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(tempPath, payload, "utf8");
  await fs.rename(tempPath, filePath);
  return filePath;
}

async function readDesktopFavoritesFile() {
  const filePath = getDesktopFavoritesFilePath();
  try {
    const content = await fs.readFile(filePath, "utf8");
    const trimmed = String(content || "").trim();
    return {
      exists: true,
      data: trimmed ? JSON.parse(trimmed) : null,
      filePath,
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { exists: false, data: null, filePath };
    }
    throw error;
  }
}

registerSystemRoutes(app, {
  appVersion: APP_VERSION,
  desktopApp: DESKTOP_APP,
  desktopAppUrl: MISSEVAN_DESKTOP_APP_URL,
  featureSuggestionUrl: FEATURE_SUGGESTION_URL,
  getDesktopFavoritesFilePath,
  getFrontendVersionFromRequest,
  getMissevanAccessDeniedCooldownUntil,
  logger,
  missevanCooldownHours: MISSEVAN_COOLDOWN_HOURS,
  missevanEnabled: MISSEVAN_ENABLED,
  normalizeDesktopFavoritesBackup,
  normalizeTextValue,
  readDesktopFavoritesFile,
  writeDesktopFavoritesFile,
  buildDesktopFavoritesReadErrorPayload,
  buildFavoriteMetaFromInfoStore,
  ensureDesktopFavoritesRequest,
});

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal.reason || new DOMException("Aborted", "AbortError"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function getMissevanGetdmJitterDelayMs(randomValue = Math.random()) {
  const numericRandomValue = Number(randomValue);
  const normalizedRandomValue = Number.isFinite(numericRandomValue)
    ? Math.min(1, Math.max(0, numericRandomValue))
    : Math.random();
  return Math.round(
    MISSEVAN_GETDM_MIN_INTERVAL_MS +
      normalizedRandomValue *
        (MISSEVAN_GETDM_MAX_INTERVAL_MS - MISSEVAN_GETDM_MIN_INTERVAL_MS)
  );
}

function getFinitePositiveIntervalValue(value, fallbackValue) {
  if (value == null || String(value).trim() === "") {
    return fallbackValue;
  }
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0
    ? normalized
    : fallbackValue;
}

export function getMissevanRequestIntervalConfig(options = {}) {
  const hostedDeployment = options.hostedDeployment ?? isHostedDeployment();
  const fallbackMinMs = hostedDeployment
    ? MISSEVAN_HOSTED_REQUEST_MIN_INTERVAL_MS
    : MISSEVAN_LOCAL_REQUEST_MIN_INTERVAL_MS;
  const fallbackMaxMs = hostedDeployment
    ? MISSEVAN_HOSTED_REQUEST_MAX_INTERVAL_MS
    : MISSEVAN_LOCAL_REQUEST_MAX_INTERVAL_MS;
  const rawMinMs = options.minIntervalMs ?? process.env.MISSEVAN_REQUEST_MIN_INTERVAL_MS;
  const rawMaxMs = options.maxIntervalMs ?? process.env.MISSEVAN_REQUEST_MAX_INTERVAL_MS;
  const firstValue = getFinitePositiveIntervalValue(rawMinMs, fallbackMinMs);
  const secondValue = getFinitePositiveIntervalValue(rawMaxMs, fallbackMaxMs);

  return {
    minMs: Math.min(firstValue, secondValue),
    maxMs: Math.max(firstValue, secondValue),
  };
}

const MISSEVAN_REQUEST_INTERVAL_CONFIG = getMissevanRequestIntervalConfig();

export function getMissevanRequestJitterDelayMs(
  randomValue = Math.random(),
  config = MISSEVAN_REQUEST_INTERVAL_CONFIG
) {
  const numericRandomValue = Number(randomValue);
  const normalizedRandomValue = Number.isFinite(numericRandomValue)
    ? Math.min(1, Math.max(0, numericRandomValue))
    : Math.random();
  const minMs = getFinitePositiveIntervalValue(config?.minMs, MISSEVAN_LOCAL_REQUEST_MIN_INTERVAL_MS);
  const maxMs = getFinitePositiveIntervalValue(config?.maxMs, minMs);
  const safeMinMs = Math.min(minMs, maxMs);
  const safeMaxMs = Math.max(minMs, maxMs);

  return Math.round(
    safeMinMs + normalizedRandomValue * (safeMaxMs - safeMinMs)
  );
}

function waitForPromiseWithSignal(promise, signal) {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(signal.reason || new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      reject(signal.reason || new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

async function waitForMissevanRequestSlot(signal) {
  const previousTail = missevanRequestThrottleTail;
  let releaseSlot = () => {};
  missevanRequestThrottleTail = new Promise((resolve) => {
    releaseSlot = resolve;
  });

  try {
    await waitForPromiseWithSignal(previousTail, signal);
  } catch (error) {
    void previousTail.finally(releaseSlot);
    throw error;
  }

  try {
    const waitMs = Math.max(0, nextMissevanRequestAt - Date.now());
    if (waitMs > 0) {
      await sleep(waitMs, signal);
    }

    nextMissevanRequestAt =
      Date.now() + getMissevanRequestJitterDelayMs();
  } finally {
    releaseSlot();
  }
}

function createTaskId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function cleanupExpiredStatsTasks() {
  statsTaskEngine.pruneExpired();
}

function buildStatsTaskSnapshot(task) {
  return statsTaskEngine.getSnapshot(task?.taskId);
}

function reportStatsTask(task, patch) {
  const { status, ...safePatch } = patch || {};
  const reported = statsTaskReporters.get(task)?.(safePatch) ?? false;
  if (status === "completed" || status === "cancelled") {
    return { status, patch: safePatch };
  }
  return reported;
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

function isFalsyEnvValue(value) {
  return ["0", "false", "no", "off"].includes(String(value ?? "").trim().toLowerCase());
}

function isHostedDeploymentEnv(env = process.env) {
  return (
    Boolean(env.RAILWAY_ENVIRONMENT)
    || Boolean(env.RAILWAY_PROJECT_ID)
    || Boolean(env.RAILWAY_SERVICE_ID)
  );
}

function isHostedDeployment() {
  return isHostedDeploymentEnv();
}

export function shouldPersistAccessDeniedCooldownForEnv(env = process.env, options = {}) {
  const missevanEnabled = options.missevanEnabled ?? env.ENABLE_MISSEVAN !== "false";
  const desktopApp = options.desktopApp ?? env.DESKTOP_APP === "true";
  const hostedDeployment = options.hostedDeployment ?? isHostedDeploymentEnv(env);

  if (!missevanEnabled || desktopApp || !hostedDeployment) {
    return false;
  }

  const explicitValue = env.MISSEVAN_PERSISTENT_COOLDOWN;
  if (isFalsyEnvValue(explicitValue)) {
    return false;
  }

  return true;
}

function shouldPersistAccessDeniedCooldown() {
  return shouldPersistAccessDeniedCooldownForEnv(process.env, {
    missevanEnabled: MISSEVAN_ENABLED,
    desktopApp: DESKTOP_APP,
  });
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

function normalizeMissevanCooldownMode(value) {
  return value === "base" || value === "repeat" || value === "repeat_ready"
    ? value
    : "none";
}

function normalizeMissevanRouteCooldownState(state = {}) {
  const accessUntil = Number(state?.accessUntil ?? state?.accessDeniedUntil ?? 0);
  return {
    accessUntil: Number.isFinite(accessUntil) ? accessUntil : 0,
    cooldownMode: normalizeMissevanCooldownMode(state?.cooldownMode ?? state?.accessDeniedCooldownMode),
    useShortCooldown: state?.useShortCooldown === true || state?.accessDeniedUseShortCooldown === true,
  };
}

export function parseMissevanCooldownStatePayload(payload = {}) {
  return {
    appVersion: normalizeVersion(payload?.appVersion),
    direct: normalizeMissevanRouteCooldownState(payload),
    primary: normalizeMissevanRouteCooldownState({
      accessUntil: payload?.primaryAccessDeniedUntil,
      cooldownMode: payload?.primaryAccessDeniedCooldownMode,
      useShortCooldown: payload?.primaryAccessDeniedUseShortCooldown,
    }),
    secondary: normalizeMissevanRouteCooldownState({
      accessUntil: payload?.secondaryAccessDeniedUntil,
      cooldownMode: payload?.secondaryAccessDeniedCooldownMode,
      useShortCooldown: payload?.secondaryAccessDeniedUseShortCooldown,
    }),
  };
}

export function buildMissevanRouteCooldownStateAfterAccessDenied(state = {}, options = {}) {
  const normalizedState = normalizeMissevanRouteCooldownState(state);
  const now = Number(options.now ?? Date.now());
  const baseCooldownMs = Number(options.baseCooldownMs ?? MISSEVAN_COOLDOWN_MS);
  const repeatCooldownMs = Number(options.repeatCooldownMs ?? MISSEVAN_REPEAT_COOLDOWN_MS);
  const useShortCooldown = normalizedState.useShortCooldown;

  return {
    accessUntil: now + (useShortCooldown ? repeatCooldownMs : baseCooldownMs),
    cooldownMode: useShortCooldown ? "repeat" : "base",
    useShortCooldown,
  };
}

function buildMissevanRouteRepeatReadyState(state = {}) {
  const normalizedState = normalizeMissevanRouteCooldownState(state);
  const shouldUseRepeatCooldown =
    normalizedState.useShortCooldown
    || ["base", "repeat", "repeat_ready"].includes(normalizedState.cooldownMode);

  return {
    accessUntil: 0,
    useShortCooldown: shouldUseRepeatCooldown,
    cooldownMode: shouldUseRepeatCooldown ? "repeat_ready" : "none",
  };
}

export function getNearestMissevanAccessUntil(states = [], now = Date.now()) {
  const futureAccessTimes = states
    .map((state) => Number(state?.accessUntil ?? state?.accessDeniedUntil ?? 0))
    .filter((value) => Number.isFinite(value) && value > now);
  return futureAccessTimes.length ? Math.min(...futureAccessTimes) : 0;
}

export function selectMissevanRequestRoute({
  directState = {},
  fallbackRoutes = [],
  now = Date.now(),
} = {}) {
  const normalizedDirectState = normalizeMissevanRouteCooldownState(directState);
  if (normalizedDirectState.accessUntil <= now) {
    return { type: "direct", routeKey: "direct", cooldownUntil: 0 };
  }

  const enabledRoutes = (Array.isArray(fallbackRoutes) ? fallbackRoutes : [])
    .filter((route) => route?.enabled !== false);
  const availableRoute = enabledRoutes.find(
    (route) => normalizeMissevanRouteCooldownState(route?.state).accessUntil <= now
  );
  if (availableRoute) {
    return {
      type: "fallback",
      routeKey: String(availableRoute.key || ""),
      cooldownUntil: 0,
    };
  }

  return {
    type: "blocked",
    routeKey: "",
    cooldownUntil: getNearestMissevanAccessUntil(
      [
        normalizedDirectState,
        ...enabledRoutes.map((route) => normalizeMissevanRouteCooldownState(route?.state)),
      ],
      now
    ),
  };
}

function getDirectCooldownState() {
  return {
    accessUntil: accessDeniedUntil,
    cooldownMode: accessDeniedCooldownMode,
    useShortCooldown: accessDeniedUseShortCooldown,
  };
}

function applyDirectCooldownState(state = {}) {
  const normalizedState = normalizeMissevanRouteCooldownState(state);
  accessDeniedUntil = normalizedState.accessUntil;
  accessDeniedCooldownMode = normalizedState.cooldownMode;
  accessDeniedUseShortCooldown = normalizedState.useShortCooldown;
}

function getFallbackCooldownState(routeKey) {
  return normalizeMissevanRouteCooldownState(fallbackAccessDeniedCooldowns[routeKey]);
}

function applyFallbackCooldownState(routeKey, state = {}) {
  if (!fallbackAccessDeniedCooldowns[routeKey]) {
    return;
  }
  fallbackAccessDeniedCooldowns[routeKey] = normalizeMissevanRouteCooldownState(state);
}

function getAllMissevanCooldownStates() {
  return [
    getDirectCooldownState(),
    getFallbackCooldownState("primary"),
    getFallbackCooldownState("secondary"),
  ];
}

function getNearestMissevanCooldownUntil() {
  return getNearestMissevanAccessUntil(getAllMissevanCooldownStates());
}

function getCooldownStatePayload() {
  const primaryCooldown = getFallbackCooldownState("primary");
  const secondaryCooldown = getFallbackCooldownState("secondary");
  return {
    appVersion: APP_VERSION,
    accessDeniedUntil,
    accessDeniedCooldownMode,
    accessDeniedUseShortCooldown,
    primaryAccessDeniedUntil: primaryCooldown.accessUntil,
    primaryAccessDeniedCooldownMode: primaryCooldown.cooldownMode,
    primaryAccessDeniedUseShortCooldown: primaryCooldown.useShortCooldown,
    secondaryAccessDeniedUntil: secondaryCooldown.accessUntil,
    secondaryAccessDeniedCooldownMode: secondaryCooldown.cooldownMode,
    secondaryAccessDeniedUseShortCooldown: secondaryCooldown.useShortCooldown,
  };
}

function applyLoadedCooldownState(payload) {
  const parsed = parseMissevanCooldownStatePayload(payload);
  applyDirectCooldownState(parsed.direct);
  applyFallbackCooldownState("primary", parsed.primary);
  applyFallbackCooldownState("secondary", parsed.secondary);
}

function armRepeatCooldownIfNeeded() {
  applyDirectCooldownState(buildMissevanRouteRepeatReadyState(getDirectCooldownState()));
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
    if (!raw) {
      applyDirectCooldownState();
      applyFallbackCooldownState("primary");
      applyFallbackCooldownState("secondary");
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
    cooldownUntil: getNearestMissevanCooldownUntil(),
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

function isMissevanFallbackRouteInCooldown(route) {
  const routeState = getFallbackCooldownState(route?.key);
  if (routeState.accessUntil > 0 && routeState.accessUntil <= Date.now()) {
    applyFallbackCooldownState(route?.key, buildMissevanRouteRepeatReadyState(routeState));
    void persistAccessDeniedCooldown();
    return false;
  }

  return Date.now() < routeState.accessUntil;
}

function markAccessDeniedCooldown() {
  applyDirectCooldownState(buildMissevanRouteCooldownStateAfterAccessDenied(getDirectCooldownState()));
  cooldownStateLoaded = true;
  lastCooldownRefreshSucceeded = true;
  void persistAccessDeniedCooldown();
}

function markMissevanFallbackRouteCooldown(route) {
  applyFallbackCooldownState(
    route?.key,
    buildMissevanRouteCooldownStateAfterAccessDenied(getFallbackCooldownState(route?.key))
  );
  cooldownStateLoaded = true;
  lastCooldownRefreshSucceeded = true;
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

function createCooldownError(remainingMs = getCooldownRemainingMs()) {
  const seconds = Math.ceil(Math.max(0, remainingMs) / 1000);
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

function getHourInRanksCacheTimeZone(now = Date.now(), timeZone = "Asia/Shanghai") {
  const parts = getDateTimePartsInRanksCacheTimeZone(now, timeZone);
  return Number.isInteger(parts.hour) ? parts.hour : new Date(now).getHours();
}

function getDateTimePartsInRanksCacheTimeZone(now = Date.now(), timeZone = "Asia/Shanghai") {
  const date = now instanceof Date ? now : new Date(now);
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const year = Number(parts.find((part) => part.type === "year")?.value);
    const month = Number(parts.find((part) => part.type === "month")?.value);
    const dayOfMonth = Number(parts.find((part) => part.type === "day")?.value);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    if (
      Number.isInteger(year) &&
      Number.isInteger(month) &&
      Number.isInteger(dayOfMonth) &&
      Number.isInteger(hour) &&
      hour >= 0 &&
      hour <= 23
    ) {
      return { year, month, dayOfMonth, hour };
    }
  } catch (_) {
    if (timeZone !== "Asia/Shanghai") {
      return getDateTimePartsInRanksCacheTimeZone(now, "Asia/Shanghai");
    }
  }
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    dayOfMonth: date.getDate(),
    hour: date.getHours(),
  };
}

function getFixedUtcMinusFourParts(now = Date.now()) {
  const date = now instanceof Date ? now : new Date(now);
  const shifted = new Date(date.getTime() - 4 * 60 * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const dayOfMonth = shifted.getUTCDate();
  return {
    year,
    month,
    dayOfMonth,
    dateId: formatFixedUtcMinusFourDateId(year, month, dayOfMonth),
    day: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

function formatFixedUtcMinusFourDateId(year, month, dayOfMonth) {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(dayOfMonth).padStart(2, "0"),
  ].join("-");
}

function getPreviousFixedUtcMinusFourDateId(parts) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.dayOfMonth - 1));
  return formatFixedUtcMinusFourDateId(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate()
  );
}

function buildRanksProbePhase(active, phase = "idle", ttlMs = Infinity) {
  return { active, phase, ttlMs };
}

function getDailyCrossMidnightProbePhase(minutes, config) {
  const { start, expectedStart, expectedEnd, stop, prefix } = config;
  if (minutes >= start) {
    if (minutes < expectedStart) {
      return buildRanksProbePhase(true, `${prefix}-warmup`, RANKS_META_PROBE_FALLBACK_TTL_MS);
    }
    if (minutes < expectedEnd) {
      return buildRanksProbePhase(true, `${prefix}-expected`, RANKS_META_PROBE_EXPECTED_TTL_MS);
    }
    return buildRanksProbePhase(true, `${prefix}-fallback`, RANKS_META_PROBE_FALLBACK_TTL_MS);
  }
  if (minutes < stop) {
    return buildRanksProbePhase(true, `${prefix}-fallback`, RANKS_META_PROBE_FALLBACK_TTL_MS);
  }
  return buildRanksProbePhase(false);
}

function getWeeklyThursdayCrossMidnightProbePhase(day, minutes, config) {
  const { start, expectedStart, expectedEnd, stop, prefix } = config;
  if (day === 4 && minutes >= start) {
    return buildRanksProbePhase(true, `${prefix}-warmup`, RANKS_META_PROBE_FALLBACK_TTL_MS);
  }
  if (day === 5 && minutes < stop) {
    if (minutes < expectedStart) {
      return buildRanksProbePhase(true, `${prefix}-warmup`, RANKS_META_PROBE_FALLBACK_TTL_MS);
    }
    if (minutes < expectedEnd) {
      return buildRanksProbePhase(true, `${prefix}-expected`, RANKS_META_PROBE_EXPECTED_TTL_MS);
    }
    return buildRanksProbePhase(true, `${prefix}-fallback`, RANKS_META_PROBE_FALLBACK_TTL_MS);
  }
  return buildRanksProbePhase(false);
}

export function getRanksMetaProbePlan(now = Date.now()) {
  const { day, minutes } = getFixedUtcMinusFourParts(now);
  return {
    normal: getDailyCrossMidnightProbePhase(minutes, {
      start: 19 * 60 + 6,
      expectedStart: 20 * 60 + 36,
      expectedEnd: 21 * 60 + 36,
      stop: 0,
      prefix: "normal",
    }),
    cv: getWeeklyThursdayCrossMidnightProbePhase(day, minutes, {
      start: 23 * 60 + 6,
      expectedStart: 16,
      expectedEnd: 66,
      stop: 4 * 60,
      prefix: "cv",
    }),
  };
}

export function getRanksMetaProbeCycleIds(now = Date.now()) {
  const parts = getFixedUtcMinusFourParts(now);
  const cvCycleDateId =
    parts.day === 5 && parts.minutes < 4 * 60
      ? getPreviousFixedUtcMinusFourDateId(parts)
      : parts.dateId;
  return {
    normal: `normal:${parts.dateId}`,
    cv: `cv:${cvCycleDateId}`,
  };
}

export function getRanksMetaProbeTtlForState(probePlan, cycleIds = {}, postRefreshBackoff = {}) {
  const activeTtls = ["normal", "cv"]
    .map((source) => {
      const plan = probePlan?.[source];
      if (!plan?.active) {
        return null;
      }
      const cycleId = normalizeTextValue(cycleIds?.[source]);
      const backedOffCycleId = normalizeTextValue(postRefreshBackoff?.[source]?.cycleId);
      if (cycleId && cycleId === backedOffCycleId) {
        return RANKS_META_POST_REFRESH_TTL_MS;
      }
      return Number(plan.ttlMs);
    })
    .filter((ttlMs) => Number.isFinite(ttlMs));
  return activeTtls.length ? Math.min(...activeTtls) : Infinity;
}

function normalizeRanksMetaUpdatedAt(value) {
  return normalizeTextValue(value?.updatedAt ?? value?.updated_at);
}

function normalizeRanksMeta(meta) {
  return {
    normal: {
      updatedAt: normalizeRanksMetaUpdatedAt(meta?.normal),
      publishedAt: normalizeTextValue(meta?.normal?.publishedAt ?? meta?.normal?.published_at),
    },
    cv: {
      updatedAt: normalizeRanksMetaUpdatedAt(meta?.cv),
      publishedAt: normalizeTextValue(meta?.cv?.publishedAt ?? meta?.cv?.published_at),
    },
  };
}

function buildRanksResponseMeta(meta) {
  const normalized = normalizeRanksMeta(meta);
  return {
    normal: { publishedAt: normalized.normal.publishedAt },
    cv: { publishedAt: normalized.cv.publishedAt },
  };
}

export function buildRanksMetaRefreshDecision(currentVersions = {}, meta = {}) {
  const normalizedMeta = normalizeRanksMeta(meta);
  const normalUpdatedAt = normalizedMeta.normal.updatedAt || normalizeTextValue(currentVersions.normalUpdatedAt);
  const cvUpdatedAt = normalizedMeta.cv.updatedAt || normalizeTextValue(currentVersions.cvUpdatedAt);
  return {
    normalUpdatedAt,
    cvUpdatedAt,
    refreshNormal: Boolean(normalizedMeta.normal.updatedAt && normalizedMeta.normal.updatedAt !== normalizeTextValue(currentVersions.normalUpdatedAt)),
    refreshCv: Boolean(normalizedMeta.cv.updatedAt && normalizedMeta.cv.updatedAt !== normalizeTextValue(currentVersions.cvUpdatedAt)),
  };
}

export function getRanksCachePolicyForConfig(now = Date.now(), config = {}) {
  const timeZone = String(config.timeZone ?? "Asia/Shanghai").trim() || "Asia/Shanghai";
  const startHour = Number.isInteger(Number(config.startHour))
    ? Math.min(23, Math.max(0, Number(config.startHour)))
    : 7;
  const endHour = Number.isInteger(Number(config.endHour))
    ? Math.min(24, Math.max(0, Number(config.endHour)))
    : 10;
  const ttlMs = Number.isFinite(Number(config.ttlMs))
    ? Math.max(60 * 1000, Number(config.ttlMs))
    : 10 * 60 * 1000;
  const hour = getHourInRanksCacheTimeZone(now, timeZone);
  if (hour >= startHour && hour < endHour) {
    return { inUpdateWindow: true, ttlMs };
  }
  return { inUpdateWindow: false, ttlMs: Infinity };
}

export function isRanksCacheEntryFreshForConfig(loadedAt, now = Date.now(), config = {}) {
  const normalizedLoadedAt = Number(loadedAt);
  if (!Number.isFinite(normalizedLoadedAt) || normalizedLoadedAt <= 0) {
    return false;
  }
  const cachePolicy = getRanksCachePolicyForConfig(now, config);
  return now - normalizedLoadedAt < cachePolicy.ttlMs;
}

export function getRankDerivedCacheCycleIdForConfig(now = Date.now(), config = {}) {
  const timeZone = String(config.timeZone ?? "Asia/Shanghai").trim() || "Asia/Shanghai";
  const startHour = Number.isInteger(Number(config.startHour))
    ? Math.min(23, Math.max(0, Number(config.startHour)))
    : 7;
  const parts = getDateTimePartsInRanksCacheTimeZone(now, timeZone);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.dayOfMonth));
  if (parts.hour < startHour) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function isRankDerivedCacheEntryFreshForConfig(
  loadedAt,
  now = Date.now(),
  config = {}
) {
  if (!isRanksCacheEntryFreshForConfig(loadedAt, now, config)) {
    return false;
  }

  return getRankDerivedCacheCycleIdForConfig(loadedAt, config) ===
    getRankDerivedCacheCycleIdForConfig(now, config);
}

export function getRanksCachePolicy(now = Date.now()) {
  return getRanksCachePolicyForConfig(now, {
    timeZone: RANKS_CACHE_TIME_ZONE,
    startHour: RANKS_UPDATE_WINDOW_START_HOUR,
    endHour: RANKS_UPDATE_WINDOW_END_HOUR,
    ttlMs: RANKS_UPDATE_WINDOW_TTL_MS,
  });
}

export function isRanksCacheEntryFresh(loadedAt, now = Date.now()) {
  return isRanksCacheEntryFreshForConfig(loadedAt, now, {
    timeZone: RANKS_CACHE_TIME_ZONE,
    startHour: RANKS_UPDATE_WINDOW_START_HOUR,
    endHour: RANKS_UPDATE_WINDOW_END_HOUR,
    ttlMs: RANKS_UPDATE_WINDOW_TTL_MS,
  });
}

function isRankDerivedCacheEntryFresh(loadedAt, now = Date.now()) {
  return isRankDerivedCacheEntryFreshForConfig(loadedAt, now, {
    timeZone: RANKS_CACHE_TIME_ZONE,
    startHour: RANKS_UPDATE_WINDOW_START_HOUR,
    endHour: RANKS_UPDATE_WINDOW_END_HOUR,
    ttlMs: RANKS_UPDATE_WINDOW_TTL_MS,
  });
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

export function normalizeNewDramaIdsForPlatform(platform, ids) {
  if (platform === "manbo") {
    return normalizeStringIds(ids, 200);
  }
  if (platform === "missevan") {
    return normalizeDramaIds(ids).map((id) => String(id));
  }
  return [];
}

export function normalizeMissevanDramaCardItems(input = {}) {
  const normalizedItems = [];
  const seenResolvedItems = new Set();
  const seenInvalidItems = new Set();

  const pushItem = (item) => {
    if (!item || typeof item !== "object") {
      return;
    }
    if (item.type === "invalid") {
      const invalidKey = `invalid:${item.raw}`;
      if (!seenInvalidItems.has(invalidKey)) {
        seenInvalidItems.add(invalidKey);
        normalizedItems.push(item);
      }
      return;
    }

    const resolvedKey = `${item.type}:${item.id}`;
    if (!seenResolvedItems.has(resolvedKey)) {
      seenResolvedItems.add(resolvedKey);
      normalizedItems.push(item);
    }
  };

  normalizeDramaIds(input.dramaIds || []).forEach((id) => {
    pushItem({
      raw: String(id),
      type: "drama",
      id: String(id),
    });
  });

  (Array.isArray(input.items) ? input.items : []).forEach((item) => {
    const raw = typeof item === "string" ? item : item?.raw;
    const normalizedRaw = String(raw ?? "").trim();
    if (!normalizedRaw) {
      return;
    }
    pushItem(
      parseMissevanInputToken(normalizedRaw) || {
        raw: normalizedRaw,
        type: "invalid",
        id: "",
      }
    );
  });

  return normalizedItems.slice(0, 200);
}

export function dedupeMissevanDramaCardResults(cards = []) {
  return Array.from(
    (Array.isArray(cards) ? cards : [])
      .filter(Boolean)
      .reduce((map, card) => {
        const key = String(card?.id ?? "").trim();
        if (key && !map.has(key)) {
          map.set(key, card);
        }
        return map;
      }, new Map())
      .values()
  );
}

export function normalizeMissevanDirectSearchInput(keyword) {
  const raw = String(keyword ?? "").trim();
  if (!/^https?:\/\//i.test(raw)) {
    return null;
  }
  return parseMissevanInputToken(raw);
}

export function shouldUseMissevanApiFallback(value) {
  return String(value ?? "").trim() !== "0";
}

function buildKeywordTooShortSearchResponse(keyword, offset, limit, extraMeta = {}) {
  return {
    success: false,
    results: [],
    message: "关键词太短，请至少输入 2 个汉字，或 3 位字母/数字。",
    meta: {
      ...buildSearchPageMeta(keyword, 0, offset, limit),
      keywordTooShort: true,
      ...extraMeta,
    },
  };
}

export function buildMissevanSearchApiUsageLog(keyword, options = {}) {
  const matchedCount = Math.max(0, Math.floor(Number(options.matchedCount ?? 0) || 0));
  const error = options.error || null;
  const message = error ? String(error?.message || error) : "";
  return {
    platform: "missevan",
    action: "missevan_search_api",
    keyword: normalizeKeyword(keyword),
    success: !error && matchedCount > 0,
    matchedCount,
    cached: false,
    ...(error ? { accessDenied: isMissevanAccessDenied(error), error: message } : {}),
  };
}

export function buildManboSearchApiUsageLog(keyword, options = {}) {
  const matchedCount = Math.max(0, Math.floor(Number(options.matchedCount ?? 0) || 0));
  const error = options.error || null;
  const message = error ? String(error?.message || error) : "";
  return {
    platform: "manbo",
    action: "manbo_search_api",
    keyword: normalizeKeyword(keyword),
    success: !error && matchedCount > 0,
    matchedCount,
    cached: false,
    ...(error ? { error: message } : {}),
  };
}

export function buildCompatibilitySearchUsageLog(platform, keyword) {
  return {
    platform: normalizeTextValue(platform),
    action: "compatibility_search",
    keyword: normalizeKeyword(keyword),
  };
}

export function normalizeStatsTaskSource(value) {
  return normalizeTextValue(value).slice(0, 40);
}

export function buildStatsTaskCompletedUsageLog(snapshot = {}) {
  if (snapshot?.status !== "completed") {
    return null;
  }
  const source = normalizeStatsTaskSource(snapshot.source);
  const failedCount = Math.max(0, Math.floor(Number(snapshot.failedCount ?? 0) || 0));
  const accessDenied = Boolean(snapshot.accessDenied);
  return {
    action: "calculate",
    platform: normalizeTextValue(snapshot.platform),
    taskId: normalizeTextValue(snapshot.taskId),
    taskType: normalizeTextValue(snapshot.taskType),
    status: "completed",
    success: !accessDenied && failedCount === 0,
    ...(source ? { source } : {}),
    totalCount: Math.max(0, Math.floor(Number(snapshot.totalCount ?? 0) || 0)),
    completedCount: Math.max(0, Math.floor(Number(snapshot.completedCount ?? 0) || 0)),
    failedCount,
    accessDenied,
    result: snapshot.result ?? null,
  };
}

export function buildFavoriteUsageLog(payload = {}) {
  const platform = normalizeTextValue(payload.platform);
  const action = normalizeTextValue(payload.action);
  const dramaId = normalizeTextValue(payload.dramaId ?? payload.id).slice(0, 80);
  if (!["missevan", "manbo"].includes(platform) || !["favorite_add", "favorite_remove"].includes(action) || !dramaId) {
    return null;
  }

  const dramaName = normalizeTextValue(payload.dramaName ?? payload.name).slice(0, 200);
  const source = normalizeStatsTaskSource(payload.source);
  return {
    platform,
    action,
    dramaId,
    ...(dramaName ? { dramaName } : {}),
    ...(source ? { source } : {}),
    success: true,
  };
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
  const aliases = normalizeStringArray(record?.aliases, 30);
  const mainCvNicknames = normalizeStringArray(record?.mainCvNicknames, 20);
  const mainCvNames = normalizeStringArray(record?.mainCvNames, 20);
  const mainCvRoleNames = normalizeStringArray(record?.mainCvRoleNames, 20);
  const seriesTitle = normalizeTextValue(record?.seriesTitle);
  const author = normalizeTextValue(record?.author);
  return {
    dramaId,
    name,
    normalizedName: normalizeSearchText(record?.normalizedName || name),
    aliases,
    cover: normalizeTextValue(record?.cover),
    needpay: Boolean(record?.needpay),
    vipFree: Number(record?.vipFree ?? 0) === 1,
    mainCvNicknames,
    mainCvNames,
    catalog: normalizeOptionalFiniteNumber(record?.catalog),
    createTime: normalizeTextValue(record?.createTime),
    catalogName: normalizeTextValue(record?.catalogName),
    type: normalizeOptionalFiniteNumber(record?.type),
    genre: normalizeTextValue(record?.genre),
    mainCvIds: normalizeNumericArray(record?.mainCvIds, 20),
    mainCvRoleNames,
    seriesTitle,
    author,
    searchPinyinTokens: buildCombinedPinyinSearchTokens([
      name,
      aliases,
      mainCvNicknames,
      mainCvNames,
      mainCvRoleNames,
      seriesTitle,
      author,
    ]),
    searchPinyinUnits: buildCombinedPinyinSearchUnits([
      stripSearchSeasonSuffix(name),
      aliases,
      mainCvNicknames,
      mainCvNames,
      mainCvRoleNames,
      stripSearchSeasonSuffix(seriesTitle),
      author,
    ]),
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

function normalizeCvRankWork(work, platform) {
  if (!work || typeof work !== "object") {
    return null;
  }

  const dramaId = normalizeTextValue(work.dramaId ?? work.id);
  const title = normalizeTextValue(work.title ?? work.name);
  if (!isNumericId(dramaId) || !title) {
    return null;
  }

  return {
    platform,
    dramaId,
    title,
    cover: normalizeTextValue(work.cover),
    mainCvs: normalizeStringArray(work.mainCvs ?? work.main_cvs, 20),
    viewCount: normalizeRankNumber(work.viewCount ?? work.view_count) ?? 0,
    isPaid: work.isPaid === true || work.is_paid === true,
  };
}

function getCvTrendRecord(snapshot, cvName) {
  const normalizedCvName = normalizeTextValue(cvName);
  const cvs = snapshot?.cvs && typeof snapshot.cvs === "object" ? snapshot.cvs : {};
  if (!normalizedCvName) {
    return null;
  }
  if (cvs[normalizedCvName] && typeof cvs[normalizedCvName] === "object") {
    return cvs[normalizedCvName];
  }
  return Object.values(cvs).find((record) =>
    normalizeTextValue(record?.cvName ?? record?.name) === normalizedCvName
  ) || null;
}

function buildCvPlaybackDelta({
  item,
  platform,
  scope,
  cvTrendSnapshots,
  currentSnapshotGeneratedAt,
}) {
  const cvName = normalizeTextValue(item?.cvName ?? item?.name);
  const metricKey = scope === "paid" ? "paidViewCount" : "totalViewCount";
  const points = [];

  const trendSnapshot = cvTrendSnapshots?.[platform];
  const trendRecord = getCvTrendRecord(trendSnapshot, cvName);
  const samples = trendRecord?.samples && typeof trendRecord.samples === "object" ? trendRecord.samples : {};
  Object.entries(samples).forEach(([date, sample]) => {
    const normalizedDate = normalizeTextValue(date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
      return;
    }
    const metrics = sample?.metrics && typeof sample.metrics === "object" ? sample.metrics : {};
    const value = normalizeRankNumber(metrics?.[metricKey]);
    if (value == null) {
      return;
    }
    points.push({
      date: normalizedDate,
      generatedAt: normalizeTextValue(sample?.generated_at ?? sample?.generatedAt),
      value,
    });
  });

  const currentValue = normalizeRankNumber(item?.totalViewCount ?? item?.total_view_count);
  const currentGeneratedAt =
    normalizeTextValue(item?.generated_at ?? item?.generatedAt) ||
    normalizeTextValue(currentSnapshotGeneratedAt);
  const currentDate =
    normalizeTextValue(item?.date) ||
    (/^\d{4}-\d{2}-\d{2}/.test(currentGeneratedAt)
      ? currentGeneratedAt.slice(0, 10)
      : "");
  if (currentValue != null && currentDate) {
    const currentPoint = {
      date: currentDate,
      generatedAt: currentGeneratedAt,
      value: currentValue,
    };
    const existingPointIndex = points.findIndex((point) => point.date === currentDate);
    if (existingPointIndex >= 0) {
      points[existingPointIndex] = currentPoint;
    } else {
      points.push(currentPoint);
    }
  }

  const sortedPoints = points
    .filter((point) => point.date && point.value != null)
    .sort((left, right) => left.date.localeCompare(right.date));
  const fromPoint = sortedPoints.at(-2) || null;
  const toPoint = sortedPoints.at(-1) || null;
  const available = Boolean(fromPoint && toPoint && fromPoint !== toPoint);
  return {
    key: "view_count",
    label: scope === "paid" ? "付费播放量" : "总播放量",
    available,
    fromDate: fromPoint?.date || "",
    toDate: toPoint?.date || "",
    fromValue: fromPoint?.value ?? null,
    toValue: toPoint?.value ?? currentValue ?? null,
    delta: available ? toPoint.value - fromPoint.value : null,
  };
}

function normalizeCvRankItem(item, index, platform, options = {}) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const cvName = normalizeTextValue(item.cvName ?? item.name);
  if (!cvName) {
    return null;
  }

  const works = (Array.isArray(item.works) ? item.works : [])
    .map((work) => normalizeCvRankWork(work, platform))
    .filter(Boolean);
  const explicitWorkCount = normalizeRankNumber(item.workCount ?? item.work_count);

  return {
    rank: normalizeRankNumber(item.rank) ?? index + 1,
    cvName,
    avatar: normalizeTextValue(item.avatar),
    totalViewCount: normalizeRankNumber(item.totalViewCount ?? item.total_view_count) ?? 0,
    workCount: explicitWorkCount ?? works.length,
    topWorks: works.slice(0, 3),
    works,
    trendKind: "cv",
    trendScope: options.scope === "paid" ? "paid" : "total",
    playbackDelta: buildCvPlaybackDelta({
      item,
      platform,
      scope: options.scope === "paid" ? "paid" : "total",
      cvTrendSnapshots: options.cvTrendSnapshots,
      currentSnapshotGeneratedAt: options.currentSnapshotGeneratedAt,
    }),
  };
}

function buildNormalizedCvRank(cvSnapshot, platform, options = {}) {
  const scope = options.scope === "paid" ? "paid" : "total";
  const sourceKey = scope === "paid" ? "paidRankings" : "rankings";
  const fetchedAt = normalizeTextValue(cvSnapshot?.generated_at ?? cvSnapshot?.generatedAt);
  const rankings = Array.isArray(cvSnapshot?.[sourceKey]?.[platform])
    ? cvSnapshot[sourceKey][platform]
    : [];
  const items = rankings
    .map((item, index) =>
      normalizeCvRankItem(item, index, platform, {
        ...options,
        currentSnapshotGeneratedAt: fetchedAt,
      })
    )
    .filter(Boolean);

  if (!items.length) {
    return null;
  }

  return {
    key: scope === "paid" ? "cv-paid" : "cv",
    label: scope === "paid" ? "付费榜" : "总榜",
    name: scope === "paid" ? "CV付费榜" : "CV总榜",
    fetchedAt,
    unitName: scope === "paid" ? "付费剧播放量" : "总播放量",
    items,
  };
}

function buildNormalizedCvRankCategory(cvSnapshot, platform, cvTrendOptions = {}) {
  const ranks = [
    buildNormalizedCvRank(cvSnapshot, platform, {
      ...cvTrendOptions,
      scope: "total",
    }),
    buildNormalizedCvRank(cvSnapshot, platform, {
      ...cvTrendOptions,
      scope: "paid",
    }),
  ].filter(Boolean);

  if (!ranks.length) {
    return null;
  }

  return {
    key: "cv",
    label: "CV榜",
    ranks,
  };
}

function buildCvRanksSummary(cvSnapshot) {
  return {
    updatedAt: normalizeTextValue(cvSnapshot?.generated_at ?? cvSnapshot?.generatedAt),
    missevanDramaCount: normalizeRankNumber(cvSnapshot?.missevanDramaCount) ?? 0,
    manboDramaCount: normalizeRankNumber(cvSnapshot?.manboDramaCount) ?? 0,
  };
}

function buildNormalizedRankPlatform(snapshot, platform, peakTrendSnapshot = null, cvSnapshot = null, cvTrendOptions = {}) {
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
  const cvCategory = buildNormalizedCvRankCategory(cvSnapshot, platform, cvTrendOptions);
  if (cvCategory) {
    categories.push(cvCategory);
  }

  return {
    key: platform,
    label: platform === "missevan" ? "猫耳" : "漫播",
    categories,
  };
}

export function buildNormalizedRanksResponse(snapshot, peakTrendSnapshot = null, cvSnapshot = null, cvTrendOptions = {}) {
  const safeSnapshot =
    snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
      ? snapshot
      : {};
  const cvSummary = buildCvRanksSummary(cvSnapshot);
  const meta = buildRanksResponseMeta(cvTrendOptions.meta);

  return {
    success: true,
    schemaVersion: RANKS_RESPONSE_SCHEMA_VERSION,
    updatedAt: normalizeTextValue(safeSnapshot?._meta?.updated_at),
    cvSummary,
    meta,
    platforms: {
      missevan: buildNormalizedRankPlatform(safeSnapshot, "missevan", peakTrendSnapshot, cvSnapshot, cvTrendOptions),
      manbo: buildNormalizedRankPlatform(safeSnapshot, "manbo", null, cvSnapshot, cvTrendOptions),
    },
  };
}

export function getRanksResponseCacheValidator(response = {}) {
  return [
    response?.schemaVersion || RANKS_RESPONSE_SCHEMA_VERSION,
    normalizeTextValue(response?.updatedAt),
    normalizeTextValue(response?.cvSummary?.updatedAt),
    normalizeTextValue(response?.meta?.normal?.publishedAt),
    normalizeTextValue(response?.meta?.cv?.publishedAt),
  ].join(":");
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

function getRanksSnapshotUpdatedAt(snapshot) {
  return normalizeTextValue(snapshot?._meta?.updated_at ?? snapshot?._meta?.updatedAt);
}

function getCvSnapshotUpdatedAt(snapshot) {
  return normalizeTextValue(snapshot?.generated_at ?? snapshot?.generatedAt);
}

async function readNormalRanksBundle() {
  const [snapshot, peakTrendSnapshot] = await Promise.all([
    readRanksSnapshot(),
    readRanksJsonKey(MISSEVAN_PEAK_SERIES_TREND_KEY).catch(() => null),
  ]);
  return {
    snapshot,
    peakTrendSnapshot,
    updatedAt: getRanksSnapshotUpdatedAt(snapshot),
  };
}

async function readCvRanksBundle(options = {}) {
  const tolerateError = options?.tolerateError === true;
  let cvSnapshot = null;
  let cvTrendSnapshots = null;
  try {
    const [latestSnapshot, missevanTrendSnapshot, manboTrendSnapshot] = await Promise.all([
      readRanksJsonKey(CV_RANKS_KEY),
      readRanksJsonKey(CV_RANK_TREND_AGGREGATE_KEYS.missevan).catch(() => null),
      readRanksJsonKey(CV_RANK_TREND_AGGREGATE_KEYS.manbo).catch(() => null),
    ]);
    cvSnapshot = latestSnapshot;
    cvTrendSnapshots = {
      missevan: isCvRankTrendAggregateSnapshot(missevanTrendSnapshot, "missevan")
        ? missevanTrendSnapshot
        : null,
      manbo: isCvRankTrendAggregateSnapshot(manboTrendSnapshot, "manbo")
        ? manboTrendSnapshot
        : null,
    };
  } catch (error) {
    if (!tolerateError) {
      throw error;
    }
    console.warn("Failed to read CV ranks snapshot", error);
  }
  return {
    cvSnapshot,
    cvTrendSnapshots,
    updatedAt: getCvSnapshotUpdatedAt(cvSnapshot),
  };
}

function updateCombinedRanksResponseCache() {
  const response = buildNormalizedRanksResponse(
    ranksCache.normalSnapshot,
    ranksCache.peakTrendSnapshot,
    ranksCache.cvSnapshot,
    {
      cvTrendSnapshots: ranksCache.cvTrendSnapshots,
      meta: ranksCache.meta,
    }
  );
  ranksCache.response = response;
  ranksCache.loadedAt = Date.now();
  ranksCache.normalUpdatedAt = response.updatedAt || ranksCache.normalUpdatedAt;
  ranksCache.cvUpdatedAt = response.cvSummary?.updatedAt || ranksCache.cvUpdatedAt;
  return response;
}

function updateRanksResponseMetaCache(meta = ranksCache.meta) {
  if (!ranksCache.response) {
    return null;
  }
  ranksCache.response = {
    ...ranksCache.response,
    meta: buildRanksResponseMeta(meta),
  };
  return ranksCache.response;
}

async function readInitialRanksMeta(readMeta, now) {
  try {
    const meta = normalizeRanksMeta(await readMeta());
    ranksCache.meta = meta;
    ranksCache.metaLoadedAt = now;
    ranksCache.metaLoadFailedAt = 0;
    return meta;
  } catch (error) {
    console.warn("Failed to read ranks meta during cold refresh", error);
    ranksCache.metaLoadFailedAt = now;
    return normalizeRanksMeta(ranksCache.meta);
  }
}

function hasNormalRanksSnapshot(snapshot) {
  return Boolean(snapshot && typeof snapshot === "object" && !Array.isArray(snapshot));
}

function getActiveRanksMetaProbeTtl(
  probePlan,
  cycleIds = getRanksMetaProbeCycleIds(),
  postRefreshBackoff = ranksCache.metaPostRefreshBackoff
) {
  return getRanksMetaProbeTtlForState(probePlan, cycleIds, postRefreshBackoff);
}

async function readCachedRanksMeta(
  probePlan,
  now = Date.now(),
  cycleIds = getRanksMetaProbeCycleIds(now),
  options = {}
) {
  const readMeta = typeof options?.readRanksMeta === "function"
    ? options.readRanksMeta
    : () => readRanksJsonKey(RANKS_META_KEY);
  const ttlOverrideMs = Number(options?.ttlMsOverride);
  const ttlMs = Number.isFinite(ttlOverrideMs)
    ? Math.max(60 * 1000, ttlOverrideMs)
    : getActiveRanksMetaProbeTtl(probePlan, cycleIds);
  if (!Number.isFinite(ttlMs)) {
    return { meta: ranksCache.meta, status: "hit" };
  }
  if (ranksCache.meta && now - ranksCache.metaLoadedAt < ttlMs) {
    return { meta: ranksCache.meta, status: "meta-hit" };
  }
  if (ranksCache.metaLoadFailedAt > 0 && now - ranksCache.metaLoadFailedAt < ttlMs) {
    throw new Error("Ranks meta probe is in failure backoff");
  }
  if (ranksCache.metaLoadPromise) {
    return ranksCache.metaLoadPromise;
  }

  ranksCache.metaLoadPromise = (async () => {
    try {
      const meta = normalizeRanksMeta(await readMeta());
      ranksCache.meta = meta;
      ranksCache.metaLoadedAt = now;
      ranksCache.metaLoadFailedAt = 0;
      return { meta, status: "meta-refresh" };
    } catch (error) {
      ranksCache.metaLoadFailedAt = now;
      throw error;
    } finally {
      ranksCache.metaLoadPromise = null;
    }
  })();
  return ranksCache.metaLoadPromise;
}

function recordRanksMetaPostRefreshBackoff(source, cycleIds, now = Date.now()) {
  const normalizedSource = source === "cv" ? "cv" : source === "normal" ? "normal" : "";
  const cycleId = normalizeTextValue(cycleIds?.[normalizedSource]);
  if (!normalizedSource || !cycleId) {
    return;
  }
  ranksCache.metaPostRefreshBackoff[normalizedSource] = {
    cycleId,
    recordedAt: now,
  };
}

async function loadInitialRanksResponse() {
  const [normalBundle, cvBundle] = await Promise.all([
    readNormalRanksBundle(),
    readCvRanksBundle({ tolerateError: true }),
  ]);
  ranksCache.normalSnapshot = normalBundle.snapshot;
  ranksCache.peakTrendSnapshot = normalBundle.peakTrendSnapshot;
  ranksCache.normalUpdatedAt = normalBundle.updatedAt;
  ranksCache.cvSnapshot = cvBundle.cvSnapshot;
  ranksCache.cvTrendSnapshots = cvBundle.cvTrendSnapshots;
  ranksCache.cvUpdatedAt = cvBundle.updatedAt;
  return updateCombinedRanksResponseCache();
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

function isRanksResponseVersionTooOld(response, now = Date.now()) {
  const updatedAtMs = Date.parse(response?.updatedAt || "");
  return Number.isFinite(updatedAtMs) && now >= updatedAtMs + RANKS_EXPECTED_REFRESH_INTERVAL_MS;
}

function getRanksProbePhaseHeaderValue(probePlan = {}) {
  return ["normal", "cv"]
    .map((source) => normalizeTextValue(probePlan?.[source]?.phase))
    .filter(Boolean)
    .join(",");
}

export async function getCachedRanksResponse(options = {}) {
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const readNormalBundle = options.readNormalRanksBundle || readNormalRanksBundle;
  const readCvBundle = options.readCvRanksBundle || readCvRanksBundle;
  const readMeta = options.readRanksMeta || (() => readRanksJsonKey(RANKS_META_KEY));
  if (ranksCache.loadPromise) {
    return ranksCache.loadPromise;
  }

  ranksCache.loadPromise = (async () => {
    try {
      if (!ranksCache.response || ranksCache.response.schemaVersion !== RANKS_RESPONSE_SCHEMA_VERSION) {
        const [normalBundle, cvBundle] = await Promise.all([
          readNormalBundle(),
          readCvBundle({ tolerateError: true }),
          readInitialRanksMeta(readMeta, now),
        ]);
        ranksCache.normalSnapshot = normalBundle.snapshot;
        ranksCache.peakTrendSnapshot = normalBundle.peakTrendSnapshot;
        ranksCache.normalUpdatedAt = normalBundle.updatedAt;
        ranksCache.cvSnapshot = cvBundle.cvSnapshot;
        ranksCache.cvTrendSnapshots = cvBundle.cvTrendSnapshots;
        ranksCache.cvUpdatedAt = cvBundle.updatedAt;
        const response = updateCombinedRanksResponseCache();
        return { response, cacheStatus: "cold-refresh", probePhase: "" };
      }

      const probePlan = getRanksMetaProbePlan(now);
      const probeCycleIds = getRanksMetaProbeCycleIds(now);
      const activeMetaProbeTtlMs = getActiveRanksMetaProbeTtl(probePlan, probeCycleIds);
      const responseVersionTooOld = isRanksResponseVersionTooOld(ranksCache.response, now);
      const shouldUseFallbackMetaProbe = responseVersionTooOld || !Number.isFinite(activeMetaProbeTtlMs);
      const probePhase = getRanksProbePhaseHeaderValue(probePlan);

      let metaResult;
      try {
        metaResult = await readCachedRanksMeta(probePlan, now, probeCycleIds, {
          ttlMsOverride: shouldUseFallbackMetaProbe ? RANKS_META_PROBE_FALLBACK_TTL_MS : undefined,
          readRanksMeta: readMeta,
        });
      } catch (error) {
        console.warn("Failed to read ranks meta", error);
        return { response: ranksCache.response, cacheStatus: "stale", probePhase };
      }

      const decision = buildRanksMetaRefreshDecision(
        {
          normalUpdatedAt: ranksCache.normalUpdatedAt,
          cvUpdatedAt: ranksCache.cvUpdatedAt,
        },
        metaResult.meta
      );
      if (!decision.refreshNormal && !decision.refreshCv) {
        return {
          response: updateRanksResponseMetaCache(metaResult.meta),
          cacheStatus: metaResult.status || "meta-hit",
          probePhase,
        };
      }

      const refreshStatuses = [];
      if (decision.refreshNormal) {
        try {
          const normalBundle = await readNormalBundle();
          ranksCache.normalSnapshot = normalBundle.snapshot;
          ranksCache.peakTrendSnapshot = normalBundle.peakTrendSnapshot;
          ranksCache.normalUpdatedAt = normalBundle.updatedAt || decision.normalUpdatedAt;
          recordRanksMetaPostRefreshBackoff("normal", probeCycleIds, now);
          refreshStatuses.push("normal-refresh");
        } catch (error) {
          console.warn("Failed to refresh normal ranks snapshot", error);
          refreshStatuses.push("stale");
        }
      }

      if (decision.refreshCv) {
        try {
          const cvBundle = await readCvBundle();
          ranksCache.cvSnapshot = cvBundle.cvSnapshot;
          ranksCache.cvTrendSnapshots = cvBundle.cvTrendSnapshots;
          ranksCache.cvUpdatedAt = cvBundle.updatedAt || decision.cvUpdatedAt;
          recordRanksMetaPostRefreshBackoff("cv", probeCycleIds, now);
          refreshStatuses.push("cv-refresh");
        } catch (error) {
          console.warn("Failed to refresh CV ranks snapshot", error);
          refreshStatuses.push("stale");
        }
      }

      const response = updateCombinedRanksResponseCache();
      if (refreshStatuses.includes("normal-refresh")) {
        ranksCache.normalUpdatedAt = decision.normalUpdatedAt || ranksCache.normalUpdatedAt;
      }
      if (refreshStatuses.includes("cv-refresh")) {
        ranksCache.cvUpdatedAt = decision.cvUpdatedAt || ranksCache.cvUpdatedAt;
      }
      return {
        response,
        cacheStatus: refreshStatuses.includes("stale") ? "stale" : refreshStatuses.join("+"),
        probePhase,
      };
    } finally {
      ranksCache.loadPromise = null;
    }
  })();

  return ranksCache.loadPromise;
}

function normalizeAdminCacheRefreshTarget(value) {
  const target = normalizeTextValue(value).toLowerCase();
  return [
    "ranks:normal",
    "ranks:cv",
    "ranks",
    "ongoing:missevan",
    "ongoing:manbo",
    "ongoing",
    "all",
  ].includes(target)
    ? target
    : "";
}

function getAdminRefreshErrorMessage(error) {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}

function getAuthorizationValue(request = {}) {
  const headers = request.headers && typeof request.headers === "object" ? request.headers : {};
  return String(
    request.authorization ??
      headers.authorization ??
      headers.Authorization ??
      ""
  ).trim();
}

function getAdminCacheRefreshReason(value) {
  return normalizeTextValue(value).slice(0, 200);
}

export async function refreshAdminRanksCacheTarget(options = {}) {
  const target = normalizeAdminCacheRefreshTarget(options.target || "ranks");
  const force = options.force === true;
  const readNormalBundle = options.readNormalRanksBundle || readNormalRanksBundle;
  const readCvBundle = options.readCvRanksBundle || readCvRanksBundle;
  const readMeta = options.readRanksMeta || (() => readRanksJsonKey(RANKS_META_KEY));
  const refreshNormal = target === "ranks" || target === "ranks:normal";
  const refreshCv = target === "ranks" || target === "ranks:cv";
  const statuses = [];
  let nextNormalSnapshot = ranksCache.normalSnapshot;
  let nextPeakTrendSnapshot = ranksCache.peakTrendSnapshot;
  let nextCvSnapshot = ranksCache.cvSnapshot;
  let nextCvTrendSnapshots = ranksCache.cvTrendSnapshots;
  let nextNormalUpdatedAt = ranksCache.normalUpdatedAt;
  let nextCvUpdatedAt = ranksCache.cvUpdatedAt;
  const cacheIsCold =
    !ranksCache.response ||
    ranksCache.response.schemaVersion !== RANKS_RESPONSE_SCHEMA_VERSION;

  if (cacheIsCold) {
    statuses.push("cold-refresh");
  }

  if (force) {
    if (refreshNormal) {
      const normalBundle = await readNormalBundle();
      nextNormalSnapshot = normalBundle.snapshot;
      nextPeakTrendSnapshot = normalBundle.peakTrendSnapshot;
      nextNormalUpdatedAt = normalBundle.updatedAt || nextNormalUpdatedAt;
      statuses.push("normal-refresh");
    }
    if (refreshCv) {
      const cvBundle = await readCvBundle();
      nextCvSnapshot = cvBundle.cvSnapshot;
      nextCvTrendSnapshots = cvBundle.cvTrendSnapshots;
      nextCvUpdatedAt = cvBundle.updatedAt || nextCvUpdatedAt;
      statuses.push("cv-refresh");
    }
  } else {
    const meta = normalizeRanksMeta(await readMeta());
    const decision = buildRanksMetaRefreshDecision(
      {
        normalUpdatedAt: ranksCache.normalUpdatedAt,
        cvUpdatedAt: ranksCache.cvUpdatedAt,
      },
      meta
    );
    if (refreshNormal && decision.refreshNormal) {
      const normalBundle = await readNormalBundle();
      nextNormalSnapshot = normalBundle.snapshot;
      nextPeakTrendSnapshot = normalBundle.peakTrendSnapshot;
      nextNormalUpdatedAt = normalBundle.updatedAt || decision.normalUpdatedAt;
      statuses.push("normal-refresh");
    }
    if (refreshCv && decision.refreshCv) {
      const cvBundle = await readCvBundle();
      nextCvSnapshot = cvBundle.cvSnapshot;
      nextCvTrendSnapshots = cvBundle.cvTrendSnapshots;
      nextCvUpdatedAt = cvBundle.updatedAt || decision.cvUpdatedAt;
      statuses.push("cv-refresh");
    }
    if (!statuses.length) {
      statuses.push("meta-hit");
    }
  }

  ranksCache.normalSnapshot = nextNormalSnapshot;
  ranksCache.peakTrendSnapshot = nextPeakTrendSnapshot;
  ranksCache.cvSnapshot = nextCvSnapshot;
  ranksCache.cvTrendSnapshots = nextCvTrendSnapshots;
  ranksCache.normalUpdatedAt = nextNormalUpdatedAt;
  ranksCache.cvUpdatedAt = nextCvUpdatedAt;

  const response = hasNormalRanksSnapshot(nextNormalSnapshot)
    ? updateCombinedRanksResponseCache()
    : ranksCache.response;
  return {
    target,
    success: true,
    cacheStatus: statuses.join("+"),
    normalUpdatedAt: response?.updatedAt || ranksCache.normalUpdatedAt || "",
    cvUpdatedAt: response?.cvSummary?.updatedAt || ranksCache.cvUpdatedAt || "",
  };
}

export function __getRanksCacheForTest() {
  return {
    normalSnapshot: ranksCache.normalSnapshot,
    peakTrendSnapshot: ranksCache.peakTrendSnapshot,
    cvSnapshot: ranksCache.cvSnapshot,
    normalUpdatedAt: ranksCache.normalUpdatedAt,
    cvUpdatedAt: ranksCache.cvUpdatedAt,
    meta: ranksCache.meta,
    response: ranksCache.response,
    loadedAt: ranksCache.loadedAt,
  };
}

export function __setRanksCacheForTest(patch = {}) {
  Object.assign(ranksCache, { metaLoadFailedAt: 0 }, patch);
}

async function refreshAdminOngoingCachePlatform(platform) {
  const normalizedPlatform = platform === "manbo" ? "manbo" : platform === "missevan" ? "missevan" : "";
  if (!normalizedPlatform) {
    throw new Error("Invalid ongoing platform");
  }
  const response = await getCachedOngoingResponse(normalizedPlatform, { force: true });
  return {
    target: `ongoing:${normalizedPlatform}`,
    success: true,
    updatedAt: normalizeTextValue(response?.updatedAt ?? response?.latestUpdatedAt),
  };
}

function getAdminCacheRefreshTasks(target) {
  if (target === "all") {
    return [
      { kind: "ranks", target: "ranks" },
      { kind: "ongoing", platform: "missevan" },
      { kind: "ongoing", platform: "manbo" },
    ];
  }
  if (target === "ranks" || target === "ranks:normal" || target === "ranks:cv") {
    return [{ kind: "ranks", target }];
  }
  if (target === "ongoing") {
    return [
      { kind: "ongoing", platform: "missevan" },
      { kind: "ongoing", platform: "manbo" },
    ];
  }
  if (target === "ongoing:missevan") {
    return [{ kind: "ongoing", platform: "missevan" }];
  }
  if (target === "ongoing:manbo") {
    return [{ kind: "ongoing", platform: "manbo" }];
  }
  return [];
}

function summarizeAdminCacheRefreshResults(results = []) {
  const errors = results
    .filter((result) => !result.success)
    .map((result) => `${result.target}: ${result.error}`);
  const ranksResult = [...results].reverse().find((result) => result.success && result.kind === "ranks");
  return {
    success: errors.length === 0,
    cacheStatus: ranksResult?.cacheStatus || "",
    normalUpdatedAt: ranksResult?.normalUpdatedAt || ranksCache.normalUpdatedAt || "",
    cvUpdatedAt: ranksResult?.cvUpdatedAt || ranksCache.cvUpdatedAt || "",
    errors,
  };
}

export async function executeAdminCacheRefresh(request = {}, dependencies = {}) {
  const adminToken =
    typeof dependencies.adminToken === "string"
      ? dependencies.adminToken.trim()
      : ADMIN_CACHE_REFRESH_TOKEN;
  if (!adminToken) {
    return {
      status: 404,
      payload: { success: false, message: "Admin cache refresh is unavailable" },
    };
  }

  const expectedAuthorization =
    typeof dependencies.adminToken === "string"
      ? `Bearer ${adminToken}`
      : `Bearer ${ADMIN_CACHE_REFRESH_TOKEN}`;
  if (getAuthorizationValue(request) !== expectedAuthorization) {
    return {
      status: 403,
      payload: { success: false, message: "Forbidden admin cache refresh request" },
    };
  }

  const body = request.body && typeof request.body === "object" ? request.body : {};
  const target = normalizeAdminCacheRefreshTarget(body.target || "ranks");
  if (!target) {
    return {
      status: 400,
      payload: { success: false, message: "Invalid cache refresh target" },
    };
  }

  const force = body.force === true;
  const reason = getAdminCacheRefreshReason(body.reason);
  const refreshRanks = dependencies.refreshRanks || refreshAdminRanksCacheTarget;
  const refreshOngoing = dependencies.refreshOngoing || refreshAdminOngoingCachePlatform;
  const results = [];

  for (const task of getAdminCacheRefreshTasks(target)) {
    try {
      if (task.kind === "ranks") {
        const result = await refreshRanks({ target: task.target, force });
        results.push({ kind: "ranks", target: task.target, ...result, success: true });
      } else {
        const result = await refreshOngoing(task.platform);
        results.push({ kind: "ongoing", target: `ongoing:${task.platform}`, ...result, success: true });
      }
    } catch (error) {
      results.push({
        kind: task.kind,
        target: task.kind === "ranks" ? task.target : `ongoing:${task.platform}`,
        success: false,
        error: getAdminRefreshErrorMessage(error),
      });
    }
  }

  const summary = summarizeAdminCacheRefreshResults(results);
  const logEntry = {
    action: "cache_refresh",
    target,
    force,
    ...(reason ? { reason } : {}),
    success: summary.success,
    ...(summary.cacheStatus ? { cacheStatus: summary.cacheStatus } : {}),
    normalUpdatedAt: summary.normalUpdatedAt,
    cvUpdatedAt: summary.cvUpdatedAt,
    errors: summary.errors,
  };
  if (dependencies.writeLog) {
    await dependencies.writeLog(logEntry);
  } else {
    await writeUsageLog(logEntry);
  }

  return {
    status: summary.success ? 200 : 207,
    payload: {
      success: summary.success,
      target,
      force,
      ...(reason ? { reason } : {}),
      results,
      ...summary,
    },
  };
}

function getRankTrendCacheKey(platform, dramaId, latestIndexDate = "", sourceVersion = "") {
  return `${RANK_TRENDS_RESPONSE_SCHEMA_VERSION}:${platform}:${dramaId}:${latestIndexDate}:${sourceVersion}`;
}

function pruneRankTrendCacheEntries(platform, dramaId, activeCacheKey) {
  const cacheKeyPrefix = `${RANK_TRENDS_RESPONSE_SCHEMA_VERSION}:${platform}:${dramaId}:`;
  for (const cacheKey of rankTrendsCache.keys()) {
    if (cacheKey !== activeCacheKey && cacheKey.startsWith(cacheKeyPrefix)) {
      rankTrendsCache.delete(cacheKey);
    }
  }
}

function getRankTrendAggregateCacheKey(platform) {
  return `${RANK_TRENDS_RESPONSE_SCHEMA_VERSION}:${platform}`;
}

function getRankTrendAggregateUpstashKey(platform) {
  return RANK_TREND_AGGREGATE_KEYS[String(platform ?? "").trim()] || "";
}

async function readRankTrendAggregateSnapshot(platform) {
  const key = getRankTrendAggregateUpstashKey(platform);
  if (!key) {
    return null;
  }
  return readRanksJsonKey(key);
}

async function getCachedRankTrendAggregateSnapshot(platform, options = {}) {
  const normalizedPlatform = String(platform ?? "").trim();
  const forceRefresh = options?.force === true;
  const cacheKey = getRankTrendAggregateCacheKey(normalizedPlatform);
  const now = Date.now();
  const cached = rankTrendAggregateCache.get(cacheKey);
  if (
    !forceRefresh &&
    cached &&
    "snapshot" in cached &&
    isRankDerivedCacheEntryFresh(cached.loadedAt, now)
  ) {
    return cached.snapshot;
  }
  if (!forceRefresh && cached?.loadPromise) {
    return cached.loadPromise;
  }

  const loadPromise = (async () => {
    const snapshot = await readRankTrendAggregateSnapshot(normalizedPlatform);
    if (!isRankTrendAggregateSnapshot(snapshot, normalizedPlatform)) {
      const error = new Error("Rank trend aggregate is unavailable");
      error.status = 503;
      throw error;
    }
    rankTrendAggregateCache.set(cacheKey, {
      snapshot,
      loadedAt: Date.now(),
      loadPromise: null,
    });
    return snapshot;
  })();

  rankTrendAggregateCache.set(cacheKey, {
    snapshot: cached?.snapshot || null,
    loadedAt: cached?.loadedAt || 0,
    loadPromise,
  });

  try {
    return await loadPromise;
  } catch (error) {
    rankTrendAggregateCache.delete(cacheKey);
    throw error;
  }
}

function getOngoingCacheKey(platform) {
  return `${ONGOING_RESPONSE_SCHEMA_VERSION}:${platform}`;
}

async function getCachedOngoingResponse(platform, options = {}) {
  const normalizedPlatform = String(platform ?? "").trim();
  const forceRefresh = options?.force === true;
  const cacheKey = getOngoingCacheKey(normalizedPlatform);
  const now = Date.now();
  const cached = ongoingCache.get(cacheKey);
  if (
    !forceRefresh &&
    cached?.response &&
    isRankDerivedCacheEntryFresh(cached.loadedAt, now)
  ) {
    return cached.response;
  }
  if (!forceRefresh && cached?.loadPromise) {
    return cached.loadPromise;
  }

  const loadPromise = (async () => {
    const [ongoingIds, aggregateSnapshot] = await Promise.all([
      readOngoingIds(normalizedPlatform),
      getCachedRankTrendAggregateSnapshot(normalizedPlatform, { force: forceRefresh }),
    ]);
    if (!isRankTrendAggregateSnapshot(aggregateSnapshot, normalizedPlatform)) {
      const error = new Error("Ongoing rank trend aggregate is unavailable");
      error.status = 503;
      throw error;
    }
    const { indexSnapshot, metricSnapshotsByDate } =
      buildMetricSnapshotsFromRankTrendAggregate(aggregateSnapshot, normalizedPlatform);
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
    if (cached?.response) {
      ongoingCache.set(cacheKey, {
        response: cached.response,
        loadedAt: cached.loadedAt,
        loadPromise: null,
      });
    } else {
      ongoingCache.delete(cacheKey);
    }
    throw error;
  }
}

async function getCachedCvRankTrendResponse(cvName) {
  const normalizedCvName = normalizeTextValue(cvName);
  const cacheKey = getRankTrendCacheKey("cv", normalizedCvName, "", CV_RANK_TREND_AGGREGATE_KEYS.missevan);
  const now = Date.now();
  const cached = rankTrendsCache.get(cacheKey);
  if (cached?.response && isRankDerivedCacheEntryFresh(cached.loadedAt, now)) {
    return cached.response;
  }
  if (cached?.loadPromise) {
    return cached.loadPromise;
  }

  const loadPromise = (async () => {
    const [missevanTrendSnapshot, manboTrendSnapshot] = await Promise.all([
      readRanksJsonKey(CV_RANK_TREND_AGGREGATE_KEYS.missevan).catch(() => null),
      readRanksJsonKey(CV_RANK_TREND_AGGREGATE_KEYS.manbo).catch(() => null),
    ]);
    const response = buildCvTrendResponse({
      id: normalizedCvName,
      trendSnapshots: {
        missevan: missevanTrendSnapshot,
        manbo: manboTrendSnapshot,
      },
    });
    if (response && typeof response === "object") {
      response.schemaVersion = RANK_TRENDS_RESPONSE_SCHEMA_VERSION;
    }
    if (rankTrendsCache.get(cacheKey)?.loadPromise === loadPromise) {
      if (response.status === 503) {
        rankTrendsCache.delete(cacheKey);
      } else {
        rankTrendsCache.set(cacheKey, {
          response,
          loadedAt: Date.now(),
          loadPromise: null,
        });
      }
    }
    return response;
  })();

  pruneRankTrendCacheEntries("cv", normalizedCvName, cacheKey);
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

async function getCachedRankTrendResponse(platform, dramaId) {
  const normalizedPlatform = String(platform ?? "").trim();
  const normalizedDramaId = String(dramaId ?? "").trim();

  if (normalizedPlatform === "missevan" && !isNumericId(normalizedDramaId)) {
    const cacheKey = getRankTrendCacheKey(
      normalizedPlatform,
      normalizedDramaId,
      "",
      MISSEVAN_PEAK_SERIES_TREND_KEY
    );
    const now = Date.now();
    const cached = rankTrendsCache.get(cacheKey);
    if (cached?.response && isRankDerivedCacheEntryFresh(cached.loadedAt, now)) {
      return cached.response;
    }
    if (cached?.loadPromise) {
      return cached.loadPromise;
    }

    const loadPromise = (async () => {
      const peakSnapshot = await readRanksJsonKey(MISSEVAN_PEAK_SERIES_TREND_KEY);
      const response = buildPeakSeriesTrendResponse({
        id: normalizedDramaId,
        peakSnapshot,
      });
      if (response && typeof response === "object") {
        response.schemaVersion = RANK_TRENDS_RESPONSE_SCHEMA_VERSION;
      }
      if (rankTrendsCache.get(cacheKey)?.loadPromise === loadPromise) {
        rankTrendsCache.set(cacheKey, {
          response,
          loadedAt: Date.now(),
          loadPromise: null,
        });
      }
      return response;
    })();

    pruneRankTrendCacheEntries(normalizedPlatform, normalizedDramaId, cacheKey);
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

  const aggregateSnapshot = await getCachedRankTrendAggregateSnapshot(normalizedPlatform);

  const hasUsableAggregate = isRankTrendAggregateSnapshot(aggregateSnapshot, normalizedPlatform);
  const aggregateDates = hasUsableAggregate ? normalizeRankTrendDates(aggregateSnapshot) : [];
  const latestIndexDate = aggregateDates.at(-1) || "";
  const aggregateSourceVersion = hasUsableAggregate
    ? String(aggregateSnapshot?.updated_at ?? aggregateSnapshot?.updatedAt ?? "").trim()
    : "unavailable";
  const cacheKey = getRankTrendCacheKey(
    normalizedPlatform,
    normalizedDramaId,
    latestIndexDate,
    aggregateSourceVersion
  );
  const now = Date.now();
  const cached = rankTrendsCache.get(cacheKey);
  if (cached?.response && isRankDerivedCacheEntryFresh(cached.loadedAt, now)) {
    return cached.response;
  }
  if (cached?.loadPromise) {
    return cached.loadPromise;
  }

  const loadPromise = (async () => {
    const response = buildAggregatedRankTrendResponse({
      platform: normalizedPlatform,
      id: normalizedDramaId,
      aggregateSnapshot,
    });
    if (response && typeof response === "object") {
      response.schemaVersion = RANK_TRENDS_RESPONSE_SCHEMA_VERSION;
    }
    await Promise.resolve();
    if (rankTrendsCache.get(cacheKey)?.loadPromise === loadPromise) {
      rankTrendsCache.set(cacheKey, {
        response,
        loadedAt: Date.now(),
        loadPromise: null,
      });
    }
    return response;
  })();

  pruneRankTrendCacheEntries(normalizedPlatform, normalizedDramaId, cacheKey);
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
  const cvroles = normalizeStringMap(node?.cvroles);
  const cvnames = normalizeStringMap(node?.cvnames);
  const author = normalizeTextValue(node?.author);
  return {
    title,
    dramaId,
    soundIds: normalizeStringIdArray(node?.soundIds, 500),
    maincvs: normalizeNumericArray(node?.maincvs, 20),
    type: normalizeOptionalFiniteNumber(node?.type),
    cvroles,
    cvnames,
    catalog: normalizeOptionalFiniteNumber(node?.catalog),
    createTime: normalizeTextValue(node?.createTime),
    author,
    seriesTitle,
    needpay: Boolean(node?.needpay),
    is_member: Boolean(node?.is_member),
    cover: normalizeTextValue(node?.cover),
    seasonKey: normalizeTextValue(seasonKey),
    searchPinyinTokens: buildCombinedPinyinSearchTokens([
      title,
      seriesTitle,
      Object.values(cvnames),
      Object.values(cvroles),
      author,
    ]),
    searchPinyinUnits: buildCombinedPinyinSearchUnits([
      stripSearchSeasonSuffix(title),
      stripSearchSeasonSuffix(seriesTitle),
      Object.values(cvnames),
      Object.values(cvroles),
      author,
    ]),
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

export function getInfoStoreReadFailureSnapshot(store) {
  if (store?.loaded && store?.snapshot) {
    return cloneJson(store.snapshot);
  }
  return null;
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
      console.error(`Failed to read Upstash info snapshot key=${store.key}`, error);
      const fallbackSnapshot = getInfoStoreReadFailureSnapshot(store);
      if (fallbackSnapshot) {
        return fallbackSnapshot;
      }
      store.remoteAvailable = false;
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

async function ensureInfoStoreReadyForSearch(store) {
  if (!store.loaded) {
    return ensureInfoStoreLoaded(store);
  }
  if (Date.now() - store.lastLoadedAt >= INFO_STORE_SYNC_INTERVAL_MS && !store.loadPromise) {
    void ensureInfoStoreLoaded(store).catch((error) => {
      console.warn(`Info store background refresh failed platform=${store.platform}: ${formatImageProxyError(error)}`);
    });
  }
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

  const normalizedValue = normalizeSearchText(rawValue);
  if (!normalizedValue || !normalizedKeyword) {
    return 0;
  }
  if (normalizedValue === normalizedKeyword) {
    return 780;
  }
  if (
    normalizedValue.startsWith(normalizedKeyword) &&
    isCompleteSearchTermPrefix(rawValue, rawKeyword)
  ) {
    return 700;
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
  const normalizedKeywords = (Array.isArray(normalizedKeyword)
    ? normalizedKeyword
    : [normalizedKeyword]
  ).filter(Boolean);
  let bestScore = 0;
  entries.forEach(({ value, boost = 0 }) => {
    const values = Array.isArray(value) ? value : [value];
    values.forEach((item) => {
      const score = Math.max(
        0,
        ...normalizedKeywords.map((keyword) => getSearchFieldScore(item, rawKeyword, keyword))
      );
      if (score > 0) {
        bestScore = Math.max(bestScore, score + boost);
      }
    });
  });
  return bestScore;
}

function getPinyinSearchWindowScore(unit, normalizedKeyword) {
  const syllables = Array.isArray(unit?.syllables)
    ? unit.syllables.map((item) => normalizeSearchText(item)).filter(Boolean)
    : [];
  if (!syllables.length || !normalizedKeyword) {
    return 0;
  }

  let bestScore = 0;
  for (let start = 0; start < syllables.length; start += 1) {
    let joined = "";
    for (let end = start; end < syllables.length; end += 1) {
      joined += syllables[end];
      if (joined !== normalizedKeyword) {
        continue;
      }
      if (start === 0 && end === syllables.length - 1) {
        bestScore = Math.max(bestScore, 780);
      } else if (start === 0) {
        bestScore = Math.max(bestScore, 620);
      } else {
        bestScore = Math.max(bestScore, 460);
      }
    }
  }
  return bestScore;
}

function getPinyinInitialsScore(unit, normalizedKeyword) {
  const initials = normalizeSearchText(unit?.initials);
  if (!initials || !normalizedKeyword) {
    return 0;
  }
  if (initials === normalizedKeyword) {
    return 780;
  }
  if (initials.startsWith(normalizedKeyword)) {
    return 620;
  }
  if (initials.includes(normalizedKeyword)) {
    return 460;
  }
  return 0;
}

function getPinyinSearchUnitScore(units, rawKeyword) {
  const normalizedKeyword = normalizeSearchText(rawKeyword);
  if (!normalizedKeyword) {
    return 0;
  }

  const keywordHasHan = /\p{Script=Han}/u.test(String(rawKeyword ?? ""));
  const queryUnits = keywordHasHan ? buildPinyinSearchUnits(rawKeyword) : [];
  const queryFull = queryUnits.length
    ? normalizeSearchText(queryUnits.flatMap((unit) => unit.syllables || []).join(""))
    : normalizedKeyword;
  const safeUnits = Array.isArray(units) ? units : [];

  return safeUnits.reduce((bestScore, unit) => {
    const fullScore = getPinyinSearchWindowScore(unit, queryFull);
    const initialsScore = keywordHasHan ? 0 : getPinyinInitialsScore(unit, normalizedKeyword);
    return Math.max(bestScore, fullScore, initialsScore);
  }, 0);
}

function getWeightedPinyinSearchScore(entries, rawKeyword) {
  let bestScore = 0;
  entries.forEach(({ value, boost = 0 }) => {
    const score = getPinyinSearchUnitScore(value, rawKeyword);
    if (score > 0) {
      bestScore = Math.max(bestScore, score + boost);
    }
  });
  return bestScore;
}

function buildSearchKeywordVariants(rawKeyword) {
  const pinyinTokens = /\p{Script=Han}/u.test(String(rawKeyword ?? ""))
    ? buildPinyinFullSearchTokens(rawKeyword)
    : buildPinyinSearchTokens(rawKeyword);
  return Array.from(
    new Set([normalizeSearchText(rawKeyword), ...pinyinTokens].filter(Boolean))
  );
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
  if (card?.search_source === "manbo_api") {
    return Number(card?.price ?? 0) > 100 ? "付费" : "免费";
  }
  return ["season", "episode"].includes(String(card?.revenue_type ?? ""))
    ? "付费"
    : "免费";
}

function escapeRegExp(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pushSearchBranch(branches, keyword, category = null) {
  const rawKeyword = normalizeTextValue(keyword);
  if (!rawKeyword) {
    return;
  }
  const normalizedKeyword = normalizeSearchText(rawKeyword);
  if (!normalizedKeyword) {
    return;
  }

  const hasBranch = (branchKeyword) => branches.some(
    (branch) =>
      branch.category === category &&
      normalizeSearchText(branch.keyword) === branchKeyword
  );
  if (!hasBranch(normalizedKeyword)) {
    branches.push({ keyword: rawKeyword, category });
  }

  const strippedKeyword = stripSearchSeasonSuffix(rawKeyword);
  const normalizedStrippedKeyword = normalizeSearchText(strippedKeyword);
  if (
    normalizedStrippedKeyword &&
    normalizedStrippedKeyword !== normalizedKeyword &&
    !hasBranch(normalizedStrippedKeyword)
  ) {
    branches.push({ keyword: strippedKeyword, category });
  }
}

function buildSearchBranches(keyword) {
  const rawKeyword = normalizeTextValue(keyword);
  const branches = [];
  pushSearchBranch(branches, rawKeyword);
  if (!rawKeyword) {
    return branches;
  }

  const normalizedKeyword = normalizeSearchText(rawKeyword);
  for (const category of SEARCH_CATEGORY_TERMS) {
    for (const term of category.terms) {
      const normalizedTerm = normalizeSearchText(term);
      if (!normalizedTerm || !normalizedKeyword.includes(normalizedTerm)) {
        continue;
      }

      const splitKeyword = normalizeTextValue(
        rawKeyword.replace(new RegExp(escapeRegExp(term), "g"), "")
      );
      if (!splitKeyword || normalizeSearchText(splitKeyword) === normalizedKeyword) {
        continue;
      }

      pushSearchBranch(branches, splitKeyword, category.key);
      return branches;
    }
  }

  return branches;
}

const QUERY_COMMA_SEPARATOR_PATTERN = /[,，]+/u;
const QUERY_SPACE_SEPARATOR_PATTERN = /\s+/u;
const QUERY_SEASON_PART_PATTERN = /^[上中下前后]$/u;
const CHINESE_NUMBER_PATTERN = "[0-9零〇一二两三四五六七八九十百千万]+";
const QUERY_SEASON_TERM_PATTERN = new RegExp(
  `^(?:第\\s*${CHINESE_NUMBER_PATTERN}\\s*[季部册卷期集话章节]?|${CHINESE_NUMBER_PATTERN}\\s*[季部]|[上下]季|全一季)` +
    `(?:\\s*[（(【\\[]?[上中下前后]\\s*[）)】\\]]?)?$`,
  "u"
);

function isPureSeasonQueryTerm(value) {
  const text = normalizeTextValue(value);
  return Boolean(text && (QUERY_SEASON_PART_PATTERN.test(text) || QUERY_SEASON_TERM_PATTERN.test(text)));
}

function tokenizeSearchAndTerms(value) {
  const chunks = normalizeTextValue(value)
    .split(QUERY_SPACE_SEPARATOR_PATTERN)
    .map((item) => item.trim())
    .filter(Boolean);
  const terms = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (
      QUERY_SEASON_TERM_PATTERN.test(chunk) &&
      QUERY_SEASON_PART_PATTERN.test(chunks[index + 1] || "")
    ) {
      terms.push(`${chunk} ${chunks[index + 1]}`);
      index += 1;
      continue;
    }
    terms.push(chunk);
  }

  return terms;
}

function parseLibrarySearchExpression(keyword) {
  const rawKeyword = normalizeTextValue(keyword);
  if (!rawKeyword) {
    return {
      groups: [],
      isCompound: false,
    };
  }

  const hasOrSeparator = QUERY_COMMA_SEPARATOR_PATTERN.test(rawKeyword);
  const groups = rawKeyword
    .split(QUERY_COMMA_SEPARATOR_PATTERN)
    .map((group) => tokenizeSearchAndTerms(group))
    .filter((terms) => terms.length > 0)
    .filter((terms) => !(hasOrSeparator && terms.every(isPureSeasonQueryTerm)))
    .map((terms) => ({ terms }));

  return {
    groups,
    isCompound: hasOrSeparator || groups.some((group) => group.terms.length > 1),
  };
}

function pickBestScoredItems(items) {
  const map = new Map();
  items.forEach((item) => {
    const key = String(item?.record?.dramaId ?? "");
    if (!key) {
      return;
    }
    const current = map.get(key);
    if (!current || Number(item?.score ?? 0) > Number(current?.score ?? 0)) {
      map.set(key, item);
    }
  });
  return map;
}

function mergeBestScoredItem(map, item) {
  const key = String(item?.record?.dramaId ?? "");
  if (!key) {
    return;
  }
  const current = map.get(key);
  if (!current || Number(item?.score ?? 0) > Number(current?.score ?? 0)) {
    map.set(key, item);
  }
}

function buildAndScoredMatches(records, terms, keyword, buildTermMatches) {
  const termMaps = terms.map((term) => pickBestScoredItems(buildTermMatches(records, term)));
  if (!termMaps.length || termMaps.some((map) => map.size === 0)) {
    return [];
  }

  const [firstMap, ...remainingMaps] = termMaps;
  const matches = [];
  firstMap.forEach((firstItem, key) => {
    if (!remainingMaps.every((map) => map.has(key))) {
      return;
    }
    const items = [firstItem, ...remainingMaps.map((map) => map.get(key))];
    matches.push({
      record: firstItem.record,
      score: items.reduce((total, item) => total + Number(item?.score ?? 0), 0),
    });
  });

  return sortScoredDramaRecords(matches, keyword);
}

function buildCompoundScoredMatches(records, keyword, buildTermMatches) {
  const expression = parseLibrarySearchExpression(keyword);
  if (!expression.isCompound) {
    return null;
  }

  const merged = new Map();
  expression.groups.forEach((group) => {
    buildAndScoredMatches(records, group.terms, group.terms.join(" "), buildTermMatches)
      .forEach((item) => mergeBestScoredItem(merged, item));
  });

  return sortScoredDramaRecords(Array.from(merged.values()), keyword);
}

function recordTextIncludesAny(values, terms) {
  const normalizedTerms = (Array.isArray(terms) ? terms : [])
    .map((term) => normalizeSearchText(term))
    .filter(Boolean);
  if (!normalizedTerms.length) {
    return false;
  }

  return (Array.isArray(values) ? values : [values]).some((value) => {
    const normalizedValue = normalizeSearchText(value);
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

function getManboRecordPinyinUnits(record) {
  if (Array.isArray(record?.searchPinyinUnits) && record.searchPinyinUnits.length) {
    return record.searchPinyinUnits;
  }
  return buildCombinedPinyinSearchUnits([
    stripSearchSeasonSuffix(record?.name),
    record?.aliases,
    record?.mainCvNicknames,
    record?.mainCvNames,
    record?.mainCvRoleNames,
    stripSearchSeasonSuffix(record?.seriesTitle),
    record?.author,
  ]);
}

function getMissevanRecordPinyinUnits(record) {
  if (Array.isArray(record?.searchPinyinUnits) && record.searchPinyinUnits.length) {
    return record.searchPinyinUnits;
  }
  return buildCombinedPinyinSearchUnits([
    stripSearchSeasonSuffix(record?.title),
    stripSearchSeasonSuffix(record?.seriesTitle),
    Object.values(record?.cvnames || {}),
    Object.values(record?.cvroles || {}),
    record?.author,
  ]);
}

function getExactSeasonTitleSearchScore(value, rawKeyword, boost = 0) {
  const normalizedKeyword = normalizeSearchText(rawKeyword);
  const normalizedStrippedKeyword = normalizeSearchText(stripSearchSeasonSuffix(rawKeyword));
  if (
    !normalizedKeyword ||
    !normalizedStrippedKeyword ||
    normalizedKeyword === normalizedStrippedKeyword
  ) {
    return 0;
  }
  return normalizeSearchText(value) === normalizedKeyword ? 1080 + boost : 0;
}

function scoreManboLibraryRecord(record, keyword, options = {}) {
  const allowSeasonTerm = Boolean(options?.allowSeasonTerm);
  const rawKeyword = normalizeTextValue(keyword);
  const normalizedKeywords = buildSearchKeywordVariants(rawKeyword);
  if (!rawKeyword) {
    return 0;
  }
  if (record.dramaId === rawKeyword) {
    return 1200;
  }
  const textScore = getWeightedSearchScore(
    [
      { value: stripSearchSeasonSuffix(record.name), boost: 220 },
      { value: record.aliases, boost: 180 },
      { value: record.mainCvNicknames, boost: 150 },
      { value: record.mainCvNames, boost: 140 },
      { value: record.mainCvRoleNames, boost: 120 },
      { value: stripSearchSeasonSuffix(record.seriesTitle), boost: 100 },
      { value: record.author, boost: 90 },
    ],
    rawKeyword,
    normalizedKeywords
  );
  const pinyinScore = getWeightedPinyinSearchScore(
    [{ value: getManboRecordPinyinUnits(record), boost: 210 }],
    rawKeyword
  );
  const exactSeasonTitleScore = Math.max(
    getExactSeasonTitleSearchScore(record.name, rawKeyword, 20),
    getExactSeasonTitleSearchScore(record.seriesTitle, rawKeyword)
  );
  const seasonTermScore = allowSeasonTerm && isPureSeasonQueryTerm(rawKeyword)
    ? getWeightedSearchScore(
        [
          { value: record.name, boost: 40 },
          { value: record.seriesTitle, boost: 20 },
        ],
        rawKeyword,
        normalizeSearchText(rawKeyword)
      )
    : 0;
  return Math.max(exactSeasonTitleScore, seasonTermScore, textScore, pinyinScore);
}

function scoreMissevanLibraryRecord(record, keyword, options = {}) {
  const allowSeasonTerm = Boolean(options?.allowSeasonTerm);
  const rawKeyword = normalizeTextValue(keyword);
  const normalizedKeywords = buildSearchKeywordVariants(rawKeyword);
  if (!rawKeyword) {
    return 0;
  }
  if (String(record.dramaId) === rawKeyword) {
    return 1200;
  }
  if ((Array.isArray(record.soundIds) ? record.soundIds : []).includes(rawKeyword)) {
    return 1120;
  }
  const textScore = getWeightedSearchScore(
    [
      { value: stripSearchSeasonSuffix(record.title), boost: 220 },
      { value: stripSearchSeasonSuffix(record.seriesTitle), boost: 170 },
      { value: Object.values(record.cvnames || {}), boost: 150 },
      { value: Object.values(record.cvroles || {}), boost: 130 },
      { value: record.author, boost: 90 },
    ],
    rawKeyword,
    normalizedKeywords
  );
  const pinyinScore = getWeightedPinyinSearchScore(
    [{ value: getMissevanRecordPinyinUnits(record), boost: 210 }],
    rawKeyword
  );
  const exactSeasonTitleScore = Math.max(
    getExactSeasonTitleSearchScore(record.title, rawKeyword, 20),
    getExactSeasonTitleSearchScore(record.seriesTitle, rawKeyword)
  );
  const seasonTermScore = allowSeasonTerm && isPureSeasonQueryTerm(rawKeyword)
    ? getWeightedSearchScore(
        [
          { value: record.title, boost: 40 },
          { value: record.seriesTitle, boost: 20 },
        ],
        rawKeyword,
        normalizeSearchText(rawKeyword)
      )
    : 0;
  return Math.max(exactSeasonTitleScore, seasonTermScore, textScore, pinyinScore);
}

function buildScoredManboLibraryMatches(records, keyword, category = null, options = {}) {
  return sortScoredDramaRecords(records
    .filter((record) => matchesManboSearchCategory(record, category))
    .map((record) => ({
      record,
      score: scoreManboLibraryRecord(record, keyword, options),
    }))
    .filter((item) => item.score > 0), keyword);
}

function buildScoredMissevanLibraryMatches(records, keyword, category = null, options = {}) {
  return sortScoredDramaRecords(records
    .filter((record) => matchesMissevanSearchCategory(record, category))
    .map((record) => ({
      record,
      score: scoreMissevanLibraryRecord(record, keyword, options),
    }))
    .filter((item) => item.score > 0), keyword);
}

function buildScoredManboLibraryTermMatches(records, keyword) {
  return buildSearchBranches(keyword)
    .flatMap((branch) => buildScoredManboLibraryMatches(
      records,
      branch.keyword,
      branch.category,
      { allowSeasonTerm: true }
    ));
}

function buildScoredMissevanLibraryTermMatches(records, keyword) {
  return buildSearchBranches(keyword)
    .flatMap((branch) => buildScoredMissevanLibraryMatches(
      records,
      branch.keyword,
      branch.category,
      { allowSeasonTerm: true }
    ));
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

function getSearchSortTitle(record) {
  return normalizeTextValue(record?.title || record?.name || record?.seriesTitle || "");
}

function getSearchSortGroupKey(sortKey) {
  return sortKey?.baseKey ? normalizeSearchText(sortKey.baseKey) : "";
}

function getSearchSortKindRank(sortKey) {
  if (sortKey?.kind === 0) {
    return 0;
  }
  if (sortKey?.kind === 2) {
    return 1;
  }
  if (sortKey?.kind === 1) {
    return 2;
  }
  return 3;
}

function compareSearchSortKeys(left, right) {
  const kindDelta = getSearchSortKindRank(left) - getSearchSortKindRank(right);
  if (kindDelta !== 0) {
    return kindDelta;
  }

  if (left?.kind === 0 && right?.kind === 0) {
    const leftSeason = Number(left?.seasonNumber ?? Number.MAX_SAFE_INTEGER);
    const rightSeason = Number(right?.seasonNumber ?? Number.MAX_SAFE_INTEGER);
    const seasonDelta = leftSeason - rightSeason;
    if (seasonDelta !== 0) {
      return seasonDelta;
    }

    const partDelta = Number(left?.partRank ?? 0) - Number(right?.partRank ?? 0);
    if (partDelta !== 0) {
      return partDelta;
    }
  }

  return 0;
}

function decorateSearchSortItems(items, keyword) {
  const decoratedItems = [...(Array.isArray(items) ? items : [])].map((item) => {
    const sortKey = extractSearchSortKey(getSearchSortTitle(item?.record), keyword);
    return {
      ...item,
      searchSortKey: sortKey,
      searchSortGroupKey: getSearchSortGroupKey(sortKey),
      searchSortGroupRecord: null,
    };
  });
  const groupBestRecords = new Map();
  decoratedItems.forEach((item) => {
    if (!item.searchSortGroupKey) {
      return;
    }
    const key = `${Number(item?.score ?? 0)}::${item.searchSortGroupKey}`;
    const currentRecord = groupBestRecords.get(key);
    if (!currentRecord || compareDramaIdsDesc(item.record, currentRecord) < 0) {
      groupBestRecords.set(key, item.record);
    }
  });

  return decoratedItems.map((item) => {
    if (!item.searchSortGroupKey) {
      return item;
    }
    return {
      ...item,
      searchSortGroupRecord: groupBestRecords.get(
        `${Number(item?.score ?? 0)}::${item.searchSortGroupKey}`
      ) || null,
    };
  });
}

function compareSearchSortGroups(left, right) {
  if (!left?.searchSortGroupKey || !right?.searchSortGroupKey) {
    return 0;
  }
  if (left.searchSortGroupKey === right.searchSortGroupKey) {
    return compareSearchSortKeys(left.searchSortKey, right.searchSortKey);
  }

  const groupDelta = compareDramaIdsDesc(
    left.searchSortGroupRecord,
    right.searchSortGroupRecord
  );
  if (groupDelta !== 0) {
    return groupDelta;
  }
  return left.searchSortGroupKey.localeCompare(right.searchSortGroupKey, "zh-Hans-CN");
}

function sortScoredDramaRecords(items, keyword) {
  return decorateSearchSortItems(items, keyword).sort((left, right) => {
    const scoreDelta = Number(right?.score ?? 0) - Number(left?.score ?? 0);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    const searchSortDelta = compareSearchSortGroups(left, right);
    if (searchSortDelta !== 0) {
      return searchSortDelta;
    }
    return compareDramaIdsDesc(left?.record, right?.record);
  });
}

function searchManboLibraryRecordsStrict(records, keyword, limit = null) {
  const compoundMatches = buildCompoundScoredMatches(
    records,
    keyword,
    buildScoredManboLibraryTermMatches
  );
  if (compoundMatches) {
    return applyOptionalSearchLimit(compoundMatches.map((item) => item.record), limit);
  }

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

function searchMissevanLibraryRecordsStrict(records, keyword, limit = null) {
  const compoundMatches = buildCompoundScoredMatches(
    records,
    keyword,
    buildScoredMissevanLibraryTermMatches
  );
  if (compoundMatches) {
    return applyOptionalSearchLimit(compoundMatches.map((item) => item.record), limit);
  }

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

function canonicalizeCompatibleStringArray(values) {
  return (Array.isArray(values) ? values : [])
    .map(canonicalizeCompatibleSearchText);
}

function canonicalizeCompatibleStringMap(values) {
  return Object.fromEntries(
    Object.entries(values && typeof values === "object" ? values : {})
      .map(([key, value]) => [key, canonicalizeCompatibleSearchText(value)])
  );
}

function buildCompatibleManboSearchRecord(record) {
  return {
    ...record,
    name: canonicalizeCompatibleSearchText(record?.name),
    aliases: canonicalizeCompatibleStringArray(record?.aliases),
    mainCvNicknames: canonicalizeCompatibleStringArray(record?.mainCvNicknames),
    mainCvNames: canonicalizeCompatibleStringArray(record?.mainCvNames),
    mainCvRoleNames: canonicalizeCompatibleStringArray(record?.mainCvRoleNames),
    seriesTitle: canonicalizeCompatibleSearchText(record?.seriesTitle),
    author: canonicalizeCompatibleSearchText(record?.author),
    catalogName: canonicalizeCompatibleSearchText(record?.catalogName),
    genre: canonicalizeCompatibleSearchText(record?.genre),
  };
}

function buildCompatibleMissevanSearchRecord(record) {
  return {
    ...record,
    title: canonicalizeCompatibleSearchText(record?.title),
    seriesTitle: canonicalizeCompatibleSearchText(record?.seriesTitle),
    cvnames: canonicalizeCompatibleStringMap(record?.cvnames),
    cvroles: canonicalizeCompatibleStringMap(record?.cvroles),
    author: canonicalizeCompatibleSearchText(record?.author),
  };
}

function restoreOriginalSearchRecords(matchedRecords, records) {
  const recordsById = new Map(
    (Array.isArray(records) ? records : [])
      .map((record) => [String(record?.dramaId ?? ""), record])
      .filter(([dramaId]) => dramaId)
  );
  return matchedRecords
    .map((record) => recordsById.get(String(record?.dramaId ?? "")))
    .filter(Boolean);
}

function searchCompatibleLibraryRecords(
  records,
  keyword,
  limit,
  buildCompatibleRecord,
  searchStrict
) {
  const compatibleRecords = (Array.isArray(records) ? records : [])
    .map(buildCompatibleRecord);
  const matchedRecords = searchStrict(
    compatibleRecords,
    canonicalizeCompatibleSearchText(keyword),
    limit
  );
  return restoreOriginalSearchRecords(matchedRecords, records);
}

export function searchManboLibraryRecords(records, keyword, limit = null, matchMode = "fallback") {
  if (matchMode === "compatible") {
    return searchCompatibleLibraryRecords(
      records,
      keyword,
      limit,
      buildCompatibleManboSearchRecord,
      searchManboLibraryRecordsStrict
    );
  }

  const strictMatches = searchManboLibraryRecordsStrict(records, keyword, limit);
  if (strictMatches.length || matchMode === "strict") {
    return strictMatches;
  }
  return searchCompatibleLibraryRecords(
    records,
    keyword,
    limit,
    buildCompatibleManboSearchRecord,
    searchManboLibraryRecordsStrict
  );
}

export function searchMissevanLibraryRecords(records, keyword, limit = null, matchMode = "fallback") {
  if (matchMode === "compatible") {
    return searchCompatibleLibraryRecords(
      records,
      keyword,
      limit,
      buildCompatibleMissevanSearchRecord,
      searchMissevanLibraryRecordsStrict
    );
  }

  const strictMatches = searchMissevanLibraryRecordsStrict(records, keyword, limit);
  if (strictMatches.length || matchMode === "strict") {
    return strictMatches;
  }
  return searchCompatibleLibraryRecords(
    records,
    keyword,
    limit,
    buildCompatibleMissevanSearchRecord,
    searchMissevanLibraryRecordsStrict
  );
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

async function buildFavoriteMetaFromInfoStore(platform, dramaId) {
  const normalizedPlatform = platform === "manbo" ? "manbo" : platform === "missevan" ? "missevan" : "";
  const normalizedDramaId = String(dramaId ?? "").trim();
  if (!normalizedPlatform || !isNumericId(normalizedDramaId)) {
    return null;
  }

  const store = getInfoStore(normalizedPlatform);
  await ensureInfoStoreLoaded(store);
  const record = store.byDramaId.get(normalizedDramaId);
  if (!record) {
    return null;
  }

  const mainCvs = normalizedPlatform === "manbo" ? getManboMainCvNames(record) : getMissevanMainCvNames(record);
  const mainCvText = buildMainCvText(mainCvs);
  return {
    platform: normalizedPlatform,
    dramaId: normalizedDramaId,
    mainCvText,
    main_cv_text: mainCvText,
  };
}

function buildManboSearchFallbackCard(record) {
  const mainCvs = getManboMainCvNames(record);
  const isMember = Boolean(record?.vipFree);
  const paymentLabel = isMember ? "会员" : record?.needpay ? "付费" : "免费";
  const card = {
    id: String(record?.dramaId ?? ""),
    name: record?.name || "",
    cover: record?.cover || "",
    view_count: null,
    playCountWan: "",
    price: null,
    sound_id: null,
    subscription_num: null,
    pay_count: null,
    diamond_value: null,
    is_member: isMember,
    checked: false,
    platform: "manbo",
    metrics_status: "pending",
    content_type_label: getManboContentTypeLabel(record),
    main_cvs: mainCvs,
    main_cv_text: buildMainCvText(mainCvs),
    author: normalizeTextValue(record?.author),
  };
  return { ...card, payment_label: paymentLabel };
}

function buildMissevanSearchFallbackCard(record) {
  const mainCvs = getMissevanMainCvNames(record);
  const primarySoundId = normalizeStringIdArray(record?.soundIds, 1)[0] || null;
  const isMember = Boolean(record?.is_member);
  const paymentLabel = isMember ? "会员" : record?.needpay ? "付费" : "免费";
  const card = {
    id: Number(record?.dramaId ?? 0),
    name: record?.title || "",
    cover: record?.cover || "",
    view_count: null,
    playCountWan: "",
    vip: null,
    price: null,
    member_price: null,
    is_member: isMember,
    sound_id: primarySoundId ? Number(primarySoundId) : null,
    subscription_num: null,
    reward_num: null,
    checked: false,
    platform: "missevan",
    metrics_status: "pending",
    search_source: "library",
    content_type_label: getMissevanContentTypeLabel(record),
    main_cvs: mainCvs,
    main_cv_text: buildMainCvText(mainCvs),
    author: normalizeTextValue(record?.author),
  };
  return { ...card, payment_label: paymentLabel };
}

function getMissevanPrimarySoundIdFromRecord(record) {
  const primarySoundId = normalizeStringIdArray(record?.soundIds, 1)[0] || "";
  return Number(primarySoundId) || null;
}

function normalizeManboApiCategoryLabel(value) {
  if (typeof value === "string") {
    return normalizeTextValue(value);
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  return normalizeTextValue(value.name ?? value.label ?? value.title ?? value.categoryName);
}

function normalizeManboApiContentTypeLabel(drama) {
  const categoryName = normalizeTextValue(
    drama?.category ??
      drama?.categoryName ??
      drama?.category_name ??
      drama?.catalogName ??
      drama?.catalog_name
  );
  if (categoryName === "有声书") {
    return CONTENT_TYPE_LABEL_BY_CATEGORY.audio_drama;
  }
  if (recordTextIncludesAny(categoryName, MANBO_CATEGORY_ALIASES.radio_drama)) {
    return CONTENT_TYPE_LABEL_BY_CATEGORY.radio_drama;
  }
  if (recordTextIncludesAny(categoryName, MANBO_CATEGORY_ALIASES.audio_drama)) {
    return CONTENT_TYPE_LABEL_BY_CATEGORY.audio_drama;
  }
  return "";
}

function splitManboApiCvNames(value) {
  return normalizeStringArray(
    normalizeTextValue(value)
      .split(/[&、,，/／|]+/)
      .map((item) => item.trim())
      .filter(Boolean),
    20
  );
}

export function normalizeManboSearchApiCandidate(item) {
  const source = item && typeof item === "object" ? item : {};
  const drama = source?.radioDramaResp && typeof source.radioDramaResp === "object"
    ? source.radioDramaResp
    : source;
  const dramaId = String(
    drama?.radioDramaIdStr ??
      drama?.radioDramaId ??
      drama?.dramaId ??
      drama?.id ??
      ""
  ).trim();
  const title = normalizeTextValue(drama?.title ?? drama?.name);
  if (!/^\d+$/.test(dramaId) || !title) {
    return null;
  }

  const categoryLabels = normalizeStringArray(
    (Array.isArray(drama?.categoryLabels) ? drama.categoryLabels : [])
      .map(normalizeManboApiCategoryLabel)
      .filter(Boolean),
    10
  );

  return {
    dramaId,
    title,
    cover: normalizeTextValue(drama?.coverPic ?? drama?.cover ?? drama?.coverUrl),
    watchCount: normalizeOptionalFiniteNumber(drama?.watchCount) ?? 0,
    collectionFormatText: normalizeTextValue(drama?.collectionFormatText),
    cvNames: splitManboApiCvNames(drama?.cvNameStr),
    author: normalizeTextValue(
      drama?.author ??
        drama?.authorName ??
        drama?.originalAuthor ??
        drama?.originalAuthorName
    ),
    categoryLabels,
    contentTypeLabel: normalizeManboApiContentTypeLabel(drama),
    price: normalizeOptionalFiniteNumber(drama?.price) ?? 0,
    vipFree: Number(drama?.vipFree ?? 0) === 1,
  };
}

export function buildManboApiSearchFallbackCard(record) {
  const mainCvs = normalizeStringArray(record?.cvNames, 20);
  const viewCount = Number(record?.watchCount ?? 0) || 0;
  const card = {
    id: String(record?.dramaId ?? ""),
    name: record?.title || "",
    cover: record?.cover || "",
    view_count: viewCount,
    playCountWan: formatPlayCountWan(viewCount),
    price: Number(record?.price ?? 0) || 0,
    sound_id: null,
    subscription_num: null,
    pay_count: null,
    diamond_value: 0,
    is_member: Boolean(record?.vipFree),
    checked: false,
    platform: "manbo",
    search_source: "manbo_api",
    content_type_label: record?.contentTypeLabel || "",
    main_cvs: mainCvs,
    main_cv_text: buildMainCvText(mainCvs),
    author: normalizeTextValue(record?.author),
  };
  return {
    ...card,
    payment_label: getManboPaymentLabel(card),
  };
}

function collectManboSearchApiTimelineItems(payload) {
  const groups = Array.isArray(payload?.b?.searchStructureNewRespList)
    ? payload.b.searchStructureNewRespList
    : [];
  return groups.flatMap((group) =>
    Array.isArray(group?.timelineItemResp) ? group.timelineItemResp : []
  );
}

export function normalizeManboSearchApiPayloadRecords(payload) {
  const statusCode = payload?.h?.code == null ? 200 : Number(payload.h.code);
  if (statusCode !== 200) {
    const message = normalizeTextValue(payload?.h?.msg ?? payload?.h?.message);
    throw new Error(`Manbo search API error ${statusCode}${message ? `: ${message}` : ""}`);
  }

  return Array.from(
    collectManboSearchApiTimelineItems(payload)
      .map(normalizeManboSearchApiCandidate)
      .filter(Boolean)
      .reduce((map, item) => {
        const key = String(item.dramaId);
        if (!map.has(key)) {
          map.set(key, item);
        }
        return map;
      }, new Map())
      .values()
  ).slice(0, 20);
}

function generateManboVisitorId() {
  const randomSuffix = Math.floor(Math.random() * 1000000)
    .toString()
    .padStart(6, "0");
  return `${Date.now()}${randomSuffix}`;
}

async function fetchManboSearchApiRecords(keyword, options = {}) {
  const cacheKey = normalizeTextValue(keyword);
  const cached = getCachedValue(
    manboSearchApiCache,
    cacheKey,
    MISSEVAN_SEARCH_API_CACHE_TTL_MS
  );
  if (cached) {
    return cached;
  }

  const url = new URL(MANBO_SEARCH_API_BASE);
  url.searchParams.set("type", "5");
  url.searchParams.set("keyWord", cacheKey);
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("pageSize", "20");

  try {
    const payload = await fetchJsonWithRetry(url.toString(), 2, 250, {
      headers: {
        visitor_id: generateManboVisitorId(),
      },
      timeoutMs: MANBO_FETCH_TIMEOUT_MS,
    });
    const normalized = normalizeManboSearchApiPayloadRecords(payload);

    setCachedValue(manboSearchApiCache, cacheKey, normalized);
    if (options?.logApiCall) {
      void writeUsageLog(buildManboSearchApiUsageLog(cacheKey, { matchedCount: normalized.length }));
    }
    return normalized;
  } catch (error) {
    if (options?.logApiCall) {
      void writeUsageLog(buildManboSearchApiUsageLog(cacheKey, { matchedCount: 0, error }));
    }
    throw error;
  }
}

export function selectManboSearchSourceRecords(libraryRecords, apiRecords) {
  const normalizedLibraryRecords = Array.isArray(libraryRecords) ? libraryRecords : [];
  if (normalizedLibraryRecords.length > 0) {
    return {
      source: "library",
      records: normalizedLibraryRecords,
    };
  }
  return {
    source: "manbo_api",
    records: Array.isArray(apiRecords) ? apiRecords : [],
  };
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
    author: normalizeTextValue(
      candidate?.author ??
        candidate?.author_name ??
        candidate?.authorName ??
        drama?.author ??
        drama?.author_name ??
        drama?.authorName ??
        info?.author ??
        ""
    ),
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

async function searchMissevanApiRecords(keyword, limit = 70, options = {}) {
  const cacheKey = normalizeTextValue(keyword);
  const cached = getCachedValue(
    missevanSearchApiCache,
    cacheKey,
    MISSEVAN_SEARCH_API_CACHE_TTL_MS
  );
  if (cached) {
    return cached;
  }

  try {
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
        if (options?.logApiCall) {
          void writeUsageLog(buildMissevanSearchApiUsageLog(cacheKey, { matchedCount: 0 }));
        }
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
    if (options?.logApiCall) {
      void writeUsageLog(buildMissevanSearchApiUsageLog(cacheKey, { matchedCount: normalized.length }));
    }
    return normalized;
  } catch (error) {
    if (options?.logApiCall) {
      void writeUsageLog(buildMissevanSearchApiUsageLog(cacheKey, { matchedCount: 0, error }));
    }
    throw error;
  }
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
    view_count: null,
    playCountWan: "",
    vip: null,
    price: null,
    member_price: null,
    is_member: null,
    sound_id: Number(record?.soundId ?? 0) || null,
    subscription_num: null,
    reward_num: null,
    checked: false,
    platform: "missevan",
    metrics_status: "pending",
    search_source: "missevan_api",
    content_type_label: "",
    main_cvs: mainCvs,
    main_cv_text: buildMainCvText(mainCvs),
    author: normalizeTextValue(record?.author),
  };
  return { ...card, payment_label: "" };
}

async function hydrateMissevanApiSearchBaseRecord(record) {
  const fallbackCard = buildMissevanApiSearchFallbackCard(record);
  try {
    const info = await fetchDramaInfo(record.dramaId, fallbackCard.sound_id);
    if (!info?.drama) {
      return fallbackCard;
    }
    const mainCvs = getMissevanApiCvNames(info, 2);
    const card = {
      ...fallbackCard,
      cover: info.drama.cover || fallbackCard.cover,
      vip: Number(info.drama.vip ?? 0),
      price: Number(info.drama.price ?? 0),
      member_price: Number(info.drama.member_price ?? 0),
      is_member: Boolean(info.drama.is_member),
      sound_id: Number(fallbackCard.sound_id ?? info?.episodes?.episode?.[0]?.sound_id ?? 0) || null,
      content_type_label: getMissevanContentTypeLabel(info.drama),
      main_cvs: mainCvs,
      main_cv_text: buildMainCvText(mainCvs),
      author: fallbackCard.author || normalizeTextValue(info.drama.author),
    };
    return { ...card, payment_label: getMissevanPaymentLabel(card) };
  } catch (error) {
    if (isMissevanAccessDenied(error)) {
      return {
        ...fallbackCard,
        metrics_status: "access_denied",
        metrics_error_code: "ACCESS_DENIED",
        search_access_denied: true,
      };
    }
    console.warn(
      `Failed to resolve Missevan API search base card drama_id=${record.dramaId}: ${formatImageProxyError(error)}`
    );
    return fallbackCard;
  }
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
      author: fallbackCard.author || normalizeTextValue(info.drama.author),
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
      author: fallbackCard.author || normalizeTextValue(info.drama.author),
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

function buildEmptyUnifiedPlatformSearchResult(keyword, offset, limit, source = "library_only", extraMeta = {}) {
  return {
    success: false,
    results: [],
    meta: {
      ...buildSearchPageMeta(keyword, 0, offset, limit),
      source,
      ...extraMeta,
    },
  };
}

export function normalizeSettledUnifiedSearchResult(platform, settled, fallbackResult, stage) {
  if (settled.status === "fulfilled") {
    return settled.value;
  }
  const error = settled.reason;
  const message = error instanceof Error ? error.message : String(error);
  const accessDenied = platform === "missevan" && isMissevanAccessDenied(error);
  console.error(`Unified ${stage} search failed platform=${platform}`, error);
  return {
    ...fallbackResult,
    success: false,
    unavailable: true,
    ...(accessDenied ? { accessDenied: true } : {}),
    error: message,
    meta: {
      ...(fallbackResult.meta || {}),
      source: `${stage}_error`,
      error: message,
    },
  };
}

function hasUnifiedSearchMatches(result) {
  const results = Array.isArray(result?.results) ? result.results : [];
  const matchedCount = Number(result?.meta?.matchedCount ?? result?.meta?.totalMatched ?? results.length) || 0;
  return matchedCount > 0 || results.length > 0;
}

export function buildUnifiedSearchFallbackPlan(missevanResult, manboResult) {
  const missevanHasMatches = hasUnifiedSearchMatches(missevanResult);
  const manboHasMatches = hasUnifiedSearchMatches(manboResult);
  const missevan = !missevanHasMatches && !missevanResult?.unavailable && !manboHasMatches;
  const manbo = !manboHasMatches && !manboResult?.unavailable && !missevanHasMatches;

  return {
    missevan,
    manbo,
    usedApiFallback: missevan || manbo,
  };
}

async function runMissevanLibraryUnifiedSearch(keyword, offset, limit, matchMode = "fallback") {
  let source = "library_only";
  let totalMatched = 0;
  let results = [];

  if (missevanInfoStore.remoteAvailable) {
    const matchedRecords = searchMissevanLibraryRecords(
      missevanInfoStore.records,
      keyword,
      SEARCH_RESULT_LIMIT,
      matchMode
    );
    source = "library";
    totalMatched = matchedRecords.length;

    if (matchedRecords.length > 0) {
      const pagedRecords = matchedRecords.slice(offset, offset + limit);
      results = pagedRecords.map(buildMissevanSearchFallbackCard);
    }
  }

  return {
    success: totalMatched > 0,
    results,
    meta: {
      ...buildSearchPageMeta(keyword, totalMatched, offset, limit),
      source,
    },
  };
}

async function runManboLibraryUnifiedSearch(keyword, offset, limit, matchMode = "fallback") {
  const matchedRecords = searchManboLibraryRecords(
    manboInfoStore.records,
    keyword,
    SEARCH_RESULT_LIMIT,
    matchMode
  );

  if (!matchedRecords.length) {
    return buildEmptyUnifiedPlatformSearchResult(keyword, offset, limit, "library_only", {
      hydratedCount: 0,
    });
  }

  const pagedRecords = matchedRecords.slice(offset, offset + limit);
  const hydratedResults = pagedRecords.map(buildManboSearchFallbackCard);

  return {
    success: true,
    results: hydratedResults,
    meta: {
      ...buildSearchPageMeta(keyword, matchedRecords.length, offset, limit),
      source: "library",
      hydratedCount: hydratedResults.length,
    },
  };
}

async function runMissevanApiUnifiedSearch(keyword, offset, limit) {
  try {
    const apiRecords = await searchMissevanApiRecords(
      keyword,
      SEARCH_RESULT_LIMIT,
      { logApiCall: true }
    );
    const pagedRecords = apiRecords.slice(offset, offset + limit);
    const resolvedResults = await mapWithConcurrency(
      pagedRecords,
      4,
      hydrateMissevanApiSearchBaseRecord
    );
    const accessDenied = resolvedResults.some((item) => item?.search_access_denied === true);
    const results = resolvedResults.map(({ search_access_denied: _ignored, ...item }) => item);

    return {
      success: apiRecords.length > 0,
      results,
      ...(accessDenied ? { accessDenied: true } : {}),
      meta: {
        ...buildSearchPageMeta(keyword, apiRecords.length, offset, limit),
        source: "missevan_api",
      },
    };
  } catch (error) {
    console.error(`Failed to run unified Missevan API search keyword=${keyword}`, error);
    return {
      ...buildMissevanAccessDeniedResponse(error),
      results: [],
      meta: {
        ...buildSearchPageMeta(keyword, 0, offset, limit),
        source: "missevan_api",
      },
    };
  }
}

async function runManboApiUnifiedSearch(keyword, offset, limit) {
  try {
    const apiRecords = await fetchManboSearchApiRecords(keyword, { logApiCall: true });
    const sourceSelection = selectManboSearchSourceRecords([], apiRecords);
    const apiResults = sourceSelection.records.map(buildManboApiSearchFallbackCard);
    const pagedResults = apiResults.slice(offset, offset + limit);

    return {
      success: apiResults.length > 0,
      results: pagedResults,
      meta: {
        ...buildSearchPageMeta(keyword, apiResults.length, offset, limit),
        source: sourceSelection.source,
        hydratedCount: pagedResults.length,
      },
    };
  } catch (error) {
    console.error(`Failed to run unified Manbo API search keyword=${keyword}`, error);
    return {
      success: false,
      results: [],
      meta: {
        ...buildSearchPageMeta(keyword, 0, offset, limit),
        source: "manbo_api",
        hydratedCount: 0,
      },
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function buildMissevanDramaCardFromInput(item) {
  if (!item || item.type === "invalid") {
    return null;
  }

  const requestedDramaId = item.type === "drama" ? Number(item.id) : null;
  const requestedSoundId = item.type === "sound" ? Number(item.id) : null;
  const libraryRecord = requestedDramaId
    ? missevanInfoStore.byDramaId.get(String(requestedDramaId))
    : null;
  const preferredSoundId =
    requestedSoundId || getMissevanPrimarySoundIdFromRecord(libraryRecord);
  const info = await fetchDramaInfo(requestedDramaId, preferredSoundId || null);

  if (!info?.drama) {
    return null;
  }

  const resolvedDramaId = Number(info.drama.id ?? requestedDramaId ?? 0);
  const resolvedLibraryRecord =
    libraryRecord || missevanInfoStore.byDramaId.get(String(resolvedDramaId));
  const primarySoundId =
    preferredSoundId ||
    Number(info?.episodes?.episode?.[0]?.sound_id ?? 0) ||
    null;
  const mainCvs = resolvedLibraryRecord
    ? getMissevanMainCvNames(resolvedLibraryRecord)
    : [];
  let rewardNum = null;

  try {
    const rewardMeta = await fetchRewardDetailMeta(resolvedDramaId);
    rewardNum = normalizeOptionalFiniteNumber(rewardMeta?.reward_num);
  } catch (error) {
    if (isMissevanAccessDenied(error)) {
      throw error;
    }
    console.error(
      `Failed to fetch Missevan reward detail drama_id=${resolvedDramaId}`,
      error
    );
  }

  const card = {
    id: resolvedDramaId,
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
    content_type_label:
      getMissevanContentTypeLabel(info.drama) ||
      (resolvedLibraryRecord ? getMissevanContentTypeLabel(resolvedLibraryRecord) : ""),
    author: normalizeTextValue(resolvedLibraryRecord?.author ?? info.drama.author),
  };

  if (mainCvs.length > 0) {
    card.main_cvs = mainCvs;
    card.main_cv_text = buildMainCvText(mainCvs);
  }

  return {
    card: {
      ...card,
      payment_label: getMissevanPaymentLabel(card),
    },
    isNewDrama: !resolvedLibraryRecord,
    dramaId: String(resolvedDramaId),
  };
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
      author: card.author || fallbackCard.author,
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

export function createTimeoutSignal(timeoutMs, externalSignal) {
  const normalizedTimeout = Number(timeoutMs);
  const hasTimeout = Number.isFinite(normalizedTimeout) && normalizedTimeout > 0;
  if (!hasTimeout && !externalSignal) {
    return { signal: undefined, cleanup: () => {} };
  }

  const controller = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => {
    controller.abort(externalSignal.reason);
  };
  if (externalSignal?.aborted) {
    onExternalAbort();
  } else {
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  }
  const timer = hasTimeout
    ? setTimeout(() => {
        timedOut = true;
        controller.abort(new Error(`Request timeout after ${normalizedTimeout}ms`));
      }, normalizedTimeout)
    : null;

  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
    cleanup: () => {
      if (timer) {
        clearTimeout(timer);
      }
      externalSignal?.removeEventListener("abort", onExternalAbort);
    },
  };
}

function buildMissevanFetchHeaders(headers = {}) {
  const mergedHeaders = {
    ...MISSEVAN_BROWSER_HEADERS,
    ...(headers || {}),
  };
  delete mergedHeaders.Cookie;
  delete mergedHeaders.cookie;
  return mergedHeaders;
}

function normalizeMissevanFallbackBaseUrl(
  value = MISSEVAN_FALLBACK_DEFAULT_BASE_URL,
  defaultBaseUrl = MISSEVAN_FALLBACK_DEFAULT_BASE_URL
) {
  const rawValue = String(value || defaultBaseUrl).trim();

  try {
    const parsed = new URL(rawValue);
    parsed.hash = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString().replace(/\/+$/, "");
  } catch (_error) {
    return defaultBaseUrl;
  }
}

export function isMissevanFallbackEnabled({
  baseUrl = MISSEVAN_FALLBACK_BASE_URL,
  proxyToken = MISSEVAN_FALLBACK_PROXY_TOKEN,
} = {}) {
  return Boolean(String(baseUrl || "").trim() && String(proxyToken || "").trim());
}

function shouldForceMissevanFallback() {
  return Boolean(getForcedMissevanFallbackRoute());
}

function isMissevanFallbackRouteEnabled(route) {
  return isMissevanFallbackEnabled({
    baseUrl: route?.baseUrl,
    proxyToken: route?.proxyToken,
  });
}

function getEnabledMissevanFallbackRoutes(routes = MISSEVAN_FALLBACK_ROUTES) {
  return routes.filter((route) => isMissevanFallbackRouteEnabled(route));
}

function hasEnabledMissevanFallbackRoutes() {
  return getEnabledMissevanFallbackRoutes().length > 0;
}

function getMissevanAccessDeniedCooldownUntil() {
  if (!isInAccessDeniedCooldown()) {
    return 0;
  }

  const routes = getEnabledMissevanFallbackRoutes();
  const fallbackRoutes = [];
  for (const route of routes) {
    const routeInCooldown = isMissevanFallbackRouteInCooldown(route);
    fallbackRoutes.push({
      key: route.key,
      enabled: true,
      state: getFallbackCooldownState(route.key),
    });
    if (!routeInCooldown) {
      break;
    }
  }
  const selection = selectMissevanRequestRoute({
    directState: getDirectCooldownState(),
    fallbackRoutes,
  });
  return selection.type === "blocked" ? selection.cooldownUntil : 0;
}

function shouldBlockMissevanAccessForCooldown() {
  return getMissevanAccessDeniedCooldownUntil() > Date.now();
}

function getForcedMissevanFallbackRoute() {
  const forceMode = MISSEVAN_FORCE_FALLBACK;
  const route = forceMode === "1"
    ? MISSEVAN_FALLBACK_ROUTES.find((candidate) => candidate.key === "primary")
    : forceMode === "2"
      ? MISSEVAN_FALLBACK_ROUTES.find((candidate) => candidate.key === "secondary")
      : null;

  return route && isMissevanFallbackRouteEnabled(route) ? route : null;
}

export function buildMissevanFallbackUrl(url, fallbackBaseUrl = MISSEVAN_FALLBACK_BASE_URL) {
  const targetUrl = typeof url === "string" ? new URL(url) : url;
  const normalizedBaseUrl = normalizeMissevanFallbackBaseUrl(fallbackBaseUrl);
  const fallbackUrl = new URL(normalizedBaseUrl);
  const basePath = fallbackUrl.pathname.replace(/\/+$/, "");
  const targetPath = String(targetUrl.pathname || "").replace(/^\/+/, "");

  fallbackUrl.pathname = `${basePath}/${targetPath}`.replace(/\/{2,}/g, "/");
  fallbackUrl.search = targetUrl.search;
  return fallbackUrl.toString();
}

function buildMissevanFallbackFetchOptions(route, options = {}, signal = undefined) {
  return {
    headers: {
      ...buildMissevanFetchHeaders(options.headers),
      "x-proxy-token": route.proxyToken,
    },
    signal,
  };
}

function createMissevanFallbackError(message, status = "") {
  const error = new Error(message);
  error.missevanFallback = true;
  error.status = status;
  return error;
}

function isMissevanFallbackError(error) {
  return error?.missevanFallback === true;
}

async function fetchMissevanViaFallbackRoute(url, route, options = {}, details = {}) {
  if (!isMissevanFallbackRouteEnabled(route)) {
    throw createMissevanFallbackError("Missevan fallback is not configured");
  }

  if (isMissevanFallbackRouteInCooldown(route)) {
    writeMissevanRequestUsageLog(url, {
      attempt: details.attempt,
      status: "cooldown",
      success: false,
      accessDenied: true,
      cooldownBlocked: true,
      fallbackUsed: true,
      fallbackRoute: route.fallbackRoute,
      fallbackReason: details.reason,
    });
    throw createCooldownError(getNearestMissevanCooldownUntil() - Date.now());
  }

  const timeout = createTimeoutSignal(
    options.fallbackTimeoutMs ?? route.timeoutMs,
    options.signal
  );
  const requestStartedAt = Date.now();
  let responseStatus = "";

  try {
    const response = await fetch(
      buildMissevanFallbackUrl(url, route.baseUrl),
      buildMissevanFallbackFetchOptions(route, options, timeout.signal)
    );
    responseStatus = response.status;

    if (!response.ok) {
      if (response.status === 418) {
        markMissevanFallbackRouteCooldown(route);
      }
      writeMissevanRequestUsageLog(url, {
        attempt: details.attempt,
        status: response.status,
        durationMs: Date.now() - requestStartedAt,
        success: false,
        accessDenied: response.status === 418,
        fallbackUsed: true,
        fallbackRoute: route.fallbackRoute,
        fallbackReason: details.reason,
      });
      throw createMissevanFallbackError(`HTTP ${response.status}`, response.status);
    }

    const payload = details.responseType === "text"
      ? await response.text()
      : await response.json();

    writeMissevanRequestUsageLog(url, {
      attempt: details.attempt,
      status: response.status,
      durationMs: Date.now() - requestStartedAt,
      success: true,
      accessDenied: false,
      fallbackUsed: true,
      fallbackRoute: route.fallbackRoute,
      fallbackReason: details.reason,
    });

    return payload;
  } catch (error) {
    const failureStatus = responseStatus || (error?.name === "AbortError" ? "timeout" : "error");
    if (!isMissevanFallbackError(error)) {
      writeMissevanRequestUsageLog(url, {
        attempt: details.attempt,
        status: failureStatus,
        durationMs: Date.now() - requestStartedAt,
        success: false,
        accessDenied: false,
        fallbackUsed: true,
        fallbackRoute: route.fallbackRoute,
        fallbackReason: details.reason,
      });
    }
    throw isMissevanFallbackError(error)
      ? error
      : createMissevanFallbackError(error?.message || "Missevan fallback failed", failureStatus);
  } finally {
    timeout.cleanup();
  }
}

function fetchMissevanJsonViaFallbackRoute(url, route, options = {}, details = {}) {
  return fetchMissevanViaFallbackRoute(url, route, options, {
    ...details,
    responseType: "json",
  });
}

function fetchMissevanTextViaFallbackRoute(url, route, options = {}, details = {}) {
  return fetchMissevanViaFallbackRoute(url, route, options, {
    ...details,
    responseType: "text",
  });
}

async function fetchMissevanWithFallbackChain(url, options = {}, details = {}) {
  const routes = getEnabledMissevanFallbackRoutes();
  if (!routes.length) {
    throw createMissevanFallbackError("Missevan fallback is not configured");
  }

  let lastError;
  for (let index = 0; index < routes.length; index += 1) {
    const route = routes[index];
    try {
      return await fetchMissevanViaFallbackRoute(url, route, options, {
        ...details,
        reason: index === 0 ? details.reason : "primary_failed",
      });
    } catch (error) {
      lastError = error;
    }
  }

  const accessDeniedCooldownUntil = getMissevanAccessDeniedCooldownUntil();
  if (accessDeniedCooldownUntil > Date.now()) {
    throw createCooldownError(accessDeniedCooldownUntil - Date.now());
  }

  throw lastError;
}

function fetchMissevanJsonWithFallbackChain(url, options = {}, details = {}) {
  return fetchMissevanWithFallbackChain(url, options, {
    ...details,
    responseType: "json",
  });
}

function fetchMissevanTextWithFallbackChain(url, options = {}, details = {}) {
  return fetchMissevanWithFallbackChain(url, options, {
    ...details,
    responseType: "text",
  });
}

export function buildFetchOptions(url, options = {}) {
  const targetUrl = typeof url === "string" ? new URL(url) : url;
  const fetchOptions = {
    headers: options.missevan
      ? buildMissevanFetchHeaders(options.headers)
      : options.headers,
    signal: options.signal,
    agent: options.agent,
    redirect: options.redirect,
  };

  if (!fetchOptions.agent && targetUrl.hostname === MANBO_API_HOST) {
    fetchOptions.agent = manboHttpsAgent;
  }

  return fetchOptions;
}

function getMissevanRequestLogEndpoint(url) {
  try {
    const targetUrl = typeof url === "string" ? new URL(url) : url;
    return String(targetUrl.pathname || "")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "") || "root";
  } catch (_error) {
    return "unknown";
  }
}

function writeMissevanRequestUsageLog(url, details = {}) {
  void writeUsageLog({
    platform: "missevan",
    action: "missevan_request",
    endpoint: getMissevanRequestLogEndpoint(url),
    attempt: Math.max(0, Number(details.attempt ?? 0) || 0),
    status: details.status ?? "",
    durationMs: Math.max(0, Math.round(Number(details.durationMs ?? 0) || 0)),
    success: Boolean(details.success),
    accessDenied: Boolean(details.accessDenied),
    cooldownBlocked: Boolean(details.cooldownBlocked),
    fallbackUsed: Boolean(details.fallbackUsed),
    fallbackRoute: String(details.fallbackRoute || ""),
    fallbackReason: String(details.fallbackReason || ""),
  });
}

function ensureMissevanFetchOptions(options = {}) {
  if (!options.missevan || options.beforeAttempt) {
    return options;
  }
  return {
    ...options,
    beforeAttempt: () => waitForMissevanRequestSlot(options.signal),
  };
}

async function fetchJsonWithRetry(url, retries = 2, delayMs = 250, options = {}) {
  options = ensureMissevanFetchOptions(options);
  const forcedFallbackRoute = options.missevan ? getForcedMissevanFallbackRoute() : null;
  if (forcedFallbackRoute) {
    return fetchMissevanJsonViaFallbackRoute(url, forcedFallbackRoute, options, {
      attempt: 0,
      reason: "forced",
    });
  }

  if (options.missevan && isInAccessDeniedCooldown()) {
    if (hasEnabledMissevanFallbackRoutes()) {
      return fetchMissevanJsonWithFallbackChain(url, options, {
        attempt: 0,
        reason: "cooldown",
      });
    }

    writeMissevanRequestUsageLog(url, {
      attempt: 0,
      status: "cooldown",
      success: false,
      accessDenied: true,
      cooldownBlocked: true,
    });
    throw createCooldownError();
  }

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let cleanup = () => {};
    let timeoutState = null;
    let requestStartedAt = 0;
    let responseStatus = "";
    let requestLogged = false;

    try {
      await options.beforeAttempt?.();
      if (options.missevan && isInAccessDeniedCooldown()) {
        if (hasEnabledMissevanFallbackRoutes()) {
          return fetchMissevanJsonWithFallbackChain(url, options, {
            attempt: attempt + 1,
            reason: "cooldown",
          });
        }

        writeMissevanRequestUsageLog(url, {
          attempt: attempt + 1,
          status: "cooldown",
          success: false,
          accessDenied: true,
          cooldownBlocked: true,
        });
        throw createCooldownError();
      }

      timeoutState = createTimeoutSignal(options.timeoutMs, options.signal);
      const signal = timeoutState.signal;
      cleanup = timeoutState.cleanup;
      requestStartedAt = Date.now();
      const response = await fetch(
        url,
        buildFetchOptions(url, {
          ...options,
          signal,
        })
      );
      responseStatus = response.status;

      if (!response.ok) {
        if (options.missevan) {
          writeMissevanRequestUsageLog(url, {
            attempt: attempt + 1,
            status: response.status,
            durationMs: Date.now() - requestStartedAt,
            success: false,
            accessDenied: response.status === 418,
          });
          requestLogged = true;
        }
        if (options.missevan && response.status === 418 && hasEnabledMissevanFallbackRoutes()) {
          markAccessDeniedCooldown();
          return fetchMissevanJsonWithFallbackChain(url, options, {
            attempt: attempt + 1,
            reason: "direct_418",
          });
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      if (options.missevan) {
        writeMissevanRequestUsageLog(url, {
          attempt: attempt + 1,
          status: response.status,
          durationMs: Date.now() - requestStartedAt,
          success: true,
          accessDenied: false,
        });
        requestLogged = true;
        markSuccessfulMissevanRequest();
      }
      return data;
    } catch (error) {
      if (timeoutState?.timedOut) {
        error.requestTimedOut = true;
      }
      if (isCooldownError(error)) {
        throw error;
      }

      if (isMissevanFallbackError(error)) {
        throw error;
      }

      if (options.missevan && isAccessDeniedError(error)) {
        markAccessDeniedCooldown();
        if (!requestLogged) {
          writeMissevanRequestUsageLog(url, {
            attempt: attempt + 1,
            status: responseStatus || "error",
            durationMs: requestStartedAt ? Date.now() - requestStartedAt : 0,
            success: false,
            accessDenied: true,
          });
        }
        throw error;
      }

      if (options.missevan && !requestLogged) {
        writeMissevanRequestUsageLog(url, {
          attempt: attempt + 1,
          status: responseStatus || (options.signal?.aborted ? "cancelled" : timeoutState?.timedOut ? "timeout" : "error"),
          durationMs: requestStartedAt ? Date.now() - requestStartedAt : 0,
          success: false,
          accessDenied: false,
        });
      }

      lastError = error;
      if (options.signal?.aborted) {
        throw error;
      }
      if (attempt < retries) {
        await sleep(delayMs * (attempt + 1), options.signal);
      }
    } finally {
      cleanup();
    }
  }

  throw lastError;
}

async function fetchTextWithRetry(url, retries = 2, delayMs = 250, options = {}) {
  options = ensureMissevanFetchOptions(options);
  const forcedFallbackRoute = options.missevan ? getForcedMissevanFallbackRoute() : null;
  if (forcedFallbackRoute) {
    return fetchMissevanTextViaFallbackRoute(url, forcedFallbackRoute, options, {
      attempt: 0,
      reason: "forced",
    });
  }

  if (options.missevan && isInAccessDeniedCooldown()) {
    if (hasEnabledMissevanFallbackRoutes()) {
      return fetchMissevanTextWithFallbackChain(url, options, {
        attempt: 0,
        reason: "cooldown",
      });
    }

    writeMissevanRequestUsageLog(url, {
      attempt: 0,
      status: "cooldown",
      success: false,
      accessDenied: true,
      cooldownBlocked: true,
    });
    throw createCooldownError();
  }

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let cleanup = () => {};
    let timeoutState = null;
    let requestStartedAt = 0;
    let responseStatus = "";
    let requestLogged = false;

    try {
      await options.beforeAttempt?.();
      if (options.missevan && isInAccessDeniedCooldown()) {
        if (hasEnabledMissevanFallbackRoutes()) {
          return fetchMissevanTextWithFallbackChain(url, options, {
            attempt: attempt + 1,
            reason: "cooldown",
          });
        }

        writeMissevanRequestUsageLog(url, {
          attempt: attempt + 1,
          status: "cooldown",
          success: false,
          accessDenied: true,
          cooldownBlocked: true,
        });
        throw createCooldownError();
      }

      timeoutState = createTimeoutSignal(options.timeoutMs, options.signal);
      const signal = timeoutState.signal;
      cleanup = timeoutState.cleanup;

      requestStartedAt = Date.now();
      const response = await fetch(
        url,
        buildFetchOptions(url, {
          ...options,
          signal,
        })
      );
      responseStatus = response.status;

      if (!response.ok) {
        if (options.missevan) {
          writeMissevanRequestUsageLog(url, {
            attempt: attempt + 1,
            status: response.status,
            durationMs: Date.now() - requestStartedAt,
            success: false,
            accessDenied: response.status === 418,
          });
          requestLogged = true;
        }
        if (options.missevan && response.status === 418 && hasEnabledMissevanFallbackRoutes()) {
          markAccessDeniedCooldown();
          return fetchMissevanTextWithFallbackChain(url, options, {
            attempt: attempt + 1,
            reason: "direct_418",
          });
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const text = await response.text();
      if (options.missevan) {
        writeMissevanRequestUsageLog(url, {
          attempt: attempt + 1,
          status: response.status,
          durationMs: Date.now() - requestStartedAt,
          success: true,
          accessDenied: false,
        });
        requestLogged = true;
        markSuccessfulMissevanRequest();
      }
      return text;
    } catch (error) {
      if (timeoutState?.timedOut) {
        error.requestTimedOut = true;
      }
      if (isCooldownError(error)) {
        throw error;
      }

      if (isMissevanFallbackError(error)) {
        throw error;
      }

      if (options.missevan && isAccessDeniedError(error)) {
        markAccessDeniedCooldown();
        if (!requestLogged) {
          writeMissevanRequestUsageLog(url, {
            attempt: attempt + 1,
            status: responseStatus || "error",
            durationMs: requestStartedAt ? Date.now() - requestStartedAt : 0,
            success: false,
            accessDenied: true,
          });
        }
        throw error;
      }

      if (options.missevan && !requestLogged) {
        writeMissevanRequestUsageLog(url, {
          attempt: attempt + 1,
          status: responseStatus || (options.signal?.aborted ? "cancelled" : timeoutState?.timedOut ? "timeout" : "error"),
          durationMs: requestStartedAt ? Date.now() - requestStartedAt : 0,
          success: false,
          accessDenied: false,
        });
      }

      lastError = error;
      if (options.signal?.aborted) {
        throw error;
      }
      if (attempt < retries) {
        await sleep(delayMs * (attempt + 1), options.signal);
      }
    } finally {
      cleanup();
    }
  }

  throw lastError;
}

function formatImageProxyError(error) {
  return [
    error?.name ? `name=${error.name}` : "",
    error?.type ? `type=${error.type}` : "",
    error?.code ? `code=${error.code}` : "",
    error?.status ? `status=${error.status}` : "",
    error?.message ? `message=${error.message}` : "",
  ].filter(Boolean).join(" ");
}

async function fetchImageBufferWithRetry(targetUrl) {
  let lastError;
  let attempts = 0;

  for (let attempt = 0; attempt <= IMAGE_PROXY_RETRIES; attempt += 1) {
    attempts = attempt + 1;
    const { signal, cleanup } = createTimeoutSignal(IMAGE_PROXY_TIMEOUT_MS);
    let response;

    try {
      let currentUrl = validateImageProxyUrl(targetUrl, isAllowedImageHost);
      for (let redirectCount = 0; redirectCount <= IMAGE_PROXY_MAX_REDIRECTS; redirectCount += 1) {
        response = await fetch(
          currentUrl.toString(),
          buildFetchOptions(currentUrl, {
            signal,
            redirect: "manual",
          })
        );
        if (![301, 302, 303, 307, 308].includes(response.status)) {
          break;
        }
        response.body?.destroy();
        if (redirectCount >= IMAGE_PROXY_MAX_REDIRECTS) {
          throw new ImageProxyPolicyError("Image proxy redirect limit exceeded", {
            status: 400,
            code: "INVALID_IMAGE_REDIRECT",
          });
        }
        const location = response.headers.get("location");
        if (!location) {
          throw new ImageProxyPolicyError("Image proxy redirect is missing a location", {
            status: 502,
            code: "INVALID_IMAGE_REDIRECT",
          });
        }
        currentUrl = validateImageProxyUrl(new URL(location, currentUrl), isAllowedImageHost);
      }

      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }

      try {
        assertImageContentLength(
          response.headers.get("content-length"),
          IMAGE_PROXY_MAX_BYTES
        );
      } catch (error) {
        response.body?.destroy();
        throw error;
      }
      const buffer = await readImageBodyWithLimit(
        response.body,
        IMAGE_PROXY_MAX_BYTES
      );
      const contentType = detectImageContentType(buffer);
      if (!contentType) {
        throw new ImageProxyPolicyError("Image response type is not supported", {
          status: 415,
          code: "IMAGE_TYPE_UNSUPPORTED",
        });
      }
      return {
        attempts,
        buffer,
        contentType,
      };
    } catch (error) {
      lastError = error;
      if (
        error?.retryable === false ||
        (response && response.status >= 400 && response.status < 500)
      ) {
        break;
      }
      if (attempt < IMAGE_PROXY_RETRIES) {
        await sleep(IMAGE_PROXY_RETRY_DELAY_MS * (attempt + 1));
      }
    } finally {
      cleanup();
    }
  }

  const error = lastError || new Error("Image proxy request failed");
  error.attempts = attempts;
  throw error;
}

export function normalizeMissevanDramaInfo(info) {
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
      updated_at: normalizeTextValue(
        drama.updated_at ?? drama.updatedAt ?? drama.lastupdate_time ?? drama.lastUpdateTime
      ),
      platform: "missevan",
      pay_type: normalizeMissevanPayType(drama.pay_type ?? drama.payType),
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

async function fetchSoundSummary(soundId, options = {}) {
  const cached = getCachedValue(
    soundSummaryCache,
    soundId,
    SOUND_SUMMARY_CACHE_TTL_MS
  );
  if (cached) {
    return {
      ...cached,
      cached: true,
    };
  }

  const data = await fetchJsonWithRetry(
    `https://www.missevan.com/sound/getsound?soundid=${soundId}`,
    2,
    250,
    { missevan: true, signal: options.signal }
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
    cached: false,
  };

  setCachedValue(soundSummaryCache, soundId, summary);
  return summary;
}

function writeWatchCountUsageLog({
  episode = {},
  summary = null,
  calculationMode = "selected_sum",
  success = false,
  error = null,
} = {}) {
  const soundid = String(episode?.sound_id ?? summary?.sound_id ?? "").trim();
  const title = String(episode?.episode_title ?? episode?.name ?? "").trim();
  void writeUsageLog({
    platform: "missevan",
    action: "watch_count",
    soundid: soundid,
    title: title,
    dramaId: String(episode?.drama_id ?? "").trim(),
    dramaTitle: String(episode?.drama_title ?? "").trim(),
    episodeTitle: title,
    viewCount: Number(summary?.view_count ?? 0),
    calculationMode,
    success: Boolean(success),
    accessDenied: Boolean(summary?.accessDenied || isMissevanAccessDenied(error)),
    cached: Boolean(summary?.cached),
    errorMessage: success ? "" : String(error?.message ?? summary?.error ?? "").slice(0, 200),
  });
}

async function fetchDramaInfo(dramaId, soundId = null, options = {}) {
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
    { missevan: true, signal: options.signal }
  );

  if (data.success && data.info) {
    let normalized = normalizeMissevanDramaInfo(data.info);
    const resolvedSoundId = Number(
      soundId ?? normalized?.episodes?.episode?.[0]?.sound_id
    );

    const needsSubscriptionBackfill = Number(normalized?.drama?.subscription_num ?? 0) <= 0;
    const needsUpdatedAtBackfill = !normalizeTextValue(normalized?.drama?.updated_at);

    if (!soundId && normalized && resolvedSoundId > 0 && (needsSubscriptionBackfill || needsUpdatedAtBackfill)) {
      try {
        const bySoundData = await fetchJsonWithRetry(
          `https://www.missevan.com/dramaapi/getdramabysound?sound_id=${resolvedSoundId}`,
          2,
          250,
          { missevan: true, signal: options.signal }
        );
        if (bySoundData?.success && bySoundData?.info) {
          const bySoundNormalized = normalizeMissevanDramaInfo(bySoundData.info);
          const bySoundSubscriptionNum = Number(bySoundNormalized?.drama?.subscription_num ?? 0);
          const bySoundUpdatedAt = normalizeTextValue(bySoundNormalized?.drama?.updated_at);
          if (bySoundSubscriptionNum > 0 || bySoundUpdatedAt) {
            normalized = {
              ...normalized,
              drama: {
                ...normalized.drama,
                ...(bySoundSubscriptionNum > 0 ? { subscription_num: bySoundSubscriptionNum } : {}),
                ...(bySoundUpdatedAt ? { updated_at: bySoundUpdatedAt } : {}),
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

async function fetchRewardSummary(dramaId, options = {}) {
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
    { missevan: true, signal: options.signal }
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

async function fetchRewardDetailMeta(dramaId, options = {}) {
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
    { missevan: true, signal: options.signal }
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

async function fetchManboLegacyDramaPayload(dramaId, options = {}) {
  const normalizedDramaId = String(dramaId ?? "").trim();
  if (!isNumericId(normalizedDramaId)) {
    return null;
  }

  const data = await fetchJsonWithRetry(
    `${MANBO_API_BASE}/dramaDetail?dramaId=${normalizedDramaId}`,
    2,
    250,
    { signal: options.signal }
  );

  if (Number(data?.code) !== 200 || !data?.data) {
    return null;
  }

  return data.data;
}

async function fetchManboV530DramaPayload(dramaId, options = {}) {
  const normalizedDramaId = String(dramaId ?? "").trim();
  if (!isNumericId(normalizedDramaId)) {
    return null;
  }

  try {
    const v530Data = await fetchJsonWithRetry(
      `${MANBO_API_V530_BASE}/detail?radioDramaId=${normalizedDramaId}`,
      2,
      250,
      { signal: options.signal }
    );
    if (Number(v530Data?.h?.code) === 200 && v530Data?.b) {
      return v530Data.b;
    }
  } catch (_v530Err) {
    return null;
  }

  return null;
}

async function fetchDanmakuSummary(
  soundId,
  dramaTitle,
  episodeTitle = "",
  rawSource = "",
  options = {}
) {
  const source = normalizeStatsTaskSource(rawSource);
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
      ...(source ? { source } : {}),
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
      {
        missevan: true,
        beforeAttempt: () => waitForMissevanRequestSlot(options.signal),
        signal: options.signal,
      }
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
      ...(source ? { source } : {}),
    });

    return {
      ...cachedResult,
      drama_title: dramaTitle,
      episode_title: episodeTitle,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.signal?.aborted) {
      console.info(`Cancelled Missevan danmaku sound_id=${soundId}`);
      void writeUsageLog({
        platform: "missevan",
        action: "danmaku_summary",
        status: "cancelled",
        soundId: Number(soundId),
        dramaTitle,
        episodeTitle,
        success: false,
        cancelled: true,
        cached: false,
        ...(source ? { source } : {}),
      });
      return {
        success: false,
        cancelled: true,
        sound_id: Number(soundId),
        drama_title: dramaTitle,
        episode_title: episodeTitle,
        danmaku: 0,
        users: [],
        accessDenied: false,
        error: message,
      };
    }
    if (error?.requestTimedOut) {
      console.warn(`Timed out fetching Missevan danmaku sound_id=${soundId}: ${message}`);
    } else {
      console.error(`Failed to fetch Missevan danmaku sound_id=${soundId}: ${message}`);
    }
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
      ...(source ? { source } : {}),
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

export function normalizeManboDramaInfo(raw) {
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
      updated_at: normalizeTextValue(
        pickFirstDefined(raw.updated_at, raw.updatedAt, raw.updateTime, raw.update_time)
      ),
      pay_type: Number(raw.payType ?? raw.setPayType ?? 0),
      member_price: memberPrice,
      vip_free: vipFree,
      is_member: isMember,
      author: normalizeTextValue(
        raw.author ??
          raw.authorName ??
          raw.originalAuthor ??
          raw.originalAuthorName
      ),
      main_cvs: splitManboApiCvNames(raw.cvNameStr),
      catalogName: normalizeTextValue(
        raw.catalogName ?? raw.radioDramaCategoryResp?.name
      ),
      genre: normalizeTextValue(raw.genre),
      seriesTitle: normalizeTextValue(raw.seriesTitle),
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
  const revenueType = getManboRevenueType(info, isManboMemberDramaInfo);

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
    metrics_status: "pending",
    author: normalizeTextValue(drama.author),
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

async function fetchManboDramaDetail(dramaId, options = {}) {
  const normalizedDramaId = String(dramaId ?? "").trim();
  const cached = getCachedValue(
    manboDramaCache,
    normalizedDramaId,
    MANBO_DRAMA_CACHE_TTL_MS
  );
  if (cached) {
    return cached;
  }

  const payload = await fetchManboDramaPayload(normalizedDramaId, options);
  if (!payload) {
    return null;
  }

  const normalized = normalizeManboDramaInfo(payload);
  if (normalized?.drama?.id) {
    setCachedValue(manboDramaCache, normalized.drama.id, normalized);
  }

  return normalized;
}

async function fetchManboDramaPayload(dramaId, options = {}) {
  const normalizedDramaId = String(dramaId ?? "").trim();
  if (!isNumericId(normalizedDramaId)) {
    return null;
  }

  let legacyPayload = null;
  try {
    legacyPayload = await fetchManboLegacyDramaPayload(normalizedDramaId, options);
  } catch (legacyErr) {
    const v530Fallback = await fetchManboV530DramaPayload(normalizedDramaId, options);
    if (v530Fallback) {
      return v530Fallback;
    }
    throw legacyErr;
  }

  if (!legacyPayload) {
    return await fetchManboV530DramaPayload(normalizedDramaId, options);
  }

  if (!shouldFetchManboMemberSupplement(legacyPayload)) {
    return legacyPayload;
  }

  const v530Payload = await fetchManboV530DramaPayload(normalizedDramaId, options);
  return mergeManboDramaMemberSupplement(legacyPayload, v530Payload);
}

async function fetchManboSetDetail(setId, options = {}) {
  const normalizedSetId = String(setId ?? "").trim();
  if (!isNumericId(normalizedSetId)) {
    return null;
  }

  const cached = getCachedValue(manboSetCache, normalizedSetId, MANBO_SET_CACHE_TTL_MS);
  if (cached) {
    return cached;
  }

  const data = await fetchJsonWithRetry(
    `${MANBO_API_BASE}/dramaSetDetail?dramaSetId=${normalizedSetId}`,
    2,
    250,
    { signal: options.signal }
  );
  if (Number(data?.code) !== 200 || !data?.data) {
    return null;
  }

  setCachedValue(manboSetCache, normalizedSetId, data.data);
  return data.data;
}

async function fetchManboV530SetDetail(setId, options = {}) {
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
      `${MANBO_API_V530_BASE}/set/detail/new?radioDramaSetId=${normalizedSetId}`,
      2,
      250,
      { signal: options.signal }
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

async function fetchManboStatsSetDetail(setId, options = {}) {
  const v530Detail = await fetchManboV530SetDetail(setId, options);
  if (v530Detail) {
    return v530Detail;
  }
  return fetchManboSetDetail(setId, options);
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
    return (
      /(^|\.)kilamanbo\.(com|world)$/i.test(url.hostname) ||
      /(^|\.)kilaaudio\.com$/i.test(url.hostname)
    );
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
        /(^|\.)kilamanbo\.(com|world)$/i.test(url.hostname) ||
        /(^|\.)kilaaudio\.com$/i.test(url.hostname)
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

    if (
      !/(^|\.)kilamanbo\.(com|world)$/i.test(url.hostname) &&
      !/(^|\.)kilaaudio\.com$/i.test(url.hostname)
    ) {
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

async function fetchManboDanmakuSummary(
  setId,
  dramaTitle,
  episodeTitle = "",
  rawSource = "",
  options = {}
) {
  const source = normalizeStatsTaskSource(rawSource);
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
      ...(source ? { source } : {}),
      ...(cached.error ? { error: cached.error } : {}),
    });
    return {
      ...cached,
      drama_title: dramaTitle,
      episode_title: resolvedEpisodeTitle,
    };
  }

  const result = await manboDanmakuRequests.run(
    String(setId),
    options.signal,
    async (sharedSignal) => {
      const startedAt = Date.now();

      try {
        const pageSize = 200;
        const users = new Set();
        const pageFetchOptions = {
          timeoutMs: MANBO_FETCH_TIMEOUT_MS,
          signal: sharedSignal,
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
          ...(source ? { source } : {}),
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
        if (sharedSignal.aborted) {
          console.info(`Cancelled Manbo danmaku set_id=${setId}`);
          void writeUsageLog({
            platform: "manbo",
            action: "danmaku_summary",
            status: "cancelled",
            soundId: String(setId),
            dramaTitle,
            episodeTitle: resolvedEpisodeTitle,
            success: false,
            cancelled: true,
            cached: false,
            ...(source ? { source } : {}),
            pageConcurrency: MANBO_DANMAKU_PAGE_CONCURRENCY,
            durationMs: Date.now() - startedAt,
          });
          return {
            success: false,
            cancelled: true,
            sound_id: String(setId),
            drama_title: dramaTitle,
            episode_title: resolvedEpisodeTitle,
            danmaku: 0,
            users: [],
            accessDenied: false,
            error: message,
          };
        }
        if (error?.requestTimedOut) {
          console.warn(`Timed out fetching Manbo danmaku set_id=${setId}: ${message}`);
        } else {
          console.error(`Failed to fetch Manbo danmaku set_id=${setId}: ${message}`);
        }
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
          ...(source ? { source } : {}),
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
      }
    }
  );
  return {
    ...result,
    drama_title: dramaTitle,
    episode_title: resolvedEpisodeTitle || String(result?.episode_title ?? "").trim(),
  };
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

function normalizePlayCountEpisode(episode = {}, fallback = {}) {
  const dramaId = String(episode?.drama_id ?? fallback.drama_id ?? "").trim();
  const soundId = String(episode?.sound_id ?? "").trim();
  const dramaTitle = String(episode?.drama_title ?? fallback.drama_title ?? "").trim();
  const episodeTitle = String(episode?.episode_title ?? episode?.name ?? "").trim();
  return {
    drama_id: dramaId,
    sound_id: soundId,
    drama_title: dramaTitle,
    episode_title: episodeTitle,
    duration: Number(episode?.duration ?? 0),
    selected: Boolean(episode?.selected),
  };
}

function getPlayCountEpisodeDramaKey(episode = {}) {
  const dramaId = String(episode?.drama_id ?? "").trim();
  if (dramaId) {
    return `id:${dramaId}`;
  }
  return `title:${String(episode?.drama_title ?? "Unknown").trim() || "Unknown"}`;
}

function normalizePlayCountTotal(value) {
  if (value == null || String(value).trim() === "") {
    return null;
  }
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : null;
}

export function normalizePlayCountDramas(rawDramas = []) {
  return (Array.isArray(rawDramas) ? rawDramas : [])
    .map((drama) => {
      const dramaId = String(drama?.drama_id ?? drama?.dramaId ?? "").trim();
      const dramaTitle = String(drama?.drama_title ?? drama?.title ?? "").trim() || "Unknown";
      const episodes = (Array.isArray(drama?.episodes) ? drama.episodes : [])
        .map((episode) => normalizePlayCountEpisode(episode, {
          drama_id: dramaId,
          drama_title: dramaTitle,
        }))
        .filter((episode) => episode.sound_id);

      if (!episodes.length) {
        return null;
      }

      const rawTotalEpisodeCount = Number(drama?.total_episode_count ?? drama?.totalEpisodeCount);
      const totalEpisodeCount = Number.isFinite(rawTotalEpisodeCount) && rawTotalEpisodeCount > 0
        ? Math.max(episodes.length, Math.trunc(rawTotalEpisodeCount))
        : episodes.length;

      return {
        drama_id: dramaId,
        drama_title: dramaTitle,
        total_view_count: normalizePlayCountTotal(drama?.total_view_count ?? drama?.totalViewCount),
        total_episode_count: totalEpisodeCount,
        episodes,
      };
    })
    .filter(Boolean);
}

function buildFallbackPlayCountWorkPlan(selectedEpisodes = []) {
  const dramaMap = new Map();
  selectedEpisodes.forEach((episode) => {
    const normalizedEpisode = normalizePlayCountEpisode(episode);
    if (!normalizedEpisode.sound_id) {
      return;
    }
    const key = getPlayCountEpisodeDramaKey(normalizedEpisode);
    if (!dramaMap.has(key)) {
      dramaMap.set(key, {
        dramaId: normalizedEpisode.drama_id,
        title: normalizedEpisode.drama_title || "Unknown",
        totalEpisodeCount: 0,
        selectedEpisodeCount: 0,
        requestEpisodeCount: 0,
        calculationMode: "selected_sum",
        totalViewCount: null,
        requestEpisodes: [],
        playCountTotal: 0,
        playCountFailed: false,
      });
    }
    const drama = dramaMap.get(key);
    drama.selectedEpisodeCount += 1;
    drama.totalEpisodeCount = Math.max(drama.totalEpisodeCount, drama.selectedEpisodeCount);
    drama.requestEpisodes.push(normalizedEpisode);
    drama.requestEpisodeCount = drama.requestEpisodes.length;
  });

  const dramas = Array.from(dramaMap.values());
  return {
    dramas,
    totalRequestCount: dramas.reduce((sum, drama) => sum + drama.requestEpisodeCount, 0),
  };
}

export function buildMissevanPlayCountWorkPlan({ selectedEpisodes = [], playCountDramas = [] } = {}) {
  const normalizedSelectedEpisodes = normalizeTaskEpisodes(selectedEpisodes);
  const normalizedPlayCountDramas = normalizePlayCountDramas(playCountDramas);
  if (!normalizedPlayCountDramas.length) {
    return buildFallbackPlayCountWorkPlan(normalizedSelectedEpisodes);
  }

  const selectedSoundIds = new Set(normalizedSelectedEpisodes.map((episode) => episode.sound_id));
  const coveredSoundIds = new Set();
  const dramas = [];

  normalizedPlayCountDramas.forEach((drama) => {
    const selected = drama.episodes.filter((episode) => selectedSoundIds.has(episode.sound_id));
    if (!selected.length) {
      return;
    }
    const unselected = drama.episodes.filter((episode) => !selectedSoundIds.has(episode.sound_id));
    selected.forEach((episode) => coveredSoundIds.add(episode.sound_id));

    const canSubtractUnselected = drama.total_view_count != null && unselected.length < selected.length;
    const requestEpisodes = canSubtractUnselected ? unselected : selected;
    dramas.push({
      dramaId: drama.drama_id,
      title: drama.drama_title || "Unknown",
      totalEpisodeCount: drama.total_episode_count,
      selectedEpisodeCount: selected.length,
      requestEpisodeCount: requestEpisodes.length,
      calculationMode: canSubtractUnselected ? "total_minus_unselected" : "selected_sum",
      totalViewCount: drama.total_view_count,
      requestEpisodes,
      playCountTotal: 0,
      playCountFailed: false,
    });
  });

  const uncoveredSelectedEpisodes = normalizedSelectedEpisodes
    .filter((episode) => !coveredSoundIds.has(episode.sound_id));
  const fallbackPlan = buildFallbackPlayCountWorkPlan(uncoveredSelectedEpisodes);
  const allDramas = [...dramas, ...fallbackPlan.dramas];

  return {
    dramas: allDramas,
    totalRequestCount: allDramas.reduce((sum, drama) => sum + drama.requestEpisodeCount, 0),
  };
}

export function resolveMissevanPlayCountDramaTotal(drama = {}, requestedPlayCountTotal = 0, failed = false) {
  if (failed || drama?.playCountFailed) {
    return {
      ...drama,
      playCountFailed: true,
      playCountTotal: Number(drama?.playCountTotal ?? 0) || 0,
    };
  }

  const requestedTotal = Number(requestedPlayCountTotal ?? 0) || 0;
  const playCountTotal = drama?.calculationMode === "total_minus_unselected"
    ? Math.max(0, Number(drama?.totalViewCount ?? 0) - requestedTotal)
    : requestedTotal;

  return {
    ...drama,
    playCountFailed: false,
    playCountTotal,
  };
}


registerStatsRoutes(app, {
  adminCacheRefreshToken: ADMIN_CACHE_REFRESH_TOKEN,
  buildRanksResponseMeta,
  buildRankTrendAvailabilityResponse,
  buildStatsTaskSnapshot,
  createStatsTaskFromRequest,
  executeAdminCacheRefresh,
  getCachedCvRankTrendResponse,
  getCachedOngoingResponse,
  getCachedRankTrendAggregateSnapshot,
  getCachedRankTrendResponse,
  getCachedRanksResponse,
  getRanksResponseCacheValidator,
  getStatsTaskSnapshotOr404,
  isNumericId,
  isRankTrendAggregateSnapshot,
  ongoingResponseSchemaVersion: ONGOING_RESPONSE_SCHEMA_VERSION,
  rankTrendsResponseSchemaVersion: RANK_TRENDS_RESPONSE_SCHEMA_VERSION,
  refreshMissevanCooldownState,
  statsTaskCreationLimiter,
  statsTaskEngine,
});

app.get("/image-proxy", imageProxyLimiter, async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({
      success: false,
      code: "INVALID_IMAGE_URL",
      message: "缺少图片地址。",
    });
  }

  let targetUrl;
  try {
    targetUrl = validateImageProxyUrl(url, isAllowedImageHost);
  } catch (error) {
    return res.status(error?.status || 400).json({
      success: false,
      code: error?.code || "INVALID_IMAGE_URL",
      message: "图片地址无效。",
    });
  }

  try {
    const { buffer, contentType } = await fetchImageBufferWithRetry(targetUrl);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.send(buffer);
  } catch (error) {
    const attempts = error?.attempts ?? 1;
    const summary = formatImageProxyError(error);
    console.warn(
      `Image proxy failed url=${targetUrl.toString()} attempts=${attempts} error=${summary}`
    );
    const isPolicyError = error instanceof ImageProxyPolicyError;
    const status = isPolicyError ? error.status : 502;
    const code = error?.code === "IMAGE_TOO_LARGE"
      ? "IMAGE_TOO_LARGE"
      : error?.code === "IMAGE_TYPE_UNSUPPORTED"
        ? "IMAGE_TYPE_UNSUPPORTED"
        : "IMAGE_PROXY_FAILED";
    const message = code === "IMAGE_TOO_LARGE"
      ? "图片大小超过 10 MiB 限制。"
      : code === "IMAGE_TYPE_UNSUPPORTED"
        ? "图片类型不受支持。"
        : "图片代理请求失败。";
    return res.status(status).json({
      success: false,
      code,
      message,
    });
  }
});

function createRequestAbortContext(req, res) {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted && !res.writableEnded) {
      controller.abort(new DOMException("Client disconnected", "AbortError"));
    }
  };
  req.once("aborted", abort);
  res.once("close", abort);
  return {
    signal: controller.signal,
    cleanup() {
      req.removeListener("aborted", abort);
      res.removeListener("close", abort);
    },
  };
}

function getSearchCardMetricsCacheState(platform, id, soundId = null) {
  if (platform === "missevan") {
    const infoKey = soundId ? `sound:${soundId}` : `drama:${id}`;
    return Boolean(
      getCachedValue(dramaCache, infoKey, DRAMA_CACHE_TTL_MS) &&
      getCachedValue(rewardDetailCache, id, REWARD_DETAIL_CACHE_TTL_MS)
    );
  }
  return Boolean(getCachedValue(manboDramaCache, String(id), MANBO_DRAMA_CACHE_TTL_MS));
}

const SEARCH_CARD_PATCH_FIELDS = [
  "cover",
  "name",
  "author",
  "main_cvs",
  "main_cv_text",
  "content_type_label",
  "payment_label",
  "sound_id",
  "vip",
  "price",
  "member_price",
  "is_member",
];

function pickSearchCardPatchFields(card = {}) {
  return Object.fromEntries(
    SEARCH_CARD_PATCH_FIELDS
      .filter((field) => Object.prototype.hasOwnProperty.call(card, field))
      .map((field) => [field, card[field]])
  );
}

export function buildMissevanSearchCardPatch(info) {
  const drama = info?.drama;
  if (!drama) {
    return {};
  }
  const mainCvs = getMissevanApiCvNames(info, 20);
  const soundId = Number(info?.episodes?.episode?.[0]?.sound_id ?? 0) || null;
  const card = {
    cover: normalizeTextValue(drama.cover),
    name: normalizeTextValue(drama.name),
    author: normalizeTextValue(drama.author),
    main_cvs: mainCvs,
    main_cv_text: buildMainCvText(mainCvs),
    content_type_label: getMissevanContentTypeLabel(drama),
    sound_id: soundId,
    vip: Number(drama.vip ?? 0),
    price: Number(drama.price ?? 0),
    member_price: Number(drama.member_price ?? 0),
    is_member: Boolean(drama.is_member),
  };
  card.payment_label = getMissevanPaymentLabel(card);
  return pickSearchCardPatchFields(card);
}

export function buildManboSearchCardPatch(info) {
  const card = normalizeManboCardFromDramaInfo(info);
  if (!card) {
    return {};
  }
  const mainCvs = normalizeStringArray(info?.drama?.main_cvs, 20);
  return pickSearchCardPatchFields({
    ...card,
    main_cvs: mainCvs,
    main_cv_text: buildMainCvText(mainCvs),
  });
}

async function fetchSearchCardMetrics(platform, id, soundId, signal) {
  const cached = getSearchCardMetricsCacheState(platform, id, soundId);
  if (platform === "missevan") {
    await refreshMissevanCooldownState();
    if (shouldBlockMissevanAccessForCooldown()) {
      throw createCooldownError();
    }
    const info = await fetchDramaInfo(id, soundId, { signal });
    if (!info?.drama) {
      throw new Error("Missevan drama metrics are unavailable");
    }
    let rewardNum = null;
    try {
      const reward = await fetchRewardDetailMeta(id, { signal });
      rewardNum = normalizeOptionalFiniteNumber(reward?.reward_num);
    } catch (error) {
      if (signal?.aborted || isMissevanAccessDenied(error)) {
        throw error;
      }
      console.warn(
        `Failed to fetch Missevan search reward metric drama_id=${id}: ${formatImageProxyError(error)}`
      );
    }
    return {
      cached,
      metrics: {
        view_count: Number(info.drama.view_count ?? 0),
        subscription_num: normalizeOptionalFiniteNumber(info.drama.subscription_num),
        reward_num: rewardNum,
      },
      cardPatch: buildMissevanSearchCardPatch(info),
    };
  }

  const info = await fetchManboDramaDetail(id, { signal });
  const card = normalizeManboCardFromDramaInfo(info);
  if (!card) {
    throw new Error("Manbo drama metrics are unavailable");
  }
  return {
    cached,
    metrics: {
      view_count: normalizeOptionalFiniteNumber(card.view_count),
      subscription_num: normalizeOptionalFiniteNumber(card.subscription_num),
      diamond_value: normalizeOptionalFiniteNumber(card.diamond_value),
      pay_count: normalizeOptionalFiniteNumber(card.pay_count),
      member_listen_count: normalizeOptionalFiniteNumber(card.member_listen_count),
    },
    cardPatch: buildManboSearchCardPatch(info),
  };
}

app.get("/unified-search", expensiveDataLimiter, async (req, res) => {
  const normalizedKeyword = normalizeKeyword(req.query.keyword);
  const offset = normalizeSearchOffset(req.query.offset);
  const limit = normalizeSearchLimit(req.query.limit, 5, 5);

  function buildUnifiedResponse(missevanResult, manboResult, usedApiFallback = false) {
    return {
      success: Boolean(missevanResult?.success || manboResult?.success),
      results: {
        missevan: missevanResult,
        manbo: manboResult,
      },
      meta: {
        keyword: normalizedKeyword,
        usedApiFallback,
      },
    };
  }

  if (!normalizedKeyword) {
    return res.json({
      success: false,
      message: "Missing keyword",
      results: {
        missevan: buildEmptyUnifiedPlatformSearchResult("", offset, limit),
        manbo: buildEmptyUnifiedPlatformSearchResult("", offset, limit),
      },
      meta: {
        keyword: "",
        usedApiFallback: false,
      },
    });
  }

  if (!isSearchKeywordLongEnough(normalizedKeyword)) {
    return res.json({
      success: false,
      results: {
        missevan: buildKeywordTooShortSearchResponse(normalizedKeyword, offset, limit),
        manbo: buildKeywordTooShortSearchResponse(normalizedKeyword, offset, limit, {
          hydratedCount: 0,
        }),
      },
      meta: {
        keyword: normalizedKeyword,
        usedApiFallback: false,
      },
    });
  }

  void writeUsageLog({
    platform: "unified",
    action: "search",
    keyword: normalizedKeyword,
  });

  try {
    await Promise.all([
      ensureInfoStoreReadyForSearch(missevanInfoStore),
      ensureInfoStoreReadyForSearch(manboInfoStore),
    ]);

    const [missevanLibrarySettled, manboLibrarySettled] = await Promise.allSettled([
      runMissevanLibraryUnifiedSearch(normalizedKeyword, offset, limit, "strict"),
      runManboLibraryUnifiedSearch(normalizedKeyword, offset, limit, "strict"),
    ]);
    let missevanLibraryResult = normalizeSettledUnifiedSearchResult("missevan",
      missevanLibrarySettled,
      buildEmptyUnifiedPlatformSearchResult(normalizedKeyword, offset, limit, "library_error"),
      "library"
    );
    let manboLibraryResult = normalizeSettledUnifiedSearchResult("manbo",
      manboLibrarySettled,
      buildEmptyUnifiedPlatformSearchResult(normalizedKeyword, offset, limit, "library_error", {
        hydratedCount: 0,
      }),
      "library"
    );
    const shouldRunCompatibilitySearch = !hasUnifiedSearchMatches(missevanLibraryResult) &&
      !hasUnifiedSearchMatches(manboLibraryResult);

    if (shouldRunCompatibilitySearch) {
      void writeUsageLog(buildCompatibilitySearchUsageLog("unified", normalizedKeyword));
      const [missevanCompatibleSettled, manboCompatibleSettled] = await Promise.allSettled([
        runMissevanLibraryUnifiedSearch(normalizedKeyword, offset, limit, "compatible"),
        runManboLibraryUnifiedSearch(normalizedKeyword, offset, limit, "compatible"),
      ]);
      missevanLibraryResult = normalizeSettledUnifiedSearchResult("missevan",
        missevanCompatibleSettled, missevanLibraryResult, "compatibility");
      manboLibraryResult = normalizeSettledUnifiedSearchResult("manbo",
        manboCompatibleSettled, manboLibraryResult, "compatibility");
    }

    const shouldRunApiFallback = !hasUnifiedSearchMatches(missevanLibraryResult) &&
      !hasUnifiedSearchMatches(manboLibraryResult);
    if (!shouldRunApiFallback) {
      return res.json(buildUnifiedResponse(missevanLibraryResult, manboLibraryResult, false));
    }
    const [missevanFinalSettled, manboFinalSettled] = await Promise.allSettled([
      runMissevanApiUnifiedSearch(normalizedKeyword, offset, limit),
      runManboApiUnifiedSearch(normalizedKeyword, offset, limit),
    ]);
    const missevanFinal = normalizeSettledUnifiedSearchResult("missevan",
      missevanFinalSettled, missevanLibraryResult, "api");
    const manboFinal = normalizeSettledUnifiedSearchResult("manbo",
      manboFinalSettled, manboLibraryResult, "api");
    return res.json(buildUnifiedResponse(missevanFinal, manboFinal, true));
  } catch (error) {
    console.error(`Failed to run unified search keyword=${normalizedKeyword}`, error);
    return res.status(500).json({
      success: false,
      results: {
        missevan: buildEmptyUnifiedPlatformSearchResult(normalizedKeyword, offset, limit),
        manbo: buildEmptyUnifiedPlatformSearchResult(normalizedKeyword, offset, limit),
      },
      meta: {
        keyword: normalizedKeyword,
        usedApiFallback: false,
      },
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.post("/search-card-metrics", searchCardMetricsLimiter, async (req, res) => {
  const platform = req.body?.platform === "manbo"
    ? "manbo"
    : req.body?.platform === "missevan"
      ? "missevan"
      : "";
  const rawId = String(req.body?.id ?? "").trim();
  const id = platform === "missevan" ? Number(rawId) : rawId;
  const soundId = platform === "missevan" ? Number(req.body?.soundId ?? 0) || null : null;
  if (!platform || !isNumericId(rawId)) {
    return res.status(400).json({
      success: false,
      code: "INVALID_METRICS_REQUEST",
      message: "动态指标请求无效。",
    });
  }
  if (activeSearchCardMetricRequests >= SEARCH_CARD_METRICS_MAX_ACTIVE) {
    res.setHeader("Retry-After", "3");
    return res.status(503).json({
      success: false,
      code: "METRICS_BUSY",
      message: "动态指标队列繁忙，请稍后重试。",
      retryAfterSeconds: 3,
    });
  }

  const requestAbort = createRequestAbortContext(req, res);
  activeSearchCardMetricRequests += 1;
  try {
    const result = await searchCardMetricRequests.run(
      `${platform}:${rawId}`,
      requestAbort.signal,
      async (sharedSignal) => {
        const timeout = createTimeoutSignal(SEARCH_CARD_METRICS_TIMEOUT_MS, sharedSignal);
        try {
          return await fetchSearchCardMetrics(platform, id, soundId, timeout.signal);
        } catch (error) {
          if (timeout.timedOut) {
            error.searchMetricsTimeout = true;
          }
          throw error;
        } finally {
          timeout.cleanup();
        }
      }
    );
    return res.json({
      success: true,
      id: platform === "missevan" ? Number(id) : String(id),
      cached: Boolean(result.cached),
      metrics: result.metrics,
      card_patch: result.cardPatch,
    });
  } catch (error) {
    if (requestAbort.signal.aborted) {
      return;
    }
    const timeout = error?.searchMetricsTimeout === true;
    const accessDenied = isCooldownError(error) || isAccessDeniedError(error);
    const code = timeout
      ? "METRICS_TIMEOUT"
      : accessDenied
        ? "ACCESS_DENIED"
        : "UPSTREAM_ERROR";
    const status = timeout ? 504 : accessDenied ? 503 : 502;
    return res.status(status).json({
      success: false,
      code,
      message: timeout
        ? "动态指标获取超时。"
        : accessDenied
          ? "动态指标暂时不可用。"
          : "动态指标获取失败。",
    });
  } finally {
    activeSearchCardMetricRequests = Math.max(0, activeSearchCardMetricRequests - 1);
    requestAbort.cleanup();
  }
});

app.get("/search", expensiveDataLimiter, async (req, res) => {
  if (!ensureMissevanEnabled(res)) {
    return;
  }
  const { keyword } = req.query;
  const normalizedKeyword = normalizeKeyword(keyword);
  const offset = normalizeSearchOffset(req.query.offset);
  const limit = normalizeSearchLimit(req.query.limit, 5, 5);
  const useApiFallback = shouldUseMissevanApiFallback(req.query.apiFallback);

  if (!normalizedKeyword) {
    return res.json({ success: false, message: "Missing keyword" });
  }

  if (!isSearchKeywordLongEnough(normalizedKeyword)) {
    return res.json(buildKeywordTooShortSearchResponse(normalizedKeyword, offset, limit));
  }

  void writeUsageLog({
    platform: "missevan",
    action: "search",
    keyword: normalizedKeyword,
  });

  try {
    await ensureInfoStoreLoaded(missevanInfoStore);
    await refreshMissevanCooldownState();

    const directInput = normalizeMissevanDirectSearchInput(normalizedKeyword);
    if (directInput) {
      const resolvedCard = await buildMissevanDramaCardFromInput(directInput);
      const results = resolvedCard?.card ? [resolvedCard.card] : [];
      const meta = {
        ...buildSearchPageMeta(
          normalizedKeyword,
          results.length,
          offset,
          limit
        ),
        source: "direct_link",
      };

      return res.json({
        success: results.length > 0,
        results,
        meta,
      });
    }

    let source = "missevan_api";
    let totalMatched = 0;
    let results = [];

    if (missevanInfoStore.remoteAvailable) {
      const librarySearch = await searchLibraryWithFallback({
        keyword: normalizedKeyword,
        libraryOnly: true,
        searchLibrary(searchKeyword, mode) {
          if (mode === "compatible") {
            void writeUsageLog(
              buildCompatibilitySearchUsageLog("missevan", normalizedKeyword)
            );
          }
          return searchMissevanLibraryRecords(
            missevanInfoStore.records,
            searchKeyword,
            SEARCH_RESULT_LIMIT,
            mode
          );
        },
      });
      const matchedRecords = librarySearch.items;
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

    if (!results.length && totalMatched === 0 && useApiFallback) {
      source = "missevan_api";
      const apiRecords = await searchMissevanApiRecords(
        normalizedKeyword,
        SEARCH_RESULT_LIMIT,
        { logApiCall: true }
      );
      totalMatched = apiRecords.length;
      const pagedRecords = apiRecords.slice(offset, offset + limit);
      results = await mapWithConcurrency(
        pagedRecords,
        4,
        hydrateMissevanApiSearchRecord
      );
    } else if (!results.length && totalMatched === 0 && !useApiFallback) {
      source = "library_only";
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

  if (!["missevan", "manbo"].includes(platform)) {
    return res.status(400).json({
      success: false,
      message: "Invalid platform",
    });
  }

  const dramaIds = normalizeNewDramaIdsForPlatform(platform, req.body?.drama_ids || []);

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

    if (action === "compare") {
      const dramaIds = (Array.isArray(payload.dramaIds) ? payload.dramaIds : [])
        .map((id) => normalizeTextValue(id).slice(0, 80))
        .filter(Boolean)
        .slice(0, 6);
      const dramaTitles = (Array.isArray(payload.dramaTitles) ? payload.dramaTitles : [])
        .map((title) => normalizeTextValue(title).slice(0, 200))
        .filter(Boolean)
        .slice(0, 6);
      const platforms = (Array.isArray(payload.platforms) ? payload.platforms : [])
        .map((item) => normalizeTextValue(item).slice(0, 40))
        .filter(Boolean)
        .slice(0, 6);
      const compareKinds = (Array.isArray(payload.compareKinds) ? payload.compareKinds : [])
        .map((item) => normalizeTextValue(item).slice(0, 40))
        .filter(Boolean)
        .slice(0, 6);
      if (!dramaIds.length || !dramaTitles.length) {
        return res.status(400).json({
          success: false,
          message: "Invalid usage log payload",
        });
      }
      await writeUsageLog({
        action,
        dramaIds,
        dramaTitles,
        ...(platforms.length ? { platforms } : {}),
        ...(compareKinds.length ? { compareKinds } : {}),
        success: true,
      });
      return res.json({ success: true });
    }

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

    if (["favorite_add", "favorite_remove"].includes(action)) {
      const entry = buildFavoriteUsageLog(payload);
      if (!entry) {
        return res.status(400).json({
          success: false,
          message: "Invalid usage log payload",
        });
      }
      await writeUsageLog(entry);
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

registerMissevanRoutes(app, {
  buildMissevanDramaCardFromInput,
  buildMissevanSearchFallbackCard,
  dedupeMissevanDramaCardResults,
  ensureInfoStoreLoaded,
  ensureMissevanEnabled,
  expensiveDataLimiter,
  fetchDanmakuSummary,
  fetchDramaInfo,
  fetchRewardDetailMeta,
  fetchRewardSummary,
  fetchSoundSummary,
  filterUntrackedNewDramaIds,
  fireAndForget,
  isAccessDeniedError,
  isMissevanAccessDenied,
  missevanInfoStore,
  normalizeDramaCardUsageAction,
  normalizeDramaIds,
  normalizeIds,
  normalizeMissevanDramaCardItems,
  normalizeStatsTaskSource,
  normalizeStringArray,
  queueNewDramaIdsAppend,
  refreshMissevanCooldownState,
  sleep,
  writeUsageLog,
});



registerManboRoutes(app, {
  buildCompatibilitySearchUsageLog,
  buildKeywordTooShortSearchResponse,
  buildMainCvText,
  buildManboApiSearchFallbackCard,
  buildManboContentTypeLabel: getManboContentTypeLabel,
  buildManboSearchFallbackCard,
  buildSearchPageMeta,
  dramaService,
  ensureInfoStoreLoaded,
  expensiveDataLimiter,
  fetchManboDanmakuSummary,
  fetchManboSearchApiRecords,
  fetchManboSetSummary,
  filterUntrackedNewDramaIds,
  fireAndForget,
  getManboMainCvNames,
  hydrateManboSearchRecord,
  isAccessDeniedError,
  manboInfoStore,
  mapWithConcurrency,
  normalizeDramaCardUsageAction,
  normalizeKeyword,
  normalizeManboCardFromDramaInfo,
  normalizeRawInputItems,
  normalizeSearchLimit,
  normalizeSearchOffset,
  normalizeStatsTaskSource,
  normalizeStringIds,
  normalizeStringArray,
  normalizeTextValue,
  queueNewDramaIdsAppend,
  resolveManboItem,
  searchLibraryWithFallback,
  searchManboLibraryRecords,
  selectManboSearchSourceRecords,
  shouldUseMissevanApiFallback,
  sleep,
  writeUsageLog,
  SEARCH_RESULT_LIMIT,
  isSearchKeywordLongEnough,
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

function createStatsTask({
  platform,
  taskType,
  episodes = [],
  dramaIds = [],
  playCountDramas = [],
  source = "",
  clientKey = "unknown",
}) {
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
    source: normalizeStatsTaskSource(source),
    clientKey: String(clientKey ?? "").trim() || "unknown",
    queuePosition: 0,
    episodes,
    dramaIds,
    playCountDramas,
    result: null,
    error: "",
    cancelled: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastSeenAt: Date.now(),
  };

  cleanupExpiredStatsTasks();
  return task;
}

function getStatsTaskSnapshotOr404(taskId, res, { touch = false } = {}) {
  cleanupExpiredStatsTasks();
  const snapshot = touch
    ? statsTaskEngine.touch(taskId)
    : statsTaskEngine.getSnapshot(taskId);
  if (!snapshot) {
    res.status(404).json({ error: "Task not found" });
    return null;
  }
  return snapshot;
}

export function getStatsTaskItemCounts({
  taskType = "",
  episodes = [],
  dramaIds = [],
  playCountDramas = [],
} = {}) {
  const normalizedPlayCountDramas = Array.isArray(playCountDramas)
    ? playCountDramas
    : [];
  return {
    primary:
      taskType === "revenue"
        ? (Array.isArray(dramaIds) ? dramaIds.length : 0)
        : (Array.isArray(episodes) ? episodes.length : 0),
    playCountDramas: normalizedPlayCountDramas.length,
    playCountEpisodes: normalizedPlayCountDramas.reduce(
      (count, drama) =>
        count + (Array.isArray(drama?.episodes) ? drama.episodes.length : 0),
      0
    ),
  };
}

export function isStatsTaskItemLimitExceeded(
  itemCounts,
  limit = STATS_TASK_MAX_ITEMS
) {
  return (
    Number(itemCounts?.primary ?? 0) > limit ||
    Number(itemCounts?.playCountDramas ?? 0) > limit ||
    Number(itemCounts?.playCountEpisodes ?? 0) > limit
  );
}

function createStatsTaskFromRequest(req, res, forcedPlatform = null, defaultTaskType = null) {
  const platform =
    forcedPlatform || (req.body?.platform === "manbo" ? "manbo" : "missevan");
  const taskType = String(req.body?.taskType ?? "").trim();
  const normalizedTaskType = taskType || defaultTaskType || "";
  const episodes = normalizeTaskEpisodes(req.body?.episodes);
  const dramaIds = normalizeTaskDramaIds(req.body?.dramaIds, platform);
  const playCountDramas = platform === "missevan" && normalizedTaskType === "play_count"
    ? normalizePlayCountDramas(req.body?.playCountDramas)
    : [];
  const source = normalizeStatsTaskSource(req.body?.source);
  const itemCounts = getStatsTaskItemCounts({
    taskType: normalizedTaskType,
    episodes,
    dramaIds,
    playCountDramas,
  });

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

  if (isStatsTaskItemLimitExceeded(itemCounts)) {
    res.status(400).json({
      success: false,
      code: "TASK_ITEM_LIMIT_EXCEEDED",
      message: `单次统计最多处理 ${STATS_TASK_MAX_ITEMS} 个条目。`,
      limit: STATS_TASK_MAX_ITEMS,
    });
    return null;
  }

  const task = createStatsTask({
    platform,
    taskType: normalizedTaskType,
    episodes,
    dramaIds,
    playCountDramas,
    source,
    clientKey: req.ip,
  });
  const enqueueResult = statsTaskEngine.enqueue(task);
  if (!enqueueResult.accepted) {
    const code = enqueueResult.code === "TASK_CLIENT_QUEUE_FULL"
      ? "TASK_CLIENT_QUEUE_FULL"
      : "TASK_QUEUE_FULL";
    const message = code === "TASK_CLIENT_QUEUE_FULL"
      ? "当前设备排队中的统计任务已达上限，请稍后重试。"
      : "统计任务队列已满，请稍后重试。";
    res.setHeader("Retry-After", "30");
    res.status(429).json({
      success: false,
      code,
      message,
      platform,
      retryAfterSeconds: 30,
    });
    return null;
  }
  task.queuePosition = enqueueResult.queuePosition;
  if (task.queuePosition > 0) {
    statsTaskEngine.report(task.taskId, {
      currentAction: `任务排队中，前方 ${task.queuePosition} 个任务`,
    });
  }
  return task;
}

app.use(express.static(path.join(__dirname, "dist")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

let serverInstance = null;

export async function startServer(port = defaultPort, options = {}) {
  if (serverInstance) {
    return serverInstance;
  }

  await loadAccessDeniedCooldown();
  await persistCurrentAppVersionToCooldownState();

  serverInstance = await new Promise((resolve, reject) => {
    const onListening = () => {
      resolve(listener);
    };
    const host = String(options?.host || "").trim();
    const listener = host ? app.listen(port, host, onListening) : app.listen(port, onListening);

    listener.once("error", (error) => {
      serverInstance = null;
      reject(error);
    });
  });

  const actualPort = serverInstance.address()?.port ?? port;
  logger.info("server_started", { port: actualPort, host: options?.host || null });
  void Promise.all([
    ensureInfoStoreLoaded(missevanInfoStore),
    ensureInfoStoreLoaded(manboInfoStore),
  ]).catch((error) => {
    console.warn(`Info store prewarm failed: ${formatImageProxyError(error)}`);
  });
  void statsTaskEngine.restore().catch((error) => {
    console.warn(`Stats task recovery failed: ${formatImageProxyError(error)}`);
    return [];
  });
  return serverInstance;
}

if (process.env.START_SERVER_ON_IMPORT !== "false") {
  startServer().catch((error) => {
    console.error("Failed to start server", error);
    process.exitCode = 1;
  });
}
