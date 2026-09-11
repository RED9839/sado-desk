# -*- coding: utf-8 -*-
"""사도 데스크 에셋 추출기 — 사용자 PC의 뮤뮤 앱플레이어에 설치된 트릭컬 리바이브에서 미니미·스탠딩·인게임 SD·효과음·로비 보이스를 꺼내
앱이 읽는 형태(assets/)로 저장한다. 게임 파일은 암호화되지 않은 표준 Unity AssetBundle이라 UnityPy로 그대로 읽는다(보호장치 해제 없음).
게임 서버·실행 중인 게임과는 통신하지 않고, 에뮬레이터 저장소의 파일을 adb로 복사만 한다. 추출물은 개인 사용 목적으로만.

사용: python tools/extract-all.py --out <assets 폴더> [--steps minimi,sfx,standing,ingame,voice] [--mumu "C:\\Program Files\\Netease\\MuMuPlayer"] [--vm 0] [--json]
  --json  진행 상황을 한 줄 JSON으로 출력(앱 UI가 읽음): {"step":..,"msg":..,"done":n,"total":n,"level":"info|warn|error|ok"}
필요 패키지: UnityPy(texture2ddecoder 포함), Pillow, imageio-ffmpeg(보이스 opus 변환)
"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile, time, glob
from concurrent.futures import ProcessPoolExecutor

PKG = "com.epidgames.trickcalrevive"
BASE = f"/sdcard/Android/data/{PKG}/files/Packages"
VOICE_CATS = ("touch", "joy", "pleasure", "anger", "sorrow", "sorry", "surprise", "eat", "greeting", "spawn", "line", "ticklestart", "tickleduring", "dutchrubend")
ENV = dict(os.environ); ENV["MSYS_NO_PATHCONV"] = "1"
JSON = False

def log(step, msg, level="info", done=None, total=None):
    if JSON:
        o = {"step": step, "msg": msg, "level": level}
        if done is not None: o["done"] = done
        if total is not None: o["total"] = total
        print(json.dumps(o, ensure_ascii=False), flush=True)
    else:
        print(f"[{step}] {msg}" + (f" ({done}/{total})" if done is not None else ""), flush=True)

# ---------- 뮤뮤 / adb ----------
def find_mumu(hint=None):
    cands = [hint] if hint else []
    cands += [r"C:\Program Files\Netease\MuMuPlayer", r"C:\Program Files\Netease\MuMu Player 12", r"C:\Program Files (x86)\Netease\MuMuPlayer", r"D:\Program Files\Netease\MuMuPlayer"]
    for base in cands:
        if not base: continue
        for sub in ("nx_main", "shell", ""):
            d = os.path.join(base, sub) if sub else base
            if os.path.exists(os.path.join(d, "adb.exe")) and os.path.exists(os.path.join(d, "MuMuManager.exe")): return d
    # 실행 중인 MuMuPlayer 프로세스 경로로 찾기
    try:
        out = subprocess.run(["powershell", "-NoProfile", "-Command", "(Get-Process MuMuPlayer,MuMuNxDevice,MuMuManager -ErrorAction SilentlyContinue | Select-Object -First 1).Path"], capture_output=True, text=True, timeout=15).stdout.strip()
        if out:
            d = os.path.dirname(out)
            for cand in (d, os.path.join(os.path.dirname(d), "nx_main")):
                if os.path.exists(os.path.join(cand, "adb.exe")): return cand
    except Exception: pass
    return None

def mumu_json(mm, *args):
    p = subprocess.run([mm, *args], capture_output=True, text=True, timeout=60)
    try: return json.loads(p.stdout)
    except Exception: return {"raw": p.stdout, "err": p.stderr}

def ensure_vm(mmdir, vm):
    mm = os.path.join(mmdir, "MuMuManager.exe")
    info = mumu_json(mm, "info", "-v", str(vm))
    if not info.get("is_android_started"):
        log("adb", "뮤뮤 앱플레이어를 켜는 중… (안드로이드 부팅까지 30초~1분)")
        subprocess.run([mm, "control", "-v", str(vm), "launch"], capture_output=True, timeout=60)
        for _ in range(60):
            time.sleep(3)
            info = mumu_json(mm, "info", "-v", str(vm))
            if info.get("is_android_started"): break
        else: raise RuntimeError("뮤뮤 안드로이드가 3분 안에 켜지지 않았어요. 뮤뮤를 직접 켠 뒤 다시 시도해 주세요.")
    a = mumu_json(mm, "adb", "-v", str(vm))
    host, port = a.get("adb_host", "127.0.0.1"), a.get("adb_port")
    if not port: raise RuntimeError(f"adb 포트를 알 수 없어요: {a}")
    return f"{host}:{port}"

def adb(adb_exe, dev, *args, timeout=600):
    return subprocess.run([adb_exe, "-s", dev, *args], env=ENV, capture_output=True, timeout=timeout)

def adb_connect(adb_exe, dev):
    subprocess.run([adb_exe, "connect", dev], env=ENV, capture_output=True, timeout=30)
    for _ in range(10):
        p = adb(adb_exe, dev, "shell", "echo ok", timeout=20)
        if p.returncode == 0 and b"ok" in p.stdout: return
        time.sleep(1)
    raise RuntimeError(f"adb로 {dev}에 연결하지 못했어요.")

def adb_ls(adb_exe, dev, path):
    p = adb(adb_exe, dev, "shell", f"ls -1 {path}", timeout=60)
    if p.returncode != 0: return []
    return [l.strip() for l in p.stdout.decode("utf-8", "ignore").splitlines() if l.strip()]

def adb_pull(adb_exe, dev, remote, local):
    os.makedirs(os.path.dirname(local) or ".", exist_ok=True)
    p = adb(adb_exe, dev, "pull", remote, local, timeout=3600)
    if p.returncode != 0: raise RuntimeError(f"adb pull 실패 {remote}: {p.stderr.decode('utf-8', 'ignore')[:200]}")

# ---------- UnityPy 디코드 ----------
def text_asset(path):
    import UnityPy
    for o in UnityPy.load(path).objects:
        if o.type.name == "TextAsset":
            r = o.read().m_Script
            return r if isinstance(r, bytes) else r.encode("utf-8", "surrogateescape")
    return None

def textures(path):
    import UnityPy
    out = []
    for o in UnityPy.load(path).objects:
        if o.type.name == "Texture2D":
            d = o.read(); out.append((d.m_Name, d.image))
    return out

def decode_spine_dir(src, out, tex_pick):
    """src 폴더(번들들) → out/<stem>.skel|.atlas|<page>.png. tex_pick(f) = 텍스처 번들인지"""
    os.makedirs(out, exist_ok=True)
    got = {"skel": None, "atlas": None, "pages": [], "tex": []}
    for f in sorted(os.listdir(src)):
        p = os.path.join(src, f)
        if os.path.isdir(p): continue
        if f.endswith(".skel"):
            b = text_asset(p)
            if b: open(os.path.join(out, f), "wb").write(b); got["skel"] = f
        elif f.endswith(".atlas"):
            b = text_asset(p)
            if b:
                open(os.path.join(out, f), "wb").write(b); got["atlas"] = f
                got["pages"] = [l.strip() for l in b.decode("utf-8", "ignore").splitlines() if l.strip().lower().endswith(".png")]
        elif tex_pick(f):
            try: got["tex"] += textures(p)
            except Exception as e: got.setdefault("err", []).append(f"{f}: {e}")
    for pg in got["pages"]:
        for tname, img in got["tex"]:
            if tname.lower() == pg[:-4].lower(): img.save(os.path.join(out, pg))
    ok = got["skel"] and got["atlas"] and all(os.path.exists(os.path.join(out, pg)) for pg in got["pages"])
    return ok, got

def _spine_job(args):
    src, out, kind = args
    try:
        ok, got = decode_spine_dir(src, out, (lambda f: "." not in f and "_" not in f) if kind == "ingame" else (lambda f: "." not in f and not f.endswith(("_atlas", "_material", "_skeletondata", "_standing"))))
        return os.path.basename(src), ok, (None if ok else f"skel={got['skel']} atlas={got['atlas']} pages={got['pages']} tex={[t for t, _ in got['tex']]} {got.get('err', '')}")
    except Exception as e:
        return os.path.basename(src), False, str(e)

# ---------- 단계 ----------
def step_minimi(adb_exe, dev, out, tmp):
    log("minimi", "미니미(스틱 SD) 스켈레톤·아틀라스·텍스처 3장 복사 중…")
    src = os.path.join(tmp, "minimi")
    for f in ("minimi.skel", "minimi.atlas", "minimi", "minimi_2", "minimi_3"): adb_pull(adb_exe, dev, f"{BASE}/spine/minimi/{f}", os.path.join(src, f))
    ok, got = decode_spine_dir(src, os.path.join(out, "minimi"), lambda f: f in ("minimi", "minimi_2", "minimi_3"))
    if not ok: raise RuntimeError(f"미니미 디코드 실패: {got}")
    log("minimi", f"미니미 완료 — 텍스처 {len(got['pages'])}장", "ok")

def step_sfx(adb_exe, dev, out, tmp):
    import UnityPy
    log("sfx", "효과음(점프) 2개 복사 중…")
    os.makedirs(os.path.join(out, "sfx"), exist_ok=True)
    for n in ("sfx_minimi_jump01", "sfx_minimi_jump02"):
        local = os.path.join(tmp, "sfx", n); adb_pull(adb_exe, dev, f"{BASE}/audio/sfx/{n}", local)
        for o in UnityPy.load(local).objects:
            if o.type.name == "AudioClip":
                for _name, wav in o.read().samples.items():
                    open(os.path.join(out, "sfx", n.replace("sfx_minimi_", "") + ".wav"), "wb").write(wav); break
    log("sfx", "효과음 완료", "ok")

def step_spine_sets(kind, remote, adb_exe, dev, out, tmp):
    label = {"standing": "스탠딩(사도 상세 화면 SD)", "ingame": "인게임 SD(전투·마이홈)"}[kind]
    names = [n for n in adb_ls(adb_exe, dev, remote) if re.match(r"^[a-z0-9_]+$", n)]
    if not names: log(kind, f"{label}: 기기에 내려받힌 것이 없어요 (게임에서 사도 상세를 열면 다운로드됨)", "warn"); return
    log(kind, f"{label} {len(names)}세트 복사 중… (몇 분 걸릴 수 있어요)", total=len(names), done=0)
    local = os.path.join(tmp, kind)
    adb_pull(adb_exe, dev, remote, local)  # 폴더 통째로 (파일별 pull보다 훨씬 빠름)
    root = local if os.path.isdir(os.path.join(local, names[0])) else os.path.join(local, os.path.basename(remote))
    jobs = [(os.path.join(root, n), os.path.join(out, kind, n), kind) for n in names if os.path.isdir(os.path.join(root, n))]
    log(kind, f"{label} 디코드 중…", total=len(jobs), done=0)
    okn = 0; bad = []
    with ProcessPoolExecutor(max_workers=max(1, (os.cpu_count() or 4) - 1)) as ex:
        for i, (name, ok, err) in enumerate(ex.map(_spine_job, jobs, chunksize=4), 1):
            if ok: okn += 1
            else: bad.append(f"{name}: {err}")
            if i % 10 == 0 or i == len(jobs): log(kind, f"{label} 디코드 {i}/{len(jobs)}", done=i, total=len(jobs))
    for b in bad[:10]: log(kind, "실패 " + b, "warn")
    log(kind, f"{label} 완료 — {okn}세트" + (f", 실패 {len(bad)}" if bad else ""), "ok")

def _voice_job(args):
    src, dst, ffmpeg = args
    if os.path.exists(dst): return "skip"
    try:
        import UnityPy
        for o in UnityPy.load(src).objects:
            if o.type.name != "AudioClip": continue
            for _name, wav in o.read().samples.items():
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                p = subprocess.run([ffmpeg, "-loglevel", "error", "-y", "-i", "pipe:0", "-c:a", "libopus", "-b:a", "40k", "-vbr", "on", dst], input=wav, capture_output=True)
                return "ok" if p.returncode == 0 else "ffmpeg"
        return "noclip"
    except Exception as e:
        return "err:" + str(e)[:80]

KEY_RE = re.compile(r"^([a-z]+?)(\d[\d_]*)?(?:_(skin\d+))?$")
def step_voice(adb_exe, dev, out, tmp):
    import imageio_ffmpeg
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    heroes = [h for h in adb_ls(adb_exe, dev, f"{BASE}/audio/kor/voice/hero") if re.match(r"^[a-z0-9_]+$", h)]
    log("voice", f"보이스: 사도 {len(heroes)}명 폴더에서 로비 대사만 골라 복사 중… (터치·감정·인사·등장·잡담·간지럽히기·꿀밤)", total=len(heroes), done=0)
    cat_re = re.compile(r"^voice_([a-z0-9]+)_(" + "|".join(VOICE_CATS) + r")(\d[\d_]*)?(_skin\d+)?$")
    jobs = []
    for i, h in enumerate(heroes, 1):
        files = [f for f in adb_ls(adb_exe, dev, f"{BASE}/audio/kor/voice/hero/{h}") if cat_re.match(f) and "_selective_" not in f]
        # 폴더명과 접두어가 다른 파일: 변형 폴더가 기본 대사를 공유하는 경우(kommyswim ← voice_kommy_*)만
        files = [f for f in files if cat_re.match(f).group(1) == h or h.startswith(cat_re.match(f).group(1))]
        if not files: continue
        local = os.path.join(tmp, "voice", h)
        # 파일 단위 pull은 느리므로 폴더를 통째로 받고 필요한 것만 변환
        adb_pull(adb_exe, dev, f"{BASE}/audio/kor/voice/hero/{h}", os.path.join(tmp, "voice"))
        for f in files:
            m = re.match(r"^voice_[a-z0-9]+_(.+)$", f)
            jobs.append((os.path.join(local, f), os.path.join(out, "voice", h, m.group(1) + ".ogg"), ffmpeg))
        if i % 5 == 0 or i == len(heroes): log("voice", f"보이스 복사 {i}/{len(heroes)}", done=i, total=len(heroes))
    log("voice", f"보이스 {len(jobs)}개 opus 변환 중…", total=len(jobs), done=0)
    stats = {}
    with ProcessPoolExecutor(max_workers=max(1, (os.cpu_count() or 4) - 1)) as ex:
        for i, st in enumerate(ex.map(_voice_job, jobs, chunksize=16), 1):
            k = st.split(":")[0]; stats[k] = stats.get(k, 0) + 1
            if i % 200 == 0 or i == len(jobs): log("voice", f"보이스 변환 {i}/{len(jobs)}", done=i, total=len(jobs))
    build_voice_index(os.path.join(out, "voice"))
    log("voice", f"보이스 완료 — {stats}", "ok")

def build_voice_index(vdir):
    index = {}
    if not os.path.isdir(vdir): return
    for hero in sorted(os.listdir(vdir)):
        hdir = os.path.join(vdir, hero)
        if not os.path.isdir(hdir): continue
        for fn in sorted(os.listdir(hdir)):
            if not fn.endswith(".ogg"): continue
            mm = KEY_RE.match(fn[:-4])
            if not mm: continue
            cat, _var, skin = mm.group(1), mm.group(2), mm.group(3) or "base"
            index.setdefault(hero, {}).setdefault(skin, {}).setdefault(cat, []).append(f"{hero}/{fn}")
    json.dump(index, open(os.path.join(vdir, "index.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

def main():
    global JSON
    try: sys.stdout.reconfigure(encoding="utf-8"); sys.stderr.reconfigure(encoding="utf-8")
    except Exception: pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True); ap.add_argument("--steps", default="minimi,sfx,standing,ingame,voice")
    ap.add_argument("--mumu", default=None); ap.add_argument("--vm", default="0"); ap.add_argument("--json", action="store_true"); ap.add_argument("--keep-tmp", action="store_true")
    a = ap.parse_args(); JSON = a.json
    steps = [s.strip() for s in a.steps.split(",") if s.strip()]
    out = os.path.abspath(a.out); os.makedirs(out, exist_ok=True)
    try:
        import UnityPy  # noqa
    except ImportError:
        log("setup", "UnityPy가 없어요. pip install UnityPy Pillow imageio-ffmpeg", "error"); sys.exit(2)
    mmdir = find_mumu(a.mumu)
    if not mmdir: log("adb", "뮤뮤 앱플레이어를 찾지 못했어요. 설치 폴더(MuMuManager.exe·adb.exe가 있는 nx_main)를 지정해 주세요.", "error"); sys.exit(3)
    log("adb", f"뮤뮤: {mmdir}")
    try:
        dev = ensure_vm(mmdir, a.vm)
        adb_exe = os.path.join(mmdir, "adb.exe")
        adb_connect(adb_exe, dev)
        if not adb_ls(adb_exe, dev, f"{BASE}/spine"):
            log("adb", f"뮤뮤 안에 트릭컬 리바이브 데이터가 없어요 ({BASE}). 게임을 한 번 실행해 리소스를 내려받은 뒤 다시 시도해 주세요.", "error"); sys.exit(4)
        log("adb", f"연결됨 {dev}", "ok")
    except Exception as e:
        log("adb", str(e), "error"); sys.exit(3)
    tmp = tempfile.mkdtemp(prefix="sadodesk-")
    try:
        if "minimi" in steps: step_minimi(adb_exe, dev, out, tmp)
        if "sfx" in steps: step_sfx(adb_exe, dev, out, tmp)
        if "standing" in steps: step_spine_sets("standing", f"{BASE}/spine/standing", adb_exe, dev, out, tmp)
        if "ingame" in steps: step_spine_sets("ingame", f"{BASE}/spine/ingame/hero", adb_exe, dev, out, tmp)
        if "voice" in steps: step_voice(adb_exe, dev, out, tmp)
        log("done", f"완료 — {out}", "ok")
    except Exception as e:
        log("error", str(e), "error"); sys.exit(1)
    finally:
        if not a.keep_tmp: shutil.rmtree(tmp, ignore_errors=True)

if __name__ == "__main__":
    main()
