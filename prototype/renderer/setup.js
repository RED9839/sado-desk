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
  el("start").addEventListener("click", async () => {
    const steps = [...document.querySelectorAll("[data-step]")].filter(c => c.checked).map(c => c.dataset.step);
    log.innerHTML = ""; bar.style.width = "0%";
    const r = await host.assetsExtract({ steps, mumu: el("mumu").value.trim() || null });
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
  refresh();
})();
