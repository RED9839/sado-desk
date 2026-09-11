// 전체 스탠딩(HD 기본) 바닥 진단 요약: 발 본 최저점-박스 바닥 차이, 가장 낮은 첨부의 폭 비율
import fs from "node:fs"; import path from "node:path"; import * as spine from "@esotericsoftware/spine-core";
class FakeTexture extends spine.Texture { constructor() { super({ width: 1, height: 1 }); } setFilters() {} setWraps() {} dispose() {} }
const FOOT = /(foot|shoe|ankle|heel|toe|boots?)/i;
const root = process.argv[2] || "assets/standing-hd";
for (const hero of fs.readdirSync(root)) {
  const dir = path.join(root, hero); if (!fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".skel"))) {
    const stem = f.slice(0, -5);
    try {
      const atlas = new spine.TextureAtlas(fs.readFileSync(path.join(dir, `${stem}.atlas`), "utf8")); for (const p of atlas.pages) p.setTexture(new FakeTexture());
      const data = new spine.SkeletonBinary(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(new Uint8Array(fs.readFileSync(path.join(dir, f))));
      const sk = new spine.Skeleton(data); const skin = data.findSkin("Normal") || data.skins.find(s => s.name !== "default"); if (skin) sk.setSkin(skin);
      sk.setSlotsToSetupPose(); sk.updateWorldTransform();
      const off = new spine.Vector2(), size = new spine.Vector2(); sk.getBounds(off, size, []);
      const feet = sk.bones.filter(b => FOOT.test(b.data.name)); const footY = feet.length ? Math.min(...feet.map(b => b.worldY)) : null;
      let low = null;
      for (const s of sk.slots) { const a = s.getAttachment(); if (!a) continue; let v;
        if (a instanceof spine.RegionAttachment) { v = new Array(8); a.computeWorldVertices(s, v, 0, 2); } else if (a instanceof spine.MeshAttachment) { v = new Array(a.worldVerticesLength); a.computeWorldVertices(s, 0, a.worldVerticesLength, v, 0, 2); } else continue;
        let x0 = 1e9, x1 = -1e9, y0 = 1e9; for (let i = 0; i < v.length; i += 2) { x0 = Math.min(x0, v[i]); x1 = Math.max(x1, v[i]); y0 = Math.min(y0, v[i + 1]); }
        if (!low || y0 < low.y0) low = { name: s.data.name, y0, w: x1 - x0 }; }
      const gap = footY == null ? null : footY - off.y;
      console.log(`${stem.padEnd(18)} box=${off.y.toFixed(0).padStart(5)}..${(off.y + size.y).toFixed(0)} feet=${footY == null ? "  -" : footY.toFixed(0).padStart(4)} gap=${gap == null ? "  -" : gap.toFixed(0).padStart(4)} low=${(low?.name || "-").padEnd(24)} lowW/boxW=${low ? (low.w / size.x).toFixed(2) : "-"}`);
    } catch (e) { console.log(`${stem} ERR ${e.message}`); }
  }
}
