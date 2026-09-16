/* 설정 창. 설정은 메인이 관리 — 여기서 바꾸면 host.setSettings(patch), 다른 창의 변경은 "settings" 이벤트로 받는다. */
(async () => {
  const host = window.host;
  // FULL = {version, global:{sound,display}, characters:[...]} (메인 원본). S = 선택한 캐릭터 뷰 {skin,mode,scale,opacity,behavior,sound,display}
  let FULL = await host.getSettings();
  let cur = FULL.characters[0].id;
  const GLOBAL_KEYS = new Set(["sound", "display", "news", "ai", "talk"]);   // talk = 대본으로 하는 말(혼잣말·잡담)
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
  const set = (p, v) => { setLocal(p, v); host.setSettings(patchOf(p, v), cur); };
  function setLocal(p, v) { const ks = p.split("."); let o = GLOBAL_KEYS.has(ks[0]) ? FULL.global : charOf(cur); for (const k of ks.slice(0, -1)) o = o[k] || (o[k] = {}); o[ks[ks.length - 1]] = v; S = view(); } // 옛 설정 파일엔 news·ai·talk 이 없어 중간 객체가 비면 여기서 죽었다

  // ---- 캐릭터(인스턴스) 선택 바 ----
  const chipsEl = document.getElementById("char-chips");
  function renderCharBar() {
    chipsEl.innerHTML = FULL.characters.map((c, i) => `<span class="chip ${c.id === cur ? "on" : ""}" data-char="${c.id}"><span class="n">${i + 1}</span>${KO.skinName(c.skin, { withSkin: false })}${c.mode === "sd" ? " · SD" : ""}</span>`).join("");
    const rm = document.getElementById("char-remove"); if (FULL.characters.length > 1) rm.removeAttribute("disabled"); else rm.setAttribute("disabled", "");
  }
  chipsEl.addEventListener("click", (e) => { const t = e.target.closest("[data-char]"); if (!t) return; selectChar(t.dataset.char); });
  document.getElementById("char-add").addEventListener("click", () => host.addCharacter(cur));
  document.getElementById("char-remove").addEventListener("click", () => { if (FULL.characters.length > 1) host.removeCharacter(cur); });
  function selectChar(id) { if (!charOf(id)) return; cur = id; S = view(); renderControls(); markCurrent(); }
  host.on("select", (id) => selectChar(id));

  // ---- 탭 ----
  const showTab = (name) => {
    for (const b of document.querySelectorAll("nav button")) b.classList.toggle("on", b.dataset.tab === name);
    for (const s of document.querySelectorAll("main section")) s.classList.toggle("on", s.id === "tab-" + name);
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
      else if (el.tagName === "SELECT") el.addEventListener("change", () => set(p, el.value));
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
    const mn = document.getElementById("mode-note"); if (mn) { const cur = catalog.skins.find(s => s.name === S.skin); const a = cur?.sd || {};
      mn.textContent = S.mode === "ingame" ? (a.ingame ? "" : a.standing ? `※ ${KO.skinName(S.skin)}은(는) 인게임 SD 데이터가 없어 스탠딩 SD로 표시됩니다 (에셋 가져오기 → '인게임 SD' 체크)` : `※ ${KO.skinName(S.skin)}은(는) SD 데이터가 없어 미니미로 표시됩니다`)
        : S.mode !== "sd" || a.standing ? "" : a.ingame ? `※ ${KO.skinName(S.skin)}은(는) 스탠딩 데이터가 없어 인게임 SD로 표시됩니다` : `※ ${KO.skinName(S.skin)}은(는) SD 데이터가 없어 미니미로 표시됩니다`; }
    const nv = document.getElementById("nav-ver"); if (nv) nv.textContent = "v" + (catalog.version || "");
    document.title = `사도 데스크 설정 — ${KO.skinName(S.skin)}${FULL.characters.length > 1 ? ` (${FULL.characters.findIndex(c => c.id === cur) + 1}/${FULL.characters.length})` : ""}`;
    renderCharBar();
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
      t.title = [`${KO.skinName(sk.name)} (${sk.name})`, guess ? "※ 추정 이름" : null, `보이스: ${voiceIndex[folder] ? `${folder}/ (${variant === "base" ? "기본" : "스킨 " + variant.slice(4)})` : "없음"} · ${vc}개`].filter(Boolean).join("\n"); // 기본↔이격 분리 확인용
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
  async function refreshAi() {
    clearTimeout(aiTimer); aiTimer = setTimeout(async () => {
      const st = await host.aiStatus(); if (!st) return;
      const names = { ollama: "Ollama", gemini: "Gemini", anthropic: "Claude", openai: "OpenAI 호환" };
      document.getElementById("ai-resolved").textContent = st.resolved ? `→ 지금 쓰는 것: ${names[st.resolved]}` : "→ 쓸 수 있는 제공자가 없어요 (아래에서 하나를 준비해 주세요)";
      const o = st.ollama; document.getElementById("ai-ollama-state").textContent = !o.running ? "실행 중 아님 — Ollama를 설치·실행해 주세요 (설치하면 자동으로 켜져 있음)" : o.hasModel ? `실행 중 · 모델 있음 (${o.models.length}개 설치됨)` : `실행 중 · 모델 없음 → '내려받기' (설치된 것: ${o.models.join(", ") || "-"})`;
      for (const k of ["gemini", "anthropic", "openai"]) document.getElementById(`ai-key-${k}-state`).textContent = st[k].key ? "저장됨 ✓" : "없음";
    }, 50);
  }
  for (const b of document.querySelectorAll("[data-savekey]")) b.addEventListener("click", async () => { const k = b.dataset.savekey, inp = document.getElementById(`ai-key-${k}`); await host.aiSetKey(k, inp.value); inp.value = ""; refreshAi(); });
  for (const a of document.querySelectorAll("[data-ai-url]")) a.addEventListener("click", (e) => { e.preventDefault(); host.aiOpenUrl(a.dataset.aiUrl); });
  document.getElementById("ai-test").addEventListener("click", async (e) => { const out = document.getElementById("ai-test-out"); e.target.disabled = true; out.textContent = "생각 중…"; const r = await host.aiTest(); e.target.disabled = false; out.textContent = r.ok ? `[${r.provider}/${r.model}] ${r.text} (${r.emotion || "감정 태그 없음"})` : `실패: ${r.error}`; });
  document.getElementById("ai-pull").addEventListener("click", async (e) => { const model = getPath(FULL.global, "ai.ollama.model"); const out = document.getElementById("ai-pull-out"); e.target.disabled = true; out.textContent = `${model} 내려받는 중…`; const r = await host.aiPull(model); e.target.disabled = false; out.textContent = r.ok ? "완료 ✓" : `실패: ${r.error}`; refreshAi(); });
  host.on("ai:pull-progress", (t) => { document.getElementById("ai-pull-out").textContent = t; });
  document.getElementById("news-check").addEventListener("click", async (e) => { e.target.textContent = "확인 중…"; const r = await host.newsCheck(); e.target.textContent = "지금 확인"; document.getElementById("news-status").textContent = r.added.length ? `새 소식 ${r.added.length}개!` : (r.errors?.length ? "확인 실패: " + r.errors.join(" / ") : "새 소식 없음"); setTimeout(renderNews, 500); });
  document.getElementById("news-test").addEventListener("click", () => { host.newsTest(); setTimeout(renderNews, 500); });
  document.getElementById("news-read").addEventListener("click", () => { host.newsReadAll(); setTimeout(renderNews, 300); });

  // ---- 정보 탭 ----
  function renderAbout() {
    const voices = Object.values(voiceIndex).reduce((n, h) => n + Object.values(h).reduce((m, sk) => m + Object.values(sk).reduce((q, l) => q + l.length, 0), 0), 0);
    const guessedN = (KO.names.guessed || []).length;
    const kv = [["앱", `사도 데스크 프로토타입 v${catalog.version}`], ["실행 환경", `Electron ${catalog.electron}`], ["애니메이션 런타임", `spine-ts ${spineVersion()}`], ["캐릭터(스킨)", `${catalog.skins.length}개`], ["애니메이션", `${catalog.animations.length}개`], ["보이스", `${Object.keys(voiceIndex).length}명 · ${voices}파일`], ["한글 이름표", `${Object.keys(KO.names.heroes).length}명 (추정 ${guessedN}명 — <code>assets/names-ko.json</code>)`], ["설정 파일", `<code>${catalog.settingsFile}</code>`], ["에셋 폴더", `<code>${catalog.assetRoot}</code>`]];
    document.getElementById("about-kv").innerHTML = kv.map(([k, v]) => `<div class="k">${k}</div><div>${v}</div>`).join("");
  }
  const spineVersion = () => "4.1.56";
  for (const b of document.querySelectorAll("[data-open]")) b.addEventListener("click", () => host.openPath(b.dataset.open));
  document.getElementById("assets-setup")?.addEventListener("click", () => host.assetsOpenSetup());
  document.getElementById("reset").addEventListener("click", () => { if (confirm("모든 설정을 기본값으로 되돌릴까요?")) host.resetSettings(); });

  // ---- 동기화 ----
  host.on("settings", (s) => { FULL = s; S = view(); renderControls(); markCurrent(); if (document.querySelector("#tab-news.on")) renderNews(); });
  host.on("catalog", async (c) => { catalog = c; await loadPages(); buildGrid(); buildAnims(); renderAbout(); });

  bindControls(); renderControls(); renderNews();
  if (catalog.skins.length) { await loadPages(); buildGrid(); buildAnims(); renderAbout(); }
  else document.getElementById("skin-count").textContent = "마스코트 로딩 중…";
  console.log(`SETTINGS ready skins=${catalog.skins.length} anims=${catalog.animations.length} skin=${S.skin} chars=${FULL.characters.length} cur=${cur}`);
})();
