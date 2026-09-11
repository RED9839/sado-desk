"""게임 spine/ingame/hero/<name>/ 번들(tar로 뽑은 것) → assets/ingame/<name>/<Name>.skel/.atlas/.png
사용: python tools/extract-ingame.py <ingame_hero.tar>
"""
import os, sys, tarfile, tempfile, json
import UnityPy
from concurrent.futures import ProcessPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "assets", "ingame")

def text(env):
    for o in env.objects:
        if o.type.name == "TextAsset":
            r = o.read().m_Script
            return r if isinstance(r, bytes) else r.encode("utf-8", "surrogateescape")

def convert(args):
    src, name = args
    out = os.path.join(OUT, name); os.makedirs(out, exist_ok=True)
    got = {"skel": None, "atlas": None, "pages": [], "tex": []}
    for f in os.listdir(src):
        p = os.path.join(src, f)
        try:
            if f.endswith(".skel"): open(os.path.join(out, f), "wb").write(text(UnityPy.load(p))); got["skel"] = f
            elif f.endswith(".atlas"):
                atlas = text(UnityPy.load(p)); open(os.path.join(out, f), "wb").write(atlas); got["atlas"] = f
                got["pages"] = [l.strip() for l in atlas.decode("utf-8", "ignore").splitlines() if l.strip().lower().endswith(".png")]
            elif "_" not in f and "." not in f:  # 텍스처 번들 (예: alice, 여러 페이지면 alice_2?) — 확장자/밑줄 없는 파일
                for o in UnityPy.load(p).objects:
                    if o.type.name == "Texture2D":
                        d = o.read(); got["tex"].append((d.m_Name, d.image))
        except Exception as e:
            return name, f"ERR {f}: {e}"
    for pg in got["pages"]:
        for tname, img in got["tex"]:
            if tname.lower() == pg[:-4].lower(): img.save(os.path.join(out, pg))
    ok = got["skel"] and got["atlas"] and all(os.path.exists(os.path.join(out, pg)) for pg in got["pages"])
    return name, "ok" if ok else f"incomplete skel={got['skel']} atlas={got['atlas']} pages={got['pages']} tex={[t for t,_ in got['tex']]}"

def main():
    tmp = tempfile.mkdtemp()
    with tarfile.open(sys.argv[1]) as t: t.extractall(tmp)
    root = os.path.join(tmp, "hero")
    jobs = [(os.path.join(root, n), n) for n in sorted(os.listdir(root)) if os.path.isdir(os.path.join(root, n))]
    print("sets:", len(jobs))
    stats = {}
    with ProcessPoolExecutor(max_workers=os.cpu_count() or 4) as ex:
        for name, st in ex.map(convert, jobs, chunksize=8):
            stats[st.split(" ")[0]] = stats.get(st.split(" ")[0], 0) + 1
            if st != "ok": print(name, st)
    print("done", stats)

if __name__ == "__main__":
    main()
