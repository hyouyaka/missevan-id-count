import test from "node:test";
import assert from "node:assert/strict";

import {
  FAVORITE_DELTA_METRICS,
  FAVORITES_HISTORY_CSV_COLUMNS,
  FAVORITES_BACKUP_VERSION,
  DESKTOP_FAVORITES_FILE_NAME,
  buildFavoritesBackup,
  buildFavoritesHistoryCsvRows,
  createFavoriteKey,
  filterFavorites,
  getFavoriteDelta,
  getLatestMetricReading,
  getLatestSnapshot,
  getSnapshotIdsForFavoriteRemoval,
  normalizeFavoriteRecord,
  normalizeFavoritesBackup,
  normalizeFavoriteSettings,
  normalizeSnapshotRecord,
  importFavoritesData,
  listFavorites,
  listSnapshots,
  loadFavoriteSettings,
  saveFavorite,
  serializeFavoritesHistoryCsv,
  shouldMigrateFavoritesBackupToDesktopJson,
  sortFavoritesWithSnapshots,
} from "./favoritesStorage.js";

function createSnapshot(overrides = {}) {
  return {
    id: "missevan:93038:1770000000000",
    favoriteKey: "missevan:93038",
    platform: "missevan",
    dramaId: "93038",
    capturedAt: 1770000000000,
    status: "success",
    metrics: {
      viewCount: 3648898,
      subscriptionCount: 111113,
      rewardCount: 4354,
      rewardTotal: 446514,
      giftTotal: null,
      paidOrListenCount: null,
      paidIdCount: 7221,
    },
    metricErrors: {},
    errors: [],
    ...overrides,
  };
}

function createFakeIndexedDb() {
  const stores = new Map();
  const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));

  function makeRequest(result) {
    const request = { result: undefined, error: null, onsuccess: null, onerror: null };
    queueMicrotask(() => {
      request.result = clone(result);
      request.onsuccess?.();
    });
    return request;
  }

  function makeStore(storeState) {
    return {
      createIndex() {},
      put(value) {
        storeState.records.set(value[storeState.keyPath], clone(value));
        return makeRequest(undefined);
      },
      get(key) {
        return makeRequest(storeState.records.get(key));
      },
      getAll() {
        return makeRequest(Array.from(storeState.records.values()));
      },
      delete(key) {
        storeState.records.delete(key);
        return makeRequest(undefined);
      },
    };
  }

  const db = {
    objectStoreNames: {
      contains(name) {
        return stores.has(name);
      },
    },
    createObjectStore(name, options = {}) {
      const storeState = { keyPath: options.keyPath || "key", records: new Map() };
      stores.set(name, storeState);
      return makeStore(storeState);
    },
    transaction(storeNames) {
      const tx = {
        error: null,
        oncomplete: null,
        onerror: null,
        objectStore(name) {
          return makeStore(stores.get(name));
        },
      };
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    },
    close() {},
  };

  return {
    open() {
      const request = { result: db, error: null, onupgradeneeded: null, onsuccess: null, onerror: null };
      queueMicrotask(() => {
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
}

test("normalizeFavoriteRecord creates a stable platform id key", () => {
  assert.equal(createFavoriteKey("missevan", 93038), "missevan:93038");

  assert.deepEqual(
    normalizeFavoriteRecord({
      platform: "missevan",
      dramaId: 93038,
      title: " 一屋暗灯 第一季 ",
      cover: "https://example.com/cover.jpg",
      paymentLabel: "付费",
      contentTypeLabel: "广播剧",
      dramaUpdatedAt: "2026-05-17T01:00:00.000Z",
      mainCvText: "主要CV：倒霉死勒，袁铭喆",
      createdAt: 1770000000000,
    }),
    {
      key: "missevan:93038",
      platform: "missevan",
      dramaId: "93038",
      title: "一屋暗灯 第一季",
      cover: "https://example.com/cover.jpg",
      paymentLabel: "付费",
      contentTypeLabel: "广播剧",
      dramaUpdatedAt: "2026-05-17T01:00:00.000Z",
      mainCvText: "主要CV：倒霉死勒，袁铭喆",
      createdAt: 1770000000000,
      updatedAt: 1770000000000,
      lastSnapshotAt: 0,
    }
  );
});

test("buildFavoritesBackup emits tool-readable versioned JSON payloads", () => {
  const favorite = normalizeFavoriteRecord({
    platform: "manbo",
    dramaId: "1467142227078676553",
    title: "奇洛李维斯回信",
  });
  const snapshot = createSnapshot({
    id: "manbo:1467142227078676553:1770000000000",
    favoriteKey: "manbo:1467142227078676553",
    platform: "manbo",
    dramaId: "1467142227078676553",
    status: "partial",
    metrics: { paidIdCount: null },
    metricErrors: { paidIdCount: "付费 ID 读取失败" },
    errors: ["付费 ID 读取失败"],
  });

  const backup = buildFavoritesBackup({
    favorites: [favorite],
    snapshots: [snapshot],
    settings: { deltaMetric: "paidIdCount", sortBy: "paidIdCount" },
    exportedAt: "2026-05-19T00:00:00.000Z",
  });

  assert.equal(backup.app, "mm-toolkit");
  assert.equal(backup.type, "favorites-backup");
  assert.equal(backup.version, FAVORITES_BACKUP_VERSION);
  assert.equal(backup.exportedAt, "2026-05-19T00:00:00.000Z");
  assert.equal(backup.favorites[0].key, "manbo:1467142227078676553");
  assert.equal(backup.favorites[0].dramaUpdatedAt, "");
  assert.equal(backup.snapshots[0].favoriteKey, "manbo:1467142227078676553");
  assert.deepEqual(backup.snapshots[0].metricErrors, { paidIdCount: "付费 ID 读取失败" });
  assert.deepEqual(backup.settings, { deltaMetric: "paidIdCount", sortBy: "paidIdCount" });
});

test("normalizeFavoritesBackup rejects unknown backup shapes and dedupes records", () => {
  assert.throws(
    () => normalizeFavoritesBackup({ app: "mm-toolkit", type: "wrong", version: 1 }),
    /收藏备份文件格式不正确/
  );

  const parsed = normalizeFavoritesBackup({
    app: "mm-toolkit",
    type: "favorites-backup",
    version: 1,
    favorites: [
      { platform: "missevan", dramaId: "93038", title: "旧标题", dramaUpdatedAt: "2026-05-16T01:00:00.000Z", updatedAt: 1 },
      { platform: "missevan", dramaId: "93038", title: "新标题", dramaUpdatedAt: "2026-05-17T01:00:00.000Z", updatedAt: 2 },
    ],
    snapshots: [
      createSnapshot({ capturedAt: 1 }),
      createSnapshot({ capturedAt: 1, metrics: { viewCount: 2 } }),
    ],
    settings: { deltaMetric: "rewardTotal", sortBy: "rewardTotal" },
  });

  assert.equal(parsed.favorites.length, 1);
  assert.equal(parsed.favorites[0].title, "新标题");
  assert.equal(parsed.favorites[0].dramaUpdatedAt, "2026-05-17T01:00:00.000Z");
  assert.equal(parsed.snapshots.length, 1);
  assert.equal(parsed.snapshots[0].metrics.viewCount, 2);
  assert.deepEqual(parsed.snapshots[0].metricErrors, {});
  assert.deepEqual(parsed.settings, { deltaMetric: "rewardTotal", sortBy: "rewardTotal" });
});

test("browser favorites import accepts exported backup payloads", async () => {
  const originalWindow = globalThis.window;
  const favorite = normalizeFavoriteRecord({
    platform: "missevan",
    dramaId: "93038",
    title: "一屋暗灯",
  });
  const snapshot = createSnapshot({
    id: "missevan:93038:1770000000000",
    favoriteKey: favorite.key,
  });
  const backup = buildFavoritesBackup({
    favorites: [favorite],
    snapshots: [snapshot],
    settings: { deltaMetric: "rewardTotal", sortBy: "paidIdCount" },
    exportedAt: "2026-05-23T00:13:45.776Z",
  });
  globalThis.window = { indexedDB: createFakeIndexedDb() };

  try {
    const imported = await importFavoritesData(backup);
    const favorites = await listFavorites();
    const snapshots = await listSnapshots();
    const settings = await loadFavoriteSettings();

    assert.equal(imported.favorites.length, 1);
    assert.equal(favorites[0].key, favorite.key);
    assert.equal(snapshots[0].id, snapshot.id);
    assert.deepEqual(settings, { deltaMetric: "rewardTotal", sortBy: "paidIdCount" });
  } finally {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test("browser favorites import merges history without regressing newer local metadata", async () => {
  const originalWindow = globalThis.window;
  const currentFavorite = normalizeFavoriteRecord({
    platform: "missevan",
    dramaId: "93038",
    title: "本地新标题",
    createdAt: 100,
    updatedAt: 300,
    lastSnapshotAt: 200,
  });
  const olderIncomingFavorite = normalizeFavoriteRecord({
    ...currentFavorite,
    title: "备份旧标题",
    updatedAt: 150,
    lastSnapshotAt: 400,
  });
  const currentSnapshot = createSnapshot({
    id: `${currentFavorite.key}:200`,
    capturedAt: 200,
  });
  const incomingSnapshot = createSnapshot({
    id: `${currentFavorite.key}:400`,
    capturedAt: 400,
    metrics: { viewCount: 400 },
  });
  globalThis.window = { indexedDB: createFakeIndexedDb() };

  try {
    await importFavoritesData(buildFavoritesBackup({
      favorites: [currentFavorite],
      snapshots: [currentSnapshot],
    }));
    await importFavoritesData(buildFavoritesBackup({
      favorites: [olderIncomingFavorite],
      snapshots: [incomingSnapshot],
    }));
    const favorites = await listFavorites();
    const snapshots = await listSnapshots();

    assert.equal(favorites.length, 1);
    assert.equal(favorites[0].title, "本地新标题");
    assert.equal(favorites[0].lastSnapshotAt, 400);
    assert.deepEqual(snapshots.map((item) => item.capturedAt).sort((a, b) => a - b), [200, 400]);
  } finally {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test("favorite removal targets every snapshot for the removed work", () => {
  const snapshots = [
    createSnapshot({ id: "missevan:93038:10", favoriteKey: "missevan:93038", capturedAt: 10 }),
    createSnapshot({ id: "missevan:93038:20", favoriteKey: "missevan:93038", capturedAt: 20 }),
    createSnapshot({
      id: "manbo:1467142227078676553:30",
      favoriteKey: "manbo:1467142227078676553",
      platform: "manbo",
      dramaId: "1467142227078676553",
      capturedAt: 30,
    }),
  ];

  assert.deepEqual(getSnapshotIdsForFavoriteRemoval("missevan:93038", snapshots), [
    "missevan:93038:10",
    "missevan:93038:20",
  ]);
});

test("snapshot helpers calculate latest records, deltas, and favorite ordering", () => {
  const favoriteA = normalizeFavoriteRecord({
    platform: "missevan",
    dramaId: "93038",
    title: "一屋暗灯",
    dramaUpdatedAt: "2026-05-21T00:00:00.000Z",
  });
  const favoriteB = normalizeFavoriteRecord({
    platform: "manbo",
    dramaId: "1467142227078676553",
    title: "奇洛李维斯回信",
    dramaUpdatedAt: "2026-05-20T00:00:00.000Z",
  });
  const snapshots = [
    createSnapshot({ id: "missevan:93038:10", capturedAt: 10, metrics: { viewCount: 100, paidIdCount: 5 } }),
    createSnapshot({ id: "missevan:93038:20", capturedAt: 20, metrics: { viewCount: 160, paidIdCount: 7 } }),
    createSnapshot({
      id: "manbo:1467142227078676553:30",
      favoriteKey: "manbo:1467142227078676553",
      platform: "manbo",
      dramaId: "1467142227078676553",
      capturedAt: 30,
      metrics: { viewCount: 80, paidIdCount: 30 },
    }),
  ];

  assert.equal(getLatestSnapshot(favoriteA.key, snapshots).capturedAt, 20);
  assert.equal(getFavoriteDelta(favoriteA.key, snapshots, "viewCount"), 60);
  assert.equal(getFavoriteDelta(favoriteB.key, snapshots, "viewCount"), null);

  const sortedById = sortFavoritesWithSnapshots([favoriteA, favoriteB], snapshots, "paidIdCount");
  assert.deepEqual(sortedById.map((item) => item.key), [favoriteB.key, favoriteA.key]);

  const sortedByUpdated = sortFavoritesWithSnapshots([favoriteA, favoriteB], snapshots, "lastSnapshotAt");
  assert.deepEqual(sortedByUpdated.map((item) => item.key), [favoriteB.key, favoriteA.key]);
});

test("snapshot normalization preserves real zeroes and keeps unavailable metrics nullable", () => {
  const snapshot = normalizeSnapshotRecord(createSnapshot({
    status: "partial",
    metrics: {
      viewCount: 0,
      subscriptionCount: null,
      paidIdCount: 0,
    },
    metricErrors: {
      subscriptionCount: "追剧人数读取失败",
      unknownMetric: "不应保留",
    },
    errors: ["追剧人数读取失败"],
  }));

  assert.equal(snapshot.metrics.viewCount, 0);
  assert.equal(snapshot.metrics.paidIdCount, 0);
  assert.equal(snapshot.metrics.subscriptionCount, null);
  assert.equal(snapshot.metrics.rewardTotal, null);
  assert.deepEqual(snapshot.metricErrors, { subscriptionCount: "追剧人数读取失败" });

  const failedSnapshot = normalizeSnapshotRecord(createSnapshot({
    status: "failed",
    metrics: { viewCount: 0, subscriptionCount: 0, paidIdCount: 0 },
    errors: ["旧版失败记录"],
  }));
  assert.deepEqual(
    Object.values(failedSnapshot.metrics),
    [null, null, null, null, null, null, null],
    "failed snapshots from older backups must not retain synthetic zero metrics"
  );
  assert.equal(
    normalizeSnapshotRecord(createSnapshot({ capturedAt: 1e20 }), { now: 1234 }).capturedAt,
    1234,
    "out-of-range imported timestamps should not crash date rendering or CSV export"
  );
  assert.equal(
    normalizeSnapshotRecord(createSnapshot({ capturedAt: 1e20 })),
    null,
    "invalid imported timestamps should not be silently rewritten as the current time"
  );
  assert.equal(
    normalizeSnapshotRecord(createSnapshot({ favoriteKey: "manbo:93038" })),
    null,
    "snapshot platform, drama id, and favorite key must describe the same work"
  );
});

test("favorite metric readings and deltas skip failed or missing snapshots", () => {
  const favorite = normalizeFavoriteRecord({
    platform: "missevan",
    dramaId: "93038",
    title: "一屋暗灯",
  });
  const snapshots = [
    createSnapshot({ id: `${favorite.key}:10`, capturedAt: 10, metrics: { viewCount: 100 } }),
    createSnapshot({
      id: `${favorite.key}:20`,
      capturedAt: 20,
      status: "failed",
      metrics: {},
      errors: ["作品详情读取失败"],
    }),
    createSnapshot({
      id: `${favorite.key}:30`,
      capturedAt: 30,
      status: "partial",
      metrics: { viewCount: 160 },
      metricErrors: { paidIdCount: "付费 ID 读取失败" },
      errors: ["付费 ID 读取失败"],
    }),
    createSnapshot({
      id: `${favorite.key}:40`,
      capturedAt: 40,
      status: "failed",
      metrics: {},
      errors: ["网络错误"],
    }),
  ];

  const reading = getLatestMetricReading(favorite.key, snapshots, "viewCount");
  assert.equal(getLatestSnapshot(favorite.key, snapshots).capturedAt, 40);
  assert.equal(reading.snapshot.capturedAt, 30);
  assert.equal(reading.value, 160);
  assert.equal(getFavoriteDelta(favorite.key, snapshots, "viewCount"), 60);
  assert.equal(getLatestMetricReading(favorite.key, snapshots, "paidIdCount").value, null);
});

test("metric sorting uses the latest valid value while recent refresh uses the latest attempt", () => {
  const favoriteA = normalizeFavoriteRecord({ platform: "missevan", dramaId: "93038", title: "有效值较高" });
  const favoriteB = normalizeFavoriteRecord({ platform: "manbo", dramaId: "1467142227078676553", title: "有效值较低" });
  const snapshots = [
    createSnapshot({ id: `${favoriteA.key}:10`, capturedAt: 10, metrics: { viewCount: 100 } }),
    createSnapshot({ id: `${favoriteA.key}:40`, capturedAt: 40, status: "failed", metrics: {}, errors: ["失败"] }),
    createSnapshot({
      id: `${favoriteB.key}:30`,
      favoriteKey: favoriteB.key,
      platform: "manbo",
      dramaId: favoriteB.dramaId,
      capturedAt: 30,
      metrics: { viewCount: 80 },
    }),
  ];

  assert.deepEqual(
    sortFavoritesWithSnapshots([favoriteB, favoriteA], snapshots, "viewCount").map((item) => item.key),
    [favoriteA.key, favoriteB.key]
  );
  assert.deepEqual(
    sortFavoritesWithSnapshots([favoriteB, favoriteA], snapshots, "lastSnapshotAt").map((item) => item.key),
    [favoriteA.key, favoriteB.key]
  );

  const zeroFavorite = normalizeFavoriteRecord({ platform: "missevan", dramaId: "300", title: "真实零值" });
  const missingFavorite = normalizeFavoriteRecord({ platform: "missevan", dramaId: "400", title: "缺失值" });
  const zeroAndMissingSnapshots = [
    createSnapshot({
      id: `${zeroFavorite.key}:50`,
      favoriteKey: zeroFavorite.key,
      dramaId: zeroFavorite.dramaId,
      capturedAt: 50,
      metrics: { viewCount: 0 },
    }),
    createSnapshot({
      id: `${missingFavorite.key}:60`,
      favoriteKey: missingFavorite.key,
      dramaId: missingFavorite.dramaId,
      capturedAt: 60,
      status: "partial",
      metrics: { viewCount: null },
      metricErrors: { viewCount: "播放量未获取" },
      errors: ["播放量未获取"],
    }),
  ];
  assert.deepEqual(
    sortFavoritesWithSnapshots([missingFavorite, zeroFavorite], zeroAndMissingSnapshots, "viewCount").map((item) => item.key),
    [zeroFavorite.key, missingFavorite.key],
    "a real zero should sort ahead of a missing metric"
  );
});

test("recent refresh sorting uses snapshot capture time instead of drama update time", () => {
  const olderRefreshNewerDrama = normalizeFavoriteRecord({
    platform: "missevan",
    dramaId: "93038",
    title: "作品更新时间较新",
    dramaUpdatedAt: "2026-05-21T00:00:00.000Z",
  });
  const newerRefreshOlderDrama = normalizeFavoriteRecord({
    platform: "manbo",
    dramaId: "1467142227078676553",
    title: "刷新时间较新",
    dramaUpdatedAt: "2026-05-01T00:00:00.000Z",
  });
  const snapshots = [
    createSnapshot({
      id: "missevan:93038:100",
      capturedAt: 100,
      favoriteKey: olderRefreshNewerDrama.key,
      platform: "missevan",
      dramaId: "93038",
    }),
    createSnapshot({
      id: "manbo:1467142227078676553:200",
      capturedAt: 200,
      favoriteKey: newerRefreshOlderDrama.key,
      platform: "manbo",
      dramaId: "1467142227078676553",
    }),
  ];

  const sorted = sortFavoritesWithSnapshots(
    [olderRefreshNewerDrama, newerRefreshOlderDrama],
    snapshots,
    "lastSnapshotAt"
  );

  assert.deepEqual(sorted.map((item) => item.key), [newerRefreshOlderDrama.key, olderRefreshNewerDrama.key]);
});

test("recent refresh sorting places never-refreshed favorites after captured snapshots", () => {
  const neverRefreshed = normalizeFavoriteRecord({
    platform: "missevan",
    dramaId: "93038",
    title: "刚收藏未刷新",
    createdAt: 300,
    updatedAt: 300,
  });
  const refreshed = normalizeFavoriteRecord({
    platform: "manbo",
    dramaId: "1467142227078676553",
    title: "已有快照",
    createdAt: 100,
    updatedAt: 100,
  });
  const snapshots = [
    createSnapshot({
      id: "manbo:1467142227078676553:200",
      capturedAt: 200,
      favoriteKey: refreshed.key,
      platform: "manbo",
      dramaId: "1467142227078676553",
    }),
  ];

  const sorted = sortFavoritesWithSnapshots([neverRefreshed, refreshed], snapshots, "lastSnapshotAt");

  assert.deepEqual(sorted.map((item) => item.key), [refreshed.key, neverRefreshed.key]);
});

test("reward sorting compares Missevan diamonds and Manbo beans as yuan", () => {
  const favoriteA = normalizeFavoriteRecord({
    platform: "missevan",
    dramaId: "93038",
    title: "猫耳作品",
  });
  const favoriteB = normalizeFavoriteRecord({
    platform: "manbo",
    dramaId: "1467142227078676553",
    title: "漫播作品",
  });
  const snapshots = [
    createSnapshot({
      id: "missevan:93038:20",
      capturedAt: 20,
      metrics: { rewardTotal: 1000, giftTotal: null },
    }),
    createSnapshot({
      id: "manbo:1467142227078676553:20",
      favoriteKey: "manbo:1467142227078676553",
      platform: "manbo",
      dramaId: "1467142227078676553",
      capturedAt: 20,
      metrics: { rewardTotal: null, giftTotal: 5000 },
    }),
  ];

  const sorted = sortFavoritesWithSnapshots([favoriteA, favoriteB], snapshots, "rewardTotal");

  assert.deepEqual(sorted.map((item) => item.key), [favoriteA.key, favoriteB.key]);
});

test("favorite delta metric merges Missevan reward total and Manbo gift total", () => {
  assert.equal(FAVORITE_DELTA_METRICS.some((item) => item.key === "giftTotal"), false);
  assert.deepEqual(
    FAVORITE_DELTA_METRICS.find((item) => item.key === "rewardTotal"),
    { key: "rewardTotal", label: "打赏/投喂", platforms: ["missevan", "manbo"] }
  );
  assert.deepEqual(normalizeFavoriteSettings({ deltaMetric: "giftTotal" }), {
    deltaMetric: "rewardTotal",
    sortBy: "lastSnapshotAt",
  });

  const manboFavorite = normalizeFavoriteRecord({
    platform: "manbo",
    dramaId: "1467142227078676553",
    title: "漫播作品",
  });
  const snapshots = [
    createSnapshot({
      id: "manbo:1467142227078676553:20",
      favoriteKey: manboFavorite.key,
      platform: "manbo",
      dramaId: "1467142227078676553",
      capturedAt: 20,
      metrics: { rewardTotal: null, giftTotal: 15000 },
    }),
    createSnapshot({
      id: "manbo:1467142227078676553:10",
      favoriteKey: manboFavorite.key,
      platform: "manbo",
      dramaId: "1467142227078676553",
      capturedAt: 10,
      metrics: { rewardTotal: null, giftTotal: 10000 },
    }),
  ];

  assert.equal(getFavoriteDelta(manboFavorite.key, snapshots, "rewardTotal"), 5000);

  const missevanFavorite = normalizeFavoriteRecord({
    platform: "missevan",
    dramaId: "93038",
    title: "猫耳作品",
  });
  const missevanSnapshots = [
    createSnapshot({
      id: "missevan:93038:20",
      favoriteKey: missevanFavorite.key,
      platform: "missevan",
      dramaId: "93038",
      capturedAt: 20,
      metrics: { rewardTotal: 1500, giftTotal: null },
    }),
    createSnapshot({
      id: "missevan:93038:10",
      favoriteKey: missevanFavorite.key,
      platform: "missevan",
      dramaId: "93038",
      capturedAt: 10,
      metrics: { rewardTotal: 1000, giftTotal: null },
    }),
  ];

  assert.equal(getFavoriteDelta(missevanFavorite.key, missevanSnapshots, "giftTotal"), 500);
});

test("desktop favorites JSON migration only runs for missing or empty desktop data", () => {
  const favorite = normalizeFavoriteRecord({
    platform: "missevan",
    dramaId: "93038",
    title: "猫耳作品",
  });
  const populatedBackup = buildFavoritesBackup({
    favorites: [favorite],
    snapshots: [],
    exportedAt: "2026-05-22T00:00:00.000Z",
  });
  const emptyBackup = buildFavoritesBackup({
    favorites: [],
    snapshots: [],
    exportedAt: "2026-05-22T00:00:00.000Z",
  });

  assert.equal(DESKTOP_FAVORITES_FILE_NAME, "mm-toolkit-favorites.json");
  assert.equal(shouldMigrateFavoritesBackupToDesktopJson({ exists: false, data: null }), true);
  assert.equal(shouldMigrateFavoritesBackupToDesktopJson({ exists: true, data: emptyBackup }), true);
  assert.equal(shouldMigrateFavoritesBackupToDesktopJson({ exists: true, data: populatedBackup }), false);
});

test("desktop favorites writes recover after a failed JSON write", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const initialBackup = buildFavoritesBackup({
    favorites: [
      normalizeFavoriteRecord({
        platform: "missevan",
        dramaId: "93038",
        title: "已有收藏",
      }),
    ],
    snapshots: [],
    exportedAt: "2026-05-22T00:00:00.000Z",
  });
  let putCount = 0;
  globalThis.window = { desktopFavorites: {} };
  globalThis.fetch = async (url, options = {}) => {
    if (url === "/desktop/favorites-data" && options.method === "PUT") {
      putCount += 1;
      if (putCount === 1) {
        return {
          ok: false,
          json: async () => ({ success: false, message: "写入失败" }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: JSON.parse(options.body),
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        success: true,
        exists: true,
        data: initialBackup,
      }),
    };
  };

  try {
    await assert.rejects(
      () => saveFavorite({ platform: "missevan", dramaId: "100", title: "第一次写入" }),
      /写入失败/
    );
    const saved = await saveFavorite({ platform: "missevan", dramaId: "101", title: "第二次写入" });
    assert.equal(saved.key, "missevan:101");
    assert.equal(putCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test("favorite filters search title, id, and CV while combining groups with OR and AND", () => {
  const favorites = [
    normalizeFavoriteRecord({
      platform: "missevan",
      dramaId: "100",
      title: "深夜航线",
      mainCvText: "主要CV：甲",
      contentTypeLabel: "广播剧",
      paymentLabel: "付费",
    }),
    normalizeFavoriteRecord({
      platform: "manbo",
      dramaId: "200",
      title: "晴日来信",
      mainCvText: "主要CV：乙",
      contentTypeLabel: "有声漫",
      paymentLabel: "会员",
    }),
    normalizeFavoriteRecord({
      platform: "manbo",
      dramaId: "300",
      title: "山海回声",
      mainCvText: "主要CV：丙",
      contentTypeLabel: "有声剧",
      paymentLabel: "免费",
    }),
  ];

  assert.deepEqual(filterFavorites(favorites, { query: "200" }).map((item) => item.dramaId), ["200"]);
  assert.deepEqual(filterFavorites(favorites, null).map((item) => item.dramaId), ["100", "200", "300"]);
  assert.deepEqual(filterFavorites(favorites, { query: "乙" }).map((item) => item.dramaId), ["200"]);
  assert.deepEqual(
    filterFavorites(favorites, {
      platforms: ["missevan", "manbo"],
      contentTypes: ["audioDrama"],
      payments: ["member", "free"],
    }).map((item) => item.dramaId),
    ["200", "300"],
    "有声漫 should share the 有声剧 filter while preserving its stored label"
  );
  assert.deepEqual(
    filterFavorites(favorites, { platforms: ["missevan"], contentTypes: ["audioDrama"] }),
    [],
    "filter groups should combine with AND"
  );
});

test("favorite history CSV keeps real zeroes, converts money to yuan, and excludes failed snapshots", () => {
  assert.deepEqual(FAVORITES_HISTORY_CSV_COLUMNS.slice(5, 9), [
    "播放量",
    "猫耳追剧/漫播收藏人数",
    "猫耳打赏人数/漫播付费（收听）人数",
    "猫耳打赏榜总和/漫播总投喂（元）",
  ]);
  const missevan = normalizeFavoriteRecord({
    platform: "missevan",
    dramaId: "100",
    title: "=危险标题",
    contentTypeLabel: "广播剧",
  });
  const manbo = normalizeFavoriteRecord({
    platform: "manbo",
    dramaId: "200",
    title: "漫播,作品",
    contentTypeLabel: "有声漫",
  });
  const snapshots = [
    createSnapshot({
      id: "missevan:100:1000",
      favoriteKey: missevan.key,
      dramaId: missevan.dramaId,
      capturedAt: 1000,
      status: "partial",
      metrics: { viewCount: 0, subscriptionCount: null, rewardCount: 2, rewardTotal: 101, paidIdCount: 0 },
      metricErrors: { subscriptionCount: "未获取" },
      errors: ["未获取"],
    }),
    createSnapshot({
      id: "missevan:100:2000",
      favoriteKey: missevan.key,
      dramaId: missevan.dramaId,
      capturedAt: 2000,
      status: "failed",
      metrics: {},
      errors: ["详情失败"],
    }),
    createSnapshot({
      id: "manbo:200:3000",
      favoriteKey: manbo.key,
      platform: "manbo",
      dramaId: manbo.dramaId,
      capturedAt: 3000,
      metrics: { viewCount: 8, subscriptionCount: 3, paidOrListenCount: 4, giftTotal: 1234, paidIdCount: null },
    }),
  ];

  const rows = buildFavoritesHistoryCsvRows([missevan, manbo], snapshots);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], ["=危险标题", "100", "猫耳", "广播剧", new Date(1000).toISOString(), 0, null, 2, 10.1, 0]);
  assert.deepEqual(rows[1], ["漫播,作品", "200", "漫播", "有声漫", new Date(3000).toISOString(), 8, 3, 4, 12.34, null]);

  const csv = serializeFavoritesHistoryCsv(rows);
  assert.ok(csv.startsWith(`\uFEFF${FAVORITES_HISTORY_CSV_COLUMNS.join(",")}\r\n`));
  assert.match(csv, /'=危险标题/);
  assert.match(csv, /"漫播,作品"/);
  assert.match(csv, /,0,,2,10\.1,0/);
  assert.doesNotMatch(csv, /详情失败/);
});
