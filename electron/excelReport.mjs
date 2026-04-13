import {
  HEADERS,
  INPUT_SHEETS,
  OUTPUT_SHEETS,
  SHEET_THEMES,
} from "../shared/excelReportMeta.js";

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeCategory(rawType) {
  const value = normalizeText(rawType);
  if (value === "会员") {
    return { category: "member", paymentMode: "member", rawType: value };
  }
  if (value === "免费") {
    return { category: "free", paymentMode: "free", rawType: value };
  }
  if (value === "单集付费") {
    return { category: "paid", paymentMode: "episode", rawType: value };
  }
  if (value === "付费") {
    return { category: "paid", paymentMode: "season", rawType: value };
  }
  return null;
}

function parseIds(rawValue) {
  return Array.from(
    new Set(
      normalizeText(rawValue)
        .split(/[\s,，]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function getColumnIndexes(headerRow) {
  const map = {};
  headerRow.forEach((cell, index) => {
    const key = normalizeText(cell);
    if (key && map[key] == null) {
      map[key] = index;
    }
  });
  return map;
}

async function getXlsx() {
  const module = await import("xlsx");
  return module.default || module;
}

async function getExcelJs() {
  const module = await import("exceljs");
  return module.default || module;
}

function parseInputSheet(XLSX, workbook, platform) {
  const sheetName = INPUT_SHEETS[platform];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`缺少工作表: ${sheetName}`);
  }

  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });
  const headerRow = Array.isArray(rows[0]) ? rows[0] : [];
  const columns = getColumnIndexes(headerRow);
  const titleIndex = columns["标题"];
  const typeIndex = columns["类型"];
  const idIndex = columns["ID"];

  if ([titleIndex, typeIndex, idIndex].some((index) => index == null)) {
    throw new Error(`${sheetName} 缺少必要列：标题 / 类型 / ID`);
  }

  const parsedRows = [];
  const errors = [];

  rows.slice(1).forEach((row, rowOffset) => {
    const rowNumber = rowOffset + 2;
    const title = normalizeText(row[titleIndex]);
    const rawType = normalizeText(row[typeIndex]);
    const ids = parseIds(row[idIndex]);

    if (!title && !rawType && ids.length === 0) {
      return;
    }

    const normalized = normalizeCategory(rawType);
    if (!normalized) {
      errors.push({
        platform,
        sheetName,
        rowNumber,
        title: title || `第 ${rowNumber} 行`,
        error: `不支持的类型: ${rawType || "空"}`,
      });
      return;
    }

    if (!title || ids.length === 0) {
      errors.push({
        platform,
        sheetName,
        rowNumber,
        title: title || `第 ${rowNumber} 行`,
        error: "标题或 ID 为空",
      });
      return;
    }

    parsedRows.push({
      platform,
      sheetName,
      rowNumber,
      title,
      rawType,
      category: normalized.category,
      paymentMode: normalized.paymentMode,
      dramaIds: ids,
    });
  });

  return { rows: parsedRows, errors };
}

export async function parseTemplateWorkbook(bytes) {
  const XLSX = await getXlsx();
  const workbook = XLSX.read(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), { type: "array" });
  const missevan = parseInputSheet(XLSX, workbook, "missevan");
  const manbo = parseInputSheet(XLSX, workbook, "manbo");
  return {
    rows: [...missevan.rows, ...manbo.rows],
    parseErrors: [...missevan.errors, ...manbo.errors],
  };
}

function getColumnWidths(headers) {
  return headers.map((header) => {
    if (header === "标题") {
      return 34;
    }
    if (header.includes("收益") || header.includes("总价")) {
      return 18;
    }
    if (header.includes("播放量")) {
      return 16;
    }
    return 14;
  });
}

export async function buildReportWorkbook(groupedRows) {
  const ExcelJS = await getExcelJs();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "M&M Toolkit";
  workbook.company = "M&M Toolkit";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  Object.entries(OUTPUT_SHEETS).forEach(([platform, categories]) => {
    Object.entries(categories).forEach(([category, sheetName]) => {
      const headers = HEADERS[platform][category];
      const rows = Array.isArray(groupedRows?.[platform]?.[category])
        ? groupedRows[platform][category]
        : [];
      if (rows.length === 0) {
        return;
      }
      const theme = SHEET_THEMES[platform][category];
      const worksheet = workbook.addWorksheet(sheetName, {
        properties: { tabColor: { argb: theme.tabColor } },
        views: [{ state: "frozen", ySplit: 1 }],
      });

      worksheet.columns = headers.map((header, index) => ({
        header,
        key: `col_${index}`,
        width: getColumnWidths(headers)[index],
      }));
      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: headers.length },
      };

      const headerRow = worksheet.getRow(1);
      headerRow.height = 24;
      headerRow.eachCell((cell) => {
        cell.font = { name: "Microsoft YaHei UI", bold: true, color: { argb: "FF23313F" } };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: theme.headerFill },
        };
        cell.border = {
          bottom: { style: "thin", color: { argb: "FFD2DCE6" } },
        };
      });

      rows.forEach((row, rowIndex) => {
        const values = headers.map((header) => row[header] ?? "");
        const excelRow = worksheet.addRow(values);
        const status = row.__status || "success";
        excelRow.height = 22;
        excelRow.eachCell((cell, colNumber) => {
          const header = headers[colNumber - 1];
          const isTitle = header === "标题";
          cell.alignment = {
            vertical: "middle",
            horizontal: isTitle ? "left" : "center",
            wrapText: true,
          };
          cell.border = {
            bottom: { style: "hair", color: { argb: "FFE2E8EF" } },
          };

          if (status === "failed") {
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFFCE9E7" },
            };
            cell.font = { name: "Microsoft YaHei UI", color: { argb: "FF9E3D32" }, bold: isTitle };
            return;
          }

          if (status === "partial") {
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFFFF4DD" },
            };
            cell.font = { name: "Microsoft YaHei UI", color: { argb: "FF7E5A12" }, bold: isTitle };
            return;
          }

          cell.font = { name: "Microsoft YaHei UI", bold: isTitle };

          if (rowIndex % 2 === 0) {
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: theme.accentFill },
            };
          }
        });
      });

      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          if (typeof cell.value === "string" && /^-?\d+(?:\.\d+)?$/.test(cell.value)) {
            if (!String(cell.address).startsWith("B")) {
              cell.numFmt = "0.00";
            }
          }
        });
      });
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
}
