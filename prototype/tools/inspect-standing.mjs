// 스탠딩 skel 바닥 진단: 바운딩 바닥 / 발 본 최저점 / 발 아래 슬롯 목록. 사용: node tools/inspect-standing.mjs assets/standing-hd/Daya Daya [Normal]
import fs from "node:fs";
import path from "node:path";
import * as spine from "@esotericsoftware/spine-core";

const dir = process.argv[2], stem = process.argv[3], skinName = process.argv[4] || "Normal";
class FakeTexture extends spine.Texture { constructor() { super({ width: 1, height: 1 }); } setFilters() {} setWraps() {} dispose() {} }
const atlas = new spine.TextureAtlas(fs.readFileSync(path.join(dir, `${stem}.atlas`), "utf8"));
for (const p of atlas.pages) p.setTexture(new FakeTexture());
const data = new spine.SkeletonBinary(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(new Uint8Array(fs.readFileSync(path.join(dir, `${stem}.skel`))));
const sk = new spine.Skeleton(data);
const skin = data.findSkin(skinName) || data.skins.find(s => s.name !== "default"); if (skin) sk.setSkin(skin);
sk.setSlotsToSetupPose(); sk.updateWorldTransform();
const off = new spine.Vector2(), size = new spine.Vector2(); sk.getBounds(off, size, []);
console.log(`skins=${data.skins.map(s => s.name).join(",")} bounds x=${off.x.toFixed(0)}..${(off.x + size.x).toFixed(0)} y=${off.y.toFixed(0)}..${(off.y + size.y).toFixed(0)}`);
const FOOT = /(foot|shoe|ankle|heel|toe|boots?)/i;
const feet = sk.bones.filter(b => FOOT.test(b.data.name));
console.log("foot bones:", feet.map(b => `${b.data.name}@(${b.worldX.toFixed(0)},${b.worldY.toFixed(0)})`).join(" ") || "-");
const head = sk.bones.find(b => /^head$/i.test(b.data.name)); console.log("head:", head ? head.worldY.toFixed(0) : "-");
// 슬롯별 바운딩 (첨부 있는 것만), 바닥 낮은 순
const rows = [];
const tmp = [];
for (const s of sk.slots) {
  const a = s.getAttachment(); if (!a) continue;
  let verts;
  if (a instanceof spine.RegionAttachment) { verts = new Array(8); a.computeWorldVertices(s, verts, 0, 2); }
  else if (a instanceof spine.MeshAttachment) { verts = new Array(a.worldVerticesLength); a.computeWorldVertices(s, 0, a.worldVerticesLength, verts, 0, 2); }
  else continue;
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (let i = 0; i < verts.length; i += 2) { x0 = Math.min(x0, verts[i]); x1 = Math.max(x1, verts[i]); y0 = Math.min(y0, verts[i + 1]); y1 = Math.max(y1, verts[i + 1]); }
  rows.push({ slot: s.data.name, bone: s.bone.data.name, att: a.name, x0, x1, y0, y1 });
}
rows.sort((a, b) => a.y0 - b.y0);
for (const r of rows.slice(0, 15)) console.log(`${r.slot.padEnd(22)} bone=${r.bone.padEnd(16)} att=${String(r.att).padEnd(22)} y=${r.y0.toFixed(0)}..${r.y1.toFixed(0)} x=${r.x0.toFixed(0)}..${r.x1.toFixed(0)} w=${(r.x1 - r.x0).toFixed(0)}`);
