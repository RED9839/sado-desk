/* 셀프테스트 — `--selftest`·`--mood-test`·`--ingame-test` 로만 도는 점검. 제품 동작은 여기 없다.
 * mascot.js 에서 떼어 냈다: 창을 실제로 띄워 마우스를 흉내내고 상태·애니·음성을 콘솔에 적는다(SELFTEST 줄).
 * 바깥 상태는 A 로 받는다 — 값이 바뀌는 것(S·active·voiceSet·lastPlayed·W·H·geoD)은 getter, 나머지는 그대로.
 *   const T = MascotSelftest.create(A);  → { selftest, moodTest, ingameTest }
 */
(function (root) {
  function create(A) {
    const { m, mini, sd, sdI, id, host, menuOpen, sleep, fire: _f, hit, hover, onMouse, patchSettings, decideIdle, useSlot,
      slotForRest, isSD, play, playVoice, motionVoice, voiceCount, voicePlaying, voiceCatsFor, onComplete, bodyHeight,
      zoneAt, ctrlBone, eyeBones, headBone, headGeom, floorAt, mascots, bTmp, grab, grabOffsetPx } = A;
  // ---- 셀프테스트 (첫 캐릭터에서만) ----
  function fire(type, x, y, button = 0) { onMouse({ type, x, y, button, buttons: 0 }); }
  const shot = (name) => { const pad = 24; console.log(`SHOTREQ ${name} ${Math.round(m.x - m.w / 2 - pad)} ${Math.round(A.H - m.y - m.h - pad)} ${Math.round(m.w + pad * 2)} ${Math.round(m.h + pad * 2)}`); };
  async function ingameTest() {
    const say = (s) => console.log("INGAMETEST " + s);
    await sleep(2500);
    for (const skin of ["Mini_Erpin", "Mini_Crepe", "Mini_ErpinSkin1"]) {
      patchSettings({ mode: "ingame", skin, mood: "", sound: { muted: true } }); await sleep(3000);
      say(`${skin}: active=${A.active === mini ? "minimi" : A.active.family} src=${sd.src} key=${sd.key?.split("/").slice(-1)[0]} anims=${sd.data?.animations.length} state=${m.state} anim=${m.anim} move=${A.active.A.move} h=${m.h.toFixed(0)}`);
      shot(`ingame-${skin}`); await sleep(500);
      // 이동 강제
      const B0 = A.S.behavior.hopChance; A.S.behavior.hopChance = 100; m.state = "idle"; m.timer = 0; await sleep(700); say(`${skin} move: state=${m.state} slot=${A.active === mini ? "minimi" : A.active.family} anim=${m.anim} (expect hop + Move on ingame)`); A.S.behavior.hopChance = B0; await sleep(2500);
    }
    // 전투 대사: 인게임 형태에서 클릭 → Victory/Attack 리액션 + victory/basicattack 보이스
    patchSettings({ mode: "ingame", skin: "Mini_Erpin", sound: { muted: false, master: 0.5, voice: 0.01 } }); await sleep(2500);
    { const cats = Object.keys(A.voiceSet.cats).filter(c => A.voiceSet.cats[c].length); say(`erpin voice cats: ${cats.join(" ")} (expect victory/basicattack/spskill/ultimate/hit/die 포함)`); }
    for (const a of ["Victory", "Attack1_1", "Skill1_1", "Ultimate1_1", "Groggy", "Die", "Spawn"]) { const f = motionVoice(a, true); say(`ingame motion ${a} → ${f}`); await sleep(150); }
    { const cx0 = m.x, cy0 = A.H - m.y - m.h / 2; fire("mousemove", cx0, cy0); fire("mousedown", cx0, cy0); await sleep(30); fire("mouseup", cx0, cy0); await sleep(80); say(`ingame click → state=${m.state} anim=${m.anim} voice=${A.lastPlayed?.name} (expect react Victory/Attack + victory/basicattack voice)`); }
    patchSettings({ mode: "sd", skin: "Mini_Erpin", sound: { muted: true } }); await sleep(2000); say(`back to sd: src=${sd.src} anim=${m.anim} (expect standing/game)`);
    say("done");
  }
  async function moodTest() {
    const say = (s) => console.log("MOODTEST " + s);
    await sleep(2500);
    patchSettings({ mode: "sd", mood: "", sound: { muted: true } }); await sleep(1500);
    for (const mood of ["", "smile", "anger", "sad", "happy", "eat", "sulky", "surprise"]) {
      patchSettings({ mood }); await sleep(2200);
      say(`mood=${mood || "default"} state=${m.state} anim=${m.anim} pool=${(A.active.A.moods?.[mood] || []).join("/")}`); shot(`mood-${mood || "default"}`); await sleep(600);
    }
    patchSettings({ mood: "" }); say("MOODTEST done");
  }
  async function selftest() {
    const say = (s) => console.log("SELFTEST " + s);
    const settle = async () => { if (isSD()) useSlot(slotForRest()); m.state = "idle"; m.timer = 99; m.rot = 0; m.y = floorAt(m.x); play(A.active.A.hold, true); await sleep(120); };
    await sleep(3000); if (A.S.mode !== "minimi") { patchSettings({ mode: "minimi" }); await sleep(500); } await settle();
    let cx = m.x, cy = A.H - m.y - m.h / 2;
    fire("mousemove", cx, cy); await sleep(50);
    say(`hover hit=${hit(cx, cy)} (expect true)`);
    fire("mousedown", cx, cy); await sleep(60); fire("mouseup", cx, cy); await sleep(100);
    say(`click state=${m.state} anim=${m.anim} (expect react)`);
    await sleep(2500); await settle();
    cx = m.x; cy = A.H - m.y - m.h / 2;
    fire("mousemove", cx, cy); fire("mousedown", cx, cy);
    for (let i = 1; i <= 12; i++) { await sleep(16); fire("mousemove", cx + i * 3, cy - i * 12); }
    say(`drag state=${m.state} y=${m.y.toFixed(0)} (expect drag, y>0)`);
    for (let i = 1; i <= 8; i++) { await sleep(16); fire("mousemove", cx + 36 + i * 45, cy - 144 - i * 6); }
    fire("mouseup", cx + 36 + 8 * 45, cy - 144 - 48);
    await sleep(30);
    say(`throw state=${m.state} vx=${m.vx.toFixed(0)} vy=${m.vy.toFixed(0)} (expect thrown, vx>0)`);
    let maxY = 0, t0 = performance.now();
    while (m.state === "thrown" && performance.now() - t0 < 6000) { maxY = Math.max(maxY, m.y); await sleep(50); }
    say(`after throw state=${m.state} anim=${m.anim} maxY=${maxY.toFixed(0)} x=${m.x.toFixed(0)} last=${JSON.stringify(A.lastPlayed)} (expect land + voice)`);
    await sleep(600);
    fire("mousemove", 10, 10); await sleep(50);
    say(`leave over=${m.over} (expect false)`);
    await settle(); cx = m.x; cy = A.H - m.y - m.h / 2;
    fire("mousedown", 5, 5); await sleep(30);
    say(`outside click menuOpen=${menuOpen} over=${m.over} (expect false/false)`);
    patchSettings({ skin: "Mini_Crepe" });
    await settle(); cx = m.x; cy = A.H - m.y - m.h / 2;
    patchSettings({ sound: { master: 0.5, voice: 0.8, muted: false } });
    fire("mousemove", cx, cy); fire("mousedown", cx, cy); await sleep(30); fire("mouseup", cx, cy); await sleep(30);
    say(`sound click anim=${m.anim} last=${JSON.stringify(A.lastPlayed)} (expect voice crepe/touch* — 크레페는 감정 대사 없음, volume 0.4)`);
    patchSettings({ sound: { muted: true } });
    fire("mousedown", cx, cy); await sleep(30); fire("mouseup", cx, cy); await sleep(30);
    say(`sound muted last=${JSON.stringify(A.lastPlayed)} (expect volume 0)`);
    const fromMain = await host.getSettings(id);
    say(`settings roundtrip main.sound=${JSON.stringify(fromMain.sound)} main.skin=${fromMain.skin} (expect muted true, master 0.5, skin Mini_Crepe)`);
    patchSettings({ skin: "Mini_ErpinSkin1" }); say(`voice set erpin skin1 hero=${A.voiceSet.hero} skin=${A.voiceSet.skin} n=${voiceCount()}`);
    patchSettings({ skin: "Mini_Dummy" }); say(`voice set dummy hero=${A.voiceSet.hero} n=${voiceCount()} (expect null/0, no crash: ${playVoice("touch")})`);
    patchSettings({ skin: "Mini_Crepe", sound: { muted: false, master: 0.8, voice: 0.5 } });
    patchSettings({ behavior: { hop: false, jump: false } }); decideIdle(); say(`behavior hop/jump off → state=${m.state} anim=${m.anim} (expect idle/react, not hop/jump)`);
    patchSettings({ behavior: { hop: true, jump: true } });
    patchSettings({ opacity: 0.5 }); say(`opacity skeleton.alpha=${A.active.skeleton.color.a} (expect 0.5)`); patchSettings({ opacity: 1 });
    // SD 모드: 크레페(게임 추출) → 에르핀 스킨1(사이트 HD) → 스탠딩 없는 더미 → 미니미 폴백
    patchSettings({ mode: "sd", skin: "Mini_Erpin" }); await sleep(3500);
    say(`sd erpin(default, 스탠딩만) active=${A.active === mini ? "minimi" : A.active.family} ingameLoaded=${!!sdI.skeleton} state=${m.state} anim=${m.anim} (expect standing, ingame not loaded)`);
    m.state = "idle"; A.S.behavior.hopChance = 100; decideIdle(); await sleep(150); say(`sd move(default) slot=${A.active === mini ? "minimi" : A.active.family} anim=${m.anim} k=${A.active.k.toFixed(3)} h=${m.h.toFixed(0)} standingBox=${sd.h.toFixed(0)} body=${((bodyHeight(sd) || 0) * sd.k).toFixed(0)} (expect minimi Idle2_1, h = 기본 미니미 크기 ≈ 184)`);
    A.S.behavior.hopChance = 0; m.state = "idle"; decideIdle(); say(`sd rest after move slot=${A.active === mini ? "minimi" : A.active.family} anim=${m.anim} (expect standing)`); A.S.behavior.hopChance = 45;
    say(`erpin ingame slot loaded=${!!sdI.skeleton} (expect false — 인게임은 스탠딩 없을 때만)`);
    patchSettings({ skin: "Mini_Vela" }); await sleep(2500);
    { const o = new spine.Vector2(), z = new spine.Vector2(); sd.skeleton.getBounds(o, z, bTmp); say(`vela ground: bounds bottom=${(o.y - sd.skeleton.y).toFixed(0)}px ground=${sd.feet.toFixed(0)}px (expect ground 0 = 원점, bottom < 0 = 머리가 지면 아래로) skel.y=${sd.skeleton.y.toFixed(0)} floor=${floorAt(m.x)}`);
      m.state = "idle"; A.S.behavior.hopChance = 100; decideIdle(); await sleep(100); say(`vela minimi move h=${m.h.toFixed(0)} standingBox=${sd.h.toFixed(0)} body=${((bodyHeight(sd) || 0) * sd.k).toFixed(0)} (expect 기본 미니미 크기 ≈ 184)`); A.S.behavior.hopChance = 45; }
    patchSettings({ skin: "Mini_Daya" }); await sleep(2500);
    { const o = new spine.Vector2(), z = new spine.Vector2(); sd.skeleton.getBounds(o, z, bTmp); say(`daya ground: bounds bottom=${(o.y - sd.skeleton.y).toFixed(0)}px ground=${sd.feet.toFixed(0)}px skel.y=${sd.skeleton.y.toFixed(0)} m.y=${m.y.toFixed(0)} (expect ground ≈ bottom ≈ 0: 돌 바닥이 지면)`); }
    patchSettings({ skin: "Mini_Erpin" }); await sleep(1500);
    { m.state = "react"; onComplete(A.active, A.active.state.getCurrent(0) || { loop: false }); say(`after motion → state=${m.state} anim=${m.anim} timer=${m.timer.toFixed(2)} (expect idle loop, timer≈actGap ${A.S.behavior.actGap})`); }
    A.S.behavior.hopChance = 0; m.state = "idle"; decideIdle(); say(`hybrid rest slot=${A.active.family} anim=${m.anim} (expect standing Idle_*)`); A.S.behavior.hopChance = 45;
    await settle(); cx = m.x; cy = A.H - m.y - m.h / 2; fire("mousemove", cx, cy); fire("mousedown", cx, cy); await sleep(30); fire("mouseup", cx, cy); await sleep(60);
    say(`hybrid click(몸 톡) slot=${A.active.family} anim=${m.anim} voice=${A.lastPlayed?.name} (expect standing 가벼운 반응(Happy/Smile…) + joy — 톡은 간지럽히기·볼 당기기 아님)`);
    patchSettings({ skin: "Mini_Crepe" }); await sleep(2500);
    say(`hybrid crepe(인게임 없음) active=${A.active.family} sdI=${sdI.skeleton ? "loaded" : "-"} (expect standing only)`);

    patchSettings({ skin: "Mini_Crepe" }); await sleep(2500);
    say(`sd crepe active=${A.active.kind} src=${sd.src} key=${sd.key?.split("/").slice(-2).join("/")} anims=${sd.data?.animations.length} h=${m.h.toFixed(0)} state=${m.state} anim=${m.anim} (expect sd/game/crepe 47 h≈208)`);

    patchSettings({ skin: "Mini_ErpinSkin1" }); await sleep(3000);
    say(`sd erpin skin1 active=${A.active === mini ? "minimi" : A.active.family} standing=${sd.key?.split("/").slice(-2).join("/")} ingame=${sdI.key?.split("/").slice(-1)[0]} (expect standing Erpin/ErpinSkin1 + ingame erpinskin1)`);
    await settle(); cx = m.x; cy = A.H - m.y - m.h / 2; fire("mousemove", cx, cy); fire("mousedown", cx, cy); await sleep(30); fire("mouseup", cx, cy); await sleep(60);
    say(`sd click(몸 톡) state=${m.state} anim=${m.anim} voice=${A.lastPlayed?.name} (expect react Happy/Smile/… + erpin/joy|pleasure — 톡은 간지럽히기·볼 당기기 아님)`);
    { await sleep(2600); await settle(); const g0 = headGeom(); const ex = g0.headX, ey = A.H - g0.eyeY; fire("mousedown", ex, ey); say(`press cheek → anim=${m.anim} (expect Touch_Idle)`); await sleep(30); fire("mouseup", ex, ey); await sleep(60);
      say(`cheek tap(볼 톡) state=${m.state} anim=${m.anim} voice=${A.lastPlayed?.name} (expect react 가벼운 반응(Happy/Smile…) + erpin/joy|pleasure — 볼을 끌지 않은 톡은 볼 당기기가 아니다)`); }
    { // 교감: 머리 드래그 = 쓰다듬기, 얼굴 드래그 = 볼 당기기, 몸 드래그 = 들기
      await sleep(2600); await settle(); cx = m.x; const o = new spine.Vector2(), z = new spine.Vector2(); sd.skeleton.getBounds(o, z, bTmp); const hb = headBone(sd);
      const g = headGeom(); const topY = A.H - g.top, neckY = A.H - g.neckY, hx = g.headX, eyeSY = A.H - g.eyeY;
      say(`zones(erpin): head=${hb?.data.name} eyes=${eyeBones(sd).length} anchors=${g.anchors} u=${g.u.toFixed(0)}px browY=${(g.browY - g.neckY).toFixed(0)}px-above-neck patY=${((ctrlBone(sd, "pat")?.worldY ?? 0) - g.neckY).toFixed(0)} zone(top+20)=${zoneAt(hx, topY + 20)} zone(eye)=${zoneAt(hx, eyeSY)} zone(neck+10)=${zoneAt(hx, neckY - 10)} zone(body)=${zoneAt(cx, A.H - m.y - 30)} zone(beside head)=${zoneAt(hx + 4 * g.u, eyeSY)} (expect head / cheek / cheek / body / body)`);
      shot("idle-before"); await sleep(120); const py = topY + 25; fire("mousedown", hx, py); say(`press head → state=${m.state} anim=${m.anim} (expect touch, 대기 애니 유지 — 머리는 놓아야 꿀밤/끌어야 쓰다듬기)`);
      fire("mouseup", hx, py); await sleep(30); say(`tap head(꿀밤 1단) → state=${m.state} anim=${m.anim} voice=${A.lastPlayed?.name} (expect smash1 Smash_End_1 + erpin/dutchrubend1)`);
      await sleep(1400); say(`꿀밤 2단 → state=${m.state} anim=${m.anim} voice=${A.lastPlayed?.name} (expect react Smash_End_2 + erpin/dutchrubend2*)`);
      await sleep(3500); await settle(); fire("mousedown", hx, py);
      for (let i = 1; i <= 8; i++) { await sleep(16); fire("mousemove", hx + i * 6, py); } await sleep(40); shot("pat-drag"); await sleep(120); say(`pat drag → state=${m.state} anim=${m.anim} ctrl=${grab.kind} offset=${(grabOffsetPx("pat") ?? -1).toFixed(0)}px (expect pat Pat_Idle, Character_Pat 본이 손을 따라 20~48px 이동)`);
      fire("mouseup", hx + 48, py); await sleep(30); say(`pat release → state=${m.state} anim=${m.anim} voice=${A.lastPlayed?.name} (expect react Pat_End + erpin/touch2*)`);
      await sleep(400); say(`pat ctrl bone after release: kind=${grab.kind} offset=${(grabOffsetPx("pat") ?? -1).toFixed(0)}px (expect null, ≈0 = 제자리로 감쇠)`);
      await sleep(3500); await settle(); sd.skeleton.getBounds(o, z, bTmp); const cy2 = A.H - (hb ? hb.worldY : o.y + z.y * 0.55) - 12;
      fire("mousedown", hx, cy2); for (let i = 1; i <= 8; i++) { await sleep(16); fire("mousemove", hx + i * 8, cy2 + i * 3); }
      await sleep(40); shot("cheek-drag"); await sleep(120); { const b = ctrlBone(sd, "cheek"); say(`cheek drag → state=${m.state} anim=${m.anim} ctrl=${grab.kind} bone=${b?.data.name} parent=${b?.parent?.data.name} offset=${(grabOffsetPx("cheek") ?? -1).toFixed(0)}px (expect touch Touch_Idle 유지, Character_Ball_Move 본이 커서를 따라 30~70px 이동 → 얼굴이 절반 따라옴)`); }
      shot("cheek-drag2"); await sleep(120); fire("mouseup", hx + 64, cy2 + 24); await sleep(30); say(`cheek release → state=${m.state} anim=${m.anim} voice=${A.lastPlayed?.name} (expect react Touch_End + erpin/touch1*)`);
      await sleep(400); say(`cheek ctrl bone after release: kind=${grab.kind} offset=${(grabOffsetPx("cheek") ?? -1).toFixed(0)}px (expect null, ≈0)`);
      await sleep(3000); await settle(); cx = m.x; let by = A.H - m.y - 30; fire("mousedown", cx, by); await sleep(700);
      say(`body press+hold 0.7s → state=${m.state} anim=${m.anim} (expect touch, 대기 애니 그대로 — 가만히 누르면 아무것도 안 함)`);
      fire("mouseup", cx, by); await sleep(30); say(`body tap release → state=${m.state} anim=${m.anim} voice=${A.lastPlayed?.name} (expect react Happy/Smile/… + joy — 간지럽히기 아님)`);
      await sleep(4500); await settle(); cx = m.x; by = A.H - m.y - 30; fire("mousedown", cx, by); // 몸 문지르기(좌우 왕복 24px) → 간지럽히기
      for (const dx of [8, 16, 24, 16, 8, 0, -8, 0, 8, 16]) { await sleep(16); fire("mousemove", cx + dx, by); }
      say(`body rub(문지르기) → state=${m.state} anim=${m.anim} voice=${A.lastPlayed?.name} (expect tickle Tickle_Idle_1 + ticklestart — 루프 하나만)`);
      await sleep(350); for (const dx of [8, 0, -8]) { await sleep(16); fire("mousemove", cx + dx, by); } await sleep(30);
      say(`rub more → state=${m.state} anim=${m.anim} (expect still tickle Tickle_Idle_1, no Idle_2 switch)`);
      fire("mouseup", cx - 8, by); await sleep(30); say(`rub release → state=${m.state} anim=${m.anim} (expect react Tickle_End)`);
      await sleep(4500); await settle(); cx = m.x; by = A.H - m.y - 30; const x0 = m.x; fire("mousedown", cx, by); for (let i = 1; i <= 8; i++) { await sleep(16); fire("mousemove", cx + i * 12, by - i * 12); }
      say(`body drag(위로) → state=${m.state} moved=${(m.x - x0).toFixed(0)}px after 96px cursor (expect drag, moved ≈ 96−48 = 48 → 세로 45px 넘은 지점부터 따라옴, 튀지 않음)`);
      fire("mouseup", cx + 96, by - 96); await sleep(1500); await settle(); cx = m.x; by = A.H - m.y - 30; fire("mousedown", cx, by); // 가로로 길게 문지르기(±100px) → 들리지 않아야
      for (const dx of [40, 80, 120, 80, 40, 0, -40, -80, -120, -80, -40, 0]) { await sleep(16); fire("mousemove", cx + dx, by); }
      say(`body wide rub(가로 ±120px) → state=${m.state} anim=${m.anim} (expect tickle Tickle_Idle_1, not drag)`); fire("mouseup", cx, by); await sleep(1500); await settle();
      { patchSettings({ skin: "Mini_Opal" }); await sleep(2500); await settle(); const g2 = headGeom(); const hx2 = g2.headX, eyeS = A.H - g2.eyeY, topS = A.H - g2.top;
        say(`zones(opal, 큰 모자 hatRatio≈8): u=${g2.u.toFixed(0)} topAboveEye=${(g2.top - g2.eyeY).toFixed(0)}px zone(eye)=${zoneAt(hx2, eyeS)} zone(eye+1.5u 머리)=${zoneAt(hx2, eyeS - 1.5 * g2.u)} zone(top-20 모자)=${zoneAt(hx2, topS + 20)} (expect cheek / head / head — 예전 방식이면 얼굴이 모자 중간까지 올라갔음)`); }
      patchSettings({ skin: "Mini_ErpinSkin1" }); await sleep(2500);
      say(`voice split: cheek=${A.voiceSet.cats.cheek?.length} pat=${A.voiceSet.cats.pat?.length} touch=${A.voiceSet.cats.touch?.length} (expect 3/3/6 for erpin skin1 view)`);
    }
    m.state = "idle"; A.S.behavior.hopChance = 100; decideIdle(); say(`sd move slot=${A.active === mini ? "minimi" : A.active.family} state=${m.state} anim=${m.anim} (expect minimi Idle2_1)`); await sleep(400); A.S.behavior.hopChance = 45;
    patchSettings({ skin: "Mini_Dummy" }); await sleep(800);
    say(`sd dummy active=${A.active.kind} (expect minimi fallback)`);
    patchSettings({ skin: "Mini_Crepe", mode: "minimi" }); await sleep(500);
    say(`back to minimi active=${A.active.kind} h=${m.h.toFixed(0)} (expect minimi 184)`);
    { const pairs = ["Happy_1", "Angry_1", "Sad_1", "Surprise_1", "Eat_1", "Blank_1", "Spawn", "Victory", "Success", "Idle2_4"].map(a => `${a}→${(voiceCatsFor(a) || ["-"]).join("/")}`); say(`motion→voice map: ${pairs.join(", ")}`); }
    patchSettings({ skin: "Mini_Erpin", mode: "sd" }); await sleep(2500);
    { const f = motionVoice("Happy_1", true); say(`motion voice Happy_1 → ${f} (expect erpin/joy* or pleasure*)`); const f2 = motionVoice("Angry_1", true); say(`motion voice Angry_1 → ${f2} (expect erpin/anger*)`); }
    say(`motion voice gating: chance=${A.S.sound.motionVoiceChance} cooldown=${A.S.sound.motionVoiceCooldown}s on=${A.S.sound.motionVoice}`);
    { patchSettings({ sound: { muted: false, master: 0.5, voice: 0.01 } }); playVoice("joy", "touch"); await sleep(300); m.state = "idle"; m.timer = 0.01; await sleep(400); say(`voice hold: voicePlaying=${voicePlaying()} state=${m.state} timer=${m.timer.toFixed(2)} (expect still idle while voice plays, timer≥0.4)`); if (A.currentVoice) A.currentVoice.pause(); patchSettings({ sound: { voice: 0.5, master: 0.8 } }); }
    patchSettings({ skin: "Mini_Crepe", mode: "sd" }); await sleep(1500);
    say(`geo: window ${A.W}x${A.H}, displays=${A.geoD.map(d => `[${d.x0}-${d.x1} floor=${d.floor} top=${d.top}${d.primary ? " P" : ""}]`).join(" ")} floorAt(100)=${floorAt(100)} floorAt(W-100)=${floorAt(A.W - 100)} (expect 2 displays, floor>0 = 작업표시줄 높이)`);
    { const o = m.x; m.state = "idle"; m.x = A.W - 200; m.y = floorAt(m.x); say(`on 2nd monitor x=${m.x.toFixed(0)} floor=${floorAt(m.x)} (expect that display's floor)`); m.x = o; m.y = floorAt(o); }
    say(`multi: mascots=${mascots.size} ids=${[...mascots.keys()].join(",")} (expect ≥1, one window)`);
    say("DONE");
  }
    return { selftest, moodTest, ingameTest };
  }
  const api = { create };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.MascotSelftest = api;
})(typeof window !== "undefined" ? window : globalThis);
