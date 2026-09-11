"""게임에서 뽑은 사도 보이스 AssetBundle → ogg/opus + index.json
입력: <raw_dir>/<hero>/voice_<hero>_<key>   (Unity AssetBundle, AudioClip 1개)
출력: assets/voice/<hero>/<key>.ogg, assets/voice/index.json
사용: python tools/build-voices.py <raw_dir>
"""
import json, os, re, subprocess, sys
from concurrent.futures import ProcessPoolExecutor

RAW = sys.argv[1]
OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "voice")
FFMPEG = None


def ffmpeg_exe():
    global FFMPEG
    if FFMPEG is None:
        import imageio_ffmpeg
        FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
    return FFMPEG


def convert(args):
    src, dst = args
    if os.path.exists(dst):
        return dst, "skip"
    import UnityPy
    env = UnityPy.load(src)
    for o in env.objects:
        if o.type.name != "AudioClip":
            continue
        clip = o.read()
        for _name, wav in clip.samples.items():
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            p = subprocess.run([ffmpeg_exe(), "-loglevel", "error", "-y", "-i", "pipe:0", "-c:a", "libopus", "-b:a", "40k", "-vbr", "on", dst],
                               input=wav, capture_output=True)
            return dst, ("ok" if p.returncode == 0 else "ffmpeg:" + p.stderr.decode(errors="ignore")[:200])
    return dst, "noclip"


KEY_RE = re.compile(r"^([a-z]+?)(\d[\d_]*)?(?:_(skin\d+))?$")


def main():
    jobs = []
    for hero in sorted(os.listdir(RAW)):
        hdir = os.path.join(RAW, hero)
        if not os.path.isdir(hdir):
            continue
        for fn in os.listdir(hdir):
            m = re.match(r"^voice_([a-z0-9]+)_(.+)$", fn)
            if not m:
                continue
            # 폴더명과 접두어가 다른 파일: 변형 캐릭터 폴더가 기본 캐릭터 대사를 공유하는 경우(kommyswim ← voice_kommy_*)만 포함.
            # 반대(uros 폴더 안의 voice_uroswicked_*)는 다른 형태의 대사이므로 제외.
            if m.group(1) != hero and not hero.startswith(m.group(1)):
                continue
            key = m.group(2)
            jobs.append((os.path.join(hdir, fn), os.path.join(OUT, hero, key + ".ogg")))
    print("files:", len(jobs))
    stats = {}
    with ProcessPoolExecutor(max_workers=os.cpu_count() or 4) as ex:
        for i, (dst, st) in enumerate(ex.map(convert, jobs, chunksize=16)):
            k = st.split(":")[0]
            stats[k] = stats.get(k, 0) + 1
            if st.startswith("ffmpeg") and stats[k] <= 3:
                print(dst, st)
            if i % 500 == 0:
                print(i, stats)
    print("done", stats)

    # index.json: hero → skin("base"|"skin1"...) → category → [file, ...]
    index = {}
    for hero in sorted(os.listdir(OUT)):
        hdir = os.path.join(OUT, hero)
        if not os.path.isdir(hdir):
            continue
        for fn in sorted(os.listdir(hdir)):
            if not fn.endswith(".ogg"):
                continue
            key = fn[:-4]
            mm = KEY_RE.match(key)
            if not mm:
                print("unparsed key", hero, key)
                continue
            cat, _var, skin = mm.group(1), mm.group(2), mm.group(3) or "base"
            index.setdefault(hero, {}).setdefault(skin, {}).setdefault(cat, []).append(f"{hero}/{fn}")
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, separators=(",", ":"))
    total = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(OUT) for f in fs)
    print(f"index: {len(index)} heroes, total {total/1e6:.1f} MB")


if __name__ == "__main__":
    main()
