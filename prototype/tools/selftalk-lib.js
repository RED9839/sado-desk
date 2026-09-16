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
// 위키에서 더 뽑은 것 — 개요·연회장 음식·생활 스킬 (tools/build-hero-extra.py, 로컬 전용)
const XP = path.join(root, "out", "_hero-extra.json");
const XTRA = fs.existsSync(XP) ? JSON.parse(fs.readFileSync(XP, "utf8")) : {};
const keyOf = h => Object.keys(talk.heroes).find(k => k.toLowerCase() === h);

const META = { note: "사도 혼잣말 대본. 우리가 쓴 글이며 게임 대사 원문이 아니다.", fields: "t=말풍선 문장 · m=감정(8종) · a=동작(애니 접두어)" };
const MOODS = ["", "happy", "smile", "anger", "sad", "surprise", "eat", "sulky"];
const TAG2MOOD = { 행복: "happy", 미소: "smile", 분노: "anger", 슬픔: "sad", 놀람: "surprise", 냠냠: "eat", 삐짐: "sulky", 기본: "" };
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
];
// 모모의 '~닷' — 앞 글자 받침이 ㅂ 일 때만 바른 꼴이다(입니닷·습니닷·립니닷·겁니닷 ○, 설렘니닷·거얌니닷 ×)
function badDat(t) {
  const m = /([가-힣])니닷/.exec(t);
  if (/닷/.test(t) && !m) return true;                       // 니닷 꼴이 아예 아님
  if (!m) return false;
  const jong = (m[1].charCodeAt(0) - 0xac00) % 28;           // 받침 번호 (ㅂ = 17)
  return jong !== 17;
}
const brokenWhy = t => { if (badDat(t)) return "…닷 앞 받침이 ㅂ이 아님"; for (const [re, w] of BROKEN) if (re.test(t)) return w; return null; };

const SIGNATURE = new Set(["royal", "vivi", "momo", "jubee", "ayla", "haso", "hao", "noun", "robot", "crepe"]);
// 말을 하지 않는 사도 — bible 의 말투 설계가 '소리와 몸짓으로만' 이라고 적어 둔 경우.
// 짧은 소리 + (몸짓 설명) 꼴이 정답이라 어미를 따질 수 없다
const SILENT = new Set(["skea"]);
const GESTURE = /^[가-힣~!?.…⋯\s]{1,12}[(（][^)）]{4,40}[)）][!?.…⋯]*$/;
const _allowed = {};
function allowedStyles(h, st) {
  if (_allowed[h]) return _allowed[h];
  const set = new Set([SAMEOF(st)]);
  const L = REF[h] || [], c = {}; let n = 0;
  for (const x of L) { const g = classify(x.split(/[.!?~…⋯]/).filter(Boolean).pop() || x); if (g) { const s = SAMEOF(g); c[s] = (c[s] || 0) + 1; n++; } }
  for (const [s, v] of Object.entries(c)) if (v / n >= 0.15) set.add(s);
  return (_allowed[h] = set);
}

function profile(h) {
  const k = keyOf(h); if (!k) return null;
  const p = Object.assign({}, talk.heroes[k]); p.key = h; p.styleInfo = style[h]; p.bible = bible[h];
  return p;
}
function normalize(s) {
  return String(s || "").replace(/^[-*\d.)\s]+/, "").replace(/^[가-힣A-Za-z]{1,8}\s*[:：]\s*/, "")
    .replace(/^["'“”]|["'“”]$/g, "").trim();
}
function parse(text) {
  const out = [];
  for (const raw of String(text || "").split("\n")) {
    const l = normalize(raw); if (!l) continue;
    const m = /^(.*?)\s*[\[(（]\s*([^\])）]{1,6})\s*[\])）]\s*$/.exec(l);
    if (!m) continue;
    const t = normalize(m[1]), tag = m[2].replace(/^감정\s*[:：]?\s*/, "").trim();
    if (!t || !(tag in TAG2MOOD)) continue;
    out.push({ t, m: TAG2MOOD[tag] });
  }
  return out;
}
function loadCorpus() {
  const set = new Set();
  for (const d of [path.join(root, "out", "namu"), path.join(root, "out", "namu-pages")]) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (!f.endsWith(".txt")) continue;
      const t = fs.readFileSync(path.join(d, f), "utf8").replace(/[\s\W_]+/g, "");
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
function reasons(line, p, seen, corpus) {
  const t = line.t, out = [];
  if (t.length < 12) out.push("너무 짧음");
  if (t.length > 70) out.push("너무 김");
  if (MD.test(t) || EMOTICON.test(t)) out.push("이모지·이모티콘·마크다운");
  if (BAN.test(t)) out.push("메타 낱말");
  if (SCREEN.test(t)) out.push("화면 내용을 아는 척");
  if (!MOODS.includes(line.m)) out.push("감정 태그 이상");
  if (/[,，]\s*$/.test(t)) out.push("쉼표로 끝남");
  const sents = t.split(/(?<=[.!?~])s+/).map(x => x.trim()).filter(Boolean);
  if (sents.length > 2) out.push("두 문장 초과");
  // 문장마다 다 그 말투여야 한다 — 한 문장만 맞으면 뒤에 딴 말투를 붙여도 통과해 버린다
  if (SILENT.has(p.key)) { if (!GESTURE.test(t)) out.push("소리+(몸짓) 꼴이 아님"); } else {
  const allow = allowedStyles(p.key, p.style);
  const got = sents.map(x => { const m = matches(x, p.style); return m.got ? SAMEOF(m.got) : null; });
  const outside = got.find(g => g && !allow.has(g));
  if (outside) out.push(`말투(${[...allow].join('/')} 아님 → ${outside})`);
  else if (got.every(g => !g)) out.push(`말투(판정불가)`);
  else if (SIGNATURE.has(SAMEOF(p.style)) && !got.includes(SAMEOF(p.style))) out.push(`말버릇 말투(${p.style})가 한 문장도 없음`);
  }
  for (const x of sents) { const w = brokenWhy(x); if (w) { out.push(w); break; } }
  const nm = wrongName(t, p); if (nm) out.push(nm);
  const ad = wrongAddr(t, p); if (ad) out.push(ad);
  const n = t.replace(/[\s\W_]+/g, "");
  for (let i = 0; i + 18 <= n.length; i++) if (corpus.has(n.slice(i, i + 18))) { out.push("위키 원문과 겹침"); break; }
  const rn = (REF[p.key] || []).map(x => x.replace(/[\s\W_]+/g, ""));
  for (let i = 0; i + 10 <= n.length; i++) { const g = n.slice(i, i + 10); if (rn.some(r => r.includes(g))) { out.push("실제 대사를 베낌"); break; } }
  const W = wordSet(t), head = t.split(/\s+/).slice(0, 2).join(" ");
  for (const s of seen) {
    const S = wordSet(s), inter = [...W].filter(x => S.has(x)).length;
    if (inter / Math.max(1, Math.min(W.size, S.size)) >= 0.35) { out.push("앞 줄과 겹침"); break; }
    if (s.split(/\s+/).slice(0, 2).join(" ") === head) { out.push("앞 줄과 시작이 같음"); break; }
  }
  return out;
}
module.exports = { XTRA, META, MOODS, TAG2MOOD, profile, normalize, parse, loadCorpus, reasons, brokenWhy, REF, keyOf };
