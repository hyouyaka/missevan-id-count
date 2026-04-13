import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { promises as fs } from "fs";
import { loadLocalEnv } from "../envConfig.js";
import { buildReportWorkbook, parseTemplateWorkbook } from "./excelReport.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const appIconPath = path.join(projectRoot, "windowsapp.ico");
const preloadPath = path.join(__dirname, "preload.cjs");
let mainWindow = null;
let desktopUrl = "";

function registerDesktopExcelHandlers() {
  ipcMain.handle("desktop-excel:pick-input-workbook", async () => {
    if (!mainWindow) {
      return { canceled: true, filePath: "" };
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择 Excel 模板",
      properties: ["openFile"],
      filters: [
        { name: "Excel Workbook", extensions: ["xlsx"] },
      ],
    });

    return {
      canceled: result.canceled,
      filePath: result.canceled ? "" : (result.filePaths[0] || ""),
    };
  });

  ipcMain.handle("desktop-excel:pick-save-workbook", async (_, payload = {}) => {
    if (!mainWindow) {
      return { canceled: true, filePath: "" };
    }

    const defaultName = String(payload?.defaultName || "猫耳漫播统计报告.xlsx").trim()
      || "猫耳漫播统计报告.xlsx";
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "保存 Excel 报告",
      defaultPath: defaultName.endsWith(".xlsx") ? defaultName : `${defaultName}.xlsx`,
      filters: [
        { name: "Excel Workbook", extensions: ["xlsx"] },
      ],
    });

    return {
      canceled: result.canceled,
      filePath: result.canceled ? "" : (result.filePath || ""),
    };
  });

  ipcMain.handle("desktop-excel:read-file", async (_, payload = {}) => {
    const filePath = String(payload?.filePath || "").trim();
    if (!filePath) {
      return { success: false, error: "Missing file path", bytes: null };
    }

    try {
      const bytes = await fs.readFile(filePath);
      return {
        success: true,
        bytes: Array.from(bytes),
        error: "",
      };
    } catch (error) {
      return {
        success: false,
        bytes: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle("desktop-excel:parse-template-workbook", async (_, payload = {}) => {
    const filePath = String(payload?.filePath || "").trim();
    if (!filePath) {
      return { success: false, rows: [], parseErrors: [], error: "Missing file path" };
    }

    try {
      const bytes = await fs.readFile(filePath);
      const parsed = await parseTemplateWorkbook(bytes);
      return {
        success: true,
        rows: parsed.rows,
        parseErrors: parsed.parseErrors,
        error: "",
      };
    } catch (error) {
      return {
        success: false,
        rows: [],
        parseErrors: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle("desktop-excel:write-file", async (_, payload = {}) => {
    const filePath = String(payload?.filePath || "").trim();
    const bytes = Array.isArray(payload?.bytes) ? payload.bytes : [];
    if (!filePath) {
      return { success: false, error: "Missing file path" };
    }

    try {
      await fs.writeFile(filePath, Buffer.from(bytes));
      return { success: true, error: "" };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle("desktop-excel:write-report-workbook", async (_, payload = {}) => {
    const filePath = String(payload?.filePath || "").trim();
    if (!filePath) {
      return { success: false, error: "Missing file path" };
    }

    try {
      const bytes = await buildReportWorkbook(payload?.groupedRows || {});
      await fs.writeFile(filePath, Buffer.from(bytes));
      return { success: true, error: "" };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle("desktop-excel:open-file", async (_, payload = {}) => {
    const filePath = String(payload?.filePath || "").trim();
    if (!filePath) {
      return { success: false, error: "Missing file path" };
    }

    try {
      const result = await shell.openPath(filePath);
      return {
        success: result === "",
        error: result || "",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

async function waitForServer(url, retries = 60, delayMs = 500) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return true;
      }
    } catch (_) {
      // Ignore and retry.
    }

    await new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  throw new Error("Local desktop server did not start in time.");
}

async function startEmbeddedServer() {
  process.env.START_SERVER_ON_IMPORT = "false";
  process.env.APP_DATA_DIR = app.getPath("userData");
  process.env.DESKTOP_APP = "true";
  await loadLocalEnv({
    desktopApp: true,
    projectRoot,
    appDataDir: process.env.APP_DATA_DIR,
    exeDir: path.dirname(app.getPath("exe")),
  });

  const serverModule = await import(pathToFileURL(path.join(projectRoot, "server.js")).href);
  const listener = await serverModule.startServer(0);
  const port = listener.address()?.port;
  desktopUrl = `http://127.0.0.1:${port}`;
  await waitForServer(`${desktopUrl}/health`);
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 920,
    minWidth: 1080,
    minHeight: 760,
    autoHideMenuBar: true,
    backgroundColor: "#f6f1e8",
    title: "M&M Toolkit",
    icon: appIconPath,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  });

  try {
    await startEmbeddedServer();
    await mainWindow.loadURL(desktopUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await mainWindow.loadURL(
      `data:text/html,${encodeURIComponent(`
        <html>
          <body style="font-family: Segoe UI, sans-serif; background:#f6f1e8; color:#1f2a37; padding:32px;">
            <h2>Desktop app failed to start</h2>
            <p>${message}</p>
            <p>Please close the app and try again.</p>
          </body>
        </html>
      `)}`
    );
  }
}

app.whenReady().then(() => {
  registerDesktopExcelHandlers();
  return createMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createMainWindow();
  }
});
