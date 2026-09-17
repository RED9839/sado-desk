/* 코스튬(스킨) 혼잣말을 쓰기 위한 브리프. 로컬 전용 — 참고 대사는 실제 게임 대사이므로 베끼면 안 된다.
 *   node tools/_brief-skin.js alice#1 crepe#1          (자세히)
 *   node tools/_brief-skin.js alice#1 alice#2 --short  (라벨·말투·참고 대사만 — 여러 벌 볼 때)
 *   node tools/_brief-skin.js --list                   (코스튬 목록)
 *   node tools/_brief-skin.js --hero alice             (그 사도의 코스튬 전부)
 */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const J = f => JSON.parse(fs.readFileSync(path.join(root, f), "utf8"));
const talk = J("data/talk-ko.json").heroes, bible = J("data/bible.json");
const theaters = J("data/theaters.json").items;
const REFS = fs.existsSync(path.join(root, "out/_ref-skins.json")) ? J("out/_ref-skins.json") : {};
const B = require(path.join(root, "tools/selftalk-lib.js"));
const keyOf = h => Object.keys(talk).find(k => k.toLowerCase() === h);

function head(key) {
  const [h, n] = key.split("#");
  const H = keyOf(h); if (!H) return null;
  const p = talk[H], sk = (p.skins || {})[n]; if (!sk) return null;
  return { h, n, H, p, sk, ref: REFS[key] || [] };
}
function briefShort(key) {
  const x = head(key); if (!x) return `### ${key}  — 없는 코스튬`;
  const { p, sk, ref } = x;
  const L = [`### ${key}  ${p.ko} · 「${sk.label}」  말투=${sk.style || p.style} 호칭=${sk.addr || p.addr}${sk.interj && sk.interj.length ? ` 감탄사=${sk.interj.join(",")}` : ""}`];
  for (const r of ref.slice(0, 10)) L.push("  · " + r);
  return L.join("\n");
}
function brief(key) {
  const x = head(key); if (!x) return `### ${key}  — 없는 코스튬`;
  const { h, p, sk, ref } = x;
  const b = bible[h] || {};
  const th = theaters.filter(t => (t.castKeys || []).includes(h));
  const L = [];
  L.push(`### ${key}  ${p.ko} · 「${sk.label}」`);
  L.push(`말투=${sk.style || p.style} · 호칭=${sk.addr || p.addr} · 자칭=${p.me || "나"}${sk.style && sk.style !== p.style ? "  ※말투가 기본과 다름" : ""}${sk.addr && sk.addr !== p.addr ? "  ※호칭이 기본과 다름" : ""}`);
  if (sk.interj && sk.interj.length) L.push(`이 코스튬의 감탄사: ${sk.interj.join(", ")}`);
  L.push(`누구: ${(b.who || "").slice(0, 160)}`);
  if (b.quirk) L.push(`말버릇: ${b.quirk}`);
  if (b.never && b.never.length) L.push(`안함: ${b.never.slice(0, 5).join(" / ")}`);
  if (th.length) L.push(`테마극장: ${th.slice(0, 2).map(t => `${t.title} — ${(t.synopsis || "").slice(0, 110)}`).join("\n           ")}`);
  L.push(`이 코스튬의 실제 대사 ${ref.length}줄 (말투·소재 참고용, 베끼지 말 것):`);
  for (const r of ref.slice(0, 14)) L.push("  · " + r);
  return L.join("\n");
}

const argv = process.argv.slice(2);
const SHORT = argv.includes("--short");
const args = argv.filter(a => !a.startsWith("--"));
if (argv.includes("--list")) {
  const rows = [];
  for (const [H, p] of Object.entries(talk)) for (const [n, sk] of Object.entries(p.skins || {})) {
    const k = `${H.toLowerCase()}#${n}`;
    rows.push(`${k}\t${p.ko}\t${sk.label}\t${(REFS[k] || []).length}줄`);
  }
  console.log(rows.join("\n"));
  console.log(`\n합계 ${rows.length}개 코스튬`);
} else if (argv.includes("--hero")) {
  const h = (args[0] || "").toLowerCase(), H = keyOf(h);
  if (!H) { console.log("모르는 사도"); process.exit(1); }
  for (const n of Object.keys(talk[H].skins || {})) console.log((SHORT ? briefShort : brief)(`${h}#${n}`) + "\n");
} else {
  for (const k of args) console.log((SHORT ? briefShort : brief)(k.toLowerCase()) + "\n");
}
