import fs from "fs/promises";
import path from "path";

const SUPPORTED_ENV_KEYS = [
  "ADMIN_CACHE_REFRESH_TOKEN",
  "APP_DATA_DIR",
  "CACHE_MAX_ENTRIES",
  "DESKTOP_APP",
  "DESKTOP_EXE_DIR",
  "DESKTOP_PACKAGED_APP",
  "ENABLE_MISSEVAN",
  "FEATURE_SUGGESTION_URL",
  "INFO_STORE_SYNC_INTERVAL_MS",
  "JSON_BODY_LIMIT",
  "IMAGE_PROXY_MAX_BYTES",
  "MANBO_DANMAKU_PAGE_CONCURRENCY",
  "MANBO_FETCH_TIMEOUT_MS",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "WEEKLY_PLAYBACK_CACHE_TTL_MS",
  "MANBO_STATS_EPISODE_CONCURRENCY",
  "MANBO_STATS_MAX_CONCURRENCY",
  "MISSEVAN_DANMAKU_CACHE_MAX_ENTRIES",
  "MISSEVAN_PERSISTENT_COOLDOWN",
  "MISSEVAN_COOLDOWN_KEY",
  "MISSEVAN_COOLDOWN_HOURS",
  "MISSEVAN_FALLBACK_BASE_URL",
  "MISSEVAN_FALLBACK_PROXY_TOKEN",
  "MISSEVAN_FALLBACK_TIMEOUT_MS",
  "MISSEVAN_SECONDARY_FALLBACK_BASE_URL",
  "MISSEVAN_SECONDARY_FALLBACK_PROXY_TOKEN",
  "MISSEVAN_SECONDARY_FALLBACK_TIMEOUT_MS",
  "MISSEVAN_FORCE_FALLBACK",
  "MISSEVAN_REQUEST_MIN_INTERVAL_MS",
  "MISSEVAN_REQUEST_MAX_INTERVAL_MS",
  "MISSEVAN_STATS_MAX_CONCURRENCY",
  "MISSEVAN_DESKTOP_APP_URL",
  "PORT",
  "RANKS_CACHE_TIME_ZONE",
  "RANKS_CACHE_TTL_MS",
  "RANKS_UPDATE_WINDOW_TTL_MS",
  "START_SERVER_ON_IMPORT",
  "STATS_TASK_CLIENT_QUEUE_MAX",
  "STATS_TASK_MAX_ITEMS",
  "STATS_TASK_QUEUE_MAX",
];

function parseEnvValue(rawValue) {
  const trimmed = String(rawValue ?? "").trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\""))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseEnvFile(content) {
  const entries = {};
  const lines = String(content ?? "").split(/\r?\n/);

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1);
    if (!SUPPORTED_ENV_KEYS.includes(key)) {
      return;
    }

    entries[key] = parseEnvValue(rawValue);
  });

  return entries;
}

async function readEnvFile(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return parseEnvFile(content);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function resolveCandidateEnvPaths({
  desktopApp = false,
  projectRoot = process.cwd(),
  appDataDir = "",
  exeDir = "",
} = {}) {
  const candidates = [];

  if (desktopApp) {
    if (exeDir) {
      candidates.push(path.join(exeDir, ".env"));
    }
    if (appDataDir) {
      candidates.push(path.join(appDataDir, ".env"));
    }
  }

  if (projectRoot) {
    candidates.push(path.join(projectRoot, ".env"));
  }

  return Array.from(new Set(candidates.filter(Boolean)));
}

export async function loadLocalEnv(options = {}) {
  const candidatePaths = resolveCandidateEnvPaths(options);

  for (const filePath of candidatePaths) {
    const values = await readEnvFile(filePath);
    if (!values) {
      continue;
    }

    SUPPORTED_ENV_KEYS.forEach((key) => {
      if (!process.env[key] && values[key]) {
        process.env[key] = values[key];
      }
    });
  }
}
