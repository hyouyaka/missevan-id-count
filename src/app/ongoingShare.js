import { getOngoingMetricDisplay } from "../../shared/ongoingUtils.js";

const SHARE_WIDTH = 1280;
const MAX_SHARE_HEIGHT = 16000;
const SHARE_MARGIN = 0;
const TABLE_WIDTH = SHARE_WIDTH - SHARE_MARGIN * 2;
const MIN_SHARE_WIDTH = 680;
const FOOTER_RIGHT_INSET = 56;
const CELL_PADDING_X = 12;
const HEADER_FONT = '600 16px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const TITLE_FONT = '700 26px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const SUBTITLE_FONT = '400 17px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
export const shareImageFonts = Object.freeze({
  header: HEADER_FONT,
  title: TITLE_FONT,
  subtitle: SUBTITLE_FONT,
  body: '400 16px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
  titleCell: '500 18px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
});
export const shareImageColors = Object.freeze({
  canvas: "#f8fafc",
  title: "#1b2a45",
  header: "#2767c8",
  body: "#172033",
  metric: "#183a68",
  row: "#ffffff",
  alternateRow: "#edf5ff",
  grid: "#dce6f2",
  subtitle: "#cbd5e1",
  delta: "#007b65",
});
// Matches the project's 88% success-color/foreground mix with 4.75:1 contrast on the blue row fill.
const DELTA_TEXT_COLOR = "#007b65";
const SITE_ADDRESS = "https://mmtoolkit.app";

export function drawShareBodyWatermark(context, top, height, width = TABLE_WIDTH) {
  context.save();
  context.beginPath();
  context.rect(SHARE_MARGIN, top, width, height);
  context.clip();
  context.fillStyle = "#526a87";
  context.globalAlpha = 0.09;
  context.font = '500 22px "Geist", sans-serif';
  context.textAlign = "center";
  context.textBaseline = "middle";
  const spacingY = 156;
  for (let y = Math.min(68, height / 2), row = 0; y < height; y += spacingY, row += 1) {
    for (let x = 190 + (row % 2) * 110; x < width; x += 420) {
      context.save();
      context.translate(SHARE_MARGIN + x, top + y);
      context.rotate(-Math.PI / 24);
      context.fillText(SITE_ADDRESS, 0, 0);
      context.restore();
    }
  }
  context.restore();
}

const metricColumnsByPlatform = {
  missevan: [
    { key: "view_count", label: "播放量" },
    { key: "subscription_num", label: "追剧人数" },
    { key: "danmaku_uid_count", label: "付费ID数" },
  ],
  manbo: [
    { key: "view_count", label: "播放量" },
    { key: "pay_count", label: "付费/收听人数" },
    { key: "danmaku_uid_count", label: "付费ID数" },
  ],
};

const metricLabelsByPlatform = {
  missevan: { playback: "播放量", secondary: "追剧人数", "paid-id": "付费ID数" },
  manbo: { playback: "播放量", secondary: "付费/收听人数", "paid-id": "付费ID数" },
};

function normalizePlatform(platform) {
  return platform === "manbo" ? "manbo" : "missevan";
}

function normalizeText(value, fallback = "") {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim() || fallback;
}

function formatMetricCell(metricKey, metric, windowMetric) {
  const display = getOngoingMetricDisplay({
    currentValue: metric?.value,
    metricKey,
    windowMetric,
  });
  if (display.showEmptyPaidDanmaku) {
    return display.currentText;
  }
  return `${display.currentText}（${display.deltaText}）`;
}

export function getOngoingShareMetricLabel(platform, metric) {
  const normalizedPlatform = normalizePlatform(platform);
  return metricLabelsByPlatform[normalizedPlatform][metric] || metricLabelsByPlatform[normalizedPlatform].playback;
}

export function buildOngoingShareTable({ platform, metric, items = [], selectedCvNames = [] } = {}) {
  const normalizedPlatform = normalizePlatform(platform);
  const metricColumns = metricColumnsByPlatform[normalizedPlatform];
  const metricName = getOngoingShareMetricLabel(normalizedPlatform, metric);
  const platformName = normalizedPlatform === "manbo" ? "漫播" : "猫耳";
  const normalizedCvNames = Array.isArray(selectedCvNames)
    ? Array.from(new Set(selectedCvNames.map((name) => normalizeText(name)).filter(Boolean)))
    : [];
  const rows = (Array.isArray(items) ? items : []).map((item) => {
    const mainCv = normalizeText(
      item?.main_cv_text?.replace?.(/^主要CV：/, "") || item?.main_cvs?.join?.("，"),
      "暂无"
    );
    return {
      title: normalizeText(item?.name, "未命名剧集"),
      mainCv,
      ...Object.fromEntries(metricColumns.map(({ key }) => [
        key,
        formatMetricCell(key, item?.metrics?.[key], item?.windows?.["7d"]?.metrics?.[key]),
      ])),
    };
  });

  return {
    platform: normalizedPlatform,
    metric: metric || "playback",
    metricName,
    title: `${platformName}一周内更新剧集（按${metricName}7日增量排序）`,
    cvFilterText: normalizedCvNames.length ? `筛选CV：${normalizedCvNames.join("、")}` : "",
    selectedCvNames: normalizedCvNames,
    columns: [
      { key: "title", label: "标题" },
      { key: "mainCv", label: "主役" },
      ...metricColumns.map(({ key, label }) => ({ key, label })),
    ],
    rows,
  };
}

function setFont(context, font) {
  context.font = font;
}

function measureTextWidth(context, text, font) {
  setFont(context, font);
  return context.measureText(text || " ").width;
}

export function wrapShareText(context, text, maxWidth, font) {
  setFont(context, font);
  const paragraphs = String(text ?? "").split("\n");
  const lines = [];
  paragraphs.forEach((paragraph) => {
    if (!paragraph) {
      lines.push("");
      return;
    }
    let line = "";
    for (const character of Array.from(paragraph)) {
      const candidate = `${line}${character}`;
      if (!line || context.measureText(candidate).width <= maxWidth) {
        line = candidate;
      } else {
        lines.push(line.trimEnd());
        line = character.trimStart();
      }
    }
    lines.push(line);
  });
  return lines.length ? lines : [""];
}

export function wrapOngoingShareMetricCell(context, text, maxWidth, font) {
  const normalizedText = String(text ?? "");
  const openParenIndex = normalizedText.indexOf("（");
  if (openParenIndex <= 0) {
    return wrapShareText(context, normalizedText, maxWidth, font);
  }

  const currentValue = normalizedText.slice(0, openParenIndex);
  const deltaValue = normalizedText.slice(openParenIndex);
  if (measureTextWidth(context, normalizedText, font) <= maxWidth) {
    return [normalizedText];
  }

  const wrapTokenIfNeeded = (token) => (
    measureTextWidth(context, token, font) <= maxWidth
      ? [token]
      : wrapShareText(context, token, maxWidth, font)
  );
  return [...wrapTokenIfNeeded(currentValue), ...wrapTokenIfNeeded(deltaValue)];
}

export function getAdaptiveShareColumnWidths(context, {
  columns = [],
  rows = [],
  bodyFonts = [],
  minWidths = [],
  maxWidths = [],
  minCanvasWidth = MIN_SHARE_WIDTH,
  maxCanvasWidth = SHARE_WIDTH,
} = {}) {
  const minimumWidths = columns.map((column, index) => Math.max(
    Number(minWidths[index]) || 0,
    Math.ceil(measureTextWidth(context, column.label, HEADER_FONT) + CELL_PADDING_X * 2)
  ));
  const preferredWidths = columns.map((column, index) => {
    const headerWidth = measureTextWidth(context, column.label, HEADER_FONT);
    const cellWidths = rows.map((row) => measureTextWidth(context, row[column.key], bodyFonts[index] || BODY_FONT));
    const contentWidth = Math.ceil(Math.max(headerWidth, ...cellWidths) + CELL_PADDING_X * 2);
    const columnMaxWidth = Math.max(minimumWidths[index], Number(maxWidths[index]) || maxCanvasWidth);
    return Math.min(columnMaxWidth, Math.max(minimumWidths[index], contentWidth));
  });
  const minimumTotal = minimumWidths.reduce((sum, value) => sum + value, 0);
  const preferredTotal = preferredWidths.reduce((sum, value) => sum + value, 0);
  const targetWidth = Math.min(
    maxCanvasWidth,
    Math.max(minimumTotal, minCanvasWidth, preferredTotal)
  );
  const widths = [...minimumWidths];
  const deficits = preferredWidths.map((value, index) => Math.max(0, value - minimumWidths[index]));
  const deficitTotal = deficits.reduce((sum, value) => sum + value, 0);
  let unassigned = targetWidth - minimumTotal;
  if (deficitTotal > 0 && unassigned > 0) {
    deficits.forEach((deficit, index) => {
      const allocation = Math.min(deficit, Math.floor((targetWidth - minimumTotal) * deficit / deficitTotal));
      widths[index] += allocation;
      unassigned -= allocation;
    });
    while (unassigned > 0) {
      const nextIndex = widths.findIndex((value, index) => value < preferredWidths[index]);
      if (nextIndex < 0) break;
      widths[nextIndex] += 1;
      unassigned -= 1;
    }
  }
  if (unassigned > 0) {
    widths[0] += unassigned;
  }
  return widths;
}

export function getOngoingShareColumnWidths(context, table) {
  const bodyFonts = getOngoingShareBodyFonts(table);
  return getAdaptiveShareColumnWidths(context, {
    columns: table.columns,
    rows: table.rows,
    bodyFonts,
    minWidths: [240, 160, ...table.columns.slice(2).map(() => 140)],
    maxWidths: [440, 340, ...table.columns.slice(2).map(() => 250)],
    minCanvasWidth: MIN_SHARE_WIDTH,
    maxCanvasWidth: TABLE_WIDTH,
  });
}

const BODY_FONT = '400 16px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';

function getOngoingShareBodyFonts(table) {
  return [
    '500 18px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
    '400 17px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
    ...table.columns.slice(2).map(() => '400 16px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif'),
  ];
}

export function measureOngoingShareSingleLineRows(context, table, columnWidths = getOngoingShareColumnWidths(context, table)) {
  const fonts = getOngoingShareBodyFonts(table);
  const rows = table.rows.map((row, rowIndex) => {
    const cellsFit = table.columns.map((column, columnIndex) => (
      !String(row[column.key] ?? "").includes("\n") &&
      measureTextWidth(context, row[column.key], fonts[columnIndex]) <= columnWidths[columnIndex] - CELL_PADDING_X * 2
    ));
    return { rowIndex, cellsFit, isSingleLine: cellsFit.every(Boolean) };
  });
  const singleLineRowCount = rows.filter((row) => row.isSingleLine).length;
  return {
    rowCount: rows.length,
    singleLineRowCount,
    ratio: rows.length ? Math.round(singleLineRowCount * 1000 / rows.length) / 10 : 0,
    rows,
  };
}

export function drawShareWrappedCell(context, lines, x, y, width, height, options = {}) {
  const { align = "left", color = "#172033", font, lineHeight = 27 } = options;
  setFont(context, font);
  context.fillStyle = color;
  context.textAlign = align;
  context.textBaseline = "middle";
  const firstLineY = y + height / 2 - ((lines.length - 1) * lineHeight) / 2;
  const textX = align === "center" ? x + width / 2 : x + CELL_PADDING_X;
  lines.forEach((line, index) => context.fillText(line, textX, firstLineY + index * lineHeight));
}

export function drawOngoingShareMetricCell(context, lines, x, y, width, height, options = {}) {
  const { align = "center", color = "#183a68", font, lineHeight = 22 } = options;
  setFont(context, font);
  context.textBaseline = "middle";
  const firstLineY = y + height / 2 - ((lines.length - 1) * lineHeight) / 2;
  let isDrawingDelta = false;
  lines.forEach((line, index) => {
    const openParenIndex = line.indexOf("（");
    if (openParenIndex >= 0) {
      isDrawingDelta = true;
    }
    if (openParenIndex < 0 && !isDrawingDelta) {
      context.fillStyle = color;
      context.textAlign = align;
      const textX = align === "center" ? x + width / 2 : x + CELL_PADDING_X;
      context.fillText(line, textX, firstLineY + index * lineHeight);
      return;
    }

    if (openParenIndex < 0) {
      context.fillStyle = DELTA_TEXT_COLOR;
      context.textAlign = align;
      const textX = align === "center" ? x + width / 2 : x + CELL_PADDING_X;
      context.fillText(line, textX, firstLineY + index * lineHeight);
    } else {
      const currentValue = line.slice(0, openParenIndex);
      const deltaValue = line.slice(openParenIndex);
      const currentWidth = currentValue ? measureTextWidth(context, currentValue, font) : 0;
      const deltaWidth = measureTextWidth(context, deltaValue, font);
      const textX = align === "center"
        ? x + (width - currentWidth - deltaWidth) / 2
        : x + CELL_PADDING_X;
      context.textAlign = "left";
      if (currentValue) {
        context.fillStyle = color;
        context.fillText(currentValue, textX, firstLineY + index * lineHeight);
      }
      context.fillStyle = DELTA_TEXT_COLOR;
      context.fillText(deltaValue, textX + currentWidth, firstLineY + index * lineHeight);
    }
    if (line.includes("）")) {
      isDrawingDelta = false;
    }
  });
}

export function loadLocalLogo() {
  return new Promise((resolve, reject) => {
    if (typeof Image === "undefined") {
      reject(new Error("当前浏览器无法载入分享图片所需的项目图标。"));
      return;
    }
    const candidates = ["/icon.png", "/app-icon.png"];
    const image = new Image();
    let candidateIndex = 0;
    image.onload = () => resolve(image);
    image.onerror = () => {
      candidateIndex += 1;
      if (candidateIndex >= candidates.length) {
        reject(new Error("项目图标载入失败，请重试生成分享图片。"));
        return;
      }
      image.src = candidates[candidateIndex];
    };
    image.src = candidates[candidateIndex];
  });
}

export function canvasToPngBlob(canvas) {
  if (typeof canvas.toBlob === "function") {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("PNG 图片生成失败，请重试。"));
      }, "image/png");
    });
  }
  if (typeof canvas.toDataURL === "function" && typeof fetch === "function") {
    return fetch(canvas.toDataURL("image/png")).then((response) => response.blob());
  }
  return Promise.reject(new Error("当前浏览器不支持生成 PNG 图片。"));
}

export function drawShareFooter(context, logo, { top, width = TABLE_WIDTH } = {}) {
  const footerHeight = 82;
  context.fillStyle = "#f8fafc";
  context.fillRect(0, top, width, footerHeight);
  context.strokeStyle = "#dce6f2";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(SHARE_MARGIN, top);
  context.lineTo(width - SHARE_MARGIN, top);
  context.stroke();
  const logoSize = 48;
  const brandText = "小猫小狐工具箱";
  const siteText = SITE_ADDRESS;
  setFont(context, '600 17px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif');
  const brandWidth = context.measureText(brandText).width;
  setFont(context, '400 14px "Geist", sans-serif');
  const siteWidth = context.measureText(siteText).width;
  const brandBlockWidth = Math.max(brandWidth, siteWidth);
  const groupWidth = logoSize + 12 + brandBlockWidth;
  const groupX = width - FOOTER_RIGHT_INSET - groupWidth;
  context.drawImage(logo, groupX, top + (footerHeight - logoSize) / 2, logoSize, logoSize);
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillStyle = "#233752";
  context.font = '600 17px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
  context.fillText(brandText, groupX + logoSize + 12, top + 30);
  context.fillStyle = "#64748b";
  context.font = '400 14px "Geist", sans-serif';
  context.fillText(siteText, groupX + logoSize + 12, top + 53);
}

export async function createOngoingSharePng({
  platform,
  metric,
  items,
  selectedCvNames = [],
  canvasFactory = () => document.createElement("canvas"),
  loadLogo = loadLocalLogo,
} = {}) {
  const table = buildOngoingShareTable({ platform, metric, items, selectedCvNames });
  if (!table.rows.length) {
    throw new Error("当前没有可分享的作品。请调整筛选后重试。");
  }
  const canvas = canvasFactory();
  const context = canvas?.getContext?.("2d");
  if (!context) {
    throw new Error("当前浏览器无法绘制 PNG 图片，请重试。");
  }

  const widths = getOngoingShareColumnWidths(context, table);
  const tableWidth = widths.reduce((sum, width) => sum + width, 0);
  const bodyFonts = getOngoingShareBodyFonts(table);
  const titleLines = wrapShareText(context, table.title, tableWidth - 48, TITLE_FONT);
  const subtitleLines = table.cvFilterText
    ? wrapShareText(context, table.cvFilterText, tableWidth - 48, SUBTITLE_FONT)
    : [];
  const titleLineHeight = 34;
  const subtitleLineHeight = 24;
  const titleBlockHeight = titleLines.length * titleLineHeight + (
    subtitleLines.length ? 8 + subtitleLines.length * subtitleLineHeight : 0
  );
  const titleHeight = Math.max(76, titleBlockHeight + 24);
  const headerLines = table.columns.map((column, index) => (
    wrapShareText(context, column.label, widths[index] - CELL_PADDING_X * 2, HEADER_FONT)
  ));
  const headerHeight = Math.max(52, Math.max(...headerLines.map((lines) => lines.length)) * 22 + 20);
  const rowLayouts = table.rows.map((row) => {
    const cells = table.columns.map((column, index) => (
      index >= 2
        ? wrapOngoingShareMetricCell(context, row[column.key], widths[index] - CELL_PADDING_X * 2, bodyFonts[index])
        : wrapShareText(context, row[column.key], widths[index] - CELL_PADDING_X * 2, bodyFonts[index])
    ));
    const lineHeights = [25, 24, ...table.columns.slice(2).map(() => 22)];
    const rowHeight = Math.max(52, Math.max(...cells.map((lines, index) => lines.length * lineHeights[index] + 20)));
    return { cells, rowHeight };
  });
  const footerHeight = 82;
  const tableHeight = titleHeight + headerHeight + rowLayouts.reduce((sum, row) => sum + row.rowHeight, 0);
  const canvasHeight = tableHeight + footerHeight;
  if (canvasHeight > MAX_SHARE_HEIGHT) {
    throw new Error("当前列表过长，无法完整生成单张 PNG。请缩小 CV 筛选范围后重试。");
  }
  canvas.width = tableWidth;
  canvas.height = canvasHeight;
  context.fillStyle = "#f8fafc";
  context.fillRect(0, 0, tableWidth, canvasHeight);

  context.fillStyle = "#1b2a45";
  context.fillRect(SHARE_MARGIN, 0, tableWidth, titleHeight);
  const titleBlockStartY = (titleHeight - titleBlockHeight) / 2;
  titleLines.forEach((line, index) => {
    context.fillStyle = "#ffffff";
    context.font = TITLE_FONT;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(line, tableWidth / 2, titleBlockStartY + titleLineHeight / 2 + index * titleLineHeight);
  });
  subtitleLines.forEach((line, index) => {
    context.fillStyle = "#cbd5e1";
    context.font = SUBTITLE_FONT;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(
      line,
      tableWidth / 2,
      titleBlockStartY + titleLines.length * titleLineHeight + 8 + subtitleLineHeight / 2 + index * subtitleLineHeight
    );
  });

  let rowY = titleHeight;
  context.fillStyle = "#2767c8";
  context.fillRect(SHARE_MARGIN, rowY, tableWidth, headerHeight);
  let columnX = SHARE_MARGIN;
  headerLines.forEach((lines, index) => {
    drawShareWrappedCell(context, lines, columnX, rowY, widths[index], headerHeight, {
      align: index < 2 ? "left" : "center",
      color: "#ffffff",
      font: HEADER_FONT,
      lineHeight: 22,
    });
    columnX += widths[index];
  });
  rowY += headerHeight;

  const bodyTop = rowY;
  rowLayouts.forEach(({ rowHeight }, rowIndex) => {
    context.fillStyle = rowIndex % 2 === 0 ? "#ffffff" : "#edf5ff";
    context.fillRect(SHARE_MARGIN, rowY, tableWidth, rowHeight);
    rowY += rowHeight;
  });
  drawShareBodyWatermark(context, bodyTop, rowY - bodyTop, tableWidth);
  rowY = bodyTop;
  rowLayouts.forEach(({ cells, rowHeight }) => {
    let x = SHARE_MARGIN;
    cells.forEach((lines, columnIndex) => {
      const drawCell = columnIndex < 2 ? drawShareWrappedCell : drawOngoingShareMetricCell;
      drawCell(context, lines, x, rowY, widths[columnIndex], rowHeight, {
        align: columnIndex < 2 ? "left" : "center",
        color: columnIndex < 2 ? "#172033" : "#183a68",
        font: bodyFonts[columnIndex],
        lineHeight: [25, 24, ...table.columns.slice(2).map(() => 22)][columnIndex],
      });
      if (columnIndex > 0) {
        context.strokeStyle = "#dce6f2";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(x, rowY);
        context.lineTo(x, rowY + rowHeight);
        context.stroke();
      }
      x += widths[columnIndex];
    });
    context.strokeStyle = "#dce6f2";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(SHARE_MARGIN, rowY + rowHeight);
    context.lineTo(SHARE_MARGIN + tableWidth, rowY + rowHeight);
    context.stroke();
    rowY += rowHeight;
  });

  const logo = await loadLogo();
  const footerY = tableHeight;
  drawShareFooter(context, logo, { top: footerY, width: tableWidth });

  return canvasToPngBlob(canvas);
}

export const ongoingShareCanvasConstants = Object.freeze({
  width: SHARE_WIDTH,
  maxHeight: MAX_SHARE_HEIGHT,
  margin: SHARE_MARGIN,
  tableWidth: TABLE_WIDTH,
  footerRightInset: FOOTER_RIGHT_INSET,
  cellPaddingX: CELL_PADDING_X,
  deltaTextColor: DELTA_TEXT_COLOR,
});
