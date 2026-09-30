import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRanksShareTable,
  createRanksSharePng,
  ranksShareConstants,
} from "./ranksShare.js";

function createRank(items, overrides = {}) {
  return { key: "new_daily", label: "日榜", name: "日榜", items, ...overrides };
}

function createShareItem(index, overrides = {}) {
  return {
    rank: index + 1,
    id: String(index + 1),
    name: `剧集${index + 1}`,
    view_count: 123456,
    subscription_num: 0,
    reward_total: 25000,
    diamond_value: 1200,
    pay_count: 0,
    danmaku_uid_count: 0,
    ...overrides,
  };
}

function createCanvasHarness() {
  const calls = { fills: [], texts: [], textStyles: [], textPositions: [], clips: [], events: [], images: [], imageRects: [] };
  const states = [];
  const context = {
    font: "16px sans-serif",
    globalAlpha: 1,
    save() { states.push({ font: this.font, fillStyle: this.fillStyle, globalAlpha: this.globalAlpha }); },
    restore() { Object.assign(this, states.pop()); },
    translate() {},
    rotate() {},
    rect(x, y, width, height) { this.clipRect = { x, y, width, height }; },
    clip() { calls.clips.push(this.clipRect); },
    measureText(text) {
      const size = Number(this.font.match(/(\d+)px/)?.[1] || 16);
      return { width: Array.from(String(text)).length * size };
    },
    fillRect(x, y, width, height) {
      calls.fills.push({ color: this.fillStyle, x, y, width, height });
      calls.events.push({ kind: "fill", y });
    },
    fillText(text, x, y) {
      const normalizedText = String(text);
      calls.texts.push(normalizedText);
      calls.textStyles.push({ text: normalizedText, color: this.fillStyle, alpha: this.globalAlpha, font: this.font });
      calls.events.push({ kind: "text", text: normalizedText, alpha: this.globalAlpha });
      calls.textPositions.push({
        text: normalizedText,
        x,
        y,
        width: this.measureText(normalizedText).width,
        align: this.textAlign,
        font: this.font,
        baseline: this.textBaseline,
      });
    },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    drawImage(...args) {
      calls.images.push(args[0]);
      calls.imageRects.push({ x: args[1], y: args[2], width: args[3], height: args[4] });
    },
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toBlob(callback, type) { callback(new Blob(["png"], { type })); },
  };
  return { canvas, calls };
}

test("Missevan rank tables keep rank order, required columns, display formats, and the 30-row cap", () => {
  const items = Array.from({ length: 35 }, (_, index) => createShareItem(index, {
    name: `新品剧集${index + 1}`,
    view_count: index === 0 ? 123456 : 0,
    subscription_num: index === 0 ? 0 : null,
    reward_total: index === 0 ? 25000 : null,
    danmaku_uid_count: index === 0 ? null : 0,
    ...(index === 1 ? { payment_label: "付费" } : {}),
    ...(index === 2 ? { payment_label: "免费" } : {}),
  }));
  const table = buildRanksShareTable({
    platform: "missevan",
    categoryKey: "bestseller",
    updatedAt: "2026-09-29T17:00:00.000Z",
    rank: createRank(items, { key: "bestseller_monthly" }),
  });

  assert.equal(table.title, "猫耳畅销月榜");
  assert.deepEqual(table.metadata, { inlineText: "更新日期：2026-09-29", statusText: "" });
  assert.deepEqual(table.columns.map(({ label }) => label), ["剧集标题", "播放量", "追剧", "打赏（钻石）", "付费ID"]);
  assert.equal(table.rows.length, 30);
  assert.deepEqual(table.rows.slice(0, 2).map(({ title }) => title), ["1. 新品剧集1", "2. 新品剧集2"]);
  assert.equal(table.rows[0].view, "12.3万");
  assert.equal(table.rows[0].secondary, "0");
  assert.equal(table.rows[0].reward, "2.5万");
  assert.equal(table.rows[0].paidId, "-");
  assert.equal(table.rows[1].secondary, "-");
  assert.equal(table.rows[1].paidId, "0");
  assert.equal(table.rows[2].paidId, "-");
});

test("peak and growth tables use their period fields, exact limits, and official-status subtitles", () => {
  const peak = buildRanksShareTable({
    platform: "missevan",
    categoryKey: "peak",
    rank: createRank(Array.from({ length: 55 }, (_, index) => ({
      ...createShareItem(index),
      name: `系列${index + 1}`,
      type: "peak",
      daily_view_delta: { available: true, delta: 1234 },
    })), { key: "peak" }),
  });
  assert.equal(peak.title, "猫耳巅峰榜");
  assert.deepEqual(peak.columns.map(({ label }) => label), ["系列标题", "播放量", "日增"]);
  assert.equal(peak.rows.length, 50);
  assert.equal(peak.rows[0].delta, "+1234");
  assert.equal(peak.rows.at(-1).title, "50. 系列50");

  const growth = buildRanksShareTable({
    platform: "manbo",
    categoryKey: "growth",
    rank: createRank(Array.from({ length: 35 }, (_, index) => createShareItem(index, {
      name: `飙升剧${index + 1}`,
      view_count_increase: index === 0 ? -123 : 0,
      create_time: "2024-06-07 08:09:10",
    })), {
      key: "growth_monthly",
      statisticsPeriod: { startDate: "2026-08-30", endDate: "2026-09-26" },
    }),
  });
  assert.equal(growth.title, "漫播飙升榜（4周）");
  assert.deepEqual(growth.metadata, {
    inlineText: "统计区间：2026-08-30 至 2026-09-26",
    statusText: "*此榜单非官方",
  });
  assert.deepEqual(growth.columns.map(({ label }) => label), ["剧集标题", "播放量", "4周增量", "上线时间"]);
  assert.equal(growth.rows.length, 30);
  assert.equal(growth.rows[0].delta, "-123");
  assert.equal(growth.rows[0].createdAt, "2024-06-07 08:09:10");
});

test("Manbo rows show a dash without paid listening, retain paid ID zero, and omit paid IDs for peak", () => {
  const regular = buildRanksShareTable({
    platform: "manbo",
    categoryKey: "box_office",
    rank: createRank([
      createShareItem(0, { pay_count: null, danmaku_uid_count: null }),
      createShareItem(1, { pay_count: 42, danmaku_uid_count: 0 }),
    ], { key: "box_office_paid" }),
  });
  assert.equal(regular.title, "漫播票房付费剧榜");
  assert.deepEqual(regular.columns.map(({ label }) => label), ["剧集标题", "播放量", "收藏", "投喂（红豆）", "付费/收听", "付费ID"]);
  assert.equal(regular.rows[0].favorite, "0");
  assert.equal(regular.rows[0].pay, "-");
  assert.equal(regular.rows[0].paidId, "-");
  assert.equal(regular.rows[1].pay, "42");
  assert.equal(regular.rows[1].paidId, "0");

  const peak = buildRanksShareTable({
    platform: "manbo",
    categoryKey: "peak",
    rank: createRank([createShareItem(0, { pay_count: 0, danmaku_uid_count: null })], { key: "peak" }),
  });
  assert.equal(peak.title, "漫播巅峰榜");
  assert.deepEqual(peak.columns.map(({ label }) => label), ["剧集标题", "播放量", "收藏", "投喂（红豆）", "付费/收听"]);
  assert.equal(peak.rows[0].pay, "-");
  assert.equal("paidId" in peak.rows[0], false);
});

test("CV share tables include TOP3, date status, and compact playback values", () => {
  const table = buildRanksShareTable({
    platform: "manbo",
    categoryKey: "cv",
    updatedAt: "2026-09-29T17:00:00.000Z",
    rank: {
      key: "cv-paid",
      label: "付费榜",
      fetchedAt: "2026-09-29T17:00:00.000Z",
      items: [{
        rank: 2,
        cvName: "CV乙",
        totalViewCount: 12345,
        workCount: 0,
        topWorks: [{ title: "作品甲" }, { title: "作品乙" }, { title: "作品丙" }, { title: "作品丁" }],
      }],
    },
  });
  assert.equal(table.title, "漫播CV付费榜");
  assert.deepEqual(table.metadata, { inlineText: "更新日期：2026-09-29", statusText: "*此榜单非官方" });
  assert.deepEqual(table.columns.map(({ label }) => label), ["CV", "播放量", "剧集数量", "TOP3"]);
  assert.equal(table.columns.at(-1).maxWidth, 560);
  assert.deepEqual(table.rows[0], {
    title: "2. CV乙",
    view: "1.23万",
    workCount: "0",
    top3: "《作品甲》 《作品乙》 《作品丙》",
  });
});

test("CV TOP3 long works expand the image within the 1280px limit", async () => {
  const createCvPng = async (title) => {
    const harness = createCanvasHarness();
    await createRanksSharePng({
      platform: "missevan",
      categoryKey: "cv",
      rank: {
        key: "cv-total",
        fetchedAt: "2026-09-29T17:00:00.000Z",
        items: [{
          rank: 1,
          cvName: "CV甲",
          totalViewCount: 123456,
          workCount: 3,
          topWorks: [1, 2, 3].map((index) => ({ title: `${title}${index}` })),
        }],
      },
      canvasFactory: () => harness.canvas,
      loadLogo: async () => ({ local: true }),
    });
    return harness.canvas.width;
  };
  const shortWidth = await createCvPng("短作");
  const longWidth = await createCvPng("作品标题较长".repeat(20));
  assert.ok(longWidth > shortWidth);
  assert.ok(longWidth <= ranksShareConstants.maxWidth);
});

test("rank title metadata stays inline, while the unofficial label remains small and clear", async () => {
  const normalHarness = createCanvasHarness();
  await createRanksSharePng({
    platform: "missevan",
    categoryKey: "new",
    rank: createRank([createShareItem(0)]),
    updatedAt: "2026-09-29T17:00:00.000Z",
    canvasFactory: () => normalHarness.canvas,
    loadLogo: async () => ({ local: true }),
  });
  const normalTitle = normalHarness.calls.textPositions.find(({ text }) => text === "猫耳新品日榜");
  const normalDate = normalHarness.calls.textPositions.find(({ text }) => text.includes("更新日期：2026-09-29"));
  assert.ok(normalTitle);
  assert.ok(normalDate);
  assert.equal(normalTitle.y, normalDate.y);
  assert.equal(normalTitle.baseline, "bottom");
  assert.equal(normalDate.baseline, "bottom");
  assert.ok(Number(normalDate.font.match(/(\d+)px/)?.[1]) < Number(normalTitle.font.match(/(\d+)px/)?.[1]));

  const growthHarness = createCanvasHarness();
  const period = { startDate: "2026-08-30", endDate: "2026-09-26" };
  await createRanksSharePng({
    platform: "manbo",
    categoryKey: "growth",
    rank: createRank([createShareItem(0, { view_count_increase: -123 })], {
      key: "growth_monthly",
      statisticsPeriod: period,
    }),
    canvasFactory: () => growthHarness.canvas,
    loadLogo: async () => ({ local: true }),
  });
  const growthTitle = growthHarness.calls.textPositions.find(({ text }) => text === "漫播飙升榜（4周）");
  const growthMetadata = growthHarness.calls.textPositions.find(({ text }) => text.includes("统计区间：2026-08-30 至 2026-09-26"));
  const unofficial = growthHarness.calls.textPositions.find(({ text }) => text === "*此榜单非官方");
  assert.ok(growthTitle);
  assert.ok(growthMetadata);
  assert.equal(growthTitle.y, growthMetadata.y);
  assert.equal(growthTitle.baseline, "bottom");
  assert.equal(growthMetadata.baseline, "bottom");
  assert.equal(unofficial.align, "right");
  assert.ok(unofficial.y < growthTitle.y);
  assert.ok(unofficial.y < growthTitle.y - Number(growthTitle.font.match(/(\d+)px/)?.[1]));
  assert.ok(Number(unofficial.font.match(/(\d+)px/)?.[1]) < Number(growthMetadata.font.match(/(\d+)px/)?.[1]));
  const inlineLeft = Math.min(growthTitle.x, growthMetadata.x);
  const inlineRight = Math.max(growthTitle.x + growthTitle.width, growthMetadata.x + growthMetadata.width);
  assert.ok(Math.abs((inlineLeft + inlineRight) / 2 - growthHarness.canvas.width / 2) < 1);

  const wrappedHarness = createCanvasHarness();
  const longPeriod = { startDate: "2026-08-30".repeat(80), endDate: "2026-09-26".repeat(80) };
  await createRanksSharePng({
    platform: "manbo",
    categoryKey: "growth",
    rank: createRank([createShareItem(0, { view_count_increase: 0 })], {
      key: "growth_monthly",
      statisticsPeriod: longPeriod,
    }),
    canvasFactory: () => wrappedHarness.canvas,
    loadLogo: async () => ({ local: true }),
  });
  const titleAreaHeight = wrappedHarness.calls.fills.find(({ color }) => color === "#2767c8").y;
  const wrappedTitleText = wrappedHarness.calls.textPositions.filter(({ y, font }) => (
    y < titleAreaHeight && font !== unofficial.font
  ));
  assert.ok(titleAreaHeight > 80);
  assert.ok(wrappedTitleText.length > 2);
  wrappedTitleText.forEach(({ x, y, width }) => {
    assert.ok(x >= 0);
    assert.ok(x + width <= wrappedHarness.canvas.width);
    if (y >= 46) assert.notEqual(y, unofficial.y);
  });
});

test("rank numeric increment cells use green while ordinary metrics keep their metric color", async () => {
  const harness = createCanvasHarness();
  await createRanksSharePng({
    platform: "missevan",
    categoryKey: "growth",
    rank: createRank([
      createShareItem(0, { name: "负增量", view_count: 123456, view_count_increase: -123 }),
      createShareItem(1, { name: "正增量", view_count: 654321, view_count_increase: 123 }),
      createShareItem(2, { name: "零增量", view_count: 223456, view_count_increase: 0 }),
    ], { key: "growth_weekly", statisticsPeriod: { startDate: "2026-09-01", endDate: "2026-09-07" } }),
    canvasFactory: () => harness.canvas,
    loadLogo: async () => ({ local: true }),
  });
  const negativeDelta = harness.calls.textStyles.find(({ text }) => text === "-123");
  const positiveDelta = harness.calls.textStyles.find(({ text }) => text === "+123");
  const zeroDelta = harness.calls.textStyles.find(({ text }) => text === "0");
  const normalMetric = harness.calls.textStyles.find(({ text }) => text === "12.3万");
  assert.equal(negativeDelta.color, "#007b65");
  assert.equal(positiveDelta.color, "#007b65");
  assert.equal(zeroDelta.color, "#007b65");
  assert.equal(normalMetric.color, "#183a68");
});

test("rank PNG uses adaptive width, the shared low-opacity watermark, and the shared footer", async () => {
  const shortHarness = createCanvasHarness();
  const shortRank = createRank([createShareItem(0, { name: "短标题" })]);
  await createRanksSharePng({
    platform: "missevan",
    categoryKey: "new",
    rank: shortRank,
    updatedAt: "2026-09-29T17:00:00.000Z",
    canvasFactory: () => shortHarness.canvas,
    loadLogo: async () => ({ local: true }),
  });
  assert.ok(shortHarness.canvas.width < ranksShareConstants.maxWidth);
  assert.ok(shortHarness.canvas.width > 0);
  assert.ok(shortHarness.canvas.height <= ranksShareConstants.maxHeight);
  assert.equal(shortHarness.calls.clips[0].width, shortHarness.canvas.width);
  const marks = shortHarness.calls.textStyles.filter(({ text, alpha }) => text === "https://mmtoolkit.app" && alpha < 1);
  assert.ok(marks.length > 0);
  assert.ok(marks.every(({ alpha }) => alpha > 0 && alpha <= 0.12));
  const headerBand = shortHarness.calls.fills.find(({ color }) => color === "#2767c8");
  const footerBand = shortHarness.calls.fills.at(-1);
  assert.equal(shortHarness.calls.clips[0].y, headerBand.y + headerBand.height);
  assert.equal(shortHarness.calls.clips[0].y + shortHarness.calls.clips[0].height, footerBand.y);
  const lastMark = shortHarness.calls.events.findLastIndex(({ kind, alpha }) => kind === "text" && alpha < 1);
  const firstBodyText = shortHarness.calls.events.findIndex(({ text }) => text?.includes("短标题"));
  assert.ok(lastMark < firstBodyText);
  assert.equal(shortHarness.calls.textStyles.at(-1).alpha, 1);
  assert.equal(shortHarness.calls.texts.includes("https://mmtoolkit.app"), true);

  const longHarness = createCanvasHarness();
  await createRanksSharePng({
    platform: "missevan",
    categoryKey: "popular",
    rank: createRank([createShareItem(0, { name: "超长标题".repeat(80) })], { key: "popular_monthly" }),
    updatedAt: "2026-09-29T17:00:00.000Z",
    canvasFactory: () => longHarness.canvas,
    loadLogo: async () => ({ local: true }),
  });
  assert.ok(longHarness.canvas.width <= ranksShareConstants.maxWidth);
  assert.ok(longHarness.canvas.width < ranksShareConstants.maxWidth);
  assert.ok(longHarness.calls.texts.some((text) => text.includes("超长标题")));
});
