"""게임(뮤뮤) spine/standing/<name>/ 번들 → assets/standing/<name>/<Name>.skel/.atlas/.png (UnityPy)
사용: python tools/extract-standing.py <name> [<name> ...]   (뮤뮤 VM 켜져 있고 adb 연결된 상태)
"""
import os, subprocess, sys, tempfile
import UnityPy

ADB = r"C:\Program Files\Netease\MuMuPlayer\nx_main\adb.exe"
DEV = "127.0.0.1:16384"
P = "/sdcard/Android/data/com.epidgames.trickcalrevive/files/Packages/spine/standing"
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
env = dict(os.environ); env["MSYS_NO_PATHCONV"] = "1"

def text(env_):
    for o in env_.objects:
        if o.type.name == "TextAsset":
            d = o.read(); r = d.m_Script
            return r if isinstance(r, bytes) else r.encode("utf-8", "surrogateescape")

for name in sys.argv[1:]:
    out = os.path.join(ROOT, "assets", "standing", name); os.makedirs(out, exist_ok=True)
    tmp = tempfile.mkdtemp()
    subprocess.run([ADB, "-s", DEV, "pull", f"{P}/{name}", tmp], env=env, capture_output=True)
    src = os.path.join(tmp, name)
    files = os.listdir(src) if os.path.isdir(src) else []
    got = {}
    for f in files:
        p = os.path.join(src, f)
        if f.endswith(".skel"): open(os.path.join(out, f), "wb").write(text(UnityPy.load(p))); got["skel"] = f
        elif f.endswith(".atlas"):
            atlas = text(UnityPy.load(p)); open(os.path.join(out, f), "wb").write(atlas); got["atlas"] = f
            got["pages"] = [l.strip() for l in atlas.decode("utf-8", "ignore").splitlines() if l.strip().lower().endswith(".png")]
        elif f == name:  # 텍스처 번들 (확장자 없음)
            for o in UnityPy.load(p).objects:
                if o.type.name == "Texture2D":
                    d = o.read(); got.setdefault("tex", []).append((d.m_Name, d.image))
    # 아틀라스가 참조하는 페이지 이름으로 PNG 저장 (대소문자 맞춰서)
    for pg in got.get("pages", []):
        stem = pg[:-4].lower()
        for tname, img in got.get("tex", []):
            if tname.lower() == stem: img.save(os.path.join(out, pg))
    print(name, "->", got.get("skel"), got.get("atlas"), got.get("pages"), "tex:", [t for t, _ in got.get("tex", [])], flush=True)
