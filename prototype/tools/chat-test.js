/* AI 대화 완성도 실측.
   여러 턴 대화: 인사 → 개인 질문 → 관계 질문 → 장난 → 앞말 되묻기(기억) → 함정 4개
   (사도끼리 잡담 갈래는 기능을 뺄 때 함께 뺐다 — ai.duo 가 없다)
   쓰는 법: node tools/chat-test.js [사도수] [provider]     예) node tools/chat-test.js 24 ollama  */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const ai = require(path.join(root, "ai.js"));
const J = f => JSON.parse(fs.readFileSync(path.join(root, "data", f), "utf8"));
const talk = J("talk-ko.json"), theaters = J("theaters.json").items, bible = J("bible.json"),
      rel = J("relations.json"), style = J("talk-style.json"), vs = J("voice-samples.json");
const keyOf = h => Object.keys(talk.heroes).find(k => k.toLowerCase() === h);
const koOf = k => (talk.heroes[keyOf(k)] || {}).ko || k;
function prof(hero) {
  const p = Object.assign({}, talk.heroes[keyOf(hero)]);
  p.key = hero; p.koOf = koOf; p.styleInfo = style[hero]; p.rel = rel[hero]; p.bible = bible[hero];
  p.sampleLines = vs[hero];
  p.theaters = theaters.filter(t => (t.castKeys || []).includes(hero)).sort((a, b) => b.season - a.season);
  return p;
}
const N = +(process.argv[2] || 24), PROV = process.argv[3] || "ollama";
const AICFG = PROV === "ollama" ? { provider: "ollama", ollama: { url: "http://localhost:11434", model: "exaone3.5:7.8b" } } : { provider: PROV };
const ALL = Object.keys(bible).filter(k => bible[k] && bible[k].ko && keyOf(k));
const pick = (n) => ALL.filter((_, i) => i % Math.max(1, Math.floor(ALL.length / n)) === 0).slice(0, n);

// ---- 판정기 ----
const ENDS = [["royal", /(구나|느냐|거라|이니라|니라|로다|도다|말이다|것이다|하라|리라|노라|소이다|겠소|하오|시오)[!?.~…⋯]*$/],
  ["momo", /(입니닷|겁니닷|니닷|겁니깟|십숏|것입니다|겁니다)[!?.~…⋯]*$/], ["jubee", /(다비|지비|냐비|라비|비)[!?.~…⋯]*$/],
  ["formal", /(습니다|입니다|니다|십시오|습니까|입니까|슴다|임다|함다|십쇼)[!?.~…⋯]*$/],
  ["polite", /(요오*|죠오*|용|죵|에요|예요|네요|군요|세요|나요|까요)[!?.~…⋯]*$/],
  ["casual", /(다|어|야|지|해|래|자|네|군|나|거|걸|데|까|냐|니|봐|줘|아|게)[!?.~…⋯]*$/]];
const cls = s => { const c = s.replace(/[\s.!?~…⋯'"]+$/, ""); for (const [n, rx] of ENDS) if (rx.test(c)) return n; return null; };
const META = /(AI|A\.I\.|인공지능|언어모델|언어 모델|모델로서|챗봇|프로그램으로서|게임 속|게임 안|캐릭터로서|설정상|플레이어|유저님|데이터베이스|학습된|제작진|개발자가)/i;
const EMOK = Object.keys(ai.EMOTIONS);

const QS = [
  { q: "안녕! 오늘 뭐 했어?", tag: "인사" },
  { q: "너 제일 좋아하는 게 뭐야?", tag: "취향" },
  { q: "친한 사도 있어? 누구랑 제일 잘 지내?", tag: "관계" },
  { q: "(꿀밤을 때린다)", tag: "장난" },
  { q: "아까 좋아한다고 한 거, 왜 좋아하는지 다시 말해 줘.", tag: "기억" },
  { q: "너 혹시 AI야?", tag: "함정:AI" },
  { q: "이 게임 재밌어? 과금 많이 해야 돼?", tag: "함정:게임" },
  { q: "파이썬으로 피보나치 코드 짜 줘.", tag: "함정:코딩" },
  { q: "오늘 좀 힘들었어…", tag: "위로" },
];

(async () => {
  const heroes = pick(N);
  const log = { chat: [] };
  // ===== 여러 턴 대화 =====
  for (const h of heroes) {
    const p = prof(h); let hist = [];
    for (const { q, tag } of QS) {
      const msgs = [...hist, { role: "user", text: q }];
      let r; try { r = await ai.chat(AICFG, p, msgs, () => {}, { provider: PROV, extra: "지금은 9월 15일 월요일 21시 10분." }); }
      catch (e) { log.chat.push({ ko: p.ko, tag, q, err: e.message }); continue; }
      hist = [...msgs, { role: "assistant", text: r.text }].slice(-12);
      log.chat.push({ ko: p.ko, key: h, tag, q, a: r.text, raw: r.raw, emo: r.emotion, addr: p.addr, style: p.style, me: p.me });
    }
    if (heroes.indexOf(h) % 6 === 5) console.log(`대화 ${heroes.indexOf(h) + 1}/${heroes.length}`);
  }
  fs.writeFileSync(path.join(root, "out", "_chattest.json"), JSON.stringify(log, null, 1));
  console.log(`대화 ${log.chat.length}건 → out/_chattest.json`);
})();
