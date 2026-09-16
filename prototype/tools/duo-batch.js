/* 사도끼리 잡담 대본용 프롬프트를 묶어 낸다 (혼잣말의 duo 판).
 *   node tools/duo-batch.js 4        → out/ask-duo/duo-01.txt … (사도 4명씩)
 *   node tools/duo-batch.js 4 vivi,momo
 * 사도마다 세 묶음을 쓴다:
 *   open  먼저 건네는 말 6줄  — 상대가 누구든 통해야 하므로 이름을 쓰지 않는다
 *   reply 받는 말 6줄        — 앞말 내용을 몰라도 통하는 맞장구·되물음
 *   self  자기 자신을 만났을 때 2줄 (같은 사도를 둘 부를 수 있다)
 * 대화 한 판 = open(A) → reply(B) → open(B) → reply(A). 묶음이 스스로 완결돼야 아무 짝이나 붙는다. */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const B = require(path.join(root, "tools/selftalk-lib.js"));
const XT = k => B.XTRA[k];
const { matches } = require(path.join(root, "tools/style-match.js"));
const J = f => JSON.parse(fs.readFileSync(path.join(root, "data", f), "utf8"));
const bible = J("bible.json");

function one(h) {
  const p = B.profile(h), b = bible[h] || {};
  const all = B.REF[h] || [], on = all.filter(x => matches(x, p.style).ok === true);
  const real = (on.length >= 6 ? on : all).slice(0, 10);
  return [
    `### ${h}  — 사도 "${p.ko}"`,
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

const HEAD = [
  "모바일 게임 <트릭컬 리바이브>의 사도 둘이 바탕화면에서 마주쳤을 때 주고받을 말을 씁니다.",
  "누가 누구와 마주칠지 모릅니다. 그래서 사도마다 아래 세 묶음을 따로 씁니다.",
  "",
  "  [먼저] 6줄 — 마주친 상대에게 먼저 건네는 말. 자기 이야기나 가벼운 물음.",
  "  [받아] 6줄 — 상대가 무슨 말을 했는지 모르는 채로 받는 말. 맞장구·되물음·딴청.",
  "  [자기] 2줄 — 자기 자신과 마주쳤을 때. 똑같이 생긴 사도가 서 있는 상황입니다.",
  "",
  "대화 한 판은 [먼저](가) → [받아](나) → [먼저](나) → [받아](가) 로 이어 붙입니다.",
  "그러니 **줄 하나하나가 스스로 완결돼야** 어떤 짝에 붙여도 말이 됩니다.",
  "",
  B.RULES(6, { duo: true }),
  "",
  "■ 잡담에만 더 붙는 규칙",
  "  ㄱ. **다른 사도 이름을 쓰지 마세요.** 누가 앞에 있을지 모릅니다.",
  "     ('너', '당신', '거기', '그쪽' 처럼 그 사도가 실제로 쓰는 호칭은 됩니다.)",
  "  ㄴ. [받아] 는 앞말이 무엇이든 어색하지 않아야 합니다. 앞말 내용을 되짚지 마세요.",
  "     ○ \"음, 그건 생각해 본 적 없는걸.\"   × \"송편 얘기라면 나도 할 말이 있어!\"",
  "  ㄷ. 교주(사용자)는 이 자리에 없습니다. 교주를 부르지 마세요.",
  "  ㄹ. [자기] 는 자기 자신을 보고 하는 말입니다. 놀라거나, 재밌어하거나, 미심쩍어하거나.",
  "",
  "■ 답 형식 (설명 없이 이대로만)",
  "### <사도키>",
  "[먼저] 문장입니다. [행복]",
  "(먼저 6줄)",
  "[받아] 문장입니다. [미소]",
  "(받아 6줄)",
  "[자기] 문장입니다. [놀람]",
  "(자기 2줄)",
  "",
  "———— 아래가 사도 정보입니다 ————",
  "",
].join("\n");

const per = +(process.argv[2] || 4);
const pick = (process.argv[3] || "").toLowerCase();
const ALL = Object.keys(bible).filter(k => bible[k] && bible[k].ko && B.keyOf(k));
const HS = pick ? pick.split(",").map(x => x.trim()).filter(x => ALL.includes(x)) : ALL;
const dir = path.join(root, "out", "ask-duo"); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
let f = 0;
for (let i = 0; i < HS.length; i += per) {
  const body = HEAD + HS.slice(i, i + per).map(one).join("\n\n");
  fs.writeFileSync(path.join(dir, `duo-${String(++f).padStart(2, "0")}.txt`), body, "utf8");
}
console.log(`out/ask-duo/ 에 ${f}개 (사도 ${HS.length}명 · ${per}명씩 · 사도당 먼저6+받아6+자기2 = 14줄)`);
