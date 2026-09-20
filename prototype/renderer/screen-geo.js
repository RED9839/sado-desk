/* 모니터 기하 — 어느 모니터 위인가, 바닥·천장은 어디인가, 벽 안으로 어떻게 가두나.
 * 순수 계산이라 브라우저(mascot.js)와 node(test/screen-geo.test.js) 양쪽에서 쓴다.
 * 좌표는 창 기준 픽셀이고, displays 는 [{ id, x0, x1, floor, top, primary }] (mascot.js setGeo 가 만든 꼴).
 *   브라우저: window.ScreenGeo · node: require("./screen-geo.js")
 */
(function (root) {
  // 그 x 가 올라가 있는 모니터. 어디에도 안 걸리면 가장 가까운 것 (창 밖으로 조금 나간 경우)
  function dispAt(displays, x) {
    let best = null, bd = Infinity;
    for (const d of displays || []) { const dd = x < d.x0 ? d.x0 - x : x > d.x1 ? x - d.x1 : 0; if (dd < bd) { bd = dd; best = d; } }
    return best;
  }
  const floorAt = (displays, x) => (dispAt(displays, x) || { floor: 0 }).floor;
  const topAt = (displays, x, H) => { const d = dispAt(displays, x); return d ? d.top : H; };
  // 사도를 벽 안으로. d 가 null 이면 창 전체(0~W)를 쓴다. 모니터가 사도보다 좁으면 가운데
  function clampX(x, d, W, w, margin) {
    const lo = (d ? d.x0 : 0) + margin + w / 2;
    const hi = (d ? d.x1 : W) - margin - w / 2;
    return hi < lo ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, x));
  }
  const api = { dispAt, floorAt, topAt, clampX };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.ScreenGeo = api;
})(typeof window !== "undefined" ? window : globalThis);
