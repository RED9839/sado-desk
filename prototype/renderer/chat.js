/* 대화 창 — 메인이 "chat:init"으로 {who, prov, history, ready, setup} 을 주면 기록을 그리고, 사용자가 보낸 말은 host.chatSend()로.
 * 답변은 "chat:token"(조각) → "chat:done"({text, emotion, error}) 순서로 온다. 사도가 먼저 말을 걸 땐 "chat:say"({text}). */
(() => {
  const host = window.host;
  const el = (id) => document.getElementById(id);
  const log = el("log"), input = el("in"), sendBtn = el("send");
  let busy = false, cur = null, withScreen = false;
  const resize = () => requestAnimationFrame(() => host.chatResize(Math.ceil(el("chat").getBoundingClientRect().height) + 22));
  function add(role, text, cls = "") { const d = document.createElement("div"); d.className = `msg ${role} ${cls}`.trim(); d.textContent = text; log.appendChild(d); while (log.children.length > 40) log.firstChild.remove(); log.scrollTop = log.scrollHeight; resize(); return d; }
  // chat:done 이 안 오면(제공자가 스트림을 끊고 아무 말 없이 사라짐) 입력창이 영영 잠겼다. 조각이 올 때마다 다시 세어 90초 침묵이면 풀어 준다
  let busyTimer = null;
  function setBusy(b) {
    busy = b; sendBtn.disabled = b; input.disabled = b; if (!b) input.focus();
    clearTimeout(busyTimer); busyTimer = null;
    if (b) busyTimer = setTimeout(() => { if (cur) { cur.classList.remove("typing"); if (!cur.textContent) cur.textContent = "…답이 오지 않았어요"; } cur = null; setBusy(false); resize(); }, 90000);
  }
  function send() {
    const t = input.value.trim(); if (!t || busy) return;
    input.value = ""; input.style.height = "";
    add("user", (withScreen ? "📷 " : "") + t); cur = add("bot", "", "typing"); setBusy(true);
    host.chatSend(t, withScreen); withScreen = false; el("cam").classList.remove("on");
  }
  el("cam").addEventListener("click", () => { withScreen = !withScreen; el("cam").classList.toggle("on", withScreen); el("status").textContent = withScreen ? "다음 말과 함께 화면을 보여줍니다" : ""; input.focus(); });
  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } }); // Escape 는 아래 window 쪽 하나로 (둘이면 chatClose 가 두 번)
  input.addEventListener("input", () => { input.style.height = ""; input.style.height = Math.min(72, input.scrollHeight) + "px"; resize(); });
  el("close").addEventListener("click", () => host.chatClose());
  el("clear").addEventListener("click", () => { log.innerHTML = ""; host.chatClear(); resize(); });
  el("settings").addEventListener("click", () => host.openSettings("ai"));
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") host.chatClose(); });

  host.on("chat:init", ({ who, prov, history, ready, setup }) => {
    el("who").textContent = who || "사도"; el("prov").textContent = prov || "";
    log.innerHTML = "";
    if (!ready) { const d = document.createElement("div"); d.className = "setup"; d.innerHTML = setup || "AI 서비스가 설정되지 않았습니다. <b>설정 → AI 대화</b>에서 Ollama(로컬)를 연결하거나 API 키를 저장해 주세요."; log.appendChild(d); }
    for (const m of history || []) add(m.role === "user" ? "user" : "bot", m.text);
    el("status").textContent = ready ? "" : "설정 필요";
    setBusy(false); resize();
  });
  host.on("chat:token", ({ delta }) => { if (!cur) cur = add("bot", "", "typing"); cur.textContent += delta; log.scrollTop = log.scrollHeight; if (busy) setBusy(true); }); // 조각이 오는 동안은 감시 타이머를 다시 센다
  host.on("chat:done", ({ text, error }) => {
    if (error) { if (cur) cur.remove(); add("bot", error, "err"); }
    else if (cur) { cur.classList.remove("typing"); cur.textContent = text; }
    cur = null; setBusy(false); resize();
  });
  // 먼저 말 걸기. 스트리밍으로 이미 말풍선이 하나 만들어져 있으므로 새로 붙이지 않고 그것을 마무리한다
  // (새로 붙이면 감정 태그가 붙은 날것 말풍선이 하나 남아 혼잣말을 두 번 한 것처럼 보였다)
  host.on("chat:say", ({ text }) => {
    if (cur) { cur.classList.remove("typing"); cur.textContent = text; } else add("bot", text);
    cur = null; setBusy(false); resize();
  });
  host.on("chat:status", ({ text }) => { el("status").textContent = text || ""; });
})();
