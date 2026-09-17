/* 세계관(트릭컬 리바이브/설정) 과 우리 대사를 대조한다. 사도 개인 설정이 아니라 "이 세계의 규칙" 쪽이다.
 *   node tools/world-check.js            data/self-talk.json 전체
 *   node tools/world-check.js --list     규칙만 보기
 * 걸린 줄이 곧 오류는 아니다 — 예외가 있는 규칙이 많아 사람이 한 번 봐야 한다.
 */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const B = require(path.join(root, "tools/selftalk-lib.js"));

// only: 이 사도들에게는 허용. never: 예외 없음.
const RULES = [
  {
    id: "죽음",
    why: "엘리아스에는 죽음이라는 개념이 지워져 있다(주말농장). 죽다·시체·장례·저승이 성립하지 않는다.",
    re: /(죽었|죽는다|죽을 뻔|죽어 버|죽여 버|죽음을|사망|시체|송장|장례식|저승|목숨을 잃|영면에 들)/,
    only: [],
  },
  {
    id: "남성",
    why: "지성체는 전부 여성이다. 영감·아저씨·아빠·오빠·사내 같은 남성 지칭이 성립하지 않는다.",
    re: /(영감님|촌장 영감|아저씨|아빠|아버지|오라버니|오빠|사내|남자|소년|삼촌|할아버지|할아범|아들)(?<!받아들|아들이)/,
    only: ["rohne", "rohnemayor", "elena", "amelia", "ameliar41", "haley", "haleysane", "mute"],  // 엘프는 지구에서 산타 밑에 있었다 — 남성을 안다
  },
  {
    id: "손가락",
    why: "엘리아스 주민은 손가락이 넷이다(교주만 다섯). 손으로 여덟까지 센다.",
    re: /(손가락 다섯|다섯 손가락|열 손가락|손가락 열)/,
    only: [],
  },
  {
    id: "눈·겨울",
    why: "엘리아스는 늘 봄에 가까운 기후로 눈이 내리지 않는다. 눈은 정령산 만년설(아야)과 바깥 글레이시아 쪽 이야기다.",
    re: /(눈이 내리|첫눈|눈사람|폭설|눈보라|함박눈|겨울이 오|한겨울|얼어붙은 대지)/,
    only: ["aya", "guin", "delia", "aurora", "sparrot", "renewaawaken", "renewa_alba", "eisia", "eisiafridge", "ayla"],
  },
  {
    id: "바깥세상",
    why: "엘리아스 밖(안개·황무지·바다)은 아무나 드나들지 못한다. 바다·해적·글레이시아·볼케니카는 바깥 출신이나 빵주를 탄 사도의 몫이다.",
    re: /(해적|바닷가|바다로|항해|갑판|선장|빙하|글레이시아|볼케니카|안개 너머|황무지)/,
    only: ["guin", "delia", "sparrot", "aragnia", "ayla", "aurora", "haley", "haleysane", "snorky", "orr", "elena", "makasha", "uros", "tighero", "shoupan", "kommyswim", "ronnie", "skea"],
  },
  {
    id: "지구·현실",
    why: "지구와 지구 물건을 아는 것은 엘프(외계인)와 교주뿐이다. 토착 사도가 지구 지명·기업·매체를 알 수 없다.",
    re: /(지구|한국|미국|일본|서울|유튜브|넷플릭스|인스타|스마트폰|텔레비전|티브이|지하철|전철|택시|버스 정류장|편의점 삼각김밥)/,
    only: ["elena", "amelia", "ameliar41", "haley", "haleysane", "mute", "rohne", "rohnemayor", "taida", "canna", "allet", "hilde", "nicole", "shoupan", "meluna", "eisia", "eisiafridge", "orr", "lazy", "xxionx", "maestromk2", "renewaawaken", "renewa_alba", "silvia"],
  },
  {
    id: "화폐",
    why: "화폐는 골드·엘리프와 원이다. 달러·엔·유로는 없다.",
    re: /(달러|엔화|유로화|파운드화|위안)/,
    only: [],
  },
  {
    id: "현실종교",
    why: "엘리아스의 종교는 세계수 교단이다. 교회·절·성당 같은 현실 종교 시설이 없다.",
    re: /(교회|성당|사찰|절간|스님|목사|신부님|부처|하느님|하나님)/,
    only: [],
  },
  {
    id: "세계수호칭",
    why: "세계수는 엘드르이고 신으로 모시는 쪽은 요정·마녀·정령이다. 엘프·유령은 공경하지 않는다.",
    re: /(세계수님|엘드르님)/,
    only: ["ner", "nerrage", "joanne", "skea", "kyarot", "crepe", "speakimaid", "erpin", "erpinroyale", "belita", "fricle", "sherum", "makasha"],
  },
  {
    id: "교단재정",
    why: "교단 재정은 늘 적자였고 네르가 관리한다. 에슈르 빵집·리뉴아 극장·클로에 재단소·캬롯 농장은 교단 땅에 월세를 낸다.",
    re: /(교단 금고가 넉넉|교단은 부자|재정이 넉넉)/,
    only: [],
  },
  {
    id: "현실천체",
    why: "엘리아스의 밤하늘 별자리는 지구와 다르다(키디언 사도 스토리). 지구의 별자리·행성 이름이 나올 수 없다.",
    re: /(북두칠성|오리온|카시오페아|백조자리|전갈자리|은하수|화성|금성|목성|토성|명왕성|안드로메다)/,
    only: [],
  },
  {
    id: "현실인물·브랜드",
    why: "지구의 인물·기업 이름을 아는 것은 엘프와 교주뿐이다.",
    re: /(아인슈타인|뉴턴|모차르트|셰익스피어|나폴레옹|콜럼버스|구글|삼성|마이크로소프트)/,
    only: ["elena", "amelia", "ameliar41", "mute", "haley", "haleysane"],
  },
  {
    id: "우주",
    why: "생명체는 세계수의 금제로 특정 고도 위로 나갈 수 없다. 무생물(위성)만 올라간다.",
    re: /(우주로 나가|우주선을 타|우주 여행|달에 가|행성을 떠)/,
    only: ["orr", "elena", "sist", "kidian", "meluna", "yomi", "maestromk2"],
  },
];

function main() {
  if (process.argv.includes("--list")) {
    for (const r of RULES) console.log(`\n[${r.id}] ${r.why}\n  예외: ${r.only.length ? r.only.join(", ") : "없음"}`);
    return;
  }
  const db = JSON.parse(fs.readFileSync(path.join(root, "data/self-talk.json"), "utf8")).heroes;
  const hit = new Map(RULES.map(r => [r.id, []]));
  let tot = 0;
  for (const key of Object.keys(db)) {
    const p = B.profile(key), ko = (p && p.ko) || key;
    for (const l of db[key]) {
      tot++;
      for (const r of RULES) {
        if (r.only.includes(key)) continue;
        const m = r.re.exec(l.t);
        if (m) hit.get(r.id).push(`${ko}(${key})\t«${m[0]}»\t${l.w ? "[" + B.WHEN_KO[l.w] + "] " : ""}${l.t}`);
      }
    }
  }
  let n = 0;
  for (const r of RULES) {
    const rows = hit.get(r.id);
    if (!rows.length) continue;
    n += rows.length;
    console.log(`\n=== [${r.id}] ${rows.length}줄 — ${r.why}`);
    for (const x of rows) console.log("  " + x);
  }
  console.log(`\n${tot}줄 검사 · 걸린 줄 ${n}`);
}
main();
