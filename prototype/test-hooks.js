/* 개발·검사용 훅 — `--selftalk-test` 같은 실행 인자로 켜는 자동 점검. 제품 동작은 여기 없다.
 * main.js 의 상태는 ctx 의 getter 로 본다(값이 바뀌어도 따라간다). captureScreenFor 는 화면 시험이 감싸 쓰므로 setter 도 있다.
 *   require("./test-hooks.js")(ctx);
 */
const { app, BrowserWindow, ipcMain, screen } = require("electron");
const fs = require("fs"), path = require("path");
const Ai = require("./ai.js");
const Talk = require("./renderer/talk.js");
const { argHas, argVal } = require("./args.js");

module.exports = function installTestHooks(ctx) {
  // --perf-test — 숨어 있을 때 정말로 쉬는지 센다: 렌더러의 rAF 예약 횟수와 메인의 커서 확인 타이머.
  // 에셋이 필요하다(로컬). 프레임을 세려면 진짜로 그려야 해서 가짜 사도로는 못 한다
  if (argHas("--perf-test")) setTimeout(async () => {
    const fails = [], ok = (cond, msg) => { console.log(`PERFTEST ${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) fails.push(msg); };
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const js = (code) => ctx.mascotWin.webContents.executeJavaScript(code);
    // rAF 예약을 센다 (그린 프레임이 아니라 '깨어난 횟수')
    await js(`window.__raf = 0; if (!window.__rafWrapped) { const o = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => { window.__raf++; return o(cb); }; window.__rafWrapped = true; } true`);
    const count = async (ms) => { await js("window.__raf = 0; true"); await sleep(ms); return js("window.__raf"); };
    const before = await count(1000);
    ok(before > 20, `평소엔 초당 ${before}번 깨어난다(시험 전제)`);
    ctx.setFsHidden(true); await sleep(300);
    const hidden = await count(1000);
    ok(hidden <= 2, `숨으면 초당 ${hidden}번 — 예약이 멈춘다 (전에는 평소와 같았다)`);
    ok(!ctx.cursorPoll.on, `숨는 동안 커서 확인도 멈춘다 (on=${ctx.cursorPoll.on})`);
    ctx.setFsHidden(false); await sleep(500);
    const after = await count(1000);
    ok(after > 20, `돌아오면 다시 ${after}번 — 멈춘 뒤에도 깨어난다`);
    ok(ctx.cursorPoll.on, "커서 확인도 다시 돈다");
    // 간격이 상황에 맞는 값인지는 순수 계산이라 단위 시험(test/cursor-poll.test.js)에서 본다. 여기서는 돌고 있는 값만 적어 둔다
    console.log(`PERFTEST 지금 커서 간격 ${ctx.cursorPoll.ms}ms`);
    console.log(`PERFTEST ${fails.length ? "FAILED " + fails.length : "ALL PASS"}`);
    app.exit(fails.length ? 1 : 0);
  }, 7000);

  // --hit-test — 손짓이 닿는 길: 히트 창(renderer/hit.html + hit.js) → ipc "hit-ev" → 마스코트 창.
  // 이 창의 스크립트가 막히면(예전에 CSP 가 인라인을 막았다) 사도는 보이는데 아무 손짓도 먹지 않는다.
  // 그래서 ipc 를 직접 쏘지 않고 **실제 창에 입력을 넣어** 확인한다. 에셋 없이도 돈다(CI)
  if (argHas("--hit-test")) setTimeout(async () => {
    const fails = [], ok = (cond, msg) => { console.log(`HITTEST ${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) fails.push(msg); };
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const got = []; ipcMain.on("hit-ev", (_e, ev) => got.push(ev));
    const blocked = [];
    // 사도가 떠 있으면 그 히트 창을, 아니면(에셋이 없는 CI) 같은 페이지를 직접 띄운다 —
    // 이 시험의 핵심은 '그 페이지의 스크립트가 CSP 에 막히지 않고 입력을 메인까지 넘기는가' 이고, 그건 사도 없이도 볼 수 있다
    const own = argHas("--hit-standalone") || !(ctx.hitWin && !ctx.hitWin.isDestroyed());   // --hit-standalone: 에셋이 있는 PC 에서도 CI 와 같은 길을 시험해 보려고
    const w = own ? new BrowserWindow({
      x: 100, y: 100, width: 200, height: 200, show: false, transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true,
      resizable: false, movable: false, hasShadow: false, focusable: false, backgroundColor: "#00000000",
      webPreferences: { preload: path.join(__dirname, "renderer", "hit-preload.js"), contextIsolation: true, sandbox: true },
    }) : ctx.hitWin;
    if (own) { await w.loadFile(path.join(__dirname, "renderer", "hit.html")); console.log("HITTEST 사도가 없어 히트 창을 직접 띄웠다 (에셋 없는 환경)"); }
    ok(!!w && !w.isDestroyed(), "히트 창이 있다");
    if (!w || w.isDestroyed()) { console.log("HITTEST FAILED " + fails.length); return app.exit(1); }
    w.webContents.on("console-message", (ev) => { if (/Refused to (execute|load)/i.test(ev.message)) blocked.push(ev.message); });
    // 에셋이 있으면 진짜 사도 자리에, 없으면(CI) 아무 자리에나 창을 놓고 입력을 넣는다
    const id = (ctx.settings.characters[0] || {}).id, inst = id && ctx.instances.get(id);
    let b;
    if (!own && inst && inst.rect) {
      // 창이 선 자리만 본다 — 진짜 커서가 딴 데 있으면 16ms 폴링이 곧 숨긴다(그래도 입력은 창에 넣을 수 있다).
      // 사도는 걷는 중이라 한 번 재면 그 사이에 움직여 있다. 여러 번 재서 가장 잘 맞은 것을 본다(가만히 서는 순간이 온다)
      let best = 0;
      for (let i = 0; i < 8; i++) {
        const r = ctx.screenRect(ctx.instances.get(id).rect);
        ctx.updateHitTarget(r.x + r.width / 2 - ctx.geo.x, r.y + r.height / 2 - ctx.geo.y);
        await sleep(150);
        b = w.getBounds();
        const now = ctx.screenRect(ctx.instances.get(id).rect);
        const ov = Math.max(0, Math.min(b.x + b.width, now.x + now.width) - Math.max(b.x, now.x)) * Math.max(0, Math.min(b.y + b.height, now.y + now.height) - Math.max(b.y, now.y));
        best = Math.max(best, ov / (now.width * now.height));
        if (best > 0.5) break;
      }
      ok(best > 0.5, `사도 자리에 히트 창이 선다 (겹침 ${Math.round(100 * best)}%)`);
    }
    else { b = { x: 100, y: 100, width: 200, height: 200 }; w.setBounds(b); w.showInactive(); await sleep(300); }
    const px = Math.round(b.width / 2), py = Math.round(b.height / 2);
    const put = (type, button, clickCount) => w.webContents.sendInputEvent({ type, x: px, y: py, globalX: b.x + px, globalY: b.y + py, button, clickCount, modifiers: [] });
    got.length = 0;
    put("mouseMove", "left", 0); await sleep(120);
    put("mouseDown", "left", 1); await sleep(120);
    put("mouseUp", "left", 1); await sleep(200);
    ok(got.some(e => e.type === "mousedown"), `마우스 누름이 전달됐다 (${got.map(e => e.type).join(",") || "아무것도 안 옴"})`);
    ok(got.some(e => e.type === "mouseup"), "마우스 뗌이 전달됐다");
    ok(got.some(e => e.type === "mousemove"), "마우스 이동이 전달됐다");
    const d = got.find(e => e.type === "mousedown");
    ok(!!d && Math.abs(d.sx - (b.x + px)) <= 2 && Math.abs(d.sy - (b.y + py)) <= 2, `좌표가 화면 좌표로 온다 (${d ? d.sx + "," + d.sy : "-"} ≈ ${b.x + px},${b.y + py})`);
    ok(blocked.length === 0, `CSP 에 막힌 스크립트 없음${blocked.length ? " — " + blocked[0].slice(0, 80) : ""}`);
    if (!own && inst && inst.rect) {   // 에셋이 있을 때만: 오른쪽 버튼이 메뉴까지 가는지 (창 → 메인 다음 구간: 메인 → 마스코트 렌더러)
      ipcMain.emit("hit-ev", null, { instance: id, type: "mousedown", sx: b.x + px, sy: b.y + py, button: 2, buttons: 0 });
      for (let i = 0; i < 80 && !(ctx.menuWin && !ctx.menuWin.isDestroyed()); i++) {   // 사도가 다른 동작 중이면 메뉴가 늦게 열린다 — 8초까지 기다리고 한 번 더 눌러 본다
        if (i === 40) ipcMain.emit("hit-ev", null, { instance: id, type: "mousedown", sx: b.x + px, sy: b.y + py, button: 2, buttons: 0 });
        await sleep(100);
      }
      ok(!!(ctx.menuWin && !ctx.menuWin.isDestroyed()), "오른쪽 버튼 → 메뉴가 열린다");
    }
    if (own && !w.isDestroyed()) w.destroy();
    console.log(`HITTEST ${fails.length ? "FAILED " + fails.length : "ALL PASS"}`);
    app.exit(fails.length ? 1 : 0);
  }, 6000);

  // --second-test — 이미 켜져 있는데 또 실행했을 때(second-instance). 사도가 안 보여서 다시 누른 사람에게
  // 설정 창을 열어 주던 것을 "사도가 있는 자리에서 손 흔들기 + 한마디"로 바꿨다. 세 갈래를 다 본다:
  // 에셋 없음 → 가져오기 창 / 전체화면 뒤 → 트레이 풍선만 / 보통 → 등장 동작 + 말풍선. CI(에셋 없음)는 첫 갈래만 실제로 탄다
  if (argHas("--second-test")) setTimeout(async () => {
    const fails = [], ok = (cond, msg) => { console.log(`SECONDTEST ${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) fails.push(msg); };
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    // 사도가 자리를 잡을 때까지 기다린다 — 고정 7초로는 PC 사정에 따라 "아직 없음" 갈래로 새어 시험이 흔들렸다
    const id = (ctx.settings.characters[0] || {}).id;
    for (let i = 0; i < 60 && !(ctx.instances.get(id) || {}).rect; i++) await sleep(200);
    const inst = id && ctx.instances.get(id);
    // 전체화면 앱(게임)이 앞에 있으면 사도는 숨어 있는 게 정상이라 "손 흔들기" 갈래가 아예 성립하지 않는다 — 그 상황은 건너뛴다
    const fsNow = ctx.fsHidden;
    const hasMascot = !!(inst && inst.rect) && !fsNow;
    if (fsNow) console.log("SECONDTEST 전체화면 앱이 앞에 있어 사도가 숨은 상태 — 손 흔들기 갈래는 건너뛴다");
    const r1 = ctx.onSecondInstance(); await sleep(1500);
    if (!hasMascot) {
      const setupWin = ctx.setup.setupWin;
      if (r1 === "setup") ok(!!(setupWin && !setupWin.isDestroyed()), "에셋 없음 → 가져오기 창이 열린다");
      else ok(r1 === "balloon", `사도가 아직 없음 → 트레이 풍선만 (${r1})`);
      console.log("SECONDTEST 에셋이 없어 '손 흔들기' 갈래는 이 환경에서 못 본다");
    } else {
      ok(r1 === "wave", `사도가 있으면 손 흔들기 (${r1})`);
      const bw = ctx.bubbleWin;
      ok(!!(bw && !bw.isDestroyed() && bw.isVisible()), "말풍선이 떠 있다");
      if (bw && !bw.isDestroyed()) { const t = await bw.webContents.executeJavaScript("document.body.innerText"); ok(/이미 켜져 있어요/.test(t), "말풍선에 '이미 켜져 있어요'"); }
      ok(!(ctx.settingsWin && !ctx.settingsWin.isDestroyed() && ctx.settingsWin.isVisible()), "설정 창은 열지 않는다");
      // 전체화면 뒤에 숨어 있을 때는 풍선만 — 말풍선이 게임 위로 올라오면 안 된다
      ctx.setFsHidden(true); const r2 = ctx.onSecondInstance(); ctx.setFsHidden(false);
      ok(r2 === "balloon", `전체화면 뒤 → 트레이 풍선만 (${r2})`);
    }
    console.log(`SECONDTEST ${fails.length ? "FAILED " + fails.length : "ALL PASS"}`);
    app.exit(fails.length ? 1 : 0);
  }, 7000);

  if (argHas("--persona-test")) setTimeout(async () => { // 여러 사도의 말투 확인: 스킨마다 같은 질문 → 답 로그
    const skins = (argVal("--persona-test", "") || "Mini_Crepe").split(","); const q = argVal("--persona-q", "") || "안녕! 오늘 뭐 하고 있었어?";
    for (const skin of skins) {
      const p = ctx.talkData ? Talk.profileFor(ctx.talkData, skin) : null; if (!p) { console.log("PERSONA", skin, "프로필 없음"); continue; }
      const hero = skin.replace(/^Mini_/, "").replace(/Skin\d+$/, "").toLowerCase(); if (ctx.talkStyle && ctx.talkStyle[hero]) p.styleInfo = ctx.talkStyle[hero]; if (ctx.vsamples[hero]) p.sampleLines = ctx.vsamples[hero];
      p.key = hero; p.koOf = ctx.koOfHero; if (ctx.relations && ctx.relations[hero]) p.rel = ctx.relations[hero]; if (ctx.bible[hero]) p.bible = ctx.bible[hero]; p.theaters = ctx.theaters.filter(t => (t.castKeys || []).includes(hero));
      try { const r = await Ai.chat(ctx.settings.global.ai, p, [{ role: "user", text: q }], () => {}, {}); console.log(`PERSONA ${skin} [${p.style}/${p.addr}] → ${r.text.replace(/\n/g, " ")} {${r.raw}}`); }
      catch (e) { console.log(`PERSONA ${skin} ERROR ${e.message}`); }
      await new Promise(r => setTimeout(r, +argVal("--persona-gap", "7000") || 7000));
    }
    console.log("PERSONA done");
  }, 5000);
  // 혼잣말 대본 시험: 사도 하나가 여덟 번 중얼거린다 (되풀이·모션·말풍선 확인)
  if (argHas("--selftalk-test")) setTimeout(async () => {
    const id = ctx.settings.characters[0].id, prof = ctx.chatProfile(id);
    console.log(`SELFTALKTEST hero=${prof && prof.ko}(${prof && prof.key}) 대본 ${((ctx.selfTalk[prof && prof.key]) || []).length}줄`);
    for (let i = 0; i < 8; i++) { const ok = ctx.saySelfTalk(id); console.log(`SELFTALKTEST ${i + 1}/8 ${ok ? "말함" : "대본 없음"}`); await new Promise(r => setTimeout(r, 2500)); }
    const said = ctx.selfTalkSaid.get(prof.key) || [];
    console.log(`SELFTALKTEST 서로 다른 줄 ${new Set(said).size}/${said.length} (8번에 겹침 없어야 정상)`);
    app.quit();
  }, 6000);
  if (argHas("--gemini-models")) setTimeout(async () => { const key = Ai.decKey(Ai.merge(ctx.settings.global.ai).keys.gemini); const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key } }); const j = await r.json(); console.log("GEMINI MODELS", r.status, JSON.stringify((j.models || []).filter(m => (m.supportedGenerationMethods || []).includes("generateContent")).map(m => m.name.replace("models/", "")))); app.quit(); }, 3000);
  if (argHas("--chat-test")) setTimeout(async () => {
    const id = ctx.settings.characters[0].id; ctx.openChat(id);
    setTimeout(async () => { const st = await Ai.status(ctx.settings.global.ai); console.log("CHATTEST status", JSON.stringify(st)); for (const q of (argVal("--chat-msgs", "") || "안녕! 오늘 뭐 했어?").split("|")) { await ctx.chatWin.webContents.executeJavaScript(`document.getElementById("in").value = ${JSON.stringify(q)}; document.getElementById("send").click();`); for (let i = 0; i < 20 && !ctx.chatBusy; i++) await new Promise(r => setTimeout(r, 100)); for (let i = 0; i < 400 && ctx.chatBusy; i++) await new Promise(r => setTimeout(r, 250)); await new Promise(r => setTimeout(r, 800)); } const r = Ai.loadHistory(app.getPath("userData"), id); console.log("CHATTEST history", JSON.stringify(r)); console.log("CHATTEST ui", await ctx.chatWin.webContents.executeJavaScript(`JSON.stringify({sendDisabled: document.getElementById("send").disabled, inDisabled: document.getElementById("in").disabled, bg: getComputedStyle(document.getElementById("send")).backgroundColor})`)); setTimeout(async () => { if (ctx.chatWin && !app.isPackaged) { const img = await ctx.chatWin.webContents.capturePage(); fs.writeFileSync(path.join(__dirname, "out", "chat.png"), img.toPNG()); console.log("CHAT shot", img.getSize(), JSON.stringify(ctx.chatWin.getBounds())); } }, 1200); }, 2500);
  }, 5000);
  if (argHas("--screen-test")) setTimeout(async () => {
    const id = ctx.settings.characters[0].id;
    const origCap = ctx.captureScreenFor;
    let picked = null; ctx.captureScreenFor = async (i) => { const r = await origCap(i); picked = r.window || ("모니터 " + r.display); console.log("SCREENTEST 캡처:", picked, `${(r.data.length / 1024).toFixed(0)}KB`); return r; };
    if (argHas("--dry")) { // 캡처까지만 — AI 에 보내지 않는다. 어느 창이 찍히는지, 막힐 때 무슨 말이 나오는지만 본다
      try { await ctx.captureScreenFor(id); } catch (e) { console.log("SCREENTEST 막힘:", e.message); }
      app.quit(); return;
    }
    await ctx.screenTalk(id, argVal("--screen-msg", "") || "");
    for (let i = 0; i < 400 && ctx.chatBusy; i++) await new Promise(r => setTimeout(r, 250));
    await new Promise(r => setTimeout(r, 1500));
    if (ctx.chatWin && !ctx.chatWin.isDestroyed()) { const img = await ctx.chatWin.webContents.capturePage(); fs.writeFileSync(path.join(__dirname, "out", "chat-screen.png"), img.toPNG()); console.log("SCREENTEST 대화창 캡처", img.getSize()); }
    const h = Ai.loadHistory(app.getPath("userData"), id).slice(-1)[0];
    console.log("SCREENTEST 답:", h ? JSON.stringify(h.text) : "(기록 없음 — 오류 말풍선만 떴을 것)");
    app.quit();
  }, 6000);
  if (argHas("--menu-test")) setTimeout(async () => { const id = ctx.settings.characters[0].id; ctx.openMenu(id, ctx.geo.x + 400, ctx.geo.y + 300); setTimeout(async () => { if (ctx.menuWin) { const img = await ctx.menuWin.webContents.capturePage(); fs.writeFileSync(path.join(__dirname, "out", "menu.png"), img.toPNG()); console.log("MENU shot", img.getSize());
    const sub = argVal("--menu-sub", ""); if (sub) { await ctx.menuWin.webContents.executeJavaScript(`document.querySelector('[data-toggle=${sub}]').click()`); await new Promise(r => setTimeout(r, 800)); const b = ctx.menuWin.getBounds(); const info = await ctx.menuWin.webContents.executeJavaScript("({sh: document.getElementById('menu').scrollHeight, ch: document.getElementById('menu').clientHeight, quitY: document.querySelector('[data-act=quit]').getBoundingClientRect().bottom})"); console.log("MENU sub", sub, JSON.stringify(b), JSON.stringify(info)); const img2 = await ctx.menuWin.webContents.capturePage(); fs.writeFileSync(path.join(__dirname, "out", "menu-sub.png"), img2.toPNG()); }
    // --menu-click='선택자|선택자' — 메뉴 항목을 순서대로 눌러 본다. 누른 뒤 사도들 설정을 찍어 통합 편집이 먹는지 본다
    for (const sel of (argVal("--menu-click", "") || "").split("|").filter(Boolean)) { await ctx.menuWin.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(sel)}).click()`); await new Promise(r => setTimeout(r, 700)); console.log(`MENU click ${sel} → ${JSON.stringify(ctx.settings.characters.map(c => [c.id, c.scale, c.mode, c.skin]))} bulkEdit=${!!ctx.settings.global.display.bulkEdit}`); }
    } }, 1500); }, 5000);
  if (argHas("--multi-test")) setTimeout(() => {
    const dump = (tag) => console.log(`MULTI ${tag} chars=${JSON.stringify(ctx.settings.characters.map(c => [c.id, c.skin, c.mode, c.scale]))} rects=${[...instances.keys()].join(",")} windows=${BrowserWindow.getAllWindows().length} hitFor=${ctx.hitFor} shown=${ctx.hitShown} rects=${[...instances.values()].map(i => i.rect ? JSON.stringify(ctx.screenRect(i.rect)) : "-").join(" ")}`);
    dump("start");
    const id2 = ctx.addCharacter(ctx.settings.characters[0].id);
    setTimeout(() => {
      dump("added");
      ctx.updateSettings({ skin: "Mini_Erpin", scale: 0.8 }, id2);            // 개별 설정: 2번만 바뀌어야 함
      ctx.updateSettings({ sound: { master: 0.3 } }, ctx.settings.characters[0].id); // 공통 설정
      setTimeout(() => {
        dump("patched"); console.log("MULTI global.sound.master=", ctx.settings.global.sound.master, "view(c1).skin=", ctx.viewFor(ctx.settings.characters[0].id).skin, "view(id2)=", ctx.viewFor(id2).skin, ctx.viewFor(id2).scale, "count", ctx.viewFor(id2).count);
        const inst = ctx.instances.get(id2); const hb = ctx.screenRect(inst.rect); ctx.updateHitTarget(hb.x + hb.width / 2 - ctx.geo.x, hb.y + hb.height / 2 - ctx.geo.y); console.log("MULTI hover c2 → hitFor=", ctx.hitFor, "hitWin=", ctx.hitWin ? JSON.stringify(ctx.hitWin.getBounds()) : null);
        ipcMain.emit("hit-ev", null, { instance: id2, type: "mousedown", sx: hb.x + hb.width / 2, sy: hb.y + hb.height / 2, button: 2, buttons: 0 });
        setTimeout(() => {
          console.log("MULTI menuFor=", ctx.menuFor, "menuWin=", ctx.menuWin ? JSON.stringify(ctx.menuWin.getBounds()) : null);
          if (ctx.menuWin && !ctx.menuWin.isDestroyed()) ctx.menuWin.close();
          ctx.removeCharacter(id2);
          setTimeout(() => { dump("removed"); console.log("MULTI DONE"); app.quit(); }, 1500);
        }, 2500);
      }, 4000);
    }, 6000);
  }, 5000);


  // --memdump — 40초 뒤 Chromium memory-infra 를 12초 기록해 GPU 프로세스의 할당자별 크기를 찍는다.
  // "GPU 프로세스가 700MB" 가 텍스처인지 스킨 캐시인지 공유 이미지인지를 이걸로 가른다
  if (argHas("--memdump")) setTimeout(async () => {
    const { contentTracing } = require("electron");
    await contentTracing.startRecording({ included_categories: ["disabled-by-default-memory-infra"], memory_dump_config: { triggers: [{ mode: "detailed", periodic_interval_ms: 3000 }] } });
    await new Promise(r => setTimeout(r, 12000));
    const file = await contentTracing.stopRecording();
    const j = JSON.parse(fs.readFileSync(file, "utf8")); const ev = j.traceEvents || j;
    const pidName = {}; for (const e of ev) if (e.ph === "M" && e.name === "process_name") pidName[e.pid] = e.args.name;
    const dumps = ev.filter(e => e.ph === "v" && e.args && e.args.dumps && e.args.dumps.allocators);
    const last = {}; for (const d of dumps) last[d.pid] = d; // 프로세스별 마지막 덤프
    for (const [pid, d] of Object.entries(last)) {
      const rows = [];
      for (const [name, a] of Object.entries(d.args.dumps.allocators)) { const sz = a.attrs && a.attrs.size; if (!sz) continue; const v = parseInt(sz.value, 16); if (name.split("/").length <= 3 && v > 2 * 1024 * 1024) rows.push([name, v]); }
      rows.sort((x, y) => y[1] - x[1]);
      console.log(`MEMDUMP ${pidName[pid] || "?"} pid ${pid}`); for (const [n, v] of rows.slice(0, 24)) console.log(`MEMDUMP   ${(v / 1048576).toFixed(0).padStart(5)} MB  ${n}`);
    }
    console.log("MEMDUMP file", file); app.quit();
  }, 40000);

  // --shot-mascot — 8초 뒤 마스코트 창을 그대로 찍는다(out/mascot.png). 렌더 옵션을 바꿨을 때 눈으로 확인용
  if (argHas("--shot-mascot")) setTimeout(async () => { const w = ctx.mascotWin; if (w && !w.isDestroyed()) { const img = await w.webContents.capturePage(); fs.writeFileSync(path.join(__dirname, "out", "mascot.png"), img.toPNG()); console.log("MASCOT shot", img.getSize()); } app.quit(); }, 8000);

  // --chat-race-test — 대화 상태의 경쟁 네 가지를 재현하고 스스로 판정한다. 외부 AI 없이 돌리려면 SADO_AI_MOCK=1
  // (ai.js 의 모의 제공자: 150ms 마다 토큰, 취소 가능). npm run test:flow 가 이걸 새 프로필로 띄워 FAIL 이 있으면 실패로 끝낸다.
  //   ① 답하는 중 다른 사도로 옮김 → 앞 턴이 끊기고 어느 쪽에도 기록이 남지 않는다
  //   ② 정상 턴 → 기록 2줄
  //   ③ 답하는 중 '기록 지우기' → 턴이 끊기고 기록 0줄 (고치기 전엔 옛 기록이 되살아나 4줄)
  //   ④ A 를 열고 곧장 B 를 열기 → 초기화(Ai.status 대기)가 늦게 끝나도 창의 이름은 B (고치기 전엔 A 가 덮어썼다)
  //   ⑤ 화면 캡처 중 창 닫기 · ⑥ 캡처 중 다른 사도로 · ⑦ 캡처 중 '화면 보기' 끄기 → AI 요청이 시작되지 않는다 (⑧ 은 캡처가 그대로 끝나면 턴이 도는 대조군)
  //   ⑨ 답하는 중 창 닫고 다시 열기 → 끊긴 턴은 저장되지 않고, 새 창은 입력이 열려 있다
  //   ⑩ A→B→A 연속 열기 → 대상·이름 A  ·  ⑪ 같은 사도의 답이 오는 중 다시 열기 → 답이 끊기지 않고 창에 남는다
  if (argHas("--chat-race-test")) setTimeout(async () => { try {
    const [a, b] = ctx.settings.characters.map(c => c.id); const ud = app.getPath("userData");
    const fails = [], ok = (cond, msg) => { console.log(`RACETEST ${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) fails.push(msg); };
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const wait = async () => { for (let i = 0; i < 400 && ctx.chatBusy; i++) await sleep(100); };
    const sendIn = async (text) => { await ctx.chatWin.webContents.executeJavaScript(`document.getElementById("in").value = ${JSON.stringify(text)}; document.getElementById("send").click();`); for (let i = 0; i < 30 && !ctx.chatBusy; i++) await sleep(100); };
    const who = () => ctx.chatWin.webContents.executeJavaScript(`document.getElementById("who").textContent`);
    const koOf = (id) => { const p = ctx.chatProfile(id); return p ? p.ko : id; };
    Ai.clearHistory(ud, a); Ai.clearHistory(ud, b);
    ctx.openChat(a); await sleep(2500);
    // ①
    await sendIn("안녕! 오늘 뭐 했어?"); await sleep(600);
    ctx.openChat(b); const busyAtSwitch = ctx.chatBusy; await wait(); await sleep(300);
    ok(busyAtSwitch, "① 옮길 때 앞 사도가 답하는 중이었다(시험 전제)");
    ok(Ai.loadHistory(ud, a).length === 0 && Ai.loadHistory(ud, b).length === 0, `① 옮긴 뒤 기록 a=${Ai.loadHistory(ud, a).length} b=${Ai.loadHistory(ud, b).length} (둘 다 0)`);
    ok((await who()) === koOf(b), `① 창 이름=${await who()} (${koOf(b)} 이어야)`);
    // ②
    ctx.openChat(a); await sleep(1500);
    await sendIn("꿀은 어디서 나?"); await wait(); await sleep(200);
    ok(Ai.loadHistory(ud, a).length === 2, `② 정상 턴 뒤 기록 ${Ai.loadHistory(ud, a).length}줄 (2)`);
    // ③
    await sendIn("하나 더 물을게"); await sleep(400);
    const busyAtClear = ctx.chatBusy; ipcMain.emit("chat:clear"); await wait(); await sleep(400);
    ok(busyAtClear, "③ 지울 때 답하는 중이었다(시험 전제)");
    ok(Ai.loadHistory(ud, a).length === 0, `③ 지운 뒤 기록 ${Ai.loadHistory(ud, a).length}줄 (0 — 되살아나면 4)`);
    // ④ 초기화 경쟁 — A 열고 곧장 B
    Ai._test.setMockStatusDelay(900); ctx.openChat(a); ctx.openChat(b); await sleep(2500);   // A 의 초기화(status)만 0.9초 늦춘다 — B 가 먼저 끝나고 A 가 나중에 도착
    ok(ctx.chatFor === b && (await who()) === koOf(b), `④ A→B 연속 열기 뒤 대상=${ctx.chatFor} 창 이름=${await who()} (${koOf(b)})`);
    Ai._test.setMockStatusDelay(900); ctx.openChat(b); ctx.openChat(a); await sleep(2500);
    ok(ctx.chatFor === a && (await who()) === koOf(a), `④' B→A 연속 열기 뒤 창 이름=${await who()} (${koOf(a)})`);
    // ⑤~⑧ 화면 캡처 경쟁 — 캡처를 0.8초 걸리는 가짜로 바꾼다. '요청이 시작됐다' 는 chatBusy 가 한 번이라도 true 였는지로 본다
    ctx.updateSettings({ ai: { screen: true } });
    const realCap = ctx.captureScreenFor; ctx.captureScreenFor = async () => { await sleep(800); return { mime: "image/png", data: "iVBORw0KGgo=" }; };
    const sawBusy = async (ms) => { for (let i = 0; i < ms / 50; i++) { if (ctx.chatBusy) return true; await sleep(50); } return false; };
    ctx.chatWin.close(); await sleep(300); Ai.clearHistory(ud, a); Ai.clearHistory(ud, b);
    ctx.screenTalk(a, "이거 봐"); await sleep(300); ctx.chatWin.close();   // 캡처(0.8초)가 도는 중에 닫기 — 창은 아직 뜨는 중이어도 된다
    ok(!(await sawBusy(1500)) && Ai.loadHistory(ud, a).length === 0, `⑤ 캡처 중 창을 닫음 → 요청 없음 (busy=${ctx.chatBusy} 기록 ${Ai.loadHistory(ud, a).length})`);
    ctx.screenTalk(a, "이거 봐"); await sleep(300); ctx.openChat(b); const sw = await sawBusy(1500);
    ok(!sw && ctx.chatFor === b && Ai.loadHistory(ud, a).length === 0, `⑥ 캡처 중 다른 사도로 → 요청 없음 (busy=${sw} 대상=${ctx.chatFor})`);
    ctx.chatWin.close(); await sleep(300);
    ctx.screenTalk(a, "이거 봐"); await sleep(300); ctx.updateSettings({ ai: { screen: false } }); const sw7 = await sawBusy(1500);
    ok(!sw7 && Ai.loadHistory(ud, a).length === 0, `⑦ 캡처 중 화면 보기 끔 → 요청 없음 (busy=${sw7})`);
    ctx.updateSettings({ ai: { screen: true } });
    ctx.screenTalk(a, "이거 봐"); const sw8 = await sawBusy(2500); await wait(); await sleep(300);
    ok(sw8 && Ai.loadHistory(ud, a).length === 2, `⑧ 대조군: 캡처가 끝나면 턴이 돈다 (busy=${sw8} 기록 ${Ai.loadHistory(ud, a).length}줄, 2)`);
    ctx.captureScreenFor = realCap; ctx.updateSettings({ ai: { screen: false } });
    // ⑨ 답하는 중 닫고 다시 열기
    Ai.clearHistory(ud, a); ctx.openChat(a); await sleep(1500); await sendIn("잠깐만"); await sleep(400);
    const busyAtClose = ctx.chatBusy; ctx.chatWin.close(); await wait(); await sleep(300);
    ctx.openChat(a); await sleep(1500);
    const inOpen = await ctx.chatWin.webContents.executeJavaScript(`!document.getElementById("in").disabled`);
    ok(busyAtClose && !ctx.chatBusy && Ai.loadHistory(ud, a).length === 0 && inOpen && (await who()) === koOf(a), `⑨ 답하는 중 닫고 다시 열기 → 저장 ${Ai.loadHistory(ud, a).length}줄(0) · 입력 ${inOpen ? "열림" : "잠김"} · 이름=${await who()}`);
    // ⑩ A→B→A
    Ai._test.setMockStatusDelay(900); ctx.openChat(a); ctx.openChat(b); ctx.openChat(a); await sleep(2800);
    ok(ctx.chatFor === a && (await who()) === koOf(a), `⑩ A→B→A 연속 열기 뒤 대상=${ctx.chatFor} 이름=${await who()} (${koOf(a)})`);
    // ⑪ 같은 사도의 답이 오는 중 다시 열기(단축키)
    await sendIn("계속 말해 줘"); await sleep(400); ctx.openChat(a); await sleep(200); const stillBusy = ctx.chatBusy; await wait(); await sleep(300);
    const bots = await ctx.chatWin.webContents.executeJavaScript(`[...document.querySelectorAll("#log .msg.bot")].filter(d => d.textContent).length`);
    ok(stillBusy && Ai.loadHistory(ud, a).length === 2 && bots >= 1 && await ctx.chatWin.webContents.executeJavaScript(`!document.getElementById("in").disabled`), `⑪ 답하는 중 다시 열기 → 안 끊김(busy=${stillBusy}) · 기록 ${Ai.loadHistory(ud, a).length}줄(2) · 창에 답 ${bots}개 · 입력 열림`);
    // ⑫ 창은 열 때 자리를 잡고 사도가 움직여도 그대로 — 렌더러 없는 가짜 사도 'zz' 로 (진짜 사도는 렌더러가 제 위치를 계속 보낸다)
    if (ctx.geo) {
      ctx.instances.set("zz", { rect: { x: 300, y: 500, w: 120, h: 160 } }); ctx.openChat("zz"); await sleep(1500);
      const ev = { sender: { id: 0 } }, b1 = ctx.chatWin.getBounds();
      ipcMain.emit("hit-rect", ev, { x: 700, y: 300, w: 120, h: 160 }, "zz"); await sleep(200); const b2 = ctx.chatWin.getBounds();
      ok(b1.x === b2.x && b1.y === b2.y, `⑫ 사도가 (400, −200) 옮겨도 창은 그대로 (${b2.x - b1.x}, ${b2.y - b1.y})`);
      ctx.chatWin.close(); ctx.instances.delete("zz");
    }
    // ⑬ 기록 파일이 망가진 채 말을 걸기 — JSON 으로 읽히지만 배열이 아닌 {} (사람이 고쳤거나 저장이 잘렸을 때).
    // 고치기 전엔 준비 단계(hist.map)에서 터졌고 그게 try 밖이라 chatBusy 가 잠긴 채 남아 대화가 영영 막혔다
    // 앞 창이 닫히는 중일 수 있다(⑫). 닫힘이 끝나고 a 의 새 창이 현재 창이 될 때까지 기다린다 — 그 틈에 보내면 chatWin 이 null 이다
    const winUp = async () => { for (let i = 0; i < 80 && !(ctx.chatWin && !ctx.chatWin.isDestroyed() && ctx.chatFor === a); i++) await sleep(100); await sleep(800); };
    for (let i = 0; i < 40 && ctx.chatWin; i++) await sleep(100);   // ⑫ 의 close 가 끝나기 전에 열면 openChat 이 제 차례를 잃는다(창 닫힘이 chatSeq 를 올린다)
    ctx.openChat(a); await winUp();
    Ai.clearHistory(ud, a); Ai.saveHistory(ud, a, [{ role: "user", text: "씨앗" }, { role: "assistant", text: "응" }], 12);
    const cdir = path.join(ud, "chat");
    const hfile = path.join(cdir, fs.readdirSync(cdir).find(f => f.endsWith(".json")));
    fs.writeFileSync(hfile, JSON.stringify({ broken: true }));   // 배열이 아니다
    ok(Ai.loadHistory(ud, a).length === 0, `⑬ 망가진 기록은 빈 것으로 읽는다 (${JSON.stringify(Ai.loadHistory(ud, a))})`);
    await sendIn("망가진 기록에도 대답해 줘"); await wait(); await sleep(300);
    ok(!ctx.chatBusy, `⑬ 턴 뒤 대화가 잠기지 않았다 (busy=${ctx.chatBusy})`);
    ok(Ai.loadHistory(ud, a).length === 2, `⑬ 새 기록 ${Ai.loadHistory(ud, a).length}줄 (2 — 망가진 것 대신 새로 쌓인다)`);
    // ⑭ 답하는 도중 '기록 저장' 끄기 → 그 답은 저장되지 않는다 (시작 시점 설정을 붙들고 있으면 저장됐다)
    Ai.clearHistory(ud, a);
    await sendIn("이건 저장되면 안 돼"); await sleep(400);
    const busyAtOff = ctx.chatBusy; ctx.updateSettings({ ai: { memory: false } }); await wait(); await sleep(400);
    ok(busyAtOff, "⑭ 끌 때 답하는 중이었다(시험 전제)");
    ok(Ai.loadHistory(ud, a).length === 0, `⑭ 끈 뒤 기록 ${Ai.loadHistory(ud, a).length}줄 (0)`);
    ctx.updateSettings({ ai: { memory: true } });
    console.log(`RACETEST ${fails.length ? "FAILED " + fails.length : "ALL PASS"}`);
    app.exit(fails.length ? 1 : 0);
    } catch (e) { console.log("RACETEST FAIL 시험 자체가 터졌다:", e && e.stack || e); console.log("RACETEST FAILED 1"); app.exit(1); }
  }, 6000);

  // --stay-test — 대화창이 열려 있는 동안 그 사도가 제자리에 있는지(폴짝·점프 없음), 닫으면 다시 돌아다니는지. 에셋 필요(로컬)
  if (argHas("--stay-test")) setTimeout(async () => {
    const fails = [], ok = (cond, msg) => { console.log(`STAYTEST ${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) fails.push(msg); };
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const a = ctx.settings.characters[0].id, R = () => (ctx.instances.get(a) || {}).rect, x = () => R() && R().x + R().w / 2, y = () => R() && R().y + R().h;   // 발 위치(가운데·아래) — 대기 애니로 바운딩 박스가 흔들려도 덜 움직인다
    ctx.updateSettings({ behavior: { hopChance: 100, jumpChance: 0, idleMin: 0.5, idleMax: 1 } }, a);   // 쉬는 시간마다 반드시 폴짝
    await sleep(3000); if (x() === undefined) { console.log("STAYTEST FAIL 사도 위치가 없다(에셋 없음?)"); app.exit(1); return; }
    ctx.openChat(a);
    for (let t = 0, still = 0, px = x(); t < 40 && still < 3; t++) { await sleep(500); still = Math.abs(x() - px) < 2 ? still + 1 : 0; px = x(); }   // 열 때 하던 폴짝은 끝까지 간다 — 1.5초 멈춘 뒤부터 잰다(최대 20초)
    const x0 = x(), y0 = y(); let dx = 0, dy = 0;
    for (let i = 0; i < 40; i++) { await sleep(500); dx = Math.max(dx, Math.abs(x() - x0)); dy = Math.max(dy, Math.abs(y() - y0)); }
    ok(dx < 50 && dy < 50, `대화창 열린 20초 동안 이동 x ${dx.toFixed(0)}px y ${dy.toFixed(0)}px (폴짝은 80px 이상 — 대기 애니로 바운딩 박스만 흔들림)`);
    ctx.chatWin.close(); await sleep(300);
    const x1 = x(); let moved = 0;
    for (let i = 0; i < 40 && moved < 30; i++) { await sleep(500); moved = Math.max(moved, Math.abs(x() - x1)); }
    ok(moved >= 30, `닫은 뒤 20초 안에 다시 폴짝 (${moved.toFixed(0)}px)`);
    console.log(`STAYTEST ${fails.length ? "FAILED " + fails.length : "ALL PASS"}`);
    app.exit(fails.length ? 1 : 0);
  }, 5000);

  // --monitor-test — 사도는 서 있는 모니터 안에서만 폴짝하고, 옆 모니터로 끌어다 놓으면 그곳에 머물며 그 모니터 id 가 설정에 남는다. 모니터 둘·에셋 필요(로컬)
  if (argHas("--monitor-test")) setTimeout(async () => { try { await monitorTest(); } catch (e) { console.log("MONTEST FAIL 예외:", e.stack || e); app.exit(1); } }, 5000);
  async function monitorTest() {
    const fails = [], ok = (cond, msg) => { console.log(`MONTEST ${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) fails.push(msg); };
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const a = ctx.settings.characters[0].id, D = ctx.geo.displays;
    if (D.length < 2) { console.log("MONTEST FAIL 모니터가 둘 이상이어야 한다"); app.exit(1); return; }
    const R = () => (ctx.instances.get(a) || {}).rect, cx = () => { const r = R(); return r ? r.x + r.w / 2 : NaN; };   // 공중에 떠 있는 순간엔 히트 사각형이 없다(null)
    const dispOf = (x) => D.findIndex(d => x >= d.x && x < d.x + d.w);
    // 미니미로 맞춘다 — 스탠딩은 가로로 끄는 것이 '간지럽히기' 로 잡혀 들어 올려지지 않는다(시험이 끌기를 못 한다)
    ctx.updateSettings({ mode: "minimi", behavior: { hopChance: 100, jumpChance: 0, idleMin: 0.3, idleMax: 0.8, hopRange: 900 } }, a);   // 멀리, 자주 폴짝
    ctx.updateSettings({ display: { confineMonitor: !argHas("--roam") } });   // --roam 은 대조군: '모니터 가두기' 를 끄면 ① 이 떨어져야 한다. 프로필이 재사용되니 켜는 쪽도 명시
    await sleep(3000); const d0 = dispOf(cx());
    { const want = D.findIndex(d => d.id === +ctx.settings.characters[0].monitor); if (want >= 0) ok(d0 === want, `⓪ 설정에 적힌 모니터에서 시작 (${d0} = ${want})`); else console.log(`MONTEST PASS ⓪ 설정에 모니터가 없어 ${d0}번에서 시작 (건너뜀)`); }
    // 히트 창이 보내는 마우스 이벤트를 흉내내 끌어다 놓는다 (화면 좌표)
    const ev = (type, x, y) => ipcMain.emit("hit-ev", { sender: { id: 0 } }, { instance: a, type, sx: x, sy: y, button: 0, buttons: type === "mouseup" ? 0 : 1 });
    const dragTo = async (tx, ty) => { for (let t = 0, still = 0, px = cx(); t < 50 && still < 2; t++) { await sleep(200); still = R() && Math.abs(cx() - px) < 2 ? still + 1 : 0; px = cx(); }   // 폴짝 중이면 잡기를 놓친다 — 멈출 때까지(최대 10초)
      const r0 = R(); if (!r0) { ok(false, "끌 사도의 히트 사각형이 없다"); return; }
      ctx.mascotWin.webContents.send("mascot", a, "logstate", "drag-before"); console.log(`MONTEST · 끌기 시작 rect=${JSON.stringify(r0)} → (${tx.toFixed(0)}, ${ty.toFixed(0)})`);
      const sx = ctx.geo.x + r0.x + r0.w / 2, sy = ctx.geo.y + r0.y + r0.h / 2; ev("mousedown", sx, sy); await sleep(80); for (let i = 1; i <= 30; i++) { ev("mousemove", sx + (tx - sx) * i / 30, sy + (ty - sy) * i / 30); await sleep(30); } ev("mouseup", tx, ty); await sleep(2500); };
    // ① 모니터 경계 바로 앞(100px)에 세워 두고 900px 폴짝을 30초 — 가두지 않으면 첫 오른쪽 폴짝에 넘어간다
    const here = D[d0], nb = D[(d0 + 1) % D.length], right = nb.x > here.x;
    await dragTo(ctx.geo.x + (right ? here.x + here.w - 100 : here.x + 100), ctx.geo.y + here.floor - 200);
    const seen = new Set();
    for (let i = 0; i < 60; i++) { await sleep(500); seen.add(dispOf(cx())); }
    ok(seen.size === 1 && seen.has(d0), `① 경계 앞에서 30초 폴짝하는 동안 머문 모니터 ${[...seen].join(",")} (${d0} 하나여야)`);
    // ② 옆 모니터로 끌어다 놓는다
    await dragTo(ctx.geo.x + nb.x + nb.w / 2, ctx.geo.y + nb.floor - 200);
    const d1 = dispOf(cx()); ok(d1 === (d0 + 1) % D.length, `② 끌어다 놓은 뒤 모니터 ${d1} (목표 ${(d0 + 1) % D.length})`);
    const seen2 = new Set(); for (let i = 0; i < 60; i++) { await sleep(500); seen2.add(dispOf(cx())); }
    ok(seen2.size === 1 && seen2.has(d1), `③ 옮긴 뒤 30초 동안 머문 모니터 ${[...seen2].join(",")} (${d1} 하나여야)`);
    ok(+ctx.settings.characters[0].monitor === D[d1].id, `④ 놓아둔 모니터 id 가 설정에 남았다 (${ctx.settings.characters[0].monitor} = ${D[d1].id}) — 다음 시작도 거기서`);
    console.log(`MONTEST ${fails.length ? "FAILED " + fails.length : "ALL PASS"}`);
    app.exit(fails.length ? 1 : 0);
  }

  // --react-test — 교감 직후 그 상황의 대본만 나오는지(only), 없는 상황이면 말하지 않는지. 에셋 필요(로컬)
  if (argHas("--react-test")) setTimeout(() => {
    const fails = [], ok = (cond, msg) => { console.log(`REACTTEST ${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) fails.push(msg); };
    const a = ctx.settings.characters[0].id, prof = ctx.chatProfile(a), lines = ctx.selfTalk[prof.key] || [];
    for (const kind of ["petted", "poked", "thrown"]) {
      const said = new Set();
      for (let i = 0; i < 12; i++) { const r = ctx.saySelfTalk(a, { only: kind, quiet: true }); if (!r) break; const t = (ctx.selfTalkSaid.get(prof.key) || []).slice(-1)[0]; said.add(t); }
      const tagged = new Set(lines.filter(x => x.w === kind).map(x => x.t));
      ok(said.size > 0 && [...said].every(t => tagged.has(t)), `${kind}: ${said.size}줄 말함, 전부 [${kind}] 꼬리표 (${[...said][0] || "-"})`);
    }
    ok(ctx.saySelfTalk(a, { only: "nosuchtag", quiet: true }) === false, "없는 상황이면 말하지 않는다");
    console.log(`REACTTEST ${fails.length ? "FAILED " + fails.length : "ALL PASS"}`);
    app.exit(fails.length ? 1 : 0);
  }, 4000);

  // --aifail-test — 외부 AI 실패 상황에서 안내와 입력 복구. test/fake-ai.js(OpenAI 호환 흉내)가 끊김 → 429 → 401 → 정상 순으로 답한다
  if (argHas("--aifail-test")) setTimeout(async () => {
    const fails = [], ok = (cond, msg) => { console.log(`AIFAIL ${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) fails.push(msg); };
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const a = ctx.settings.characters[0].id; ctx.openChat(a); await sleep(2500);
    const js = (code) => ctx.chatWin.webContents.executeJavaScript(code);
    const send = async (text) => { await js(`document.getElementById("in").value = ${JSON.stringify(text)}; document.getElementById("send").click();`); for (let i = 0; i < 30 && !ctx.chatBusy; i++) await sleep(100); for (let i = 0; i < 300 && ctx.chatBusy; i++) await sleep(100); await sleep(400); };
    const last = () => js(`(() => { const e = [...document.querySelectorAll("#log .msg.bot")].pop(); return { text: e ? e.textContent : "", err: !!(e && e.classList.contains("err")), cut: document.querySelectorAll("#log .msg.bot.cut").length, inOn: !document.getElementById("in").disabled, sendOn: !document.getElementById("send").disabled }; })()`);
    await send("첫 번째"); let r = await last();
    ok(r.err && /연결이 중간에 끊겼습니다/.test(r.text) && r.cut === 1 && r.inOn && r.sendOn, `① 스트림 끊김 → 안내 "${r.text.slice(0, 40)}" · 받은 조각 남김=${r.cut} · 입력 ${r.inOn ? "열림" : "잠김"}`);
    await send("두 번째"); r = await last();
    ok(r.err && /사용 한도를 넘었거나/.test(r.text) && r.inOn, `② 429 → "${r.text.slice(0, 40)}" · 입력 ${r.inOn ? "열림" : "잠김"}`);
    await send("세 번째"); r = await last();
    ok(r.err && /API 키가 올바르지 않거나/.test(r.text) && r.inOn, `③ 401 → "${r.text.slice(0, 40)}" · 입력 ${r.inOn ? "열림" : "잠김"}`);
    await send("네 번째"); r = await last();
    ok(!r.err && /잘 왔다비/.test(r.text) && r.inOn, `④ 그 뒤 정상 답 "${r.text.slice(0, 30)}" — 오류 뒤에도 다음 턴이 된다`);
    const hist = Ai.loadHistory(app.getPath("userData"), a);
    ok(hist.length === 2, `⑤ 기록에는 정상 턴만 남았다 (${hist.length}줄, 2)`);
    console.log(`AIFAIL ${fails.length ? "FAILED " + fails.length : "ALL PASS"}`);
    app.exit(fails.length ? 1 : 0);
  }, 6000);

  // --quit-in <초> — 그만큼 뒤에 앱을 정상 종료한다(app.quit → before-quit 이 돈다). 끝날 때 치우는 것들을 시험할 때
  if (argHas("--quit-in")) setTimeout(() => { console.log("QUITIN 정상 종료"); app.quit(); }, (+argVal("--quit-in", 10) || 10) * 1000);

  // --diag-test — 진단 정보에 필요한 줄이 다 있고, API 키·대화 내용 같은 비밀이 섞이지 않는지
  if (argHas("--diag-test")) setTimeout(async () => {
    const fails = [], ok = (cond, msg) => { console.log(`DIAGTEST ${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) fails.push(msg); };
    ctx.openSettings("about"); await new Promise(r => setTimeout(r, 2500));   // handle 은 직접 못 부르니 설정 창의 다리로 부른다
    const out = await ctx.settingsWin.webContents.executeJavaScript("window.host.diagGet()");
    console.log("DIAGTEST ----" + String.fromCharCode(10) + out + String.fromCharCode(10) + "DIAGTEST ----");
    for (const must of ["사도 데스크 v", "게임 데이터:", "사도 ", "화면:", "소리:", "AI:", "새 소식:", "경로:"]) ok(out.includes(must), `줄 있음: ${must}`);
    const key = Ai.decKey(Ai.merge(ctx.settings.global.ai).keys.gemini || "");
    ok(!/sk-ant-|AIza|"keys"/.test(out) && (!key || !out.includes(key)), "API 키가 들어가지 않는다");
    ok(!/혼잣말\[|chat\[/.test(out), "대화·혼잣말 내용이 들어가지 않는다");
    { const lines = out.split(String.fromCharCode(10)).length; ok(lines >= 8 && out.length < 4000, `길이 ${out.length}자 · ${lines}줄 (붙여 넣을 만한 크기)`); }
    console.log(`DIAGTEST ${fails.length ? "FAILED " + fails.length : "ALL PASS"}`);
    app.exit(fails.length ? 1 : 0);
  }, 4000);

  // --keys-test — 설정 창의 키보드 조작: Tab 으로 탭 줄에 닿고, ←→ 로 탭을 옮기고, Home·End 로 처음·끝
  if (argHas("--keys-test")) setTimeout(async () => {
    const fails = [], ok = (cond, msg) => { console.log(`KEYSTEST ${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) fails.push(msg); };
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    ctx.openSettings("character"); await sleep(2500);
    const wc = ctx.settingsWin.webContents;
    const js = (c) => wc.executeJavaScript(c);
    const cur = () => js("(document.querySelector('main section.on')||{}).id");
    const focused = () => js("document.activeElement && document.activeElement.dataset ? (document.activeElement.dataset.tab || document.activeElement.tagName) : 'none'");
    ok((await js("[...document.querySelectorAll('nav button')].filter(b => b.tabIndex === 0).length")) === 1, "Tab 으로 닿는 탭 단추는 하나(고른 것)");
    await js("document.querySelector('nav button.on').focus()"); await sleep(200);
    const key = (k) => wc.sendInputEvent({ type: "keyDown", keyCode: k });
    key("Right"); await sleep(300);
    ok((await cur()) === "tab-behavior" && (await focused()) === "behavior", `→ 로 다음 탭 (${await cur()} · 포커스 ${await focused()})`);
    key("Left"); await sleep(300);
    ok((await cur()) === "tab-character", `← 로 이전 탭 (${await cur()})`);
    key("End"); await sleep(300);
    ok((await cur()) === "tab-about", `End 로 마지막 탭 (${await cur()})`);
    key("Home"); await sleep(300);
    ok((await cur()) === "tab-guide", `Home 으로 첫 탭 (${await cur()})`);
    ok((await js("document.activeElement.getAttribute('aria-selected')")) === "true", "고른 탭에 aria-selected");
    console.log(`KEYSTEST ${fails.length ? "FAILED " + fails.length : "ALL PASS"}`);
    app.exit(fails.length ? 1 : 0);
  }, 4000);

  // --hints-test — 설정 창의 긴 설명 접기. 한 줄로 접히고, '더 보기'가 펼치고, 라벨 안의 버튼이라 체크박스를 건드리지 않아야 한다
  if (argHas("--hints-test")) setTimeout(async () => {
    const fails = [], ok = (cond, msg) => { console.log(`HINTSTEST ${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) fails.push(msg); };
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    ctx.openSettings("display"); await sleep(2500);
    const wc = ctx.settingsWin.webContents;
    await wc.executeJavaScript(`document.querySelector('nav button[data-tab="display"]').click()`); await sleep(300);   // "tab" 메시지가 로드보다 먼저 닿으면 사도 탭에 남는다 — 확실히 넘긴다
    const r = await wc.executeJavaScript(`(() => {
      const all = [...document.querySelectorAll(".row label .hint.clamp")];
      const on = document.querySelector("main section.on");   // 보이는 탭에서만 재야 높이가 나온다
      const h = on && on.querySelector("label:has(input[type=checkbox]) .hint.clamp"), b = h && h.nextElementSibling, cb = h && h.closest("label").querySelector("input[type=checkbox]");
      if (!h || !b || !cb) return { n: all.length, err: "보이는 탭(" + (on && on.id) + ")에 체크박스 딸린 접힌 설명이 없다" };
      const before = cb.checked, h0 = h.getBoundingClientRect().height;
      b.click(); const open = h.classList.contains("open"), h1 = h.getBoundingClientRect().height, t1 = b.textContent, after1 = cb.checked;
      b.click(); const closed = !h.classList.contains("open"), after2 = cb.checked;
      return { n: all.length, btn: b.className, before, after1, after2, open, closed, h0, h1, t1, short: [...document.querySelectorAll(".row label .hint:not(.clamp)")].every(x => x.textContent.trim().length < 70 || x.querySelector("a, code")) };
    })()`);
    ok(!r.err, r.err || `접힌 설명 ${r.n}개`);
    if (!r.err) {
      ok(r.n >= 8, `긴 설명이 접혔다 (${r.n}개)`);
      ok(r.btn === "more", "'더 보기' 버튼이 붙었다");
      ok(r.open && r.h1 > r.h0, `누르면 펼쳐진다 (${Math.round(r.h0)} → ${Math.round(r.h1)}px, "${r.t1}")`);
      ok(r.closed, "다시 누르면 접힌다");
      ok(r.before === r.after1 && r.before === r.after2, "체크박스는 그대로다 (라벨 안 버튼)");
      ok(r.short, "짧은 설명·링크 든 설명은 접지 않는다");
    }
    console.log(`HINTSTEST ${fails.length ? "FAILED " + fails.length : "ALL PASS"}`);
    app.exit(fails.length ? 1 : 0);
  }, 4000);

  // --bounds-test — 창 크기·위치 기억. 설정 창을 끌어 옮기고 크기를 바꾼 뒤 닫고 다시 열면 그 자리·크기여야 한다.
  // 저장된 값이 화면 밖(모니터가 빠진 경우)이면 안으로 끌어오는지, 메뉴 간격 설정이 메뉴에 닿는지도 본다
  if (argHas("--bounds-test")) setTimeout(async () => {
    const fails = [], ok = (cond, msg) => { console.log(`BOUNDSTEST ${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) fails.push(msg); };
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const wa = screen.getPrimaryDisplay().workArea;
    ctx.openSettings("display"); await sleep(2000);
    const w1 = ctx.settingsWin, want = { x: wa.x + 60, y: wa.y + 40, width: 760, height: 540 };
    w1.setBounds(want); await sleep(900);   // 400ms 디바운스 뒤 저장
    const saved = (ctx.settings.global.windows || {}).settings;
    ok(!!saved && saved.w === 760 && saved.h === 540 && saved.x === want.x && saved.y === want.y, `끌어 맞춘 크기·자리가 저장된다 (${JSON.stringify(saved)})`);
    w1.close(); await sleep(500);
    ctx.openSettings("display"); await sleep(1500);
    const b2 = ctx.settingsWin.getBounds();
    ok(b2.width === 760 && b2.height === 540 && b2.x === want.x && b2.y === want.y, `다시 열면 그 크기·자리 (${JSON.stringify(b2)})`);
    ctx.settingsWin.close(); await sleep(500);
    // 화면 밖에 저장돼 있던 경우 (옛 오른쪽 모니터 자리) → 안으로.
    // 모니터가 여럿인 PC 에선 '주 모니터 오른쪽' 이 아직 화면 위다 — 모든 작업영역의 오른쪽 끝보다 더 밖에 둔다
    const areas = screen.getAllDisplays().map(d => d.workArea);
    const rightMost = Math.max(...areas.map(a => a.x + a.width));
    ctx.updateSettings({ windows: { settings: { x: rightMost + 500, y: wa.y + 30, w: 700, h: 500 } } });
    ctx.openSettings("display"); await sleep(1500);
    const b3 = ctx.settingsWin.getBounds();
    const inSome = areas.some(a => b3.x >= a.x && b3.y >= a.y && b3.x + b3.width <= a.x + a.width && b3.y + b3.height <= a.y + a.height);
    ok(inSome && b3.width === 720, `화면 밖·최소보다 작은 값은 키워서 안으로 끌어온다 (x=${b3.x}, w=${b3.width}, 모니터 ${areas.length}대)`);
    // 메뉴 간격 고정이 메뉴에 닿는가
    ctx.updateSettings({ display: { menuDensity: "compact" } });
    const id = ctx.settings.characters[0].id; ctx.openMenu(id, wa.x + 300, wa.y + 200); await sleep(1500);
    const d1 = await ctx.menuWin.webContents.executeJavaScript("document.body.dataset.density");
    ctx.updateSettings({ display: { menuDensity: "auto" } }); await sleep(400);
    const d2 = await ctx.menuWin.webContents.executeJavaScript("document.body.dataset.density");
    ok(d1 === "compact", `메뉴 간격 '조밀' 고정 → 메뉴가 compact (${d1})`);
    ok(["roomy", "normal", "compact"].includes(d2), `자동으로 돌리면 화면 높이로 정한다 (${d2})`);
    console.log(`BOUNDSTEST ${fails.length ? "FAILED " + fails.length : "ALL PASS"}`);
    app.exit(fails.length ? 1 : 0);
  }, 4000);

  // --first-run-test — 설치판의 첫 실행. 빈 프로필(--userdata 새 폴더)로 띄우면 에셋이 없으니 '가져오기' 창이 첫 화면으로 떠야 한다.
  // test/first-run.js 가 dist/win-unpacked 또는 설치된 exe 로 돌린다 (개발 실행에선 prototype/assets 가 잡혀 첫 실행이 아니다)
  if (argHas("--first-run-test")) setTimeout(async () => {
    const fails = [], ok = (cond, msg) => { console.log(`FIRSTRUN ${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) fails.push(msg); };
    const w = ctx.setup.setupWin;
    ok(!ctx.hasAssets(ctx.assetRoot), `에셋 없음 (root=${ctx.assetRoot})`);
    ok(!ctx.mascotWin, "마스코트 창은 아직 없다");
    ok(!!ctx.tray, "트레이 아이콘이 있다");
    ok(w && !w.isDestroyed() && w.isVisible(), `가져오기 창이 보인다 (${w ? (w.isVisible() ? "visible" : "hidden") : "없음"})`);
    if (w && !w.isDestroyed()) {
      const b = w.getBounds(), d = screen.getDisplayMatching(b).workArea;
      ok(b.x >= d.x - 8 && b.y >= d.y - 8 && b.x + b.width <= d.x + d.width + 8 && b.y + b.height <= d.y + d.height + 8, `창이 화면 안에 있다 ${JSON.stringify(b)}`);
      const page = await w.webContents.executeJavaScript(`({ title: document.title, start: !!document.getElementById("start"), scan: !!document.getElementById("scan"), status: (document.getElementById("status") || {}).textContent || "" })`).catch(e => ({ err: e.message }));
      ok(page.start && page.scan, `가져오기 화면이 그려졌다 (title=${page.title} status=${JSON.stringify((page.status || "").slice(0, 40))})`);
    }
    ok(app.isPackaged ? /resources/.test(process.resourcesPath) : true, `packaged=${app.isPackaged} exe=${process.execPath}`);
    console.log(`FIRSTRUN ${fails.length ? "FAILED " + fails.length : "ALL PASS"}`);
    app.exit(fails.length ? 1 : 0);
  }, 4000);

  // --settings-test — 설정 파일의 복구·저장·초기화. test/flow.js(settings) 가 깨진 settings.json 을 미리 둔 프로필로 띄운다
  //   ① 깨진 파일 → 기본값으로 뜨고 원본은 settings.json.bad 로 남는다 (덮어쓰지 않는다)
  //   ② settings:set 으로 넣은 값이 파일에 남고, 범위 밖은 잘리고 모르는 키는 버린다  ③ settings:reset → 표시·소리는 기본값, AI 설정은 유지, 사도 하나
  if (argHas("--settings-test")) setTimeout(async () => {
    const fails = [], ok = (cond, msg) => { console.log(`SETTINGSTEST ${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) fails.push(msg); };
    const ud = app.getPath("userData"), file = path.join(ud, "settings.json");
    const onDisk = () => { ctx.flushSettings(); return JSON.parse(fs.readFileSync(file, "utf8")); };
    const { GLOBAL_DEFAULTS } = require("./settings-schema.js");
    const S = () => ctx.settings, c1 = () => S().characters[0].id;
    // ①
    ok(fs.existsSync(file + ".bad") && /^\{\{\{/.test(fs.readFileSync(file + ".bad", "utf8")), "① 깨진 원본이 settings.json.bad 로 남았다");
    ok(S().version === 2 && S().characters.length >= 1 && S().global.sound.master === GLOBAL_DEFAULTS.sound.master, `① 기본값으로 떴다 (사도 ${S().characters.length}, master=${S().global.sound.master})`);
    ok(onDisk().version === 2, "① 새 설정 파일이 정상 JSON 으로 쓰였다");
    // ② 저장·걸러내기 — settings:set 은 설정 창이 보내는 그 IPC. sender.id 0 은 어느 창도 아니다
    const fakeEvent = { sender: { id: 0 } };
    ipcMain.emit("settings:set", fakeEvent, { sound: { master: 0.3 }, ai: { screen: true, screenScope: "display" } });
    ipcMain.emit("settings:set", fakeEvent, { scale: 99, opacity: 0.5, nonsense: { a: 1 }, behavior: { hopChance: -5 } }, c1());
    let d = onDisk(); const ch = d.characters.find(c => c.id === c1());
    ok(d.global.sound.master === 0.3 && d.global.ai.screen === true && d.global.ai.screenScope === "display", `② 전역 값이 파일에 남았다 (master=${d.global.sound.master} screen=${d.global.ai.screen} scope=${d.global.ai.screenScope})`);
    ok(ch.opacity === 0.5 && ch.scale === S().characters[0].scale && ch.scale <= 3 && ch.scale !== 99, `② 범위 밖 scale=99 는 범위 안으로 잘리고 opacity=0.5 는 남았다 (scale=${ch.scale})`);
    ok(!("nonsense" in ch) && !("nonsense" in d.global) && (ch.behavior || {}).hopChance !== -5, `② 모르는 키는 파일에 없고 hopChance=-5 는 범위 안으로 (hopChance=${(ch.behavior || {}).hopChance})`);
    ipcMain.emit("settings:set", fakeEvent, { ai: { keys: { gemini: "x" } } });
    ok(!(onDisk().global.ai.keys || {}).gemini, "② settings:set 으로 온 ai.keys 는 버린다 (키는 ai:set-key 로만)");
    // ③ 초기화 — 하나 더 부르고 나서
    await ctx.addCharacter(); await new Promise(r => setTimeout(r, 500));
    const before = S().characters.length;
    ipcMain.emit("settings:reset"); d = onDisk();
    ok(before >= 2 && d.characters.length === 1 && d.characters[0].id === c1(), `③ 초기화 뒤 사도 ${before} → ${d.characters.length} (첫 사도 ${c1()} 유지)`);
    ok(d.global.sound.master === GLOBAL_DEFAULTS.sound.master && (d.characters[0].opacity === undefined || d.characters[0].opacity === 1), `③ 소리·표시는 기본값 (master=${d.global.sound.master} opacity=${d.characters[0].opacity})`);
    ok(d.global.ai.screen === true && d.global.ai.screenScope === "display", `③ AI 설정은 유지 (screen=${d.global.ai.screen} scope=${d.global.ai.screenScope})`);
    ok(!ctx.hasAssets(ctx.assetRoot) || ctx.instances.size === 1, `③ 화면의 사도도 하나 (${ctx.instances.size}${ctx.hasAssets(ctx.assetRoot) ? "" : " — 에셋 없는 환경, 건너뜀"})`);
    // ④ 연결 확인 버튼 — 확인 자체가 터져도 버튼이 다시 눌려야 하고(안 그러면 한 번 실패로 영영 못 누른다),
    //    실패 원문은 접힌 채로 따로 보여야 한다
    ctx.openSettings("ai");
    for (let i = 0; i < 60 && !(ctx.settingsWin && !ctx.settingsWin.isDestroyed()); i++) await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 1500));
    const js = (code) => ctx.settingsWin.webContents.executeJavaScript(code);
    ipcMain.removeHandler("ai:test");   // contextBridge 로 넘긴 host 는 얼려 있어 렌더러에서 못 바꾼다 — 메인 쪽에서 터뜨린다
    await js(`document.getElementById("ai-test").click(); true`);
    await new Promise(r => setTimeout(r, 800));
    let ui = await js(`({ disabled: document.getElementById("ai-test").disabled, out: document.getElementById("ai-test-out").textContent })`);
    ok(!ui.disabled && /마치지 못했어요/.test(ui.out), `④ 확인이 터져도 버튼이 다시 눌린다 (disabled=${ui.disabled}, "${ui.out.slice(0, 30)}")`);
    ipcMain.handle("ai:test", async () => ({ ok: false, error: "API 키가 올바르지 않습니다.", detail: "HTTP 401 invalid_api_key: 제공자 원문" }));
    await js(`document.getElementById("ai-test").click(); true`);
    await new Promise(r => setTimeout(r, 800));
    ui = await js(`({ disabled: document.getElementById("ai-test").disabled, out: document.getElementById("ai-test-out").firstChild.textContent, det: !!document.querySelector("#ai-test-out details.raw"), open: document.querySelector("#ai-test-out details.raw")?.open, raw: document.querySelector("#ai-test-out .rawtext")?.textContent || "" })`);
    ok(!ui.disabled && /API 키가 올바르지 않습니다/.test(ui.out) && !/HTTP 401/.test(ui.out), `④ 안내는 대화창과 같은 문장 ("${ui.out.slice(0, 30)}")`);
    ok(ui.det && !ui.open && /HTTP 401/.test(ui.raw), `④ 원문은 접힌 채 따로 (접힘=${!ui.open}, "${ui.raw.slice(0, 20)}")`);
    ctx.settingsWin.close();
    console.log(`SETTINGSTEST ${fails.length ? "FAILED " + fails.length : "ALL PASS"}`);
    app.exit(fails.length ? 1 : 0);
  }, 4000);

  // --extract-test — 에셋 추출기의 실패·취소·재시도. 진짜 파이썬 대신 SADO_EXTRACTOR 로 끼운 가짜(test/fake-extract.js)가
  // --steps 값을 시나리오로 읽는다: fail(오류 한 줄 뒤 종료 3) · hang(손자 프로세스를 하나 띄우고 멈춤) · ok(진행 몇 줄 뒤 종료 0)
  //   ① fail → 끝난 뒤 running=false, 로그에 [exit 3]  ② 곧바로 다시 시작할 수 있다(재시도)  ③ 도는 중 다시 시작 → "이미 추출 중"
  //   ④ hang 을 취소 → 파이썬뿐 아니라 그 밑의 손자 프로세스도 죽는다 (kill() 만 쓰면 adb·변환 일꾼이 남았다)  ⑤ 취소 뒤 재시도
  if (argHas("--extract-test")) setTimeout(async () => {
    const fails = [], ok = (cond, msg) => { console.log(`EXTRACTTEST ${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) fails.push(msg); };
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const logFile = path.join(app.getPath("userData"), "extract.log"), log = () => { try { return fs.readFileSync(logFile, "utf8"); } catch { return ""; } };
    const tail = () => JSON.stringify(log().trim().split("\n").pop());
    const until = async (f, ms = 8000) => { for (let i = 0; i < ms / 50; i++) { if (f()) return true; await sleep(50); } return f(); };
    const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    if (!process.env.SADO_EXTRACTOR) { console.log("EXTRACTTEST FAIL SADO_EXTRACTOR 가 없다 — npm run test:flow 로 돌린다"); app.exit(1); return; }
    const S = ctx.setup;
    // ①② 실패 뒤 재시도
    let r = S.startExtract({ steps: ["fail"] }); ok(r.ok, `① 시작 ${JSON.stringify(r)}`);
    ok(await until(() => !S.extractPid && /\[exit 3\]/.test(log())), `① 실패로 끝남 — running=${!!S.extractPid} 로그 끝=${tail()}`);
    ok(/치명적 오류 시나리오/.test(log()), "① 추출기의 오류 줄이 로그에 남았다");
    r = S.startExtract({ steps: ["ok"] }); ok(r.ok, `② 실패 직후 재시도 ${JSON.stringify(r)}`);
    ok(await until(() => !S.extractPid && /\[exit 0\]/.test(log())), `② 재시도가 정상 종료 — 로그 끝=${tail()}`);
    // ③④ 멈춘 추출기 취소 → 손자까지
    r = S.startExtract({ steps: ["hang"] }); ok(r.ok, `③ hang 시작 ${JSON.stringify(r)}`);
    const pyPid = S.extractPid;
    ok(await until(() => /"child":\d+/.test(log())), "④ 가짜 추출기가 손자 프로세스를 띄웠다(시험 전제)");
    const child = +(log().match(/"child":(\d+)/) || [])[1];
    ok(child && alive(child) && alive(pyPid), `④ 취소 전 — 추출기 ${pyPid} 손자 ${child} 살아 있음`);
    r = S.startExtract({ steps: ["ok"] }); ok(!r.ok && /이미/.test(r.error), `③ 도는 중 다시 시작 → ${JSON.stringify(r)}`);
    ipcMain.emit("assets:cancel");
    ok(await until(() => !S.extractPid, 10000), "④ 취소 뒤 running=false");
    ok(await until(() => !alive(pyPid) && !alive(child), 5000), `④ 취소 뒤 추출기 ${alive(pyPid) ? "살아 있음 ✗" : "죽음"} · 손자 ${alive(child) ? "살아 있음 ✗" : "죽음"}`);
    // ⑤ 취소 뒤 재시도
    r = S.startExtract({ steps: ["ok"] }); ok(r.ok, `⑤ 취소 뒤 재시도 ${JSON.stringify(r)}`);
    ok(await until(() => !S.extractPid && /\[exit 0\]/.test(log())), "⑤ 정상 종료");
    console.log(`EXTRACTTEST ${fails.length ? "FAILED " + fails.length : "ALL PASS"}`);
    app.exit(fails.length ? 1 : 0);
  }, 3000);
};
