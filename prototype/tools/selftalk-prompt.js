/* 혼잣말 대본을 다른 데(ChatGPT·Gemini 등)서 만들려면 이걸로 프롬프트를 뽑는다.
 *   node tools/selftalk-prompt.js jubee 15 > out/ask-jubee.txt
 *   node tools/selftalk-prompt.js all 15            (사도마다 out/ask/<키>.txt)
 * 받은 답은 tools/selftalk-import.js 로 넣으면 같은 잣대로 걸러진다. */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const { matches } = require(path.join(root, "tools/style-match.js"));
const B = require(path.join(root, "tools/selftalk-lib.js"));
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
  // 실제 대사 5,090줄에서 잰 비율. 이대로 요구하지 않으면 전부 23자짜리 평서문으로 수렴한다
  //   길이 25%가 14자 이하 · 15%가 30자 이상 / 물음표 32% · 느낌표 40% · 말줄임표 21%
  const R = (r) => Math.max(1, Math.round(n * r));
  const SH = R(0.25), LO = R(0.18), QN = R(0.30), EN = R(0.40), LN = R(0.20);
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
    B.RULES(n, { one: p.ko }),
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
