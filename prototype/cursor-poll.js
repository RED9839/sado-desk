/* 커서를 얼마나 자주 물을지 — 순수 계산이라 따로 뒀다(main.js 에서 떼어 냄, 시험: test/cursor-poll.test.js).
 * 사도 근처에서만 촘촘히 볼 값어치가 있다. 멀리 있으면 성기게 봐도 손맛이 같다 — 가까워지는 건 한 틱 안에 알아챈다.
 * 좌표는 모두 마스코트 창 기준 픽셀이고, rects 는 [{ x, y, w, h }] (사도들의 현재 자리).
 *   const { pollMs, FAST, SLOW, NEAR_PX } = require("./cursor-poll.js");
 */
const FAST = 16, SLOW = 50, NEAR_PX = 240;

const near = (r, x, y, pad) => !!r && x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad;

// cursor 가 아직 없으면(첫 틱) 촘촘히 — 어디 있는지 모르는 채 성기게 보면 첫 손짓이 굼뜨다
function pollMs(cursor, rects, opt = {}) {
  const pad = opt.nearPx ?? NEAR_PX, fast = opt.fast ?? FAST, slow = opt.slow ?? SLOW;
  if (!cursor) return fast;
  for (const r of rects || []) if (near(r, cursor.x, cursor.y, pad)) return fast;
  return slow;
}

module.exports = { pollMs, near, FAST, SLOW, NEAR_PX };
