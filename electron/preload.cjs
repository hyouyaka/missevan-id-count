const { contextBridge, ipcRenderer } = require("electron");

function toUint8Array(value) {
  if (!value) {
    return new Uint8Array();
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  return new Uint8Array(value);
}

contextBridge.exposeInMainWorld("desktopExcel", {
  async pickInputWorkbook() {
    return ipcRenderer.invoke("desktop-excel:pick-input-workbook");
  },
  async pickSaveWorkbook(defaultName) {
    return ipcRenderer.invoke("desktop-excel:pick-save-workbook", {
      defaultName,
    });
  },
  async readFile(filePath) {
    const result = await ipcRenderer.invoke("desktop-excel:read-file", {
      filePath,
    });
    return {
      ...result,
      bytes: result?.bytes ? toUint8Array(result.bytes) : null,
    };
  },
  async parseTemplateWorkbook(filePath) {
    return ipcRenderer.invoke("desktop-excel:parse-template-workbook", {
      filePath,
    });
  },
  async writeFile(filePath, bytes) {
    return ipcRenderer.invoke("desktop-excel:write-file", {
      filePath,
      bytes: Array.from(toUint8Array(bytes)),
    });
  },
  async writeReportWorkbook(filePath, groupedRows) {
    return ipcRenderer.invoke("desktop-excel:write-report-workbook", {
      filePath,
      groupedRows,
    });
  },
  async openFile(filePath) {
    return ipcRenderer.invoke("desktop-excel:open-file", {
      filePath,
    });
  },
});
