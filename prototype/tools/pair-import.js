/* 짝 전용 대사를 data/duo-talk.json 의 pairs 에 넣는다.
 *   node tools/pair-import.js <파일…> [--replace]
 * 열쇠는 두 사도 키를 사전순으로 "a|b" 로 맞춘다 — 만나는 차례와 무관하게 찾히도록. */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const B = require(path.join(root, "tools/selftalk-lib.js"));
const corpus = B.loadCorpus();
const OUT = path.join(root, "data", "duo-talk.json");
const args = process.argv.slice(2);
const replace = args.includes("--replace");
const files = args.filter(a => !a.startsWith("--"));
if (!files.length) { console.error("쓰기: node tools/pair-import.js <파일…> [--replace]"); process.exit(1); }

const db = JSON.parse(fs.readFileSync(OUT, "utf8"));
if (replace || !db.pairs) db.pairs = {};
const KYOJU = /(교주|주인님|사장님)/;
let kept = 0, total = 0, skipped = [];
for (const f of files) {
  const TEXT = fs.readFileSync(f, "utf8").replace(/\r\n?/g, "\n");
  for (const part of TEXT.split(/^\s*#{2,4}\s*/m)) {
    const mk = /^([A-Za-z0-9_]+)\s*\|\s*([A-Za-z0-9_]+)/.exec(part.trim()); if (!mk) continue;
    const [, A, C] = mk, pa = B.profile(A), pc = B.profile(C);
    if (!pa || !pc) { skipped.push(`모르는 키 ${!pa ? A : C}`); continue; }
    const koA = pa.ko.replace(/\(.*\)$/, "").trim(), koC = pc.ko.replace(/\(.*\)$/, "").trim();
    const rows = [], seen = [];
    let bad = 0;
    for (const raw of part.slice(part.indexOf("\n") + 1).split(/\n/)) {
      const m = /^\s*\[(가|나)\]\s*(.+)$/.exec(raw); if (!m) continue;
      const parsed = B.parse(m[2]); if (!parsed.length) { bad++; continue; }
      const side = m[1], me = side === "가" ? pa : pc, you = side === "가" ? koC : koA;
      const bare = parsed[0].t.split(you).join(" ");
      const rs = B.reasons({ ...parsed[0], t: bare }, me, seen, corpus).filter(x => !/^다른 사도 이름/.test(x));
      const other = B.otherName(bare, me); if (other && other !== you) rs.push("제3의 사도 이름");
      if (KYOJU.test(parsed[0].t)) rs.push("교주를 부름");
      total++;
      if (rs.length) { bad++; continue; }
      seen.push(parsed[0].t);
      rows.push({ who: side === "가" ? "a" : "b", ...parsed[0] });
    }
    const shape = rows.length === 4 && rows.every((r, i) => r.who === (i % 2 ? "b" : "a"));
    if (!shape || bad) { skipped.push(`${koA}×${koC}(${rows.length}줄${bad ? `, 걸림 ${bad}` : ""})`); continue; }
    // 열쇠는 사전순
    const [x, y] = [A, C].sort();
    const flip = x !== A;   // 파일의 '가' 가 사전순 뒤쪽이면 뒤집어 저장
    db.pairs[`${x}|${y}`] = { a: x, b: y, lines: rows.map(r => ({ ...r, who: flip ? (r.who === "a" ? "b" : "a") : r.who })) };
    kept += rows.length;
  }
}
fs.writeFileSync(OUT, JSON.stringify(db, null, 1), "utf8");
console.log(`짝 ${Object.keys(db.pairs).length}쌍 · 넣은 줄 ${kept}/${total}`);
if (skipped.length) console.log(`건너뜀 ${skipped.length}: ${skipped.slice(0, 8).join(", ")}${skipped.length > 8 ? " …" : ""}`);
