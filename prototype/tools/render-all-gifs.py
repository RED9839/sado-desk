"""assets/standing-hd/index.json(사이트 에셋) + 게임 추출 스탠딩(크레페)으로 캐릭터별 GIF 일괄 생성
출력: out/gif/<한글이름>/<스킨>_<애니>.gif
사용: python tools/render-all-gifs.py [--anim Idle_1] [--skins base|all] [--size 480] [--fps 24] [--only alice,erpin] [--all-anims]
"""
import json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
arg = lambda k, d=None: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
anim, skins_mode, size, fps = arg("--anim", "Idle_1"), arg("--skins", "base"), arg("--size", "480"), arg("--fps", "24")
only = arg("--only", "").split(",") if "--only" in sys.argv else None
names = json.load(open(os.path.join(ROOT, "assets", "names-ko.json"), encoding="utf-8"))
index = json.load(open(os.path.join(ROOT, "assets", "standing-hd", "index.json"), encoding="utf-8"))
env = dict(os.environ); env.pop("ELECTRON_RUN_AS_NODE", None)
electron = os.path.join(ROOT, "node_modules", "electron", "dist", "electron.exe")
OUT = os.path.join(ROOT, "out", "gif")

HERO_CI = {k.lower(): k for k in names["heroes"]}  # 사이트 폴더명 대소문자 차이(Bigwood) 흡수
def canon(hero): return HERO_CI.get(hero.lower(), hero)
def ko_name(hero_id):  # 사이트 폴더명(Alice, AmeliaR41, xXionx…) → 한글
    m = re.match(r"^(.*?)(Skin(\d+))?$", hero_id)
    base, skin = canon(m.group(1)), m.group(3)
    ko = names["heroes"].get(base, base)
    if skin: ko += " · " + names["skins"].get(base, {}).get(skin, f"스킨 {skin}")
    return ko

jobs = []
for slug, rec in sorted(index.items()):
    if only and slug not in only: continue
    for sk in rec.get("skins", []):
        if skins_mode == "base" and sk["id"] != "base": continue
        sid = os.path.basename(sk["skel"]).replace(".skel", "")
        jobs.append((names["heroes"].get(canon(rec["hero"]), rec["hero"]), ko_name(sid), os.path.join(ROOT, "assets", "standing-hd", sk["skel"]), os.path.join(ROOT, "assets", "standing-hd", sk["atlas"])))
# 게임 추출본 (사이트에 Spine이 없는 캐릭터 + 크레페): assets/standing/<name>/<name>.skel  (tools/extract-standing.py)
GAME = {"crepe": "Crepe", "ameliar41": "AmeliaR41", "arnet": "Arnet", "ashurmagi": "AshurMagi", "eisia": "Eisia", "benibeni": "BeniBeni", "scizor": "Scizor",
        "dayapureshine": "DayaPureShine", "dianayester": "DianaYester", "edrehab": "EdRehab", "erpinroyale": "ErpinRoyale", "guin": "Guin", "haleysane": "HaleySane",
        "joanne": "Joanne", "kommyswim": "KommySwim", "cuee": "Cuee", "lazy": "Lazy", "lion": "Lion", "levigraduate": "LeviGraduate", "mayocool": "MayoCool",
        "nerrage": "NerRage", "laika": "Laika", "renewaawaken": "RenewaAwaken", "ricota": "Ricota", "rimchaos": "RimChaos", "rohnemayor": "RohneMayor", "rude": "Rude",
        "selline": "Selline", "shady": "Shady", "shadytwisted": "ShadyTwisted", "suro": "Suro", "speakimaid": "SpeakiMaid", "tighero": "TigHero"}
site_heroes = {canon(r["hero"]) for r in index.values() if r.get("skins")}
for folder, hero in GAME.items():
    if hero in site_heroes: continue
    if only and folder not in only: continue
    skel = os.path.join(ROOT, "assets", "standing", folder, f"{folder}.skel")
    atlas = skel.replace(".skel", ".atlas")
    if os.path.exists(skel): jobs.append((names["heroes"].get(hero, hero), names["heroes"].get(hero, hero), skel, atlas))

print("jobs:", len(jobs))
for hero_ko, label, skel, atlas in jobs:
    safe = re.sub(r'[\\/:*?"<>|]', "_", label)
    if "--all-anims" in sys.argv:
        out = os.path.join(OUT, re.sub(r'[\\/:*?"<>|]', "_", hero_ko), safe)
        cmd = [electron, os.path.join(HERE, "render-gif.js"), "--", skel, atlas, out, "--all-anims", "--fps", fps, "--size", size]
    else:
        out = os.path.join(OUT, re.sub(r'[\\/:*?"<>|]', "_", hero_ko), f"{safe}_{anim}.gif")
        if os.path.exists(out): print("skip", out); continue
        cmd = [electron, os.path.join(HERE, "render-gif.js"), "--", skel, atlas, out, "--anim", anim, "--fps", fps, "--size", size]
    r = subprocess.run(cmd, env=env, capture_output=True, text=True, encoding="utf-8", errors="ignore", timeout=600)
    lines = [l for l in (r.stdout + r.stderr).splitlines() if l.startswith(("GIF", "ERR"))]
    print(label, "|", " / ".join(lines) if lines else f"exit {r.returncode}", flush=True)
print("done")
