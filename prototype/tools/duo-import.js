/* 잡담 대본을 data/duo-talk.json 에 넣는다. 혼잣말과 같은 잣대에 잡담 전용 검사를 더한다.
 *   node tools/duo-import.js --multi out/답-duo-01.txt [--replace] [--force]
 * 형식: "### <사도키>" 아래에 "[먼저] 문장 [행복]" / "[받아] …" / "[자기] …"
 * 잡담만의 검사:
 *   - 다른 사도 이름 금지 (짝이 누구일지 모른다)
 *   - 교주 호칭 금지 (그 자리에 없다)
 *   - [받아] 는 앞말을 되짚으면 안 된다 ("그 얘기", "방금 말한" …)
 */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const B = require(path.join(root, "tools/selftalk-lib.js"));
const OUT = path.join(root, "data", "duo-talk.json");
const args = process.argv.slice(2);
const force = args.includes("--force"), replace = args.includes("--replace");
const rest = args.filter(a => !a.startsWith("--"));
if (!rest.length) { console.error("쓰기: node tools/duo-import.js --multi <파일> [--replace]"); process.exit(1); }

const bible = JSON.parse(fs.readFileSync(path.join(root, "data", "bible.json"), "utf8"));
// 사도 한국어 이름 (2자 이상). 자기 이름은 써도 되므로 부를 때 뺀다
// 앞말을 아는 척하는 꼴. 짝이 바뀌면 바로 어색해진다
const BACKREF = /(그 (얘기|말|소리|이야기)|방금 (한|말)|아까 (한|말)|네 말|당신 말|그렇게 말|[가-힣]+ (얘기|이야기|말)(라면|이라면|가 나오|를 하면|는 )|그런 (얘기|말|소리)|맞장구|지금 뭐라)/;
const KYOJU = /(교주|주인님|사장님|촌장님|선생님)/;

const db = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { _meta: B.META, heroes: {} };
const corpus = B.loadCorpus();
let total = 0, kept0 = 0;

function duoReasons(kind, line, p) {
  const out = [];
  { const n = B.otherName(line.t, p); if (n) out.push(`다른 사도 이름(${n})`); }
  if (kind !== "self" && KYOJU.test(line.t)) out.push("교주를 부름(그 자리에 없다)");
  if (kind === "reply" && BACKREF.test(line.t)) out.push("앞말을 되짚음");
  return out;
}

function put(h, rows) {
  const p = B.profile(h);
  if (!p) { console.log(`  ? 모르는 사도 키: ${h}`); return; }
  const had = replace ? { open: [], reply: [], self: [] } : (db.heroes[h] || { open: [], reply: [], self: [] });
  const kept = { open: [], reply: [], self: [] }, dropped = [];
  for (const kind of ["open", "reply", "self"]) {
    const seen = [...(had[kind] || []).map(x => x.t)];
    for (const line of rows[kind]) {
      total++;
      const rs = [...B.reasons(line, p, seen, corpus), ...duoReasons(kind, line, p)];
      if (rs.length && !force) { dropped.push([kind, line.t, rs.join(", ")]); continue; }
      if (rs.length) dropped.push([kind, line.t, rs.join(", ") + " (그래도 넣음)"]);
      kept[kind].push(line); seen.push(line.t);
    }
  }
  for (const k of ["open", "reply", "self"]) db.heroes[h] = { ...(db.heroes[h] || {}), [k]: [...(had[k] || []), ...kept[k]] };
  const n = kept.open.length + kept.reply.length + kept.self.length;
  kept0 += n;
  const cur = db.heroes[h];
  console.log(`${p.ko.padEnd(14)} 먼저${cur.open.length} 받아${cur.reply.length} 자기${cur.self.length}  (+${n})` +
    (dropped.length ? `  버림: ${[...new Set(dropped.map(d => d[2]))].slice(0, 3).join(", ")}` : ""));
  if (process.env.VERBOSE) for (const [k, t, why] of dropped) console.log(`    [${k}] [${why}] ${t}`);
}

const KIND = { "먼저": "open", "받아": "reply", "자기": "self" };
const text = fs.readFileSync(rest[0], "utf8").replace(/
?/g, "
"); // 윈도 줄바꿈이 섞여도 되게

?/g, "
"); // 윈도 줄바꿈이 섞여도 되게
for (const part of text.split(/^\s*#{2,4}\s*/m)) {
  const mk = /^([A-Za-z0-9_]+)/.exec(part.trim()); if (!mk) continue;
  const rows = { open: [], reply: [], self: [] };
  for (const raw of part.slice(part.indexOf("\n") + 1).split(/\r?\n/)) {
    const m = /^\s*\[(먼저|받아|자기)\]\s*(.+)$/.exec(raw); if (!m) continue;
    const parsed = B.parse(m[2]); if (!parsed.length) continue;
    rows[KIND[m[1]]].push(parsed[0]);
  }
  if (rows.open.length + rows.reply.length + rows.self.length) put(mk[1], rows);
}
fs.writeFileSync(OUT, JSON.stringify(db, null, 1), "utf8");
console.log(`\n합계 ${kept0}/${total}줄 → data/duo-talk.json`);
