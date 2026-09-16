import fs from "node:fs"; import path from "node:path"; import * as spine from "@esotericsoftware/spine-core";
class FakeTexture extends spine.Texture { constructor(){super({width:1,height:1});} setFilters(){} setWraps(){} dispose(){} }
const ROOT = process.argv[2];
const dirs = fs.readdirSync(ROOT).filter(d => fs.statSync(path.join(ROOT,d)).isDirectory());
const count = new Map(), durs = new Map(); let ok = 0, bad = [];
const perSet = [];
for (const d of dirs) {
  const dir = path.join(ROOT, d);
  const skel = fs.readdirSync(dir).find(f => f.endsWith(".skel"));
  const atl = fs.readdirSync(dir).find(f => f.endsWith(".atlas"));
  if (!skel || !atl) { bad.push(d + " (파일 없음)"); continue; }
  try {
    const atlas = new spine.TextureAtlas(fs.readFileSync(path.join(dir, atl), "utf8"));
    for (const p of atlas.pages) p.setTexture(new FakeTexture());
    const data = new spine.SkeletonBinary(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(new Uint8Array(fs.readFileSync(path.join(dir, skel))));
    const names = data.animations.map(a => a.name);
    perSet.push({ d, names: new Set(names) });
    for (const a of data.animations) {
      count.set(a.name, (count.get(a.name) || 0) + 1);
      if (!durs.has(a.name)) durs.set(a.name, []);
      durs.get(a.name).push(a.duration);
    }
    ok++;
  } catch (e) { bad.push(d + " (" + String(e.message).slice(0,60) + ")"); }
}
const out = [];
out.push(`인게임 세트 ${dirs.length}개 중 ${ok}개 읽음` + (bad.length ? ` · 실패 ${bad.length}: ${bad.slice(0,5).join(", ")}` : ""));
out.push("");
out.push("모션 이름".padEnd(24) + "가진 세트".padStart(9) + "  평균 길이");
out.push("-".repeat(48));
for (const [n, c] of [...count].sort((a,b)=>b[1]-a[1])) {
  const ds = durs.get(n); const av = ds.reduce((a,b)=>a+b,0)/ds.length;
  out.push(n.padEnd(24) + String(c).padStart(6) + "개" + ("  " + av.toFixed(2) + "s").padStart(11));
}
fs.writeFileSync(process.argv[3], out.join("\n"), "utf8");
fs.writeFileSync(process.argv[4], JSON.stringify(perSet.map(x=>({d:x.d,names:[...x.names]})), null, 0), "utf8");
