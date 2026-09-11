"""나무위키 캐릭터 문서(namu-fetch-all.py 결과) ↔ assets/names-ko.json 대조
- 이름: 문서가 어떤 제목으로 존재하는지 (표기 확인)
- 스킨: 문서 목차의 "사복" 절 하위 항목(번호순) vs 내 스킨 번호표
사용: python tools/namu-compare.py <pages_dir> [--out report.md]
"""
import json, os, re, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
PAGES = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
names = json.load(open(os.path.join(ROOT, "assets", "names-ko.json"), encoding="utf-8"))
results = json.load(open(os.path.join(PAGES, "_results.json"), encoding="utf-8"))
skel = json.load(open(os.path.join(ROOT, "out", "minimi-anims.json"), encoding="utf-8"))["skeleton"]["skins"]
need = {}
for s in skel:
    m = re.match(r"^Mini_(.*?)Skin(\d+)$", s)
    if m: need.setdefault(m.group(1), []).append(m.group(2))

def toc_skins(text):
    """목차에서 'x.y. 사복' 다음의 'x.y.k. 이름' 항목들을 순서대로. 목차 줄은 '3.9. 사복' / '3.9.1. 유령 나라 앨리스' 형식."""
    lines = [l.strip() for l in text.split("\n")]
    for i, l in enumerate(lines):
        m = re.match(r"^(\d+(?:\.\d+)*)\.\s*(사복|스킨|의상)$", l)
        if not m: continue
        prefix = m.group(1) + "."
        out = []
        for l2 in lines[i + 1:]:
            m2 = re.match(r"^(\d+(?:\.\d+)*)\.\s+(.+)$", l2)
            if not m2: continue
            if not m2.group(1).startswith(prefix): break
            if m2.group(1).count(".") == prefix.count("."):  # 직계 하위만
                out.append(m2.group(2).strip())
        return out
    return None

rows = []; name_ok = name_miss = 0; skin_ok = skin_diff = skin_unk = 0; extra_total = 0
for hero, r in sorted(results.items()):
    ko = r["ko"]; st = r["status"]
    if st == "missing": name_miss += 1; rows.append((hero, ko, "문서 없음", [], [])); continue
    name_ok += 1
    text = open(r["file"], encoding="utf-8").read()
    namu = toc_skins(text)
    mine = [names["skins"].get(hero, {}).get(n) for n in sorted(need.get(hero, []), key=int)]
    nums = sorted(need.get(hero, []), key=int)
    diffs = []
    if namu is None:
        if nums: skin_unk += len(nums)
        rows.append((hero, ko, st, mine, None)); continue
    for n, my in zip(nums, mine):
        i = int(n) - 1
        nm = namu[i] if i < len(namu) else None
        norm = lambda s: re.sub(r"\s+", "", s or "").lower()
        if my and nm and norm(my) == norm(nm): skin_ok += 1
        elif my and nm and (norm(my) in norm(nm) or norm(nm) in norm(my)): skin_ok += 1
        elif my and nm: skin_diff += 1; diffs.append(f"skin{n}: 내표 '{my}' / 나무 '{nm}'")
        elif nm and not my: skin_diff += 1; diffs.append(f"skin{n}: 내표 없음 / 나무 '{nm}'")
        elif my and not nm: skin_unk += 1; diffs.append(f"skin{n}: 내표 '{my}' / 나무 목차에 없음")
    extra = namu[len(nums):]
    extra_total += len(extra)
    rows.append((hero, ko, st, mine, namu, diffs, extra))

print(f"이름: 문서 확인 {name_ok}, 없음 {name_miss}")
print(f"스킨: 일치 {skin_ok}, 불일치 {skin_diff}, 대조 불가 {skin_unk}, 나무위키에만 있는 스킨(미니미 없음) {extra_total}")
print("\n== 불일치 ==")
for row in rows:
    if len(row) > 5 and row[5]:
        print(row[0], row[1], "|", row[2]); [print("   ", d) for d in row[5]]
print("\n== 문서 없음 ==")
for row in rows:
    if row[2] == "문서 없음": print(" ", row[0], row[1])
print("\n== 사복 목차 없음(대조 불가) ==")
for row in rows:
    if len(row) == 5 and row[4] is None and need.get(row[0]): print(" ", row[0], row[1], row[3])
if "--out" in sys.argv:
    out = sys.argv[sys.argv.index("--out") + 1]
    with open(out, "w", encoding="utf-8") as f:
        f.write("| 사도 | 문서 | 스킨 대조 |\n|---|---|---|\n")
        for row in rows:
            hero, ko, st = row[:3]
            if len(row) > 5:
                d = "; ".join(row[5]) if row[5] else ("일치" if row[3] else "-")
                if row[6]: d += f" (+나무만: {', '.join(row[6])})"
            elif len(row) == 5: d = "사복 목차 없음"
            else: d = "-"
            f.write(f"| {ko} | {st} | {d} |\n")
    print("wrote", out)
