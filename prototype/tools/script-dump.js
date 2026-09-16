/* 대본을 사람이 읽기 좋게 뽑는다.
 *   node tools/script-dump.js pair <시작> <개수>   짝 전용 대사
 *   node tools/script-dump.js duo  <시작> <개수>   두루 통하는 잡담 (사도별)
 *   node tools/script-dump.js self <시작> <개수>   혼잣말 (사도별)
 * 사도마다 인물 한 줄과 관계를 같이 찍어, 대사가 그 사도답게 나왔는지 볼 수 있게 한다. */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const B = require("./selftalk-lib.js");
const J = f => JSON.parse(fs.readFileSync(path.join(root, "data", f), "utf8"));
const bible = J("bible.json"), rel = J("relations.json");
const duo = J("duo-talk.json"), self = J("self-talk.json");
const ko = k => ((bible[k] || {}).ko || k);
const bare = k => ko(k).replace(/\(.*\)$/, "").trim();
const kind = process.argv[2] || "pair", from = +process.argv[3] || 0, n = +process.argv[4] || 10;

if (kind === "pair") {
  const keys = Object.keys(duo.pairs);
  for (const k of keys.slice(from, from + n)) {
    const p = duo.pairs[k], pa = B.profile(p.a), pb = B.profile(p.b);
    console.log(`════ [${keys.indexOf(k)}] ${pa.ko} × ${pb.ko}`);
    for (const [x, y, px] of [[p.a, p.b, pa], [p.b, p.a, pb]]) {
      const c = ((rel[x] || {}).calls || {})[y] || [];
      const r = ((bible[x] || {}).rel || []).find(s => s.startsWith(bare(y) + ":"));
      console.log(`  ${px.ko} [말투 ${px.style}] 부르는 말: ${c.map(z => z.form).join(",") || "(기록 없음)"}`);
      if (r) console.log(`    관계: ${r.slice(0, 120)}`);
    }
    p.lines.forEach(l => console.log(`  ${(l.who === "a" ? pa.ko : pb.ko).padEnd(14)} ${l.t}`));
    console.log();
  }
} else {
  const db = kind === "self" ? self.heroes : duo.heroes;
  const keys = Object.keys(db);
  for (const h of keys.slice(from, from + n)) {
    const p = B.profile(h), b = bible[h] || {};
    console.log(`════ [${keys.indexOf(h)}] ${p.ko} (${h}) [말투 ${p.style}] 자칭 ${p.me || "나"} · 교주 호칭 ${p.addr || "-"}`);
    if (b.who) console.log(`  인물: ${String(b.who).slice(0, 180)}`);
    if (b.quirk) console.log(`  말버릇: ${b.quirk}`);
    if (kind === "self") db[h].forEach(x => console.log(`    ${x.t}  [${x.a}]`));
    else for (const g of ["open", "reply", "self"])
      db[h][g].forEach(x => console.log(`    [${g === "open" ? "먼저" : g === "reply" ? "받아" : "자기"}] ${x.t}`));
    console.log();
  }
}
