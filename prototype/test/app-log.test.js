/* 앱 로그 파일 — 한 줄 형식, 모아 쓰기, 크기 넘으면 .1 로 밀기, 깨져도 앱을 죽이지 않기 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { create, formatLine } = require("../app-log.js");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sadodesk-log-"));

test("한 줄 = 한 기록: 시각·수준·본문, 오류는 스택, 객체는 JSON, 줄바꿈은 들여쓰기", () => {
  const now = new Date(2026, 8, 21, 9, 5, 7, 42);
  assert.equal(formatLine("LOG", ["assets:", "ok", 3], now), "2026-09-21 09:05:07.042 LOG   assets: ok 3\n");
  assert.equal(formatLine("WARN", [{ a: 1 }], now), "2026-09-21 09:05:07.042 WARN  {\"a\":1}\n");
  const e = new Error("boom"); e.stack = "Error: boom\n    at x.js:1";
  assert.equal(formatLine("ERROR", ["uncaught:", e], now), "2026-09-21 09:05:07.042 ERROR uncaught: Error: boom\n      at x.js:1\n");
  assert.equal(formatLine("LOG", [undefined, null], now).trim().endsWith("undefined null"), true);
});

test("모아 두었다가 flush 에 파일로 — 순서 그대로", () => {
  const file = path.join(tmp(), "app.log"), log = create({ file, flushMs: 100000 });
  log.write("LOG", ["첫째"]); log.write("WARN", ["둘째"]);
  assert.equal(fs.existsSync(file), false);            // 아직 안 썼다
  log.flush();
  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /LOG {3}첫째$/); assert.match(lines[1], /WARN {2}둘째$/);
});

test("크기를 넘으면 app.log → app.log.1, 새 파일에 이어 쓴다. 파일은 최대 둘", () => {
  const dir = tmp(), file = path.join(dir, "app.log"), log = create({ file, maxBytes: 200, flushMs: 100000 });
  for (let i = 0; i < 10; i++) { log.write("LOG", ["x".repeat(40), i]); log.flush(); }
  assert.equal(fs.existsSync(log.rotated), true);
  assert.ok(fs.statSync(file).size < 200 + 80, "새 파일은 작다");
  assert.deepEqual(fs.readdirSync(dir).sort(), ["app.log", "app.log.1"]);
});

test("시작할 때 지난 실행의 큰 로그를 .1 로 민다", () => {
  const dir = tmp(), file = path.join(dir, "app.log");
  fs.writeFileSync(file, "이전 실행\n".repeat(50));
  const log = create({ file, maxBytes: 100 });
  assert.equal(log.rotateIfBig(), true);
  assert.equal(fs.readFileSync(log.rotated, "utf8").startsWith("이전 실행"), true);
  assert.equal(fs.existsSync(file), false);
});

test("파일에 못 쓰는 상황이어도 write 는 던지지 않는다", () => {
  const log = create({ file: path.join(tmp(), "없는폴더", "깊이", "app.log"), flushMs: 100000 });
  assert.doesNotThrow(() => { log.write("LOG", ["a"]); log.flush(); log.write("LOG", ["b"]); log.flush(); });
});

test("install: console.* 을 감싸서 파일에도 남기고, 원래 출력은 그대로 나간다", () => {
  const file = path.join(tmp(), "app.log"), log = create({ file, flushMs: 100000 });
  const saved = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug };
  const seen = [], errs = []; console.log = (...a) => seen.push(a); console.error = (...a) => errs.push(a);   // 시험 출력을 더럽히지 않게
  try {
    log.install("사도 데스크 v9.9.9 시작");
    console.log("hello", 1); console.error("uncaught:", new Error("bad"));
    log.flush();
    assert.deepEqual(seen, [["hello", 1]]); assert.equal(errs.length, 1);   // 원래 console.* 도 불렸다
    const t = fs.readFileSync(file, "utf8");
    assert.match(t, /LOG {3}사도 데스크 v9\.9\.9 시작\n/);
    assert.match(t, /LOG {3}hello 1\n/);
    assert.match(t, /ERROR uncaught: Error: bad\n {6}at /);
  } finally { Object.assign(console, saved); }
});
