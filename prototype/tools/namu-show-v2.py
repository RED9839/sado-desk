# v2 작성 보조 — 추출 문서(out/namu-v2/<key>.txt)와 기존 인물 사전 요약을 한 번에 보여 준다. python tools/namu-show-v2.py key [key]
# 잡음(광고·각주·포지션 표·빈 사복 대사 줄·출시일/가격)은 걷어 낸다. LIM 환경변수로 사도당 글자 수 제한.
import json, os, re, sys
sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.join(os.path.dirname(__file__), "..")
b = json.load(open(os.path.join(ROOT, "data", "bible.json"), encoding="utf-8"))
t = json.load(open(os.path.join(ROOT, "data", "talk-ko.json"), encoding="utf-8"))["heroes"]
s = json.load(open(os.path.join(ROOT, "data", "talk-style.json"), encoding="utf-8"))
lim = int(os.environ.get("LIM", "0"))
JUNK = re.compile(r"^(\[\d+\].*|전열|중열|후열|모든열|딜러|탱커|서포터초록:|엘다인|.*Common (Position|Unit).*|\(.*\)|친밀 레벨 \d+ (미만|이상)|출시일|가격|\d{4} / \d{1,2} / \d{1,2}.*|[\d,]+ ?원.*|[\d,]+ 엔.*|이벤트 .*보상.*|.*(쿠팡|www\.|\.co\.kr|\.com|blog\.naver|\.kr|\.me|\.net)\b.*|Trickal .*|.*스킨\.\.\.|◀|▶|트릭컬 성격\(.*\) .*|한국 서버 캐릭터 출시 순|글로벌 서버 캐릭터 출시 순|.*번째 추가 사도|.*출시 순|상세 내용 아이콘.*|Document Protect.*|편집 요청|.*스포일러.*포함.*)$")
def clean(d):
    out = []
    for l in d.splitlines():
        ls = l.strip()
        if not ls or JUNK.match(ls): continue
        out.append(l)
    d = "\n".join(out)
    return re.sub(r"\[\d+\]", "", d)
for k in sys.argv[1:]:
    e = b[k]; tk = next((v for h, v in t.items() if h.lower() == k), {}); sk = s.get(k, {})
    print(f"######## {k} {e['ko']} | talk-ko: style={tk.get('style')} addr={tk.get('addr')} me={tk.get('me')} interj={tk.get('interj')} skins={[v.get('label') for v in (tk.get('skins') or {}).values()]}")
    print(f"talk-style: style={sk.get('style')} addr={sk.get('addrCounts')} me={sk.get('me')} interj={sk.get('interj')} catch={sk.get('catch')} tic={sk.get('tic')} touch={sk.get('endingsTouch')}")
    print("기존 who:", e["who"]); print("기존 traits:", " / ".join(e["traits"])); print("기존 rel:", " · ".join(r.split(":")[0] for r in e["rel"])); print("기존 quirk:", e["quirk"])
    d = clean(open(os.path.join(ROOT, "out", "namu-v2", k + ".txt"), encoding="utf-8").read())
    print("---- 문서 ----"); print(d[:lim] if lim else d); print()
