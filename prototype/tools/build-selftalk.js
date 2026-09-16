/* 사도 혼잣말 대본을 만든다 — 먼저 말 걸기를 LLM 대신 대본으로 돌리기 위한 것.
 * 걸러 내는 잣대는 tools/selftalk-lib.js 에 모아 두었다. 생산자는 갈아 끼울 수 있다:
 *   node tools/build-selftalk.js jubee,butter 12                 (ollama — 무료·무제한)
 *   npx electron tools/build-selftalk.js all 15 gemini           (설정에 든 키로. 어법이 훨씬 낫다)
 *   node tools/selftalk-prompt.js jubee 15 > out/ask.txt         (ChatGPT 등에 붙여넣기용)
 *   node tools/selftalk-import.js jubee out/받은글.txt            (받은 답을 같은 잣대로 걸러 넣기)
 * 이미 채운 사도는 건너뛴다(--redo 로 다시).
 */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const B = require(path.join(root, "tools/selftalk-lib.js"));
const J = f => JSON.parse(fs.readFileSync(path.join(root, "data", f), "utf8"));
const bible = J("bible.json"), vs = J("voice-samples.json");
const OUT = path.join(root, "data", "self-talk.json");
const { matches } = require(path.join(root, "tools/style-match.js"));

function seedsFor(h, st) {
  const b = bible[h] || {};
  // 예시가 섞이면 모델이 따라 샌다 — 위키 대사표엔 다른 말투도 있다(다야 40줄 중 15줄만 하대)
  const all = B.REF[h] || [], on = all.filter(x => matches(x, st).ok === true);
  return { real: on.length >= 6 ? on : all, topics: (b.topics || []).slice(0, 8),
    react: Object.entries(b.react || {}).slice(0, 8).map(([k, v]) => `${k}: ${v}`),
    quirk: b.quirk || "", voice: (b.voice || []).slice(0, 3), mood: b.mood || "",
    never: (b.never || []).slice(0, 5), samples: (vs[h] || []).slice(0, 3) };
}
function ask(p, s, n, avoid) {
  return [
    `너는 대사 작가다. 모바일 게임 <트릭컬 리바이브>의 사도 "${p.ko}"가 바탕화면 한쪽에 서서 혼자 중얼거리는 말을 쓴다.`,
    `사용자(교주)는 아무 말도 하지 않았다. 대답을 요구하지 않는 혼잣말이다.`, "",
    `이 사도가 실제로 하는 말 — 이 어미만 쓴다. 다른 말투로 새지 마라:`,
    ...s.real.slice(0, 12).map(x => "  " + x),
    ...s.samples.map(x => "  " + x), "",
    `말투: ${s.voice.join(" / ") || "—"}`,
    s.quirk ? `말버릇: ${s.quirk}` : "",
    `자신: ${p.me || "나"} · 교주를 부를 때: ${p.addr || "교주"}`,
    s.mood ? `감정 경향: ${s.mood}` : "",
    `꺼낼 만한 화제: ${s.topics.join(" / ")}`,
    s.react.length ? `성격 참고:\n  ${s.react.slice(0, 5).join("\n  ")}` : "",
    s.never.length ? `하지 않는 것: ${s.never.join(" / ")}` : "",
    avoid.length ? `\n이미 쓴 것(겹치지 말 것):\n  ${avoid.slice(-10).join("\n  ")}` : "", "",
    `${n}줄을 써라. 규칙:`,
    "- 한 줄에 한두 문장, 15~60자. 혼잣말이라 답을 기다리지 않는다.",
    "- 문장마다 위 어미로 맺는다. 한 줄도 예외 없다.",
    "- 한국어 어법에 맞아야 한다. 어미를 억지로 붙여 없는 말을 만들지 않는다(감사사와요 ×, 감사하사와요 ○).",
    `- 사도 이름을 정확히 쓴다(이 사도는 "${p.ko}"). 다른 사도 이름도 틀리면 안 된다.`,
    "- 화면에 뭐가 보이는지는 모른다. 바탕화면·창·커서 같은 '자리'는 말해도 되지만 내용은 모른다.",
    "- 이모지·이모티콘·마크다운·따옴표·번호·화자 이름 금지.",
    "- 줄마다 끝에 감정 하나: [행복] [미소] [분노] [슬픔] [놀람] [냠냠] [삐짐] [기본]", "",
    "형식(이 형식만, 설명 없이):",
    `${s.samples[0] || "오늘은 꽃밭을 한 바퀴 돌고 왔다."} [행복]`,
  ].filter(Boolean).join("\n");
}
async function genOllama(sys, n) {
  const r = await fetch("http://localhost:11434/api/chat", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "exaone3.5:7.8b", messages: [{ role: "system", content: sys }, { role: "user", content: `${n}줄 써라.` }],
      stream: false, keep_alive: "10m", options: { temperature: 1.0, num_predict: 900 } }) });
  return ((await r.json()).message || {}).content || "";
}
async function main(gen, sleepMs) {
  const arg = (process.argv[2] || "butter").toLowerCase(), WANT = +(process.argv[3] || 12);
  const redo = process.argv.includes("--redo");
  const ALL = Object.keys(bible).filter(k => bible[k] && bible[k].ko && B.keyOf(k));
  const HS = arg === "all" ? ALL : arg.split(",").map(x => x.trim()).filter(x => ALL.includes(x));
  const corpus = B.loadCorpus();
  const db = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { _meta: B.META, heroes: {} };
  console.log(`원문 조각 ${corpus.size}개 · 사도 ${HS.length}명 · 목표 ${WANT}줄`);
  for (const h of HS) {
    if (!redo && (db.heroes[h] || []).length >= WANT) { console.log(`${h} — 이미 있음, 건너뜀`); continue; }
    const p = B.profile(h), s = seedsFor(h, p.style);
    const kept = [], why = {};
    for (let round = 0; round < 8 && kept.length < WANT; round++) {
      const n = Math.max(6, (WANT - kept.length) * 2);
      let txt; try { txt = await gen(ask(p, s, n, kept.map(x => x.t)), n); } catch (e) { console.log("  생성 실패:", e.message); break; }
      for (const line of B.parse(txt)) {
        if (kept.length >= WANT) break;
        const rs = B.reasons(line, p, kept.map(x => x.t), corpus);
        if (rs.length) { for (const r of rs) why[r] = (why[r] || 0) + 1; continue; }
        kept.push(line);
      }
      if (sleepMs) await new Promise(r => setTimeout(r, sleepMs));
    }
    db.heroes[h] = kept;
    fs.writeFileSync(OUT, JSON.stringify(db, null, 1), "utf8");
    console.log(`${p.ko.padEnd(14)} ${kept.length}/${WANT}줄  버린 이유: ${Object.entries(why).map(([k, v]) => k + " " + v).join(", ") || "없음"}`);
  }
  console.log("\n→ data/self-talk.json   (동작 붙이기: node tools/selftalk-act.js)");
}
// 제공자: 기본 ollama. gemini·openai 는 앱 설정의 키를 써야 해서 electron 으로 띄운다
const PROV = (process.argv[4] || "ollama").toLowerCase();
if (PROV === "ollama") main(genOllama, 0);
else {
  const { app } = require("electron");
  app.setPath("userData", path.join(process.env.APPDATA, "사도 데스크"));
  const ai = require(path.join(root, "ai.js"));
  app.whenReady().then(async () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "settings.json"), "utf8")).global.ai;
    console.log("제공자:", PROV);
    await main(async (sys, n) => {
      const r = await ai.chat(cfg, { ko: "", style: "polite", addr: "교주", lines: [] },
        [{ role: "user", text: `${n}줄 써라.` }], () => {}, { provider: PROV, system: sys, extra: sys });
      return r.text;
    }, PROV === "gemini" ? 4500 : 1200);
    app.quit();
  });
}
