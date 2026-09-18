// 대본의 특정 줄만 바꾼다 — 퇴고용. 파일 꼴:  ### 사도키  다음에  옛 문장  =>  새 문장 [감정]  (상황 꼬리표는 옛 줄의 것을 그대로 둔다)
// 새 줄은 import 와 같은 잣대(말투·어법·원문 대조·중복)로 검사하고, 걸리면 바꾸지 않는다.
//   node tools/selftalk-revise.js out/revise/r1.txt [--check]
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const B = require(path.join(root, "tools/selftalk-lib.js"));
const OUT = path.join(root, "data", "self-talk.json");
const args = process.argv.slice(2), check = args.includes("--check"), file = args.find(a => !a.startsWith("--"));
const db = JSON.parse(fs.readFileSync(OUT, "utf8")), corpus = B.loadCorpus();
let h = null, ok = 0, bad = 0, miss = 0;
for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
  const line = raw.trim(); if (!line) continue;
  if (line.startsWith("### ")) { h = line.slice(4).trim(); continue; }
  const m = line.split(/\s*=>\s*/); if (m.length !== 2 || !h) { console.log("  ? 꼴이 아니다:", line.slice(0, 60)); continue; }
  const [oldT, newRaw] = m; const bag = h.includes("#") ? db.skins : db.heroes; const L = bag[h] || [];
  const i = L.findIndex(x => x.t === oldT); if (i < 0) { miss++; console.log(`  ? 없는 줄 [${h}]: ${oldT.slice(0, 50)}`); continue; }
  const p = B.profile(h); const parsed = B.parse(newRaw)[0]; if (!parsed) { console.log("  ? 새 줄을 못 읽음:", newRaw); continue; }
  const others = L.filter((_, j) => j !== i).map(x => x.t);
  const rs = B.reasons(parsed, p, others, corpus, { solo: true });
  if (rs.length) { bad++; console.log(`  x [${rs.join(", ")}] ${h}: ${parsed.t}`); continue; }
  ok++;
  if (!check) L[i] = { ...L[i], t: parsed.t, m: parsed.m || L[i].m, a: L[i].a, ...(parsed.w ? { w: parsed.w } : {}) };
}
console.log(`${check ? "검사만: " : ""}바꿈 ${ok} · 걸림 ${bad} · 못 찾음 ${miss}`);
if (!check && ok) { fs.writeFileSync(OUT, JSON.stringify(db, null, 1) + "\n"); console.log("→ data/self-talk.json (동작 다시 붙이기: node tools/selftalk-act.js)"); }
