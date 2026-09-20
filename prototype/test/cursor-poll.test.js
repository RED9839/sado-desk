/* 커서를 얼마나 자주 물을지 — 사도 근처에서만 촘촘히. 창 기준 픽셀 좌표를 쓴다 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { pollMs, near, FAST, SLOW, NEAR_PX } = require("../cursor-poll.js");

const R = [{ x: 1000, y: 800, w: 200, h: 260 }, { x: 3000, y: 900, w: 180, h: 220 }];

test("사도 위나 곁이면 촘촘히 본다", () => {
  assert.equal(pollMs({ x: 1100, y: 900 }, R), FAST);            // 몸 위
  assert.equal(pollMs({ x: 1000 - NEAR_PX + 5, y: 900 }, R), FAST); // 왼쪽 가까이
  assert.equal(pollMs({ x: 3100, y: 900 + 200 }, R), FAST);      // 두 번째 사도 곁
});

test("멀면 성기게 본다", () => {
  assert.equal(pollMs({ x: 0, y: 0 }, R), SLOW);
  assert.equal(pollMs({ x: 2000, y: 200 }, R), SLOW);            // 두 사도 사이지만 둘 다 멀다
  assert.equal(pollMs({ x: 1100, y: 900 }, []), SLOW);           // 사도가 없으면(아직 안 떴을 때)
});

test("커서를 아직 모르면 촘촘히 — 첫 손짓이 굼뜨지 않게", () => {
  assert.equal(pollMs(null, R), FAST);
  assert.equal(pollMs(undefined, R), FAST);
});

test("경계는 여유(NEAR_PX)만큼 넓게 잡는다", () => {
  const r = R[0];
  assert.equal(near(r, r.x - NEAR_PX + 1, r.y, NEAR_PX), true);
  assert.equal(near(r, r.x - NEAR_PX - 1, r.y, NEAR_PX), false);
  assert.equal(near(r, r.x + r.w + NEAR_PX - 1, r.y + r.h, NEAR_PX), true);
});

test("여유·간격은 불러 쓰는 쪽에서 바꿀 수 있다", () => {
  assert.equal(pollMs({ x: 1500, y: 900 }, R, { nearPx: 600 }), FAST);
  assert.equal(pollMs({ x: 0, y: 0 }, R, { slow: 200 }), 200);
});
