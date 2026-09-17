/* data/self-talk.json 에 이미 들어간 줄을 지금 잣대로 다시 검사한다 (고치지 않는다).
 *   node tools/selftalk-audit.js            전체
 *   node tools/selftalk-audit.js jubee,ner  몇 명만
 *   ... --tagged / --plain                  상황줄만 / 예전 줄만
 */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const B = require(path.join(root, "tools/selftalk-lib.js"));
const args = process.argv.slice(2);
const only = (args.find(a => !a.startsWith("--")) || "").split(",").filter(Boolean);
const wantTagged = args.includes("--tagged"), wantPlain = args.includes("--plain");
const db = (() => { const j = JSON.parse(fs.readFileSync(path.join(root, "data/self-talk.json"), "utf8")); return { ...j.heroes, ...(j.skins || {}) }; })();
const corpus = B.loadCorpus();
let bad = 0, tot = 0;
for (const key of Object.keys(db)) {
  if (only.length && !only.includes(key)) continue;
  const p = B.profile(key); if (!p) { console.log(`? 모르는 사도 ${key}`); continue; }
  const seen = [];
  for (const l of db[key]) {
    if (wantTagged && !l.w) { seen.push(l.t); continue; }
    if (wantPlain && l.w) { seen.push(l.t); continue; }
    tot++;
    const rs = B.reasons({ t: l.t, m: l.m || "", w: l.w }, p, seen, corpus, { solo: true });
    seen.push(l.t);
    if (rs.length) { bad++; console.log(`${key}\t[${rs.join(", ")}]\t${l.w ? "[" + B.WHEN_KO[l.w] + "] " : ""}${l.t}`); }
  }
}
console.log(`\n검사 ${tot}줄 중 걸린 줄 ${bad}`);
