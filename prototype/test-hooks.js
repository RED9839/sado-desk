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

  // --chat-race-test — 대화 상태의 경쟁 네 가지를 재현하고 스스로 판정한다. 외부 AI 없이 돌리려면 SADO_AI_MOCK=1
  // (ai.js 의 모의 제공자: 150ms 마다 토큰, 취소 가능). npm run test:flow 가 이걸 새 프로필로 띄워 FAIL 이 있으면 실패로 끝낸다.
  //   ① 답하는 중 다른 사도로 옮김 → 앞 턴이 끊기고 어느 쪽에도 기록이 남지 않는다
  //   ② 정상 턴 → 기록 2줄
  //   ③ 답하는 중 '기록 지우기' → 턴이 끊기고 기록 0줄 (고치기 전엔 옛 기록이 되살아나 4줄)
  //   ④ A 를 열고 곧장 B 를 열기 → 초기화(Ai.status 대기)가 늦게 끝나도 창의 이름은 B (고치기 전엔 A 가 덮어썼다)
  //   ⑤ 화면 캡처 중 창 닫기 · ⑥ 캡처 중 다른 사도로 · ⑦ 캡처 중 '화면 보기' 끄기 → AI 요청이 시작되지 않는다 (⑧ 은 캡처가 그대로 끝나면 턴이 도는 대조군)
  //   ⑨ 답하는 중 창 닫고 다시 열기 → 끊긴 턴은 저장되지 않고, 새 창은 입력이 열려 있다
  //   ⑩ A→B→A 연속 열기 → 대상·이름 A  ·  ⑪ 같은 사도의 답이 오는 중 다시 열기 → 답이 끊기지 않고 창에 남는다
  if (argHas("--chat-race-test")) setTimeout(async () => {
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
    console.log(`RACETEST ${fails.length ? "FAILED " + fails.length : "ALL PASS"}`);
    app.exit(fails.length ? 1 : 0);
  }, 6000);

  // --stay-test — 대화창이 열려 있는 동안 그 사도가 제자리에 있는지(폴짝·점프 없음), 닫으면 다시 돌아다니는지. 에셋 필요(로컬)
  if (argHas("--stay-test")) setTimeout(async () => {
    const fails = [], ok = (cond, msg) => { console.log(`STAYTEST ${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) fails.push(msg); };
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const a = ctx.settings.characters[0].id, R = () => (ctx.instances.get(a) || {}).rect, x = () => R() && R().x + R().w / 2, y = () => R() && R().y + R().h;   // 발 위치(가운데·아래) — 대기 애니로 바운딩 박스가 흔들려도 덜 움직인다
    ctx.updateSettings({ behavior: { hopChance: 100, jumpChance: 0, idleMin: 0.5, idleMax: 1 } }, a);   // 쉬는 시간마다 반드시 폴짝
    await sleep(3000); if (x() === undefined) { console.log("STAYTEST FAIL 사도 위치가 없다(에셋 없음?)"); app.exit(1); return; }
    ctx.openChat(a);
    for (let i = 0, px = x(); i < 40; i++) { await sleep(500); if (Math.abs(x() - px) < 2) { if (++i >= 3) break; } else i = 0; px = x(); }   // 열 때 하던 폴짝은 끝까지 간다 — 1.5초 멈춘 뒤부터 잰다
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
  if (argHas("--monitor-test")) setTimeout(async () => {
    const fails = [], ok = (cond, msg) => { console.log(`MONTEST ${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) fails.push(msg); };
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const a = ctx.settings.characters[0].id, D = ctx.geo.displays;
    if (D.length < 2) { console.log("MONTEST FAIL 모니터가 둘 이상이어야 한다"); app.exit(1); return; }
    const R = () => (ctx.instances.get(a) || {}).rect, cx = () => R() && R().x + R().w / 2;
    const dispOf = (x) => D.findIndex(d => x >= d.x && x < d.x + d.w);
    ctx.updateSettings({ behavior: { hopChance: 100, jumpChance: 0, idleMin: 0.3, idleMax: 0.8, hopRange: 900 } }, a);   // 멀리, 자주 폴짝
    await sleep(3000); const d0 = dispOf(cx());
    { const want = D.findIndex(d => d.id === +ctx.settings.characters[0].monitor); if (want >= 0) ok(d0 === want, `⓪ 설정에 적힌 모니터에서 시작 (${d0} = ${want})`); else console.log(`MONTEST PASS ⓪ 설정에 모니터가 없어 ${d0}번에서 시작 (건너뜀)`); }
    // 히트 창이 보내는 마우스 이벤트를 흉내내 끌어다 놓는다 (화면 좌표)
    const ev = (type, x, y) => ipcMain.emit("hit-ev", { sender: { id: 0 } }, { instance: a, type, sx: x, sy: y, button: 0, buttons: type === "mouseup" ? 0 : 1 });
    const dragTo = async (tx, ty) => { const r0 = R(), sx = ctx.geo.x + r0.x + r0.w / 2, sy = ctx.geo.y + r0.y + r0.h / 2; ev("mousedown", sx, sy); await sleep(80); for (let i = 1; i <= 30; i++) { ev("mousemove", sx + (tx - sx) * i / 30, sy + (ty - sy) * i / 30); await sleep(30); } ev("mouseup", tx, ty); await sleep(2500); };
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
  }, 5000);

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
