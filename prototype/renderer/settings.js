/* 설정 창. 설정은 메인이 관리 — 여기서 바꾸면 host.setSettings(patch), 다른 창의 변경은 "settings" 이벤트로 받는다. */
(async () => {
  const host = window.host;
  // FULL = {version, global:{sound,display}, characters:[...]} (메인 원본). S = 선택한 캐릭터 뷰 {skin,mode,scale,opacity,behavior,sound,display}
  let FULL = await host.getSettings();
  let cur = FULL.characters[0].id;
  const GLOBAL_KEYS = new Set(["sound", "display", "news", "ai", "talk"]);   // talk = 대본으로 하는 말(혼잣말)
  const charOf = (id) => FULL.characters.find(c => c.id === id);
  const view = () => { const c = charOf(cur) || FULL.characters[0]; cur = c.id; return { ...c, sound: FULL.global.sound, display: FULL.global.display, news: FULL.global.news || {}, ai: FULL.global.ai || {}, talk: FULL.global.talk || {} }; };
  let S = view();
  let catalog = await host.getCatalog();
  let voiceIndex = {};
  try { voiceIndex = JSON.parse(host.readText(`${catalog.assetRoot}/voice/index.json`)); } catch {}
  KO.load(catalog.dataRoot || catalog.assetRoot);

  const getPath = (obj, p) => p.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const patchOf = (p, v) => p.split(".").reverse().reduce((acc, k) => ({ [k]: acc }), v);
  const fmt = (v, f) => f === "%" ? Math.round(v) + "%" : f === "px" ? Math.round(v) + "px" : f === "s" ? (+v).toFixed(1) + "s" : f === "s0" ? Math.round(v) + "초" : f === "min" ? Math.round(v) + "분" : v;
  // 통합 편집: 켜면 사도별 값이 모든 사도에게 함께 들어간다(스킨만은 메인에서 제외 — 다 같은 모습이 되니까).
  // 전역 설정(sound·display·ai…)은 원래 하나뿐이라 이 토글과 무관하다
  // 설정에 남는 값이라 우클릭 메뉴와 같은 토글을 본다 — 메뉴 창은 열 때마다 새로 만들어져서
  // 창 안에만 두면 껐다 켤 때마다 다시 체크해야 했다
  const bulkNow = () => !!(FULL.global.display && FULL.global.display.bulkEdit);
  const set = (p, v) => {
    setLocal(p, v);
    const target = (bulkNow() && !GLOBAL_KEYS.has(p.split(".")[0])) ? "*" : cur;
    host.setSettings(patchOf(p, v), target);
    if (target === "*") for (const c of FULL.characters) { const ks = p.split("."); let o = c; for (const k of ks.slice(0, -1)) o = o[k] || (o[k] = {}); if (ks[0] !== "skin") o[ks[ks.length - 1]] = v; }
  };
  function setLocal(p, v) { const ks = p.split("."); let o = GLOBAL_KEYS.has(ks[0]) ? FULL.global : charOf(cur); for (const k of ks.slice(0, -1)) o = o[k] || (o[k] = {}); o[ks[ks.length - 1]] = v; S = view(); } // 옛 설정 파일엔 news·ai·talk 이 없어 중간 객체가 비면 여기서 죽었다

  // ---- 캐릭터(인스턴스) 선택 바 ----
  const chipsEl = document.getElementById("char-chips");
  // 고른 형태(mode)와 실제로 그려지는 형태 — 스킨에 그 데이터가 없으면 다른 것으로 대체된다. 본문 배지와 상단 칩이 같은 계산을 쓴다
  const MODE_NAME = { minimi: "미니미", sd: "스탠딩", ingame: "전투 SD" };
  function shownMode(skin, mode) { const a = (catalog.skins.find(s => s.name === skin) || {}).sd || {}; return mode === "ingame" ? (a.ingame ? "ingame" : a.standing ? "sd" : "minimi") : mode === "sd" ? (a.standing ? "sd" : a.ingame ? "ingame" : "minimi") : "minimi"; }
  function renderCharBar() {
    chipsEl.innerHTML = FULL.characters.map((c, i) => { const shown = shownMode(c.skin, c.mode), tag = c.mode === "minimi" && shown === "minimi" ? "" : shown === c.mode ? ` · ${MODE_NAME[c.mode]}` : ` · <s>${MODE_NAME[c.mode]}</s>→${MODE_NAME[shown]}`;
      return `<span class="chip ${c.id === cur ? "on" : ""}" data-char="${c.id}" tabindex="0" role="button" title="${shown === c.mode ? "" : `${MODE_NAME[c.mode]} 데이터가 없어 ${MODE_NAME[shown]}로 표시 중`}"><span class="n">${i + 1}</span>${KO.skinName(c.skin, { withSkin: false })}${tag}</span>`; }).join("");
    const rm = document.getElementById("char-remove"); if (FULL.characters.length > 1) rm.removeAttribute("disabled"); else rm.setAttribute("disabled", "");
  }
  chipsEl.addEventListener("click", (e) => { const t = e.target.closest("[data-char]"); if (!t) return; selectChar(t.dataset.char); });
  chipsEl.addEventListener("keydown", (e) => { if (e.key !== "Enter" && e.key !== " ") return; const t = e.target.closest("[data-char]"); if (!t) return; e.preventDefault(); selectChar(t.dataset.char); });
  document.getElementById("char-add").addEventListener("click", () => host.addCharacter(cur));
  document.getElementById("char-remove").addEventListener("click", () => { if (FULL.characters.length > 1) host.removeCharacter(cur); });
  function selectChar(id) { if (!charOf(id)) return; cur = id; S = view(); renderControls(); markCurrent(); }

  // ---- 통합 편집 토글 ----
  const bulkEl = document.getElementById("bulk");
  // 메인은 보낸 창에 자기 변경을 되돌려 주지 않으니(에코 방지) 안내 문구는 여기서 직접 고친다
  if (bulkEl) bulkEl.addEventListener("change", () => { set("display.bulkEdit", bulkEl.checked); updateBulkNote(); });
  function updateBulkNote() {
    const bulk = bulkNow();
    if (bulkEl) { bulkEl.checked = bulk; document.getElementById("bulk-wrap").classList.toggle("on", bulk); }
    const note = document.getElementById("charbar-note"); if (!note) return;
    note.textContent = COMMON_TABS.has(curTab) ? "이 탭의 설정은 모든 사도에 공통으로 적용됩니다."
      : bulk ? `아래에서 바꾸는 값이 사도 ${FULL.characters.length}명 모두에게 적용됩니다 (외형은 각자 그대로).`
      : curTab === "display" ? "크기·불투명도는 선택한 사도에만, 아래 '전체 공통'은 모든 사도에 적용됩니다."
      : "이 탭의 설정은 선택한 사도에만 적용됩니다. 여러 사도를 함께 바꾸려면 '모든 사도에 적용'을 켜 주세요.";
    const w = document.getElementById("bulk-wrap"); if (w) w.style.display = FULL.characters.length > 1 && !COMMON_TABS.has(curTab) ? "" : "none";
  }

  host.on("select", (id) => selectChar(id));

  // ---- 탭 ----
  const COMMON_TABS = new Set(["sound", "news", "ai", "about"]);   // 모든 사도 공통인 탭 — 사도 칩을 흐리게, 일괄 적용은 숨김
  let curTab = "character";
  const showTab = (name) => {
    curTab = name;
    for (const b of document.querySelectorAll("nav button")) b.classList.toggle("on", b.dataset.tab === name);
    for (const s of document.querySelectorAll("main section")) s.classList.toggle("on", s.id === "tab-" + name);
    document.getElementById("charbar").classList.toggle("common", COMMON_TABS.has(name)); updateBulkNote();
    if (name === "ai") refreshAi(); else if (name === "news") renderNews(); // 브로드캐스트 때는 보이는 탭만 새로 그리므로, 탭을 열 때 한 번은 채워야 한다
  };
  for (const b of document.querySelectorAll("nav button")) b.addEventListener("click", () => showTab(b.dataset.tab));
  host.on("tab", (t) => showTab(t));

  // ---- 일반 컨트롤 바인딩 (data-s="path") ----
  function bindControls() {
    for (const el of document.querySelectorAll("[data-s]")) {
      const p = el.dataset.s, mul = +(el.dataset.scale || 1);
      if (el.type === "checkbox") el.addEventListener("change", () => set(p, el.checked));
      else if (el.type === "radio") el.addEventListener("change", () => { if (el.checked) set(p, el.value); });
      else if (el.type === "range") {
        const val = el.parentElement.querySelector(".val");
        el.addEventListener("input", () => { const v = el.value / mul; setLocal(p, v); if (val) val.textContent = fmt(el.value, val.dataset.fmt); });
        el.addEventListener("change", () => set(p, el.value / mul));
      }
      else if (el.tagName === "SELECT") el.addEventListener("change", () => set(p, el.dataset.num ? +el.value : el.value));   // 모니터 id 는 숫자다 — 문자열로 보내면 비교가 안 맞는다
      else if (el.type === "text") el.addEventListener("change", () => set(p, el.value.trim()));
    }
    // 글자 입력은 change(포커스가 떠날 때)에만 저장된다 — 타이핑하고 곧장 창을 닫으면 change 가 안 와 적은 것이 사라졌다
    window.addEventListener("beforeunload", () => { const el = document.activeElement; if (!el || el.type !== "text" || !el.dataset.s) return; const v = el.value.trim(); if (v !== (getPath(S, el.dataset.s) ?? "")) set(el.dataset.s, v); });
  }
  function renderControls() {
    for (const el of document.querySelectorAll("[data-s]")) {
      const v = getPath(S, el.dataset.s), mul = +(el.dataset.scale || 1);
      if (el.type === "checkbox") el.checked = !!v;
      else if (el.type === "radio") el.checked = (v === el.value);
      else if (el.type === "range") { if (document.activeElement === el) continue; el.value = v * mul; const val = el.parentElement.querySelector(".val"); if (val) val.textContent = fmt(v * mul, val.dataset.fmt); } // 끌고 있는 슬라이더는 브로드캐스트로 되돌리지 않는다(글자·선택과 같은 규칙)
      else if (el.tagName === "SELECT" || el.type === "text") { if (document.activeElement !== el) el.value = v ?? ""; }
    }
    if (document.querySelector("#tab-ai.on")) refreshAi(); // 설정이 바뀔 때마다(슬라이더 한 칸에도) Ollama 에 물어봤다 — 보이는 탭일 때만
    for (const row of document.querySelectorAll("[data-vol]")) row.classList.toggle("off", S.sound.muted);
    renderVoiceSummary();
    { const MODE_DESC = { minimi: "게임 로비의 작은 모습입니다. 폴짝 뛰며 이동하고 모든 외형을 지원합니다.", sd: "사도 상세 화면의 모습입니다. 표정과 교감 동작을 지원하며, 이동할 때는 미니미로 전환됩니다.", ingame: "전투에서 사용하는 모습입니다. 표정·교감 동작은 없고 별도의 전투 SD 데이터가 필요합니다." };
      const md = document.getElementById("mode-desc"); if (md) md.textContent = MODE_DESC[S.mode] || ""; }
    const mn = document.getElementById("mode-note"); if (mn) { const cur = catalog.skins.find(s => s.name === S.skin); const a = cur?.sd || {};
      // 고른 형태와 실제로 그려지는 형태가 다르면 배지로 분명히 — "선택이 안 먹었다" 로 느끼지 않게 (UI 리뷰)
      const NAME = MODE_NAME, shown = shownMode(S.skin, S.mode);
      const missing = S.mode === "ingame" && !a.ingame ? "전투 SD 데이터 없음 (게임 데이터 가져오기 → '전투 SD' 선택)" : S.mode === "sd" && !a.standing ? "스탠딩 데이터 없음 (게임에서 사도 상세 화면을 한 번 열어 본 뒤 다시 가져오기)" : "";
      mn.innerHTML = shown === S.mode ? "" : `<span class="badge warn">현재 표시: ${NAME[shown]}</span> ${KO.skinName(S.skin)}은(는) ${missing}`; }
    const nv = document.getElementById("nav-ver"); if (nv) nv.textContent = "v" + (catalog.version || "");
    document.title = `사도 데스크 설정 — ${KO.skinName(S.skin)}${FULL.characters.length > 1 ? ` (${FULL.characters.findIndex(c => c.id === cur) + 1}/${FULL.characters.length})` : ""}`;
    renderCharBar();
    updateBulkNote();
    const note = document.getElementById("name-note");
    if (note) note.textContent = KO.isGuessed(S.skin) ? `※ "${KO.heroName(KO.parse(S.skin).hero)}"는 공식 표기가 확인되지 않은 추정 이름입니다 (assets/names-ko.json 에서 수정 가능)` : "";
  }

  // ---- 캐릭터 그리드 ----
  const pages = {};
  async function loadPages() {
    const names = new Set(catalog.skins.map(s => s.region?.page).filter(Boolean));
    await Promise.all([...names].map(n => new Promise(res => { const img = new Image(); img.onload = () => { pages[n] = img; res(); }; img.onerror = res; img.src = `file:///${catalog.assetRoot}/minimi/${n}`; })));
  }
  function drawThumb(cv, region) {
    const g = cv.getContext("2d"); cv.width = 144; cv.height = 192; g.clearRect(0, 0, cv.width, cv.height);
    const img = region && pages[region.page]; if (!img) return;
    const rot = region.degrees === 90;
    const sw = rot ? region.height : region.width, sh = rot ? region.width : region.height; // 아틀라스에 실제로 놓인 크기
    const dw = region.width, dh = region.height;                                           // 원래 크기
    const k = Math.min(cv.width / dw, cv.height / dh);
    g.save(); g.translate(cv.width / 2, cv.height / 2); g.scale(k, k);
    if (rot) { g.rotate(Math.PI / 2); g.drawImage(img, region.x, region.y, sw, sh, -sw / 2, -sh / 2, sw, sh); }
    else g.drawImage(img, region.x, region.y, sw, sh, -dw / 2, -dh / 2, dw, dh);
    g.restore();
  }
  // 보이스 수·카테고리·미리듣기 파일은 마스코트 창이 카탈로그에 세어 준 것을 쓴다(voiceSetFor 하나가 진실). 여기서 index.json 을 다시 합치던 때는
  // 스킨 묶음이 카테고리를 통째로 갈아치워(줄기 단위 대체가 아니라) HUD 와 타일 숫자가 달랐다
  const skinInfo = (name) => catalog.skins.find(s => s.name === name) || {};
  const voiceCountOf = (skinName) => skinInfo(skinName).voices || 0;
  const grid = document.getElementById("skin-grid"), search = document.getElementById("skin-search"), voicedOnly = document.getElementById("skin-voiced"), sdOnly = document.getElementById("skin-sd");
  const tiles = new Map();
  function buildGrid() {
    grid.innerHTML = ""; tiles.clear();
    for (const sk of [...catalog.skins].sort((a, b) => KO.skinName(a.name).localeCompare(KO.skinName(b.name), "ko") || a.name.localeCompare(b.name))) {
      const t = document.createElement("div"); t.className = "tile"; t.dataset.skin = sk.name;
      const vc = voiceCountOf(sk.name);
      const mm = sk.name.replace(/^Mini_/, "").match(/^(.*?)(Skin\d+)?$/), folder = mm[1].toLowerCase(), variant = mm[2] ? mm[2].toLowerCase() : "base";
      const guess = KO.isGuessed(sk.name);
      t.title = [`${KO.skinName(sk.name)} (${sk.name})`, guess ? "※ 추정 이름" : null, `음성: ${voiceIndex[folder] ? `${folder}/ (${variant === "base" ? "기본" : "사복 " + variant.slice(4)})` : "없음"} · ${vc}개`].filter(Boolean).join("\n"); // 기본↔이격 분리 확인용
      t.dataset.search = KO.searchText(sk.name);
      t.innerHTML = `<canvas></canvas><div class="nm">${KO.skinName(sk.name, { withSkin: false })}${mm[2] ? `<br><span style="color:var(--muted)">${KO.skinTitle(sk.name)}</span>` : ""}</div><span class="vc ${vc ? "" : "zero"}">♪${vc}</span>${guess ? '<span class="q" title="추정 이름">?</span>' : ""}`;
      t.dataset.sd = (sk.sd?.ingame || sk.sd?.standing) ? "1" : "";
      t.dataset.voices = vc;
      drawThumb(t.querySelector("canvas"), sk.region);
      t.addEventListener("click", () => set("skin", sk.name));
      grid.appendChild(t); tiles.set(sk.name, t);
    }
    filterGrid(); markCurrent();
  }
  function filterGrid() {
    const q = search.value.trim().toLowerCase(); let n = 0;
    for (const [name, t] of tiles) { const show = (!q || t.dataset.search.includes(q)) && (!voicedOnly.checked || +t.dataset.voices > 0) && (!sdOnly.checked || t.dataset.sd); t.style.display = show ? "" : "none"; if (show) n++; }
    document.getElementById("skin-count").textContent = `${n} / ${tiles.size}`;
  }
  function markCurrent() {
    for (const [name, t] of tiles) t.classList.toggle("on", name === S.skin);
    const t = tiles.get(S.skin); if (!t) return; // 그리드 안에서만 스크롤 (main 전체가 밀리지 않게)
    const top = t.offsetTop - grid.offsetTop; if (top < grid.scrollTop || top + t.offsetHeight > grid.scrollTop + grid.clientHeight) grid.scrollTop = top - grid.clientHeight / 2 + t.offsetHeight / 2;
  }
  search.addEventListener("input", filterGrid); voicedOnly.addEventListener("change", filterGrid); sdOnly.addEventListener("change", filterGrid);

  // ---- 행동 탭: 애니 재생 ----
  const animSel = document.getElementById("anim-select");
  function buildAnims() { animSel.innerHTML = catalog.animations.map(a => `<option value="${a.name}">${KO.anim(a.name)} · ${a.duration}초</option>`).join(""); }
  document.getElementById("anim-play").addEventListener("click", () => host.mascot("play", animSel.value, cur));
  document.getElementById("respawn").addEventListener("click", () => host.mascot("respawn", undefined, cur));

  // ---- 사운드 탭 ----
  function renderVoiceSummary() {
    const parts = Object.entries(skinInfo(S.skin).voiceCats || {}).map(([k, n]) => `${KO.voiceCat(k)} ${n}`);
    document.getElementById("voice-summary").textContent = parts.length ? `${KO.skinName(S.skin)} — ${parts.join(", ")}` : `${KO.skinName(S.skin)} — 없음`;
  }
  let previewAudio = null;
  for (const b of document.querySelectorAll("[data-preview]")) b.addEventListener("click", () => {
    const s = S.sound; if (s.muted) return;
    let src, vol;
    if (b.dataset.preview === "voice") {
      const f = skinInfo(S.skin).previewVoice; if (!f) return;
      src = `file:///${catalog.assetRoot}/voice/${f}`; vol = s.master * s.voice;
    } else { src = `file:///${catalog.assetRoot}/sfx/jump02.wav`; vol = s.master * s.sfx; }
    if (previewAudio) previewAudio.pause();
    previewAudio = new Audio(src); previewAudio.volume = Math.max(0, Math.min(1, vol)); previewAudio.play().catch(() => {});
  });

  // ---- 알림 탭 ----
  // 제목·주소는 유튜브와 라운지에서 온 값이다. 쿠폰 게시판처럼 아무나 글을 쓰는 곳도 있고,
  // news.js 의 unesc 가 &lt; 를 < 로 되돌려 놓으므로 문자열로 HTML 을 조립하면 그대로 태그가 된다.
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"'`]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || "")) ? String(u) : "");
  async function renderNews() {
    const r = await host.newsList();
    const st = r.status || {};
    document.getElementById("news-status").textContent = `${st.lastCheck ? "마지막 확인 " + new Date(st.lastCheck).toLocaleString("ko-KR") : "아직 확인 안 함"}${st.lastError ? " · 오류: " + st.lastError : ""} · 안 읽음 ${r.unread}`;
    document.getElementById("news-list").innerHTML = r.items.length ? r.items.slice(0, 20).map(i => `<div style="padding:3px 0;${i.read ? "" : "font-weight:700;color:var(--text)"}"><a href="#" data-url="${esc(safeUrl(i.url))}" data-id="${esc(i.id)}" style="color:inherit;text-decoration:none">[${esc(i.label)}] ${esc(i.title)}</a> <span style="color:var(--muted);font-size:11px">${i.date ? new Date(i.date).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}</span></div>`).join("") : "아직 새 소식이 없어요. 처음 켠 시점 이후 올라오는 글부터 알립니다.";
  }
  document.getElementById("news-list").addEventListener("click", (e) => { const a = e.target.closest("[data-url]"); if (!a) return; e.preventDefault(); host.openUrl(a.dataset.url, a.dataset.id); setTimeout(renderNews, 300); });
  // ---- AI 대화 탭 ----
  let aiTimer = null;
  // ---- 화면 보기: 사도가 볼 창 고르기 ----
  // 창 제목은 열어 둔 문서에 따라 매번 달라지므로 앱 이름표(맨 뒤 토막)만 기억한다.
  // 지금 안 열려 있어도 이미 켜 둔 것은 목록에 남긴다 — 안 그러면 끌 방법이 없다
  const allowedWins = () => (getPath(FULL.global, "ai.screenWindows") || []).slice();
  function toggleWin(label, on) {
    const cur = allowedWins(), i = cur.indexOf(label);
    if (on && i < 0) cur.push(label); else if (!on && i >= 0) cur.splice(i, 1); else return;
    set("ai.screenWindows", cur);
  }
  async function renderWindows() {
    const box = document.getElementById("ai-win-list"); if (!box) return;
    const wrap = document.getElementById("ai-win-wrap");
    if (wrap) wrap.style.display = (getPath(FULL.global, "ai.screenScope") || "windows") === "windows" ? "" : "none";
    const open = (await host.aiWindows()) || [];
    const on = allowedWins();
    const rows = open.map(w => ({ label: w.label, title: w.title, open: true }));
    for (const l of on) if (!rows.some(r => r.label === l)) rows.push({ label: l, title: "지금 열려 있지 않습니다", open: false });
    box.innerHTML = rows.length
      ? rows.map(r => `<label class="toggle" style="display:flex;gap:8px;padding:3px 0;${r.open ? "" : "opacity:.55"}"><input type="checkbox" data-win="${esc(r.label)}"${on.includes(r.label) ? " checked" : ""}><span><b>${esc(r.label)}</b> <span style="color:var(--muted);font-size:11px">${esc(r.title)}</span></span></label>`).join("")
      : "선택할 수 있는 창이 없습니다.";
    for (const el of box.querySelectorAll("[data-win]")) el.addEventListener("change", () => { toggleWin(el.dataset.win, el.checked); renderWindows(); });
  }
  { const b = document.getElementById("ai-win-refresh"); if (b) b.addEventListener("click", () => renderWindows()); }

  async function refreshAi() {
    renderWindows();
    clearTimeout(aiTimer); aiTimer = setTimeout(async () => {
      const st = await host.aiStatus(); if (!st) return;
      const names = { ollama: "Ollama", gemini: "Gemini", anthropic: "Claude", openai: "OpenAI 호환" };
      // 고른 서비스가 아직 준비되지 않았으면(키 없음·Ollama 미연결) "현재 사용" 이라 하지 않는다
      const ready = st.resolved && (st.resolved === "ollama" ? (st.ollama.running && st.ollama.hasModel) : st.resolved === "mock" ? true : !!(st[st.resolved] || {}).key);
      document.getElementById("ai-resolved").textContent = !st.resolved ? "→ 사용할 수 있는 AI 서비스가 없습니다. 아래에서 하나를 준비해 주세요."
        : ready ? `→ 현재 사용: ${names[st.resolved]}` : `→ ${names[st.resolved]}을(를) 골랐지만 아직 준비되지 않았습니다. 아래 카드에서 ${st.resolved === "ollama" ? "설치·모델 내려받기를" : "API 키 저장을"} 진행해 주세요.`;
      { const prov = getPath(FULL.global, "ai.provider") || "auto", order = document.getElementById("ai-order");
        const DESC = { auto: "자동 선택: Gemini → Anthropic → Ollama → OpenAI 호환 순으로, 준비된 첫 서비스를 씁니다.", ollama: "내 PC에서 실행합니다. API 키와 요금이 없고 대화가 PC 밖으로 나가지 않습니다.", gemini: "Google API 키가 필요합니다. 무료 등급이 있습니다.", anthropic: "Anthropic API 키가 필요합니다 (유료). 말투 재현 측정에서 가장 높았습니다.", openai: "Groq·OpenRouter·LM Studio 등 /v1/chat/completions 를 제공하는 서비스를 연결합니다." };
        if (order) order.textContent = DESC[prov] || "";
        // 고른 서비스의 카드만 펼치고 나머지는 '다른 서비스 설정' 로 접는다 — 흐리게 두면 못 쓰는 것처럼 보였다(UI 리뷰)
        const CARD = { gemini: "Google Gemini", ollama: "Ollama", anthropic: "Anthropic", openai: "OpenAI" };
        let fold = document.getElementById("ai-others");
        if (!fold) { fold = document.createElement("details"); fold.id = "ai-others"; fold.className = "fold"; fold.innerHTML = "<summary>다른 서비스 설정</summary>"; }
        const isCard = c => Object.values(CARD).some(t => ((c.querySelector("h3") || {}).textContent || "").startsWith(t));
        const cards = [...document.querySelectorAll("#tab-ai > .card, #tab-ai #ai-others > .card")].filter(isCard);
        const anchor = document.querySelector("#tab-ai .card.warn");
        if (prov === "auto") { for (const c of [...cards].reverse()) anchor.after(c); if (fold.parentNode) fold.remove(); }   // after 는 앞에 끼우므로 역순으로 넣어 원래 순서
        else {
          const mine = cards.find(c => c.querySelector("h3").textContent.startsWith(CARD[prov])), others = cards.filter(c => c !== mine);
          if (mine) anchor.after(mine);
          for (const c of others) fold.appendChild(c);
          fold.querySelector("summary").textContent = `다른 서비스 설정 (${others.map(c => c.querySelector("h3").textContent.split(" (")[0]).join(" · ")})`;
          (mine || anchor).after(fold);
        } }
      { const enc = document.getElementById("ai-key-enc"); if (enc) enc.textContent = st.keysEncrypted === false ? "이 PC에서는 운영체제 암호화를 사용할 수 없어 키를 암호화하지 않은 상태로 저장합니다." : st.keysEncrypted ? "키는 Windows 계정에 묶인 암호화(DPAPI)로 저장합니다." : ""; }
      const o = st.ollama; document.getElementById("ai-ollama-state").textContent = !o.running ? "Ollama에 연결할 수 없습니다. 설치·실행 상태와 서버 주소를 확인해 주세요." : o.hasModel ? `연결됨 · 모델 ${o.models.length}개 설치됨` : `연결됨 · 모델 없음 → '내려받기'를 눌러 주세요 (설치된 모델: ${o.models.join(", ") || "-"})`;
      // ①②③ 단계 표시 — Ollama 가 뭔지 모르는 사람이 지금 어디까지 왔는지 보게. 끝난 단계는 ✓, 지금 할 단계는 →
      { const s1 = document.getElementById("ai-step1-state"), s2 = document.getElementById("ai-step2-state");
        if (s1) { s1.textContent = o.running ? "✓ 설치됨 · 실행 중" : "→ 아직 연결되지 않았습니다 (설치 뒤 이 탭을 다시 열면 확인됩니다)"; s1.style.color = o.running ? "var(--ok, #7bd88f)" : ""; }
        if (s2) { s2.textContent = !o.running ? "①을 먼저 진행해 주세요" : o.hasModel ? `✓ 모델 있음 (${o.models.join(", ")})` : "→ 아래 '내 PC에 맞추기' 다음 '내려받기'를 눌러 주세요"; s2.style.color = o.running && o.hasModel ? "var(--ok, #7bd88f)" : ""; } }
      for (const k of ["gemini", "anthropic", "openai"]) document.getElementById(`ai-key-${k}-state`).textContent = st[k].key ? "저장됨 ✓" : "저장된 키 없음";
      // PC 사양과 그에 맞는 모델 — 지금 고른 것이 사양에 안 맞으면 눈에 띄게 알린다
      const spec = document.getElementById("ai-ollama-spec");
      if (spec) {
        if (!st.machine || !st.recommend) spec.textContent = "PC 사양을 읽지 못했습니다. RAM·그래픽카드 메모리를 보고 모델을 직접 골라 주세요.";
        else {
          const mc = st.machine, rc = st.recommend;
          const hw = `RAM ${mc.ramGB}GB` + (mc.vramGB != null ? ` · 그래픽카드 메모리 ${mc.vramGB}GB` : " · 그래픽카드 메모리 확인 불가");
          const cur = (document.querySelector('[data-s="ai.ollama.model"]') || {}).value || "";
          const same = cur && (cur === rc.model || cur.split(":")[0] === rc.model.split(":")[0]);
          spec.textContent = (same || !cur) ? `${hw} → ${rc.model} (${rc.ko}) 권장` : `${hw} → ${rc.model} (${rc.ko}) 권장 · 지금은 ${cur}`;
          spec.style.color = (same || !cur) ? "" : "#c60";
          // 권장과 다를 때만 버튼을 보인다 — 누르기 전에는 설정을 건드리지 않는다
          const fit = document.getElementById("ai-fit");
          if (fit) { fit.style.display = (same || !cur) ? "none" : ""; fit.dataset.model = rc.model; }
        }
      }
    }, 50);
  }
  for (const b of document.querySelectorAll("[data-savekey]")) b.addEventListener("click", async () => { const k = b.dataset.savekey, inp = document.getElementById(`ai-key-${k}`); await host.aiSetKey(k, inp.value); inp.value = ""; refreshAi(); });
  for (const a of document.querySelectorAll("[data-ai-url]")) a.addEventListener("click", (e) => { e.preventDefault(); host.aiOpenUrl(a.dataset.aiUrl); });
  document.getElementById("ai-test").addEventListener("click", async (e) => { const out = document.getElementById("ai-test-out"); e.target.disabled = true; out.textContent = "확인 중…"; const r = await host.aiTest(); e.target.disabled = false; out.textContent = r.ok ? `연결됨 [${r.provider}/${r.model}] ${r.text} (${r.emotion || "감정 태그 없음"})` : `연결 실패: ${r.error}`; });
  document.getElementById("ai-pull").addEventListener("click", async (e) => { const model = getPath(FULL.global, "ai.ollama.model"); const out = document.getElementById("ai-pull-out"); e.target.disabled = true; out.textContent = `${model} 내려받는 중…`; const r = await host.aiPull(model); e.target.disabled = false; out.textContent = r.ok ? "완료 ✓" : `실패: ${r.error}`; refreshAi(); });
  host.on("ai:pull-progress", (t) => { document.getElementById("ai-pull-out").textContent = t; });
  // 사용자가 눌렀을 때만 모델 이름을 바꾼다. 내려받기는 여전히 따로 눌러야 한다
  document.getElementById("ai-fit").addEventListener("click", (e) => {
    const m = e.target.dataset.model; if (!m) return;
    const input = document.querySelector('[data-s="ai.ollama.model"]');
    if (!input) return;
    input.value = m; input.dispatchEvent(new Event("change", { bubbles: true }));
    e.target.style.display = "none"; refreshAi();
  });
  document.getElementById("news-check").addEventListener("click", async (e) => { e.target.textContent = "확인 중…"; const r = await host.newsCheck(); e.target.textContent = "지금 확인"; document.getElementById("news-status").textContent = r.added.length ? `새 소식 ${r.added.length}개!` : (r.errors?.length ? "확인 실패: " + r.errors.join(" / ") : "새 소식 없음"); setTimeout(renderNews, 500); });
  document.getElementById("news-test").addEventListener("click", () => { host.newsTest(); setTimeout(renderNews, 500); });
  document.getElementById("news-read").addEventListener("click", () => { host.newsReadAll(); setTimeout(renderNews, 300); });

  // ---- 정보 탭 ----
  function renderAbout() {
    const voices = Object.values(voiceIndex).reduce((n, h) => n + Object.values(h).reduce((m, sk) => m + Object.values(sk).reduce((q, l) => q + l.length, 0), 0), 0);
    const guessedN = (KO.names.guessed || []).length;
    const kv = [["앱", `사도 데스크 프로토타입 v${catalog.version}`], ["실행 환경", `Electron ${catalog.electron}`], ["동작 런타임", `spine-ts ${spineVersion()}`], ["외형", `${catalog.skins.length}벌`], ["동작", `${catalog.animations.length}개`], ["음성", `${Object.keys(voiceIndex).length}명 · ${voices}파일`], ["한글 이름표", `${Object.keys(KO.names.heroes).length}명 (추정 ${guessedN}명 — <code>assets/names-ko.json</code>)`], ["설정 파일", `<code>${catalog.settingsFile}</code>`], ["게임 데이터 폴더", `<code>${catalog.assetRoot}</code>`]];
    document.getElementById("about-kv").innerHTML = kv.map(([k, v]) => `<div class="k">${k}</div><div>${v}</div>`).join("");
  }
  const spineVersion = () => "4.1.56";
  for (const b of document.querySelectorAll("[data-open]")) b.addEventListener("click", () => host.openPath(b.dataset.open));
  document.getElementById("assets-setup")?.addEventListener("click", () => host.assetsOpenSetup());
  // 진단 정보 — 문제를 알릴 때 붙이라고. 키·대화 내용은 들어가지 않는다
  document.getElementById("diag-copy")?.addEventListener("click", async (e) => {
    const b = e.target; b.disabled = true; const was = b.textContent;
    try { const t = await host.diagGet(); host.copyText(t); b.textContent = "복사했습니다 ✓"; }
    catch (err) { b.textContent = "복사 실패: " + err.message; }
    setTimeout(() => { b.textContent = was; b.disabled = false; }, 2500);
  });
  document.getElementById("reset").addEventListener("click", () => { if (confirm("설정을 초기화하시겠습니까?\n추가한 사도와 개별 설정이 초기화됩니다. AI 설정과 API 키는 유지됩니다.")) host.resetSettings(); });

  // ---- 동기화 ----
  host.on("settings", (s) => { FULL = s; S = view(); renderControls(); markCurrent(); if (document.querySelector("#tab-news.on")) renderNews(); if (document.querySelector("#tab-ai.on")) refreshAi(); });   // 서비스를 바꾸면 카드 순서·흐림도 따라간다
  host.on("catalog", async (c) => { catalog = c; await loadPages(); buildGrid(); buildAnims(); renderAbout(); });

  bindControls(); renderControls(); renderNews();
  if (catalog.skins.length) { await loadPages(); buildGrid(); buildAnims(); renderAbout(); }
  else document.getElementById("skin-count").textContent = "마스코트 로딩 중…";
  console.log(`SETTINGS ready skins=${catalog.skins.length} anims=${catalog.animations.length} skin=${S.skin} chars=${FULL.characters.length} cur=${cur}`);
})();
