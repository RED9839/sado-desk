/* AI 대화 창 제어 — main.js 에서 떼어 낸 것. 창·대상·요청 번호(chatSeq)·턴(스트림→저장→표정)·화면 보고 한마디·chat:* IPC 가 여기 있다.
 * 바깥 상태(설정·사도 위치·프로필·마스코트 창)는 ctx 로만 본다: main.js 가 getter 를 넘겨 주므로 값이 바뀌어도 따라간다.
 *   const CH = require("./chat.js")(ctx);  → { openChat, closeChat, chatTurn, screenTalk, win, for, busy, lastAt(get/set), touch }
 * 요청 번호 하나(chatSeq)가 초기화·캡처·스트림·완료 전송을 모두 지킨다 — 창을 열거나(대상 전환 포함) 닫으면 오르고,
 * 기다림이 끝난 뒤 chatLive(seq) 가 거짓이면 결과를 버린다. 저장은 파일을 다시 읽어 그 위에 얹는다(기록 지우기와 겹쳐도 옛 기록이 되살아나지 않게). */
const { app, BrowserWindow, ipcMain, screen } = require("electron");
const path = require("path");
const Ai = require("./ai.js");

module.exports = function createChat(ctx) {
  let chatWin = null, chatFor = null, chatBounds = null, chatAnchor = null, chatBusy = false, chatAbort = null, lastChatAt = 0;
  const chatReady = new WeakSet(); // did-finish-load 를 지난 대화창
  // 대화 요청 번호 — 창을 열거나(대상 전환 포함) 닫을 때마다 +1. 기다림이 있는 일(초기화의 Ai.status, 화면 캡처, 답 스트림)은
  // 시작할 때 번호를 쥐고, 기다림이 끝난 뒤 chatLive 로 아직 같은 요청인지 본다. 다르면 결과를 버린다 — 대상이 바뀌었거나 창이 닫힌 것
  let chatSeq = 0;
  const chatLive = (seq) => chatSeq === seq && chatWin && !chatWin.isDestroyed();
  const CHAT_W = 332;
  // 창은 열 때 사도의 머리 위에 자리를 잡고 그 뒤로는 움직이지 않는다. 사도를 따라다니게도 해 봤지만(v0.24.2 작업 중)
  // "어지럽다" — 대신 대화창이 열려 있는 동안 사도가 제자리에 있다(stay). 사용자가 끌어 옮긴 자리도 그대로
  function chatPlace(id) {
    if (!chatWin || chatWin.isDestroyed() || !ctx.geo) return;
    const inst = ctx.instances.get(id); const r = inst && inst.rect;
    if (!chatAnchor || chatAnchor.id !== id) { if (!r) return; chatAnchor = { id, cx: Math.round(ctx.geo.x + r.x + r.w / 2), top: Math.round(ctx.geo.y + r.y) }; }
    const h = chatBounds ? chatBounds.height : 220;
    const sx = chatAnchor.cx - Math.round(CHAT_W / 2), sy = chatAnchor.top - h + 6;
    const d = screen.getDisplayNearestPoint({ x: sx + CHAT_W / 2, y: sy + h / 2 }).workArea;
    const b = { x: Math.min(Math.max(sx, d.x), d.x + d.width - CHAT_W), y: Math.max(d.y, sy), width: CHAT_W, height: h };
    if (!chatBounds || b.x !== chatBounds.x || b.y !== chatBounds.y || b.height !== chatBounds.height) { chatWin.setBounds(b); chatBounds = b; }
  }
  async function chatInitPayload(id) {
    const st = await Ai.status(ctx.settings.global.ai);
    const prof = ctx.chatProfile(id);
    const prov = st.resolved ? `${st.resolved}${st.resolved === "ollama" ? " · " + Ai.merge(ctx.settings.global.ai).ollama.model : ""}` : "";
    return { who: prof ? prof.ko : "사도", prov, ready: !!st.resolved, history: ctx.settings.global.ai.memory !== false ? Ai.loadHistory(app.getPath("userData"), id) : [] };
  }
  function openChat(id, opt = {}) {
    id = id || ctx.settings.characters[0].id;
    const same = chatWin && !chatWin.isDestroyed() && chatFor === id;   // 이미 그 사도의 창
    // 같은 사도의 답이 오는 중에 다시 열면(단축키) 창만 앞으로 — 다시 초기화하면 로그가 지워지고 오던 조각이 버려진다
    if (same && chatBusy) { if (!opt.quiet) { chatWin.show(); chatWin.focus(); } return; }
    // 다른 사도에게로 옮기는데 앞 사도의 답이 아직 오는 중이면 끊는다 — 안 끊으면 그 답이 새 사도의 말처럼 창에 찍혔다(코드 리뷰 P2)
    if (chatFor && chatFor !== id && chatBusy && chatAbort) chatAbort.abort();
    // 대화창이 열려 있는 동안 그 사도는 제자리에 (폴짝·점프 안 함). 창이 사도를 따라다니게도 해 봤지만 어지럽다고 해서
    if (chatFor && chatFor !== id) ctx.sendMascot(chatFor, "stay", false);
    ctx.sendMascot(id, "stay", true);
    chatFor = id; chatBounds = null; chatAnchor = null;
    const seq = same ? chatSeq : ++chatSeq;   // 같은 사도면 요청 번호를 그대로 — 진행 중인 화면 캡처가 살아 있게
    // 초기화 정보(제공자 상태·기록)는 Ai.status 를 기다린다. A 를 열고 곧장 B 를 열면 A 의 것이 늦게 도착해 이름·기록은 A,
    // 실제 대상은 B 가 되던 문제(코드 리뷰) — 기다린 뒤 아직 같은 요청인지 본다
    const send = async () => {
      const w0 = chatWin; if (!w0 || w0.isDestroyed()) return;
      if (!chatReady.has(w0)) await new Promise(r => w0.webContents.once("did-finish-load", r));   // 창이 아직 뜨는 중이면 기다린다 — 로드 전에 보낸 메시지는 사라진다 (isLoading 은 loadFile 직후 잠깐 false 일 수 있어 우리 표시로 본다)
      const payload = await chatInitPayload(id);
      if (!chatLive(seq) || chatWin !== w0) return;   // 기다리는 동안 대상이 바뀌었거나 창이 닫혔다
      w0.webContents.send("chat:init", payload); chatPlace(id); if (opt.quiet) w0.showInactive(); else { w0.show(); w0.focus(); }
    };
    if (chatWin && !chatWin.isDestroyed()) { send(); return; }
    chatWin = new BrowserWindow({
      x: 0, y: 0, width: CHAT_W, height: 220, show: false, transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true,
      resizable: false, movable: true, hasShadow: false, backgroundColor: "#00000000",
      webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: false },
    });
    chatWin.setAlwaysOnTop(true, "screen-saver");
    chatWin.loadFile(path.join(__dirname, "renderer", "chat.html"));
    chatWin.webContents.on("console-message", (ev) => console.log(`[chat:${ev.level}] ${ev.message}`));
    const w = chatWin; ctx.trackBounds(w);
    // 창을 닫으면 진행 중인 턴은 끊는다. chatBusy 는 그 턴의 finally 가 스스로 내린다 (여기서 내리면 다음 턴과 엇갈린다)
    w.on("closed", () => { if (chatWin !== w) return; if (chatFor) ctx.sendMascot(chatFor, "stay", false); chatSeq++; chatWin = null; chatFor = null; chatBounds = null; chatAnchor = null; if (chatAbort) chatAbort.abort(); });
    w.webContents.on("render-process-gone", (_e, d) => { if (ctx.noteCrash) ctx.noteCrash("대화창", d.reason, d.exitCode); if (!w.isDestroyed()) w.close(); }); // 다음 '말 걸기'가 새 창을 만든다
    w.webContents.once("did-finish-load", () => chatReady.add(w));
    send();   // 로드를 기다리는 건 send 안에서 한다
  }
  function closeChat() { if (chatWin && !chatWin.isDestroyed()) chatWin.close(); }
  const chatSend = (ch, payload) => { if (chatWin && !chatWin.isDestroyed()) chatWin.webContents.send(ch, payload); };
  // 턴 안에서 쓰는 전송 — 그 턴의 요청 번호가 아직 살아 있을 때만. 대상을 바꾸거나 창을 닫은 뒤 늦게 온 조각·완료가 남의 창에 찍히지 않게
  const chatSendFor = (seq, ch, payload) => { if (chatLive(seq)) chatSend(ch, payload); };
  // 한 턴 실행: history + user → 답변 스트리밍 → 기록 저장 → 표정/보이스
  async function chatTurn(id, userText, opts = {}) {
    if (chatBusy) { if (userText) chatSend("chat:done", { error: "아직 말하는 중이에요. 잠깐 뒤에 다시 보내 주세요." }); return null; }
    chatBusy = true; lastChatAt = Date.now(); const seq = chatSeq;
    const ud = app.getPath("userData"), ai = ctx.settings.global.ai, prof = ctx.chatProfile(id);
    const load = () => (ctx.settings.global.ai.memory !== false ? Ai.loadHistory(ud, id) : []);   // 저장 여부는 그때그때의 설정으로 (아래 저장도 같다)
    const ctl = chatAbort = new AbortController(); let timedOut = false, partial = "";
    // 제공자가 답을 시작만 하고 멎으면(스트림이 열린 채 조용) chatBusy 가 영영 남아 대화·혼잣말이 전부 막혔다. 90초면 끊는다
    const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, 90_000);
    ctx.sendMascot(id, "announce", { hold: 20000, sound: false }); // 대답하는 동안 제자리에
    try {
      // 준비(기록 읽기·메시지 만들기)도 이 안에서 한다 — 밖에서 터지면 finally 를 못 지나 chatBusy 가 잠긴 채 남았다
      let hist = load();
      // 먼저 말 걸 때는 모델에게 보여 줄 기록을 최근 두 마디로 줄인다. 제 지난 답이 길게 쌓여 있으면 모델이 그 길이를
      // 따라가 회차마다 답이 길어졌다(실측 1회 77자 → 3회 141자, 120자 초과 4건 → 100건). 저장은 아래에서 파일을 다시 읽으니 줄지 않는다
      if (!userText && !opts.image) hist = hist.slice(-2);
      // 사용자가 보낸 말이 없으면(먼저 말 걸기) 침묵을 알리는 한 줄을 붙인다. 안 붙이면 기록 끝이 assistant 라
      // normalizeMessages 가 "(계속)" 을 붙이고, 모델은 먼저 말을 거는 대신 자기 혼잣말에 이어 대답한다
      const msgs = [...hist.map(m => ({ role: m.role, text: m.text })),
        (userText || opts.image)
          ? { role: "user", text: userText || "(사용자의 화면을 본다)", ...(opts.image ? { image: opts.image } : {}) }
          : { role: "user", text: "(사용자가 조용히 있다)" }];
      const now = new Date();
      const extra = `지금은 ${now.getMonth() + 1}월 ${now.getDate()}일 ${["일", "월", "화", "수", "목", "금", "토"][now.getDay()]}요일 ${now.getHours()}시 ${now.getMinutes()}분.` + (opts.extra ? "\n" + opts.extra : "");
      const r = await Ai.chat(ai, prof, msgs, (d) => { partial += d; chatSendFor(seq, "chat:token", { delta: d }); }, { extra, signal: ctl.signal });
      // 저장은 시작할 때 읽어 둔 hist 가 아니라 지금 파일 위에 얹는다 — 답을 만드는 사이 '기록 지우기'로 파일이 비었으면 이번 한 마디만 남고
      // (옛 기록이 되살아나던 문제), 먼저 말 걸 때 두 마디로 줄인 것이 저장까지 줄이지 않는다 (줄이면 먼저 말 걸 때마다 기록이 3줄로 잘렸다)
      const saved = [...load(), ...(userText ? [{ role: "user", text: userText, t: Date.now() }] : []), { role: "assistant", text: r.text, t: Date.now() }];
      const aiNow = ctx.settings.global.ai;   // 답하는 사이에 '기록 저장'을 껐을 수 있다 — 저장 직전의 설정을 따른다
      if (aiNow.memory !== false) Ai.saveHistory(ud, id, saved, aiNow.maxTurns || ai.maxTurns || 12);
      if (opts.say) chatSendFor(seq, "chat:say", { text: r.text }); else chatSendFor(seq, "chat:done", { text: r.text, emotion: r.emotion });
      ctx.sendMascot(id, "emote", { mood: r.emotion, role: "speak", pose: Math.min(15000, 3000 + r.text.length * 90), hold: 15000 });
      console.log(`chat[${id}] ${r.provider}/${r.model} → ${r.text.length}자 [${r.raw}]`);   // 본문은 찍지 않는다 — app.log 에 남는다
      return r;
    } catch (e) {
      const aborted = ctl.signal.aborted || e.name === "AbortError" || e.name === "TimeoutError"; // 창 닫기(사용자) 또는 90초 시한. Gemini 재시도 대기 중이면 "취소됨" Error 로 온다
      const msg = aborted ? (timedOut ? "AI가 오랫동안 답하지 않아 중단했습니다." : "") : e.message === "no-provider" ? "사용할 수 있는 AI 서비스가 없습니다. 설정 → AI 대화에서 Ollama를 연결하거나 API 키를 저장해 주세요." : Ai.explainError(e);
      // 끊긴 턴에도 chat:done 은 보낸다 — 렌더러는 이걸 받아야 입력칸을 다시 연다. 창을 닫아 끊은 경우엔 받을 창이 없어 그냥 사라진다
      chatSendFor(seq, "chat:done", msg ? { error: msg } : { text: partial });
      console.log("chat error:", timedOut ? "timeout(90s)" : e.message);
      return null;
    } finally { clearTimeout(timer); if (chatAbort === ctl) { chatBusy = false; chatAbort = null; } lastChatAt = Date.now(); } // 이 턴의 것일 때만 내린다
  }
  // 혼자 화면 보고 한마디 (대화창에 표시). userText 있으면 그 말에 화면을 붙여 답함
  async function screenTalk(id, userText) {
    const chatOpen = chatWin && !chatWin.isDestroyed() && chatFor === id;
    if (!ctx.screenAllowed()) { if (!chatOpen) openChat(id); const seq = chatSeq; setTimeout(() => chatSendFor(seq, "chat:done", { error: "화면 캡처가 허용되지 않았습니다. 설정 → AI 대화 → '화면 캡처 사용 허용'을 켜 주세요. 캡처 이미지는 선택한 AI 서비스로 전송됩니다." }), chatOpen ? 0 : 1200); return; }
    if (!chatOpen) openChat(id, { quiet: !userText });
    const seq = chatSeq;   // 캡처를 기다리는 사이 창을 닫거나 다른 사도로 옮기면 여기서 멈춘다 — AI 요청을 시작하지 않는다(코드 리뷰 P2)
    ctx.sendMascot(id, "emote", { mood: "", role: "listen", pose: 4000, hold: 12000 }); // 화면을 살피는 포즈
    // 창을 막 열었으면 렌더러가 뜨기 전이라 바로 보낸 오류는 사라진다 — 위의 '꺼져 있어요' 와 같은 간격을 둔다
    let image; try { image = await ctx.captureScreenFor(id); } catch (e) { setTimeout(() => chatSendFor(seq, "chat:done", { error: e.message }), chatOpen ? 0 : 1200); return; }
    if (!chatLive(seq) || !ctx.screenAllowed()) { console.log(`screenTalk[${id}] 캡처 뒤 취소 — ${chatLive(seq) ? "화면 보기가 꺼짐" : "창이 닫히거나 대상이 바뀜"}`); return; }
    await chatTurn(id, userText || "", { image, say: !userText, extra: "사용자의 화면 스크린샷을 첨부했다. 지금 사용자가 무엇을 하고 있는지 알아보고, 네 성격대로 한두 문장으로 반응하라(감상·놀림·응원·질문 등)." });
  }
  ipcMain.on("chat:send", (_e, text, withScreen) => { if (!chatFor || typeof text !== "string" || !text.trim()) return; if (withScreen) screenTalk(chatFor, text.trim().slice(0, 2000)); else chatTurn(chatFor, text.trim().slice(0, 2000)); });
  ipcMain.on("chat:screen", (e, id) => screenTalk(id || ctx.instanceOf(e.sender) || ctx.settings.characters[0].id));
  ipcMain.on("chat:close", () => closeChat());
  ipcMain.on("chat:clear", () => { if (!chatFor) return; Ai.clearHistory(app.getPath("userData"), chatFor); if (chatBusy && chatAbort) chatAbort.abort(); }); // 만들던 답도 끊는다. 끊기기 전에 답이 다 왔어도 저장은 빈 파일 위에 얹는다(chatTurn)
  ipcMain.on("chat:resize", (_e, h) => { h = ctx.heightOf(h, 40); if (h === null) return; if (chatWin && !chatWin.isDestroyed()) { const d = screen.getDisplayNearestPoint(chatBounds ? { x: chatBounds.x, y: chatBounds.y } : screen.getCursorScreenPoint()).workArea; chatBounds = { ...(chatBounds || { x: 0, y: 0, width: CHAT_W }), height: Math.min(h, d.height) }; chatPlace(chatFor); } });
  ipcMain.on("chat:open", (e, id) => openChat(id || ctx.instanceOf(e.sender) || ctx.settings.characters[0].id));

  return {
    openChat, closeChat, chatTurn, screenTalk,
    get win() { return chatWin; }, get for() { return chatFor; }, get busy() { return chatBusy; },
    get lastAt() { return lastChatAt; }, set lastAt(v) { lastChatAt = v; }, touch() { lastChatAt = Date.now(); },
  };
};
