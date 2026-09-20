// 사도 데스크 — Electron 메인 프로세스
// 캐릭터(인스턴스)마다 [마스코트 창(모니터 합집합, 항상 클릭 통과) + 히트 창(캐릭터 크기, 실제 입력 수신)] 한 쌍.
// 설정: settings.json 하나. global(사운드·화면) + characters[](스킨·형태·크기·불투명도·행동). 렌더러엔 자기 캐릭터와 global을 합친 "뷰"를 준다.
const { app, BrowserWindow, screen, ipcMain, Menu, Tray, nativeImage, shell, globalShortcut, desktopCapturer } = require("electron");
const Ai = require("./ai.js");
const { createFullscreenWatcher } = require("./fullscreen-watch.js");
const path = require("node:path");
const fs = require("node:fs");

// 터미널에서 띄운 뒤 그 터미널이 닫히면 stdout 이 끊긴다. 그때 console.log 하나가
// 잡히지 않은 예외가 되어 본체를 통째로 죽였다 (EPIPE). 로그는 죽을 이유가 못 된다.
for (const s of [process.stdout, process.stderr]) {
  try { s.on("error", (e) => { if (!e || e.code !== "EPIPE") throw e; }); } catch {}
}
// 메인에서 잡히지 않은 예외는 Electron 이 영어 오류 모달을 띄운다. 상주 앱은 로그만 남기고 계속 산다
process.on("uncaughtException", (e) => console.error("uncaught:", e && e.stack || e));
process.on("unhandledRejection", (e) => console.error("unhandled:", e && e.stack || e));

// 앱이 배포하는 데이터(한글 이름표·말투 프로필) = data/ (asar 안). 게임 에셋(스켈레톤·텍스처·보이스)은 배포하지 않고
// 사용자가 자기 PC의 뮤뮤(트릭컬)에서 추출해 userData/assets 에 둔다 (tools/extract-all.py, 설정 창의 '에셋 가져오기').
const DATA_ROOT = path.join(__dirname, "data").split(path.sep).join("/");
const toSlash = (p) => p.split(path.sep).join("/");
const hasAssets = (root) => !!root && fs.existsSync(path.join(root, "minimi", "minimi.skel")) && fs.existsSync(path.join(root, "minimi", "minimi.atlas"));
let ASSET_ROOT = null; // resolveAssetRoot()에서 결정 (설정 로드 뒤)
function resolveAssetRoot() {
  const custom = settings && settings.global && settings.global.assets && settings.global.assets.root;
  const cands = [custom, app.isPackaged ? null : path.join(__dirname, "assets"), path.join(app.getPath("userData"), "assets")].filter(Boolean); // 개발 중엔 prototype/assets 우선
  const found = cands.find(hasAssets);
  return toSlash(found || custom || path.join(app.getPath("userData"), "assets"));
}
// 테스트용: 별도 userData (설치판과 락·설정을 공유하지 않게) — 사도 데스크.exe --userdata C:\sadodesk-test
{ const i = process.argv.indexOf("--userdata"); if (i >= 0 && process.argv[i + 1]) app.setPath("userData", process.argv[i + 1]); }
// 앱 이름 변경(trickcal-crepe-mascot-proto → sado-desk): 예전 userData의 설정·소식 상태를 새 폴더로 한 번 옮긴다
(() => { try {
  if (process.argv.includes("--userdata")) return; // 시험용 폴더에 옛 설정을 끌어오면 첫 실행을 시험할 수 없다
  const oldDir = path.join(app.getPath("appData"), "trickcal-crepe-mascot-proto"), newDir = app.getPath("userData");
  if (fs.existsSync(oldDir)) { fs.mkdirSync(newDir, { recursive: true }); for (const f of ["settings.json", "news-state.json"]) { const src = path.join(oldDir, f), dst = path.join(newDir, f); if (fs.existsSync(src) && !fs.existsSync(dst)) { fs.copyFileSync(src, dst); console.log(`migrated ${f} ← ${oldDir}`); } } }
} catch (e) { console.warn("userData migrate", e.message); } })();
const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");
const { argHas, argVal } = require("./args.js");
let NAMES = { heroes: {}, skins: {} };
try { NAMES = JSON.parse(fs.readFileSync(path.join(DATA_ROOT, "names-ko.json"), "utf8")); } catch (e) { console.warn("data/names-ko.json 을 읽지 못했습니다 — 사도 이름이 영문으로 보입니다:", e.message); }
function koSkin(skin) { const m = skin.replace(/^Mini_/, "").match(/^(.*?)(?:Skin(\d+))?$/); const base = NAMES.heroes[m[1]] || m[1]; return m[2] ? `${base} · ${NAMES.skins[m[1]]?.[m[2]] || "스킨 " + m[2]}` : base; }

// ---- 설정 ----
// 기본값·병합·범위 검사는 settings-schema.js — Electron 없이 테스트할 수 있게 떼어 냈다
const { CHAR_DEFAULTS, GLOBAL_DEFAULTS, GLOBAL_KEYS, CHAR_KEYS, isObj, deepMerge, sanitizePatch, clampSettings: clampPure } = require("./settings-schema.js");
// 파일에서 읽은 설정 전체를 검사하고, 고친 게 있으면 파일에도 남긴다
function clampSettings(s) {
  const fixed = clampPure(s);
  if (fixed.length) { console.log(`settings: 읽으면서 고침 — ${fixed.join(", ")}`); process.nextTick(saveSettings); } // nextTick — 지금은 settings 변수에 대입되기 전이다
  return s;
}
let firstRun = false; // 설정 파일이 아예 없을 때만 참. 깨진 파일도 "없음"으로 치면 사도가 둘로 늘어 첫 실행처럼 보인다
function loadSettings() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")); }
  catch (e) {
    if (e && e.code === "ENOENT") firstRun = true;
    // 깨진 파일은 옆에 남겨 둔다 — 기본값으로 덮어쓰면 사용자가 손수 넣은 키·설정을 되살릴 길이 없다
    else { console.error("settings load", e && e.message); try { fs.copyFileSync(SETTINGS_FILE, SETTINGS_FILE + ".bad"); } catch {} }
  }
  if (!isObj(raw)) raw = {};
  let s;
  if (raw.version === 2 && Array.isArray(raw.characters)) s = raw;
  else { // v1(단일 캐릭터) → v2 이관
    const c = { id: "c1", skin: raw.skin, mode: raw.mode, scale: raw.scale, opacity: raw.opacity, behavior: raw.behavior };
    for (const k of Object.keys(c)) if (c[k] === undefined) delete c[k];
    const g = { sound: raw.sound, display: raw.display };
    for (const k of Object.keys(g)) if (g[k] === undefined) delete g[k];
    s = { version: 2, global: g, characters: [c] };
    // 설정 파일이 아예 없는 첫 실행이면 둘을 세운다. 기본이 하나면 여럿 부를 수 있다는 것을
    // "하나 더 부르기"를 우연히 찾은 사람만 알았다. 둘째는 네르 — 잡담은 뺐지만 둘째는 그대로 둔다)
    if (firstRun) s.characters.push({ id: "c2", skin: "Mini_Ner" });
  }
  s.global = deepMerge(GLOBAL_DEFAULTS, s.global || {});
  s.characters = (s.characters.length ? s.characters : [{ id: "c1" }]).map((c, i) => deepMerge({ ...CHAR_DEFAULTS, id: c.id || `c${i + 1}` }, c));
  // talk 이 GLOBAL_KEYS 에 없던 판(v0.12.8~v0.13.2)에서는 말하기 설정이 캐릭터 밑으로 저장되고 아무도 읽지 않았다. 끌어올린다
  for (const c of s.characters) { if (c.talk && typeof c.talk === "object") s.global.talk = deepMerge(s.global.talk, c.talk); delete c.talk; }
  for (const c of s.characters) if (["standing", "hybrid"].includes(c.mode)) c.mode = "sd"; // 옛 모드 이름 → sd ("ingame"은 v0.9.12부터 정식 형태라 그대로)
  return clampSettings(s);
}
let settings = loadSettings();
let saveTimer = null;

function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSettings, 150);
}
// 임시 파일에 다 쓴 뒤 이름을 바꾼다 — 쓰는 도중 전원이 나가면 settings.json 이 반쪽만 남아 다음 시작이 기본값으로 돌아갔다.
// rename 이 막히면(백신이 새 파일을 붙잡는 동안) 예전처럼 바로 쓴다
function flushSettings() {
  clearTimeout(saveTimer); saveTimer = null;
  const json = JSON.stringify(settings, null, 2), tmp = SETTINGS_FILE + ".tmp";
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    try { fs.writeFileSync(tmp, json); fs.renameSync(tmp, SETTINGS_FILE); }
    catch (e) { console.warn("settings rename", e.message); fs.writeFileSync(SETTINGS_FILE, json); try { fs.unlinkSync(tmp); } catch {} }
  } catch (e) { console.error("settings save", e); }
}
const charOf = (id) => settings.characters.find(c => c.id === id);
// 렌더러용 뷰: 캐릭터 설정 + global(sound, display)
const viewsAll = () => settings.characters.map(c => viewFor(c.id));
const viewFor = (id) => { const c = charOf(id) || settings.characters[0]; return { ...c, sound: settings.global.sound, display: settings.global.display, news: settings.global.news, ai: { screen: !!(settings.global.ai && settings.global.ai.screen) }, count: settings.characters.length, unread: news ? news.unread : 0 }; };
// patch: {skin, mode, scale, opacity, behavior} → 캐릭터 id / {sound, display} → global. 양쪽이 섞여 있으면 각각 (GLOBAL_KEYS 는 설정 검사 쪽에)
function updateSettings(patch, id, sourceId) {
  // 창 기하·자동시작·전체화면 숨김을 다시 걸지 말지 볼 때, 화면과 무관한 표시용 값은 빼고 본다.
  // 안 빼면 '모든 사도에 함께' 를 누를 때마다 setLoginItemSettings 가 레지스트리를 건드린다
  const dispSig = () => { const { bulkEdit, guideShown, keepOnTop, confineMonitor, ...d } = settings.global.display || {}; return JSON.stringify(d); };
  const prevDisp = dispSig();
  const g = {}, c = {};
  for (const [k, v] of Object.entries(patch || {})) (GLOBAL_KEYS.has(k) ? g : c)[k] = v;
  if (Object.keys(g).length) settings.global = deepMerge(settings.global, g);
  if (Object.keys(c).length && id === "*") {
    // 통합 편집 — 스킨은 사도의 정체라 함께 바꾸지 않는다(모두 같은 모습이 되어 버린다)
    const { skin, ...rest } = c;
    if (Object.keys(rest).length) for (const ch of settings.characters) Object.assign(ch, deepMerge(ch, rest));
  } else if (Object.keys(c).length && id) { const ch = charOf(id); if (ch) Object.assign(ch, deepMerge(ch, c)); }
  saveSettings();
  if (dispSig() !== prevDisp) { applyGeometry(); applyAutoStart(); applyFullscreenHide(); }
  if (g.news && news) news.start(); // 주기·게시판 변경 → 감시 재시작
  broadcast(sourceId);
}
// 설정 창에 주는 원본 — API 키 암호문은 뺀다. 설정 창은 키를 읽지 않고(저장됨/없음은 ai:status 로 보고) 키는 ai:set-key 로만 들어온다
const settingsPublic = () => ({ ...settings, global: { ...settings.global, ai: { ...(settings.global.ai || {}), keys: undefined } } });
function broadcast(sourceId) {
  if (mascotWin && !mascotWin.isDestroyed() && mascotLoaded && mascotWin.webContents.id !== sourceId) mascotWin.webContents.send("settings", viewsAll()); // 자기 패치의 에코는 안 보냄(연속 패치 때 옛 값으로 되돌아가는 문제)
  for (const w of [settingsWin, menuWin]) if (w && !w.isDestroyed() && w.webContents.id !== sourceId) w.webContents.send("settings", w === settingsWin ? settingsPublic() : viewFor(menuFor));
  if (tray) buildTray();
}

// ---- 스탠딩/인게임 에셋 인덱스 ----
function scanStanding(root) {
  const hd = {}, game = {}, ingame = {};
  if (!root) return { hd, game, ingame };
  try { for (const hero of fs.readdirSync(path.join(root, "standing-hd"), { withFileTypes: true })) {
    if (!hero.isDirectory()) continue;
    const ids = fs.readdirSync(path.join(root, "standing-hd", hero.name)).filter(f => f.endsWith(".skel")).map(f => f.slice(0, -5));
    if (ids.length) hd[hero.name.toLowerCase()] = { dir: hero.name, ids };
  } } catch {}
  try { for (const d of fs.readdirSync(path.join(root, "standing"), { withFileTypes: true })) {
    if (d.isDirectory() && fs.existsSync(path.join(root, "standing", d.name, d.name + ".skel"))) game[d.name.toLowerCase()] = d.name;
  } } catch {}
  try { for (const d of fs.readdirSync(path.join(root, "ingame"), { withFileTypes: true })) {
    const dir = path.join(root, "ingame", d.name);
    if (d.isDirectory() && fs.existsSync(path.join(dir, d.name + ".skel")) && fs.existsSync(path.join(dir, d.name + ".atlas"))) ingame[d.name.toLowerCase()] = d.name;
  } } catch {}
  return { hd, game, ingame };
}
let STANDING = { hd: {}, game: {}, ingame: {} };
function rescanAssets() {
  ASSET_ROOT = resolveAssetRoot(); STANDING = scanStanding(ASSET_ROOT);
  console.log(`assets: ${ASSET_ROOT} (${hasAssets(ASSET_ROOT) ? "ok" : "없음"}) — standing hd ${Object.keys(STANDING.hd).length}, game ${Object.keys(STANDING.game).length}, ingame ${Object.keys(STANDING.ingame).length}`);
}
rescanAssets();

// ---- 윈도우 시작 시 자동 실행 (설치판에서만 의미 있음) ----
function applyAutoStart() {
  try { if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!settings.global.display.autoStart, path: process.execPath, args: [] }); } catch (e) { console.warn("autoStart", e.message); }
}

// ---- 창 기하 ----
function geometry() {
  const all = screen.getAllDisplays(), prim = screen.getPrimaryDisplay();
  const disp = (settings.global && settings.global.display) || GLOBAL_DEFAULTS.display;   // 설정이 깨져 있어도 창은 떠야 한다
  const use = all;   // 창은 모니터 전부를 덮는다 — 사도마다 놓아둔 모니터에 머물고, 끌어서 옮긴다 ('모든 모니터로 이동' 토글은 v0.24.2 에서 뺐다)
  const rect = (d) => disp.overTaskbar ? d.bounds : d.workArea;
  const x0 = Math.min(...use.map(d => rect(d).x)), y0 = Math.min(...use.map(d => rect(d).y));
  const x1 = Math.max(...use.map(d => rect(d).x + rect(d).width)), y1 = Math.max(...use.map(d => rect(d).y + rect(d).height));
  const displays = use.map(d => ({ id: d.id, primary: d.id === prim.id, x: rect(d).x - x0, w: rect(d).width, top: rect(d).y - y0, floor: d.workArea.y + d.workArea.height - y0, bottom: rect(d).y + rect(d).height - y0, scale: d.scaleFactor }));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, displays };
}
let geo = null;
function applyGeometry() {
  geo = geometry();
  if (mascotWin && !mascotWin.isDestroyed()) { mascotWin.setBounds({ x: geo.x, y: geo.y, width: geo.w, height: geo.h }); mascotWin.webContents.send("geo", geo); }
  lastCursor = null;
}

let settingsWin = null, menuWin = null, menuFor = null, tray = null;
let catalog = { animations: [], skins: [] };
const sdAnimsOf = new Map(); // 캐릭터별 SD 애니 목록 (스킨마다 다름)

// ---- 마스코트 창(하나) + 캐릭터별 히트 창 ----
// 마스코트 창은 모니터 합집합 크기의 투명 창 하나에 캐릭터 전부를 그린다. 캐릭터마다 창을 띄우면 투명 창 합성 비용이 창 수에 비례해 두 명부터 렉 → 창 하나로.
// 히트 창(캐릭터 크기, 실제 입력 수신)은 캐릭터마다 하나씩.
let mascotWin = null, mascotLoaded = false;
const instances = new Map(); // id → { rect } (렌더러가 30Hz로 보내는 캐릭터 바운딩, 창 기준 px)
// 히트 창은 전체에 하나. 커서가 어느 캐릭터 위(근처)에 있을 때만 그 캐릭터 크기로 옮겨 보이고, 아니면 숨김.
// (v0.6.1: 캐릭터마다 히트 창 = 렌더러 프로세스 하나씩 + 30Hz setBounds가 캐릭터 수만큼 → 추가할 때마다 무거워짐)
let hitWin = null, hitFor = null, hitDown = false, hitShown = false, hitBounds = null;
const HIT_NEAR = 12; // 커서가 이 px 안으로 들어오면 미리 옮겨 둠 (클릭 순간 창이 없는 일 방지)
function createHitWindow() {
  if (hitWin && !hitWin.isDestroyed()) return;
  hitWin = new BrowserWindow({
    x: 0, y: 0, width: 100, height: 100, show: false, transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true,
    resizable: false, movable: false, hasShadow: false, focusable: false, backgroundColor: "#00000000",
    webPreferences: { preload: path.join(__dirname, "renderer", "hit-preload.js"), contextIsolation: true, sandbox: true },
  });
  hitWin.setAlwaysOnTop(true, "screen-saver");
  hitWin.loadFile(path.join(__dirname, "renderer", "hit.html"));
  const w = hitWin;
  w.on("closed", () => { if (hitWin !== w) return; hitWin = null; hitShown = false; });
  // 렌더러가 죽으면 창은 남는데 입력을 아무 데도 전하지 않는다 — 사도가 '클릭이 안 되는' 상태. 다시 띄운다
  w.webContents.on("render-process-gone", (_e, d) => { console.log("hit renderer gone:", d.reason); if (hitWin === w && !w.isDestroyed()) w.webContents.reload(); });
}
const screenRect = (r) => ({ x: Math.round(geo.x + r.x), y: Math.round(geo.y + r.y), width: Math.max(8, Math.round(r.w)), height: Math.max(8, Math.round(r.h)) });
const inRect = (r, x, y, pad) => r && x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;
function placeHit(id) {
  if (!hitWin || hitWin.isDestroyed() || !geo) return;
  const inst = id && instances.get(id);
  if (!inst || !inst.rect) { if (hitShown) { hitWin.hide(); hitShown = false; } hitFor = null; hitBounds = null; return; }
  const b = screenRect(inst.rect);
  if (!hitBounds || hitBounds.x !== b.x || hitBounds.y !== b.y || hitBounds.width !== b.width || hitBounds.height !== b.height) { hitWin.setBounds(b); hitBounds = b; }
  if (!hitShown) { hitWin.showInactive(); hitWin.setAlwaysOnTop(true, "screen-saver"); hitShown = true; }
  hitFor = id;
}
// 보조 창(설정·가져오기·메뉴·말풍선·대화)의 화면 좌표 표. 커서 폴링이 16ms 마다 창마다 isDestroyed/isVisible/getBounds 를
// 물었다 — 전부 네이티브 호출이라 하루 종일 초당 수백 번. 창 자리는 옮기고·키우고·보이고·숨길 때만 바뀌니 그때 받아 두고 폴링은 표만 읽는다
const auxBounds = new Map(); // BrowserWindow → Rect(보임) | null(숨김)
function trackBounds(w) {
  const upd = () => { if (w.isDestroyed()) { auxBounds.delete(w); return; } auxBounds.set(w, w.isVisible() ? w.getBounds() : null); };
  for (const ev of ["move", "resize", "show", "hide"]) w.on(ev, upd);
  w.on("closed", () => auxBounds.delete(w));
  upd();
}
// 커서 위치(창 기준)로 히트 창 대상 정하기. 누르고 있는 동안은 대상 고정(드래그 중 캐릭터가 커서를 따라오므로)
function cursorOverOurWindow(sx, sy) {
  for (const b of auxBounds.values()) if (b && sx >= b.x && sx < b.x + b.width && sy >= b.y && sy < b.y + b.height) return true;
  return false;
}
function updateHitTarget(x, y) {
  if (hitDown && hitFor && instances.has(hitFor)) { placeHit(hitFor); return; }
  // 설정창·가져오기 창·메뉴·말풍선 위에 커서가 있으면 히트 창을 치운다 — 히트 창이 항상 최상위라 캐릭터가 창 뒤에 있으면 그 창을 못 누르던 문제
  if (geo && cursorOverOurWindow(geo.x + x, geo.y + y)) { placeHit(null); return; }
  if (hitFor && inRect(instances.get(hitFor)?.rect, x, y, HIT_NEAR)) { placeHit(hitFor); return; } // 지금 대상 위면 유지(겹칠 때 깜빡임 방지)
  let best = null;
  for (const [id, inst] of instances) if (inRect(inst.rect, x, y, HIT_NEAR)) { best = id; break; }
  placeHit(best);
}
function mascotConfig() { return { geo, characters: viewsAll(), assetRoot: ASSET_ROOT, dataRoot: DATA_ROOT, standing: STANDING, logPos: argHas("--log-pos"), selftest: argHas("--selftest"), moodTest: argHas("--mood-test"), ingameTest: argHas("--ingame-test"), fpsProbe: argHas("--fps-probe") }; }
let rendererGone = []; // 마스코트 렌더러가 죽은 시각들 — 무한 재시작을 막는다
function createMascotWindow() {
  if (mascotWin && !mascotWin.isDestroyed()) return;
  if (!geo) geo = geometry();
  const win = new BrowserWindow({
    x: geo.x, y: geo.y, width: geo.w, height: geo.h,
    transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true,
    resizable: false, movable: false, hasShadow: false, focusable: false, backgroundColor: "#00000000",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false },
  });
  mascotWin = win; mascotLoaded = false;
  win.setAlwaysOnTop(true, "screen-saver");
  // 항상 클릭 통과 (끄면 Chrome이 '가려짐'으로 보고 영상을 회색으로 멈춤). forward:true는 쓰지 않는다 — 커서 폴링(아래 setInterval)과 함께 켜면
  // 같은 프로세스의 다른 창(설정창)을 제목줄로 끌어도 움직이지 않는 현상이 남(둘 중 하나만 끄면 정상). 호버는 폴링으로 처리하므로 forward가 필요 없음
  win.setIgnoreMouseEvents(true);
  win.setBounds({ x: geo.x, y: geo.y, width: geo.w, height: geo.h }); // 생성 시 잘린 크기 재적용
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.webContents.on("console-message", (ev) => {
    console.log(`[mascot:${ev.level}] ${ev.message} (${path.basename(ev.sourceId || "")}:${ev.lineNumber})`);
    const mm = /^SHOTREQ (\S+) (-?\d+) (-?\d+) (\d+) (\d+)$/.exec(ev.message); // 테스트: 렌더러가 요청한 영역을 캡처해 out/에 저장
    if (mm && !app.isPackaged) win.webContents.capturePage({ x: +mm[2], y: +mm[3], width: +mm[4], height: +mm[5] }).then(img => { fs.mkdirSync(path.join(__dirname, "out"), { recursive: true }); fs.writeFileSync(path.join(__dirname, "out", `shot-${mm[1]}.png`), img.toPNG()); console.log("SHOT saved", mm[1]); }).catch(e => console.log("SHOT fail", e.message));
  });
  if (argHas("--devtools")) win.webContents.openDevTools({ mode: "detach" });
  win.webContents.on("did-finish-load", () => {
    win.setBounds({ x: geo.x, y: geo.y, width: geo.w, height: geo.h });
    lastCursor = null; mascotLoaded = true;
    win.webContents.send("config", mascotConfig());
  });
  win.on("closed", () => { if (mascotWin !== win) return; mascotWin = null; mascotLoaded = false; }); // 그 사이 새로 만든 창을 지우지 않게
  // 렌더러(스파인·WebGL)가 죽으면 창은 투명하게 남고 사도만 사라진다 — 트레이는 살아 있으니 사용자는 이유를 모른다.
  // 옛 바운딩은 다 지워 히트 창이 빈자리를 잡지 않게 하고, 잠시 뒤 다시 로드한다 (did-finish-load 가 config 를 다시 보낸다)
  win.webContents.on("render-process-gone", (_e, d) => {
    console.log("mascot renderer gone:", d.reason, d.exitCode);
    for (const inst of instances.values()) inst.rect = null;
    placeHit(null); mascotLoaded = false;
    // 로드마다 죽는 상태(GPU·메모리)면 1초마다 영원히 다시 띄우게 된다. 5분에 세 번까지만
    const now = Date.now(); rendererGone = rendererGone.filter(t => now - t < 300000); rendererGone.push(now);
    if (rendererGone.length > 3) { console.error("mascot renderer keeps dying — giving up until restart"); return; }
    if (d.reason !== "clean-exit") setTimeout(() => { if (mascotWin === win && !win.isDestroyed()) win.reload(); }, 1000 * rendererGone.length);
  });
}
function createInstance(id) { if (!instances.has(id)) instances.set(id, { rect: null }); }
function destroyInstance(id) {
  if (!instances.has(id)) return;
  instances.delete(id); sdAnimsOf.delete(id);
  if (hitFor === id) { hitDown = false; placeHit(null); }
}
function addCharacter(from) {
  const src = charOf(from) || settings.characters[0];
  let n = settings.characters.length + 1; while (charOf(`c${n}`)) n++;
  const c = deepMerge({ ...CHAR_DEFAULTS, id: `c${n}` }, { skin: src.skin, mode: src.mode, scale: src.scale, opacity: src.opacity, behavior: src.behavior });
  settings.characters.push(c); saveSettings(); createInstance(c.id); broadcast(); return c.id; // 마스코트 창은 settings 브로드캐스트로 새 캐릭터를 만든다
}
function removeCharacter(id) {
  if (settings.characters.length <= 1) return false;
  settings.characters = settings.characters.filter(c => c.id !== id); saveSettings(); destroyInstance(id);
  if (menuFor === id && menuWin && !menuWin.isDestroyed()) menuWin.close();
  if (CH.for === id) closeChat();
  if (bubbleFor === id) closeBubble();
  broadcast(); return true;
}
// 메뉴 창은 --instance=id 로 만들어져 자기 캐릭터를 안다. 마스코트 창·설정 창은 id를 명시해서 보낸다
const instanceOf = (webContents) => (menuWin && !menuWin.isDestroyed() && menuWin.webContents.id === webContents.id) ? menuFor : null;
const sendMascot = (id, cmd, arg) => { if (mascotWin && !mascotWin.isDestroyed()) mascotWin.webContents.send("mascot", id, cmd, arg); };

// ---- 설정 창 ----
function openSettings(tab, forId) {
  const tell = () => { if (tab) settingsWin.webContents.send("tab", tab); if (forId) settingsWin.webContents.send("select", forId); };
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); tell(); return; }
  settingsWin = new BrowserWindow({
    width: 900, height: 660, minWidth: 720, minHeight: 520, title: "사도 데스크 설정", show: false,
    backgroundColor: "#1f1f24", autoHideMenuBar: true, icon: path.join(__dirname, "renderer", "tray.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  settingsWin.loadFile(path.join(__dirname, "renderer", "settings.html"));
  settingsWin.webContents.on("console-message", (ev) => console.log(`[settings:${ev.level}] ${ev.message} (${path.basename(ev.sourceId || "")}:${ev.lineNumber})`));
  { const w = settingsWin; w.once("ready-to-show", () => { if (settingsWin === w && !w.isDestroyed()) { w.show(); tell(); } }); }
  if (argHas("--shot-settings")) {
    const tabs = ["guide", "character", "behavior", "sound", "display", "news", "ai", "about"]; let i = 0;
    // 탭마다 위쪽 한 장 + 아래로 끝까지 내린 한 장. AI 탭처럼 긴 탭은 위만 찍으면 절반을 못 본다
    const shoot = () => { if (!settingsWin || i >= tabs.length) return; settingsWin.webContents.send("tab", tabs[i]); setTimeout(async () => {
      const dir = path.join(__dirname, "out"); fs.mkdirSync(dir, { recursive: true });
      // 탭이 실제로 바뀐 뒤에 찍는다 — 렌더러가 늦게 뜨면 첫 "tab" 메시지가 사라져 한 탭씩 어긋난 파일이 남았다(리뷰). 3초까지 기다리며 다시 보낸다
      for (let t = 0; t < 30; t++) { const on = await settingsWin.webContents.executeJavaScript("(document.querySelector('main section.on')||{}).id"); if (on === "tab-" + tabs[i]) break; if (t % 5 === 4) settingsWin.webContents.send("tab", tabs[i]); await new Promise(r => setTimeout(r, 100)); }
      { const on = await settingsWin.webContents.executeJavaScript("(document.querySelector('main section.on')||{}).id"); if (on !== "tab-" + tabs[i]) { console.log("SHOT SKIP", tabs[i], "탭 전환 안 됨:", on); i++; shoot(); return; } }
      await new Promise(r => setTimeout(r, 300));
      const top = await settingsWin.webContents.capturePage(); fs.writeFileSync(path.join(dir, `settings-${tabs[i]}.png`), top.toPNG());
      const more = await settingsWin.webContents.executeJavaScript("(()=>{const m=document.querySelector('main');const can=m.scrollHeight>m.clientHeight+8;m.scrollTop=m.scrollHeight;return can})()");
      if (more) { // 긴 탭은 가운데·아래도 한 장씩 — AI 탭은 세 화면 분량이다
        await new Promise(r => setTimeout(r, 400)); const bot = await settingsWin.webContents.capturePage(); fs.writeFileSync(path.join(dir, `settings-${tabs[i]}-bottom.png`), bot.toPNG());
        await settingsWin.webContents.executeJavaScript("(()=>{const m=document.querySelector('main');m.scrollTop=(m.scrollHeight-m.clientHeight)/2})()"); await new Promise(r => setTimeout(r, 400));
        const mid = await settingsWin.webContents.capturePage(); fs.writeFileSync(path.join(dir, `settings-${tabs[i]}-mid.png`), mid.toPNG());
        await settingsWin.webContents.executeJavaScript("document.querySelector('main').scrollTop=0"); }
      // --shot-focus '#ai-step1' — 그 요소가 보이게 내려서 한 장 더 (특정 카드를 확인할 때)
      const focus = argVal("--shot-focus", ""); if (focus) { const ok = await settingsWin.webContents.executeJavaScript(`(()=>{const e=document.querySelector(${JSON.stringify(focus)});if(!e||!e.offsetParent)return false;e.scrollIntoView({block:"start"});return true})()`); if (ok) { await new Promise(r => setTimeout(r, 400)); const img = await settingsWin.webContents.capturePage(); fs.writeFileSync(path.join(dir, `settings-${tabs[i]}-focus.png`), img.toPNG()); } }
      console.log("SHOT", tabs[i], more ? "(위+아래)" : ""); i++; shoot(); }, 1800); };  // 창 목록처럼 IPC 로 채우는 칸이 있어 넉넉히
    setTimeout(shoot, 5000);
  }
  const w = settingsWin; trackBounds(w);
  w.on("closed", () => { if (settingsWin === w) settingsWin = null; });
  if (argHas("--devtools")) settingsWin.webContents.openDevTools({ mode: "detach" });
}

// ---- 새 소식 감시 + 말풍선 ----
const { createNewsWatcher } = require("./news.js");
const Talk = require("./renderer/talk.js");
let talkData = null; try { talkData = JSON.parse(fs.readFileSync(path.join(DATA_ROOT, "talk-ko.json"), "utf8")); console.log(`talk profiles: ${Object.keys(talkData.heroes).length}명`); } catch (e) { console.warn("talk-ko.json 없음 — 크레페 말투만 사용", e.message); }
// 알림 말투: 첫 캐릭터의 사도 프로필(나무위키 대사 기반). 설정 news.talkCrepe면 크레페 고정
function talkProfile() {
  const cfg = settings.global.news || {};
  if (!cfg.talkCrepe && talkData) { const p = Talk.profileFor(talkData, settings.characters[0].skin); if (p) return p; }
  return (talkData && talkData.heroes.Crepe) || { style: "crepe", addr: "교주님", ko: "크레페" };
}
const NEWS_STATE = path.join(app.getPath("userData"), "news-state.json");
let news = null, bubbleWin = null, bubbleFor = null, bubbleBounds = null;
const BUBBLE_W = 308;
function announce(items) {
  const cfg = settings.global.news || {};
  const id = settings.characters[0].id; // 첫 캐릭터가 알림 담당 (여러 명이 동시에 떠들지 않게)
  const text = Talk.announce(items, talkProfile());
  const ttl = Math.max(8, +cfg.ttlSec || 40) * 1000;
  showBubble(id, { items, text, ttl });
  sendMascot(id, "announce", { n: items.length, sound: cfg.sound !== false, hold: ttl + 2000 });
  if (cfg.toast) { try { const { Notification } = require("electron"); if (Notification.isSupported()) new Notification({ title: `사도 데스크 — ${text.head}`, body: items.slice(0, 3).map(i => `[${i.label}] ${i.title}`).join("\n"), silent: true }).show(); } catch {} }
  if (tray) buildTray();
  broadcast();
}
let bubbleAnchor = null; // 띄운 순간의 캐릭터 머리 위 좌표(화면). 이후 높이 변경 때만 이 기준으로 재배치
function bubblePlace(id) {
  if (!bubbleWin || bubbleWin.isDestroyed() || !geo) return;
  const inst = instances.get(id); const r = inst && inst.rect;
  if (!bubbleAnchor || bubbleAnchor.id !== id) { if (!r) return; bubbleAnchor = { id, cx: Math.round(geo.x + r.x + r.w / 2), top: Math.round(geo.y + r.y) }; }
  const h = bubbleBounds ? bubbleBounds.height : 200;
  const sx = bubbleAnchor.cx - Math.round(BUBBLE_W / 2), sy = bubbleAnchor.top - h + 6;
  const d = screen.getDisplayNearestPoint({ x: sx + BUBBLE_W / 2, y: sy + h / 2 }).workArea;
  const b = { x: Math.min(Math.max(sx, d.x), d.x + d.width - BUBBLE_W), y: Math.max(d.y, sy), width: BUBBLE_W, height: h };
  if (!bubbleBounds || b.x !== bubbleBounds.x || b.y !== bubbleBounds.y || b.height !== bubbleBounds.height) { bubbleWin.setBounds(b); bubbleBounds = b; }
}
function showBubble(id, payload) {
  if (fsHidden) return; // 전체화면 뒤에 숨어 있는 동안 말풍선만 게임 위로 올라오면 안 된다
  bubbleFor = id; bubbleBounds = null; // 위치는 지금 캐릭터 자리 기준으로 한 번만 잡고 고정 (따라다니면 읽기 힘듦)
  if (!bubbleWin || bubbleWin.isDestroyed()) {
    bubbleWin = new BrowserWindow({
      x: 0, y: 0, width: BUBBLE_W, height: 200, show: false, transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true,
      resizable: false, movable: false, hasShadow: false, focusable: false, backgroundColor: "#00000000",
      webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: false },
    });
    bubbleWin.setAlwaysOnTop(true, "screen-saver");
    bubbleWin.loadFile(path.join(__dirname, "renderer", "bubble.html"));
    bubbleWin.webContents.on("console-message", (ev) => console.log(`[bubble:${ev.level}] ${ev.message}`));
    const w = bubbleWin; trackBounds(w);
    w.on("closed", () => { if (bubbleWin !== w) return; bubbleWin = null; bubbleFor = null; bubbleBounds = null; bubbleAnchor = null; });
    w.webContents.on("render-process-gone", (_e, d) => { console.log("bubble renderer gone:", d.reason); if (!w.isDestroyed()) w.close(); }); // 다음 말풍선이 새 창을 만든다
    w.webContents.once("did-finish-load", () => { if (w.isDestroyed()) return; w.webContents.send("show", payload); bubblePlace(id); w.showInactive(); });
  } else { bubbleAnchor = null; bubbleWin.webContents.send("show", payload); bubblePlace(id); if (!bubbleWin.isVisible()) bubbleWin.showInactive(); }
}
function closeBubble() { if (bubbleWin && !bubbleWin.isDestroyed()) bubbleWin.close(); }

// ---- AI 대화 창 — chat.js (아래 CH). 프로필 자료는 여기서 읽어 chatProfile 로 준다 ----
let talkStyle = null; try { talkStyle = JSON.parse(fs.readFileSync(path.join(DATA_ROOT, "talk-style.json"), "utf8")); } catch (e) { console.warn("data/talk-style.json 을 읽지 못했습니다 — 말투 통계 없이 돕니다:", e.message); } // 보이스 STT 대본 분석(어미 비율·표본) — 없어도 됨
let relations = null; try { relations = JSON.parse(fs.readFileSync(path.join(DATA_ROOT, "relations.json"), "utf8")); } catch (e) { console.warn("data/relations.json 을 읽지 못했습니다 — 사도끼리 부르는 말 없이 돕니다:", e.message); } // 사도끼리 부르는 말·함께 등장 (tools/build-relations.py)
let theaters = []; try { theaters = JSON.parse(fs.readFileSync(path.join(DATA_ROOT, "theaters.json"), "utf8")).items || []; } catch (e) { console.warn("data/theaters.json 을 읽지 못했습니다 — 테마극장 이야기 없이 돕니다:", e.message); } // 테마극장 출연·줄거리 (나무위키)
let bible = {}; try { bible = JSON.parse(fs.readFileSync(path.join(DATA_ROOT, "bible.json"), "utf8")); } catch (e) { console.warn("data/bible.json 을 읽지 못했습니다 — 인물 사전 없이 돕니다:", e.message); } // 인물 사전: 나무위키 사도 문서 139편 요약(누구인지·성격·관계·행적·말버릇)
let vsamples = {}; try { vsamples = JSON.parse(fs.readFileSync(path.join(DATA_ROOT, "voice-samples.json"), "utf8")); } catch (e) { console.warn("data/voice-samples.json 을 읽지 못했습니다 — 말투 예시 없이 돕니다:", e.message); } // 말투 예시: 게임 대사가 아니라, 잰 말투에 맞춰 우리가 지은 문장
// 혼잣말(대본)은 selftalk.js — 데이터 적재·상황 고르기·말풍선 내보내기. bubbleMs 는 아래에서 정의되므로 getter 로
const ST = require("./selftalk.js")({ dataRoot: DATA_ROOT, get bubbleMs() { return bubbleMs; }, chatProfile: (id) => chatProfile(id), instanceOf: (wc) => instanceOf(wc), sendMascot: (id, cmd, arg) => sendMascot(id, cmd, arg), showBubble: (id, p) => showBubble(id, p) });
const selfTalk = ST.lines, skinTalk = ST.skins, saySelfTalk = ST.saySelfTalk, selfTalkSaid = ST.selfTalkSaid;
const koOfHero = (k) => (relations && relations[k] && relations[k].ko) || k;
const KIN = { renewa: "renewaawaken" };   // 자료를 물려받을 같은 인물 — tools/selftalk-lib.js 의 ALIAS 와 짝
function chatProfile(id) {
  const ch = charOf(id); if (!ch) return null;
  const p = talkData ? Talk.profileFor(talkData, ch.skin) : null;
  const prof = p || { ko: koSkin(ch.skin), style: "polite", addr: "교주", lines: [] };
  const hero = ch.skin.replace(/^Mini_/, "").replace(/Skin\d+$/, "").toLowerCase();
  // 같은 인물인데 미니미가 따로 있는 경우 — 인물 사전·관계·말투 예시는 본판 것을 같이 쓴다.
  // 리뉴아는 프론티어 시절(Mini_Renewa)과 각성판(Mini_RenewaAwaken)이 나뉘어 있는데 자료는 각성판에만 있다
  const kin = KIN[hero] || hero;
  if (talkStyle && talkStyle[kin]) prof.styleInfo = talkStyle[kin];
  prof.key = hero; prof.koOf = koOfHero;
  // 코스튬을 입고 있으면 그 코스튬 전용 혼잣말도 쓴다 (data/self-talk.json 의 skins)
  { const sm = /Skin([0-9]+)$/.exec(ch.skin.replace(/^Mini_/, "")); prof.skinKey = sm ? `${hero}#${sm[1]}` : ""; }
  if (relations && relations[kin]) prof.rel = relations[kin];
  if (bible[kin]) prof.bible = bible[kin];
  // 말투 예시: 손으로 지은 3줄 뒤에 혼잣말 대본을 붙인다. 혼잣말은 사도마다 12줄쯤 되고 전부 말투 검사를 통과한
  // 지은 문장이라, 모델이 어미·자칭·말버릇을 붙잡을 표본이 셋에서 열다섯으로 는다. 게임 대사는 아니다(원칙)
  const own = vsamples[kin] || [], talk = selfTalk[hero] || [];
  if (own.length || talk.length) prof.sampleLines = Ai.sampleLinesFor(own, talk, 12);
  prof.theaters = theaters.filter(t => (t.castKeys || []).includes(hero)).sort((x, y) => y.season - x.season);
  return prof;
}
// ---- 화면 보기: 캐릭터가 서 있는 모니터를 캡처해(축소 JPEG) AI에 첨부. 설정 ai.screen 이 켜져 있을 때만 ----
// 화면 캡처는 screen-capture.js — 허용 창 고르기·모니터 캡처·먼저 말 걸 때 붙일 수 있는지. 상태는 getter 로
const SC = require("./screen-capture.js")({ get settings() { return settings; }, get geo() { return geo; }, get instances() { return instances; } });
let captureScreenFor = SC.captureScreenFor;   // let — 화면 시험 훅이 감싸서 갈아 끼운다
const screenAllowed = SC.screenAllowed, screenReady = SC.screenReady;
// 대화 창·턴·화면 보고 한마디는 chat.js — 상태는 getter 로. captureScreenFor 는 화면 시험 훅이 갈아 끼우므로 매번 읽는다
const CH = require("./chat.js")({ get settings() { return settings; }, get geo() { return geo; }, get instances() { return instances; }, get captureScreenFor() { return captureScreenFor; },
  chatProfile: (id) => chatProfile(id), sendMascot: (id, cmd, arg) => sendMascot(id, cmd, arg), trackBounds: (w) => trackBounds(w), instanceOf: (wc) => instanceOf(wc), screenAllowed, heightOf: (h, lo) => heightOf(h, lo) });
const openChat = CH.openChat, closeChat = CH.closeChat, chatTurn = CH.chatTurn, screenTalk = CH.screenTalk;
// 말풍선이 떠 있는 시간: 기본 초 + 글자당 0.1초
const bubbleMs = (t) => Math.round((Math.max(2, +((settings.global.talk || {}).bubbleSec) || 4) * 1000) + Math.min(80, t.length) * 100);
// 렌더러가 보낸 높이는 정수여야 한다 — NaN 이면 setBounds 가 메인에서 throw 한다 (레이아웃 전에 0/undefined 로 온 적이 있다)
const heightOf = (h, lo) => { h = Math.round(+h); return Number.isFinite(h) && h >= lo ? h : null; };
// 설정창용
// ---- 업데이트: 앱 안에서 받아 설치 ----
const pct = (st) => st.total ? `${Math.round(st.got / st.total * 100)}%` : `${(st.got / 1048576).toFixed(0)}MB`;
let updateBusy = false;
async function startUpdate(silentIfBusy = false) {
  if (!UP.info) return;
  if (updateBusy) { if (!silentIfBusy) console.log("update: 이미 진행 중"); return; }
  if (UP.state.phase === "ready") return confirmInstall();
  updateBusy = true; buildTray();
  const tick = setInterval(buildTray, 1500);   // 트레이 항목에 진행률
  const r = await UP.download();
  clearInterval(tick); updateBusy = false; buildTray();
  if (!r.ok) {
    if (r.cancelled) return;   // 사람이 멈춘 것 — 아무 말도 하지 않는다
    const { dialog } = require("electron");
    const a = await dialog.showMessageBox({ type: "warning", title: "사도 데스크 업데이트", message: "업데이트를 받지 못했어요.", detail: r.error + "\n\n릴리스 페이지에서 직접 받으실 수도 있습니다.", buttons: ["릴리스 페이지 열기", "닫기"], defaultId: 1, cancelId: 1 });
    if (a.response === 0) shell.openExternal(UP.info.url);
    return;
  }
  confirmInstall();
}
async function confirmInstall() {
  const { dialog } = require("electron");
  const a = await dialog.showMessageBox({
    type: "question", title: "사도 데스크 업데이트",
    message: `새 버전 ${UP.info.tag} 을 받았습니다. 지금 설치할까요?`,
    detail: "설치하는 동안 사도가 잠시 사라졌다가 새 버전으로 다시 나타납니다. 설정과 게임 데이터는 그대로입니다.",
    buttons: ["지금 설치", "나중에"], defaultId: 0, cancelId: 1,
  });
  if (a.response !== 0) return;
  const r = UP.install();
  if (!r.ok) { shell.showItemInFolder(UP.state.file || ""); dialog.showMessageBox({ type: "info", title: "사도 데스크", message: "설치 파일을 열어 주세요.", detail: r.error }); }
}
// 설치가 실패하면 설치 파일이 우리를 이 인자로 다시 켠다 (updater.install 의 || 갈래) — 조용히 옛 판으로 돌아오면 사람은 됐는지 안 됐는지 모른다
if (argHas("--update-failed")) app.whenReady().then(() => setTimeout(async () => {
  const { dialog } = require("electron");
  const a = await dialog.showMessageBox({ type: "warning", title: "사도 데스크 업데이트", message: "새 버전 설치가 끝나지 못했어요.", detail: `지금 판(v${app.getVersion()})은 그대로 쓰실 수 있습니다. 릴리스 페이지에서 설치 파일을 직접 받아 설치해 보세요.`, buttons: ["릴리스 페이지 열기", "닫기"], defaultId: 1, cancelId: 1 });
  if (a.response === 0) shell.openExternal("https://github.com/RED9839/sado-desk/releases/latest");
}, 3000));
ipcMain.handle("update:state", () => ({ info: UP.info, state: UP.state, version: app.getVersion() }));
ipcMain.handle("update:check", async () => { await UP.checkUpdate(); return { info: UP.info, version: app.getVersion() }; });
ipcMain.on("update:start", () => startUpdate());
ipcMain.on("update:cancel", () => { UP.cancel(); buildTray(); });
ipcMain.handle("ai:status", async () => ({ ...(await Ai.status(settings.global.ai)), keysEncrypted: Ai.keysEncrypted() }));
// 진단 정보 — 문제를 알릴 때 붙이라고 한 덩이로. API 키·대화 내용·창 제목은 넣지 않는다 (키는 있고 없고만)
ipcMain.handle("diag:get", async () => {
  const g = settings.global, ai = g.ai || {};
  let st = null; try { st = await Ai.status(ai); } catch (e) { st = { error: e.message }; }
  const disp = (geo && geo.displays || []).map((d, i) => `${i + 1}) ${d.w}×${(d.bottom - d.top) || "?"} scale ${d.scale || 1}${d.primary ? " 주" : ""}`);
  const L = [
    `사도 데스크 v${app.getVersion()} · Electron ${process.versions.electron} · ${process.platform} ${require("os").release()}`,
    `설치판: ${app.isPackaged ? "예" : "아니오(개발 실행)"} · 켠 지 ${Math.round((Date.now() - (app._startedAt || Date.now())) / 60000)}분`,
    `게임 데이터: ${hasAssets(ASSET_ROOT) ? "있음" : "없음"} — 스탠딩 ${Object.keys(STANDING.game).length} · 전투 SD ${Object.keys(STANDING.ingame).length} · 외형 ${(catalog.skins || []).length}벌`,
    `사도 ${settings.characters.length}명: ${settings.characters.map(c => `${koSkin(c.skin)}(${c.mode})`).join(", ")}`,
    `화면: ${disp.length}대 [${disp.join(" · ")}] · 모니터 가두기 ${g.display.confineMonitor !== false ? "켬" : "끔"} · 맨 앞 유지 ${g.display.keepOnTop ? "켬" : "끔"} · 전체화면 숨김 ${g.display.hideFullscreen !== false ? "켬" : "끔"} · 갱신 ${g.display.fps}`,
    `소리: ${g.sound.muted ? "꺼짐" : `전체 ${Math.round(g.sound.master * 100)}% · 음성 ${Math.round(g.sound.voice * 100)}% · 효과음 ${Math.round(g.sound.sfx * 100)}%`}`,
    `AI: 고른 것 ${ai.provider || "auto"} · 지금 쓰는 것 ${(st && st.resolved) || "없음"} · 키 ${["gemini", "anthropic", "openai"].filter(k => st && st[k] && st[k].key).join(",") || "없음"}${Ai.keysEncrypted() ? "(암호화)" : "(암호화 불가)"} · Ollama ${st && st.ollama ? (st.ollama.running ? `실행 중, 모델 ${st.ollama.models.length}개` : "연결 안 됨") : "?"}`,
    `AI 대화: 먼저 말 걸기 ${ai.proactive ? "켬" : "끔"} · 화면 보기 ${ai.screen ? `켬(${ai.screenScope === "display" ? "모니터 전체" : `앱 ${(ai.screenWindows || []).length}개`})` : "끔"} · 기록 ${ai.memory !== false ? "켬" : "끔"}`,
    `새 소식: ${g.news && g.news.enabled === false ? "끔" : "켬"} · 마지막 확인 ${news && news.status.lastCheck ? new Date(news.status.lastCheck).toLocaleString("ko-KR") : "없음"} · 마지막 오류 ${(news && news.status.lastError) || "없음"}`,
    `경로: 설정 ${SETTINGS_FILE} · 게임 데이터 ${ASSET_ROOT}`,
  ];
  return L.join("\n");
});   // 키가 실제로 암호화돼 저장되는지 — 설정 창이 사실대로 적는다
ipcMain.handle("ai:set-key", (_e, provider, key) => { if (!["gemini", "anthropic", "openai"].includes(provider)) return false; updateSettings({ ai: { keys: { [provider]: Ai.encKey(String(key || "").trim()) } } }); return true; });
ipcMain.handle("ai:test", async (_e, provider) => {
  const prof = chatProfile(settings.characters[0].id); let out = "";
  try { const r = await Ai.chat(settings.global.ai, prof, [{ role: "user", text: "안녕! 한 마디만 해 줘." }], (d) => { out += d; }, { provider: provider || undefined }); return { ok: true, text: r.text, emotion: r.raw, provider: r.provider, model: r.model }; }
  // 대화창과 같은 말로 안내한다 — 같은 오류인데 화면마다 설명이 다르면 사용자가 두 번 헤맨다. 원문은 상세로 따로 준다
  catch (e) { return { ok: false, error: e.message === "no-provider" ? "쓸 수 있는 AI 서비스가 없습니다. 설정 → AI 대화에서 Ollama를 연결하거나 API 키를 저장해 주세요." : Ai.explainError(e), detail: String(e.message || e).slice(0, 300) }; }
});
let pullProc = null;
ipcMain.handle("ai:pull", (e, model) => new Promise((resolve) => { // ollama pull <model> (CLI가 PATH에 있어야 함)
  if (pullProc) return resolve({ ok: false, error: "이미 내려받는 중" });
  if (typeof model !== "string" || !/^[\w.\-\/]+(:[\w.\-]+)?$/.test(model) || model.startsWith("-")) return resolve({ ok: false, error: "모델 이름이 올바르지 않아요 (예: exaone3.5:7.8b)" }); // 명령줄 인자로 넘어가니 "-" 로 시작하는 옵션 꼴은 막는다
  const { spawn } = require("node:child_process"); let last = "";
  try { pullProc = spawn("ollama", ["pull", model], { windowsHide: true }); } catch (err) { return resolve({ ok: false, error: err.message }); }
  const relay = (d) => { const t = d.toString("utf8").replace(/\r/g, "\n").split("\n").map(s => s.trim()).filter(Boolean); if (t.length) { last = t[t.length - 1]; if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send("ai:pull-progress", last); } };
  pullProc.stdout.on("data", relay); pullProc.stderr.on("data", relay);
  pullProc.on("error", (err) => { pullProc = null; resolve({ ok: false, error: err.code === "ENOENT" ? "ollama 명령을 찾지 못했어요 — Ollama를 설치하고 다시 시도해 주세요" : err.message }); });
  pullProc.on("exit", (code) => { pullProc = null; resolve({ ok: code === 0, error: code === 0 ? "" : last }); });
}));
ipcMain.on("ai:open-url", (_e, which) => { const u = { ollama: "https://ollama.com/download", gemini: "https://aistudio.google.com/apikey", anthropic: "https://console.anthropic.com/settings/keys", groq: "https://console.groq.com/keys" }[which]; if (u) shell.openExternal(u); });
// 먼저 말 걸기. 혼잣말은 대본이라 AI 없이 돌고(talk.minMin 마다), 화면 보기만 AI 가 필요하다
let proactiveBusy = false; // Ai.status()를 기다리는 동안 다음 타이머가 겹쳐 들어오면 사도가 둘 연달아 말을 건다
setInterval(async () => {
  const ai = settings.global.ai || {}, T = settings.global.talk || {};
  if (CH.busy || proactiveBusy || !mascotStarted || fsHidden) return;
  const gapMin = (Date.now() - Math.max(CH.lastAt, app._startedAt || 0)) / 60000;
  if (gapMin < (T.minMin || 8) || Math.random() > 0.25) return;
  proactiveBusy = true;
  try {
  const id = CH.for || settings.characters[Math.floor(Math.random() * settings.characters.length)].id; // 여러 명이면 아무나 한 명이. 대화창이 열려 있으면 그 사도 — 남의 창을 가로채지 않게
  // AI 를 쓰는 길은 제 간격(기본 40분)을 따로 지킨다 — 대본보다 훨씬 드물게
  const aiTurn = ai.proactive && gapMin >= (ai.proactiveMin || 40);
  // 화면을 보고 말 거는 것 — AI 필요. 설정에서 켠 만큼만, 제공자가 실제로 잡힐 때만
  if (aiTurn && Math.random() * 100 < (+ai.screenProactive || 0) && await screenReady()) {
    const st = await Ai.status(ai);
    if (st.resolved) { CH.touch(); screenTalk(id, ""); return; }
  }
  // 혼잣말 — 대본. AI 를 켜지 않았어도 여기까지 온다
  if (T.selfTalk !== false && saySelfTalk(id)) { CH.touch(); return; }
  // 대본이 없는 사도만 AI 로 물러선다
  if (!aiTurn) return;
  const st2 = await Ai.status(ai); if (!st2.resolved) return;
  CH.touch();
  openChat(id, { quiet: true });
  setTimeout(async () => {
    await chatTurn(id, "", { say: true, extra: "사용자가 한동안 아무 말도 하지 않았다. 네가 먼저 한두 문장(60자 안팎)으로 짧게 말을 걸어라 — 안부, 시간대에 맞는 인사, 가벼운 질문이나 혼잣말 중 하나. 대답을 강요하지 말 것. 문장은 두 개까지." });
    const sec = +settings.global.ai.chatAutoCloseSec; if (!(sec > 0)) return;
    const opened = CH.lastAt; // 사용자가 그 사이 입력하면(lastChatAt 갱신) 닫지 않음
    setTimeout(() => { const w = CH.win; if (w && !w.isDestroyed() && !w.isFocused() && !CH.busy && CH.lastAt === opened) closeChat(); }, sec * 1000);
  }, 900);
  } catch (e) { console.log("proactive error:", e.message); } // setInterval 의 async 콜백에서 던지면 unhandledRejection 으로 새 나가 분마다 오류가 쌓인다
  finally { proactiveBusy = false; }
}, 60000);
app._startedAt = Date.now();
function initNews() {
  news = createNewsWatcher({ stateFile: NEWS_STATE, getConfig: () => settings.global.news, onNew: announce, log: (...a) => console.log(...a) });
  news.start();
  if (argHas("--news-test-fake")) setTimeout(() => news.inject([
    { source: "update", label: "업데이트", id: "test:1", title: "[업데이트] 9월 10일(목) 신규 업데이트 안내 (테스트)", url: "https://game.naver.com/lounge/Trickcal/board/11", date: new Date().toISOString(), writer: "GM아멜리아" },
    { source: "youtube", label: "유튜브", id: "test:2", title: "[트릭컬 리바이브] 신규 사도 PV (테스트)", url: "https://www.youtube.com/@epidgames6350", date: new Date().toISOString(), thumb: "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg" },
  ]), 6000);
  if (argHas("--news-test")) setTimeout(() => ipcMain.emit("news:test"), 4000);
  if (argHas("--news-test") || argHas("--news-test-fake")) setTimeout(async () => { console.log("BUBBLE", bubbleWin && !bubbleWin.isDestroyed() ? JSON.stringify(bubbleWin.getBounds()) : null, "visible", bubbleWin?.isVisible(), "unread", news.unread, "url", bubbleWin?.webContents.getURL()); if (bubbleWin) { const img = await bubbleWin.webContents.capturePage(); fs.writeFileSync(path.join(__dirname, "out", "bubble-page.png"), img.toPNG()); console.log("BUBBLE page shot", img.getSize()); } }, 9000);
}

// ---- 우클릭 메뉴 창 ----
const MENU_W = 270;
function openMenu(id, sx, sy) {
  menuFor = id;
  const d = screen.getDisplayNearestPoint({ x: sx, y: sy }).workArea;
  const h = 600;
  const x = Math.min(Math.max(sx, d.x), d.x + d.width - MENU_W), y = Math.min(Math.max(sy, d.y), d.y + d.height - h);
  if (menuWin && !menuWin.isDestroyed()) { menuWin.setBounds({ x, y, width: MENU_W, height: h }); menuWin.webContents.send("settings", viewFor(id)); menuWin.show(); menuWin.focus(); return; }
  menuWin = new BrowserWindow({
    x, y, width: MENU_W, height: h, show: false, transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true,
    resizable: false, movable: true, hasShadow: false, backgroundColor: "#00000000", // movable: 제목줄(-webkit-app-region: drag)을 잡고 옮길 수 있게
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: false, additionalArguments: [`--instance=${id}`] },
  });
  menuWin.setAlwaysOnTop(true, "screen-saver");
  menuWin.loadFile(path.join(__dirname, "renderer", "menu.html"));
  { const w = menuWin; w.once("ready-to-show", () => { if (menuWin === w && !w.isDestroyed()) { w.show(); w.focus(); } }); }
  const w = menuWin; trackBounds(w);
  w.on("blur", () => { if (!w.isDestroyed()) w.close(); });
  w.on("closed", () => { if (menuWin !== w) return; menuWin = null; menuFor = null; });
  w.webContents.on("render-process-gone", (_e, d) => { console.log("menu renderer gone:", d.reason); if (!w.isDestroyed()) w.close(); }); // 다음 우클릭이 새 창을 만든다
  menuWin.webContents.on("console-message", (ev) => console.log(`[menu:${ev.level}] ${ev.message}`));
}

// ---- 커서 폴링 (모든 마스코트 창에) ----
// 16ms 마다 커서를 묻는 건 사도 근처에서만 값어치가 있다. 사도가 숨었으면 아예 멈추고(전체화면 뒤),
// 커서가 멀면 성기게 본다 — 가까워지는 건 한 틱 안에 알아채므로 손맛은 그대로다
let lastCursor = null, still = 0; // still: 커서가 같은 자리에 머문 틱 수
let cursorT = null, cursorMs = 0;
const CP = require("./cursor-poll.js");
const cursorPollMs = () => CP.pollMs(lastCursor, [...instances.values()].map(i => i.rect).filter(Boolean));
function startCursorPoll(ms) {
  if (cursorT && cursorMs === ms) return;
  if (cursorT) clearInterval(cursorT);
  cursorMs = ms; cursorT = setInterval(cursorTick, ms);
}
function stopCursorPoll() { if (cursorT) { clearInterval(cursorT); cursorT = null; cursorMs = 0; } }
function cursorTick() {
  if (!geo || !mascotWin || mascotWin.isDestroyed()) return;
  if (fsHidden) { if (hitFor !== null) placeHit(null); stopCursorPoll(); return; } // 전체화면 뒤에 숨는 동안엔 묻지도 않는다(applyFullscreenHide 가 다시 켠다)
  startCursorPoll(cursorPollMs());
  const p = screen.getCursorScreenPoint();
  const x = p.x - geo.x, y = p.y - geo.y;
  // 커서가 가만히 있으면 대상 판정을 4틱(≈64ms)에 한 번만 하고 렌더러에도 알리지 않는다(같은 값이다).
  // 아예 건너뛰면 안 된다 — 서 있는 커서 밑으로 사도가 걸어 들어올 수 있고, hit-rect 는 hitFor 인 사도만 따라간다
  if (lastCursor && lastCursor.x === x && lastCursor.y === y) { if (++still % 4 === 0) updateHitTarget(x, y); return; }
  still = 0; updateHitTarget(x, y);
  lastCursor = { x, y };
  mascotWin.webContents.send("cursor", lastCursor);
}
startCursorPoll(CP.FAST);

// ---- IPC ----
ipcMain.on("loaded", (e, info) => { catalog = info; lastCursor = null; buildTray(); if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send("catalog", catalogPayload()); showGuideOnce(); });
// 처음 뜬 사도가 조작법을 한 번 알려 준다. 쓰다듬기·볼 당기기·간지럽히기·들기·우클릭 메뉴는 전부
// 우연히 발견해야 하는 손짓이었고, 들어온 제보 대부분이 "이 손짓이 뭘 하는지 모르겠다"였다.
// 판정은 여러 번 고쳤지만 설명은 한 번도 붙이지 않았다. 설정 → 조작법에 같은 내용이 남아 있다
function showGuideOnce() {
  if ((settings.global.display || {}).guideShown) return;
  setTimeout(() => {
    if (fsHidden) { setTimeout(showGuideOnce, 30000); return; }   // 전체화면 뒤라면 나올 수 있을 때 다시
    const id = settings.characters[0] && settings.characters[0].id; if (!id || !instances.get(id)) return;
    updateSettings({ display: { guideShown: true } });
    showBubble(id, { items: [], ttl: 30000, text: {
      head: "처음이시죠? 이렇게 놀아 주세요",
      body: "머리를 문지르면 쓰다듬기 · 볼을 끌면 볼 당기기 · 몸을 좌우로 문지르면 간지럽히기 · 위로 끌면 들어 올리기",
      tail: "우클릭하면 메뉴가 열립니다. 설정 → 조작법에 다시 있어요.", who: "" } });
  }, 4000);
}
ipcMain.on("quit", () => app.quit());
ipcMain.handle("settings:get", (e, id) => id ? viewFor(id) : settingsPublic());
// 렌더러가 보내는 패치는 값만 받는다. id·version·characters 는 메인이 정하는 뼈대라 캐릭터 밑으로 들어오면 안 되고,
// ai.keys 는 ai:set-key 로만(설정 창에는 키를 주지 않으니 되돌아오는 패치에 keys 가 있으면 잘못된 것)
ipcMain.on("settings:set", (e, patch, id) => {
  if (!isObj(patch)) return;
  const p = { ...patch }; delete p.id; delete p.version; delete p.characters;
  if (isObj(p.ai) && "keys" in p.ai) { p.ai = { ...p.ai }; delete p.ai.keys; }
  const target = id || instanceOf(e.sender);
  updateSettings(sanitizePatch(p, { forChar: !!target }), target, e.sender.id); // 모르는 키·범위 밖 수치·엉뚱한 열거값은 여기서 걸러진다
});
ipcMain.on("sd-anims", (_e, id, list) => { sdAnimsOf.set(id, list || []); });
ipcMain.on("settings:reset", () => { const keepAi = settings.global.ai; settings = { version: 2, global: deepMerge(GLOBAL_DEFAULTS, { ai: keepAi }), characters: [{ ...CHAR_DEFAULTS, id: settings.characters[0].id }] }; /* AI 키·제공자는 유지 */ for (const id of [...instances.keys()]) if (id !== settings.characters[0].id) destroyInstance(id); saveSettings(); applyGeometry(); applyAutoStart(); applyFullscreenHide(); if (news) news.start(); broadcast(); }); // 자동 실행 등록·전체화면 숨김·소식 감시도 기본값대로(코드 리뷰 P2 — autoStart 만 false 로 그려 놓고 등록은 남아 있었다)
ipcMain.on("settings:open", (e, tab, id) => openSettings(tab, id || menuFor || instanceOf(e.sender)));
ipcMain.handle("catalog:get", (e) => {
  const p = catalogPayload(instanceOf(e.sender) || menuFor);
  // 설정 창의 모니터 고르기용 — 이름은 붙지 않으므로 순번·해상도·주모니터 여부로 알아보게 한다
  try {
    const prim = screen.getPrimaryDisplay();
    p.displays = screen.getAllDisplays().map((d, i) => ({ id: d.id, i: i + 1, w: d.bounds.width, h: d.bounds.height, x: d.bounds.x, primary: d.id === prim.id }));
  } catch { p.displays = []; }
  return p;
});
ipcMain.on("mascot", (e, cmd, arg, id) => sendMascot(id || instanceOf(e.sender) || menuFor || settings.characters[0].id, cmd, arg));
// ---- 에셋 가져오기(추출) 창 — setup-window.js ----
// 바깥 상태는 getter 로 넘긴다: ASSET_ROOT 는 '폴더 사용'에서 바뀌고, STANDING 은 다시 훑을 때 바뀐다
const setup = require("./setup-window.js")({ get assetRoot() { return ASSET_ROOT; }, get dataRoot() { return DATA_ROOT; }, get standing() { return STANDING; }, get mascotStarted() { return mascotStarted; },
  hasAssets, toSlash, updateSettings, rescanAssets, startMascot, refreshTray: () => { if (tray) buildTray(); }, trackBounds, argHas, argVal });
const openSetup = setup.openSetup;

// 새 소식
ipcMain.handle("news:list", () => ({ items: news ? news.items : [], unread: news ? news.unread : 0, status: news ? news.status : null }));
ipcMain.handle("news:check", async () => { if (!news) return { added: [], errors: ["감시 꺼짐"] }; const r = await news.check(true); if (tray) buildTray(); broadcast(); return { ...r, status: news.status, unread: news.unread }; });
ipcMain.on("news:open", (_e, url, id) => { if (/^https?:\/\//.test(url || "")) shell.openExternal(url); if (news) { news.markRead(id); if (tray) buildTray(); broadcast(); } });
ipcMain.on("news:read-all", () => { if (news) { news.markRead(null); if (tray) buildTray(); broadcast(); } });
ipcMain.on("news:show", () => { if (news) { const items = news.items.slice(0, 4); if (items.length) showBubble(settings.characters[0].id, { items, text: Talk.announce(items, talkProfile()), ttl: 40000 }); } });
ipcMain.on("news:test", async () => { // 미리보기: 지금 올라와 있는 실제 최신 글(유튜브 1 + 라운지 게시판별 1)을 말풍선으로. 본 것/안 읽음에는 영향 없음
  if (!news) return; const items = await news.latest(); if (!items.length) return;
  const id = settings.characters[0].id, ttl = Math.max(8, +(settings.global.news || {}).ttlSec || 40) * 1000;
  showBubble(id, { items, text: Talk.announce(items, talkProfile()), ttl }); sendMascot(id, "announce", { n: items.length, sound: (settings.global.news || {}).sound !== false, hold: ttl + 2000 });
});
ipcMain.on("bubble:resize", (_e, h) => { h = heightOf(h, 1); if (h === null) return; if (bubbleWin && !bubbleWin.isDestroyed()) { bubbleBounds = { ...(bubbleBounds || { x: 0, y: 0, width: BUBBLE_W }), height: Math.max(80, h) }; bubblePlace(bubbleFor); } });
ipcMain.on("bubble:close", () => closeBubble());
ipcMain.on("copy-text", (_e, t) => { try { require("electron").clipboard.writeText(String(t || "").slice(0, 20000)); } catch (e) { console.warn("clipboard", e.message); } });
ipcMain.on("open-path", (_e, which) => { if (which === "settings") shell.showItemInFolder(SETTINGS_FILE); else if (which === "assets") shell.openPath(ASSET_ROOT); });
ipcMain.on("char:add", (e, from) => addCharacter(from || instanceOf(e.sender)));
ipcMain.on("char:remove", (e, id) => removeCharacter(id || instanceOf(e.sender)));
// 히트 창
ipcMain.on("hit-rect", (e, r, id) => {
  const inst = instances.get(id); if (!inst) return;
  inst.rect = (r && r.w > 0) ? r : null;
  if (hitFor === id) placeHit(id); // 대상 캐릭터가 움직이면(드래그·이동) 히트 창도 바로 따라감
  // (말풍선·대화창은 띄울 때 자리를 잡고 고정 — 캐릭터를 따라다니지 않음. 대화창이 열린 동안엔 사도가 제자리에 있다: chat.js stay)
});
ipcMain.on("hit-ev", (e, ev) => {
  if (ev && ev.type === "mousedown") ST.touch(); // 손이 닿았다 — "오래 방치" 꼬리표를 푼다
  const id = ev.instance || hitFor; // 실제 히트 창 이벤트는 현재 대상 캐릭터에게. (테스트는 instance를 직접 지정)
  if (!id || !instances.has(id) || !geo || !mascotWin || mascotWin.isDestroyed()) return;
  if (ev.type === "mousedown") hitDown = true; else if (ev.type === "mouseup") hitDown = false;
  mascotWin.webContents.send("hit-mouse", { instance: id, type: ev.type, x: ev.sx - geo.x, y: ev.sy - geo.y, button: ev.button, buttons: ev.buttons });
});
ipcMain.on("menu:open", (e, p, id) => { if (id && charOf(id) && geo) openMenu(id, geo.x + p.x, geo.y + p.y); });
ipcMain.on("menu:close", () => { if (menuWin && !menuWin.isDestroyed()) menuWin.close(); });
ipcMain.on("menu:resize", (_e, h) => { h = heightOf(h, 40); if (h === null) return; if (menuWin && !menuWin.isDestroyed()) { const b = menuWin.getBounds(); const d = screen.getDisplayNearestPoint({ x: b.x, y: b.y }).workArea; const nh = Math.min(h, d.height); menuWin.setBounds({ x: b.x, y: Math.min(b.y, d.y + d.height - nh), width: MENU_W, height: nh }); } });
function catalogPayload(id) { return { ...catalog, sdAnimations: (id && sdAnimsOf.get(id)) || catalog.sdAnimations || [], standing: STANDING, assetRoot: ASSET_ROOT, dataRoot: DATA_ROOT, hasAssets: hasAssets(ASSET_ROOT), settingsFile: SETTINGS_FILE, version: app.getVersion(), electron: process.versions.electron }; }

// ---- 개발·검사용 훅 — test-hooks.js (--selftalk-test 같은 실행 인자) ----
// 훅은 main 의 상태를 getter 로 본다. 제품 코드가 훅을 부르는 일은 없다
require("./test-hooks.js")({ get cursorPoll() { return { on: !!cursorT, ms: cursorMs }; }, get setFsHidden() { return (v) => { fsHidden = v; if (!v) startCursorPoll(CP.FAST); else stopCursorPoll(); if (mascotWin && !mascotWin.isDestroyed()) mascotWin.webContents.send("pause", v); }; }, get chatFor() { return CH.for; }, get mascotWin() { return mascotWin; }, get addCharacter() { return addCharacter; }, get bible() { return bible; }, get chatBusy() { return CH.busy; }, get chatProfile() { return chatProfile; }, get chatWin() { return CH.win; }, get geo() { return geo; }, get hitFor() { return hitFor; }, get hitShown() { return hitShown; }, get hitWin() { return hitWin; }, get instances() { return instances; }, get koOfHero() { return koOfHero; }, get menuFor() { return menuFor; }, get menuWin() { return menuWin; }, get openChat() { return openChat; }, get openMenu() { return openMenu; }, get relations() { return relations; }, get removeCharacter() { return removeCharacter; }, get saySelfTalk() { return saySelfTalk; }, get screenRect() { return screenRect; }, get screenTalk() { return screenTalk; }, get selfTalk() { return selfTalk; }, get selfTalkSaid() { return selfTalkSaid; }, get settings() { return settings; }, get talkData() { return talkData; }, get talkStyle() { return talkStyle; }, get theaters() { return theaters; }, get updateHitTarget() { return updateHitTarget; }, get updateSettings() { return updateSettings; }, get viewFor() { return viewFor; }, get vsamples() { return vsamples; }, get captureScreenFor() { return captureScreenFor; }, set captureScreenFor(v) { captureScreenFor = v; }, get setup() { return setup; }, get tray() { return tray; }, get openSettings() { return openSettings; }, get settingsWin() { return settingsWin; }, get hasAssets() { return hasAssets; }, get assetRoot() { return ASSET_ROOT; }, get flushSettings() { return flushSettings; } });

// ---- 트레이 ----
function buildTray() {
  const items = [
    ...settings.characters.map(c => ({ label: `${koSkin(c.skin)} (${c.mode === "sd" ? "스탠딩" : c.mode === "ingame" ? "전투 SD" : "미니미"})`, submenu: [
      { label: "설정...", click: () => openSettings("character", c.id) },
      { label: "다시 등장", click: () => sendMascot(c.id, "respawn") },
      { label: "보내기", enabled: settings.characters.length > 1, click: () => removeCharacter(c.id) },
    ] })),
    { label: "사도 추가", click: () => addCharacter() },
    { type: "separator" },
    { label: news && news.unread ? `새 소식 ${news.unread}개 보기` : "새 소식 (없음)", enabled: !!(news && news.items.length), click: () => { ipcMain.emit("news:show"); } },
    { label: "지금 소식 확인", click: async () => { if (news) { const r = await news.check(true); if (!r.added.length) console.log("news: 새 소식 없음", r.errors); } } },
    { type: "separator" },
    { label: "AI 대화 (Ctrl+Shift+Space)", click: () => openChat(settings.characters[0].id) },
    ...(UP.info ? [{ label: UP.state.phase === "downloading" ? `새 버전 ${UP.info.tag} 받는 중… ${pct(UP.state)}` : UP.state.phase === "ready" ? `새 버전 ${UP.info.tag} 설치하기` : `새 버전 ${UP.info.tag} 받기`, click: () => startUpdate() }] : []),
    ...(UP.state.phase === "downloading" ? [{ label: "받기 취소", click: () => UP.cancel() }] : []),
    { label: "설정...", click: () => openSettings() },
    { label: hasAssets(ASSET_ROOT) ? "게임 데이터 다시 가져오기..." : "게임 데이터 가져오기...", click: () => openSetup() },
    { label: "소리 끄기", type: "checkbox", checked: settings.global.sound.muted, click: (m) => updateSettings({ sound: { muted: m.checked } }) },
    { type: "separator" },
    { label: "종료", click: () => app.quit() },
  ];
  if (tray) { tray.setContextMenu(Menu.buildFromTemplate(items)); tray.setToolTip(`사도 데스크 — ${settings.characters.map(c => koSkin(c.skin)).join(", ")}`); return; }
  const icon = nativeImage.createFromPath(path.join(__dirname, "renderer", "tray.png"));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 }));
  tray.setToolTip(`사도 데스크 — ${settings.characters.map(c => koSkin(c.skin)).join(", ")}`);
  tray.setContextMenu(Menu.buildFromTemplate(items));
  tray.on("click", () => hasAssets(ASSET_ROOT) ? openSettings() : openSetup()); // 에셋이 없으면 설정보다 가져오기 창이 먼저
}

if (!app.requestSingleInstanceLock()) { app.quit(); } else app.on("second-instance", () => { if (!hasAssets(ASSET_ROOT)) { openSetup(); return; } if (settingsWin && !settingsWin.isDestroyed()) settingsWin.show(); else openSettings(); });
// ---- 업데이트 확인 — updater.js ----
const UP = require("./updater.js")({
  refreshTray: () => { if (tray) buildTray(); }, startUpdate: () => startUpdate(),
  // 설치기를 띄우지도 못한 경우 — 우리는 살아 있으니 여기서 말해 준다 (설치 뒤 실패는 --update-failed 로 새 판이 말한다)
  onInstallError: (msg) => { const { dialog } = require("electron"); dialog.showMessageBox({ type: "warning", title: "사도 데스크 업데이트", message: "설치를 시작하지 못했어요.", detail: `${msg}

받아 둔 설치 파일은 그대로 있습니다. 잠시 뒤 다시 시도하시거나, 파일을 직접 실행해 보세요.`, buttons: ["설치 파일 위치 열기", "닫기"], defaultId: 1, cancelId: 1 }).then((a) => { if (a.response === 0 && UP.state.file) shell.showItemInFolder(UP.state.file); }); },
});
const checkUpdate = UP.checkUpdate;
let mascotStarted = false;
function startMascot() {
  if (mascotStarted) { if (mascotWin && !mascotWin.isDestroyed()) { mascotLoaded = false; mascotWin.reload(); } return; } // 재추출 뒤: 창 다시 로드 (did-finish-load에서 config 재전송)
  mascotStarted = true;
  createMascotWindow(); createHitWindow();
  for (const c of settings.characters) createInstance(c.id);
  initNews();
  startFullscreenWatch();
  // 단축키: 커서에 가장 가까운 캐릭터에게 말 걸기 (여러 명일 때). 이미 열려 있고 포커스면 닫기
  const nearestChar = () => { const p = screen.getCursorScreenPoint(); let best = settings.characters[0].id, bd = Infinity; for (const [id, inst] of instances) { const r = inst.rect; if (!r || !geo) continue; const cx = geo.x + r.x + r.w / 2, cy = geo.y + r.y + r.h / 2, d = Math.hypot(cx - p.x, cy - p.y); if (d < bd) { bd = d; best = id; } } return best; };
  try { globalShortcut.register("CommandOrControl+Shift+Space", () => { const w = CH.win; if (w && !w.isDestroyed() && w.isVisible() && w.isFocused()) closeChat(); else openChat(nearestChar()); }); } catch (e) { console.warn("단축키 등록 실패", e.message); }
}
// ---- 전체화면 위에서는 숨는다 ----
// 마스코트 창은 최상위(screen-saver) 라 전체화면 유튜브·게임 위에도 그대로 뜬다. 대상 사용자가 게이머인데
// 게임 중에 방해받는다 — "재밌다"가 아니라 "꺼야겟다"로 가는 종류다. 앞 창이 모니터를 통째로 덮으면
// 사도·히트 창·말풍선을 내리고, 벗어나면 되돌린다. 숨은 동안엔 먼저 말도 걸지 않는다
let fsWatch = null, fsNow = false, fsHidden = false;
const hideFsOn = () => (settings.global.display || {}).hideFullscreen !== false;
function startFullscreenWatch() {
  if (fsWatch) return;
  fsWatch = createFullscreenWatcher({ screen, ownPid: process.pid, log: (...a) => console.log(...a), onChange: (fs, info) => {
    fsNow = fs; if (fs) console.log("전체화면 감지:", info.cls, "pid", info.pid);
    applyFullscreenHide();
  } });
  fsWatch.start();
}
function applyFullscreenHide() {
  const want = fsNow && hideFsOn();
  if (want === fsHidden) return;
  fsHidden = want;
  if (!want) startCursorPoll(CP.FAST); else stopCursorPoll();   // 숨는 동안엔 커서를 묻지 않는다
  const wins = [mascotWin, hitWin, bubbleWin].filter(w => w && !w.isDestroyed());
  if (mascotWin && !mascotWin.isDestroyed()) mascotWin.webContents.send("pause", want); // 창을 숨겨도 렌더 루프는 돈다(backgroundThrottling:false) — 멈추라고 알려 준다
  if (want) { for (const w of wins) w.hide(); }
  else { for (const w of wins) { if (w === hitWin) continue; w.showInactive(); w.setAlwaysOnTop(true, "screen-saver"); } } // 히트 창은 커서 폴링이 필요할 때 스스로 뜬다
}
// ---- 맨 위로 올리기 ----
// 최상위(screen-saver) 창끼리는 나중에 최상위를 잡은 쪽이 위다. 게임·오버레이가 켜지면 사도가 그 밑에 깔린다.
// 이 옵션을 켜면 2초마다 사도·말풍선·히트 창을 다시 맨 위로 올린다. 포커스는 건드리지 않는다.
// 전체화면 숨김으로 내려가 있을 때는 하지 않는다 — 숨긴 창을 올려 봐야 소용없고, 숨김의 뜻과도 어긋난다
setInterval(() => {
  if (!(settings.global.display || {}).keepOnTop || fsHidden) return;
  for (const w of [mascotWin, bubbleWin, hitShown ? hitWin : null]) {
    if (!w || w.isDestroyed() || !w.isVisible()) continue;
    try { w.setAlwaysOnTop(true, "screen-saver"); w.moveTop(); } catch {}
  }
}, 2000);
// 창은 전부 loadFile 로 우리 파일만 띄운다. 그래도 렌더러에서 한 줄이 새 나가면(원격 제목이 그대로 태그가 되는 식)
// preload 를 그대로 물려받은 채 남의 페이지로 넘어갈 수 있다. 나갈 길을 아예 막고 바깥 주소는 기본 브라우저로 보낸다.
app.on("web-contents-created", (_e, wc) => {
  wc.on("will-navigate", (e, url) => {
    if (url.startsWith("file://")) return;
    e.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  wc.on("will-attach-webview", (e) => e.preventDefault());
});
app.whenReady().then(() => {
  geo = geometry();
  if (hasAssets(ASSET_ROOT)) { buildTray(); startMascot(); }
  else { console.log("에셋 없음 → 가져오기 창을 첫 화면으로"); openSetup(); buildTray(); }
  applyAutoStart();
  setTimeout(() => checkUpdate(), 8000); setInterval(() => checkUpdate(), 6 * 3600 * 1000); // 깃허브 최신 릴리스 확인 (시작 8초 뒤, 이후 6시간마다)
  if (argHas("--settings")) setTimeout(() => openSettings(), +argVal("--settings-delay", 0) || 0);
  for (const ev of ["display-added", "display-removed", "display-metrics-changed"]) screen.on(ev, () => setTimeout(applyGeometry, 300));
});
app.on("window-all-closed", () => { /* 트레이 상주 */ });
app.on("before-quit", () => { if (saveTimer) flushSettings(); /* 150ms 디바운스 안에 끄면 마지막 변경이 파일에 안 남았다 */ setup.stopExtract(); if (pullProc) { try { pullProc.kill(); } catch {} } if (news) news.stop(); if (fsWatch) fsWatch.stop(); closeBubble(); for (const id of [...instances.keys()]) destroyInstance(id); if (hitWin && !hitWin.isDestroyed()) hitWin.destroy(); if (mascotWin && !mascotWin.isDestroyed()) mascotWin.destroy(); });
