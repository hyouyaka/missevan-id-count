import fs from "fs/promises";
import path from "path";
import fetch from "node-fetch";
import { fileURLToPath } from "url";

export const MANBO_INDEX_VERSION = 1;
const INDEX_KEY = "manbo:index:v1";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function normalizeWhitespace(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeManboIndexName(name) {
  return normalizeWhitespace(name)
    .toLowerCase()
    .replace(/[\/\\|,_\-+~`!@#$%^&*()[\]{}:;"'<>.?，。！？、：；（）《》“”‘’【】]/g, "")
    .replace(/\s+/g, "");
}

function normalizeAliases(aliases, primaryName, previousName = "") {
  const seen = new Set();
  return (Array.isArray(aliases) ? aliases : [])
    .concat(previousName ? [previousName] : [])
    .map((alias) => normalizeWhitespace(alias))
    .filter((alias) => {
      if (!alias || alias === primaryName || seen.has(alias)) {
        return false;
      }
      seen.add(alias);
      return true;
    });
}

function normalizeRecord(record) {
  const dramaId = String(record?.dramaId ?? "").trim();
  const name = normalizeWhitespace(record?.name);
  if (!/^\d+$/.test(dramaId) || !name) {
    return null;
  }

  return {
    dramaId,
    name,
    normalizedName: normalizeManboIndexName(record?.normalizedName || name),
    aliases: normalizeAliases(record?.aliases, name),
    cover: normalizeWhitespace(record?.cover),
  };
}

function createEmptySnapshot() {
  return {
    version: MANBO_INDEX_VERSION,
    updatedAt: 0,
    records: [],
  };
}

async function readJsonFile(filePath) {
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

export function createUpstashRestClient({
  upstashRestUrl = (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/+$/, ""),
  upstashRestToken = process.env.UPSTASH_REDIS_REST_TOKEN || "",
} = {}) {
  const enabled = Boolean(upstashRestUrl && upstashRestToken);

  return {
    enabled,
    async command(args) {
      if (!enabled) {
        throw new Error("Upstash Redis is not configured");
      }

      const response = await fetch(upstashRestUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${upstashRestToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
      });
      const payload = await response.json();
      if (!response.ok || payload?.error) {
        throw new Error(payload?.error || `Upstash request failed: ${response.status}`);
      }
      return payload.result;
    },
  };
}

export function createManboIndexStore({
  runtimeDir,
  filePath = path.join(runtimeDir, "manbo-index.json"),
  seedFilePath = path.join(__dirname, "data", "manbo-index.seed.json"),
  upstashRestUrl = (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/+$/, ""),
  upstashRestToken = process.env.UPSTASH_REDIS_REST_TOKEN || "",
  syncIntervalMs = Number(process.env.MANBO_INDEX_SYNC_INTERVAL_MS ?? 30000) || 30000,
} = {}) {
  const state = {
    records: new Map(),
    version: MANBO_INDEX_VERSION,
    updatedAt: 0,
    loaded: false,
    loadPromise: null,
    flushPromise: null,
    flushTimer: null,
    lastRemoteSyncAt: 0,
  };

  const upstashClient = createUpstashRestClient({
    upstashRestUrl,
    upstashRestToken,
  });
  const hasUpstash = upstashClient.enabled;

  async function upstashCommand(args) {
    return upstashClient.command(args);
  }

  async function readPersistentSnapshot() {
    if (hasUpstash) {
      const raw = await upstashCommand(["GET", INDEX_KEY]);
      if (raw) {
        return JSON.parse(raw);
      }
    }

    const fileSnapshot = await readJsonFile(filePath);
    if (fileSnapshot) {
      return fileSnapshot;
    }

    const seedSnapshot = await readJsonFile(seedFilePath);
    return seedSnapshot || createEmptySnapshot();
  }

  function applySnapshot(snapshot) {
    const normalizedSnapshot = snapshot && typeof snapshot === "object"
      ? snapshot
      : createEmptySnapshot();
    const records = Array.isArray(normalizedSnapshot.records)
      ? normalizedSnapshot.records
      : [];
    state.records = new Map();
    records.forEach((record) => {
      const normalized = normalizeRecord(record);
      if (normalized) {
        state.records.set(normalized.dramaId, normalized);
      }
    });
    state.version = Number(normalizedSnapshot.version ?? MANBO_INDEX_VERSION) || MANBO_INDEX_VERSION;
    state.updatedAt = Number(normalizedSnapshot.updatedAt ?? 0) || 0;
    state.lastRemoteSyncAt = Date.now();
    state.loaded = true;
  }

  async function ensureLoaded(forceRefresh = false) {
    if (state.loaded && !forceRefresh) {
      if (hasUpstash && Date.now() - state.lastRemoteSyncAt > syncIntervalMs && !state.flushPromise) {
        return ensureLoaded(true);
      }
      return;
    }
    if (state.loadPromise) {
      return state.loadPromise;
    }

    state.loadPromise = (async () => {
      try {
        const snapshot = await readPersistentSnapshot();
        applySnapshot(snapshot);
      } catch (error) {
        if (!state.loaded) {
          applySnapshot(createEmptySnapshot());
        }
        console.error("Failed to load Manbo index snapshot", error);
      } finally {
        state.loadPromise = null;
      }
    })();

    return state.loadPromise;
  }

  function buildSnapshot() {
    return {
      version: state.version,
      updatedAt: state.updatedAt,
      records: Array.from(state.records.values()),
    };
  }

  async function flush() {
    const snapshot = JSON.stringify(buildSnapshot());
    if (hasUpstash) {
      await upstashCommand(["SET", INDEX_KEY, snapshot]);
      state.lastRemoteSyncAt = Date.now();
      return;
    }

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, snapshot, "utf8");
  }

  function scheduleFlush() {
    if (state.flushTimer) {
      clearTimeout(state.flushTimer);
    }
    state.flushTimer = setTimeout(() => {
      state.flushTimer = null;
      state.flushPromise = flush()
        .catch((error) => {
          console.error("Failed to persist Manbo index snapshot", error);
        })
        .finally(() => {
          state.flushPromise = null;
        });
    }, 300);
  }

  function scoreRecord(record, keyword, normalizedKeyword) {
    if (record.dramaId === keyword) {
      return 1000;
    }
    if (record.normalizedName === normalizedKeyword) {
      return 900;
    }
    if (record.normalizedName.startsWith(normalizedKeyword)) {
      return 700;
    }
    if (record.normalizedName.includes(normalizedKeyword)) {
      return 500;
    }
    const aliasHit = record.aliases.some((alias) => normalizeManboIndexName(alias).includes(normalizedKeyword));
    return aliasHit ? 300 : 0;
  }

  return {
    async ensureLoaded() {
      await ensureLoaded(false);
    },
    async search(keyword, limit = 30) {
      await ensureLoaded(false);
      const rawKeyword = normalizeWhitespace(keyword);
      const normalizedKeyword = normalizeManboIndexName(rawKeyword);
      if (!rawKeyword || (!normalizedKeyword && !/^\d+$/.test(rawKeyword))) {
        return [];
      }
      return Array.from(state.records.values())
        .map((record) => ({
          record,
          score: scoreRecord(record, rawKeyword, normalizedKeyword),
        }))
        .filter((item) => item.score > 0)
        .sort((a, b) => {
          if (b.score !== a.score) {
            return b.score - a.score;
          }
          return a.record.name.localeCompare(b.record.name, "zh-Hans-CN");
        })
        .slice(0, Math.max(1, Number(limit) || 30))
        .map(({ record }) => ({ ...record }));
    },
    async upsert(record) {
      await ensureLoaded(false);
      const normalized = normalizeRecord(record);
      if (!normalized) {
        return null;
      }

      const existing = state.records.get(normalized.dramaId);
      const nextRecord = {
        dramaId: normalized.dramaId,
        name: normalized.name,
        normalizedName: normalized.normalizedName,
        aliases: normalizeAliases(
          [
            ...(existing?.aliases || []),
            ...(normalized.aliases || []),
            existing?.name || "",
          ],
          normalized.name,
          existing?.name || ""
        ),
        cover: normalized.cover || existing?.cover || "",
      };

      state.records.set(nextRecord.dramaId, nextRecord);
      state.updatedAt = Date.now();
      scheduleFlush();
      return { ...nextRecord };
    },
    async getMeta() {
      await ensureLoaded(false);
      return {
        version: state.version,
        updatedAt: state.updatedAt,
        recordCount: state.records.size,
        persistence: hasUpstash ? "upstash" : "file",
      };
    },
  };
}
