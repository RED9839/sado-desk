import fs from "node:fs"; import path from "node:path"; import * as spine from "@esotericsoftware/spine-core";
class FakeTexture extends spine.Texture { constructor() { super({ width: 1, height: 1 }); } setFilters() {} setWraps() {} dispose() {} }
const dir = process.argv[2], stem = process.argv[3], filt = process.argv[4] ? new RegExp(process.argv[4], "i") : null;
const atlas = new spine.TextureAtlas(fs.readFileSync(path.join(dir, `${stem}.atlas`), "utf8")); for (const p of atlas.pages) p.setTexture(new FakeTexture());
const data = new spine.SkeletonBinary(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(new Uint8Array(fs.readFileSync(path.join(dir, `${stem}.skel`))));
console.log("bones:", data.bones.map(b => b.name).join(" "));
console.log("events:", data.events.map(e => e.name).join(" ") || "-");
for (const a of data.animations) {
  if (filt && !filt.test(a.name)) continue;
  const bones = new Set(), kinds = new Set(), evs = [];
  for (const t of a.timelines) { kinds.add(t.constructor.name.replace("Timeline", "")); if (t.boneIndex !== undefined) bones.add(data.bones[t.boneIndex].name); if (t instanceof spine.EventTimeline) for (const e of t.events) evs.push(`${e.data.name}@${e.time.toFixed(2)}`); }
  console.log(`${a.name.padEnd(16)} ${a.duration.toFixed(2)}s kinds=[${[...kinds].join(",")}] bones=${[...bones].slice(0, 12).join(",")}${bones.size > 12 ? "…" : ""} ${evs.length ? "events=" + evs.join(" ") : ""}`);
}
