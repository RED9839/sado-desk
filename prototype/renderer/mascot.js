/* 사도 데스크 마스코트 — 렌더러(spine-webgl 4.1). 한 창에 캐릭터 여러 명.
 * 좌표계: 월드 = 창 픽셀, 원점 왼쪽 아래(y 위로 증가). 화면 y = H - 월드 y.
 * 상태: spawn → idle ⇄ hop(이동) / jump / react, 마우스로 drag → thrown → land → idle
 * 캐릭터 형태(S.mode): "minimi" = 스틱 미니미(공용 스켈레톤 + 스킨), "sd" = 사도 상세 화면 스탠딩 Spine(캐릭터별 skel), "ingame" = 전투·마이홈 SD(Idle/Move/Spawn/Victory/Attack).
 *   두 형태는 같은 상태머신을 쓰고, 애니 이름 매핑(ANIM)과 이동 방식만 다르다.
 * 구조: 바깥 = 창 하나에 공유되는 것(WebGL 컨텍스트, 미니미 SkeletonData, 보이스 색인, 모니터 기하, 프레임 루프).
 *       Mascot(id, S) = 캐릭터 한 명의 모든 상태(슬롯·상태머신·마우스·보이스). 캐릭터마다 히트 창이 따로 있어 마우스 이벤트는 id로 라우팅.
 *       (예전엔 캐릭터마다 모니터 전체 크기의 투명 창을 하나씩 띄웠는데, 투명 창 합성 비용이 창 수에 비례해 두 명부터 렉이 걸림 → 창 하나로 합침)
 * 설정(S)은 메인이 관리. 여기서 바꾸면 patchSettings()로 즉시 적용 + 메인에 전송(캐릭터 id 포함), 메인은 다른 창에 브로드캐스트.
 */
(() => {
  const canvas = document.getElementById("c");
  const hud = document.getElementById("hud");
  const host = window.host;

  // ---- 미니미 애니 ----
  const MINI = {
    idleActs: ["Idle1_1", "Idle1_2", "Idle2_1", "Idle2_2", "Idle2_3", "Idle2_4", "Idle2_5", "Idle3_5", "Idle3_6", "Idle3_7", "Idle", "Act1_1", "Act2_1", "Act3_1", "Act4_1", "Act5_1", "Act6_1"],
    idleQuiet: ["Idle1_1", "Idle1_2", "Idle"],
    idleLoop: new Set(["Idle1_1", "Idle1_2", "Idle", "Idle2_1"]),
    move: "Idle2_1", jump: ["Jump1", "Jump2", "Jump3", "Jump5", "Jump6"], spawn: ["Spawn1", "Spawn2"],
    react: ["Success", "Idle3_7", "Act6_1", "Idle2_4"], land: "Idle2_3", drag: "Idle1_1", hold: "Idle1_1",
    moveSpeed: 110, // px/s (scale 0.5 기준 ×2)
  };
  // ---- SD(스탠딩) 애니 — 캐릭터마다 구성이 달라서(에르핀 Angry 16개, 앨리스는 Move 없음) 로드 시 접두어로 자동 분류 ----
  function sdPools(data) {
    const all = data.animations.map(a => ({ n: a.name, d: a.duration }));
    const by = (prefixes, maxDur = 4) => all.filter(a => prefixes.some(p => a.n.startsWith(p + "_")) && a.d <= maxDur).map(a => a.n);
    const idles = by(["Idle"], 10);
    // 대기 중 스스로 하는 잔동작: 감정이 튀지 않는 것들(화남·슬픔·놀람은 클릭/착지/메뉴로만). 보이스는 motion-voice.js 매핑으로 카테고리 매칭
    const acts = by(["Happy", "Smile", "Laugh", "Shy", "Blank", "Proud", "Clean", "Try", "Taunt", "Talk", "Dance", "Sing", "Eat", "Think", "Thinking", "Serious", "Curious", "Question", "Tired", "Sleepy", "Bbang", "Gao", "Ignore", "Melong", "Merong", "Joke"], 3.5);
    return {
      idleActs: [...idles, ...idles, ...acts], idleQuiet: idles.length ? idles : ["Idle_1"], idleLoop: new Set(idles),
      move: ["Move_1", "Move_2", "Walk_1"].find(n => data.findAnimation(n)) || null, // 없으면 절차적 폴짝 이동
      jump: [], spawn: [],
      react: [...by(["Happy", "Smile", "Laugh", "Proud", "Surprise"], 3), ...by(["Shy", "Taunt", "Excited"], 3)],
      land: ["Groggy_1", "Surprise_1", "Panic_1", "Angry_1", "Smash_End_1"].find(n => data.findAnimation(n)) || null,
      drag: ["Panic_1", "Surprise_1", "Touch_Idle"].find(n => data.findAnimation(n)) || null, // 들려 있을 때
      // 게임 교감 4종 (보이스 STT + 나무위키 대사표로 확인, docs/05-보이스-카탈로그.md):
      //  볼 당기기 = Touch_Idle(누르는 동안 볼 늘어남) → Touch_End + touch1_x 대사("당기지 마!")   쓰다듬기 = Pat_Idle → Pat_End + touch2_x 대사("더 쓰다듬으라고")
      //  꿀밤 = Smash_End + dutchrubend(1=맞는 소리, 2=대사 "머리 때리지 마!")                     간지럽히기 = Tickle_Idle → Tickle_End + ticklestart/tickleduring(웃음)
      touchIdle: data.findAnimation("Touch_Idle") ? "Touch_Idle" : null, touchEnd: data.findAnimation("Touch_End") ? "Touch_End" : null,
      patIdle: data.findAnimation("Pat_Idle") ? "Pat_Idle" : null, patEnd: data.findAnimation("Pat_End") ? "Pat_End" : null,
      tickleIdle: ["Tickle_Idle_1", "Tickle_Idle"].find(n => data.findAnimation(n)) || null, tickleEnd: data.findAnimation("Tickle_End") ? "Tickle_End" : null,
      smash: ["Smash_End_1", "Smash_End"].filter(n => data.findAnimation(n)),
      hold: idles[0] || all[0]?.n, moveSpeed: 90, hopHeight: 22,
      moods: moodPools(all),
    };
  }
  // 표정 고정(스토리 표정 8종: 기본·미소·분노·슬픔·행복·냠냠·삐짐·놀람) — 애니를 한 번 재생하고 마지막 프레임에서 멈춰 '스탠딩'처럼 둔다.
  //   미소 = Happy_1(가벼운 웃음)·Smile, 행복 = 그 밖의 Happy·Laugh·Dance. 없는 캐릭터(크레페 Sulky/Surprise 없음)는 비슷한 감정으로 대체
  const MOOD_ORDER = ["smile", "anger", "sad", "happy", "eat", "sulky", "surprise"];
  function moodPools(all) {
    const by = (re, maxDur = 4) => all.filter(a => re.test(a.n) && a.d <= maxDur).map(a => a.n);
    const first = (...cands) => cands.find(c => c.length) || [];
    const happy = by(/^Happy_\d+$/), happyRest = happy.filter(n => n !== "Happy_1");
    return {
      smile: first(by(/^Smile_/), happy.slice(0, 1), by(/^Shy_/)),
      happy: first(happyRest, by(/^(Laugh|Dance|Nicesmile|Excited)_/), happy),
      anger: first(by(/^(Angry|Mad)_/), by(/^Upset_/)),
      sad: first(by(/^Sad_/), by(/^(Cry|Sorry)_/)),
      eat: first(by(/^Eat_/), by(/^(Hungry|Bread|Drink)_/)),
      sulky: first(by(/^Sulky_/), by(/^(Upset|Mad|Serious)_/), by(/^Angry_\d+$/).slice(0, 1)),
      surprise: first(by(/^(Surprise|Surprised|Shock)_/), by(/^Panic_/), by(/^Groggy_/)),
    };
  }
  const SD = { idleActs: [], idleQuiet: ["Idle_1"], idleLoop: new Set(["Idle_1"]), move: null, jump: [], spawn: [], react: [], land: null, drag: null, hold: "Idle_1", moveSpeed: 90, hopHeight: 22, moods: {} };
  // ---- 인게임 SD(전투·마이홈) 애니: Idle / Move / Spawn / Victory / Groggy / Attack / Skill / Ultimate ... 414/416 세트에 Move 있음 ----
  function ingamePools(data) {
    const hasA = (n) => !!data.findAnimation(n);
    const dur = (n) => data.findAnimation(n)?.duration ?? 99;
    const shortish = (n) => hasA(n) && dur(n) <= 4;
    return {
      idleActs: ["Idle", "Idle", "Idle", "Victory", "EasterEgg_Idle", "Attack1_1"].filter(shortish).concat(["Idle"]),
      idleQuiet: ["Idle"], idleLoop: new Set(["Idle", "EasterEgg_Idle"]),
      move: hasA("Move") ? "Move" : null, jump: [], spawn: hasA("Spawn") ? ["Spawn"] : [],
      react: ["Victory", "Attack1_1", "Attack2_1", "Skill1_1", "EasterEgg_Victory"].filter(shortish),
      land: ["Groggy", "Hit", "Die"].find(hasA) || null, drag: ["Groggy", "Idle"].find(hasA) || null,
      hold: "Idle", moveSpeed: 120, hopHeight: 18, moods: {},
    };
  }
  // SD 배율: 스탠딩·인게임 스켈레톤은 같은 단위(에르핀 Head 본 y=429 동일)라 바운딩 박스로 맞추지 않고 단위→픽셀 고정 배율을 쓴다.
  // 박스 기준이면 지팡이·머리장식 크기에 따라 몸 크기가 달라져 혼합 모드에서 미스매치가 난다. scale 0.5 → 0.4px/unit (에르핀 ≈ 283px)
  const SD_UNIT = 0.8;
  const HIDE_SLOTS = new Set(["Background", "테두리", "대성공"]);           // 미니미: 게임 UI용 프레임/뱃지
  const HIDE_SD_SLOTS = /^(CommonShadow|Shadow|Point_Shadow|Ground|Floor)$/i; // SD: 발밑 바닥 그림자 (바운딩 바닥을 36유닛 내려 정렬·크기를 틀어놓음)
  const GRAVITY = 2600, WALL_MARGIN = 20;
  const IMAGE_FACES = -1;       // 미니미 원본 그림은 왼쪽을 본다 → 오른쪽(facing=+1)으로 갈 때 미러
  const MINI_MATCH = 0.78;

  // ---- 모션 ↔ 보이스 매핑은 renderer/motion-voice.js (node 감사 도구와 공유) ----
  const voiceCatsFor = (anim) => MotionVoice.voiceCatsFor(anim);

  // ================= 창 공유 상태 =================
  let cfg = null, ctx, renderer;
  let W = 0, H = 0;
  // ---- 모니터 기하 (창 기준, 월드 y는 위로 증가) ----
  // geoD: [{x0,x1, floor(월드y), top(월드y)}] — floor = 작업표시줄 위, top = 모니터 상단. 창이 작업표시줄까지 덮으면 floor 아래 영역은 작업표시줄 위에 그려진다.
  let geoD = [];
  function setGeo(g) {
    W = g.w; H = g.h; canvas.width = W; canvas.height = H;
    geoD = g.displays.map(d => ({ x0: d.x, x1: d.x + d.w, floor: H - d.floor, top: H - d.top, primary: d.primary }));
    for (const mas of mascots.values()) mas.onGeo();
  }
  function dispAt(x) { let best = null, bd = 1e9; for (const d of geoD) { const dd = x < d.x0 ? d.x0 - x : x > d.x1 ? x - d.x1 : 0; if (dd < bd) { bd = dd; best = d; } } return best; }
  const floorAt = (x) => (dispAt(x) || { floor: 0 }).floor;
  const topAt = (x) => (dispAt(x) || { top: H }).top;
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const deepMerge = (b, p) => { const o = { ...b }; for (const [k, v] of Object.entries(p || {})) o[k] = isObj(v) && isObj(b[k]) ? deepMerge(b[k], v) : v; return o; };
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // ---- 공유 에셋 ----
  let miniData = null;          // 미니미 SkeletonData (418 스킨) — Skeleton 인스턴스는 캐릭터마다
  let voiceIndex = {};          // hero → skin("base"|"skinN") → category → [파일]
  const clips = { sfx: {} };
  function voiceSetFor(skinName) {
    const mm = skinName.replace(/^Mini_/, "").match(/^(.*?)(Skin\d+)?$/);
    const hero = mm[1].toLowerCase(), skin = mm[2] ? mm[2].toLowerCase() : "base";
    const h = voiceIndex[hero] || {};
    // 스킨 묶음은 스킨 전용 파일(X_skinN)만 들고 있다 → 같은 이름의 base 파일(X)만 대체하고 나머지 base(예: dutchrubend1 맞는 소리)는 유지
    const cats = {}; for (const [c, l] of Object.entries(h.base || {})) cats[c] = [...l];
    for (const [c, l] of Object.entries(h[skin] || {})) {
      if (skin === "base") continue;
      const stems = new Set(l.map(f => f.replace(/_skin\d+(?=\.ogg$)/, "")));
      cats[c] = [...(cats[c] || []).filter(f => !stems.has(f)), ...l];
    }
    // touch 파일은 두 묶음: touch1[_n] = 볼 당기기 대사(친밀도 3단계), touch2[_n] = 쓰다듬기 대사. 스킨 전용(_skinN)은 index가 이미 스킨 키로 분리해 둠
    if (cats.touch) { cats.cheek = cats.touch.filter(f => /touch1(_\d+)?(_skin\d+)?\.ogg$/.test(f)); cats.pat = cats.touch.filter(f => /touch2(_\d+)?(_skin\d+)?\.ogg$/.test(f)); }
    return { hero: voiceIndex[hero] ? hero : null, skin, cats, base: h.base || {} };
  }
  const countVoices = (vs) => Object.values(vs.cats).reduce((n, l) => n + l.length, 0);
  function loadImage(src) { return new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = src; }); }
  // 아틀라스 텍스처 로드. pma:false 아틀라스는 업로드 시 프리멀티플라이해서 PMA 백버퍼와 맞춘다 (가장자리 흰 테 방지)
  async function loadAtlas(atlasPath, dir) {
    const atlas = new spine.TextureAtlas(host.readText(atlasPath));
    const textures = [];
    for (const page of atlas.pages) {
      const img = await loadImage(`file:///${dir}/${page.name}`);
      ctx.gl.pixelStorei(ctx.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, page.pma ? 0 : 1);
      const tex = new spine.GLTexture(ctx, img); textures.push(tex);
      ctx.gl.pixelStorei(ctx.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
      page.setTexture(tex);
    }
    return { atlas, textures };
  }
  // ---- SD(스탠딩) 에셋 찾기: 사이트 HD 우선, 없으면 게임 추출본, 스킨 전용 없으면 기본 ----
  function resolveSD(skinName) {
    const mm = skinName.replace(/^Mini_/, "").match(/^(.*?)(?:Skin(\d+))?$/);
    const hero = mm[1], skinNo = mm[2];
    const st = cfg.standing || { hd: {}, game: {} };
    const tryHD = (id) => { const h = st.hd[hero.toLowerCase()]; if (!h) return null; const real = h.ids.find(x => x.toLowerCase() === id.toLowerCase()); return real ? { src: "hd", dir: `${cfg.assetRoot}/standing-hd/${h.dir}`, stem: real } : null; };
    const tryGame = (name) => { const g = st.game[name.toLowerCase()]; return g ? { src: "game", dir: `${cfg.assetRoot}/standing/${g}`, stem: g } : null; };
    return (skinNo && (tryHD(hero + "Skin" + skinNo) || tryGame(hero + "skin" + skinNo))) || tryHD(hero) || tryGame(hero) || null;
  }
  function resolveIngame(skinName) {
    const mm = skinName.replace(/^Mini_/, "").match(/^(.*?)(?:Skin(\d+))?$/);
    const hero = mm[1].toLowerCase(), skinNo = mm[2];
    const ig = (cfg.standing && cfg.standing.ingame) || {};
    const hit = (skinNo && ig[hero + "skin" + skinNo]) || ig[hero];
    return hit ? { src: "ingame", dir: `${cfg.assetRoot}/ingame/${hit}`, stem: hit } : null;
  }
  const sdAvailable = (skinName) => ({ standing: !!resolveSD(skinName), ingame: !!resolveIngame(skinName) });

  // ---- 캐릭터 레지스트리 ----
  const mascots = new Map(); // id → Mascot
  const firstMascot = () => mascots.values().next().value || null;
  const debugOn = () => { const f = firstMascot(); return !!(f && f.S.display.debug); };

  host.on("config", async (c) => { cfg = c; try { await init(); } catch (e) { console.error("init 실패", e && (e.stack || e.message || e)); } });
  host.on("settings", (views) => sync(views));
  host.on("geo", (g) => setGeo(g));
  host.on("cursor", ({ x, y }) => { for (const mas of mascots.values()) mas.hover(x, y); });
  host.on("hit-mouse", (ev) => { const mas = mascots.get(ev.instance); if (mas && ev.type !== "mouseleave") mas.onMouse(ev); });
  host.on("mascot", (id, cmd, arg) => { const mas = mascots.get(id) || firstMascot(); if (!mas) return; if (cmd === "play") mas.playCmd(arg); else if (cmd === "respawn") mas.spawn(); else if (cmd === "preview") mas.preview(arg); else if (cmd === "announce") mas.announce(arg); else if (cmd === "emote") mas.emote(arg); else if (cmd === "meet") mas.meet(arg); else if (cmd === "logstate") mas.logState(arg); });
  window.addEventListener("contextmenu", (e) => e.preventDefault());

  // 메인이 내려준 캐릭터 뷰 목록과 맞추기: 새 id → 생성, 없어진 id → 제거, 있는 것 → 설정 적용
  async function sync(views) {
    const ids = new Set(views.map(v => v.id));
    for (const [id, mas] of [...mascots]) if (!ids.has(id)) { mas.dispose(); mascots.delete(id); }
    for (const v of views) {
      const mas = mascots.get(v.id);
      if (mas) mas.applySettings(v);
      else { const nm = Mascot(v.id, v); mascots.set(v.id, nm); await nm.start(); }
    }
    hud.style.display = debugOn() ? "block" : "none";
  }

  async function init() {
    setGeo(cfg.geo);
    ctx = new spine.ManagedWebGLRenderingContext(canvas, { alpha: true, premultipliedAlpha: true, antialias: true });
    renderer = new spine.SceneRenderer(canvas, ctx, true);

    const root = `${cfg.assetRoot}/minimi`;
    const { atlas } = await loadAtlas(`${root}/minimi.atlas`, root);
    miniData = new spine.SkeletonBinary(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(host.readBytes(`${root}/minimi.skel`));

    KO.load(cfg.dataRoot || cfg.assetRoot);
    try { voiceIndex = JSON.parse(host.readText(`${cfg.assetRoot}/voice/index.json`)); } catch (e) { console.warn("voice index 없음", e); }
    for (const n of ["jump01", "jump02"]) clips.sfx[n] = `file:///${cfg.assetRoot}/sfx/${n}.wav`;

    await sync(cfg.characters);
    console.log(`MASCOT ready chars=${[...mascots.keys()].join(",")} window=${W}x${H}`);
    host.loaded(buildCatalog());
    requestAnimationFrame(loop);
    if (cfg.selftest) firstMascot()?.selftest();
    if (cfg.moodTest) firstMascot()?.moodTest();
    if (cfg.ingameTest) firstMascot()?.ingameTest();
  }

  function buildCatalog() {
    const slotIndex = miniData.findSlot("Minimi").index;
    const skins = [];
    for (const sk of miniData.skins) {
      if (sk.name === "default") continue;
      let region = null;
      for (const e of sk.getAttachments()) { if (e.slotIndex === slotIndex && e.attachment && e.attachment.region) { region = e.attachment.region; break; } }
      skins.push({ name: sk.name, voices: countVoices(voiceSetFor(sk.name)), sd: sdAvailable(sk.name), region: region ? { page: region.page.name, x: region.x, y: region.y, width: region.width, height: region.height, degrees: region.degrees } : null });
    }
    const f = firstMascot();
    return { animations: miniData.animations.map(a => ({ name: a.name, duration: +a.duration.toFixed(2) })), sdAnimations: f ? f.sdAnimations() : [], skins };
  }

  // ---- 프레임: 캐릭터 전부 갱신 → 한 번에 그리기 ----
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    for (const mas of mascots.values()) mas.update(dt);
    render();
    for (const mas of mascots.values()) mas.pushHitRect(dt);
    requestAnimationFrame(loop);
  }
  const bOff = new spine.Vector2(), bSize = new spine.Vector2();
  function render() {
    const gl = ctx.gl;
    renderer.resize(spine.ResizeMode.Expand);
    renderer.camera.position.set(W / 2, H / 2, 0); renderer.camera.update();
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    renderer.begin();
    const dbg = debugOn();
    for (const mas of mascots.values()) {
      const sk = mas.active.skeleton; if (!sk) continue;
      renderer.drawSkeleton(sk, true);
      if (dbg) { sk.getBounds(bOff, bSize, []); renderer.rect(false, bOff.x, bOff.y, bSize.x, bSize.y, new spine.Color(1, 0, 0, 1)); }
    }
    if (dbg) for (const d of geoD) { renderer.line(d.x0, d.floor, d.x1, d.floor, new spine.Color(0, 1, 0, 1)); renderer.rect(false, d.x0, d.floor, d.x1 - d.x0, d.top - d.floor, new spine.Color(0, 0.6, 1, 0.6)); }
    renderer.end();
    if (dbg) hud.textContent = [...mascots.values()].map(mas => mas.hudLine()).join("\n\n");
  }

  // ================= 캐릭터 한 명 =================
  function Mascot(id, S0) {
    let S = S0; // 설정 뷰 (내 캐릭터 + 공통 sound/display), 메인과 동기화
    const scale = () => S.scale;
    const debug = () => S.display.debug;
    let facing = 1;

    // ---- 캐릭터 슬롯: mini(항상 로드) / sd(선택 시 로드). active가 현재 그리는 쪽 ----
    const mini = { kind: "minimi", skeleton: null, state: null, data: null, pma: true, A: MINI, feet: 0, w: 100, h: 150, k: 1 };
    const sd = { kind: "sd", skeleton: null, state: null, data: null, pma: true, A: SD, feet: 0, w: 100, h: 150, k: 1, key: null, textures: [] };
    const sdI = { kind: "sd", skeleton: null, state: null, data: null, pma: true, A: SD, feet: 0, w: 100, h: 150, k: 1, key: null, textures: [] }; // 하이브리드용 인게임 슬롯
    let active = mini;
    const self = { id, get S() { return S; }, get active() { return active; } };

    // 상태에 맞는 슬롯으로 전환 (이동 = 미니미/스탠딩 Move, 그 외 = 스탠딩). 위치·방향 유지, 발 기준 정렬
    function useSlot(slot) {
      if (active === slot || !slot.skeleton) return;
      active = slot; applyScale(); applyFacing();
    }
    const isSD = () => (S.mode === "sd" || S.mode === "ingame") && !!sd.skeleton;
    // 이동 슬롯(SD 모드): 기본 = 미니미(게임에서 돌아다닐 때 쓰는 스틱 미니미로 폴짝) / 스탠딩 자체에 Move가 있으면(크레페) 스탠딩
    function slotForMove() {
      if (!sd.skeleton) return active;
      if (sd.A.move && sd.data.findAnimation(sd.A.move)) return sd; // 스탠딩 자체 걷기(크레페 등)
      return mini; // 게임 로비처럼 미니미로 폴짝
    }
    function slotForRest() { return sd.skeleton ? sd : active; }
    const state = () => active.state;

    // ---- 설정 동기화 ----
    function patchSettings(patch) { applySettings(deepMerge(S, patch)); host.setSettings(patch, id); }
    function applySettings(next) {
      const prev = S; S = next;
      if (!mini.skeleton) return;
      const skinChanged = !prev || prev.skin !== S.skin, modeChanged = !prev || prev.mode !== S.mode;
      if (skinChanged) setSkin(S.skin, !!prev && S.sound.greetOnSkin);
      if (skinChanged || modeChanged) activateMode();
      else if (prev.scale !== S.scale) applyScale();
      applyOpacity();
      hud.style.display = S.display.debug ? "block" : "none";
      if (prev && prev.mood !== S.mood && (m.state === "idle" || m.state === "mood" || m.state === "pose" || m.state === "react" || m.state === "hop")) { if (m.state === "hop") { m.vx = m.vy = 0; m.y = floorAt(m.x); } decideIdle(); }
    }
    const moodOn = () => !!S.mood && isSD() && active.A.moods && (active.A.moods[S.mood] || []).some(has);
    // 불투명도: 창 하나에 여러 명이라 캔버스 대신 스켈레톤 색 알파로 (PMA 렌더러에서 슬롯 색에 곱해짐)
    function applyOpacity() { for (const s of [mini, sd, sdI]) if (s.skeleton) s.skeleton.color.a = S.opacity; }

    // ---- 사운드 ----
    let voiceSet = { hero: null, skin: "base", cats: {}, base: {} };
    let currentVoice = null, lastPlayed = null;
    function selectVoiceSet(skinName) { voiceSet = voiceSetFor(skinName); }
    const voiceCount = () => countVoices(voiceSet);
    function volumeOf(cat) { const s = S.sound; return s.muted ? 0 : Math.max(0, Math.min(1, s.master * s[cat])); }
    const SFX_BASE = 0.4; // 효과음 원본이 피크 1.0 풀스케일로 녹음돼 있어 같은 % 에서도 목소리보다 훨씬 크게 들림 → 기본 감쇠
    let lastSfxAt = -1e9;
    function playSound(cat, name, src, gain = 1) {
      if (!src) return;
      if (cat === "sfx") { const now = performance.now(); if (now - lastSfxAt < 220) return; lastSfxAt = now; } // 튕길 때 연타 방지
      const v = Math.min(1, volumeOf(cat) * (cat === "sfx" ? SFX_BASE * gain : 1)); lastPlayed = { cat, name, volume: +v.toFixed(3) };
      if (v <= 0) return;
      if (cat === "voice" && currentVoice) { currentVoice.pause(); currentVoice = null; }
      const a = new Audio(src); a.volume = v; a.play().catch(() => {});
      if (cat === "voice") currentVoice = a;
    }
    function playVoice(...cats) {
      for (const c of cats) { const list = voiceSet.cats[c]; if (list && list.length) { const f = pick(list); playSound("voice", f, `file:///${cfg.assetRoot}/voice/${f}`); return f; } }
      return null;
    }
    const playSfx = (name, gain = 1) => playSound("sfx", name, clips.sfx[name], gain);
    const voicePlaying = () => !!(currentVoice && !currentVoice.ended && !currentVoice.paused && currentVoice.currentTime < (currentVoice.duration || 99));
    let lastMotionVoiceAt = -1e9;
    // 모션에 맞는 대사. force=true(메뉴/클릭에서 직접 시킨 경우)면 확률·쿨다운 무시
    // 감정 소리(joy/pleasure/anger/sorrow/surprise/sorry = 0.6~2초 웃음·으아악)는 짧은 리액션이라 대사(line/greeting/spawn, 2~5초 문장)보다 훨씬 자주 내도 안 시끄럽다.
    // 웃는 포즈(Happy/Smile/Laugh)에 웃음소리가 거의 안 나던 원인 = 대사와 같은 30%/15초 게이트를 쓴 것
    const EMOTE_CATS = new Set(["joy", "pleasure", "anger", "sorrow", "surprise", "sorry", "eat", "shout", "hit", "basicattack", "powerattack"]); // 전투 외침·피격·공격 소리도 짧은 리액션
    let lastEmoteAt = -1e9;
    function motionVoice(anim, force = false) {
      if (!S.sound.motionVoice && !force) return null;
      const cats = voiceCatsFor(anim); if (!cats) return null;
      const now = performance.now() / 1000;
      const emote = EMOTE_CATS.has(cats[0]);
      if (!force) {
        if (emote) { if (Math.random() * 100 >= (S.sound.emoteVoiceChance ?? 85)) return null; if (now - lastEmoteAt < 2.5) return null; }
        else { if (Math.random() * 100 >= S.sound.motionVoiceChance) return null; if (now - lastMotionVoiceAt < S.sound.motionVoiceCooldown) return null; }
      }
      const f = playVoice(...cats); if (f) { if (emote) lastEmoteAt = now; else lastMotionVoiceAt = now; } return f;
    }

    // ---- 캐릭터 런타임 상태 ----
    const m = { state: "boot", x: 300, y: 0, vx: 0, vy: 0, rot: 0, timer: 0, targetX: 0, anim: "", over: false, get w() { return active.w; }, get h() { return active.h; } };
    const mouse = { down: false, dragging: false, sx: 0, sy: 0, gx: 0, gy: 0, offX: 0, offY: 0, hist: [], zone: "body" };
    let tickleT = 0, holdT = 0; // 간지럽히기 중 웃음 간격 / 몸 누르고 가만히 있는 시간(→ 간지럽히기)

    function makeChar(slot, data) {
      slot.data = data; slot.skeleton = new spine.Skeleton(data);
      const sdata = new spine.AnimationStateData(data); sdata.defaultMix = slot.kind === "sd" ? 0.15 : 0.08;
      slot.state = new spine.AnimationState(sdata);
      slot.state.addListener({ complete: (entry) => onComplete(slot, entry) });
      slot.pma = true; // loadAtlas에서 전부 PMA로 맞춤
      slot.skeleton.color.a = S.opacity;
    }

    async function start() {
      makeChar(mini, miniData);
      if (!miniData.findSkin(S.skin)) S.skin = "Mini_Crepe";
      setSkin(S.skin, false);
      { const p = geoD.find(d => d.primary) || geoD[0]; m.x = p ? (p.x0 + p.x1) / 2 + (Math.random() - 0.5) * (p.x1 - p.x0) * 0.4 : W / 2; }
      await activateMode(true);
    }
    function dispose() { unloadSlot(sd); unloadSlot(sdI); mini.skeleton = null; mini.state = null; if (currentVoice) currentVoice.pause(); host.hitRect({ x: 0, y: 0, w: 0, h: 0 }, id); }
    function onGeo() { if (m.state !== "boot") { m.x = clampX(m.x); if (m.state !== "thrown" && m.state !== "drag") m.y = floorAt(m.x); } }

    async function loadSlot(slot, r) {
      if (!r) { unloadSlot(slot); return false; }
      const key = `${r.dir}/${r.stem}`;
      if (slot.key === key && slot.skeleton) return true;
      const { atlas, textures } = await loadAtlas(`${r.dir}/${r.stem}.atlas`, r.dir);
      const data = new spine.SkeletonBinary(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(host.readBytes(`${r.dir}/${r.stem}.skel`));
      unloadSlot(slot);
      makeChar(slot, data); slot.headBoneCached = undefined; slot.eyeBonesCached = undefined; slot.textures = textures; slot.key = key; slot.src = r.src; slot.A = r.src === "ingame" ? ingamePools(data) : sdPools(data); slot.family = r.src === "ingame" ? "ingame" : "standing";
      const skin = data.findSkin("Normal") || data.skins.find(s => s.name !== "default"); if (skin) slot.skeleton.setSkin(skin);
      slot.skeleton.setSlotsToSetupPose();
      return true;
    }
    function unloadSlot(slot) {
      if (active === slot) active = (slot !== sd && sd.skeleton) ? sd : mini; // 그리는 중인 슬롯을 내리면 안전한 쪽으로
      for (const t of slot.textures || []) try { t.dispose(); } catch {} slot.textures = []; slot.skeleton = null; slot.state = null; slot.data = null; slot.key = null; slot.headBoneCached = undefined; slot.eyeBonesCached = undefined;
    }
    let activating = 0;
    async function activateMode(first) {
      const want = S.mode === "sd" || S.mode === "ingame" ? "sd" : "minimi";
      const seq = ++activating;
      if (active === sdI) active = sd.skeleton ? sd : mini; // 전환 동안 인게임 슬롯이 교체될 수 있음
      if (want === "sd") {
        let ok = false;
        try {
          if (S.mode === "ingame") {
            // 인게임 형태: 전투·마이홈 SD 스켈레톤을 그대로 (Move로 걷고 Spawn으로 등장). 없으면 스탠딩으로 대체
            unloadSlot(sdI);
            ok = await loadSlot(sd, resolveIngame(S.skin)) || await loadSlot(sd, resolveSD(S.skin));
          } else {
            // SD = 스탠딩(대기·상호작용). 스탠딩이 없는 캐릭터만 인게임 SD로 대체
            const okS = await loadSlot(sd, resolveSD(S.skin));
            const okI = !okS ? await loadSlot(sdI, resolveIngame(S.skin)) : (unloadSlot(sdI), false);
            if (!okS && okI) { await loadSlot(sd, resolveIngame(S.skin)); unloadSlot(sdI); }
            ok = okS || okI;
          }
        } catch (e) { console.warn("SD 로드 실패", e); }
        if (seq !== activating) return; // 더 최신 요청이 있음
        if (!ok) { console.warn("SD 없음 → 미니미로", S.skin); }
        active = ok ? sd : mini;
      } else { active = mini; unloadSlot(sdI); }
      applyScale();
      if (first) spawn(); else { m.y = floorAt(m.x); m.rot = 0; decideIdle(); }
      host.sdAnims(id, sdAnimations());
    }
    const sdAnimations = () => sd.data ? sd.data.animations.map(a => a.name) : [];

    // ---- 우클릭 메뉴는 별도 창(menu.html). 여기선 열기 요청만 ----
    function openMenu(px, py) { host.openMenu(px, py, id); if (m.state === "hop") restThenDecide(); }
    const menuOpen = false; // (호환) 메뉴 창이 열려 있어도 마스코트 창 입력과는 무관
    // 설정창/메뉴에서 "듣기": 카테고리별 미리듣기
    function preview(cat) { if (cat === "voice") playVoice("touch", "greeting"); else playSfx("jump02"); }
    function playCmd(name) { playOnce(name, "react"); motionVoice(name, true); }
    // 새 소식 알림: 말풍선은 메인이 띄우고, 여기선 "말하는" 모션 + 인사/잡담 대사. 잡고 있거나 공중이면 건드리지 않음
    let holdUntil = 0; // 말풍선이 떠 있는 동안은 돌아다니지 않음 (말풍선은 제자리 고정이라 캐릭터가 가버리면 이상함)
    const holding = () => performance.now() < holdUntil;
    // 다른 사도 쪽으로 다가가서(창 기준 x) 그쪽을 본다 — 둘이 잡담할 때. 도착하면 holdUntil 동안 제자리
    function meet(arg) {
      if (!arg || typeof arg.x !== "number") return;
      if (["drag", "thrown", "touch", "pat", "tickle", "smash1"].includes(m.state)) return;
      holdUntil = Math.max(holdUntil, performance.now() + (arg.hold || 30000));
      // 메인이 자리(to)를 정해 주면 거기로(둘이 동시에 움직여도 겹치지 않게 중간점 기준), 아니면 상대 옆(폭 절반씩 + 여유)
      const gap = ((m.w || 120) + (arg.w || m.w || 120)) / 2 + 48;
      const target = clampX(typeof arg.to === "number" ? arg.to : (arg.x < m.x ? arg.x + gap : arg.x - gap));
      if (Math.abs(target - m.x) < 12) { facing = arg.x < m.x ? -1 : 1; applyFacing(); return; }
      if (isSD()) useSlot(slotForMove());
      m.state = "hop"; m.hopT = 0; m.targetX = target; facing = m.targetX < m.x ? -1 : 1; applyFacing();
      play(active.A.move && has(active.A.move) ? active.A.move : active.A.hold, true);
      m.faceAfter = arg.x < m.x ? -1 : 1; // 도착하면 상대를 본다 (restThenDecide 뒤)
    }
    // AI 대답의 감정 태그 → 그 표정 애니 한 번 + 감정 소리. SD가 아니거나 풀이 없으면 반응 애니로
    // AI 대답/잡담의 감정 → 표정 애니를 한 번 재생하고 마지막 프레임에서 멈춰(pose) 말풍선이 떠 있는 동안 그 표정을 유지.
    //   mood 없음: role=speak(말하는 쪽)면 Talk/Point/Blank 같은 '말하는' 포즈, role=listen(듣는 쪽)이면 Blank/Think/Nodding '듣는' 포즈
    function emote(arg) {
      const mood = arg && arg.mood; if (arg && arg.hold) holdUntil = Math.max(holdUntil, performance.now() + arg.hold);
      if (["drag", "thrown", "touch", "pat", "tickle", "smash1"].includes(m.state)) return;
      if (isSD()) useSlot(slotForRest());
      const A = active.A;
      const pool = mood && A.moods ? (A.moods[mood] || []).filter(has) : [];
      const SPEAK = ["Talk_1", "Talk_2", "Point_1", "Blank_1", "Happy_1", "Proud_1", "Taunt_1"], LISTEN = ["Blank_1", "Blank_2", "Nodding_1", "Think_1", "Thinking_1", "Curious_1", "Question_1"];
      const role = arg && arg.role;
      let a = pool.length ? pick(pool) : null;
      if (!a) { const cands = (role === "listen" ? LISTEN : role === "speak" ? SPEAK : []).filter(has); a = cands.length ? pick(cands) : (mood ? (A.react || []).find(has) : null); }
      m.rot = 0; m.vx = m.vy = 0; m.y = floorAt(m.x);
      if (!a) return;
      const poseMs = arg && arg.pose ? arg.pose : 0;
      if (poseMs > 0 && !A.idleLoop.has(a)) { play(a, false); m.state = "pose"; m.timer = poseMs / 1000; } // 마지막 프레임 유지
      else playOnce(a, "react");
      if (mood && S.sound.clickVoice !== false && role !== "listen") motionVoice(a, true);
    }
    function logState(tag) { console.log(`STATE[${tag}] ${m.state} anim=${m.anim} timer=${(m.timer || 0).toFixed(1)} facing=${facing}`); }
    function announce(arg) {
      if (arg && arg.hold) holdUntil = Math.max(holdUntil, performance.now() + arg.hold);
      if (["drag", "thrown", "touch", "pat", "tickle"].includes(m.state)) return;
      if (isSD()) useSlot(slotForRest());
      const A = active.A;
      const cand = active === mini ? ["Idle3_7", "Act1_1", "Success", "Idle2_4"] : ["Talk_1", "Point_1", "Hi_1", "Happy_1", "Blank_1", "Proud_1", ...(A.react || [])];
      const a = cand.find(has) || A.hold;
      m.rot = 0; m.vx = m.vy = 0; m.y = floorAt(m.x); playOnce(a, "react");
      if (arg && arg.sound !== false && S.sound.clickVoice !== false) playVoice("greeting", "line", "spawn", "joy", "pleasure", "touch");
    }

    function setSkin(name, greet) {
      const skin = miniData.findSkin(name);
      if (skin) { mini.skeleton.setSkin(skin); mini.skeleton.setSlotsToSetupPose(); miniRawH = 0; }
      selectVoiceSet(name);
      if (greet) playVoice("greeting", "spawn", "touch");
    }
    // 크기: 미니미는 scale 그대로, SD는 단위 고정 배율(SD_UNIT×scale). 발 위치(바운딩 바닥)와 w/h도 여기서.
    function applyScale() {
      const sk = active.skeleton;
      active.k = active === mini ? scale() : scale() * SD_UNIT * (active === sdI ? hybridFix() : 1); // 미니미는 SD 이동 중에도 기본 미니미 크기(scale) 그대로
      applyFacing(); sk.scaleY = active.k;
      const sx = sk.x, sy = sk.y; sk.x = 0; sk.y = 0;
      sk.setToSetupPose(); sk.setSlotsToSetupPose(); hideExtraSlots();
      sk.updateWorldTransform();
      const off = new spine.Vector2(), size = new spine.Vector2();
      sk.getBounds(off, size, []);
      active.feet = active === mini ? off.y : groundY(active, off, size); active.w = size.x; active.h = size.y;
      sk.x = sx; sk.y = sy;
      m.x = clampX(m.x);
    }
    // SD 바닥(픽셀, 스켈레톤 로컬 기준) = 스켈레톤 원점(y=0). 게임 스탠딩은 전부 원점을 지면으로 잡아 그려져 있다(tools/ground-survey.mjs: 발이 서 있는 캐릭터는 박스 바닥 −20~+10).
    // 원점보다 아래로 내려오는 것(벨라 흘러내리는 머리 −259, 시온 총 −186, 우로스 −151)은 지면 아래로 그려지는 게 맞고(작업표시줄 위로 침범),
    // 발이 원점보다 높은 것은 의도된 것(다야는 돌 위에 앉음 131, 스패로우 상자 97, 앨리스 의자 50, 리스티·벨라 공중, 에드 배양기). 발 본 기준으로 잡으면 다야의 돌이 바닥 아래로 꺼진다.
    // 박스 바닥이 원점보다 위면(주비 238 등 아무것도 지면에 닿지 않음) 박스 바닥을 바닥에 놓는다.
    function groundY(slot, off, size) { return off.y > 0 ? off.y : 0; }
    function applyFacing() { active.skeleton.scaleX = active.k * facing * IMAGE_FACES; }
    let miniRawH = 0;
    // (참고용) SD 모드에서 미니미를 스탠딩 크기에 맞추는 배율 — 지금은 기본 미니미 크기로 통일해서 사용하지 않음
    function miniMatchK() {
      if (!miniRawH) { const sk = mini.skeleton; const sx = sk.scaleX, sy = sk.scaleY; sk.scaleX = 1; sk.scaleY = 1; sk.setToSetupPose(); sk.setSlotsToSetupPose(); hideExtraSlots(mini); sk.updateWorldTransform(); const o = new spine.Vector2(), z = new spine.Vector2(); sk.getBounds(o, z, []); miniRawH = Math.max(1, z.y); sk.scaleX = sx; sk.scaleY = sy; }
      const body = sd.skeleton ? bodyHeight(sd) : null;
      const boxPx = (sd.h || 0) > 0 ? sd.h : 560 * scale() * SD_UNIT;
      const standingPx = body ? Math.min(boxPx, body * sd.k * 1.65) : boxPx;
      return (standingPx * MINI_MATCH) / miniRawH;
    }
    // 발(발 본)→Head 본 높이(스켈레톤 단위). Head 본이 없거나 비율이 이상하면 null
    function bodyHeight(slot) {
      const sk = slot.skeleton; if (!sk) return null;
      const sx = sk.scaleX, sy = sk.scaleY, x0 = sk.x, y0 = sk.y;
      sk.scaleX = 1; sk.scaleY = 1; sk.x = 0; sk.y = 0; sk.setToSetupPose(); sk.setSlotsToSetupPose(); hideExtraSlots(slot); sk.updateWorldTransform();
      const o = new spine.Vector2(), z = new spine.Vector2(); sk.getBounds(o, z, []);
      const head = sk.bones.find(b => /^head$/i.test(b.data.name));
      const h = head ? head.worldY - groundY(slot, o, z) : null;
      sk.scaleX = sx; sk.scaleY = sy; sk.x = x0; sk.y = y0;
      return h && h > 20 ? h : null;
    }
    let hybridFixCache = { key: null, v: 1 };
    function hybridFix() {
      if (!sd.skeleton || !sdI.skeleton || sd.family !== "standing") return 1;
      const key = sd.key + "|" + sdI.key; if (hybridFixCache.key === key) return hybridFixCache.v;
      const hs = bodyHeight(sd), hi = bodyHeight(sdI);
      let v = 1; if (hs && hi) { const r = hs / hi; if (r > 0.6 && r < 1.7) v = r; }
      hybridFixCache = { key, v }; return v;
    }
    function hideExtraSlots(slot = active) {
      if (!slot.skeleton) return;
      if (slot === mini) { for (const s of mini.skeleton.slots) if (HIDE_SLOTS.has(s.data.name)) s.setAttachment(null); }
      else for (const s of slot.skeleton.slots) if (HIDE_SD_SLOTS.test(s.data.name)) s.setAttachment(null);
    }

    // ---- 애니 제어 (현재 형태에 있는 애니만) ----
    const has = (name) => !!active.data.findAnimation(name);
    const firstOf = (...names) => names.find(has) || null;
    function play(name, loop) { if (!has(name)) name = firstOf(active.A.hold, "Idle_1", "Idle1_1"); if (!name) return null; m.anim = name; return state().setAnimation(0, name, loop); }
    function playOnce(name, nextState) { m.state = nextState; m.rot = 0; play(name, false); }
    // 꿀밤은 게임처럼 2단: Smash_End_1(맞는 순간, dutchrubend1 = "아얏" 소리) → 끝나면 Smash_End_2(머리 감싸는 포즈, dutchrubend2 = 대사 "머리 때리지 마!")
    //   스킨 보이스 묶음엔 dutchrubend2_skinN만 있고 맞는 소리는 base에만 있어서 1단은 base에서 찾는다
    function voiceFile(re, ...lists) { for (const l of lists) { const c = (l || []).filter(f => re.test(f)); if (c.length) return pick(c); } return null; }
    function playVoiceFile(f) { if (f) playSound("voice", f, `file:///${cfg.assetRoot}/voice/${f}`); return f; }
    function smashHit() {
      const a1 = has("Smash_End_1") ? "Smash_End_1" : active.A.smash[0], a2 = has("Smash_End_2") ? "Smash_End_2" : null;
      playOnce(a1, a2 ? "smash1" : "react");
      if (S.sound.clickVoice) {
        const hit = voiceFile(/dutchrubend1/, voiceSet.cats.dutchrubend, voiceSet.base.dutchrubend);
        if (hit) playVoiceFile(hit); else if (!a2) smashLine();
      }
    }
    function smashLine() {
      const line = voiceFile(/dutchrubend2/, voiceSet.cats.dutchrubend, voiceSet.base.dutchrubend);
      if (line) playVoiceFile(line); else playVoice("dutchrubend", "anger", "surprise");
    }
    function onComplete(slot, entry) {
      if (slot !== active) return;
      if (entry !== slot.state.getCurrent(0)) return; // 교체된 옛 엔트리의 지연 complete 무시
      if (entry.loop) return;
      if (m.state === "smash1") { playOnce("Smash_End_2", "react"); if (S.sound.clickVoice) smashLine(); return; }
      if (m.state === "spawn" && S.sound.landSfx) playSfx("jump02");
      if (m.state === "pose") return; // 표정 유지 중 — 타이머가 끝내 준다
      if (m.state === "spawn" || m.state === "react" || m.state === "jump" || m.state === "land") restThenDecide();
    }

    // 모션이 끝난 뒤: 대기 루프로 돌아가 actGap 초 쉬고 나서 다음 행동 결정 (연속 모션으로 끊기는 느낌 방지)
    function restThenDecide() {
      if (moodOn()) { decideIdle(); return; }
      if (isSD()) useSlot(slotForRest());
      const A = active.A;
      m.state = "idle"; m.rot = 0; m.vx = m.vy = 0; m.y = floorAt(m.x);
      const idles = [...A.idleLoop].filter(has);
      play(idles.length ? pick(idles) : A.hold, true);
      m.timer = Math.max(0.3, S.behavior.actGap ?? 2) * (0.8 + Math.random() * 0.4);
    }

    function spawn() {
      m.x = clampX(m.x); m.vx = m.vy = 0; m.rot = 0;
      if (isSD()) useSlot(slotForRest());
      const sp = active.A.spawn.filter(has);
      if (sp.length) { m.y = floorAt(m.x); playOnce(pick(sp), "spawn"); }
      else { m.y = topAt(m.x) - m.h - 10; m.state = "thrown"; play(active.A.hold, true); } // 등장 애니 없음(SD) → 위에서 떨어져 착지
      if (S.sound.spawnVoice) playVoice("spawn", "greeting");
    }
    function decideIdle() {
      const B = S.behavior;
      m.state = "idle"; m.rot = 0; m.vx = m.vy = 0; m.y = floorAt(m.x);
      if (moodOn()) {
        useSlot(slotForRest());
        const pool = active.A.moods[S.mood].filter(has);
        const a = pool.length > 1 && m.anim && pool.includes(m.anim) ? pick(pool.filter(n => n !== m.anim)) : pick(pool);
        play(a, false); m.state = "mood"; m.timer = B.idleMin + Math.random() * Math.max(0, B.idleMax - B.idleMin); motionVoice(a);
        return;
      }
      const r = Math.random() * 100;
      if (B.hop && r < B.hopChance && !holding()) {
        if (isSD()) useSlot(slotForMove());
        const A = active.A;
        m.state = "hop"; m.hopT = 0;
        const cur = dispAt(m.x), others = geoD.filter(d => d !== cur);
        if (others.length && Math.random() < 0.2) { const d = pick(others); m.targetX = clampX(d.x0 + m.w / 2 + WALL_MARGIN + Math.random() * Math.max(1, d.x1 - d.x0 - m.w - WALL_MARGIN * 2)); } // 다른 모니터로 원정
        else m.targetX = clampX(m.x + (Math.random() < 0.5 ? -1 : 1) * (80 + Math.random() * Math.max(0, B.hopRange - 80)));
        facing = m.targetX < m.x ? -1 : 1; applyFacing(); play(A.move && has(A.move) ? A.move : A.hold, true);
        return;
      }
      if (isSD()) useSlot(slotForRest());
      const A = active.A;
      const jumps = A.jump.filter(has);
      if (B.jump && jumps.length && r < B.hopChance + B.jumpChance) { playOnce(pick(jumps), "jump"); }
      else {
        const pool = (B.idleActs ? A.idleActs : A.idleQuiet).filter(has);
        const a = pick(pool.length ? pool : [A.hold]);
        if (A.idleLoop.has(a)) { play(a, true); m.timer = B.idleMin + Math.random() * Math.max(0, B.idleMax - B.idleMin); }
        else { play(a, false); m.timer = 0; m.state = "react"; motionVoice(a); }
      }
    }
    function clampX(x) { return Math.max(WALL_MARGIN + m.w / 2, Math.min(W - WALL_MARGIN - m.w / 2, x)); } // 창 = 모니터 합집합

    // ---- 프레임 ----
    let logT = 0;
    function update(dt) {
      if (!active.skeleton) return;
      if (cfg.logPos && (logT += dt) > 1) { logT = 0; console.log(`POS[${id}] ${active === mini ? "minimi" : active.family} ${m.state} ${m.anim} x=${m.x.toFixed(0)} screenY=${(H - m.y).toFixed(0)} w=${m.w.toFixed(0)} h=${m.h.toFixed(0)} rot=${m.rot.toFixed(1)} over=${m.over}`); }
      switch (m.state) {
        case "idle":
          if (voicePlaying()) m.timer = Math.max(m.timer, 0.5); // 대사가 끝나기 전엔 다음 모션 안 함
          m.timer -= dt; if (m.timer <= 0) decideIdle(); break;
        case "mood":
          if (!moodOn()) { decideIdle(); break; }
          m.timer -= dt; if (m.timer <= 0) decideIdle(); break;
        case "pose": // 표정 유지 (말풍선 동안) → 끝나면 대기
          m.timer -= dt; if (m.timer <= 0) restThenDecide(); break;
        case "hop": {
          const dir = Math.sign(m.targetX - m.x); m.x += dir * active.A.moveSpeed * scale() * 2 * (S.behavior.hopSpeed / 100) * dt;
          const floorY = floorAt(m.x); if (active.A.move && has(active.A.move)) m.y = floorY;
          if (!(active.A.move && has(active.A.move))) { // 걷기 애니 없음 → 절차적 이동. 스탠딩은 살짝 통통(작은 바운스 + 미세 기울기), 그 외 폴짝
            const gentle = active !== mini;
            m.hopT = (m.hopT || 0) + dt * (gentle ? 4.2 : 3.2); const ph = m.hopT % 1;
            const hh = gentle ? 7 : active.A.hopHeight;
            m.y = floorY + Math.abs(Math.sin(ph * Math.PI)) * hh * scale() * 2; m.rot = Math.sin(ph * Math.PI * 2) * (gentle ? 2 : 4) * -dir;
          }
          if ((dir > 0 && m.x >= m.targetX) || (dir < 0 && m.x <= m.targetX) || dir === 0) { m.x = m.targetX; restThenDecide(); if (m.faceAfter) { facing = m.faceAfter; m.faceAfter = 0; applyFacing(); } }
          break;
        }
        case "touch": case "pat": case "tickle": // 누르고 있는 동안 — 바닥에 서서 해당 루프 애니
          m.y = floorAt(m.x); m.rot = 0;
          if (m.state === "touch" && mouse.zone === "body" && active.A.tickleIdle) { holdT += dt; if (holdT > 0.5) startTickle(); } // 몸을 누른 채 가만히 → 간지럽히기
          if (m.state === "tickle") { tickleT += dt; if (tickleT > 2.5) { tickleT = 0; if (S.sound.clickVoice) playVoice("tickleduring", "ticklestart"); } } // 계속 간지럽히면 계속 웃음
          break;
        case "drag":
          m.x = mouse.gx; m.y = mouse.gy;
          m.rot = spine.MathUtils.clamp(-m.vx * 0.02, -25, 25);
          break;
        case "thrown": {
          m.vy -= GRAVITY * dt; m.x += m.vx * dt; m.y += m.vy * dt; m.rot -= m.vx * 0.5 * dt;
          const half = m.w / 2;
          if (m.x < half) { m.x = half; m.vx *= -0.6; } else if (m.x > W - half) { m.x = W - half; m.vx *= -0.6; }
          const topY = topAt(m.x), floorY = floorAt(m.x);
          if (m.y + m.h > topY) { m.y = topY - m.h; m.vy *= -0.4; }
          if (m.y <= floorY) {
            m.y = floorY;
            if (Math.abs(m.vy) < 250) {
              m.vx = m.vy = 0; m.rot = 0; if (isSD()) useSlot(slotForRest()); applyFacing(); playOnce(firstOf(active.A.land || "", "Angry_1", "Idle_1", "Idle1_1"), "land");
              if (S.sound.landSfx) playSfx("jump02");
              if (S.sound.landVoice) { if (!motionVoice(m.anim, true)) playVoice("surprise", "sorry", "anger", "ticklestart"); }
            } else { // 튕김: 세게 떨어질 때만, 세기에 비례해 작게 (작은 튕김은 무음)
              const impact = Math.abs(m.vy); m.vy *= -0.45; m.vx *= 0.75;
              if (S.sound.landSfx && impact > 900) playSfx("jump02", Math.min(0.7, impact / 4000));
            }
          }
          break;
        }
      }
      const sk = active.skeleton;
      sk.x = m.x; sk.y = m.y - active.feet;
      state().update(dt); state().apply(sk);
      hideExtraSlots();
      const rb = sk.getRootBone(); rb.rotation = rb.data.rotation + m.rot * Math.sign(sk.scaleX);
      sk.updateWorldTransform();
    }
    const hudLine = () => `[${id}] 형태=${S.mode}/${active === mini ? "minimi" : active.family} 상태=${m.state} 애니=${KO.anim(m.anim)} (${m.anim})\nx=${m.x.toFixed(0)} y=${m.y.toFixed(0)} vx=${m.vx.toFixed(0)} vy=${m.vy.toFixed(0)} 회전=${m.rot.toFixed(1)}\n마우스 위=${m.over} 캐릭터=${KO.skinName(S.skin)} 크기=${scale()} 보이스=${voiceCount()}`;
    const bo = new spine.Vector2(), bs = new spine.Vector2();
    let lastHit = null, hitT = 0;
    function pushHitRect(dt) {
      hitT += dt; if (hitT < 1 / 30 || !active.skeleton) return; hitT = 0; // 30Hz
      active.skeleton.getBounds(bo, bs, []);
      const pad = 10;
      const r = { x: bo.x - pad, y: H - (bo.y + bs.y) - pad, w: bs.x + pad * 2, h: bs.y + pad * 2 }; // 창 기준 px (y 아래로)
      if (lastHit && Math.abs(lastHit.x - r.x) < 1 && Math.abs(lastHit.y - r.y) < 1 && Math.abs(lastHit.w - r.w) < 1 && Math.abs(lastHit.h - r.h) < 1) return;
      lastHit = r; host.hitRect(r, id);
    }

    // ---- 마우스 (이 캐릭터의 히트 창에서 온 이벤트만) ----
    function hit(px, py) { if (!active.skeleton) return false; active.skeleton.getBounds(bo, bs, []); const wy = H - py; return px >= bo.x && px <= bo.x + bs.x && wy >= bo.y && wy <= bo.y + bs.y; }
    // 머리 본(교감 영역·볼 당기기용). 없으면 null → 높이 비율로 판정
    function headBone(slot) { if (slot.headBoneCached === undefined) { const sk = slot.skeleton; slot.headBoneCached = sk ? (sk.bones.find(b => /^(S\d_)?Head$/i.test(b.data.name)) || sk.bones.find(b => /head/i.test(b.data.name) && !/hair|ac|ct|rct/i.test(b.data.name)) || null) : null; } return slot.headBoneCached; }
    // 누른 위치가 캐릭터의 어디인가: "head"(머리 위쪽 → 쓰다듬기) / "cheek"(얼굴 → 볼 당기기) / "body"(들어서 던지기). 스탠딩(SD)에서만
    // 눈 본(얼굴 높이 기준). 눈썹·속눈썹·하이라이트 제외
    function eyeBones(slot) { if (slot.eyeBonesCached === undefined) { const sk = slot.skeleton; slot.eyeBonesCached = sk ? sk.bones.filter(b => /eye/i.test(b.data.name) && !/brow|lash|light|shadow|ac/i.test(b.data.name)) : []; } return slot.eyeBonesCached; }
    // 머리/얼굴 기하(픽셀, 월드): neckY = Head 본(목), eyeY = 눈 높이, u = 눈-목 거리(얼굴 반높이 정도). 바운딩 상단은 모자·뿔·머리장식 때문에 쓰지 않는다
    // (tools/head-survey.mjs: 137명 중 눈-목 거리 중앙값 69유닛, 상단-눈 거리는 모자 유무로 3~8배 차이)
    function headGeom() {
      const sk = active.skeleton, k = Math.abs(sk.scaleY) || 1, hb = headBone(active), eyes = eyeBones(active);
      sk.getBounds(bo, bs, []);
      const neckY = hb ? hb.worldY : bo.y + bs.y * 0.55, headX = hb ? hb.worldX : bo.x + bs.x / 2;
      let d = eyes.length ? eyes.reduce((a, b) => a + b.worldY, 0) / eyes.length - neckY : 0;
      if (d < 20 * k) d = 65 * k; // 눈 본이 없거나 Head 본이 눈보다 위(주비·림)면 표준값
      const u = Math.max(d, 60 * k); // 영역 크기 단위: 눈-목이 유난히 짧은 리그(오팔 44유닛)도 얼굴 영역이 너무 작아지지 않게 하한
      return { neckY, headX, eyeY: neckY + d, u, top: bo.y + bs.y };
    }
    // 누른 위치가 캐릭터의 어디인가: "cheek"(얼굴: 턱~눈썹) / "head"(눈썹 위: 머리카락·모자·장식 전부 → 쓰다듬기·꿀밤) / "body". 스탠딩(SD)에서만
    function zoneAt(px, py) {
      if (!isSD() || active !== sd) return "body";
      const g = headGeom(), wy = H - py, dx = Math.abs(px - g.headX);
      if (wy < g.neckY - 0.2 * g.u || dx > 3.2 * g.u) return "body";      // 목 아래 / 머리 옆(팔·날개)
      if (wy <= g.eyeY + 0.6 * g.u) return dx <= 2.2 * g.u ? "cheek" : "body"; // 턱~눈썹 = 얼굴
      return "head";                                                          // 눈썹 위 = 머리 (모자·뿔 포함)
    }
    function startTickle() { m.state = "tickle"; tickleT = 0; play(active.A.tickleIdle, true); if (S.sound.clickVoice) playVoice("ticklestart", "tickleduring"); }
    function hover(px, py) {
      if (mouse.down) return;
      const inside = px >= 0 && py >= 0 && px < W && py < H;
      m.over = inside && hit(px, py);
    }
    function onMouse(ev) { const e = { clientX: ev.x, clientY: ev.y, button: ev.button, buttons: ev.buttons }; if (ev.type === "mousemove") onMove(e); else if (ev.type === "mousedown") onDown(e); else if (ev.type === "mouseup") onUp(e); }
    function onMove(e) {
      hover(e.clientX, e.clientY);
      if (mouse.down) {
        const wy = H - e.clientY;
        const moved = Math.hypot(e.clientX - mouse.sx, e.clientY - mouse.sy);
        if (m.state === "touch" && moved > 6) {
          if (mouse.zone === "head" && active.A.patIdle) { m.state = "pat"; play(active.A.patIdle, true); } // 머리에서 끌기 → 쓰다듬기
          else if (mouse.zone === "cheek") { /* 얼굴에서 끌기 → 볼을 계속 당기는 중(Touch_Idle 유지), 뗄 때 Touch_End */ }
        }
        if (m.state === "pat" || m.state === "tickle" || (m.state === "touch" && mouse.zone === "cheek")) return; // 잡고 있는 동안은 루프 애니만
        if (!mouse.dragging && moved > 6) { mouse.dragging = true; m.state = "drag"; m.vx = m.vy = 0; if (isSD()) useSlot(slotForRest()); play(active.A.drag || active.A.hold, true); }
        if (mouse.dragging) {
          const nx = e.clientX - mouse.offX, ny = wy - mouse.offY;
          const t = performance.now(); mouse.hist.push({ t, x: nx, y: ny }); while (mouse.hist.length > 6) mouse.hist.shift();
          const h0 = mouse.hist[0]; const dtms = Math.max(1, t - h0.t);
          m.vx = (nx - h0.x) / dtms * 1000; m.vy = (ny - h0.y) / dtms * 1000;
          mouse.gx = nx; mouse.gy = ny;
        }
      }
    }
    function onDown(e) {
      if (!hit(e.clientX, e.clientY)) return;
      if (e.button === 2) { openMenu(e.clientX, e.clientY); return; }
      if (e.button !== 0) return;
      mouse.down = true; mouse.dragging = false; mouse.sx = e.clientX; mouse.sy = e.clientY; mouse.hist = [];
      mouse.offX = e.clientX - m.x; mouse.offY = (H - e.clientY) - m.y; mouse.gx = m.x; mouse.gy = m.y;
      if (m.state === "thrown" || m.state === "drag") return; // 공중에 있을 땐 잡기만
      mouse.zone = zoneAt(e.clientX, e.clientY); holdT = 0;
      if (isSD()) { useSlot(slotForRest()); if (active.A.touchIdle) { m.state = "touch"; m.vx = m.vy = 0; m.rot = 0; m.y = floorAt(m.x); play(active.A.touchIdle, true); } }
    }
    function onUp(e) {
      if (!mouse.down) return; mouse.down = false;
      if (mouse.dragging) {
        mouse.dragging = false; m.state = "thrown"; play(active.A.hold, true);
        if (Math.abs(m.vx) < 30 && Math.abs(m.vy) < 30) { m.vx = 0; m.vy = 0; }
        if (Math.abs(m.vx) > 30) { facing = m.vx > 0 ? 1 : -1; applyFacing(); }
      } else if (m.state === "pat") {          // 쓰다듬기 끝 → touch2_x ("그래 그래 더 쓰다듬으라고")
        playOnce(active.A.patEnd || active.A.hold, "react"); if (S.sound.clickVoice) playVoice("pat", "pleasure", "joy");
      } else if (m.state === "tickle") {       // 간지럽히기 끝 → 웃음
        playOnce(active.A.tickleEnd || active.A.hold, "react"); if (S.sound.clickVoice) playVoice("tickleduring", "ticklestart", "joy");
      } else if (m.state === "touch" && mouse.zone === "head" && active.A.smash.length) { // 머리 톡 → 꿀밤
        smashHit();
      } else if (m.state === "touch" && active.A.touchEnd) { // 볼 당기기(게임의 기본 터치) 끝 → touch1_x ("당기지 마!")
        playOnce(active.A.touchEnd, "react"); if (S.sound.clickVoice) playVoice("cheek", "touch");
      } else {                                 // 미니미: 반응 모션 + 그에 맞는 대사
        if (isSD()) useSlot(slotForRest());
        const reacts = active.A.react.filter(has);
        const ra = reacts.length ? pick(reacts) : active.A.hold;
        playOnce(ra, "react");
        if (S.sound.clickVoice) { if (!motionVoice(ra, true)) playVoice("touch"); } // 대사는 반응 모션에 맞춰(웃으면 기쁨 대사), 매핑 없는 모션(Idle2_4 등)만 터치 대사
      }
      m.over = hit(e.clientX, e.clientY);
    }

    // ---- 셀프테스트 (첫 캐릭터에서만) ----
    function fire(type, x, y, button = 0) { onMouse({ type, x, y, button, buttons: 0 }); }
    const shot = (name) => { const pad = 24; console.log(`SHOTREQ ${name} ${Math.round(m.x - m.w / 2 - pad)} ${Math.round(H - m.y - m.h - pad)} ${Math.round(m.w + pad * 2)} ${Math.round(m.h + pad * 2)}`); };
    async function ingameTest() {
      const say = (s) => console.log("INGAMETEST " + s);
      await sleep(2500);
      for (const skin of ["Mini_Erpin", "Mini_Crepe", "Mini_ErpinSkin1"]) {
        patchSettings({ mode: "ingame", skin, mood: "", sound: { muted: true } }); await sleep(3000);
        say(`${skin}: active=${active === mini ? "minimi" : active.family} src=${sd.src} key=${sd.key?.split("/").slice(-1)[0]} anims=${sd.data?.animations.length} state=${m.state} anim=${m.anim} move=${active.A.move} h=${m.h.toFixed(0)}`);
        shot(`ingame-${skin}`); await sleep(500);
        // 이동 강제
        const B0 = S.behavior.hopChance; S.behavior.hopChance = 100; m.state = "idle"; m.timer = 0; await sleep(700); say(`${skin} move: state=${m.state} slot=${active === mini ? "minimi" : active.family} anim=${m.anim} (expect hop + Move on ingame)`); S.behavior.hopChance = B0; await sleep(2500);
      }
      // 전투 대사: 인게임 형태에서 클릭 → Victory/Attack 리액션 + victory/basicattack 보이스
      patchSettings({ mode: "ingame", skin: "Mini_Erpin", sound: { muted: false, master: 0.5, voice: 0.01 } }); await sleep(2500);
      { const cats = Object.keys(voiceSet.cats).filter(c => voiceSet.cats[c].length); say(`erpin voice cats: ${cats.join(" ")} (expect victory/basicattack/spskill/ultimate/hit/die 포함)`); }
      for (const a of ["Victory", "Attack1_1", "Skill1_1", "Ultimate1_1", "Groggy", "Die", "Spawn"]) { const f = motionVoice(a, true); say(`ingame motion ${a} → ${f}`); await sleep(150); }
      { const cx0 = m.x, cy0 = H - m.y - m.h / 2; fire("mousemove", cx0, cy0); fire("mousedown", cx0, cy0); await sleep(30); fire("mouseup", cx0, cy0); await sleep(80); say(`ingame click → state=${m.state} anim=${m.anim} voice=${lastPlayed?.name} (expect react Victory/Attack + victory/basicattack voice)`); }
      patchSettings({ mode: "sd", skin: "Mini_Erpin", sound: { muted: true } }); await sleep(2000); say(`back to sd: src=${sd.src} anim=${m.anim} (expect standing/game)`);
      say("done");
    }
    async function moodTest() {
      const say = (s) => console.log("MOODTEST " + s);
      await sleep(2500);
      patchSettings({ mode: "sd", mood: "", sound: { muted: true } }); await sleep(1500);
      for (const mood of ["", "smile", "anger", "sad", "happy", "eat", "sulky", "surprise"]) {
        patchSettings({ mood }); await sleep(2200);
        say(`mood=${mood || "default"} state=${m.state} anim=${m.anim} pool=${(active.A.moods?.[mood] || []).join("/")}`); shot(`mood-${mood || "default"}`); await sleep(600);
      }
      patchSettings({ mood: "" }); say("MOODTEST done");
    }
    async function selftest() {
      const say = (s) => console.log("SELFTEST " + s);
      const settle = async () => { if (isSD()) useSlot(slotForRest()); m.state = "idle"; m.timer = 99; m.rot = 0; m.y = floorAt(m.x); play(active.A.hold, true); await sleep(120); };
      await sleep(3000); if (S.mode !== "minimi") { patchSettings({ mode: "minimi" }); await sleep(500); } await settle();
      let cx = m.x, cy = H - m.y - m.h / 2;
      fire("mousemove", cx, cy); await sleep(50);
      say(`hover hit=${hit(cx, cy)} (expect true)`);
      fire("mousedown", cx, cy); await sleep(60); fire("mouseup", cx, cy); await sleep(100);
      say(`click state=${m.state} anim=${m.anim} (expect react)`);
      await sleep(2500); await settle();
      cx = m.x; cy = H - m.y - m.h / 2;
      fire("mousemove", cx, cy); fire("mousedown", cx, cy);
      for (let i = 1; i <= 12; i++) { await sleep(16); fire("mousemove", cx + i * 3, cy - i * 12); }
      say(`drag state=${m.state} y=${m.y.toFixed(0)} (expect drag, y>0)`);
      for (let i = 1; i <= 8; i++) { await sleep(16); fire("mousemove", cx + 36 + i * 45, cy - 144 - i * 6); }
      fire("mouseup", cx + 36 + 8 * 45, cy - 144 - 48);
      await sleep(30);
      say(`throw state=${m.state} vx=${m.vx.toFixed(0)} vy=${m.vy.toFixed(0)} (expect thrown, vx>0)`);
      let maxY = 0, t0 = performance.now();
      while (m.state === "thrown" && performance.now() - t0 < 6000) { maxY = Math.max(maxY, m.y); await sleep(50); }
      say(`after throw state=${m.state} anim=${m.anim} maxY=${maxY.toFixed(0)} x=${m.x.toFixed(0)} last=${JSON.stringify(lastPlayed)} (expect land + voice)`);
      await sleep(600);
      fire("mousemove", 10, 10); await sleep(50);
      say(`leave over=${m.over} (expect false)`);
      await settle(); cx = m.x; cy = H - m.y - m.h / 2;
      fire("mousedown", 5, 5); await sleep(30);
      say(`outside click menuOpen=${menuOpen} over=${m.over} (expect false/false)`);
      patchSettings({ skin: "Mini_Crepe" });
      await settle(); cx = m.x; cy = H - m.y - m.h / 2;
      patchSettings({ sound: { master: 0.5, voice: 0.8, muted: false } });
      fire("mousemove", cx, cy); fire("mousedown", cx, cy); await sleep(30); fire("mouseup", cx, cy); await sleep(30);
      say(`sound click anim=${m.anim} last=${JSON.stringify(lastPlayed)} (expect voice crepe/touch* — 크레페는 감정 대사 없음, volume 0.4)`);
      patchSettings({ sound: { muted: true } });
      fire("mousedown", cx, cy); await sleep(30); fire("mouseup", cx, cy); await sleep(30);
      say(`sound muted last=${JSON.stringify(lastPlayed)} (expect volume 0)`);
      const fromMain = await host.getSettings(id);
      say(`settings roundtrip main.sound=${JSON.stringify(fromMain.sound)} main.skin=${fromMain.skin} (expect muted true, master 0.5, skin Mini_Crepe)`);
      patchSettings({ skin: "Mini_ErpinSkin1" }); say(`voice set erpin skin1 hero=${voiceSet.hero} skin=${voiceSet.skin} n=${voiceCount()}`);
      patchSettings({ skin: "Mini_Dummy" }); say(`voice set dummy hero=${voiceSet.hero} n=${voiceCount()} (expect null/0, no crash: ${playVoice("touch")})`);
      patchSettings({ skin: "Mini_Crepe", sound: { muted: false, master: 0.8, voice: 0.5 } });
      patchSettings({ behavior: { hop: false, jump: false } }); decideIdle(); say(`behavior hop/jump off → state=${m.state} anim=${m.anim} (expect idle/react, not hop/jump)`);
      patchSettings({ behavior: { hop: true, jump: true } });
      patchSettings({ opacity: 0.5 }); say(`opacity skeleton.alpha=${active.skeleton.color.a} (expect 0.5)`); patchSettings({ opacity: 1 });
      // SD 모드: 크레페(게임 추출) → 에르핀 스킨1(사이트 HD) → 스탠딩 없는 더미 → 미니미 폴백
      patchSettings({ mode: "sd", skin: "Mini_Erpin" }); await sleep(3500);
      say(`sd erpin(default, 스탠딩만) active=${active === mini ? "minimi" : active.family} ingameLoaded=${!!sdI.skeleton} state=${m.state} anim=${m.anim} (expect standing, ingame not loaded)`);
      m.state = "idle"; S.behavior.hopChance = 100; decideIdle(); await sleep(150); say(`sd move(default) slot=${active === mini ? "minimi" : active.family} anim=${m.anim} k=${active.k.toFixed(3)} h=${m.h.toFixed(0)} standingBox=${sd.h.toFixed(0)} body=${((bodyHeight(sd) || 0) * sd.k).toFixed(0)} (expect minimi Idle2_1, h = 기본 미니미 크기 ≈ 184)`);
      S.behavior.hopChance = 0; m.state = "idle"; decideIdle(); say(`sd rest after move slot=${active === mini ? "minimi" : active.family} anim=${m.anim} (expect standing)`); S.behavior.hopChance = 45;
      say(`erpin ingame slot loaded=${!!sdI.skeleton} (expect false — 인게임은 스탠딩 없을 때만)`);
      patchSettings({ skin: "Mini_Vela" }); await sleep(2500);
      { const o = new spine.Vector2(), z = new spine.Vector2(); sd.skeleton.getBounds(o, z, []); say(`vela ground: bounds bottom=${(o.y - sd.skeleton.y).toFixed(0)}px ground=${sd.feet.toFixed(0)}px (expect ground 0 = 원점, bottom < 0 = 머리가 지면 아래로) skel.y=${sd.skeleton.y.toFixed(0)} floor=${floorAt(m.x)}`);
        m.state = "idle"; S.behavior.hopChance = 100; decideIdle(); await sleep(100); say(`vela minimi move h=${m.h.toFixed(0)} standingBox=${sd.h.toFixed(0)} body=${((bodyHeight(sd) || 0) * sd.k).toFixed(0)} (expect 기본 미니미 크기 ≈ 184)`); S.behavior.hopChance = 45; }
      patchSettings({ skin: "Mini_Daya" }); await sleep(2500);
      { const o = new spine.Vector2(), z = new spine.Vector2(); sd.skeleton.getBounds(o, z, []); say(`daya ground: bounds bottom=${(o.y - sd.skeleton.y).toFixed(0)}px ground=${sd.feet.toFixed(0)}px skel.y=${sd.skeleton.y.toFixed(0)} m.y=${m.y.toFixed(0)} (expect ground ≈ bottom ≈ 0: 돌 바닥이 지면)`); }
      patchSettings({ skin: "Mini_Erpin" }); await sleep(1500);
      { m.state = "react"; onComplete(active, active.state.getCurrent(0) || { loop: false }); say(`after motion → state=${m.state} anim=${m.anim} timer=${m.timer.toFixed(2)} (expect idle loop, timer≈actGap ${S.behavior.actGap})`); }
      S.behavior.hopChance = 0; m.state = "idle"; decideIdle(); say(`hybrid rest slot=${active.family} anim=${m.anim} (expect standing Idle_*)`); S.behavior.hopChance = 45;
      await settle(); cx = m.x; cy = H - m.y - m.h / 2; fire("mousemove", cx, cy); fire("mousedown", cx, cy); await sleep(30); fire("mouseup", cx, cy); await sleep(60);
      say(`hybrid click slot=${active.family} anim=${m.anim} (expect standing Touch_End)`);
      patchSettings({ skin: "Mini_Crepe" }); await sleep(2500);
      say(`hybrid crepe(인게임 없음) active=${active.family} sdI=${sdI.skeleton ? "loaded" : "-"} (expect standing only)`);

      patchSettings({ skin: "Mini_Crepe" }); await sleep(2500);
      say(`sd crepe active=${active.kind} src=${sd.src} key=${sd.key?.split("/").slice(-2).join("/")} anims=${sd.data?.animations.length} h=${m.h.toFixed(0)} state=${m.state} anim=${m.anim} (expect sd/game/crepe 47 h≈208)`);

      patchSettings({ skin: "Mini_ErpinSkin1" }); await sleep(3000);
      say(`sd erpin skin1 active=${active === mini ? "minimi" : active.family} standing=${sd.key?.split("/").slice(-2).join("/")} ingame=${sdI.key?.split("/").slice(-1)[0]} (expect standing Erpin/ErpinSkin1 + ingame erpinskin1)`);
      await settle(); cx = m.x; cy = H - m.y - m.h / 2; fire("mousemove", cx, cy); fire("mousedown", cx, cy); await sleep(30); fire("mouseup", cx, cy); await sleep(60);
      say(`sd click(볼 당기기) state=${m.state} anim=${m.anim} voice=${lastPlayed?.name} (expect react Touch_End + erpin/touch1*)`);
      { // 교감: 머리 드래그 = 쓰다듬기, 얼굴 드래그 = 볼 당기기, 몸 드래그 = 들기
        await sleep(2600); await settle(); cx = m.x; const o = new spine.Vector2(), z = new spine.Vector2(); sd.skeleton.getBounds(o, z, []); const hb = headBone(sd);
        const g = headGeom(); const topY = H - g.top, neckY = H - g.neckY, hx = g.headX, eyeSY = H - g.eyeY;
        say(`zones(erpin): head=${hb?.data.name} eyes=${eyeBones(sd).length} u=${g.u.toFixed(0)}px zone(top+20)=${zoneAt(hx, topY + 20)} zone(eye)=${zoneAt(hx, eyeSY)} zone(neck+10)=${zoneAt(hx, neckY - 10)} zone(body)=${zoneAt(cx, H - m.y - 30)} zone(beside head)=${zoneAt(hx + 4 * g.u, eyeSY)} (expect head / cheek / cheek / body / body)`);
        const py = topY + 25; fire("mousedown", hx, py); say(`press head → state=${m.state} anim=${m.anim} (expect touch Touch_Idle)`);
        fire("mouseup", hx, py); await sleep(30); say(`tap head(꿀밤 1단) → state=${m.state} anim=${m.anim} voice=${lastPlayed?.name} (expect smash1 Smash_End_1 + erpin/dutchrubend1)`);
        await sleep(1400); say(`꿀밤 2단 → state=${m.state} anim=${m.anim} voice=${lastPlayed?.name} (expect react Smash_End_2 + erpin/dutchrubend2*)`);
        await sleep(3500); await settle(); fire("mousedown", hx, py);
        for (let i = 1; i <= 8; i++) { await sleep(16); fire("mousemove", hx + i * 6, py); } say(`pat drag → state=${m.state} anim=${m.anim} (expect pat Pat_Idle)`);
        fire("mouseup", hx + 48, py); await sleep(30); say(`pat release → state=${m.state} anim=${m.anim} voice=${lastPlayed?.name} (expect react Pat_End + erpin/touch2*)`);
        await sleep(3500); await settle(); sd.skeleton.getBounds(o, z, []); const cy2 = H - (hb ? hb.worldY : o.y + z.y * 0.55) - 12;
        fire("mousedown", hx, cy2); for (let i = 1; i <= 8; i++) { await sleep(16); fire("mousemove", hx + i * 8, cy2 + i * 3); }
        say(`cheek drag → state=${m.state} anim=${m.anim} (expect touch Touch_Idle 유지)`);
        fire("mouseup", hx + 64, cy2 + 24); await sleep(30); say(`cheek release → state=${m.state} anim=${m.anim} voice=${lastPlayed?.name} (expect react Touch_End + erpin/touch1*)`);
        await sleep(3000); await settle(); cx = m.x; let by = H - m.y - 30; fire("mousedown", cx, by); await sleep(700);
        say(`body hold(간지럽히기) → state=${m.state} anim=${m.anim} voice=${lastPlayed?.name} (expect tickle Tickle_Idle_1 + erpin/ticklestart*)`);
        fire("mouseup", cx, by); await sleep(30); say(`tickle release → state=${m.state} anim=${m.anim} voice=${lastPlayed?.name} (expect react Tickle_End + erpin/tickleduring*)`);
        await sleep(4500); await settle(); cx = m.x; by = H - m.y - 30; fire("mousedown", cx, by); for (let i = 1; i <= 8; i++) { await sleep(16); fire("mousemove", cx + i * 4, by - i * 10); }
        say(`body drag → state=${m.state} (expect drag)`); fire("mouseup", cx + 32, by - 80); await sleep(1500); await settle();
        { patchSettings({ skin: "Mini_Opal" }); await sleep(2500); await settle(); const g2 = headGeom(); const hx2 = g2.headX, eyeS = H - g2.eyeY, topS = H - g2.top;
          say(`zones(opal, 큰 모자 hatRatio≈8): u=${g2.u.toFixed(0)} topAboveEye=${(g2.top - g2.eyeY).toFixed(0)}px zone(eye)=${zoneAt(hx2, eyeS)} zone(eye+1.5u 머리)=${zoneAt(hx2, eyeS - 1.5 * g2.u)} zone(top-20 모자)=${zoneAt(hx2, topS + 20)} (expect cheek / head / head — 예전 방식이면 얼굴이 모자 중간까지 올라갔음)`); }
        patchSettings({ skin: "Mini_ErpinSkin1" }); await sleep(2500);
        say(`voice split: cheek=${voiceSet.cats.cheek?.length} pat=${voiceSet.cats.pat?.length} touch=${voiceSet.cats.touch?.length} (expect 3/3/6 for erpin skin1 view)`);
      }
      m.state = "idle"; S.behavior.hopChance = 100; decideIdle(); say(`sd move slot=${active === mini ? "minimi" : active.family} state=${m.state} anim=${m.anim} (expect minimi Idle2_1)`); await sleep(400); S.behavior.hopChance = 45;
      patchSettings({ skin: "Mini_Dummy" }); await sleep(800);
      say(`sd dummy active=${active.kind} (expect minimi fallback)`);
      patchSettings({ skin: "Mini_Crepe", mode: "minimi" }); await sleep(500);
      say(`back to minimi active=${active.kind} h=${m.h.toFixed(0)} (expect minimi 184)`);
      { const pairs = ["Happy_1", "Angry_1", "Sad_1", "Surprise_1", "Eat_1", "Blank_1", "Spawn", "Victory", "Success", "Idle2_4"].map(a => `${a}→${(voiceCatsFor(a) || ["-"]).join("/")}`); say(`motion→voice map: ${pairs.join(", ")}`); }
      patchSettings({ skin: "Mini_Erpin", mode: "sd" }); await sleep(2500);
      { const f = motionVoice("Happy_1", true); say(`motion voice Happy_1 → ${f} (expect erpin/joy* or pleasure*)`); const f2 = motionVoice("Angry_1", true); say(`motion voice Angry_1 → ${f2} (expect erpin/anger*)`); }
      say(`motion voice gating: chance=${S.sound.motionVoiceChance} cooldown=${S.sound.motionVoiceCooldown}s on=${S.sound.motionVoice}`);
      { patchSettings({ sound: { muted: false, master: 0.5, voice: 0.01 } }); playVoice("joy", "touch"); await sleep(300); m.state = "idle"; m.timer = 0.01; await sleep(400); say(`voice hold: voicePlaying=${voicePlaying()} state=${m.state} timer=${m.timer.toFixed(2)} (expect still idle while voice plays, timer≥0.4)`); if (currentVoice) currentVoice.pause(); patchSettings({ sound: { voice: 0.5, master: 0.8 } }); }
      patchSettings({ skin: "Mini_Crepe", mode: "sd" }); await sleep(1500);
      say(`geo: window ${W}x${H}, displays=${geoD.map(d => `[${d.x0}-${d.x1} floor=${d.floor} top=${d.top}${d.primary ? " P" : ""}]`).join(" ")} floorAt(100)=${floorAt(100)} floorAt(W-100)=${floorAt(W - 100)} (expect 2 displays, floor>0 = 작업표시줄 높이)`);
      { const o = m.x; m.state = "idle"; m.x = W - 200; m.y = floorAt(m.x); say(`on 2nd monitor x=${m.x.toFixed(0)} floor=${floorAt(m.x)} (expect that display's floor)`); m.x = o; m.y = floorAt(o); }
      say(`multi: mascots=${mascots.size} ids=${[...mascots.keys()].join(",")} (expect ≥1, one window)`);
      say("DONE");
    }

    Object.assign(self, { start, dispose, onGeo, applySettings, update, pushHitRect, hover, onMouse, spawn, playCmd, preview, announce, emote, meet, logState, moodTest, ingameTest, hudLine, sdAnimations, selftest });
    return self;
  }
})();
