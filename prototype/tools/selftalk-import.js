/* 밖에서 만든 혼잣말(ChatGPT·Gemini·손으로 쓴 것)을 data/self-talk.json 에 넣는다.
 * 만들 때와 똑같은 잣대로 거른다 — 말투·어법·이름 오타·길이·금지어·원문 대조·중복.
 *   node tools/selftalk-import.js jubee out/답.txt          (사도 하나)
 *   node tools/selftalk-import.js --multi out/답-01.txt      ("### <사도키>" 로 나뉜 여러 사도)
 *   ... --force    (버린 줄도 이유만 보고 넣기)
 *   ... --check    (넣지 않고 검사만 — 줄마다 걸린 이유를 찍는다)
 *   ### alice#1  처럼 쓰면 그 코스튬(스킨)의 대사로 들어간다 — 참고 대사·말투도 코스튬 것으로 검사한다
 *   ... --when     (상황 꼬리표 [밤] 같은 것이 없는 줄은 버린다 — 상황 대본 넣을 때)
 */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const B = require(path.join(root, "tools/selftalk-lib.js"));
const OUT = path.join(root, "data", "self-talk.json");
const args = process.argv.slice(2);
const force = args.includes("--force");
const multi = args.includes("--multi");
const replace = args.includes("--replace");   // 기본은 합치기 — 이미 있는 줄을 지우지 않는다
const check = args.includes("--check"), when = args.includes("--when");
const rest = args.filter(a => !a.startsWith("--"));
if (!rest.length) { console.error("쓰기: node tools/selftalk-import.js <사도키> <파일>  |  --multi <파일>"); process.exit(1); }

const db = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { _meta: B.META, heroes: {} };
if (!db.skins) db.skins = {};   // 코스튬(스킨) 전용 줄 — 키는 "사도키#스킨번호"
const corpus = B.loadCorpus();
let total = 0, kept0 = 0;

function put(h, text) {
  const p = B.profile(h);
  if (!p) { console.log(`  ? 모르는 사도 키: ${h}`); return; }
  const parsed = B.parse(text);
  const bag = h.includes("#") ? db.skins : db.heroes;
  const had = replace ? [] : (bag[h] || []);
  const seen = had.map(x => x.t);
  const kept = [], dropped = [];
  for (const line of parsed) {
    const rs = B.reasons(line, p, [...seen, ...kept.map(x => x.t)], corpus, { solo: true });
    if (when && !line.w) rs.push("상황 꼬리표 없음");
    if (rs.length && !force) { dropped.push([line.t, rs.join(", ")]); continue; }
    if (rs.length) dropped.push([line.t, rs.join(", ") + " (그래도 넣음)"]);
    kept.push(line);
  }
  total += parsed.length; kept0 += kept.length;
  if (!check) bag[h] = [...had, ...kept];
  if (check) { for (const [t, why] of dropped) console.log(`  x [${why}] ${t}`); console.log(`${(p.ko + (p.skinLabel ? "·" + p.skinLabel : "")).padEnd(20)} 통과 ${kept.length}/${parsed.length}` + (!h.includes("#") && kept.length < 18 ? "  <- 18줄 못 채움" : "")); return; }
  console.log(`${(p.ko + (p.skinLabel ? "·" + p.skinLabel : "")).padEnd(20)} +${kept.length}/${parsed.length}줄 → ${bag[h].length}줄` + (dropped.length ? `  버림: ${[...new Set(dropped.map(d => d[1]))].slice(0, 4).join(", ")}` : ""));
  if (process.env.VERBOSE) for (const [t, why] of dropped) console.log(`    [${why}] ${t}`);
}

if (multi) {
  const text = fs.readFileSync(rest[0], "utf8");
  // "### jubee" 또는 "### jubee — 사도 …" 로 나뉜 덩어리
  const parts = text.split(/^\s*#{2,4}\s*/m).filter(x => x.trim());
  for (const part of parts) {
    const m = /^([A-Za-z0-9_]+(?:#[0-9]+)?)/.exec(part.trim());   // alice 또는 alice#1(코스튬)
    if (!m) continue;
    put(m[1].toLowerCase(), part.slice(m[0].length));
  }
} else put(rest[0].toLowerCase(), fs.readFileSync(rest[1], "utf8"));

if (check) { console.log(`검사만: 통과 ${kept0}/${total}줄 (넣지 않음)`); process.exit(kept0 === total ? 0 : 1); }
fs.writeFileSync(OUT, JSON.stringify(db, null, 1), "utf8");
console.log(`\n합계 ${kept0}/${total}줄 → data/self-talk.json`);
console.log("동작 붙이기: node tools/selftalk-act.js");
