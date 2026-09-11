// 미니미 skel 분석: spine-core 4.1로 로드해서 애니별 길이/루트 이동/변형 범위/이벤트를 뽑는다.
import fs from "node:fs";
import path from "node:path";
import * as spine from "@esotericsoftware/spine-core";

const dir = process.argv[2] || "assets/minimi";
const skelName = process.argv[3] || "minimi";
const skinName = process.argv[4] || "Mini_Crepe";

class FakeTexture extends spine.Texture {
  constructor() { super({ width: 1, height: 1 }); }
  setFilters() {} setWraps() {} dispose() {}
}
const atlasText = fs.readFileSync(path.join(dir, `${skelName}.atlas`), "utf8");
const atlas = new spine.TextureAtlas(atlasText);
for (const p of atlas.pages) p.setTexture(new FakeTexture());
const binary = new spine.SkeletonBinary(new spine.AtlasAttachmentLoader(atlas));
const data = binary.readSkeletonData(new Uint8Array(fs.readFileSync(path.join(dir, `${skelName}.skel`))));

console.log(`version=${data.version} bones=${data.bones.length} slots=${data.slots.length} skins=${data.skins.length} anims=${data.animations.length} events=${data.events.length}`);
console.log("bones:", data.bones.map(b => `${b.name}(parent=${b.parent?.name ?? "-"})`).join(", "));
console.log("slots:", data.slots.map(s => `${s.name}@${s.boneData.name}`).join(", "));
console.log("size:", data.width, data.height, "offset", data.x, data.y);
console.log("events:", data.events.map(e => `${e.name}(audio=${e.audioPath ?? "-"})`).join(", "));

const skeleton = new spine.Skeleton(data);
const skin = data.findSkin(skinName);
if (skin) { skeleton.setSkin(skin); skeleton.setSlotsToSetupPose(); }
skeleton.updateWorldTransform();
const root = skeleton.findBone("root");
const bodyBone = skeleton.bones.find(b => b.data.name !== "root" && skeleton.slots.some(s => s.bone === b && s.attachment)) || skeleton.bones[1];
console.log("body bone:", bodyBone?.data.name, "attachment:", skeleton.slots.find(s => s.bone === bodyBone)?.attachment?.name);

const timelineKind = t => t.constructor.name.replace("Timeline", "");
const rows = [];
for (const anim of data.animations) {
  const dur = anim.duration;
  const kinds = {};
  for (const t of anim.timelines) {
    const k = timelineKind(t);
    let target = "";
    if (t.boneIndex !== undefined) target = data.bones[t.boneIndex].name;
    else if (t.slotIndex !== undefined) target = data.slots[t.slotIndex].name;
    const key = target ? `${target}:${k}` : k;
    kinds[key] = (kinds[key] || 0) + 1;
  }
  const evs = anim.timelines.filter(t => t instanceof spine.EventTimeline).flatMap(t => t.events.map(e => `${e.time.toFixed(2)}:${e.data.name}`));
  // 샘플링
  const N = Math.max(2, Math.round(dur * 60));
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, minSX = 1e9, maxSX = -1e9, minSY = 1e9, maxSY = -1e9, minR = 1e9, maxR = -1e9;
  let firstX = 0, lastX = 0, firstY = 0, lastY = 0;
  const yTrack = [];
  for (let i = 0; i <= N; i++) {
    const time = (dur * i) / N;
    skeleton.setToSetupPose(); skeleton.setSkin(skin); skeleton.setSlotsToSetupPose();
    anim.apply(skeleton, 0, time, false, [], 1, spine.MixBlend.setup, spine.MixDirection.mixIn);
    skeleton.updateWorldTransform();
    const b = bodyBone;
    const x = b.worldX, y = b.worldY;
    const sx = Math.hypot(b.a, b.c), sy = Math.hypot(b.b, b.d);
    const rot = Math.atan2(b.c, b.a) * 180 / Math.PI;
    if (i === 0) { firstX = x; firstY = y; }
    lastX = x; lastY = y;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minSX = Math.min(minSX, sx); maxSX = Math.max(maxSX, sx); minSY = Math.min(minSY, sy); maxSY = Math.max(maxSY, sy);
    minR = Math.min(minR, rot); maxR = Math.max(maxR, rot);
    if (i % Math.max(1, Math.floor(N / 12)) === 0) yTrack.push(Math.round(y));
  }
  rows.push({
    name: anim.name, duration: +dur.toFixed(3),
    dx: +(lastX - firstX).toFixed(1), dy: +(lastY - firstY).toFixed(1),
    xRange: [+minX.toFixed(1), +maxX.toFixed(1)], yRange: [+minY.toFixed(1), +maxY.toFixed(1)],
    scaleX: [+minSX.toFixed(2), +maxSX.toFixed(2)], scaleY: [+minSY.toFixed(2), +maxSY.toFixed(2)],
    rot: [+minR.toFixed(1), +maxR.toFixed(1)], yTrack, timelines: kinds, events: evs,
  });
}
fs.mkdirSync("out", { recursive: true });
fs.writeFileSync(`out/${skelName}-anims.json`, JSON.stringify({ skeleton: { version: data.version, bones: data.bones.map(b => b.name), slots: data.slots.map(s => s.name), width: data.width, height: data.height, x: data.x, y: data.y, skins: data.skins.map(s => s.name) }, animations: rows }, null, 2));
console.log("\n| anim | dur | dx | dy | yRange | scaleX | scaleY | rot | events |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const r of rows) console.log(`| ${r.name} | ${r.duration} | ${r.dx} | ${r.dy} | ${r.yRange.join("~")} | ${r.scaleX.join("~")} | ${r.scaleY.join("~")} | ${r.rot.join("~")} | ${r.events.join(" ")} |`);
