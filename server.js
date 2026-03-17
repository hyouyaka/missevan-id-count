import fs from "fs/promises";
import cors from "cors";
import express from "express";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const defaultPort = Number(process.env.PORT) || 3000;
const appDataDir = process.env.APP_DATA_DIR
  ? path.resolve(process.env.APP_DATA_DIR)
  : __dirname;
const logsDir = path.join(appDataDir, "logs");
const runtimeDir = path.join(appDataDir, "runtime");
const usageLogPath = path.join(logsDir, "usage.log");
const MISSEVAN_ENABLED = process.env.ENABLE_MISSEVAN !== "false";
const DESKTOP_APP = process.env.DESKTOP_APP === "true";
const MISSEVAN_COOLDOWN_HOURS = Math.max(
  1,
  Number(process.env.MISSEVAN_COOLDOWN_HOURS ?? 4) || 4
);
const MISSEVAN_COOLDOWN_MS = MISSEVAN_COOLDOWN_HOURS * 60 * 60 * 1000;
const COOLDOWN_STATE_PATH = path.join(runtimeDir, "missevan-cooldown.json");

const MANBO_API_BASE = "https://www.kilamanbo.com/web_manbo";

const danmakuCache = new Map();
const dramaCache = new Map();
const soundSummaryCache = new Map();
const rewardSummaryCache = new Map();
const manboDramaCache = new Map();
const manboSetCache = new Map();
const manboDanmakuCache = new Map();
const manboStatsTaskStore = new Map();

const DRAMA_CACHE_TTL_MS = 30 * 60 * 1000;
const SOUND_SUMMARY_CACHE_TTL_MS = 30 * 60 * 1000;
const REWARD_SUMMARY_CACHE_TTL_MS = 30 * 60 * 1000;
const MANBO_DRAMA_CACHE_TTL_MS = 30 * 60 * 1000;
const MANBO_SET_CACHE_TTL_MS = 30 * 60 * 1000;
const MANBO_DANMAKU_CACHE_TTL_MS = 30 * 60 * 1000;
const MANBO_STATS_TASK_TTL_MS = 60 * 60 * 1000;
const MANBO_STATS_TASK_HEARTBEAT_TIMEOUT_MS = 5 * 60 * 1000;

let accessDeniedUntil = 0;
let cooldownStateLoaded = false;

app.use(cors());
app.use(express.json());

app.get("/app-config", (req, res) => {
  res.json({
    missevanEnabled: MISSEVAN_ENABLED,
    desktopApp: DESKTOP_APP,
    brandName: MISSEVAN_ENABLED ? "M&M Toolkit" : "Manbo Toolkit",
    titleZh: MISSEVAN_ENABLED ? "小猫小狐数据分析" : "小狐分析",
    description: MISSEVAN_ENABLED
      ? "支持 Missevan 与 Manbo 的作品导入、分集筛选、弹幕统计和数据汇总。"
      : "支持 Manbo 平台的作品导入、分集筛选、弹幕统计和去重 ID 汇总。",
    cooldownHours: MISSEVAN_COOLDOWN_HOURS,
    cooldownUntil: isInAccessDeniedCooldown() ? accessDeniedUntil : 0,
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

function cleanupExpiredManboStatsTasks() {
  const now = Date.now();
  for (const [taskId, task] of manboStatsTaskStore.entries()) {
    const updatedAt = Number(task?.updatedAt ?? task?.createdAt ?? 0);
    if (now - updatedAt > MANBO_STATS_TASK_TTL_MS) {
      manboStatsTaskStore.delete(taskId);
    }
  }
}

function buildManboTaskSnapshot(task) {
  return {
    taskId: task.taskId,
    status: task.status,
    progress: task.progress,
    currentAction: task.currentAction,
    totalCount: task.totalCount,
    completedCount: task.completedCount,
    failedCount: task.failedCount,
    totalDanmaku: task.totalDanmaku,
    totalUsers: task.totalUsers,
    accessDenied: task.accessDenied,
    result: task.status === "completed" ? task.result : null,
    error: task.error || "",
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    lastSeenAt: task.lastSeenAt,
  };
}

function updateManboTask(task, patch) {
  Object.assign(task, patch, { updatedAt: Date.now() });
}

function refreshManboTaskHeartbeat(task) {
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

function shouldUsePersistentCooldown() {
  return MISSEVAN_ENABLED && !DESKTOP_APP;
}

async function persistAccessDeniedCooldown() {
  if (!shouldUsePersistentCooldown()) {
    return;
  }

  try {
    await fs.mkdir(runtimeDir, { recursive: true });
    await fs.writeFile(
      COOLDOWN_STATE_PATH,
      JSON.stringify({ accessDeniedUntil }, null, 2),
      "utf8"
    );
  } catch (error) {
    console.error("Failed to persist Missevan cooldown state", error);
  }
}

async function clearPersistedAccessDeniedCooldown() {
  if (!shouldUsePersistentCooldown()) {
    return;
  }

  try {
    await fs.rm(COOLDOWN_STATE_PATH, { force: true });
  } catch (error) {
    console.error("Failed to clear Missevan cooldown state", error);
  }
}

async function loadAccessDeniedCooldown() {
  if (cooldownStateLoaded || !shouldUsePersistentCooldown()) {
    cooldownStateLoaded = true;
    return;
  }

  cooldownStateLoaded = true;

  try {
    const content = await fs.readFile(COOLDOWN_STATE_PATH, "utf8");
    const payload = JSON.parse(content);
    const until = Number(payload?.accessDeniedUntil ?? 0);
    accessDeniedUntil = Number.isFinite(until) ? until : 0;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.error("Failed to read Missevan cooldown state", error);
    }
    accessDeniedUntil = 0;
  }

  if (accessDeniedUntil <= Date.now()) {
    accessDeniedUntil = 0;
    await clearPersistedAccessDeniedCooldown();
  }
}

function isInAccessDeniedCooldown() {
  if (!shouldUsePersistentCooldown()) {
    return false;
  }

  if (accessDeniedUntil > 0 && accessDeniedUntil <= Date.now()) {
    accessDeniedUntil = 0;
    void clearPersistedAccessDeniedCooldown();
    return false;
  }

  return Date.now() < accessDeniedUntil;
}

function markAccessDeniedCooldown() {
  if (!shouldUsePersistentCooldown()) {
    return;
  }

  accessDeniedUntil = Date.now() + MISSEVAN_COOLDOWN_MS;
  void persistAccessDeniedCooldown();
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

function setCachedValue(cache, key, value) {
  cache.set(String(key), {
    value,
    createdAt: Date.now(),
  });
}

function normalizeKeyword(keyword) {
  return String(keyword ?? "").trim().slice(0, 200);
}

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

async function fetchJsonWithRetry(url, retries = 2, delayMs = 250, options = {}) {
  if (options.missevan && isInAccessDeniedCooldown()) {
    throw createCooldownError();
  }

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      if (options.missevan && isAccessDeniedError(error)) {
        markAccessDeniedCooldown();
      }

      lastError = error;
      if (attempt < retries) {
        await sleep(delayMs * (attempt + 1));
      }
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
    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.text();
    } catch (error) {
      if (options.missevan && isAccessDeniedError(error)) {
        markAccessDeniedCooldown();
      }

      lastError = error;
      if (attempt < retries) {
        await sleep(delayMs * (attempt + 1));
      }
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

  return {
    drama: {
      ...drama,
      id: Number(drama.id),
      name: drama.name || "",
      cover: drama.cover || "",
      vip: Number(drama.vip ?? 0),
      price: Number(drama.price ?? 0),
      member_price: Number(drama?.vip_discount?.price ?? 0),
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
        need_pay: Number(episode.need_pay ?? 0),
        price: Number(episode.price ?? 0),
      })),
    },
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

  const summary = {
    sound_id: Number(soundId),
    success: true,
    view_count: viewCount,
    viewCountWan: sound.view_count_formatted || formatPlayCountWan(viewCount),
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
    const normalized = normalizeMissevanDramaInfo(data.info);
    setCachedValue(dramaCache, cacheKey, normalized);

    const resolvedDramaId = Number(normalized?.drama?.id ?? dramaId);
    if (resolvedDramaId > 0) {
      setCachedValue(dramaCache, `drama:${resolvedDramaId}`, normalized);
    }

    const resolvedSoundId = Number(
      soundId ?? normalized?.episodes?.episode?.[0]?.sound_id
    );
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

async function fetchDanmakuSummary(soundId, dramaTitle) {
  const cacheKey = String(soundId);
  if (danmakuCache.has(cacheKey)) {
    return {
      ...danmakuCache.get(cacheKey),
      drama_title: dramaTitle,
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

    danmakuCache.set(cacheKey, cachedResult);

    return {
      ...cachedResult,
      drama_title: dramaTitle,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to fetch Missevan danmaku sound_id=${soundId}: ${message}`);

    return {
      success: false,
      sound_id: Number(soundId),
      drama_title: dramaTitle,
      danmaku: 0,
      users: [],
      accessDenied:
        isAccessDeniedError(error) ||
        String(message).startsWith("ACCESS_DENIED_COOLDOWN:"),
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
  const dramaMeta = {
    isPaidDrama:
      Number(raw.payType ?? raw.setPayType ?? 0) === 1 ||
      Number(raw.price ?? 0) > 0 ||
      Number(raw.memberPrice ?? 0) > 0,
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
      play_count: Number(set.watchCount ?? 0),
      type: Number(set.type ?? 0),
      is_buy: Number(set.isBuy ?? raw.isBuy ?? 0),
      platform: "manbo",
    }))
    .filter((episode) => isNumericId(episode.sound_id))
    .sort((a, b) => a.set_no - b.set_no);
  const isMember = isManboMemberDramaInfo({
    drama: {
      pay_type: Number(raw.payType ?? raw.setPayType ?? 0),
      price: Number(raw.price ?? 0),
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
      price: Number(raw.price ?? 0),
      view_count: Number(raw.watchCount ?? 0),
      subscription_num: Number(raw.favoriteCount ?? 0),
      diamond_value: Number(raw.diamondValue ?? 0),
      pay_type: Number(raw.payType ?? raw.setPayType ?? 0),
      member_price: Number(raw.memberPrice ?? 0),
      is_member: isMember,
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

  return {
    id: drama.id,
    name: drama.name,
    cover: drama.cover,
    view_count: Number(drama.view_count ?? 0),
    playCountWan: formatPlayCountWan(drama.view_count),
    price: Number(drama.price ?? 0),
    sound_id: info?.episodes?.episode?.[0]?.sound_id || null,
    subscription_num: Number(drama.subscription_num ?? 0),
    diamond_value: Number(drama.diamond_value ?? 0),
    is_member: Boolean(drama.is_member),
    checked: true,
    platform: "manbo",
  };
}

function isManboMemberDramaInfo(info) {
  const drama = info?.drama || {};
  const episodes = Array.isArray(info?.episodes?.episode)
    ? info.episodes.episode
    : [];
  const allEpisodesFree = episodes.every((episode) => {
    return (
      Number(episode?.pay_type ?? 0) === 0 &&
      Number(episode?.price ?? 0) === 0
    );
  });
  const hasVipFreeEpisode = episodes.some(
    (episode) => Number(episode?.vip_free ?? 0) === 1
  );

  return (
    Number(drama.pay_type ?? 0) === 0 &&
    Number(drama.price ?? 0) === 0 &&
    allEpisodesFree &&
    hasVipFreeEpisode
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

  const data = await fetchJsonWithRetry(
    `${MANBO_API_BASE}/dramaDetail?dramaId=${normalizedDramaId}`
  );

  if (Number(data?.code) !== 200 || !data?.data) {
    return null;
  }

  const normalized = normalizeManboDramaInfo(data.data);
  if (normalized?.drama?.id) {
    setCachedValue(manboDramaCache, normalized.drama.id, normalized);
  }

  return normalized;
}

async function fetchManboSetDetail(setId) {
  const normalizedSetId = String(setId ?? "").trim();
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

  const detail = await fetchManboSetDetail(setId);
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

async function fetchManboDanmakuSummary(setId, dramaTitle) {
  const cached = getCachedValue(
    manboDanmakuCache,
    setId,
    MANBO_DANMAKU_CACHE_TTL_MS
  );
  if (cached) {
    return {
      ...cached,
      drama_title: dramaTitle,
    };
  }

  try {
    const pageSize = 200;
    const users = new Set();
    const firstPageData = await fetchJsonWithRetry(
      `${MANBO_API_BASE}/getDanmaKuPgList?pageSize=${pageSize}&dramaSetId=${setId}&pageNo=1`
    );
    const firstPayload = firstPageData?.data || {};
    const firstList = Array.isArray(firstPayload.list) ? firstPayload.list : [];
    const totalDanmaku = Math.max(
      0,
      Number(firstPayload.count ?? firstList.length ?? 0)
    );
    const totalPages = totalDanmaku > 0 ? Math.ceil(totalDanmaku / pageSize) : 1;

    firstList.forEach((item) => {
      if (item?.eid) {
        users.add(String(item.eid));
      }
    });

    for (let startPage = 2; startPage <= totalPages; startPage += 6) {
      const pageNumbers = [];
      for (
        let pageNo = startPage;
        pageNo < startPage + 6 && pageNo <= totalPages;
        pageNo += 1
      ) {
        pageNumbers.push(pageNo);
      }

      const pages = await Promise.all(
        pageNumbers.map((pageNo) =>
          fetchJsonWithRetry(
            `${MANBO_API_BASE}/getDanmaKuPgList?pageSize=${pageSize}&dramaSetId=${setId}&pageNo=${pageNo}`
          )
        )
      );

      pages.forEach((data) => {
        const payload = data?.data || {};
        const list = Array.isArray(payload.list) ? payload.list : [];
        list.forEach((item) => {
          if (item?.eid) {
            users.add(String(item.eid));
          }
        });
      });
    }

    const summary = {
      success: true,
      sound_id: String(setId),
      danmaku: totalDanmaku,
      users: [...users],
      accessDenied: false,
      error: "",
    };

    setCachedValue(manboDanmakuCache, setId, summary);

    return {
      ...summary,
      drama_title: dramaTitle,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to fetch Manbo danmaku set_id=${setId}: ${message}`);

    return {
      success: false,
      sound_id: String(setId),
      drama_title: dramaTitle,
      danmaku: 0,
      users: [],
      accessDenied:
        isAccessDeniedError(error) ||
        String(message).startsWith("ACCESS_DENIED_COOLDOWN:"),
      error: message,
    };
  }
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

async function executeManboStatsTask(task) {
  const episodes = Array.isArray(task.episodes) ? task.episodes : [];
  const dramaMap = new Map();
  const allUsers = new Set();

  episodes.forEach((episode) => {
    const title = String(episode?.drama_title ?? "").trim() || "Unknown";
    if (!dramaMap.has(title)) {
      dramaMap.set(title, {
        title,
        selectedEpisodeCount: 0,
        danmaku: 0,
        userSet: new Set(),
      });
    }

    dramaMap.get(title).selectedEpisodeCount += 1;
  });

  updateManboTask(task, {
    status: "running",
    currentAction: "开始统计弹幕与去重 ID",
    progress: 0,
  });

  try {
    await runWithConcurrency(episodes, 4, async (episode) => {
      if (task.cancelled || hasManboTaskHeartbeatExpired(task)) {
        task.cancelled = true;
        return;
      }

      const setId = String(episode?.sound_id ?? "").trim();
      const dramaTitle = String(episode?.drama_title ?? "").trim() || "Unknown";

      try {
        const result = await fetchManboDanmakuSummary(setId, dramaTitle);

        if (result.success) {
          const drama = dramaMap.get(dramaTitle);
          if (drama) {
            drama.danmaku += Number(result.danmaku ?? 0);
            result.users.forEach((uid) => {
              drama.userSet.add(uid);
              allUsers.add(uid);
            });
          }

          task.totalDanmaku += Number(result.danmaku ?? 0);
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
      updateManboTask(task, {
        progress:
          task.totalCount > 0
            ? Math.floor((task.completedCount / task.totalCount) * 100)
            : 100,
        currentAction: `统计 ID ${task.completedCount}/${task.totalCount}`, 
        totalUsers: allUsers.size,
      });
    });

    if (task.cancelled) {
      updateManboTask(task, {
        status: "cancelled",
        currentAction: hasManboTaskHeartbeatExpired(task)
          ? "统计已超时取消"
          : "统计已取消",
      });
      return;
    }

    const result = {
      idResults: Array.from(dramaMap.values()).map((drama) => ({
        title: drama.title,
        selectedEpisodeCount: drama.selectedEpisodeCount,
        danmaku: drama.danmaku,
        users: drama.userSet.size,
      })),
      totalDanmaku: task.totalDanmaku,
      totalUsers: allUsers.size,
      idSelectedEpisodeCount: task.totalCount,
    };

    updateManboTask(task, {
      status: "completed",
      progress: 100,
      currentAction: task.accessDenied
        ? "访问受限"
        : task.failedCount > 0
          ? `统计完成，跳过 ${task.failedCount} 个分集`
          : "统计完成",
      totalUsers: allUsers.size,
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateManboTask(task, {
      status: "failed",
      currentAction: "统计失败",
      error: message,
      totalUsers: allUsers.size,
    });
  }
}

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

  if (!normalizedKeyword) {
    return res.json({ success: false, message: "Missing keyword" });
  }

  void writeUsageLog({
    platform: "missevan",
    action: "search",
    keyword: normalizedKeyword,
  });

  try {
    const data = await fetchJsonWithRetry(
      `https://www.missevan.com/dramaapi/search?s=${encodeURIComponent(
        normalizedKeyword
      )}&page=1`,
      2,
      250,
      { missevan: true }
    );

    if (!data.success) {
      return res.json({ success: false });
    }

    const baseResults = data.info.Datas.map((drama) => {
      const firstEpisode = Array.isArray(drama?.episode)
        ? drama.episode[0]
        : Array.isArray(drama?.episodes)
          ? drama.episodes[0]
          : drama?.episodes?.episode?.[0];
      const soundId = Number(firstEpisode?.sound_id ?? 0);

      return {
        id: Number(drama.id),
        name: drama.name,
        cover: drama.cover || "",
        view_count: Number(drama.view_count ?? 0),
        playCountWan: formatPlayCountWan(drama.view_count),
        vip: Number(drama.vip ?? 0),
        price: Number(drama.price ?? 0),
        member_price: Number(drama?.vip_discount?.price ?? 0),
        is_member: Number(drama.vip ?? 0) === 1,
        sound_id: soundId > 0 ? soundId : null,
        subscription_num: null,
        checked: false,
        platform: "missevan",
      };
    });

    const results = await Promise.all(
      baseResults.map(async (item) => {
        if (!item.sound_id) {
          return item;
        }

        try {
          const info = await fetchDramaInfo(item.id, item.sound_id);
          const subscriptionNum = Number(info?.drama?.subscription_num);

          return {
            ...item,
            vip: Number(info?.drama?.vip ?? item.vip ?? 0),
            member_price: Number(info?.drama?.member_price ?? 0),
            is_member: Boolean(info?.drama?.is_member),
            subscription_num: Number.isFinite(subscriptionNum)
              ? subscriptionNum
              : null,
          };
        } catch (error) {
          console.error(
            `Failed to fetch Missevan subscription number drama_id=${item.id}`,
            error
          );
          return item;
        }
      })
    );

    return res.json({ success: true, results });
  } catch (error) {
    console.error(error);
    return res.json({
      success: false,
      accessDenied:
        isAccessDeniedError(error) ||
        String(error?.message || error).startsWith("ACCESS_DENIED_COOLDOWN:"),
      message: "Missevan request failed",
    });
  }
});

app.post("/getdramacards", async (req, res) => {
  if (!ensureMissevanEnabled(res)) {
    return;
  }
  const ids = normalizeDramaIds(req.body.drama_ids || []);
  const results = [];
  const failedIds = [];
  let accessDenied = false;

  if (ids.length) {
    void writeUsageLog({
      platform: "missevan",
      action: "manual_import",
      dramaIds: ids,
      count: ids.length,
    });
  }

  for (const id of ids) {
    try {
      const info = await fetchDramaInfo(id);

      if (info?.drama) {
        results.push({
          id: info.drama.id,
          name: info.drama.name,
          cover: info.drama.cover || "",
          view_count: Number(info.drama.view_count ?? 0),
          playCountWan: formatPlayCountWan(info.drama.view_count),
          vip: Number(info.drama.vip ?? 0),
          price: Number(info.drama.price ?? 0),
          member_price: Number(info.drama.member_price ?? 0),
          is_member: Boolean(info.drama.is_member),
          checked: true,
          platform: "missevan",
        });
      } else {
        failedIds.push(Number(id));
      }
    } catch (error) {
      accessDenied =
        accessDenied ||
        isAccessDeniedError(error) ||
        String(error?.message || error).startsWith("ACCESS_DENIED_COOLDOWN:");
      console.error(`Failed to fetch Missevan drama card drama_id=${id}`, error);
      failedIds.push(Number(id));
    }
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

  for (const id of ids) {
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
      const accessDenied =
        isAccessDeniedError(error) ||
        String(error?.message || error).startsWith("ACCESS_DENIED_COOLDOWN:");
      console.error(`Failed to fetch Missevan drama drama_id=${id}`, error);
      results.push({ success: false, id, accessDenied });
    }
  }

  return res.json(results);
});

app.post("/getsoundsummary", async (req, res) => {
  if (!ensureMissevanEnabled(res)) {
    return;
  }
  const soundIds = normalizeIds(req.body.sound_ids || []);
  const results = [];

  for (const soundId of soundIds) {
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
          isAccessDeniedError(error) ||
          String(message).startsWith("ACCESS_DENIED_COOLDOWN:"),
        error: message,
      });
    }

    await sleep(350);
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

app.post("/getsounddanmaku", async (req, res) => {
  if (!ensureMissevanEnabled(res)) {
    return;
  }
  const { sound_id: soundId, drama_title: dramaTitle = "" } = req.body;

  if (!soundId) {
    return res.json({
      success: false,
      sound_id: 0,
      drama_title: dramaTitle,
      danmaku: 0,
      users: [],
      accessDenied: false,
      error: "Missing sound_id",
    });
  }

  const result = await fetchDanmakuSummary(soundId, dramaTitle);
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

app.post("/manbo/getdramacards", async (req, res) => {
  const items = normalizeRawInputItems(req.body.items || []);
  const results = [];
  const failedItems = [];
  let accessDenied = false;

  if (items.length) {
    void writeUsageLog({
      platform: "manbo",
      action: "manual_import",
      items: items.map((item) => item.raw),
      count: items.length,
    });
  }

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
        results.push(card);
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
  const { sound_id: setId, drama_title: dramaTitle = "" } = req.body;

  if (!setId) {
    return res.json({
      success: false,
      sound_id: 0,
      drama_title: dramaTitle,
      danmaku: 0,
      users: [],
      accessDenied: false,
      error: "Missing sound_id",
    });
  }

  const result = await fetchManboDanmakuSummary(setId, dramaTitle);
  return res.json(result);
});

app.post("/manbo/stat-tasks", async (req, res) => {
  cleanupExpiredManboStatsTasks();

  const episodes = (Array.isArray(req.body?.episodes) ? req.body.episodes : [])
    .map((episode) => ({
      sound_id: String(episode?.sound_id ?? "").trim(),
      drama_title: String(episode?.drama_title ?? "").trim(),
    }))
    .filter((episode) => episode.sound_id);

  if (!episodes.length) {
    return res.status(400).json({
      error: "Missing episodes",
    });
  }

  const taskId = createTaskId();
  const task = {
    taskId,
    status: "queued",
    progress: 0,
    currentAction: "任务已创建",
    totalCount: episodes.length,
    completedCount: 0,
    failedCount: 0,
    totalDanmaku: 0,
    totalUsers: 0,
    accessDenied: false,
    episodes,
    result: null,
    error: "",
    cancelled: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastSeenAt: Date.now(),
  };

  manboStatsTaskStore.set(taskId, task);
  executeManboStatsTask(task).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    updateManboTask(task, {
      status: "failed",
      currentAction: "统计失败",
      error: message,
    });
  });

  return res.json(buildManboTaskSnapshot(task));
});

app.get("/manbo/stat-tasks/:taskId", async (req, res) => {
  cleanupExpiredManboStatsTasks();
  const task = manboStatsTaskStore.get(String(req.params.taskId));

  if (!task) {
    return res.status(404).json({
      error: "Task not found",
    });
  }

  refreshManboTaskHeartbeat(task);
  return res.json(buildManboTaskSnapshot(task));
});

app.post("/manbo/stat-tasks/:taskId/cancel", async (req, res) => {
  const task = manboStatsTaskStore.get(String(req.params.taskId));

  if (!task) {
    return res.status(404).json({
      error: "Task not found",
    });
  }

  task.cancelled = true;
  updateManboTask(task, {
    status: task.status === "completed" ? "completed" : "cancelled",
    currentAction: task.status === "completed" ? task.currentAction : "统计已取消",
  });

  return res.json(buildManboTaskSnapshot(task));
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
