// 사용 흐름 테스트 — Electron 을 새 프로필로 띄워 test-hooks.js 의 자동 점검을 돌린다. 외부 AI 를 쓰지 않는다(SADO_AI_MOCK).
// 에셋도 필요 없다 — 대화 상태·추출기 제어는 마스코트 렌더러와 무관하다.
//   npm run test:flow                        전부 (대화 경쟁 chat → 추출기 extract → 설정 settings)
//   node test/flow.js chat|extract|settings|aifail   골라서
const { spawn } = require("node:child_process");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const electron = require("electron");   // 일반 node 에서 require 하면 실행 파일 경로가 온다
const SCENARIOS = {
  chat: { flag: "--chat-race-test", tag: "RACETEST", limit: 210_000 },
  // 진짜 파이썬 대신 가짜 추출기(node) — "실행파일|인자" 를 setup-window.js 가 읽는다. 뒤에 붙는 extract-all.py 경로는 가짜가 무시한다
  extract: { flag: "--extract-test", tag: "EXTRACTTEST", limit: 60_000, env: { SADO_EXTRACTOR: `${process.execPath}|${path.join(__dirname, "fake-extract.js")}` } },
  settings: { flag: "--settings-test", tag: "SETTINGSTEST", limit: 60_000, seed: "{{{ 깨진 설정 파일" },   // 깨진 settings.json 으로 시작
  // 손짓이 닿는 길: 히트 창에 진짜 입력을 넣어 ipc 까지 오는지. 에셋 없이도 돈다(CI). CSP 가 이 창 스크립트를 막은 적이 있다
  hit: { flag: "--hit-test", tag: "HITTEST", limit: 60_000 },
  // 창이 죽었을 때 기록이 남고 스스로 되살아나는지 (사도가 없으면 설정 창으로)
  crash: { flag: "--crash-test", tag: "CRASHTEST", limit: 90_000 },
  // 이미 켜져 있는데 또 실행: 설정 창 대신 사도가 손을 흔든다. 에셋 없이는(CI) 가져오기 창 갈래만 본다
  second: { flag: "--second-test", tag: "SECONDTEST", limit: 60_000 },
  hints: { flag: "--hints-test", tag: "HINTSTEST", limit: 60_000 },   // 설정 창의 긴 설명 접기 — 펼침·접힘·체크박스 무관
  bounds: { flag: "--bounds-test", tag: "BOUNDSTEST", limit: 60_000 },   // 창 크기·위치 기억 + 화면 밖 복구 + 메뉴 간격 설정
  // 외부 AI 실패: 가짜 OpenAI 호환 서버(test/fake-ai.js)를 띄우고 그쪽으로 보낸다. 모의 AI(SADO_AI_MOCK)는 끈다
  aifail: { flag: "--aifail-test", tag: "AIFAIL", limit: 90_000, env: { SADO_AI_MOCK: "" }, server: ["fake-ai.js", "18081"],
    seed: JSON.stringify({ version: 2, global: { ai: { memory: true, provider: "openai", openai: { base: "http://127.0.0.1:18081/v1", model: "fake" }, keys: { openai: "raw:" + Buffer.from("k").toString("base64") } } }, characters: [{ id: "t1", skin: "Mini_Jubee", mode: "minimi" }] }) },
};
const SEED = JSON.stringify({ version: 2, global: { ai: { memory: true } }, characters: [{ id: "t1", skin: "Mini_Jubee", mode: "minimi" }, { id: "t2", skin: "Mini_Ner", mode: "minimi" }] });
const want = process.argv.slice(2).filter(k => SCENARIOS[k]); const names = want.length ? want : Object.keys(SCENARIOS);
function run(name) {
  const sc = SCENARIOS[name];
  return new Promise((done) => {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), "sadodesk-flow-"));
    // 사도 둘을 미리 둔다 — 빈 프로필이면 옛 앱 폴더 설정을 이관해 와서 시험 전제(사도 둘)가 깨진다
    fs.writeFileSync(path.join(ud, "settings.json"), sc.seed || SEED);
    const env = { ...process.env, SADO_AI_MOCK: "1", SADO_AI_MOCK_MS: "150", ...(sc.env || {}) }; delete env.ELECTRON_RUN_AS_NODE;   // 이 변수가 있으면 electron 이 그냥 node 로 돈다
    for (const k of Object.keys(env)) if (env[k] === "") delete env[k];   // 시나리오가 "" 로 준 것은 끈다는 뜻
    const server = sc.server ? spawn(process.execPath, [path.join(__dirname, sc.server[0]), sc.server[1]], { stdio: "ignore" }) : null;
    const t0 = Date.now();
    const child = spawn(electron, [path.join(__dirname, ".."), `--user-data-dir=${ud}`, sc.flag], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const onData = (d) => { const s = d.toString(); out += s; for (const line of s.split("\n")) if (line.startsWith(sc.tag + " ")) console.log(line.trim()); };
    child.stdout.on("data", onData); child.stderr.on("data", onData);
    const timer = setTimeout(() => { console.log(`FLOW(${name}): ${sc.limit / 1000}초 안에 끝나지 않았다`); child.kill(); }, sc.limit);
    child.on("exit", (code) => {
      clearTimeout(timer); if (server) server.kill();
      try { fs.rmSync(ud, { recursive: true, force: true }); } catch {}
      const count = (w) => (out.match(new RegExp(`^${sc.tag} ${w}`, "gm")) || []).length;
      const fails = count("FAIL"), passes = count("PASS"), okEnd = count("ALL PASS") === 1;
      console.log(`FLOW(${name}): ${passes} pass · ${fails} fail · ${((Date.now() - t0) / 1000).toFixed(0)}s · exit ${code}`);
      const bad = !okEnd || fails > 0 || code !== 0;
      if (bad && !out.includes(sc.tag)) console.log(out.split("\n").filter(l => /error|Error/i.test(l)).slice(0, 8).join("\n"));
      done(!bad);
    });
  });
}
(async () => { let allOk = true; for (const n of names) allOk = (await run(n)) && allOk; process.exit(allOk ? 0 : 1); })();
