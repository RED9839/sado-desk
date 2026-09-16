/* 답의 끝맺음이 그 사도의 말투인지 가린다. 재는 도구들이 같은 잣대를 쓰도록 여기 모아 둔다.
 * 좁은 말투부터 본다 — '사옵니다'는 formal(습니다)에도 걸리고 '하오'는 royal(시오)에도 걸리므로 순서가 중요하다. */
const ENDS = [
  ["vivi",   /(사와요|이와요|하시와요|와요)[!?.~…⋯]*$/],                                   // 비비
  ["ayla",   /(그마|라바)[!?.~…⋯]*$/],                                                    // 아일라
  ["momo",   /(입니닷|습니닷|니닷|겁니깟|니깟|하십숏|십숏|닷)[!?.~…⋯]*$/],                  // 모모
  ["jubee",  /(다비|지비|냐비|라비|구비|비)[!?.~…⋯]*$/],                                   // 쥬비
  ["haso",   /(사옵니다|옵니다|사옵고|옵소서|나이다|더이다|겠사옵|이옵|하옵)[!?.~…⋯]*$/],    // 실비아
  ["hao",    /(하오|하시오|구려|이라오|라오|이오|겠소|다오)[!?.~…⋯]*$/],                     // 하오체
  ["royal",  /(구나|느냐|거라|이니라|니라|로다|도다|말이다|것이다|하라|리라|노라|소이다|더냐|겠느냐)[!?.~…⋯]*$/],
  ["robot",  /(요망|완료|확인|보고|개시|정지|이상|바람)[!?.~…⋯]*$/],                        // 마에스트로 2호 — 보고체
  ["noun",   /(함|임|음|짐|됨|옴|감|봄)[!?.~…⋯]*$/],                                       // 마요 — 명사형
  ["formal", /(습니다|입니다|니다|십시오|습니까|입니까|슴다|임다|함다|십쇼)[!?.~…⋯]*$/],
  ["polite", /(요오*|죠오*|용|죵|에요|예요|네요|군요|세요|나요|까요)[!?.~…⋯]*$/],
  ["casual", /(다|어|야|지|해|래|자|네|군|나|거|걸|데|까|냐|니|봐|줘|아|게)[!?.~…⋯]*$/],
];
// crepe 는 해요체라 polite 로 본다(STYLE_DESC 도 그렇게 적혀 있다)
const SAME = { crepe: "polite", robot: "noun" }; // crepe 는 해요체, 보고체는 명사형이 본체다
function classify(s) {
  const c = String(s || "").replace(/[\s.!?~…⋯'"]+$/, "");
  for (const [n, rx] of ENDS) if (rx.test(c)) return n;
  return null;
}
// 문장 끝에 붙는 호칭("안녕하세요, 교주님!")은 떼고 봐야 어미가 보인다
const VOC = /[,，]?\s*(교주님|교주|빵주|주인님|주인|마스터|사장님|선생님|손님|대장|촌장님|언니|누나|형|오빠|친구|그대|당신|자기)\s*$/;
/** 뒤에서부터 문장을 훑어 어미가 가려지는 첫 문장으로 판단한다 */
function matches(answer, style) {
  const sents = String(answer || "").split(/[\n.!?~…⋯]/).map(x => x.trim()).filter(Boolean);
  let got = null;
  for (let i = sents.length - 1; i >= 0 && !got; i--) got = classify(sents[i]) || classify(sents[i].replace(VOC, ""));
  if (!got) return { got: null, ok: null };           // 가릴 수 없는 끝맺음 — 세지 않는다
  const want = SAME[style] || style;
  return { got, ok: got === want };
}
/** 답 안에서 그 사도 말투가 한 번이라도 나왔는가 — 말풍선에서 사람이 느끼는 것은 이쪽이다 */
function matchesAny(answer, style) {
  const sents = String(answer || "").split(/[\n.!?~…⋯]/).map(x => x.trim()).filter(Boolean);
  const want = SAME[style] || style;
  const got = [];
  for (const s of sents) { const c = classify(s) || classify(s.replace(VOC, "")); if (c) got.push(SAME[c] || c); }
  if (!got.length) return { got: [], ok: null };
  return { got, ok: got.includes(want) };
}
module.exports = { ENDS, classify, matches, matchesAny, SAME };
