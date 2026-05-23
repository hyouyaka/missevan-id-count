import test from "node:test";
import assert from "node:assert/strict";

import {
  FAVORITE_DELTA_METRICS,
  FAVORITES_BACKUP_VERSION,
  DESKTOP_FAVORITES_FILE_NAME,
  buildFavoritesBackup,
  createFavoriteKey,
  getFavoriteDelta,
  getLatestSnapshot,
  getSnapshotIdsForFavoriteRemoval,
  normalizeFavoriteRecord,
  normalizeFavoritesBackup,
  normalizeFavoriteSettings,
  saveFavorite,
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
    errors: [],
    ...overrides,
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
  assert.deepEqual(parsed.settings, { deltaMetric: "rewardTotal", sortBy: "rewardTotal" });
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
  globalThis.window = { desktopExcel: {} };
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
