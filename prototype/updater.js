/* 업데이트 — 깃허브 최신 릴리스가 이 버전보다 높으면 알리고, **앱 안에서 받아 설치**한다.
 * 받은 파일은 깃허브가 주는 sha256(assets[].digest)과 대조한다. 다르면 지우고 멈춘다.
 * 브라우저로 받지 않으므로 '웹에서 받은 파일' 표시(MOTW)가 붙지 않아 SmartScreen 경고도 뜨지 않는다.
 * main.js 에서 떼어 낸 것. 트레이 갱신은 ctx.refreshTray 로.
 *   const UP = require("./updater.js")(ctx); → { checkUpdate, get info(), get state(), download, install, newerThan, semver }
 */
const { app, shell } = require("electron");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { pipeline } = require("node:stream/promises"), { Readable, Transform } = require("node:stream");
const argHas = (f) => process.argv.includes(f);
const argVal = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };

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
      if (Notification.isSupported()) {
        const n = new Notification({ title: `사도 데스크 ${tag} 업데이트가 나왔어요`, body: `지금 ${app.getVersion()} → ${tag.replace(/^v/, "")}. 클릭하면 앱 안에서 받아 설치해요. (트레이 메뉴·설정에서도 됩니다)`, silent: true });
        n.on("click", () => { if (ctx.startUpdate) ctx.startUpdate(); else shell.openExternal(updateInfo.url); });   // 브라우저로 받으면 '웹에서 받음' 표시가 붙어 경고가 뜬다
        n.show();
      }
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
    if (!app || typeof app.getPath !== "function") return;   // 일렉트론 밖(단위 테스트)에서는 할 일이 없다
    try {
      const d = path.join(app.getPath("userData"), "update"); if (!fs.existsSync(d)) return;
      for (const f of fs.readdirSync(d)) {
        if (busyWith(f)) continue;   // 지금 받고 있거나 받아 둔 파일은 건드리지 않는다
        const v = (f.match(/(\d+\.\d+\.\d+)/) || [])[1];
        if (!v || !newerThan(v, app.getVersion())) { fs.rmSync(path.join(d, f), { force: true }); console.log("update: 지난 설치 파일 지움", f); }
      }
    } catch (e) { console.warn("update sweep", e.message); }
  }
  const sweepTimer = setTimeout(sweepOld, 5000); if (sweepTimer.unref) sweepTimer.unref();   // 이 타이머가 프로세스를 붙잡지 않게

  // ---- 받아서 설치 ----
  let state = { phase: "idle", got: 0, total: 0, file: null, error: null };   // idle · downloading · ready · installing · error
  const dir = () => { const d = path.join(app.getPath("userData"), "update"); fs.mkdirSync(d, { recursive: true }); return d; };
  const sha256 = (file) => new Promise((res, rej) => { const h = crypto.createHash("sha256"), s = fs.createReadStream(file); s.on("data", (c) => h.update(c)); s.on("end", () => res(h.digest("hex"))); s.on("error", rej); });

  // 받는 동안 쓰는 것들 — 멈춤(연결은 살아 있는데 데이터가 안 오는 것)과 사람이 누른 취소
  const STALL_MS = +argVal("--update-stall-ms", 60_000) || 60_000;   // 시험에서만 줄인다
  let dlAbort = null, stalled = false, cancelled = false;
  function cancel() {   // 트레이·설정의 '받기 취소'
    if (state.phase !== "downloading" || !dlAbort) return { ok: false, error: "받는 중이 아니에요." };
    cancelled = true; dlAbort.abort();
    return { ok: true };
  }
  async function download(onProgress = () => {}) {
    const info = updateInfo;
    if (!info || !info.asset) return { ok: false, error: "받을 파일이 없어요. 릴리스 페이지에서 직접 받아 주세요." };
    if (state.phase === "downloading") return { ok: false, error: "이미 받는 중이에요." };
    stalled = false; cancelled = false;
    state = { phase: "downloading", got: 0, total: info.size || 0, file: null, error: null };
    let tmp = null, file = null;
    try {
      // 폴더 만들기(dir)도 여기 안에서 — 권한이 없거나 디스크가 막히면 이것부터 실패한다
      file = path.join(dir(), info.name || `SadoDesk-Setup-${info.tag}.exe`); state.file = file;
      // 검사값을 모르면 설치하지 않는다 — '검증한 것만 설치한다'가 이 경로의 전부라서, 검증을 건너뛸 바엔 사람이 직접 받는 게 낫다
      if (!info.sha256) throw new Error("깃허브가 이 파일의 검사값(SHA-256)을 알려 주지 않았어요. 안전을 확인할 수 없어 설치하지 않습니다.");
      // 이미 받아 둔 것이 맞으면 다시 받지 않는다
      if (fs.existsSync(file) && (await sha256(file)) === info.sha256) { state = { ...state, phase: "ready", got: info.size, total: info.size }; return { ok: true, file, cached: true }; }
      // 멈춤 시계: 조각이 올 때마다 다시 감는다. 60초 동안 한 조각도 안 오면 끊는다 (연결이 살아 있는 채 멎으면
      // '받는 중' 이 영영 남고 다시 시도도 막혔다). 사람이 누른 취소도 같은 신호를 쓴다
      const ac = dlAbort = new AbortController();
      let stallT = null;
      const bump = () => { if (stallT) clearTimeout(stallT); stallT = setTimeout(() => { stalled = true; ac.abort(); }, STALL_MS); };
      bump();
      let r;
      try { r = await fetch(info.asset, { headers: { "User-Agent": `sado-desk/${app.getVersion()}` }, redirect: "follow", signal: ac.signal }); }
      finally { if (!r) { if (stallT) clearTimeout(stallT); } }
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
      state.total = +(r.headers.get("content-length") || info.size || 0);
      tmp = file + ".part";
      // pipeline 으로 잇는다: 디스크가 차거나 쓰기가 막히면 여기서 거부로 돌아온다(예전엔 write 오류를 아무도 듣지 않아 그대로 터졌다).
      // 역압도 pipeline 이 맡는다 — 120MB 를 메모리에 쌓지 않는다
      const count = new Transform({ transform(c, _e, cb) { state.got += c.length; bump(); onProgress(state.got, state.total); cb(null, c); } });
      try { await pipeline(Readable.fromWeb(r.body), count, fs.createWriteStream(tmp), { signal: ac.signal }); }
      finally { if (stallT) clearTimeout(stallT); dlAbort = null; }
      const got = await sha256(tmp);   // 깃허브가 알려 준 sha256 과 대조 — 다르면 버린다
      if (got !== info.sha256) { fs.rmSync(tmp, { force: true }); throw new Error("받은 파일이 손상됐어요 (검사값이 다릅니다). 다시 시도해 주세요."); }
      fs.rmSync(file, { force: true }); fs.renameSync(tmp, file);
      for (const f of fs.readdirSync(dir())) if (f !== path.basename(file)) { try { fs.rmSync(path.join(dir(), f), { force: true }); } catch {} }   // 지난 판 정리
      state = { ...state, phase: "ready", file };
      console.log(`update: 내려받기 완료 ${file} (${(state.got / 1048576).toFixed(0)}MB, 검증 ok)`);
      return { ok: true, file };
    } catch (e) {
      if (tmp) { try { fs.rmSync(tmp, { force: true }); } catch {} }   // 실패한 조각은 남기지 않는다
      dlAbort = null;
      const msg = cancelled ? "받기를 멈췄어요."
        : stalled ? `받는 속도가 너무 느려 중단했어요 (${STALL_MS / 1000}초 동안 아무것도 오지 않았습니다). 다시 시도해 주세요.`
        : e.message;
      state = { ...state, phase: cancelled ? "idle" : "error", error: cancelled ? null : msg };   // 취소는 오류가 아니다 — 다시 누를 수 있게 처음 상태로
      console.log("update 내려받기 실패:", cancelled ? "사용자 취소" : stalled ? "멈춤(60초)" : e.message);
      return { ok: false, error: msg, cancelled, stalled };
    }
  }

  // 설치 파일을 조용히 돌리고 끝나면 새 판을 띄운다. 우리는 그 사이에 꺼진다(파일이 교체되어야 하므로)
  // 시작조차 못 했을 때 — 우리는 꺼지지 않는다. 받아 둔 파일은 그대로 두어 다시 해 볼 수 있게 한다
  function failInstall(msg) {
    state = { ...state, phase: "ready", error: msg };
    console.log("update: 설치를 시작하지 못했다 —", msg);
    try { if (ctx.onInstallError) ctx.onInstallError(msg); } catch {}
    return { ok: false, error: `설치 프로그램을 시작하지 못했어요 (${msg}).` };
  }
  function install() {
    if (state.phase !== "ready" || !state.file || !fs.existsSync(state.file)) return { ok: false, error: "받아 둔 설치 파일이 없어요." };
    if (!app.isPackaged && !argHas("--update-spawn-test")) { console.log("update: 개발 실행에서는 설치하지 않는다 —", state.file); return { ok: false, error: "개발 실행에서는 설치하지 않습니다." }; }
    const shell = process.env.ComSpec || "cmd.exe";
    if (!fs.existsSync(shell)) return failInstall(`명령 프롬프트를 찾지 못했어요: ${shell}`);
    state = { ...state, phase: "installing" };
    const exe = app.getPath("exe");
    // cmd 를 떼어 놓고 돌린다: 설치가 끝난 뒤 새 판을 켜는 일까지 맡아야 해서 (우리는 먼저 꺼진다).
    // && 로 이어 설치가 성공했을 때만 그냥 켜고, 실패하면 --update-failed 로 켜서 사람에게 알린다 (예전엔 & 라 실패해도 조용히 켜졌다)
    let quitT = null;
    try {
      const p = spawn(shell, ["/d", "/s", "/c", `""${state.file}" /S && start "" "${exe}" || start "" "${exe}" --update-failed"`], { detached: true, stdio: "ignore", windowsVerbatimArguments: true });
      // spawn 이 실패하면(ComSpec 이 없거나 실행 권한이 없으면) error 가 뒤늦게 온다 — 꺼지기 전에 잡아 되돌린다
      p.on("error", (e) => { if (quitT) { clearTimeout(quitT); quitT = null; } failInstall(e.message); });
      p.unref();
      console.log("update: 설치 시작 —", state.file);
      quitT = setTimeout(() => app.quit(), 1200);   // error 가 올 틈을 주고 끈다
      return { ok: true };
    } catch (e) { if (quitT) clearTimeout(quitT); return failInstall(e.message); }
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
      const keep = updateInfo.sha256;
      updateInfo.sha256 = null;   // 깃허브가 검사값을 안 주는 경우
      let x = await download(); ok(!x.ok && /검사값/.test(x.error || ""), `검사값이 없으면 받지 않는다 (${(x.error || "").slice(0, 40)})`);
      updateInfo.sha256 = "0".repeat(64);   // 캐시를 건너뛰게 한 뒤, .part 자리에 폴더를 둬서 쓰기를 막는다
      const partDir = r.file + ".part"; fs2.mkdirSync(partDir, { recursive: true });
      x = await download(); ok(!x.ok && state.phase === "error", `쓰기가 막히면 터지지 않고 오류로 돌아온다 (${(x.error || "").slice(0, 40)})`);
      fs2.rmSync(partDir, { recursive: true, force: true }); updateInfo.sha256 = keep;
      x = await download(); ok(x.ok && x.cached && state.phase === "ready", "다시 받아 둔 상태로 돌아온다(캐시)");
      const realMk = fs2.mkdirSync;   // 받을 폴더를 못 만드는 경우 (권한·디스크)
      fs2.mkdirSync = () => { throw new Error("EPERM 시험"); };
      try { x = await download(); } catch (e) { x = { ok: false, threw: e.message }; }
      fs2.mkdirSync = realMk;
      ok(!x.ok && !x.threw && state.phase === "error", `폴더를 못 만들면 터지지 않고 오류로 돌아온다 (${(x.error || x.threw || "").slice(0, 30)})`);
      x = await download(); ok(x.ok, "그 뒤에도 정상으로 돌아온다");
      {   // 멈춤: 머리만 보내고 조용해지는 서버를 세워 본다 (진짜 느린 회선 대신)
        const http = require("node:http");
        const srv = http.createServer((_q, res) => { res.writeHead(200, { "content-length": "999999999" }); res.write(Buffer.alloc(1024)); });   // 이후 아무것도 안 보낸다
        await new Promise((res2) => srv.listen(18099, "127.0.0.1", res2));
        const keepAsset = updateInfo.asset, keepSha = updateInfo.sha256;
        updateInfo.asset = "http://127.0.0.1:18099/x.exe"; updateInfo.sha256 = "1".repeat(64);
        const t1 = Date.now(); const st1 = await download();
        ok(!st1.ok && st1.stalled && state.phase === "error" && Date.now() - t1 < 20000, `멈춘 연결을 ${((Date.now() - t1) / 1000).toFixed(1)}초에 끊는다 (${(st1.error || "").slice(0, 30)})`);
        // 취소: 같은 서버에 붙였다가 사람이 멈추는 경우
        const p2 = download(); await new Promise((r2) => setTimeout(r2, 800));
        const c = cancel(); const st2 = await p2;
        ok(c.ok && !st2.ok && st2.cancelled && state.phase === "idle", `받는 중 취소하면 처음 상태로 (${state.phase})`);
        ok(!cancel().ok, "받는 중이 아니면 취소할 것도 없다");
        srv.close(); updateInfo.asset = keepAsset; updateInfo.sha256 = keepSha;
        const back = await download(); ok(back.ok, "취소한 뒤에도 다시 받을 수 있다");
      }
      if (argHas("--update-spawn-test")) {   // 설치 프로세스를 시작조차 못 하는 경우
        const keep = process.env.ComSpec, prevCb = ctx.onInstallError; let told = null;
        process.env.ComSpec = "C:/__없는폴더__/nope.exe"; ctx.onInstallError = (m) => { told = m; };
        const r2 = install();   // ① 아예 없는 경로 — 띄우기 전에 걸러진다
        await new Promise((res) => setTimeout(res, 1500));   // app.quit 이 예약됐다면 이 사이에 꺼졌을 것이다
        ok(!r2.ok && !!told && state.phase === "ready", `① 설치를 시작 못 하면 끄지 않고 알린다 (${(r2.error || "").slice(0, 40)})`);
        told = null; process.env.ComSpec = "C:/Windows";   // ② 있긴 한데 실행할 수 없는 것 — spawn 의 error 이벤트로 온다
        const r3 = install();
        await new Promise((res) => setTimeout(res, 1500));
        ok(!!told && state.phase === "ready", `② 띄우다 실패해도 끄지 않고 알린다 (${(told || "").slice(0, 40)}, install→${r3.ok ? "ok" : "fail"})`);
        process.env.ComSpec = keep; ctx.onInstallError = prevCb;
      }
    }
    console.log(`UPDLTEST ${fails ? "FAILED " + fails : "ALL PASS"}`);
    if (argHas("--update-install")) { console.log("UPDLTEST 설치 시도"); const i = install(); console.log("UPDLTEST install →", JSON.stringify(i)); return; }
    app.exit(fails ? 1 : 0);
  }, 3000);

  if (argHas("--update-test")) setTimeout(async () => { await checkUpdate(); console.log("UPDATETEST", app.getVersion(), JSON.stringify(updateInfo), "newer(v9.9.9,cur)=", newerThan("v9.9.9", app.getVersion()), "newer(v0.1.0,cur)=", newerThan("v0.1.0", app.getVersion())); app.quit(); }, 2000);
  return { checkUpdate, download, install, cancel, get info() { return updateInfo; }, get state() { return state; }, newerThan, semver };
};
