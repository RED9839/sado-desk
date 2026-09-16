/* 프롬프트 덩어리를 하나씩 떼어 보며 무엇이 실제로 답을 바꾸는지 잰다.
 *   npx electron tools/prompt-ablation.js [사도수] [반복]     예) npx electron tools/prompt-ablation.js 12 2
 * 재는 것: 고유 어미(말투 뚜렷한 사도) · 호칭 적중 · 사도끼리 구별 · 답 길이 · 아낀 글자 수 */
const { app } = require("electron");
const fs = require("fs"), path = require("path");
app.setPath("userData", path.join(process.env.APPDATA, "사도 데스크"));
const root = path.join(__dirname, "..");
const ai = require(path.join(root, "ai.js"));
const { matches, matchesAny } = require(path.join(root, "tools/style-match.js"));
const J = f => JSON.parse(fs.readFileSync(path.join(root, "data", f), "utf8"));
const talk = J("talk-ko.json"), theaters = J("theaters.json").items, bible = J("bible.json"),
      rel = J("relations.json"), style = J("talk-style.json"), vs = J("voice-samples.json");
const keyOf = h => Object.keys(talk.heroes).find(k => k.toLowerCase() === h);
const koOf = k => (talk.heroes[keyOf(k)] || {}).ko || k;
function prof(hero) { const p = Object.assign({}, talk.heroes[keyOf(hero)]);
  p.key = hero; p.koOf = koOf; p.styleInfo = style[hero]; p.rel = rel[hero]; p.bible = bible[hero];
  p.sampleLines = vs[hero]; p.theaters = theaters.filter(t => (t.castKeys || []).includes(hero)).sort((a,b)=>b.season-a.season); return p; }

/** 머리글 줄과 그에 딸린(들여쓴 · '- ' 로 시작하는) 줄을 걷어낸다 */
function drop(sys, head) {
  const L = sys.split("\n");
  const i = L.findIndex(l => l.startsWith(head));
  if (i < 0) return sys;
  let j = i + 1;
  while (j < L.length && (L[j].startsWith("  ") || L[j].startsWith("- ")) && L[j] !== "규칙:") j++;
  L.splice(i, j - i);
  return L.join("\n");
}
/** 규칙 한 줄만 */
function dropLine(sys, frag) { return sys.split("\n").filter(l => !l.includes(frag)).join("\n"); }

const CASES = [
  ["기준 (그대로)",            s => s],
  ["인물 소개",                s => drop(s, "인물:")],
  ["확정 설정",                s => drop(s, "확정 설정")],
  ["성격·특징",                s => drop(s, "성격·특징:")],
  ["관계(사전)",               s => drop(s, "다른 사도와의 관계:")],
  ["원작 행적",                s => drop(s, "원작 행적:")],
  ["극장에서 보인 모습",        s => drop(s, "테마극장에서 보인 모습:")],
  ["말투 설계",                s => drop(s, "말투 설계:")],
  ["말버릇·버릇",              s => drop(s, "말버릇·버릇:")],
  ["상황별 반응",              s => drop(s, "상황별 반응")],
  ["먼저 꺼낼 화제",           s => drop(s, "먼저 꺼낼 만한 화제:")],
  ["하지 않는 것",             s => drop(s, "하지 않는 것")],
  ["감정 경향",                s => drop(s, "감정 경향")],
  ["말버릇 어미 비율(tic)",     s => drop(s, '말버릇 어미 "')],
  ["감탄사",                   s => drop(s, "자주 쓰는 감탄사:")],
  ["자주 입에 올리는 것",       s => drop(s, "자주 입에 올리는")],
  ["부르는 말(관계 실측)",      s => drop(dropLine(s, "원작 스토리에서 자주 얽히는"), "다른 사도를 부르는 말")],
  ["테마극장 줄거리",          s => drop(s, "네가 주연으로 나온 테마극장")],
  ["말투 예시(위쪽)",          s => drop(s, "말투 예시 —")],
  ["맨 끝 예시",               s => drop(s, "답 형식 예시")],
  ["'무난한 답 금지' 규칙",     s => dropLine(s, "무난한 답 금지")],
];
const QS = ["안녕! 오늘 뭐 했어?", "너 제일 좋아하는 게 뭐야?", "오늘 좀 힘들었어…"];
const words = s => new Set(String(s).replace(/[^가-힣a-zA-Z ]/g, " ").split(/\s+/).filter(w => w.length > 1));
async function call(sys, q) {
  const r = await fetch("http://localhost:11434/api/chat", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "exaone3.5:7.8b", messages: [{ role: "system", content: sys }, { role: "user", content: q }],
      stream: false, keep_alive: "10m", options: { temperature: 0.9, num_predict: 300 } }) });
  return ai.parseEmotion(((await r.json()).message || {}).content || "");
}
app.whenReady().then(async () => {
  const N = +(process.argv[2] || 12), REP = +(process.argv[3] || 2);
  const ALL = Object.keys(bible).filter(k => bible[k] && bible[k].ko && keyOf(k));
  const quirk = ALL.filter(k => { const st = (talk.heroes[keyOf(k)] || {}).style; return st && !["polite", "formal", "casual"].includes(st); });
  const plain = ALL.filter(k => !quirk.includes(k));
  const H = [...quirk.slice(0, Math.ceil(N / 2)), ...plain.filter((_, i) => i % Math.floor(plain.length / Math.floor(N / 2)) === 0).slice(0, Math.floor(N / 2))];
  const base = {};
  const out = [`프롬프트 덩어리 떼어 보기 — 사도 ${H.length}명(말투 뚜렷 ${Math.ceil(N/2)}명) × 질문 ${QS.length}개 × ${REP}회 = ${H.length*QS.length*REP}건씩`, "",
    "| 뗀 것 | 아낀 글자 | 고유 어미(답에/끝까지) | 호칭 적중 | 사도 구별(겹침) | 평균 길이 | 감정 태그 없음 |", "|---|---|---|---|---|---|---|"];
  for (const [name, fn] of CASES) {
    let any = 0, anyN = 0, last = 0, lastN = 0, addr = 0, addrN = 0, saved = 0, emoNone = 0, all = 0;
    const byQ = {};
    for (const h of H) {
      const p = prof(h); const full = ai.buildSystem(p, {}); const sys = fn(full);
      saved += full.length - sys.length;
      for (let i = 0; i < REP; i++) for (const q of QS) {
        let r; try { r = await call(sys, q); } catch { continue; }
        all++; if (!r.raw) emoNone++;
        (byQ[q] = byQ[q] || []).push(r.text);
        if (!["polite", "formal", "casual"].includes(p.style)) {
          const A = matchesAny(r.text, p.style), L = matches(r.text, p.style);
          if (A.ok !== null) { anyN++; if (A.ok) any++; }
          if (L.ok !== null) { lastN++; if (L.ok) last++; }
        }
        if (p.addr) { addrN++; if (p.addr === "교주" ? /교주(?!님)/.test(r.text) : r.text.includes(p.addr)) addr++; }
      }
    }
    let ov = 0, ovn = 0;
    for (const t of Object.values(byQ)) for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) {
      const A = words(t[i]), B = words(t[j]); if (!A.size || !B.size) continue;
      ov += [...A].filter(w => B.has(w)).length / Math.min(A.size, B.size); ovn++;
    }
    const lens = Object.values(byQ).flat().map(x => x.length);
    const pct = (a, b) => `${Math.round(a * 100 / Math.max(1, b))}%`;
    const row = `| ${name} | ${Math.round(saved / H.length)}자 | ${pct(any, anyN)} / ${pct(last, lastN)} | ${pct(addr, addrN)} | ${pct(ov, ovn)} | ${Math.round(lens.reduce((a,b)=>a+b,0)/lens.length)}자 | ${pct(emoNone, all)} |`;
    out.push(row); console.log(row);
    if (name.startsWith("기준")) Object.assign(base, { any, anyN, last, lastN });
  }
  fs.writeFileSync(path.join(root, "out", "_ablation.md"), out.join("\n") + "\n");
  console.log("\n→ out/_ablation.md");
  app.quit();
});
