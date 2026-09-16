/* 대본 줄의 내용을 보고 어울리는 동작(애니 접두어)을 붙인다.
 * 애니 이름은 모델이 모르므로 규칙으로 고른다. 스킨에 그 애니가 없으면 mascot.js 가 감정 풀로 떨어진다.
 * 접두어 목록은 tools/anim-survey.mjs 로 137명을 조사한 결과(renderer/motion-voice.js 머리말) 기준. */
// 혼잣말(self-talk.json)과 잡담(duo-talk.json) 둘 다에 붙인다 — 규칙을 두 벌로 두면 어긋난다.
//   node tools/selftalk-act.js          → 둘 다
//   node tools/selftalk-act.js duo      → 잡담만
const fs = require("fs"), path = require("path");
const DATA = path.join(__dirname, "..", "data");
// 앞에서부터 첫 매치. 전원이 가진 접두어(Angry Eat Happy Idle Pat Sad Touch Smash Tickle Close)를 먼저,
// 다수가 가진 것(Blank Panic Shy Surprise Sulky Dance Serious Sorry Talk Taunt Proud Thinking Tired Smile)은 뒤에
const RULES = [
  [/(졸리|졸려|자고|낮잠|잠들|하품|피곤|나른)/, "Tired"],
  [/(먹어|먹을|먹고|먹는|맛있|배고|한 입|드세|식사|요리|간식 좀)/, "Eat"],
  [/(춤|노래|흥얼|리듬)/, "Dance"],
  [/(청소|치우|정리|닦)/, "Clean"],
  [/(생각|고민|궁금|뭐였더라|기억이 안|어디였)/, "Thinking"],
  [/(놀리|메롱|장난|골탕)/, "Taunt"],
  [/(자랑|대단|최고|완벽|멋지)/, "Proud"],
  [/(부끄|민망|쑥스|얼굴이 붉)/, "Shy"],
  [/(미안|죄송|사과)/, "Sorry"],
  [/(놀랐|깜짝|헉|어라|이럴 수가)/, "Surprise"],
  [/(화나|짜증|용서|훔쳐|도둑|가만 안)/, "Angry"],
  [/(슬프|아쉽|외로|울)/, "Sad"],
  [/[?？]\s*$/, "Question"],
];
const BY_MOOD = { happy: "Happy", smile: "Smile", anger: "Angry", sad: "Sad", surprise: "Surprise", eat: "Eat", sulky: "Sulky", "": "Talk" };
const which = (process.argv[2] || "").toLowerCase();
const FILES = [];
if (which !== "duo") FILES.push(["self-talk.json", "self"]);
if (which !== "self") FILES.push(["duo-talk.json", "duo"]);
for (const [file, kind] of FILES) {
const OUT = path.join(DATA, file);
if (!fs.existsSync(OUT)) { console.log(`${file} 없음 — 건너뜀`); continue; }
const db = JSON.parse(fs.readFileSync(OUT, "utf8"));
// 혼잣말은 사도마다 줄 배열, 잡담은 {open, reply, self} 꾸러미
const groups = kind === "self" ? Object.values(db.heroes)
  : [...Object.values(db.heroes).flatMap(h => [h.open || [], h.reply || [], h.self || []]),
     ...Object.values(db.pairs || {}).map(p => p.lines || [])];   // 짝 전용 대사도 함께
let n = 0, byAct = {};
for (const lines of groups) for (const l of lines) {
  // 감정이 뚜렷하면(화남·슬픔·놀람) 그것이 먼저다. 낱말 규칙을 먼저 보면 꿀·꽃꿀이 화제인 사도가 전부 Eat 으로 쏠린다
  const STRONG = ["anger", "sad", "surprise"];
  let act = STRONG.includes(l.m) ? BY_MOOD[l.m] : null;
  if (!act) for (const [re, a] of RULES) if (re.test(l.t)) { act = a; break; }
  if (!act) act = BY_MOOD[l.m] || "Talk";
  l.a = act; n++; byAct[act] = (byAct[act] || 0) + 1;
}
fs.writeFileSync(OUT, JSON.stringify(db, null, 1), "utf8");
console.log(`${file}: ${n}줄에 동작을 붙였다`);
console.log("  " + Object.entries(byAct).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · "));
}
