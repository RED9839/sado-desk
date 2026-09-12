# -*- coding: utf-8 -*-
"""사도 사이 관계 데이터 → data/relations.json
입력: out/scripts/<hero>.jsonl (STT 대본: 스토리 줄에 story/ep/speaker) + data/talk-ko.json(한글 이름)
산출(사도별):
  calls:  {상대: [부르는 말 …]}   — 내 대사에서 다른 사도 이름(+님/언니/씨…)이 나온 형태와 횟수. "네르"(반말·이름) vs "네르 언니" vs "여왕님"(별칭)
  with:   {상대: 같이 나온 에피소드 수}  — 같은 스토리·에피소드에 둘 다 대사가 있으면 함께 등장
  stories:[함께 나온 스토리 키 …]
별칭(ALIAS): 이름 대신 부르는 호칭 → 사도 (여왕님→에르핀, 시장님→엘레나 …). 확실한 것만.
"""
import os, re, json, glob, collections

SCRIPTS = "out/scripts"; TALK = "data/talk-ko.json"; OUT = "data/relations.json"
talk = json.load(open(TALK, encoding="utf-8"))
KO = {k.lower(): v["ko"] for k, v in talk["heroes"].items()}          # 폴더명(lower) → 한글
BYKO = collections.defaultdict(list)
for k, ko in KO.items(): BYKO[ko].append(k)
# 이격은 기본 사도로 합침 (erpinroyale → erpin): 폴더명이 다른 사도 폴더명으로 시작하면 그 사도
BASES = sorted(KO.keys(), key=len, reverse=True)
def base_of(folder):
    for b in BASES:
        if folder == b: return b
    for b in BASES:
        if folder.startswith(b) and len(folder) > len(b): return b
    return folder
# 이름 별칭: 부르는 말 → 사도(폴더명). 원작에서 고정된 것만
ALIAS = {"여왕님": "erpin", "여왕": "erpin", "폐하": "erpin", "시장님": "elena", "사제장": "ner", "자매님": "vivi", "단장": "posher"}
SUFFIX = r"(님|씨|양|언니|오빠|누나|형|선배|선생님|사마|짱|쨩|군|아|야|이)?"
names = sorted({ko for ko in KO.values()}, key=len, reverse=True)
name_re = re.compile(r"(?<![가-힣])(" + "|".join(re.escape(n) for n in names) + ")" + SUFFIX + r"(?![가-힣])")
# 일반 낱말과 겹치는 짧은 이름(란·림·아야·이드·뮤트·티그…)은 호칭 접미(님/언니/씨)나 호격(아/야)이 붙었을 때만 인정
RISKY = {"란", "림", "아야", "이드", "뮤트", "티그", "레비", "바나", "마리", "캐시", "미로", "루드", "루포", "사리", "오르", "라이카", "네티", "골디", "레이", "칸타", "테이", "에스피"}
alias_re = re.compile("(" + "|".join(re.escape(a) for a in sorted(ALIAS, key=len, reverse=True)) + r")(?![가-힣])")

calls = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))  # base → other → form → n
eps = collections.defaultdict(set)   # (story, ep) → set(base)
lines_n = collections.Counter()
for f in glob.glob(os.path.join(SCRIPTS, "*.jsonl")):
    folder = os.path.basename(f)[:-6]; me = base_of(folder)
    if me not in KO: continue
    for line in open(f, encoding="utf-8"):
        try: r = json.loads(line)
        except Exception: continue
        t = r.get("text") or ""
        if not t: continue
        lines_n[me] += 1
        if r.get("cat") == "story": eps[(r["story"], r["ep"])].add(me)
        for m in name_re.finditer(t):
            nm, suf = m.group(1), m.group(2) or ""
            if nm in RISKY and not suf: continue
            targets = BYKO.get(nm, [])
            for tg in targets:
                tb = base_of(tg)
                if tb == me or tb != tg: continue  # 자기 이름·이격 중복 제외
                if suf in ("아", "야", "이"): suf = "(반말 호격)"
                calls[me][tb][nm + ("" if suf.startswith("(") else suf) + (" " + suf if suf.startswith("(") else "")] += 1
        for m in alias_re.finditer(t):
            tb = ALIAS[m.group(1)]
            if tb != me and tb in KO: calls[me][tb][m.group(1)] += 1

with_ = collections.defaultdict(collections.Counter); stories = collections.defaultdict(lambda: collections.defaultdict(set))
for (story, ep), group in eps.items():
    for a in group:
        for b in group:
            if a != b: with_[a][b] += 1; stories[a][b].add(story)

out = {}
for me in KO:
    if not lines_n[me]: continue
    c = {}
    for other, forms in calls[me].items():
        top = forms.most_common(4)
        if sum(forms.values()) >= 2: c[other] = [{"form": f, "n": n} for f, n in top]
    w = {o: n for o, n in with_[me].most_common(12) if n >= 3}
    out[me] = {"ko": KO[me], "n": lines_n[me], "calls": dict(sorted(c.items(), key=lambda kv: -sum(x["n"] for x in kv[1]))[:12]),
               "with": w, "stories": {o: sorted(stories[me][o])[:6] for o in w}}
json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
print("heroes", len(out), "→", OUT)
for h in ["erpin", "ner", "vela", "crepe", "amelia", "elena", "butter", "kommy"]:
    if h in out:
        r = out[h]; print(f"\n[{r['ko']}] n={r['n']}")
        for o, fs in list(r["calls"].items())[:6]: print(f"  → {KO[o]}: " + ", ".join(f"{x['form']}×{x['n']}" for x in fs))
        print("  함께:", ", ".join(f"{KO[o]}({n})" for o, n in list(r["with"].items())[:6]))
