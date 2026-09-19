// ai.js 의 순수 부분 — 감정 꼬리표·잡음 제거·말풍선 자르기·스트림 파서·Gemini 끊김 처리.
// 네트워크는 fetch 를 가짜로 바꿔서 시험한다.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Ai = require("../ai.js");
const { stripNoise, partialField, ndjson, sse, chatGemini } = Ai._test;

test("parseEmotion — 정식 꼬리표, 비틀린 꼬리표, 괄호 감정, 없음", () => {
  assert.deepEqual(pick(Ai.parseEmotion("안녕이다비!\n[감정:행복]")), ["안녕이다비!", "happy"]);
  assert.deepEqual(pick(Ai.parseEmotion("흥. **[감정:분노]**")), ["흥.", "anger"]);
  assert.deepEqual(pick(Ai.parseEmotion("{감정: 슬픔} 비가 오네요.")), ["비가 오네요.", "sad"]);
  assert.equal(Ai.parseEmotion("(꿀밤을 때린다) 아얏").text, "(꿀밤을 때린다) 아얏"); // 지문 괄호는 남긴다
  assert.equal(Ai.parseEmotion("그냥 문장.").text, "그냥 문장.");
});
const pick = r => [r.text, r.emotion];

test("stripNoise — 코드 블록·마크다운·이모지·머리말 줄을 걷어낸다", () => {
  assert.equal(stripNoise("```python\nprint(1)\n```\n안녕"), "안녕");
  assert.equal(stripNoise("**굵게** 말하고 _기울여_ 말함"), "굵게 말하고 기울여 말함");
  assert.equal(stripNoise("좋아요 😀🎉"), "좋아요");
  assert.equal(stripNoise("대답 예시:\n진짜 답"), "진짜 답");
  assert.equal(stripNoise("끝에 별표가 남았다 **"), "끝에 별표가 남았다");
});

test("trimToBubble — 문장 수·글자 수로 자르되 문장 중간에서 끊지 않는다", () => {
  const four = "하나야. 둘이야. 셋이야. 넷이야.";
  assert.equal(Ai.trimToBubble(four), "하나야. 둘이야. 셋이야.");
  const long = "가".repeat(100) + ". " + "나".repeat(100) + ".";
  assert.equal(Ai.trimToBubble(long), "가".repeat(100) + ".");   // 140자 넘으면 뒤 문장을 뺀다
  assert.equal(Ai.trimToBubble("한 문장만."), "한 문장만.");
  assert.equal(Ai.trimToBubble(""), "");
});

test("partialField — 스트리밍 중 반쯤 온 JSON 에서 reply 값을 뽑는다", () => {
  assert.equal(partialField('{"reply": "안녕', "reply"), "안녕");
  assert.equal(partialField('{"reply":"줄\n바꿈 \\"인용\\"', "reply"), '줄\n바꿈 "인용"');
  assert.equal(partialField('{"emotion":"행복","reply"', "reply"), null);   // 값이 아직 안 왔다
  assert.equal(partialField('{"emotion":"행복"}', "reply"), null);
});

test("sampleLinesFor — 지은 예문을 먼저, 상황 꼬리표 없는 대본 줄을 다음에", () => {
  const own = ["예문1", "예문2"];
  const lines = [{ t: "밤줄", w: "night" }, { t: "무태그A" }, { t: "무태그B" }, { t: "아침줄", w: "morning" }];
  const out = Ai.sampleLinesFor(own, lines, 3);           // max 는 대본에서 고르는 수 — 지은 예문은 그 위에 통째로 붙는다(3 + 12 = 15 표본)
  assert.deepEqual(out, ["예문1", "예문2", "무태그A", "무태그B", "밤줄"]); // 무태그 먼저, 모자라면 태그 줄로 채운다
  assert.deepEqual(Ai.sampleLinesFor([], lines, 2), ["무태그A", "무태그B"]);
  assert.deepEqual(Ai.sampleLinesFor(["무태그A"], lines, 1), ["무태그A", "무태그B"]); // 예문과 겹치는 줄은 다시 안 뽑는다
});

test("pickOllamaModel — 그래픽카드 메모리에 따라 세 등급", () => {
  assert.equal(Ai.pickOllamaModel({ vramGB: 16, ramGB: 64 }).model, "qwen2.5:14b");
  assert.equal(Ai.pickOllamaModel({ vramGB: 8, ramGB: 32 }).model, "exaone3.5:7.8b");
  assert.equal(Ai.pickOllamaModel({ vramGB: null, ramGB: 8 }).model, "exaone3.5:2.4b");
});

// ---- 스트림 ----
const stream = (chunks) => new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(new TextEncoder().encode(x)); c.close(); } });
const collect = async (it) => { const out = []; for await (const x of it) out.push(x); return out; };

test("ndjson/sse — 줄이 청크 경계에서 쪼개져도, 끝에 개행이 없어도 전부 나온다", async () => {
  const lines = await collect(ndjson(stream(["a\nb", "c\n", "d"])));
  assert.deepEqual(lines, ["a", "bc", "d"]);
  const ev = await collect(sse(stream(['data: {"x":1}\r\n\r\n', 'data: [DONE]\r\n', 'data: {"x":2}'])));
  assert.deepEqual(ev, ['{"x":1}', '{"x":2}']);
});

// Gemini SSE 응답을 흉내 낸다. events: [{text, finish}] — finish 가 있으면 그 이벤트에 finishReason 을 붙인다
const gemini = (events) => stream(events.map(e => "data: " + JSON.stringify({ candidates: [{ content: { parts: e.text ? [{ text: e.text }] : [] }, ...(e.finish ? { finishReason: e.finish } : {}) }] }) + "\r\n\r\n"));
function fakeFetch(responses) { // 부를 때마다 다음 응답
  const calls = []; let i = 0;
  const f = async (url, opt) => { calls.push(JSON.parse(opt.body)); const r = responses[Math.min(i++, responses.length - 1)]; return { ok: true, status: 200, body: r, headers: new Map(), text: async () => "" }; };
  f.calls = calls; return f;
}
const cfg = { model: "gemini-flash-latest" }, msgs = [{ role: "user", text: "안녕" }];
const silent = () => {};

test("chatGemini — 정상 종료(STOP) 는 그대로", async () => {
  const orig = globalThis.fetch; globalThis.fetch = fakeFetch([gemini([{ text: "안녕이다비! " }, { text: "오늘도 꿀이다비." }, { finish: "STOP" }])]);
  try { assert.equal(await chatGemini(cfg, "k", "sys", msgs, silent, undefined), "안녕이다비! 오늘도 꿀이다비."); }
  finally { globalThis.fetch = orig; }
});

test("chatGemini — 끝 이벤트 없이 닫힌 스트림: 문장이 맺혔으면 그대로 쓴다", async () => {
  const orig = globalThis.fetch; const f = fakeFetch([gemini([{ text: "안녕이다비! " }, { text: "오늘도 꿀이다비." }])]); globalThis.fetch = f;
  try { assert.equal(await chatGemini(cfg, "k", "sys", msgs, silent, undefined), "안녕이다비! 오늘도 꿀이다비."); assert.equal(f.calls.length, 1); }
  finally { globalThis.fetch = orig; }
});

test("chatGemini — 끝 이벤트 없이 낱말 중간에서 끊기면 한 번 재시도한다 (v0.22.2 의 버그)", async () => {
  const orig = globalThis.fetch;
  const f = fakeFetch([gemini([{ text: "쥬비는 오늘 하루 종일 꽃밭을 돌면서 달" }]), gemini([{ text: "쥬비는 꽃밭을 돌았다비!" }, { finish: "STOP" }])]);
  globalThis.fetch = f;
  try {
    const out = await chatGemini(cfg, "k", "sys", msgs, silent, undefined);
    assert.equal(out, "쥬비는 꽃밭을 돌았다비!");
    assert.equal(f.calls.length, 2);
  } finally { globalThis.fetch = orig; }
});

test("chatGemini — 재시도도 끊기면 마지막 완결 문장까지만 내보낸다", async () => {
  const orig = globalThis.fetch;
  const cut = [{ text: "첫 문장은 끝났다비. 둘째 문장은 중간에 끊" }];
  globalThis.fetch = fakeFetch([gemini(cut), gemini(cut)]);
  try { assert.equal(await chatGemini(cfg, "k", "sys", msgs, silent, undefined), "첫 문장은 끝났다비."); }
  finally { globalThis.fetch = orig; }
});

test("appLabelOf — 창 제목에서 앱 이름표만 (문서 제목은 매번 바뀐다)", () => {
  const { appLabelOf } = require("../screen-capture.js");
  assert.equal(appLabelOf("Flasso - YouTube - Chrome"), "Chrome");
  assert.equal(appLabelOf("#채팅 | SSAP - Discord"), "Discord");
  assert.equal(appLabelOf("트릭컬 게임 정보 - 사도 데스크 - Visual Studio Code"), "Visual Studio Code");
  assert.equal(appLabelOf("MapleStory"), "MapleStory");                 // 구분자 없으면 제목 전체
  assert.equal(appLabelOf("귀렘 - 파일 탐색기"), "파일 탐색기");
  assert.equal(appLabelOf("a - " + "x".repeat(40)), ("a - " + "x".repeat(40)).slice(0, 80)); // 뒤 토막이 너무 길면(30자 초과) 제목 전체
  assert.equal(appLabelOf(""), "");
});

test("updater.newerThan — 태그 비교 (v 접두어·세 자리·자릿수 다름)", () => {
  const UP = require("../updater.js")({ refreshTray() {} });
  assert.equal(UP.newerThan("v0.23.1", "0.14.1"), true);
  assert.equal(UP.newerThan("v0.14.1", "0.14.1"), false);
  assert.equal(UP.newerThan("v0.9.9", "0.10.0"), false);      // 문자열 비교였다면 참이 됐을 것
  assert.equal(UP.newerThan("v1.0", "0.99.99"), true);
  assert.deepEqual(UP.semver("v1.2"), [1, 2]);
});

test("explainError — 제공자 오류를 할 일이 담긴 한 줄로, 원문은 JSON 덤프를 뗀 짧은 것만", () => {
  const E = (m) => Ai.explainError(new Error(m));
  assert.match(E('Gemini 400: API key not valid. Please pass a valid API key. [{"@type":"x"}]'), /^API 키가 올바르지 않거나.*\(Gemini 400: API key not valid\. Please pass a valid API key\)$/);
  assert.match(E("Gemini 429: You exceeded your current quota"), /^사용 한도를 넘었거나/);
  assert.match(E("Ollama가 실행 중이 아니에요"), /^Ollama에 연결할 수 없습니다/);
  assert.match(E("fetch failed"), /^AI 서비스에 연결할 수 없습니다/);
  assert.match(E('https://api.groq.com/openai/v1 401: {"error":{"message":"Invalid API Key"}}'), /^API 키가 올바르지 않거나/);
  assert.match(E('Ollama 404: model "x" not found'), /^모델을 찾을 수 없습니다/);
  assert.match(E("Gemini 503: Service Unavailable"), /^AI 서비스가 일시적으로/);
  assert.match(E("이상한 오류"), /^오류: 이상한 오류$/);
});
