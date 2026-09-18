// 설정 뼈대 — 범위·열거·문자열·배열 검사와 병합. `node --test test/` 로 돈다.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const S = require("../settings-schema.js");

test("범위 밖 수치는 잘라 넣고, 숫자 문자열은 받아 준다", () => {
  const fixed = [];
  const out = S.sanitizePatch({ scale: 9, opacity: "0.7", behavior: { hopChance: -5 } }, { forChar: true, fixed });
  assert.equal(out.scale, 3);            // 상한 3
  assert.equal(out.opacity, 0.7);        // "0.7" → 0.7
  assert.equal(out.behavior.hopChance, 0);
  assert.ok(fixed.some(f => f.startsWith("scale 9→3")));
});

test("열거형·문자열은 틀리면 버린다 (기본값을 지우지 않는다)", () => {
  const out = S.sanitizePatch({ mode: "hologram", skin: "../evil", display: { fps: "144" } }, { forChar: true });
  assert.equal(out.mode, undefined);
  assert.equal(out.skin, undefined);
  assert.deepEqual(out.display, {});     // fps 만 버려지고 display 자체는 남는다
  assert.equal(S.sanitizePatch({ display: { fps: 60 } }).display.fps, "60"); // 숫자 60 도 문자열로 받는다
});

test("모르는 최상위 키는 버리고 fixed 에 남긴다 — talk 이 GLOBAL_KEYS 에 없던 사고의 재발 방지", () => {
  const fixed = [];
  const out = S.sanitizePatch({ talk: { minMin: 5 }, bogus: 1 }, { forChar: false, fixed });
  assert.deepEqual(out, { talk: { minMin: 5 } });
  assert.ok(fixed.some(f => f.includes("bogus")));
  assert.ok(S.GLOBAL_KEYS.has("talk"));
});

test("forChar 'only' 는 캐릭터 키만, false 는 전역 키만 받는다", () => {
  assert.deepEqual(S.sanitizePatch({ scale: 1, sound: { master: 1 } }, { forChar: "only" }), { scale: 1 });
  assert.deepEqual(S.sanitizePatch({ scale: 1, sound: { master: 1 } }, { forChar: false }), { sound: { master: 1 } });
});

test("배열 값(ai.screenWindows)은 문자열만 남기고 개수·길이를 자른다", () => {
  const long = "x".repeat(200);
  const out = S.sanitizePatch({ ai: { screenWindows: ["Chrome", "Chrome", " ", 7, long] } }, { forChar: false });
  assert.deepEqual(out.ai.screenWindows.slice(0, 1), ["Chrome"]);
  assert.equal(out.ai.screenWindows.length, 2);          // 중복·빈칸·숫자 제거
  assert.equal(out.ai.screenWindows[1].length, 80);       // 이름 길이 상한
  assert.equal(S.sanitizePatch({ ai: { screenWindows: "Chrome" } }, { forChar: false }).ai.screenWindows, undefined); // 배열 아니면 버림
});

test("deepMerge 는 undefined·null·NaN 을 건너뛰고, 객체 자리에 원시값이 오면 기본을 지킨다", () => {
  const base = { display: { fps: "auto", debug: false }, scale: 0.5 };
  const out = S.deepMerge(base, { display: undefined, scale: NaN });
  assert.deepEqual(out, base);
  assert.deepEqual(S.deepMerge(base, { display: 1 }), base);            // "display": 1 → 무시
  assert.equal(S.deepMerge(base, { display: { debug: true } }).display.fps, "auto"); // 부분 병합
  assert.deepEqual(S.deepMerge({ a: [1, 2] }, { a: [3] }).a, [3]);      // 배열은 통째로 교체
});

test("clampSettings 는 파일 전체를 검사하고 monitor 를 숫자로 맞춘다", () => {
  const s = { global: { sound: { master: 5 }, junk: 1 }, characters: [{ id: "c1", scale: 0.5, monitor: "3133765106", nope: 1 }] };
  const fixed = S.clampSettings(s);
  assert.equal(s.global.sound.master, 1);
  assert.equal(s.global.junk, undefined);
  assert.equal(s.characters[0].monitor, 3133765106);
  assert.equal(s.characters[0].nope, undefined);
  assert.equal(s.characters[0].id, "c1");                 // id 는 검사 밖
  assert.ok(fixed.length >= 2);
});

test("기본값이 스스로 검사를 통과한다 (기본값이 범위 밖이면 첫 실행부터 '고침' 로그가 뜬다)", () => {
  const fixed = [];
  S.sanitizePatch(S.GLOBAL_DEFAULTS, { forChar: false, fixed });
  S.sanitizePatch(S.CHAR_DEFAULTS, { forChar: "only", fixed });
  assert.deepEqual(fixed, []);
});
