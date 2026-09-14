/* 말풍선 창: 메인이 "show" 로 {items, text, ttl} 을 보내면 크레페 말투 텍스트 + 소식 목록을 보여준다. 항목 클릭 → 브라우저로 열기. 마우스 올리면 타이머 멈춤. */
(() => {
  const host = window.host;
  const el = (id) => document.getElementById(id);
  let ttlMs = 30000, remain = 30000, tick = null, hovering = false;
  const fmtDate = (d) => { if (!d) return ""; const t = new Date(d); return isNaN(t) ? "" : `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`; };
  function render({ items, text, ttl }) {
    const say = text || Talk.announce(items, null);
    el("head").textContent = say.head; el("body").textContent = say.body; el("tail").textContent = say.tail; el("who").textContent = say.who ? `— ${say.who}` : "";
    // 제목·작성자·URL은 외부(유튜브·라운지)에서 온 값이고 라운지 닉네임은 사용자가 정하는 값이다.
    // 문자열로 HTML을 조립하면 그대로 태그가 되므로(news.js 의 unesc 가 &lt; 를 < 로 되돌린다) DOM으로 만든다.
    const box = el("items"); box.textContent = "";
    for (const i of (items || []).slice(0, 4)) {
      const d = document.createElement("div"); d.className = "item";
      d.dataset.url = String(i.url || ""); d.dataset.id = String(i.id || "");
      if (i.thumb && /^https?:\/\//i.test(i.thumb)) { const img = document.createElement("img"); img.src = i.thumb; img.alt = ""; d.appendChild(img); }
      const t = document.createElement("div"); t.className = "t";
      const ttl = document.createElement("div"); ttl.className = "ttl";
      const lab = document.createElement("span"); lab.className = "lab " + (i.source === "youtube" ? "youtube" : "lounge"); lab.textContent = i.label || "";
      ttl.appendChild(lab); ttl.appendChild(document.createTextNode(i.title || ""));
      const dt = document.createElement("div"); dt.className = "dt"; dt.textContent = fmtDate(i.date) + (i.writer ? " · " + i.writer : "");
      t.appendChild(ttl); t.appendChild(dt); d.appendChild(t); box.appendChild(d);
    }
    if ((items || []).length > 4) { const more = document.createElement("div"); more.className = "tail"; more.textContent = `…외 ${items.length - 4}개는 우클릭 메뉴 → 새 소식`; box.appendChild(more); }
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
