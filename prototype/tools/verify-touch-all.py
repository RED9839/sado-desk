"""전 사도 교감 보이스 내용 검증: touch1*(볼 당기기?) / touch2*(쓰다듬기?) / dutchrubend2(꿀밤?) 기본 파일을 STT로 받아 적고 키워드로 분류.
출력: out/voice-touch-all.txt (전체 전사), out/voice-touch-summary.txt (사도별 판정)"""
import os, glob, re, site, time, json
for d in site.getsitepackages() + [site.getusersitepackages()]:
    for p in glob.glob(os.path.join(d, "nvidia", "*", "bin")): os.add_dll_directory(p); os.environ["PATH"] = p + os.pathsep + os.environ["PATH"]
from faster_whisper import WhisperModel
model = WhisperModel("large-v3", device="cuda", compute_type="float16")
root = "assets/voice"
CHEEK = re.compile(r"당기|당겨|땡기|꼬집|늘어|늘리|볼|아프|아파|아야|아얏|그만|놔|놓|하지 마|하지마|이러|잡아|뺨")
PAT = re.compile(r"쓰다듬|쓰담|만지|만져|손|칭찬|기분|좋아|따뜻|부드|머리카락|더 해|계속|헤헤|히히|편해|좋은|고마")
KNOCK = re.compile(r"때리|때려|맞|아프|아파|머리|꿀밤|치지|왜|잘못|아야|아얏|반항|화|이씨|으이|욱")
out = open("out/voice-touch-all.txt", "w", encoding="utf-8"); summ = open("out/voice-touch-summary.txt", "w", encoding="utf-8")
heroes = sorted(d for d in os.listdir(root) if os.path.isdir(os.path.join(root, d)))
t0 = time.time(); stats = {"ok": 0, "swap": 0, "unclear": 0, "nofile": 0}
for i, h in enumerate(heroes):
    files = {}
    for key in ["touch1", "touch1_1", "touch1_2", "touch2", "touch2_1", "touch2_2", "dutchrubend2"]:
        f = os.path.join(root, h, key + ".ogg")
        if os.path.exists(f): files[key] = f
    if not files: summ.write(f"{h:16s} 파일 없음\n"); stats["nofile"] += 1; continue
    texts = {}
    for key, f in files.items():
        segs, info = model.transcribe(f, language="ko", beam_size=5)
        texts[key] = " ".join(s.text.strip() for s in segs)
        out.write(f"{h}/{key:12s} {info.duration:5.2f}s  {texts[key]}\n")
    out.flush()
    t1 = " ".join(v for k, v in texts.items() if k.startswith("touch1")); t2 = " ".join(v for k, v in texts.items() if k.startswith("touch2")); kn = texts.get("dutchrubend2", "")
    c1, p1 = len(CHEEK.findall(t1)), len(PAT.findall(t1)); c2, p2 = len(CHEEK.findall(t2)), len(PAT.findall(t2)); k = len(KNOCK.findall(kn))
    verdict = "ok" if (c1 >= p1 and p2 >= c2 and (c1 + p2) > 0) else ("swap?" if (p1 > c1 and c2 > p2) else "unclear")
    stats["ok" if verdict == "ok" else "swap" if verdict == "swap?" else "unclear"] += 1
    summ.write(f"{h:16s} {verdict:8s} touch1[볼{c1}/담{p1}] touch2[볼{c2}/담{p2}] 꿀밤[{k}] | t1: {t1[:60]} | t2: {t2[:60]} | 꿀밤: {kn[:40]}\n"); summ.flush()
    if i % 10 == 0: print(f"{i+1}/{len(heroes)} {h} {time.time()-t0:.0f}s", flush=True)
summ.write(f"\n합계 {json.dumps(stats, ensure_ascii=False)}\n"); print("DONE", stats)
