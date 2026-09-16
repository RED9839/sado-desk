/* 대본을 사람이 읽기 좋게 뽑는다.
 *   node tools/script-dump.js self <시작> <개수>   혼잣말 (사도별)
 * 사도마다 인물 한 줄을 같이 찍어, 대사가 그 사도답게 나왔는지 볼 수 있게 한다.
 * (pair·duo 모드는 사도끼리 잡담을 뺄 때 함께 뺐다 — data/duo-talk.json 이 없다) */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const B = require("./selftalk-lib.js");
const J = f => JSON.parse(fs.readFileSync(path.join(root, "data", f), "utf8"));
const bible = J("bible.json");
const self = J("self-talk.json");
const from = +process.argv[3] || 0, n = +process.argv[4] || 10;

const db = self.heroes;
const keys = Object.keys(db);
for (const h of keys.slice(from, from + n)) {
  const p = B.profile(h), b = bible[h] || {};
  console.log(`════ [${keys.indexOf(h)}] ${p.ko} (${h}) [말투 ${p.style}] 자칭 ${p.me || "나"} · 교주 호칭 ${p.addr || "-"}`);
  if (b.who) console.log(`  인물: ${String(b.who).slice(0, 180)}`);
  if (b.quirk) console.log(`  말버릇: ${b.quirk}`);
  db[h].forEach(x => console.log(`    ${x.t}  [${x.a}]`));
  console.log();
}
