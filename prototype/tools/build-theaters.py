# -*- coding: utf-8 -*-
"""나무위키 테마극장 문서(fetch-page.js로 받은 텍스트) → data/theaters.json
입력: <dir>/theater.txt (시즌 3 본문), theater-s1.txt, theater-s2.txt
항목: {season, title, cast[], synopsis, period, note}  — cast는 '주연:' 줄, synopsis는 그 다음 문단, note는 기간 뒤 위키 편집자 설명(짧게)
출처 표기: 나무위키 트릭컬 리바이브/스토리/테마극장 (CC BY-NC-SA 2.0 KR)
"""
import re, json, sys, os

SRC = sys.argv[1] if len(sys.argv) > 1 else r"C:\sadodesk-tmp\namu"
OUT = "data/theaters.json"
talk = json.load(open("data/talk-ko.json", encoding="utf-8"))
KO2KEY = {v["ko"]: k.lower() for k, v in talk["heroes"].items()}
ALIAS = {"교주": None, "빵주": None}

def parse(text, season):
    # 문서 본문은 목차가 두 번(상단 목차·본문) 나오므로 '[편집]'이 붙은 본문 헤딩만
    items = []
    heads = [(m.start(), m.group(1), m.group(2)) for m in re.finditer(r"\n(\d+(?:\.\d+)*)\. ([^\n\[]{2,60})(?:\[\d+\])?\n\[편집\]\n", text)]
    for i, (pos, num, title) in enumerate(heads):
        end = heads[i + 1][0] if i + 1 < len(heads) else len(text)
        body = text[pos:end]
        m = re.search(r"주연:\s*([^\n]+)", body)
        if not m: continue
        cast_raw = [c.strip() for c in re.split(r"[,、]", m.group(1)) if c.strip()]
        cast = [c for c in cast_raw if c not in ("교주", "빵주")]
        after = body[m.end():]
        paras = [p.strip().replace("\n", " ") for p in re.split(r"\n\s*\n", after) if p.strip()]
        syn = ""; period = ""; note = ""
        for p in paras:
            if p.startswith("이벤트 기간"): continue
            if re.match(r"^\d{4}년", p): period = period or p.split("/")[0].strip(); continue
            if re.match(r"^\d+/10", p): continue  # 작중 가짜 리뷰
            if not syn and not p.startswith("기타 언어") and len(p) > 10: syn = p; continue
            if syn and not note and not p.startswith("기타 언어") and len(p) > 40 and not re.match(r"^\d{4}년", p): note = p[:400]; break
        items.append({"season": season, "title": title.strip(), "cast": cast, "castKeys": [KO2KEY.get(c) for c in cast if KO2KEY.get(c)], "synopsis": syn[:300], "period": period, "note": note})
    return items

all_items = []
for fn, season in (("theater-s1.txt", 1), ("theater-s2.txt", 2), ("theater.txt", 3)):
    p = os.path.join(SRC, fn)
    if not os.path.exists(p): print("없음", p); continue
    items = parse(open(p, encoding="utf-8", errors="ignore").read(), season)
    print(f"season {season}: {len(items)}개")
    all_items += items
json.dump({"source": "나무위키 트릭컬 리바이브/스토리/테마극장 (CC BY-NC-SA 2.0 KR)", "items": all_items}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
print("→", OUT, len(all_items))
for it in all_items[:3] + all_items[-3:]: print(f"[S{it['season']}] {it['title']} | {it['cast']} | {it['synopsis'][:80]}… | note={it['note'][:60]}")
