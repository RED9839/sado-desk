/* 우클릭 메뉴 — 별도 작은 창. 설정은 메인과 공유(host.setSettings), 캐릭터 명령은 host.mascot(). 창 높이는 내용에 맞춰 메인에 알림. */
(async () => {
  const host = window.host;
  let S = await host.getSettings();
  const catalog = await host.getCatalog();
  KO.load(catalog.dataRoot || catalog.assetRoot);
  const menuEl = document.getElementById("menu");
  const set = (patch) => { S = deepMerge(S, patch); host.setSettings(patch); render(); };
  const MOODS = [["", "기본"], ["smile", "미소"], ["anger", "분노"], ["sad", "슬픔"], ["happy", "행복"], ["eat", "냠냠"], ["sulky", "삐짐"], ["surprise", "놀람"]];
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const deepMerge = (b, p) => { const o = { ...b }; for (const [k, v] of Object.entries(p || {})) o[k] = isObj(v) && isObj(b[k]) ? deepMerge(b[k], v) : v; return o; };
  const resize = () => host.menuResize(Math.ceil(menuEl.getBoundingClientRect().height) + 6);

  // 애니 목록: 현재 형태에 맞는 스켈레톤 애니 (마스코트가 카탈로그에 넣어준 것)
  const anims = (S.mode === "sd" && catalog.sdAnimations && catalog.sdAnimations.length) ? catalog.sdAnimations : catalog.animations.map(a => a.name);
  const groups = {};
  for (const n of anims) { const g = n.replace(/[\d_].*$/, ""); (groups[g] ||= []).push(n); }
  document.getElementById("sub-anims").innerHTML = Object.entries(groups).sort().map(([g, list]) => `<div class="group">${KO.animGroup(g)} (${list.length})</div>` + list.map(n => `<div class="item" data-anim="${n}">${KO.anim(n)}</div>`).join("")).join("");

  const skins = catalog.skins.map(s => s.name).sort((a, b) => KO.skinName(a).localeCompare(KO.skinName(b), "ko"));
  const skinList = document.getElementById("skin-list"), filter = document.getElementById("skin-filter");
  const renderSkins = () => { const qq = filter.value.trim().toLowerCase(); skinList.innerHTML = skins.filter(n => !qq || KO.searchText(n).includes(qq)).map(n => `<div class="item" data-skin="${n}">${KO.skinName(n)}${n === S.skin ? " ✓" : ""}</div>`).join(""); };
  filter.addEventListener("input", renderSkins);

  let newsItems = [];
  const fmtDate = (d) => { const t = new Date(d); return isNaN(t) ? "" : `${t.getMonth() + 1}/${t.getDate()}`; };
  async function loadNews() {
    const r = await host.newsList(); newsItems = r.items || [];
    document.getElementById("news-state").textContent = r.unread ? `${r.unread}개 ▸` : "▸";
    document.getElementById("sub-news").innerHTML = `<div class="item" data-act="news-check">지금 확인하기</div><div class="item" data-act="news-show">크레페한테 다시 듣기</div>` + (newsItems.length ? `<div class="group">최근 소식 (${newsItems.length})</div>` + newsItems.slice(0, 12).map(i => `<div class="item" data-news="${i.id}" title="${i.title}"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${i.read ? "opacity:.6" : "font-weight:700"}">[${i.label}] ${i.title}</span><span style="color:#9a9aa8;flex:none;margin-left:6px">${fmtDate(i.date)}</span></div>`).join("") : `<div class="group">아직 새 소식 없음 (${r.status?.lastCheck ? "마지막 확인 " + new Date(r.status.lastCheck).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "확인 전"})</div>`) + (r.status?.lastError ? `<div class="group" style="color:#ff8a8a">${r.status.lastError}</div>` : "");
  }
  function render() {
    document.getElementById("menu-title").textContent = `${KO.skinName(S.skin, { withSkin: false })} — 사도 데스크`;
    document.getElementById("mode-state").textContent = S.mode === "sd" ? "SD" : "미니미";
    document.getElementById("skin-cur").textContent = KO.skinName(S.skin);
    document.getElementById("scale-chips").innerHTML = [0.3, 0.4, 0.5, 0.6, 0.8, 1.0].map(v => `<div class="chip ${v === S.scale ? "on" : ""}" data-scale="${v}">${Math.round(v * 100)}%</div>`).join("");
    document.getElementById("mood-chips").innerHTML = MOODS.map(([k, label]) => `<div class="chip ${(S.mood || "") === k ? "on" : ""}" data-mood="${k}">${label}</div>`).join("");
    document.getElementById("mood-state").textContent = (MOODS.find(([k]) => k === (S.mood || "")) || MOODS[0])[1] + (S.mode !== "sd" ? " (SD에서)" : "");
    document.getElementById("mute-state").textContent = S.sound.muted ? "음소거" : "켜짐";
    for (const row of menuEl.querySelectorAll("[data-vol]")) { const k = row.dataset.vol, v = Math.round(S.sound[k] * 100); row.querySelector("input").value = v; row.querySelector(".val").textContent = v + "%"; row.classList.toggle("off", S.sound.muted); }
    document.getElementById("debug-state").textContent = S.display.debug ? "켜짐" : "꺼짐";
    document.getElementById("remove-item").style.display = (S.count || 1) > 1 ? "" : "none";
    renderSkins(); loadNews().then(resize); resize();
  }
  for (const row of menuEl.querySelectorAll("[data-vol]")) {
    const input = row.querySelector("input");
    input.addEventListener("input", () => { row.querySelector(".val").textContent = input.value + "%"; });
    input.addEventListener("change", () => { set({ sound: { [row.dataset.vol]: input.value / 100 } }); host.mascot("preview", row.dataset.vol); });
  }
  menuEl.addEventListener("click", (e) => {
    const t = e.target.closest("[data-toggle],[data-act],[data-anim],[data-skin],[data-scale],[data-news],[data-mood]"); if (!t) return;
    if (t.dataset.mood !== undefined) { set(t.dataset.mood && S.mode !== "sd" ? { mood: t.dataset.mood, mode: "sd" } : { mood: t.dataset.mood }); return; }
    if (t.dataset.news) { const it = newsItems.find(i => i.id === t.dataset.news); if (it) host.openUrl(it.url, it.id); host.menuClose(); return; }
    if (t.dataset.toggle) { const sub = document.getElementById("sub-" + t.dataset.toggle); const was = sub.classList.contains("open"); for (const el of menuEl.querySelectorAll(".sub.open")) el.classList.remove("open"); if (!was) sub.classList.add("open"); if (t.dataset.toggle === "skins" && !was) setTimeout(() => filter.focus(), 0); resize(); return; }
    if (t.dataset.anim) { host.mascot("play", t.dataset.anim); return; }
    if (t.dataset.skin) { set({ skin: t.dataset.skin }); return; }
    if (t.dataset.scale) { set({ scale: +t.dataset.scale }); return; }
    switch (t.dataset.act) {
      case "mode": set({ mode: S.mode === "sd" ? "minimi" : "sd" }); break;
      case "mute": set({ sound: { muted: !S.sound.muted } }); break;
      case "debug": set({ display: { debug: !S.display.debug } }); break;
      case "settings": host.openSettings(); host.menuClose(); break;
      case "add": host.addCharacter(); host.menuClose(); break;
      case "news-check": { t.textContent = "확인 중…"; host.newsCheck().then(r => { t.textContent = r.added.length ? `새 소식 ${r.added.length}개!` : (r.errors && r.errors.length ? "확인 실패: " + r.errors[0] : "새 소식 없음"); loadNews().then(resize); }); break; }
      case "news-show": host.newsShow(); host.menuClose(); break;
      case "remove": host.removeCharacter(); host.menuClose(); break;
      case "respawn": host.mascot("respawn"); host.menuClose(); break;
      case "quit": host.quit(); break;
    }
  });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") host.menuClose(); });
  host.on("settings", (s) => { S = s; render(); });
  render();
})();
