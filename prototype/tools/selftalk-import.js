/* 밖에서 만든 혼잣말(ChatGPT·Gemini·손으로 쓴 것)을 data/self-talk.json 에 넣는다.
 * 만들 때와 똑같은 잣대로 거른다 — 말투·어법·이름 오타·길이·금지어·원문 대조·중복.
 *   node tools/selftalk-import.js jubee out/답.txt          (사도 하나)
 *   node tools/selftalk-import.js --multi out/답-01.txt      ("### <사도키>" 로 나뉜 여러 사도)
 *   ... --force    (버린 줄도 이유만 보고 넣기)
 */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const B = require(path.join(root, "tools/selftalk-lib.js"));
const OUT = path.join(root, "data", "self-talk.json");
const args = process.argv.slice(2);
const force = args.includes("--force");
const multi = args.includes("--multi");
const replace = args.includes("--replace");   // 기본은 합치기 — 이미 있는 줄을 지우지 않는다
const rest = args.filter(a => !a.startsWith("--"));
if (!rest.length) { console.error("쓰기: node tools/selftalk-import.js <사도키> <파일>  |  --multi <파일>"); process.exit(1); }

const db = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { _meta: B.META, heroes: {} };
const corpus = B.loadCorpus();
let total = 0, kept0 = 0;

function put(h, text) {
  const p = B.profile(h);
  if (!p) { console.log(`  ? 모르는 사도 키: ${h}`); return; }
  const parsed = B.parse(text);
  const had = replace ? [] : (db.heroes[h] || []);
  const seen = had.map(x => x.t);
  const kept = [], dropped = [];
  for (const line of parsed) {
    const rs = B.reasons(line, p, [...seen, ...kept.map(x => x.t)], corpus);
    if (rs.length && !force) { dropped.push([line.t, rs.join(", ")]); continue; }
    if (rs.length) dropped.push([line.t, rs.join(", ") + " (그래도 넣음)"]);
    kept.push(line);
  }
  db.heroes[h] = [...had, ...kept];
  console.log(`${p.ko.padEnd(14)} +${kept.length}/${parsed.length}줄 → ${db.heroes[h].length}줄` + (dropped.length ? `  버림: ${[...new Set(dropped.map(d => d[1]))].slice(0, 4).join(", ")}` : ""));
  if (process.env.VERBOSE) for (const [t, why] of dropped) console.log(`    [${why}] ${t}`);
}

if (multi) {
  const text = fs.readFileSync(rest[0], "utf8");
  // "### jubee" 또는 "### jubee — 사도 …" 로 나뉜 덩어리
  const parts = text.split(/^\s*#{2,4}\s*/m).filter(x => x.trim());
  for (const part of parts) {
    const m = /^([A-Za-z0-9_]+)/.exec(part.trim());
    if (!m) continue;
    put(m[1].toLowerCase(), part.slice(m[0].length));
  }
} else put(rest[0].toLowerCase(), fs.readFileSync(rest[1], "utf8"));

fs.writeFileSync(OUT, JSON.stringify(db, null, 1), "utf8");
console.log(`\n합계 ${kept0}/${total}줄 → data/self-talk.json`);
console.log("동작 붙이기: node tools/selftalk-act.js");
