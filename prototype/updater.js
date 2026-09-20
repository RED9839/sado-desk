/* 업데이트 — 깃허브 최신 릴리스가 이 버전보다 높으면 알리고, **앱 안에서 받아 설치**한다.
 * 받은 파일은 깃허브가 주는 sha256(assets[].digest)과 대조한다. 다르면 지우고 멈춘다.
 * 브라우저로 받지 않으므로 '웹에서 받은 파일' 표시(MOTW)가 붙지 않아 SmartScreen 경고도 뜨지 않는다.
 * main.js 에서 떼어 낸 것. 트레이 갱신은 ctx.refreshTray 로.
 *   const UP = require("./updater.js")(ctx); → { checkUpdate, get info(), get state(), download, install, newerThan, semver }
 */
const { app, shell } = require("electron");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const argHas = (f) => process.argv.includes(f);

module.exports = function createUpdater(ctx) {
  const UPDATE_REPO = "RED9839/sado-desk";
  let updateInfo = null, updateNotified = "";
  const semver = (v) => String(v || "").replace(/^v/, "").split(".").map(n => parseInt(n, 10) || 0);
  const newerThan = (a, b) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
  async function checkUpdate() {
    try {
      const r = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, { headers: { "User-Agent": `sado-desk/${app.getVersion()}`, Accept: "application/vnd.github+json" } });
      if (!r.ok) { console.log("update check", r.status); return; }
      const j = await r.json(); const tag = j.tag_name || "";
      if (!newerThan(tag, app.getVersion()) && !argHas("--update-force")) { updateInfo = null; return; }   // --update-force: 같은 판이어도 있는 셈 치고 흐름을 시험한다
      const ex = (j.assets || []).find(a => /\.exe$/i.test(a.name)) || {};
      updateInfo = { tag, url: j.html_url || `https://github.com/${UPDATE_REPO}/releases/latest`, asset: ex.browser_download_url, name: ex.name, size: ex.size || 0,
        sha256: /^sha256:/.test(ex.digest || "") ? ex.digest.slice(7) : null, notes: (j.body || "").slice(0, 2000) };
      ctx.refreshTray();
      if (updateNotified === tag) return; updateNotified = tag;
      const { Notification } = require("electron");
      if (Notification.isSupported()) { const n = new Notification({ title: `사도 데스크 ${tag} 업데이트가 나왔어요`, body: `지금 ${app.getVersion()} → ${tag.replace(/^v/, "")}. 클릭하면 다운로드 페이지가 열려요. (트레이 메뉴에서도 받을 수 있어요)`, silent: true }); n.on("click", () => shell.openExternal(updateInfo.url)); n.show(); }
      console.log(`update: ${app.getVersion()} → ${tag}`);
    } catch (e) { console.log("update check 실패", e.message); }
  }
  // 지난 판 설치 파일 치우기 — 설치가 끝나고 새 판으로 돌아오면 120MB 짜리가 남는다
  const busyWith = (f) => {   // 내려받는 중(.part)이거나 설치를 기다리는 파일인가
    if (!state || !state.file || (state.phase !== "downloading" && state.phase !== "ready" && state.phase !== "installing")) return false;
    const base = path.basename(state.file);
    return f === base || f === base + ".part";
  };
  function sweepOld() {
    try {
      const d = path.join(app.getPath("userData"), "update"); if (!fs.existsSync(d)) return;
      for (const f of fs.readdirSync(d)) {
        if (busyWith(f)) continue;   // 지금 받고 있거나 받아 둔 파일은 건드리지 않는다
        const v = (f.match(/(\d+\.\d+\.\d+)/) || [])[1];
        if (!v || !newerThan(v, app.getVersion())) { fs.rmSync(path.join(d, f), { force: true }); console.log("update: 지난 설치 파일 지움", f); }
      }
    } catch (e) { console.warn("update sweep", e.message); }
  }
  setTimeout(sweepOld, 5000);

  // ---- 받아서 설치 ----
  let state = { phase: "idle", got: 0, total: 0, file: null, error: null };   // idle · downloading · ready · installing · error
  const dir = () => { const d = path.join(app.getPath("userData"), "update"); fs.mkdirSync(d, { recursive: true }); return d; };
  const sha256 = (file) => new Promise((res, rej) => { const h = crypto.createHash("sha256"), s = fs.createReadStream(file); s.on("data", (c) => h.update(c)); s.on("end", () => res(h.digest("hex"))); s.on("error", rej); });

  async function download(onProgress = () => {}) {
    const info = updateInfo;
    if (!info || !info.asset) return { ok: false, error: "받을 파일이 없어요. 릴리스 페이지에서 직접 받아 주세요." };
    if (state.phase === "downloading") return { ok: false, error: "이미 받는 중이에요." };
    const file = path.join(dir(), info.name || `SadoDesk-Setup-${info.tag}.exe`);
    state = { phase: "downloading", got: 0, total: info.size || 0, file, error: null };
    try {
      // 이미 받아 둔 것이 맞으면 다시 받지 않는다
      if (fs.existsSync(file) && info.sha256 && (await sha256(file)) === info.sha256) { state = { ...state, phase: "ready", got: info.size, total: info.size }; return { ok: true, file, cached: true }; }
      const r = await fetch(info.asset, { headers: { "User-Agent": `sado-desk/${app.getVersion()}` }, redirect: "follow" });
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
      state.total = +(r.headers.get("content-length") || info.size || 0);
      const tmp = file + ".part"; const out = fs.createWriteStream(tmp);
      for await (const chunk of r.body) { out.write(chunk); state.got += chunk.length; onProgress(state.got, state.total); }
      await new Promise((res, rej) => out.end((e) => e ? rej(e) : res()));
      if (info.sha256) {   // 깃허브가 알려 준 sha256 과 대조 — 다르면 버린다
        const got = await sha256(tmp);
        if (got !== info.sha256) { fs.unlinkSync(tmp); throw new Error("받은 파일이 손상됐어요 (검증 실패). 다시 시도해 주세요."); }
      }
      fs.rmSync(file, { force: true }); fs.renameSync(tmp, file);
      for (const f of fs.readdirSync(dir())) if (f !== path.basename(file)) { try { fs.rmSync(path.join(dir(), f), { force: true }); } catch {} }   // 지난 판 정리
      state = { ...state, phase: "ready", file };
      console.log(`update: 내려받기 완료 ${file} (${(state.got / 1048576).toFixed(0)}MB, 검증 ${info.sha256 ? "ok" : "생략"})`);
      return { ok: true, file };
    } catch (e) {
      state = { ...state, phase: "error", error: e.message };
      console.log("update 내려받기 실패:", e.message);
      return { ok: false, error: e.message };
    }
  }

  // 설치 파일을 조용히 돌리고 끝나면 새 판을 띄운다. 우리는 그 사이에 꺼진다(파일이 교체되어야 하므로)
  function install() {
    if (state.phase !== "ready" || !state.file || !fs.existsSync(state.file)) return { ok: false, error: "받아 둔 설치 파일이 없어요." };
    if (!app.isPackaged) { console.log("update: 개발 실행에서는 설치하지 않는다 —", state.file); return { ok: false, error: "개발 실행에서는 설치하지 않습니다." }; }
    state = { ...state, phase: "installing" };
    const exe = app.getPath("exe");
    // cmd 를 떼어 놓고 돌린다: 설치가 끝난 뒤 새 판을 켜는 일까지 맡아야 해서 (우리는 먼저 꺼진다)
    const p = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `""${state.file}" /S & start "" "${exe}""`], { detached: true, stdio: "ignore", windowsVerbatimArguments: true });
    p.unref();
    console.log("update: 설치 시작 —", state.file);
    setTimeout(() => app.quit(), 400);
    return { ok: true };
  }

  // --update-dl-test — 받기·검증까지 실제로 해 본다 (--update-force 와 함께). 설치는 포장판에서만
  if (argHas("--update-dl-test")) setTimeout(async () => {
    let fails = 0;
    const ok = (c, m) => { console.log(`UPDLTEST ${c ? "PASS" : "FAIL"} ${m}`); if (!c) fails++; };
    await checkUpdate();
    if (!updateInfo) { console.log("UPDLTEST FAIL 릴리스 정보를 못 읽었다"); app.exit(1); return; }
    ok(!!updateInfo.sha256, `깃허브가 sha256 을 준다 (${(updateInfo.sha256 || "").slice(0, 16)}…)`);
    let last = 0; const t0 = Date.now();
    const r = await download((got, total) => { const p = Math.round(got / total * 100); if (p >= last + 25) { last = p; console.log(`UPDLTEST · ${p}%`); } });
    ok(r.ok, `내려받기 ${r.ok ? `성공 ${(Date.now() - t0) / 1000 | 0}초${r.cached ? " (이미 받아 둔 것)" : ""}` : "실패: " + r.error}`);
    if (r.ok) {
      const fs2 = require("node:fs"); const size = fs2.statSync(r.file).size;
      ok(size === updateInfo.size, `크기 ${size} = 릴리스 ${updateInfo.size}`);
      ok(state.phase === "ready", `상태 ${state.phase} (ready)`);
      // 파일을 한 글자 망가뜨리면 검증에 걸려야 한다
      const bad = r.file + ".bad"; fs2.copyFileSync(r.file, bad); const fd = fs2.openSync(bad, "r+"); const one = Buffer.alloc(1); fs2.readSync(fd, one, 0, 1, 1000); fs2.writeSync(fd, Buffer.from([one[0] ^ 0xff]), 0, 1, 1000); fs2.closeSync(fd);   // 한 바이트를 뒤집는다
      const h = require("node:crypto").createHash("sha256").update(fs2.readFileSync(bad)).digest("hex");
      ok(h !== updateInfo.sha256, "망가진 파일은 검사값이 달라진다(검증이 잡는다)"); fs2.rmSync(bad, { force: true });
    }
    console.log(`UPDLTEST ${fails ? "FAILED " + fails : "ALL PASS"}`);
    if (argHas("--update-install")) { console.log("UPDLTEST 설치 시도"); const i = install(); console.log("UPDLTEST install →", JSON.stringify(i)); return; }
    app.exit(fails ? 1 : 0);
  }, 3000);

  if (argHas("--update-test")) setTimeout(async () => { await checkUpdate(); console.log("UPDATETEST", app.getVersion(), JSON.stringify(updateInfo), "newer(v9.9.9,cur)=", newerThan("v9.9.9", app.getVersion()), "newer(v0.1.0,cur)=", newerThan("v0.1.0", app.getVersion())); app.quit(); }, 2000);
  return { checkUpdate, download, install, get info() { return updateInfo; }, get state() { return state; }, newerThan, semver };
};
