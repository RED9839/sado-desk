/* 에셋 가져오기(추출) 창 — main.js 에서 떼어 낸 것. 창·IPC·파이썬 추출기 실행이 여기 있다.
 * 바깥 상태(에셋 루트·설정·트레이)는 ctx 로만 본다: main.js 가 getter 를 넘겨 주므로 값이 바뀌어도 따라간다.
 *   const setup = require("./setup-window.js")(ctx);  → { openSetup, stopExtract }
 */
const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const fs = require("fs"), path = require("path");
const { spawn } = require("node:child_process");

module.exports = function createSetupWindow(ctx) {
  let setupWin = null, extractProc = null;
  function toolsDir() { return app.isPackaged ? path.join(process.resourcesPath, "tools") : path.join(__dirname, "tools"); }
  function pythonExe() {
    // 시험용 갈아 끼우기(개발 실행에서만): "실행파일|인자" — test/flow.js 가 가짜 추출기(node 스크립트)를 끼워 실패·취소·재시도를 돌린다
    if (!app.isPackaged && process.env.SADO_EXTRACTOR) { const [exe, ...args] = process.env.SADO_EXTRACTOR.split("|"); return { exe, args }; }
    const bundled = path.join(process.resourcesPath || "", "pyruntime", "python.exe");
    if (app.isPackaged && fs.existsSync(bundled)) return { exe: bundled, args: [] };
    const dev = path.join(__dirname, "pyruntime", "python.exe");
    if (fs.existsSync(dev)) return { exe: dev, args: [] };
    return { exe: "python", args: [] }; // 개발: PATH의 python (UnityPy 설치되어 있어야 함)
  }
  function openSetup() {
    if (setupWin && !setupWin.isDestroyed()) { setupWin.show(); setupWin.focus(); return; }
    setupWin = new BrowserWindow({
      width: 720, height: 640, minWidth: 600, minHeight: 480, title: "사도 데스크 — 게임 데이터 가져오기", show: false,
      backgroundColor: "#1f1f24", autoHideMenuBar: true, icon: path.join(__dirname, "renderer", "tray.png"),
      webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: false },
    });
    setupWin.loadFile(path.join(__dirname, "renderer", "setup.html"));
    setupWin.webContents.on("console-message", (ev) => console.log(`[setup:${ev.level}] ${ev.message}`));
    // 첫 실행(에셋 없음)엔 이 창이 사용자가 보는 첫 화면이라 다른 창 뒤로 숨지 않게 앞으로 끌어온다. ready-to-show가 안 오는 경우 대비 1.5초 뒤 강제 표시
    const reveal = () => { if (!setupWin || setupWin.isDestroyed() || setupWin.isVisible()) return; setupWin.center(); setupWin.show(); setupWin.focus(); setupWin.setAlwaysOnTop(true); setTimeout(() => { if (setupWin && !setupWin.isDestroyed()) setupWin.setAlwaysOnTop(false); }, 1500); try { app.focus({ steal: true }); } catch {} };
    setupWin.once("ready-to-show", reveal); setTimeout(reveal, 1500);
    const w = setupWin; ctx.trackBounds(w);
    w.on("closed", () => { if (setupWin === w) setupWin = null; });
  }
  const setupSend = (ch, data) => { if (setupWin && !setupWin.isDestroyed()) setupWin.webContents.send(ch, data); };
  // preload 가 파일 읽기를 허용할 폴더(앱 폴더·에셋 폴더·userData). 동기여야 preload 초기화 때 쓸 수 있다
  ipcMain.on("roots:get", (e) => { e.returnValue = [__dirname, ctx.assetRoot, path.join(app.getPath("userData"), "assets"), ctx.dataRoot].filter(Boolean); });
  ipcMain.handle("assets:status", () => ({ root: ctx.assetRoot, hasAssets: ctx.hasAssets(ctx.assetRoot), userDataRoot: ctx.toSlash(path.join(app.getPath("userData"), "assets")), running: !!extractProc, python: pythonExe().exe, standing: Object.keys(ctx.standing.game).length, ingame: Object.keys(ctx.standing.ingame).length, voice: fs.existsSync(path.join(ctx.assetRoot, "voice", "index.json")), packaged: app.isPackaged }));
  ipcMain.handle("assets:pick-folder", async () => { const r = await dialog.showOpenDialog(setupWin || undefined, { properties: ["openDirectory"], title: "게임 데이터 폴더 선택 (minimi/ 폴더가 들어 있는 곳)" }); return r.canceled ? null : r.filePaths[0]; });
  ipcMain.handle("assets:pick-mumu", async () => { const r = await dialog.showOpenDialog(setupWin || undefined, { properties: ["openDirectory"], title: "뮤뮤 앱플레이어 설치 폴더 (MuMuManager.exe·adb.exe가 있는 nx_main)" }); return r.canceled ? null : r.filePaths[0]; });
  ipcMain.handle("assets:use-folder", (_e, folder) => {
    if (!ctx.hasAssets(folder)) return { ok: false, error: "이 폴더에 minimi/minimi.skel이 없습니다. 게임 데이터를 가져온 폴더(assets)를 선택해 주세요." };
    ctx.updateSettings({ assets: { root: ctx.toSlash(folder) } }); ctx.rescanAssets(); ctx.startMascot(); ctx.refreshTray(); return { ok: true, root: ctx.assetRoot };
  });
  ipcMain.handle("assets:scan", () => new Promise((resolve) => {
    const py = pythonExe(); const args = [...py.args, path.join(toolsDir(), "extract-all.py"), "--list-devices", "--json"];
    let out = "", err = "";
    try {
      const p = spawn(py.exe, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" } });
      p.stdout.on("data", (d) => out += d.toString("utf8")); p.stderr.on("data", (d) => err += d.toString("utf8"));
      p.on("error", (e) => resolve({ ok: false, error: "python 실행 실패: " + e.message, devices: [] }));
      // 방화벽이 포트를 버리면 adb connect 가 후보마다 6초씩 물린다. 그동안 창은 "찾는 중…"에
      // 멈춘 채 다시 찾기 단추까지 잠긴다. 이게 가져오기 창을 열자마자 저절로 도는 첫 화면이다
      const timer = setTimeout(() => {
        killTree(p.pid, () => { try { p.kill(); } catch {} });
        resolve({ ok: false, error: "기기 찾기가 60초를 넘겼어요. 앱플레이어를 켠 뒤 다시 찾아 주세요.", devices: [] });
      }, 60000);
      p.on("exit", () => { clearTimeout(timer); try { resolve({ ok: true, devices: JSON.parse(out.trim().split("\n").pop() || "[]") }); } catch { resolve({ ok: false, error: (err || out).slice(0, 300), devices: [] }); } });
    } catch (e) { resolve({ ok: false, error: e.message, devices: [] }); }
  }));
  ipcMain.handle("assets:extract", (_e, opt) => startExtract(opt));
  function startExtract(opt) {
    if (extractProc) return { ok: false, error: "이미 추출 중이에요." };
    const out = path.join(app.getPath("userData"), "assets");
    try { fs.mkdirSync(out, { recursive: true }); }
    catch (e) { return { ok: false, error: `게임 데이터 폴더를 만들 수 없습니다 (${out}): ${e.message}` }; }
    const py = pythonExe(); const script = path.join(toolsDir(), "extract-all.py");
    const args = [...py.args, script, "--out", out, "--json", "--steps", (opt.steps || ["minimi", "sfx", "standing", "ingame", "voice"]).join(",")];
    if (opt.mumu) args.push("--mumu", opt.mumu);
    if (opt.force) args.push("--force");
    args.push("--cache", path.join(app.getPath("userData"), "tools-cache")); // platform-tools adb 등 (구버전 adb만 있는 PC용)
    if (opt.adb) args.push("--adb", opt.adb);
    if (opt.serial) args.push("--serial", opt.serial);
    console.log("extract:", py.exe, args.join(" "));
    try { extractProc = spawn(py.exe, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" } }); }
    catch (e) { return { ok: false, error: "python 실행 실패: " + e.message }; }
    let buf = "";
    const logFile = path.join(app.getPath("userData"), "extract.log"); // 진단용: 마지막 추출의 전체 로그
    try { fs.writeFileSync(logFile, `[${new Date().toISOString()}] ${py.exe} ${args.join(" ")}\n`); } catch {}
    const flog = (t) => { try { fs.appendFileSync(logFile, t + "\n"); } catch {} };
    extractProc.stdout.on("data", (d) => { buf += d.toString("utf8"); let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue; flog(line); let o; try { o = JSON.parse(line); } catch { o = { step: "log", msg: line, level: "info" }; } if (o.level === "error" || o.level === "warn") console.log("extract:", o.step, o.msg); setupSend("extract:progress", o); } });
    extractProc.stderr.on("data", (d) => { const t = d.toString("utf8").trim(); if (t) { flog("[stderr] " + t); console.log("extract stderr:", t.slice(0, 300)); setupSend("extract:progress", { step: "stderr", msg: t.slice(0, 400), level: "warn" }); } });
    extractProc.on("error", (e) => { setupSend("extract:progress", { step: "error", msg: `python을 실행할 수 없어요 (${e.message}). Python 3.10+ 와 'pip install UnityPy Pillow' 가 필요해요.`, level: "error" }); extractProc = null; setupSend("extract:done", { ok: false }); });
    extractProc.on("exit", (code) => {
      extractProc = null; flog(`[exit ${code}]`);
      // 보이스에서 걸려도 미니미는 이미 받아 놓은 경우가 흔하다. 예전에는 code 0 일 때만 다시 훑어서
      // 에셋이 멀쩡히 있는데도 "에셋 없음"이 남고 사도가 안 떴다. 종료 코드와 무관하게 훑고 나서 판정한다
      if (code === 0) ctx.updateSettings({ assets: { root: "" } });
      ctx.rescanAssets();
      const got = ctx.hasAssets(ctx.assetRoot);
      if (got) { ctx.startMascot(); ctx.refreshTray(); }
      const cancelled = extractCancelled; extractCancelled = false;
      setupSend("extract:done", { ok: code === 0, cancelled, partial: code !== 0 && got, code, root: ctx.assetRoot, hasAssets: got });
      if (ctx.argHas("--setup-test")) console.log("SETUPTEST exit", code, "hasAssets", ctx.hasAssets(ctx.assetRoot), "root", ctx.assetRoot, "ctx.mascotStarted", ctx.mascotStarted);
    });
    return { ok: true };
  }
  if (ctx.argHas("--setup-test")) setTimeout(async () => { if (setupWin && !app.isPackaged) { try { const img = await setupWin.webContents.capturePage(); fs.writeFileSync(path.join(__dirname, "out", "setup.png"), img.toPNG()); } catch {} } const steps = (ctx.argVal("--setup-steps", "minimi,sfx") || "minimi,sfx").split(","); console.log("SETUPTEST start extract", steps.join(",")); startExtract({ steps }); }, 4000);
  ipcMain.handle("assets:enable-ld-adb", (_e, idx) => new Promise((resolve) => { // LD플레이어 인스턴스의 ADB 디버깅 켜고 재시작 (extract-all.py --enable-ld-adb N)
    const py = pythonExe(); const args = [...py.args, path.join(toolsDir(), "extract-all.py"), "--enable-ld-adb", String(idx), "--json"];
    let out = "";
    try {
      const p = spawn(py.exe, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" } });
      p.stdout.on("data", (d) => { out += d.toString("utf8"); for (const line of d.toString("utf8").split("\n")) { if (!line.trim()) continue; let o; try { o = JSON.parse(line); } catch { o = { step: "ld", msg: line, level: "info" }; } setupSend("extract:progress", o); } });
      p.on("error", (e) => resolve({ ok: false, error: e.message }));
      p.on("exit", (code) => resolve({ ok: code === 0, out }));
    } catch (e) { resolve({ ok: false, error: e.message }); }
  }));
  // 무리째 죽인다. spawn 의 try/catch 는 동기 예외만 잡고, taskkill 을 못 찾는 경우는 비동기 'error' 로 와서
  // 받는 이가 없으면 메인이 죽는다. 그때는 부모 하나만이라도 죽이는 폴백으로
  function killTree(pid, fallback) {
    try { const k = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }); k.on("error", fallback); }
    catch { fallback(); }
  }
  let extractCancelled = false;
  // kill() 은 python 하나만 죽인다. 그 밑에서 돌던 adb 와 변환 일꾼들은 살아남아 임시 폴더에 계속
  // 쓰고, extract-all.py 의 finally(임시 폴더 지우기)도 돌지 않는다. 보이스 원본만 1.6GB다
  ipcMain.on("assets:cancel", () => {
    if (!extractProc) return;
    extractCancelled = true;
    const pid = extractProc.pid;
    killTree(pid, () => { try { if (extractProc) extractProc.kill(); } catch {} });
  });
  ipcMain.on("assets:open-setup", () => openSetup());
  ipcMain.on("assets:open-root", () => { try { fs.mkdirSync(ctx.assetRoot, { recursive: true }); } catch (e) { console.warn("assets root mkdir", e.message); } shell.openPath(ctx.assetRoot); }); // 설정에 적힌 폴더가 없는 드라이브(빠진 USB)면 mkdir 이 던진다
  ipcMain.on("assets:open-log", () => { const f = path.join(app.getPath("userData"), "extract.log"); if (fs.existsSync(f)) shell.openPath(f); });
  // 앱을 끌 때 돌던 추출기를 정리한다 (before-quit)
  function stopExtract() { if (extractProc) killTree(extractProc.pid, () => { try { extractProc.kill(); } catch {} }); }
  return { openSetup, stopExtract, startExtract, get extractPid() { return extractProc ? extractProc.pid : 0; }, get setupWin() { return setupWin; } };
};
