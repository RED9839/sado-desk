# -*- coding: utf-8 -*-
"""사도/스킨 한글 이름표 생성 → data/names-ko.json

게임 파일에는 사도가 Erpin, 스킨이 ErpinSkin3 처럼 영문 id로만 있어서 한글 표기(에르핀 / 발랄한 현장학습)를 따로 만든다.
출처:
 1. 나무위키 트릭컬 리바이브 사도 문서 캐시 (tools/namu-fetch-all.py 로 받은 scratch/namu/pages/<한글>.txt)
    - 상단 표의 "Erpin | エルフィン | …" 줄 → 영문 id ↔ 한글 이름
    - "사복" 절의 소제목(테마 사복 이름)과 출시일 → 스킨 이름 후보 (출시 순)
 2. tools/names-verified.json — 스킨 번호(ErpinSkin3 ↔ 어느 사복인지)를 게임 아이콘과 대조해 확정한 표.
    게임의 스킨 번호는 출시 순서와 다른 경우가 있어(약 17%) 이름만으로는 번호를 못 정한다.
 3. GUESS — 나무위키에 문서가 없는 것(자리표시 Dummy, 위스프 4종 등)의 추정 표기 (UI에 '?' 표시)

사용: python tools/build-names.py <namu_pages_dir>
"""
import json, os, re, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
PAGES = sys.argv[1] if len(sys.argv) > 1 else None
verified = json.load(open(os.path.join(HERE, "names-verified.json"), encoding="utf-8"))
GUESS = {"Dummy": "더미", "Renewa": "리뉴아", "Renewa_alba": "리뉴아(알바)", "WispsCool": "위스프(쿨)", "WispsGloomy": "위스프(글루미)", "WispsJolly": "위스프(졸리)", "WispsNaive": "위스프(나이브)"}

# ---- 미니미 스킨 목록에서 사도 id / 스킨 번호 뽑기 (게임 파일 기준의 '있는 것' 목록) ----
def game_ids():
    ids = collections.defaultdict(set)
    atlas = os.path.join(ROOT, "assets", "minimi", "minimi.atlas")
    if not os.path.exists(atlas): atlas = os.path.join(os.environ.get("APPDATA", ""), "사도 데스크", "assets", "minimi", "minimi.atlas")
    if not os.path.exists(atlas): return None
    for l in open(atlas, encoding="utf-8"):
        m = re.match(r"^([A-Za-z][A-Za-z0-9_]*?)(?:Skin(\d+))?\s*$", l.rstrip("\n"))
        if m and not l.startswith(("size:", "filter:", "pma:", "scale:", "bounds:", "offsets:", "rotate:", "index:")) and not l.strip().endswith(".png"):
            ids[m.group(1)].add(m.group(2))
    # 아틀라스 영역 이름은 대소문자·접두어가 스킨 id와 다를 수 있음(DayaPureshine, Mini_WispsCool) → 검증표의 id로 정규화
    canon = {h.lower(): h for h in verified["heroes"]}
    norm = collections.defaultdict(set)
    for k, v in ids.items():
        key = k[5:] if k.startswith("Mini_") else k
        norm[canon.get(key.lower(), key)] |= v
    return norm

# ---- 나무위키 캐시 파싱 ----
def parse_namu(pages):
    out = {}  # 한글 이름 → {"en": 영문, "skins": [(이름, 출시일)]}
    for fn in os.listdir(pages):
        if not fn.endswith(".txt"): continue
        ko = fn[:-4]; text = open(os.path.join(pages, fn), encoding="utf-8", errors="ignore").read()
        en = None
        m = re.search(r"^([A-Z][A-Za-z0-9 .'-]{1,30}) \| [^\n|]+ \| ", text, re.M)
        if m: en = m.group(1).strip()
        skins = []
        sec = re.search(r"^\d+(?:\.\d+)*\. 사복\n\[편집\]\n(.*?)(?=^\d+\. |\Z)", text, re.M | re.S)
        body = sec.group(1) if sec else ""
        for sm in re.finditer(r"^\d+(?:\.\d+)*\. (.+?)\n\[편집\]\n(.*?)(?=^\d+(?:\.\d+)*\. |\Z)", body, re.M | re.S):
            name = sm.group(1).strip(); blk = sm.group(2)
            dm = re.search(r"출시일\s*\n\s*\n\s*(\d{4}) / (\d{2}) / (\d{2})", blk)
            skins.append((name, "".join(dm.groups()) if dm else ""))
        out[ko] = {"en": en, "skins": skins}
    return out

def main():
    heroes = dict(verified["heroes"]); skins = {k: dict(v) for k, v in verified["skins"].items()}
    ids = game_ids()
    namu = parse_namu(PAGES) if PAGES and os.path.isdir(PAGES) else {}
    report = []
    # 1) 나무위키 영문 표기로 사도 id 확인 (검증표와 다르면 보고)
    en2ko = {v["en"].lower().replace(" ", ""): ko for ko, v in namu.items() if v.get("en")}
    if ids:
        for hero in sorted(ids):
            if hero in heroes: continue
            ko = en2ko.get(hero.lower())
            if ko: heroes[hero] = ko; report.append(f"새 사도 {hero} → {ko} (나무위키)")
            elif hero in GUESS: heroes[hero] = GUESS[hero]
            else: heroes[hero] = hero; report.append(f"이름 모름 {hero}")
    # 2) 스킨: 검증표에 없는 번호는 나무위키 사복 출시 순으로 채움 (번호 = 출시 순 가정, 아이콘 대조 전이라 '?' 표시)
    unverified = []
    if ids:
        for hero, nums in sorted(ids.items()):
            nums = sorted(int(n) for n in nums if n)
            if not nums: continue
            known = skins.get(hero, {})
            ko = heroes.get(hero); page = namu.get(ko) if ko else None
            cand = [n for n, _ in sorted(page["skins"], key=lambda x: x[1])] if page else []
            used = set(known.values())
            free = [c for c in cand if c not in used]
            for n in nums:
                if str(n) in known: continue
                if free: skins.setdefault(hero, {})[str(n)] = free.pop(0); unverified.append(f"{hero}Skin{n}"); report.append(f"스킨 추정 {hero}Skin{n} → {skins[hero][str(n)]} (출시 순, 아이콘 대조 필요)")
                else: report.append(f"스킨 이름 모름 {hero}Skin{n}")
    guessed = [h for h in heroes if h in GUESS and (not namu or heroes[h] not in namu)]
    result = {"source": "나무위키 트릭컬 리바이브 사도 문서(영문 표기·사복 절) + 게임 아이콘 대조로 확정한 스킨 번호표(tools/names-verified.json)", "heroes": dict(sorted(heroes.items())), "skins": dict(sorted(skins.items())), "guessed": sorted(set(guessed) | set(unverified)), "defaultSkin": "기본 사복"}
    out = os.path.join(ROOT, "data", "names-ko.json")
    json.dump(result, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"heroes={len(result['heroes'])} skins={sum(len(v) for v in result['skins'].values())} guessed={len(result['guessed'])}")
    for r in report: print(" -", r)

if __name__ == "__main__":
    main()
