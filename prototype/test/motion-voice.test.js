const test = require('node:test');
const assert = require('node:assert/strict');
const { voiceCatsFor, voicePoolFor } = require('../renderer/motion-voice.js');

test('교감은 볼 당기기·쓰다듬기·간지럼 단계를 구분한다', () => {
  assert.deepEqual(voiceCatsFor('Touch_End'), ['cheek']);
  assert.equal(voiceCatsFor('Pat_End')[0], 'pat');
  assert.equal(voiceCatsFor('Tickle_Start')[0], 'ticklestart');
  assert.equal(voiceCatsFor('Tickle_Idle_1')[0], 'tickleduring');
  assert.equal(voiceCatsFor('Tickle_End')[0], 'tickleduring');
  assert.equal(voiceCatsFor('TIckle_End')[0], 'tickleduring');
});

test('꿀밤의 맞는 소리와 후속 대사를 구분한다', () => {
  assert.equal(voiceCatsFor('Smash_End_1')[0], 'smashHit');
  assert.equal(voiceCatsFor('Smash_End_2')[0], 'smashLine');
});

test('전용 음성이 한 개여도 다른 의미의 대사와 섞지 않는다', () => {
  const categories = { victory: ['win.ogg'], joy: ['laugh1.ogg', 'laugh2.ogg'] };
  assert.deepEqual(voicePoolFor(categories, voiceCatsFor('Victory')), ['win.ogg']);
  assert.deepEqual(voicePoolFor({ joy: categories.joy }, voiceCatsFor('Victory')), categories.joy);
  assert.deepEqual(voicePoolFor({ touch: ['pat.ogg'] }, voiceCatsFor('Touch_End')), []);
});

test('조용한 루프에는 잡담이나 슬픔 음성을 붙이지 않는다', () => {
  for (const anim of ['Idle', 'Move', 'Walk_1', 'Jump1', 'Sleep', 'Pat_Idle', 'Touch_Idle']) {
    assert.equal(voiceCatsFor(anim), null, anim);
  }
});

test('감정과 전투 행동은 해당 의미의 음성을 우선한다', () => {
  const pairs = { Happy_1: 'joy', Angry_1: 'anger', Sad_1: 'sorrow', Eat_1: 'eat',
    Thinking: 'hmm', Nodding: 'yes', No: 'no', Attack1_1: 'basicattack',
    Skill1_1: 'spskill', Ultimate1_1: 'ultimate', Groggy: 'hit', Die: 'die', Spawn: 'spawn' };
  for (const [anim, category] of Object.entries(pairs)) assert.equal(voiceCatsFor(anim)[0], category, anim);
});
