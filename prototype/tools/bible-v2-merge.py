# 인물 사전 v2 병합 — tools/bible-v2/*.json (사도키 → {facts, voice, react, topics, never, mood}) 을 data/bible.json 에 덧붙인다.
# 기존 필드(who/traits/rel/story/quirk/theater)는 그대로 두고 v2 필드만 갱신.
# 병합 전 원문 유입 검사(로컬 out/namu-pages 가 있을 때):
#   - 나무위키 '대사' 절(게임 대사 원문) : 10자 shingle 0건이어야 한다 (v0.11.7 원칙 — 배포 데이터에 게임 대사 원문 금지)
#   - 그 밖의 위키 서술(CC BY-NC-SA, 요약·재구성 대상) : 18자 shingle 0건 (문장 통째 베끼기 방지)
# 실행: python tools/bible-v2-merge.py [--check-only]
import json, os, re, sys, glob
sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.join(os.path.dirname(__file__), "..")
SRC = os.path.join(ROOT, "tools", "bible-v2"); PATH = os.path.join(ROOT, "data", "bible.json"); PAGES = os.path.join(ROOT, "out", "namu-pages")
FIELDS = {"facts": list, "voice": list, "react": dict, "topics": list, "never": list, "mood": str}
NAME = {"xxionx": "시온 더 다크불릿", "renewa_alba": "리뉴아"}
BRACKET = re.compile(r'"\n(\s*)\],(\s*)"topics"')  # react 사전을 ]로 닫은 손버릇 교정
HDR = re.compile(r"^\d+(?:\.\d+)*\. (.+)$")
N_LINE, N_PROSE = 10, 18

def norm(s): return re.sub(r"[\s.,!?~…⋯'\"“”‘’()\[\]\-·]", "", s)

def split_doc(t):
    """(대사 절 텍스트, 나머지 텍스트) — 문서 앞 목차와 같은 줄만 절 제목으로 본다"""
    a = t.find("\n1. 개요\n"); b0 = t.find("\n1. 개요\n", a + 5)
    if a < 0 or b0 < 0: return "", t
    toc = {l.strip() for l in t[a:b0].splitlines() if HDR.match(l.strip())}
    lines, prose, in_line = [], [], False
    for l in t[b0 + 1:].splitlines():
        ls = l.strip(); m = HDR.match(ls) if ls in toc else None
        if m: in_line = m.group(1).strip().startswith("대사")
        (lines if in_line else prose).append(l)
    return "\n".join(lines), "\n".join(prose)

b = json.load(open(PATH, encoding="utf-8"))
v2, bad = {}, []
for f in sorted(glob.glob(os.path.join(SRC, "*.json"))):
    raw = open(f, encoding="utf-8").read()
    fixed = BRACKET.sub(lambda m: '"\n' + m.group(1) + "}," + m.group(2) + '"topics"', raw)
    if fixed != raw: open(f, "w", encoding="utf-8").write(fixed)
    try: d = json.loads(fixed)
    except json.JSONDecodeError as e: print(f"{os.path.basename(f)}: JSON 오류 {e}"); sys.exit(1)
    for k, v in d.items():
        if k not in b: bad.append(f"{os.path.basename(f)}: 없는 키 {k}"); continue
        for fn, ty in FIELDS.items():
            if fn not in v or not isinstance(v[fn], ty) or not v[fn]: bad.append(f"{os.path.basename(f)}: {k}.{fn} 누락/형식")
        if k in v2: bad.append(f"{os.path.basename(f)}: {k} 중복")
        v2[k] = v
if bad: print("\n".join(bad)); sys.exit(1)

hits = 0
for k, v in v2.items():
    f = os.path.join(PAGES, NAME.get(k, b[k]["ko"]) + ".txt")
    if not os.path.exists(f): continue
    dl, pr = split_doc(open(f, encoding="utf-8").read()); dl, pr = norm(dl), norm(pr)
    texts = [x for fn in ("facts", "voice", "never", "topics") for x in v[fn]] + [f"{a}: {c}" for a, c in v["react"].items()] + [v["mood"]]
    for t in texts:
        nt = norm(t)
        sh = next((nt[i:i + N_LINE] for i in range(len(nt) - N_LINE + 1) if nt[i:i + N_LINE] in dl), None)
        if sh: hits += 1; print(f"대사 겹침 {k}: …{sh}… ← {t[:60]}"); continue
        sh = next((nt[i:i + N_PROSE] for i in range(len(nt) - N_PROSE + 1) if nt[i:i + N_PROSE] in pr), None)
        if sh: hits += 1; print(f"서술 겹침 {k}: …{sh}… ← {t[:60]}")
print(f"v2 {len(v2)}명 / 겹침 {hits}건 (대사 {N_LINE}자·서술 {N_PROSE}자)")
if "--check-only" in sys.argv: sys.exit(0 if not hits else 2)
if hits: print("겹침이 있어 병합하지 않음"); sys.exit(2)
for k, v in v2.items(): b[k].update(v)
b["_meta"]["v2"] = f"facts(확정 설정)·voice(말투 설계)·react(상황별 반응)·topics(먼저 꺼낼 화제)·never(하지 않는 것)·mood(감정 경향) — {len(v2)}명 (tools/bible-v2/)"
json.dump(b, open(PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("병합 완료:", PATH)
