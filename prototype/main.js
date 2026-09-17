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
const argHas = (f) => process.argv.includes(f);
const argVal = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
let NAMES = { heroes: {}, skins: {} };
try { NAMES = JSON.parse(fs.readFileSync(path.join(DATA_ROOT, "names-ko.json"), "utf8")); } catch {}
function koSkin(skin) { const m = skin.replace(/^Mini_/, "").match(/^(.*?)(?:Skin(\d+))?$/); const base = NAMES.heroes[m[1]] || m[1]; return m[2] ? `${base} · ${NAMES.skins[m[1]]?.[m[2]] || "스킨 " + m[2]}` : base; }

// ---- 설정 ----
const CHAR_DEFAULTS = {
  skin: "Mini_Crepe",
  mode: "sd",          // "minimi"(스틱 미니미) | "sd"(스탠딩; 이동은 미니미) | "ingame"(전투·마이홈 SD: Idle/Move/Spawn/Victory/Attack…)
  mood: "",            // 표정 고정: "" | smile | anger | sad | happy | eat | sulky | surprise (SD 전용, 게임 스토리 표정 8종)
  scale: 0.5, opacity: 1,
  monitor: 0,          // 이 사도를 가둘 모니터 id. 0 = 가두지 않음(모니터 전체를 오간다). 없어진 모니터면 자동으로 0 취급
  behavior: {
    hop: true, jump: true, idleActs: true,
    hopChance: 45, jumpChance: 10, hopSpeed: 100, hopRange: 350,
    idleMin: 4, idleMax: 10, actGap: 5.0,
  },
};
const GLOBAL_DEFAULTS = {
  sound: {
    muted: false, master: 0.6, voice: 0.4, sfx: 0.3, // 기본 볼륨 (v0.10.9: 0.8/0.5/0.5 → 0.6/0.4/0.3)
    clickVoice: true, landVoice: true, landSfx: true, spawnVoice: true, greetOnSkin: true,
    motionVoice: true, motionVoiceChance: 30, motionVoiceCooldown: 15, emoteVoiceChance: 85,
  },
  display: { debug: false, multiMonitor: true, overTaskbar: true, autoStart: false, fps: "auto", guideShown: false, hideFullscreen: true }, // fps: "auto"(손댈 때만 60) | 30 | 60
  assets: { root: "" },
  ai: Ai.DEFAULTS, // AI 대화 (ai.js) // 비어 있으면 userData/assets
  // 대본으로 하는 말 (혼잣말 self-talk.json). AI 와 무관하고 돈이 들지 않아
  // 간격을 짧게 둔다 — AI 로 먼저 말 걸던 시절의 40분과 달리 8분.
  // 사도끼리 잡담(duo-talk.json 대본 + AI)은 뺐다 — 각자 딴소리로 들리고 대본 518KB 만큼 무거워졌다. 옛 파일의 talk.duo 는 읽어도 아무도 안 본다
  talk: { selfTalk: true, minMin: 8, bubbleSec: 4 },
  // 새 소식 알림: 공식 유튜브 + 라운지 게시판(공지사항·업데이트·개발자 노트 기본). 크레페 말투 말풍선
  news: { enabled: true, youtube: true, notice: true, update: true, devnote: true, event: false, pv: false, coupon: false, intervalMin: 10, ttlSec: 40, sound: true, toast: false, talkCrepe: false },
};
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
function deepMerge(base, patch) {
  const out = { ...base };
  // 값이 undefined 인 키는 건너뛴다. 없으면 {display: undefined} 같은 패치가 기본값을 지워
  // 첫 실행(설정 파일 없음)에서 settings.global.display 가 사라지고 geometry() 가 죽는다.
  // null·NaN 도 마찬가지 — {sound:null} 이 들어오면 다음 시작에서 buildTray 가 죽어 트레이도 사도도 안 뜬다.
  // 기본값이 객체인 자리엔 객체만 받는다 (설정 파일이 손으로 고쳐져 "display": 1 같은 게 와도 기본을 지킨다)
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === undefined || v === null || (typeof v === "number" && !Number.isFinite(v))) continue;
    if (isObj(base[k])) { if (isObj(v)) out[k] = deepMerge(base[k], v); continue; }
    out[k] = v;
  }
  return out;
}
// ---- 설정 패치 검사 ----
// 렌더러 패치는 예전엔 id·version·characters·ai.keys 만 떼고 그대로 파일에 갔다. talk 이 GLOBAL_KEYS 에 없어 캐릭터 밑으로
// 저장되고 아무도 읽지 않던 다섯 판(v0.12.8~v0.13.2)은 "모르는 키" 경고 한 줄만 있었어도 첫날에 잡혔다.
// 수치는 범위로 잘라 넣는다(거부하면 손으로 고친 파일이 통째로 기본값이 된다) · 열거형·문자열은 틀리면 버린다.
// 설정 창(settings.html data-s)의 슬라이더 범위보다 넉넉하게 — 파일을 손으로 고치는 사람이 있다
const GLOBAL_KEYS = new Set(["sound", "display", "news", "assets", "ai", "talk"]);  // talk = 대본으로 하는 말(혼잣말). 렌더러(settings.js)와 같은 목록이어야 한다
const CHAR_KEYS = new Set(Object.keys(CHAR_DEFAULTS));
const RANGES = { // "점.경로": [최소, 최대]
  scale: [0.1, 3], opacity: [0.05, 1],
  "behavior.hopChance": [0, 100], "behavior.jumpChance": [0, 100], "behavior.hopSpeed": [10, 300], "behavior.hopRange": [50, 2000],
  "behavior.idleMin": [0.5, 60], "behavior.idleMax": [1, 120], "behavior.actGap": [0, 60],
  "sound.master": [0, 1], "sound.voice": [0, 1], "sound.sfx": [0, 1],
  "sound.motionVoiceChance": [0, 100], "sound.emoteVoiceChance": [0, 100], "sound.motionVoiceCooldown": [0, 600],
  "talk.minMin": [1, 240], "talk.bubbleSec": [1, 60],
  "news.intervalMin": [1, 1440], "news.ttlSec": [3, 300],
  "ai.proactiveMin": [1, 600], "ai.screenProactive": [0, 100], "ai.chatAutoCloseSec": [0, 3600], "ai.maxTurns": [1, 100],
  "ai.ollama.temperature": [0, 2], "ai.ollama.numPredict": [16, 4096], // ai.js chatOllama 의 options — 기본값엔 없고 파일로만 넣는 값
};
const ENUMS = {
  mode: ["minimi", "sd", "ingame"], mood: ["", "smile", "anger", "sad", "happy", "eat", "sulky", "surprise"],
  "display.fps": ["auto", "30", "60", "vsync"], // vsync = 모니터 주사율대로(rAF 마다) // 숫자 30·60 도 받아 문자열로 (렌더러 select 는 문자열, 손으로 고친 파일은 숫자)
  "ai.provider": ["auto", "ollama", "gemini", "anthropic", "openai"], // ai.js chat() 이 아는 것
};
const STRINGS = { skin: [/^[A-Za-z0-9_]+$/, 64], "assets.root": [/^[\s\S]*$/, 1024] };
// 값 하나. undefined 를 돌려주면 버린다(deepMerge 가 undefined 를 건너뛴다). fixed 에 고친 내역이 쌓인다
function checkValue(key, v, fixed) {
  // 손으로 고친 파일의 "0.7" 같은 숫자 문자열은 받아 준다 (ai.js 가 + 로 받던 값이다)
  if (RANGES[key]) { if (typeof v === "string" && v.trim() !== "" && Number.isFinite(+v)) v = +v; if (typeof v !== "number" || !Number.isFinite(v)) return undefined; const c = Math.min(RANGES[key][1], Math.max(RANGES[key][0], v)); if (c !== v) fixed.push(`${key} ${v}→${c}`); return c; }
  if (ENUMS[key]) { const s = String(v); return ENUMS[key].includes(s) ? s : undefined; }
  if (STRINGS[key]) return typeof v === "string" && v.length <= STRINGS[key][1] && STRINGS[key][0].test(v) ? v : undefined;
  return v;
}
function sanitizeTree(obj, prefix, fixed) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix + k, leaf = RANGES[key] || ENUMS[key] || STRINGS[key];
    const r = leaf ? checkValue(key, v, fixed) : isObj(v) ? sanitizeTree(v, key + ".", fixed) : v; // {scale:{}} 같은 것은 leaf 검사에서 걸러진다
    if (r !== undefined) out[k] = r;
  }
  return out;
}
// forChar: 캐릭터 키(skin·mode·scale…)도 받는가(설정 창 패치는 둘이 섞여 온다). "only" 면 캐릭터 키만(파일의 characters[]).
// 대상 캐릭터가 없는 패치에 캐릭터 키가 왔다면 그것도 잘못된 것이라 경고한다
function sanitizePatch(patch, { forChar = true, fixed = null } = {}) {
  const out = {}, log = fixed || [];
  for (const [k, v] of Object.entries(patch || {})) {
    const known = forChar === "only" ? CHAR_KEYS.has(k) : GLOBAL_KEYS.has(k) || (forChar && CHAR_KEYS.has(k));
    if (!known) { if (fixed) fixed.push(`모르는 키 ${k} 버림`); else console.warn("settings: 모르는 키", k); continue; }
    const leaf = RANGES[k] || ENUMS[k] || STRINGS[k];
    const r = leaf ? checkValue(k, v, log) : isObj(v) ? sanitizeTree(v, k + ".", log) : v;
    if (r !== undefined) out[k] = r;
  }
  return out;
}
// 파일에서 읽은 설정 전체에 같은 검사 — 손으로 고친 파일·옛 판 파일이 범위 밖 값을 들고 있어도 여기서 한 번에 바로잡는다
function clampSettings(s) {
  const fixed = [];
  s.global = sanitizePatch(s.global, { forChar: false, fixed });
  s.characters = s.characters.map(({ id, ...c }) => ({ id, ...sanitizePatch(c, { forChar: "only", fixed }) }));
  for (const c of s.characters) if (c.monitor !== undefined) c.monitor = +c.monitor || 0;   // 모니터 id 는 숫자 — 손으로 고친 파일이 문자열을 들고 있어도 맞춘다
  if (fixed.length) { console.log(`settings: 읽으면서 고침 — ${fixed.join(", ")}`); process.nextTick(saveSettings); } // 고친 값을 파일에도 남긴다. nextTick — 지금은 settings·saveTimer 가 아직 선언 전이다
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
  const prevDisp = JSON.stringify(settings.global.display);
  const g = {}, c = {};
  for (const [k, v] of Object.entries(patch || {})) (GLOBAL_KEYS.has(k) ? g : c)[k] = v;
  if (Object.keys(g).length) settings.global = deepMerge(settings.global, g);
  if (Object.keys(c).length && id === "*") {
    // 통합 편집 — 스킨은 사도의 정체라 함께 바꾸지 않는다(모두 같은 모습이 되어 버린다)
    const { skin, ...rest } = c;
    if (Object.keys(rest).length) for (const ch of settings.characters) Object.assign(ch, deepMerge(ch, rest));
  } else if (Object.keys(c).length && id) { const ch = charOf(id); if (ch) Object.assign(ch, deepMerge(ch, c)); }
  saveSettings();
  if (JSON.stringify(settings.global.display) !== prevDisp) { applyGeometry(); applyAutoStart(); applyFullscreenHide(); }
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
  const use = disp.multiMonitor ? all : [prim];
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
  if (chatFor === id) closeChat();
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
    const tabs = ["character", "behavior", "sound", "display", "news", "ai", "about"]; let i = 0;
    const shoot = () => { if (!settingsWin || i >= tabs.length) return; settingsWin.webContents.send("tab", tabs[i]); setTimeout(async () => { const img = await settingsWin.webContents.capturePage(); fs.mkdirSync(path.join(__dirname, "out"), { recursive: true }); fs.writeFileSync(path.join(__dirname, "out", `settings-${tabs[i]}.png`), img.toPNG()); console.log("SHOT", tabs[i]); i++; shoot(); }, 700); };
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

// ---- AI 대화 창 (ai.js) ----
let chatWin = null, chatFor = null, chatBounds = null, chatAnchor = null, chatBusy = false, chatAbort = null, lastChatAt = 0;
const CHAT_W = 332;
function chatPlace(id) {
  if (!chatWin || chatWin.isDestroyed() || !geo) return;
  const inst = instances.get(id); const r = inst && inst.rect;
  if (!chatAnchor || chatAnchor.id !== id) { if (!r) return; chatAnchor = { id, cx: Math.round(geo.x + r.x + r.w / 2), top: Math.round(geo.y + r.y) }; }
  const h = chatBounds ? chatBounds.height : 220;
  const sx = chatAnchor.cx - Math.round(CHAT_W / 2), sy = chatAnchor.top - h + 6;
  const d = screen.getDisplayNearestPoint({ x: sx + CHAT_W / 2, y: sy + h / 2 }).workArea;
  const b = { x: Math.min(Math.max(sx, d.x), d.x + d.width - CHAT_W), y: Math.max(d.y, sy), width: CHAT_W, height: h };
  if (!chatBounds || b.x !== chatBounds.x || b.y !== chatBounds.y || b.height !== chatBounds.height) { chatWin.setBounds(b); chatBounds = b; }
}
let talkStyle = null; try { talkStyle = JSON.parse(fs.readFileSync(path.join(DATA_ROOT, "talk-style.json"), "utf8")); } catch {} // 보이스 STT 대본 분석(어미 비율·표본) — 없어도 됨
let relations = null; try { relations = JSON.parse(fs.readFileSync(path.join(DATA_ROOT, "relations.json"), "utf8")); } catch {} // 사도끼리 부르는 말·함께 등장 (tools/build-relations.py)
let theaters = []; try { theaters = JSON.parse(fs.readFileSync(path.join(DATA_ROOT, "theaters.json"), "utf8")).items || []; } catch {} // 테마극장 출연·줄거리 (나무위키)
let bible = {}; try { bible = JSON.parse(fs.readFileSync(path.join(DATA_ROOT, "bible.json"), "utf8")); } catch {} // 인물 사전: 나무위키 사도 문서 139편 요약(누구인지·성격·관계·행적·말버릇)
let vsamples = {}; try { vsamples = JSON.parse(fs.readFileSync(path.join(DATA_ROOT, "voice-samples.json"), "utf8")); } catch {} // 말투 예시: 게임 대사가 아니라, 잰 말투에 맞춰 우리가 지은 문장
let selfTalk = {}, skinTalk = {}; try { const _st = JSON.parse(fs.readFileSync(path.join(DATA_ROOT, "self-talk.json"), "utf8")); selfTalk = _st.heroes || {}; skinTalk = _st.skins || {}; console.log(`혼잣말 대본: ${Object.keys(selfTalk).length}명 ${Object.values(selfTalk).reduce((a, l) => a + l.length, 0)}줄` + (Object.keys(skinTalk).length ? ` · 코스튬 ${Object.keys(skinTalk).length}벌 ${Object.values(skinTalk).reduce((a, l) => a + l.length, 0)}줄` : "")); } catch (e) { console.warn("self-talk.json 없음 — 혼잣말은 대본 대신 AI 로 돈다", e.message); }
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
async function chatInitPayload(id) {
  const st = await Ai.status(settings.global.ai);
  const prof = chatProfile(id);
  const prov = st.resolved ? `${st.resolved}${st.resolved === "ollama" ? " · " + Ai.merge(settings.global.ai).ollama.model : ""}` : "";
  return { who: prof ? prof.ko : "사도", prov, ready: !!st.resolved, history: settings.global.ai.memory !== false ? Ai.loadHistory(app.getPath("userData"), id) : [] };
}
function openChat(id, opt = {}) {
  id = id || settings.characters[0].id; chatFor = id; chatBounds = null; chatAnchor = null;
  const send = async () => { if (chatWin && !chatWin.isDestroyed()) { chatWin.webContents.send("chat:init", await chatInitPayload(id)); chatPlace(id); if (opt.quiet) chatWin.showInactive(); else { chatWin.show(); chatWin.focus(); } } };
  if (chatWin && !chatWin.isDestroyed()) { send(); return; }
  chatWin = new BrowserWindow({
    x: 0, y: 0, width: CHAT_W, height: 220, show: false, transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true,
    resizable: false, movable: true, hasShadow: false, backgroundColor: "#00000000",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: false },
  });
  chatWin.setAlwaysOnTop(true, "screen-saver");
  chatWin.loadFile(path.join(__dirname, "renderer", "chat.html"));
  chatWin.webContents.on("console-message", (ev) => console.log(`[chat:${ev.level}] ${ev.message}`));
  const w = chatWin; trackBounds(w);
  // 창을 닫으면 진행 중인 턴은 끊는다. chatBusy 는 그 턴의 finally 가 스스로 내린다 (여기서 내리면 다음 턴과 엇갈린다)
  w.on("closed", () => { if (chatWin !== w) return; chatWin = null; chatFor = null; chatBounds = null; chatAnchor = null; if (chatAbort) chatAbort.abort(); });
  w.webContents.on("render-process-gone", (_e, d) => { console.log("chat renderer gone:", d.reason); if (!w.isDestroyed()) w.close(); }); // 다음 '말 걸기'가 새 창을 만든다
  w.webContents.once("did-finish-load", send);
}
function closeChat() { if (chatWin && !chatWin.isDestroyed()) chatWin.close(); }
const chatSend = (ch, payload) => { if (chatWin && !chatWin.isDestroyed()) chatWin.webContents.send(ch, payload); };
// 한 턴 실행: history + user → 답변 스트리밍 → 기록 저장 → 표정/보이스
async function chatTurn(id, userText, opts = {}) {
  if (chatBusy) { if (userText) chatSend("chat:done", { error: "아직 말하는 중이에요. 잠깐 뒤에 다시 보내 주세요." }); return null; }
  chatBusy = true; lastChatAt = Date.now();
  const ud = app.getPath("userData"), ai = settings.global.ai, prof = chatProfile(id);
  let hist = ai.memory !== false ? Ai.loadHistory(ud, id) : [];
  // 먼저 말 걸 때는 참고할 기록을 최근 두 마디로 줄인다. 제 지난 답이 길게 쌓여 있으면 모델이 그 길이를
  // 따라가 회차마다 답이 길어졌다(실측 1회 77자 → 3회 141자, 120자 초과 4건 → 100건)
  if (!userText && !opts.image) hist = hist.slice(-2);
  // 사용자가 보낸 말이 없으면(먼저 말 걸기) 침묵을 알리는 한 줄을 붙인다. 안 붙이면 기록 끝이 assistant 라
  // normalizeMessages 가 "(계속)" 을 붙이고, 모델은 먼저 말을 거는 대신 자기 혼잣말에 이어 대답한다
  const msgs = [...hist.map(m => ({ role: m.role, text: m.text })),
    (userText || opts.image)
      ? { role: "user", text: userText || "(사용자의 화면을 본다)", ...(opts.image ? { image: opts.image } : {}) }
      : { role: "user", text: "(사용자가 조용히 있다)" }];
  // 제공자가 답을 시작만 하고 멎으면(스트림이 열린 채 조용) chatBusy 가 영영 남아 대화·혼잣말이 전부 막혔다. 90초면 끊는다
  const ctl = chatAbort = new AbortController(); let timedOut = false, partial = "";
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, 90_000);
  sendMascot(id, "announce", { hold: 20000, sound: false }); // 대답하는 동안 제자리에
  try {
    const now = new Date();
    const extra = `지금은 ${now.getMonth() + 1}월 ${now.getDate()}일 ${["일", "월", "화", "수", "목", "금", "토"][now.getDay()]}요일 ${now.getHours()}시 ${now.getMinutes()}분.` + (opts.extra ? "\n" + opts.extra : "");
    const r = await Ai.chat(ai, prof, msgs, (d) => { partial += d; chatSend("chat:token", { delta: d }); }, { extra, signal: ctl.signal });
    const saved = [...hist, ...(userText ? [{ role: "user", text: userText, t: Date.now() }] : []), { role: "assistant", text: r.text, t: Date.now() }];
    if (ai.memory !== false) Ai.saveHistory(ud, id, saved, ai.maxTurns || 12);
    if (opts.say) chatSend("chat:say", { text: r.text }); else chatSend("chat:done", { text: r.text, emotion: r.emotion });
    sendMascot(id, "emote", { mood: r.emotion, role: "speak", pose: Math.min(15000, 3000 + r.text.length * 90), hold: 15000 });
    console.log(`chat[${id}] ${r.provider}/${r.model} → ${r.text.slice(0, 60)} [${r.raw}]`);
    return r;
  } catch (e) {
    const aborted = ctl.signal.aborted || e.name === "AbortError" || e.name === "TimeoutError"; // 창 닫기(사용자) 또는 90초 시한. Gemini 재시도 대기 중이면 "취소됨" Error 로 온다
    const msg = aborted ? (timedOut ? "AI 가 한참 답을 하지 않아 그만두었어요." : "") : e.message === "no-provider" ? "AI 제공자가 없어요. 'AI 설정…'에서 Ollama나 API 키를 넣어 주세요." : `오류: ${String(e.message || e).slice(0, 200)}`;
    // 끊긴 턴에도 chat:done 은 보낸다 — 렌더러는 이걸 받아야 입력칸을 다시 연다. 창을 닫아 끊은 경우엔 받을 창이 없어 그냥 사라진다
    chatSend("chat:done", msg ? { error: msg } : { text: partial });
    console.log("chat error:", timedOut ? "timeout(90s)" : e.message);
    return null;
  } finally { clearTimeout(timer); if (chatAbort === ctl) { chatBusy = false; chatAbort = null; } lastChatAt = Date.now(); } // 이 턴의 것일 때만 내린다
}
// ---- 화면 보기: 캐릭터가 서 있는 모니터를 캡처해(축소 JPEG) AI에 첨부. 설정 ai.screen 이 켜져 있을 때만 ----
async function captureScreenFor(id) {
  const inst = instances.get(id); const r = inst && inst.rect;
  const pt = r && geo ? { x: Math.round(geo.x + r.x + r.w / 2), y: Math.round(geo.y + r.y + r.h / 2) } : screen.getCursorScreenPoint();
  const disp = screen.getDisplayNearestPoint(pt);
  const maxW = 1280, scale = Math.min(1, maxW / disp.size.width);
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: Math.round(disp.size.width * scale), height: Math.round(disp.size.height * scale) } });
  const src = sources.find(s => String(s.display_id) === String(disp.id)) || sources[0];
  if (!src || src.thumbnail.isEmpty()) throw new Error("화면을 캡처하지 못했어요");
  return { mime: "image/jpeg", data: src.thumbnail.toJPEG(60).toString("base64"), display: disp.id };
}
const screenAllowed = () => !!(settings.global.ai && settings.global.ai.screen);
// 혼자 화면 보고 한마디 (대화창에 표시). userText 있으면 그 말에 화면을 붙여 답함
async function screenTalk(id, userText) {
  const chatOpen = chatWin && !chatWin.isDestroyed() && chatFor === id;
  if (!screenAllowed()) { if (!chatOpen) openChat(id); setTimeout(() => chatSend("chat:done", { error: "화면 보기가 꺼져 있어요. 설정 → AI 대화 → '화면 보기'를 켜 주세요 (스크린샷이 선택한 AI 제공자에게 전송됩니다)." }), chatOpen ? 0 : 1200); return; }
  if (!chatOpen) openChat(id, { quiet: !userText });
  sendMascot(id, "emote", { mood: "", role: "listen", pose: 4000, hold: 12000 }); // 화면을 살피는 포즈
  let image; try { image = await captureScreenFor(id); } catch (e) { chatSend("chat:done", { error: e.message }); return; }
  await chatTurn(id, userText || "", { image, say: !userText, extra: "사용자의 화면 스크린샷을 첨부했다. 지금 사용자가 무엇을 하고 있는지 알아보고, 네 성격대로 한두 문장으로 반응하라(감상·놀림·응원·질문 등)." });
}
// 말풍선이 떠 있는 시간: 기본 초 + 글자당 0.1초
const bubbleMs = (t) => Math.round((Math.max(2, +((settings.global.talk || {}).bubbleSec) || 4) * 1000) + Math.min(80, t.length) * 100);
// ---- 혼잣말 (대본) ----
// data/self-talk.json 4,498줄(그중 2,760줄은 상황 꼬리표가 달렸다). LLM 을 부르지 않는다 — AI 를 켜지 않은 사람도 사도가 중얼거린다.
// 줄마다 {t: 문장, m: 감정, a: 동작 접두어} 라 말풍선과 모션을 그대로 태울 수 있다.
const selfTalkSaid = new Map(); // 사도키 → 최근에 말한 줄 (되풀이 방지)
// 혼잣말의 상황 꼬리표(w). 아침이든 밤이든 방금 던져졌든 같은 풀에서 뽑던 것을, 그 때에 맞는 줄이 먼저 나오게 한다.
// 꼬리표 없는 줄은 언제나 후보. 꼬리표가 지금 상황과 맞으면 세 배 무게 — 그래야 맞는 때에 실제로 나온다
const SELF_TAGS = ["morning", "day", "evening", "night", "late", "weekend", "thrown", "petted", "poked", "idle"];
const lastEvent = new Map(); // 인스턴스 id → { kind, at } 렌더러가 알려 준 마지막 교감 (던져짐·쓰다듬음·꿀밤)
let lastTouchAt = Date.now(); // 마지막으로 손이 닿은 시각 — 30분 넘으면 "오래 가만히 둠"
ipcMain.on("mascot:event", (e, id, kind) => { const me = typeof id === "string" ? id : instanceOf(e.sender); if (!me || typeof kind !== "string") return; lastEvent.set(me, { kind, at: Date.now() }); lastTouchAt = Date.now(); });
function selfCtx(id) {
  const now = new Date(), h = now.getHours(), tags = new Set();
  tags.add(h < 6 ? "late" : h < 11 ? "morning" : h < 17 ? "day" : h < 21 ? "evening" : "night");
  if (now.getDay() === 0 || now.getDay() === 6) tags.add("weekend");
  const ev = lastEvent.get(id); if (ev && Date.now() - ev.at < 90000) tags.add(ev.kind); // 던져진 지 90초 안이면 "아까 던진 거"
  if (Date.now() - lastTouchAt > 30 * 60000) tags.add("idle");
  return tags;
}
// key = 사도 키, skinKey = 입은 코스튬 키(없으면 ""). 코스튬 줄은 상황 꼬리표가 없는 평상시 줄이라
// 기본 줄과 같은 못에 넣되 가중치를 줘서 코스튬을 입은 티가 나게 한다
function pickSelfTalk(key, id, skinKey) {
  const mine = selfTalk[key] || [], skin = (skinKey && skinTalk[skinKey]) || [];
  const all = skin.length ? [...mine, ...skin] : mine;
  if (!all.length) return null;
  const ctx = id ? selfCtx(id) : new Set();
  const fits = all.filter(x => !x.w || ctx.has(x.w));   // 지금 상황에 안 맞는 꼬리표 줄은 뺀다
  const said = selfTalkSaid.get(key) || [];
  let fresh = fits.filter(x => !said.includes(x.t));
  if (!fresh.length) fresh = fits.length ? fits : all;      // 다 돌았으면 처음부터
  const isSkin = new Set(skin.map(x => x.t));
  const weighted = fresh.flatMap(x => x.w && ctx.has(x.w) ? [x, x, x] : isSkin.has(x.t) ? [x, x] : [x]);
  const line = weighted[Math.floor(Math.random() * weighted.length)];
  const keep = Math.max(3, Math.floor(all.length / 2)); // 절반은 다시 나오지 않게
  selfTalkSaid.set(key, [...(fresh.length ? said : []), line.t].slice(-keep));
  return line;
}
// 말풍선 + 모션. 대본이 없으면 false 를 돌려주니 부르는 쪽이 다른 수를 쓸 수 있다
function saySelfTalk(id, opts = {}) {
  const prof = chatProfile(id); if (!prof) return false;
  const line = pickSelfTalk(prof.key, id, prof.skinKey); if (!line) return false;
  const ttl = bubbleMs(line.t);
  const who = prof.skin ? `${prof.ko} · ${prof.skin}` : prof.ko;
  showBubble(id, { items: [], text: { head: "", body: line.t, tail: "", who }, ttl });
  sendMascot(id, "emote", { mood: line.m, act: line.a, role: "speak", pose: ttl, hold: ttl + 3000 });
  if (!opts.quiet) console.log(`혼잣말[${id}] ${prof.ko}: ${line.t} [${line.m || "기본"}/${line.a}]`);
  return true;
}
ipcMain.on("selftalk:say", (e, id) => { const me = id || instanceOf(e.sender); if (me) saySelfTalk(me); });
ipcMain.on("chat:send", (_e, text, withScreen) => { if (!chatFor || typeof text !== "string" || !text.trim()) return; if (withScreen) screenTalk(chatFor, text.trim().slice(0, 2000)); else chatTurn(chatFor, text.trim().slice(0, 2000)); });
ipcMain.on("chat:screen", (e, id) => screenTalk(id || instanceOf(e.sender) || settings.characters[0].id));
ipcMain.on("chat:close", () => closeChat());
ipcMain.on("chat:clear", () => { if (chatFor) Ai.clearHistory(app.getPath("userData"), chatFor); });
// 렌더러가 보낸 높이는 정수여야 한다 — NaN 이면 setBounds 가 메인에서 throw 한다 (레이아웃 전에 0/undefined 로 온 적이 있다)
const heightOf = (h, lo) => { h = Math.round(+h); return Number.isFinite(h) && h >= lo ? h : null; };
ipcMain.on("chat:resize", (_e, h) => { h = heightOf(h, 40); if (h === null) return; if (chatWin && !chatWin.isDestroyed()) { const d = screen.getDisplayNearestPoint(chatBounds ? { x: chatBounds.x, y: chatBounds.y } : screen.getCursorScreenPoint()).workArea; chatBounds = { ...(chatBounds || { x: 0, y: 0, width: CHAT_W }), height: Math.min(h, d.height) }; chatPlace(chatFor); } });
ipcMain.on("chat:open", (e, id) => openChat(id || instanceOf(e.sender) || settings.characters[0].id));
// 설정창용
ipcMain.handle("ai:status", () => Ai.status(settings.global.ai));
ipcMain.handle("ai:set-key", (_e, provider, key) => { if (!["gemini", "anthropic", "openai"].includes(provider)) return false; updateSettings({ ai: { keys: { [provider]: Ai.encKey(String(key || "").trim()) } } }); return true; });
ipcMain.handle("ai:test", async (_e, provider) => {
  const prof = chatProfile(settings.characters[0].id); let out = "";
  try { const r = await Ai.chat(settings.global.ai, prof, [{ role: "user", text: "안녕! 한 마디만 해 줘." }], (d) => { out += d; }, { provider: provider || undefined }); return { ok: true, text: r.text, emotion: r.raw, provider: r.provider, model: r.model }; }
  catch (e) { return { ok: false, error: e.message === "no-provider" ? "쓸 수 있는 제공자가 없어요" : String(e.message || e).slice(0, 300) }; }
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
  if (chatBusy || proactiveBusy || !mascotStarted || fsHidden) return;
  const gapMin = (Date.now() - Math.max(lastChatAt, app._startedAt || 0)) / 60000;
  if (gapMin < (T.minMin || 8) || Math.random() > 0.25) return;
  proactiveBusy = true;
  try {
  const id = settings.characters[Math.floor(Math.random() * settings.characters.length)].id; // 여러 명이면 아무나 한 명이
  // AI 를 쓰는 길은 제 간격(기본 40분)을 따로 지킨다 — 대본보다 훨씬 드물게
  const aiTurn = ai.proactive && gapMin >= (ai.proactiveMin || 40);
  // 화면을 보고 말 거는 것 — AI 필요. 설정에서 켠 만큼만, 제공자가 실제로 잡힐 때만
  if (aiTurn && screenAllowed() && Math.random() * 100 < (+ai.screenProactive || 0)) {
    const st = await Ai.status(ai);
    if (st.resolved) { lastChatAt = Date.now(); screenTalk(id, ""); return; }
  }
  // 혼잣말 — 대본. AI 를 켜지 않았어도 여기까지 온다
  if (T.selfTalk !== false && saySelfTalk(id)) { lastChatAt = Date.now(); return; }
  // 대본이 없는 사도만 AI 로 물러선다
  if (!aiTurn) return;
  const st2 = await Ai.status(ai); if (!st2.resolved) return;
  lastChatAt = Date.now();
  openChat(id, { quiet: true });
  setTimeout(async () => {
    await chatTurn(id, "", { say: true, extra: "사용자가 한동안 아무 말도 하지 않았다. 네가 먼저 한두 문장(60자 안팎)으로 짧게 말을 걸어라 — 안부, 시간대에 맞는 인사, 가벼운 질문이나 혼잣말 중 하나. 대답을 강요하지 말 것. 문장은 두 개까지." });
    const sec = +settings.global.ai.chatAutoCloseSec; if (!(sec > 0)) return;
    const opened = lastChatAt; // 사용자가 그 사이 입력하면(lastChatAt 갱신) 닫지 않음
    setTimeout(() => { if (chatWin && !chatWin.isDestroyed() && !chatWin.isFocused() && !chatBusy && lastChatAt === opened) closeChat(); }, sec * 1000);
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
let lastCursor = null, still = 0; // still: 커서가 같은 자리에 머문 틱 수
setInterval(() => {
  if (!geo || !mascotWin || mascotWin.isDestroyed()) return;
  if (fsHidden) { if (hitFor !== null) placeHit(null); return; } // 전체화면 뒤에 숨어 있을 때 히트 창이 다시 뜨면 안 된다
  const p = screen.getCursorScreenPoint();
  const x = p.x - geo.x, y = p.y - geo.y;
  // 커서가 가만히 있으면 대상 판정을 4틱(≈64ms)에 한 번만 하고 렌더러에도 알리지 않는다(같은 값이다).
  // 아예 건너뛰면 안 된다 — 서 있는 커서 밑으로 사도가 걸어 들어올 수 있고, hit-rect 는 hitFor 인 사도만 따라간다
  if (lastCursor && lastCursor.x === x && lastCursor.y === y) { if (++still % 4 === 0) updateHitTarget(x, y); return; }
  still = 0; updateHitTarget(x, y);
  lastCursor = { x, y };
  mascotWin.webContents.send("cursor", lastCursor);
}, 16);

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
ipcMain.on("settings:reset", () => { const keepAi = settings.global.ai; settings = { version: 2, global: deepMerge(GLOBAL_DEFAULTS, { ai: keepAi }), characters: [{ ...CHAR_DEFAULTS, id: settings.characters[0].id }] }; /* AI 키·제공자는 유지 */ for (const id of [...instances.keys()]) if (id !== settings.characters[0].id) destroyInstance(id); saveSettings(); applyGeometry(); broadcast(); });
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
// ---- 에셋 가져오기(추출) 창 ----
const { dialog } = require("electron");
const { spawn } = require("node:child_process");
let setupWin = null, extractProc = null;
function toolsDir() { return app.isPackaged ? path.join(process.resourcesPath, "tools") : path.join(__dirname, "tools"); }
function pythonExe() {
  const bundled = path.join(process.resourcesPath || "", "pyruntime", "python.exe");
  if (app.isPackaged && fs.existsSync(bundled)) return { exe: bundled, args: [] };
  const dev = path.join(__dirname, "pyruntime", "python.exe");
  if (fs.existsSync(dev)) return { exe: dev, args: [] };
  return { exe: "python", args: [] }; // 개발: PATH의 python (UnityPy 설치되어 있어야 함)
}
function openSetup() {
  if (setupWin && !setupWin.isDestroyed()) { setupWin.show(); setupWin.focus(); return; }
  setupWin = new BrowserWindow({
    width: 720, height: 640, minWidth: 600, minHeight: 480, title: "사도 데스크 — 에셋 가져오기", show: false,
    backgroundColor: "#1f1f24", autoHideMenuBar: true, icon: path.join(__dirname, "renderer", "tray.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  setupWin.loadFile(path.join(__dirname, "renderer", "setup.html"));
  setupWin.webContents.on("console-message", (ev) => console.log(`[setup:${ev.level}] ${ev.message}`));
  // 첫 실행(에셋 없음)엔 이 창이 사용자가 보는 첫 화면이라 다른 창 뒤로 숨지 않게 앞으로 끌어온다. ready-to-show가 안 오는 경우 대비 1.5초 뒤 강제 표시
  const reveal = () => { if (!setupWin || setupWin.isDestroyed() || setupWin.isVisible()) return; setupWin.center(); setupWin.show(); setupWin.focus(); setupWin.setAlwaysOnTop(true); setTimeout(() => { if (setupWin && !setupWin.isDestroyed()) setupWin.setAlwaysOnTop(false); }, 1500); try { app.focus({ steal: true }); } catch {} };
  setupWin.once("ready-to-show", reveal); setTimeout(reveal, 1500);
  const w = setupWin; trackBounds(w);
  w.on("closed", () => { if (setupWin === w) setupWin = null; });
}
const setupSend = (ch, data) => { if (setupWin && !setupWin.isDestroyed()) setupWin.webContents.send(ch, data); };
// preload 가 파일 읽기를 허용할 폴더(앱 폴더·에셋 폴더·userData). 동기여야 preload 초기화 때 쓸 수 있다
ipcMain.on("roots:get", (e) => { e.returnValue = [__dirname, ASSET_ROOT, path.join(app.getPath("userData"), "assets"), DATA_ROOT].filter(Boolean); });
ipcMain.handle("assets:status", () => ({ root: ASSET_ROOT, hasAssets: hasAssets(ASSET_ROOT), userDataRoot: toSlash(path.join(app.getPath("userData"), "assets")), running: !!extractProc, python: pythonExe().exe, standing: Object.keys(STANDING.game).length, ingame: Object.keys(STANDING.ingame).length, voice: fs.existsSync(path.join(ASSET_ROOT, "voice", "index.json")), packaged: app.isPackaged }));
ipcMain.handle("assets:pick-folder", async () => { const r = await dialog.showOpenDialog(setupWin || undefined, { properties: ["openDirectory"], title: "에셋 폴더 선택 (minimi/ 폴더가 들어 있는 곳)" }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.handle("assets:pick-mumu", async () => { const r = await dialog.showOpenDialog(setupWin || undefined, { properties: ["openDirectory"], title: "뮤뮤 앱플레이어 설치 폴더 (MuMuManager.exe·adb.exe가 있는 nx_main)" }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.handle("assets:use-folder", (_e, folder) => {
  if (!hasAssets(folder)) return { ok: false, error: "이 폴더에 minimi/minimi.skel 이 없어요. 추출된 에셋 폴더(assets)를 골라 주세요." };
  updateSettings({ assets: { root: toSlash(folder) } }); rescanAssets(); startMascot(); if (tray) buildTray(); return { ok: true, root: ASSET_ROOT };
});
ipcMain.handle("assets:scan", () => new Promise((resolve) => {
  const py = pythonExe(); const args = [...py.args, path.join(toolsDir(), "extract-all.py"), "--list-devices", "--json"];
  let out = "", err = "";
  try {
    const p = spawn(py.exe, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" } });
    p.stdout.on("data", (d) => out += d.toString("utf8")); p.stderr.on("data", (d) => err += d.toString("utf8"));
    p.on("error", (e) => resolve({ ok: false, error: "python 실행 실패: " + e.message, devices: [] }));
    // 방화벽이 포트를 버리면 adb connect 가 후보마다 6초씩 물린다. 그동안 창은 "찾는 중…"에
    // 멈춘 채 다시 찾기 단추까지 잠긴다. 이게 가져오기 창을 열자마자 저절로 도는 첫 화면이다
    const timer = setTimeout(() => {
      killTree(p.pid, () => { try { p.kill(); } catch {} });
      resolve({ ok: false, error: "기기 찾기가 60초를 넘겼어요. 앱플레이어를 켠 뒤 다시 찾아 주세요.", devices: [] });
    }, 60000);
    p.on("exit", () => { clearTimeout(timer); try { resolve({ ok: true, devices: JSON.parse(out.trim().split("\n").pop() || "[]") }); } catch { resolve({ ok: false, error: (err || out).slice(0, 300), devices: [] }); } });
  } catch (e) { resolve({ ok: false, error: e.message, devices: [] }); }
}));
ipcMain.handle("assets:extract", (_e, opt) => startExtract(opt));
function startExtract(opt) {
  if (extractProc) return { ok: false, error: "이미 추출 중이에요." };
  const out = path.join(app.getPath("userData"), "assets");
  try { fs.mkdirSync(out, { recursive: true }); }
  catch (e) { return { ok: false, error: `에셋 폴더를 만들 수 없어요 (${out}): ${e.message}` }; }
  const py = pythonExe(); const script = path.join(toolsDir(), "extract-all.py");
  const args = [...py.args, script, "--out", out, "--json", "--steps", (opt.steps || ["minimi", "sfx", "standing", "ingame", "voice"]).join(",")];
  if (opt.mumu) args.push("--mumu", opt.mumu);
  if (opt.force) args.push("--force");
  args.push("--cache", path.join(app.getPath("userData"), "tools-cache")); // platform-tools adb 등 (구버전 adb만 있는 PC용)
  if (opt.adb) args.push("--adb", opt.adb);
  if (opt.serial) args.push("--serial", opt.serial);
  console.log("extract:", py.exe, args.join(" "));
  try { extractProc = spawn(py.exe, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" } }); }
  catch (e) { return { ok: false, error: "python 실행 실패: " + e.message }; }
  let buf = "";
  const logFile = path.join(app.getPath("userData"), "extract.log"); // 진단용: 마지막 추출의 전체 로그
  try { fs.writeFileSync(logFile, `[${new Date().toISOString()}] ${py.exe} ${args.join(" ")}\n`); } catch {}
  const flog = (t) => { try { fs.appendFileSync(logFile, t + "\n"); } catch {} };
  extractProc.stdout.on("data", (d) => { buf += d.toString("utf8"); let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue; flog(line); let o; try { o = JSON.parse(line); } catch { o = { step: "log", msg: line, level: "info" }; } if (o.level === "error" || o.level === "warn") console.log("extract:", o.step, o.msg); setupSend("extract:progress", o); } });
  extractProc.stderr.on("data", (d) => { const t = d.toString("utf8").trim(); if (t) { flog("[stderr] " + t); console.log("extract stderr:", t.slice(0, 300)); setupSend("extract:progress", { step: "stderr", msg: t.slice(0, 400), level: "warn" }); } });
  extractProc.on("error", (e) => { setupSend("extract:progress", { step: "error", msg: `python을 실행할 수 없어요 (${e.message}). Python 3.10+ 와 'pip install UnityPy Pillow' 가 필요해요.`, level: "error" }); extractProc = null; setupSend("extract:done", { ok: false }); });
  extractProc.on("exit", (code) => {
    extractProc = null; flog(`[exit ${code}]`);
    // 보이스에서 걸려도 미니미는 이미 받아 놓은 경우가 흔하다. 예전에는 code 0 일 때만 다시 훑어서
    // 에셋이 멀쩡히 있는데도 "에셋 없음"이 남고 사도가 안 떴다. 종료 코드와 무관하게 훑고 나서 판정한다
    if (code === 0) updateSettings({ assets: { root: "" } });
    rescanAssets();
    const got = hasAssets(ASSET_ROOT);
    if (got) { startMascot(); if (tray) buildTray(); }
    const cancelled = extractCancelled; extractCancelled = false;
    setupSend("extract:done", { ok: code === 0, cancelled, partial: code !== 0 && got, code, root: ASSET_ROOT, hasAssets: got });
    if (argHas("--setup-test")) console.log("SETUPTEST exit", code, "hasAssets", hasAssets(ASSET_ROOT), "root", ASSET_ROOT, "mascotStarted", mascotStarted);
  });
  return { ok: true };
}
if (argHas("--setup-test")) setTimeout(async () => { if (setupWin && !app.isPackaged) { try { const img = await setupWin.webContents.capturePage(); fs.writeFileSync(path.join(__dirname, "out", "setup.png"), img.toPNG()); } catch {} } const steps = (argVal("--setup-steps", "minimi,sfx") || "minimi,sfx").split(","); console.log("SETUPTEST start extract", steps.join(",")); startExtract({ steps }); }, 4000);
ipcMain.handle("assets:enable-ld-adb", (_e, idx) => new Promise((resolve) => { // LD플레이어 인스턴스의 ADB 디버깅 켜고 재시작 (extract-all.py --enable-ld-adb N)
  const py = pythonExe(); const args = [...py.args, path.join(toolsDir(), "extract-all.py"), "--enable-ld-adb", String(idx), "--json"];
  let out = "";
  try {
    const p = spawn(py.exe, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" } });
    p.stdout.on("data", (d) => { out += d.toString("utf8"); for (const line of d.toString("utf8").split("\n")) { if (!line.trim()) continue; let o; try { o = JSON.parse(line); } catch { o = { step: "ld", msg: line, level: "info" }; } setupSend("extract:progress", o); } });
    p.on("error", (e) => resolve({ ok: false, error: e.message }));
    p.on("exit", (code) => resolve({ ok: code === 0, out }));
  } catch (e) { resolve({ ok: false, error: e.message }); }
}));
// 무리째 죽인다. spawn 의 try/catch 는 동기 예외만 잡고, taskkill 을 못 찾는 경우는 비동기 'error' 로 와서
// 받는 이가 없으면 메인이 죽는다. 그때는 부모 하나만이라도 죽이는 폴백으로
function killTree(pid, fallback) {
  try { const k = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }); k.on("error", fallback); }
  catch { fallback(); }
}
let extractCancelled = false;
// kill() 은 python 하나만 죽인다. 그 밑에서 돌던 adb 와 변환 일꾼들은 살아남아 임시 폴더에 계속
// 쓰고, extract-all.py 의 finally(임시 폴더 지우기)도 돌지 않는다. 보이스 원본만 1.6GB다
ipcMain.on("assets:cancel", () => {
  if (!extractProc) return;
  extractCancelled = true;
  const pid = extractProc.pid;
  killTree(pid, () => { try { if (extractProc) extractProc.kill(); } catch {} });
});
ipcMain.on("assets:open-setup", () => openSetup());
ipcMain.on("assets:open-root", () => { try { fs.mkdirSync(ASSET_ROOT, { recursive: true }); } catch (e) { console.warn("assets root mkdir", e.message); } shell.openPath(ASSET_ROOT); }); // 설정에 적힌 폴더가 없는 드라이브(빠진 USB)면 mkdir 이 던진다
ipcMain.on("assets:open-log", () => { const f = path.join(app.getPath("userData"), "extract.log"); if (fs.existsSync(f)) shell.openPath(f); });

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
ipcMain.on("open-path", (_e, which) => { if (which === "settings") shell.showItemInFolder(SETTINGS_FILE); else if (which === "assets") shell.openPath(ASSET_ROOT); });
ipcMain.on("char:add", (e, from) => addCharacter(from || instanceOf(e.sender)));
ipcMain.on("char:remove", (e, id) => removeCharacter(id || instanceOf(e.sender)));
// 히트 창
ipcMain.on("hit-rect", (e, r, id) => {
  const inst = instances.get(id); if (!inst) return;
  inst.rect = (r && r.w > 0) ? r : null;
  if (hitFor === id) placeHit(id); // 대상 캐릭터가 움직이면(드래그·이동) 히트 창도 바로 따라감
  // (말풍선은 띄울 때 자리를 잡고 고정 — 캐릭터를 따라다니지 않음)
});
ipcMain.on("hit-ev", (e, ev) => {
  if (ev && ev.type === "mousedown") lastTouchAt = Date.now(); // 손이 닿았다 — "오래 방치" 꼬리표를 푼다
  const id = ev.instance || hitFor; // 실제 히트 창 이벤트는 현재 대상 캐릭터에게. (테스트는 instance를 직접 지정)
  if (!id || !instances.has(id) || !geo || !mascotWin || mascotWin.isDestroyed()) return;
  if (ev.type === "mousedown") hitDown = true; else if (ev.type === "mouseup") hitDown = false;
  mascotWin.webContents.send("hit-mouse", { instance: id, type: ev.type, x: ev.sx - geo.x, y: ev.sy - geo.y, button: ev.button, buttons: ev.buttons });
});
ipcMain.on("menu:open", (e, p, id) => { if (id && charOf(id) && geo) openMenu(id, geo.x + p.x, geo.y + p.y); });
ipcMain.on("menu:close", () => { if (menuWin && !menuWin.isDestroyed()) menuWin.close(); });
ipcMain.on("menu:resize", (_e, h) => { h = heightOf(h, 40); if (h === null) return; if (menuWin && !menuWin.isDestroyed()) { const b = menuWin.getBounds(); const d = screen.getDisplayNearestPoint({ x: b.x, y: b.y }).workArea; const nh = Math.min(h, d.height); menuWin.setBounds({ x: b.x, y: Math.min(b.y, d.y + d.height - nh), width: MENU_W, height: nh }); } });
function catalogPayload(id) { return { ...catalog, sdAnimations: (id && sdAnimsOf.get(id)) || catalog.sdAnimations || [], standing: STANDING, assetRoot: ASSET_ROOT, dataRoot: DATA_ROOT, hasAssets: hasAssets(ASSET_ROOT), settingsFile: SETTINGS_FILE, version: app.getVersion(), electron: process.versions.electron }; }

if (argHas("--hit-test")) setTimeout(() => {
  const id = settings.characters[0].id, inst = instances.get(id); const b = screenRect(inst.rect); const sx = b.x + b.width / 2, sy = b.y + b.height / 2;
  updateHitTarget(sx - geo.x, sy - geo.y);
  const ev = (type, button) => ipcMain.emit("hit-ev", null, { type, sx, sy, button, buttons: 0 }); // instance 없이 → hitFor 로 라우팅되는지
  console.log("HITTEST rect", JSON.stringify(b), "hitFor", hitFor, "shown", hitShown, "hitWin", hitWin ? JSON.stringify(hitWin.getBounds()) : null);
  ev("mousedown", 0); setTimeout(() => ev("mouseup", 0), 60);
  setTimeout(() => { ipcMain.emit("hit-ev", null, { instance: id, type: "mousedown", sx, sy, button: 2, buttons: 0 }); setTimeout(() => console.log("HITTEST menuWin", menuWin ? JSON.stringify(menuWin.getBounds()) : null), 1500); }, 1500);
}, 6000);

if (argHas("--persona-test")) setTimeout(async () => { // 여러 사도의 말투 확인: 스킨마다 같은 질문 → 답 로그
  const skins = (argVal("--persona-test", "") || "Mini_Crepe").split(","); const q = argVal("--persona-q", "") || "안녕! 오늘 뭐 하고 있었어?";
  for (const skin of skins) {
    const p = talkData ? Talk.profileFor(talkData, skin) : null; if (!p) { console.log("PERSONA", skin, "프로필 없음"); continue; }
    const hero = skin.replace(/^Mini_/, "").replace(/Skin\d+$/, "").toLowerCase(); if (talkStyle && talkStyle[hero]) p.styleInfo = talkStyle[hero]; if (vsamples[hero]) p.sampleLines = vsamples[hero];
    p.key = hero; p.koOf = koOfHero; if (relations && relations[hero]) p.rel = relations[hero]; if (bible[hero]) p.bible = bible[hero]; p.theaters = theaters.filter(t => (t.castKeys || []).includes(hero));
    try { const r = await Ai.chat(settings.global.ai, p, [{ role: "user", text: q }], () => {}, {}); console.log(`PERSONA ${skin} [${p.style}/${p.addr}] → ${r.text.replace(/\n/g, " ")} {${r.raw}}`); }
    catch (e) { console.log(`PERSONA ${skin} ERROR ${e.message}`); }
    await new Promise(r => setTimeout(r, +argVal("--persona-gap", "7000") || 7000));
  }
  console.log("PERSONA done");
}, 5000);
if (argHas("--screen-test")) setTimeout(async () => { const id = settings.characters[0].id; try { const img = await captureScreenFor(id); fs.writeFileSync(path.join(__dirname, "out", "screen-cap.jpg"), Buffer.from(img.data, "base64")); console.log("SCREENTEST captured", img.data.length, "b64 chars display", img.display); } catch (e) { console.log("SCREENTEST capture error", e.message); } await screenTalk(id, argVal("--screen-msg", "") || ""); setTimeout(() => console.log("SCREENTEST history", JSON.stringify(Ai.loadHistory(app.getPath("userData"), id).slice(-2))), 1500); }, 7000);
// 혼잣말 대본 시험: 사도 하나가 여덟 번 중얼거린다 (되풀이·모션·말풍선 확인)
if (argHas("--selftalk-test")) setTimeout(async () => {
  const id = settings.characters[0].id, prof = chatProfile(id);
  console.log(`SELFTALKTEST hero=${prof && prof.ko}(${prof && prof.key}) 대본 ${((selfTalk[prof && prof.key]) || []).length}줄`);
  for (let i = 0; i < 8; i++) { const ok = saySelfTalk(id); console.log(`SELFTALKTEST ${i + 1}/8 ${ok ? "말함" : "대본 없음"}`); await new Promise(r => setTimeout(r, 2500)); }
  const said = selfTalkSaid.get(prof.key) || [];
  console.log(`SELFTALKTEST 서로 다른 줄 ${new Set(said).size}/${said.length} (8번에 겹침 없어야 정상)`);
  app.quit();
}, 6000);
if (argHas("--gemini-models")) setTimeout(async () => { const key = Ai.decKey(Ai.merge(settings.global.ai).keys.gemini); const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key } }); const j = await r.json(); console.log("GEMINI MODELS", r.status, JSON.stringify((j.models || []).filter(m => (m.supportedGenerationMethods || []).includes("generateContent")).map(m => m.name.replace("models/", "")))); app.quit(); }, 3000);
if (argHas("--chat-test")) setTimeout(async () => {
  const id = settings.characters[0].id; openChat(id);
  setTimeout(async () => { const st = await Ai.status(settings.global.ai); console.log("CHATTEST status", JSON.stringify(st)); for (const q of (argVal("--chat-msgs", "") || "안녕! 오늘 뭐 했어?").split("|")) { await chatWin.webContents.executeJavaScript(`document.getElementById("in").value = ${JSON.stringify(q)}; document.getElementById("send").click();`); for (let i = 0; i < 60 && chatBusy; i++) await new Promise(r => setTimeout(r, 250)); await new Promise(r => setTimeout(r, 600)); } const r = Ai.loadHistory(app.getPath("userData"), id); console.log("CHATTEST history", JSON.stringify(r)); console.log("CHATTEST ui", await chatWin.webContents.executeJavaScript(`JSON.stringify({sendDisabled: document.getElementById("send").disabled, inDisabled: document.getElementById("in").disabled, bg: getComputedStyle(document.getElementById("send")).backgroundColor})`)); setTimeout(async () => { if (chatWin && !app.isPackaged) { const img = await chatWin.webContents.capturePage(); fs.writeFileSync(path.join(__dirname, "out", "chat.png"), img.toPNG()); console.log("CHAT shot", img.getSize(), JSON.stringify(chatWin.getBounds())); } }, 1200); }, 2500);
}, 5000);
if (argHas("--menu-test")) setTimeout(async () => { const id = settings.characters[0].id; openMenu(id, geo.x + 400, geo.y + 300); setTimeout(async () => { if (menuWin) { const img = await menuWin.webContents.capturePage(); fs.writeFileSync(path.join(__dirname, "out", "menu.png"), img.toPNG()); console.log("MENU shot", img.getSize());
  const sub = argVal("--menu-sub", ""); if (sub) { await menuWin.webContents.executeJavaScript(`document.querySelector('[data-toggle=${sub}]').click()`); await new Promise(r => setTimeout(r, 800)); const b = menuWin.getBounds(); const info = await menuWin.webContents.executeJavaScript("({sh: document.getElementById('menu').scrollHeight, ch: document.getElementById('menu').clientHeight, quitY: document.querySelector('[data-act=quit]').getBoundingClientRect().bottom})"); console.log("MENU sub", sub, JSON.stringify(b), JSON.stringify(info)); const img2 = await menuWin.webContents.capturePage(); fs.writeFileSync(path.join(__dirname, "out", "menu-sub.png"), img2.toPNG()); } } }, 1500); }, 5000);
if (argHas("--multi-test")) setTimeout(() => {
  const dump = (tag) => console.log(`MULTI ${tag} chars=${JSON.stringify(settings.characters.map(c => [c.id, c.skin, c.mode, c.scale]))} rects=${[...instances.keys()].join(",")} windows=${BrowserWindow.getAllWindows().length} hitFor=${hitFor} shown=${hitShown} rects=${[...instances.values()].map(i => i.rect ? JSON.stringify(screenRect(i.rect)) : "-").join(" ")}`);
  dump("start");
  const id2 = addCharacter(settings.characters[0].id);
  setTimeout(() => {
    dump("added");
    updateSettings({ skin: "Mini_Erpin", scale: 0.8 }, id2);            // 개별 설정: 2번만 바뀌어야 함
    updateSettings({ sound: { master: 0.3 } }, settings.characters[0].id); // 공통 설정
    setTimeout(() => {
      dump("patched"); console.log("MULTI global.sound.master=", settings.global.sound.master, "view(c1).skin=", viewFor(settings.characters[0].id).skin, "view(id2)=", viewFor(id2).skin, viewFor(id2).scale, "count", viewFor(id2).count);
      const inst = instances.get(id2); const hb = screenRect(inst.rect); updateHitTarget(hb.x + hb.width / 2 - geo.x, hb.y + hb.height / 2 - geo.y); console.log("MULTI hover c2 → hitFor=", hitFor, "hitWin=", hitWin ? JSON.stringify(hitWin.getBounds()) : null);
      ipcMain.emit("hit-ev", null, { instance: id2, type: "mousedown", sx: hb.x + hb.width / 2, sy: hb.y + hb.height / 2, button: 2, buttons: 0 });
      setTimeout(() => {
        console.log("MULTI menuFor=", menuFor, "menuWin=", menuWin ? JSON.stringify(menuWin.getBounds()) : null);
        if (menuWin && !menuWin.isDestroyed()) menuWin.close();
        removeCharacter(id2);
        setTimeout(() => { dump("removed"); console.log("MULTI DONE"); app.quit(); }, 1500);
      }, 2500);
    }, 4000);
  }, 6000);
}, 5000);

// ---- 트레이 ----
function buildTray() {
  const items = [
    ...settings.characters.map(c => ({ label: `${koSkin(c.skin)} (${c.mode === "sd" ? "SD" : c.mode === "ingame" ? "인게임" : "미니미"})`, submenu: [
      { label: "설정...", click: () => openSettings("character", c.id) },
      { label: "다시 등장", click: () => sendMascot(c.id, "respawn") },
      { label: "보내기", enabled: settings.characters.length > 1, click: () => removeCharacter(c.id) },
    ] })),
    { label: "하나 더 부르기", click: () => addCharacter() },
    { type: "separator" },
    { label: news && news.unread ? `새 소식 ${news.unread}개 보기` : "새 소식 (없음)", enabled: !!(news && news.items.length), click: () => { ipcMain.emit("news:show"); } },
    { label: "지금 소식 확인", click: async () => { if (news) { const r = await news.check(true); if (!r.added.length) console.log("news: 새 소식 없음", r.errors); } } },
    { type: "separator" },
    { label: "말 걸기 (Ctrl+Shift+Space)", click: () => openChat(settings.characters[0].id) },
    ...(updateInfo ? [{ label: `새 버전 ${updateInfo.tag} 받기...`, click: () => shell.openExternal(updateInfo.url) }] : []),
    { label: "설정...", click: () => openSettings() },
    { label: hasAssets(ASSET_ROOT) ? "에셋 다시 가져오기..." : "에셋 가져오기...", click: () => openSetup() },
    { label: "사운드 음소거", type: "checkbox", checked: settings.global.sound.muted, click: (m) => updateSettings({ sound: { muted: m.checked } }) },
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
// ---- 업데이트 확인: 깃허브 최신 릴리스 태그가 이 버전보다 높으면 알림(클릭 → 릴리스 페이지) + 트레이 메뉴에 '새 버전 받기'. 같은 버전은 한 번만 알림 ----
const UPDATE_REPO = "RED9839/sado-desk";
let updateInfo = null, updateNotified = "";
const semver = (v) => String(v || "").replace(/^v/, "").split(".").map(n => parseInt(n, 10) || 0);
const newerThan = (a, b) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
async function checkUpdate() {
  try {
    const r = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, { headers: { "User-Agent": `sado-desk/${app.getVersion()}`, Accept: "application/vnd.github+json" } });
    if (!r.ok) { console.log("update check", r.status); return; }
    const j = await r.json(); const tag = j.tag_name || "";
    if (!newerThan(tag, app.getVersion())) { updateInfo = null; return; }
    updateInfo = { tag, url: j.html_url || `https://github.com/${UPDATE_REPO}/releases/latest`, asset: (j.assets || []).find(a => /\.exe$/i.test(a.name))?.browser_download_url };
    if (tray) buildTray();
    if (updateNotified === tag) return; updateNotified = tag;
    const { Notification } = require("electron");
    if (Notification.isSupported()) { const n = new Notification({ title: `사도 데스크 ${tag} 업데이트가 나왔어요`, body: `지금 ${app.getVersion()} → ${tag.replace(/^v/, "")}. 클릭하면 다운로드 페이지가 열려요. (트레이 메뉴에서도 받을 수 있어요)`, silent: true }); n.on("click", () => shell.openExternal(updateInfo.url)); n.show(); }
    console.log(`update: ${app.getVersion()} → ${tag}`);
  } catch (e) { console.log("update check 실패", e.message); }
}
if (argHas("--update-test")) setTimeout(async () => { await checkUpdate(); console.log("UPDATETEST", app.getVersion(), JSON.stringify(updateInfo), "newer(v9.9.9,cur)=", newerThan("v9.9.9", app.getVersion()), "newer(v0.1.0,cur)=", newerThan("v0.1.0", app.getVersion())); app.quit(); }, 2000);
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
  try { globalShortcut.register("CommandOrControl+Shift+Space", () => { if (chatWin && !chatWin.isDestroyed() && chatWin.isVisible() && chatWin.isFocused()) closeChat(); else openChat(nearestChar()); }); } catch (e) { console.warn("단축키 등록 실패", e.message); }
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
  const wins = [mascotWin, hitWin, bubbleWin].filter(w => w && !w.isDestroyed());
  if (mascotWin && !mascotWin.isDestroyed()) mascotWin.webContents.send("pause", want); // 창을 숨겨도 렌더 루프는 돈다(backgroundThrottling:false) — 멈추라고 알려 준다
  if (want) { for (const w of wins) w.hide(); }
  else { for (const w of wins) { if (w === hitWin) continue; w.showInactive(); w.setAlwaysOnTop(true, "screen-saver"); } } // 히트 창은 커서 폴링이 필요할 때 스스로 뜬다
}
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
app.on("before-quit", () => { if (saveTimer) flushSettings(); /* 150ms 디바운스 안에 끄면 마지막 변경이 파일에 안 남았다 */ if (extractProc) killTree(extractProc.pid, () => { try { extractProc.kill(); } catch {} }); if (pullProc) { try { pullProc.kill(); } catch {} } if (news) news.stop(); if (fsWatch) fsWatch.stop(); closeBubble(); for (const id of [...instances.keys()]) destroyInstance(id); if (hitWin && !hitWin.isDestroyed()) hitWin.destroy(); if (mascotWin && !mascotWin.isDestroyed()) mascotWin.destroy(); });
