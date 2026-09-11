// 머리 영역 진단: Head 본 / 눈·입 본 / 바운딩 상단 (스켈레톤 단위, 원점 기준)
import fs from "node:fs"; import path from "node:path"; import * as spine from "@esotericsoftware/spine-core";
class FakeTexture extends spine.Texture { constructor() { super({ width: 1, height: 1 }); } setFilters() {} setWraps() {} dispose() {} }
const roots = process.argv.slice(2).length ? process.argv.slice(2) : ["assets/standing-hd", "assets/standing"];
for (const root of roots) for (const hero of fs.readdirSync(root)) {
  const dir = path.join(root, hero); if (!fs.statSync(dir).isDirectory()) continue;
  const f = fs.readdirSync(dir).find(f => f.endsWith(".skel") && !/skin\d/i.test(f)); if (!f) continue; const stem = f.slice(0, -5);
  try {
    const atlas = new spine.TextureAtlas(fs.readFileSync(path.join(dir, `${stem}.atlas`), "utf8")); for (const p of atlas.pages) p.setTexture(new FakeTexture());
    const data = new spine.SkeletonBinary(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(new Uint8Array(fs.readFileSync(path.join(dir, f))));
    const sk = new spine.Skeleton(data); const skin = data.findSkin("Normal") || data.skins.find(s => s.name !== "default"); if (skin) sk.setSkin(skin);
    sk.setSlotsToSetupPose(); sk.updateWorldTransform();
    const off = new spine.Vector2(), size = new spine.Vector2(); sk.getBounds(off, size, []);
    const head = sk.bones.find(b => /^(S\d_)?Head$/i.test(b.data.name)) || sk.bones.find(b => /head/i.test(b.data.name) && !/hair|ac|ct|rct/i.test(b.data.name));
    const eyes = sk.bones.filter(b => /eye/i.test(b.data.name) && !/brow|lash|light|shadow|ac/i.test(b.data.name));
    const mouth = sk.bones.find(b => /^(S\d_)?mouth/i.test(b.data.name));
    const eyeY = eyes.length ? eyes.reduce((a, b) => a + b.worldY, 0) / eyes.length : null;
    // 머리 슬롯(첨부) 상단: 이름에 head/face 포함, hair/hat/ac 제외
    let headAttTop = null;
    for (const s of sk.slots) { const a = s.getAttachment(); if (!a || !/head|face/i.test(s.data.name) || /hair|hat|ac|light|shadow|back/i.test(s.data.name)) continue; let v; if (a instanceof spine.RegionAttachment) { v = new Array(8); a.computeWorldVertices(s, v, 0, 2); } else if (a instanceof spine.MeshAttachment) { v = new Array(a.worldVerticesLength); a.computeWorldVertices(s, 0, a.worldVerticesLength, v, 0, 2); } else continue; for (let i = 1; i < v.length; i += 2) headAttTop = Math.max(headAttTop ?? -1e9, v[i]); }
    const top = off.y + size.y;
    console.log(`${stem.padEnd(16)} top=${top.toFixed(0).padStart(5)} head=${head ? head.worldY.toFixed(0).padStart(4) : "   -"} eyes=${eyeY == null ? "   -" : eyeY.toFixed(0).padStart(4)}(${eyes.length}) mouth=${mouth ? mouth.worldY.toFixed(0) : "-"} faceTop=${headAttTop == null ? "-" : headAttTop.toFixed(0)} | hatRatio=${head && eyeY != null ? ((top - eyeY) / (eyeY - head.worldY)).toFixed(2) : "-"}`);
  } catch (e) { console.log(stem, "ERR", e.message); }
}
