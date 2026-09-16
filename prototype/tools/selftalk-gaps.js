
/* 모자란 사도만 골라 '이어서 채울' 프롬프트를 낸다. 이미 통과한 줄은 '겹치지 말 것'으로 넣는다.
 *   node tools/selftalk-gaps.js 12            → out/ask-gaps/gap-01.txt … (기준 12줄)
 *   node tools/selftalk-gaps.js 12 --list     → 모자란 사도만 보기
 */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const B = require(path.join(root, "tools/selftalk-lib.js"));
const XT = k => B.XTRA[k];   // 위키에서 더 뽑은 것(개요·음식·성향)
const { matches } = require(path.join(root, "tools/style-match.js"));
const J = f => JSON.parse(fs.readFileSync(path.join(root, "data", f), "utf8"));
const bible = J("bible.json");
const OUT = path.join(root, "data", "self-talk.json");
const db = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { heroes: {} };
const WANT = +(process.argv[2] || 12);
const need = Object.keys(bible).filter(k => bible[k] && bible[k].ko && B.keyOf(k))
  .map(k => ({ k, ko: bible[k].ko, have: (db.heroes[k] || []).length }))
  .filter(x => x.have < WANT).sort((a, b) => a.have - b.have);
if (process.argv.includes("--list")) {
  console.log(`모자란 사도 ${need.length}명 · 더 받아야 할 줄 ${need.reduce((a, x) => a + WANT - x.have, 0)}`);
  for (const x of need) console.log(`  ${x.ko.padEnd(16)} ${x.have}/${WANT}`);
  process.exit(0);
}
function block(x) {
  const p = B.profile(x.k), b = bible[x.k] || {};
  const all = B.REF[x.k] || [], on = all.filter(s => matches(s, p.style).ok === true);
  const real = (on.length >= 6 ? on : all).slice(0, 10);
  const mine = (db.heroes[x.k] || []).map(l => l.t);
  return [
    `### ${x.k}  — 사도 "${x.ko}" · ${WANT - x.have}줄 더`,
    `실제 대사(어미를 그대로 따라 하되 내용은 베끼지 말 것):`,
    ...real.map(s => "  " + s),
    b.who ? `인물: ${b.who}` : "",
    (b.voice || []).length ? `말투: ${b.voice.slice(0, 3).join(" / ")}` : "",
    b.quirk ? `말버릇: ${b.quirk}` : "",
    `자신: ${p.me || "나"} · 교주 호칭: ${p.addr || "교주"}`,
    (b.topics || []).length ? `화제: ${b.topics.join(" / ")}` : "",
    Object.keys(b.react || {}).length ? `성격: ${Object.entries(b.react).slice(0, 5).map(([k, v]) => `${k}=${v}`).join(" / ")}` : "",
    (XT(x.k) || {}).intro ? `소개: ${XT(x.k).intro}` : "",
    ((XT(x.k) || {}).skills || []).length ? `성향 낱말: ${XT(x.k).skills.join(" / ")}` : "",
    ((XT(x.k) || {}).food || []).length ? `음식 취향(위키 연회장 기록):\n  ${XT(x.k).food.slice(0, 5).join("\n  ")}` : "",
    (b.never || []).length ? `하지 않는 것: ${b.never.slice(0, 4).join(" / ")}` : "",
    mine.length ? `이미 쓴 줄(겹치지 말 것):\n  ${mine.join("\n  ")}` : "",
  ].filter(Boolean).join("\n");
}
const HEAD = [
  "모바일 게임 <트릭컬 리바이브>의 사도들이 사용자의 PC 바탕화면 한쪽에 서서",
  "혼자 중얼거리는 말을 씁니다. 사도마다 필요한 줄 수가 다르니 표시된 수만큼만 쓰세요.",
  "사용자(교주)는 아무 말도 하지 않았고, 대답을 요구하지 않는 혼잣말입니다.", "",
  "■ 규칙",
  "  1. 한 줄에 한두 문장, 15~60자. 문장마다 그 사도의 어미를 씁니다. 한 줄도 예외 없습니다.",
  "  2. 한국어 어법에 맞아야 합니다. 어미를 억지로 붙여 없는 말을 만들지 마세요(감사사와요 ×, 감사하사와요 ○).",
  "  3. 사도 이름을 정확히 씁니다. 다른 사도 이름도 틀리면 안 됩니다.",
  "  4. 화면에 무엇이 보이는지는 모릅니다. 바탕화면·창·커서 같은 '자리'는 말해도 되지만 내용은 모릅니다.",
  "  5. 이모지·이모티콘·마크다운·따옴표·번호·화자 이름 금지.",
  "  6. 게임·AI·과금 같은 바깥 이야기는 하지 않습니다.",
  "  7. '이미 쓴 줄'과 소재가 겹치면 안 됩니다. 소개·성향·음식 취향을 골고루 씁니다.",
  "  8. 줄 끝에 감정 하나: [행복] [미소] [분노] [슬픔] [놀람] [냠냠] [삐짐] [기본]", "",
  "■ 답 형식 (설명 없이 이대로만)",
  "### <사도키>", "문장입니다. [행복]", "",
  "———— 아래가 사도 정보입니다 ————", "",
].join("\n");
const dir = path.join(root, "out", "ask-gaps"); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
const PER = 8;
let f = 0;
for (let i = 0; i < need.length; i += PER) {
  const g = need.slice(i, i + PER);
  fs.writeFileSync(path.join(dir, `gap-${String(++f).padStart(2, "0")}.txt`), HEAD + g.map(block).join("\n\n"), "utf8");
}
console.log(`모자란 사도 ${need.length}명 · ${need.reduce((a, x) => a + WANT - x.have, 0)}줄 → out/ask-gaps/ 에 ${f}개`);