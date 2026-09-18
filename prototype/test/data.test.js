// 배포 데이터(data/*.json)의 짝이 맞는지. 대본을 손대거나 스킨을 추가할 때 여기서 깨진다.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const D = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", f), "utf8"));
const st = D("self-talk.json"), talk = D("talk-ko.json"), names = D("names-ko.json");
const lower = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));
const heroes = lower(talk.heroes);

test("혼잣말 — 사도마다 32줄(상황 20 + 무태그 12), 감정·동작이 다 붙어 있다", () => {
  const MOODS = new Set(["", "smile", "anger", "sad", "happy", "eat", "sulky", "surprise"]);
  for (const [k, lines] of Object.entries(st.heroes)) {
    assert.equal(lines.length, 32, `${k}: ${lines.length}줄`);
    assert.equal(lines.filter(l => l.w).length, 20, `${k}: 상황 줄 수`);
    for (const l of lines) { assert.ok(l.t && l.t.length >= 7, `${k}: 빈 줄`); assert.ok(MOODS.has(l.m), `${k}: 감정 ${l.m}`); assert.ok(l.a, `${k}: 동작 없음 — selftalk-act.js 안 돌림`); }
    assert.equal(new Set(lines.map(l => l.t)).size, 32, `${k}: 같은 줄이 둘`);
  }
});

test("코스튬 혼잣말 — 벌마다 8줄, 키는 '사도#번호' 이고 그 사도·번호가 talk-ko 프로필에 있다", () => {
  for (const [k, lines] of Object.entries(st.skins)) {
    assert.equal(lines.length, 8, `${k}: ${lines.length}줄`);
    const m = /^([a-z0-9_]+)#(\d+)$/.exec(k); assert.ok(m, `${k}: 키 꼴`);
    assert.ok(st.heroes[m[1]], `${k}: 본편 사도 없음`);
    assert.ok(heroes[m[1]] && heroes[m[1]].skins && heroes[m[1]].skins[m[2]], `${k}: talk-ko 코스튬 프로필 없음`);
    assert.ok(lines.every(l => !l.w), `${k}: 코스튬 줄에는 상황 꼬리표를 두지 않는다`);
  }
});

test("혼잣말 사도는 전부 talk-ko 프로필이 있고, 이름표(names-ko)도 있다", () => {
  const nameHeroes = lower(names.heroes);
  for (const k of Object.keys(st.heroes)) {
    assert.ok(heroes[k], `${k}: talk-ko 프로필 없음`);
    assert.ok(nameHeroes[k], `${k}: 한글 이름표 없음`);
  }
});

test("talk-ko 의 코스튬 프로필은 라벨이 있고, 이름표와 같은 이름을 가리킨다", () => {
  const nameSkins = lower(names.skins);
  for (const [h, p] of Object.entries(heroes)) for (const [n, sk] of Object.entries(p.skins || {})) {
    assert.ok(sk.label, `${h}#${n}: 라벨 없음`);
    const nk = nameSkins[h] && nameSkins[h][n];
    if (nk) assert.equal(sk.label, nk, `${h}#${n}: 프로필 라벨과 이름표가 다름`);
  }
});

test("대본 줄에 [감정] 꼬리표·영어·마크다운이 새지 않았다", () => {
  const bad = [];
  for (const [k, lines] of [...Object.entries(st.heroes), ...Object.entries(st.skins)]) for (const l of lines) {
    if (/\[[^\]]{1,8}\]\s*$/.test(l.t) || /[A-Za-z]{3,}/.test(l.t) || /\*\*|```/.test(l.t)) bad.push(`${k}: ${l.t}`);
  }
  assert.deepEqual(bad, []);
});

test("이름표 — 사도 이름·스킨 이름이 비어 있지 않다", () => {
  for (const [k, v] of Object.entries(names.heroes)) assert.ok(v && v.trim(), k);
  for (const [k, m] of Object.entries(names.skins)) for (const [n, v] of Object.entries(m)) assert.ok(v && v.trim(), `${k}#${n}`);
});
