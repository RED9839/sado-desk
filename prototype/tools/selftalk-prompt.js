/* 혼잣말 대본을 다른 데(ChatGPT·Gemini 등)서 만들려면 이걸로 프롬프트를 뽑는다.
 *   node tools/selftalk-prompt.js jubee 15 > out/ask-jubee.txt
 *   node tools/selftalk-prompt.js all 15            (사도마다 out/ask/<키>.txt)
 * 받은 답은 tools/selftalk-import.js 로 넣으면 같은 잣대로 걸러진다. */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const { matches } = require(path.join(root, "tools/style-match.js"));
const J = f => JSON.parse(fs.readFileSync(path.join(root, "data", f), "utf8"));
const talk = J("talk-ko.json"), bible = J("bible.json"), vs = J("voice-samples.json");
const REFP = path.join(root, "out", "_ref-lines.json");
const REF = fs.existsSync(REFP) ? JSON.parse(fs.readFileSync(REFP, "utf8")) : {};
const keyOf = h => Object.keys(talk.heroes).find(k => k.toLowerCase() === h);

function build(h, n) {
  const p = talk.heroes[keyOf(h)] || {}, b = bible[h] || {};
  const all = REF[h] || [], on = all.filter(x => matches(x, p.style).ok === true);
  const real = (on.length >= 6 ? on : all).slice(0, 14);
  const others = Object.values(bible).filter(x => x && x.ko).map(x => x.ko);
  return [
    `모바일 게임 <트릭컬 리바이브>의 사도 "${p.ko}"가 사용자의 PC 바탕화면 한쪽에 서서 혼자 중얼거리는 말을 ${n}줄 써 주세요.`,
    `사용자(교주)는 아무 말도 하지 않았습니다. 대답을 요구하지 않는 혼잣말입니다.`,
    "",
    `■ 이 사도가 실제로 하는 말 (게임에 나오는 대사입니다. 어미를 그대로 따라 하되 내용은 베끼지 마세요)`,
    ...real.map(x => "  " + x),
    "",
    b.who ? `■ 인물\n  ${b.who}` : "",
    (b.voice || []).length ? `■ 말투\n  ${b.voice.slice(0, 4).join("\n  ")}` : "",
    b.quirk ? `■ 말버릇\n  ${b.quirk}` : "",
    `■ 부르는 말\n  자신: ${p.me || "나"} · 교주: ${p.addr || "교주"}`,
    (b.topics || []).length ? `■ 꺼낼 만한 화제\n  ${b.topics.join(" / ")}` : "",
    Object.keys(b.react || {}).length ? `■ 성격 참고\n  ${Object.entries(b.react).slice(0, 8).map(([k, v]) => `${k}: ${v}`).join("\n  ")}` : "",
    (b.never || []).length ? `■ 하지 않는 것\n  ${b.never.slice(0, 6).join(" / ")}` : "",
    "",
    "■ 규칙",
    "  1. 한 줄에 한두 문장, 15~60자. 문장마다 위 어미를 씁니다. 한 줄도 예외 없습니다.",
    "  2. 한국어 어법에 맞아야 합니다. 어미를 억지로 붙여 없는 말을 만들지 마세요(감사사와요 ×, 감사하사와요 ○).",
    `  3. 사도 이름을 정확히 씁니다(이 사도는 "${p.ko}"). 다른 사도 이름도 틀리면 안 됩니다.`,
    "  4. 화면에 무엇이 보이는지는 모릅니다. 바탕화면·창·커서 같은 '자리'는 말해도 되지만 내용은 모릅니다.",
    "  5. 이모지·이모티콘·마크다운·따옴표·번호·화자 이름 금지.",
    "  6. 게임·AI·과금 같은 바깥 이야기는 하지 않습니다.",
    "  7. 같은 소재를 되풀이하지 마세요. 줄마다 다른 이야기여야 합니다.",
    "  8. 줄 끝에 감정을 하나 붙입니다: [행복] [미소] [분노] [슬픔] [놀람] [냠냠] [삐짐] [기본]",
    "",
    "■ 형식 (이 형식만, 설명 없이)",
    `  ${(vs[h] || [])[0] || "오늘은 꽃밭을 한 바퀴 돌고 왔다."} [행복]`,
  ].filter(Boolean).join("\n");
}
const arg = (process.argv[2] || "").toLowerCase(), n = +(process.argv[3] || 15);
const ALL = Object.keys(bible).filter(k => bible[k] && bible[k].ko && keyOf(k));
if (arg === "all") {
  const dir = path.join(root, "out", "ask"); fs.mkdirSync(dir, { recursive: true });
  for (const h of ALL) fs.writeFileSync(path.join(dir, h + ".txt"), build(h, n), "utf8");
  console.log(`out/ask/ 에 ${ALL.length}개`);
} else if (ALL.includes(arg)) console.log(build(arg, n));
else console.error("사도 키를 주세요. 예: jubee, butter, all");
