/* 한글 표기 — 마스코트 창과 설정 창이 공유. window.KO 로 노출.
 * 사도/스킨 이름은 assets/names-ko.json (KO.load(assetRoot) 로 읽음), 애니/보이스 종류는 여기 표.
 */
(() => {
  let names = { heroes: {}, skins: {}, guessed: [], defaultSkin: "기본 사복" };
  const guessed = new Set();

  function load(dataRoot) { // 앱이 배포하는 data/names-ko.json (예전엔 assets/에 있었음)
    try { names = JSON.parse(window.host.readText(`${dataRoot}/names-ko.json`)); } catch (e) { console.warn("names-ko.json 없음", e); }
    guessed.clear(); for (const g of names.guessed || []) guessed.add(g);
  }
  // "Mini_ErpinSkin1" → { hero:"Erpin", skinNo:"1" }
  function parse(skinName) {
    const m = String(skinName).replace(/^Mini_/, "").match(/^(.*?)(?:Skin(\d+))?$/);
    return { hero: m[1], skinNo: m[2] || null };
  }
  const heroName = (hero) => names.heroes[hero] || hero;
  const isGuessed = (skinName) => guessed.has(parse(skinName).hero);
  // 캐릭터 표시 이름: "크레페" / "에르핀 · 하드 워킹 홀리데이" / "크레페 · 스킨 2"
  function skinName(skinName, { withSkin = true } = {}) {
    const { hero, skinNo } = parse(skinName);
    const base = heroName(hero);
    if (!withSkin || !skinNo) return base;
    const sk = names.skins[hero]?.[skinNo];
    return `${base} · ${sk || "스킨 " + skinNo}`;
  }
  const skinTitle = (skinName) => { const { hero, skinNo } = parse(skinName); return skinNo ? (names.skins[hero]?.[skinNo] || `스킨 ${skinNo}`) : names.defaultSkin; };
  // 검색용: 영문 원본 + 한글 이름 + 스킨 이름
  const searchText = (skinName) => `${skinName} ${skinTitle(skinName)} ${heroName(parse(skinName).hero)}`.toLowerCase();

  // 애니메이션: Idle2_3 → "대기 2-3", Jump4 → "점프 4", Spawn10 → "등장 10"
  const ANIM_GROUP = { Idle: "대기", Act: "동작", Jump: "점프", Spawn: "등장", Throw: "던지기", Attack: "공격", Success: "성공", Fail: "실패" };
  const ANIM_NOTE = { Idle1_1: "숨쉬기", Idle1_2: "숨쉬기·갸웃", Idle2_1: "폴짝", Idle2_2: "높이 폴짝", Idle2_3: "찌그러지기", Idle2_4: "크게 찌그러지기", Idle2_5: "납작", Idle3_7: "뒤집기", Idle: "느긋한 대기", Idle2: "느긋한 대기 2", Act5_1: "쭉 늘어나기", Act6_1: "갸웃갸웃", Success: "만세", Fail: "풀썩" };
  function anim(name) {
    const m = String(name).match(/^([A-Za-z]+?)(\d+)?(?:_(\d+))?$/);
    if (!m) return name;
    const g = ANIM_GROUP[m[1]] || m[1];
    const num = m[2] ? ` ${m[2]}${m[3] ? "-" + m[3] : ""}` : "";
    const note = ANIM_NOTE[name] ? ` (${ANIM_NOTE[name]})` : "";
    return `${g}${num}${note}`;
  }
  const animGroup = (name) => ANIM_GROUP[String(name).replace(/[\d_].*$/, "")] || String(name).replace(/[\d_].*$/, "");

  // 보이스 종류
  const VOICE = { touch: "터치(볼 당기기·쓰다듬기)", cheek: "볼 당기기", pat: "쓰다듬기", dutchrubend: "꿀밤", ticklestart: "간지럽히기 시작", tickleduring: "간지럽히기 웃음", greeting: "인사", line: "대기 대사", spawn: "등장", joy: "기쁨", pleasure: "즐거움", anger: "분노", sorrow: "슬픔", surprise: "놀람", sorry: "미안", eat: "먹기", hmm: "고민", yes: "긍정", no: "부정", callplayer: "부르기", affinity: "호감도", growth: "성장", victory: "승리", defeat: "패배", die: "쓰러짐", birthday: "생일", start: "시작", end: "종료" };
  const voiceCat = (cat) => VOICE[cat] || cat;

  window.KO = { load, parse, heroName, skinName, skinTitle, searchText, isGuessed, anim, animGroup, voiceCat, get names() { return names; } };
})();
