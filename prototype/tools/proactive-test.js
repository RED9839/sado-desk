/* '먼저 말 걸기'를 main.js 와 똑같은 모양으로 재현한다.
   대화 기억이 켜져 있으면 지난 혼잣말만 쌓인 기록이 그대로 들어가고,
   normalizeMessages 가 그것들을 하나로 합친 뒤 "(계속)" 을 붙인다. */
const fs = require("fs"), path = require("path");
const root = "C:/projects/사도 데스크/prototype";
const ai = require(path.join(root, "ai.js"));
const J = f => JSON.parse(fs.readFileSync(path.join(root, "data", f), "utf8"));
const talk = J("talk-ko.json"), theaters = J("theaters.json").items, bible = J("bible.json"),
      rel = J("relations.json"), style = J("talk-style.json"), vs = J("voice-samples.json");
const koOf = k => (talk.heroes[Object.keys(talk.heroes).find(x => x.toLowerCase() === k)] || {}).ko || k;
function prof(hero) {
  const key = Object.keys(talk.heroes).find(k => k.toLowerCase() === hero);
  const p = Object.assign({}, talk.heroes[key]);
  p.key = hero; p.koOf = koOf; p.styleInfo = style[hero]; p.rel = rel[hero]; p.bible = bible[hero];
  p.sampleLines = vs[hero];
  p.theaters = theaters.filter(t => (t.castKeys || []).includes(hero)).sort((a, b) => b.season - a.season);
  return p;
}
const EXTRA = "사용자가 한동안 아무 말도 하지 않았다. 네가 먼저 한두 문장(60자 안팎)으로 짧게 말을 걸어라 — 안부, 시간대에 맞는 인사, 가벼운 질문이나 혼잣말 중 하나. 대답을 강요하지 말 것.";
const AICFG = { provider: "ollama", ollama: { url: "http://localhost:11434", model: "exaone3.5:7.8b" } };
const ALL = Object.keys(bible).filter(k => bible[k] && bible[k].ko && talk.heroes[Object.keys(talk.heroes).find(x => x.toLowerCase() === k)]);
const HEROES = process.argv[2] === "all" ? ALL : (process.argv[2] || "butter,tig,naia").split(",");
const ROUNDS = +(process.argv[3] || 3);
(async () => {
  const rows = [];
  for (const h of HEROES) {
    const p = prof(h);
    let hist = [];
    for (let i = 1; i <= ROUNDS; i++) {
      const msgs = hist.slice(-2).map(m => ({ role: m.role, text: m.text })); // main.js 와 동일: 먼저 말 걸 때는 최근 두 마디만
      const input = [...msgs, { role: "user", text: "(사용자가 조용히 있다)" }]; // main.js 와 동일: 기록이 있어도 침묵 한 줄을 붙인다
      const sent = ai.normalizeMessages(input);
      const t0 = Date.now();
      let r; try { r = await ai.chat(AICFG, p, input, () => {}, { extra: EXTRA, provider: "ollama" }); }
      catch (e) { rows.push({ ko: p.ko, i, err: e.message }); break; }
      hist = [...hist, { role: "assistant", text: r.text, t: Date.now() }].slice(-12);
      rows.push({ ko: p.ko, i, text: r.text, raw: r.raw, emo: r.emotion, ms: Date.now() - t0,
                  lastUser: sent[sent.length - 1] && sent[sent.length - 1].text });
    }
    if (HEROES.length > 20 && HEROES.indexOf(h) % 10 === 9) console.log("... " + (HEROES.indexOf(h) + 1) + "/" + HEROES.length);
  }
  fs.writeFileSync(path.join(root, "out", "_proact.json"), JSON.stringify(rows, null, 1));
  const cut = s => !/[.!?~…⋯"'」』)\]]\s*$/.test(s.trim()) && !/(다|요|죠|까|군|네|야|어|지|해|줘|봐|자|라|나)\s*$/.test(s.trim());
  const EMO = Object.keys(ai.EMOTIONS);
  const bad = { 잘림: 0, 태그없음: 0, 사전밖태그: 0, 감정오추정: 0, 장문: 0, 줄바꿈: 0, 화면언급: 0, 외국어: 0, 오류: 0 };
  const detail = { 사전밖태그: [], 화면언급: [], 외국어: [], 감정오추정: [], 잘림: [] };
  for (const r of rows) {
    if (r.err) { bad.오류++; continue; }
    if (cut(r.text)) { bad.잘림++; detail.잘림.push(r.ko + ": …" + r.text.slice(-28)); }
    if (!r.raw) bad.태그없음++;
    if (r.raw && !EMO.includes(r.raw)) { bad.사전밖태그++; detail.사전밖태그.push(r.ko + " " + r.raw);
      if (r.emo) { bad.감정오추정++; detail.감정오추정.push(r.ko + " " + r.raw + "→" + r.emo); } }
    if (r.text.length > 120) bad.장문++;
    if (r.text.includes("\n")) bad.줄바꿈++;
    if (/(화면|스크린|모니터|지금 뭐 하는지 봤|보고 있었)/.test(r.text)) { bad.화면언급++; detail.화면언급.push(r.ko + ": " + r.text.slice(0, 50)); }
    const fo = r.text.match(/[\u3040-\u30ff\u4e00-\u9fff]+|[A-Za-z]{4,}/g);
    if (fo) { bad.외국어++; detail.외국어.push(r.ko + ": " + fo.join(",")); }
  }
  fs.writeFileSync(path.join(root, "out", "_proact-detail.json"), JSON.stringify(detail, null, 1));
  const n = rows.length;
  const pct = k => `${bad[k]}건 (${Math.round(bad[k] * 100 / n)}%)`;
  const out = [`먼저 말 걸기 ${HEROES.length}명 × ${ROUNDS}회 = ${n}건 (ollama exaone3.5:7.8b)`, "",
    "| 항목 | 값 |", "|---|---|",
    ...Object.keys(bad).map(k => `| ${k} | ${pct(k)} |`), "",
    `평균 길이 ${Math.round(rows.filter(r => r.text).reduce((a, r) => a + r.text.length, 0) / n)}자 · 평균 ${Math.round(rows.reduce((a, r) => a + (r.ms || 0), 0) / n / 100) / 10}초`];
  // 회차별 — '(계속)' 이 붙는 2회차부터 달라지는가
  for (let i = 1; i <= ROUNDS; i++) { const rs = rows.filter(r => r.i === i && r.text);
    out.push(`${i}회차: 평균 ${Math.round(rs.reduce((a, r) => a + r.text.length, 0) / (rs.length || 1))}자 · 장문 ${rs.filter(r => r.text.length > 120).length}/${rs.length} · 화면언급 ${rs.filter(r => /(화면|스크린|모니터)/.test(r.text)).length}`); }
  fs.writeFileSync(path.join(root, "out", "_proact-report.md"), out.join("\n") + "\n");
  console.log(out.join("\n"));
})();
