# -*- coding: utf-8 -*-
"""나무위키 테마극장 문서(fetch-page.js로 받은 텍스트) → data/theaters.json
입력: <dir>/theater.txt (시즌 3 본문), theater-s1.txt, theater-s2.txt
항목: {season, title, cast[], castKeys[], synopsis} — cast 는 '주연:' 줄
synopsis 는 위키 문장을 옮기지 않는다. v0.11.9 부터 우리가 직접 쓴 요약만 넣는다.
  · 이미 data/theaters.json 에 있는 편은 그 요약을 그대로 살린다(이 도구가 덮어쓰지 않는다)
  · 새로 나온 편은 synopsis 를 비워 두고, 위키 문단은 out/_theater-new.txt 로만 빼 둔다 → 사람이 읽고 다시 쓴다
기간·위키 편집자 해설(note)은 앱이 읽지 않고 스포일러·원문 그대로라 만들지 않는다.
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
        wiki = ""   # 위키 문단 — 배포 데이터에는 넣지 않고 새 편을 알아보는 데만 쓴다
        for p in paras:
            if p.startswith("이벤트 기간") or p.startswith("기타 언어"): continue
            if re.match(r"^\d{4}년", p) or re.match(r"^\d+/10", p): continue  # 기간·작중 가짜 리뷰
            if len(p) > 10: wiki = p; break
        items.append({"season": season, "title": title.strip(), "cast": cast,
                      "castKeys": [KO2KEY.get(c) for c in cast if KO2KEY.get(c)],
                      "synopsis": "", "_wiki": wiki[:300]})
    return items

all_items = []
for fn, season in (("theater-s1.txt", 1), ("theater-s2.txt", 2), ("theater.txt", 3)):
    p = os.path.join(SRC, fn)
    if not os.path.exists(p): print("없음", p); continue
    items = parse(open(p, encoding="utf-8", errors="ignore").read(), season)
    print(f"season {season}: {len(items)}개")
    all_items += items
# 이미 써 둔 우리 요약을 살린다 — 덮어쓰면 v0.11.9 에서 한 일이 통째로 날아간다
old = {}
if os.path.exists(OUT):
    for it in json.load(open(OUT, encoding="utf-8")).get("items", []):
        old[(it["season"], it["title"])] = it.get("synopsis") or ""
fresh = []
for it in all_items:
    it["synopsis"] = old.get((it["season"], it["title"]), "")
    if not it["synopsis"] and it["_wiki"]: fresh.append(dict(it))
    del it["_wiki"]
json.dump({"source": "나무위키 트릭컬 리바이브/스토리/테마극장 (CC BY-NC-SA 2.0 KR)", "items": all_items},
          open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("->", OUT, len(all_items), "pcs / synopsis", sum(1 for it in all_items if it["synopsis"]))
if fresh:
    os.makedirs("out", exist_ok=True)
    with open("out/_theater-new.txt", "w", encoding="utf-8", newline="\n") as f:
        for it in fresh:
            f.write("[S%s] %s\n  cast: %s\n  wiki: %s\n\n" % (it["season"], it["title"], ", ".join(it["cast"]), it["_wiki"]))
    print("synopsis blank:", len(fresh), "-> out/_theater-new.txt")
