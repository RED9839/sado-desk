/* 혼잣말 대본을 거르는 잣대 — 만들 때(build-selftalk.js)와 밖에서 가져올 때(selftalk-import.js)가 같은 자를 쓴다.
 * 걸러 내는 게 요점이다. 생성기는 무엇이든(ollama·Gemini·ChatGPT·사람) 바꿔 끼울 수 있다. */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const { matches, classify, SAME } = require(path.join(root, "tools/style-match.js"));
const SAMEOF = s => SAME[s] || s;
const J = f => JSON.parse(fs.readFileSync(path.join(root, "data", f), "utf8"));
const talk = J("talk-ko.json"), bible = J("bible.json"), style = J("talk-style.json"), vs = J("voice-samples.json");
const REFP = path.join(root, "out", "_ref-lines.json");
const REF = fs.existsSync(REFP) ? JSON.parse(fs.readFileSync(REFP, "utf8")) : {};
// 코스튬(스킨) 실제 대사 — tools/build-skin-ref.js 가 만든다. 키는 "사도키#스킨번호"
const SKINREFP = path.join(root, "out", "_ref-skins.json");
if (fs.existsSync(SKINREFP)) Object.assign(REF, JSON.parse(fs.readFileSync(SKINREFP, "utf8")));
// 같은 인물의 다른 미니미는 참고 대사를 같이 쓴다 — 리뉴아는 프론티어 시절(Mini_Renewa)과
// 각성판(Mini_RenewaAwaken)이 따로 있는데 대사표는 각성판 하나뿐이다. 이걸 이어 주지 않으면
// 원형 쪽은 허용 말투가 시그니처 하나로 좁아지고, 원문 베끼기 검사도 아예 돌지 않는다
const ALIAS = { renewa: "renewaawaken" };
for (const [k, from] of Object.entries(ALIAS)) if (!REF[k] && REF[from]) REF[k] = REF[from];
// 위키에서 더 뽑은 것 — 개요·연회장 음식·생활 스킬 (tools/build-hero-extra.py, 로컬 전용)
const XP = path.join(root, "out", "_hero-extra.json");
const XTRA = fs.existsSync(XP) ? JSON.parse(fs.readFileSync(XP, "utf8")) : {};
const keyOf = h => Object.keys(talk.heroes).find(k => k.toLowerCase() === h);

const META = { note: "사도 혼잣말 대본. 우리가 쓴 글이며 게임 대사 원문이 아니다.", fields: "t=말풍선 문장 · m=감정(8종) · a=동작(애니 접두어)" };
const MOODS = ["", "happy", "smile", "anger", "sad", "surprise", "eat", "sulky"];
const TAG2MOOD = { 행복: "happy", 미소: "smile", 분노: "anger", 슬픔: "sad", 놀람: "surprise", 냠냠: "eat", 삐짐: "sulky", 기본: "" };
// 상황 꼬리표 — 줄 앞에 [밤] 처럼 붙는다. 없으면 언제나 나올 수 있는 줄
const WHEN = { 아침: "morning", 낮: "day", 저녁: "evening", 밤: "night", 심야: "late", 주말: "weekend", 던진뒤: "thrown", 쓰다듬은뒤: "petted", 꿀밤뒤: "poked", 오래방치: "idle" };
const WHEN_KO = Object.fromEntries(Object.entries(WHEN).map(([k, v]) => [v, k]));
const BAN = /(AI|인공지능|언어모델|챗봇|게임 속|이 게임|과금|가챠|플레이어|유저|설정상|캐릭터로서|개발자|프롬프트)/i;
const SCREEN = /(화면에 (보이|뭐)|뭐 보고 있|무슨 작업|코딩|유튜브|영상 보|게임 하고 있)/;
const MD = /[*_`#|]|```|[\u{1F300}-\u{1FAFF}\u{2600}-\u27BF\u{FE0F}]/u;
const EMOTICON = /(\^\^|ㅠㅠ|ㅜㅜ|ㅎㅎ|ㅋㅋ|＞＜|T_T|:\)|:\()/;
// 모델이 어미를 억지로 붙여 만드는 없는 말. 겪는 대로 늘린다
const BROKEN = [
  [/[요죠네다까]\s*사와요/, "어미 겹침(…요사와요)"],
  [/(사와요|이와요)[^가-힣]*(사와요|이와요)/, "어미 두 번"],
  [/(감사사와요|감탄사와요|기뻐사와요|좋아사와요|가득사와요|아시사와요|즐기사와요)/, "없는 말(…사와요)"],
  [/\[[^\]]{1,8}\]/, "대괄호 꼬리표가 남음"],
  [/[A-Za-z]{3,}/, "영어 낱말"],
  [/(니다|습니다|어요|아요)\s*비[!?.]?\s*$/, "어미 겹침(…다비 아님)"],
  [/(겟|졋|괜찬|됫|햇는|갓다|앗어)/, "맞춤법(겠·졌·괜찮)"],   // 손으로 쓸 때 자꾸 나오던 오타. 말풍선에 그대로 뜬다
];
// 모모의 '~닷' — 앞 글자 받침이 ㅂ 일 때만 바른 꼴이다(입니닷·습니닷·립니닷·겁니닷 ○, 설렘니닷·거얌니닷 ×)
function badDat(t) {
  // 낱말 속 '닷'(바닷물·바닷가·바닷바람)은 어미가 아니다 — 뒤에 한글이 이어지면 넘긴다
  if (!/닷(?![가-힣])/.test(t)) return false;
  const m = /([가-힣])니닷(?![가-힣])/.exec(t);
  if (!m) return true;                                       // 니닷 꼴이 아예 아님
  const jong = (m[1].charCodeAt(0) - 0xac00) % 28;           // 받침 번호 (ㅂ = 17)
  return jong !== 17;
}
const brokenWhy = t => { if (badDat(t)) return "…닷 앞 받침이 ㅂ이 아님"; for (const [re, w] of BROKEN) if (re.test(t)) return w; return null; };

const SIGNATURE = new Set(["royal", "vivi", "momo", "jubee", "ayla", "haso", "hao", "noun", "robot", "crepe"]);
// 말을 하지 않는 사도 — bible 의 말투 설계가 '소리와 몸짓으로만' 이라고 적어 둔 경우.
// 짧은 소리 + (몸짓 설명) 꼴이 정답이라 어미를 따질 수 없다
const SILENT = new Set(["skea"]);
const GESTURE = /^[가-힣~!?.…⋯\s]{1,12}[(（][^)）]{4,40}[)）][!?.…⋯]*$/;
// 참고 대사(out/, 로컬 전용)에서 센 사도별 허용 말투의 갈무리 — 대사 자체가 아니라 말투 이름의 집합이라 저장소에 둔다.
// 참고 대사가 없는 환경(CI, 다른 PC)에서는 이걸 읽어 같은 판정을 낸다. tools/build-style-allowed.js 가 새로 쓴다
const ALLOWEDP = path.join(root, "tools", "style-allowed.json");
const ALLOWED = fs.existsSync(ALLOWEDP) ? JSON.parse(fs.readFileSync(ALLOWEDP, "utf8")) : {};
const skinStyleOf = (h) => { const [hero, n] = h.split("#"); const k = keyOf(hero); const sk = k && n && (talk.heroes[k].skins || {})[n]; return (sk && sk.style) || null; };
const _allowed = {};
function allowedStyles(h, st) {
  if (_allowed[h]) return _allowed[h];
  const set = new Set([SAMEOF(st)]);
  // 코스튬 키는 그 사도가 평소 쓰는 말투를 그대로 물려받는다. 코스튬 참고 대사가 없으면
  // 여기가 시그니처 하나로 쪼그라들어, 모모의 '~것입니다' 같은 평소 어미까지 막혔다
  // 다만 talk-ko 의 그 코스튬에 style 이 따로 적혀 있으면(말투가 바뀌는 코스튬 — 한가닥 네르의 사투리 반말, 체육관 실비아의 어린 반말)
  // 본편 말투를 물려받지 않는다. 물려받으면 옷만 험하게 입은 평소 네르가 통과했다(코드 리뷰)
  if (h.includes("#") && !skinStyleOf(h)) for (const s of allowedStyles(h.split("#")[0], st)) set.add(s);
  if (!REF[h] && ALLOWED[h]) { for (const s of ALLOWED[h]) set.add(s); return (_allowed[h] = set); }
  const L = REF[h] || [], c = {}; let n = 0;
  for (const x of L) { const g = classify(x.split(/[.!?~…⋯]/).filter(Boolean).pop() || x); if (g) { const s = SAMEOF(g); c[s] = (c[s] || 0) + 1; n++; } }
  // 문턱 15% 는 인물 사전이 명시한 말투까지 막았다 — 버터는 자료에 "코미에겐 반말" 이라고
  // 이름까지 찍혀 있는데 실제 대사의 반말이 12.9% 라 반말을 못 썼다. 10% 로 내린다.
  // 그 사도 자신의 대사 열 줄에 한 줄꼴이면 그 말투를 실제로 쓰는 것이다.
  for (const [s, v] of Object.entries(c)) if (v / n >= 0.10) set.add(s);
  return (_allowed[h] = set);
}

// h 가 "alice#1" 꼴이면 그 코스튬의 프로필 — 기본 사도 위에 스킨 보정(호칭·말투·감탄사)을 얹는다
function profile(h) {
  const [hero, skinNo] = String(h).split("#");
  const k = keyOf(hero); if (!k) return null;
  const p = Object.assign({}, talk.heroes[k]); p.key = h; p.styleInfo = style[hero]; p.bible = bible[hero];
  if (skinNo) {
    const sk = (talk.heroes[k].skins || {})[skinNo]; if (!sk) return null;
    p.skinLabel = sk.label;
    if (sk.style) p.style = sk.style;
    if (sk.addr) p.addr = sk.addr;
    if (sk.interj && sk.interj.length) p.interj = sk.interj;
  }
  return p;
}
function normalize(s) {
  // 목록 번호("1. ", "- ")만 떼야 한다. 예전 규칙은 [-*\d.)\s]+ 라서
  // "2인자 자리는…" 의 2, "210호가…" 의 210 처럼 문장 첫 숫자를 통째로 먹었다.
  return String(s || "").replace(/^[-*\s]*\d+[.)]\s+|^[-*·•]\s+/, "").replace(/^[가-힣A-Za-z]{1,8}\s*[:：]\s*/, "")
    .replace(/^["'“”]|["'“”]$/g, "").trim();
}
function parse(text) {
  const out = [];
  for (const raw of String(text || "").split("\n")) {
    const l = normalize(raw); if (!l) continue;
    const m = /^(.*?)\s*[\[(（]\s*([^\])）]{1,6})\s*[\])）]\s*$/.exec(l);
    if (!m) continue;
    let body = m[1], w;
    const wm = /^[\[(（]\s*([가-힣]{1,5})\s*[\])）]\s*(.*)$/.exec(body.trim()); // 앞의 [상황]
    if (wm && wm[1] in WHEN) { w = WHEN[wm[1]]; body = wm[2]; }
    const t = normalize(body), tag = m[2].replace(/^감정\s*[:：]?\s*/, "").trim();
    if (!t || !(tag in TAG2MOOD)) continue;
    out.push(w ? { t, m: TAG2MOOD[tag], w } : { t, m: TAG2MOOD[tag] });
  }
  return out;
}
function loadCorpus() {
  const set = new Set();
  for (const d of [path.join(root, "out", "namu"), path.join(root, "out", "namu-pages")]) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (!f.endsWith(".txt")) continue;
      const t = fs.readFileSync(path.join(d, f), "utf8").replace(/[^\uac00-\ud7a3a-zA-Z0-9]+/g, "");
      for (let i = 0; i + 18 <= t.length; i++) set.add(t.slice(i, i + 18));
    }
  }
  return set;
}
const wordSet = s => new Set(String(s).replace(/[^가-힣a-zA-Z ]/g, " ").split(/\s+/).filter(w => w.length > 1));
// 사도 이름을 틀리게 쓰는 일이 잦다(크레페 → 크리페, 스피키 → 스피커)
const KO_NAMES = [...new Set(Object.values(bible).filter(x => x && x.ko).map(x => x.ko.replace(/\(.*\)$/, "")))];
let _common = null;
function commonWords() {
  if (_common) return _common;
  _common = new Set();
  const JOSA = /(은|는|이|가|을|를|의|에|도|만|와|과|랑|로|으로|께|한테|에게|에서|부터|까지|야|아|님)$/;
  for (const L of Object.values(REF)) for (const s of L)
    for (const w of s.match(/[가-힣]{2,6}/g) || []) { _common.add(w); _common.add(w.replace(JOSA, "")); }
  return _common;
}
// 교주를 엉뚱한 이름으로 부르는 것 — 이 세상에 없는 직함들. 사도마다 제 호칭이 따로 있다
const OUTSIDE_TITLE = /(목사님|신부님|수녀님|스님|박사님|의사님|교수님|사모님|고객님|회원님|시청자|구독자)/;
function wrongAddr(t, p) {
  const m = OUTSIDE_TITLE.exec(t);
  if (m && m[1] !== p.addr) return `엉뚱한 호칭(${m[1]} — 이 사도는 ${p.addr})`;
  return null;
}

function wrongName(t, p) {
  // 조사가 붙으므로 낱말로 자르지 않고 창을 밀며 본다. 첫 글자가 같고 한 글자만 다르면 오타로 본다
  const cands = [p.ko.replace(/\(.*\)$/, "")];
  for (const n of KO_NAMES) if (n[0] === cands[0][0] && !cands.includes(n)) cands.push(n);
  const common = commonWords();
  for (const name of cands) {
    if (name.length < 3) continue;   // 두 글자 이름은 흔한 낱말과 너무 잘 겹친다
    if (name.length < 2 || t.includes(name)) continue;   // 제대로 쓴 이름이 있으면 통과
    for (let i = 0; i + name.length <= t.length; i++) {
      const w = t.slice(i, i + name.length);
      if (!/^[가-힣]+$/.test(w) || w[0] !== name[0]) continue;
      let diff = 0; for (let k = 0; k < name.length; k++) if (w[k] !== name[k]) diff++;
      if (diff === 1 && !common.has(w)) return `이름 오타(${w} ≠ ${name})`;
    }
  }
  return null;
}
// 혼잣말에서만 막는 것 — 듣는 사람이 없는데 말을 거는 꼴.
// 잡담·짝 대사는 앞에 상대가 있으므로 이 검사를 쓰지 않는다(opts.solo 로 켠다).
const YOU = /(^|[^가-힣])(너|넌|널|네가|네놈|너희|당신|그대|자네|너도|너를|너한테|네게)([^가-힣]|$)/;
const ASK = /(주세요|주십시오|주시죠|보실래요|보시죠|해 보세요|말씀해|드릴까요|봐 주|알려 주|들어 보|와 주|해 주실|하시죠)/;
function reasons(line, p, seen, corpus, opts) {
  const solo = opts && opts.solo;
  const t = line.t, out = [];
  if (solo && YOU.test(t)) out.push("혼잣말인데 상대를 지목함");
  if (solo && ASK.test(t)) out.push("혼잣말인데 상대에게 청함");
  if (t.length < 7) out.push("너무 짧음");   // 실제 대사의 최소가 8자다. 7자 미만은 "히힛." "후후." 같은 감탄사뿐이라 사도를 가리지 못한다
  // (짧은 줄의 원문 대조는 아래에서 통째로 맞춰 본다 — 정규화 4~8자면 포함 검사가 제대로 걸러진다)
  if (t.length > 70) out.push("너무 김");
  if (MD.test(t) || EMOTICON.test(t)) out.push("이모지·이모티콘·마크다운");
  if (BAN.test(t)) out.push("메타 낱말");
  if (SCREEN.test(t)) out.push("화면 내용을 아는 척");
  if (!MOODS.includes(line.m)) out.push("감정 태그 이상");
  if (/[,，]\s*$/.test(t)) out.push("쉼표로 끝남");
  const sents = t.split(/(?<=[.!?~])\s+/).map(x => x.trim()).filter(Boolean);
  // 감탄사·의성어("어?" "우와!" "찰칵!" "흐음.")는 문장으로 세지 않는다 — 띄어쓰기 없는 세 글자 이하.
  // 이걸 문장으로 세면 "우와! 정말요? 저는 몰랐어요!" 가 세 문장이 되고, 감탄사에 말투 판정까지 붙는다.
  // 감탄사·웃음: 띄어쓰기가 없고 네 글자 이하이거나, "아하하하하" 처럼 같은 소리를 되풀이한 것
  const isInterj = (x) => { const k = x.replace(/[^가-힣]/g, ""); return !/\s/.test(x) && (k.length <= 4 || (k.length <= 6 && new Set(k).size <= 3)); };
  const said = sents.filter(x => !isInterj(x));
  const body = said.length ? said : sents;   // 감탄사뿐인 줄이면 그것이라도 본다
  if (body.length > 2) out.push("두 문장 초과");
  // 문장마다 다 그 말투여야 한다 — 한 문장만 맞으면 뒤에 딴 말투를 붙여도 통과해 버린다
  if (SILENT.has(p.key.split("#")[0])) { if (!GESTURE.test(t)) out.push("소리+(몸짓) 꼴이 아님"); } else {
  const allow = allowedStyles(p.key, p.style);
  const got = body.map(x => { const m = matches(x, p.style); return m.got ? SAMEOF(m.got) : null; });
  const outside = got.find(g => g && !allow.has(g));
  if (outside) out.push(`말투(${[...allow].join('/')} 아님 → ${outside})`);
  else if (got.every(g => !g)) out.push(`말투(판정불가)`);
  else if (SIGNATURE.has(SAMEOF(p.style)) && !got.includes(SAMEOF(p.style))) out.push(`말버릇 말투(${p.style})가 한 문장도 없음`);
  }
  for (const x of body) { const w = brokenWhy(x); if (w) { out.push(w); break; } }
  const nm = wrongName(t, p); if (nm) out.push(nm);
  const ad = wrongAddr(t, p); if (ad) out.push(ad);
  const n = t.replace(/[^\uac00-\ud7a3a-zA-Z0-9]+/g, "");
  for (let i = 0; i + 18 <= n.length; i++) if (corpus.has(n.slice(i, i + 18))) { out.push("위키 원문과 겹침"); break; }
  // 코스튬 키("alice#1")면 기본 차림의 대사와도 대조한다 — 평소 게임 대사를 베끼는 것도 막아야 한다
  const refKeys = p.key.includes("#") ? [p.key, p.key.split("#")[0]] : [p.key];
  const rn = refKeys.flatMap(k => REF[k] || []).map(x => x.replace(/[^\uac00-\ud7a3a-zA-Z0-9]+/g, ""));
  // 원문 대조는 두 방향이다. 8자로 내렸다 — 10자였을 때 "건드리다니→던지다니" 처럼 한 마디만 바꾼 줄이 통과했다
  const CP = 8;
  let copied = n.length < CP ? rn.some(r => r.includes(n)) : false;
  if (!copied) for (let i = 0; i + CP <= n.length; i++) { const g = n.slice(i, i + CP); if (rn.some(r => r.includes(g))) { copied = true; break; } }
  if (!copied) copied = rn.some(r => r.length >= 6 && n.includes(r));   // 원문이 짧으면(기억해두겠습니다) 통째로 품고도 8-gram 을 피해 갔다
  if (copied) out.push("실제 대사를 베낌");
  const W = wordSet(t), head = t.split(/\s+/).slice(0, 2).join(" ");
  for (const s of seen) {
    const S = wordSet(s), inter = [...W].filter(x => S.has(x)).length;
    if (inter / Math.max(1, Math.min(W.size, S.size)) >= 0.35) { out.push("앞 줄과 겹침"); break; }
    if (s.split(/\s+/).slice(0, 2).join(" ") === head) { out.push("앞 줄과 시작이 같음"); break; }
  }
  return out;
}
/* 만들 때 줄 잣대. 세 도구(batch·gaps·prompt)가 같은 것을 쓴다.
 * 비율은 실제 대사 5,090줄에서 잰 값 — 이걸 요구하지 않으면 전부 23자짜리 평서문으로 수렴한다.
 *   길이 25%가 14자 이하 · 15%가 30자 이상 / 물음표 32% · 느낌표 40% · 말줄임표 21% */
// 잡담용: 다른 사도 이름이 들어갔는지. 짝이 누구일지 모르므로 이름을 쓰면 안 된다.
// "잡아야" 안의 "아야"처럼 낱말 속에 묻힌 것은 이름이 아니다 — 앞은 한글이 아니어야 하고
// 뒤는 조사·호칭이거나 한글이 아니어야 한다.
const PARTICLE = "님|씨|이|가|은|는|을|를|와|과|도|랑|이랑|에게|한테|의|야|아|께|만|랑은|보다";
function otherName(t, p) {
  const mine = String(p.ko || "").replace(/\(.*\)$/, "").trim();
  // 수량 단위 앞에 수·관형사가 오면 사도 이름이 아니다 ("곰 한 마리", "세 마리")
  const t2 = t.replace(/(한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|몇|\d+)\s*마리/g, " ");
  for (const ko of KO_NAMES) {
    if (ko === mine || ko.length < 2) continue;
    const re = new RegExp(`(^|[^가-힣])${ko}(${PARTICLE})?($|[^가-힣])`);
    if (re.test(t2)) return ko;
  }
  return null;
}

function RULES(n, opt) {
  const o = opt || {};
  const R = r => Math.max(1, Math.round(n * r));
  const mi = o.mine ? "'이미 쓴 줄'과 소재가 겹치면 안 됩니다. " : "같은 소재를 되풀이하지 마세요. 줄마다 다른 이야기여야 합니다.";
  const who = o.one ? `이 사도는 "${o.one}"입니다. ` : "";
  return [
    "■ 규칙",
    "  1. 길이를 일부러 흩뜨립니다. 전부 비슷한 길이면 사람이 쓴 말로 보이지 않습니다.",
    `     ${n}줄 중 짧은 줄(10~14자) ${R(0.25)}줄 이상, 긴 줄(30~50자·두 문장) ${R(0.18)}줄 이상을 꼭 섞습니다.`,
    "     나머지는 15~29자. 어떤 줄도 60자를 넘지 않습니다.",
    `  2. ${o.duo ? "주고받는 말" : "혼잣말"}이 평서문만 있는 것은 아닙니다. 아래 실제 대사를 보면 이 사도들은`,
    `     - 셋에 하나꼴로 묻습니다. ${R(0.30)}줄쯤은 물음표로 끝내세요.${o.duo ? "" : " 답을 바라는 물음이 아니라 혼자 갸웃하는 것입니다."}`,
    `     - 다섯에 둘꼴로 느낌표를 씁니다. ${R(0.40)}줄쯤.`,
    `     - 다섯에 하나꼴로 말끝을 흐립니다(…). ${R(0.20)}줄쯤.`,
    "     - 감탄사·숨소리를 섞습니다. 실제 대사에서 그 사도가 실제로 쓰는 것만 골라 쓰세요.",
    "  3. 문장마다 그 사도의 어미를 씁니다. 한 줄도 예외 없습니다.",
    "  4. 한국어 어법에 맞아야 합니다. 어미를 억지로 붙여 없는 말을 만들지 마세요(감사사와요 ×, 감사하사와요 ○).",
    o.duo ? `  5. ${who}자기 이름은 정확히 씁니다. (다른 사도 이름은 아래 잡담 규칙대로 쓰지 않습니다.)`
          : `  5. ${who}사도 이름을 정확히 씁니다. 다른 사도 이름도 틀리면 안 됩니다.`,
    "  6. 화면에 무엇이 보이는지는 모릅니다. 바탕화면·창·커서 같은 '자리'는 말해도 되지만 내용은 모릅니다.",
    "  7. 이모지·이모티콘·마크다운·따옴표·번호·화자 이름 금지.",
    "  8. 게임·AI·과금 같은 바깥 이야기는 하지 않습니다.",
    `  9. ${mi}`,
    "     특히 다른 사도도 똑같이 할 법한 말은 쓰지 마세요. '혼자라 쓸쓸하다', '빈 자리가 허전하다' 같은",
    "     말은 누구나 할 수 있어서 그 사도의 말이 아닙니다. 소개·성향·음식 취향·화제에서 그 사도만의 것을 집으세요.",
    "  10. 줄 끝에 감정을 하나 붙입니다: [행복] [미소] [분노] [슬픔] [놀람] [냠냠] [삐짐] [기본]",
    "",
    "■ 다 쓰고 스스로 볼 것 (하나라도 아니면 고쳐 쓰세요)",
    "  - 가장 짧은 줄이 15자 아래인가? 가장 긴 줄이 30자 위인가?",
    "  - 물음표·느낌표·말줄임표가 저마다 들어갔는가?",
    "  - 모든 줄이 '무엇을 했어요' 한 가지 꼴로 끝나지는 않는가?",
    "  - 그 사도가 아니면 할 수 없는 말인가?",
  ].join("\n");
}

module.exports = { allowedStyles, RULES, otherName, XTRA, META, MOODS, TAG2MOOD, WHEN, WHEN_KO, profile, normalize, parse, loadCorpus, reasons, brokenWhy, REF, keyOf };
