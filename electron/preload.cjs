const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("window777", Object.freeze({
  minimize: () => ipcRenderer.invoke("777:window:minimize"),
  toggleSize: () => ipcRenderer.invoke("777:window:toggle-size"),
  close: () => ipcRenderer.invoke("777:window:close"),
}));
