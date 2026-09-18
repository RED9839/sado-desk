// 설치판 첫 실행 검증 — 빌드된 exe 를 빈 프로필로 띄워 '가져오기' 창이 첫 화면으로 뜨는지 본다 (test-hooks.js --first-run-test).
//   npm run test:first-run            dist/win-unpacked 의 exe (없으면 설치된 exe)
//   node test/first-run.js <exe 경로>
const { spawn } = require("node:child_process");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const cands = [process.argv[2], path.join(__dirname, "..", "dist", "win-unpacked", "사도 데스크.exe"), path.join(process.env.LOCALAPPDATA || "", "Programs", "sado-desk", "사도 데스크.exe")].filter(Boolean);
const exe = cands.find(p => fs.existsSync(p));
if (!exe) { console.log("FIRSTRUN: exe 가 없다 — npm run build 먼저 (" + cands.join(" | ") + ")"); process.exit(2); }
const ud = fs.mkdtempSync(path.join(os.tmpdir(), "sadodesk-firstrun-"));   // 비어 있다 — 설정도 에셋도 없다
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;   // 이 변수가 있으면 exe 가 그냥 node 로 돈다
const t0 = Date.now();
const child = spawn(exe, ["--userdata", ud, "--first-run-test"], { env, stdio: ["ignore", "pipe", "pipe"] });
let out = "";
const onData = (d) => { const s = d.toString(); out += s; for (const line of s.split("\n")) if (line.startsWith("FIRSTRUN ")) console.log(line.trim()); };
child.stdout.on("data", onData); child.stderr.on("data", onData);
const timer = setTimeout(() => { console.log("FIRSTRUN: 30초 안에 끝나지 않았다"); child.kill(); }, 30_000);
child.on("exit", (code) => {
  clearTimeout(timer);
  try { fs.rmSync(ud, { recursive: true, force: true }); } catch {}
  const fails = (out.match(/^FIRSTRUN FAIL/gm) || []).length, passes = (out.match(/^FIRSTRUN PASS/gm) || []).length;
  console.log(`FIRSTRUN: ${exe}\nFIRSTRUN: ${passes} pass · ${fails} fail · ${((Date.now() - t0) / 1000).toFixed(0)}s · exit ${code}`);
  if (!/^FIRSTRUN ALL PASS/m.test(out) || fails || code !== 0) { if (!/FIRSTRUN/.test(out)) console.log(out.slice(-1500)); process.exit(1); }
});
