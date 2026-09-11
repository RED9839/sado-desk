/* 말풍선 창: 메인이 "show" 로 {items, text, ttl} 을 보내면 크레페 말투 텍스트 + 소식 목록을 보여준다. 항목 클릭 → 브라우저로 열기. 마우스 올리면 타이머 멈춤. */
(() => {
  const host = window.host;
  const el = (id) => document.getElementById(id);
  let ttlMs = 30000, remain = 30000, tick = null, hovering = false;
  const fmtDate = (d) => { if (!d) return ""; const t = new Date(d); return isNaN(t) ? "" : `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`; };
  function render({ items, text, ttl }) {
    const say = text || Talk.announce(items, null);
    el("head").textContent = say.head; el("body").textContent = say.body; el("tail").textContent = say.tail; el("who").textContent = say.who ? `— ${say.who}` : "";
    el("items").innerHTML = (items || []).slice(0, 4).map(i => `<div class="item" data-url="${i.url}" data-id="${i.id}">${i.thumb ? `<img src="${i.thumb}" alt="">` : ""}<div class="t"><div class="ttl"><span class="lab ${i.source}">${i.label}</span>${i.title}</div><div class="dt">${fmtDate(i.date)}${i.writer ? " · " + i.writer : ""}</div></div></div>`).join("")
      + ((items || []).length > 4 ? `<div class="tail">…외 ${items.length - 4}개는 우클릭 메뉴 → 새 소식</div>` : "");
    ttlMs = remain = ttl || 30000;
    el("bar").style.animation = "none"; void el("bar").offsetWidth; el("bar").style.animation = `shrink ${ttlMs}ms linear forwards`;
    requestAnimationFrame(() => host.bubbleResize(Math.ceil(document.getElementById("bubble").getBoundingClientRect().height) + 22));
    clearInterval(tick); tick = setInterval(() => { if (hovering) return; remain -= 250; if (remain <= 0) { clearInterval(tick); host.bubbleClose(); } }, 250);
  }
  document.getElementById("bubble").addEventListener("mouseenter", () => { hovering = true; el("bar").style.animationPlayState = "paused"; });
  document.getElementById("bubble").addEventListener("mouseleave", () => { hovering = false; el("bar").style.animationPlayState = "running"; });
  document.getElementById("items").addEventListener("click", (e) => { const t = e.target.closest("[data-url]"); if (!t) return; host.openUrl(t.dataset.url, t.dataset.id); host.bubbleClose(); });
  document.getElementById("close").addEventListener("click", () => host.bubbleClose());
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") host.bubbleClose(); });
  host.on("show", render);
})();
