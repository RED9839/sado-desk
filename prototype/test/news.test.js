/* 새 소식 감시 — 로컬 가짜 서버로. 비공식 라운지 API 가 형식을 바꾸거나 죽어도 조용히 멈추지 않는지 본다.
 * 진짜 유튜브·네이버에는 접속하지 않는다 (endpoints 를 갈아 끼운다). */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { createNewsWatcher } = require("../news.js");

const ytFeed = (ids) => `<?xml version="1.0"?><feed>${ids.map(id => `<entry><yt:videoId>${id}</yt:videoId><title>영상 ${id} &amp; 소식</title><published>2026-09-20T01:00:00+00:00</published><media:thumbnail url="https://i.ytimg.com/${id}.jpg"/></entry>`).join("")}</feed>`;
const lounge = (feeds) => JSON.stringify({ code: 200, content: { feeds: feeds.map(([id, title]) => ({ feed: { feedId: id, title, createdDate: "20260920010203" }, feedLink: { pc: `https://game.naver.com/lounge/Trickcal/board/detail/${id}` } })) } });

// 시나리오를 바꿔 가며 쓰는 서버 하나
function server(handler) {
  return new Promise((res) => { const s = http.createServer(handler); s.listen(0, "127.0.0.1", () => res({ s, port: s.address().port })); });
}
const tmpState = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sado-news-")), "news-state.json");
const mk = (port, stateFile, cfg = {}, extra = {}) => {
  const got = [];
  const w = createNewsWatcher({
    stateFile, onNew: (items) => got.push(...items), log: () => {}, timeoutMs: 1500,
    getConfig: () => ({ youtube: true, notice: true, update: false, devnote: false, ...cfg }),
    endpoints: { youtube: () => `http://127.0.0.1:${port}/yt`, lounge: (id) => `http://127.0.0.1:${port}/lounge/${id}` },
    ...extra,
  });
  return { w, got };
};

test("첫 확인은 알리지 않고 기준만 기록, 그 뒤 새 글만 알린다", async () => {
  let yt = ["a1"], lg = [[10, "첫 공지"]];
  const { s, port } = await server((req, res) => { res.end(req.url.startsWith("/yt") ? ytFeed(yt) : lounge(lg)); });
  try {
    const st = tmpState(); const { w, got } = mk(port, st);
    let r = await w.check(true);
    assert.equal(r.added.length, 0, "첫 확인은 조용히");
    assert.deepEqual(r.errors, []);
    yt = ["a2", "a1"]; lg = [[11, "새 공지"], [10, "첫 공지"]];
    r = await w.check(true);
    assert.equal(r.added.length, 2, `새 글 둘 (${r.added.map(i => i.title).join(", ")})`);
    assert.equal(got.length, 2, "onNew 로도 전달");
    assert.ok(r.added.some(i => i.title === "영상 a2 & 소식"), "유튜브 제목의 &amp; 가 풀린다");
    assert.ok(r.added.some(i => i.title === "새 공지" && i.url.includes("/detail/11")));
    r = await w.check(true);
    assert.equal(r.added.length, 0, "같은 글은 다시 알리지 않는다");
  } finally { s.close(); }
});

test("라운지가 죽어도 유튜브는 그대로 오고, 오류는 status 에 남는다", async () => {
  let yt = ["b1"];
  const { s, port } = await server((req, res) => {
    if (req.url.startsWith("/yt")) return res.end(ytFeed(yt));
    res.writeHead(503); res.end("Service Unavailable");
  });
  try {
    const st = tmpState(); const { w } = mk(port, st);
    await w.check(true);                       // 첫 확인(기준)
    yt = ["b2", "b1"];
    const r = await w.check(true);
    assert.equal(r.added.length, 1, "유튜브 새 영상은 왔다");
    assert.ok(r.errors.some(e => /공지사항.*HTTP 503/.test(e)), `오류에 남는다: ${r.errors.join("/")}`);
    assert.ok(/503/.test(w.status.lastError || ""), "status.lastError 로 설정 창에 보인다");
  } finally { s.close(); }
});

test("응답 형식이 바뀌면(JSON 아님·code≠200·필드 없음) 조용히 멈추지 않고 오류로 남는다", async () => {
  const cases = [
    ["JSON 아님", () => "<html>점검 중</html>", /공지사항/],
    ["code≠200", () => JSON.stringify({ code: 500, message: "maintenance" }), /maintenance/],
    ["content 없음", () => JSON.stringify({ code: 200 }), /공지사항/],
  ];
  for (const [name, body, re] of cases) {
    const { s, port } = await server((req, res) => res.end(req.url.startsWith("/yt") ? ytFeed(["c1"]) : body()));
    try {
      const { w } = mk(port, tmpState());
      const r = await w.check(true);
      assert.ok(r.errors.some(e => re.test(e)), `${name}: 오류가 남아야 한다 (${r.errors.join("/") || "없음"})`);
      assert.ok(w.status.lastError, `${name}: lastError 기록`);
    } finally { s.close(); }
  }
});

test("서버가 답하지 않으면 시한 안에 끊고 다음 확인이 막히지 않는다", async () => {
  const { s, port } = await server((req, res) => { if (req.url.startsWith("/yt")) return res.end(ytFeed(["d1"])); /* 라운지: 응답 없음 */ });
  try {
    const { w } = mk(port, tmpState());
    const t0 = Date.now();
    const r = await w.check(true);
    const ms = Date.now() - t0;
    assert.ok(ms < 6000, `시한(1.5초)에 끊긴다 — ${ms}ms`);
    assert.ok(r.errors.length === 1 && /공지사항/.test(r.errors[0]), `라운지만 실패: ${r.errors.join("/")}`);
    const r2 = await w.check(true);   // 다음 확인이 checking 플래그에 막히지 않는가
    assert.equal(r2.added.length, 0);
  } finally { s.close(); }
});

test("본 글 목록은 파일에 남아 다시 켜도 또 알리지 않는다", async () => {
  const yt = ["e2", "e1"], lg = [[20, "공지"]];
  const { s, port } = await server((req, res) => res.end(req.url.startsWith("/yt") ? ytFeed(yt) : lounge(lg)));
  try {
    const st = tmpState();
    await mk(port, st).w.check(true);          // 기준 기록
    const second = mk(port, st);               // 앱을 다시 켠 셈
    const r = await second.w.check(true);
    assert.equal(r.added.length, 0, "이미 본 글은 새 인스턴스에서도 조용히");
    assert.ok(JSON.parse(fs.readFileSync(st, "utf8")).seen.youtube.includes("yt:e1"), "상태 파일에 기록됨");
  } finally { s.close(); }
});

test("설정에서 새로 켠 게시판의 기존 글은 알림 폭탄이 되지 않는다", async () => {
  const { s, port } = await server((req, res) => {
    if (req.url.startsWith("/yt")) return res.end(ytFeed(["f1"]));
    res.end(req.url.endsWith("/3") ? lounge([[30, "공지 하나"]]) : lounge([[40, "업데이트 하나"], [41, "업데이트 둘"]]));
  });
  try {
    const st = tmpState(); let cfg = { update: false };
    const got = [];
    const w = createNewsWatcher({ stateFile: st, onNew: (i) => got.push(...i), log: () => {}, timeoutMs: 1500,
      getConfig: () => ({ youtube: true, notice: true, devnote: false, ...cfg }),
      endpoints: { youtube: () => `http://127.0.0.1:${port}/yt`, lounge: (id) => `http://127.0.0.1:${port}/lounge/${id}` } });
    await w.check(true);                       // 기준
    cfg = { update: true };                    // 업데이트 게시판을 새로 켰다
    const r = await w.check(true);
    assert.equal(r.added.length, 0, `새로 켠 게시판의 기존 글 ${r.added.length}건이 알림으로 쏟아지면 안 된다`);
  } finally { s.close(); }
});
