// 사도 몇 명의 자료를 한눈에 — 상황 혼잣말을 손으로 쓸 때 본다. node tools/_brief.js key1,key2
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const B = require("./selftalk-lib.js");
const { matches } = require("./style-match.js");
const bible = JSON.parse(fs.readFileSync(path.join(root, "data/bible.json"), "utf8"));
const self = JSON.parse(fs.readFileSync(path.join(root, "data/self-talk.json"), "utf8")).heroes;
const vs = JSON.parse(fs.readFileSync(path.join(root, "data/voice-samples.json"), "utf8"));
for (const h of process.argv[2].split(",")) {
  const p = B.profile(h), b = bible[h] || {};
  const all = B.REF[h] || [], on = all.filter(x => matches(x, p.style).ok === true);
  const real = (on.length >= 6 ? on : all).slice(0, 7);
  console.log(`\n### ${h}  ${p.ko} · 말투=${p.style} · 자칭=${p.me || "나"} · 교주=${p.addr || "교주"}`);
  console.log("실제(말투만):", real.join(" | "));
  console.log("지은 예:", (vs[h] || []).join(" | "));
  if (b.who) console.log("누구:", String(b.who).slice(0, 160));
  if (b.voice) console.log("말투:", (b.voice || []).slice(0, 3).join(" / "));
  if (b.quirk) console.log("말버릇:", b.quirk);
  console.log("화제:", (b.topics || []).slice(0, 8).join(" / "));
  if (b.react) console.log("반응:", Object.entries(b.react).slice(0, 5).map(([k, v]) => k + ":" + v).join(" / ").slice(0, 300));
  if (b.never) console.log("안함:", (b.never || []).slice(0, 5).join(" / "));
  console.log("기존:", (self[h] || []).map(l => l.t).join(" | "));
}
