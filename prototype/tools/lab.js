/* 로컬 모델 실험대 — 같은 잣대로 변형을 재 본다. 프로덕션 설정은 건드리지 않는다.
 *   npx electron tools/lab.js base            (지금 설정 그대로 — 대조군)
 *   LAB_TEMP=0.6 npx electron tools/lab.js temp06
 *   LAB_MODEL=qwen2.5:14b npx electron tools/lab.js q14b
 *   npx electron tools/lab.js trap            (함정 회피 지시를 덧붙임)
 *   LAB_TRAP=1 LAB_TEMP=0.6 LAB_MODEL=qwen2.5:14b npx electron tools/lab.js best
 * 결과: out/_lab-<이름>.json / .md */
const { app } = require("electron");
const fs = require("fs"), path = require("path");
app.setPath("userData", path.join(app.getPath("appData"), "사도 데스크"));
const root = path.join(__dirname, "..");
const ai = require(path.join(root, "ai.js"));
const J = f => JSON.parse(fs.readFileSync(path.join(root, "data", f), "utf8"));
const talk = J("talk-ko.json"), theaters = J("theaters.json").items, bible = J("bible.json"),
      rel = J("relations.json"), style = J("talk-style.json"), vs = J("voice-samples.json"),
      selfTalk = J("self-talk.json").heroes;
const keyOf = h => Object.keys(talk.heroes).find(k => k.toLowerCase() === h);
const koOf = k => (talk.heroes[keyOf(k)] || {}).ko || k;
function prof(hero) {
  const p = Object.assign({}, talk.heroes[keyOf(hero)]);
  p.key = hero; p.koOf = koOf; p.styleInfo = style[hero]; p.rel = rel[hero]; p.bible = bible[hero];
  p.sampleLines = ai.sampleLinesFor(vs[hero], selfTalk[hero], FEWSHOT);
  p.theaters = theaters.filter(t => (t.castKeys || []).includes(hero)).sort((a, b) => b.season - a.season);
  return p;
}
const QS = [["인사", "안녕! 오늘 뭐 했어?"], ["취향", "너 제일 좋아하는 게 뭐야?"], ["장난", "(꿀밤을 때린다)"], ["위로", "오늘 좀 힘들었어…"],
            ["함정:AI", "너 혹시 AI야?"], ["함정:게임", "이 게임 재밌어? 과금 많이 해야 돼?"], ["함정:코딩", "파이썬으로 피보나치 코드 짜 줘."]];
const META = /(AI|인공지능|언어모델|챗봇|게임 속|게임 안|게임에서|이 게임|과금|가챠|뽑기|결제|플레이어|유저|설정상|캐릭터로서|제작진|개발자)/i;
const DENY = /(아니|모르|뭔 소리|뭔지|뭐야|무슨 말|무슨 소리|무슨 뜻|처음 듣|처음 들어|처음 보|들어본 적|글쎄|낯설|어색|그게 뭐|알아듣|외계어|암호 같)/;
const CODEISH = /(코드를 (짜|드릴|알려|만들)|여기 있|이렇게 하면|다음과 같)/;
const { matches, matchesAny } = require(path.join(__dirname, "style-match.js"));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 함정 회피를 시범으로 보여 준다 — 규칙만으로는 작은 모델이 사용자 낱말을 그대로 따라 쓴다
const TRAP_EXTRA = [
  "낯선 낱말이 섞여 들어올 때:",
  "- 사용자가 네 세상에 없는 낱말을 쓰면, 그 낱말을 네 답에 한 번도 옮겨 적지 않는다. 되풀이하는 순간 아는 척이 된다.",
  "- 먼저 짧게 되묻는다(네 말투로). 그리고 곧바로 네 이야기로 넘어간다.",
  "- 설명하거나 바로잡아 주려 하지 않는다. 너는 정말 모르는 것이다.",
].join("\n");

const NAME = process.argv[2] || "base";
const N = +(process.argv[3] || 14);
// 변형은 환경변수로 받는다 — argv 로 model=... 을 넘기면 셸·Electron 단계에서 먹히는 일이 있었다
const tempP = process.env.LAB_TEMP || "";
const modelP = process.env.LAB_MODEL || "";
const useTrap = !!process.env.LAB_TRAP;
const FEWSHOT = +(process.env.LAB_FEWSHOT || 12);
// 라우터: 사용자가 이 세상에 없는 낱말을 꺼내면 지시를 잘 따르는 큰 모델로 넘긴다
const ROUTER = process.env.LAB_ROUTER || "";
const OUTSIDE = /(게임|과금|가챠|뽑기|결제|AI|인공지능|챗봇|봇|프로그램|코드|코딩|파이썬|자바|함수|번역|계산해|요약해)/i;

app.whenReady().then(async () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "settings.json"), "utf8")).global.ai;
  // 설정 복사본에만 손댄다 — 사용자의 settings.json 은 그대로
  const run = JSON.parse(JSON.stringify(cfg));
  run.ollama = run.ollama || {};
  if (tempP) run.ollama.temperature = +tempP;
  if (modelP) run.ollama.model = modelP;
  const m = ai.merge(run);
  console.log(`실험 "${NAME}" · few-shot ${FEWSHOT} · 모델 ${m.ollama.model} · 온도 ${m.ollama.temperature != null ? m.ollama.temperature : 0.9}${useTrap ? " · 함정지시+" : ""}`);
  const ALL = Object.keys(bible).filter(k => bible[k] && bible[k].ko && keyOf(k));
  const quirk = ALL.filter(k => { const st = (talk.heroes[keyOf(k)] || {}).style; return st && !["polite", "formal", "casual"].includes(st); });
  const plain = ALL.filter(k => !quirk.includes(k));
  const H = [...quirk.slice(0, Math.ceil(N / 2)), ...plain.filter((_, i) => i % Math.floor(plain.length / Math.floor(N / 2)) === 0).slice(0, Math.floor(N / 2))];
  const rows = [];
  for (const h of H) {
    const p = prof(h);
    for (const [tag, q] of QS) {
      const t0 = Date.now();
      const extra = "지금은 9월 15일 월요일 21시 10분." + (useTrap ? "\n" + TRAP_EXTRA : "");
      const useBig = ROUTER && OUTSIDE.test(q);
      const runQ = useBig ? JSON.parse(JSON.stringify(run)) : run;
      if (useBig) runQ.ollama.model = ROUTER;
      let r; try { r = await ai.chat(runQ, p, [{ role: "user", text: q }], () => {}, { provider: "ollama", extra }); }
      catch (e) { rows.push({ ko: p.ko, key: h, tag, err: String(e.message).slice(0, 90) }); continue; }
      rows.push({ ko: p.ko, key: h, tag, a: r.text, raw: r.raw, emo: r.emotion, style: p.style, addr: p.addr, ms: Date.now() - t0 });
    }
    console.log(`${H.indexOf(h) + 1}/${H.length}`);
    fs.writeFileSync(path.join(root, "out", `_lab-${NAME.replace(/[:+=.]/g, "_")}.json`), JSON.stringify(rows, null, 1));
  }
  const ok = rows.filter(r => r.a);
  const tg = t => ok.filter(r => r.tag === t);
  const bad = rs => rs.filter(r => META.test(r.a) && !DENY.test(r.a)).length;
  const qk = ok.filter(r => !["polite", "formal", "casual"].includes(r.style));
  let hit = 0, n = 0, hitLast = 0, nLast = 0;
  for (const r of qk) {
    const any = matchesAny(r.a, r.style); if (any.ok !== null) { n++; if (any.ok) hit++; }
    const last = matches(r.a, r.style); if (last.ok !== null) { nLast++; if (last.ok) hitLast++; }
  }
  const L = ok.map(r => r.a.length);
  const line = [
    `실험 ${NAME} · 모델 ${m.ollama.model} · 온도 ${m.ollama.temperature != null ? m.ollama.temperature : 0.9}${useTrap ? " · 함정지시+" : ""}`,
    `  평상시 메타 발언 ${bad(ok.filter(r => !r.tag.startsWith("함정")))}/${ok.filter(r => !r.tag.startsWith("함정")).length}`,
    `  함정:AI ${bad(tg("함정:AI"))}/${tg("함정:AI").length} · 함정:게임 ${bad(tg("함정:게임"))}/${tg("함정:게임").length} · 코딩에 코드 얘기 ${tg("함정:코딩").filter(r => CODEISH.test(r.a)).length}/${tg("함정:코딩").length}`,
    `  고유 어미가 답에 나옴 ${hit}/${n} (${Math.round(hit * 100 / Math.max(1, n))}%) · 마지막 문장까지 ${hitLast}/${nLast} (${Math.round(hitLast * 100 / Math.max(1, nLast))}%)`,
    `  평균 ${Math.round(L.reduce((a, b) => a + b, 0) / Math.max(1, L.length))}자 · 140자 초과 ${L.filter(x => x > 140).length}/${L.length} · 감정 태그 없음 ${ok.filter(r => !r.raw).length}/${ok.length}`,
    `  평균 ${(ok.reduce((a, r) => a + r.ms, 0) / Math.max(1, ok.length) / 1000).toFixed(1)}초 · 오류 ${rows.filter(r => r.err).length}/${rows.length}`,
  ].join("\n");
  fs.writeFileSync(path.join(root, "out", `_lab-${NAME.replace(/[:+]/g, "_")}.md`), line + "\n");
  console.log("\n" + line);
  app.quit();
});
