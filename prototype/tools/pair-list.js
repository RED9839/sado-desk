/* 짝 전용 대사를 만들 짝 목록을 고정된 차례로 뽑는다 (out/duo-mine/_pairs.json).
 * relations.json 의 with(함께 나온 횟수)를 쓰고, 양쪽 다 잡담 대본이 있는 짝만 남긴다.
 * 많이 엮인 짝이 앞에 오도록 정렬 — 앞쪽부터 만들면 자주 보이는 짝이 먼저 채워진다. */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const rel = JSON.parse(fs.readFileSync(path.join(root, "data/relations.json"), "utf8"));
const duo = JSON.parse(fs.readFileSync(path.join(root, "data/duo-talk.json"), "utf8")).heroes;
const seen = new Set(), pairs = [];
for (const [h, v] of Object.entries(rel)) for (const [o, n] of Object.entries(v.with || {})) {
  if (!duo[h] || !duo[o] || h === o) continue;
  const [a, b] = [h, o].sort();
  const k = a + "|" + b; if (seen.has(k)) continue; seen.add(k);
  pairs.push({ a, b, n });
}
pairs.sort((x, y) => y.n - x.n || (x.a + x.b).localeCompare(y.a + y.b));
const out = path.join(root, "out", "duo-mine", "_pairs.json");
fs.writeFileSync(out, JSON.stringify(pairs), "utf8");
console.log(`짝 ${pairs.length}쌍 → out/duo-mine/_pairs.json (함께 나온 횟수 많은 순)`);
console.log(`  4줄씩이면 ${pairs.length * 4}줄`);
