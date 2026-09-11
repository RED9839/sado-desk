"""나무위키 트릭컬 캐릭터 문서 일괄 수집 (fetch-page.js 이용) → scratch/namu/pages/<title>.txt
사용: python tools/namu-fetch-all.py <out_dir>
대상: assets/names-ko.json 의 모든 사도 (기본 + 이격). 문서명 후보를 여러 개 시도:
  "이름", "이름(트릭컬 리바이브)", 이격은 "기본(트릭컬 리바이브)/변형", "기본/변형"
"""
import json, os, re, subprocess, sys, time
from urllib.parse import quote

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
names = json.load(open(os.path.join(ROOT, "assets", "names-ko.json"), encoding="utf-8"))
known = json.load(open(os.path.join(OUT, "..", "char_pages_all.json"), encoding="utf-8")) if os.path.exists(os.path.join(OUT, "..", "char_pages_all.json")) else []
env = dict(os.environ); env.pop("ELECTRON_RUN_AS_NODE", None)
electron = os.path.join(ROOT, "node_modules", "electron", "dist", "electron.exe")

def fetch(title, out):
    url = "https://namu.wiki/w/" + quote(title, safe="/()")
    r = subprocess.run([electron, os.path.join(HERE, "fetch-page.js"), "--", url, out, "body", "15000"], env=env, capture_output=True, text=True, timeout=120, encoding="utf-8", errors="ignore")
    txt = open(out, encoding="utf-8").read() if os.path.exists(out) else ""
    return txt

def candidates(ko):
    m = re.match(r"^(.+?)\((.+)\)$", ko)
    if m and m.group(1) in names["heroes"].values():  # 이격: 기본(변형)
        base, var = m.group(1), m.group(2)
        return [f"{base}(트릭컬 리바이브)/{var}", f"{base}/{var}", f"{base}({var})(트릭컬 리바이브)", ko]
    return [f"{ko}(트릭컬 리바이브)", ko]

results = {}
for hero, ko in sorted(names["heroes"].items()):
    if hero in ("Dummy",) or hero.startswith("Wisps"): continue
    safe = re.sub(r'[\\/:*?"<>|]', "_", ko)
    out = os.path.join(OUT, safe + ".txt")
    if os.path.exists(out) and os.path.getsize(out) > 3000:
        results[hero] = {"ko": ko, "file": out, "status": "cached"}; continue
    cands = candidates(ko)
    # 카테고리에서 본 문서명이 있으면 우선
    pri = [c for c in cands if c in known] + [c for c in cands if c not in known]
    status = "missing"
    for title in pri:
        txt = fetch(title, out)
        if "해당 문서를 찾을 수 없습니다" in txt or len(txt) < 1500:
            continue
        status = title; break
    results[hero] = {"ko": ko, "file": out, "status": status}
    print(hero, ko, "->", status, flush=True)
json.dump(results, open(os.path.join(OUT, "_results.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("done", sum(1 for r in results.values() if r["status"] != "missing"), "/", len(results))
