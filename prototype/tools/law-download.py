"""lootandwaifus.com 트릭컬 캐릭터 페이지에서 Spine 스탠딩 에셋(.skel/.atlas/png) 다운로드
출력: <out>/<Hero>/<Skin>.skel, <Skin>.atlas, <page>.png  + <out>/index.json
사용: python tools/law-download.py <out_dir> [--only alice,erpin]
"""
import json, os, re, sys, html, time, urllib.request

BASE = "https://lootandwaifus.com"
OUT = sys.argv[1]
only = sys.argv[sys.argv.index("--only") + 1].split(",") if "--only" in sys.argv else None
os.makedirs(OUT, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128"}

def get(url, binary=False):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                data = r.read()
                return data if binary else data.decode("utf-8", "ignore")
        except Exception as e:
            if attempt == 2: raise
            time.sleep(2)

page = get(f"{BASE}/trickcal-chibi-go-characters/")
links = sorted(set(re.findall(r'href="(/character/[^"]*-trickcal)"', page)))
print("characters:", len(links))
index = json.load(open(os.path.join(OUT, "index.json"), encoding="utf-8")) if os.path.exists(os.path.join(OUT, "index.json")) else {}
for link in links:
    slug = link.split("/")[-1].replace("-trickcal", "")
    if only and slug not in only: continue
    if slug in index and index[slug].get("done"): continue
    h = get(BASE + link)
    m = re.search(r'(\[\{&#34;id&#34;:&#34;base&#34;.*?\}\])', h)
    if not m:
        print("no spine:", slug); index[slug] = {"done": True, "skins": []}; continue
    skins = json.loads(html.unescape(m.group(1)))
    name = re.search(r'data-character-name="([^"]+)"', h)
    hero = skins[0]["skel"].split("/")[3]  # /l2d/trickcal/<Hero>/...
    hdir = os.path.join(OUT, hero); os.makedirs(hdir, exist_ok=True)
    rec = {"hero": hero, "name": (name.group(1).strip() if name else slug), "skins": []}
    for sk in skins:
        sid = sk["skel"].split("/")[-1].replace(".skel.asset", "")
        skel_p = os.path.join(hdir, sid + ".skel"); atlas_p = os.path.join(hdir, sid + ".atlas")
        if not os.path.exists(skel_p): open(skel_p, "wb").write(get(BASE + sk["skel"], True))
        if not os.path.exists(atlas_p): open(atlas_p, "wb").write(get(BASE + sk["atlas"], True))
        atlas_txt = open(atlas_p, encoding="utf-8", errors="ignore").read()
        pages = [l.strip() for l in atlas_txt.splitlines() if l.strip().lower().endswith(".png")]
        for p in pages:
            pp = os.path.join(hdir, p)
            if not os.path.exists(pp): open(pp, "wb").write(get(f"{BASE}/l2d/trickcal/{hero}/{p}", True))
        rec["skins"].append({"id": sk["id"], "label": sk.get("label", sk["id"]), "skel": os.path.relpath(skel_p, OUT), "atlas": os.path.relpath(atlas_p, OUT), "pages": pages})
    rec["done"] = True; index[slug] = rec
    json.dump(index, open(os.path.join(OUT, "index.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(slug, hero, rec["name"], len(rec["skins"]), "skins", flush=True)
print("done", len(index))
