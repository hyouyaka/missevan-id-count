import fs from "fs/promises";
import path from "path";

const SUPPORTED_ENV_KEYS = [
  "APP_DATA_DIR",
  "DESKTOP_APP",
  "DESKTOP_EXE_DIR",
  "DESKTOP_PACKAGED_APP",
  "ENABLE_MISSEVAN",
  "FEATURE_SUGGESTION_URL",
  "INFO_STORE_SYNC_INTERVAL_MS",
  "JSON_BODY_LIMIT",
  "MANBO_DANMAKU_PAGE_CONCURRENCY",
  "MANBO_FETCH_TIMEOUT_MS",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "MANBO_INDEX_SYNC_INTERVAL_MS",
  "MANBO_STATS_EPISODE_CONCURRENCY",
  "MISSEVAN_PERSISTENT_COOLDOWN",
  "MISSEVAN_COOLDOWN_KEY",
  "MISSEVAN_COOLDOWN_HOURS",
  "MISSEVAN_DESKTOP_APP_URL",
  "PORT",
  "RANKS_CACHE_TTL_MS",
  "START_SERVER_ON_IMPORT",
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
