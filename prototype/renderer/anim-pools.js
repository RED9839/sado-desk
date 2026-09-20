/* 애니 풀 — 스켈레톤의 애니 이름·길이를 보고 "대기에 쓸 것 / 클릭 반응 / 표정별" 로 나눈다.
 * 순수 계산이라 브라우저(mascot.js)와 node(test/anim-pools.test.js) 양쪽에서 쓴다. data 는 spine SkeletonData 이거나
 * { animations:[{name,duration}], findAnimation(n) } 꼴이면 된다.
 *   브라우저: window.AnimPools · node: require("./anim-pools.js")
 */
(function (root) {
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
  const api = { MINI, SD, MOOD_ORDER, IG_SKIP, sdPools, moodPools, ingamePools };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.AnimPools = api;
})(typeof window !== "undefined" ? window : globalThis);
