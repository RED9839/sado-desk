# -*- coding: utf-8 -*-
"""STT 대본(out/scripts/<hero>.jsonl)으로 사도별 말투 분석 → data/talk-style.json + 현재 talk-ko.json과의 차이 보고
사용: python tools/analyze-scripts.py [--apply]   (--apply: 고신뢰 style/addr 차이를 data/talk-ko.json에 반영)
분석: 문장 어미 분포(해요/합니다/반말/특수 어미) · 2인칭 호칭 · 자칭 · 감탄사 · 특징 표현(다른 사도 대비 많이 쓰는 말) · 대표 대사 표본
"""
import os, re, json, glob, argparse, collections, math

SCRIPTS = "out/scripts"
TALK = "data/talk-ko.json"
OUT = "data/talk-style.json"

# 어미 규칙 — 순서대로 첫 매치 (특수 어미 → 격식 → 해요 → 반말)
ENDINGS = [
    ("jubee", re.compile(r"다비[!?~.…]*$")),
    ("ayla", re.compile(r"그마[!?~.…]*$")),
    ("vivi", re.compile(r"사와요[!?~.…]*$")),
    ("momo", re.compile(r"(닷|입니닷|습니닷)[!?~.…]*$")),
    ("haso", re.compile(r"(옵니다|사옵니다|옵소서|시옵|나이다|사옵니까|시옵니까)[!?~.…]*$")),
    ("royal", re.compile(r"(노라|이니라|니라|거라|느냐|하라|로다|도다|하게|시게|게나|겠노)[!?~.…]*$")),
    ("hao", re.compile(r"(이오|하오|소이다|구려|시오|겠소|았소|었소|하겠소|이겠소|리오)[!?~.…]*$")),
    ("formal", re.compile(r"(니다|십시오|십니까|습니까|십쇼|시지요)[!?~.…]*$")),  # ~ㅂ니까(합니까/됩니까)는 ending_of에서 종성 검사로
    ("polite", re.compile(r"(요|죠|네요|군요|에요|예요|세요|까요|데요|래요|게요|잖아요|거예요|거든요|나요|셨어요|였어요|었어요|았어요)[!?~.…]*$")),
    ("noun", re.compile(r"(함|임|음|됨|됐음|했음|있음|없음|바람|요망)[!?~.…]*$")),
    ("casual", re.compile(r"(야|어|아|지|다|네|냐|니|자|래|줘|봐|군|구나|는데|거든|잖아|게|까|걸|는걸|을걸|거야|텐데|라고|다고|냐고|니까|해|돼|든|나|누|래도|어도|아도|는걸|는군|더라|던데|다니|라니|거지|겠지|을게|을까|을래|을걸)[!?~.…]*$")),
]
FRAG = re.compile(r"(서|고|면|데|라|는|을|를|이|가|에|의|과|와|도|로|만)$")  # 문장이 끊긴 조각 — 어미 집계에서 제외
ADDR_WORDS = ["교주님", "교주", "주인님", "주인", "마스터", "선생님", "선생", "사도님", "언니", "오빠", "누나", "형", "아저씨", "그대", "당신", "자네", "너", "넌", "네가", "니가", "님", "친구", "교수님", "교장님", "사장님", "휴먼", "대장", "단장", "손님", "고객님", "용사", "여보", "자기"]
ME_WORDS = ["저는", "제가", "저도", "저를", "나는", "내가", "나도", "나를", "난", "본인", "이 몸", "소녀", "짐은", "짐이", "소인", "오레", "우리"]
# 개성이 드러나는 감탄사만 (어/아/응/음/네/그래/좋아 같은 범용 응답어는 제외)
INTERJ = ["흥", "훗", "후후", "하하", "하핫", "헤헤", "히히", "에헤헤", "우헤헤", "으헤헤", "이히히", "쿠쿠", "큭", "킥킥", "흐응", "흐음", "으음", "어라", "앗", "아앗", "우와", "와아", "오오", "에엥", "으엥", "흐엥", "우우", "으으", "아이고", "어머", "어라라", "에잇", "칫", "쳇", "야호", "만세", "꺄", "꺄아", "하아", "후우", "휴", "흠", "오호", "호오", "네에", "엥", "어이", "얍", "냐", "냥", "뿅", "삐약", "꼬꼬", "으하하", "우하하", "이얍", "오홍", "후훗", "히힛", "에헴", "흐흐", "크크", "우와아", "꺄악", "으악", "히익", "아하", "오옷", "어엇"]
JOSA = re.compile(r"(에서|으로|에게|한테|까지|부터|처럼|보다|이랑|랑|을|를|이|가|은|는|의|도|에|로|와|과|야|아|께|만)$")
def stem(w):  # 조사 떼기 (2글자 이상 남을 때만)
    m = JOSA.search(w); return w[:-len(m.group(1))] if m and len(w) - len(m.group(1)) >= 2 else w
PLAYER_CATS = {"affinity", "callplayer", "line", "greeting", "touch", "dutchrubend", "lobby", "birthday", "telephonecall", "levelup", "growth", "heroupgrade", "equipment", "decksetting", "board", "gacha", "yes", "no", "hmm", "eat", "themeinteraction"}
STOP = set("그 이 저 것 수 있 없 하 되 나 너 우리 그리고 그래서 하지만 정말 진짜 이제 지금 오늘 여기 거기 다 더 또 좀 아주 너무 매우 안 못 잘 같이 함께 뭐 왜 어떻게 누가 언제 어디 그냥 그런 이런 저런 그게 이게 저게 근데 그럼 그러면 아니 응 네 예 음 아 어".split())

def sentences(text):
    t = re.sub(r"\s+", " ", text or "").strip()
    if not t: return []
    parts = re.split(r"(?<=[.!?…~])\s+|(?<=[.!?…])(?=[가-힣])", t)
    return [p.strip() for p in parts if len(p.strip()) >= 2]

def jong(ch):  # 종성 인덱스 (0 = 없음, 17 = ㅂ)
    o = ord(ch) - 0xAC00; return (o % 28) if 0 <= o < 11172 else -1
def ending_of(s):
    core = re.sub(r"[\"'“”‘’()\[\]]", "", s).strip()
    core = re.sub(r"[.!?~…,\s]+$", "", core)
    if not core or not re.search(r"[가-힣]$", core): return None
    if len(core) <= 4 and " " not in core: return None  # 이름·감탄사·한 단어("헉", "교주님?", "얍!")는 어미 집계 제외
    if core.endswith("니까") and len(core) >= 3 and jong(core[-3]) == 17: return "formal"  # 합니까 / 됩니까 / 겁니까
    for name, rx in ENDINGS:
        if rx.search(core): return name
    if FRAG.search(core): return None
    return "casual"

def tokens(text):
    return [w for w in re.findall(r"[가-힣]{2,}", text or "")]

def analyze_hero(recs):
    lines = [r for r in recs if r.get("text")]
    story = [r for r in lines if r["cat"] == "story"]
    endings = collections.Counter(); n_sent = 0; end_lobby = collections.Counter(); end_story = collections.Counter(); end_touch = collections.Counter()
    addr = collections.Counter(); me = collections.Counter(); interj = collections.Counter(); words = collections.Counter()
    for r in lines:
        t = r["text"]
        for s in sentences(t):
            e = ending_of(s)
            if e and not r.get("skin"):
                endings[e] += 1; n_sent += 1
                if r["cat"] == "story": end_story[e] += 1
                elif r["cat"] in PLAYER_CATS:
                    end_lobby[e] += 1  # 교주에게 하는 말만 (전투 외침·등장·승리는 제외)
                    if r["cat"] in ("touch", "dutchrubend"): end_touch[e] += 1  # 확실히 교주를 향한 말(교감 반응)
            first = re.match(r"^([가-힣]{1,4})[,.!~…?]", s)
            if first and first.group(1) in INTERJ: interj[first.group(1)] += 1
        for w in ADDR_WORDS:
            c = len(re.findall(r"(?<![가-힣])" + re.escape(w) + r"(?![가-힣])", t))
            if c: addr[w] += c
        for w in ME_WORDS:
            c = len(re.findall(r"(?<![가-힣])" + re.escape(w) + r"(?![가-힣])", t))
            if c: me[w] += c
        for w in tokens(t):
            w = stem(w)
            if w not in STOP and len(w) >= 2: words[w] += 1
    total = sum(endings.values()) or 1
    dist = {k: round(v / total, 3) for k, v in endings.most_common()}
    norm = lambda c: {k: round(v / (sum(c.values()) or 1), 3) for k, v in c.most_common()}
    dist_lobby, dist_story, dist_touch = norm(end_lobby), norm(end_story), norm(end_touch)
    # 마스코트는 교주(플레이어)에게 말하므로 로비 대사 어미가 기준(로비 문장 15개 이상일 때). 스토리는 다른 사도와의 대화라 반말이 섞임
    base = dist_lobby if sum(end_lobby.values()) >= 15 else dist
    # 지배 어미: 특수 어미가 15% 이상이면 그것(캐릭터 말버릇), 아니면 최다
    # 고유 말버릇 어미(다비/그마/사와요/닷/옵니다)는 15%만 넘어도 그 사도의 것. royal/hao는 명령형·문어체가 섞여 잡히므로 35% 이상일 때만
    special = [(k, v) for k, v in base.items() if k not in ("polite", "formal", "casual", "noun") and v >= (0.35 if k in ("royal", "hao") else 0.15)]
    dominant = special[0][0] if special else (max(base, key=base.get) if base else "polite")
    # 교주/교주님 → '교주님'이 교주보다 많으면 님
    a = None; gn, g = addr.get("교주님", 0), addr.get("교주", 0)
    if gn + g >= 3: a = "교주님" if gn >= max(3, g * 2) else ("교주" if g >= max(3, gn * 2) else None)
    elif addr: a = addr.most_common(1)[0][0]
    return {
        "n": len(lines), "nStory": len(story), "nSent": n_sent,
        "endings": dist, "endingsLobby": dist_lobby, "endingsStory": dist_story, "endingsTouch": dist_touch, "nLobbySent": sum(end_lobby.values()), "nTouchSent": sum(end_touch.values()), "style": dominant,
        "addr": a, "addrCounts": dict(addr.most_common(6)),
        "me": dict(me.most_common(5)), "interj": [k for k, v in interj.most_common(6) if v >= 2],
        "_words": words,
        "lines": lines,
    }

def pick_samples(lines, style, n=20):
    # 8~45자, 화자 성격이 드러나는 문장 우선(어미가 지배 어미인 것), 스토리·로비 섞어서, 중복 제거
    seen = set(); out = []
    cand = []
    norm = lambda t: re.sub(r"[^가-힣0-9]", "", t)
    for r in lines:
        t = re.sub(r"\s+", " ", r["text"]).strip()
        if not (8 <= len(t) <= 45) or norm(t) in seen: continue
        if re.search(r"[A-Za-z぀-ヿ一-鿿]", t): continue
        seen.add(norm(t))
        ends = [ending_of(s) for s in sentences(t)]
        special = style not in ("polite", "formal", "casual", "noun")
        if special and r["cat"] == "story" and style not in ends: continue  # 고유 어미 사도(비비·쥬비…)의 스토리 표본은 그 어미가 실제로 들린 문장만 (STT 오인식 방지)
        score = (2 if style in ends else 0) + (1 if r["cat"] != "story" else 0) + (1 if "!" in t or "~" in t else 0) + (1 if 12 <= len(t) <= 30 else 0)
        cand.append((score, r["cat"] == "story", t))
    cand.sort(key=lambda x: (-x[0]))
    story = [c for c in cand if c[1]][: n // 2 + 2]
    lobby = [c for c in cand if not c[1]][: n - len(story)]
    out = [c[2] for c in lobby + story][:n]
    return out

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--apply", action="store_true"); ap.add_argument("--min", type=int, default=15); a = ap.parse_args()
    talk = json.load(open(TALK, encoding="utf-8"))
    key_of = {k.lower(): k for k in talk["heroes"]}
    per = {}
    for f in sorted(glob.glob(os.path.join(SCRIPTS, "*.jsonl"))):
        hero = os.path.basename(f)[:-6]
        recs = [json.loads(l) for l in open(f, encoding="utf-8") if l.strip()]
        if len([r for r in recs if r.get("text")]) < a.min: continue
        per[hero] = analyze_hero(recs)
    # 특징 표현: 다른 사도 대비 비율 (단어가 그 사도 문장에서 차지하는 비율 / 전체 비율)
    glob_words = collections.Counter()
    for h, r in per.items(): glob_words.update(r["_words"])
    G = sum(glob_words.values()) or 1
    result = {}
    for h, r in per.items():
        W = sum(r["_words"].values()) or 1
        catch = []
        BAD_TAIL = re.compile(r"(요|다|어|지|아|야|니|까|네|고|서|면|죠|라|자|게|든|나)$")  # 용언 조각·어미 붙은 것 제외 → 명사(사람·물건·소재)만
        BAD = {"어떤", "것이", "와요", "그것", "이것", "저것", "무슨", "어디", "누구", "이런", "그런", "여기", "거기", "저기", "우리", "너희", "당신", "자기"}
        for w, c in r["_words"].most_common(600):
            if c < 4: break
            if w in BAD or BAD_TAIL.search(w): continue
            ratio = (c / W) / (glob_words[w] / G)
            if ratio >= 8 and len(w) >= 2: catch.append((w, c, round(ratio, 1)))
        catch.sort(key=lambda x: -x[1])
        result[h] = {k: v for k, v in r.items() if not k.startswith("_") and k != "lines"}
        result[h]["catch"] = [w for w, c, ratio in catch[:12]]
        result[h]["samples"] = pick_samples(r["lines"], r["style"])
    json.dump(result, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    # ---- 현재 프로필과 비교 ----
    rows = []; changes = {}
    for h, r in result.items():
        k = key_of.get(h)
        if not k: continue
        cur = talk["heroes"][k]
        d_style = cur["style"] != r["style"]; d_addr = r["addr"] and cur.get("addr") != r["addr"]
        if d_style or d_addr:
            rows.append(f"{k:18s} n={r['n']:4d} lobby={r['nLobbySent']:3d}  style {cur['style']:>7s} → {r['style']:<7s} {'*' if d_style else ' '}  {json.dumps(r['endingsLobby'], ensure_ascii=False)[:60]} touch={json.dumps(r['endingsTouch'], ensure_ascii=False)[:40]}  addr {cur.get('addr')} → {r['addr']} {'*' if d_addr else ' '} {json.dumps(r['addrCounts'], ensure_ascii=False)[:60]}")
            ch = {}
            top = max(r["endings"].values()) if r["endings"] else 0
            base = r["endingsLobby"] if r["nLobbySent"] >= 15 else r["endings"]; top = max(base.values()) if base else 0
            touch_top = max(r["endingsTouch"], key=r["endingsTouch"].get) if r["nTouchSent"] >= 5 else None  # 교감 반응(확실히 교주에게)의 지배 어미와 일치할 때만
            if d_style and cur["style"] in ("polite", "formal", "casual") and r["nLobbySent"] >= 30 and r["style"] in ("polite", "formal", "casual") and top >= 0.65 and touch_top == r["style"]: ch["style"] = r["style"]
            if d_addr and r["addr"] in ("교주", "교주님") and cur.get("addr") in ("교주", "교주님", None): ch["addr"] = r["addr"]
            if ch: changes[k] = ch
    print(f"분석 사도 {len(result)}명 / 프로필 매칭 {sum(1 for h in result if h in key_of)}명 / 차이 {len(rows)}건 / 고신뢰 반영 후보 {len(changes)}건")
    for row in rows: print(row)
    print("\n고신뢰 반영:", json.dumps(changes, ensure_ascii=False))
    if a.apply:
        for k, ch in changes.items(): talk["heroes"][k].update(ch)
        json.dump(talk, open(TALK, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
        print("talk-ko.json 반영 완료")

if __name__ == "__main__":
    main()
