/* 앱 로그 파일 — 설치판에서는 console.log 가 어디에도 남지 않았다(stdout 뿐). 문제를 알릴 때 붙일 것이 없었다.
 * console.log/warn/error 를 그대로 두고 옆에서 받아 적는다. 시험은 test/app-log.test.js (Electron 없이).
 *   const log = require("./app-log.js").create({ file: <userData>/app.log });
 *   log.install();                 // 이 뒤로 console.* 은 파일에도 남는다 (헤더 한 줄 먼저)
 *   log.flush();                   // 종료 직전에 — 500ms 모아 쓰는 중이라
 * 크기 제한(기본 2MB)을 넘으면 app.log → app.log.1 로 밀고 새로 시작한다. 그러니 파일은 최대 둘.
 * 비밀은 넣지 않는다 — API 키는 어디에도 찍지 않는 것이 규칙이고, 설정 값을 통째로 찍는 곳도 없다.
 * 다만 AI 대화의 첫 60자(chat.js) 처럼 대화 조각은 들어갈 수 있다 — 설정 창의 안내가 그렇게 말한다.
 */
const fs = require("node:fs");

const MAX_BYTES = 2 * 1024 * 1024, FLUSH_MS = 500;

const pad = (n, w = 2) => String(n).padStart(w, "0");
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;

// console 이 받는 인자 그대로 → 한 줄. 오류는 스택까지, 객체는 JSON, 줄바꿈은 공백으로(한 줄 = 한 기록)
function fmt(a) {
  if (a instanceof Error) return a.stack || a.message || String(a);
  if (typeof a === "string") return a;
  if (a === undefined) return "undefined";
  try { return JSON.stringify(a); } catch { return String(a); }
}
function formatLine(level, args, now = new Date()) {
  const body = args.map(fmt).join(" ").replace(/\r?\n/g, "\n  ");   // 스택의 줄바꿈은 들여쓰기로 남긴다 — 읽을 수 있어야 한다
  return `${stamp(now)} ${level.padEnd(5)} ${body}\n`;
}

function create({ file, maxBytes = MAX_BYTES, flushMs = FLUSH_MS } = {}) {
  if (!file) throw new Error("app-log: file 이 필요합니다");
  const rotated = file + ".1";
  let buf = "", timer = null, size = 0, installed = false, broken = false;

  // 시작할 때 한 번, 그리고 쓰다가 넘으면 한 번 더 — 지난 실행의 마지막 로그가 .1 에 남는다
  function rotateIfBig() {
    try { size = fs.existsSync(file) ? fs.statSync(file).size : 0; } catch { size = 0; }
    if (size < maxBytes) return false;
    try { if (fs.existsSync(rotated)) fs.unlinkSync(rotated); fs.renameSync(file, rotated); size = 0; return true; }
    catch { return false; }     // 다른 프로세스가 잡고 있으면 그냥 이어 쓴다
  }
  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!buf || broken) return;
    const chunk = buf; buf = "";
    try { fs.appendFileSync(file, chunk); size += Buffer.byteLength(chunk); }
    catch { broken = true; }   // 디스크가 꽉 찼거나 폴더가 사라진 경우 — 로그 때문에 앱이 죽어선 안 된다
    if (size >= maxBytes) rotateIfBig();
  }
  function write(level, args, now) {
    if (broken) return;
    buf += formatLine(level, args, now);
    if (buf.length > 64 * 1024) flush();                  // 갑자기 많이 찍히면 모아 두지 않는다
    else if (!timer) timer = setTimeout(flush, flushMs);
    if (timer && timer.unref) timer.unref();              // 로그 타이머가 종료를 붙들지 않게
  }
  // console 을 바꿔치기하지 않고 감싼다 — 터미널(개발 실행)에도 그대로 나온다
  function install(header) {
    if (installed) return; installed = true;
    try { fs.mkdirSync(require("node:path").dirname(file), { recursive: true }); } catch {}
    rotateIfBig();
    for (const level of ["log", "info", "warn", "error", "debug"]) {
      const orig = console[level].bind(console);
      console[level] = (...args) => { try { write(level.toUpperCase(), args); } catch {} orig(...args); };
    }
    if (header) write("LOG", [header]);
    process.on("exit", flush);
  }
  return { install, write, flush, rotateIfBig, file, rotated, get size() { return size; } };
}

module.exports = { create, formatLine, MAX_BYTES };
