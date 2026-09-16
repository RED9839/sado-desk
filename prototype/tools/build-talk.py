"""나무위키 캐시(scratch/namu/pages/<한글이름>.txt)의 '대사' 절에서 사도별 말투 프로필을 뽑는다 → assets/talk-ko.json
프로필: style(어미 부류) · addr(교주 호칭) · interj(자주 쓰는 감탄사) · share(어미 분포) · n(표본 수)
대사 원문은 배포 데이터에 넣지 않는다(2차 창작 가이드라인). 표본은 out/talk-report.md 에만 남는다.
사용: python tools/build-talk.py <namu_pages_dir>
style 판정은 어미 통계 + 수동 보정(OVERRIDE). 결과 요약은 out/talk-report.md"""
import json, os, re, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
PAGES = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.environ.get("TEMP", ""), "namu", "pages")
names = json.load(open(os.path.join(ROOT, "data", "names-ko.json"), encoding="utf-8"))

HEADINGS = set("""친밀도 상호작용 볼 당기기 꿀밤 때리기 쓰다듬기 스킬 강화 보드 색칠 장비 장착 레벨 업 승급 어사이드 발현 어사이드 승급 전투 덱 편성 스테이지 진입 승리 패배 기타 로비 로딩 화면 연회장 초대 생일 관심 사도 지정 관심 사도 해제 응원사도 배치 모험 터치시 등장 뽑기 궐기 사망 피격 기본 공격 강공격 스킬 사용 사도 강화 사도 호출 플레이어 호출 교단 대사 [편집] 궐기 시 사용 스킬 사용 시 전투 시작 전투 승리 전투 패배 필살기 초콜릿 선물""".split("\n")[0].split("  ") if False else [])
HEADING_RE = re.compile(r"^(레벨 ?\d+|친밀 레벨 .*|\d{4}년.*|\[편집\]|\d+(\.\d+)*\.? .*|친밀도|상호작용|볼 당기기|꿀밤 때리기.*|쓰다듬기|스킬 강화|보드 색칠|장비 장착|레벨 업|승급|어사이드 발현|어사이드 승급|전투|덱 편성|스테이지 진입|승리|패배|기타|로비|로딩 화면|연회장 초대|생일|관심 사도 (지정|해제)|응원사도 배치|모험 터치시|등장|뽑기|궐기|사망|피격|기본 공격|강공격|스킬 사용|교단|대사|간식|간식 주기|선물|호출|사도 호출|플레이어 호출|성장|승급 .*|테마극장.*|이벤트.*|만우절.*|콜라보.*|웹툰.*|유튜브.*|PV.*)$")

END_RULES = [  # (style, regex on 어미(문장부호 제거 후))
    ("haso", re.compile(r"(옵니다|옵소서|옵나이다|사옵니까|옵니까|나이다)$")),
    ("vivi", re.compile(r"(사와요|시와요|이와요|와요)$")),
    ("noun", re.compile(r"(함|임|음|됨|봄|감|옴|짐|남|림|듦|줌|삼|섬|굼|힘|냄|켬|픔|름|뜸|쁨|낌|밈|김|낌)$")),
    ("royal", re.compile(r"(거라|노라|느냐|이냐|것이냐|다만|니라|로다|더냐|도다|하라|말거라|겠노라|것인가|하였다|하겠다|하였느냐|이더냐|리라|리다)$")),
    ("hao", re.compile(r"(소|오|구려|시오|외다|하오|이오|다오|리오)$")),
    ("formal", re.compile(r"(습니다|입니다|니다|십시오|습니까|입니까|니까|십니다|시죠|시지요|슴다|슴둥|함다|임다|십쇼|입쇼)$")),  # 뒤쪽은 군대식 어미
    ("polite", re.compile(r"(요|죠|세요|에요|예요|네요|군요|게요|을게요|까요|지요|래요|나요|어요|아요)$")),
    ("casual", re.compile(r"(다|어|야|지|해|래|자|네|군|나|거|걸|데|고|까|냐|니|봐|줘|아|게|걔|래|마|든|랬|쟤|응|엉|엥)$")),
]
ADDR = ["교주님", "교주", "주인님", "주인", "교장님", "교장", "교수님", "교수", "선생님", "톤", "당신", "자네", "그대", "너", "네가", "니가", "사장님", "대장", "보스", "형", "오빠", "언니", "누나", "아저씨", "손님", "인간", "휴먼", "꼬맹이", "마스터", "님", "선배", "친구", "동지", "손", "소녀", "본좌", "이 몸", "소인"]
INTERJ_RE = re.compile(r"^([가-힣]{1,4}~?)[,!~.…⋯?]\s")
INTERJ_OK = re.compile(r"^(헤헤|헤헷|후후|흐흐|히히|흥|훗|하하|호호|우으|으으|에헤헤|에헤|냥|꼬끼오|크헤헤|우우|음|오이|후우|하아|우움|앗|에엥|오오|에헴|음냐|하핫|에엣|우와|와|오|아|앙|흐엥|에구|어라|어이|얏|후훗|킁|끄응|우유|오호|오홋|허허|허|흠|흐음|크크|캬하|이야|음음|아하|아이|어머|저기|저|이봐|야|잠깐|응|엥|어|오잇|삐약|삐야|꺄|꺄악|우왓|뿌|퓨|풋|킥|콜록|크앙|가르릉|고롱|멍|찹|쩝|냐|냐하|냐옹|헷|헤|홋|후|우|으|이|오라|고맙|좋|끼|삐|뿅|찌|째|뽀|묘|뮤|삐이|쪼|쫑|톡|딸|딸랑|깡|꿍|뀨|끄|끙|쿨|쿠|큐|퀴|킁킁|흡|흣|흥흥|흐응|흐엉|후욱|하암|하압|하) *~?$")
SKIN_SUFFIX = re.compile(r"\s*\(([^()]{1,30})\)\s*$")
FOOTNOTE = re.compile(r"\[\d+\]")
STRIP_END = re.compile(r"[\s.!?~…⋯'\"”’)\]♪♡☆★]+$")

# 수동 보정: 어미 통계로 잡기 어려운 개성 말투
# Polan: 실측 casual 0.37 은 부하에게 내리는 명령이다. 교주 앞에서는 합니다체라 formal 을 유지한다.
# Canna: 실측 casual 0.40 은 직속 부하에게 말을 놓기 때문이다. 교주 앞에서는 존댓말이라 formal 을 유지한다.
OVERRIDE = {
    "Haley": {"interj_add": ["크흠", "훗"]},
    "Youngchun": {"interj_add": ["으이익", "핫"]},
    "Goldy": {"interj_add": ["오", "음"]},
    "Hilde": {"interj_add": ["후훗", "어머"]},
    "HaleySane": {"interj_add": ["후후", "흠"]},
    "Heidi": {"interj_add": ["아핫", "오오"]},
    "Pira": {"interj_add": ["케헤헤", "이야이야"]},
    "Fricle": {"interj_add": ["치잇", "후웃"]},
    "Posher": {"interj_add": ["후후", "에잉"]},
    "Festa": {"interj_add": ["피스", "하핫"]},
    "Patula": {"interj_add": ["으잇", "엣"]},
    "TigHero": {"interj_add": ["흐하하", "크윽"]},
    "Kishya": {"interj_add": ["히힛", "야호"]},
    "Kidian": {"interj_add": ["으음", "헤헤"]},
    "Chloe": {"interj_add": ["흐흥", "으으"]},
    "KommySwim": {"interj_add": ["후후", "으으"]},
    "Kyarot": {"interj_add": ["쿠헤헤", "얏호"]},
    "Carren": {"interj_add": ["흐에엥", "으흐흑"]},
    "Chopi": {"interj_add": ["퍄오옹", "흐에엑"]},
    "Joanne": {"interj_add": ["으윽", "으응"]},
    "Jade": {"interj_add": ["후후", "으으"]},
    "Ifrit": {"interj_add": ["으음", "후우"]},
    "EdRehab": {"interj_add": ["헤헤", "영차"]},
    "Ed": {"interj_add": ["으음", "후훗"]},
    "Yumimi": {"interj_add": ["캬", "으음"]},
    "Ui": {"interj_add": ["히히", "헤헤"]},
    "Uros": {"interj_add": ["스하핫", "으음"]},
    "Yomi": {"interj_add": ["후훗", "으음"]},
    "Opal": {"interj_add": ["어허", "에헤헤"]},
    "Orr": {"interj_add": ["으으", "으앗"]},
    "Aurora": {"interj_add": ["후후", "으으"]},
    "Elena": {"interj_add": ["흐흥", "크흠"]},
    "Espi": {"interj_add": ["큭큭", "헤헤"]},
    "AshurMagi": {"interj_add": ["후훗", "헤헤"]},
    "ErpinRoyale": {"interj_add": ["쒸이", "으음"]},
    "Alice": {"interj_add": ["으히히", "으흐흐"]},
    "Mayo": {"style": "noun", "addr": "수집품"}, "MayoCool": {"style": "noun", "addr": "수집품"},
    "Vivi": {"style": "vivi", "interj_add": ["오호호", "엣취"]},
    "Daya": {"style": "royal", "addr": "교주"}, "DayaPureShine": {"style": "royal", "me": None}, "Belita": {"style": "royal", "interj_add": ["후으"]},
    "Inkle": {"style": "hao", "interj_add": ["잉잉", "흐하"]}, "Epica": {"style": "hao", "me": "소인", "interj_add": ["후훗", "오호", "흠흠"]}, "EpicaSkin2": {"style": "hao"},
    "MaestroMK2": {"style": "robot", "addr": "휴먼"},
    "Crepe": {"style": "crepe", "addr": "교주님", "interj_add": ["헤헤", "흐아앙"]},
    "Cuee": {"interj_add": ["오익", "오잉", "오이오이"]}, "Naia": {"interj_add": ["퓨퓨~"]}, "Diana": {"interj_add": ["에구구"]}, "Rollett": {"interj_add": ["울랄라"]}, "Kommy": {"interj_add": ["하암", "냥"]}, "Mago": {"interj_add": ["히힛"], "addr": "교주님"}, "Marie": {"interj_add": ["에헤헷"]}, "Makasha": {"interj_add": ["이-히힛"], "addr": "긴긴-팔다리"}, "Barong": {"interj_add": ["으흐흐"]}, "Leets": {"interj_add": ["크하하"], "style": "polite"}, "Rim": {"style": "polite", "interj_add": ["푸흡"]}, "RimChaos": {"style": "polite", "interj_add": ["으흐흐"]},
    # 림 자매는 교주 대면 대사가 해요·합쇼체다. 실측 casual 은 레벨업 같은 혼잣말이 끌어올린 값
    "Jubee": {"style": "jubee", "interj_add": ["애애앵", "푸헤헤"]}, "Ayla": {"style": "ayla"}, "Momo": {"style": "momo"},
    "Barie": {"style": "polite", "addr": "교주님"}, "Speaki": {"interj_add": ["흐에엥", "으으"]}, "SpeakiMaid": {"style": "polite", "interj_add": ["헤헷", "으으"]}, "Skea": {"style": "polite", "interj_add": ["으음", "후후"]}, "Sherum": {"style": "polite"},
    "AmeliaR41": {"style": "casual", "me": "이 몸"}, "Aya": {"interj_add": ["후후"]}, "Asana": {"interj_add": ["후우"]}, "Arco": {"interj_add": ["이야", "와우"]}, "Aragnia": {"me": "짐", "interj_add": ["아하핫"]}, "Silvia": {"style": "haso", "me": "소녀", "interj_add": ["오호호"]}, "Arnet": {"interj_add": ["헤헤", "아하핫"]}, "Silphir": {"interj_add": ["으윽", "헤헷"]}, 
    "Shasha": {"addr": "교주님", "interj_add": ["으으"]}, "Suro": {"addr": "교주님", "interj_add": ["으음"]}, "BeniBeni": {"addr": "교주님", "style": "polite", "interj_add": ["흐헷", "오오"]},
    # 대사표의 "교장님"(에슈르)·"교수님"은 남을 부른 말이 호칭 집계에 섞인 것이라 교주님으로 되돌린다
    "Butter": {"addr": "교주님", "me": "버터", "interj_add": ["와아"]}, "Renewa": {"addr": "교주님"}, "RenewaAwaken": {"addr": "교주님"}, "Lazy": {"addr": "교주님"},
    # 교주를 달리 부르는 사도 — 극장 대본 실측(마카샤 21회, 피코라 49회)
    "Picora": {"addr": "스승님", "interj_add": ["흠흠", "우으"]},
    "Erpin": {"addr": "교주", "interj_add": ["히히", "에헤헤", "쒸이"]}, "Scizor": {"interj_add": ["아하핫", "우히힛", "흐후후"]}, "Sist": {"style": "polite", "interj_add": ["헤헤", "아이고"]}, "Taida": {"style": "polite", "interj_add": ["에휴", "으으"]}, "Rohne": {"style": "polite"},
    # 네르 실측 해요 51% > 합니다 29%, 니콜은 교주 앞에서만 해요체(혼잣말은 반말)
    "Ner": {"style": "polite"}, "Nicole": {"style": "polite", "interj_add": ["파팝!", "크헤헷"]},
    "Beni": {"style": "polite", "interj_add": ["으음"]}, "Veroo": {"interj_add": ["이히히", "에헤헤"]}, "Vela": {"interj_add": ["히힛", "아하하"]}, "Velvet": {"interj_add": ["흠", "캬하"]}, "Blanchet": {"interj_add": ["후후"]}, "Selline": {"interj_add": ["후훗", "아하하"]}, "Shady": {"interj_add": ["히히", "으흐흐"]}, "ShadyTwisted": {"interj_add": ["히히", "흐흐"]}, "Sari": {"style": "polite", "interj_add": ["와아", "우후"]}, "Canna": {"style": "formal", "interj_add": ["으하하", "으으"]}, "Polan": {"style": "formal", "interj_add": ["으윽", "흠"]},
    # 그윈은 반말을 쓰면서도 호칭에만 님을 붙인다. 네르(빡침)은 실측 해요 65%로 본체와 같은 이유
    "Guin": {"addr": "교주님"}, "NerRage": {"style": "polite"},
    "Shoupan": {"me": "슈팡", "interj_add": ["으하하", "우히히"]}, "Rufo": {"addr": "교주"}, "Tig": {"addr": "교주", "interj_add": ["크핫", "흐흐"]}, "Ashur": {"addr": "교주", "interj_add": ["으음", "으으"]}, "Sparrot": {"addr": "교장", "me": "이 몸", "interj_add": ["요호호", "야아알", "큭큭"]}, "Canta": {"addr": "교주", "interj_add": ["키히히", "으윽"]},
    "Snorky": {"style": "formal", "addr": "돈"}, "Kathy": {"style": "polite", "interj_add": ["히익", "흐윽"]}, 
}

def safe(ko): return re.sub(r'[\\/:*?"<>|]', "_", ko)

def extract_section(text):
    lines = text.split("\n")
    idx = [i for i, l in enumerate(lines) if re.match(r"^\d+(\.\d+)*\. 대사$", l.strip()) or l.strip() == "대사"]
    if not idx: return []
    start = idx[-1] + 1
    out = []; sec = "친밀도"  # 소제목 추적: 인용(quotes)은 친밀도(로비) 대사만 쓴다
    for l in lines[start:]:
        s = l.strip()
        if re.match(r"^\d+(\.\d+)*\. \S", s) and "대사" not in s: break  # 다음 절
        if not s or s == "[편집]": continue
        if s in ("친밀도", "상호작용", "볼 당기기", "꿀밤 때리기", "쓰다듬기", "전투", "기타", "로비", "스킬 강화", "보드 색칠", "장비 장착", "레벨 업", "승급", "어사이드 발현", "어사이드 승급", "덱 편성", "스테이지 진입", "승리", "패배", "모험 터치시", "로딩 화면", "연회장 초대", "생일") or re.match(r"^꿀밤 때리기", s): sec = s.split("[")[0]
        out.append((s, sec))
    return out

def clean_line(s, ko, keep_skin=False):
    """대사 한 줄 정리. keep_skin=True면 (텍스트, 스킨명|None) 반환 — 스킨 전용 대사도 살린다"""
    s = FOOTNOTE.sub("", s).strip()
    if HEADING_RE.match(s): return None
    # "이름: 대사" 형태의 로비 대화 → 본인 대사만
    m = re.match(r"^([가-힣A-Za-z0-9 ]{1,12})\s*:\s*(.+)$", s)
    if m:
        if m.group(1).strip() != ko: return None
        s = m.group(2).strip()
    # (스킨/언어) 꼬리표
    skin = None
    m = SKIN_SUFFIX.search(s)
    if m and not re.search(r"[.!?~…⋯]", m.group(1)):
        inner = m.group(1); s = s[:m.start()].strip()
        parts = inner.split("/")
        skin = parts[0].strip(); lang = parts[1].strip() if len(parts) > 1 else "韓"
        if lang not in ("韓", "한", "KR", "kr"): return None
        if skin in ("기본 사복", "기본"): skin = None
        if skin and not keep_skin: return None
    if not s: return None
    if len(re.findall(r"[가-힣]", s)) < 2: return None
    if re.match(r"^(내용|없음|-|\?)$", s): return None
    if len(s) > 90: return None  # 설명문
    if re.search(r"(대사다|볼드체|표시는|스킨|코스튬|음성|성우)", s): return None  # 위키 주석
    return (s, skin) if keep_skin else s

def ending_style(line):
    core = STRIP_END.sub("", line)
    for style, rx in END_RULES:
        if rx.search(core): return style
    return None

def profile(hero, ko, lines, affinity=None):
    cnt = collections.Counter(filter(None, (ending_style(l) for l in lines)))
    total = sum(cnt.values()) or 1
    share = {k: v / total for k, v in cnt.items()}
    style = "polite"
    for sp in ["haso", "vivi", "noun", "royal", "hao"]:
        if share.get(sp, 0) >= 0.28: style = sp; break
    else:
        f, p, c = share.get("formal", 0), share.get("polite", 0), share.get("casual", 0)
        if f >= 0.35 and f >= p: style = "formal"
        elif p >= 0.3 and p >= c * 0.9: style = "polite"
        elif c > p: style = "casual"
        else: style = "polite"
    # 호칭
    ac = collections.Counter()
    for l in lines:
        for a in ADDR:
            n = len(re.findall(r"(?<![가-힣])" + re.escape(a) + r"(?![가-힣])", l))
            if n: ac[a] += n
    for a in ["교주님", "교주", "주인님", "주인"]:  # '교주'는 '교주님' 포함 카운트 보정
        pass
    if ac.get("교주") and ac.get("교주님"): ac["교주"] -= ac["교주님"]
    if ac.get("주인") and ac.get("주인님"): ac["주인"] -= ac["주인님"]
    if ac.get("교장") and ac.get("교장님"): ac["교장"] -= ac["교장님"]
    if ac.get("교수") and ac.get("교수님"): ac["교수"] -= ac["교수님"]
    me_c = collections.Counter({k: sum(len(re.findall(r"(?<![가-힣 ])" + re.escape(k) + r"(?=[은는이가를의도]|에게|한테)", l)) for l in lines) for k in ("이 몸", "소인", "소녀", "짐", "본좌")})
    me = me_c.most_common(1)[0][0] if me_c and me_c.most_common(1)[0][1] >= 3 else None
    ac = collections.Counter({k: v for k, v in ac.items() if v > 0 and k not in ("너", "네가", "니가", "님", "손", "이 몸", "소인", "소녀", "본좌")})
    top = ac.most_common(1)[0] if ac else None
    weak = {"친구": 3, "대장": 4, "마스터": 2, "당신": 3, "자네": 2, "그대": 2, "선배": 3, "형": 3, "언니": 3, "누나": 3, "오빠": 3, "손님": 3, "인간": 3, "동지": 3, "보스": 3}
    addr = top[0] if top and top[1] >= weak.get(top[0], 1) else ("교주" if style in ("casual", "noun", "royal") else "교주님")
    # 감탄사
    ic = collections.Counter()
    for l in lines:
        m = INTERJ_RE.match(l)
        if m and INTERJ_OK.match(m.group(1)): ic[m.group(1)] += 1
    interj = [k for k, v in ic.most_common(6) if v >= 2] or [k for k, v in ic.most_common(2)]
    # 자기 3인칭
    third = sum(1 for l in lines if re.search(r"(?<![가-힣])" + re.escape(ko.split("(")[0]) + r"(?:가|는|도|의|한테|를|이|은)?(?![가-힣])", l)) / max(1, len(lines))
    ov = OVERRIDE.get(hero, {})
    if "style" in ov: style = ov["style"]
    if style in ("formal", "haso", "momo", "vivi") and addr == "교주": addr = "교주님"  # 높임 어미엔 호칭도 높임
    if "addr" in ov: addr = ov["addr"]
    interj = [i for i in interj if (len(i.rstrip("~!")) >= 2 and i.rstrip("~!") not in ("으으", "우우", "저기", "잠깐", "이봐", "음음", "고맙")) or i.rstrip("~!") in ("흥", "훗", "냥", "헷", "홋")]
    if "interj_add" in ov: interj = ov["interj_add"] + interj  # 손으로 고른 값은 필터를 거치지 않는다
    if "me" in ov: me = ov["me"]  # None이면 자칭 없음
    if "me" not in ov and not me and third >= 0.1: me = ko.split("(")[0]  # 자기 이름 3인칭 (코미, 우이, 빅우드 …)
    src = affinity if affinity else lines
    quotes = [l for l in src if re.search(r"[.!?~…⋯]$", l) and 6 <= len(l) <= 40 and not re.search(r"[\[\]:]", l)][:16]  # 친밀도(로비) 대사만 — 볼 당기기/전투 대사는 문맥이 안 맞음
    return {"ko": ko, "style": style, "addr": addr, "me": me, "interj": interj[:6], "third": round(third, 2), "share": {k: round(v, 2) for k, v in share.items()}, "n": len(lines), "lines": quotes}

SKIN_OVERRIDE = {  # hero: {skinNo: {...}} — 위키 대사표에서 확인한 스킨별 말버릇
    "Erpin": {"5": {"addr": "주인"}},                        # 풀오토 고딕(메이드): "주인~! 섭섭하게 이럴 거야??"
    "Crepe": {"1": {"interj": ["꼬끼오!", "삐야아아악!", "꼬꼬댁~"]}},  # 뿅아리 클리너
    "Alice": {"1": {"interj": ["으히히"]}, "3": {"interj": ["으음", "헤헷"]}},
}
SKIN_UNMATCHED = []
def norm(s): return re.sub(r"[\s·ㆍ'\"“”‘’!?.~]", "", s)
def skin_profiles(hero, base, skin_lines):
    """스킨(테마 사복)별로 기본과 다른 점만: addr(호칭)·interj(감탄사)·style(어미)·lines(전용 대사). names-ko.json 스킨 이름으로 번호 매칭"""
    out = {}
    known = {norm(v): k for k, v in names.get("skins", {}).get(hero, {}).items()}
    for label, rows in skin_lines.items():
        key = known.get(norm(label))
        if not key:  # 부분 일치 (위키 표기가 조금 다를 때)
            cands = [k for nv, k in known.items() if norm(label) in nv or nv in norm(label)]
            key = cands[0] if len(cands) == 1 else None
        if not key: SKIN_UNMATCHED.append(f"{base['ko']}: ({label}) ×{len(rows)}"); continue
        texts = [t for t, _ in rows]
        # 인용 후보: 볼 당기기·꿀밤·쓰다듬기(상황 대사)와 전투는 제외 → 스킬 강화·보드·장비·레벨 업·승급·연회장·생일 같은 한마디
        p = profile(hero, base["ko"], texts, [t for t, sec in rows if sec not in ("볼 당기기", "꿀밤 때리기", "쓰다듬기", "상호작용", "전투", "승리", "패배", "스테이지 진입", "덱 편성")])
        d = {"label": label, "n": len(texts)}
        if p["addr"] != base["addr"]:
            # 호칭은 스킨 대사에 실제로 그 호칭이 2번 이상 나올 때만 (기본값으로 떨어진 경우 제외)
            cnt = sum(len(re.findall(r"(?<![가-힣])" + re.escape(p["addr"]) + r"(?![가-힣])", t)) for t in texts)
            if cnt >= 2: d["addr"] = p["addr"]
        ij = [i for i in p["interj"] if i not in base["interj"]]
        if ij: d["interj"] = ij[:3]
        if p["style"] != base["style"] and len(texts) >= 6 and p["share"].get(p["style"], 0) >= 0.6 and base["style"] not in ("crepe",): d["style"] = p["style"]
        if p["lines"]: d["lines"] = p["lines"][:10]
        out[key] = d
    for k, ov in SKIN_OVERRIDE.get(hero, {}).items(): out[k] = {**out.get(k, {"label": names.get("skins", {}).get(hero, {}).get(k, ""), "n": 0}), **ov}
    return out

# 대사표에서 프로필이 안 나오는 사도 — 위키에 대사 절이 없거나(기계음) 다른 사도와 같은 인물인 경우
MANUAL = {
    # 기계음('삐빗')만 내고 문장 대사가 없다. 괄호 안 뜻풀이가 실제 말이라 보고 프로필을 손으로 잡는다
    "EisiaFridge": {"ko": "냉장고", "style": "polite", "addr": "교주님", "me": None,
                    "interj": ["삐빗", "삐삣"], "third": 0.0, "share": {"polite": 1.0}, "n": 0, "skins": {}},
    # 리뉴아의 극장 알바 시절 모습 — 같은 인물이라 말투를 그대로 물려받는다(아래에서 복사)
    "Renewa_alba": {"_inherit": "RenewaAwaken", "ko": "리뉴아(알바)"},
}

result = {"styles": ["polite", "formal", "casual", "royal", "haso", "vivi", "noun", "hao", "robot", "jubee", "ayla", "momo", "crepe"], "heroes": {}}
missing = []
for hero, ko in sorted(names["heroes"].items()):
    if hero == "Dummy" or hero.startswith("Wisps"): continue
    fp = os.path.join(PAGES, safe(ko) + ".txt")
    if not os.path.exists(fp): missing.append(ko); continue
    raw = extract_section(open(fp, encoding="utf-8", errors="ignore").read())
    lines = []; affinity = []; skin_lines = collections.defaultdict(list)  # 스킨명 → [(줄, 소제목)]
    for l, sec in raw:
        r = clean_line(l, ko.split("(")[0], keep_skin=True)
        if not r: continue
        c, skin = r
        if skin: skin_lines[skin].append((c, sec)); continue
        if c not in lines:
            lines.append(c)
            if sec == "친밀도": affinity.append(c)
    if sum(1 for l in lines if re.search(r"[.!?~…⋯]", l)) < 5: missing.append(ko + f"({len(lines)}줄)"); continue  # 대사 절이 없어 표/제목만 잡힌 경우(로니)
    prof = profile(hero, ko, lines, affinity)
    prof["skins"] = skin_profiles(hero, prof, skin_lines)
    result["heroes"][hero] = prof

for hero, m in MANUAL.items():
    if hero in result["heroes"]: continue
    if "_inherit" in m:
        src = result["heroes"].get(m["_inherit"])
        if not src: continue
        d = json.loads(json.dumps(src)); d["ko"] = m["ko"]; result["heroes"][hero] = d
    else:
        result["heroes"][hero] = dict(m)
    if hero in missing or any(x.startswith(m["ko"]) for x in missing):
        missing = [x for x in missing if x != m["ko"] and not x.startswith(m["ko"] + "(")]

os.makedirs(os.path.join(ROOT, "assets"), exist_ok=True)
def strip_lines(res):
    """배포용 사본에서 대사 원문을 뺀다 — 리포트는 원본 result 를 그대로 쓴다"""
    import copy
    d = copy.deepcopy(res)
    for p in d["heroes"].values():
        p.pop("lines", None)
        for sk in p.get("skins", {}).values(): sk.pop("lines", None)
    return d

json.dump(strip_lines(result), open(os.path.join(ROOT, "data", "talk-ko.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
os.makedirs(os.path.join(ROOT, "out"), exist_ok=True)
with open(os.path.join(ROOT, "out", "talk-report.md"), "w", encoding="utf-8") as f:
    f.write(f"# 말투 프로필 ({len(result['heroes'])}명) · 누락 {len(missing)}: {', '.join(missing)}\n\n| 사도 | style | 호칭 | 감탄사 | 3인칭 | 어미 분포 | 표본 |\n|---|---|---|---|---|---|---|\n")
    for hero, p in sorted(result["heroes"].items(), key=lambda kv: kv[1]["ko"]):
        f.write(f"| {p['ko']} | {p['style']} | {p['addr']} / {p.get('me') or '-'} | {' '.join(p['interj'])} | {p['third']} | {' '.join(f'{k}{int(v*100)}' for k, v in sorted(p['share'].items(), key=lambda x: -x[1]))} | {' / '.join(l[:30] for l in (p.get('lines') or [])[:2]) or '-'} |\n")
    styles = collections.Counter(p["style"] for p in result["heroes"].values())
    f.write(f"\nstyle 분포: {dict(styles)}\n")
    f.write("\n## 스킨별 차이 (기본과 다른 점만)\n\n| 사도 | 스킨 | 대사 수 | 호칭 | 감탄사 | 어미 | 표본 |\n|---|---|---|---|---|---|---|\n")
    nsk = 0
    for hero, p in sorted(result["heroes"].items(), key=lambda kv: kv[1]["ko"]):
        for k, d in sorted(p.get("skins", {}).items()):
            nsk += 1
            f.write(f"| {p['ko']} | {k}. {d.get('label','')} | {d.get('n',0)} | {d.get('addr','')} | {' '.join(d.get('interj', []))} | {d.get('style','')} | {(d.get('lines') or [''])[0][:40]} |\n")
    big = [u for u in SKIN_UNMATCHED if int(re.search(r"×(\d+)", u).group(1)) >= 3]
    f.write(f"\n스킨 프로필 {nsk}개 · 스킨명 매칭 실패(3줄 이상) {len(big)}: {' / '.join(big)}\n")
print(f"heroes={len(result['heroes'])} missing={len(missing)} styles={dict(collections.Counter(p['style'] for p in result['heroes'].values()))}")
