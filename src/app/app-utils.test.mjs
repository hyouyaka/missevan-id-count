import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRevenuePaidMetricSegments,
  buildRevenueSummary,
  buildMobileRankNavigationItems,
  buildOngoingNavigationMenu,
  buildRankPlatformSwitchRoutePatch,
  buildRanksNavigationMenu,
  buildToolRouteUrl,
  buildToolViewUrl,
  classifyMergedSearchInput,
  classifyUnifiedSearchInput,
  buildPlayCountDramasFromDramas,
  createStatsHistoryEntry,
  getAllowedToolViews,
  getHistoryMetricIconKey,
  formatSignedCompactMetricValue,
  formatDeviceDateTime,
  formatRankCompactCount,
  formatRevenueDisplayValue,
  getRevenueDisplayLabel,
  getInlineTaggedTitleDisplayText,
  getRevenuePaidCountLabel,
  loadPersistedHistoryEntries,
  mergeMissingSearchCardFields,
  normalizeOngoingWindow,
  parseRawItems,
  readToolRouteStateFromLocation,
  readToolViewFromLocation,
  resolveRevenueSummaryForHistory,
  savePersistedHistoryEntries,
  selectSearchMetricQueue,
  selectDramaEpisodesByMode,
  hasSearchKeywordInResultTitles,
  shouldUseManboLibraryFallbackForMissevanSearch,
  STATS_HISTORY_STORAGE_KEY,
} from "./app-utils.js";

const appUtilsModule = await import("./app-utils.js");
const { readJsonResponse } = appUtilsModule;

test("search card detail patches fill only missing base fields", () => {
  assert.deepEqual(
    mergeMissingSearchCardFields(
      {
        cover: "",
        name: "信息库名称",
        price: 0,
        is_member: false,
        main_cvs: [],
        main_cv_text: "",
      },
      {
        cover: "https://example.com/cover.jpg",
        name: "详情接口名称",
        price: 99,
        is_member: true,
        main_cvs: ["甲", "乙"],
        main_cv_text: "甲、乙",
      }
    ),
    {
      cover: "https://example.com/cover.jpg",
      main_cvs: ["甲", "乙"],
      main_cv_text: "甲、乙",
    }
  );
});

test("search card detail patches keep existing CV fields as one source", () => {
  assert.deepEqual(
    mergeMissingSearchCardFields(
      { main_cvs: ["信息库主役"], main_cv_text: "" },
      { main_cvs: ["详情主役"], main_cv_text: "详情主役" }
    ),
    {}
  );
});

test("result metric grid keeps columns between 130px and 180px", () => {
  const calculate = appUtilsModule.calculateResultMetricGridLayout;

  assert.deepEqual(calculate(330, 3), { columns: 2, columnWidth: 165, gridWidth: 330 });
  assert.deepEqual(calculate(750, 3), { columns: 3, columnWidth: 180, gridWidth: 540 });
  assert.deepEqual(calculate(750, 5), { columns: 5, columnWidth: 150, gridWidth: 750 });
  assert.deepEqual(calculate(100, 3), { columns: 1, columnWidth: 100, gridWidth: 100 });
});

test("compact statistics use fixed two-decimal wan and yi units", () => {
  const format = appUtilsModule.formatCompactMetricValue;

  assert.equal(format(9999), "9999");
  assert.equal(format(10000), "1.00万");
  assert.equal(format(1133000), "113.30万");
  assert.equal(format(99999999), "10000.00万");
  assert.equal(format(100000000), "1.00亿");
  assert.equal(format(123456789), "1.23亿");
  assert.equal(format(Number.NaN), "0");
  assert.equal(appUtilsModule.formatPlayCountDisplay(1133000, false), "113.30万");
  assert.equal(appUtilsModule.formatPlayCountWanFixed(9999), "9999");
  assert.equal(
    appUtilsModule.formatRevenueDisplayValue(
      { minRevenueYuan: 768000, maxRevenueYuan: 942000 },
      format,
      (minValue, maxValue) => `${format(minValue)} - ${format(maxValue)}`
    ),
    "76.80万 - 94.20万"
  );
});

test("statistics history keeps danmaku and every ID metric unabridged", () => {
  const entry = appUtilsModule.createStatsHistoryEntry("manbo", {
    activeTaskType: "id",
    totalDanmaku: 123456789,
    totalUsers: 1133000,
    idResults: [
      { dramaId: 1, title: "作品甲", danmaku: 123456789, users: 1133000 },
      { dramaId: 2, title: "作品乙", danmaku: 20000, users: 10000 },
    ],
  }, { createdAt: 1, taskType: "id" });

  assert.deepEqual(entry.summaryMetrics.map((metric) => metric.value), ["123456789", "1133000"]);
  assert.deepEqual(entry.items[0].segments.map((metric) => metric.value), ["123456789", "1133000"]);
});

test("search metric queue limits keyword pages but keeps every manual import", () => {
  for (const count of [6, 10, 21]) {
    const items = Array.from({ length: count }, (_, index) => ({
      id: index + 1,
      metrics_status: "pending",
    }));
    assert.equal(selectSearchMetricQueue(items, "search").length, 5);
    assert.equal(selectSearchMetricQueue(items, "manual").length, count);
    assert.equal(selectSearchMetricQueue(items, "manual").at(-1)?.id, count);
  }
});

test("resolveIdStatisticsSource marks only one drama's complete paid episode set as payID", () => {
  const resolveSource = appUtilsModule.resolveIdStatisticsSource;
  const dramas = [
    {
      drama: { id: 12345 },
      episodes: {
        episode: [
          { sound_id: 101, need_pay: 1 },
          { sound_id: 102, vip_free: 1 },
          { sound_id: 103 },
        ],
      },
    },
    {
      drama: { id: 67890 },
      episodes: {
        episode: [{ sound_id: 201, need_pay: 1 }],
      },
    },
  ];
  const resolve = (selectedEpisodes, source = "search") =>
    typeof resolveSource === "function"
      ? resolveSource({ platform: "missevan", dramas, selectedEpisodes, source })
      : undefined;

  assert.equal(
    resolve([
      { drama_id: "12345", sound_id: 101 },
      { drama_id: "12345", sound_id: 102 },
    ]),
    "12345payID"
  );
  assert.equal(resolve([{ drama_id: "12345", sound_id: 101 }]), "search");
  assert.equal(
    resolve([
      { drama_id: "12345", sound_id: 101 },
      { drama_id: "12345", sound_id: 103 },
    ]),
    "search"
  );
  assert.equal(
    resolve([
      { drama_id: "12345", sound_id: 101 },
      { drama_id: "12345", sound_id: 102 },
      { drama_id: "67890", sound_id: 201 },
    ]),
    "search"
  );
});

test("non-JSON HTTP errors fall back without throwing a parse error", async () => {
  assert.equal(typeof readJsonResponse, "function");
  const response = {
    ok: false,
    async json() {
      throw new SyntaxError("Unexpected token <");
    },
  };

  assert.equal(await readJsonResponse(response), null);
});

function createRevenueDrama(overrides = {}) {
  return {
    platform: "missevan",
    title: "示例作品",
    paidUserCount: 12,
    paidUserIds: [101, 202, 303],
    rewardCoinTotal: 180,
    viewCount: 56000,
    estimatedRevenueYuan: 88,
    includeInSummaryPrice: true,
    titlePrice: 24,
    ...overrides,
  };
}

function createStorageMock() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

test("tool view URL helper defaults to home without query", () => {
  assert.equal(readToolViewFromLocation({ search: "" }), "home");
  assert.equal(readToolViewFromLocation({ search: "" }, { desktopApp: true }), "search");
});

test("tool view URL helper reads valid view query", () => {
  assert.equal(readToolViewFromLocation({ search: "?view=ranks" }), "ranks");
  assert.equal(readToolViewFromLocation({ search: "?view=feedback" }), "feedback");
});

test("tool view URL helper rejects unavailable desktop views", () => {
  assert.equal(readToolViewFromLocation({ search: "?view=ranks" }, { desktopApp: true }), "search");
  assert.equal(readToolViewFromLocation({ search: "?view=home" }, { desktopApp: true }), "search");
  assert.equal(readToolViewFromLocation({ search: "?view=feedback" }, { desktopApp: true }), "search");
});

test("tool view URL helper exposes platform-specific allowed views", () => {
  assert.deepEqual(getAllowedToolViews(), ["home", "search", "ongoing", "ranks", "favorites", "feedback"]);
  assert.deepEqual(getAllowedToolViews({ desktopApp: true }), ["search", "favorites"]);
});

test("tool view URL builder keeps explicit views and omits default home view", () => {
  assert.equal(buildToolViewUrl({ pathname: "/tool", search: "?view=ranks", hash: "" }, "search"), "/tool?view=search");
  assert.equal(buildToolViewUrl({ pathname: "/tool", search: "?view=ranks", hash: "" }, "ongoing"), "/tool?view=ongoing");
  assert.equal(buildToolViewUrl({ pathname: "/tool", search: "?view=ranks", hash: "" }, "feedback"), "/tool?view=feedback");
  assert.equal(buildToolViewUrl({ pathname: "/tool", search: "?view=ranks", hash: "" }, "home"), "/tool");
});

test("tool view URL builder preserves unrelated query params", () => {
  assert.equal(
    buildToolViewUrl({ pathname: "/tool", search: "?foo=bar", hash: "" }, "favorites"),
    "/tool?foo=bar&view=favorites"
  );
});

test("tool view URL builder preserves hash while replacing existing view", () => {
  assert.equal(
    buildToolViewUrl({ pathname: "/tool", search: "?view=ranks&foo=bar", hash: "#section" }, "ongoing"),
    "/tool?view=ongoing&foo=bar#section"
  );
});

test("tool route state reader includes detail params with normalized fallbacks", () => {
  assert.deepEqual(
    readToolRouteStateFromLocation({
      search: "?view=ongoing&platform=manbo&window=7d&category=ignored&rank=ignored",
    }),
    {
      view: "ongoing",
      platform: "manbo",
      window: "7d",
      category: "ignored",
      rank: "ignored",
    }
  );
  assert.deepEqual(readToolRouteStateFromLocation({ search: "?view=bad&platform=bad&window=bad" }), {
    view: "home",
    platform: "missevan",
    window: "7d",
    category: "",
    rank: "",
  });
  assert.deepEqual(readToolRouteStateFromLocation({ search: "" }), {
    view: "home",
    platform: "missevan",
    window: "7d",
    category: "",
    rank: "",
  });
  assert.equal(normalizeOngoingWindow(undefined), "7d");
});

test("tool route URL builder keeps only ongoing route params", () => {
  assert.equal(
    buildToolRouteUrl(
      { pathname: "/", search: "?view=ranks&platform=missevan&category=cv&rank=weekly&foo=bar", hash: "#top" },
      { view: "ongoing", platform: "manbo", window: "7d" }
    ),
    "/?foo=bar&view=ongoing&platform=manbo&window=7d#top"
  );
  assert.equal(
    buildToolRouteUrl(
      { pathname: "/", search: "?view=search&platform=manbo&window=30d", hash: "" },
      { view: "ongoing", platform: "missevan", window: "7d" }
    ),
    "/?view=ongoing"
  );
});

test("tool route URL builder keeps only ranks route params", () => {
  assert.equal(
    buildToolRouteUrl(
      { pathname: "/", search: "?view=ongoing&platform=manbo&window=30d&foo=bar", hash: "" },
      { view: "ranks", platform: "missevan", category: "cv", rank: "weekly" }
    ),
    "/?foo=bar&view=ranks&platform=missevan&category=cv&rank=weekly"
  );
});

test("tool route URL builder clears detail params for root views", () => {
  assert.equal(
    buildToolRouteUrl(
      { pathname: "/tool", search: "?view=ranks&platform=manbo&category=cv&rank=weekly&foo=bar", hash: "" },
      { view: "favorites" }
    ),
    "/tool?foo=bar&view=favorites"
  );
  assert.equal(
    buildToolRouteUrl(
      { pathname: "/tool", search: "?view=ongoing&platform=manbo&window=7d&foo=bar", hash: "" },
      { view: "search" }
    ),
    "/tool?foo=bar&view=search"
  );
});

test("play count context keeps all imported episodes with drama totals and selection state", () => {
  const context = buildPlayCountDramasFromDramas([
    {
      drama: {
        id: 101,
        name: "测试剧",
        view_count: 1000,
      },
      episodes: {
        episode: [
          { sound_id: 11, name: "第一集", selected: true, duration: 120 },
          { sound_id: 12, name: "第二集", selected: false, duration: 130 },
        ],
      },
    },
    {
      drama: {
        id: 202,
        name: "空剧",
        view_count: 0,
      },
      episodes: {
        episode: [],
      },
    },
  ]);

  assert.deepEqual(context, [
    {
      drama_id: "101",
      drama_title: "测试剧",
      total_view_count: 1000,
      total_episode_count: 2,
      episodes: [
        {
          drama_id: "101",
          sound_id: 11,
          drama_title: "测试剧",
          episode_title: "第一集",
          duration: 120,
          selected: true,
        },
        {
          drama_id: "101",
          sound_id: 12,
          drama_title: "测试剧",
          episode_title: "第二集",
          duration: 130,
          selected: false,
        },
      ],
    },
  ]);
});

test("play count context preserves missing drama total instead of coercing it to zero", () => {
  const context = buildPlayCountDramasFromDramas([
    {
      drama: {
        id: 101,
        name: "缺播放量剧",
      },
      episodes: {
        episode: [
          { sound_id: 11, name: "第一集", selected: true },
          { sound_id: 12, name: "第二集", selected: true },
          { sound_id: 13, name: "第三集", selected: true },
          { sound_id: 14, name: "第四集", selected: false },
        ],
      },
    },
  ]);

  assert.equal(context[0].total_view_count, null);
});

test("play count context skips dramas without selected episodes", () => {
  const context = buildPlayCountDramasFromDramas([
    {
      drama: {
        id: 101,
        name: "已选剧",
        view_count: 1000,
      },
      episodes: {
        episode: [
          { sound_id: 11, name: "第一集", selected: true },
          { sound_id: 12, name: "第二集", selected: false },
        ],
      },
    },
    {
      drama: {
        id: 202,
        name: "未选剧",
        view_count: 2000,
      },
      episodes: {
        episode: [
          { sound_id: 21, name: "第一集", selected: false },
          { sound_id: 22, name: "第二集", selected: false },
        ],
      },
    },
  ]);

  assert.equal(context.length, 1);
  assert.equal(context[0].drama_id, "101");
});

test("ongoing navigation menu exposes platform route patches that default to 7 days", () => {
  assert.deepEqual(buildOngoingNavigationMenu(), [
    {
      key: "missevan",
      label: "猫耳",
      platform: { key: "missevan", label: "猫耳" },
      routePatch: { view: "ongoing", platform: "missevan", window: "7d" },
      activeRoutePatch: { view: "ongoing", platform: "missevan" },
    },
    {
      key: "manbo",
      label: "漫播",
      platform: { key: "manbo", label: "漫播" },
      routePatch: { view: "ongoing", platform: "manbo", window: "7d" },
      activeRoutePatch: { view: "ongoing", platform: "manbo" },
    },
  ]);
});

test("ranks navigation menu derives platform category and rank route patches from payload", () => {
  const menu = buildRanksNavigationMenu({
    data: {
      platforms: {
        missevan: {
          key: "missevan",
          label: "猫耳",
          categories: [
            {
              key: "new",
              label: "新品榜",
              ranks: [
                { key: "new_daily", label: "日榜" },
                { key: "new_weekly", label: "周榜" },
              ],
            },
            {
              key: "cv",
              label: "CV榜",
              ranks: [
                { key: "cv", label: "总榜" },
                { key: "cv-paid", label: "付费榜" },
              ],
            },
          ],
        },
        manbo: {
          key: "manbo",
          label: "漫播",
          categories: [
            {
              key: "box_office",
              label: "畅销榜",
              ranks: [
                { key: "box_office_total", label: "总榜" },
                { key: "box_office_vip", label: "会员榜" },
                { key: "box_office_paid", label: "付费榜" },
              ],
            },
          ],
        },
      },
    },
  });

  assert.deepEqual(menu[0].routePatch, {
    view: "ranks",
    platform: "missevan",
    category: "new",
    rank: "new_daily",
  });
  assert.deepEqual(menu[0].activeRoutePatch, {
    view: "ranks",
    platform: "missevan",
  });
  assert.deepEqual(menu[0].platform, { key: "missevan", label: "猫耳" });
  assert.deepEqual(menu[0].children[0].routePatch, {
    view: "ranks",
    platform: "missevan",
    category: "new",
    rank: "new_daily",
  });
  assert.deepEqual(menu[0].children[0].activeRoutePatch, {
    view: "ranks",
    platform: "missevan",
    category: "new",
  });
  assert.deepEqual(menu[0].children[0].children[1], {
    key: "new_weekly",
    label: "周榜",
    routePatch: {
      view: "ranks",
      platform: "missevan",
      category: "new",
      rank: "new_weekly",
    },
  });
  assert.deepEqual(menu[0].children[1].children, [
    {
      key: "cv",
      label: "总榜",
      routePatch: {
        view: "ranks",
        platform: "missevan",
        category: "cv",
        rank: "cv",
      },
    },
    {
      key: "cv-paid",
      label: "付费榜",
      routePatch: {
        view: "ranks",
        platform: "missevan",
        category: "cv",
        rank: "cv-paid",
      },
    },
  ]);
  assert.deepEqual(menu[1].children[0].routePatch, {
    view: "ranks",
    platform: "manbo",
    category: "box_office",
    rank: "box_office_total",
  });
  assert.deepEqual(menu[1].children[0].activeRoutePatch, {
    view: "ranks",
    platform: "manbo",
    category: "box_office",
  });
  assert.deepEqual(menu[1].platform, { key: "manbo", label: "漫播" });
  assert.deepEqual(menu[1].children[0].children[2], {
    key: "box_office_paid",
    label: "付费榜",
    routePatch: {
      view: "ranks",
      platform: "manbo",
      category: "box_office",
      rank: "box_office_paid",
    },
  });
});

test("mobile rank navigation items flatten platform categories into direct rank links", () => {
  const menu = buildRanksNavigationMenu({
    data: {
      platforms: {
        missevan: {
          key: "missevan",
          label: "猫耳",
          categories: [
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
              key: "best_seller",
              label: "畅销榜",
              ranks: [
                { key: "best_seller_weekly", label: "周榜" },
                { key: "best_seller_monthly", label: "月榜" },
              ],
            },
            {
              key: "peak",
              label: "巅峰榜",
              ranks: [{ key: "peak", label: "巅峰榜" }],
            },
            {
              key: "cv",
              label: "CV榜",
              ranks: [
                { key: "cv", label: "总榜" },
                { key: "cv-paid", label: "付费榜" },
              ],
            },
          ],
        },
        manbo: {
          key: "manbo",
          label: "漫播",
          categories: [
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
            {
              key: "cv",
              label: "CV榜",
              ranks: [
                { key: "cv", label: "总榜" },
                { key: "cv-paid", label: "付费榜" },
              ],
            },
          ],
        },
      },
    },
  });

  const missevanItems = buildMobileRankNavigationItems(menu[0]);
  const manboItems = buildMobileRankNavigationItems(menu[1]);

  assert.deepEqual(
    missevanItems.map((item) => item.label),
    ["新品日榜", "新品周榜", "人气周榜", "人气月榜", "畅销周榜", "畅销月榜", "巅峰榜", "CV总榜", "CV付费榜"]
  );
  assert.deepEqual(
    manboItems.map((item) => item.label),
    ["热播榜", "票房总榜", "票房会员剧榜", "票房付费剧榜", "钻石月榜", "巅峰榜", "CV总榜", "CV付费榜"]
  );
  assert.deepEqual(missevanItems[1].routePatch, {
    view: "ranks",
    platform: "missevan",
    category: "new",
    rank: "new_weekly",
  });
  assert.deepEqual(manboItems[2].routePatch, {
    view: "ranks",
    platform: "manbo",
    category: "box_office",
    rank: "box_office_member",
  });
});

test("mobile rank navigation category defaults land on requested ranks", () => {
  const menu = buildRanksNavigationMenu({
    data: {
      platforms: {
        missevan: {
          key: "missevan",
          label: "猫耳",
          categories: [
            { key: "new", label: "新品榜", ranks: [{ key: "new_weekly", label: "周榜" }, { key: "new_daily", label: "日榜" }] },
            { key: "popular", label: "人气榜", ranks: [{ key: "popular_daily", label: "日榜" }, { key: "popular_weekly", label: "周榜" }] },
            { key: "best_seller", label: "畅销榜", ranks: [{ key: "best_seller_daily", label: "日榜" }, { key: "best_seller_weekly", label: "周榜" }] },
            { key: "cv", label: "CV榜", ranks: [{ key: "cv-paid", label: "付费榜" }, { key: "cv", label: "总榜" }] },
          ],
        },
        manbo: {
          key: "manbo",
          label: "漫播",
          categories: [
            { key: "box_office", label: "票房榜", ranks: [{ key: "box_office_member", label: "会员剧" }, { key: "box_office_total", label: "总榜" }] },
          ],
        },
      },
    },
  });

  const missevanCategories = menu[0].children;
  const manboCategories = menu[1].children;

  assert.equal(missevanCategories.find((item) => item.key === "new").routePatch.rank, "new_daily");
  assert.equal(missevanCategories.find((item) => item.key === "popular").routePatch.rank, "popular_weekly");
  assert.equal(missevanCategories.find((item) => item.key === "best_seller").routePatch.rank, "best_seller_weekly");
  assert.equal(missevanCategories.find((item) => item.key === "cv").routePatch.rank, "cv");
  assert.equal(manboCategories.find((item) => item.key === "box_office").routePatch.rank, "box_office_total");
});

test("rank platform switch carries only peak and CV categories", () => {
  const missevanPlatform = {
    key: "missevan",
    categories: [
      {
        key: "new",
        label: "新品榜",
        ranks: [
          { key: "new_daily", label: "日榜" },
          { key: "new_weekly", label: "周榜" },
        ],
      },
      {
        key: "peak",
        label: "巅峰榜",
        ranks: [{ key: "peak", label: "巅峰榜" }],
      },
      {
        key: "cv",
        label: "CV榜",
        ranks: [{ key: "cv", label: "CV榜" }],
      },
    ],
  };
  const manboPlatform = {
    key: "manbo",
    categories: [
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
        key: "peak",
        label: "巅峰榜",
        ranks: [{ key: "peak", label: "巅峰榜" }],
      },
      {
        key: "cv",
        label: "CV榜",
        ranks: [{ key: "cv", label: "CV榜" }],
      },
    ],
  };

  assert.deepEqual(
    buildRankPlatformSwitchRoutePatch("manbo", manboPlatform, {
      category: "peak",
      rank: "peak",
    }),
    { view: "ranks", platform: "manbo", category: "peak", rank: "peak" }
  );
  assert.deepEqual(
    buildRankPlatformSwitchRoutePatch("manbo", manboPlatform, {
      category: "cv",
      rank: "cv",
    }),
    { view: "ranks", platform: "manbo", category: "cv", rank: "cv" }
  );
  assert.deepEqual(
    buildRankPlatformSwitchRoutePatch("manbo", manboPlatform, {
      category: "new",
      rank: "new_weekly",
    }),
    { view: "ranks", platform: "manbo", category: "hot", rank: "hot" }
  );
  assert.deepEqual(
    buildRankPlatformSwitchRoutePatch("missevan", missevanPlatform, {
      category: "box_office",
      rank: "box_office_member",
    }),
    { view: "ranks", platform: "missevan", category: "new", rank: "new_daily" }
  );
  assert.deepEqual(
    buildRankPlatformSwitchRoutePatch(
      "manbo",
      {
        key: "manbo",
        categories: [{ key: "hot", label: "热播榜", ranks: [{ key: "hot", label: "热播榜" }] }],
      },
      { category: "cv", rank: "cv" }
    ),
    { view: "ranks", platform: "manbo", category: "hot", rank: "hot" }
  );
});

test("resolveRevenueSummaryForHistory rebuilds underpopulated summaries from results", () => {
  const revenueResults = [createRevenueDrama()];
  const staleSummary = {
    platform: "missevan",
    failed: false,
    estimatedRevenueYuan: 0,
    minRevenueYuan: null,
    maxRevenueYuan: null,
    totalPaidUserCount: 0,
    totalPayCount: 0,
    totalDanmakuPaidUserCount: 0,
    paidCountSourceSummary: "danmaku_ids",
    selectedDramaCount: 1,
    totalViewCount: 0,
    rewardTotal: 0,
    rewardNum: null,
    hasSummaryPrice: false,
    summaryTitle: "汇总 / 已选 1 部",
  };

  const resolvedSummary = resolveRevenueSummaryForHistory(revenueResults, "missevan", staleSummary);

  assert.equal(resolvedSummary.estimatedRevenueYuan, 88);
  assert.equal(resolvedSummary.totalViewCount, 56000);
  assert.equal(resolvedSummary.rewardTotal, 180);
});

test("parseRawItems preserves Missevan share URL tokens", () => {
  assert.deepEqual(
    parseRawItems(
      "https://www.missevan.com/mdrama/93420?share_channel=wechat\nhttps://www.missevan.com/sound/12681701?share_channel=copy 93420"
    ),
    [
      "https://www.missevan.com/mdrama/93420?share_channel=wechat",
      "https://www.missevan.com/sound/12681701?share_channel=copy",
      "93420",
    ]
  );
});

test("classifyMergedSearchInput routes Missevan keywords to search", () => {
  assert.deepEqual(classifyMergedSearchInput("撒野 CV", "missevan"), {
    action: "search",
    keyword: "撒野 CV",
    rawItems: [],
  });
});

test("formatRankCompactCount keeps two decimals for wan and yi units", () => {
  assert.equal(formatRankCompactCount(9999), "9999");
  assert.equal(formatRankCompactCount(10000), "1.00万");
  assert.equal(formatRankCompactCount(123456), "12.35万");
  assert.equal(formatRankCompactCount(100000000), "1.00亿");
  assert.equal(formatRankCompactCount(1188561622), "11.89亿");
});

test("getInlineTaggedTitleDisplayText truncates long tagged mobile titles", () => {
  assert.equal(
    getInlineTaggedTitleDisplayText("全球进化后我站在食物链顶端 第二季（下）", {
      hasTags: true,
      viewport: "mobile",
    }),
    "全球进化后我站在食物链顶端 第二季（..."
  );
});

test("getInlineTaggedTitleDisplayText keeps medium tagged mobile titles intact", () => {
  assert.equal(
    getInlineTaggedTitleDisplayText("初三的六一儿童节 第二季（上）", {
      hasTags: true,
      viewport: "mobile",
    }),
    "初三的六一儿童节 第二季（上）"
  );
});

test("getInlineTaggedTitleDisplayText allows more title text without tags", () => {
  assert.equal(
    getInlineTaggedTitleDisplayText("全球进化后我站在食物链顶端 第二季（下）番外篇", {
      hasTags: false,
      viewport: "mobile",
    }),
    "全球进化后我站在食物链顶端 第二季（下）番外..."
  );
});

test("getInlineTaggedTitleDisplayText keeps short titles unchanged", () => {
  assert.equal(
    getInlineTaggedTitleDisplayText("洄天 第一季", {
      hasTags: true,
      viewport: "mobile",
    }),
    "洄天 第一季"
  );
});

test("classifyMergedSearchInput routes Missevan drama and sound IDs to import", () => {
  assert.deepEqual(classifyMergedSearchInput("93420 12681701", "missevan"), {
    action: "import",
    keyword: "",
    rawItems: ["93420", "12681701"],
  });
});

test("classifyMergedSearchInput routes single numeric input to library lookup first", () => {
  assert.deepEqual(classifyMergedSearchInput("2401", "missevan"), {
    action: "numeric_lookup",
    keyword: "2401",
    rawItems: ["2401"],
  });
  assert.deepEqual(classifyMergedSearchInput("1467142227078676553", "manbo"), {
    action: "numeric_lookup",
    keyword: "1467142227078676553",
    rawItems: ["1467142227078676553"],
  });
});

test("classifyMergedSearchInput can bypass numeric lookup for fallback ID handling", () => {
  assert.deepEqual(classifyMergedSearchInput("2401", "missevan", { numericLookup: false }), {
    action: "import",
    keyword: "",
    rawItems: ["2401"],
  });
});

test("classifyMergedSearchInput imports short Missevan numeric IDs instead of rejecting as short keywords", () => {
  assert.deepEqual(classifyMergedSearchInput("12", "missevan"), {
    action: "import",
    keyword: "",
    rawItems: ["12"],
  });
});

test("classifyMergedSearchInput rejects short keyword searches", () => {
  assert.deepEqual(classifyMergedSearchInput("猫", "missevan"), {
    action: "keyword_too_short",
    keyword: "猫",
    rawItems: [],
  });
  assert.deepEqual(classifyMergedSearchInput("ab", "manbo"), {
    action: "keyword_too_short",
    keyword: "ab",
    rawItems: [],
  });
  assert.equal(classifyMergedSearchInput("猫耳", "missevan").action, "search");
  assert.equal(classifyMergedSearchInput("abc", "manbo").action, "search");
});

test("classifyMergedSearchInput treats mixed Missevan import tokens and text as search", () => {
  assert.deepEqual(classifyMergedSearchInput("93420 撒野", "missevan"), {
    action: "search",
    keyword: "93420 撒野",
    rawItems: [],
  });
});

test("classifyMergedSearchInput routes Missevan share links to import", () => {
  assert.deepEqual(
    classifyMergedSearchInput(
      "https://www.missevan.com/mdrama/93420?share_channel=wechat https://www.missevan.com/sound/12681701?share_channel=copy",
      "missevan"
    ),
    {
      action: "import",
      keyword: "",
      rawItems: [
        "https://www.missevan.com/mdrama/93420?share_channel=wechat",
        "https://www.missevan.com/sound/12681701?share_channel=copy",
      ],
    }
  );
});

test("classifyMergedSearchInput routes Manbo numeric IDs and links to import", () => {
  assert.deepEqual(
    classifyMergedSearchInput("1467142227078676553 https://manbo.hongdoulive.com/Activecard/radioplay?id=1", "manbo"),
    {
      action: "import",
      keyword: "",
      rawItems: ["1467142227078676553", "https://manbo.hongdoulive.com/Activecard/radioplay?id=1"],
    }
  );
});

test("classifyMergedSearchInput accepts 18 to 20 digit Manbo IDs after keyword lookup", () => {
  [
    "123456789012345678",
    "1467142227078676553",
    "12345678901234567890",
  ].forEach((id) => {
    assert.deepEqual(classifyMergedSearchInput(id, "manbo", { numericLookup: false }), {
      action: "import",
      keyword: "",
      rawItems: [id],
    });
  });
});

test("classifyMergedSearchInput keeps non-Manbo numeric IDs on Manbo inside Manbo search", () => {
  assert.deepEqual(classifyMergedSearchInput("12", "manbo", { numericLookup: false }), {
    action: "keyword_too_short",
    keyword: "12",
    rawItems: [],
  });
  ["123", "12345678901234567", "123456789012345678901"].forEach((id) => {
    assert.deepEqual(classifyMergedSearchInput(id, "manbo", { numericLookup: false }), {
      action: "search",
      keyword: id,
      rawItems: [],
    });
  });
});

test("classifyMergedSearchInput routes Manbo-looking input on Missevan to cross import", () => {
  assert.deepEqual(
    classifyMergedSearchInput("12345678901234567890 https://manbo.hongdoulive.com/Activecard/radioplay?id=1", "missevan"),
    {
      action: "cross_import",
      targetPlatform: "manbo",
      keyword: "",
      rawItems: ["12345678901234567890", "https://manbo.hongdoulive.com/Activecard/radioplay?id=1"],
    }
  );
});

test("classifyMergedSearchInput keeps mixed Manbo-looking input on Missevan as search", () => {
  assert.deepEqual(classifyMergedSearchInput("2087206604062588962 撒野", "missevan"), {
    action: "search",
    keyword: "2087206604062588962 撒野",
    rawItems: [],
  });
});

test("classifyMergedSearchInput keeps Missevan-looking input on Manbo as Manbo search", () => {
  assert.deepEqual(
    classifyMergedSearchInput("93420 https://www.missevan.com/sound/12681701?share_channel=copy", "manbo"),
    {
      action: "search",
      keyword: "93420 https://www.missevan.com/sound/12681701?share_channel=copy",
      rawItems: [],
    }
  );
});

test("classifyMergedSearchInput keeps short Missevan drama IDs on Manbo as Manbo search after lookup", () => {
  assert.deepEqual(classifyMergedSearchInput("2401", "manbo", { numericLookup: false }), {
    action: "search",
    keyword: "2401",
    rawItems: [],
  });
});

test("classifyMergedSearchInput keeps mixed Missevan-looking input on Manbo as search", () => {
  assert.deepEqual(classifyMergedSearchInput("93420 广播剧", "manbo"), {
    action: "search",
    keyword: "93420 广播剧",
    rawItems: [],
  });
});

test("classifyMergedSearchInput routes empty input separately", () => {
  assert.deepEqual(classifyMergedSearchInput("   ", "missevan"), {
    action: "empty",
    keyword: "",
    rawItems: [],
  });
});

test("classifyUnifiedSearchInput routes platform IDs and keywords", () => {
  assert.deepEqual(classifyUnifiedSearchInput("1467142227078676553"), {
    action: "import",
    targetPlatform: "manbo",
    keyword: "",
    rawItems: ["1467142227078676553"],
  });
  assert.deepEqual(classifyUnifiedSearchInput("https://manbo.hongdoulive.com/Activecard/radioplay?id=1"), {
    action: "import",
    targetPlatform: "manbo",
    keyword: "",
    rawItems: ["https://manbo.hongdoulive.com/Activecard/radioplay?id=1"],
  });
  assert.deepEqual(classifyUnifiedSearchInput("93420"), {
    action: "import",
    targetPlatform: "missevan",
    keyword: "",
    rawItems: ["93420"],
  });
  assert.deepEqual(classifyUnifiedSearchInput("https://www.missevan.com/sound/12681701?share_channel=copy"), {
    action: "import",
    targetPlatform: "missevan",
    keyword: "",
    rawItems: ["https://www.missevan.com/sound/12681701?share_channel=copy"],
  });
  assert.deepEqual(classifyUnifiedSearchInput("撒野 CV"), {
    action: "search",
    keyword: "撒野 CV",
    rawItems: [],
  });
  assert.equal(classifyUnifiedSearchInput("2087206604062588962 93420").action, "mixed_import");
  assert.equal(classifyUnifiedSearchInput("魔道祖师 https://www.missevan.com/mdrama/93420").action, "mixed_import");
  assert.equal(classifyUnifiedSearchInput("魔道祖师,2087206604062588962").action, "mixed_import");
});

test("hasSearchKeywordInResultTitles uses normalized title matching", () => {
  assert.equal(
    hasSearchKeywordInResultTitles(
      [{ title: "某某广播剧·第一季" }, { name: "另一个结果" }],
      "某某 广播剧"
    ),
    true
  );
  assert.equal(
    hasSearchKeywordInResultTitles(
      [{ title: "完全无关" }, { name: "别的结果" }],
      "某某广播剧"
    ),
    false
  );
});

test("shouldUseManboLibraryFallbackForMissevanSearch handles empty Missevan API results", () => {
  assert.equal(
    shouldUseManboLibraryFallbackForMissevanSearch(
      {
        success: false,
        results: [],
        meta: { source: "missevan_api", matchedCount: 0 },
      },
      "万米高空降临"
    ),
    true
  );
  assert.equal(
    shouldUseManboLibraryFallbackForMissevanSearch(
      {
        success: true,
        results: [{ name: "万米高空降临" }],
        meta: { source: "missevan_api", matchedCount: 1 },
      },
      "万米高空降临"
    ),
    false
  );
});

test("formatDeviceDateTime formats 24-hour local time without timezone suffix", () => {
  assert.equal(
    formatDeviceDateTime("2026-05-11T00:26:00.000Z", { timeZone: "America/New_York" }),
    "2026-05-10 20:26"
  );
});

test("formatDeviceDateTime treats numeric strings as browser-local millisecond timestamps", () => {
  assert.equal(
    formatDeviceDateTime("1779179144169", { timeZone: "America/New_York" }),
    "2026-05-19 04:25"
  );
});

test("formatDeviceDateTime treats numeric strings as browser-local second timestamps", () => {
  assert.equal(
    formatDeviceDateTime("1779179144", { timeZone: "America/New_York" }),
    "2026-05-19 04:25"
  );
});

test("formatSignedCompactMetricValue preserves negative compact deltas", () => {
  assert.equal(formatSignedCompactMetricValue(-5), "-5");
  assert.equal(formatSignedCompactMetricValue(-12345), "-1.23万");
  assert.equal(formatSignedCompactMetricValue(12345), "+1.23万");
  assert.equal(formatSignedCompactMetricValue(0), "0");
});

test("createStatsHistoryEntry keeps successful revenue items when some dramas fail", () => {
  const successfulDrama = createRevenueDrama({ title: "成功作品" });
  const failedDrama = createRevenueDrama({
    title: "失败作品",
    failed: true,
    paidUserCount: 0,
    paidUserIds: [],
    rewardCoinTotal: 0,
    viewCount: 0,
    estimatedRevenueYuan: 0,
    includeInSummaryPrice: false,
    titlePrice: 0,
  });

  const stats = {
    activeTaskType: "revenue",
    revenueResults: [successfulDrama, failedDrama],
    revenueSummary: buildRevenueSummary([successfulDrama, failedDrama], "missevan"),
  };

  const historyEntry = createStatsHistoryEntry("missevan", stats, {
    taskType: "revenue",
    createdAt: 1710000000000,
  });

  assert.ok(historyEntry, "expected a history entry for partial-success revenue results");
  assert.equal(historyEntry.items.length, 1);
  assert.equal(historyEntry.items[0].title, "成功作品");
});

test("createStatsHistoryEntry includes total danmaku in id summary for multi-drama results", () => {
  const stats = {
    activeTaskType: "id",
    totalDanmaku: 12345,
    totalUsers: 23,
    idResults: [
      { dramaId: 101, title: "作品一", danmaku: 6000, users: 10 },
      { dramaId: 202, title: "作品二", danmaku: 6345, users: 13 },
    ],
  };

  const historyEntry = createStatsHistoryEntry("missevan", stats, {
    taskType: "id",
    createdAt: 1710000000000,
  });

  assert.ok(historyEntry, "expected an id history entry");
  assert.deepEqual(historyEntry.summaryMetrics, [
    { key: "danmakuCount", label: "总弹幕数", value: "12345" },
    { key: "uniqueUsers", label: "去重 ID", value: "23" },
  ]);
});

test("getRevenuePaidCountLabel names Missevan pay_type=1 summed paid episode IDs", () => {
  assert.equal(
    getRevenuePaidCountLabel({
      platform: "missevan",
      payType: 1,
      revenueType: "episode",
    }),
    "付费集总ID数"
  );
});

test("getRevenuePaidCountLabel names Missevan pay_type=2 deduped paid episode IDs", () => {
  assert.equal(
    getRevenuePaidCountLabel({
      platform: "missevan",
      payType: 2,
      revenueType: "season",
    }),
    "付费集去重ID数"
  );
});

test("getRevenueDisplayLabel keeps Missevan reward-only wording", () => {
  assert.equal(
    getRevenueDisplayLabel({
      platform: "missevan",
      revenueType: "reward_only",
      summaryRevenueMode: "member_reward",
      vipOnlyReward: true,
    }),
    "收益预估（仅计算打赏，元）"
  );
});

test("Missevan pay_type=1 revenue summary and display use range values", () => {
  const drama = createRevenueDrama({
    payType: 1,
    revenueType: "episode",
    summaryRevenueMode: "range",
    paidUserCount: 5,
    episodePaidUserCountTotal: 5,
    seasonPaidUserCount: 4,
    paidEpisodeCount: 2,
    rewardCoinTotal: 100,
    estimatedRevenueYuan: 20,
    minRevenueYuan: 20,
    maxRevenueYuan: 26,
  });

  const summary = buildRevenueSummary([drama], "missevan");

  assert.equal(summary.summaryRevenueMode, "range");
  assert.equal(summary.estimatedRevenueYuan, 20);
  assert.equal(summary.minRevenueYuan, 20);
  assert.equal(summary.maxRevenueYuan, 26);
  assert.equal(formatRevenueDisplayValue(drama), "20-26");
});

test("Missevan pay_type=1 paid metrics include summed and deduped paid episode IDs", () => {
  const segments = buildRevenuePaidMetricSegments({
    platform: "missevan",
    payType: 1,
    revenueType: "episode",
    paidUserCount: 5,
    seasonPaidUserCount: 4,
  });

  assert.deepEqual(segments, [
    { key: "episodePaidUserCountTotal", kind: "metric", metricKey: "episodePaidUserCountTotal", label: "付费集总ID数", value: "5", unit: "ID" },
    { key: "seasonPaidUserCount", kind: "metric", metricKey: "seasonPaidUserCount", label: "付费集去重ID数", value: "4", unit: "ID" },
  ]);
});

test("Missevan pay_type=1 paid history metrics use the ID icon key", () => {
  const segments = buildRevenuePaidMetricSegments({
    platform: "missevan",
    payType: 1,
    revenueType: "episode",
    paidUserCount: 1995,
    seasonPaidUserCount: 1393,
  });

  assert.deepEqual(
    segments.map((segment) => getHistoryMetricIconKey(segment)),
    ["uniqueUsers", "uniqueUsers"]
  );
});

test("Missevan pay_type=1 revenue history shows both ID metrics but summary keeps one deduped ID metric", () => {
  const firstDrama = createRevenueDrama({
    title: "单集付费一",
    payType: 1,
    revenueType: "episode",
    summaryRevenueMode: "range",
    paidUserCount: 5,
    paidUserIds: [101, 202, 303, 404],
    seasonPaidUserCount: 4,
    rewardCoinTotal: 100,
    estimatedRevenueYuan: 20,
    minRevenueYuan: 20,
    maxRevenueYuan: 26,
  });
  const secondDrama = createRevenueDrama({
    title: "单集付费二",
    payType: 1,
    revenueType: "episode",
    summaryRevenueMode: "range",
    paidUserCount: 3,
    paidUserIds: [303, 505],
    seasonPaidUserCount: 2,
    rewardCoinTotal: 50,
    estimatedRevenueYuan: 11,
    minRevenueYuan: 11,
    maxRevenueYuan: 13,
  });
  const stats = {
    activeTaskType: "revenue",
    revenueResults: [firstDrama, secondDrama],
    revenueSummary: buildRevenueSummary([firstDrama, secondDrama], "missevan"),
  };

  const historyEntry = createStatsHistoryEntry("missevan", stats, {
    taskType: "revenue",
    createdAt: 1710000000000,
  });

  assert.deepEqual(
    historyEntry.items[0].segments.slice(0, 2).map((segment) => ({
      label: segment.label,
      value: segment.value,
      unit: segment.unit,
    })),
    [
      { label: "付费集总ID数", value: "5", unit: "ID" },
      { label: "付费集去重ID数", value: "4", unit: "ID" },
    ]
  );
  assert.deepEqual(
    historyEntry.summaryMetrics
      .filter((metric) => ["uniqueUsers", "episodePaidUserCountTotal", "seasonPaidUserCount"].includes(metric.key))
      .map((metric) => ({ key: metric.key, label: metric.label, value: metric.value, unit: metric.unit })),
    [{ key: "uniqueUsers", label: "总和去重 ID", value: "5", unit: "ID" }]
  );
});

test("loadPersistedHistoryEntries returns empty platform histories when storage is unavailable", () => {
  assert.deepEqual(loadPersistedHistoryEntries(null), {
    missevan: [],
    manbo: [],
  });
});

test("loadPersistedHistoryEntries ignores blocked browser storage", () => {
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      get localStorage() {
        throw new DOMException("Blocked", "SecurityError");
      },
    },
  });

  try {
    assert.deepEqual(loadPersistedHistoryEntries(), {
      missevan: [],
      manbo: [],
    });
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: previousWindow,
      });
    }
  }
});

test("savePersistedHistoryEntries persists versioned per-platform histories", () => {
  const storage = createStorageMock();
  const historyEntry = {
    id: "missevan-id-1",
    platform: "missevan",
    createdAt: 1710000000000,
    createdAtLabel: "2024-03-09 16:00",
    taskType: "id",
    summaryMetrics: [{ key: "uniqueUsers", label: "去重 ID", value: "12" }],
    items: [
      {
        id: "123",
        title: "示例作品",
        segments: [{ key: "uniqueUsers", metricKey: "uniqueUsers", label: "去重 ID", value: "12", unit: "ID" }],
      },
    ],
  };

  savePersistedHistoryEntries(
    {
      missevan: [historyEntry],
      manbo: [],
    },
    storage
  );

  const raw = JSON.parse(storage.getItem(STATS_HISTORY_STORAGE_KEY));
  assert.equal(raw.version, 1);
  assert.equal(raw.missevan.length, 1);
  assert.equal(raw.missevan[0].id, "missevan-id-1");
  assert.equal(raw.missevan[0].items[0].segments[0].metricKey, "uniqueUsers");
  assert.deepEqual(loadPersistedHistoryEntries(storage), {
    missevan: [historyEntry],
    manbo: [],
  });
});

test("loadPersistedHistoryEntries restores segment key for icon mapping", () => {
  const storage = createStorageMock();
  storage.setItem(
    STATS_HISTORY_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      missevan: [
        {
          id: "missevan-id-2",
          platform: "missevan",
          createdAt: 1710000000001,
          createdAtLabel: "2024/3/9 16:00:01",
          taskType: "id",
          summaryMetrics: [],
          items: [
            {
              id: "456",
              title: "恢复作品",
              segments: [{ metricKey: "danmakuCount", label: "总弹幕数", value: "18" }],
            },
          ],
        },
      ],
      manbo: [],
    })
  );

  const restored = loadPersistedHistoryEntries(storage);
  assert.equal(restored.missevan[0].items[0].segments[0].metricKey, "danmakuCount");
  assert.equal(restored.missevan[0].items[0].segments[0].key, "danmakuCount");
});

test("loadPersistedHistoryEntries falls back to empty histories for corrupted data", () => {
  const storage = createStorageMock();
  storage.setItem(STATS_HISTORY_STORAGE_KEY, "{not-json");

  assert.deepEqual(loadPersistedHistoryEntries(storage), {
    missevan: [],
    manbo: [],
  });
});

test("selectDramaEpisodesByMode selects all or matching episodes and expands selected dramas", () => {
  const dramas = [
    {
      drama: { id: "101", name: "作品一" },
      expanded: false,
      episodes: {
        episode: [
          { sound_id: "1", selected: false, need_pay: true },
          { sound_id: "2", selected: false, need_pay: false },
        ],
      },
    },
    {
      drama: { id: "202", name: "作品二" },
      expanded: false,
      episodes: {
        episode: [{ sound_id: "3", selected: false, need_pay: true }],
      },
    },
  ];

  const allResult = selectDramaEpisodesByMode(dramas, ["101"], {
    mode: "all",
    checked: true,
    expand: true,
    isSelectableEpisode: (episode) => episode.need_pay === true,
  });

  assert.equal(allResult.hasMatchingEpisode, true);
  assert.equal(dramas[0].expanded, true);
  assert.deepEqual(dramas[0].episodes.episode.map((episode) => episode.selected), [true, true]);
  assert.deepEqual(dramas[1].episodes.episode.map((episode) => episode.selected), [false]);

  const paidResult = selectDramaEpisodesByMode(dramas, ["101", "202"], {
    mode: "paid",
    checked: false,
    expand: false,
    isSelectableEpisode: (episode) => episode.need_pay === true,
  });

  assert.equal(paidResult.hasMatchingEpisode, true);
  assert.deepEqual(dramas[0].episodes.episode.map((episode) => episode.selected), [false, true]);
  assert.deepEqual(dramas[1].episodes.episode.map((episode) => episode.selected), [false]);
});
