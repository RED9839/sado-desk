// 사용 흐름 테스트 — Electron 을 새 프로필로 띄워 test-hooks.js 의 --chat-race-test 를 돌린다.
// 외부 AI 를 쓰지 않는다(SADO_AI_MOCK). 에셋도 필요 없다 — 대화 상태는 마스코트 렌더러와 무관하다.
//   npm run test:flow
const { spawn } = require("node:child_process");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const electron = require("electron");   // 일반 node 에서 require 하면 실행 파일 경로가 온다
const ud = fs.mkdtempSync(path.join(os.tmpdir(), "sadodesk-flow-"));
// 사도 둘을 미리 둔다 — 빈 프로필이면 옛 앱 폴더 설정을 이관해 와서 시험 전제(사도 둘)가 깨진다
fs.writeFileSync(path.join(ud, "settings.json"), JSON.stringify({ version: 2, global: { ai: { memory: true } }, characters: [{ id: "t1", skin: "Mini_Jubee", mode: "minimi" }, { id: "t2", skin: "Mini_Ner", mode: "minimi" }] }));
const env = { ...process.env, SADO_AI_MOCK: "1", SADO_AI_MOCK_MS: "150" }; delete env.ELECTRON_RUN_AS_NODE;   // 이 변수가 있으면 electron 이 그냥 node 로 돈다
const t0 = Date.now();
const child = spawn(electron, [path.join(__dirname, ".."), `--user-data-dir=${ud}`, "--chat-race-test"], { env, stdio: ["ignore", "pipe", "pipe"] });
let out = "";
const onData = (d) => { const s = d.toString(); out += s; for (const line of s.split("\n")) if (/^RACETEST /.test(line)) console.log(line.trim()); };
child.stdout.on("data", onData); child.stderr.on("data", onData);
const timer = setTimeout(() => { console.log("FLOW: 90초 안에 끝나지 않았다"); child.kill(); }, 90_000);
child.on("exit", (code) => {
  clearTimeout(timer);
  try { fs.rmSync(ud, { recursive: true, force: true }); } catch {}
  const fails = (out.match(/^RACETEST FAIL/gm) || []).length, passes = (out.match(/^RACETEST PASS/gm) || []).length;
  const okEnd = /^RACETEST ALL PASS/m.test(out);
  console.log(`FLOW: ${passes} pass · ${fails} fail · ${((Date.now() - t0) / 1000).toFixed(0)}s · exit ${code}`);
  if (!okEnd || fails || code !== 0) { if (!/RACETEST/.test(out)) console.log(out.split("\n").filter(l => /error|Error/i.test(l)).slice(0, 8).join("\n")); process.exit(1); }
});
