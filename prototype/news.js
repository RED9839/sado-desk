/* 새 소식 감시 (메인 프로세스). 공식 유튜브 RSS + 네이버 게임 라운지(트릭컬) 게시판 API를 주기적으로 확인해 새 글/영상을 알린다.
 * - 유튜브: https://www.youtube.com/feeds/videos.xml?channel_id=UCI37oS0O5OlmQNeiyIywEAQ (EPID Games 공식, 키 불필요)
 * - 라운지: https://comm-api.game.naver.com/nng_main/v1/community/lounge/Trickcal/feed?boardId=N&limit=..&order=NEW (라운지 페이지가 쓰는 공개 JSON)
 *   게시판: 3 공지사항 · 11 업데이트 · 8 개발자 노트 (그 외 13 진행 이벤트, 22 테마극장 PV, 31 쿠폰 게시판, 15 공식 영상)
 * 본 적 있는 id는 news-state.json 에 저장. 첫 실행은 현재 글들을 '본 것'으로만 기록(알림 폭탄 방지).
 * 비공식 엔드포인트라 실패하면 조용히 넘어가고 다음 주기에 다시 시도. */
const fs = require("node:fs");
const path = require("node:path");

const YT_CHANNEL = "UCI37oS0O5OlmQNeiyIywEAQ";
const LOUNGE = "Trickcal";
const BOARDS = { notice: { id: 3, label: "공지사항" }, update: { id: 11, label: "업데이트" }, devnote: { id: 8, label: "개발자 노트" }, event: { id: 13, label: "진행 이벤트" }, pv: { id: 22, label: "테마극장 PV" }, coupon: { id: 31, label: "쿠폰 게시판" } };
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) sado-desk/0.8";
const MAX_KEEP = 60;

// 주소·시한은 시험에서만 갈아 끼운다 (test/news.test.js 가 로컬 가짜 서버를 물린다). 제품 코드는 기본값 그대로
const DEFAULT_ENDPOINTS = {
  youtube: (ch) => `https://www.youtube.com/feeds/videos.xml?channel_id=${ch}`,
  lounge: (boardId) => `https://comm-api.game.naver.com/nng_main/v1/community/lounge/${LOUNGE}/feed?offset=0&limit=8&order=NEW&boardId=${boardId}`,
};
function createNewsWatcher({ stateFile, getConfig, onNew, log = () => {}, endpoints, timeoutMs = 15000 }) {
  const EP = { ...DEFAULT_ENDPOINTS, ...(endpoints || {}) };
  let state = { seen: { youtube: [], lounge: [] }, items: [], unread: 0, initialized: false, lastCheck: 0, lastError: null };
  try { state = { ...state, ...JSON.parse(fs.readFileSync(stateFile, "utf8")) }; } catch {}
  let timer = null, checking = false;
  const save = () => { try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(state, null, 2)); } catch (e) { log("news state save", e); } };

  async function fetchText(url, ms = timeoutMs) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
    try { const r = await fetch(url, { headers: { "User-Agent": UA, Referer: "https://game.naver.com/" }, signal: ac.signal }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.text(); }
    finally { clearTimeout(t); }
  }
  const unesc = (s) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

  async function fetchYouTube() {
    const xml = await fetchText(EP.youtube(YT_CHANNEL));
    const out = [];
    for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
      const e = m[1];
      const id = (e.match(/<yt:videoId>([^<]+)/) || [])[1]; if (!id) continue;
      const title = unesc((e.match(/<title>([^<]*)/) || [, ""])[1]);
      const published = (e.match(/<published>([^<]+)/) || [, ""])[1];
      const thumb = (e.match(/<media:thumbnail url="([^"]+)"/) || [, ""])[1];
      out.push({ source: "youtube", label: "유튜브", id: `yt:${id}`, title, url: `https://www.youtube.com/watch?v=${id}`, date: published, thumb });
    }
    return out;
  }
  async function fetchBoard(key) {
    const b = BOARDS[key];
    const json = JSON.parse(await fetchText(EP.lounge(b.id)));
    if (json.code !== 200) throw new Error(`lounge ${key}: ${json.message}`);
    return (json.content.feeds || []).map(f => {
      const fe = f.feed || {}; const d = String(fe.createdDate || "");
      const date = d.length >= 12 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(8, 10)}:${d.slice(10, 12)}:00+09:00` : "";
      return { source: key, label: b.label, id: `lounge:${fe.feedId}`, title: unesc(fe.title || "(제목 없음)"), url: (f.feedLink && f.feedLink.pc) || `https://game.naver.com/lounge/${LOUNGE}/board/detail/${fe.feedId}`, date, thumb: fe.repImageUrl || null, writer: f.user && f.user.nickname };
    });
  }

  async function check(force = false) {
    if (checking) return { added: [] }; checking = true;
    const cfg = getConfig() || {};
    const added = []; const errors = [];
    try {
      const jobs = [];
      if (cfg.youtube !== false) jobs.push(fetchYouTube().catch(e => { errors.push("유튜브: " + e.message); return []; }));
      for (const key of Object.keys(BOARDS)) if (cfg[key] === true || (cfg[key] === undefined && ["notice", "update", "devnote"].includes(key))) jobs.push(fetchBoard(key).catch(e => { errors.push(`${BOARDS[key].label}: ${e.message}`); return []; }));
      const lists = await Promise.all(jobs);
      const seenYt = new Set(state.seen.youtube), seenLg = new Set(state.seen.lounge);
      const known = new Set(state.sources || []); // 이미 한 번 확인한 소스(게시판). 설정에서 새로 켠 게시판은 기존 글을 '본 것'으로만 기록(알림 폭탄 방지)
      for (const list of lists) for (const it of list) {
        const set = it.source === "youtube" ? seenYt : seenLg;
        if (set.has(it.id)) continue;
        set.add(it.id);
        if (state.initialized && known.has(it.source)) added.push(it);
      }
      for (const list of lists) for (const it of list) known.add(it.source);
      state.sources = [...known];
      state.seen.youtube = [...seenYt].slice(-400); state.seen.lounge = [...seenLg].slice(-800);
      if (!state.initialized) { state.initialized = true; log(`news: 첫 확인 — 유튜브 ${seenYt.size}, 라운지 ${seenLg.size}건을 기준으로 기록`); }
      added.sort((a, b) => (a.date < b.date ? -1 : 1));
      if (added.length) { state.items = [...added.map(it => ({ ...it, read: false })).reverse(), ...state.items].slice(0, MAX_KEEP); state.unread = state.items.filter(i => !i.read).length; }
      state.lastCheck = Date.now(); state.lastError = errors.length ? errors.join(" / ") : null;
      save();
      if (added.length) { log(`news: 새 소식 ${added.length}건 — ${added.map(i => `[${i.label}] ${i.title}`).join(" | ")}`); onNew(added); }
      else if (errors.length) log("news: " + state.lastError);
    } finally { checking = false; }
    return { added, errors };
  }
  // 미리보기용: 지금 올라와 있는 최신 글 — 유튜브 최신 1 + 켜진 라운지 게시판마다 최신 1 (상태 변경 없음)
  async function latest() {
    const cfg = getConfig() || {}; const out = [];
    const jobs = [];
    if (cfg.youtube !== false) jobs.push(fetchYouTube().then(l => l.slice(0, 1)).catch(() => []));
    for (const key of Object.keys(BOARDS)) if (cfg[key] === true || (cfg[key] === undefined && ["notice", "update", "devnote"].includes(key))) jobs.push(fetchBoard(key).then(l => l.slice(0, 1)).catch(() => []));
    for (const l of await Promise.all(jobs)) out.push(...l);
    out.sort((a, b) => (a.date < b.date ? 1 : -1));
    return out.slice(0, 4);
  }
  function start() { stop(); const cfg = getConfig() || {}; if (cfg.enabled === false) return; const min = Math.max(2, +cfg.intervalMin || 10); check(); timer = setInterval(() => check(), min * 60 * 1000); }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  function markRead(id) { let n = 0; for (const it of state.items) if (!id || it.id === id) { if (!it.read) n++; it.read = true; } state.unread = state.items.filter(i => !i.read).length; if (n) save(); }
  // 테스트용: 가짜 새 소식 주입
  function inject(items) { const list = items.map(it => ({ ...it, read: false })); state.items = [...list, ...state.items].slice(0, MAX_KEEP); state.unread = state.items.filter(i => !i.read).length; save(); onNew(items); }
  return { check, start, stop, markRead, inject, latest, get items() { return state.items; }, get unread() { return state.unread; }, get status() { return { lastCheck: state.lastCheck, lastError: state.lastError, initialized: state.initialized }; }, BOARDS };
}
module.exports = { createNewsWatcher, BOARDS };
