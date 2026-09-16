# 인물 사전 v2 작성용 — 나무위키 사도 문서에서 말투·성격 관련 절만 뽑아 out/namu-v2/<key>.txt 로 (로컬 전용)
# 남기는 절: 인포박스·개요·소개·성격·대사·관계도·사복·사도 스토리·여담·떡밥.  버리는 절: 스킬·평가·모험회·연회장·친밀도·피규어·어사이드·메인/이벤트 스토리 행적·웹툰 목록
# 실행: python tools/namu-extract-v2.py [key ...]   (키 없으면 bible.json 전원)
import re, os, sys, json
sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.join(os.path.dirname(__file__), "..")
PAGES = os.path.join(ROOT, "out", "namu-pages"); OUT = os.path.join(ROOT, "out", "namu-v2"); os.makedirs(OUT, exist_ok=True)
DROP = ("스킬", "평가", "모험회", "연회장", "친밀도", "피규어", "어사이드", "작중 행적", "공식 웹툰", "성능", "운용", "추천", "스탯", "둘러보기", "공식 사도 PV", "PV", "출시", "인게임 정보")
KEEP = ("대사", "사도 스토리", "사도 이야기", "사복", "관계도", "성격", "여담", "떡밥", "말투", "정체", "특징")
JUNK = re.compile(r"^(▢.*|전열|중열|후열|모든열|딜러|탱커|서포터|사도 목록|분류.*|편집|토론|역사|최근 (변경|토론)|특수 기능|여기에서 검색|\d+|Common Position.*|Icon Graduate.*|Character .*|TR .*|Aside .*|HeroGrade.*|트릭컬 리바이브 로고.*|.*로고|▶|Trickcal .*|\[\[파일:.*)$")
HDR = re.compile(r"^(\d+(?:\.\d+)*)\. (.+)$")

def infobox(t):
    i = t.find("최근 수정 시각"); j = t.find("\n1. 개요", i)
    if i < 0 or j < 0: return ""
    out = []
    for l in t[i:j].splitlines():
        l = l.strip()
        if not l or JUNK.match(l): continue
        l = re.sub(r"^Common \w+\.\.\. ", "", l)
        out.append(l)
    return "[인포박스]\n" + "\n".join(out)

def body(t):
    # namu-pages 사본은 [편집] 표식이 없다 → 문서 앞 목차(첫 "1. 개요" ~ 둘째 "1. 개요")와 똑같은 줄만 절 제목으로 본다
    a = t.find("\n1. 개요\n"); b0 = t.find("\n1. 개요\n", a + 5)
    if a < 0 or b0 < 0: return t[:20000]
    toc = {l.strip() for l in t[a:b0].splitlines() if HDR.match(l.strip())}
    b = t[b0 + 1:]; e = b.find("크리에이티브 커먼즈 라이선스"); b = b[:e] if e > 0 else b
    out, stack, dropped = [], [], False  # stack: [(depth, dropped)]
    for l in b.splitlines():
        ls = l.strip()
        if ls in toc:
            m = HDR.match(ls); depth, title = m.group(1).count(".") + 1, m.group(2).strip()
            while stack and stack[-1][0] >= depth: stack.pop()
            parent_dropped = stack[-1][1] if stack else False
            keep = any(title == k or title.startswith(k) for k in KEEP)
            dropped = (any(k in title for k in DROP) and not keep) or (parent_dropped and not any(k in title for k in KEEP))
            stack.append((depth, dropped))
        if not dropped and not JUNK.match(ls): out.append(l)
    s = "\n".join(out)
    return re.sub(r"\n{3,}", "\n\n", s)

def run(key, ko):
    name = {"xxionx": "시온 더 다크불릿", "renewa_alba": "리뉴아"}.get(key, ko)
    f = os.path.join(PAGES, name + ".txt")
    if not os.path.exists(f): print(key, ko, "문서 없음"); return
    t = open(f, encoding="utf-8").read()
    s = infobox(t) + "\n\n" + body(t)
    open(os.path.join(OUT, key + ".txt"), "w", encoding="utf-8").write(s)
    return len(s)

if __name__ == "__main__":
    b = json.load(open(os.path.join(ROOT, "data", "bible.json"), encoding="utf-8"))
    keys = sys.argv[1:] or [k for k in b if k != "_meta"]
    for k in keys:
        n = run(k, b[k]["ko"]); print(f"{k:16} {b[k]['ko']:12} {n}")
