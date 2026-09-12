# -*- coding: utf-8 -*-
"""스토리(테마극장·메인·인연) 대사 + 로비 대사 보이스를 STT로 받아쓰기 → out/scripts/<hero>.jsonl
사용: python tools/transcribe-scripts.py <voice/hero 폴더> [--heroes a,b] [--model large-v3] [--batch 24]
  폴더 = 기기에서 pull 한 audio/kor/voice/hero (UnityFS 번들). 결과는 사도별 jsonl {file, cat, story, ep, idx, dur, text}
  이미 있는 jsonl의 파일은 건너뜀(재시작 가능). 말투 분석(tools/analyze-scripts.py)의 입력.
"""
import sys, os, io, re, json, time, glob, site, argparse, threading, queue
for d in site.getsitepackages() + [site.getusersitepackages()]:
    for p in glob.glob(os.path.join(d, "nvidia", "*", "bin")): os.add_dll_directory(p); os.environ["PATH"] = p + os.pathsep + os.environ["PATH"]
import UnityPy
from faster_whisper import WhisperModel, BatchedInferencePipeline
from faster_whisper.audio import decode_audio

SPEECH_CATS = ("affinity", "callplayer", "callhero", "line", "greeting", "yes", "no", "hmm", "themeinteraction", "board", "lobby", "birthday", "trickcal", "gacha", "levelup", "growth", "heroupgrade", "equipment", "decksetting", "telephonecall", "stage", "spawn", "victory", "defeat", "eat", "touch", "dutchrubend", "asideupgrade", "heroskill")
SEL_RE = re.compile(r"^_selective_(.+?)_ep(\d+)_(\d+)_([a-z0-9_]+)$", re.I)
CAT_RE = re.compile(r"^voice_([a-z0-9_]+?)_(" + "|".join(SPEECH_CATS) + r")(\d[\d_-]*)?(_skin\d+)?$", re.I)

def classify(fn):
    m = SEL_RE.match(fn)
    if m: return {"cat": "story", "story": m.group(1).lower(), "ep": int(m.group(2)), "idx": int(m.group(3)), "speaker": m.group(4).lower()}
    m = CAT_RE.match(fn)
    if m: return {"cat": m.group(2).lower(), "story": "", "ep": 0, "idx": 0, "speaker": m.group(1).lower(), "skin": (m.group(4) or "").lstrip("_")}
    return None

def decode(path):
    try:
        for o in UnityPy.load(path).objects:
            if o.type.name != "AudioClip": continue
            for _n, wav in o.read().samples.items():
                return decode_audio(io.BytesIO(wav), sampling_rate=16000)
    except Exception as e:
        return None
    return None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root"); ap.add_argument("--heroes", default=""); ap.add_argument("--model", default="large-v3"); ap.add_argument("--batch", type=int, default=24)
    ap.add_argument("--out", default="out/scripts"); ap.add_argument("--story-only", action="store_true")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    heroes = [h for h in sorted(os.listdir(a.root)) if os.path.isdir(os.path.join(a.root, h))]
    if a.heroes: want = set(a.heroes.split(",")); heroes = [h for h in heroes if h in want]
    t0 = time.time()
    model = WhisperModel(a.model, device="cuda", compute_type="float16")
    pipe = BatchedInferencePipeline(model=model)
    print(f"model {a.model} loaded {time.time()-t0:.1f}s heroes={len(heroes)}", flush=True)
    total = 0
    for hi, hero in enumerate(heroes, 1):
        outp = os.path.join(a.out, f"{hero}.jsonl")
        done = set()
        if os.path.exists(outp):
            for line in open(outp, encoding="utf-8"):
                try: done.add(json.loads(line)["file"])
                except Exception: pass
        files = []
        for fn in sorted(os.listdir(os.path.join(a.root, hero))):
            if fn in done: continue
            c = classify(fn)
            if not c or (a.story_only and c["cat"] != "story"): continue
            # 다른 사도가 화자인 스토리 파일(변형 폴더가 공유)은 speaker로 걸러 냄: 폴더명으로 시작하지 않으면 제외
            if c["cat"] == "story" and not (c["speaker"] == hero or c["speaker"].startswith(hero) or hero.startswith(c["speaker"])): continue
            files.append((fn, c))
        if not files: print(f"[{hi}/{len(heroes)}] {hero}: 0 new", flush=True); continue
        # 디코드는 스레드로 앞서 가며, 전사는 순서대로
        q = queue.Queue(maxsize=64)
        def producer():
            for fn, c in files: q.put((fn, c, decode(os.path.join(a.root, hero, fn))))
            q.put(None)
        threading.Thread(target=producer, daemon=True).start()
        n = 0; t1 = time.time()
        with open(outp, "a", encoding="utf-8") as out:
            while True:
                item = q.get()
                if item is None: break
                fn, c, audio = item
                if audio is None or len(audio) < 1600: continue
                try:
                    segs, info = pipe.transcribe(audio, language="ko", batch_size=a.batch, beam_size=3, vad_filter=False, without_timestamps=True)
                    text = " ".join(s.text.strip() for s in segs).strip()
                except Exception as e:
                    text = ""; print("  ERR", fn, e, flush=True)
                rec = {"file": fn, **c, "dur": round(len(audio) / 16000, 2), "text": text}
                out.write(json.dumps(rec, ensure_ascii=False) + "\n"); n += 1
                if n % 100 == 0: out.flush(); print(f"  {hero} {n}/{len(files)} {time.time()-t1:.0f}s", flush=True)
        total += n
        print(f"[{hi}/{len(heroes)}] {hero}: {n} lines {time.time()-t1:.0f}s (total {total}, {time.time()-t0:.0f}s)", flush=True)

if __name__ == "__main__":
    main()
