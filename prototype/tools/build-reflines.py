# -*- coding: utf-8 -*-
"""사도별 실제 대사를 모아 말투 참고용으로 쓴다. 두 군데서:
  (1) 나무위키 '대사' 절 — 깨끗한 글자. 우선
  (2) 극장 OCR 발췌 — 오독이 있어 보조로만
결과 out/_ref-lines.json 은 로컬 전용이다. 배포 데이터에 넣지 않고, 대본을 만들 때 예시로만 쓴다.
나온 대본은 18자 원문 대조로 걸러 원문이 새지 않게 한다(voice-samples 때와 같은 방식)."""
import io, os, re, glob, json, collections
os.chdir(r"C:\projects\사도 데스크\prototype")

talk = json.load(io.open("data/talk-ko.json", encoding="utf-8"))
KO2KEY = {v["ko"]: k.lower() for k, v in talk["heroes"].items()}
HEAD = re.compile(r"^\d+(?:\.\d+)*\.\s*(.+?)\[편집\]\s*$")
# 대사표 안의 구획 이름 — 대사가 아니다
LABEL = re.compile(r"^(친밀도|레벨\s*\d+|상호작용|볼 당기기|꿀밤 때리기.*|쓰다듬기|간지럽히기|친밀 레벨.*|스킬 강화|보드 색칠|장비 장착|레벨 업|승급|어사이드.*|전투|덱 편성|스테이지 진입|등장|일반 공격|강화 공격|저학년 스킬|고학년 스킬|쓰러짐|승리 대사|패배 대사|기타|교단|모험 터치시|로딩 화면|연회장 초대|생일|관심 사도.*|응원사도 배치|아르바이트|시작|성공.*|대성공|실패|PVP.*|사복.*|스킨.*|보이스.*)$")
CLEAN = re.compile(r"\[\d+\]")

wiki = collections.defaultdict(list)
for f in sorted(glob.glob("out/namu/*.txt")):
    L = io.open(f, encoding="utf-8").read().split("\n")
    # 파일 이름에서 사도 이름 (01_가비아.txt)
    # 01_네르_빡침(트릭컬 리바이브).txt → 네르(빡침)
    ko = re.sub(r"^\d+_", "", os.path.basename(f)).replace(".txt", "")
    ko = ko.replace("(트릭컬 리바이브)", "")
    if "_" in ko:
        base, _, tail = ko.partition("_")
        ko = "%s(%s)" % (base, tail) if tail else base
    k = KO2KEY.get(ko)
    if not k: continue
    start = None
    for n, l in enumerate(L):
        m = HEAD.match(l.strip())
        if not m: continue
        if m.group(1).strip() == "대사": start = n + 1
        elif start is not None: break
    if start is None: continue
    for l in L[start:n]:
        s = CLEAN.sub("", l.strip())
        s = re.sub(r"\s*\([^()]{1,24}\)\s*$", "", s)      # (기본 사복) 꼬리표
        if not s or LABEL.match(s): continue
        if re.match(r"^[가-힣A-Za-z0-9 ]{1,12}\s*:", s): continue   # "이름: 대사" 는 스토리 대화
        if not (8 <= len(s) <= 60): continue
        if s not in wiki[k]: wiki[k].append(s)

# 보조: 극장 OCR
OK = re.compile(r"^[가-힣0-9\s.,!?~…·'\"()\-—⋯♪%]+$")
JUNK = re.compile(r"(\.{2,}\s*[0-9]|[A-Za-z]{2,}|[\u3040-\u30ff\u4e00-\u9fff])")
SPEAK = re.compile(r"^([가-힣A-Za-z0-9()· ]{1,14}):\s*(.+)$")
ocr = collections.defaultdict(list)
for f in sorted(glob.glob("out/theater-ocr/digest/*.txt")):
    for line in io.open(f, encoding="utf-8"):
        s = line.strip()
        if not s or s.startswith("#"): continue
        m = SPEAK.match(s)
        if not m: continue
        k = KO2KEY.get(m.group(1).strip())
        if not k: continue
        t = re.sub(r"\s+", " ", m.group(2)).strip(" -—")
        if not (8 <= len(t) <= 60) or JUNK.search(t) or not OK.match(t): continue
        if re.search(r"[가-힣]\d|\d[가-힣]", t) or re.search(r"\s\d\s*$", t): continue
        if t.count("(") != t.count(")"): continue
        if re.search(r"[가-힣]{1,2}\s[가-힣]{1}\s[가-힣]{1,2}", t): continue
        if t not in ocr[k]: ocr[k].append(t)

out = {}
for k in set(list(wiki) + list(ocr)):
    v = wiki[k][:30] + [x for x in ocr[k] if x not in wiki[k]][:10]
    if len(v) >= 3: out[k] = v
io.open("out/_ref-lines.json", "w", encoding="utf-8", newline="\n").write(json.dumps(out, ensure_ascii=False, indent=1))
n = sum(len(v) for v in out.values())
rep = ["사도 %d명 · 참고 대사 %d줄 (평균 %.1f)" % (len(out), n, n / len(out)),
       "위키에서 %d줄 · OCR 보조 %d줄" % (sum(len(v[:30]) for v in wiki.values()), n - sum(len(v[:30]) for v in wiki.values())),
       "10줄 이상 %d명 · 5줄 이상 %d명" % (len([1 for v in out.values() if len(v) >= 10]), len([1 for v in out.values() if len(v) >= 5]))]
for k in ("jubee", "butter", "daya", "vivi", "momo"):
    if k in out: rep += ["", "[%s] %d줄" % (k, len(out[k]))] + ["  " + x for x in out[k][:5]]
io.open("out/_reflines.txt", "w", encoding="utf-8", newline="\n").write("\n".join(rep))
