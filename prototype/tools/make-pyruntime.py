"""설치판에 넣을 임베디드 Python 런타임 만들기 → prototype/pyruntime/ (electron-builder extraResources)
- python.org 임베더블 배포판(zip) 내려받아 풀고, ._pth 에 site-packages 추가
- 추출기 의존 패키지(UnityPy·Pillow·imageio-ffmpeg 등)를 그 파이썬 버전용 휠로 받아 Lib/site-packages 에 설치
사용: python tools/make-pyruntime.py [--version 3.12.10]
"""
import argparse, io, os, subprocess, sys, urllib.request, zipfile, shutil, glob

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

pkgs = ["UnityPy", "Pillow", "imageio-ffmpeg", "texture2ddecoder"]
print("install wheels for", ver)
r = subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "--target", site, "--only-binary=:all:", "--python-version", short[0] + "." + short[1:], "--platform", "win_amd64", "--implementation", "cp", *pkgs], capture_output=True, text=True)
print(r.stdout[-2000:], r.stderr[-3000:])
if r.returncode != 0: sys.exit(r.returncode)
# 검증
chk = subprocess.run([os.path.join(out, "python.exe"), "-c", "import UnityPy, PIL, imageio_ffmpeg, texture2ddecoder; print('ok', UnityPy.__version__, imageio_ffmpeg.get_ffmpeg_exe())"], capture_output=True, text=True)
print(chk.stdout, chk.stderr[-1500:])
total = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(out) for f in fs)
print(f"pyruntime: {total/1e6:.0f} MB")
