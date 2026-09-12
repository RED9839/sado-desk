/* 대화 창 — 메인이 "chat:init"으로 {who, prov, history, ready, setup} 을 주면 기록을 그리고, 사용자가 보낸 말은 host.chatSend()로.
 * 답변은 "chat:token"(조각) → "chat:done"({text, emotion, error}) 순서로 온다. 사도가 먼저 말을 걸 땐 "chat:say"({text}). */
(() => {
  const host = window.host;
  const el = (id) => document.getElementById(id);
  const log = el("log"), input = el("in"), sendBtn = el("send");
  let busy = false, cur = null;
  const resize = () => requestAnimationFrame(() => host.chatResize(Math.ceil(el("chat").getBoundingClientRect().height) + 22));
  function add(role, text, cls = "") { const d = document.createElement("div"); d.className = `msg ${role} ${cls}`.trim(); d.textContent = text; log.appendChild(d); while (log.children.length > 40) log.firstChild.remove(); log.scrollTop = log.scrollHeight; resize(); return d; }
  function setBusy(b) { busy = b; sendBtn.disabled = b; input.disabled = b; if (!b) input.focus(); }
  function send() {
    const t = input.value.trim(); if (!t || busy) return;
    input.value = ""; input.style.height = "";
    add("user", t); cur = add("bot", "", "typing"); setBusy(true);
    host.chatSend(t);
  }
  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } if (e.key === "Escape") host.chatClose(); });
  input.addEventListener("input", () => { input.style.height = ""; input.style.height = Math.min(72, input.scrollHeight) + "px"; resize(); });
  el("close").addEventListener("click", () => host.chatClose());
  el("clear").addEventListener("click", () => { log.innerHTML = ""; host.chatClear(); resize(); });
  el("settings").addEventListener("click", () => host.openSettings("ai"));
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") host.chatClose(); });

  host.on("chat:init", ({ who, prov, history, ready, setup }) => {
    el("who").textContent = who || "사도"; el("prov").textContent = prov || "";
    log.innerHTML = "";
    if (!ready) { const d = document.createElement("div"); d.className = "setup"; d.innerHTML = setup || "AI 제공자가 설정되지 않았어요. <b>AI 설정…</b>에서 Ollama(무료·로컬)나 API 키를 넣어 주세요."; log.appendChild(d); }
    for (const m of history || []) add(m.role === "user" ? "user" : "bot", m.text);
    el("status").textContent = ready ? "" : "설정 필요";
    setBusy(false); resize();
  });
  host.on("chat:token", ({ delta }) => { if (!cur) cur = add("bot", "", "typing"); cur.textContent += delta; log.scrollTop = log.scrollHeight; });
  host.on("chat:done", ({ text, error }) => {
    if (error) { if (cur) cur.remove(); add("bot", error, "err"); }
    else if (cur) { cur.classList.remove("typing"); cur.textContent = text; }
    cur = null; setBusy(false); resize();
  });
  host.on("chat:say", ({ text }) => { add("bot", text); cur = null; setBusy(false); });
  host.on("chat:status", ({ text }) => { el("status").textContent = text || ""; });
})();
