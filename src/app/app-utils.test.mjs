import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRevenuePaidMetricSegments,
  buildRevenueSummary,
  classifyMergedSearchInput,
  classifyUnifiedSearchInput,
  createStatsHistoryEntry,
  getHistoryMetricIconKey,
  formatSignedCompactMetricValue,
  formatDeviceDateTime,
  formatRankCompactCount,
  formatRevenueDisplayValue,
  getRevenueDisplayLabel,
  getInlineTaggedTitleDisplayText,
  getRevenuePaidCountLabel,
  loadPersistedHistoryEntries,
  parseRawItems,
  resolveRevenueSummaryForHistory,
  savePersistedHistoryEntries,
  selectDramaEpisodesByMode,
  hasSearchKeywordInResultTitles,
  shouldUseManboLibraryFallbackForMissevanSearch,
  STATS_HISTORY_STORAGE_KEY,
} from "./app-utils.js";

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
  assert.equal(formatSignedCompactMetricValue(-12345), "-1.2万");
  assert.equal(formatSignedCompactMetricValue(12345), "+1.2万");
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
