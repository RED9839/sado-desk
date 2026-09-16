
/* ChatGPT 같은 웹 채팅에 붙여넣기 좋게 여러 사도를 한 덩어리로 묶어 낸다.
 *   node tools/selftalk-batch.js 4 12            → out/ask/batch-01.txt … (사도 4명씩, 12줄씩)
 *   node tools/selftalk-batch.js 4 12 vivi,momo  → 특정 사도만
 * 받은 답은 그대로 파일에 저장하고:
 *   node tools/selftalk-import.js --multi out/답-01.txt
 * 답 형식은 사도마다 "### <키>" 로 나눠 달라고 프롬프트에 적어 둔다. */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const B = require(path.join(root, "tools/selftalk-lib.js"));
const XT = k => B.XTRA[k];   // 위키에서 더 뽑은 것(개요·음식·성향)
const { matches } = require(path.join(root, "tools/style-match.js"));
const J = f => JSON.parse(fs.readFileSync(path.join(root, "data", f), "utf8"));
const bible = J("bible.json"), vs = J("voice-samples.json");

function one(h, n) {
  const p = B.profile(h), b = bible[h] || {};
  const all = B.REF[h] || [], on = all.filter(x => matches(x, p.style).ok === true);
  const real = (on.length >= 6 ? on : all).slice(0, 10);
  return [
    `### ${h}  — 사도 "${p.ko}" · ${n}줄`,
    `실제 대사(어미를 그대로 따라 하되 내용은 베끼지 말 것):`,
    ...real.map(x => "  " + x),
    b.who ? `인물: ${b.who}` : "",
    (b.voice || []).length ? `말투: ${b.voice.slice(0, 3).join(" / ")}` : "",
    b.quirk ? `말버릇: ${b.quirk}` : "",
    `자신: ${p.me || "나"} · 교주 호칭: ${p.addr || "교주"}`,
    (b.topics || []).length ? `화제: ${b.topics.join(" / ")}` : "",
    Object.keys(b.react || {}).length ? `성격: ${Object.entries(b.react).slice(0, 5).map(([k, v]) => `${k}=${v}`).join(" / ")}` : "",
    (XT(h) || {}).intro ? `소개: ${XT(h).intro}` : "",
    ((XT(h) || {}).skills || []).length ? `성향 낱말: ${XT(h).skills.join(" / ")}` : "",
    ((XT(h) || {}).food || []).length ? `음식 취향(위키 연회장 기록):\n  ${XT(h).food.slice(0, 5).join("\n  ")}` : "",
    (b.never || []).length ? `하지 않는 것: ${b.never.slice(0, 4).join(" / ")}` : "",
  ].filter(Boolean).join("\n");
}
const HEAD = (n) => [
  "모바일 게임 <트릭컬 리바이브>의 사도들이 사용자의 PC 바탕화면 한쪽에 서서",
  `혼자 중얼거리는 말을 사도마다 ${n}줄씩 써 주세요. 사용자(교주)는 아무 말도 하지 않았고,`,
  "대답을 요구하지 않는 혼잣말입니다.", "",
  B.RULES(n), "",
  "■ 답 형식 (설명 없이 이대로만)",
  "### <사도키>", "문장입니다. [행복]", "문장입니다. [미소]", "",
  "———— 아래가 사도 정보입니다 ————", "",
].join("\n");

const per = +(process.argv[2] || 4), n = +(process.argv[3] || 12);
const pick = (process.argv[4] || "").toLowerCase();
const ALL = Object.keys(bible).filter(k => bible[k] && bible[k].ko && B.keyOf(k));
const HS = pick ? pick.split(",").map(x => x.trim()).filter(x => ALL.includes(x)) : ALL;
const dir = path.join(root, "out", "ask"); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
let f = 0;
for (let i = 0; i < HS.length; i += per) {
  const group = HS.slice(i, i + per);
  const body = HEAD(n) + group.map(h => one(h, n)).join("\n\n");
  fs.writeFileSync(path.join(dir, `batch-${String(++f).padStart(2, "0")}.txt`), body, "utf8");
}
console.log(`out/ask/ 에 ${f}개 (사도 ${HS.length}명 · ${per}명씩 · 사도당 ${n}줄)`);