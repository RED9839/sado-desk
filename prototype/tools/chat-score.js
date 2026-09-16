/* out/_chattest.json 을 채점한다. node tools/chat-score.js */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const ai = require(path.join(root, "ai.js"));
const SRC = process.argv[2] || "_chattest.json"; // 다른 회차와 견주려면 파일 이름을 넘긴다
const TAG = SRC.replace("_chattest", "").replace(".json", "") || "-now";
const d = JSON.parse(fs.readFileSync(path.join(root, "out", SRC), "utf8"));
const EMOK = Object.keys(ai.EMOTIONS);
const ENDS = [["royal", /(구나|느냐|거라|이니라|니라|로다|도다|말이다|것이다|하라|리라|노라|소이다|겠소|하오|시오)[!?.~…⋯]*$/],
  ["momo", /(입니닷|겁니닷|니닷|겁니깟|십숏|것입니다|겁니다)[!?.~…⋯]*$/], ["jubee", /(다비|지비|냐비|라비|비)[!?.~…⋯]*$/],
  ["formal", /(습니다|입니다|니다|십시오|습니까|입니까|슴다|임다|함다|십쇼)[!?.~…⋯]*$/],
  ["polite", /(요오*|죠오*|용|죵|에요|예요|네요|군요|세요|나요|까요)[!?.~…⋯]*$/],
  ["casual", /(다|어|야|지|해|래|자|네|군|나|거|걸|데|까|냐|니|봐|줘|아|게)[!?.~…⋯]*$/]];
const cls = s => { const c = String(s).replace(/[\s.!?~…⋯'"]+$/, ""); for (const [n, rx] of ENDS) if (rx.test(c)) return n; return null; };
// '나는 AI가 아니다' 같은 부정은 잘못이 아니다
const META = [
  [/(AI|인공지능|언어모델|언어 모델|챗봇)/i, "AI 언급"],
  [/(게임 속|게임 안|게임에서|이 게임|과금|가챠|뽑기|결제|플레이어|유저)/, "게임 취급"],
  [/(설정상|캐릭터로서|제작진|개발자|데이터베이스|학습)/, "설정 언급"],
];
const DENY = /(아니|모르|뭔 소리|뭔지|뭐야|무슨 말|무슨 소리|무슨 뜻|처음 듣|처음 들어|처음 보|들어본 적|글쎄|낯설|어색|그게 뭐|알아듣|외계어|암호 같)/;
const CODE = /```|^\s*(def|for|if|while|return|print|elif|else|class|import)\b/m;
const MD = /(\*\*|^#{1,6} |^\s*[-*] |\|\s*-{2,})/m;

function pctl(a, b) { return `${a}/${b} (${Math.round(a * 100 / Math.max(1, b))}%)`; }
const out = [];
// ===== 대화 =====
const chat = d.chat.filter(r => r.a);
const byTag = {};
for (const r of chat) (byTag[r.tag] = byTag[r.tag] || []).push(r);
let addrHit = 0, addrN = 0, endHit = 0, endN = 0, metaN = 0, codeN = 0, mdN = 0, emoBad = 0, emoNone = 0, longN = 0;
const metaEx = [], codeEx = [];
for (const r of chat) {
  if (r.addr && r.addr !== "교주") { addrN++; if (r.a.includes(r.addr)) addrHit++; }
  else if (r.addr === "교주") { addrN++; if (/교주(?!님)/.test(r.a)) addrHit++; }
  const c = cls(r.a.split(/[\n.!?~…]/).filter(Boolean).pop() || r.a);
  if (c) { endN++; if (c === r.style) endHit++; }
  for (const [rx, label] of META) {
    if (rx.test(r.a)) {

      // 답 어디에도 부정·되묻기가 없을 때만 잘못이라고 본다("과금?" 처럼 되묻고 넘기는 답을 실패로 세던 버릇)
      if (!DENY.test(r.a)) { metaN++; if (metaEx.length < 12) metaEx.push(`${r.ko} [${r.tag}] ${label}: ${r.a.trim().slice(0, 56)}`); break; }
    }
  }
  if (CODE.test(r.a)) { codeN++; if (codeEx.length < 5) codeEx.push(`${r.ko} [${r.tag}] ${r.a.slice(0, 60).replace(/\n/g, " ⏎ ")}`); }
  if (MD.test(r.a)) mdN++;
  if (!r.raw) emoNone++; else if (!r.raw.startsWith("추정:") && !EMOK.includes(r.raw)) emoBad++;
  if (r.a.length > 200) longN++;
}
out.push(`## 여러 턴 대화 — ${chat.length}건 (사도 ${new Set(chat.map(r => r.ko)).size}명 × 질문 ${Object.keys(byTag).length}개)`, "",
  "| 항목 | 값 |", "|---|---|",
  `| 호칭 적중 | ${pctl(addrHit, addrN)} |`,
  `| 어미가 프로필과 일치 | ${pctl(endHit, endN)} |`,
  `| 메타 발언(AI·게임·설정) | ${pctl(metaN, chat.length)} |`,
  `| 코드·태그 덩어리 | ${pctl(codeN, chat.length)} |`,
  `| 마크다운 남음 | ${pctl(mdN, chat.length)} |`,
  `| 감정 태그 못 붙임 | ${pctl(emoNone, chat.length)} |`,
  `| 사전에 없는 감정 | ${pctl(emoBad, chat.length)} |`,
  `| 200자 초과 | ${pctl(longN, chat.length)} |`, "");
out.push("### 질문 종류별 메타 발언");
for (const [tag, rs] of Object.entries(byTag)) {
  let n = 0;
  for (const r of rs) if (META.some(([rx]) => rx.test(r.a)) && !DENY.test(r.a)) n++;
  out.push(`  ${tag.padEnd(10)} ${pctl(n, rs.length)}`);
}
out.push("", "### 메타 발언 예", ...metaEx.map(x => "  " + x));
if (codeEx.length) out.push("", "### 코드 덩어리", ...codeEx.map(x => "  " + x));
// ===== 잡담 =====
const duo = d.duo.filter(p => p.lines);
let lineOk = 0, alt = 0, emoOkD = 0, emoTot = 0, selfTalk = 0;
const perKind = {};
for (const p of duo) {
  (perKind[p.kind] = perKind[p.kind] || { n: 0, lines: 0, four: 0 });
  perKind[p.kind].n++; perKind[p.kind].lines += p.lines.length;
  if (p.lines.length === 4) { perKind[p.kind].four++; lineOk++; }
  let ok = true; for (let i = 1; i < p.lines.length; i++) if (p.lines[i].who === p.lines[i - 1].who) ok = false;
  if (ok) alt++;
  for (const l of p.lines) { emoTot++; if (l.emotion) emoOkD++; }
  if (p.lines.some(l => l.text.includes(p.a) && l.who === "a") && p.a !== p.b) selfTalk++;
}
out.push("", `## 사도끼리 잡담 — ${duo.length}쌍 · ${emoTot}줄`, "",
  "| 항목 | 값 |", "|---|---|",
  `| 정확히 4줄 | ${pctl(lineOk, duo.length)} |`,
  `| 번갈아 말함 | ${pctl(alt, duo.length)} |`,
  `| 줄마다 감정 붙음 | ${pctl(emoOkD, emoTot)} |`, "");
for (const [k, v] of Object.entries(perKind)) out.push(`  ${k.padEnd(10)} ${v.n}쌍 · 평균 ${(v.lines / v.n).toFixed(1)}줄 · 4줄 정확 ${v.four}`);
// 서로 다른 목소리인가 — 짝 안에서 두 사람 어휘 겹침
const words = s => new Set(String(s).replace(/[^가-힣a-zA-Z ]/g, " ").split(/\s+/).filter(w => w.length > 1));
let ov = 0, ovn = 0;
for (const p of duo) { if (p.a === p.b) continue;
  const A = words(p.lines.filter(l => l.who === "a").map(l => l.text).join(" ")), B = words(p.lines.filter(l => l.who === "b").map(l => l.text).join(" "));
  if (!A.size || !B.size) continue; const inter = [...A].filter(w => B.has(w)).length;
  ov += inter / Math.min(A.size, B.size); ovn++; }
out.push("", `  짝 안에서 두 사도 어휘 겹침 평균 ${Math.round(ov * 100 / Math.max(1, ovn))}%`);
fs.writeFileSync(path.join(root, "out", "_chatscore" + TAG + ".md"), out.join("\n") + "\n");
console.log(out.join("\n"));
