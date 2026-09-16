/* 짝 전용 대사를 쓸 때 볼 자료. node tools/pair-info.js <시작> <개수> */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const B = require("./selftalk-lib.js");
const J = f => JSON.parse(fs.readFileSync(path.join(root, "data", f), "utf8"));
const bible = J("bible.json"), rel = J("relations.json");
const pairs = JSON.parse(fs.readFileSync(path.join(root, "out/duo-mine/_pairs.json"), "utf8"));
const from = +process.argv[2] || 0, n = +process.argv[3] || 6;
const callOf = (x, y) => {
  const c = ((rel[x] || {}).calls || {})[y];
  return c && c.length ? c.map(z => `${z.form}(${z.n}회)`).join(", ") : "(기록 없음)";
};
const relLine = (x, y) => {
  const ko = (bible[y] || {}).ko || y;
  return ((bible[x] || {}).rel || []).find(s => s.startsWith(ko + ":")) || null;
};
for (let i = from; i < Math.min(from + n, pairs.length); i++) {
  const { a, b, n: cnt } = pairs[i];
  const pa = B.profile(a), pb = B.profile(b);
  console.log(`════ [${i}] ${pa.ko} × ${pb.ko}   (함께 나온 횟수 ${cnt})`);
  for (const [x, y, px] of [[a, b, pa], [b, a, pb]]) {
    const bx = bible[x] || {};
    console.log(`  ${px.ko} [말투 ${px.style}] 자칭 ${px.me || "나"}`);
    console.log(`    상대를 부르는 말: ${callOf(x, y)}`);
    const r = relLine(x, y); if (r) console.log(`    관계: ${r}`);
    if (bx.quirk) console.log(`    말버릇: ${bx.quirk}`);
    if ((bx.topics || []).length) console.log(`    화제: ${bx.topics.slice(0, 5).join(" / ")}`);
    const real = (B.REF[x] || []).slice(0, 3);
    if (real.length) console.log(`    실제 대사: ${real.join(" | ").slice(0, 200)}`);
  }
  const st = ((rel[a] || {}).stories || {})[b] || [];
  if (st.length) console.log(`  함께 나온 이야기: ${st.join(", ")}`);
  console.log();
}
