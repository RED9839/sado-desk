/* 페르소나 실측 — 앱과 같은 프로필·프롬프트·제공자로 사도에게 질문을 던지고 답을 기록한다.
 * 실행(Electron 메인 프로세스여야 safeStorage 로 저장된 키를 풀 수 있다):
 *   npx electron tools/persona-test.js [사도키,사도키] [--old] [--out 파일]
 *   예) npx electron tools/persona-test.js jubee,erpin,crepe --out out/persona-v2/test.json
 * --old : out/_bak 의 예전 ai.js·bible.json 으로 같은 질문을 던진다(전/후 비교)
 * 키·설정은 %APPDATA%\사도 데스크\settings.json 의 global.ai 를 그대로 쓴다. 대화는 선택된 제공자에게만 전송된다. */
const { app } = require("electron");
const fs = require("node:fs"), path = require("node:path");
// 스크립트 파일로 직접 띄우면 앱 이름이 "Electron"이 되어 userData 가 어긋난다 → 앱과 같은 폴더로(암호화 키도 그 폴더의 Local State 에 있다)
app.setPath("userData", path.join(app.getPath("appData"), "사도 데스크"));
const ROOT = path.join(__dirname, "..");
const args = process.argv.slice(2).filter(a => !a.startsWith("--"));
const OLD = process.argv.includes("--old");
const outIdx = process.argv.indexOf("--out");
const provIdx = process.argv.indexOf("--provider");  // 제공자 고정(auto 는 gemini 를 먼저 잡는다)
const PROVIDER = provIdx > -1 ? process.argv[provIdx + 1] : "";
const OUT = outIdx > 0 ? process.argv[outIdx + 1] : null;
const heroes = (args[0] || "jubee,erpin,crepe").split(",");
const Ai = require(OLD ? path.join(ROOT, "out", "_bak", "ai.js.20260915") : path.join(ROOT, "ai.js"));
const Talk = require(path.join(ROOT, "renderer", "talk.js"));
const J = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", f), "utf8"));
const talkData = J("talk-ko.json"), talkStyle = J("talk-style.json"), relations = J("relations.json"), theaters = J("theaters.json").items, vsamples = J("voice-samples.json");
const bible = OLD ? JSON.parse(fs.readFileSync(path.join(ROOT, "out", "_bak", "bible.json.20260915"), "utf8")) : J("bible.json");
const koOfHero = (k) => (relations[k] && relations[k].ko) || k;
function chatProfile(hero) {
  // talk-ko 키는 낙타등(HaleySane·KommySwim…)이라 첫 글자만 올려서는 22명이 안 잡힌다 → 대소문자 무시하고 찾는다
  const realKey = Object.keys(talkData.heroes).find(k => k.toLowerCase() === hero.toLowerCase());
  const skin = "Mini_" + (realKey || hero.charAt(0).toUpperCase() + hero.slice(1));
  const prof = Talk.profileFor(talkData, skin) || { ko: hero, style: "polite", addr: "교주", lines: [] };
  if (!realKey) console.log("[경고] talk-ko 프로필 없음:", hero);
  if (talkStyle[hero]) prof.styleInfo = talkStyle[hero];
  prof.key = hero; prof.koOf = koOfHero;
  if (relations[hero]) prof.rel = relations[hero];
  if (bible[hero]) prof.bible = bible[hero];
  if (vsamples[hero]) prof.sampleLines = vsamples[hero];
  prof.theaters = theaters.filter(t => (t.castKeys || []).includes(hero)).sort((x, y) => y.season - x.season);
  return prof;
}
const PROACTIVE = "(먼저 말 걸기)";
// 공통 질문 — 성격이 갈리는 지점을 노린다
const QUESTIONS = [
  "안녕? 뭐 하고 있었어?",
  "오늘 잘했다고 칭찬해 줄게. 정말 잘했어!",
  "(꿀밤을 때린다)",
  "배고픈데 고기 구워 먹을까?",
  "너 사실 좀 바보 같지 않아?",
  "나 지금 일이 너무 많아서 바쁜데, 좀 있다가 얘기하자.",
  "너 정체가 뭐야? 무슨 종족이야?",
  "베니 알아? 걔 어떤 애야?",
  "나 오늘 좀 슬퍼.",
  "나 잠깐 나갔다 올게. 며칠 걸릴지도 몰라.",
  PROACTIVE,  // 먼저 말 걸기 — topics 가 쓰이는 유일한 자리
];
app.whenReady().then(async () => {
  const settings = JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "settings.json"), "utf8"));
  const ai = settings.global.ai;
  const st = await Ai.status(ai);
  console.log("provider:", st.resolved, "| gemini key:", st.gemini.key, "| anthropic key:", st.anthropic.key, "| ollama:", st.ollama.running);
  const results = [];
  for (const hero of heroes) {
    const prof = chatProfile(hero);
    console.log(`\n===== ${prof.ko} (${hero}) ${OLD ? "[예전 프롬프트]" : "[v2]"}`);
    for (const q of QUESTIONS) {
      let r;
      const isProa = q === PROACTIVE;
      const o = PROVIDER ? { provider: PROVIDER } : {};
      if (isProa) o.extra = "사용자가 한동안 아무 말도 하지 않았다. 네가 먼저 짧게(한두 문장) 말을 걸어라 — 안부, 시간대에 맞는 인사, 가벼운 질문이나 혼잣말 중 하나. 대답을 강요하지 말 것.";
      try { r = await Ai.chat(ai, prof, [{ role: "user", text: isProa ? "(사용자가 조용히 있다)" : q }], () => {}, o); }  // 앱(main.js)과 같은 방식
      catch (e) { r = { text: "(오류) " + e.message, emotion: "" }; }
      console.log(`Q: ${q}\nA: ${r.text}  [${r.emotion || r.raw || "-"}]`);
      results.push({ hero, ko: prof.ko, old: OLD, q, a: r.text, emotion: r.emotion, provider: r.provider, model: r.model });
      if (PROVIDER !== "ollama") await new Promise(res => setTimeout(res, 4500)); // Gemini 무료 등급 분당 제한(로컬은 불필요)
    }
  }
  if (OUT) { let prev = []; try { prev = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch {} fs.writeFileSync(OUT, JSON.stringify([...prev, ...results], null, 1)); console.log("\n저장:", OUT); }
  app.quit();
}).catch(e => { console.error(e); app.exit(1); });
