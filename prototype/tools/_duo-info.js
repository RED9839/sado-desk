/* 잡담 대본을 손으로 쓸 때 볼 자료를 간추려 낸다. node tools/_duo-info.js <시작> <개수> */
const fs = require("fs");
const B = require("./selftalk-lib.js");
const bible = JSON.parse(fs.readFileSync(__dirname + "/../data/bible.json", "utf8"));
const { matches } = require("./style-match.js");
const miss = JSON.parse(fs.readFileSync(process.env.TEMP + "/duo-miss.json", "utf8"));
const from = +process.argv[2] || 0, n = +process.argv[3] || 6;
for (const h of miss.slice(from, from + n)) {
  const p = B.profile(h), b = bible[h] || {}, x = B.XTRA[h] || {};
  const all = B.REF[h] || [], on = all.filter(y => matches(y, p.style).ok === true);
  console.log(`════ ${h}  ${p.ko}  [말투 ${p.style}] 자신=${p.me || "나"}`);
  ((on.length >= 5 ? on : all).slice(0, 6)).forEach(y => console.log("  · " + y));
  if (b.who) console.log("인물: " + String(b.who).slice(0, 230));
  if ((b.voice || []).length) console.log("말투: " + b.voice.slice(0, 3).join(" / ").slice(0, 300));
  if (b.quirk) console.log("말버릇: " + b.quirk);
  if ((b.topics || []).length) console.log("화제: " + b.topics.join(" / "));
  console.log();
}
