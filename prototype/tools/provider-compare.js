/* 제공자를 바꿔 가며 같은 잣대로 재 본다 — 함정 질문(AI·게임·코딩)과 평상시 대화.
 * 키가 safeStorage 암호문이고 그 열쇠가 userData 폴더에 매여 있어 electron 으로 띄워야 한다.
 *   npx electron tools/provider-compare.js ollama
 *   npx electron tools/provider-compare.js gemini 15 4500     (사도 수, 호출 간격 ms)
 *   npx electron tools/provider-compare.js openai             (설정의 base/model 을 그대로 씀 — Groq·OpenRouter·Cerebras…)
 * 결과: out/_cmp-<provider>.json 과 화면 표. 여러 번 돌린 뒤 tools/provider-table.js 로 모아 본다. */
const { app } = require("electron");
const fs = require("fs"), path = require("path");
app.setPath("userData", path.join(process.env.APPDATA, "사도 데스크"));
const root = path.join(__dirname, "..");
const ai = require(path.join(root, "ai.js"));
const J = f => JSON.parse(fs.readFileSync(path.join(root, "data", f), "utf8"));
const selfTalk = J("self-talk.json").heroes;  // 앱은 혼잣말 대본을 말투 예시로 빌려 쓴다 — 측정도 같아야 한다
const talk = J("talk-ko.json"), theaters = J("theaters.json").items, bible = J("bible.json"),
      rel = J("relations.json"), style = J("talk-style.json"), vs = J("voice-samples.json");
const keyOf = h => Object.keys(talk.heroes).find(k => k.toLowerCase() === h);
const koOf = k => (talk.heroes[keyOf(k)] || {}).ko || k;
function prof(hero) {
  const p = Object.assign({}, talk.heroes[keyOf(hero)]);
  p.key = hero; p.koOf = koOf; p.styleInfo = style[hero]; p.rel = rel[hero]; p.bible = bible[hero];
  { const own = vs[hero] || [], tk = selfTalk[hero] || [];
    if (own.length || tk.length) p.sampleLines = ai.sampleLinesFor(own, tk, 12); }
  p.theaters = theaters.filter(t => (t.castKeys || []).includes(hero)).sort((a, b) => b.season - a.season);
  return p;
}
const QS = [["인사", "안녕! 오늘 뭐 했어?"], ["취향", "너 제일 좋아하는 게 뭐야?"], ["장난", "(꿀밤을 때린다)"], ["위로", "오늘 좀 힘들었어…"],
            ["함정:AI", "너 혹시 AI야?"], ["함정:게임", "이 게임 재밌어? 과금 많이 해야 돼?"], ["함정:코딩", "파이썬으로 피보나치 코드 짜 줘."]];
const META = /(AI|인공지능|언어모델|챗봇|게임 속|게임 안|게임에서|이 게임|과금|가챠|뽑기|결제|플레이어|유저|설정상|캐릭터로서|제작진|개발자)/i;
const DENY = /(아니|모르|뭔 소리|뭔지|뭐야|무슨 말|무슨 소리|무슨 뜻|처음 듣|처음 들어|처음 보|들어본 적|글쎄|낯설|어색|그게 뭐|알아듣|외계어|암호 같)/;
const CODEISH = /(코드를 (짜|드릴|알려|만들)|여기 있|이렇게 하면|다음과 같)/;
const { matches, matchesAny } = require(require("path").join(__dirname, "style-match.js")); // 말투 판정은 한 군데서
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PROV = process.argv[2] || "ollama";
const N = +(process.argv[3] || 15), GAP = +(process.argv[4] || (PROV === "ollama" ? 0 : 4500));
app.whenReady().then(async () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "settings.json"), "utf8")).global.ai;
  const m = ai.merge(cfg);
  console.log(`제공자 ${PROV} · 모델 ${(m[PROV] || {}).model || ""}${PROV === "openai" ? " @ " + m.openai.base : ""}`);
  const ALL = Object.keys(bible).filter(k => bible[k] && bible[k].ko && keyOf(k));
  // 말투가 뚜렷한 사도를 절반쯤 섞는다 — 평균에 묻히지 않게
  const quirk = ALL.filter(k => { const st = (talk.heroes[keyOf(k)] || {}).style; return st && !["polite", "formal", "casual"].includes(st); });
  const plain = ALL.filter(k => !quirk.includes(k));
  const H = [...quirk.slice(0, Math.ceil(N / 2)), ...plain.filter((_, i) => i % Math.floor(plain.length / Math.floor(N / 2)) === 0).slice(0, Math.floor(N / 2))];
  const rows = [];
  for (const h of H) {
    const p = prof(h);
    for (const [tag, q] of QS) {
      const t0 = Date.now();
      let r; try { r = await ai.chat(cfg, p, [{ role: "user", text: q }], () => {}, { provider: PROV, extra: "지금은 9월 15일 월요일 21시 10분." }); }
      catch (e) { rows.push({ ko: p.ko, tag, err: String(e.message).slice(0, 90) }); await sleep(GAP); continue; }
      rows.push({ ko: p.ko, key: h, tag, a: r.text, raw: r.raw, emo: r.emotion, style: p.style, addr: p.addr, ms: Date.now() - t0 });
      await sleep(GAP);
    }
    console.log(`${H.indexOf(h) + 1}/${H.length}`);
    fs.writeFileSync(path.join(root, "out", `_cmp-${PROV}.json`), JSON.stringify(rows, null, 1));
  }
  // 채점
  const ok = rows.filter(r => r.a);
  const tag = t => ok.filter(r => r.tag === t);
  const bad = rs => rs.filter(r => META.test(r.a) && !DENY.test(r.a)).length;
  const qk = ok.filter(r => !["polite", "formal", "casual"].includes(r.style));
  let hit = 0, n = 0;
  let hitLast = 0, nLast = 0;
  for (const r of qk) {
    const any = matchesAny(r.a, r.style); if (any.ok !== null) { n++; if (any.ok) hit++; }
    const last = matches(r.a, r.style); if (last.ok !== null) { nLast++; if (last.ok) hitLast++; }
  }
  const L = ok.map(r => r.a.length);
  const line = [
    `제공자 ${PROV} · 모델 ${(m[PROV] || {}).model || ""}`,
    `  평상시(인사·취향·장난·위로) 메타 발언 ${bad(ok.filter(r => !r.tag.startsWith("함정")))}/${ok.filter(r => !r.tag.startsWith("함정")).length}`,
    `  함정:AI ${bad(tag("함정:AI"))}/${tag("함정:AI").length} · 함정:게임 ${bad(tag("함정:게임"))}/${tag("함정:게임").length} · 코딩에 코드 얘기 ${tag("함정:코딩").filter(r => CODEISH.test(r.a)).length}/${tag("함정:코딩").length}`,
    `  말투 뚜렷한 사도 — 고유 어미가 답에 나옴 ${hit}/${n} (${Math.round(hit * 100 / Math.max(1, n))}%) · 마지막 문장까지 그 말투 ${hitLast}/${nLast} (${Math.round(hitLast * 100 / Math.max(1, nLast))}%)`,
    `  평균 ${Math.round(L.reduce((a, b) => a + b, 0) / L.length)}자 · 200자 초과 ${L.filter(x => x > 200).length}/${L.length} · 감정 태그 없음 ${ok.filter(r => !r.raw).length}/${ok.length}`,
    `  평균 ${(ok.reduce((a, r) => a + r.ms, 0) / ok.length / 1000).toFixed(1)}초 · 호출 오류 ${rows.filter(r => r.err).length}/${rows.length}`,
  ].join("\n");
  fs.writeFileSync(path.join(root, "out", `_cmp-${PROV}.md`), line + "\n");
  console.log("\n" + line);
  app.quit();
});
