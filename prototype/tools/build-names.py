"""사도/스킨 한글 이름표 생성 → data/names-ko.json

출처(우선순위):
 1. tools/trickcaltool-ko-KR.json  — Triple3T/trickcaltool (tr.triple-lab.com) 로케일. 사도 104명 + 스킨 번호별 이름 139개 (2025-08)
 2. tools/tr-trickcalChar.ts, tools/tr-costumes.ts — lsbim/t-r (2026-09 활발). 사도 138명(한글) + 코스튬 275개(한글 사도명 기준, 번호 없음)
 3. tools/skin-decisions.json — 번호가 없는 스킨을 게임 아이콘과 대조해 사람이 판별한 결과 (78개)
 4. GUESS — 위 어디에도 없는 사도의 추정 표기 (UI에 '?' 표시)

스킨 번호 결정: (1) 로케일 번호표 → (3) 판별표 → 남은 후보가 하나면 자동 → 그래도 없으면 "스킨 N"으로 표시(맵에 없음)
사용: python tools/build-names.py
"""
import json, re, os

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "..", "data", "names-ko.json")
ANIMS = os.path.join(HERE, "..", "out", "minimi-anims.json")

# t-r 에서 확인된 표기 (로케일에 없거나 다른 것)
TR_FIX = {
    "ErpinRoyale": "에르핀(왕도)", "Sparrot": "스패럿", "BeniBeni": "베니(베니)", "TigHero": "티그(영웅)",
    "HaleySane": "헤일리(멀쩡)", "Skea": "스키아", "ShadyTwisted": "셰이디(역전)", "NerRage": "네르(빡침)",
    "AshurMagi": "에슈르(마도)", "xXionx": "시온 더 다크불릿", "Crepe": "크레페",
    # 나무위키 문서로 확인
    "EisiaFridge": "냉장고", "Goldy": "골디", "Youngchun": "영춘",
    # 아래는 로케일엔 없지만 t-r 사도 목록에 같은 표기가 존재해 확인된 것
    "AmeliaR41": "아멜리아(R41)", "Aragnia": "아라그니아", "Asana": "아사나", "Aurora": "오로라", "Ayla": "아일라",
    "DayaPureShine": "다야(퓨어샤인)", "Delia": "델리아", "EdRehab": "이드(재활)", "Heidi": "하이디", "Inkle": "잉클",
    "Kishya": "키샤", "LeviGraduate": "레비(졸업)", "Miro": "미로", "Mute": "뮤트", "Nicole": "니콜", "Ronnie": "로니",
    "Scizor": "시저", "Silvia": "실비아", "Uros": "우로스", "Yomi": "요미",
}
# 어디에도 없는 것 — 추정
GUESS = {
    "Dummy": "더미", "Renewa": "리뉴아(원형)", "Renewa_alba": "리뉴아(알바)",
    "WispsCool": "위스프(냉정)", "WispsGloomy": "위스프(우울)", "WispsJolly": "위스프(활발)", "WispsNaive": "위스프(순수)",
}

ko = json.load(open(os.path.join(HERE, "trickcaltool-ko-KR.json"), encoding="utf-8"))["translation"]
heroes = dict(ko["chara"]); heroes.update(TR_FIX)
tr_chars = set(re.findall(r'^\s*"([^"]+)":\s*\{\s*grade', open(os.path.join(HERE, "tr-trickcalChar.ts"), encoding="utf-8").read(), re.M))
costumes = {}
for ch, cos in re.findall(r'charName:\s*"([^"]+)",\s*cosName:\s*"([^"]+)"', open(os.path.join(HERE, "tr-costumes.ts"), encoding="utf-8").read()):
    costumes.setdefault(ch, []).append(cos)
decisions = json.load(open(os.path.join(HERE, "skin-decisions.json"), encoding="utf-8"))

skeleton_skins = json.load(open(ANIMS, encoding="utf-8"))["skeleton"]["skins"]
need = {}
for s in skeleton_skins:
    m = re.match(r"^Mini_(.*?)(?:Skin(\d+))?$", s)
    if m and s != "default":
        need.setdefault(m.group(1), set())
        if m.group(2): need[m.group(1)].add(m.group(2))

guessed = []
for hero in sorted(need):
    if hero not in heroes:
        heroes[hero] = GUESS.get(hero, hero); guessed.append(hero)
    elif hero in GUESS:
        guessed.append(hero)
unverified = [h for h in heroes if h in GUESS or (heroes[h] not in tr_chars and h not in ko["chara"] and h not in TR_FIX)]

skins = {k: dict(v) for k, v in ko.get("skin", {}).items()}
skins.setdefault("Kidian", {})["2"] = "마음속의 은하수"  # 로케일 띄어쓰기 오류 (t-r·나무위키 일치)
stats = {"locale": 0, "decided": 0, "auto": 0, "unnamed": []}
for hero, nums in need.items():
    have = skins.setdefault(hero, {})
    stats["locale"] += sum(1 for n in nums if n in have)
    cands = [c for c in costumes.get(heroes.get(hero), []) if c not in have.values()]
    for n in sorted(nums, key=int):
        if n in have: continue
        d = decisions.get(hero, {}).get(n)
        if d: have[n] = d; stats["decided"] += 1; cands = [c for c in cands if c != d]
    rest = [n for n in sorted(nums, key=int) if n not in have]
    if len(rest) == 1 and len(cands) == 1:
        have[rest[0]] = cands[0]; stats["auto"] += 1; rest = []
    for n in rest: stats["unnamed"].append(f"{hero}Skin{n}")
    if not have: del skins[hero]

out = {
    "source": "trickcaltool ko-KR(2025-08) + lsbim/t-r(2026-09) + 아이콘 대조 판별(skin-decisions.json) + 추정(GUESS)",
    "heroes": heroes, "skins": skins, "guessed": sorted(set(guessed)), "defaultSkin": ko.get("defaultSkin", "기본 사복"),
}
json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
total_skins = sum(len(v) for v in need.values())
print(f"heroes {len(heroes)} (추정 {len(out['guessed'])}: {out['guessed']})")
print(f"skins {total_skins}: locale {stats['locale']} + decided {stats['decided']} + auto {stats['auto']} = {stats['locale']+stats['decided']+stats['auto']}, unnamed {stats['unnamed']}")
