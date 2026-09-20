/* 애니 풀 분류 — 스켈레톤마다 애니 구성이 달라서(에르핀 Angry 16개, 앨리스 Move 없음) 이름·길이로 나눈다.
 * spine 없이: { animations:[{name,duration}], findAnimation } 꼴만 주면 된다. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { MINI, SD, sdPools, moodPools, ingamePools, IG_SKIP } = require("../renderer/anim-pools.js");

const data = (names) => {
  const animations = names.map(n => (Array.isArray(n) ? { name: n[0], duration: n[1] } : { name: n, duration: 1 }));
  return { animations, findAnimation: (n) => animations.find(a => a.name === n) || null };
};

test("스탠딩: 대기는 Idle, 잔동작은 감정이 튀지 않는 것만 (화남·슬픔·놀람은 안 섞는다)", () => {
  const p = sdPools(data(["Idle_1", "Idle_2", "Happy_1", "Talk_1", "Angry_1", "Sad_1", "Surprise_1", "Clean_1"]));
  assert.deepEqual(p.idleQuiet, ["Idle_1", "Idle_2"]);
  assert.ok(p.idleLoop.has("Idle_1"));
  assert.ok(p.idleActs.includes("Happy_1") && p.idleActs.includes("Clean_1"), "밝은 것은 잔동작에");
  for (const bad of ["Angry_1", "Sad_1", "Surprise_1"]) assert.ok(!p.idleActs.includes(bad), `${bad} 는 스스로 하지 않는다`);
  assert.ok(p.idleActs.filter(n => n === "Idle_1").length >= 2, "Idle 을 두 번 넣어 잔동작이 드물게 나오게");
});

test("스탠딩: 긴 애니는 대기에 넣지 않는다 (10초 넘는 Idle, 4초 넘는 잔동작)", () => {
  const p = sdPools(data([["Idle_1", 2], ["Idle_2", 12], ["Happy_1", 2], ["Happy_2", 9]]));
  assert.deepEqual(p.idleQuiet, ["Idle_1"], "12초짜리 Idle 은 뺀다");
  assert.ok(p.idleActs.includes("Happy_1") && !p.idleActs.includes("Happy_2"), "9초짜리 잔동작은 뺀다");
});

test("스탠딩: 교감 4종은 있는 것만 잡고 없으면 null", () => {
  const full = sdPools(data(["Idle_1", "Touch_Idle", "Touch_End", "Pat_Idle", "Pat_End", "Tickle_Idle_1", "Tickle_End", "Smash_End_1"]));
  assert.equal(full.touchIdle, "Touch_Idle"); assert.equal(full.patEnd, "Pat_End");
  assert.equal(full.tickleIdle, "Tickle_Idle_1"); assert.deepEqual(full.smash, ["Smash_End_1"]);
  const bare = sdPools(data(["Idle_1"]));
  assert.equal(bare.touchIdle, null); assert.equal(bare.patIdle, null); assert.equal(bare.tickleIdle, null);
  assert.deepEqual(bare.smash, [], "꿀밤 애니가 없으면 빈 배열 — 부르는 쪽이 길이로 본다");
});

test("스탠딩: Move 가 없으면 null (그때는 미니미로 폴짝 이동)", () => {
  assert.equal(sdPools(data(["Idle_1", "Move_1"])).move, "Move_1");
  assert.equal(sdPools(data(["Idle_1", "Walk_1"])).move, "Walk_1");
  assert.equal(sdPools(data(["Idle_1"])).move, null);
});

test("표정: 없는 감정은 비슷한 것으로 물러난다 (미소→행복, 삐짐→화남)", () => {
  const all = (names) => names.map(n => ({ n, d: 1 }));
  const m = moodPools(all(["Happy_1", "Happy_2", "Angry_1", "Sad_1", "Eat_1"]));
  assert.deepEqual(m.smile, ["Happy_1"], "Smile 이 없으면 Happy_1(가벼운 웃음)");
  assert.deepEqual(m.happy, ["Happy_2"], "행복은 Happy_1 을 뺀 나머지");
  assert.deepEqual(m.sulky, ["Angry_1"], "삐짐이 없으면 화남 하나");
  assert.deepEqual(m.surprise, [], "놀람도 대체도 없으면 빈 풀");
  const m2 = moodPools(all(["Smile_1", "Laugh_1", "Cry_1", "Panic_1"]));
  assert.deepEqual(m2.smile, ["Smile_1"]);
  assert.deepEqual(m2.happy, ["Laugh_1"], "Happy 가 없으면 Laugh");
  assert.deepEqual(m2.sad, ["Cry_1"]);
  assert.deepEqual(m2.surprise, ["Panic_1"]);
});

test("전투 SD: 작업용 찌꺼기·딴 모습은 고르지 않는다", () => {
  for (const bad of ["zTest", "잔상", "Groggry", "Test_DUMMY", "Idle_ChangeForm", "MirrorImage_1", "AlterEgo_1", "Idle_rejected"])
    assert.ok(IG_SKIP.test(bad), `거르는 이름: ${bad}`);
  for (const good of ["Idle", "Move", "Victory", "Attack1_1", "Skill1_1", "Ultimate1_1", "Groggy", "Die"])
    assert.ok(!IG_SKIP.test(good), `쓰는 이름: ${good}`);
  const p = ingamePools(data(["Idle", "Move", "Victory", "Attack1_1", "zTest", "Idle_ChangeForm"]));
  assert.ok(!p.all.includes("zTest") && !p.all.includes("Idle_ChangeForm"));
  assert.equal(p.move, "Move");
  assert.ok(p.react.includes("Victory") && p.react.includes("Attack1_1"));
});

test("전투 SD: 공격 모션이 없는 세트(허수아비)도 클릭 반응이 비지 않는다", () => {
  const p = ingamePools(data(["Idle", "Spawn", "Hit", "Die"]));
  assert.ok(p.react.length > 0, `반응 풀이 비면 클릭해도 아무 일도 안 난다 (${JSON.stringify(p.react)})`);
  assert.equal(p.move, null, "Move 가 없으면 null");
  assert.equal(p.land, "Hit", "착지는 그로기→피격→죽음 순으로 있는 것 (Groggy 가 없으니 Hit)");
});

test("미니미 기본값은 그대로 (모든 외형이 같은 스켈레톤을 쓴다)", () => {
  assert.equal(MINI.move, "Idle2_1");
  assert.ok(MINI.idleLoop.has("Idle2_1"));
  assert.ok(MINI.moods.happy.length && MINI.moods.anger.length);
  assert.equal(SD.hold, "Idle_1", "스탠딩 기본값(로드 전)도 비어 있지 않다");
});
