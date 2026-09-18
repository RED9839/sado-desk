// 가짜 에셋 추출기 — test-hooks.js 의 --extract-test 가 진짜 extract-all.py 대신 띄운다 (setup-window.js 의 SADO_EXTRACTOR).
// 진짜와 같은 모양으로 stdout 에 JSON 한 줄씩 낸다. --steps 값이 시나리오: fail · hang · ok
const { spawn } = require("node:child_process");
const args = process.argv.slice(2), mode = args[args.indexOf("--steps") + 1] || "ok";
const say = (o) => process.stdout.write(JSON.stringify(o) + "\n");
say({ step: "minimi", msg: `가짜 추출기 시작 (${mode})`, level: "info" });
if (mode === "fail") { say({ step: "minimi", msg: "치명적 오류 시나리오: 기기를 찾지 못했어요", level: "error" }); process.exit(3); }
if (mode === "hang") {
  // adb·변환 일꾼처럼 손자 프로세스를 하나 두고 멈춘다 — 취소가 나무째 죽이는지 보려고.
  // detached 여야 한다: node 는 제 자식을 잡 오브젝트에 넣어 제가 죽으면 같이 죽인다(파이썬은 안 그런다). 떼어 놓아야 파이썬 밑의 adb 와 같은 처지가 된다
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", detached: true }); child.unref();
  say({ step: "hang", child: child.pid, level: "info" });
  setInterval(() => {}, 1000);
} else { say({ step: "sfx", msg: "진행 중", level: "info" }); setTimeout(() => process.exit(0), 300); }
