/* 화면 보기 — 무엇을 찍어 AI 에 보낼지. main.js 에서 떼어 낸 것.
 * '고른 창만'(기본)이면 허용 목록에 든 창 하나를, '모니터 전체'면 사도가 선 모니터를 1280px 로 줄여 JPEG 로 만든다.
 * 설정·창 기하·사도 위치는 ctx 의 getter 로 본다.
 *   const SC = require("./screen-capture.js")(ctx); → { appLabelOf, listCapturableWindows, captureScreenFor, screenAllowed, screenReady }
 */
const { BrowserWindow, ipcMain, screen, desktopCapturer } = require("electron");

// 창 이름에서 앱 이름표를 뽑는다: "Flasso - YouTube - Chrome" → "Chrome", "MapleStory" → "MapleStory".
// 제목은 열어 둔 문서에 따라 매번 달라지므로 맨 뒤 토막(대개 앱 이름)만 기억해 둔다. 순수 함수라 test/ 에서도 부른다
function appLabelOf(name) {
  const n = String(name || "").trim();
  const parts = n.split(/\s+[-—–|]\s+/).filter(Boolean);
  const last = parts.length > 1 ? parts[parts.length - 1].trim() : "";
  return (last && last.length <= 30) ? last : n.slice(0, 80);
}

module.exports = function createScreenCapture(ctx) {
  // 사도 데스크 자신의 창은 목록에 넣지 않는다 — 제 얼굴을 찍어 보내 봐야 소용없다
  const ownWindowIds = () => new Set(BrowserWindow.getAllWindows().map(w => { try { return w.getMediaSourceId(); } catch { return ""; } }).filter(Boolean));
  async function listCapturableWindows() {
    const own = ownWindowIds();
    const src = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 0, height: 0 } }); // 썸네일 없이 — 이름만 필요하다(1x1 은 3초, 0x0 은 0.3초)
    const seen = new Set(), out = [];
    for (const s of src) {
      if (own.has(s.id) || !s.name || !s.name.trim() || /^사도 데스크/.test(s.name)) continue; // 다른 인스턴스의 창(개발 실행 중 설치판 등)도 이름으로 걸러 둔다
      const label = appLabelOf(s.name);
      if (seen.has(label)) continue; seen.add(label);
      out.push({ label, title: s.name });
    }
    return out;
  }
  async function captureScreenFor(id) {
    const ai = ctx.settings.global.ai || {};
    const maxW = 1280;
    // 고른 창만 보내기 — 허용 목록에 있는 창 중 가장 앞의 것. 하나도 안 열려 있으면 화면을 보내지 않는다
    if ((ai.screenScope || "windows") === "windows") {
      const allow = (ai.screenWindows || []).map(x => String(x).toLowerCase());
      if (!allow.length) throw new Error("사도가 볼 창을 아직 안 고르셨어요. 설정 → AI 대화 → '화면 보기'에서 보여 줄 창을 켜 주세요.");
      const own = ownWindowIds();
      const wins = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: maxW, height: maxW } });
      const hit = wins.find(w => !own.has(w.id) && w.name && !/^사도 데스크/.test(w.name) && allow.includes(appLabelOf(w.name).toLowerCase()));
      if (!hit) throw new Error(`고르신 창이 지금 하나도 안 열려 있어요 (${(ai.screenWindows || []).join(", ")}).`);
      if (hit.thumbnail.isEmpty()) throw new Error("그 창을 캡처하지 못했어요 (최소화돼 있으면 안 보입니다)");
      return { mime: "image/jpeg", data: hit.thumbnail.toJPEG(60).toString("base64"), window: appLabelOf(hit.name) };
    }
    const inst = ctx.instances.get(id); const r = inst && inst.rect;
    const pt = r && ctx.geo ? { x: Math.round(ctx.geo.x + r.x + r.w / 2), y: Math.round(ctx.geo.y + r.y + r.h / 2) } : screen.getCursorScreenPoint();
    const disp = screen.getDisplayNearestPoint(pt);
    const scale = Math.min(1, maxW / disp.size.width);
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: Math.round(disp.size.width * scale), height: Math.round(disp.size.height * scale) } });
    const src = sources.find(s => String(s.display_id) === String(disp.id)) || sources[0];
    if (!src || src.thumbnail.isEmpty()) throw new Error("화면을 캡처하지 못했어요");
    return { mime: "image/jpeg", data: src.thumbnail.toJPEG(60).toString("base64"), display: disp.id };
  }
  // 먼저 말 걸 때 화면을 붙일 수 있는 상태인가 — '고른 창만' 인데 그 창이 하나도 안 열려 있으면 false.
  // 여기서 걸러야 사도가 스스로 대화창을 열고 "창을 안 고르셨어요" 라고 40분마다 잔소리하는 일이 없다.
  // 사용자가 직접 누른 '내 화면 보고 한마디' 는 screenTalk 이 그 말을 그대로 보여 준다
  async function screenReady() {
    const ai = ctx.settings.global.ai || {};
    if (!screenAllowed()) return false;
    if ((ai.screenScope || "windows") !== "windows") return true;
    const allow = (ai.screenWindows || []).map(x => String(x).toLowerCase()); if (!allow.length) return false;
    try { return (await listCapturableWindows()).some(w => allow.includes(w.label.toLowerCase())); } catch { return false; }
  }
  ipcMain.handle("ai:windows", () => listCapturableWindows().catch((e) => { console.warn("ai:windows 실패", e.message); return []; }));
  const screenAllowed = () => !!(ctx.settings.global.ai && ctx.settings.global.ai.screen);
  return { appLabelOf, listCapturableWindows, captureScreenFor, screenAllowed, screenReady };
};
module.exports.appLabelOf = appLabelOf;
