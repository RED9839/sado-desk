const { contextBridge, ipcRenderer } = require("electron");
const INSTANCE = (process.argv.find(a => a.startsWith("--instance=")) || "").slice("--instance=".length) || null;
contextBridge.exposeInMainWorld("hit", { ev: (e) => ipcRenderer.send("hit-ev", { ...e, instance: INSTANCE }) });
