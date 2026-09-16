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
    // 미니미는 그림이 하나라 '표정' 대신 몸짓으로: 행복=만세/폴짝, 미소=갸웃, 분노=공격/늘어나기, 슬픔=풀썩/납작, 놀람=뒤집기, 냠냠=동작, 삐짐=찌그러지기
    moods: { happy: ["Success", "Jump1", "Jump2", "Idle2_2"], smile: ["Act6_1", "Idle1_2", "Idle3_5"], anger: ["Attack1_1", "Attack1_2", "Act5_1"], sad: ["Fail", "Idle2_5", "Idle2_3"], surprise: ["Idle3_7", "Jump3", "Idle2_4"], eat: ["Act2_1", "Act3_1", "Act1_1"], sulky: ["Idle2_3", "Idle2_5", "Act5_1"] },
    speak: ["Act1_1", "Act6_1", "Idle3_5", "Idle3_6", "Act4_1"], listen: ["Idle1_2", "Act6_1", "Idle3_6"],
    all: ["Idle1_1","Idle1_2","Idle2_1","Idle2_2","Idle2_3","Idle2_4","Idle2_5","Idle3_5","Idle3_6","Idle3_7","Act1_1","Act2_1","Act3_1","Act4_1","Act5_1","Act6_1","Jump1","Jump2","Jump3","Success","Fail","Attack1_1","Attack1_2"],
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
      tickleIdle: ["Tickle_Idle_1", "Tickle_Idle"].find(n => data.findAnimation(n)) || null, tickleIdle2: data.findAnimation("Tickle_Idle_2") ? "Tickle_Idle_2" : null, tickleEnd: data.findAnimation("Tickle_End") ? "Tickle_End" : null,
      smash: ["Smash_End_1", "Smash_End"].filter(n => data.findAnimation(n)),
      hold: idles[0] || all[0]?.n, moveSpeed: 90, hopHeight: 22,
      moods: moodPools(all),
      all: all.map(a => a.n),
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
  // 인게임 SD 는 전투 모션뿐이다. 417세트를 전수 조사해서(tools/_ig-survey.mjs) 실제로 있는 것만 쓴다.
  //   Idle 416 · Die 416 · Spawn 416 · Groggy 415 · Move 414 · Victory 413 · Attack1_1 410 · Skill1_1 409
  //   Ultimate1_1 391 · Attack2_1 330 · Experience_1/2 142 · EasterEgg_Victory 47 · EasterEgg_Idle 19 · Aside1_1 6
  // 딴 모습(_Change·_DreamForm·_SebastianForm…)과 작업용 찌꺼기(Test_DUMMY/…·z…·잔상·Groggry)는 고르지 않는다.
  const IG_SKIP = /(\/|^z|^\d|^test$|^잔상$|^Groggry$|_rejected$|dummy|MirrorImage|AlterEgo_|FakeDie|_SebastianForm$|_DreamForm$|_ChangeForm$|_Change$|^OW\d_|^AS\d_|백업)/i;
  function ingamePools(data) {
    const hasA = (n) => !!data.findAnimation(n);
    const ok = (n) => hasA(n) && !IG_SKIP.test(n);
    const keep = (...names) => names.filter(ok);
    return {
      // 대기 중 스스로 하는 것. Idle 을 여러 번 넣어 가끔만 큰 동작이 나오게 한다
      idleActs: ["Idle", "Idle", "Idle", "Idle", ...keep("Victory", "EasterEgg_Idle", "Experience_1", "Experience_2", "Aside1_1", "Attack1_1")].concat(["Idle"]),
      idleQuiet: ["Idle"], idleLoop: new Set(["Idle", "EasterEgg_Idle"]),
      move: ok("Move") ? "Move" : null, jump: [], spawn: keep("Spawn"),
      // 클릭했을 때. 승리·궁극기가 가장 볼만하다 (길면 ONESHOT_CAP 초에서 잘린다)
      // 허수아비(scarecrow*)처럼 공격 모션이 아예 없는 세트가 둘 있어 빈 풀이 되지 않게 받쳐 둔다
      react: keep("Victory", "EasterEgg_Victory", "Ultimate1_1", "Skill1_1", "Attack1_1", "Attack2_1").concat(
        keep("Victory", "Attack1_1").length ? [] : keep("Buff", "Hit_1", "Hit", "Spawn")),
      land: keep("Groggy", "Hit", "Die")[0] || null, drag: keep("Groggy", "Bind", "Idle")[0] || null,
      hold: "Idle", moveSpeed: 120, hopHeight: 18,
      // 전투 모션밖에 없으니: 행복·미소 = 승리, 분노 = 공격·궁극기, 슬픔·삐짐·놀람 = 그로기·피격
      moods: {
        happy: keep("EasterEgg_Victory", "Victory", "Experience_2"), smile: keep("Victory", "Experience_1"),
        anger: keep("Ultimate1_1", "Attack1_1", "Attack2_1", "Skill1_1"), sad: keep("Groggy", "Die"),
        surprise: keep("Hit", "Groggy", "Bind"), eat: keep("Experience_1", "Victory"), sulky: keep("Groggy", "Bind"),
      },
      speak: keep("Aside1_1", "Victory", "Attack1_1"), listen: keep("EasterEgg_Idle", "Idle"),
      all: data.animations.map(a => a.name).filter(n => !IG_SKIP.test(n)),
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
  // WebGL 컨텍스트 상실(GPU 드라이버 갱신·절전 복귀·GPU 프로세스 재시작). spine 의 ManagedWebGLRenderingContext 가 lost 를 preventDefault 하고
  // restored 에 텍스처·셰이더·배처를 다시 올려 주지만, 그 사이 render() 는 매 프레임 던져 초당 30번 에러를 찍고, 복구 뒤엔
  // pma:false 아틀라스가 프리멀티플라이 없이 올라와 가장자리에 흰 테가 돌아온다(GLTexture.restore 는 pixelStorei 를 모른다).
  let glLost = false, glFrames = 0;
  const pmaFix = new Set();    // 업로드 때 UNPACK_PREMULTIPLY_ALPHA 가 필요했던 텍스처 — 복구 뒤 같은 플래그로 다시 올린다
  let miniTextures = [];       // 미니미 아틀라스 텍스처(창이 사는 동안 유지) — pmaFix 추적용으로 붙들어 둔다
  const disposeTex = (t) => { pmaFix.delete(t); try { t.dispose(); } catch {} };
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
  // cheek·pat 은 touch 를 둘로 가른 것이라 따로 세면 같은 파일이 두 번 들어간다(에르핀 스킨1: 6이 12로)
  const countVoices = (vs) => Object.entries(vs.cats).reduce((n, [c, l]) => n + (c === "cheek" || c === "pat" ? 0 : l.length), 0);
  function loadImage(src) { return new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = src; }); }
  // 아틀라스 텍스처 로드. pma:false 아틀라스는 업로드 시 프리멀티플라이해서 PMA 백버퍼와 맞춘다 (가장자리 흰 테 방지)
  async function loadAtlas(atlasPath, dir) {
    const atlas = new spine.TextureAtlas(host.readText(atlasPath));
    const textures = [];
    try {
      for (const page of atlas.pages) {
        const img = await loadImage(`file:///${dir}/${page.name}`);
        ctx.gl.pixelStorei(ctx.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, page.pma ? 0 : 1);
        const tex = new spine.GLTexture(ctx, img); textures.push(tex);
        ctx.gl.pixelStorei(ctx.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
        if (!page.pma) pmaFix.add(tex);
        page.setTexture(tex);
      }
    } catch (e) { for (const t of textures) disposeTex(t); throw e; } // 페이지가 여럿인 아틀라스에서 둘째 그림이 없으면 첫째 GL 텍스처가 아무도 모르게 남는다
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

  // init 이 죽으면 창은 떠 있는데 아무것도 안 그려져 "실행이 안 된다"로만 보였다 — 콘솔은 사용자가 못 본다
  host.on("config", async (c) => { cfg = c; try { await init(); } catch (e) { console.error("init 실패", e && (e.stack || e.message || e)); hud.textContent = `에셋을 읽지 못했어요 — 트레이 → 에셋 다시 가져오기\n${e && e.message || e}`; hud.style.display = "block"; hud.dataset.stuck = "1"; } }); // stuck: 다음 sync 가 디버그 꺼짐이라고 지우지 않게
  host.on("settings", (views) => sync(views));
  host.on("geo", (g) => setGeo(g));
  host.on("cursor", ({ x, y }) => { for (const mas of mascots.values()) mas.hover(x, y); });
  host.on("hit-mouse", (ev) => { if (cfg && cfg.selftest) return; /* 셀프테스트 중엔 진짜 마우스가 캐릭터 위에 있으면 합성 입력과 섞여 드래그로 튐 */ const mas = mascots.get(ev.instance); if (mas && ev.type !== "mouseleave") mas.onMouse(ev); });
  host.on("mascot", (id, cmd, arg) => { const mas = mascots.get(id) || firstMascot(); if (!mas) return; if (cmd === "play") mas.playCmd(arg); else if (cmd === "respawn") mas.spawn(); else if (cmd === "preview") mas.preview(arg); else if (cmd === "announce") mas.announce(arg); else if (cmd === "emote") mas.emote(arg); else if (cmd === "meet") mas.meet(arg); else if (cmd === "logstate") mas.logState(arg); });
  window.addEventListener("contextmenu", (e) => e.preventDefault());

  // 메인이 내려준 캐릭터 뷰 목록과 맞추기: 새 id → 생성, 없어진 id → 제거, 있는 것 → 설정 적용
  async function sync(views) {
    const ids = new Set(views.map(v => v.id));
    for (const [id, mas] of [...mascots]) if (!ids.has(id)) { mas.dispose(); mascots.delete(id); }
    for (const v of views) {
      const mas = mascots.get(v.id);
      if (mas) mas.applySettings(v);
      else { const nm = Mascot(v.id, v); mascots.set(v.id, nm); try { await nm.start(); } catch (e) { console.error("start 실패", v.id, e); } } // 한 명이 실패해도 나머지는 세운다
    }
    if (!hud.dataset.stuck) hud.style.display = debugOn() ? "block" : "none";
  }

  async function init() {
    setGeo(cfg.geo);
    ctx = new spine.ManagedWebGLRenderingContext(canvas, { alpha: true, premultipliedAlpha: true, antialias: true });
    renderer = new spine.SceneRenderer(canvas, ctx, true);
    // spine 이 생성자에서 먼저 등록했으니 같은 이벤트에서 우리 것은 그 뒤에 돈다 — 복구 순서(spine 재업로드 → PMA 재업로드)가 여기에 걸려 있다
    canvas.addEventListener("webglcontextlost", () => { glLost = true; for (const mas of mascots.values()) mas.hideHit(); }, false); // 안 보이는 사도가 클릭을 먹지 않게
    canvas.addEventListener("webglcontextrestored", () => {
      const gl = ctx.gl;
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
      for (const t of pmaFix) try { t.update(false); } catch (e) { console.warn("PMA 재업로드 실패", e); } // update(useMipMaps) — 우리는 밉맵을 안 쓴다
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
      glLost = false; last = performance.now(); acc = 0; // 잃어버린 동안 쌓인 시간을 한 번에 넘기지 않게
    }, false);

    const root = `${cfg.assetRoot}/minimi`;
    const { atlas, textures } = await loadAtlas(`${root}/minimi.atlas`, root);
    miniTextures = textures;
    miniData = new spine.SkeletonBinary(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(host.readBytes(`${root}/minimi.skel`));

    KO.load(cfg.dataRoot || cfg.assetRoot);
    try { voiceIndex = JSON.parse(host.readText(`${cfg.assetRoot}/voice/index.json`)); } catch (e) { console.warn("voice index 없음", e); }
    for (const n of ["jump01", "jump02"]) clips.sfx[n] = `file:///${cfg.assetRoot}/sfx/${n}.wav`;

    await sync(cfg.characters);
    console.log(`MASCOT ready chars=${[...mascots.keys()].join(",")} window=${W}x${H}`);
    host.loaded(buildCatalog());
    requestAnimationFrame(loop);
    if (cfg.selftest) { glTest(); firstMascot()?.selftest(); }
    if (cfg.moodTest) firstMascot()?.moodTest();
    if (cfg.ingameTest) firstMascot()?.ingameTest();
  }

  // 개발용(셀프테스트): WEBGL_lose_context 로 상실→복구를 강제해 위 경로를 실제로 밟는다. 실제 상실은 드라이버 갱신 때나 오니 손으로는 못 본다
  async function glTest() {
    const say = (s) => console.log("GLTEST " + s);
    const ext = ctx.gl.getExtension("WEBGL_lose_context"); if (!ext) { say("WEBGL_lose_context 없음"); return; }
    await sleep(3000); ext.loseContext(); await sleep(200);
    say(`lost glLost=${glLost} isContextLost=${ctx.gl.isContextLost()} (expect true/true)`);
    const n0 = glFrames; await sleep(2000); say(`while lost frames=${glFrames - n0} (expect 0)`);
    ext.restoreContext(); await sleep(1000);
    say(`restored glLost=${glLost} isContextLost=${ctx.gl.isContextLost()} frames=${glFrames - n0} pmaFix=${pmaFix.size} miniTex=${miniTextures.length} (expect false/false, frames>0)`);
  }

  function buildCatalog() {
    const slotIndex = miniData.findSlot("Minimi").index;
    const skins = [];
    for (const sk of miniData.skins) {
      if (sk.name === "default") continue;
      let region = null;
      for (const e of sk.getAttachments()) { if (e.slotIndex === slotIndex && e.attachment && e.attachment.region) { region = e.attachment.region; break; } }
      // 보이스 수는 여기서만 센다 — 설정창이 index.json 을 따로 합쳐 세던 때는 스킨 묶음이 카테고리를 통째로 갈아치워 HUD 와 숫자가 달랐다(에르핀 스킨1)
      const vs = voiceSetFor(sk.name);
      const pv = ["greeting", "pat", "joy", "line"].map(c => vs.cats[c]).concat(Object.values(vs.cats)).find(l => l && l.length);
      skins.push({ name: sk.name, voices: countVoices(vs), voiceCats: Object.fromEntries(Object.entries(vs.cats).filter(([c, l]) => l.length && c !== "cheek" && c !== "pat").map(([c, l]) => [c, l.length])), previewVoice: pv ? pv[0] : null, sd: sdAvailable(sk.name), region: region ? { page: region.page.name, x: region.x, y: region.y, width: region.width, height: region.height, degrees: region.degrees } : null });
    }
    const f = firstMascot();
    return { animations: miniData.animations.map(a => ({ name: a.name, duration: +a.duration.toFixed(2) })), sdAnimations: f ? f.sdAnimations() : [], skins };
  }

  // ---- 프레임: 캐릭터 전부 갱신 → 한 번에 그리기 ----
  let last = performance.now();
  // 다음 프레임 예약이 맨 끝에 있어서, 여기서 예외가 하나 나면 예약이 영영 안 걸린다.
  // 그러면 사도 전원이 그 자리에 얼어붙는데 히트 창은 마지막 자리에 남아 클릭을 계속 가로챈다.
  // 한 프레임이 튀는 것과 창이 죽는 것은 다른 일이다.
  // 스파인 대기 동작 원본이 대개 30fps 라 60 으로 그려도 더 부드러워지지 않는다. 하루 종일 켜 두는
  // 앱이라 그 절반이 그대로 전력과 발열이다. 다만 끌기·던지기는 애니가 아니라 여기서 계산하는
  // 움직임이라 30 이면 손에 뚝뚝 걸린다. 기본은 "손댈 때만 60" — 설정(display.fps)으로 30·60 고정도 된다
  function frameMs() {
    const f = firstMascot(); const want = f ? f.S.display.fps : "auto";
    // 60 은 "매 프레임" — rAF 가 모니터 주사율(100Hz 면 10ms) 단위라 16.7ms 문턱을 두면 둘째 프레임만
    // 통과해 50 이 된다. 주사율대로 그리는 것이 정직하다. 30 은 그 절반쯤으로 묶인다
    if (want === 60 || want === "60") return 0;
    if (want === 30 || want === "30") return 1000 / 30;
    for (const mas of mascots.values()) if (mas.hands) return 0;
    return 1000 / 30;
  }
  let acc = 0, probeN = 0, probeT0 = 0, paused = false;
  host.on("pause", (p) => { paused = !!p; if (!paused) last = performance.now(); }); // 돌아올 때 dt 가 한꺼번에 튀지 않게
  function loop(now) {
    const raw = now - last; last = now;
    acc += raw;
    if (acc < frameMs() - 2 || paused || glLost) { requestAnimationFrame(loop); return; } // paused: 전체화면 뒤에 숨어 있을 때 메인이 알려 준다(document.hidden 은 backgroundThrottling:false 라 늘 false). glLost: 컨텍스트가 돌아올 때까지 그리지 않는다(예약은 유지)
    if (cfg && cfg.fpsProbe) { probeN++; if (!probeT0) probeT0 = now; if (now - probeT0 >= 3000) { const f = firstMascot(); console.log(`FPSPROBE ${(probeN / ((now - probeT0) / 1000)).toFixed(1)} fps  setting=${f ? f.S.display.fps : "?"} hands=${[...mascots.values()].some(x => x.hands)}`); probeN = 0; probeT0 = now; } }
    // 30 으로 묶었을 땐 고정 스텝(정확히 1/30초)으로 넘긴다. 이월분을 dt 에도 넣고 다음 프레임에도 더하면 두 번 세어져
    // 100Hz·144Hz 모니터에서 시간이 4~10% 빨리 흘렀다. 매 프레임 모드는 실제 경과 시간을 쓴다
    const fm = frameMs();
    const dt = fm ? fm / 1000 : Math.min(0.05, acc / 1000);
    acc = fm ? Math.min(acc - fm, fm) : 0;
    try {
      for (const mas of mascots.values()) mas.update(dt);
      render(); glFrames++;
      for (const mas of mascots.values()) mas.pushHitRect(dt);
    } catch (e) { console.error("frame", e && e.stack || e); }
    requestAnimationFrame(loop);
  }
  const bOff = new spine.Vector2(), bSize = new spine.Vector2();
  // getBounds 는 세 번째 인자 배열을 정점 수만큼 키워 쓴다. 매번 새 []를 주면 그 일을 매번 처음부터 한다
  const bTmp = [];
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
      if (dbg) { sk.getBounds(bOff, bSize, bTmp); renderer.rect(false, bOff.x, bOff.y, bSize.x, bSize.y, new spine.Color(1, 0, 0, 1)); }
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
    const HANDS = new Set(["drag", "thrown", "touch", "pat", "tickle", "smash1"]);
    // 상태 우선순위 — 높은 쪽이 진행 중이면 낮은 요청은 미루거나 버린다. 손이 닿아 있는 것이 항상 가장 높다(smash1 도 손: 꿀밤 2단 대사가 소식에 잘렸다).
    //   boot 도 최고: 등장(spawn)이 곧 상태를 잡으니 그 전에 끼어들면 SD 로드 뒤 덮어써져 헛일이다.
    //   land·spawn(7)은 짧은 한 번짜리라 소식은 기다리고 표정(AI 대답)은 자른다. react·pose(5) = 클릭 반응·AI 대답 표정: 소식·기분 변경은 끝날 때까지 기다린다.
    //   emote·meet 는 예전처럼 손만 아니면 끼어든다 — 잡담 대본은 표정을 잇달아 바꾸고(pose→pose), 다가가기가 착지·반응에 막혀 met 를 보내면 상대가 헛기다린다.
    const PRIO = { drag: 9, thrown: 9, touch: 9, pat: 9, tickle: 9, smash1: 9, boot: 9, land: 7, spawn: 7, react: 5, pose: 5, jump: 5, hop: 3, idle: 1, mood: 1 };
    const REQ = { emote: 8, meet: 8, announce: 5, moodChange: 4 };
    const canInterrupt = (req) => (PRIO[m.state] ?? 1) < REQ[req];
    const self = { id, get S() { return S; }, get active() { return active; }, get hands() { return mouse.down || HANDS.has(m.state); } };

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
      // 기분 변경: 대기·이동 중이면 바로, 반응·표정(AI 대답 pose) 중이면 끝난 뒤 — restThenDecide 가 moodOn() 을 보고 decideIdle 로 넘긴다. 대답 중 표정이 잘려 딴 얼굴이 됐었다
      if (prev && prev.mood !== S.mood && canInterrupt("moodChange")) { if (m.state === "hop") { m.vx = m.vy = 0; m.y = floorAt(m.x); if (m.faceAfter) { m.faceAfter = 0; m.pendingEmote = null; met(); } } decideIdle(); } // 만나러 가던 길이면 상대가 8초 상한까지 기다리지 않게 못 간다고 알린다
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
      a.onended = () => { a.removeAttribute("src"); a.load(); }; // 다 들은 요소가 디코더·파일 핸들을 쥔 채 GC 를 기다린다 — 하루 종일 켜 두는 앱이라 놓아 준다
      if (cat === "voice") currentVoice = a;
    }
    // 앞 카테고리에 파일이 하나라도 있으면 거기서 멈추던 것을, 후보를 다 합쳐 고르게 바꿨다.
    // 벨라는 greeting 이 1개뿐이라 클릭할 때마다 같은 인사만 나왔다(joy 5·pleasure 5·line 3 을 두고도).
    // 앞에 적은 카테고리일수록 자주 나오게 가중치를 준다 — 순서의 뜻은 살린다
    // 클릭처럼 '아무 말이나' 하는 자리: 여러 묶음을 앞쪽에 무게를 두고 섞어 같은 말이 되풀이되지 않게 한다
    function playVoice(...cats) {
      const pool = [];
      cats.forEach((c, n) => { const l = voiceSet.cats[c]; if (!l || !l.length) return;
        const w = Math.max(1, cats.length - n); for (let k = 0; k < w; k++) pool.push(...l); });
      return playFrom(pool);
    }
    // 뜻이 정해진 자리(쓰다듬기·볼 당기기·간지럽히기·등장): 전용 대사만 쓴다.
    // 섞어 버리면 전용이 묻힌다 — 쓰다듬기 전용 대사는 셋인데 pleasure·joy 열 개와 같이 담겨 41% 밖에 안 나왔다.
    // 게임 파일은 쓰다듬기·볼 당기기 3개, 등장 2개, 간지럽히기 1개가 표준이다.
    // 전용이 둘 이상이면 그것만, 하나뿐이면 같은 말만 되풀이되니 뒤 묶음을 보탠다.
    const OWN_MIN = 2;
    function playVoiceOwn(...cats) {
      const lists = cats.map(c => voiceSet.cats[c]).filter(l => l && l.length);
      if (!lists.length) return null;
      const own = lists[0];
      if (own.length >= OWN_MIN) return playFrom(own);              // 전용 대사가 넉넉하면 그것만
      const extra = lists.slice(1).flat();                          // 모자라면 뒤 묶음을 보태되,
      const reps = Math.max(1, Math.ceil(extra.length / own.length)); // 전용이 절반은 되게 되풀이해 넣는다
      return playFrom([...extra, ...Array.from({ length: reps }, () => own).flat()]);
    }
    // 클릭: 아무 말이나 — 전용 대사(쓰다듬기·등장·간지럼)는 넣지 않는다.
    // 크레페처럼 감정 보이스가 하나도 없는 사도(8~16명)는 말을 잃으므로 그때만 쓰다듬기 대사로 받친다.
    // cheek(볼 당기기 "당기지 마!")는 넣지 않는다 — 클릭했을 뿐인데 아파하는 소리가 난다
    function sayOnClick() { return playVoice("greeting", "line", "joy", "pleasure") || playVoiceOwn("pat"); }
    function playFrom(pool) {
      if (!pool.length) return null;
      const f = pick(pool); playSound("voice", f, `file:///${cfg.assetRoot}/voice/${f}`); return f;
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
      // playVoiceOwn 은 앞 카테고리가 비면 뒤로 내려가므로, 게이트도 실제로 나올 묶음 기준으로 — victory 가 없는 사도는 joy(짧은 리액션)가 나오는데 대사 게이트(30%/15초)에 걸려 조용했다
      const played = cats.find(c => (voiceSet.cats[c] || []).length) || cats[0];
      const emote = EMOTE_CATS.has(played);
      if (!force) {
        if (emote) { if (Math.random() * 100 >= (S.sound.emoteVoiceChance ?? 85)) return null; if (now - lastEmoteAt < 2.5) return null; }
        else { if (Math.random() * 100 >= S.sound.motionVoiceChance) return null; if (now - lastMotionVoiceAt < S.sound.motionVoiceCooldown) return null; }
      }
      // 매핑표(motion-voice.js)는 "순서대로 첫 매치, 앞 카테고리가 없으면 뒤로 폴백"이 원칙이다 — 섞으면 안 된다.
      // 섞고 있었던 탓에 Victory 모션에 전투 승리 대사(2개) 대신 웃음소리(pleasure·joy 10개)가 더 자주 나왔다.
      const f = playVoiceOwn(...cats); if (f) { if (emote) lastEmoteAt = now; else lastMotionVoiceAt = now; } return f;
    }

    // ---- 캐릭터 런타임 상태 ----
    const m = { state: "boot", x: 300, y: 0, vx: 0, vy: 0, rot: 0, timer: 0, targetX: 0, anim: "", over: false, get w() { return active.w; }, get h() { return active.h; } };
    const mouse = { down: false, dragging: false, sx: 0, sy: 0, gx: 0, gy: 0, offX: 0, offY: 0, hist: [], zone: "body" };
    let tickleT = 0; // 간지럽히기 중 웃음 간격
    // 문지르기 판정: 18px 한 번 스쳐도 간지럽히기가 시작돼 '톡 친 것'과 구별이 안 됐다.
    // 좌우로 방향이 한 번 이상 바뀌고(왕복) 누적 이동이 충분할 때만 간지럽히기로 본다
    const rub = { last: 0, dir: 0, travel: 0, turns: 0 };
    // 몸 제스처 셋: **톡**(안 움직이고 뗌) = 가벼운 반응 / **왕복으로 문지르기**(좌우로 방향 바꿔 가며 RUB_TRAVEL 이상) = 간지럽히기 / **위아래로 끌기**(세로 LIFT_DY 이상) = 들어올리기
    //   누른 채 가만히 있으면 아무것도 안 함(0.5초 홀드→간지럽히기는 톡 반응과 번갈아 튀어 뺐다). 간지럽히는 동안은 Tickle_Idle_1 루프 하나만
    //   (방향 바뀔 때 Tickle_Idle_2로 갈아타면 사도마다 1초 넘는 딴 동작이라 "터치↔간지럽히기"가 반복돼 보였다). 문지르기 중 가로는 LIFT_DX까지 자유
    const LIFT_DY = 45, LIFT_DX = 260, RUB_TRAVEL = 40, TAP_PX = 12; // px  (TAP_PX 미만 = 톡 친 것 · RUB_TRAVEL = 왕복 문지르기로 볼 누적 이동)

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
      if (!miniData.findSkin(S.skin)) { S.skin = "Mini_Crepe"; host.setSettings({ skin: S.skin }, id); } // 메인에도 알린다 — 설정창은 여전히 없는 스킨을 가리키고 있었다
      setSkin(S.skin, false);
      { const p = geoD.find(d => d.primary) || geoD[0]; m.x = p ? (p.x0 + p.x1) / 2 + (Math.random() - 0.5) * (p.x1 - p.x0) * 0.4 : W / 2; }
      await activateMode(true);
    }
    // activating++ 로 진행 중인 activateMode 를 무효화한다 — 캐릭터를 지우는 도중 SD 로드가 끝나면 내려놓은 슬롯에 다시 채워 넣고(텍스처 누수) spawn() 이 죽은 미니미 스켈레톤을 건드렸다
    function dispose() { disposed = true; activating++; clearTimeout(announceTimer); unloadSlot(sd); unloadSlot(sdI); mini.skeleton = null; mini.state = null; if (currentVoice) currentVoice.pause(); hideHit(); }
    function hideHit() { lastHit = null; host.hitRect({ x: 0, y: 0, w: 0, h: 0 }, id); } // lastHit 을 비워야 다음 pushHitRect 가 같은 자리라도 다시 보낸다
    function onGeo() { if (m.state !== "boot") { m.x = clampX(m.x); if (m.state !== "thrown" && m.state !== "drag") m.y = floorAt(m.x); } }

    async function loadSlot(slot, r) {
      if (!r) { slot.want = null; unloadSlot(slot); return false; }
      const key = `${r.dir}/${r.stem}`;
      slot.want = key; // 스킨을 빠르게 두 번 바꾸면 먼저 시작한(느린) 로드가 나중에 끝나 새 스킨 위에 옛 스킨을 덮어썼다 (이미 든 것으로 돌아오는 요청도 진행 중인 로드를 무효화해야 한다)
      if (slot.key === key && slot.skeleton) return true;
      const { atlas, textures } = await loadAtlas(`${r.dir}/${r.stem}.atlas`, r.dir);
      if (slot.want !== key || disposed) { for (const t of textures) disposeTex(t); return false; }
      const data = new spine.SkeletonBinary(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(host.readBytes(`${r.dir}/${r.stem}.skel`));
      unloadSlot(slot);
      makeChar(slot, data); slot.headBoneCached = undefined; slot.eyeBonesCached = undefined; slot.ctrlCache = undefined; slot.hideCache = null; slot.textures = textures; slot.key = key; slot.src = r.src; slot.A = r.src === "ingame" ? ingamePools(data) : sdPools(data); slot.family = r.src === "ingame" ? "ingame" : "standing";
      const skin = data.findSkin("Normal") || data.skins.find(s => s.name !== "default"); if (skin) slot.skeleton.setSkin(skin);
      slot.skeleton.setSlotsToSetupPose();
      return true;
    }
    function unloadSlot(slot) {
      if (active === slot) active = (slot !== sd && sd.skeleton) ? sd : mini; // 그리는 중인 슬롯을 내리면 안전한 쪽으로
      for (const t of slot.textures || []) disposeTex(t); slot.textures = []; slot.skeleton = null; slot.state = null; slot.data = null; slot.key = null; slot.headBoneCached = undefined; slot.eyeBonesCached = undefined; slot.ctrlCache = undefined; slot.hideCache = null; if (slot === sd) grab.kind = null;
    }
    let activating = 0, disposed = false;
    async function activateMode(first) {
      const want = S.mode === "sd" || S.mode === "ingame" ? "sd" : "minimi";
      const seq = ++activating;
      if (active === sdI) active = sd.skeleton ? sd : mini; // 전환 동안 인게임 슬롯이 교체될 수 있음
      if (want === "sd") {
        let ok = false;
        // 로드 하나가 끝날 때마다 아직 내 차례인지 본다. loadSlot 은 뒤에 온 요청에 밀리면 false 를 돌려주는데,
        // 그걸 "스탠딩이 없다"로 읽고 인게임 폴백을 시작하면 새 요청이 막 든 sd 슬롯을 옛 요청의 폴백이 덮어쓴다
        const stale = () => seq !== activating || disposed;
        try {
          if (S.mode === "ingame") {
            // 인게임 형태: 전투·마이홈 SD 스켈레톤을 그대로 (Move로 걷고 Spawn으로 등장). 없으면 스탠딩으로 대체
            unloadSlot(sdI);
            ok = await loadSlot(sd, resolveIngame(S.skin));
            if (!ok && !stale()) ok = await loadSlot(sd, resolveSD(S.skin));
          } else {
            // SD = 스탠딩(대기·상호작용). 스탠딩이 없는 캐릭터만 인게임 SD로 대체
            const okS = await loadSlot(sd, resolveSD(S.skin));
            if (stale()) throw null;
            const okI = !okS ? await loadSlot(sdI, resolveIngame(S.skin)) : (unloadSlot(sdI), false);
            if (stale()) throw null;
            if (!okS && okI) { await loadSlot(sd, resolveIngame(S.skin)); unloadSlot(sdI); }
            ok = okS || okI;
          }
        } catch (e) { if (e !== null) console.warn("SD 로드 실패", e); }
        if (disposed) { unloadSlot(sd); unloadSlot(sdI); return; } // 로드 중에 캐릭터가 지워졌다 — 방금 든 것을 다시 내려놓는다
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
    function preview(cat) { if (cat === "voice") playVoice("greeting", "pat", "line"); else playSfx("jump02"); }
    function playCmd(name) { playOnce(name, "react"); motionVoice(name, true); }
    // 새 소식 알림: 말풍선은 메인이 띄우고, 여기선 "말하는" 모션 + 인사/잡담 대사. 잡고 있거나 공중이면 건드리지 않음
    let holdUntil = 0; // 말풍선이 떠 있는 동안은 돌아다니지 않음 (말풍선은 제자리 고정이라 캐릭터가 가버리면 이상함)
    const holding = () => performance.now() < holdUntil;
    // 다른 사도 쪽으로 다가가서(창 기준 x) 그쪽을 본다 — 둘이 잡담할 때. 도착하면 holdUntil 동안 제자리
    // 도착했거나 갈 수 없으면(손에 잡혀 있음) 메인에 met 를 보낸다 — 오지 않을 사람을 상대가 기다리지 않게. preload 가 아직 없을 수 있어 있는지 보고 부른다
    const met = () => { if (host.met) host.met(id); };
    function meet(arg) {
      if (!arg || typeof arg.x !== "number") return;
      if (!canInterrupt("meet")) { met(); return; }
      holdUntil = Math.max(holdUntil, performance.now() + (arg.hold || 30000));
      // 메인이 자리(to)를 정해 주면 거기로(둘이 동시에 움직여도 겹치지 않게 중간점 기준), 아니면 상대 옆(폭 절반씩 + 여유)
      const gap = ((m.w || 120) + (arg.w || m.w || 120)) / 2 + 48;
      const target = clampX(typeof arg.to === "number" ? arg.to : (arg.x < m.x ? arg.x + gap : arg.x - gap));
      if (Math.abs(target - m.x) < 12) { facing = arg.x < m.x ? -1 : 1; applyFacing(); met(); return; }
      if (isSD()) useSlot(slotForMove());
      m.state = "hop"; m.hopT = 0; m.targetX = target; facing = m.targetX < m.x ? -1 : 1; applyFacing(); m.pendingEmote = null; // 끊긴 지난 만남의 표정이 이번 도착에 튀어나오지 않게
      play(active.A.move && has(active.A.move) ? active.A.move : active.A.hold, true);
      m.faceAfter = arg.x < m.x ? -1 : 1; // 도착하면 상대를 본다 (restThenDecide 뒤)
    }
    // AI 대답의 감정 태그 → 그 표정 애니 한 번 + 감정 소리. SD가 아니거나 풀이 없으면 반응 애니로
    // AI 대답/잡담의 감정 → 표정 애니를 한 번 재생하고 마지막 프레임에서 멈춰(pose) 말풍선이 떠 있는 동안 그 표정을 유지.
    //   mood 없음: role=speak(말하는 쪽)면 Talk/Point/Blank 같은 '말하는' 포즈, role=listen(듣는 쪽)이면 Blank/Think/Nodding '듣는' 포즈
    function emote(arg) {
      const mood = arg && arg.mood; if (arg && arg.hold) holdUntil = Math.max(holdUntil, performance.now() + arg.hold);
      if (!canInterrupt("emote")) return;
      if (m.state === "hop" && m.faceAfter) { m.pendingEmote = arg; return; } // 다가가는 중(meet) — 표정을 지금 바꾸면 이동이 끊겨 상대 옆에 못 간다. 도착하면 그때 한다(우선순위가 아니라 순서 문제라 표에 없다)
      if (isSD()) useSlot(slotForRest());
      const A = active.A;
      const pool = mood && A.moods ? (A.moods[mood] || []).filter(has) : [];
      const SPEAK = A.speak || ["Talk_1", "Talk_2", "Point_1", "Blank_1", "Happy_1", "Proud_1", "Taunt_1"], LISTEN = A.listen || ["Blank_1", "Blank_2", "Nodding_1", "Think_1", "Thinking_1", "Curious_1", "Question_1"]; // 형태별 (미니미/인게임은 자기 목록)
      const role = arg && arg.role;
      // 대본이 동작을 지정하면(act: 'Sleepy' 같은 접두어) 그것부터. 스킨마다 있는 애니가 달라 없으면 감정 풀로 떨어진다
      const want = arg && arg.act ? (A.all || []).filter(n => n.toLowerCase().startsWith(String(arg.act).toLowerCase())).filter(has) : [];
      let a = want.length ? pick(want) : (pool.length ? pick(pool) : null);
      if (!a) { const cands = (role === "listen" ? LISTEN : role === "speak" ? SPEAK : []).filter(has); a = cands.length ? pick(cands) : (mood ? (A.react || []).find(has) : null); }
      m.rot = 0; m.vx = m.vy = 0; m.y = floorAt(m.x);
      if (!a) return;
      const poseMs = arg && arg.pose ? arg.pose : 0;
      if (poseMs > 0 && !A.idleLoop.has(a)) {
        // 말풍선이 떠 있는 동안: 멈춰 있지 않고 같은 감정의 변형을 이어서 재생 (끝나면 onComplete가 다음 변형을 고름)
        const cands = (role === "listen" ? LISTEN : SPEAK).filter(has);
        m.posePool = pool.length ? pool : (cands.length ? cands : [a]);
        play(a, false); m.state = "pose"; m.timer = poseMs / 1000;
      }
      else playOnce(a, "react");
      if (mood && S.sound.clickVoice !== false && role !== "listen") motionVoice(a, true);
    }
    function logState(tag) { console.log(`STATE[${tag}] ${m.state} anim=${m.anim} timer=${(m.timer || 0).toFixed(1)} facing=${facing}`); }
    // 소식은 급하지 않다: 꿀밤 1단·AI 대답 표정·착지 도중이면 자르지 않고 1.5초 뒤에 다시 본다(3번까지, 그래도 막혀 있으면 말풍선만으로 끝). hold 는 첫 호출에서만 늘린다
    let announceTimer = 0;
    function announce(arg, tries = 0) {
      if (arg && arg.hold) holdUntil = Math.max(holdUntil, performance.now() + arg.hold);
      if (!canInterrupt("announce")) { clearTimeout(announceTimer); if (tries < 3 && !disposed) announceTimer = setTimeout(() => announce({ ...arg, hold: 0 }, tries + 1), 1500); return; }
      if (isSD()) useSlot(slotForRest());
      const A = active.A;
      const cand = active === mini ? ["Idle3_7", "Act1_1", "Success", "Idle2_4"] : ["Talk_1", "Point_1", "Hi_1", "Happy_1", "Blank_1", "Proud_1", ...(A.react || [])];
      const a = cand.find(has) || A.hold;
      m.rot = 0; m.vx = m.vy = 0; m.y = floorAt(m.x); playOnce(a, "react");
      if (arg && arg.sound !== false && S.sound.clickVoice !== false) sayOnClick();
    }

    function setSkin(name, greet) {
      const skin = miniData.findSkin(name);
      if (skin) { mini.skeleton.setSkin(skin); mini.skeleton.setSlotsToSetupPose(); miniRawH = 0; }
      selectVoiceSet(name);
      if (greet) playVoice("greeting", "spawn", "pat");   // touch 는 볼 당기기 대사를 품고 있어 인사로 쓰지 않는다
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
      sk.getBounds(off, size, bTmp);
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
      if (!miniRawH) { const sk = mini.skeleton; const sx = sk.scaleX, sy = sk.scaleY; sk.scaleX = 1; sk.scaleY = 1; sk.setToSetupPose(); sk.setSlotsToSetupPose(); hideExtraSlots(mini); sk.updateWorldTransform(); const o = new spine.Vector2(), z = new spine.Vector2(); sk.getBounds(o, z, bTmp); miniRawH = Math.max(1, z.y); sk.scaleX = sx; sk.scaleY = sy; }
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
      const o = new spine.Vector2(), z = new spine.Vector2(); sk.getBounds(o, z, bTmp);
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
    // 매 프레임 불린다(애니가 어태치먼트를 되살리므로). 스탠딩 리그는 슬롯이 수백 개라
    // 그때마다 전부 정규식에 넣으면 초당 수만 번이 된다. 대상은 스켈레톤마다 고정이니 한 번만 고른다
    function hideExtraSlots(slot = active) {
      if (!slot.skeleton) return;
      if (!slot.hideCache) slot.hideCache = slot.skeleton.slots.filter(s => slot === mini ? HIDE_SLOTS.has(s.data.name) : HIDE_SD_SLOTS.test(s.data.name));
      for (const s of slot.hideCache) s.setAttachment(null);
    }

    // ---- 애니 제어 (현재 형태에 있는 애니만) ----
    // spine 의 findAnimation 은 빈 이름에 null 을 주지 않고 예외를 던진다. land·hold 는 null 이 될 수 있다
    const has = (name) => !!name && !!active.data.findAnimation(name);
    const firstOf = (...names) => names.find(has) || null;
    // 한 번짜리 모션은 이보다 길게 붙들지 않는다. 인게임 Victory 는 중앙값 9.8초·최장 23.4초여서
    // 예전에는 "4초 이하"로 아예 걸러 버렸고, 그 탓에 사도 413명 중 258명은 승리 모션을 볼 수 없었다.
    // animationEnd 를 줄이면 그 지점에서 complete 가 떠 평소대로 대기 동작으로 섞여 들어간다(defaultMix).
    const ONESHOT_CAP = 6;
    // complete 하나로 대기에 돌아오는 상태들. complete 가 안 오면(엔트리 교체·트랙 비움) 그 상태에 영영 서 있으니 update 가 시간을 세어 강제로 돌려놓는다
    const ONESHOT_STATES = new Set(["react", "jump", "land", "spawn", "smash1"]);
    function play(name, loop) {
      if (!has(name)) name = firstOf(active.A.hold, "Idle_1", "Idle1_1");
      if (!name) return null;
      m.anim = name;
      const e = state().setAnimation(0, name, loop);
      if (!loop && e && e.animationEnd > ONESHOT_CAP) e.animationEnd = ONESHOT_CAP;
      return e;
    }
    function playOnce(name, nextState) { m.state = nextState; m.rot = 0; m.oneT = 0; play(name, false); }
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
      if (cfg.logPos) console.log(`COMPLETE[${id}] state=${m.state} anim=${m.anim} entry=${entry.animation && entry.animation.name} cur=${slot.state.getCurrent(0) && slot.state.getCurrent(0).animation.name} active=${slot === active}`);
      if (slot !== active) return;
      if (entry !== slot.state.getCurrent(0)) return; // 교체된 옛 엔트리의 지연 complete 무시
      if (entry.loop) return;
      if (m.state === "smash1") { playOnce("Smash_End_2", "react"); if (S.sound.clickVoice) smashLine(); return; }
      if (m.state === "spawn" && S.sound.landSfx) playSfx("jump02");
      if (m.state === "pose") { // 표정 유지 중 — 같은 감정의 다른 변형(없으면 같은 것)을 이어서 재생, 타이머가 끝내 준다
        const pool = (m.posePool || []).filter(has); if (!pool.length) return;
        const next = pool.length > 1 ? pick(pool.filter(n => n !== m.anim)) : pool[0];
        play(next, false); return;
      }
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
      if (S.sound.spawnVoice) playVoiceOwn("spawn", "greeting");
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
        m.state = "hop"; m.hopT = 0; m.faceAfter = 0; m.pendingEmote = null; // meet 가 남긴 것이 다음 산책에 새어 들면 도착해서 엉뚱한 쪽을 보며 표정을 짓는다
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
      if (ONESHOT_STATES.has(m.state)) { if ((m.oneT = (m.oneT || 0) + dt) > ONESHOT_CAP + 2) { console.warn(`oneshot watchdog ${m.state}/${m.anim}`); restThenDecide(); } } else m.oneT = 0;
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
          if ((dir > 0 && m.x >= m.targetX) || (dir < 0 && m.x <= m.targetX) || dir === 0) {
            // restThenDecide 가 다시 hop 을 고를 수 있다(moodOn → decideIdle). 그때 상대 쪽으로 돌려놓으면 가는 방향과 반대를 보며 걷는다
            const fa = m.faceAfter, pe = m.pendingEmote; m.faceAfter = 0; m.pendingEmote = null;
            m.x = m.targetX; restThenDecide();
            if (fa && m.state !== "hop") { facing = fa; applyFacing(); }
            if (fa) met(); // 다가가기(meet)였다 — 도착을 메인에 알린다
            if (pe) emote(pe); // 오는 동안 미뤄 둔 표정
          }
          break;
        }
        case "touch": case "pat": case "tickle": // 누르고 있는 동안 — 바닥에 서서 해당 루프 애니
          m.y = floorAt(m.x); m.rot = 0;
          if (m.state === "tickle") { tickleT += dt; if (tickleT > 2.5) { tickleT = 0; if (S.sound.clickVoice) playVoiceOwn("tickleduring", "ticklestart"); } } // 계속 간지럽히면 계속 웃음
          break;
        case "drag":
          m.x = clampX(mouse.gx); m.y = mouse.gy; // 창 밖으로 끌고 나가면 히트 창이 따라 나가 놓을 수도 잡을 수도 없어진다
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
              if (S.sound.landVoice) { if (!motionVoice(m.anim, true)) playVoice("surprise", "hit", "sorry", "anger"); } // ticklestart(간지럼 웃음)는 여기 쓸 것이 아니다
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
      const gb = grabBone(); if (gb) { gb.x = gb.data.x; gb.y = gb.data.y; }
      state().update(dt); state().apply(sk);
      if (gb) grabApply(gb, dt); // 볼 당기기/쓰다듬기: 조작 본을 커서 쪽으로 (애니 값 위에 오프셋)
      hideExtraSlots();
      const rb = sk.getRootBone(); rb.rotation = rb.data.rotation + m.rot * Math.sign(sk.scaleX);
      sk.updateWorldTransform();
    }
    const hudLine = () => `[${id}] 형태=${S.mode}/${active === mini ? "minimi" : active.family} 상태=${m.state} 애니=${KO.anim(m.anim)} (${m.anim})\nx=${m.x.toFixed(0)} y=${m.y.toFixed(0)} vx=${m.vx.toFixed(0)} vy=${m.vy.toFixed(0)} 회전=${m.rot.toFixed(1)}\n마우스 위=${m.over} 영역=${mouse.zone} 조작본=${grab.kind ? `${grab.kind} ${grab.dx.toFixed(0)},${grab.dy.toFixed(0)}px→${(grabOffsetPx(grab.kind) ?? 0).toFixed(0)}px` : "-"} 캐릭터=${KO.skinName(S.skin)} 크기=${scale()} 보이스=${voiceCount()}`;
    const bo = new spine.Vector2(), bs = new spine.Vector2();
    let lastHit = null, hitT = 0, hitBox = null;
    function pushHitRect(dt) {
      hitT += dt; if (hitT < 1 / 30 || !active.skeleton) return; hitT = 0; // 30Hz
      active.skeleton.getBounds(bo, bs, bTmp);
      hitBox = { x: bo.x, y: H - (bo.y + bs.y), w: bs.x, h: bs.y }; // 창 기준(y 아래로) — hit() 가 돌려 쓴다
      const pad = 10;
      const r = { x: bo.x - pad, y: H - (bo.y + bs.y) - pad, w: bs.x + pad * 2, h: bs.y + pad * 2 }; // 창 기준 px (y 아래로)
      if (lastHit && Math.abs(lastHit.x - r.x) < 1 && Math.abs(lastHit.y - r.y) < 1 && Math.abs(lastHit.w - r.w) < 1 && Math.abs(lastHit.h - r.h) < 1) return;
      lastHit = r; host.hitRect(r, id);
    }

    // ---- 마우스 (이 캐릭터의 히트 창에서 온 이벤트만) ----
    // 바깥(메인)이 커서를 16ms 마다 물어 오므로 여기서 getBounds 를 돌리면 초당 60번 넘게
    // 전신 정점을 다시 계산한다 — 그리는 일과 맞먹는 양이 렌더 루프와 별개로 더 돈다.
    // pushHitRect 가 30Hz 로 이미 구해 둔 것을 쓴다(최대 33ms 묵은 값이라 손맛에 차이가 없다)
    function hit(px, py) {
      if (!active.skeleton) return false;
      if (!hitBox) { active.skeleton.getBounds(bo, bs, bTmp); hitBox = { x: bo.x, y: H - (bo.y + bs.y), w: bs.x, h: bs.y }; }
      return px >= hitBox.x && px <= hitBox.x + hitBox.w && py >= hitBox.y && py <= hitBox.y + hitBox.h;
    }
    // 머리 본(교감 영역·볼 당기기용). 없으면 null → 높이 비율로 판정
    function headBone(slot) { if (slot.headBoneCached === undefined) { const sk = slot.skeleton; slot.headBoneCached = sk ? (sk.bones.find(b => /^(S\d_)?Head$/i.test(b.data.name)) || sk.bones.find(b => /head/i.test(b.data.name) && !/hair|ac|ct|rct/i.test(b.data.name)) || null) : null; } return slot.headBoneCached; }
    // 누른 위치가 캐릭터의 어디인가: "head"(머리 위쪽 → 쓰다듬기) / "cheek"(얼굴 → 볼 당기기) / "body"(들어서 던지기). 스탠딩(SD)에서만
    // 눈 본(얼굴 높이 기준). 눈썹·속눈썹·하이라이트 제외
    function eyeBones(slot) { if (slot.eyeBonesCached === undefined) { const sk = slot.skeleton; slot.eyeBonesCached = sk ? sk.bones.filter(b => /eye/i.test(b.data.name) && !/brow|lash|light|shadow|ac/i.test(b.data.name)) : []; } return slot.eyeBonesCached; }
    // 머리/얼굴 기하(픽셀, 월드): neckY = Head 본(목), eyeY = 눈 높이, u = 눈-목 거리(얼굴 반높이 정도). 바운딩 상단은 모자·뿔·머리장식 때문에 쓰지 않는다
    // (tools/head-survey.mjs: 137명 중 눈-목 거리 중앙값 69유닛, 상단-눈 거리는 모자 유무로 3~8배 차이)
    //   게임의 교감 기준점(Character_Ball_Move = 볼, Character_Pat = 이마·머리선, Character_Tickle = 배)이 있으면 그걸로 보정: 머리 중심 x = Character_Pat.x,
    //   얼굴 윗선 = Character_Pat 바로 아래(그 위부터 쓰다듬기·꿀밤). 기준점은 점이라 영역 폭·아랫선은 여전히 눈-목 거리로 잡는다(게임의 콜라이더 모양은 스켈레톤에 없음)
    function headGeom() {
      const sk = active.skeleton, k = Math.abs(sk.scaleY) || 1, hb = headBone(active), eyes = eyeBones(active);
      const ball = ctrlBone(active, "cheek"), pat = ctrlBone(active, "pat");
      sk.getBounds(bo, bs, bTmp);
      const neckY = hb ? hb.worldY : (ball ? ball.worldY - 45 * k : bo.y + bs.y * 0.55), headX = pat ? pat.worldX : hb ? hb.worldX : bo.x + bs.x / 2;
      let d = eyes.length ? eyes.reduce((a, b) => a + b.worldY, 0) / eyes.length - neckY : 0;
      if (d < 20 * k) d = 65 * k; // 눈 본이 없거나 Head 본이 눈보다 위(주비·림)면 표준값
      const u = Math.max(d, 60 * k); // 영역 크기 단위: 눈-목이 유난히 짧은 리그(오팔 44유닛)도 얼굴 영역이 너무 작아지지 않게 하한
      let browY = neckY + d + 0.6 * u; // 얼굴 윗선(눈썹)
      if (pat && ball && pat.worldY > ball.worldY) browY = Math.min(browY, pat.worldY - 0.1 * (pat.worldY - ball.worldY)); // 게임 기준점: Character_Pat부터는 머리
      return { neckY, headX, eyeY: neckY + d, browY, u, top: bo.y + bs.y, anchors: !!(pat && ball) };
    }
    // 누른 위치가 캐릭터의 어디인가: "cheek"(얼굴: 턱~눈썹) / "head"(눈썹 위: 머리카락·모자·장식 전부 → 쓰다듬기·꿀밤) / "body". 스탠딩(SD)에서만
    function zoneAt(px, py) {
      if (!isSD() || active !== sd) return "body";
      const g = headGeom(), wy = H - py, dx = Math.abs(px - g.headX);
      if (wy < g.neckY - 0.2 * g.u || dx > 3.2 * g.u) return "body";      // 목 아래 / 머리 옆(팔·날개)
      if (wy <= g.browY) return dx <= 2.2 * g.u ? "cheek" : "body";        // 턱~눈썹 = 얼굴
      return "head";                                                          // 눈썹 위 = 머리 (모자·뿔 포함)
    }
    // ---- 교감 조작 본: 게임이 손가락 위치로 끌고 다니는 본 (스탠딩 스켈레톤 444/496세트, 비플레이어블만 없음) ----
    //   Character_Ball_Move(볼 옆) — Touch_Idle이 제약 `Face_CT ← Character_Ball_Move`(mix 0.5)를 켠다 → 본을 끌면 얼굴(볼)이 절반만큼 따라 늘어난다 = 볼 당기기
    //   Character_Pat(정수리)     — Pat_Idle이 제약 `Face_CT ← Character_Pat`(mix 0.5)를 켠다 → 쓰다듬는 손을 얼굴이 따라온다
    //   누른 지점부터의 이동량(창 px)을 본 부모의 로컬 좌표로 바꿔 애니 값 위에 더한다(절대 위치로 옮기면 누른 자리가 본과 멀 때 얼굴이 튄다). 놓으면 짧게 감쇠해 제자리로.
    const CTRL = { cheek: { re: /^Character_Ball_Move$/, max: 150 }, pat: { re: /^Character_Pat$/, max: 110 } }; // max = 스켈레톤 단위, 고무줄처럼 부드럽게 제한
    function ctrlBone(slot, kind) { const c = slot.ctrlCache || (slot.ctrlCache = {}); if (c[kind] === undefined) { const sk = slot.skeleton; c[kind] = sk ? sk.bones.find(b => CTRL[kind].re.test(b.data.name)) || null : null; } return c[kind]; }
    const grab = { kind: null, sx: 0, sy: 0, dx: 0, dy: 0 }; // kind: cheek|pat, s = 누른 위치(창 px, y 위로), d = 끌린 양(px)
    function grabStart(kind, px, wy) { grab.kind = kind; grab.sx = px; grab.sy = wy; grab.dx = grab.dy = 0; }
    function grabMove(px, wy) { if (grab.kind) { grab.dx = px - grab.sx; grab.dy = wy - grab.sy; } }
    // 프레임: 애니 적용 전 본을 셋업값으로 되돌리고(키가 없는 본은 apply가 안 건드려 오프셋이 누적됨), 적용 뒤 오프셋을 더한다
    function grabBone() { return grab.kind && isSD() && active === sd ? ctrlBone(active, grab.kind) : null; }
    function grabApply(b, dt) {
      if (!mouse.down) { const f = Math.exp(-dt / 0.05); grab.dx *= f; grab.dy *= f; if (Math.abs(grab.dx) + Math.abs(grab.dy) < 0.5) { grab.kind = null; return; } }
      const p = b.parent; if (!p) return; const det = p.a * p.d - p.b * p.c; if (!det) return;
      let lx = (grab.dx * p.d - grab.dy * p.b) / det, ly = (grab.dy * p.a - grab.dx * p.c) / det; // 부모 월드 행렬(전 프레임) 역변환 → 부모 로컬(스켈레톤 단위)
      const R = CTRL[grab.kind].max, len = Math.hypot(lx, ly);
      if (len > 1e-3) { const s = R * (1 - Math.exp(-len / R)) / len; lx *= s; ly *= s; }
      b.x += lx; b.y += ly;
    }
    // 조작 본이 셋업 자리에서 얼마나 벗어났나(월드 px) — 셀프테스트·HUD용
    function grabOffsetPx(kind) { const b = sd.skeleton && ctrlBone(sd, kind); if (!b) return null; const p = b.parent; const x0 = p.worldX + b.data.x * p.a + b.data.y * p.b, y0 = p.worldY + b.data.x * p.c + b.data.y * p.d; return Math.hypot(b.worldX - x0, b.worldY - y0); }
    function startTickle() { m.state = "tickle"; tickleT = 0; play(active.A.tickleIdle, true); if (S.sound.clickVoice) playVoiceOwn("ticklestart", "tickleduring"); }
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
          if (mouse.zone === "head" && active.A.patIdle) { m.state = "pat"; play(active.A.patIdle, true); grabStart("pat", mouse.sx, H - mouse.sy); } // 머리에서 끌기 → 쓰다듬기 (Character_Pat 본이 손을 따라감)
          else if (mouse.zone === "cheek") { /* 얼굴에서 끌기 → 볼을 계속 당기는 중(Touch_Idle 유지 + Character_Ball_Move 본이 커서를 따라감), 뗄 때 Touch_End */ }
        }
        if (m.state === "pat" || (m.state === "touch" && mouse.zone === "cheek")) { grabMove(e.clientX, wy); return; } // 잡고 있는 동안은 루프 애니 + 조작 본만
        const ddx = Math.abs(e.clientX - mouse.sx), ddy = Math.abs(wy - (H - mouse.sy));
        if (m.state === "touch" && mouse.zone === "body" && ddy <= LIFT_DY) {   // 몸을 왕복으로 문지르면 간지럽히기 (위아래로 끌면 들어올리기)
          const d = e.clientX - rub.last; rub.last = e.clientX;
          if (Math.abs(d) >= 3) { const s = Math.sign(d); if (rub.dir && s !== rub.dir) rub.turns++; rub.dir = s; rub.travel += Math.abs(d); }
          if (rub.turns >= 1 && rub.travel >= RUB_TRAVEL && active.A.tickleIdle) startTickle();
          return;
        }
        if (m.state === "tickle" && ddy <= LIFT_DY && ddx <= LIFT_DX) return; // 간지럽히는 중: 문질러도 루프 유지. 위아래로 끌면 들어올리기
        if (!mouse.dragging && moved > 6) { if (cfg.selftest) console.log(`DRAGSTART state=${m.state} zone=${mouse.zone} moved=${moved.toFixed(0)} dx=${(e.clientX - mouse.sx).toFixed(0)} dy=${(wy - (H - mouse.sy)).toFixed(0)} anim=${m.anim}`); mouse.dragging = true; m.state = "drag"; m.vx = m.vy = 0; mouse.offX = e.clientX - m.x; mouse.offY = wy - m.y; if (isSD()) useSlot(slotForRest()); play(active.A.drag || active.A.hold, true); } // 들어올리기 시작: 지금 자리에서 커서를 따라가기 시작(문지르기 판정 거리만큼 튀지 않게)
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
      mouse.zone = zoneAt(e.clientX, e.clientY);
      if (isSD()) {
        useSlot(slotForRest());
        if (active.A.touchIdle) {
          m.state = "touch"; m.vx = m.vy = 0; m.rot = 0; m.y = floorAt(m.x);
          rub.last = e.clientX; rub.dir = 0; rub.travel = 0; rub.turns = 0;
          // 얼굴: 누른 순간 Touch_Idle(볼 잡힌 찡그림) + 볼 본 구동. 머리: 놓아야(꿀밤) 끌어야(쓰다듬기) 정해지니 대기 애니 그대로. 몸: 바로 간지럽히기
          if (mouse.zone === "cheek") { play(active.A.touchIdle, true); grabStart("cheek", e.clientX, H - e.clientY); }
          // 몸: 아직 모름(톡/문지르기/들기) → 대기 애니 그대로
        }
      }
    }
    function onUp(e) {
      if (!mouse.down) return; mouse.down = false;
      if (mouse.dragging) {
        mouse.dragging = false; m.state = "thrown"; play(active.A.hold, true);
        if (Math.abs(m.vx) < 30 && Math.abs(m.vy) < 30) { m.vx = 0; m.vy = 0; }
        if (Math.abs(m.vx) > 30) { facing = m.vx > 0 ? 1 : -1; applyFacing(); }
      } else if (m.state === "pat") {          // 쓰다듬기 끝 → touch2_x ("그래 그래 더 쓰다듬으라고")
        playOnce(active.A.patEnd || active.A.hold, "react"); if (S.sound.clickVoice) playVoiceOwn("pat", "pleasure", "joy");
      } else if (m.state === "tickle") {       // 간지럽히기 끝 → Tickle_End. 웃음은 좀 간지럽혔을 때만(톡 치고 뗀 건 시작 웃음 하나로)
        playOnce(active.A.tickleEnd || active.A.hold, "react"); if (S.sound.clickVoice && tickleT > 0.6) playVoiceOwn("tickleduring", "ticklestart", "joy");
      } else if (m.state === "touch" && mouse.zone === "head" && active.A.smash.length) { // 머리 톡 → 꿀밤
        smashHit();
      } else if (m.state === "touch" && mouse.zone === "cheek" && active.A.touchEnd && Math.hypot(grab.dx, grab.dy) >= TAP_PX) { // 볼을 끌었을 때만 → touch1_x ("당기지 마!")
        playOnce(active.A.touchEnd, "react"); if (S.sound.clickVoice) playVoiceOwn("cheek", "touch");
      } else if (m.state === "thrown") { /* 공중에서 톡 — 잡아 끌지 않았으면 그대로 떨어지게 둔다(react 로 바꾸면 중력이 멈춰 공중에 선다) */
      } else {                               // 몸 톡(안 움직이고 뗌) / 미니미: 가벼운 반응 모션 + 그에 맞는 소리(웃음 등). 볼 당기기 대사("아파!")는 볼을 잡았을 때만, 간지럽히기는 문질러야
        if (isSD()) useSlot(slotForRest());
        let reacts = active.A.react.filter(has);
        if (active === sd) { const soft = reacts.filter(n => /^(Happy|Smile|Laugh|Shy|Proud|Excited|Taunt)_/.test(n)); if (soft.length) reacts = soft; } // 몸 톡은 놀람(으아악)도 빼고 웃음·수줍음만
        const ra = reacts.length ? pick(reacts) : active.A.hold;
        playOnce(ra, "react");
        if (S.sound.clickVoice) { if (!motionVoice(ra, true)) sayOnClick(); } // 대사는 반응 모션에 맞춰(웃으면 기쁨 소리), 매핑 없는 모션(Idle2_4 등)은 웃음·잡담, 그것도 없는 크레페는 쓰다듬기 대사(볼 당기기는 볼을 끌었을 때만)
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
      { const o = new spine.Vector2(), z = new spine.Vector2(); sd.skeleton.getBounds(o, z, bTmp); say(`vela ground: bounds bottom=${(o.y - sd.skeleton.y).toFixed(0)}px ground=${sd.feet.toFixed(0)}px (expect ground 0 = 원점, bottom < 0 = 머리가 지면 아래로) skel.y=${sd.skeleton.y.toFixed(0)} floor=${floorAt(m.x)}`);
        m.state = "idle"; S.behavior.hopChance = 100; decideIdle(); await sleep(100); say(`vela minimi move h=${m.h.toFixed(0)} standingBox=${sd.h.toFixed(0)} body=${((bodyHeight(sd) || 0) * sd.k).toFixed(0)} (expect 기본 미니미 크기 ≈ 184)`); S.behavior.hopChance = 45; }
      patchSettings({ skin: "Mini_Daya" }); await sleep(2500);
      { const o = new spine.Vector2(), z = new spine.Vector2(); sd.skeleton.getBounds(o, z, bTmp); say(`daya ground: bounds bottom=${(o.y - sd.skeleton.y).toFixed(0)}px ground=${sd.feet.toFixed(0)}px skel.y=${sd.skeleton.y.toFixed(0)} m.y=${m.y.toFixed(0)} (expect ground ≈ bottom ≈ 0: 돌 바닥이 지면)`); }
      patchSettings({ skin: "Mini_Erpin" }); await sleep(1500);
      { m.state = "react"; onComplete(active, active.state.getCurrent(0) || { loop: false }); say(`after motion → state=${m.state} anim=${m.anim} timer=${m.timer.toFixed(2)} (expect idle loop, timer≈actGap ${S.behavior.actGap})`); }
      S.behavior.hopChance = 0; m.state = "idle"; decideIdle(); say(`hybrid rest slot=${active.family} anim=${m.anim} (expect standing Idle_*)`); S.behavior.hopChance = 45;
      await settle(); cx = m.x; cy = H - m.y - m.h / 2; fire("mousemove", cx, cy); fire("mousedown", cx, cy); await sleep(30); fire("mouseup", cx, cy); await sleep(60);
      say(`hybrid click(몸 톡) slot=${active.family} anim=${m.anim} voice=${lastPlayed?.name} (expect standing 가벼운 반응(Happy/Smile…) + joy — 톡은 간지럽히기·볼 당기기 아님)`);
      patchSettings({ skin: "Mini_Crepe" }); await sleep(2500);
      say(`hybrid crepe(인게임 없음) active=${active.family} sdI=${sdI.skeleton ? "loaded" : "-"} (expect standing only)`);

      patchSettings({ skin: "Mini_Crepe" }); await sleep(2500);
      say(`sd crepe active=${active.kind} src=${sd.src} key=${sd.key?.split("/").slice(-2).join("/")} anims=${sd.data?.animations.length} h=${m.h.toFixed(0)} state=${m.state} anim=${m.anim} (expect sd/game/crepe 47 h≈208)`);

      patchSettings({ skin: "Mini_ErpinSkin1" }); await sleep(3000);
      say(`sd erpin skin1 active=${active === mini ? "minimi" : active.family} standing=${sd.key?.split("/").slice(-2).join("/")} ingame=${sdI.key?.split("/").slice(-1)[0]} (expect standing Erpin/ErpinSkin1 + ingame erpinskin1)`);
      await settle(); cx = m.x; cy = H - m.y - m.h / 2; fire("mousemove", cx, cy); fire("mousedown", cx, cy); await sleep(30); fire("mouseup", cx, cy); await sleep(60);
      say(`sd click(몸 톡) state=${m.state} anim=${m.anim} voice=${lastPlayed?.name} (expect react Happy/Smile/… + erpin/joy|pleasure — 톡은 간지럽히기·볼 당기기 아님)`);
      { await sleep(2600); await settle(); const g0 = headGeom(); const ex = g0.headX, ey = H - g0.eyeY; fire("mousedown", ex, ey); say(`press cheek → anim=${m.anim} (expect Touch_Idle)`); await sleep(30); fire("mouseup", ex, ey); await sleep(60);
        say(`cheek tap(볼 톡) state=${m.state} anim=${m.anim} voice=${lastPlayed?.name} (expect react Touch_End + erpin/touch1*)`); }
      { // 교감: 머리 드래그 = 쓰다듬기, 얼굴 드래그 = 볼 당기기, 몸 드래그 = 들기
        await sleep(2600); await settle(); cx = m.x; const o = new spine.Vector2(), z = new spine.Vector2(); sd.skeleton.getBounds(o, z, bTmp); const hb = headBone(sd);
        const g = headGeom(); const topY = H - g.top, neckY = H - g.neckY, hx = g.headX, eyeSY = H - g.eyeY;
        say(`zones(erpin): head=${hb?.data.name} eyes=${eyeBones(sd).length} anchors=${g.anchors} u=${g.u.toFixed(0)}px browY=${(g.browY - g.neckY).toFixed(0)}px-above-neck patY=${((ctrlBone(sd, "pat")?.worldY ?? 0) - g.neckY).toFixed(0)} zone(top+20)=${zoneAt(hx, topY + 20)} zone(eye)=${zoneAt(hx, eyeSY)} zone(neck+10)=${zoneAt(hx, neckY - 10)} zone(body)=${zoneAt(cx, H - m.y - 30)} zone(beside head)=${zoneAt(hx + 4 * g.u, eyeSY)} (expect head / cheek / cheek / body / body)`);
        shot("idle-before"); await sleep(120); const py = topY + 25; fire("mousedown", hx, py); say(`press head → state=${m.state} anim=${m.anim} (expect touch, 대기 애니 유지 — 머리는 놓아야 꿀밤/끌어야 쓰다듬기)`);
        fire("mouseup", hx, py); await sleep(30); say(`tap head(꿀밤 1단) → state=${m.state} anim=${m.anim} voice=${lastPlayed?.name} (expect smash1 Smash_End_1 + erpin/dutchrubend1)`);
        await sleep(1400); say(`꿀밤 2단 → state=${m.state} anim=${m.anim} voice=${lastPlayed?.name} (expect react Smash_End_2 + erpin/dutchrubend2*)`);
        await sleep(3500); await settle(); fire("mousedown", hx, py);
        for (let i = 1; i <= 8; i++) { await sleep(16); fire("mousemove", hx + i * 6, py); } await sleep(40); shot("pat-drag"); await sleep(120); say(`pat drag → state=${m.state} anim=${m.anim} ctrl=${grab.kind} offset=${(grabOffsetPx("pat") ?? -1).toFixed(0)}px (expect pat Pat_Idle, Character_Pat 본이 손을 따라 20~48px 이동)`);
        fire("mouseup", hx + 48, py); await sleep(30); say(`pat release → state=${m.state} anim=${m.anim} voice=${lastPlayed?.name} (expect react Pat_End + erpin/touch2*)`);
        await sleep(400); say(`pat ctrl bone after release: kind=${grab.kind} offset=${(grabOffsetPx("pat") ?? -1).toFixed(0)}px (expect null, ≈0 = 제자리로 감쇠)`);
        await sleep(3500); await settle(); sd.skeleton.getBounds(o, z, bTmp); const cy2 = H - (hb ? hb.worldY : o.y + z.y * 0.55) - 12;
        fire("mousedown", hx, cy2); for (let i = 1; i <= 8; i++) { await sleep(16); fire("mousemove", hx + i * 8, cy2 + i * 3); }
        await sleep(40); shot("cheek-drag"); await sleep(120); { const b = ctrlBone(sd, "cheek"); say(`cheek drag → state=${m.state} anim=${m.anim} ctrl=${grab.kind} bone=${b?.data.name} parent=${b?.parent?.data.name} offset=${(grabOffsetPx("cheek") ?? -1).toFixed(0)}px (expect touch Touch_Idle 유지, Character_Ball_Move 본이 커서를 따라 30~70px 이동 → 얼굴이 절반 따라옴)`); }
        shot("cheek-drag2"); await sleep(120); fire("mouseup", hx + 64, cy2 + 24); await sleep(30); say(`cheek release → state=${m.state} anim=${m.anim} voice=${lastPlayed?.name} (expect react Touch_End + erpin/touch1*)`);
        await sleep(400); say(`cheek ctrl bone after release: kind=${grab.kind} offset=${(grabOffsetPx("cheek") ?? -1).toFixed(0)}px (expect null, ≈0)`);
        await sleep(3000); await settle(); cx = m.x; let by = H - m.y - 30; fire("mousedown", cx, by); await sleep(700);
        say(`body press+hold 0.7s → state=${m.state} anim=${m.anim} (expect touch, 대기 애니 그대로 — 가만히 누르면 아무것도 안 함)`);
        fire("mouseup", cx, by); await sleep(30); say(`body tap release → state=${m.state} anim=${m.anim} voice=${lastPlayed?.name} (expect react Happy/Smile/… + joy — 간지럽히기 아님)`);
        await sleep(4500); await settle(); cx = m.x; by = H - m.y - 30; fire("mousedown", cx, by); // 몸 문지르기(좌우 왕복 24px) → 간지럽히기
        for (const dx of [8, 16, 24, 16, 8, 0, -8, 0, 8, 16]) { await sleep(16); fire("mousemove", cx + dx, by); }
        say(`body rub(문지르기) → state=${m.state} anim=${m.anim} voice=${lastPlayed?.name} (expect tickle Tickle_Idle_1 + ticklestart — 루프 하나만)`);
        await sleep(350); for (const dx of [8, 0, -8]) { await sleep(16); fire("mousemove", cx + dx, by); } await sleep(30);
        say(`rub more → state=${m.state} anim=${m.anim} (expect still tickle Tickle_Idle_1, no Idle_2 switch)`);
        fire("mouseup", cx - 8, by); await sleep(30); say(`rub release → state=${m.state} anim=${m.anim} (expect react Tickle_End)`);
        await sleep(4500); await settle(); cx = m.x; by = H - m.y - 30; const x0 = m.x; fire("mousedown", cx, by); for (let i = 1; i <= 8; i++) { await sleep(16); fire("mousemove", cx + i * 12, by - i * 12); }
        say(`body drag(위로) → state=${m.state} moved=${(m.x - x0).toFixed(0)}px after 96px cursor (expect drag, moved ≈ 96−48 = 48 → 세로 45px 넘은 지점부터 따라옴, 튀지 않음)`);
        fire("mouseup", cx + 96, by - 96); await sleep(1500); await settle(); cx = m.x; by = H - m.y - 30; fire("mousedown", cx, by); // 가로로 길게 문지르기(±100px) → 들리지 않아야
        for (const dx of [40, 80, 120, 80, 40, 0, -40, -80, -120, -80, -40, 0]) { await sleep(16); fire("mousemove", cx + dx, by); }
        say(`body wide rub(가로 ±120px) → state=${m.state} anim=${m.anim} (expect tickle Tickle_Idle_1, not drag)`); fire("mouseup", cx, by); await sleep(1500); await settle();
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

    Object.assign(self, { start, dispose, hideHit, onGeo, applySettings, update, pushHitRect, hover, onMouse, spawn, playCmd, preview, announce, emote, meet, logState, moodTest, ingameTest, hudLine, sdAnimations, selftest });
    return self;
  }
})();
