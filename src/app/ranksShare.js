import {
  formatDeviceDateTime,
  formatPlainNumber,
  formatRankCardMetricValue,
  formatRankCompactCount,
  formatSignedRankCardMetricValue,
} from "./app-utils.js";
import {
  canvasToPngBlob,
  drawShareBodyWatermark,
  drawShareFooter,
  drawShareWrappedCell,
  getAdaptiveShareColumnWidths,
  loadLocalLogo,
  shareImageColors,
  shareImageFonts,
  wrapShareText,
} from "./ongoingShare.js";

const MAX_SHARE_WIDTH = 1280;
const MAX_SHARE_HEIGHT = 16000;
const MIN_SHARE_WIDTH = 680;
const CELL_PADDING_X = 12;
const FOOTER_HEIGHT = 82;
const TOP_RANK_LIMIT = 30;
const PEAK_RANK_LIMIT = 50;
const TITLE_METADATA_FONT = shareImageFonts.subtitle;
const STATUS_FONT = '500 12px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';

const platformNames = { missevan: "猫耳", manbo: "漫播" };

function normalizePlatform(platform) {
  return platform === "manbo" ? "manbo" : "missevan";
}

function hasFiniteMetric(value) {
  if (value == null || String(value).trim() === "") return false;
  return Number.isFinite(Number(value));
}

function formatOptionalRankMetric(value, { plain = false } = {}) {
  if (!hasFiniteMetric(value)) return "-";
  return plain ? formatPlainNumber(value) : formatRankCardMetricValue(value);
}

function formatPaidIdMetric(item) {
  const explicitLabel = String(item?.payment_label ?? "").trim();
  const payStatus = String(item?.payStatus ?? item?.paystatus ?? item?.pay_status ?? "").trim();
  const paymentLabel = ["付费", "会员", "免费"].includes(explicitLabel)
    ? explicitLabel
    : ["付费", "会员", "免费"].includes(payStatus)
      ? payStatus
      : item?.is_member
        ? "会员"
        : "";
  if (paymentLabel === "免费") return "-";
  return formatOptionalRankMetric(item?.danmaku_uid_count, { plain: true });
}

function formatRankTrendDelta(metric) {
  if (metric?.emptyPaidEpisodes) return "暂无付费集";
  const delta = metric?.available && hasFiniteMetric(metric.delta) ? Number(metric.delta) : null;
  if (delta == null) return "暂无数据";
  const prefix = delta > 0 ? "+" : delta < 0 ? "-" : "";
  return `${prefix}${formatPlainNumber(Math.abs(delta))}`;
}

function formatShareDate(value) {
  if (!value) return "未知";
  const formatted = formatDeviceDateTime(value);
  return formatted === "未知" ? "未知" : formatted.slice(0, 10);
}

function getRankLimit(categoryKey, rankKey) {
  return categoryKey === "peak" || rankKey === "peak" ? PEAK_RANK_LIMIT : TOP_RANK_LIMIT;
}

function getRankShareTitle(platform, categoryKey, rank) {
  const platformName = platformNames[platform];
  const rankKey = String(rank?.key ?? "");
  if (categoryKey === "growth") {
    return `${platformName}飙升榜（${rankKey === "growth_monthly" ? "4周" : "7日"}）`;
  }
  if (categoryKey === "cv") {
    const isPaid = rankKey === "cv-paid" || rank?.label === "付费榜";
    return `${platformName}CV${isPaid ? "付费" : "总"}榜`;
  }
  if (categoryKey === "peak") {
    return `${platformName}巅峰榜`;
  }
  if (platform === "missevan") {
    const categoryName = ({ new: "新品", popular: "人气", bestseller: "畅销" })[categoryKey];
    if (categoryName) {
      const periodName = rankKey.endsWith("_daily") ? "日" : rankKey.endsWith("_monthly") ? "月" : "周";
      return `猫耳${categoryName}${periodName}榜`;
    }
  }
  if (categoryKey === "hot") return "漫播热播榜";
  if (categoryKey === "box_office") {
    const typeName = ({
      box_office_total: "总",
      box_office_member: "会员剧",
      box_office_paid: "付费剧",
    })[rankKey] || "总";
    return `漫播票房${typeName}榜`;
  }
  if (categoryKey === "diamond") return "漫播钻石月榜";
  return `${platformName}${String(rank?.name || rank?.label || "榜单")}`;
}

function getRankShareMetadata({ categoryKey, rank, updatedAt }) {
  if (categoryKey === "growth") {
    const period = rank?.statisticsPeriod;
    const startDate = String(period?.startDate ?? "").trim();
    const endDate = String(period?.endDate ?? "").trim();
    const periodText = startDate && endDate ? `${startDate} 至 ${endDate}` : "统计区间未知";
    return { inlineText: `统计区间：${periodText}`, statusText: "*此榜单非官方" };
  }
  if (categoryKey === "cv") {
    const date = formatShareDate(rank?.fetchedAt || updatedAt);
    return { inlineText: `更新日期：${date}`, statusText: "*此榜单非官方" };
  }
  return { inlineText: `更新日期：${formatShareDate(updatedAt || rank?.fetchedAt)}`, statusText: "" };
}

function getRankShareColumns(platform, categoryKey, rankKey) {
  if (categoryKey === "cv") {
    return [
      { key: "title", label: "CV", minWidth: 160, maxWidth: 300 },
      { key: "view", label: "播放量", minWidth: 125, maxWidth: 210, align: "center" },
      { key: "workCount", label: "剧集数量", minWidth: 125, maxWidth: 180, align: "center" },
      { key: "top3", label: "TOP3", minWidth: 280, maxWidth: 560 },
    ];
  }
  if (categoryKey === "growth") {
    const growthLabel = rankKey === "growth_monthly" ? "4周增量" : "7日增量";
    return [
      { key: "title", label: "剧集标题", minWidth: 220, maxWidth: 400 },
      { key: "view", label: "播放量", minWidth: 125, maxWidth: 210, align: "center" },
      { key: "delta", label: growthLabel, minWidth: 130, maxWidth: 200, align: "center" },
      { key: "createdAt", label: "上线时间", minWidth: 150, maxWidth: 230, align: "center" },
    ];
  }
  if (platform === "missevan" && categoryKey === "peak") {
    return [
      { key: "title", label: "系列标题", minWidth: 220, maxWidth: 400 },
      { key: "view", label: "播放量", minWidth: 125, maxWidth: 210, align: "center" },
      { key: "delta", label: "日增", minWidth: 125, maxWidth: 200, align: "center" },
    ];
  }
  if (platform === "missevan") {
    return [
      { key: "title", label: "剧集标题", minWidth: 220, maxWidth: 400 },
      { key: "view", label: "播放量", minWidth: 125, maxWidth: 210, align: "center" },
      { key: "secondary", label: "追剧", minWidth: 120, maxWidth: 190, align: "center" },
      { key: "reward", label: "打赏（钻石）", minWidth: 145, maxWidth: 220, align: "center" },
      { key: "paidId", label: "付费ID", minWidth: 125, maxWidth: 190, align: "center" },
    ];
  }
  const columns = [
    { key: "title", label: "剧集标题", minWidth: 220, maxWidth: 400 },
    { key: "view", label: "播放量", minWidth: 125, maxWidth: 210, align: "center" },
    { key: "favorite", label: "收藏", minWidth: 120, maxWidth: 190, align: "center" },
    { key: "feed", label: "投喂（红豆）", minWidth: 150, maxWidth: 220, align: "center" },
    { key: "pay", label: "付费/收听", minWidth: 150, maxWidth: 220, align: "center" },
  ];
  if (rankKey !== "peak") columns.push({ key: "paidId", label: "付费ID", minWidth: 125, maxWidth: 190, align: "center" });
  return columns;
}

function getRankShareRow({ item, index, platform, categoryKey, rankKey }) {
  const row = {
    title: `${formatPlainNumber(item?.rank ?? index + 1)}. ${String(item?.name ?? item?.cvName ?? "未命名").trim() || "未命名"}`,
    view: categoryKey === "cv"
      ? formatRankCompactCount(item?.totalViewCount)
      : formatOptionalRankMetric(item?.view_count),
  };

  if (categoryKey === "cv") {
    row.workCount = formatOptionalRankMetric(item?.workCount, { plain: true });
    const topWorks = Array.isArray(item?.topWorks) ? item.topWorks : Array.isArray(item?.works) ? item.works : [];
    row.top3 = topWorks.slice(0, 3).map((work) => String(work?.title ?? "").trim()).filter(Boolean)
      .map((title) => `《${title}》`).join(" ") || "暂无";
    return row;
  }

  if (categoryKey === "growth") {
    row.delta = hasFiniteMetric(item?.view_count_increase)
      ? formatSignedRankCardMetricValue(item.view_count_increase)
      : "暂无数据";
    row.createdAt = String(item?.create_time ?? "").trim() || "-";
    return row;
  }

  if (platform === "missevan" && categoryKey === "peak") {
    row.delta = formatRankTrendDelta(item?.daily_view_delta);
    return row;
  }

  if (platform === "missevan") {
    row.secondary = formatOptionalRankMetric(item?.subscription_num);
    row.reward = formatOptionalRankMetric(item?.reward_total);
    row.paidId = formatPaidIdMetric(item);
    return row;
  }

  row.favorite = formatOptionalRankMetric(item?.subscription_num);
  row.feed = formatOptionalRankMetric(item?.diamond_value);
  row.pay = hasFiniteMetric(item?.pay_count) && Number(item.pay_count) > 0
    ? formatPlainNumber(item.pay_count)
    : "-";
  if (rankKey !== "peak") row.paidId = formatPaidIdMetric(item);
  return row;
}

export function buildRanksShareTable({ platform, categoryKey, rank, updatedAt } = {}) {
  const normalizedPlatform = normalizePlatform(platform);
  const normalizedCategory = String(categoryKey ?? "").trim();
  const normalizedRank = rank && typeof rank === "object" ? rank : {};
  const rankKey = String(normalizedRank.key ?? "").trim();
  const limit = getRankLimit(normalizedCategory, rankKey);
  const items = Array.isArray(normalizedRank.items) ? normalizedRank.items.slice(0, limit) : [];
  const columns = getRankShareColumns(normalizedPlatform, normalizedCategory, rankKey);
  const rows = items.map((item, index) => getRankShareRow({
    item,
    index,
    platform: normalizedPlatform,
    categoryKey: normalizedCategory,
    rankKey,
  }));
  return {
    platform: normalizedPlatform,
    categoryKey: normalizedCategory,
    rankKey,
    title: getRankShareTitle(normalizedPlatform, normalizedCategory, normalizedRank),
    metadata: getRankShareMetadata({ categoryKey: normalizedCategory, rank: normalizedRank, updatedAt }),
    columns,
    rows,
    limit,
  };
}

function measureTextWidth(context, text, font) {
  context.font = font;
  return context.measureText(String(text ?? " ")).width;
}

function appendTitleCharacter(context, line, character, font, color) {
  const lastSegment = line.segments.at(-1);
  context.font = font;
  if (!lastSegment || lastSegment.font !== font || lastSegment.color !== color) {
    const width = context.measureText(character).width;
    line.segments.push({ text: character, font, color, width });
    line.width += width;
    return;
  }
  const previousWidth = context.measureText(lastSegment.text).width;
  lastSegment.text += character;
  lastSegment.width = context.measureText(lastSegment.text).width;
  line.width += lastSegment.width - previousWidth;
}

function layoutRankTitle(context, { title, metadata, tableWidth }) {
  const horizontalPadding = 24;
  const availableWidth = Math.max(1, tableWidth - horizontalPadding * 2);
  const lines = [{ segments: [], width: 0, availableWidth }];
  const appendRun = (text, font, color) => {
    for (const character of Array.from(String(text ?? ""))) {
      let line = lines.at(-1);
      context.font = font;
      const characterWidth = context.measureText(character).width;
      if (line.width > 0 && line.width + characterWidth > line.availableWidth) {
        lines.push({ segments: [], width: 0, availableWidth });
        line = lines.at(-1);
        if (!character.trim()) continue;
      }
      appendTitleCharacter(context, line, character, font, color);
    }
  };
  appendRun(title, shareImageFonts.title, "#ffffff");
  appendRun(`  ${metadata.inlineText}`, TITLE_METADATA_FONT, shareImageColors.subtitle);
  return {
    lines: lines.filter((line) => line.segments.length),
    horizontalPadding,
  };
}

function getRankShareColumnWidths(context, table) {
  const bodyFonts = table.columns.map((column) => column.key === "title" || column.key === "top3"
    ? shareImageFonts.titleCell
    : shareImageFonts.body);
  const inlineHeaderWidth = measureTextWidth(context, table.title, shareImageFonts.title) +
    measureTextWidth(context, `  ${table.metadata.inlineText}`, TITLE_METADATA_FONT) +
    60;
  return getAdaptiveShareColumnWidths(context, {
    columns: table.columns,
    rows: table.rows,
    bodyFonts,
    minWidths: table.columns.map((column) => column.minWidth),
    maxWidths: table.columns.map((column) => column.maxWidth),
    minCanvasWidth: Math.min(MAX_SHARE_WIDTH, Math.max(MIN_SHARE_WIDTH, Math.ceil(inlineHeaderWidth))),
    maxCanvasWidth: MAX_SHARE_WIDTH,
  });
}

function formatCellText(value) {
  return String(value ?? "");
}

function isNumericRankDelta(value) {
  return /^[+-]?\d+(?:\.\d+)?(?:万|亿)?$/.test(String(value ?? "").trim());
}

export async function createRanksSharePng({
  platform,
  categoryKey,
  rank,
  updatedAt,
  canvasFactory = () => document.createElement("canvas"),
  loadLogo = loadLocalLogo,
} = {}) {
  const table = buildRanksShareTable({ platform, categoryKey, rank, updatedAt });
  if (!table.rows.length) throw new Error("当前榜单没有可分享的数据。");
  const canvas = canvasFactory();
  const context = canvas?.getContext?.("2d");
  if (!context) throw new Error("当前浏览器无法绘制 PNG 图片，请重试。");

  const widths = getRankShareColumnWidths(context, table);
  const tableWidth = widths.reduce((sum, width) => sum + width, 0);
  const titleLineHeight = 34;
  const titleLayout = layoutRankTitle(context, {
    title: table.title,
    metadata: table.metadata,
    tableWidth,
  });
  const titleHeight = Math.max(76, 46 + titleLayout.lines.length * titleLineHeight);
  const headerLines = table.columns.map((column, index) => (
    wrapShareText(context, column.label, widths[index] - CELL_PADDING_X * 2, shareImageFonts.header)
  ));
  const headerHeight = Math.max(52, Math.max(...headerLines.map((lines) => lines.length)) * 22 + 20);
  const rowLayouts = table.rows.map((row) => {
    const cells = table.columns.map((column, index) => wrapShareText(
      context,
      formatCellText(row[column.key]),
      widths[index] - CELL_PADDING_X * 2,
      column.key === "title" || column.key === "top3" ? shareImageFonts.titleCell : shareImageFonts.body
    ));
    const rowHeight = Math.max(52, Math.max(...cells.map((lines, index) => (
      lines.length * (table.columns[index].key === "title" || table.columns[index].key === "top3" ? 25 : 22) + 20
    ))));
    return { cells, rowHeight };
  });
  const tableHeight = titleHeight + headerHeight + rowLayouts.reduce((sum, row) => sum + row.rowHeight, 0);
  const canvasHeight = tableHeight + FOOTER_HEIGHT;
  if (canvasHeight > MAX_SHARE_HEIGHT) throw new Error("当前榜单过长，无法完整生成单张 PNG。");

  canvas.width = tableWidth;
  canvas.height = canvasHeight;
  context.fillStyle = shareImageColors.canvas;
  context.fillRect(0, 0, tableWidth, canvasHeight);
  context.fillStyle = shareImageColors.title;
  context.fillRect(0, 0, tableWidth, titleHeight);
  titleLayout.lines.forEach((line, lineIndex) => {
    const lineX = lineIndex === 0
      ? titleLayout.horizontalPadding + (line.availableWidth - line.width) / 2
      : (tableWidth - line.width) / 2;
    let segmentX = lineX;
    line.segments.forEach((segment) => {
      context.fillStyle = segment.color;
      context.font = segment.font;
      context.textAlign = "left";
      context.textBaseline = "bottom";
      context.fillText(segment.text, segmentX, 52 + titleLineHeight * lineIndex);
      segmentX += segment.width;
    });
  });
  if (table.metadata.statusText) {
    context.fillStyle = shareImageColors.subtitle;
    context.font = STATUS_FONT;
    context.textAlign = "right";
    context.textBaseline = "bottom";
    context.fillText(table.metadata.statusText, tableWidth - 24, 18);
  }

  let rowY = titleHeight;
  context.fillStyle = shareImageColors.header;
  context.fillRect(0, rowY, tableWidth, headerHeight);
  let columnX = 0;
  headerLines.forEach((lines, index) => {
    drawShareWrappedCell(context, lines, columnX, rowY, widths[index], headerHeight, {
      align: table.columns[index].align || "left",
      color: "#ffffff",
      font: shareImageFonts.header,
      lineHeight: 22,
    });
    columnX += widths[index];
  });
  rowY += headerHeight;

  const bodyTop = rowY;
  rowLayouts.forEach(({ rowHeight }, rowIndex) => {
    context.fillStyle = rowIndex % 2 === 0 ? shareImageColors.row : shareImageColors.alternateRow;
    context.fillRect(0, rowY, tableWidth, rowHeight);
    rowY += rowHeight;
  });
  drawShareBodyWatermark(context, bodyTop, rowY - bodyTop, tableWidth);
  rowY = bodyTop;
  rowLayouts.forEach(({ cells, rowHeight }, rowIndex) => {
    let x = 0;
    cells.forEach((lines, index) => {
      const column = table.columns[index];
      const isGreenDelta = column.key === "delta" && isNumericRankDelta(table.rows[rowIndex]?.[column.key]);
      drawShareWrappedCell(context, lines, x, rowY, widths[index], rowHeight, {
        align: column.align || "left",
        color: isGreenDelta
          ? shareImageColors.delta
          : ["view", "secondary", "reward", "paidId", "favorite", "feed", "pay", "delta", "workCount"].includes(column.key)
            ? shareImageColors.metric
            : shareImageColors.body,
        font: column.key === "title" || column.key === "top3" ? shareImageFonts.titleCell : shareImageFonts.body,
        lineHeight: column.key === "title" || column.key === "top3" ? 25 : 22,
      });
      if (index > 0) {
        context.strokeStyle = shareImageColors.grid;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(x, rowY);
        context.lineTo(x, rowY + rowHeight);
        context.stroke();
      }
      x += widths[index];
    });
    context.strokeStyle = shareImageColors.grid;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, rowY + rowHeight);
    context.lineTo(tableWidth, rowY + rowHeight);
    context.stroke();
    rowY += rowHeight;
  });

  const logo = await loadLogo();
  drawShareFooter(context, logo, { top: tableHeight, width: tableWidth });
  return canvasToPngBlob(canvas);
}

export const ranksShareConstants = Object.freeze({
  maxWidth: MAX_SHARE_WIDTH,
  maxHeight: MAX_SHARE_HEIGHT,
  topRankLimit: TOP_RANK_LIMIT,
  peakRankLimit: PEAK_RANK_LIMIT,
});
