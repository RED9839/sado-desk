// 스탠딩 애니 접두어 전체 조사 (HD + 게임): 접두어별 캐릭터 수
import fs from "node:fs"; import path from "node:path"; import * as spine from "@esotericsoftware/spine-core";
class FakeTexture extends spine.Texture { constructor() { super({ width: 1, height: 1 }); } setFilters() {} setWraps() {} dispose() {} }
const count = new Map(); const examples = new Map();
for (const root of ["assets/standing-hd", "assets/standing"]) for (const hero of fs.readdirSync(root)) {
  const dir = path.join(root, hero); if (!fs.statSync(dir).isDirectory()) continue;
  const skels = fs.readdirSync(dir).filter(f => f.endsWith(".skel") && !/Skin\d/i.test(f));
  for (const f of skels) {
    const stem = f.slice(0, -5);
    try {
      const atlas = new spine.TextureAtlas(fs.readFileSync(path.join(dir, `${stem}.atlas`), "utf8")); for (const p of atlas.pages) p.setTexture(new FakeTexture());
      const data = new spine.SkeletonBinary(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(new Uint8Array(fs.readFileSync(path.join(dir, f))));
      const seen = new Set();
      for (const a of data.animations) { const g = a.name.replace(/_?\d+$/, "").replace(/_(Start|End|Idle|Loop|In|Out)$/i, "$&"); if (seen.has(g)) continue; seen.add(g); count.set(g, (count.get(g) || 0) + 1); if (!examples.has(g)) examples.set(g, `${stem}:${a.name}(${a.duration.toFixed(1)}s)`); }
    } catch (e) {}
  }
}
for (const [g, n] of [...count].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(4)} ${g.padEnd(28)} ${examples.get(g)}`);
