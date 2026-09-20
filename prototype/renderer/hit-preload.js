// 히트 창은 사도 하나에 묶이지 않는다 — 어느 사도에게 갈지는 메인이 hitFor 로 고른다(그래서 instance 를 붙이지 않는다)
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("hit", { ev: (e) => ipcRenderer.send("hit-ev", e) });
