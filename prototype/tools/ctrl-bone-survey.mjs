// 스탠딩 스켈레톤의 교감 조작 본 조사 — 게임이 손가락 위치로 끌고 다니는 본(Character_Ball_Move 볼 / Character_Pat 머리 / Character_Tickle 배)과
// 그 본을 얼굴에 연결하는 변환 제약(Face_CT ← 본, mix 0.5)이 어느 애니에서 켜지는지. 사용:
//   node tools/ctrl-bone-survey.mjs <assets/standing>            전수 통계
//   node tools/ctrl-bone-survey.mjs <assets/standing> erpin opal  지정 사도의 본 위치·제약·애니별 mix
import fs from "node:fs"; import path from "node:path"; import * as spine from "@esotericsoftware/spine-core";
class FakeTexture extends spine.Texture { constructor() { super({ width: 1, height: 1 }); } setFilters() {} setWraps() {} dispose() {} }
const root = process.argv[2], only = process.argv.slice(3);
const CTRL = /^Character_(Ball_Move|Pat|Tickle)$/, INTER = /^(Touch_Idle|Touch_End|Pat_Idle|Pat_End|Tickle_Idle(_\d)?|Tickle_End|Smash_End(_\d)?)$/;
function load(d) {
  const dir = path.join(root, d); const skel = fs.readdirSync(dir).find(f => f.endsWith(".skel")); if (!skel) return null; const stem = skel.replace(/\.skel$/, "");
  try { const atlas = new spine.TextureAtlas(fs.readFileSync(path.join(dir, `${stem}.atlas`), "utf8")); for (const p of atlas.pages) p.setTexture(new FakeTexture()); return new spine.SkeletonBinary(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(new Uint8Array(fs.readFileSync(path.join(dir, skel)))); } catch { return null; }
}
if (only.length) {
  for (const d of only) {
    const data = load(d); if (!data) { console.log(d, "로드 실패"); continue; }
    const sk = new spine.Skeleton(data); const skin = data.skins.find(s => s.name !== "default"); if (skin) sk.setSkin(skin); sk.setToSetupPose(); sk.updateWorldTransform();
    console.log(`== ${d}`);
    for (const b of sk.bones) if (CTRL.test(b.data.name)) console.log(`  ${b.data.name} parent=${b.parent?.data.name} world=(${b.worldX.toFixed(0)},${b.worldY.toFixed(0)})`);
    for (const c of data.transformConstraints) if (CTRL.test(c.target.name)) console.log(`  제약 ${c.name}: ${c.bones.map(b => b.name).join("+")} ← ${c.target.name} setup mix=(${c.mixRotate},${c.mixX},${c.mixY})`);
    for (const a of data.animations) {
      if (!INTER.test(a.name)) continue; const on = [];
      for (const t of a.timelines) if (t instanceof spine.TransformConstraintTimeline) { const c = data.transformConstraints[t.transformConstraintIndex]; if (c && CTRL.test(c.target.name)) on.push(`${c.target.name} mix=${t.frames[2].toFixed(2)}`); }
      console.log(`  ${a.name.padEnd(14)} ${a.duration.toFixed(2)}s ${on.length ? "켬: " + on.join(", ") : ""}`);
    }
  }
} else {
  const stats = {}; const inc = (k) => stats[k] = (stats[k] || 0) + 1; let n = 0;
  for (const d of fs.readdirSync(root)) {
    const data = load(d); if (!data) continue; n++;
    for (const b of data.bones) if (CTRL.test(b.name)) inc("bone:" + b.name);
    for (const c of data.transformConstraints) if (CTRL.test(c.target.name)) inc(`tc:${c.target.name} → ${c.bones.map(b => b.name).join("+")}`);
    for (const a of data.animations) { if (!INTER.test(a.name)) continue; inc("anim:" + a.name); for (const t of a.timelines) if (t instanceof spine.TransformConstraintTimeline) { const c = data.transformConstraints[t.transformConstraintIndex]; if (c && CTRL.test(c.target.name)) inc(`${a.name} 켬 ${c.target.name}`); } }
  }
  console.log("skeletons:", n); for (const [k, v] of Object.entries(stats).sort()) console.log(v.toString().padStart(4), k);
}
