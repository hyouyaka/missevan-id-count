const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("desktopFavorites", {
  enabled: true,
});
