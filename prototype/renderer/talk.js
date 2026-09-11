/* 사도별 말투로 새 소식 알리기. 메인(node)과 말풍선 창(브라우저) 공용.
 * 프로필(assets/talk-ko.json, tools/build-talk.py가 나무위키 대사표에서 추출): style(어미 부류) · addr(교주 호칭) · me(자칭) · interj(감탄사) · lines(실제 대사 표본)
 * 문장은 어간 + 어미 슬롯으로 쓰고, style마다 슬롯을 채운다:
 *   {PAST} 았/었 뒤 ("올라왔{PAST}")   {PRES} 있/없 뒤 ("있{PRES}")   {COP} 명사 뒤 서술 ("새 소식{COP}")   {REQ} "확인{REQ}" 같은 요청
 * style: polite(해요) formal(합니다) casual(반말) royal(~거라/노라: 다야·벨리타·아라그니아) haso(~옵니다: 실비아) vivi(~사와요: 비비)
 *        noun(~함/~임: 마요) hao(~소/~오: 잉클·에피카) robot(마에스트로) jubee(~다비) ayla(~그마) momo(~입니닷) crepe(전용 문장) */
(function (root) {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const S = {
    polite: { PAST: "어요", PRES: "어요", COP: "이에요", REQ: "해 주세요",
      head: ["{addr}! 잠깐만요!", "{addr}, 소식이 있어요!", "{addr}! {addr}!", "{addr}, 잠깐 이것 좀 보세요!"],
      tail: ["확인해 보시고 알려 주세요!", "제가 먼저 알려드린 거예요!", "놓치면 아쉬우니까 꼭 보세요!", "그럼 저는 하던 일 하러 갈게요!"] },
    formal: { PAST: "습니다", PRES: "습니다", COP: "입니다", REQ: "해 주십시오",
      head: ["{addr}, 보고드립니다.", "{addr}, 잠시 시간 괜찮으십니까?", "{addr}, 새 소식입니다."],
      tail: ["확인 후 지시를 기다리겠습니다.", "이상, 보고를 마칩니다.", "필요하시면 다시 말씀드리겠습니다."] },
    casual: { PAST: "어", PRES: "어", COP: "이야", REQ: "해 봐",
      head: ["{addr}! 잠깐 이리 와 봐.", "야, {addr}! 소식 있어.", "{addr}, 이거 봐.", "{addr}! 이거 알아?"],
      tail: ["먼저 알려준 건 나니까 기억해 둬.", "궁금하면 직접 봐. 난 여기까지.", "봤으면 나한테도 얘기해 줘.", "이제 됐지? 나 간다."] },
    royal: { PAST: "노라", PRES: "노라", COP: "이니라", REQ: "해 보거라",
      head: ["{addr}, 들으라.", "{addr}, 잠시 멈추거라.", "{addr}. 알려줄 것이 있노라."],
      tail: ["확인은 그대가 하거라.", "이만하면 충분히 일러 주었노라.", "게으름 피우지 말고 보거라."] },
    haso: { PAST: "사옵니다", PRES: "사옵니다", COP: "이옵니다", REQ: "해 보시옵소서",
      head: ["{addr}, 소녀가 아뢰옵니다.", "{addr}, 잠시 귀를 기울여 주시옵소서."],
      tail: ["부디 살펴 주시옵소서.", "소녀는 이만 물러가옵니다.", "어리다고 얕보지 마시옵소서. 소식은 정확하옵니다."] },
    vivi: { PAST: "사와요", PRES: "사와요", COP: "이사와요", REQ: "해 보시와요",
      head: ["{addr}, 소식이 있사와요.", "{addr}, 잠깐 들어 보시와요.", "{addr}. 숙녀의 정보력을 보여드리겠사와요."],
      tail: ["품격 있게 확인하시와요.", "소녀는 이만 물러가겠사와요.", "엣취! ⋯실례했사와요."] },
    noun: { PAST: "음", PRES: "음", COP: "임", REQ: "해야 함",
      head: ["{addr}. 보고 있음.", "{addr}, 잠깐 주목.", "{addr}. 새 소식 발견."],
      tail: ["확인 안 하면 수집품 압수임.", "이상. 관찰 계속함.", "나중에 감상 공유 바람."] },
    hao: { PAST: "소", PRES: "소", COP: "이오", REQ: "해 보시오",
      head: ["{addr}, 소식이 있소.", "{addr}, 잠시 들어 보시오.", "{addr}. 전할 말이 있소."],
      tail: ["확인은 그대에게 맡기겠소.", "이만하면 됐소? 그럼 이만.", "놓치지 마시오."] },
    robot: { PAST: "음.", PRES: "음.", COP: "임.", REQ: " 요망.",
      head: ["{addr}. 외부 정보 갱신 감지.", "알림. {addr}, 새 데이터 수신.", "{addr}. 보고 프로토콜 개시."],
      tail: ["확인 완료 시 응답 바람.", "보고 종료. 대기 모드 전환.", "우호적 의도의 알림임. 척살 모드 아님."] },
    jubee: { PAST: "다비", PRES: "다비", COP: "이다비", REQ: "해 보라비",
      head: ["{addr}! 소식이 있다비!", "{addr}, 잠깐 들어봐라비!", "애애앵! {addr}! 소식이다비!"],
      tail: ["꿀보다 달콤한 소식이다비~", "확인 안 하면 침 쏜다비!", "그럼 난 꿀 모으러 간다비~"] },
    ayla: { PAST: "그마~", PRES: "그마~", COP: "이그마~", REQ: "해 봐그마~",
      head: ["{addr}~ 소식이 있그마~", "{addr}, 잠깐 일어나 봐그마~", "으으⋯ 단잠 깨우는 소식이그마~"],
      tail: ["확인했으면 나랑 같이 낮잠 자그마~", "무리하지 말고 천천히 보그마~", "햇볕 좋을 때 보면 더 좋그마~"] },
    momo: { PAST: "습니닷", PRES: "습니닷", COP: "입니닷", REQ: "해 주십시닷",
      head: ["{addr}! 보고입니닷!", "{addr}, 닌자의 정보망이 소식을 물어왔습니닷!", "야호! {addr}! 새 소식입니닷!"],
      tail: ["일류 닌자 모모, 임무 완수입니닷!", "확인은 스피드가 생명입니닷!", "그럼 수련하러 가는 것입니닷!"] },
  };
  // 크레페 전용 (교단 청소 담당 주민: 사물에 '님', 청소 비유, 하핫/헤헤)
  const CREPE = {
    head: ["교주님! 교주님!", "교주님, 잠깐만요!", "교주님~ 크레페예요!", "교주님! 청소하다가 발견했어요!", "교주님, 크레페가 소식을 물어왔어요!"],
    body: {
      youtube: ["유튜브님에 새 영상님이 올라왔어요! 샥샥 보고 오세요~", "유튜브님이 새 영상을 내놓으셨어요! 크레페가 먼저 봐도 되나요?", "새 영상님 도착이에요! 먼지 앉기 전에 얼른 보셔야 해요!"],
      notice: ["라운지님에 새 공지사항님이 붙었어요! 깨끗하게 읽어 주세요!", "공지사항님이 새로 올라왔어요! 놓치면 큰일 나요~", "라운지님 게시판을 털었더니 새 공지가 나왔어요!"],
      update: ["업데이트님이 왔어요! 교단님이 새 옷을 입는 거예요!", "라운지님에 업데이트 소식님이 올라왔어요! 샥샥 확인해 주세요~", "새 업데이트예요! 크레페가 먼저 읽어봤는데… 어려운 말이 많았어요."],
      devnote: ["개발자 노트님이 올라왔어요! 어른들이 뭔가 열심히 쓰셨어요!", "라운지님에 새 개발자 노트가 있어요! 읽으시면 크레페한테도 알려주세요!"],
      event: ["새 이벤트님이 시작됐어요! 간식이 있을지도 몰라요!", "라운지님에 진행 이벤트 소식이에요! 참여하시면 크레페도 응원할게요!"],
      pv: ["테마극장 PV님이 새로 올라왔어요! 크레페도 같이 보고 싶어요~"],
      coupon: ["쿠폰 게시판님에 새 글이에요! 쿠폰님은 먼지보다 빨리 사라져요!"],
      default: ["라운지님에 새 소식이 올라왔어요! 확인해 주세요~"],
    },
    many: ["새 소식님이 한꺼번에 {n}개나 왔어요! 크레페가 일단 되는대로 정리해놨어요!", "교주님! 소식님이 {n}개 쌓였어요! 먼지처럼 쌓이기 전에 봐 주세요~"],
    none: "지금은 새 소식님이 없어요. 라운지님도 유튜브님도 깨끗해요!",
    tail: ["헤헤~ 크레페, 잘했나요?", "하핫! 어때요? 소식도 깨끗하게 전해드렸죠?", "이제 다시 청소하러 갈게요! 샥샥!", "확인은 교주님께 맡길게요! 금방 끝날 거예요!"],
  };
  // 공용 본문 (어미 슬롯). 어간은 ㅏ/ㅓ 모음조화가 필요 없는 것만: 올라왔·왔·생겼·있·없·했
  const BODY = {
    youtube: ["공식 유튜브에 새 영상이 올라왔{PAST} 확인{REQ}", "유튜브에 새 영상{COP} 놓치기 전에 확인{REQ}", "새 영상이 도착했{PAST} 시간 날 때 보기{REQ2}"],
    notice: ["라운지에 새 공지사항이 올라왔{PAST} 확인{REQ}", "공지사항이 새로 붙었{PAST} 중요한 내용일지도 모르니 확인{REQ}"],
    update: ["업데이트 소식이 올라왔{PAST} 무엇이 바뀌었는지 확인{REQ}", "라운지에 업데이트 안내가 있{PRES} 확인{REQ}"],
    devnote: ["개발자 노트가 새로 올라왔{PAST} 읽어 볼 만한 이야기가 있{PRES}", "라운지에 새 개발자 노트{COP} 확인{REQ}"],
    event: ["새 이벤트 소식이 올라왔{PAST} 보상이 있을지도 모르니 확인{REQ}", "이벤트 안내가 새로 붙었{PAST} 참여 기간을 확인{REQ}"],
    pv: ["테마극장 PV가 올라왔{PAST} 같이 보고 싶었{PAST}", "새 PV가 도착했{PAST} 확인{REQ}"],
    coupon: ["쿠폰 게시판에 새 글이 올라왔{PAST} 쿠폰은 금방 사라지니 서둘러 확인{REQ}"],
    default: ["라운지에 새 소식이 올라왔{PAST} 확인{REQ}"],
    many: ["새 소식이 {n}개나 쌓였{PAST} 하나씩 확인{REQ}", "소식이 한꺼번에 {n}개 왔{PAST} 아래 목록을 확인{REQ}"],
    none: ["지금은 새 소식이 없{PRES}", "라운지도 유튜브도 조용{COP2}"],
  };
  const PUNCT = { polite: "!", formal: ".", casual: ".", royal: ".", haso: ".", vivi: ".", noun: ".", hao: ".", robot: "", jubee: "!", ayla: "", momo: "!" };
  function fill(tpl, style, vars) {
    const s = S[style] || S.polite; const p = PUNCT[style] ?? ".";
    let t = tpl
      .replace(/\{PAST\}/g, s.PAST + (s.PAST.endsWith(".") ? "" : p) + " ")
      .replace(/\{PRES\}/g, s.PRES + (s.PRES.endsWith(".") ? "" : p) + " ")
      .replace(/\{COP\}/g, s.COP + (s.COP.endsWith(".") ? "" : p) + " ")
      .replace(/\{COP2\}/g, (style === "noun" || style === "robot" ? "함." : s.COP.replace(/^이/, "")) + " ")
      .replace(/\{REQ\}/g, s.REQ + (s.REQ.endsWith(".") ? "" : p))
      .replace(/\{REQ2\}/g, style === "noun" || style === "robot" ? " 바람." : style === "casual" ? " 바래." : style === "royal" ? " 바라노라." : style === "jubee" ? " 바란다비!" : style === "ayla" ? " 바라그마~" : style === "hao" ? " 바라오." : style === "haso" ? " 바라옵니다." : style === "vivi" ? " 바라사와요." : style === "momo" ? " 바랍니닷!" : style === "formal" ? " 바랍니다." : " 바라요!")
      .replace(/\{n\}/g, vars.n);
    return t.replace(/\s+/g, " ").trim();
  }
  function sub(tpl, prof) {
    let t = tpl.replace(/\{addr\}/g, prof.addr || "교주님").replace(/\{me\}/g, prof.me || "").replace(/\{n\}/g, prof.n ?? "");
    if (prof.me) { // 자칭(코미·쥬비·이 몸 …)이 있으면 1인칭 '나/난/저/제가'를 바꿔 준다
      const me = prof.me, last = me.charCodeAt(me.length - 1), cons = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0; // 받침 유무
      t = t.replace(/(^|\s)난(\s)/g, `$1${me}${cons ? "은" : "는"}$2`).replace(/(^|\s)나니까/g, `$1${me}${cons ? "이" : ""}니까`).replace(/(^|\s)나(는|도|한테|만|\s|$)/g, (m, a, b) => `${a}${me}${b === "는" && cons ? "은" : b}`).replace(/(^|\s)제가(\s)/g, `$1${me}${cons ? "이" : "가"}$2`).replace(/(^|\s)저는(\s)/g, `$1${me}${cons ? "은" : "는"}$2`);
    }
    return t;
  }

  // items: [{source,label,title,url}], prof: {style, addr, me, interj[], lines[], ko}
  function announce(items, prof) {
    prof = prof || { style: "crepe", addr: "교주님" };
    const list = items || [];
    const srcs = [...new Set(list.map(i => i.source))];
    const lines = list.slice(0, 4).map(i => `[${i.label}] ${i.title}`);
    if (prof.style === "crepe") {
      let body;
      if (list.length === 1) body = pick(CREPE.body[list[0].source] || CREPE.body.default);
      else if (list.length > 1) body = srcs.length === 1 ? pick(CREPE.body[srcs[0]] || CREPE.body.default).replace(/새 (영상|공지사항|업데이트 소식|개발자 노트|이벤트)님이/, `새 $1님이 ${list.length}개`) : pick(CREPE.many).replace("{n}", list.length);
      else body = CREPE.none;
      let head = pick(CREPE.head), tail = pick(CREPE.tail);
      if (prof.skin && (prof.interj || []).length && Math.random() < 0.6) head = `${pick(prof.interj)} ${head}`; // 뿅아리 클리너: "꼬끼오! 교주님! 교주님!"
      if (prof.skin && (prof.lines || []).length && Math.random() < 0.4) tail = `${tail} …${pick(prof.lines)}`;
      return { head, body, tail, lines, who: "크레페" };
    }
    const st = S[prof.style] ? prof.style : "polite", s = S[st];
    let body;
    if (list.length === 0) body = fill(pick(BODY.none), st, { n: 0 });
    else if (list.length === 1 || srcs.length === 1) { body = fill(pick(BODY[srcs[0]] || BODY.default), st, { n: list.length }); if (list.length > 1) body = body.replace(/(새 [^ ]+이) /, `$1 ${list.length}개 `); }
    else body = fill(pick(BODY.many), st, { n: list.length });
    // 감탄사(40%) + 실제 대사 한 줄(30%)로 개성 보강
    const FL = (typeof TalkFlavor !== "undefined" ? TalkFlavor : (typeof require === "function" ? require("./talk-flavor.js") : null));
    const flavor = FL && prof.hero ? FL.flavorFor(prof.hero) : null; // 사도 전용 머리말/꼬리말 (70%)
    const useF = !!flavor && Math.random() < 0.7;
    const ij = (prof.interj || []).filter(Boolean);
    if (!useF && ij.length && Math.random() < 0.4) { // 전용 머리말을 쓸 땐 감탄사 생략(이미 들어 있음)
      let w = pick(ij); if (!/[!~,.…]$/.test(w)) w += /^(흥|훗|앗|응)$/.test(w) ? "." : "~"; body = w + " " + body; }
    // 스킨이 호칭을 바꾸면(에르핀 풀오토 고딕 → "주인") 전용 문장의 호칭도 바꿔 준다
    const reAddr = (t) => (prof.addrBase && prof.addr !== prof.addrBase) ? t.replace(new RegExp(prof.addrBase.replace(/님$/, "") + "님?", "g"), prof.addr) : t;
    let tail = useF && flavor.tail ? reAddr(pick(flavor.tail)) : sub(pick(s.tail), prof);
    if ((!useF || prof.skin) && (prof.lines || []).length && Math.random() < (prof.skin ? 0.5 : 0.35)) tail = `${tail} …${pick(prof.lines)}`; // 실제 대사 한 줄 (스킨이면 스킨 전용 대사가 우선·더 자주)
    const head = useF && flavor.head ? reAddr(pick(flavor.head)) : sub(pick(s.head), prof);
    return { head, body, tail, lines, who: prof.ko || "" };
  }
  // 스킨 이름(Mini_ErpinSkin1) → 프로필. 없으면 null
  function profileFor(talkData, skinName) {
    if (!talkData || !skinName) return null;
    const hero = skinName.replace(/^Mini_/, "").replace(/Skin\d+$/, "");
    const p = talkData.heroes[hero]; if (!p) return null;
    const m = skinName.match(/Skin(\d+)$/), sk = m && p.skins && p.skins[m[1]];
    if (!sk) return { ...p, hero, addrBase: p.addr };
    // 테마 사복(스킨) 보정: 위키 대사표에서 그 스킨만 다르게 나온 호칭·감탄사·어미 + 스킨 전용 대사 인용 우선
    return { ...p, hero, addrBase: p.addr, skin: sk.label, addr: sk.addr || p.addr, style: sk.style || p.style, interj: [...(sk.interj || []), ...(p.interj || [])].slice(0, 6), lines: [...(sk.lines || []), ...(sk.lines || []), ...(p.lines || [])] };
  }
  const api = { announce, profileFor, STYLES: S, CREPE, BODY, fill };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Talk = api;
})(typeof window !== "undefined" ? window : globalThis);
