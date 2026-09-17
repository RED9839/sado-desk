/* 검토에서 나온 고칠 줄을 한꺼번에 반영한다. data/self-talk.json 과 out/selftalk-when/*.txt 를 같이 고친다.
 *   node tools/selftalk-patch.js out/check/fixes-g2.tsv
 * 파일 형식(탭 구분): <사도키>\t<지금 줄(꼬리표 [아침] 이 붙어 있어도 된다)>\t<바꿀 줄>
 */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const P = path.join(root, "data/self-talk.json");
const db = JSON.parse(fs.readFileSync(P, "utf8"));
const strip = s => s.replace(/^\s*-\s*/, "").replace(/^\[[^\]]{1,8}\]\s*/, "").replace(/\s*<[^>]{1,12}>\s*$/, "").trim();
const src = fs.readFileSync(process.argv[2], "utf8");
const rows = process.argv[2].endsWith(".json")
  ? JSON.parse(src)                                  // [["사도키", "지금 줄", "바꿀 줄"], ...]
  : src.split(/\r?\n/).map(l => l.split("\t")).filter(c => c.length >= 3 && c[0].trim() && !c[0].startsWith("#"));
const drafts = fs.existsSync(path.join(root, "out/selftalk-when"))
  ? fs.readdirSync(path.join(root, "out/selftalk-when")).filter(f => /^w\d+\.txt$/.test(f)) : [];
const dtext = new Map(drafts.map(f => [f, fs.readFileSync(path.join(root, "out/selftalk-when", f), "utf8")]));
let ok = 0; const miss = [];
for (const c of rows) {
  const key = c[0].trim(), oldT = strip(c[1]), newT = strip(c[2]);
  const arr = db.heroes[key] || [];
  const i = arr.findIndex(l => l.t === oldT);
  if (i < 0) { miss.push(`${key} / ${oldT.slice(0, 30)}`); continue; }
  arr[i].t = newT; ok++;
  for (const [f, t] of dtext) if (t.includes(oldT)) dtext.set(f, t.split(oldT).join(newT));
}
fs.writeFileSync(P, JSON.stringify(db, null, 1), "utf8");
for (const [f, t] of dtext) fs.writeFileSync(path.join(root, "out/selftalk-when", f), t, "utf8");
console.log(`고친 줄 ${ok}/${rows.length}` + (miss.length ? `\n못 찾음:\n  ${miss.join("\n  ")}` : ""));
