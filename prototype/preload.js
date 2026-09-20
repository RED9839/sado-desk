const { contextBridge, ipcRenderer } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
// 렌더러가 읽을 수 있는 곳: 앱 폴더(스파인 런타임·data/)와 에셋 폴더(사용자가 추출한 스켈레톤·보이스)뿐.
// 창 하나라도 주입을 당하면 임의 파일 읽기로 이어지므로 preload 단계에서 막는다.
const ROOTS = (() => {
  try { return (ipcRenderer.sendSync("roots:get") || []).map(r => path.resolve(r)); } catch { return []; }
})();
const allowed = (p) => {
  const r = path.resolve(String(p));
  return ROOTS.some(root => r === root || r.startsWith(root + path.sep));
};
const guard = (p) => { if (!allowed(p)) throw new Error("허용되지 않은 경로: " + p); return String(p); };
// 이 창이 담당하는 캐릭터 id (메뉴 창). 마스코트 창(캐릭터 전부)·설정 창은 없음 → id를 명시해서 호출
const INSTANCE = (process.argv.find(a => a.startsWith("--instance=")) || "").slice("--instance=".length) || null;
contextBridge.exposeInMainWorld("host", {
  instance: INSTANCE,
  // 파일
  readBytes: (p) => new Uint8Array(fs.readFileSync(guard(p))),
  readText: (p) => fs.readFileSync(guard(p), "utf8"),
  // 마스코트 창
  event: (kind, id) => ipcRenderer.send("mascot:event", id === undefined ? INSTANCE : id, kind), // 던져져 착지·쓰다듬음·꿀밤 — 혼잣말이 상황을 안다
  hitRect: (r, id) => ipcRenderer.send("hit-rect", r, id === undefined ? INSTANCE : id),
  openMenu: (x, y, id) => ipcRenderer.send("menu:open", { x, y }, id === undefined ? INSTANCE : id),
  sdAnims: (id, list) => ipcRenderer.send("sd-anims", id, list),
  menuClose: () => ipcRenderer.send("menu:close"),
  menuResize: (h) => ipcRenderer.send("menu:resize", h),
  loaded: (info) => ipcRenderer.send("loaded", info),
  quit: () => ipcRenderer.send("quit"),
  // 설정 (공유). id 생략 시 자기 인스턴스(마스코트/메뉴 창) 또는 전체(설정 창)
  getSettings: (id) => ipcRenderer.invoke("settings:get", id === undefined ? INSTANCE : id),
  setSettings: (patch, id) => ipcRenderer.send("settings:set", patch, id === undefined ? INSTANCE : id),
  resetSettings: () => ipcRenderer.send("settings:reset"),
  openSettings: (tab, id) => ipcRenderer.send("settings:open", tab, id === undefined ? INSTANCE : id),
  addCharacter: (from) => ipcRenderer.send("char:add", from === undefined ? INSTANCE : from),
  removeCharacter: (id) => ipcRenderer.send("char:remove", id === undefined ? INSTANCE : id),
  // 설정 창 / 메뉴
  getCatalog: () => ipcRenderer.invoke("catalog:get"),
  mascot: (cmd, arg, id) => ipcRenderer.send("mascot", cmd, arg, id === undefined ? INSTANCE : id),
  openPath: (which) => ipcRenderer.send("open-path", which),
  diagGet: () => ipcRenderer.invoke("diag:get"),
  updateState: () => ipcRenderer.invoke("update:state"),
  updateCheck: () => ipcRenderer.invoke("update:check"),
  updateStart: () => ipcRenderer.send("update:start"),
  copyText: (t) => ipcRenderer.send("copy-text", String(t || "")),
  // 에셋 가져오기(추출)
  assetsStatus: () => ipcRenderer.invoke("assets:status"),
  assetsPickFolder: () => ipcRenderer.invoke("assets:pick-folder"),
  assetsPickMumu: () => ipcRenderer.invoke("assets:pick-mumu"),
  assetsUseFolder: (folder) => ipcRenderer.invoke("assets:use-folder", folder),
  assetsExtract: (opt) => ipcRenderer.invoke("assets:extract", opt),
  assetsScan: () => ipcRenderer.invoke("assets:scan"),
  assetsEnableLdAdb: (idx) => ipcRenderer.invoke("assets:enable-ld-adb", idx),
  assetsCancel: () => ipcRenderer.send("assets:cancel"),
  assetsOpenSetup: () => ipcRenderer.send("assets:open-setup"),
  assetsOpenRoot: () => ipcRenderer.send("assets:open-root"),
  assetsOpenLog: () => ipcRenderer.send("assets:open-log"),
  // 새 소식 / 말풍선
  newsList: () => ipcRenderer.invoke("news:list"),
  newsCheck: () => ipcRenderer.invoke("news:check"),
  newsShow: () => ipcRenderer.send("news:show"),
  newsTest: () => ipcRenderer.send("news:test"),
  newsReadAll: () => ipcRenderer.send("news:read-all"),
  openUrl: (url, id) => ipcRenderer.send("news:open", url, id),
  bubbleResize: (h) => ipcRenderer.send("bubble:resize", h),
  // AI 대화
  chatOpen: (id) => ipcRenderer.send("chat:open", id === undefined ? INSTANCE : id),
  selfTalk: (id) => ipcRenderer.send("selftalk:say", id === undefined ? INSTANCE : id),
  chatSend: (text, withScreen) => ipcRenderer.send("chat:send", text, !!withScreen),
  chatScreen: (id) => ipcRenderer.send("chat:screen", id === undefined ? INSTANCE : id),
  chatClose: () => ipcRenderer.send("chat:close"),
  chatClear: () => ipcRenderer.send("chat:clear"),
  chatResize: (h) => ipcRenderer.send("chat:resize", h),
  aiStatus: () => ipcRenderer.invoke("ai:status"),
  aiSetKey: (provider, key) => ipcRenderer.invoke("ai:set-key", provider, key),
  aiTest: (provider) => ipcRenderer.invoke("ai:test", provider),
  aiPull: (model) => ipcRenderer.invoke("ai:pull", model),
  aiWindows: () => ipcRenderer.invoke("ai:windows"),   // 화면 보기에서 고를 수 있는 창 목록
  aiOpenUrl: (which) => ipcRenderer.send("ai:open-url", which),
  bubbleClose: () => ipcRenderer.send("bubble:close"),
  on: (ch, fn) => ipcRenderer.on(ch, (_e, ...args) => fn(...args)),
});
