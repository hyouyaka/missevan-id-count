import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOngoingShareTable,
  createOngoingSharePng,
  drawOngoingShareMetricCell,
  getOngoingShareColumnWidths,
  measureOngoingShareSingleLineRows,
  ongoingShareCanvasConstants,
  wrapOngoingShareMetricCell,
} from "./ongoingShare.js";

function createItem({
  id = "1",
  name = "测试剧集",
  mainCv = "测试CV",
  values = {},
  deltas = {},
  unavailable = [],
} = {}) {
  const keys = ["view_count", "subscription_num", "pay_count", "danmaku_uid_count"];
  return {
    id,
    name,
    main_cv_text: mainCv,
    metrics: Object.fromEntries(keys.map((key) => [key, {
      value: values[key] ?? 0,
      visible: true,
    }])),
    windows: {
      "7d": {
        metrics: Object.fromEntries(keys.map((key) => [key, {
          delta: unavailable.includes(key) ? null : deltas[key] ?? 0,
          available: !unavailable.includes(key),
        }])),
      },
    },
  };
}

function createCanvasHarness() {
  const calls = { fills: [], texts: [], textStyles: [], textPositions: [], imageRects: [], clips: [], events: [], strokes: 0, images: 0 };
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
      calls.textStyles.push({ text: normalizedText, color: this.fillStyle, font: this.font, alpha: this.globalAlpha });
      calls.events.push({ kind: "text", text: normalizedText, alpha: this.globalAlpha });
      calls.textPositions.push({
        text: normalizedText,
        x,
        y,
        width: this.measureText(normalizedText).width,
        font: this.font,
      });
    },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() { calls.strokes += 1; },
    drawImage(...args) {
      calls.images += 1;
      calls.imageRects.push({ x: args[1], y: args[2], width: args[3], height: args[4] });
    },
  };
  const canvas = {
    width: 300,
    height: 150,
    getContext: () => context,
    toBlob(callback, type) {
      callback(new Blob(["png"], { type }));
    },
  };
  return { canvas, calls };
}

test("share table maps current totals and full 7-day deltas for both platforms", () => {
  const item = createItem({
    name: "完整数值测试",
    mainCv: "主要CV：CV甲，CV乙",
    values: { view_count: 1234567, subscription_num: 4321, pay_count: 8765, danmaku_uid_count: 2345 },
    deltas: { view_count: 12345, subscription_num: 20, pay_count: -123, danmaku_uid_count: 2 },
  });

  const missevanTable = buildOngoingShareTable({ platform: "missevan", metric: "secondary", items: [item] });
  assert.equal(missevanTable.title, "猫耳一周内更新剧集（按追剧人数7日增量排序）");
  assert.deepEqual(missevanTable.columns.map(({ key }) => key), [
    "title", "mainCv", "view_count", "subscription_num", "danmaku_uid_count",
  ]);
  assert.deepEqual(missevanTable.columns.map(({ label }) => label), [
    "标题",
    "主役",
    "播放量",
    "追剧人数",
    "付费ID数",
  ]);
  assert.deepEqual(missevanTable.rows[0], {
    title: "完整数值测试",
    mainCv: "CV甲，CV乙",
    view_count: "123.5万（+1.2万）",
    subscription_num: "4321（+20）",
    danmaku_uid_count: "2345（+2）",
  });

  const manboTable = buildOngoingShareTable({ platform: "manbo", metric: "secondary", items: [item] });
  assert.equal(manboTable.title, "漫播一周内更新剧集（按付费/收听人数7日增量排序）");
  assert.deepEqual(manboTable.columns.map(({ key }) => key), [
    "title", "mainCv", "view_count", "pay_count", "danmaku_uid_count",
  ]);
  assert.deepEqual(manboTable.columns.map(({ label }) => label), [
    "标题",
    "主役",
    "播放量",
    "付费/收听人数",
    "付费ID数",
  ]);
  assert.equal(manboTable.rows[0].pay_count, "8765（-123）");
});

test("share table snapshots selected CV names without adding a subtitle when none are selected", () => {
  const items = [createItem()];
  const single = buildOngoingShareTable({
    platform: "missevan",
    items,
    selectedCvNames: ["  CV甲  "],
  });
  const multiple = buildOngoingShareTable({
    platform: "manbo",
    items,
    selectedCvNames: ["CV甲", "CV乙", "CV甲", ""],
  });
  const unfiltered = buildOngoingShareTable({ platform: "missevan", items });

  assert.deepEqual(single.selectedCvNames, ["CV甲"]);
  assert.equal(single.cvFilterText, "筛选CV：CV甲");
  assert.deepEqual(multiple.selectedCvNames, ["CV甲", "CV乙"]);
  assert.equal(multiple.cvFilterText, "筛选CV：CV甲、CV乙");
  assert.deepEqual(unfiltered.selectedCvNames, []);
  assert.equal(unfiltered.cvFilterText, "");
});

test("share table labels either unavailable current values or unavailable 7-day deltas", () => {
  const item = createItem({
    values: { view_count: null, subscription_num: 1234, danmaku_uid_count: 0 },
    deltas: { view_count: 1000, subscription_num: null, danmaku_uid_count: 0 },
    unavailable: ["subscription_num", "danmaku_uid_count"],
  });
  item.metrics.view_count.value = null;
  const table = buildOngoingShareTable({ platform: "missevan", metric: "paid-id", items: [item] });

  assert.equal(table.rows[0].view_count, "暂不可用（暂不可用）");
  assert.equal(table.rows[0].subscription_num, "1234（暂无）");
  assert.equal(table.rows[0].danmaku_uid_count, "0（暂无）");
});

test("PNG metric cells use page status text and split only before the delta token", () => {
  const item = createItem({
    values: { view_count: 1234, subscription_num: 1234, danmaku_uid_count: 8 },
    deltas: { view_count: null, subscription_num: 12, danmaku_uid_count: 0 },
    unavailable: ["view_count"],
  });
  item.windows["7d"].metrics.danmaku_uid_count = {
    key: "danmaku_uid_count",
    fromValue: 0,
    toValue: 0,
    delta: 0,
    available: true,
  };
  const table = buildOngoingShareTable({ platform: "missevan", metric: "playback", items: [item] });
  assert.equal(table.rows[0].view_count, "1234（暂无）");
  assert.equal(table.rows[0].danmaku_uid_count, "暂无付费集");

  const context = {
    font: "10px sans-serif",
    measureText(text) { return { width: Array.from(String(text)).length * 10 }; },
  };
  assert.deepEqual(wrapOngoingShareMetricCell(context, "123.5万（+1.2万）", 90, "10px sans-serif"), [
    "123.5万",
    "（+1.2万）",
  ]);
  assert.deepEqual(wrapOngoingShareMetricCell(context, "12万（+999万）", 40, "10px sans-serif"), [
    "12万",
    "（+99",
    "9万）",
  ]);
  assert.deepEqual(wrapOngoingShareMetricCell(context, "12万（+1万）", 200, "10px sans-serif"), [
    "12万（+1万）",
  ]);
});

test("share rows count as single-line only when all five cells fit", () => {
  const table = buildOngoingShareTable({
    platform: "manbo",
    items: [
      createItem({ name: "短剧", mainCv: "CV甲" }),
      createItem({ id: "2", name: "超长标题".repeat(80), mainCv: "超长主役".repeat(60) }),
    ],
  });
  const context = {
    font: "16px sans-serif",
    measureText(text) {
      const size = Number(this.font.match(/(\d+)px/)?.[1] || 16);
      return { width: Array.from(String(text)).length * size };
    },
  };
  const widths = getOngoingShareColumnWidths(context, table);
  const measurement = measureOngoingShareSingleLineRows(context, table, widths);

  assert.equal(measurement.rowCount, 2);
  assert.ok(widths.reduce((sum, width) => sum + width, 0) <= ongoingShareCanvasConstants.width);
  assert.equal(measurement.singleLineRowCount, 1);
  assert.equal(measurement.ratio, 50);
  assert.equal(measurement.rows[0].isSingleLine, true);
  assert.equal(measurement.rows[0].cellsFit.length, 5);
  assert.equal(measurement.rows[1].isSingleLine, false);
  assert.equal(measurement.rows[1].cellsFit[0], false);
});

test("positive and negative delta parentheses stay green on one line and wrapped continuation lines", () => {
  const oneLine = createCanvasHarness();
  drawOngoingShareMetricCell(oneLine.canvas.getContext("2d"), ["1234（+12）"], 0, 0, 240, 32, {
    font: "16px sans-serif",
  });
  assert.deepEqual(oneLine.calls.textStyles.map(({ text, color }) => [text, color]), [
    ["1234", "#183a68"],
    ["（+12）", ongoingShareCanvasConstants.deltaTextColor],
  ]);

  const negativeOneLine = createCanvasHarness();
  drawOngoingShareMetricCell(negativeOneLine.canvas.getContext("2d"), ["1234（-12）"], 0, 0, 240, 32, {
    font: "16px sans-serif",
  });
  assert.deepEqual(negativeOneLine.calls.textStyles.map(({ text, color }) => [text, color]), [
    ["1234", "#183a68"],
    ["（-12）", ongoingShareCanvasConstants.deltaTextColor],
  ]);

  const zeroOneLine = createCanvasHarness();
  drawOngoingShareMetricCell(zeroOneLine.canvas.getContext("2d"), ["1234（0）"], 0, 0, 240, 32, {
    font: "16px sans-serif",
  });
  assert.deepEqual(zeroOneLine.calls.textStyles.map(({ text, color }) => [text, color]), [
    ["1234", "#183a68"],
    ["（0）", ongoingShareCanvasConstants.deltaTextColor],
  ]);

  const twoLines = createCanvasHarness();
  drawOngoingShareMetricCell(twoLines.canvas.getContext("2d"), ["1234", "（+12）"], 0, 0, 240, 48, {
    font: "16px sans-serif",
  });
  assert.deepEqual(twoLines.calls.textStyles.map(({ text, color }) => [text, color]), [
    ["1234", "#183a68"],
    ["（+12）", ongoingShareCanvasConstants.deltaTextColor],
  ]);

  const wrapped = createCanvasHarness();
  drawOngoingShareMetricCell(wrapped.canvas.getContext("2d"), ["12万", "（+99", "9万）"], 0, 0, 80, 72, {
    font: "10px sans-serif",
    lineHeight: 22,
  });
  assert.deepEqual(wrapped.calls.textStyles.map(({ text, color }) => [text, color]), [
    ["12万", "#183a68"],
    ["（+99", ongoingShareCanvasConstants.deltaTextColor],
    ["9万）", ongoingShareCanvasConstants.deltaTextColor],
  ]);

  const negativeWrapped = createCanvasHarness();
  drawOngoingShareMetricCell(negativeWrapped.canvas.getContext("2d"), ["12万", "（-99", "9万）"], 0, 0, 80, 72, {
    font: "10px sans-serif",
    lineHeight: 22,
  });
  assert.deepEqual(negativeWrapped.calls.textStyles.map(({ text, color }) => [text, color]), [
    ["12万", "#183a68"],
    ["（-99", ongoingShareCanvasConstants.deltaTextColor],
    ["9万）", ongoingShareCanvasConstants.deltaTextColor],
  ]);
});

test("Manbo's longest metric header fits the allocated content width", () => {
  const table = buildOngoingShareTable({ platform: "manbo", items: [createItem()] });
  const context = {
    font: "16px sans-serif",
    measureText(text) {
      const size = Number(this.font.match(/(\d+)px/)?.[1] || 16);
      return { width: Array.from(String(text)).length * size };
    },
  };
  const widths = getOngoingShareColumnWidths(context, table);
  const metricColumn = table.columns.find((column) => column.key === "pay_count");
  context.font = '600 16px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
  const requiredContentWidth = context.measureText(metricColumn.label).width;

  assert.equal(metricColumn.label, "付费/收听人数");
  assert.equal("subLabel" in metricColumn, false);
  assert.ok(widths[table.columns.indexOf(metricColumn)] >= requiredContentWidth + ongoingShareCanvasConstants.cellPaddingX * 2);
  assert.ok(widths.reduce((sum, width) => sum + width, 0) <= ongoingShareCanvasConstants.width - ongoingShareCanvasConstants.margin * 2);
});

test("PNG rendering adapts width, grows with rows, wraps long text, and embeds the local logo", async () => {
  const longTitle = "超长标题".repeat(60);
  const longCv = "主役名字".repeat(40);
  const item = createItem({
    name: longTitle,
    mainCv: longCv,
    values: { view_count: 1234567, subscription_num: 123, danmaku_uid_count: 4 },
    deltas: { view_count: 123, subscription_num: 12, danmaku_uid_count: 1 },
  });
  const oneRowHarness = createCanvasHarness();
  const oneRowBlob = await createOngoingSharePng({
    platform: "missevan",
    metric: "playback",
    items: [item],
    canvasFactory: () => oneRowHarness.canvas,
    loadLogo: async () => ({ local: true }),
  });
  const manyRowsHarness = createCanvasHarness();
  await createOngoingSharePng({
    platform: "missevan",
    metric: "playback",
    items: Array.from({ length: 12 }, (_, index) => createItem({ id: String(index), name: `作品${index}` })),
    canvasFactory: () => manyRowsHarness.canvas,
    loadLogo: async () => ({ local: true }),
  });

  assert.ok(oneRowHarness.canvas.width <= ongoingShareCanvasConstants.width);
  assert.ok(oneRowHarness.canvas.width > 0);
  assert.ok(manyRowsHarness.canvas.width < oneRowHarness.canvas.width);
  assert.ok(oneRowHarness.canvas.height > 0);
  assert.ok(manyRowsHarness.canvas.height > oneRowHarness.canvas.height);
  assert.equal(oneRowBlob.type, "image/png");
  assert.equal(oneRowHarness.calls.images, 1);
  assert.ok(oneRowHarness.calls.texts.join("").includes(longTitle));
  assert.ok(oneRowHarness.calls.texts.join("").includes(longCv));
  assert.ok(oneRowHarness.calls.texts.includes("播放量"));
  for (const color of ["#1b2a45", "#2767c8", "#ffffff"]) {
    const tableBands = oneRowHarness.calls.fills.filter((fill) => fill.color === color);
    assert.ok(tableBands.length > 0);
    tableBands.forEach((fill) => {
      assert.equal(fill.x, 0);
      assert.equal(fill.width, oneRowHarness.canvas.width);
    });
  }
  const paleStripe = manyRowsHarness.calls.fills.find((fill) => fill.color === "#edf5ff");
  assert.ok(paleStripe);
  assert.equal(paleStripe.x, 0);
  assert.equal(paleStripe.width, manyRowsHarness.canvas.width);
  const logoRect = oneRowHarness.calls.imageRects[0];
  assert.ok(logoRect.x + logoRect.width <= oneRowHarness.canvas.width - ongoingShareCanvasConstants.footerRightInset);
});

test("PNG CV subtitle wraps completely, grows the title area, and is absent without a filter", async () => {
  const items = [createItem()];
  const noFilter = createCanvasHarness();
  await createOngoingSharePng({
    platform: "missevan",
    metric: "playback",
    items,
    canvasFactory: () => noFilter.canvas,
    loadLogo: async () => ({ local: true }),
  });
  assert.equal(noFilter.calls.texts.some((text) => text.startsWith("筛选CV：")), false);

  const multiple = createCanvasHarness();
  const multipleNames = ["CV甲", "CV乙"];
  await createOngoingSharePng({
    platform: "missevan",
    metric: "playback",
    items,
    selectedCvNames: multipleNames,
    canvasFactory: () => multiple.canvas,
    loadLogo: async () => ({ local: true }),
  });
  assert.ok(multiple.calls.texts.includes("筛选CV：CV甲、CV乙"));
  assert.ok(multiple.canvas.height > noFilter.canvas.height);

  const longNames = ["长CV甲".repeat(100), "长CV乙".repeat(100)];
  const long = createCanvasHarness();
  await createOngoingSharePng({
    platform: "manbo",
    metric: "secondary",
    items,
    selectedCvNames: longNames,
    canvasFactory: () => long.canvas,
    loadLogo: async () => ({ local: true }),
  });
  const subtitleStart = long.calls.texts.findIndex((text) => text.startsWith("筛选CV："));
  const headerStart = long.calls.texts.indexOf("标题", subtitleStart);
  assert.notEqual(subtitleStart, -1);
  assert.notEqual(headerStart, -1);
  assert.equal(
    long.calls.texts.slice(subtitleStart, headerStart).join(""),
    `筛选CV：${longNames.join("、")}`
  );
  assert.ok(long.canvas.height > multiple.canvas.height);
});

test("PNG footer uses the secure site address", async () => {
  const harness = createCanvasHarness();
  await createOngoingSharePng({
    platform: "manbo",
    metric: "secondary",
    items: [createItem()],
    canvasFactory: () => harness.canvas,
    loadLogo: async () => ({ local: true }),
  });
  assert.ok(harness.calls.texts.includes("https://mmtoolkit.app"));
  const sitePosition = harness.calls.textPositions.findLast(({ text }) => text === "https://mmtoolkit.app");
  assert.ok(sitePosition.x + sitePosition.width <= harness.canvas.width - ongoingShareCanvasConstants.footerRightInset);
  assert.equal(ongoingShareCanvasConstants.tableWidth, ongoingShareCanvasConstants.width);
  assert.equal(ongoingShareCanvasConstants.margin, 0);
});

test("PNG watermark stays behind readable body content and outside the header and footer", async () => {
  const harness = createCanvasHarness();
  await createOngoingSharePng({
    platform: "missevan",
    items: Array.from({ length: 8 }, (_, index) => createItem({ name: `水印测试${index}`, mainCv: "主役甲", values: { view_count: 1234 } })),
    canvasFactory: () => harness.canvas,
    loadLogo: async () => ({ local: true }),
  });
  const marks = harness.calls.textStyles.filter(({ text, alpha }) => text === "https://mmtoolkit.app" && alpha < 1);
  assert.ok(marks.length > 3, "repeat the address across the body");
  assert.ok(marks.every(({ alpha }) => alpha > 0 && alpha <= 0.12), "keep the watermark faint");
  const bodyClip = harness.calls.clips[0];
  const headerBand = harness.calls.fills.find(({ color }) => color === "#2767c8");
  const footerBand = harness.calls.fills.at(-1);
  assert.equal(bodyClip.y, headerBand.y + headerBand.height);
  assert.equal(bodyClip.width, harness.canvas.width);
  assert.equal(bodyClip.y + bodyClip.height, footerBand.y);
  const firstMark = harness.calls.events.findIndex(({ kind, alpha }) => kind === "text" && alpha < 1);
  const lastMark = harness.calls.events.findLastIndex(({ kind, alpha }) => kind === "text" && alpha < 1);
  const bodyFills = harness.calls.events.flatMap((event, index) => event.kind === "fill" && event.y >= bodyClip.y && event.y < footerBand.y ? [index] : []);
  assert.ok(bodyFills.every((index) => index < firstMark), "row backgrounds must not cover the watermark");
  const firstBodyText = harness.calls.events.findIndex(({ text }) => text === "水印测试0");
  assert.ok(lastMark < firstBodyText, "watermarks must not paint over body text");
  assert.ok(harness.calls.textStyles.filter(({ text }) => text !== "https://mmtoolkit.app").every(({ alpha }) => alpha === 1));
  assert.equal(harness.calls.textStyles.at(-1).alpha, 1, "restore opacity for the footer address");
});

test("PNG rendering rejects an empty visible list with a retryable message", async () => {
  await assert.rejects(
    createOngoingSharePng({ platform: "manbo", metric: "playback", items: [], canvasFactory: createCanvasHarness }),
    /没有可分享的作品/
  );
});

test("PNG rendering refuses an unsafe canvas height instead of clipping the list", async () => {
  const longRows = Array.from({ length: 330 }, (_, index) => createItem({
    id: String(index),
    name: `作品${index}`,
  }));
  await assert.rejects(
    createOngoingSharePng({
      platform: "manbo",
      metric: "playback",
      items: longRows,
      canvasFactory: () => createCanvasHarness().canvas,
      loadLogo: async () => ({ local: true }),
    }),
    /列表过长.*缩小 CV 筛选/,
  );
});
