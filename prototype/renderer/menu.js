/* 우클릭 메뉴 — 별도 작은 창. 설정은 메인과 공유(host.setSettings), 캐릭터 명령은 host.mascot(). 창 높이는 내용에 맞춰 메인에 알림. */
(async () => {
  const host = window.host;
  // 화면 높이에 맞춘 밀도 — 창이 아니라 이 창이 뜬 모니터의 작업영역(DIP). 사람마다 해상도·배율이 달라 한 값으로는 어디선가 넘친다
  const density = (h) => h >= 860 ? "roomy" : h >= 700 ? "normal" : "compact";
  let S = await host.getSettings();
  const applyDensity = () => { const d = (S.display || {}).menuDensity; document.body.dataset.density = d && d !== "auto" ? d : density(screen.availHeight); };   // 설정 → 화면에서 고정할 수 있다
  applyDensity();
  const catalog = await host.getCatalog();
  KO.load(catalog.dataRoot || catalog.assetRoot);
  const menuEl = document.getElementById("menu");
  // '모든 사도에 함께' 가 켜져 있고 둘 이상 불러 뒀으면 사도별 값은 "*"(전원)으로 보낸다.
  // 사도 바꾸기(skin)와 전역 설정(sound·display)은 그대로 — 전역은 id 를 봐도 달라지는 게 없다
  const bulkOn = () => !!(S.display && S.display.bulkEdit) && (S.count || 1) > 1;
  const set = (patch, all) => { S = deepMerge(S, patch); host.setSettings(patch, all ? "*" : undefined); render(); };
  const MOODS = [["", "기본"], ["smile", "미소"], ["anger", "분노"], ["sad", "슬픔"], ["happy", "행복"], ["eat", "냠냠"], ["sulky", "삐짐"], ["surprise", "놀람"]];
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const deepMerge = (b, p) => { const o = { ...b }; for (const [k, v] of Object.entries(p || {})) o[k] = isObj(v) && isObj(b[k]) ? deepMerge(b[k], v) : v; return o; };
  // 창 높이는 실제 내용 높이(scrollHeight)로 — #menu에 max-height가 있어 rect 높이로 재면 창이 처음 크기에 갇혀 아래 항목(종료)이 잘려 보였음. 화면보다 길면 메인이 화면 높이로 자르고 #menu가 스크롤됨
  let lastH = 0;
  const resize = () => { const h = menuEl.scrollHeight + 6; if (h !== lastH) { lastH = h; host.menuResize(h); requestAnimationFrame(() => setTimeout(resize, 50)); } }; // 창 크기가 바뀐 뒤 내용 높이가 달라지면 한 번 더

  // 애니 목록: 현재 형태에 맞는 스켈레톤 애니 (마스코트가 카탈로그에 넣어준 것)
  const anims = (S.mode !== "minimi" && catalog.sdAnimations && catalog.sdAnimations.length) ? catalog.sdAnimations : catalog.animations.map(a => a.name);
  const groups = {};
  for (const n of anims) { const g = n.replace(/[\d_].*$/, ""); (groups[g] ||= []).push(n); }
  document.getElementById("sub-anims").innerHTML = Object.entries(groups).sort().map(([g, list]) => `<div class="group">${KO.animGroup(g)} (${list.length})</div>` + list.map(n => `<div class="item" data-anim="${n}">${KO.anim(n)}</div>`).join("")).join("");

  const skins = catalog.skins.map(s => s.name).sort((a, b) => KO.skinName(a).localeCompare(KO.skinName(b), "ko"));
  const skinList = document.getElementById("skin-list"), filter = document.getElementById("skin-filter");
  const renderSkins = () => { const qq = filter.value.trim().toLowerCase(); skinList.innerHTML = skins.filter(n => !qq || KO.searchText(n).includes(qq)).map(n => `<div class="item" data-skin="${n}">${KO.skinName(n)}${n === S.skin ? " ✓" : ""}</div>`).join(""); };
  filter.addEventListener("input", renderSkins);

  let newsItems = [];
  // 제목·작성자·오류 문자열은 유튜브와 라운지에서 온 값이다. 쿠폰 게시판처럼 아무나 글을 쓰는 곳도 있고,
  // news.js 의 unesc 가 &lt; 를 < 로 되돌려 놓으므로 문자열로 HTML 을 조립하면 그대로 태그가 된다.
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"'`]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c]));
  const fmtDate = (d) => { const t = new Date(d); return isNaN(t) ? "" : `${t.getMonth() + 1}/${t.getDate()}`; };
  async function loadNews() {
    const r = await host.newsList(); newsItems = r.items || [];
    document.getElementById("news-state").textContent = r.unread ? `${r.unread}개 ▸` : "▸";
    document.getElementById("sub-news").innerHTML = `<div class="item" data-act="news-check">지금 확인하기</div><div class="item" data-act="news-show">크레페한테 다시 듣기</div>` + (newsItems.length ? `<div class="group">최근 소식 (${newsItems.length})</div>` + newsItems.slice(0, 12).map(i => `<div class="item" data-news="${esc(i.id)}" title="${esc(i.title)}"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${i.read ? "opacity:.6" : "font-weight:700"}">[${esc(i.label)}] ${esc(i.title)}</span><span style="color:#9a9aa8;flex:none;margin-left:6px">${fmtDate(i.date)}</span></div>`).join("") : `<div class="group">아직 새 소식 없음 (${r.status?.lastCheck ? "마지막 확인 " + new Date(r.status.lastCheck).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "확인 전"})</div>`) + (r.status?.lastError ? `<div class="group" style="color:#ff8a8a">${esc(r.status.lastError)}</div>` : "");
  }
  function render() {
    document.getElementById("menu-title").textContent = KO.skinName(S.skin, { withSkin: false });
    document.getElementById("menu-sub").textContent = (S.count || 1) > 1 ? `사도 ${S.count}명` : "사도 데스크";
    const cur = catalog.skins.find(s => s.name === S.skin), sdA = cur?.sd || {};
    const MODES = [["minimi", "미니미", true], ["sd", "스탠딩", !!(sdA.standing || sdA.ingame)], ["ingame", "전투 SD", !!sdA.ingame]];
    document.getElementById("mode-state").textContent = (MODES.find(([k]) => k === S.mode) || MODES[0])[1];
    document.getElementById("mode-chips").innerHTML = MODES.map(([k, label, ok]) => `<div class="chip ${S.mode === k ? "on" : ""} ${ok ? "" : "off"}" data-mode="${k}" title="${ok ? "" : (k === "ingame" ? "이 외형은 전투 SD 데이터가 없습니다 (게임 데이터 가져오기 → '전투 SD' 선택)" : "이 외형은 스탠딩 데이터가 없습니다")}">${label}</div>`).join("");
    document.getElementById("skin-cur").textContent = KO.skinName(S.skin);
    document.getElementById("scale-chips").innerHTML = [0.3, 0.4, 0.5, 0.6, 0.8, 1.0].map(v => `<div class="chip ${v === S.scale ? "on" : ""}" data-scale="${v}">${Math.round(v * 100)}%</div>`).join("");
    document.getElementById("mood-chips").innerHTML = MOODS.map(([k, label]) => `<div class="chip ${(S.mood || "") === k ? "on" : ""}" data-mood="${k}">${label}</div>`).join("");
    document.getElementById("mood-state").textContent = (MOODS.find(([k]) => k === (S.mood || "")) || MOODS[0])[1] + (S.mode !== "sd" ? " (스탠딩에서)" : "") + " ▸";
    document.getElementById("mute-state").textContent = (S.sound.muted ? "꺼짐" : `${Math.round(S.sound.master * 100)}%`) + " ▸";
    document.getElementById("mute-item").textContent = S.sound.muted ? "소리 켜기" : "소리 끄기";
    for (const row of menuEl.querySelectorAll("[data-vol]")) { const k = row.dataset.vol, v = Math.round(S.sound[k] * 100); row.querySelector("input").value = v; row.querySelector(".val").textContent = v + "%"; row.classList.toggle("off", S.sound.muted); }
    document.getElementById("remove-item").style.display = (S.count || 1) > 1 ? "" : "none";
    { // '모든 사도에 함께' — 혼자면 의미가 없으니 숨긴다
      const it = document.getElementById("bulk-item"), on = bulkOn();
      it.style.display = (S.count || 1) > 1 ? "" : "none";
      it.classList.toggle("on", on);
      document.getElementById("bulk-state").textContent = on ? `켜짐 · ${S.count}명` : "꺼짐";
    }
    document.getElementById("screen-state").textContent = S.ai && S.ai.screen ? "" : "꺼짐";
    renderSkins(); loadNews().then(resize); resize();
  }
  for (const row of menuEl.querySelectorAll("[data-vol]")) {
    const input = row.querySelector("input");
    input.addEventListener("input", () => { row.querySelector(".val").textContent = input.value + "%"; });
    input.addEventListener("change", () => { set({ sound: { [row.dataset.vol]: input.value / 100 } }); host.mascot("preview", row.dataset.vol); });
  }
  menuEl.addEventListener("click", (e) => {
    const t = e.target.closest("[data-toggle],[data-act],[data-anim],[data-skin],[data-scale],[data-news],[data-mood],[data-mode]"); if (!t) return;
    if (t.dataset.mode) { if (!t.classList.contains("off")) set({ mode: t.dataset.mode }, bulkOn()); return; }
    if (t.dataset.mood !== undefined) { set(t.dataset.mood && S.mode !== "sd" ? { mood: t.dataset.mood, mode: "sd" } : { mood: t.dataset.mood }, bulkOn()); return; }
    if (t.dataset.news) { const it = newsItems.find(i => i.id === t.dataset.news); if (it) host.openUrl(it.url, it.id); host.menuClose(); return; }
    if (t.dataset.toggle) { const sub = document.getElementById("sub-" + t.dataset.toggle); const was = sub.classList.contains("open"); for (const el of menuEl.querySelectorAll(".sub.open")) el.classList.remove("open"); if (!was) sub.classList.add("open"); if (t.dataset.toggle === "skins" && !was) setTimeout(() => filter.focus(), 0); resize(); return; }
    if (t.dataset.anim) { host.mascot("play", t.dataset.anim); return; }
    if (t.dataset.skin) { set({ skin: t.dataset.skin }); return; }
    if (t.dataset.scale) { set({ scale: +t.dataset.scale }, bulkOn()); return; }
    switch (t.dataset.act) {

      case "bulk": set({ display: { bulkEdit: !(S.display && S.display.bulkEdit) } }); break;
      case "mute": set({ sound: { muted: !S.sound.muted } }); break;
      case "settings": host.openSettings(); host.menuClose(); break;
      case "chat": host.chatOpen(); host.menuClose(); break;
      case "selftalk": host.selfTalk(); host.menuClose(); break;
      case "screen": host.chatScreen(); host.menuClose(); break;
      case "add": host.addCharacter(); host.menuClose(); break;
      case "news-check": { t.textContent = "확인 중…"; host.newsCheck().then(r => { t.textContent = r.added.length ? `새 소식 ${r.added.length}개!` : (r.errors && r.errors.length ? "확인 실패: " + r.errors[0] : "새 소식 없음"); loadNews().then(resize); }); break; }
      case "news-show": host.newsShow(); host.menuClose(); break;
      case "remove": host.removeCharacter(); host.menuClose(); break;
      case "respawn": host.mascot("respawn"); host.menuClose(); break;
      case "quit": host.quit(); break;
    }
  });
  // 키보드: 항목·칩에 Tab 으로 닿고, ↑↓ 로 옮기고, Enter·Space 로 누른다 (UI 리뷰 — 클릭 중심이었다)
  const focusables = () => [...menuEl.querySelectorAll(".item,.chip,input[type=range]")].filter(el => el.offsetParent !== null && !el.classList.contains("off"));
  const applyTabIndex = () => { for (const el of menuEl.querySelectorAll(".item,.chip")) if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0"); };
  applyTabIndex(); new MutationObserver(applyTabIndex).observe(menuEl, { childList: true, subtree: true });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { host.menuClose(); return; }
    if (e.target && e.target.tagName === "INPUT" && e.target.type === "text") return;   // 검색칸에서는 글자 입력
    const list = focusables(), i = list.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const n = list.length ? list[(i + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length] : null; if (n) n.focus(); }
    else if ((e.key === "Enter" || e.key === " ") && i >= 0 && list[i].tagName !== "INPUT") { e.preventDefault(); list[i].click(); }
  });
  host.on("settings", (s) => { S = s; applyDensity(); render(); });   // 창은 재사용되니 열릴 때마다 — 다른 모니터로 옮겨 열릴 수 있다
  render();
})();
