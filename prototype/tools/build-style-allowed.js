// 사도별 허용 말투 갈무리 — out/_ref-lines.json(로컬 전용 참고 대사)에서 selftalk-lib 의 allowedStyles 로 센 집합을
// tools/style-allowed.json 에 쓴다. 대사는 한 글자도 들어가지 않는다(말투 이름만). 참고 대사가 바뀌면 다시 돈다:
//   node tools/build-style-allowed.js
const fs = require("fs"), path = require("path");
const lib = require("./selftalk-lib.js");
const talk = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "talk-ko.json"), "utf8"));
if (!Object.keys(lib.REF).length) { console.error("out/_ref-lines.json 이 없다 — 참고 대사가 있는 PC 에서만 새로 쓸 수 있다"); process.exit(1); }
const out = {};
for (const k of Object.keys(talk.heroes).sort()) { const h = k.toLowerCase(); if (lib.REF[h]) out[h] = [...lib.allowedStyles(h, talk.heroes[k].style || "polite")].sort(); }
fs.writeFileSync(path.join(__dirname, "style-allowed.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`style-allowed.json: ${Object.keys(out).length}명`);
