// 모션↔보이스 매핑 감사: 스탠딩(HD 기본 + 게임 기본) 애니 전부에 대해 매핑 카테고리와 그 캐릭터의 실제 보이스 보유 여부를 확인
import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module"; import * as spine from "@esotericsoftware/spine-core";
const require = createRequire(import.meta.url);
const { voiceCatsFor } = require("../renderer/motion-voice.js");
class FakeTexture extends spine.Texture { constructor() { super({ width: 1, height: 1 }); } setFilters() {} setWraps() {} dispose() {} }
const voiceIndex = JSON.parse(fs.readFileSync("assets/voice/index.json", "utf8"));
const catsOf = (hero) => { const h = voiceIndex[hero.toLowerCase()]; if (!h) return null; const c = { ...(h.base || {}) }; if (c.touch) { c.cheek = c.touch.filter(f => /touch1(_\d+)?\.ogg$/.test(f)); c.pat = c.touch.filter(f => /touch2(_\d+)?\.ogg$/.test(f)); } return c; };
const unmapped = new Map(), mapped = new Map(), noVoice = new Map(), fallback = new Map(); let total = 0, heroes = 0, heroesNoVoice = [];
for (const root of ["assets/standing-hd", "assets/standing"]) for (const hero of fs.readdirSync(root)) {
  const dir = path.join(root, hero); if (!fs.statSync(dir).isDirectory()) continue;
  const f = fs.readdirSync(dir).find(f => f.endsWith(".skel") && !/skin\d/i.test(f)); if (!f) continue;
  const stem = f.slice(0, -5);
  let data; try { const atlas = new spine.TextureAtlas(fs.readFileSync(path.join(dir, `${stem}.atlas`), "utf8")); for (const p of atlas.pages) p.setTexture(new FakeTexture()); data = new spine.SkeletonBinary(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(new Uint8Array(fs.readFileSync(path.join(dir, f)))); } catch { continue; }
  heroes++;
  const vc = catsOf(hero); if (!vc) heroesNoVoice.push(hero);
  for (const a of data.animations) {
    total++;
    const g = a.name.replace(/_?\d+$/, "");
    const cats = voiceCatsFor(a.name);
    if (!cats) { unmapped.set(g, (unmapped.get(g) || 0) + 1); continue; }
    mapped.set(g, cats.join("/"));
    if (!vc) continue;
    const hit = cats.find(c => vc[c] && vc[c].length);
    if (!hit) noVoice.set(`${hero}:${g}→${cats.join("/")}`, 1);
    else if (hit !== cats[0]) fallback.set(`${g}→${hit}(${cats[0]} 없음)`, (fallback.get(`${g}→${hit}(${cats[0]} 없음)`) || 0) + 1);
  }
}
console.log(`heroes=${heroes} anims=${total} mapped prefixes=${mapped.size} unmapped prefixes=${unmapped.size}`);
console.log("\n[매핑 없음 → 대사 없이 모션만] (접두어: 애니 수)");
console.log([...unmapped].sort((a, b) => b[1] - a[1]).map(([g, n]) => `${g}:${n}`).join("  "));
console.log("\n[매핑됨] 접두어 → 카테고리");
const byCat = {}; for (const [g, c] of mapped) (byCat[c] ||= []).push(g);
for (const [c, gs] of Object.entries(byCat)) console.log(`  ${c.padEnd(24)} ${gs.sort().join(", ")}`);
console.log(`\n[보이스 폴더 없는 스탠딩 캐릭터] ${heroesNoVoice.length}: ${heroesNoVoice.join(", ")}`);
console.log(`\n[매핑 카테고리 전부 없음 → 무음] ${noVoice.size}`); console.log([...noVoice.keys()].slice(0, 40).join("  "));
console.log("\n[1순위 카테고리 없어 2순위로 폴백] (횟수)"); console.log([...fallback].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join("  "));
