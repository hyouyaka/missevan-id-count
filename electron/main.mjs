import { app, BrowserWindow, shell } from "electron";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { loadLocalEnv } from "../envConfig.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const appIconPath = path.join(projectRoot, "windowsapp.ico");
const preloadPath = path.join(__dirname, "preload.cjs");
let mainWindow = null;
let desktopUrl = "";

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
  process.env.DESKTOP_PACKAGED_APP = app.isPackaged ? "true" : "false";
  process.env.DESKTOP_EXE_DIR = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath("exe"));
  await loadLocalEnv({
    desktopApp: true,
    projectRoot: app.isPackaged ? "" : projectRoot,
    appDataDir: process.env.APP_DATA_DIR,
    exeDir: process.env.DESKTOP_EXE_DIR,
  });

  const serverModule = await import(pathToFileURL(path.join(projectRoot, "server.js")).href);
  const listener = await serverModule.startServer(0, { host: "127.0.0.1" });
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
    title: "MMTOOLKIT.APP",
    icon: appIconPath,
    webPreferences: {
      sandbox: true,
      webSecurity: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  });

  const embeddedOrigin = () => {
    try {
      return new URL(desktopUrl).origin;
    } catch (_) {
      return "";
    }
  };

  mainWindow.webContents.on("will-navigate", (event, url) => {
    try {
      if (url === pathToFileURL(path.join(__dirname, "error.html")).href) {
        return;
      }
      if (new URL(url).origin !== embeddedOrigin()) {
        event.preventDefault();
      }
    } catch (_) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol === "https:" && parsedUrl.origin !== embeddedOrigin()) {
        void shell.openExternal(url);
      }
    } catch (_) {
      // Invalid and unsupported protocols are rejected without opening a window.
    }
    return { action: "deny" };
  });

  const rejectPermission = (_webContents, _permission, callback) => callback(false);
  mainWindow.webContents.session.setPermissionRequestHandler(rejectPermission);
  mainWindow.webContents.session.setPermissionCheckHandler(() => false);

  try {
    await startEmbeddedServer();
    await mainWindow.loadURL(`${desktopUrl}/tool`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await mainWindow.loadFile(path.join(__dirname, "error.html"), {
      query: { message },
    });
  }
}

app.whenReady().then(() => {
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
