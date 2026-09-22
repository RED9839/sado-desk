/* 창 크기·위치 기억 — 설정 창·가져오기 창. 사용자가 모서리를 끌어 맞춘 크기를 다음에도 쓴다(픽셀 입력 대신).
 * 순수 계산만 여기 — 저장은 main.js(updateSettings), 시험은 test/win-bounds.test.js.
 *   fit({x,y,w,h}, [workArea…], {minW,minH}) → 어느 모니터 작업영역 안으로 끌어온 {x,y,width,height} | null(못 쓸 값)
 * 모니터가 빠졌거나 해상도가 줄어 창이 화면 밖이면 가장 가까운 작업영역 안으로 옮기고, 크면 줄인다.
 * minW·minH 는 창의 최소 크기와 같아야 한다 — 그보다 작게 저장돼 있으면 키운 뒤에 자리를 잡는다(창이 최소로 커지며 화면 밖으로 삐져나오지 않게).
 */
const num = (v) => typeof v === "number" && Number.isFinite(v);

// 저장된 사각형과 가장 많이 겹치는 작업영역. 하나도 안 겹치면 중심이 가장 가까운 것
function nearestArea(b, areas) {
  let best = null, bestScore = -Infinity;
  for (const a of areas) {
    const ix = Math.max(0, Math.min(b.x + b.w, a.x + a.width) - Math.max(b.x, a.x)), iy = Math.max(0, Math.min(b.y + b.h, a.y + a.height) - Math.max(b.y, a.y));
    const overlap = ix * iy;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, ax = a.x + a.width / 2, ay = a.y + a.height / 2;
    const score = overlap > 0 ? overlap : -Math.hypot(cx - ax, cy - ay);   // 겹침이 있으면 넓이, 없으면 거리(음수)
    if (score > bestScore) { bestScore = score; best = a; }
  }
  return best;
}

function fit(saved, areas, { minW = 200, minH = 200 } = {}) {
  if (!saved || !areas || !areas.length) return null;
  const b = { x: saved.x, y: saved.y, w: saved.w, h: saved.h };
  if (![b.x, b.y, b.w, b.h].every(num)) return null;
  const a = nearestArea(b, areas);
  const width = Math.min(Math.max(Math.round(b.w), minW), a.width), height = Math.min(Math.max(Math.round(b.h), minH), a.height);
  const x = Math.min(Math.max(Math.round(b.x), a.x), a.x + a.width - width), y = Math.min(Math.max(Math.round(b.y), a.y), a.y + a.height - height);
  return { x, y, width, height };
}

// BrowserWindow.getBounds() → 저장 모양. 최소화 상태의 음수 좌표(-32000) 같은 값은 버린다
function fromBounds(b) {
  if (!b || ![b.x, b.y, b.width, b.height].every(num) || b.x < -10000 || b.y < -10000) return null;
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

module.exports = { fit, fromBounds, nearestArea };
