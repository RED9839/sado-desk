"""보이스 내용 확인용 STT (faster-whisper). 사용: python tools/transcribe-voices.py <hero> [파일 패턴...]  → out/voice-text-<hero>.txt"""
import sys, os, glob, re, time, site
for d in site.getsitepackages() + [site.getusersitepackages()]:
    for p in glob.glob(os.path.join(d, "nvidia", "*", "bin")): os.add_dll_directory(p); os.environ["PATH"] = p + os.pathsep + os.environ["PATH"]
from faster_whisper import WhisperModel
hero = sys.argv[1]; pats = sys.argv[2:] or ["*"]
root = os.path.join("assets", "voice", hero)
files = sorted({f for p in pats for f in glob.glob(os.path.join(root, p + ".ogg"))}, key=lambda f: os.path.basename(f))
t0 = time.time()
try: model = WhisperModel("large-v3", device="cuda", compute_type="float16")
except Exception as e: print("cuda 실패 → cpu", e); model = WhisperModel("small", device="cpu", compute_type="int8")
print(f"model loaded {time.time()-t0:.1f}s files={len(files)}")
out = open(f"out/voice-text-{hero}.txt", "w", encoding="utf-8")
for f in files:
    segs, info = model.transcribe(f, language="ko", beam_size=5, vad_filter=False)
    text = " ".join(s.text.strip() for s in segs)
    line = f"{os.path.basename(f):28s} {info.duration:5.2f}s  {text}"
    print(line); out.write(line + "\n"); out.flush()
