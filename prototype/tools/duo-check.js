/* 잡담 대본 초안을 넣지 않고 검사만 한다.  node tools/duo-check.js <파일> [--quiet] */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const B = require(path.join(root, "tools/selftalk-lib.js"));
const corpus = B.loadCorpus();
const bible = JSON.parse(fs.readFileSync(path.join(root, "data", "bible.json"), "utf8"));
const BACKREF = /(그 (얘기|말|소리|이야기)|방금 (한|말)|아까 (한|말)|네 말|당신 말|그렇게 말|[가-힣]+ (얘기|이야기|말)(라면|이라면|가 나오|를 하면|는 )|그런 (얘기|말|소리)|맞장구|지금 뭐라)/;
const KYOJU = /(교주|주인님|사장님|촌장님|선생님)/;
const KIND = { "먼저": "open", "받아": "reply", "자기": "self" };
const quiet = process.argv.includes("--quiet");
let heroes = 0, ok = 0, bad = 0;
// 줄 끝 CR 를 먼저 없앤다 — 윈도 줄바꿈으로 쓴 파일을 쪼개면 CR 가 앞줄에 남아 형식 검사가 어긋난다
const TEXT = fs.readFileSync(process.argv[2], "utf8").replace(/\r\n?/g, "\n");
for (const part of TEXT.split(/^\s*#{2,4}\s*/m)) {
  const mk = /^([A-Za-z0-9_]+)/.exec(part.trim()); if (!mk) continue;
  const h = mk[1], p = B.profile(h);
  if (!p) { console.log(`? 모르는 사도 키: ${h}`); continue; }
  heroes++;
  const rows = { open: [], reply: [], self: [] }, probs = [];
  for (const raw of part.slice(part.indexOf("\n") + 1).split(/\r?\n/)) {
    const m = /^\s*\[(먼저|받아|자기)\]\s*(.+)$/.exec(raw); if (!m) continue;
    const parsed = B.parse(m[2]);
    if (!parsed.length) { probs.push(["?", raw.trim(), "형식이 아님(감정 꼬리표 확인)"]); continue; }
    rows[KIND[m[1]]].push(parsed[0]);
  }
  for (const kind of ["open", "reply", "self"]) {
    const seen = [];
    for (const line of rows[kind]) {
      const rs = B.reasons(line, p, seen, corpus);
      { const n = B.otherName(line.t, p); if (n) rs.push(`다른 사도 이름(${n})`); }
      if (kind !== "self" && KYOJU.test(line.t)) rs.push("교주를 부름");
      if (kind === "reply" && BACKREF.test(line.t)) rs.push("앞말을 되짚음");
      if (rs.length) { probs.push([kind, line.t, rs.join(", ")]); bad++; } else { seen.push(line.t); ok++; }
    }
  }
  const cnt = `먼저${rows.open.length}/6 받아${rows.reply.length}/6 자기${rows.self.length}/2`;
  const shape = rows.open.length === 6 && rows.reply.length === 6 && rows.self.length === 2;
  if (!quiet || probs.length || !shape) {
    console.log(`${p.ko.padEnd(14)} ${cnt}${shape ? "" : "  ← 개수 안 맞음"}${probs.length ? `  문제 ${probs.length}` : "  ✓"}`);
    for (const [k, t, why] of probs) console.log(`    [${k}] ${t}\n        ← ${why}`);
  }
}
console.log(`\n사도 ${heroes}명 · 통과 ${ok} · 걸림 ${bad}`);
