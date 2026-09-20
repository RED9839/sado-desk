/* 히트 창의 손 — 마우스 이벤트를 메인으로 넘긴다(preload 의 window.hit.ev → ipc "hit-ev" → 마스코트 창).
 * 별도 파일인 이유: 이 창의 CSP 가 'self' 만 허용해서 인라인 스크립트는 실행되지 않는다.
 * (한동안 인라인이었고, CSP 를 붙이면서 통째로 막혀 사도가 손짓에 반응하지 않았다 — test-hooks.js --hit-test 가 이 경로를 지킨다)
 */
const send = (type, e) => window.hit.ev({ type, sx: e.screenX, sy: e.screenY, button: e.button, buttons: e.buttons });
window.addEventListener("mousedown", (e) => { if (e.button === 0) document.body.classList.add("grabbing"); send("mousedown", e); });
window.addEventListener("mouseup", (e) => { document.body.classList.remove("grabbing"); send("mouseup", e); });
window.addEventListener("mousemove", (e) => send("mousemove", e));
window.addEventListener("mouseleave", (e) => send("mouseleave", e));
window.addEventListener("contextmenu", (e) => e.preventDefault());
