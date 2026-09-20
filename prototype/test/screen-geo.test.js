/* 모니터 기하 — 사도가 어느 모니터 위인지, 바닥·천장은 어디인지, 벽 안으로 어떻게 가두는지.
 * 실제 값 꼴: 창은 모든 모니터의 합집합이고 y 는 위로 증가(바닥 floor 가 큰 값). */
const test = require("node:test");
const assert = require("node:assert/strict");
const { dispAt, floorAt, topAt, clampX } = require("../renderer/screen-geo.js");

// 3440×1440 주 모니터 + 오른쪽 2560×1440 (작업표시줄 높이가 달라 바닥이 다르다)
const D = [
  { id: 1, x0: 0, x1: 3440, floor: 1392, top: 0, primary: true },
  { id: 2, x0: 3440, x1: 6000, floor: 1440, top: 0 },
];

test("x 가 올라가 있는 모니터를 고른다", () => {
  assert.equal(dispAt(D, 0).id, 1);
  assert.equal(dispAt(D, 3439).id, 1);
  assert.equal(dispAt(D, 3441).id, 2);
  assert.equal(dispAt(D, 5999).id, 2);
});

test("경계와 창 밖은 가장 가까운 모니터로 (사도가 조금 삐져나가도 바닥을 잃지 않는다)", () => {
  assert.equal(dispAt(D, -500).id, 1, "왼쪽 밖 → 1번");
  assert.equal(dispAt(D, 99999).id, 2, "오른쪽 밖 → 2번");
  assert.equal(dispAt(D, 3440).id, 1, "딱 경계는 앞 모니터(둘 다 거리 0이면 먼저 나온 것)");
});

test("모니터마다 바닥이 다르다 (작업표시줄 높이 차이)", () => {
  assert.equal(floorAt(D, 100), 1392);
  assert.equal(floorAt(D, 4000), 1440);
  assert.equal(topAt(D, 4000, 1440), 0);
});

test("모니터가 하나도 없으면 바닥 0·천장은 창 높이 (기하가 아직 안 온 순간)", () => {
  assert.equal(dispAt([], 100), null);
  assert.equal(floorAt([], 100), 0);
  assert.equal(topAt([], 100, 1440), 1440);
  assert.equal(floorAt(undefined, 100), 0);
});

test("벽 안으로 가둔다 — 사도 몸 절반과 여백만큼 띄운다", () => {
  const w = 100, margin = 20;               // lo = x0+20+50, hi = x1-20-50
  assert.equal(clampX(-999, D[0], 6000, w, margin), 70);
  assert.equal(clampX(99999, D[0], 6000, w, margin), 3370);
  assert.equal(clampX(1000, D[0], 6000, w, margin), 1000, "안쪽은 그대로");
  assert.equal(clampX(3500, D[1], 6000, w, margin), 3510, "2번 모니터의 왼쪽 벽");
});

test("가두는 모니터가 없으면 창 전체를 쓴다 ('모든 모니터 이동' · 끌고 있을 때)", () => {
  assert.equal(clampX(-999, null, 6000, 100, 20), 70);
  assert.equal(clampX(99999, null, 6000, 100, 20), 5930);
});

test("모니터가 사도보다 좁으면 가운데에 세운다 (작은 보조 화면)", () => {
  const tiny = { id: 3, x0: 0, x1: 120, floor: 700, top: 0 };
  const x = clampX(9999, tiny, 6000, 300, 20);
  assert.equal(x, 60, `가운데(${x})에 서야 한다 — 좌우 벽이 뒤집히면 값이 튄다`);
});

// 실제로 겪는 화면 변화 — 절전에서 깨거나 모니터를 뽑거나 배율을 바꾸면 기하가 통째로 바뀐다.
// 그때 사도가 사라지지 않고 남은 화면 안으로 돌아오는지가 핵심이라 그 계산만 따로 본다
test("모니터를 뽑으면 그 위에 있던 사도가 남은 모니터 안으로 들어온다", () => {
  const before = [{ id: 1, x0: 0, x1: 1920, floor: 1040, top: 0 }, { id: 2, x0: 1920, x1: 3840, floor: 1040, top: 0 }];
  const after = before.slice(0, 1);                      // 2번 모니터가 빠졌다
  const x = 3000;                                        // 사도는 2번 위에 있었다
  assert.equal(dispAt(before, x).id, 2);
  const d = dispAt(after, x);                  // 사라진 모니터 → 가장 가까운(남은) 모니터
  assert.equal(d.id, 1);
  const nx = clampX(x, d, 1920, 200, 10);
  assert.ok(nx >= 110 && nx <= 1810, `남은 모니터 안으로 (${nx})`);
});

test("배율을 바꿔 화면이 좁아져도 벽 밖에 남지 않는다", () => {
  const wide = { id: 1, x0: 0, x1: 2560, floor: 1400, top: 0 };
  const scaled = { id: 1, x0: 0, x1: 1707, floor: 933, top: 0 };   // 150% 로 바꾼 뒤
  const x = clampX(2400, wide, 2560, 200, 10);
  assert.equal(x, 2400);
  const nx = clampX(x, scaled, 1707, 200, 10);
  assert.ok(nx <= 1707 - 10 - 100, `좁아진 화면 안 (${nx})`);
  assert.equal(floorAt([scaled], nx), 933);              // 바닥도 새 값으로
});

test("모니터가 하나만 남아도 바닥을 잃지 않는다 (절전 복귀 직후 한 대만 먼저 올라올 때)", () => {
  const one = [{ id: 1, x0: 0, x1: 1920, floor: 1040, top: 0 }];
  for (const x of [-500, 0, 960, 1920, 5000]) assert.equal(floorAt(one, x), 1040);
});
