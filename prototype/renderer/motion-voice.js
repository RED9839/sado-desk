/* 모션(애니 이름) ↔ 보이스 카테고리 매핑. 브라우저(전역 MOTION_VOICE)와 node(tools/voice-motion-audit.mjs) 양쪽에서 쓴다.
 * 보이스 카테고리(게임 로비 대사 폴더, STT로 내용 확인): touch1_x=볼 당기기 대사(→cheek) touch2_x=쓰다듬기 대사(→pat) dutchrubend=꿀밤(1 소리, 2 대사)
 *   ticklestart/tickleduring=간지럽히기 웃음 · joy/pleasure/anger/sorrow/surprise/sorry = 짧은 감정 소리(웃음·으아악·미안) · eat greeting spawn line(잡담 대사)
 * 스탠딩 애니 접두어(137명 조사, tools/anim-survey.mjs): 전원 = Angry Eat Happy Idle Pat_* Sad Touch_* Smash_End Tickle_* Close
 *   다수 = Blank(113) Panic(105) Shy(85) Surprise(63) Sulky(56) Dance(44) Serious(39) Sorry(30) Talk Taunt Proud Thinking Tired Smile Mad Groggy ...
 * 인게임 SD(전투·마이홈 형태) 애니 → 전투 대사: Spawn=spawn Victory=victory Attack=basicattack Skill=spskill Ultimate=ultimate Groggy/Hit=hit Die=die (416세트 조사)
 * 순서대로 첫 매치. 앞 카테고리가 없으면 뒤로 폴백. 매치 없음 = 대사 없음(Idle, Close, Pat_Idle 같은 루프/무표정).
 */
(function (root) {
  const MOTION_VOICE = [
    // 이동·수면·교감 대기 루프에는 관계없는 잡담이나 울음소리를 붙이지 않는다.
    [/^(?:Move|Walk|Dash|Jump|Sleep|Sleepy)(?:_|\d|$)/i, null],
    [/^(?:Pat|Touch)_Idle(?:_|$)/i, null],
    // 교감 단계는 넓은 접두어 규칙보다 먼저 판정한다.
    [/^Smash_End_1(?:_|$)/i, ["smashHit", "hit", "surprise"]],
    [/^Smash_End_2(?:_|$)/i, ["smashLine", "anger"]],
    [/^Tickle_End(?:_|$)/i, ["tickleduring", "ticklestart"]],
    [/^Tickle_Idle(?:_|$)/i, ["tickleduring", "ticklestart"]],
    // 혼잣말 재료를 늘리며 더한 것 — 고민하는 동작엔 hmm, 끄덕/도리질엔 yes/no
    [/^(Thinking|Think|Question|Curious|Doubt|Hesitate)/i, ["hmm", "line", "affinity"]],
    [/^(Nodding|Yes|Agree|Ok)/i, ["yes", "line"]],
    [/^(No_|No$|Nope|Deny|Shake)/i, ["no", "line"]],
    // ---- 인게임 SD (전투 애니는 이름이 고정: Attack1_1 / Skill1_1 / Ultimate1_1 / Victory / Groggy / Die / Spawn). 스탠딩 규칙보다 먼저 ----
    [/^(Victory|EasterEgg_Victory)/i, ["victory", "pleasure", "joy"]],
    [/^(OW\d_)?Attack\d/i, ["basicattack", "shout", "anger"]],
    [/^(OW\d_)?(Skill\d|Cast\d)/i, ["spskill", "shout", "anger"]],
    [/^(OW\d_)?Ultimate\d/i, ["ultimate", "shout", "anger"]],
    [/^(Groggy|Hit|Bind)(_|$)/i, ["hit", "surprise", "sorry"]],
    [/^Die(_|$)/i, ["die", "defeat", "sorrow"]],
    // 기쁨 계열
    [/^(Happy|Smile|Laugh|Excited|Nicesmile|Joy|Dance|Sing|Singing|Rhythm|Clap|Heart|Wink|Cute|Relaxed|EasterEgg_Happy|Success)/i, ["joy", "pleasure"]],
    // 뿌듯·자랑·승리
    [/^(Proud|Pride|Victory|Pose|Posing|Cool|Ganzi|Strong|Salute|Present|Magic|Beam|Special|V_|V$)/i, ["pleasure", "joy"]],
    // 수줍·장난(메롱)
    [/^(Shy|Dere|Innocent)/i, ["pleasure"]],
    [/^(Melong|Merong|Joke|Tease|Cheeky|Sneaky|Smirking|Villain|Scary|Annoy)/i, ["pleasure", "line"]],
    // 화남·공격
    [/^(Angry|Mad|Upset|Sulky|Attack|Punch|Fight|Sword|Skill|Ultimate|Laser|Pistol|Revolver|Aiming|Warning|Scream|Stop|No_|No$|Nope|Ban)/i, ["anger"]],
    // 슬픔·지침·아픔
    [/^(Sad|Sorrow|Die|Defeat|Cry|Tired|Sleepy|Sleep|Lazy|Dizzy|Boring|Ouch|Knee|Fear|Hesitate|Doubt|Worry)/i, ["sorrow", "sorry"]],
    // 미안·민망·땀
    [/^(Sorry|Notmyfault|Sweat|Shame|Regret|Calm|Ottokhaji|Why)/i, ["sorry", "sorrow"]],
    // 꿀밤 (Smash_End) → dutchrubend = 꿀밤 맞은 소리/대사 ("머리 때리지 마!")
    [/^Smash/i, ["dutchrubend", "surprise", "anger"]],
    // 놀람·당황
    [/^(Surprise|Surprised|Shock|Panic|Groggy|Hit|Break|Splash|Fail)/i, ["surprise", "sorry"]],
    // 먹기
    [/^(Eat|Hungry|Bread|Drink|Cook|Latte|Smell|Spit|Spitter)/i, ["eat"]],
    // 교감 애니 (STT로 확인한 실제 대응): 간지럽히기 = 웃음 / 쓰다듬기 = touch2_x(pat) / 볼 당기기(Touch_*) = touch1_x(cheek)
    [/^Tickle/i, ["ticklestart", "tickleduring"]],
    [/^Pat/i, ["pat", "pleasure"]],
    [/^Touch/i, ["cheek"]],
    // 등장·인사
    [/^(Spawn|Enter|Hi$|Hi_|Greeting|Hug|Call)/i, ["spawn", "greeting"]],
    // 잡담(대사) — 멍·말하기·생각·질문·놀리기·기타 동작
    [/^(Blank|Nodding|Taunt|Talk|Speak|Whisper|Think|Thinking|Question|Curious|Serious|Point|Check|Note|Read|Write|Work|Camera|Phone|Mic|Loudspeaker|Recorder|Recoder|Clock|Mirror|Money|Count|Sit|Sitting|Squat|Stand|Rest|Yoga|Pray|Quiet|Ignore|Yare|Bbang|Gao|Try|Clean|Act|Idle_3|Idle3|Dumb|Robot|Drill|Scouter|Rummage|Glasses|Mask|Scroll|Track|Aside|Jackson|Parrot|Domo|Kirat|Kisya|Baldo|Urcharyu|Sijeo|Dehet|Taik|Oioi|Beni|Rock|Go|Drive|Drift|Dash|Jump|Move|Walk|Promise|Succession|Concent|Open|Closed|Help|Disgust|Lying|Down|Yes)/i, ["line", "affinity", "callplayer", "hmm", "greeting"]],
  ];
  function voiceCatsFor(anim) { for (const [re, cats] of MOTION_VOICE) if (re.test(anim)) return cats; return null; }
  // 없는 전용 음성만 다음 후보로 대체한다. 한 개뿐이어도 다른 의미의 음성을 섞지 않는다.
  function voicePoolFor(categories, cats) {
    for (const category of cats) {
      const files = categories[category];
      if (Array.isArray(files) && files.length) return files;
    }
    return [];
  }
  const api = { MOTION_VOICE, voiceCatsFor, voicePoolFor };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.MotionVoice = api;
})(typeof window !== "undefined" ? window : globalThis);
