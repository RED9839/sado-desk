/* 창 크기·위치 기억 — 저장된 사각형을 지금 모니터 안으로 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { fit, fromBounds } = require("../win-bounds.js");

const FHD = { x: 0, y: 0, width: 1920, height: 1032 };            // 작업표시줄 뺀 작업영역
const SIDE = { x: 1920, y: 0, width: 1280, height: 720 };          // 오른쪽에 붙은 작은 모니터

test("작업영역 안에 있으면 그대로", () => {
  assert.deepEqual(fit({ x: 100, y: 80, w: 900, h: 660 }, [FHD]), { x: 100, y: 80, width: 900, height: 660 });
});

test("화면 밖으로 나갔으면 안으로 끌어온다 (모니터가 빠진 경우)", () => {
  const r = fit({ x: 2000, y: 50, w: 900, h: 660 }, [FHD]);        // 옛 오른쪽 모니터 자리
  assert.deepEqual(r, { x: 1020, y: 50, width: 900, height: 660 });
});

test("작업영역보다 크면 줄인다 (고배율·저해상도로 바뀐 경우)", () => {
  const r = fit({ x: 0, y: 0, w: 1400, h: 900 }, [SIDE]);
  assert.deepEqual(r, { x: 1920, y: 0, width: 1280, height: 720 });
});

test("가장 많이 겹치는 모니터를 고른다", () => {
  const r = fit({ x: 1800, y: 100, w: 800, h: 500 }, [FHD, SIDE]);   // 120px 는 FHD, 680px 는 SIDE 에 걸침
  assert.equal(r.x >= SIDE.x, true);
  assert.deepEqual(r, { x: 1920, y: 100, width: 800, height: 500 });
});

test("못 쓸 값은 null — 기본 크기로 연다", () => {
  assert.equal(fit(null, [FHD]), null);
  assert.deepEqual(fit({ x: 1900, y: 0, w: 50, h: 50 }, [FHD], { minW: 720, minH: 480 }), { x: 1200, y: 0, width: 720, height: 480 });   // 최소보다 작으면 키우고, 키운 채로 안에 넣는다
  assert.equal(fit({ x: "a", y: 0, w: 900, h: 660 }, [FHD]), null);        // 손으로 고친 파일
  assert.equal(fit({ x: 0, y: 0, w: 900, h: 660 }, []), null);             // 모니터 정보 없음
});

test("fromBounds: 최소화 좌표(-32000)는 버린다", () => {
  assert.deepEqual(fromBounds({ x: 10, y: 20, width: 900, height: 660 }), { x: 10, y: 20, w: 900, h: 660 });
  assert.equal(fromBounds({ x: -32000, y: -32000, width: 900, height: 660 }), null);
  assert.equal(fromBounds(null), null);
});
