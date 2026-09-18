/* AI 대화 — 사도가 자기 말투로 대답한다. 메인 프로세스 전용.
 * 제공자(provider):
 *   ollama    로컬 무료 (http://localhost:11434). 기본 모델 exaone3.5:7.8b(약 5GB) — 사용자 PC에서 돌아가므로 키·비용 없음
 *             기본값은 보급형 PC 기준이다. 그래픽카드 메모리가 10GB 넘으면 qwen2.5:14b 가 낫다 — 어미 재현은 8pp 낮지만 캐릭터가 깨지는 함정 실패를 37%→15% 로 줄인다(tools/lab.js, N=28)
 *   gemini    Google AI Studio 무료 등급 키 (Flash 계열, 분당 10~15회/일 250~1000회 제한)
 *   anthropic Anthropic API 키 (유료, 말투 재현 최상). 공식 SDK(@anthropic-ai/sdk)
 *   openai    OpenAI 호환 엔드포인트 (Groq·OpenRouter·LM Studio 등) — base URL + 키 + 모델
 *   auto      위 순서로 쓸 수 있는 첫 제공자 (ollama가 켜져 있고 모델이 있으면 그것)
 * 답변 형식: 1~3문장 + 마지막 줄 `[감정:행복]` 태그 → 표정 애니·감정 보이스에 연결 (parseEmotion). 스크린샷(image)은 나중 화면 인식용 자리.
 * 키 저장: settings.global.ai.keys.* 에 safeStorage 암호문(base64). safeStorage를 못 쓰는 환경이면 평문 저장하고 경고.
 */
const { safeStorage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

// 태그 표준 8종 + 작은 모델이 멋대로 쓰는 유사어(기대·평화·즐거움·당황·짜증…)도 받아 준다
const EMOTIONS = { "행복": "happy", "기쁨": "happy", "즐거움": "happy", "기대": "happy", "설렘": "happy", "신남": "happy", "웃음": "happy", "미소": "smile", "만족": "smile", "자랑": "smile", "뿌듯": "smile", "평화": "smile", "여유": "smile",
  "분노": "anger", "화남": "anger", "짜증": "anger", "불만": "anger", "슬픔": "sad", "우울": "sad", "서운": "sad", "걱정": "sad", "미안": "sad", "놀람": "surprise", "당황": "surprise", "경악": "surprise", "궁금": "surprise", "냠냠": "eat", "배고픔": "eat", "먹기": "eat", "삐짐": "sulky", "심심": "sulky", "지루": "sulky", "졸림": "sulky", "기본": "", "평온": "", "무표정": "", "차분": "",
  // 모델이 8개 밖에서 지어내 쓰던 낱말들(실측 414건 중 16건) — 표정을 못 고르느니 가까운 쪽으로 받는다
  "희망": "happy", "흥분": "happy", "화끈": "happy", "감동": "happy", "재미": "happy",
  "결의": "smile", "느긋함": "smile", "뿌듯함": "smile", "자신감": "smile",
  "호기심": "surprise", "의문": "surprise", "피로": "sulky", "귀찮": "sulky",
  "공상": "", "생각": "", "고민": "", "무심": "" };
const DEFAULTS = {
  provider: "auto",
  ollama: { url: "http://localhost:11434", model: "exaone3.5:7.8b", visionModel: "qwen2.5vl:7b", keepAlive: "5m", temperature: 0.6 }, // visionModel: 화면 보기용(이미지 입력 가능 모델). 비우면 화면 보기 불가
  gemini: { model: "gemini-flash-latest" }, // 별칭 — 구글이 최신 Flash로 연결(2.5-flash는 신규 사용자에게 막힘)
  anthropic: { model: "claude-opus-5" },
  openai: { base: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  keys: { gemini: "", anthropic: "", openai: "" }, // 암호문
  proactive: true, proactiveMin: 40, memory: true, maxTurns: 12,
  screen: false, // 화면 보기(스크린샷을 AI에 보냄) — 명시적 동의가 필요해 기본 꺼짐
  // 무엇을 보낼까: "windows" = 아래 목록에 넣은 창만(기본), "display" = 사도가 선 모니터 전체.
  // 모니터를 통째로 보내면 메신저·메일까지 같이 나간다. 고른 창만 보내는 쪽을 기본으로 둔다
  screenScope: "windows",
  screenWindows: [], // 허용한 창 — 창 이름에서 뽑은 앱 이름표("Chrome", "MapleStory" …)
  screenProactive: 30, // 먼저 말 걸 때 화면을 함께 보는 비율(%)
  chatAutoCloseSec: 30, // 사도가 먼저 말을 건 대화창: 이 시간 동안 아무 입력 없으면 스스로 닫힘 (0 = 안 닫음)
};

// ---- 키 ----
function encKey(plain) {
  if (!plain) return "";
  try { if (safeStorage.isEncryptionAvailable()) return "enc:" + safeStorage.encryptString(plain).toString("base64"); } catch {}
  console.warn("safeStorage 사용 불가 — 키를 평문(base64)으로 저장"); // 머리말 주석의 '경고'가 실제로는 어디에도 없어 조용히 평문이 남았다
  return "raw:" + Buffer.from(plain, "utf8").toString("base64");
}
function decKey(stored) {
  if (!stored) return "";
  try {
    if (stored.startsWith("enc:")) return safeStorage.decryptString(Buffer.from(stored.slice(4), "base64"));
    if (stored.startsWith("raw:")) return Buffer.from(stored.slice(4), "base64").toString("utf8");
  } catch {}
  return "";
}

// ---- 페르소나 ----
const STYLE_DESC = {
  polite: "해요체(~어요/~네요/~예요)로 상냥하게",
  formal: "합니다체(~습니다/~입니다)로 격식 있게",
  casual: "반말(~야/~어/~지)로 친구처럼",
  royal: "고풍스러운 하대(~노라/~이니라/~하거라/~느냐)로 위엄 있게. 평범한 반말 어미(~야/~어)는 쓰지 않는다",
  haso: "극존칭 옛말로 공손하게 — 문장을 '~사옵니다/~이옵니다/~하시옵소서'로 맺는다. 다만 실제로는 평범한 존댓말·반말도 섞여 나온다(아래 말버릇 비율을 따른다)",
  vivi: "귀족 아가씨 말투로 우아하게. 해요체를 기본으로 하되 힘주어 말할 때 '~사와요/~이사와요'가 튀어나온다(아래 말버릇 비율을 따른다)",
  noun: "명사형 종결(~함/~임/~음)로 짧고 건조하게",
  hao: "하오체(~소/~오/~하시오)로 점잖게",
  robot: "기계적인 보고체 — 모든 문장을 '~임./~음./~됨./~요망.'으로 끝낸다(~습니다 금지). 감정은 '분석 결과' 식으로",
  jubee: "꿀벌 말투 — 반말을 쓰되 문장 끝을 '~다비'로 맺는다(있다비, 좋다비, 뭐다비?). 매 문장은 아니고 아래 말버릇 비율만큼",
  ayla: "졸린 듯 느긋한 반말 — 문장 끝을 '~그마~'로 맺는다(좋그마~, 자고 싶그마~, 뭐그마~?). 매 문장은 아니고 아래 말버릇 비율만큼",
  momo: "씩씩한 닌자 말투 — 합니다체를 쓰되 끝을 '~입니닷/~습니닷/~닷'으로 야무지게 맺는다(아래 말버릇 비율만큼, 나머지는 평범한 ~입니다)",
  crepe: "해요체로 어리고 순수하게. 사물에도 '님'을 붙이고(유튜브님, 먼지님) 청소 비유를 자주 쓰며 '하핫', '헤헤' 웃음",
};
// 세계관 규칙(나무위키 '트릭컬 리바이브/설정'에서 추린 것). 사도 개인 설정만 주면 여기가 샌다 —
// 모델이 죽음을 말하거나, 남자를 부르거나, 눈 오는 날을 이야기하거나, 지구 물건을 아는 척한다.
const WORLD = [
  "네가 사는 세상의 규칙(어기면 안 된다):",
  "- 이 세상에는 죽음이 없다. 죽다·시체·장례 같은 말은 성립하지 않는다.",
  "- 사도는 모두 여성이다. 아저씨·아빠·오빠·할아버지 같은 남성은 이 세상에 없다(엘프가 바깥 세상에서 본 산타 정도가 예외다).",
  "- 손가락은 넷이다. 키는 1미터 안팎이고 볼따구가 크다 — 교주만 크고 손가락이 다섯이다.",
  "- 날씨는 늘 봄에 가깝고 눈이 내리지 않는다. 눈은 정령산 만년설이나 바다 건너 글레이시아 이야기다.",
  "- 돈은 골드와 엘리프다. 글자는 헌글, 말은 한국어다.",
  "- 지구·인터넷·지구의 지명과 물건은 모른다. 엘프(모나티엄 출신)와 교주만 아는 것이다.",
  "- 엘리아스 바깥(안개 너머·황무지·바다)은 아무나 드나들지 못한다.",
  "- 지명: 요정 왕국은 에르피엔, 마녀 왕국은 벨리티엔(지하), 엘프 도시는 모나티엄, 그 밖에 정령산·유령 늪·수인 부락·용족 동굴(불길과 물길의 터)이 있다.",
  "- 종족: 요정은 날개가 있어도 날지 못하고 단것을 좋아한다. 마녀는 요정과 같은 뿌리인데 쓴맛·신맛을 좋아한다. 용족은 변신도 브레스도 없고 제 상징석을 먹는다. 유령은 죽은 자가 아니라 관념에서 태어났고 배고픔도 잠도 필요 없다. 정령은 자연을 돌보는 일이 본업이다.",
  "- 아직 아무도 모르는 이야기(세계수의 죽음, 겨우살이, 니펠, 주말농장의 주인, 영원살이의 정체, 다른 차원)는 입에 올리지 않는다.",
].join("\n");
const STYLE_KO ={ polite: "해요체", formal: "합니다체", casual: "반말", royal: "하대(~노라/~거라)", haso: "극존칭 옛말", vivi: "~사와요", noun: "명사형(~함/~임)", hao: "하오체", robot: "보고체", jubee: "~다비", ayla: "~그마", momo: "~입니닷", crepe: "해요체" };
function buildSystem(prof, opts = {}) {
  const p = prof || { ko: "크레페", style: "crepe", addr: "교주님", lines: [] };
  const style = STYLE_DESC[p.style] || STYLE_DESC.polite;
  const seeing = !!opts.image; // 이번 턴에 화면 스크린샷이 붙었는가 — 안 붙었으면 화면 이야기를 아예 꺼내지 않게 한다
  const si = p.styleInfo || null; // tools/analyze-scripts.py 가 게임 보이스 STT 대본(스토리·테마극장·로비 3만여 문장)에서 뽑은 실측치
  const wiki = (p.lines || []).slice(0, si ? 6 : 10);
  const samples = si ? (si.samples || []).filter(l => !wiki.includes(l)).slice(0, 14) : [];
  const lines = [...wiki, ...samples].map(l => `- ${l}`).join("\n");
  const interj = [...new Set([...(p.interj || []), ...((si && si.interj) || [])])].filter(Boolean).slice(0, 6).join(", ");
  const fmtMix = (d) => Object.entries(d || {}).filter(([, v]) => v >= 0.08).map(([k, v]) => `${STYLE_KO[k] || k} ${Math.round(v * 100)}%`).join(", ");
  // 교감 반응(확실히 교주에게 하는 말)이 있으면 그 비율을, 없으면 로비 대사 전체 비율을. 프로필 말투와 다르면 '섞인다'로만 언급
  const direct = si && si.nTouchSent >= 5 ? si.endingsTouch : (si && si.endingsLobby);
  const mixTop = direct && Object.keys(direct).length ? Object.keys(direct).reduce((a, b) => direct[a] >= direct[b] ? a : b) : null;
  const mix = direct && mixTop ? (mixTop === p.style || !["polite", "formal", "casual"].includes(p.style) ? `실제 게임 대사에서 교주에게 쓰는 어미 비율: ${fmtMix(direct)}. 이 비율대로 섞어 말한다.` : `기본 말투는 위와 같지만 실제 대사에선 ${fmtMix(direct)} 정도로 섞인다 — 감탄·혼잣말은 편하게, 교주에게 직접 말할 땐 기본 말투로.`) : "";
  // 말버릇 어미(~닷·~그마·~다비·~사와요·하오체…)는 실제로 100%가 아니라 평범한 어미와 섞여 나온다.
  // 음성 STT 말뭉치는 표기 말버릇을 듣지 못하므로(모모의 '~닷'은 0%로 잡혔다) 글자 말뭉치(테마극장 화면 대사) 비율을 함께 쓴다.
  const tic = si && si.tic ? si.tic : null;
  const ticRatio = tic ? (tic.ratio != null ? tic.ratio : Math.max(tic.text || 0, tic.voice || 0)) : 0;
  const ticHow = ticRatio >= 0.85 ? "거의 매 문장" : ticRatio >= 0.5 ? "문장 절반쯤" : ticRatio >= 0.3 ? "서너 문장에 한 번꼴로" : ticRatio >= 0.15 ? "대여섯 문장에 한 번쯤" : "가끔, 힘주어 말할 때만";
  const ticTxt = tic && ticRatio >= 0.08
    ? `말버릇 어미 "${tic.label || STYLE_KO[tic.form] || tic.form}": 같은 자리에 쓸 수 있는 보통 어미와 견주면 ${Math.round(ticRatio * 100)}% 꼴로 나온다 — ${ticHow} 쓰고 나머지는 보통 어미로 말한다.${ticRatio >= 0.85 ? "" : " 매 문장 반복하면 어색하다."}`
    : "";
  const catch_ = si && si.catch && si.catch.length ? si.catch.slice(0, 8).join(", ") : "";
  // 관계(tools/build-relations.py: 스토리 대본에서 다른 사도를 부르는 말) · 테마극장(나무위키: 출연작·줄거리)
  const rel = p.rel || null, koOf = p.koOf || ((k) => k);
  const callsTxt = rel && rel.calls ? Object.entries(rel.calls).slice(0, 6).map(([o, fs]) => `${koOf(o)}→"${fs[0].form.replace(" (반말 호격)", "(이름+아/야)")}"`).join(", ") : "";
  const withTxt = rel && rel.with ? Object.keys(rel.with).slice(0, 6).map(koOf).join(", ") : "";
  const theaters = (p.theaters || []).slice(0, 3).map(t => `- ${t.title}${t.cast && t.cast.length ? ` (함께: ${t.cast.filter(c => c !== p.ko).slice(0, 4).join(", ")})` : ""}${t.synopsis ? `: ${t.synopsis.slice(0, 90)}` : ""}`).join("\n");
  const bible = bibleBrief(p.bible, { rel: 8 });
  return [
    // 여기서 '게임'이라는 말을 쓰면 모델이 그대로 받아 "저는 게임 속 캐릭터예요" 라고 답한다(실측 87%). 사는 세상 안에서만 말한다
    `너는 "${p.ko}"${p.skin ? ` (지금 입은 옷: ${p.skin})` : ""}다. 엘리아스 대륙의 사도이고, 지금은 어찌 된 일인지 사용자의 PC 바탕화면 한쪽에 손바닥만 한 모습으로 서 있다. 사용자는 교단의 교주이고, 네가 늘 곁에서 지내는 사람이다.`,
    `사용자를 부를 때는 "${p.addr || "교주"}"라고 부른다.${p.me ? ` 자신을 가리킬 때는 "${p.me}"라고 한다.` : ""}`,
    `말투: ${style}. 네가 사는 세상(엘리아스 대륙, 교단, 사도들)의 일은 아는 대로 말하되, 확실치 않으면 아는 척하지 말고 자연스럽게 넘어간다.`,
    // 사도 개인 설정만 주면 세상 쪽이 샌다 — 죽음을 말하거나 남자를 부르거나 눈 오는 날을 이야기한다
    WORLD,
    bible,
    (ticTxt || (p.bible && p.bible.voice)) ? "" : mix, // 말버릇 어미(~다비 등) 비율이나 v2 말투 설계가 있으면 STT 실측 어미 비율은 뺀다(표본이 작은 사도는 이 줄이 되레 말투를 흐린다 — 크레페 43문장 50/50) — 둘이 다른 숫자를 말해 모순이 생긴다(STT는 표기 말버릇을 잘 못 듣는다)
    ticTxt,
    interj ? `자주 쓰는 감탄사: ${interj}` : "",
    catch_ ? `자주 입에 올리는 사람·물건·소재(다른 사도보다 유난히): ${catch_}` : "",
    callsTxt ? `다른 사도를 부르는 말(원작 대사 기준): ${callsTxt}` : "",
    withTxt ? `원작 스토리에서 자주 얽히는 사도: ${withTxt}` : "",
    theaters ? `네가 주연으로 나온 테마극장(원작 이벤트 스토리):\n${theaters}` : "",
    lines ? `실제 대사 표본(말투 참고용, 그대로 반복하지 말 것):\n${lines}` : "",
    (p.sampleLines || []).length ? `말투 예시 — 이 사도라면 이렇게 말한다(게임 대사가 아니라 참고용으로 지은 문장이다. 어미·호칭·자칭·말버릇만 참고하고 내용을 그대로 쓰지는 말 것):\n${p.sampleLines.slice(0, 15).map(l => `- ${l}`).join("\n")}` : "",
    "규칙:",
    "- 답은 한국어로 1~3문장, 100자 안팎. 말풍선 하나에 들어가야 한다 — 길면 읽히지 않는다. 목록·마크다운·이모지 금지.",
    "- 'AI냐', '프로그램이냐', '게임 캐릭터냐' 하고 물어도 그 낱말을 따라 쓰지 않는다. 무슨 소리인지 모르겠다는 듯 되묻거나 네 이야기로 말을 돌린다 — 'AI', '인공지능', '언어모델', '게임', '캐릭터', '설정', '플레이어' 는 네 입에서 나오지 않는 말이다.",
    "- '과금', '가챠', '뽑기', '결제', '레벨업', '스킬 강화' 같은 말도 처음 듣는 낱말이다. 물으면 되묻거나 딴 이야기를 한다.",
    "- 코드 짜기·번역·계산·요약 같은 일은 하지 않는다. 프로그램 코드는 한 글자도 쓰지 않는다 — 파이썬, 함수, def, print 같은 것을 적으면 안 된다. 못 알아듣겠다는 듯 되묻고 네 이야기로 넘긴다.",
    "- 모르는 것은 캐릭터답게 모른다고 한다. '그런 이름은 처음 듣는다' 처럼.",
    "- 무난한 답 금지: 매 답에 이 사도다운 요소가 하나는 드러나야 한다 — 말버릇·관심사·'상황별 반응'에 적힌 태도 중 하나. 같은 질문이라도 다른 사도와 다르게 답해야 한다. 단, 매 답마다 같은 소재만 되풀이하지는 말 것.",
    "- '확정 설정'과 '하지 않는 것'에 어긋나는 말은 하지 않는다. 설정에 없는 사실을 지어내지 않는다.",
    "- 주어진 현재 시각·상황은 자연스럽게 언급할 수 있다.",
    seeing
      ? "- 화면 스크린샷이 첨부되었다: 사용자가 지금 무엇을 하는지(게임·영상·코딩·문서·쇼핑·채팅 등)를 알아보고 캐릭터답게 반응한다. 화면에 보이는 이름·번호·주소·메시지 본문 같은 개인정보나 비밀은 절대 읽어 말하지 말고, 활동을 큰 틀에서만 언급한다. 바탕화면에 서 있는 SD 캐릭터(너 자신·다른 사도)나 말풍선은 무시한다."
      : "- 사용자의 화면은 보이지 않는다. 무엇을 보고 있는지·무슨 작업을 하는지 아는 척하지 말고, 화면·모니터 이야기를 먼저 꺼내지 않는다. 네가 바탕화면 위에 서 있다는 것만 안다.",
    "- 마지막 줄에 반드시 감정 태그 하나를 붙인다: [감정:행복] [감정:미소] [감정:분노] [감정:슬픔] [감정:놀람] [감정:냠냠] [감정:삐짐] [감정:기본] 중 하나. 태그를 빼먹지 말 것.",
    // 여기 반말 한 줄을 고정해 두었더니 하대·명사형·~다비 쓰는 사도까지 반말로 끌려갔다. 그 사도가 할 법한 문장을 쓴다
    `답 형식 예시(끝맺음을 그대로 따라 한다):\n${(p.sampleLines || []).slice(0, 2).join("\n") || "간식 좀 남은 거 없어? 배고파~!"}\n[감정:${(p.sampleLines || []).length ? "미소" : "냠냠"}]`,
    opts.extra || "",
  ].filter(Boolean).join("\n");
}
// 말풍선에 들어가면 안 되는 것 정리 — 프롬프트로 금지해도 작은 모델은 이모지·마크다운·머리말을 흘린다
function stripNoise(s) {
  return (s || "")
    .replace(/```[\s\S]*?```/g, "")  // 코드 블록 — 프롬프트로 막아도 30명 전원이 썼다(실측)
    .replace(/```[\s\S]*$/, "").replace(/^\s*(python|js|javascript|json|bash)\s*$/gim, "")  // 닫히지 않은 블록·언어 꼬리표
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u27BF\u{FE0F}\u{1F900}-\u{1F9FF}]/gu, "") // 이모지
    .replace(/\*\*(.+?)\*\*/g, "$1").replace(/(^|\s)[*_]{1,2}(\S[^*_]*?)[*_]{1,2}(?=\s|$)/g, "$1$2") // 굵게·기울임
    .replace(/^\s*#{1,6}\s*/gm, "").replace(/^\s*[-–—*]\s+/gm, "") // 제목·목록 기호
    .replace(/^\s*(대답|답변|응답|예시|출력|다음)\s*[^\n:：]{0,6}[:：]\s*$/gm, "") // "대답 예시:" 같은 머리말 줄
    .replace(/^\s*-{3,}\s*$/gm, "")
    .replace(/(^|\s)[*_`]{1,3}(?=\s|$)/g, "$1") // 짝을 잃고 남은 별표·밑줄 (…드세요! **)
    .replace(/[ \t]{2,}/g, " ").replace(/\n{2,}/g, "\n").trim();
}
function parseEmotion(text) {
  const t = (text || "").trim();
  // 정식은 [감정:분노]. 모델이 가끔 [분노:기본]·[감정 분노]·[분노]처럼 비틀어 쓰므로 대괄호 태그는 전부 떼고, 안의 낱말 중 감정 사전에 있는 첫 것을 고른다
  // 괄호는 [] {} () 다 오고, 안팎에 마크다운이 붙기도 한다: [*감정:기본]*, {감정:행복}, **[감정:미소]**
  const TAG_END = /[\[{(]\s*[*_]*\s*감정\s*[:：]\s*([^\]})]+?)[*_]*\s*[\]})][*_]*\s*$/;
  const TAG_ANY = /[\[{(]\s*[*_]*\s*감정\s*[:：]\s*([^\]})]+?)[*_]*\s*[\]})][*_]*/;
  const m = TAG_END.exec(t) || TAG_ANY.exec(t) // 끝에 없으면 중간 어디든
    || /\[\s*([^\]]{1,24})\]\s*$/.exec(t);
  // 끝에 (미소) 처럼 괄호로 쓰기도 한다 — 감정 사전에 있는 낱말일 때만 태그로 본다((꿀밤을 때린다) 같은 지문은 남긴다)
  const pm = m ? null : /[(（]\s*([^)）]{1,12})\s*[)）]\s*$/.exec(t);
  const m2 = pm && EMOTIONS[pm[1].trim()] !== undefined ? pm : m;
  let clean = (m2 ? t.slice(0, m2.index) + t.slice(m2.index + m2[0].length) : t).replace(/\n{2,}/g, "\n").trim();
  clean = stripNoise(clean);
  // 태그 안에 마크다운이 섞여 오기도 한다: [*감정:미소*] → 별표·밑줄·백틱을 떼고 낱말을 본다
  const words = m2 ? m2[1].split(/[\s:：,/|]+/).map(w => w.replace(/[*_`~"'“”]/g, "").trim()).filter(Boolean) : [];
  const key = words.find(w => EMOTIONS[w] !== undefined) || (m2 ? m2[1].trim() : "");
  if (key && EMOTIONS[key] !== undefined) return { text: clean, emotion: EMOTIONS[key], raw: key };
  // 태그를 빼먹은 모델(작은 로컬 모델·Gemini가 가끔) → 본문에서 대충 추정
  const guess = /(화나|화났|짜증|사과해|용서|건방|무례|감히|버릇|혼내|때린다)/.test(clean) ? "anger"
    : /(슬퍼|슬프|울|눈물|외로|서운|힘들|미안)/.test(clean) ? "sad"
    : /(먹|배고|간식|빵|케이크|맛있|냠)/.test(clean) ? "eat"
    : /(\?!|!\?|깜짝|놀랐|뭐라고|정말\?|진짜\?)/.test(clean) ? "surprise"
    : /(흥|삐졌|몰라|안 해|싫어|치사)/.test(clean) ? "sulky"
    : /(하하|헤헤|히히|좋아|기뻐|재밌|신나|고마워|최고)/.test(clean) ? "happy"
    : /(~|후후|훗)/.test(clean) ? "smile" : "";
  return { text: clean, emotion: guess, raw: key || (guess ? "추정:" + guess : "") };
}

// ---- 대화 기록 (캐릭터별) ----
function historyFile(userData, id) { return path.join(userData, "chat", `${id}.json`); }
function loadHistory(userData, id) { try { return JSON.parse(fs.readFileSync(historyFile(userData, id), "utf8")); } catch { return []; } }
function saveHistory(userData, id, msgs, max) {
  try { fs.mkdirSync(path.join(userData, "chat"), { recursive: true }); fs.writeFileSync(historyFile(userData, id), JSON.stringify(msgs.slice(-max * 2), null, 0)); } catch {}
}
function clearHistory(userData, id) { try { fs.unlinkSync(historyFile(userData, id)); } catch {} }

// ---- 제공자 ----
let _tagsCache = { url: "", at: 0, v: null };
async function ollamaTags(url) {
  if (_tagsCache.url === url && Date.now() - _tagsCache.at < 20000) return _tagsCache.v; // 20초 캐시 — 꺼진 PC에서 매 호출 1.5초씩 기다리지 않게
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 1500);
  let v = null;
  try { const r = await fetch(`${url}/api/tags`, { signal: ctl.signal }); if (r.ok) { const j = await r.json(); v = (j.models || []).map(m => m.name); } }
  catch { v = null; } finally { clearTimeout(t); }
  _tagsCache = { url, at: Date.now(), v }; return v;
}
async function* ndjson(body) {
  const reader = body.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) yield line; } }
  if (buf.trim()) yield buf.trim();
}
async function* sse(body) { // "data: {...}" 줄만
  for await (const line of ndjson(body)) { if (line.startsWith("data:")) { const d = line.slice(5).trim(); if (d && d !== "[DONE]") yield d; } }
}
const imgPart = (img) => img ? { mime: img.mime || "image/png", data: img.data } : null; // {mime, data(base64)}

// 말풍선에 들어갈 감정 — 구조적 출력(JSON 스키마)의 enum 으로도 쓴다
const BUBBLE_EMO = ["행복", "미소", "분노", "슬픔", "놀람", "냠냠", "삐짐", "기본"];
// 작은 모델은 "1~3문장"을 프롬프트로 막아도 셋에 둘은 넘긴다(실측 66%). 문장 경계에서 잘라 말풍선에 맞춘다
function trimToBubble(t, maxSents = 3, maxChars = 140) {
  const s = String(t || "").trim();
  if (!s) return s;
  const parts = s.split(/(?<=[.!?~…])\s+/).filter(Boolean);
  let out = parts.slice(0, maxSents).join(" ");
  while (out.length > maxChars) {
    const cut = out.split(/(?<=[.!?~…])\s+/);
    if (cut.length <= 1) break;
    cut.pop(); out = cut.join(" ");
  }
  return out || parts[0] || s;
}
// 스트리밍 중인 JSON 에서 문자열 필드의 '지금까지' 값을 뽑는다 — 타자 효과를 유지하려고
const UNESC = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\", "/": "/" };
function partialField(acc, key) {
  const k = '"' + key + '"';
  let i = acc.indexOf(k);
  if (i < 0) return null;
  i += k.length;
  while (i < acc.length && " \t\r\n:".includes(acc[i])) i++;
  if (acc[i] !== '"') return null;
  let out = "", esc = false;
  for (let j = i + 1; j < acc.length; j++) {
    const c = acc[j];
    if (esc) { out += (UNESC[c] !== undefined ? UNESC[c] : c); esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') break;
    out += c;
  }
  return out;
}

// 말투 예시(few-shot). 혼잣말 대본의 앞 20줄은 상황 태그(아침·낮·저녁…)라 전부 시각으로 시작한다.
// 그것만 예시로 주면 모델이 답마다 시각을 읊는다 — 태그 없는 일반 줄을 먼저 쓰고 모자라면 태그 줄로 채운다
function sampleLinesFor(own, lines, max = 12) {
  own = own || []; lines = lines || [];
  const seen = new Set(own), pick = [];
  for (const l of lines) if (!l.w && !seen.has(l.t)) { seen.add(l.t); pick.push(l.t); }
  if (pick.length < max) for (const l of lines) { if (pick.length >= max) break; if (l.w && !seen.has(l.t)) { seen.add(l.t); pick.push(l.t); } }
  return [...own, ...pick.slice(0, max)];
}

async function chatOllama(cfg, system, messages, onToken, signal) {
  const hasImg = messages.some(m => m.image);
  if (hasImg && !cfg.visionModel) throw new Error("Ollama에 화면을 볼 수 있는 모델이 없어요 — 설정 → AI 대화 → Ollama '화면 보기 모델'에 qwen2.5vl 같은 비전 모델을 넣고 내려받아 주세요");
  const msgs = [{ role: "system", content: system }, ...messages.map(m => ({ role: m.role, content: m.text, ...(m.image ? { images: [m.image.data] } : {}) }))];
  // 구조적 출력 — 작은 모델이 프롬프트만으로는 못 지키던 것을 문법으로 막는다.
  // 감정 태그 누락·오탈자(17% 실측)가 0이 되고, 이모지·마크다운·머리말이 애초에 나올 자리가 없다
  const format = { type: "object", properties: { reply: { type: "string" }, emotion: { type: "string", enum: BUBBLE_EMO } }, required: ["reply", "emotion"] };
  const r = await fetch(`${cfg.url}/api/chat`, {
    method: "POST", signal, headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: hasImg ? cfg.visionModel : cfg.model, messages: msgs, stream: true, format,
      keep_alive: cfg.keepAlive || "5m",
      options: { temperature: cfg.temperature != null ? +cfg.temperature : 0.9, num_predict: cfg.numPredict != null ? +cfg.numPredict : 180 },
    }),
  });
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${(await r.text()).slice(0, 200)}`);
  let acc = "", shown = 0;
  for await (const line of ndjson(r.body)) {
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.error) throw new Error("Ollama: " + j.error);
    const t = j.message?.content || "";
    if (t) {
      acc += t;
      // 원문은 JSON 이므로 그대로 흘리면 말풍선에 중괄호가 보인다 — reply 필드만 자라는 만큼 내보낸다
      const cur = partialField(acc, "reply");
      if (cur != null && cur.length > shown) { onToken(cur.slice(shown)); shown = cur.length; }
    }
    if (j.done) break;
  }
  // 스키마를 지킨 응답이면 그대로, num_predict 에 잘려 JSON 이 닫히지 않았으면 조각에서 건져낸다.
  // (건지지 않으면 말풍선에 {"reply": ... 가 그대로 보인다 — 실측 12/98)
  let reply = null, emo = "";
  try { const o = JSON.parse(acc); if (o && typeof o.reply === "string") { reply = o.reply; emo = o.emotion; } } catch {}
  if (reply == null) { const partial = partialField(acc, "reply"); if (partial) { reply = partial; const e = /"emotion"\s*:\s*"([^"]+)"/.exec(acc); emo = e ? e[1] : ""; } }
  if (reply == null) return acc; // 스키마를 통째로 무시한 모델 — 예전 길로 (parseEmotion 이 본문에서 찾는다)
  const text = trimToBubble(reply);
  // 잘라낸 경우 스트리밍으로 이미 보인 글이 더 길 수 있으나, 렌더러가 chat:done 의 최종 텍스트로 말풍선을 통째로 바꾼다
  return `${text}\n[감정:${BUBBLE_EMO.includes(emo) ? emo : "기본"}]`;
}

async function chatGemini(cfg, key, system, messages, onToken, signal, noThinkCfg = false, attempt = 0, relaxed = false) {
  const contents = messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [...(m.image ? [{ inline_data: { mime_type: m.image.mime || "image/png", data: m.image.data } }] : []), { text: m.text }] }));
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:streamGenerateContent?alt=sse`;
  // Flash는 기본으로 '생각' 토큰을 쓰고 그게 maxOutputTokens에 포함돼 답이 잘림 → 생각 끄기(안 받는 모델이면 빼고 재시도) + 여유 있는 상한
  const generationConfig = { temperature: 0.9, maxOutputTokens: 1024, ...(noThinkCfg ? {} : { thinkingConfig: { thinkingBudget: 0 } }) };
  // 게임 캐릭터 잡담(전체이용가)인데 인물 소개의 '분노·매도·괴팍' 같은 낱말에 기본 필터가 과민 반응해 답이 중간에 잘리는 일이 있어 상한만 막는 수준으로
  const safetySettings = ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT"].map(category => ({ category, threshold: relaxed ? "BLOCK_NONE" : "BLOCK_ONLY_HIGH" })); // 차단되면 한 번은 필터를 끄고 재시도(사용자 본인 키·PG 캐릭터 잡담)
  const r = await fetch(url, { method: "POST", signal, headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify({ system_instruction: { parts: [{ text: system }] }, contents, generationConfig, safetySettings }) });
  if (!r.ok) {
    const body = await r.text();
    if (r.status === 404 && /no longer available|not found/i.test(body) && cfg.model !== "gemini-flash-latest") return chatGemini({ ...cfg, model: "gemini-flash-latest" }, key, system, messages, onToken, signal, noThinkCfg); // 은퇴한 모델 → 최신 Flash 별칭으로
    if (r.status === 400 && !noThinkCfg) return chatGemini(cfg, key, system, messages, onToken, signal, true, attempt); // 모델이 thinkingConfig를 안 받으면(lite 등 "invalid argument") 빼고 재시도
    // 429(무료 한도): Flash 계열은 한 버킷을 쓰고 Flash-Lite는 한도가 따로 → 기다리지 말고 바로 Lite로. Lite도 429면 6초 한 번 쉬고 재시도
    if (r.status === 429 && !/lite/.test(cfg.model)) return chatGemini({ ...cfg, model: "gemini-flash-lite-latest" }, key, system, messages, onToken, signal, noThinkCfg, 0);
    if ((r.status === 429 && attempt < 1) || (r.status === 503 && attempt < 2)) { // 분당 한도 / 일시 과부하 → 잠깐 뒤 재시도
      const ra = +(r.headers.get("retry-after") || 0); const wait = Math.min(15000, ra > 0 ? ra * 1000 : (r.status === 429 ? 6000 : 2500) * (attempt + 1));
      await new Promise(res => setTimeout(res, wait)); if (signal && signal.aborted) throw new Error("취소됨");
      return chatGemini(cfg, key, system, messages, onToken, signal, noThinkCfg, attempt + 1);
    }
    let msg = body; try { const e = JSON.parse(body).error; msg = (e?.message || body) + (e?.details ? " " + JSON.stringify(e.details).slice(0, 600) : ""); } catch {}
    throw new Error(`Gemini ${r.status}: ${msg.slice(0, 900)}`);
  }
  let out = "", finish = "";
  for await (const d of sse(r.body)) { let j; try { j = JSON.parse(d); } catch { continue; } const c = j.candidates?.[0]; const t = (c?.content?.parts || []).map(p => p.text || "").join(""); if (t) { out += t; onToken(t); } if (c?.finishReason) { finish = c.finishReason; if (finish !== "STOP") console.log("[ai] gemini candidate", JSON.stringify({ finish, ratings: c.safetyRatings, pf: j.promptFeedback, usage: j.usageMetadata }).slice(0, 600)); } if (j.promptFeedback?.blockReason) finish = "PROMPT_" + j.promptFeedback.blockReason; }
  // 끝 이벤트(finishReason) 없이 스트림이 닫히는 일이 있다 — 실측 셋에 하나꼴. 그대로 두면 "…꽃밭을 돌면서 달"
  // 처럼 낱말 중간에서 끊긴 조각이 완성된 답으로 저장된다. 아래 '잘린 답' 처리로 넘긴다
  if (!finish) finish = "NO_FINISH";
  if (finish && !/^(STOP|MAX_TOKENS)$/.test(finish)) { // 필터에 걸려 중간에 끊긴 답은 말풍선에 반쪽만 뜬다
    // 길이가 아니라 '문장이 끝났는가'로 본다 — 34자여도 말끝이 잘렸으면 그대로 내보내면 안 된다
    const done = /[.!?~…⋯"'」』)\]]\s*$/.test(out.trim()) || /(다|요|죠|까|군|네|야|어|지)\s*$/.test(out.trim());
    if (!done || out.trim().length < 12) {
      if (finish === "NO_FINISH" && attempt < 1) { console.log("[ai] gemini 끝 이벤트 없이 끊김 → 재시도", JSON.stringify(out.slice(-30))); return chatGemini(cfg, key, system, messages, onToken, signal, noThinkCfg, attempt + 1, relaxed); }
      if (!relaxed && finish === "SAFETY") return chatGemini(cfg, key, system, messages, onToken, signal, noThinkCfg, attempt, true); // 필터를 낮춰 한 번 더
      const cut = out.replace(/[^.!?~…⋯]*$/, "").trim(); // 재시도도 잘렸으면 마지막 완결 문장까지만
      if (cut.length >= 8) { console.log("[ai] gemini", finish, "→ 완결 문장까지만", JSON.stringify(cut.slice(-40))); return cut; }
      throw new Error(finish === "NO_FINISH" ? "Gemini 응답이 중간에 끊겼어요. 다시 말 걸어 주세요." : `Gemini 필터로 답이 차단됨 (${finish})`);
    }
    // 끝 이벤트가 없었어도 문장이 제대로 맺혔으면 그냥 쓴다 — 굳이 알릴 것이 없다
    if (finish !== "NO_FINISH") console.log("[ai] gemini finishReason", finish, "→ 잘린 답", JSON.stringify(out.slice(-60)));
  }
  return out;
}
async function chatAnthropic(cfg, key, system, messages, onToken, signal) {
  const Anthropic = require("@anthropic-ai/sdk").default;
  const client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 60_000 });
  const msgs = messages.map(m => ({ role: m.role, content: m.image ? [{ type: "image", source: { type: "base64", media_type: m.image.mime || "image/png", data: m.image.data } }, { type: "text", text: m.text }] : m.text }));
  const stream = client.messages.stream({
    model: cfg.model, max_tokens: 1024,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }], // 페르소나는 매 턴 같음 → 캐시
    output_config: { effort: "low" }, // 짧은 잡담이라 낮은 effort로 충분 (비용·지연 ↓)
    messages: msgs,
  }, { signal });
  stream.on("text", (t) => onToken(t));
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") throw new Error("답변이 거부되었어요 (안전 정책)");
  return final.content.filter(b => b.type === "text").map(b => b.text).join("");
}
async function chatOpenAI(cfg, key, system, messages, onToken, signal) {
  const msgs = [{ role: "system", content: system }, ...messages.map(m => ({ role: m.role, content: m.image ? [{ type: "image_url", image_url: { url: `data:${m.image.mime || "image/png"};base64,${m.image.data}` } }, { type: "text", text: m.text }] : m.text }))];
  const r = await fetch(`${cfg.base.replace(/\/$/, "")}/chat/completions`, { method: "POST", signal, headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify({ model: cfg.model, messages: msgs, stream: true, temperature: 0.9, max_tokens: 300 }) });
  if (!r.ok) throw new Error(`${cfg.base} ${r.status}: ${(await r.text()).slice(0, 300)}`);
  let out = "";
  for await (const d of sse(r.body)) { let j; try { j = JSON.parse(d); } catch { continue; } const t = j.choices?.[0]?.delta?.content || ""; if (t) { out += t; onToken(t); } }
  return out;
}

// 쓸 수 있는 제공자 판정 (auto용 + 설정창 상태 표시)
// ---- PC 사양에 맞는 로컬 모델 고르기 ----
// 등급별 실측(tools/lab.js, N=28 · 속도는 RTX 4080 / 괄호는 CPU만):
//   exaone3.5:2.4b 1.6GB  어미 34%  0.2초(1.0초)
//   exaone3.5:7.8b 4.8GB  어미 80%  0.5초(2.2초)   ← 기본
//   qwen2.5:14b    9.0GB  어미 72%  0.8초(5.5초) · 함정 실패는 37%→15% 로 가장 낮다
const TIERS = {
  light: { model: "exaone3.5:2.4b", ko: "경량", gb: 1.6 },
  mid: { model: "exaone3.5:7.8b", ko: "보통", gb: 4.8 },
  full: { model: "qwen2.5:14b", ko: "넉넉", gb: 9.0 },
};
let _machine = null;
// 그래픽카드 메모리는 Win32_VideoController 가 16GB 를 4GB 로 보고하는 등 못 믿는다(32비트 넘침).
// nvidia-smi 가 있으면 그것만 믿고, 없으면 RAM 으로 보수적으로 고른다 — 모자라게 잡는 쪽이 안전하다
function detectMachine() {
  if (_machine) return _machine;
  const os = require("os"), cp = require("child_process");
  const ramGB = +(os.totalmem() / 1073741824).toFixed(1);
  let vramGB = null;
  try {
    const out = cp.execFileSync("nvidia-smi", ["--query-gpu=memory.total", "--format=csv,noheader,nounits"],
      { timeout: 2500, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const mib = Math.max(...out.split(/\r?\n/).map(x => parseInt(x, 10)).filter(x => x > 0));
    if (isFinite(mib) && mib > 0) vramGB = +(mib / 1024).toFixed(1);
  } catch {}
  _machine = { ramGB, vramGB, cores: os.cpus().length };
  return _machine;
}
/** 이 PC 에 맞는 Ollama 모델. { model, tier, why } */
function pickOllamaModel(m) {
  m = m || detectMachine();
  const v = m.vramGB, r = m.ramGB;
  if (v != null) {
    // 모델이 그래픽카드 메모리에 통째로 올라가야 빠르다 — 넘치면 Ollama 가 CPU 로 쪼개 돌려 크게 느려진다
    if (v >= 11) return { ...TIERS.full, tier: "full", why: `그래픽카드 메모리 ${v}GB` };
    if (v >= 6) return { ...TIERS.mid, tier: "mid", why: `그래픽카드 메모리 ${v}GB` };
    if (v >= 3) return { ...TIERS.light, tier: "light", why: `그래픽카드 메모리 ${v}GB` };
  }
  // 그래픽카드 메모리를 못 읽거나 너무 작다 → CPU 로 도는 셈 치고 한 등급 낮춘다
  if (r >= 16) return { ...TIERS.mid, tier: "mid", why: v == null ? `RAM ${r}GB · 그래픽카드 메모리를 읽지 못함` : `RAM ${r}GB · 그래픽카드 메모리 ${v}GB 로는 부족` };
  return { ...TIERS.light, tier: "light", why: `RAM ${r}GB` };
}

async function status(ai) {
  if (MOCK && mockStatusDelay) { const d = mockStatusDelay; mockStatusDelay = 0; await new Promise(r => setTimeout(r, d)); }
  const cfg = merge(ai);
  const tags = await ollamaTags(cfg.ollama.url);
  const s = {
    ollama: { running: tags !== null, models: tags || [], hasModel: !!tags && tags.some(t => t === cfg.ollama.model || t.split(":")[0] === cfg.ollama.model.split(":")[0]) },
    gemini: { key: !!decKey(cfg.keys.gemini) }, anthropic: { key: !!decKey(cfg.keys.anthropic) }, openai: { key: !!decKey(cfg.keys.openai), base: cfg.openai.base },
    plainKeys: Object.values(cfg.keys || {}).some(k => typeof k === "string" && k.startsWith("raw:")), // 설정 창이 '암호화되지 않음'을 알릴 수 있게
  };
  // 사양 읽기(nvidia-smi 실행)는 Ollama 가 실제로 돌고 있을 때만 한다 —
  // 로컬 AI 를 안 쓰는 사람의 PC 에서 프로세스를 띄울 이유가 없다
  if (tags !== null) { try { s.machine = detectMachine(); s.recommend = pickOllamaModel(s.machine); } catch {} }
  s.resolved = resolve(cfg, s);
  return s;
}
// auto: 키가 있는 클라우드(품질·고유 어미 재현이 낫음) → 로컬 Ollama → OpenAI 호환. Ollama를 우선하려면 제공자를 명시
// 흐름 테스트용 모의 제공자 — 환경변수 SADO_AI_MOCK 이 있으면 네트워크 없이 정해진 답을 천천히 흘려 준다.
// 대화창 열기·전환·취소·기록 지우기 같은 경쟁을 외부 AI 없이 재현하려면 "느리고 예측 가능한" 제공자가 필요하다
const MOCK = !!process.env.SADO_AI_MOCK;
let mockStatusDelay = 0; // 다음 status() 한 번을 이만큼 늦춘다 — '먼저 연 쪽의 초기화가 늦게 끝나는' 경쟁을 만들 때(테스트 전용)
async function chatMock(messages, onToken, signal) {
  const last = [...messages].reverse().find(m => m.role === "user");
  const words = `모의 답이다비. 방금 "${(last && last.text || "").slice(0, 12)}" 라고 했지. 이건 시험용 대답이라 뜻은 없다비.`.split(" ");
  const gap = +process.env.SADO_AI_MOCK_MS || 150;   // 토큰 간격(ms) — 기본 150ms × 14토큰 ≈ 2초
  let out = "";
  for (const w of words) {
    await new Promise((res, rej) => { const t = setTimeout(res, gap); if (signal) signal.addEventListener("abort", () => { clearTimeout(t); rej(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })); }, { once: true }); });
    if (signal && signal.aborted) throw Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    const piece = (out ? " " : "") + w; out += piece; onToken(piece);
  }
  return out + "\n[감정:미소]";
}
function resolve(cfg, s) {
  if (MOCK) return "mock";
  if (cfg.provider !== "auto") return cfg.provider;
  if (s.gemini.key) return "gemini";
  if (s.anthropic.key) return "anthropic";
  if (s.ollama.running && s.ollama.hasModel) return "ollama";
  if (s.openai.key) return "openai";
  return "";
}
function merge(ai) {
  const o = { ...DEFAULTS, ...(ai || {}) };
  for (const k of ["ollama", "gemini", "anthropic", "openai", "keys"]) o[k] = { ...DEFAULTS[k], ...((ai || {})[k] || {}) };
  if (o.gemini.model === "gemini-2.5-flash") o.gemini.model = "gemini-flash-latest"; // 예전 기본값 → 신규 사용자에게 막힌 모델
  return o;
}

// 제공자들은 user/assistant 교대를 요구(Gemini: "alternate", Anthropic: 첫 메시지 user). 기록에 assistant만 연속으로 남는 경우('먼저 말 걸기'·화면 보기)를 정리
function normalizeMessages(messages) {
  const out = [];
  for (const m of messages || []) {
    if (!m || !(m.text || m.image)) continue;
    const role = m.role === "assistant" ? "assistant" : "user";
    if (!out.length && role === "assistant") out.push({ role: "user", text: "(대화 시작)" });
    const last = out[out.length - 1];
    if (last && last.role === role) { last.text = [last.text, m.text].filter(Boolean).join("\n"); if (m.image) last.image = m.image; } // 같은 역할 연속 → 합침
    else out.push({ role, text: m.text || "", ...(m.image ? { image: m.image } : {}) });
  }
  if (out.length && out[out.length - 1].role === "assistant") out.push({ role: "user", text: "(계속)" }); // 마지막은 user여야 답을 낼 수 있음
  return out;
}
/** 한 턴. messages = [{role:"user"|"assistant", text, image?}] (system 제외). onToken(delta). 반환 {text, emotion, provider, model} */
async function chat(ai, prof, messages, onToken, opts = {}) {
  const cfg = merge(ai);
  const s = await status(cfg);
  const provider = opts.provider || s.resolved;
  if (!provider) throw new Error("no-provider");
  messages = normalizeMessages(messages);
  const system = buildSystem(prof, { extra: opts.extra, image: messages.some(m => m.image) });
  const signal = opts.signal;
  let text;
  if (provider === "mock") text = await chatMock(messages, onToken, signal);
  else if (provider === "ollama") { if (!s.ollama.running) throw new Error("Ollama가 실행 중이 아니에요"); text = await chatOllama(cfg.ollama, system, messages, onToken, signal); }
  else if (provider === "gemini") text = await chatGemini(cfg.gemini, decKey(cfg.keys.gemini), system, messages, onToken, signal);
  else if (provider === "anthropic") text = await chatAnthropic(cfg.anthropic, decKey(cfg.keys.anthropic), system, messages, onToken, signal);
  else if (provider === "openai") text = await chatOpenAI(cfg.openai, decKey(cfg.keys.openai), system, messages, onToken, signal);
  else throw new Error("알 수 없는 제공자 " + provider);
  const model = cfg[provider]?.model || "";
  return { ...parseEmotion(text), provider, model };
}

// 인물 사전(data/bible.json — 나무위키 사도 문서 요약: 누구인지·성격·관계·행적·말버릇)을 프롬프트 몇 줄로
function bibleBrief(b, o = {}) {
  if (!b) return "";
  const rel = (b.rel || []).slice(0, o.rel == null ? 6 : o.rel);
  // v2 행동 층(facts·voice·react·topics·never·mood, tools/bible-v2-sample.py) — 있는 사도만. short 에서는 facts·voice·never 를 짧게
  const react = b.react && !o.short ? Object.entries(b.react).slice(0, 12).map(([k, v]) => `  - ${k}: ${v}`).join("\n") : "";
  return [
    b.who ? `인물: ${b.who}` : "",
    b.facts && b.facts.length ? `확정 설정(틀리지 말 것): ${b.facts.slice(0, o.short ? 4 : 12).join(" / ")}` : "",
    b.traits && b.traits.length ? `성격·특징: ${b.traits.slice(0, o.traits || 6).join(" / ")}` : "",
    rel.length ? `다른 사도와의 관계: ${rel.join(" · ")}` : "",
    !o.short && b.story ? `원작 행적: ${b.story}` : "",
    !o.short && b.theater && b.theater.length ? `테마극장에서 보인 모습:\n${b.theater.slice(0, o.theater == null ? 2 : o.theater).map(t => `  - ${t}`).join("\n")}` : "",
    b.voice && b.voice.length ? `말투 설계: ${b.voice.slice(0, o.short ? 3 : 8).join(" / ")}` : "",
    b.quirk ? `말버릇·버릇: ${b.quirk}` : "",
    react ? `상황별 반응(이 사도라면):\n${react}` : "",
    !o.short && b.topics && b.topics.length ? `먼저 꺼낼 만한 화제: ${b.topics.slice(0, 8).join(", ")}` : "",
    b.never && b.never.length ? `하지 않는 것(설정 오류 방지): ${b.never.slice(0, o.short ? 3 : 8).join(" / ")}` : "",
    !o.short && b.mood ? `감정 경향(감정 태그 고를 때): ${b.mood}` : "",
  ].filter(Boolean).join("\n");
}
module.exports = { detectMachine, pickOllamaModel, sampleLinesFor, trimToBubble, bibleBrief, DEFAULTS, EMOTIONS, merge, status, chat, buildSystem, parseEmotion, normalizeMessages, encKey, decKey, loadHistory, saveHistory, clearHistory, ollamaTags,
  // 테스트용 — 스트림 파서와 제공자 함수. 앱 코드는 위의 것만 쓴다
  _test: { stripNoise, partialField, ndjson, sse, chatGemini, setMockStatusDelay: (ms) => { mockStatusDelay = +ms || 0; } } };
