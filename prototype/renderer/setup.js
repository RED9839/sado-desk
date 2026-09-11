/* 에셋 가져오기 창: 메인이 python tools/extract-all.py 를 실행하고 JSON 진행 줄을 보내 준다 */
(async () => {
  const host = window.host;
  const el = (id) => document.getElementById(id);
  const log = el("log"), bar = el("bar");
  let running = false;
  function line(msg, level = "info") { const d = document.createElement("div"); d.className = level; d.textContent = msg; log.appendChild(d); log.scrollTop = log.scrollHeight; }
  async function refresh() {
    const s = await host.assetsStatus();
    el("status").innerHTML = s.hasAssets
      ? `<b>에셋 있음</b> — <code>${s.root}</code><br>스탠딩 ${s.standing}세트 · 인게임 SD ${s.ingame}세트 · 보이스 ${s.voice ? "있음" : "없음"}`
      : `<b style="color:var(--warn)">에셋 없음</b> — 아래에서 추출하면 <code>${s.userDataRoot}</code> 에 저장됩니다`;
    el("pyinfo").textContent = s.packaged ? "" : `python: ${s.python} (UnityPy · Pillow · imageio-ffmpeg 필요)`;
    running = s.running; el("start").disabled = running; el("cancel").disabled = !running;
  }
  el("pick-mumu").addEventListener("click", async () => { const p = await host.assetsPickMumu(); if (p) el("mumu").value = p; });
  let devices = [];
  async function scan() {
    const sel = el("device"); sel.innerHTML = `<option value="">검색 중…</option>`; el("scan").disabled = true;
    const r = await host.assetsScan(); devices = r.devices || [];
    sel.innerHTML = devices.length
      ? devices.map((d, i) => d.unavailable ? `<option value="" disabled>${d.emulator} — ${d.unavailable}</option>` : `<option value="${i}" ${d.hasGame && !devices.slice(0, i).some(x => x.hasGame) ? "selected" : ""}>${d.emulator} — ${d.serial} (Android ${d.android}) ${d.hasGame ? "✓ 트릭컬 데이터 있음" : "✗ 트릭컬 데이터 없음"}</option>`).join("") + `<option value="">자동 (트릭컬 데이터가 있는 첫 기기 / 뮤뮤 자동 실행)</option>`
      : `<option value="">붙을 수 있는 기기가 없어요 — 앱플레이어를 켜고 다시 검색 (자동: 뮤뮤 12가 설치돼 있으면 켜서 진행)</option>`;
    if (!r.ok && r.error) line(r.error, "warn");
    const ldOff = devices.find(d => d.unavailable && d.ldIndex != null);
    el("ld-adb").style.display = ldOff ? "" : "none"; el("ld-adb").dataset.idx = ldOff ? ldOff.ldIndex : "";
    for (const d of devices) if (d.unavailable) line(`${d.emulator}: ${d.unavailable}`, "warn"); else if (!d.hasGame) line(`${d.emulator} ${d.serial}: 트릭컬 데이터 없음 — 그 앱플레이어에서 게임을 실행해 리소스를 받아야 합니다`, "warn");
    el("scan").disabled = false;
  }
  el("scan").addEventListener("click", scan);
  el("ld-adb").addEventListener("click", async () => {
    const idx = +el("ld-adb").dataset.idx; el("ld-adb").disabled = true; line(`LD플레이어 인스턴스 ${idx}: ADB 디버깅을 켜고 재시작합니다…`);
    const r = await host.assetsEnableLdAdb(idx); el("ld-adb").disabled = false;
    if (!r.ok) line(r.error || "실패", "error"); else scan();
  });
  el("start").addEventListener("click", async () => {
    const steps = [...document.querySelectorAll("[data-step]")].filter(c => c.checked).map(c => c.dataset.step);
    log.innerHTML = ""; bar.style.width = "0%";
    const pick = devices[+el("device").value]; const manual = el("mumu").value.trim();
    const isAdb = /adb\.exe$/i.test(manual), isPort = /^\d{2,5}$/.test(manual), isSerial = /^[\w.-]+:\d{2,5}$/.test(manual) || /^emulator-\d+$/.test(manual);
    const r = await host.assetsExtract({ force: el("force").checked, steps, mumu: manual && !isAdb && !isPort && !isSerial ? manual : null, adb: pick ? pick.adb : (isAdb ? manual : null), serial: pick ? pick.serial : (isPort ? `127.0.0.1:${manual}` : isSerial ? manual : null) });
    if (!r.ok) { line(r.error, "error"); return; }
    running = true; el("start").disabled = true; el("cancel").disabled = false;
    line(`추출 시작 — ${steps.join(", ")}`);
  });
  el("cancel").addEventListener("click", () => { host.assetsCancel(); line("중단 요청…", "warn"); });
  el("use-folder").addEventListener("click", async () => {
    const p = await host.assetsPickFolder(); if (!p) return;
    const r = await host.assetsUseFolder(p);
    if (r.ok) { line(`에셋 폴더 지정: ${r.root}`, "ok"); refresh(); } else line(r.error, "error");
  });
  el("open-root").addEventListener("click", () => host.assetsOpenRoot());
  el("open-log").addEventListener("click", () => host.assetsOpenLog());
  host.on("extract:progress", (o) => {
    if (o.total) bar.style.width = `${Math.round(100 * (o.done || 0) / o.total)}%`;
    if (o.level === "ok") bar.style.width = "100%";
    // 같은 단계의 진행 카운트 줄은 마지막 줄을 덮어써서 로그가 길어지지 않게
    const last = log.lastElementChild;
    if (last && last.dataset.step === o.step && o.done != null && last.dataset.count === "1") { last.textContent = `[${o.step}] ${o.msg}`; return; }
    const d = document.createElement("div"); d.className = o.level || "info"; d.dataset.step = o.step; d.dataset.count = o.done != null ? "1" : "0"; d.textContent = `[${o.step}] ${o.msg}`; log.appendChild(d); log.scrollTop = log.scrollHeight;
  });
  host.on("extract:done", (r) => {
    running = false; el("start").disabled = false; el("cancel").disabled = true;
    line(r.ok ? "완료! 캐릭터가 화면에 나타납니다. 이 창은 닫아도 됩니다." : `종료됨 (code ${r.code}) — 위 메시지를 확인해 주세요`, r.ok ? "ok" : "error");
    refresh();
  });
  refresh(); scan();
})();
