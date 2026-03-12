import fs from "fs/promises";
import cors from "cors";
import express from "express";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const danmakuCache = new Map();
const dramaCache = new Map();
const soundSummaryCache = new Map();
const rewardSummaryCache = new Map();
const DRAMA_CACHE_TTL_MS = 30 * 60 * 1000;
const SOUND_SUMMARY_CACHE_TTL_MS = 30 * 60 * 1000;
const REWARD_SUMMARY_CACHE_TTL_MS = 30 * 60 * 1000;
const ACCESS_DENIED_COOLDOWN_MS = 10 * 60 * 1000;
const port = Number(process.env.PORT) || 3000;
const logsDir = path.join(__dirname, "logs");
const usageLogPath = path.join(logsDir, "usage.log");

let accessDeniedUntil = 0;

app.use(cors());
app.use(express.json());

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
    return `${(count / 10000).toFixed(1)}万`;
  }

  return `${(count / 100000000).toFixed(2)}亿`;
}

function isAllowedImageHost(hostname) {
  return hostname === "maoercdn.com" || hostname.endsWith(".maoercdn.com");
}

function isAccessDeniedError(error) {
  return String(error?.message || error).includes("HTTP 418");
}

function isInAccessDeniedCooldown() {
  return Date.now() < accessDeniedUntil;
}

function markAccessDeniedCooldown() {
  accessDeniedUntil = Date.now() + ACCESS_DENIED_COOLDOWN_MS;
}

function getCooldownRemainingMs() {
  return Math.max(0, accessDeniedUntil - Date.now());
}

function createCooldownError() {
  const seconds = Math.ceil(getCooldownRemainingMs() / 1000);
  return new Error(`ACCESS_DENIED_COOLDOWN:${seconds}`);
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

function normalizeDramaIds(ids) {
  return Array.from(
    new Set(
      (Array.isArray(ids) ? ids : [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  ).slice(0, 200);
}

async function writeUsageLog(entry) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    ...entry,
  };

  console.log("[usage]", JSON.stringify(logEntry));

  try {
    await fs.mkdir(logsDir, { recursive: true });
    await fs.appendFile(
      usageLogPath,
      `${JSON.stringify(logEntry)}\n`,
      "utf8"
    );
  } catch (error) {
    console.error("Failed to write usage log", error);
  }
}

async function fetchJsonWithRetry(url, retries = 2, delayMs = 250) {
  if (isInAccessDeniedCooldown()) {
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
      if (isAccessDeniedError(error)) {
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

async function fetchTextWithRetry(url, retries = 2, delayMs = 250) {
  if (isInAccessDeniedCooldown()) {
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
      if (isAccessDeniedError(error)) {
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
    `https://www.missevan.com/sound/getsound?soundid=${soundId}`
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
      : `https://www.missevan.com/dramaapi/getdrama?drama_id=${dramaId}`
  );

  if (data.success) {
    setCachedValue(dramaCache, cacheKey, data.info);

    const resolvedDramaId = Number(data?.info?.drama?.id ?? dramaId);
    if (resolvedDramaId > 0) {
      setCachedValue(dramaCache, `drama:${resolvedDramaId}`, data.info);
    }

    const resolvedSoundId = Number(
      soundId ?? data?.info?.episodes?.episode?.[0]?.sound_id
    );
    if (resolvedSoundId > 0) {
      setCachedValue(dramaCache, `sound:${resolvedSoundId}`, data.info);
    }
  }

  return data.info;
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
    `https://www.missevan.com/reward/user-reward-rank?period=3&drama_id=${dramaId}`
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
      `https://www.missevan.com/sound/getdm?soundid=${soundId}`
    );
    const lines = text.split("\n").filter((line) => line.includes('<d p='));
    const users = new Set();

    lines.forEach((line) => {
      const match = line.match(/<d p="([^"]+)"/);
      if (match) {
        const uid = match[1].split(",")[6];
        users.add(uid);
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
    console.error(`获取弹幕失败 sound_id=${soundId}: ${message}`);

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
  const { keyword } = req.query;
  const normalizedKeyword = normalizeKeyword(keyword);

  if (!normalizedKeyword) {
    return res.json({ success: false, message: "缺少 keyword 参数" });
  }

  void writeUsageLog({
    action: "search",
    keyword: normalizedKeyword,
  });

  try {
    const data = await fetchJsonWithRetry(
      `https://www.missevan.com/dramaapi/search?s=${encodeURIComponent(
        normalizedKeyword
      )}&page=1`
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
        id: drama.id,
        name: drama.name,
        cover: drama.cover || "",
        view_count: Number(drama.view_count ?? 0),
        playCountWan: formatPlayCountWan(drama.view_count),
        price: Number(drama.price ?? 0),
        sound_id: soundId > 0 ? soundId : null,
        subscription_num: null,
        checked: false,
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
            subscription_num: Number.isFinite(subscriptionNum)
              ? subscriptionNum
              : null,
          };
        } catch (error) {
          console.error(
            `获取追剧人数失败 drama_id=${item.id} sound_id=${item.sound_id}`,
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
      message: "猫耳访问受限",
    });
  }
});

app.post("/getdramacards", async (req, res) => {
  const ids = normalizeDramaIds(req.body.drama_ids || []);
  const results = [];
  const failedIds = [];
  let accessDenied = false;

  if (ids.length) {
    void writeUsageLog({
      action: "manual_import",
      dramaIds: ids,
      count: ids.length,
    });
  }

  for (const id of ids) {
    try {
      const info = await fetchDramaInfo(id);

      if (info?.drama) {
        const drama = info.drama;
        results.push({
          id: drama.id,
          name: drama.name,
          cover: drama.cover || "",
          view_count: Number(drama.view_count ?? 0),
          playCountWan: formatPlayCountWan(drama.view_count),
          price: Number(drama.price ?? 0),
          checked: true,
        });
      } else {
        failedIds.push(Number(id));
      }
    } catch (error) {
      accessDenied =
        accessDenied ||
        isAccessDeniedError(error) ||
        String(error?.message || error).startsWith("ACCESS_DENIED_COOLDOWN:");
      console.error(`获取剧集卡片失败 drama_id=${id}`, error);
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
  const ids = req.body.drama_ids || [];
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
      console.error(`获取剧集失败 drama_id=${id}`, error);
      results.push({ success: false, id, accessDenied });
    }
  }

  return res.json(results);
});

app.post("/getsoundsummary", async (req, res) => {
  const soundIds = req.body.sound_ids || [];
  const results = [];

  for (const soundId of soundIds) {
    try {
      results.push(await fetchSoundSummary(soundId));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`获取单集播放量失败 sound_id=${soundId}`, error);
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
  const dramaId = Number(req.body.drama_id ?? 0);

  if (!dramaId) {
    return res.json({
      success: false,
      drama_id: 0,
      rewardCoinTotal: 0,
      accessDenied: false,
      error: "缺少 drama_id",
    });
  }

  try {
    const result = await fetchRewardSummary(dramaId);
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`获取打赏榜失败 drama_id=${dramaId}`, error);
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
  const { sound_id: soundId, drama_title: dramaTitle = "" } = req.body;

  if (!soundId) {
    return res.json({
      success: false,
      sound_id: 0,
      drama_title: dramaTitle,
      danmaku: 0,
      users: [],
      accessDenied: false,
      error: "缺少 sound_id",
    });
  }

  const result = await fetchDanmakuSummary(soundId, dramaTitle);
  return res.json(result);
});

app.use(express.static(path.join(__dirname, "dist")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(port, () => {
  console.log(`server running on ${port}`);
});
