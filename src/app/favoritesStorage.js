export const FAVORITES_DB_NAME = "mm-toolkit-favorites";
export const FAVORITES_DB_VERSION = 1;
export const FAVORITES_BACKUP_VERSION = 1;
export const FAVORITES_BACKUP_TYPE = "favorites-backup";
export const FAVORITES_APP_ID = "mm-toolkit";
export const DESKTOP_FAVORITES_FILE_NAME = "mm-toolkit-favorites.json";

const FAVORITES_STORE = "favorites";
const SNAPSHOTS_STORE = "snapshots";
const SETTINGS_STORE = "settings";
const VALID_PLATFORMS = new Set(["missevan", "manbo"]);
const DEFAULT_SETTINGS = {
  deltaMetric: "viewCount",
  sortBy: "lastSnapshotAt",
};
let desktopFavoritesCache = null;
let desktopFavoritesLoadPromise = null;
let desktopFavoritesWritePromise = Promise.resolve();

export const FAVORITE_DELTA_METRICS = [
  { key: "viewCount", label: "播放量", platforms: ["missevan", "manbo"] },
  { key: "subscriptionCount", label: "追剧/收藏", platforms: ["missevan", "manbo"] },
  { key: "rewardCount", label: "打赏人数", platforms: ["missevan"] },
  { key: "rewardTotal", label: "打赏/投喂", platforms: ["missevan", "manbo"] },
  { key: "paidOrListenCount", label: "付费/收听人数", platforms: ["manbo"] },
  { key: "paidIdCount", label: "付费 ID 数", platforms: ["missevan", "manbo"] },
];

export const FAVORITE_SORT_OPTIONS = [
  { key: "lastSnapshotAt", label: "最近刷新" },
  { key: "viewCount", label: "最高播放" },
  { key: "subscriptionCount", label: "最高追剧/收藏" },
  { key: "rewardTotal", label: "最高打赏/投喂" },
  { key: "paidIdCount", label: "最高付费 ID" },
];

function normalizePlatform(value) {
  const platform = String(value ?? "").trim();
  return VALID_PLATFORMS.has(platform) ? platform : "";
}

function normalizeString(value) {
  return String(value ?? "").trim();
}

function normalizeTimestamp(value, fallback = 0) {
  const timestamp = Number(value ?? fallback);
  return Number.isFinite(timestamp) && timestamp > 0 ? Math.trunc(timestamp) : fallback;
}

function normalizeOptionalNumber(value) {
  if (value == null || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function normalizeMetricNumber(value) {
  const number = normalizeOptionalNumber(value);
  return number == null ? 0 : number;
}

function normalizeRewardSortYuan(platform, value) {
  const number = normalizeOptionalNumber(value);
  if (number == null) {
    return 0;
  }
  return platform === "manbo" ? number / 100 : number / 10;
}

function normalizeMetrics(metrics = {}) {
  const source = metrics && typeof metrics === "object" ? metrics : {};
  return {
    viewCount: normalizeMetricNumber(source.viewCount),
    subscriptionCount: normalizeMetricNumber(source.subscriptionCount),
    rewardCount: normalizeOptionalNumber(source.rewardCount),
    rewardTotal: normalizeOptionalNumber(source.rewardTotal),
    giftTotal: normalizeOptionalNumber(source.giftTotal),
    paidOrListenCount: normalizeOptionalNumber(source.paidOrListenCount),
    paidIdCount: normalizeMetricNumber(source.paidIdCount),
  };
}

export function createFavoriteKey(platform, dramaId) {
  const normalizedPlatform = normalizePlatform(platform);
  const normalizedDramaId = normalizeString(dramaId);
  return normalizedPlatform && normalizedDramaId ? `${normalizedPlatform}:${normalizedDramaId}` : "";
}

export function normalizeFavoriteRecord(record = {}, options = {}) {
  const platform = normalizePlatform(record.platform);
  const dramaId = normalizeString(record.dramaId ?? record.id);
  const key = createFavoriteKey(platform, dramaId);
  if (!key) {
    return null;
  }

  const now = normalizeTimestamp(options.now, Date.now());
  const createdAt = normalizeTimestamp(record.createdAt, now);
  const updatedAt = normalizeTimestamp(record.updatedAt, createdAt);
  const lastSnapshotAt = normalizeTimestamp(record.lastSnapshotAt, 0);

  return {
    key,
    platform,
    dramaId,
    title: normalizeString(record.title ?? record.name) || `${platform}:${dramaId}`,
    cover: normalizeString(record.cover),
    paymentLabel: normalizeString(record.paymentLabel ?? record.payment_label),
    contentTypeLabel: normalizeString(record.contentTypeLabel ?? record.content_type_label),
    dramaUpdatedAt: normalizeString(record.dramaUpdatedAt ?? record.drama_updated_at ?? record.updated_at),
    mainCvText: normalizeString(record.mainCvText ?? record.main_cv_text),
    createdAt,
    updatedAt,
    lastSnapshotAt,
  };
}

export function normalizeSnapshotRecord(record = {}, options = {}) {
  const platform = normalizePlatform(record.platform);
  const dramaId = normalizeString(record.dramaId ?? record.id);
  const favoriteKey = normalizeString(record.favoriteKey) || createFavoriteKey(platform, dramaId);
  if (!favoriteKey || !platform || !dramaId) {
    return null;
  }
  const capturedAt = normalizeTimestamp(record.capturedAt, normalizeTimestamp(options.now, Date.now()));
  const id = normalizeString(record.id) || `${favoriteKey}:${capturedAt}`;
  if (!id) {
    return null;
  }

  const errors = Array.isArray(record.errors)
    ? record.errors.map((item) => normalizeString(item)).filter(Boolean)
    : [];

  return {
    id,
    favoriteKey,
    platform,
    dramaId,
    capturedAt,
    status: normalizeString(record.status) || (errors.length ? "partial" : "success"),
    metrics: normalizeMetrics(record.metrics),
    errors,
  };
}

export function normalizeFavoriteSettings(settings = {}) {
  const requestedDeltaMetric = settings?.deltaMetric === "giftTotal" ? "rewardTotal" : settings?.deltaMetric;
  const deltaMetric = FAVORITE_DELTA_METRICS.some((item) => item.key === requestedDeltaMetric)
    ? requestedDeltaMetric
    : DEFAULT_SETTINGS.deltaMetric;
  const sortBy = FAVORITE_SORT_OPTIONS.some((item) => item.key === settings?.sortBy)
    ? settings.sortBy
    : DEFAULT_SETTINGS.sortBy;
  return { deltaMetric, sortBy };
}

export function buildFavoritesBackup({
  favorites = [],
  snapshots = [],
  settings = DEFAULT_SETTINGS,
  exportedAt = new Date().toISOString(),
} = {}) {
  return {
    app: FAVORITES_APP_ID,
    type: FAVORITES_BACKUP_TYPE,
    version: FAVORITES_BACKUP_VERSION,
    exportedAt,
    favorites: favorites.map((item) => normalizeFavoriteRecord(item)).filter(Boolean),
    snapshots: snapshots.map((item) => normalizeSnapshotRecord(item)).filter(Boolean),
    settings: normalizeFavoriteSettings(settings),
  };
}

export function normalizeFavoritesBackup(payload = {}) {
  if (
    !payload ||
    typeof payload !== "object" ||
    payload.app !== FAVORITES_APP_ID ||
    payload.type !== FAVORITES_BACKUP_TYPE ||
    Number(payload.version) !== FAVORITES_BACKUP_VERSION
  ) {
    throw new Error("收藏备份文件格式不正确");
  }

  const favoritesByKey = new Map();
  (Array.isArray(payload.favorites) ? payload.favorites : []).forEach((item) => {
    const favorite = normalizeFavoriteRecord(item);
    if (!favorite) {
      return;
    }
    const previous = favoritesByKey.get(favorite.key);
    if (!previous || Number(favorite.updatedAt) >= Number(previous.updatedAt)) {
      favoritesByKey.set(favorite.key, favorite);
    }
  });

  const snapshotsById = new Map();
  (Array.isArray(payload.snapshots) ? payload.snapshots : []).forEach((item) => {
    const snapshot = normalizeSnapshotRecord(item);
    if (snapshot) {
      snapshotsById.set(snapshot.id, snapshot);
    }
  });

  return {
    favorites: Array.from(favoritesByKey.values()),
    snapshots: Array.from(snapshotsById.values()),
    settings: normalizeFavoriteSettings(payload.settings),
  };
}

export function shouldMigrateFavoritesBackupToDesktopJson(state = {}) {
  if (!state?.exists) {
    return true;
  }
  try {
    const normalized = normalizeFavoritesBackup(state.data);
    return normalized.favorites.length === 0 && normalized.snapshots.length === 0;
  } catch (_) {
    return true;
  }
}

function isDesktopFavoritesStorageEnabled() {
  return typeof window !== "undefined" && Boolean(window.desktopFavorites);
}

function buildEmptyFavoritesBackup() {
  return buildFavoritesBackup({
    favorites: [],
    snapshots: [],
    settings: DEFAULT_SETTINGS,
  });
}

function hasFavoritesBackupContent(backup) {
  const normalized = normalizeFavoritesBackup(backup);
  return normalized.favorites.length > 0 || normalized.snapshots.length > 0;
}

async function fetchDesktopFavoritesState() {
  const response = await fetch("/desktop/favorites-data", {
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok || !data?.success) {
    throw new Error(data?.message || "读取桌面收藏 JSON 失败");
  }
  return data;
}

async function writeDesktopFavoritesBackup(backup) {
  const normalized = normalizeFavoritesBackup(buildFavoritesBackup(backup));
  const response = await fetch("/desktop/favorites-data", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildFavoritesBackup(normalized)),
  });
  const data = await response.json();
  if (!response.ok || !data?.success) {
    throw new Error(data?.message || "写入桌面收藏 JSON 失败");
  }
  desktopFavoritesCache = normalizeFavoritesBackup(data.data || buildFavoritesBackup(normalized));
  return desktopFavoritesCache;
}

export function getSnapshotsForFavorite(favoriteKey, snapshots = []) {
  const normalizedKey = normalizeString(favoriteKey);
  return (Array.isArray(snapshots) ? snapshots : [])
    .map((item) => normalizeSnapshotRecord(item))
    .filter((item) => item && item.favoriteKey === normalizedKey)
    .sort((left, right) => Number(right.capturedAt) - Number(left.capturedAt));
}

export function getLatestSnapshot(favoriteKey, snapshots = []) {
  return getSnapshotsForFavorite(favoriteKey, snapshots)[0] || null;
}

export function getSnapshotIdsForFavoriteRemoval(favoriteKey, snapshots = []) {
  const normalizedKey = normalizeString(favoriteKey);
  if (!normalizedKey) {
    return [];
  }
  return (Array.isArray(snapshots) ? snapshots : [])
    .map((item) => normalizeSnapshotRecord(item))
    .filter((item) => item && item.favoriteKey === normalizedKey)
    .map((item) => item.id);
}

export function getFavoriteDelta(favoriteKey, snapshots = [], metricKey = DEFAULT_SETTINGS.deltaMetric) {
  const sorted = getSnapshotsForFavorite(favoriteKey, snapshots);
  if (sorted.length < 2) {
    return null;
  }
  const resolvedMetricKey = resolveFavoriteMetricKey(sorted[0]?.platform, metricKey);
  const latest = normalizeOptionalNumber(sorted[0]?.metrics?.[resolvedMetricKey]);
  const previous = normalizeOptionalNumber(sorted[1]?.metrics?.[resolvedMetricKey]);
  if (latest == null || previous == null) {
    return null;
  }
  return latest - previous;
}

export function resolveFavoriteMetricKey(platform, metricKey) {
  const key = normalizeString(metricKey);
  const normalizedPlatform = normalizePlatform(platform);
  if (key === "rewardTotal" && normalizedPlatform === "manbo") {
    return "giftTotal";
  }
  if (key === "giftTotal" && normalizedPlatform === "missevan") {
    return "rewardTotal";
  }
  return key;
}

function getSortMetricValue(favorite, snapshots, sortBy) {
  const latest = getLatestSnapshot(favorite.key, snapshots);
  if (sortBy === "lastSnapshotAt") {
    return Number(latest?.capturedAt ?? favorite.lastSnapshotAt ?? 0) || 0;
  }
  if (sortBy === "rewardTotal") {
    const rewardTotal = normalizeOptionalNumber(latest?.metrics?.rewardTotal);
    const giftTotal = normalizeOptionalNumber(latest?.metrics?.giftTotal);
    return normalizeRewardSortYuan(favorite.platform, favorite.platform === "manbo" ? giftTotal : rewardTotal);
  }
  return normalizeOptionalNumber(latest?.metrics?.[sortBy]) ?? 0;
}

export function sortFavoritesWithSnapshots(favorites = [], snapshots = [], sortBy = DEFAULT_SETTINGS.sortBy) {
  const normalizedSort = FAVORITE_SORT_OPTIONS.some((item) => item.key === sortBy)
    ? sortBy
    : DEFAULT_SETTINGS.sortBy;
  return (Array.isArray(favorites) ? favorites : [])
    .map((item) => normalizeFavoriteRecord(item))
    .filter(Boolean)
    .sort((left, right) => {
      const diff = getSortMetricValue(right, snapshots, normalizedSort) - getSortMetricValue(left, snapshots, normalizedSort);
      if (diff !== 0) {
        return diff;
      }
      return left.title.localeCompare(right.title, "zh-Hans-CN");
    });
}

function getIndexedDb() {
  if (typeof window === "undefined") {
    return null;
  }
  return window.indexedDB || null;
}

function openFavoritesDb() {
  const indexedDb = getIndexedDb();
  if (!indexedDb) {
    return Promise.reject(new Error("当前浏览器不支持 IndexedDB"));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDb.open(FAVORITES_DB_NAME, FAVORITES_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FAVORITES_STORE)) {
        const store = db.createObjectStore(FAVORITES_STORE, { keyPath: "key" });
        store.createIndex("platform", "platform");
        store.createIndex("updatedAt", "updatedAt");
        store.createIndex("lastSnapshotAt", "lastSnapshotAt");
      }
      if (!db.objectStoreNames.contains(SNAPSHOTS_STORE)) {
        const store = db.createObjectStore(SNAPSHOTS_STORE, { keyPath: "id" });
        store.createIndex("favoriteKey", "favoriteKey");
        store.createIndex("capturedAt", "capturedAt");
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("打开收藏数据库失败"));
  });
}

function runStore(storeName, mode, runner) {
  return openFavoritesDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try {
      result = runner(store);
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("收藏数据库操作失败"));
    };
  }));
}

function runStores(storeNames, mode, runner) {
  return openFavoritesDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    const stores = {};
    storeNames.forEach((storeName) => {
      stores[`${storeName}Store`] = tx.objectStore(storeName);
    });
    let result;
    try {
      result = runner(stores);
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("收藏数据库操作失败"));
    };
  }));
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("收藏数据库读取失败"));
  });
}

function deleteSnapshotsForFavorite(store, favoriteKey) {
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => {
      const ids = getSnapshotIdsForFavoriteRemoval(favoriteKey, request.result);
      ids.forEach((id) => {
        store.delete(id);
      });
      resolve(ids);
    };
    request.onerror = () => reject(request.error || new Error("收藏统计记录删除失败"));
  });
}

async function listIndexedDbFavorites() {
  return runStore(FAVORITES_STORE, "readonly", (store) => requestToPromise(store.getAll()));
}

async function getIndexedDbFavoriteByKey(key) {
  const normalizedKey = normalizeString(key);
  if (!normalizedKey) {
    return null;
  }
  return runStore(FAVORITES_STORE, "readonly", async (store) => {
    const result = await requestToPromise(store.get(normalizedKey));
    return normalizeFavoriteRecord(result);
  });
}

async function saveIndexedDbFavorite(record) {
  const favorite = normalizeFavoriteRecord(record);
  if (!favorite) {
    throw new Error("收藏作品数据不完整");
  }
  await runStore(FAVORITES_STORE, "readwrite", (store) => {
    store.put(favorite);
  });
  return favorite;
}

async function updateIndexedDbFavoriteIfExists(key, updater) {
  const normalizedKey = normalizeString(key);
  if (!normalizedKey) {
    return null;
  }
  return runStore(FAVORITES_STORE, "readwrite", (store) => new Promise((resolve, reject) => {
    const request = store.get(normalizedKey);
    request.onsuccess = () => {
      const activeFavorite = normalizeFavoriteRecord(request.result);
      if (!activeFavorite) {
        resolve(null);
        return;
      }

      let nextRecord;
      try {
        nextRecord = typeof updater === "function" ? updater(activeFavorite) : { ...activeFavorite, ...(updater || {}) };
      } catch (error) {
        reject(error);
        return;
      }

      const nextFavorite = normalizeFavoriteRecord(nextRecord);
      if (!nextFavorite || nextFavorite.key !== activeFavorite.key) {
        reject(new Error("收藏作品更新数据不完整"));
        return;
      }

      store.put(nextFavorite);
      resolve(nextFavorite);
    };
    request.onerror = () => reject(request.error || new Error("收藏数据库读取失败"));
  }));
}

async function removeIndexedDbFavoriteWithSnapshots(platform, dramaId) {
  const key = createFavoriteKey(platform, dramaId);
  if (!key) {
    return { key: "", deletedSnapshotCount: 0 };
  }
  await runStore(FAVORITES_STORE, "readwrite", (store) => {
    store.delete(key);
  });
  const deletedSnapshotIds = await runStore(SNAPSHOTS_STORE, "readwrite", (store) => deleteSnapshotsForFavorite(store, key));
  return { key, deletedSnapshotCount: deletedSnapshotIds.length };
}

async function listIndexedDbSnapshots() {
  return runStore(SNAPSHOTS_STORE, "readonly", (store) => requestToPromise(store.getAll()));
}

async function saveIndexedDbSnapshot(record) {
  const snapshot = normalizeSnapshotRecord(record);
  if (!snapshot) {
    throw new Error("收藏快照数据不完整");
  }

  return runStores([FAVORITES_STORE, SNAPSHOTS_STORE], "readwrite", ({ favoritesStore, snapshotsStore }) => new Promise((resolve, reject) => {
    const request = favoritesStore.get(snapshot.favoriteKey);
    request.onsuccess = () => {
      const favorite = normalizeFavoriteRecord(request.result);
      if (!favorite) {
        resolve(null);
        return;
      }

      snapshotsStore.put(snapshot);
      favoritesStore.put({
        ...favorite,
        lastSnapshotAt: snapshot.capturedAt,
      });
      resolve(snapshot);
    };
    request.onerror = () => reject(request.error || new Error("收藏数据库读取失败"));
  }));
}

async function loadIndexedDbFavoriteSettings() {
  return runStore(SETTINGS_STORE, "readonly", async (store) => {
    const result = await requestToPromise(store.get("favorites"));
    return normalizeFavoriteSettings(result?.value);
  });
}

async function saveIndexedDbFavoriteSettings(settings) {
  const value = normalizeFavoriteSettings(settings);
  await runStore(SETTINGS_STORE, "readwrite", (store) => {
    store.put({ key: "favorites", value });
  });
  return value;
}

async function exportIndexedDbFavoritesData() {
  const [favorites, snapshots, settings] = await Promise.all([
    listIndexedDbFavorites(),
    listIndexedDbSnapshots(),
    loadIndexedDbFavoriteSettings(),
  ]);
  return buildFavoritesBackup({ favorites, snapshots, settings });
}

async function importIndexedDbFavoritesData(payload) {
  const normalized = payload;
  await Promise.all(normalized.favorites.map((favorite) => saveIndexedDbFavorite(favorite)));
  await Promise.all(normalized.snapshots.map((snapshot) => saveIndexedDbSnapshot(snapshot)));
  await saveIndexedDbFavoriteSettings(normalized.settings);
  return normalized;
}

async function exportIndexedDbFavoritesDataIfAvailable() {
  try {
    return await exportIndexedDbFavoritesData();
  } catch (_) {
    return buildEmptyFavoritesBackup();
  }
}

async function loadDesktopFavoritesBackup({ force = false } = {}) {
  if (desktopFavoritesCache && !force) {
    return desktopFavoritesCache;
  }
  if (desktopFavoritesLoadPromise && !force) {
    return desktopFavoritesLoadPromise;
  }

  desktopFavoritesLoadPromise = (async () => {
    const state = await fetchDesktopFavoritesState();
    let backup;
    try {
      backup = normalizeFavoritesBackup(state.data);
    } catch (_) {
      backup = normalizeFavoritesBackup(buildEmptyFavoritesBackup());
    }

    if (shouldMigrateFavoritesBackupToDesktopJson(state)) {
      const indexedDbBackup = await exportIndexedDbFavoritesDataIfAvailable();
      backup = hasFavoritesBackupContent(indexedDbBackup)
        ? normalizeFavoritesBackup(indexedDbBackup)
        : backup;
      await writeDesktopFavoritesBackup(backup);
    }

    desktopFavoritesCache = backup;
    desktopFavoritesLoadPromise = null;
    return backup;
  })();

  try {
    return await desktopFavoritesLoadPromise;
  } catch (error) {
    desktopFavoritesLoadPromise = null;
    throw error;
  }
}

async function updateDesktopFavoritesBackup(updater) {
  const queuedWrite = desktopFavoritesWritePromise.catch(() => null).then(async () => {
    const current = await loadDesktopFavoritesBackup();
    const next = typeof updater === "function" ? updater(current) : current;
    return writeDesktopFavoritesBackup(next);
  });
  desktopFavoritesWritePromise = queuedWrite.catch(() => null);
  return queuedWrite;
}

function mergeFavoriteLists(existingFavorites = [], incomingFavorites = []) {
  const favoritesByKey = new Map();
  [...existingFavorites, ...incomingFavorites].forEach((item) => {
    const favorite = normalizeFavoriteRecord(item);
    if (!favorite) {
      return;
    }
    const previous = favoritesByKey.get(favorite.key);
    if (!previous || Number(favorite.updatedAt) >= Number(previous.updatedAt)) {
      favoritesByKey.set(favorite.key, favorite);
    }
  });
  return Array.from(favoritesByKey.values());
}

function mergeSnapshotLists(existingSnapshots = [], incomingSnapshots = []) {
  const snapshotsById = new Map();
  [...existingSnapshots, ...incomingSnapshots].forEach((item) => {
    const snapshot = normalizeSnapshotRecord(item);
    if (snapshot) {
      snapshotsById.set(snapshot.id, snapshot);
    }
  });
  return Array.from(snapshotsById.values());
}

export async function listFavorites() {
  if (!isDesktopFavoritesStorageEnabled()) {
    return listIndexedDbFavorites();
  }
  return (await loadDesktopFavoritesBackup()).favorites;
}

export async function getFavoriteByKey(key) {
  const normalizedKey = normalizeString(key);
  if (!normalizedKey) {
    return null;
  }
  if (!isDesktopFavoritesStorageEnabled()) {
    return getIndexedDbFavoriteByKey(normalizedKey);
  }
  const backup = await loadDesktopFavoritesBackup();
  return backup.favorites.find((favorite) => favorite.key === normalizedKey) || null;
}

export async function saveFavorite(record) {
  const favorite = normalizeFavoriteRecord(record);
  if (!favorite) {
    throw new Error("收藏作品数据不完整");
  }
  if (!isDesktopFavoritesStorageEnabled()) {
    return saveIndexedDbFavorite(favorite);
  }
  await updateDesktopFavoritesBackup((current) => ({
    ...current,
    favorites: mergeFavoriteLists(
      current.favorites.filter((item) => item.key !== favorite.key),
      [favorite]
    ),
  }));
  return favorite;
}

export async function updateFavoriteIfExists(key, updater) {
  const normalizedKey = normalizeString(key);
  if (!normalizedKey) {
    return null;
  }
  if (!isDesktopFavoritesStorageEnabled()) {
    return updateIndexedDbFavoriteIfExists(normalizedKey, updater);
  }

  let updatedFavorite = null;
  await updateDesktopFavoritesBackup((current) => {
    const activeFavorite = current.favorites.find((favorite) => favorite.key === normalizedKey);
    if (!activeFavorite) {
      return current;
    }
    const nextRecord = typeof updater === "function" ? updater(activeFavorite) : { ...activeFavorite, ...(updater || {}) };
    const nextFavorite = normalizeFavoriteRecord(nextRecord);
    if (!nextFavorite || nextFavorite.key !== activeFavorite.key) {
      throw new Error("收藏作品更新数据不完整");
    }
    updatedFavorite = nextFavorite;
    return {
      ...current,
      favorites: current.favorites.map((favorite) => (favorite.key === normalizedKey ? nextFavorite : favorite)),
    };
  });
  return updatedFavorite;
}

export async function removeFavoriteWithSnapshots(platform, dramaId) {
  if (!isDesktopFavoritesStorageEnabled()) {
    return removeIndexedDbFavoriteWithSnapshots(platform, dramaId);
  }
  const key = createFavoriteKey(platform, dramaId);
  if (!key) {
    return { key: "", deletedSnapshotCount: 0 };
  }
  let deletedSnapshotCount = 0;
  await updateDesktopFavoritesBackup((current) => {
    const nextSnapshots = current.snapshots.filter((snapshot) => {
      const shouldDelete = snapshot.favoriteKey === key;
      if (shouldDelete) {
        deletedSnapshotCount += 1;
      }
      return !shouldDelete;
    });
    return {
      ...current,
      favorites: current.favorites.filter((favorite) => favorite.key !== key),
      snapshots: nextSnapshots,
    };
  });
  return { key, deletedSnapshotCount };
}

export async function listSnapshots() {
  if (!isDesktopFavoritesStorageEnabled()) {
    return listIndexedDbSnapshots();
  }
  return (await loadDesktopFavoritesBackup()).snapshots;
}

export async function saveSnapshot(record) {
  const snapshot = normalizeSnapshotRecord(record);
  if (!snapshot) {
    throw new Error("收藏快照数据不完整");
  }
  if (!isDesktopFavoritesStorageEnabled()) {
    return saveIndexedDbSnapshot(snapshot);
  }

  let savedSnapshot = null;
  await updateDesktopFavoritesBackup((current) => {
    const activeFavorite = current.favorites.find((favorite) => favorite.key === snapshot.favoriteKey);
    if (!activeFavorite) {
      return current;
    }
    savedSnapshot = snapshot;
    return {
      ...current,
      favorites: current.favorites.map((favorite) =>
        favorite.key === snapshot.favoriteKey
          ? { ...favorite, lastSnapshotAt: snapshot.capturedAt }
          : favorite
      ),
      snapshots: mergeSnapshotLists(
        current.snapshots.filter((item) => item.id !== snapshot.id),
        [snapshot]
      ),
    };
  });
  return savedSnapshot;
}

export async function loadFavoriteSettings() {
  if (!isDesktopFavoritesStorageEnabled()) {
    return loadIndexedDbFavoriteSettings();
  }
  return normalizeFavoriteSettings((await loadDesktopFavoritesBackup()).settings);
}

export async function saveFavoriteSettings(settings) {
  const value = normalizeFavoriteSettings(settings);
  if (!isDesktopFavoritesStorageEnabled()) {
    return saveIndexedDbFavoriteSettings(value);
  }
  await updateDesktopFavoritesBackup((current) => ({
    ...current,
    settings: value,
  }));
  return value;
}

export async function exportFavoritesData() {
  if (!isDesktopFavoritesStorageEnabled()) {
    return exportIndexedDbFavoritesData();
  }
  return buildFavoritesBackup(await loadDesktopFavoritesBackup());
}

export async function importFavoritesData(payload) {
  const normalized = normalizeFavoritesBackup(payload);
  if (!isDesktopFavoritesStorageEnabled()) {
    return importIndexedDbFavoritesData(normalized);
  }
  await updateDesktopFavoritesBackup((current) => ({
    favorites: mergeFavoriteLists(current.favorites, normalized.favorites),
    snapshots: mergeSnapshotLists(current.snapshots, normalized.snapshots),
    settings: normalizeFavoriteSettings(normalized.settings),
  }));
  return normalized;
}
