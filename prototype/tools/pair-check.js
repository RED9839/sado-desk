/* 짝 전용 대사 초안을 검사한다 (넣지는 않는다).  node tools/pair-check.js <파일> [--quiet]
 * 형식:  ### <가키>|<나키>
 *        [가] 문장 [행복]
 *        [나] 문장 [미소]
 *        [가] …  [나] …           (가·나 번갈아 네 줄)
 * 잡담(두루 통하는 말)과 다른 점:
 *  - 상대 이름·호칭을 써도 된다(오히려 써야 한다). 제3의 사도 이름만 막는다.
 *  - 앞말을 되짚어도 된다. 짝이 정해져 있으니 대화가 이어져야 한다.
 */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const B = require(path.join(root, "tools/selftalk-lib.js"));
const corpus = B.loadCorpus();
const bible = JSON.parse(fs.readFileSync(path.join(root, "data", "bible.json"), "utf8"));
const KYOJU = /(교주|주인님|사장님)/;
const quiet = process.argv.includes("--quiet");
const TEXT = fs.readFileSync(process.argv[2], "utf8").replace(/\r\n?/g, "\n");
let pairs = 0, ok = 0, bad = 0;
for (const part of TEXT.split(/^\s*#{2,4}\s*/m)) {
  const mk = /^([A-Za-z0-9_]+)\s*\|\s*([A-Za-z0-9_]+)/.exec(part.trim()); if (!mk) continue;
  const [, A, C] = mk;
  const pa = B.profile(A), pc = B.profile(C);
  if (!pa || !pc) { console.log(`? 모르는 사도 키: ${!pa ? A : C}`); continue; }
  pairs++;
  const koA = pa.ko.replace(/\(.*\)$/, "").trim(), koC = pc.ko.replace(/\(.*\)$/, "").trim();
  const rows = [], probs = [];
  for (const raw of part.slice(part.indexOf("\n") + 1).split(/\n/)) {
    const m = /^\s*\[(가|나)\]\s*(.+)$/.exec(raw); if (!m) continue;
    const parsed = B.parse(m[2]);
    if (!parsed.length) { probs.push(["?", raw.trim(), "형식이 아님(감정 꼬리표 확인)"]); continue; }
    rows.push({ side: m[1], ...parsed[0] });
  }
  // 가·나 번갈아 네 줄
  const shape = rows.length === 4 && rows.every((r, i) => r.side === (i % 2 ? "나" : "가"));
  const seen = [];
  for (const r of rows) {
    const me = r.side === "가" ? pa : pc, you = r.side === "가" ? koC : koA;
    // 짝 대사에서는 상대 이름을 부르는 것이 정상이다. 이름을 뺀 문장으로 잣대를 돌려야
    // "이프리트 → 프리트 ≠ 프리클" 같은 오타 판정이 나지 않는다.
    const bare = r.t.split(you).join(" ");
    const rs = B.reasons({ ...r, t: bare }, me, seen, corpus).filter(x => !/^다른 사도 이름/.test(x));
    const other = B.otherName(bare, me);
    if (other && other !== you) rs.push(`제3의 사도 이름(${other})`);
    if (KYOJU.test(r.t)) rs.push("교주를 부름(그 자리에 없다)");
    if (rs.length) { probs.push([r.side, r.t, rs.join(", ")]); bad++; } else { seen.push(r.t); ok++; }
  }
  if (!quiet || probs.length || !shape) {
    console.log(`${(koA + " × " + koC).padEnd(22)} ${rows.length}줄${shape ? "" : " ← 가·나 번갈아 네 줄이 아님"}${probs.length ? `  문제 ${probs.length}` : "  ✓"}`);
    for (const [s, t, why] of probs) console.log(`    [${s}] ${t}\n        ← ${why}`);
  }
}
console.log(`\n짝 ${pairs}쌍 · 통과 ${ok} · 걸림 ${bad}`);
