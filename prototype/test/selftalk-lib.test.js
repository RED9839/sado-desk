// 혼잣말 검사기 — 대본을 넣기 전에 거르는 잣대. 원문 대조 자료(out/)는 저장소에 없으니 그 부분은 자료가 있을 때만 돈다.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const B = require("../tools/selftalk-lib.js");
const EMPTY = new Set();
const why = (key, text, opts = {}) => { const p = B.profile(key); assert.ok(p, key + " 프로필"); const l = B.parse(text)[0]; assert.ok(l, "parse 실패: " + text); return B.reasons(l, p, opts.seen || [], opts.corpus || EMPTY, { solo: true }); };

test("parse — [상황] 앞꼬리표와 [감정] 뒤꼬리표를 읽는다", () => {
  assert.deepEqual(B.parse("[밤] 밤이야. [기본]"), [{ t: "밤이야.", m: "", w: "night" }]);
  assert.equal(B.parse("[밤] 밤이야. [기본]")[0].w, "night");
  assert.equal(B.parse("감정 꼬리표 없는 줄").length, 0);
  assert.equal(B.parse("모르는 감정 [황홀]").length, 0);
});

test("멀쩡한 줄은 통과한다 — 반말·해요·하게체", () => {
  assert.deepEqual(why("alice", "카드는 거짓말을 안 해. 뭐, 내가 가끔 비틀긴 하지만. [미소]"), []);
  assert.deepEqual(why("hilde", "꾀병 환자라도 반가워요. 진료를 볼 수 있으니까요. [기본]"), []);
  assert.deepEqual(why("haleysane", "망상에서 스스로 걸어 나왔네. 그 길은 참으로 길었지. [기본]"), []);
});

test("혼잣말인데 상대에게 청하거나 지목하면 걸린다", () => {
  assert.ok(why("alice", "카드 좀 뽑아 주세요. [기본]").some(r => r.includes("청함")));
  assert.ok(why("hilde", "네가 그렇게 말하니 그런가 봐요. [기본]").length > 0);
});

test("두 문장 초과는 걸리고, 감탄사는 문장으로 세지 않는다", () => {
  assert.ok(why("alice", "카드를 뽑았어. 뒤집어 봤어. 결과는 비밀이야. [기본]").includes("두 문장 초과"));
  assert.deepEqual(why("alice", "으히히! 카드를 뽑았어. 결과는 비밀이야. [미소]"), []);   // 웃음은 안 센다
  assert.deepEqual(why("alice", "우와! 정말 그런 카드가 나왔어. [미소]"), []);
});

test("말투가 정체성인 사도는 그 어미가 한 문장은 있어야 한다", () => {
  assert.ok(why("momo", "소생은 닌자입니다. 임무를 시작합니다. [기본]").some(r => r.includes("momo")));
  assert.deepEqual(why("momo", "소생은 닌자인 것입니다. 임무를 시작하는 겁니닷! [기본]"), []);
  assert.ok(why("vivi", "소녀는 은의 용족이에요. [기본]").some(r => r.includes("vivi")));
  assert.deepEqual(why("vivi", "소녀는 은의 용족이와요. [기본]"), []);
});

test("모모의 ~닷 은 앞 받침이 ㅂ일 때만 — '바닷물'·'바닷바람' 은 걸리지 않는다", () => {
  assert.ok(why("momo", "임무 완료닷! [행복]").some(r => r.includes("닷")));
  assert.deepEqual(why("momo", "바닷바람이 좋은 것입니다. 훈련하기 딱 좋은 날입니닷! [행복]"), []);
});

test("코스튬 키는 본편 사도의 허용 말투를 물려받는다 (참고 대사 없는 코스튬이 시그니처 하나로 좁아지던 결함)", () => {
  // momo#4 는 참고 대사가 없다. 본편에서 허용되는 '~것입니다' 가 코스튬에서도 통과해야 한다
  assert.deepEqual(why("momo#4", "눈 위에는 발자국이 남는 것입니다. 닌자에게 이건 치명적인 겁니닷! [슬픔]"), []);
  const p = B.profile("momo#4"); assert.equal(p.skinLabel, "스위트 닌자 스노우"); assert.equal(p.style, "momo");
});

test("스키아(말을 못 함)는 소리+(몸짓) 꼴만 통과한다", () => {
  assert.deepEqual(why("skea", "…! (고개를 끄덕인다) [기본]"), []);
  assert.ok(why("skea", "오늘은 날씨가 좋네. [기본]").some(r => r.includes("몸짓")));
});

test("앞 줄과 낱말이 많이 겹치면 걸린다", () => {
  const seen = ["카드는 거짓말을 안 해. 내가 가끔 비틀긴 하지만."];
  assert.ok(why("alice", "카드는 거짓말을 안 해. 내가 가끔 비틀긴 해. [기본]", { seen }).some(r => r.includes("겹침")));
});

test("영어 낱말·메타 표현은 걸린다", () => {
  assert.ok(why("alice", "오늘은 happy 한 날이야. [행복]").length > 0);
  assert.ok(why("alice", "나는 AI 가 만든 캐릭터야. [기본]").length > 0);
});

const REF = path.join(__dirname, "..", "out", "_ref-lines.json");
test("게임 대사 원문과 8자 이상 겹치면 걸린다 (로컬 참고 자료가 있을 때만)", { skip: !fs.existsSync(REF) && "out/_ref-lines.json 없음" }, () => {
  const ref = JSON.parse(fs.readFileSync(REF, "utf8"));
  const [key, lines] = Object.entries(ref).find(([k, v]) => !k.includes("#") && v.length && B.profile(k)) || [];
  assert.ok(key, "참고 대사가 있는 사도");
  const real = lines.find(l => l.replace(/[^가-힣]/g, "").length >= 10);
  assert.ok(why(key, real + " [기본]").some(r => r.includes("원문") || r.includes("베")), key + ": 원문 그대로가 통과했다");
});
