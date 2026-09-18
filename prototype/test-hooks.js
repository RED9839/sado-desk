/* 개발·검사용 훅 — `--selftalk-test` 같은 실행 인자로 켜는 자동 점검. 제품 동작은 여기 없다.
 * main.js 의 상태는 ctx 의 getter 로 본다(값이 바뀌어도 따라간다). captureScreenFor 는 화면 시험이 감싸 쓰므로 setter 도 있다.
 *   require("./test-hooks.js")(ctx);
 */
const { app, BrowserWindow, ipcMain, screen } = require("electron");
const fs = require("fs"), path = require("path");
const Ai = require("./ai.js");
const Talk = require("./renderer/talk.js");
const argHas = (f) => process.argv.includes(f);
const argVal = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };

module.exports = function installTestHooks(ctx) {
  if (argHas("--hit-test")) setTimeout(() => {
    const id = ctx.settings.characters[0].id, inst = ctx.instances.get(id); const b = ctx.screenRect(inst.rect); const sx = b.x + b.width / 2, sy = b.y + b.height / 2;
    ctx.updateHitTarget(sx - ctx.geo.x, sy - ctx.geo.y);
    const ev = (type, button) => ipcMain.emit("hit-ev", null, { type, sx, sy, button, buttons: 0 }); // instance 없이 → hitFor 로 라우팅되는지
    console.log("HITTEST rect", JSON.stringify(b), "hitFor", ctx.hitFor, "shown", ctx.hitShown, "hitWin", ctx.hitWin ? JSON.stringify(ctx.hitWin.getBounds()) : null);
    ev("mousedown", 0); setTimeout(() => ev("mouseup", 0), 60);
    setTimeout(() => { ipcMain.emit("hit-ev", null, { instance: id, type: "mousedown", sx, sy, button: 2, buttons: 0 }); setTimeout(() => console.log("HITTEST menuWin", ctx.menuWin ? JSON.stringify(ctx.menuWin.getBounds()) : null), 1500); }, 1500);
  }, 6000);

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
};
