# -*- coding: utf-8 -*-
"""위키 문서에서 대본 쓸 때 쓸 만한 것을 더 뽑는다 — out/_hero-extra.json (로컬 전용).
  · 개요 / 인물 소개  : 사도가 어떤 인물인지
  · 연회장 선호 음식   : 좋아하는·싫어하는 음식과 그 반응 (혼잣말 소재로 아주 좋다)
  · 생활 스킬        : 오지랖·애교·추진력 같은 성향 낱말 5개
여담·평가·스킬 같은 절은 메타(성우·패치·유저 평)가 섞여 있어 넣지 않는다."""
import io, os, re, glob, json
os.chdir(r"C:\projects\사도 데스크\prototype")

talk = json.load(io.open("data/talk-ko.json", encoding="utf-8"))
KO2KEY = {v["ko"]: k.lower() for k, v in talk["heroes"].items()}
HEAD = re.compile(r"^\d+(?:\.\d+)*\.\s*(.+?)\[편집\]\s*$")
NOISE = re.compile(r"(^TR |ItemSlot|MyHomeRestaurant|Skill Effect|^Icon |^※|^\s*$|파일:|width=|^\d+$)")

def sections(path):
    L = io.open(path, encoding="utf-8").read().split("\n")
    marks = [(n, HEAD.match(l.strip()).group(1).strip()) for n, l in enumerate(L) if HEAD.match(l.strip())]
    out = {}
    for i, (n, name) in enumerate(marks):
        end = marks[i + 1][0] if i + 1 < len(marks) else len(L)
        out.setdefault(name, [x.strip() for x in L[n + 1:end] if x.strip()])
    return out

def hero_key(path):
    ko = re.sub(r"^\d+_", "", os.path.basename(path)).replace(".txt", "").replace("(트릭컬 리바이브)", "")
    if "_" in ko:
        base, _, tail = ko.partition("_")
        ko = "%s(%s)" % (base, tail) if tail else base
    return KO2KEY.get(ko)

out = {}
for f in sorted(glob.glob("out/namu/*.txt")):
    k = hero_key(f)
    if not k: continue
    S = sections(f)
    rec = {}
    # 개요·인물 소개 — 문장만
    for name in ("인물 소개", "개요"):
        body = [x for x in S.get(name, []) if not NOISE.search(x) and len(x) > 20]
        if body: rec["intro"] = " ".join(body)[:400]; break
    # 연회장 음식 — 표 찌꺼기를 뺀 서술문만
    food = [x for x in S.get("연회장 선호 음식", []) if not NOISE.search(x) and len(x) > 15]
    if food: rec["food"] = food[:8]
    # 생활 스킬 — 'TR 오지랖Skill EffectOn' 다음 줄이 이름
    sk, prev = [], ""
    for x in S.get("모험회", []):
        if prev.startswith("TR ") and "Skill Effect" in prev and 1 <= len(x) <= 6 and re.match(r"^[가-힣]+$", x):
            if x not in sk: sk.append(x)
        prev = x
    if sk: rec["skills"] = sk[:6]
    if rec: out[k] = rec

io.open("out/_hero-extra.json", "w", encoding="utf-8", newline="\n").write(json.dumps(out, ensure_ascii=False, indent=1))
n = len(out)
rep = ["사도 %d명" % n,
       "  개요·인물 소개 %d명 · 음식 %d명 · 생활 스킬 %d명" % (
           len([1 for v in out.values() if v.get("intro")]),
           len([1 for v in out.values() if v.get("food")]),
           len([1 for v in out.values() if v.get("skills")]))]
for k in ("jubee", "butter", "daya"):
    if k in out:
        v = out[k]
        rep += ["", "[%s]" % k, "  intro: %s" % (v.get("intro", "")[:110]),
                "  skills: %s" % ", ".join(v.get("skills", []))]
        rep += ["  food: " + x[:90] for x in v.get("food", [])[:4]]
io.open("out/_extra.txt", "w", encoding="utf-8", newline="\n").write("\n".join(rep))
