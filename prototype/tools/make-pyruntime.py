"""설치판에 넣을 임베디드 Python 런타임 만들기 → prototype/pyruntime/ (electron-builder extraResources)
- python.org 임베더블 배포판(zip) 내려받아 풀고, ._pth 에 site-packages 추가
- 추출기 의존 패키지(UnityPy·Pillow 등)를 그 파이썬 버전용 휠로 받아 Lib/site-packages 에 설치
- 보이스 wav→opus 변환기 opusenc.exe(0.5MB) 를 Xiph/Mozilla 배포본에서 받아 pyruntime/ 에 둠
  (예전에는 imageio-ffmpeg 를 썼는데 ffmpeg 하나가 87MB 라 설치판이 그만큼 부풀었다)
사용: python tools/make-pyruntime.py [--version 3.12.10]
"""
import argparse, hashlib, io, os, subprocess, sys, urllib.request, zipfile, shutil, glob

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
ap = argparse.ArgumentParser(); ap.add_argument("--version", default="3.12.10"); ap.add_argument("--out", default=os.path.join(ROOT, "pyruntime"))
a = ap.parse_args()
ver = a.version; short = "".join(ver.split(".")[:2])
out = a.out
if os.path.exists(out): shutil.rmtree(out)
os.makedirs(out)

url = f"https://www.python.org/ftp/python/{ver}/python-{ver}-embed-amd64.zip"
print("download", url)
data = urllib.request.urlopen(url, timeout=120).read()
zipfile.ZipFile(io.BytesIO(data)).extractall(out)
pth = os.path.join(out, f"python{short}._pth")
open(pth, "w", encoding="utf-8").write(f"python{short}.zip\n.\nLib\\site-packages\nimport site\n")
site = os.path.join(out, "Lib", "site-packages"); os.makedirs(site, exist_ok=True)

REQ = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pyruntime-requirements.txt")
print("install wheels for", ver, "from", REQ)
r = subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "--target", site, "--only-binary=:all:", "--python-version", short[0] + "." + short[1:], "--platform", "win_amd64", "--implementation", "cp", "-r", REQ], capture_output=True, text=True)
print(r.stdout[-2000:], r.stderr[-3000:])
if r.returncode != 0: sys.exit(r.returncode)
# 검증 — 여기서 결과를 버리면 임포트가 안 되는 런타임이 그대로 설치 파일에 들어간다.
# 그러면 모든 사용자에게서 추출이 100% 실패하는데, 앱은 "완료"라고 말한다.
chk = subprocess.run([os.path.join(out, "python.exe"), "-c",
    "import UnityPy, PIL, texture2ddecoder;"
    "from UnityPy import load;"
    "print('ok', UnityPy.__version__, PIL.__version__)"], capture_output=True, text=True)
print(chk.stdout, chk.stderr[-1500:])
if chk.returncode != 0:
    sys.exit("pyruntime 검증 실패 — 임베디드 파이썬에서 임포트가 안 됩니다:\n" + chk.stderr[-2000:])
if not chk.stdout.startswith("ok 1."):
    sys.exit(f"UnityPy 가 1.x 가 아닙니다({chk.stdout.strip()}). extract-all.py 는 1.x API 에 기대므로 "
             "tools/pyruntime-requirements.txt 와 추출기를 함께 손봐야 합니다.")

# opusenc — 보이스 변환기. 받은 파일이 우리가 확인한 그 파일인지 해시로 확인한 뒤에만 쓴다
OPUS_ZIP = "https://archive.mozilla.org/pub/opus/win32/opus-tools-0.2-opus-1.3.1.zip"
OPUS_SHA = {"opusenc.exe": "a5fe14e1989f83e06378c54afca5f4d0f46a48ba7b0afcc4ee5e406acf0b7833",
            "LICENSE": "c28016e58544119d6b93aea28297d040f17dcef7a9f548d3e6a4d0b558c5d248"}
print("download", OPUS_ZIP)
z = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(OPUS_ZIP, timeout=120).read()))
for name, want in OPUS_SHA.items():
    blob = z.read(name)
    got = hashlib.sha256(blob).hexdigest()
    if got != want:
        sys.exit(f"opus-tools {name} 해시가 달라요: {got} (기대 {want})")
    open(os.path.join(out, "opusenc.exe" if name == "opusenc.exe" else "opusenc-LICENSE.txt"), "wb").write(blob)
print("opusenc ok")
total = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(out) for f in fs)
print(f"pyruntime: {total/1e6:.0f} MB")
