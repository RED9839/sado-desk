/* 혼잣말(대본) — main.js 에서 떼어 낸 것. data/self-talk.json 을 읽고, 상황에 맞는 줄을 골라 말풍선·모션으로 내보낸다.
 * LLM 을 부르지 않는다. 바깥(말풍선·모션·프로필)은 ctx 로 받는다.
 *   const ST = require("./selftalk.js")(ctx);  → { lines, skins, saySelfTalk, pickSelfTalk, selfCtx, selfTalkSaid, touch }
 */
const { ipcMain } = require("electron");
const fs = require("fs"), path = require("path");

module.exports = function createSelfTalk(ctx) {
  let selfTalk = {}, skinTalk = {}; try { const _st = JSON.parse(fs.readFileSync(path.join(ctx.dataRoot, "self-talk.json"), "utf8")); selfTalk = _st.heroes || {}; skinTalk = _st.skins || {}; console.log(`혼잣말 대본: ${Object.keys(selfTalk).length}명 ${Object.values(selfTalk).reduce((a, l) => a + l.length, 0)}줄` + (Object.keys(skinTalk).length ? ` · 코스튬 ${Object.keys(skinTalk).length}벌 ${Object.values(skinTalk).reduce((a, l) => a + l.length, 0)}줄` : "")); } catch (e) { console.warn("self-talk.json 없음 — 혼잣말은 대본 대신 AI 로 돈다", e.message); }
  // ---- 혼잣말 (대본) ----
  // data/self-talk.json 4,498줄(그중 2,760줄은 상황 꼬리표가 달렸다). LLM 을 부르지 않는다 — AI 를 켜지 않은 사람도 사도가 중얼거린다.
  // 줄마다 {t: 문장, m: 감정, a: 동작 접두어} 라 말풍선과 모션을 그대로 태울 수 있다.
  const selfTalkSaid = new Map(); // 사도키 → 최근에 말한 줄 (되풀이 방지)
  // 혼잣말의 상황 꼬리표(w). 아침이든 밤이든 방금 던져졌든 같은 풀에서 뽑던 것을, 그 때에 맞는 줄이 먼저 나오게 한다.
  // 꼬리표 없는 줄은 언제나 후보. 꼬리표가 지금 상황과 맞으면 세 배 무게 — 그래야 맞는 때에 실제로 나온다
  const SELF_TAGS = ["morning", "day", "evening", "night", "late", "weekend", "thrown", "petted", "poked", "idle"];
  const lastEvent = new Map(); // 인스턴스 id → { kind, at } 렌더러가 알려 준 마지막 교감 (던져짐·쓰다듬음·꿀밤)
  let lastTouchAt = Date.now(); // 마지막으로 손이 닿은 시각 — 30분 넘으면 "오래 가만히 둠"
  // 교감 직후 그 상황의 대본 한 줄 — 늘은 아니고(음성 반응이 먼저다) 35%, 사도마다 45초에 한 번. 나머지는 90초 동안 후보 가중치로 남는다
  const lastReactAt = new Map();
  ipcMain.on("mascot:event", (e, id, kind) => {
    const me = typeof id === "string" ? id : ctx.instanceOf(e.sender); if (!me || typeof kind !== "string") return;
    lastEvent.set(me, { kind, at: Date.now() }); lastTouchAt = Date.now();
    if (!SELF_TAGS.includes(kind) || Math.random() >= 0.35 || Date.now() - (lastReactAt.get(me) || 0) < 45000) return;
    lastReactAt.set(me, Date.now());
    setTimeout(() => { try { saySelfTalk(me, { only: kind }); } catch (err) { console.warn("selftalk react", err.message); } }, 1400);   // 착지·쓰다듬기 음성이 끝날 즈음
  });
  function selfCtx(id) {
    const now = new Date(), h = now.getHours(), tags = new Set();
    tags.add(h < 6 ? "late" : h < 11 ? "morning" : h < 17 ? "day" : h < 21 ? "evening" : "night");
    if (now.getDay() === 0 || now.getDay() === 6) tags.add("weekend");
    const ev = lastEvent.get(id); if (ev && Date.now() - ev.at < 90000) tags.add(ev.kind); // 던져진 지 90초 안이면 "아까 던진 거"
    if (Date.now() - lastTouchAt > 30 * 60000) tags.add("idle");
    return tags;
  }
  // key = 사도 키, skinKey = 입은 코스튬 키(없으면 ""). 코스튬 줄은 상황 꼬리표가 없는 평상시 줄이라
  // 기본 줄과 같은 못에 넣되 가중치를 줘서 코스튬을 입은 티가 나게 한다.
  // skinOnly — 말투가 바뀌는 코스튬(한가닥 네르의 사투리 반말, 체육관 실비아의 어린 반말): 기본 줄을 섞으면 평소 말투가 새어
  // 나오므로 코스튬 줄만 쓴다 (talk-ko 의 그 코스튬에 style 이 따로 적힌 경우, 코드 리뷰)
  function pickSelfTalk(key, id, skinKey, skinOnly = false, only = "") {
    const mine = selfTalk[key] || [], skin = (skinKey && skinTalk[skinKey]) || [];
    let all = skin.length ? (skinOnly ? skin : [...mine, ...skin]) : mine;
    if (only) all = all.filter(x => x.w === only);   // 교감 직후: 그 상황 줄만 (없으면 말하지 않는다)
    if (!all.length) return null;
    const ctx = id ? selfCtx(id) : new Set();
    const fits = all.filter(x => !x.w || ctx.has(x.w) || x.w === only);   // 지금 상황에 안 맞는 꼬리표 줄은 뺀다
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
    const prof = ctx.chatProfile(id); if (!prof) return false;
    const line = pickSelfTalk(prof.key, id, prof.skinKey, !!(prof.skin && prof.styleBase && prof.style !== prof.styleBase), opts.only || ""); if (!line) return false;
    const ttl = ctx.bubbleMs(line.t);
    const who = prof.skin ? `${prof.ko} · ${prof.skin}` : prof.ko;
    ctx.showBubble(id, { items: [], text: { head: "", body: line.t, tail: "", who }, ttl });
    ctx.sendMascot(id, "emote", { mood: line.m, act: line.a, role: "speak", pose: ttl, hold: ttl + 3000 });
    if (!opts.quiet) console.log(`혼잣말[${id}] ${prof.ko}: ${line.t} [${line.m || "기본"}/${line.a}]`);
    return true;
  }
  ipcMain.on("selftalk:say", (e, id) => { const me = id || ctx.instanceOf(e.sender); if (me) saySelfTalk(me); });
  // 렌더러가 마우스를 눌렀을 때 — "오래 가만히 둠" 꼬리표를 푼다 (hit-ev 에서 부른다)
  const touch = () => { lastTouchAt = Date.now(); };
  return { lines: selfTalk, skins: skinTalk, saySelfTalk, pickSelfTalk, selfCtx, selfTalkSaid, touch };
};
