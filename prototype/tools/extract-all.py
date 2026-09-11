# -*- coding: utf-8 -*-
"""사도 데스크 에셋 추출기 — 사용자 PC의 뮤뮤 앱플레이어에 설치된 트릭컬 리바이브에서 미니미·스탠딩·인게임 SD·효과음·로비 보이스를 꺼내
앱이 읽는 형태(assets/)로 저장한다. 게임 파일은 암호화되지 않은 표준 Unity AssetBundle이라 UnityPy로 그대로 읽는다(보호장치 해제 없음).
게임 서버·실행 중인 게임과는 통신하지 않고, 에뮬레이터 저장소의 파일을 adb로 복사만 한다. 추출물은 개인 사용 목적으로만.

지원 앱플레이어: 뮤뮤 12(꺼져 있으면 자동 실행)·뮤뮤 구버전·LD플레이어(ldconsole 경유, 포트 충돌 무관)·블루스택 4/5(설정에서 ADB 켜기), 그 외 adb가 붙는 기기.
사용: python tools/extract-all.py --out <assets 폴더> [--steps minimi,sfx,standing,ingame,voice] [--adb <adb.exe> --serial 127.0.0.1:5555] [--mumu <뮤뮤 폴더>] [--json]
      python tools/extract-all.py --list-devices --json   # 붙을 수 있는 기기 목록
  --json  진행 상황을 한 줄 JSON으로 출력(앱 UI가 읽음): {"step":..,"msg":..,"done":n,"total":n,"level":"info|warn|error|ok"}
필요 패키지: UnityPy(texture2ddecoder 포함), Pillow, imageio-ffmpeg(보이스 opus 변환)
"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile, time, glob, io as _io, zipfile, urllib.request
from concurrent.futures import ProcessPoolExecutor

PKG = "com.epidgames.trickcalrevive"
BASE = f"/sdcard/Android/data/{PKG}/files/Packages"
VOICE_CATS = ("touch", "joy", "pleasure", "anger", "sorrow", "sorry", "surprise", "eat", "greeting", "spawn", "line", "ticklestart", "tickleduring", "dutchrubend")
ENV = dict(os.environ); ENV["MSYS_NO_PATHCONV"] = "1"
JSON = False
FORCE = False  # --force: 이미 있는 것도 다시 받기
FAILED = False  # 단계 중 하나가 통째로 실패 → 종료 코드 7

def log(step, msg, level="info", done=None, total=None):
    if JSON:
        o = {"step": step, "msg": msg, "level": level}
        if done is not None: o["done"] = done
        if total is not None: o["total"] = total
        print(json.dumps(o, ensure_ascii=False), flush=True)
    else:
        print(f"[{step}] {msg}" + (f" ({done}/{total})" if done is not None else ""), flush=True)

# ---------- 앱플레이어 감지 (뮤뮤·LD플레이어·블루스택·녹스·기타 adb) ----------
# 각 앱플레이어는 자기 adb.exe를 갖고 있고 adb 포트가 다르다. 실행 중인 것들에 전부 붙어 보고, 트릭컬 데이터가 있는 기기를 고른다.
EMULATORS = [
    # (이름, adb 후보 경로들(글롭), 기본 포트들, 안내)
    ("MuMu Player 12", [r"C:\Program Files\Netease\MuMuPlayer\nx_main\adb.exe", r"C:\Program Files\Netease\MuMu Player 12\shell\adb.exe", r"D:\Program Files\Netease\MuMuPlayer\nx_main\adb.exe", r"*:\Netease\MuMuPlayer\nx_main\adb.exe"], [16384, 16416, 16448, 16480], "뮤뮤는 꺼져 있으면 자동으로 켭니다"),
    ("MuMu Player (구버전)", [r"C:\Program Files\Netease\MuMu\emulator\nemu\vmonitor\bin\adb_server.exe", r"*:\Netease\MuMu\emulator\nemu\vmonitor\bin\adb_server.exe"], [7555], "뮤뮤를 켠 상태여야 합니다"),
    ("LDPlayer", [r"*:\LDPlayer\LDPlayer*\adb.exe", r"*:\LDPlayer*\adb.exe", r"C:\Program Files\LDPlayer\LDPlayer*\adb.exe", r"*:\XuanZhi\LDPlayer*\adb.exe"], [5555, 5557, 5559, 5561, 5563], "LD플레이어를 켠 상태여야 합니다 (설정 → 기타 → ADB 디버깅 '로컬 연결 열기')"),
    ("LDPlayer 4", [r"C:\LDPlayer\LDPlayer4.0\adb.exe", r"*:\LDPlayer\LDPlayer4.0\adb.exe", r"C:\Changzhi\dnplayer2\adb.exe"], [5555, 5557, 5559], "LD플레이어를 켠 상태여야 합니다"),
    ("BlueStacks 5", [r"C:\Program Files\BlueStacks_nxt\HD-Adb.exe", r"*:\BlueStacks_nxt\HD-Adb.exe"], [5555, 5565, 5575, 5585], "블루스택 설정 → 고급 → 'Android 디버그 브리지(ADB)'를 켜야 합니다 (포트는 그 화면에 표시)"),
    ("BlueStacks 4", [r"C:\Program Files\BlueStacks\HD-Adb.exe", r"*:\BlueStacks\HD-Adb.exe"], [5555, 5565], "블루스택 설정에서 ADB를 켜야 합니다"),
]
def _glob_paths(pats):
    out = []
    for pat in pats:
        if pat.startswith("*:"):
            for d in "CDEFGH":
                out += glob.glob(d + pat[1:])
        else: out += glob.glob(pat)
    return out

def short_path(p):
    """윈도우 8.3 짧은 경로 (C:\\Users\\장권민 → C:\\Users\\C7C6~1) — 한글 경로를 adb가 못 써서 ASCII 별칭이 필요할 때"""
    try:
        import ctypes
        buf = ctypes.create_unicode_buffer(520)
        n = ctypes.windll.kernel32.GetShortPathNameW(p, buf, 520)
        return buf.value if 0 < n < 520 else None
    except Exception: return None

def pick_tmp_base():
    """adb pull 대상이 될 임시 폴더: ASCII만·공백 없음. (adb는 한글이 든 로컬 경로에 파일을 못 만든다 — 사용자 이름이 한글이면 %TEMP%가 그렇다)"""
    def ok(c): return bool(c) and c.isascii() and " " not in c
    cands = []
    for env in ("TEMP", "TMP", "LOCALAPPDATA"):
        c = os.environ.get(env)
        if not c: continue
        cands.append(c)
        if not ok(c):
            try: os.makedirs(c, exist_ok=True)
            except Exception: pass
            sp = short_path(c)
            if sp: cands.append(sp)
    drive = os.environ.get("SystemDrive", "C:")
    cands += [os.path.join(drive + os.sep, "Users", "Public", "sadodesk-tmp"), os.path.join(drive + os.sep, "sadodesk-tmp"), os.path.join(drive + os.sep, "Temp")]
    for cand in cands:
        if not ok(cand): continue
        try:
            os.makedirs(cand, exist_ok=True)
            probe = os.path.join(cand, ".sadodesk-w"); open(probe, "w").close(); os.remove(probe)
            return cand
        except Exception: continue
    return None

MODERN_ADB = (1, 0, 41)
PTOOLS_URL = "https://dl.google.com/android/repository/platform-tools-latest-windows.zip"
def ensure_modern_adb(adb_exe, cache_dir):
    """adb_exe가 구버전(<1.0.41)이면 platform-tools adb를 cache_dir에 내려받아(사용자 PC가 직접 구글에서 받음, 약 6MB) 그 경로를 돌려준다. 실패하면 원래 adb"""
    if not adb_exe or adb_exe.lower().endswith("ldconsole.exe") or adb_version(adb_exe) >= MODERN_ADB: return adb_exe
    if not cache_dir: return adb_exe
    cached = os.path.join(cache_dir, "platform-tools", "adb.exe")
    if os.path.exists(cached) and adb_version(cached) >= MODERN_ADB: return cached
    try:
        log("adb", f"앱플레이어의 adb가 구버전({'.'.join(map(str, adb_version(adb_exe)))})이라 큰 폴더 복사가 불안정해요 → 구글 platform-tools adb를 내려받습니다 (약 6MB, 1회)")
        os.makedirs(cache_dir, exist_ok=True)
        data = urllib.request.urlopen(PTOOLS_URL, timeout=60).read()
        with zipfile.ZipFile(_io.BytesIO(data)) as z:
            for n in z.namelist():
                if n.startswith("platform-tools/") and (n.endswith("adb.exe") or n.endswith(".dll")): z.extract(n, cache_dir)
        if os.path.exists(cached):
            log("adb", f"platform-tools adb {'.'.join(map(str, adb_version(cached)))} 준비됨", "ok"); return cached
    except Exception as e:
        log("adb", f"platform-tools 내려받기 실패({e}) — 앱플레이어 adb로 계속합니다", "warn")
    return adb_exe

_ADB_VER = {}
def adb_version(exe):
    if exe not in _ADB_VER:
        try: m = re.search(r"version (\d+)\.(\d+)\.(\d+)", subprocess.run([exe, "version"], capture_output=True, timeout=10).stdout.decode("utf-8", "ignore")); _ADB_VER[exe] = tuple(int(x) for x in m.groups()) if m else (0, 0, 0)
        except Exception: _ADB_VER[exe] = (0, 0, 0)
    return _ADB_VER[exe]

ONLY = os.environ.get("SADODESK_ONLY", "").lower()  # 테스트용: "mumu" | "ld" | "bluestacks" — 그 앱플레이어만 설치된 PC처럼 동작
def _only_ok(name):
    if not ONLY: return True
    n = name.lower()
    return (ONLY == "mumu" and "mumu" in n) or (ONLY == "ld" and "ldplayer" in n) or (ONLY == "bluestacks" and "bluestacks" in n)

def find_adbs(extra=None):
    """설치된 앱플레이어들의 adb.exe → [(이름, adb경로, 포트들, 안내)]. 새 버전 adb 우선(블루스택 HD-Adb 1.0.36은 폴더 pull이 실패해서 뒤로)"""
    found = []
    for name, pats, ports, tip in EMULATORS:
        if not _only_ok(name): continue
        for p in _glob_paths(pats):
            if os.path.exists(p): found.append((name, p, ports, tip)); break
    if extra and os.path.exists(extra): found.insert(0, ("직접 지정", extra, [], ""))
    # BlueStacks 5: 설정 파일에서 실제 adb 포트
    conf = os.path.join(os.environ.get("ProgramData", r"C:\ProgramData"), "BlueStacks_nxt", "bluestacks.conf")
    if os.path.exists(conf):
        try:
            ports = [int(m.group(1)) for m in re.finditer(r'adb_port="(\d+)"', open(conf, encoding="utf-8", errors="ignore").read())]
            for i, (name, p, ps, tip) in enumerate(found):
                if name.startswith("BlueStacks 5"): found[i] = (name, p, sorted(set(ports + ps)), tip)
        except Exception: pass
    # PATH의 adb (platform-tools) — 실제 스마트폰(USB 디버깅)도 이걸로
    w = None if ONLY else shutil.which("adb")
    if w and all(os.path.normcase(w) != os.path.normcase(f[1]) for f in found): found.append(("adb (PATH)", w, [], "USB 디버깅을 켠 실제 기기 · 기타 앱플레이어"))
    found.sort(key=lambda f: (0 if f[0] == "직접 지정" else 1, tuple(-v for v in adb_version(f[1]))))
    return found

def ldconsole_path():
    if ONLY and ONLY != "ld": return None
    for exe in _glob_paths([r"*:\\LDPlayer\\LDPlayer*\\ldconsole.exe", r"*:\\LDPlayer*\\ldconsole.exe", r"C:\\Program Files\\LDPlayer\\LDPlayer*\\ldconsole.exe"]):
        return exe
    return None

def ld_instances():
    """LD플레이어 인스턴스 [(index, 제목, 켜짐)] — ldconsole list2: index,title,top hwnd,bind hwnd,android_started,pid,..."""
    exe = ldconsole_path(); out = []
    if not exe: return out
    try:
        for line in subprocess.run([exe, "list2"], capture_output=True, text=True, timeout=10, encoding="utf-8", errors="ignore").stdout.splitlines():
            f = line.split(",")
            if len(f) >= 5 and f[0].isdigit(): out.append((int(f[0]), f[1], f[4] == "1"))
    except Exception: pass
    return out

def device_info(adb_exe, serial):
    """기기 하나의 식별 정보: 모델·안드로이드 버전·boot_id(중복 제거용 — 같은 VM이 emulator-5554와 127.0.0.1:5555 두 이름으로 보임. android_id는 뮤뮤12와 LD14가 같은 이미지라 겹쳐서 못 씀)·블루스택 여부·트릭컬 데이터 유무"""
    p = adb(adb_exe, serial, "shell", f"getprop ro.product.model; getprop ro.build.version.release; cat /proc/sys/kernel/random/boot_id; getprop | grep -c 'ro.bst\\.'; ls {BASE}/spine >/dev/null 2>&1 && echo HAS || echo NO", timeout=20)
    lines = [l.strip() for l in p.stdout.decode("utf-8", "ignore").splitlines() if l.strip()]
    if len(lines) < 5: return None
    return {"model": lines[0], "android": lines[1], "aid": lines[2], "bst": lines[3] != "0", "hasGame": lines[4] == "HAS"}

def label_device(serial, info, ldnames):
    port = None
    if ":" in serial: port = int(serial.rsplit(":", 1)[1])
    elif serial.startswith("emulator-"): port = int(serial.split("-")[1]) + 1  # emulator-5554 ↔ 127.0.0.1:5555
    if info and info["bst"]: return "BlueStacks 5", "설정 → 고급 → 'Android 디버그 브리지(ADB)'가 켜져 있어야 합니다"
    if port is not None:
        if 16384 <= port < 17000 and (port - 16384) % 32 == 0: return "MuMu Player 12", "꺼져 있으면 자동으로 켭니다"
        if port == 7555: return "MuMu Player (구버전)", ""
        if 5555 <= port < 5600:
            idx = (port - 5555) // 2
            if ldnames and idx in ldnames: return f"LDPlayer — {ldnames[idx]}", "LD플레이어 인스턴스"
            return "안드로이드 에뮬레이터 (포트 %d)" % port, ""
    return "안드로이드 기기", "USB 디버깅 기기 또는 기타 에뮬레이터"

def stable_devices(adb_exe, wait=6.0):
    """adb devices 결과가 안정될 때까지(offline 없음) 기다림 — adb.exe 버전이 다르면 서버가 재시작돼 잠깐 offline이 됨"""
    t0 = time.time(); last = []
    while True:
        p = subprocess.run([adb_exe, "devices"], env=ENV, capture_output=True, timeout=20)
        rows = [l.split() for l in p.stdout.decode("utf-8", "ignore").splitlines()[1:] if l.strip()]
        last = [(r[0], r[1]) for r in rows if len(r) >= 2]
        if last and all(st == "device" for _, st in last): break
        if time.time() - t0 > wait: break
        time.sleep(0.7)
    return [sn for sn, st in last if st == "device"]

def scan_devices(mumu_hint=None, adb_hint=None):
    """붙을 수 있는 기기 전부: [{emulator, adb, serial, hasGame, android, model, tip}]. 같은 기기가 두 serial로 보이면(emulator-5554 = 127.0.0.1:5555) 하나만"""
    adbs = find_adbs(adb_hint or (mumu_hint and os.path.join(mumu_hint, "adb.exe")))
    if not adbs: return []
    all_ports = sorted({pt for _, _, ports, _ in adbs for pt in ports} | {16384, 7555, 5555, 5557, 5559})
    result = []; seen_aid = set()
    ldc = ldconsole_path()
    ld_running = {idx: title for idx, title, started in ld_instances() if started} if ldc else {}
    ldnames = ld_running
    for name, adb_exe, ports, tip in adbs:  # adb 서버(5037)는 공유되므로 첫 adb로 전부 보인다. 안 보이면 다음 adb로
        for port in sorted(set(all_ports)):
            subprocess.run([adb_exe, "connect", f"127.0.0.1:{port}"], env=ENV, capture_output=True, timeout=6)
        serials = stable_devices(adb_exe)
        if not serials: continue
        # 같은 VM이 여러 이름으로 보이면 emulator-XXXX(앱플레이어가 adb 서버에 직접 등록한 것)를 우선 — 127.0.0.1:포트 쪽은 블루스택 ADB 옵션이 꺼져 있으면 'closed'가 나기도 함
        serials.sort(key=lambda sn: (0 if sn.startswith("emulator-") else 1, sn))
        for serial in serials:
            info = None
            for _ in range(3):  # 서버 재시작 직후엔 shell이 빈 응답을 줄 수 있음 → 잠깐 뒤 재시도
                info = device_info(adb_exe, serial)
                if info: break
                time.sleep(0.8)
            if not info: continue  # 응답 없는 중복 연결(다른 앱플레이어와 포트가 겹친 127.0.0.1:5555 등)은 건너뜀
            emu, tip2 = label_device(serial, info, ldnames)
            if info["aid"] in seen_aid:
                # 같은 VM의 다른 이름: 더 구체적인 라벨(뮤뮤 16384 등)이면 라벨만 갱신 (serial은 먼저 잡힌 emulator-XXXX 유지)
                for d in result:
                    if d.get("aid") == info["aid"] and d["emulator"].startswith("안드로이드") and not emu.startswith("안드로이드"): d["emulator"], d["tip"] = emu, tip2
                continue
            seen_aid.add(info["aid"])
            result.append({"emulator": emu, "adb": adb_exe, "serial": serial, "tip": tip2, "hasGame": info["hasGame"], "android": info["android"], "model": info["model"], "aid": info["aid"]})
        if result: break
    # LD플레이어가 켜져 있는데 그 포트(5555+2i)로 아무 기기도 안 잡히면 = LD 설정의 'ADB 디버깅'이 꺼진 것(기본값) → 안내 항목
    for idx, title in ld_running.items():
        if any(d["emulator"].startswith("LDPlayer") and (f":{5555 + 2 * idx}" in d["serial"] or d["serial"] == f"emulator-{5554 + 2 * idx}") for d in result): continue
        result.append({"emulator": f"LDPlayer — {title}", "adb": "", "serial": f"ld:{idx}", "tip": "ADB 디버깅 꺼져 있음", "hasGame": False, "android": "?", "model": "", "unavailable": "LD플레이어 설정 → 기타 → 'ADB 디버깅'을 '로컬 연결 열기'로 바꾸고 재시작 (또는 아래 '켜기' 버튼)", "ldIndex": idx})
    # 블루스택이 켜져 있는데 어느 serial로도 응답이 없으면 = ADB 옵션이 꺼진 것 (포트는 열려 있어도 shell이 'closed') → 안내용 항목
    if any(n.startswith("BlueStacks") for n, _, _, _ in adbs) and not any(d["emulator"].startswith("BlueStacks") for d in result):
        try:
            running = subprocess.run(["powershell", "-NoProfile", "-Command", "(Get-Process HD-Player -ErrorAction SilentlyContinue | Measure-Object).Count"], capture_output=True, text=True, timeout=15).stdout.strip()
            if running and int(running) > 0:
                result.append({"emulator": "BlueStacks 5", "adb": "", "serial": "", "tip": "ADB 꺼져 있음", "hasGame": False, "android": "?", "model": "", "unavailable": "블루스택 설정 → 고급 → 'Android 디버그 브리지(ADB)'를 켜고 블루스택을 다시 시작한 뒤 검색"})
        except Exception: pass
    result.sort(key=lambda d: (not d["hasGame"], d["emulator"]))
    return result

# ---------- 뮤뮤 / adb ----------
def find_mumu(hint=None):
    if ONLY and ONLY != "mumu": return None
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
    # LD플레이어: 뮤뮤가 같은 PC에서 5555/7555/16384 포트를 다 점유하면 LD의 adb 포트가 밀려 일반 adb로는 닿지 않는다(emulator-5554도 뮤뮤로 연결됨).
    # ldconsole.exe adb --index N --command "..." 은 LD가 자기 인스턴스로 직접 라우팅해 주므로 이 경로를 쓴다.
    if dev.startswith("ld:"):
        cmd = " ".join(args)  # ldconsole은 문자열을 그대로 adb에 넘김 — 따옴표를 붙이면 shell이 멈춤. 경로에 공백이 없게 임시 폴더를 잡는다
        return subprocess.run([adb_exe, "adb", "--index", dev[3:], "--command", cmd], env=ENV, capture_output=True, timeout=timeout)
    return subprocess.run([adb_exe, "-s", dev, *args], env=ENV, capture_output=True, timeout=timeout)

def adb_connect(adb_exe, dev):
    if dev.startswith("ld:"): return
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
    if p.returncode != 0:
        msg = (p.stderr.decode("utf-8", "ignore").strip() or p.stdout.decode("utf-8", "ignore").strip())[-300:]
        raise RuntimeError(f"adb pull 실패 {remote}: {msg or f'code {p.returncode}'} (adb {'.'.join(map(str, adb_version(adb_exe))) if not dev.startswith('ld:') else 'ldconsole'})")

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
    # 이미 완성된 세트(skel·atlas·아틀라스가 가리키는 png 전부 있음)는 건너뜀 → 재추출은 새로 받은 사도만
    def complete(n):
        d = os.path.join(out, kind, n); at = os.path.join(d, n + ".atlas")
        if not (os.path.exists(os.path.join(d, n + ".skel")) and os.path.exists(at)): return False
        try: pages = [l.strip() for l in open(at, encoding="utf-8", errors="ignore") if l.strip().lower().endswith(".png")]
        except Exception: return False
        return bool(pages) and all(os.path.exists(os.path.join(d, pg)) for pg in pages)
    todo = names if FORCE else [n for n in names if not complete(n)]
    if not todo: log(kind, f"{label} {len(names)}세트 이미 있음 — 건너뜀 (다시 받으려면 '이미 있는 것도 다시 받기' 체크)", "ok"); return
    log(kind, f"{label} {len(todo)}세트 복사 중… (이미 있는 {len(names) - len(todo)}세트 제외)", total=len(todo), done=0)
    local = os.path.join(tmp, kind); os.makedirs(local, exist_ok=True)
    if len(todo) < len(names) * 0.5:  # 일부만 새로 받으면 그 폴더들만
        for i, n in enumerate(todo, 1):
            adb_pull(adb_exe, dev, f"{remote}/{n}", os.path.join(local, n))
            if i % 10 == 0 or i == len(todo): log(kind, f"{label} 복사 {i}/{len(todo)}", done=i, total=len(todo))
        root = local
    else:
        try:
            adb_pull(adb_exe, dev, remote, local)  # 폴더 통째로 (파일별 pull보다 훨씬 빠름)
            root = local if os.path.isdir(os.path.join(local, todo[0])) else os.path.join(local, os.path.basename(remote))
        except RuntimeError as e:  # 구버전 adb(블루스택 HD-Adb 1.0.36)는 큰 폴더 pull이 실패함 → 세트별로
            log(kind, f"폴더 일괄 복사 실패, 세트별로 다시 받습니다 — {e}", "warn")
            shutil.rmtree(local, ignore_errors=True); os.makedirs(local, exist_ok=True)
            try: adb_connect(adb_exe, dev)  # 다른 앱플레이어의 adb가 서버를 재시작해 끊긴 경우 다시 연결
            except Exception: pass
            failed = []
            for i, n in enumerate(todo, 1):
                try: adb_pull(adb_exe, dev, f"{remote}/{n}", os.path.join(local, n))
                except RuntimeError:
                    try: time.sleep(0.5); adb_pull(adb_exe, dev, f"{remote}/{n}", os.path.join(local, n))
                    except RuntimeError as e2: failed.append(f"{n}: {e2}")
                if i % 20 == 0 or i == len(todo): log(kind, f"{label} 복사 {i}/{len(todo)}", done=i, total=len(todo))
            for f in failed[:5]: log(kind, "복사 실패 " + f, "warn")
            root = local
    jobs = [(os.path.join(root, n), os.path.join(out, kind, n), kind) for n in todo if os.path.isdir(os.path.join(root, n))]
    if todo and not jobs:
        global FAILED; FAILED = True
        log(kind, f"{label}: {len(todo)}세트 중 하나도 복사되지 않았어요 — 위 adb 오류를 확인해 주세요", "error"); return
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
    if os.path.exists(dst) and not FORCE: return "skip"
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
    cat_re = re.compile(r"^voice_([a-z0-9]+)_(" + "|".join(VOICE_CATS) + r")(\d[\d_]*)?(_skin\d+)?$")
    # 이미 변환된 사도(index.json 기준 파일이 있음)는 다시 받지 않음 → 재추출 때는 새 사도만
    vout = os.path.join(out, "voice")
    def hero_done(h):
        d = os.path.join(vout, h); return os.path.isdir(d) and len([f for f in os.listdir(d) if f.endswith(".ogg")]) >= 10
    todo = heroes if FORCE else [h for h in heroes if not hero_done(h)]
    if not todo: build_voice_index(vout); log("voice", f"보이스 {len(heroes)}명 이미 있음 — 건너뜀 (다시 받으려면 '이미 있는 것도 다시 받기' 체크)", "ok"); return
    log("voice", f"보이스: 사도 {len(todo)}명 폴더 복사 중… (이미 있는 {len(heroes) - len(todo)}명 제외 · 원본 1.6GB 중 로비 대사만 변환)", total=len(todo), done=0)
    vtmp = os.path.join(tmp, "voice"); os.makedirs(vtmp, exist_ok=True)
    root = None
    if len(todo) >= len(heroes) * 0.5:
        try: adb_pull(adb_exe, dev, f"{BASE}/audio/kor/voice/hero", vtmp); root = os.path.join(vtmp, "hero") if os.path.isdir(os.path.join(vtmp, "hero")) else vtmp  # 한 번에 (사도별 156회 pull보다 빠름)
        except RuntimeError as e:
            log("voice", f"폴더 일괄 복사 실패, 사도별로 다시 받습니다 — {e}", "warn"); shutil.rmtree(vtmp, ignore_errors=True); os.makedirs(vtmp, exist_ok=True)
            try: adb_connect(adb_exe, dev)
            except Exception: pass
    if root is None:
        for i, h in enumerate(todo, 1):
            try: adb_pull(adb_exe, dev, f"{BASE}/audio/kor/voice/hero/{h}", os.path.join(vtmp, h))
            except RuntimeError as e: log("voice", f"복사 실패 {h}: {e}", "warn")
            if i % 5 == 0 or i == len(todo): log("voice", f"보이스 복사 {i}/{len(todo)}", done=i, total=len(todo))
        root = vtmp
    jobs = []
    for h in todo:
        hdir = os.path.join(root, h)
        if not os.path.isdir(hdir): continue
        for f in os.listdir(hdir):
            m = cat_re.match(f)
            if not m or "_selective_" in f: continue
            if m.group(1) != h and not h.startswith(m.group(1)): continue  # 변형 폴더가 기본 대사를 공유하는 경우(kommyswim ← voice_kommy_*)만
            jobs.append((os.path.join(hdir, f), os.path.join(vout, h, re.match(r"^voice_[a-z0-9]+_(.+)$", f).group(1) + ".ogg"), ffmpeg))
    log("voice", f"보이스 {len(jobs)}개 opus 변환 중…", total=len(jobs), done=0)
    stats = {}
    with ProcessPoolExecutor(max_workers=max(1, (os.cpu_count() or 4) - 1)) as ex:
        for i, st in enumerate(ex.map(_voice_job, jobs, chunksize=16), 1):
            k = st.split(":")[0]; stats[k] = stats.get(k, 0) + 1
            if i % 200 == 0 or i == len(jobs): log("voice", f"보이스 변환 {i}/{len(jobs)}", done=i, total=len(jobs))
    build_voice_index(os.path.join(out, "voice"))
    if todo and not stats:
        global FAILED; FAILED = True
        log("voice", f"보이스: {len(todo)}명 중 하나도 복사되지 않았어요 — 위 adb 오류를 확인해 주세요", "error"); return
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
    ap.add_argument("--out", default=None); ap.add_argument("--steps", default="minimi,sfx,standing,ingame,voice")
    ap.add_argument("--mumu", default=None); ap.add_argument("--vm", default="0"); ap.add_argument("--json", action="store_true"); ap.add_argument("--keep-tmp", action="store_true")
    ap.add_argument("--adb", default=None, help="adb.exe 경로 (앱플레이어 것 또는 platform-tools)"); ap.add_argument("--serial", default=None, help="기기 serial (예 127.0.0.1:5555, emulator-5554)")
    ap.add_argument("--list-devices", action="store_true", help="붙을 수 있는 기기 목록만 JSON으로 출력")
    ap.add_argument("--force", action="store_true", help="이미 있는 스탠딩·보이스도 다시 받아 덮어쓰기")
    ap.add_argument("--enable-ld-adb", type=int, default=None, help="LD플레이어 인스턴스 N의 ADB 디버깅을 켜고 재시작")
    ap.add_argument("--cache", default=os.path.join(os.environ.get("LOCALAPPDATA", tempfile.gettempdir()), "sado-desk"), help="platform-tools 등 보조 도구 저장 폴더")
    a = ap.parse_args(); JSON = a.json
    global FORCE; FORCE = a.force
    if a.list_devices:
        print(json.dumps(scan_devices(a.mumu, a.adb), ensure_ascii=False)); return
    if a.enable_ld_adb is not None:
        ldc = ldconsole_path()
        if not ldc: log("adb", "LD플레이어를 찾지 못했어요", "error"); sys.exit(3)
        cfg = os.path.join(os.path.dirname(ldc), "vms", "config", f"leidian{a.enable_ld_adb}.config")
        try:
            c = json.load(open(cfg, encoding="utf-8")) if os.path.exists(cfg) else {}
            c["basicSettings.adbDebug"] = 1
            open(cfg, "w", encoding="utf-8").write(json.dumps(c, ensure_ascii=False, indent=4))
            log("adb", f"LD플레이어 인스턴스 {a.enable_ld_adb}: ADB 디버깅(로컬) 켬 → 재시작 중… (30초쯤)")
            subprocess.run([ldc, "reboot", "--index", str(a.enable_ld_adb)], capture_output=True, timeout=30)
            for _ in range(40):
                time.sleep(3)
                if any(i == a.enable_ld_adb and st for i, _, st in ld_instances()): break
            time.sleep(8)
            log("adb", "재시작 완료 — 다시 검색해 주세요", "ok"); return
        except Exception as e:
            log("adb", f"설정 변경 실패: {e}", "error"); sys.exit(3)
    if not a.out: ap.error("--out 이 필요해요")
    steps = [s.strip() for s in a.steps.split(",") if s.strip()]
    out = os.path.abspath(a.out); os.makedirs(out, exist_ok=True)
    try:
        import UnityPy  # noqa
    except ImportError:
        log("setup", "UnityPy가 없어요. pip install UnityPy Pillow imageio-ffmpeg", "error"); sys.exit(2)
    try:
        adb_exe, dev = None, None
        if a.serial and re.fullmatch(r"\d{2,5}", a.serial): a.serial = "127.0.0.1:" + a.serial  # 포트만 준 경우
        if a.serial and a.serial.startswith("ld:"): log("adb", "LD플레이어의 ADB 디버깅을 먼저 켜 주세요 (설정 → 기타 → ADB 디버깅: 로컬 연결 열기)", "error"); sys.exit(6)
        if a.serial and not a.adb:  # 포트만 직접 지정 → 설치된 앱플레이어 adb 아무거나
            found = find_adbs(); a.adb = found[0][1] if found else None
            if not a.adb: log("adb", "adb.exe를 찾지 못했어요. adb 경로도 함께 지정해 주세요.", "error"); sys.exit(3)
        if a.adb and a.serial:  # UI에서 고른 기기
            adb_exe, dev = a.adb, a.serial
            if ":" in dev: adb_connect(adb_exe, dev)
            log("adb", f"기기: {dev} ({'LD플레이어 ldconsole' if dev.startswith('ld:') else os.path.basename(os.path.dirname(adb_exe))})")
        else:
            devs = [d for d in scan_devices(a.mumu, a.adb) if d["hasGame"]]
            if devs:
                adb_exe, dev = devs[0]["adb"], devs[0]["serial"]; log("adb", f"{devs[0]['emulator']} {dev} 에서 트릭컬 데이터 발견")
            else:
                mmdir = find_mumu(a.mumu)  # 켜진 게 없으면 뮤뮤는 자동으로 켜 본다
                if not mmdir: log("adb", "트릭컬이 설치된 앱플레이어를 찾지 못했어요. 앱플레이어(뮤뮤·LD플레이어·블루스택·녹스)를 켠 뒤 다시 시도하거나, adb 경로와 포트를 직접 지정해 주세요. 블루스택은 설정에서 ADB를 켜야 합니다.", "error"); sys.exit(3)
                log("adb", f"뮤뮤: {mmdir}")
                dev = ensure_vm(mmdir, a.vm); adb_exe = os.path.join(mmdir, "adb.exe"); adb_connect(adb_exe, dev)
        # 구버전 adb면 최신 platform-tools로 교체 (TCP serial은 새 adb로 다시 connect. emulator-XXXX 등록은 서버가 바뀌면 사라질 수 있어 conf 포트로 재탐색)
        better = ensure_modern_adb(adb_exe, a.cache)
        if better != adb_exe:
            new_dev = dev
            if not dev.startswith("ld:"):
                if ":" not in dev:  # emulator-5554 → 그 앱플레이어의 TCP 포트로 (블루스택 conf 포트 / emulator-N → 127.0.0.1:N+1)
                    cands = []
                    conf = os.path.join(os.environ.get("ProgramData", r"C:\\ProgramData"), "BlueStacks_nxt", "bluestacks.conf")
                    if os.path.exists(conf):
                        try: cands += [f"127.0.0.1:{m.group(1)}" for m in re.finditer(r'adb_port="(\d+)"', open(conf, encoding="utf-8", errors="ignore").read())]
                        except Exception: pass
                    if dev.startswith("emulator-"): cands.append(f"127.0.0.1:{int(dev.split('-')[1]) + 1}")
                    for c in dict.fromkeys(cands):
                        try:
                            adb_connect(better, c)
                            if adb_ls(better, c, f"{BASE}/spine"): new_dev = c; break
                        except Exception: continue
                    else:
                        # 등록형 serial이 그대로 보이면 그것도 시도
                        try: adb_connect(better, dev); new_dev = dev
                        except Exception: better = adb_exe
                else:
                    try: adb_connect(better, dev)
                    except Exception: better = adb_exe
            if better != adb_exe: adb_exe, dev = better, new_dev; log("adb", f"최신 adb로 전환: {dev}")
        if not adb_ls(adb_exe, dev, f"{BASE}/spine"):
            probe = adb(adb_exe, dev, "shell", "echo ok", timeout=15)
            if b"closed" in probe.stderr + probe.stdout or b"ok" not in probe.stdout:
                log("adb", f"기기({dev})가 adb 명령을 거부해요 ('closed'). 블루스택이면 설정 → 고급 → 'Android 디버그 브리지(ADB)'를 켜고 블루스택을 다시 시작한 뒤 시도해 주세요.", "error"); sys.exit(5)
            log("adb", f"이 기기({dev})에 트릭컬 리바이브 데이터가 없어요 ({BASE}). 그 앱플레이어에서 게임을 한 번 실행해 리소스를 내려받은 뒤 다시 시도해 주세요. (안드로이드 11 이상 실기기는 adb로 앱 데이터를 읽을 수 없어 앱플레이어가 필요합니다)", "error"); sys.exit(4)
        log("adb", f"연결됨 {dev}", "ok")
    except Exception as e:
        log("adb", str(e), "error"); sys.exit(3)
    tmpbase = pick_tmp_base()
    log("adb", f"임시 폴더: {tmpbase}")
    tmp = tempfile.mkdtemp(prefix="sadodesk-", dir=tmpbase)
    try:
        if "minimi" in steps: step_minimi(adb_exe, dev, out, tmp)
        if "sfx" in steps: step_sfx(adb_exe, dev, out, tmp)
        if "standing" in steps: step_spine_sets("standing", f"{BASE}/spine/standing", adb_exe, dev, out, tmp)
        if "ingame" in steps: step_spine_sets("ingame", f"{BASE}/spine/ingame/hero", adb_exe, dev, out, tmp)
        if "voice" in steps: step_voice(adb_exe, dev, out, tmp)
        if FAILED: log("error", "일부 단계가 통째로 실패했어요 — 위 오류를 확인하고 다시 시도해 주세요", "error"); sys.exit(7)
        log("done", f"완료 — {out}", "ok")
    except Exception as e:
        log("error", str(e), "error"); sys.exit(1)
    finally:
        if not a.keep_tmp: shutil.rmtree(tmp, ignore_errors=True)

if __name__ == "__main__":
    main()
