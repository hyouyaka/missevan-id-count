const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("mmToolkit", {
  desktopApp: true,
});
