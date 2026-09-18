/* 설정의 뼈대 — 기본값·병합·범위 검사. main.js 가 쓰고, 테스트(test/)가 Electron 없이 그대로 돌린다.
 * 여기에는 파일·창·로그를 만지는 코드를 두지 않는다. */
const Ai = require("./ai.js");
const CHAR_DEFAULTS = {
  skin: "Mini_Crepe",
  mode: "sd",          // "minimi"(스틱 미니미) | "sd"(스탠딩; 이동은 미니미) | "ingame"(전투·마이홈 SD: Idle/Move/Spawn/Victory/Attack…)
  mood: "",            // 표정 고정: "" | smile | anger | sad | happy | eat | sulky | surprise (SD 전용, 게임 스토리 표정 8종)
  scale: 0.5, opacity: 1,
  monitor: -1,         // 이 사도를 가둘 모니터 id. -1 = 놓아둔 모니터에 머문다(끌어다 옮기면 그곳, 기본). 0 = 가두지 않음(모니터 전체를 오간다). 없어진 모니터면 0 취급
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
  // bulkEdit: 사도별 값(형태·크기·불투명도·표정·행동)을 바꿀 때 모든 사도에 함께 넣는다.
  // 설정 창과 우클릭 메뉴가 같은 값을 본다 — 메뉴 창은 열 때마다 새로 만들어지므로 껐다 켤 때마다
  // 다시 체크하게 두면 쓸모가 없어서 설정에 남긴다. 사도 바꾸기(skin)만은 함께 가지 않는다
  display: { debug: false, multiMonitor: true, overTaskbar: true, autoStart: false, fps: "auto", guideShown: false, hideFullscreen: true, bulkEdit: false, keepOnTop: false }, // fps: "auto"(손댈 때만 60) | 30 | 60
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
  "ai.screenScope": ["windows", "display"], // 고른 창만 / 모니터 전체
};
const STRINGS = { skin: [/^[A-Za-z0-9_]+$/, 64], "assets.root": [/^[\s\S]*$/, 1024] };
// 배열로 오는 값 — 문자열만 남기고 개수·길이를 자른다 (창 이름은 무엇이든 올 수 있다)
const LISTS = { "ai.screenWindows": [40, 80] };  // [최대 개수, 이름 최대 길이]
// 값 하나. undefined 를 돌려주면 버린다(deepMerge 가 undefined 를 건너뛴다). fixed 에 고친 내역이 쌓인다
function checkValue(key, v, fixed) {
  if (LISTS[key]) { const [n, len] = LISTS[key]; return Array.isArray(v) ? [...new Set(v.filter(x => typeof x === "string" && x.trim()).map(x => x.trim().slice(0, len)))].slice(0, n) : undefined; }
  // 손으로 고친 파일의 "0.7" 같은 숫자 문자열은 받아 준다 (ai.js 가 + 로 받던 값이다)
  if (RANGES[key]) { if (typeof v === "string" && v.trim() !== "" && Number.isFinite(+v)) v = +v; if (typeof v !== "number" || !Number.isFinite(v)) return undefined; const c = Math.min(RANGES[key][1], Math.max(RANGES[key][0], v)); if (c !== v) fixed.push(`${key} ${v}→${c}`); return c; }
  if (ENUMS[key]) { const s = String(v); return ENUMS[key].includes(s) ? s : undefined; }
  if (STRINGS[key]) return typeof v === "string" && v.length <= STRINGS[key][1] && STRINGS[key][0].test(v) ? v : undefined;
  return v;
}
function sanitizeTree(obj, prefix, fixed) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix + k, leaf = RANGES[key] || ENUMS[key] || STRINGS[key] || LISTS[key];
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
    const leaf = RANGES[k] || ENUMS[k] || STRINGS[k] || LISTS[k];
    const r = leaf ? checkValue(k, v, log) : isObj(v) ? sanitizeTree(v, k + ".", log) : v;
    if (r !== undefined) out[k] = r;
  }
  return out;
}
// 파일에서 읽은 설정 전체에 같은 검사 — 손으로 고친 파일·옛 판 파일이 범위 밖 값을 들고 있어도 여기서 한 번에 바로잡는다.
// 고친 내역을 돌려주고, 로그와 파일 저장은 부르는 쪽(main.js)이 한다 — 이 파일은 파일·창·로그를 만지지 않는다
function clampSettings(s) {
  const fixed = [];
  s.global = sanitizePatch(s.global, { forChar: false, fixed });
  s.characters = s.characters.map(({ id, ...c }) => ({ id, ...sanitizePatch(c, { forChar: "only", fixed }) }));
  for (const c of s.characters) if (c.monitor !== undefined) c.monitor = +c.monitor || 0;   // 모니터 id 는 숫자 — 손으로 고친 파일이 문자열을 들고 있어도 맞춘다
  return fixed;
}
module.exports = { CHAR_DEFAULTS, GLOBAL_DEFAULTS, GLOBAL_KEYS, CHAR_KEYS, RANGES, ENUMS, STRINGS, LISTS, isObj, deepMerge, checkValue, sanitizeTree, sanitizePatch, clampSettings };
