/* 코스튬(스킨)별 실제 대사를 나무위키 보관본에서 뽑아 out/_ref-skins.json 에 모은다 — 로컬 전용 참고 자료.
 * 대사표에서 코스튬 전용 줄은 끝에 "(코스튬 이름)" 꼬리표가 붙는다.
 *   node tools/build-skin-ref.js
 * 결과 키는 "사도키#스킨번호" (예: alice#1). 배포물에는 절대 넣지 않는다(v0.11.7 원칙).
 */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const talk = JSON.parse(fs.readFileSync(path.join(root, "data", "talk-ko.json"), "utf8")).heroes;
const dir = path.join(root, "out", "namu");
const norm = s => String(s).replace(/[\s·・()（）_]/g, "");

const byKo = {};
for (const f of fs.readdirSync(dir)) {
  const base = f.replace(/\.txt$/, "").replace(/^\d+_/, "").replace(/\(트릭컬 리바이브\)/, "");
  byKo[norm(base)] = f;
}
const out = {};
let costumes = 0, lines = 0, empty = [];
for (const [h, p] of Object.entries(talk)) {
  const skins = p.skins || {}; if (!Object.keys(skins).length) continue;
  const ko = p.ko || "";
  const f = [norm(ko), norm(ko.replace(/\(.*\)$/, ""))].map(c => byKo[c]).find(Boolean);
  if (!f) continue;
  const txt = fs.readFileSync(path.join(dir, f), "utf8").split(/\r?\n/);
  for (const [n, sk] of Object.entries(skins)) {
    const lab = norm(sk.label || ""); if (!lab) continue;
    const key = `${h.toLowerCase()}#${n}`;
    const got = [];
    for (const raw of txt) {
      const line = raw.trim();
      const m = /^(.*?)\s*\(([^)]{2,24})\)$/.exec(line);
      if (!m || norm(m[2]) !== lab) continue;
      const t = m[1].trim();
      if (t.length >= 4 && !/^\d/.test(t)) got.push(t);
    }
    costumes++;
    if (got.length) { out[key] = [...new Set(got)]; lines += out[key].length; }
    else empty.push(`${ko}·${sk.label}`);
  }
}
fs.writeFileSync(path.join(root, "out", "_ref-skins.json"), JSON.stringify(out, null, 1));
console.log(`코스튬 ${costumes}개 중 ${Object.keys(out).length}개에서 참고 대사 ${lines}줄 → out/_ref-skins.json`);
if (empty.length) console.log(`대사를 못 찾은 코스튬 ${empty.length}개: ${empty.slice(0, 8).join(", ")}${empty.length > 8 ? " …" : ""}`);
