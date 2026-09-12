/* AI 대화 — 사도가 자기 말투로 대답한다. 메인 프로세스 전용.
 * 제공자(provider):
 *   ollama    로컬 무료 (http://localhost:11434). 기본 모델 exaone3.5:7.8b(LG, 한국어 강함) — 사용자 PC에서 돌아가므로 키·비용 없음
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

const EMOTIONS = { "행복": "happy", "기쁨": "happy", "미소": "smile", "분노": "anger", "화남": "anger", "슬픔": "sad", "놀람": "surprise", "냠냠": "eat", "삐짐": "sulky", "기본": "", "평온": "" };
const DEFAULTS = {
  provider: "auto",
  ollama: { url: "http://localhost:11434", model: "exaone3.5:7.8b" },
  gemini: { model: "gemini-flash-latest" }, // 별칭 — 구글이 최신 Flash로 연결(2.5-flash는 신규 사용자에게 막힘)
  anthropic: { model: "claude-opus-5" },
  openai: { base: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  keys: { gemini: "", anthropic: "", openai: "" }, // 암호문
  proactive: true, proactiveMin: 40, memory: true, maxTurns: 12,
  duo: true, // 소환된 사도가 둘 이상이면 가끔 둘이 잡담
  bubbleSec: 6, // 잡담 말풍선 기본 표시 시간(초) + 글자당 0.12초
};

// ---- 키 ----
function encKey(plain) {
  if (!plain) return "";
  try { if (safeStorage.isEncryptionAvailable()) return "enc:" + safeStorage.encryptString(plain).toString("base64"); } catch {}
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
  royal: "고풍스러운 하대(~노라/~이니라/~하거라)로 위엄 있게",
  haso: "극존칭 옛말(~사옵니다/~이옵니다/~하시옵소서)로 공손하게",
  vivi: "귀족 아가씨 말투(~사와요/~이사와요)로 우아하게",
  noun: "명사형 종결(~함/~임/~음)로 짧고 건조하게",
  hao: "하오체(~소/~오/~하시오)로 점잖게",
  robot: "기계적인 보고체(~임./~음./~요망.)로. 감정 표현은 '분석 결과' 식으로",
  jubee: "말끝에 '~다비'를 붙이는 꿀벌 말투로",
  ayla: "졸린 듯 말끝을 '~그마~'로 늘이는 말투로",
  momo: "닌자 말투(~입니닷/~습니닷)로 씩씩하게",
  crepe: "해요체로 어리고 순수하게. 사물에도 '님'을 붙이고(유튜브님, 먼지님) 청소 비유를 자주 쓰며 '하핫', '헤헤' 웃음",
};
const STYLE_KO = { polite: "해요체", formal: "합니다체", casual: "반말", royal: "하대(~노라/~거라)", haso: "극존칭 옛말", vivi: "~사와요", noun: "명사형(~함/~임)", hao: "하오체", robot: "보고체", jubee: "~다비", ayla: "~그마", momo: "~입니닷", crepe: "해요체" };
function buildSystem(prof, opts = {}) {
  const p = prof || { ko: "크레페", style: "crepe", addr: "교주님", lines: [] };
  const style = STYLE_DESC[p.style] || STYLE_DESC.polite;
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
  const catch_ = si && si.catch && si.catch.length ? si.catch.slice(0, 8).join(", ") : "";
  return [
    `너는 모바일 게임 <트릭컬 리바이브>의 사도 "${p.ko}"${p.skin ? ` (지금 입은 옷: ${p.skin})` : ""}이다. 지금은 게임 밖, 사용자의 PC 바탕화면에 작은 SD 캐릭터로 서 있고, 사용자는 게임의 플레이어(교주)다.`,
    `사용자를 부를 때는 "${p.addr || "교주"}"라고 부른다.${p.me ? ` 자신을 가리킬 때는 "${p.me}"라고 한다.` : ""}`,
    `말투: ${style}. 게임 속 성격과 세계관(엘리아스 대륙, 교단, 사도들)을 유지하되, 게임 지식이 확실치 않으면 아는 척하지 말고 자연스럽게 넘어간다.`,
    mix,
    interj ? `자주 쓰는 감탄사: ${interj}` : "",
    catch_ ? `자주 입에 올리는 사람·물건·소재(다른 사도보다 유난히): ${catch_}` : "",
    lines ? `실제 대사 표본(말투 참고용, 그대로 반복하지 말 것):\n${lines}` : "",
    "규칙:",
    "- 답은 한국어로 1~3문장, 말풍선에 들어갈 만큼 짧게. 목록·마크다운·이모지 금지.",
    "- AI나 언어모델이라는 말은 하지 않는다. 캐릭터로서 답한다. 모르는 것은 캐릭터답게 모른다고 한다.",
    "- 사용자의 화면·현재 시각·상황이 주어지면 그걸 자연스럽게 언급할 수 있다.",
    "- 마지막 줄에 반드시 감정 태그 하나를 붙인다: [감정:행복] [감정:미소] [감정:분노] [감정:슬픔] [감정:놀람] [감정:냠냠] [감정:삐짐] [감정:기본] 중 하나. 태그를 빼먹지 말 것.",
    "답 형식 예시:\n간식 좀 남은 거 없어? 배고파~!\n[감정:냠냠]",
    opts.extra || "",
  ].filter(Boolean).join("\n");
}
function parseEmotion(text) {
  const t = (text || "").trim();
  const m = /\[\s*감정\s*[:：]\s*([^\]]+)\]\s*$/.exec(t) || /\[\s*감정\s*[:：]\s*([^\]]+)\]/.exec(t); // 끝에 없으면 중간 어디든
  const clean = (m ? t.slice(0, m.index) + t.slice(m.index + m[0].length) : t).replace(/\n{2,}/g, "\n").trim();
  const key = m ? m[1].trim() : "";
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
async function ollamaTags(url) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 1500);
  try { const r = await fetch(`${url}/api/tags`, { signal: ctl.signal }); if (!r.ok) return null; const j = await r.json(); return (j.models || []).map(m => m.name); }
  catch { return null; } finally { clearTimeout(t); }
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

async function chatOllama(cfg, system, messages, onToken, signal) {
  const msgs = [{ role: "system", content: system }, ...messages.map(m => ({ role: m.role, content: m.text, ...(m.image ? { images: [m.image.data] } : {}) }))];
  const r = await fetch(`${cfg.url}/api/chat`, { method: "POST", signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ model: cfg.model, messages: msgs, stream: true, options: { temperature: 0.9, num_predict: 300 } }) });
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${(await r.text()).slice(0, 200)}`);
  let out = "";
  for await (const line of ndjson(r.body)) { let j; try { j = JSON.parse(line); } catch { continue; } if (j.error) throw new Error("Ollama: " + j.error); const t = j.message?.content || ""; if (t) { out += t; onToken(t); } if (j.done) break; }
  return out;
}
async function chatGemini(cfg, key, system, messages, onToken, signal, noThinkCfg = false) {
  const contents = messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [...(m.image ? [{ inline_data: { mime_type: m.image.mime || "image/png", data: m.image.data } }] : []), { text: m.text }] }));
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:streamGenerateContent?alt=sse`;
  // Flash는 기본으로 '생각' 토큰을 쓰고 그게 maxOutputTokens에 포함돼 답이 잘림 → 생각 끄기(안 받는 모델이면 빼고 재시도) + 여유 있는 상한
  const generationConfig = { temperature: 0.9, maxOutputTokens: 1024, ...(noThinkCfg ? {} : { thinkingConfig: { thinkingBudget: 0 } }) };
  const r = await fetch(url, { method: "POST", signal, headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify({ system_instruction: { parts: [{ text: system }] }, contents, generationConfig }) });
  if (!r.ok) {
    const body = await r.text();
    if (r.status === 404 && /no longer available|not found/i.test(body) && cfg.model !== "gemini-flash-latest") return chatGemini({ ...cfg, model: "gemini-flash-latest" }, key, system, messages, onToken, signal, noThinkCfg); // 은퇴한 모델 → 최신 Flash 별칭으로
    if (r.status === 400 && !noThinkCfg && /thinking/i.test(body)) return chatGemini(cfg, key, system, messages, onToken, signal, true);
    let msg = body; try { msg = JSON.parse(body).error?.message || body; } catch {}
    throw new Error(`Gemini ${r.status}: ${msg.slice(0, 300)}`);
  }
  let out = "";
  for await (const d of sse(r.body)) { let j; try { j = JSON.parse(d); } catch { continue; } const t = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join(""); if (t) { out += t; onToken(t); } }
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
async function status(ai) {
  const cfg = merge(ai);
  const tags = await ollamaTags(cfg.ollama.url);
  const s = {
    ollama: { running: tags !== null, models: tags || [], hasModel: !!tags && tags.some(t => t === cfg.ollama.model || t.split(":")[0] === cfg.ollama.model.split(":")[0]) },
    gemini: { key: !!decKey(cfg.keys.gemini) }, anthropic: { key: !!decKey(cfg.keys.anthropic) }, openai: { key: !!decKey(cfg.keys.openai), base: cfg.openai.base },
  };
  s.resolved = resolve(cfg, s);
  return s;
}
function resolve(cfg, s) {
  if (cfg.provider !== "auto") return cfg.provider;
  if (s.ollama.running && s.ollama.hasModel) return "ollama";
  if (s.gemini.key) return "gemini";
  if (s.anthropic.key) return "anthropic";
  if (s.openai.key) return "openai";
  return "";
}
function merge(ai) {
  const o = { ...DEFAULTS, ...(ai || {}) };
  for (const k of ["ollama", "gemini", "anthropic", "openai", "keys"]) o[k] = { ...DEFAULTS[k], ...((ai || {})[k] || {}) };
  if (o.gemini.model === "gemini-2.5-flash") o.gemini.model = "gemini-flash-latest"; // 예전 기본값 → 신규 사용자에게 막힌 모델
  return o;
}

/** 한 턴. messages = [{role:"user"|"assistant", text, image?}] (system 제외). onToken(delta). 반환 {text, emotion, provider, model} */
async function chat(ai, prof, messages, onToken, opts = {}) {
  const cfg = merge(ai);
  const s = await status(cfg);
  const provider = opts.provider || s.resolved;
  if (!provider) throw new Error("no-provider");
  const system = buildSystem(prof, { extra: opts.extra });
  const signal = opts.signal;
  let text;
  if (provider === "ollama") { if (!s.ollama.running) throw new Error("Ollama가 실행 중이 아니에요"); text = await chatOllama(cfg.ollama, system, messages, onToken, signal); }
  else if (provider === "gemini") text = await chatGemini(cfg.gemini, decKey(cfg.keys.gemini), system, messages, onToken, signal);
  else if (provider === "anthropic") text = await chatAnthropic(cfg.anthropic, decKey(cfg.keys.anthropic), system, messages, onToken, signal);
  else if (provider === "openai") text = await chatOpenAI(cfg.openai, decKey(cfg.keys.openai), system, messages, onToken, signal);
  else throw new Error("알 수 없는 제공자 " + provider);
  const model = cfg[provider]?.model || "";
  return { ...parseEmotion(text), provider, model };
}

// 사도 둘의 짧은 대화(3~5줄). 한 번의 호출로 대본을 받아 줄마다 {who, text, emotion}. 작은 모델도 따르기 쉽게 JSON 대신 "이름: 대사 [감정:x]" 줄 형식
function personaBrief(p) {
  const si = p.styleInfo || null;
  const lines = [...(p.lines || []).slice(0, 4), ...((si && si.samples) || []).slice(0, 6)].map(l => `  - ${l}`).join("\n");
  return [`■ ${p.ko}${p.skin ? ` (옷: ${p.skin})` : ""}: 말투 ${STYLE_DESC[p.style] || STYLE_DESC.polite}.${p.me ? ` 자칭 "${p.me}".` : ""}${si && si.catch && si.catch.length ? ` 자주 입에 올리는 것: ${si.catch.slice(0, 6).join(", ")}.` : ""}`, lines ? `  대사 표본:\n${lines}` : ""].filter(Boolean).join("\n");
}
// 같은 사도 둘(스킨만 다르거나 완전히 같은)이면 이름을 구분해 준다: "벨라(존재감 넘치는 구미호)" / "벨라(기본)" — 그래도 같으면 "벨라 A"/"벨라 B"
function duoLabels(a, b) {
  if (a.ko !== b.ko) return [a.ko, b.ko];
  let la = a.skin ? `${a.ko}(${a.skin})` : `${a.ko}(기본)`, lb = b.skin ? `${b.ko}(${b.skin})` : `${b.ko}(기본)`;
  if (la === lb) { la = `${a.ko} A`; lb = `${b.ko} B`; }
  return [la, lb];
}
function buildDuoSystem(a, b, opts = {}) {
  const [la, lb] = duoLabels(a, b); const same = a.ko === b.ko;
  return [
    `너는 모바일 게임 <트릭컬 리바이브>의 두 사도가 나누는 짧은 대화를 쓰는 작가다. 두 사도는 지금 게임 밖, 사용자의 PC 바탕화면에 작은 SD 캐릭터로 서 있다가 마주쳤다. 사용자(교주)는 근처에서 보고 있을 수도 있다.`,
    same ? `특이 상황: 둘은 같은 사도 ${a.ko}가 둘이다(교주가 둘 소환함${a.skin !== b.skin ? ", 입은 옷만 다름" : ""}). 서로를 보고 놀라거나, 누가 진짜인지 다투거나, 죽이 맞아 장난치는 식으로 — 같은 성격이 둘이라 생기는 재미를 살려라. 이름은 아래 표기 그대로 구분해 쓴다.` : "",
    personaBrief(a).replace(`■ ${a.ko}`, `■ ${la}`), personaBrief(b).replace(`■ ${b.ko}`, `■ ${lb}`),
    "규칙:",
    `- 정확히 ${opts.n || 4}줄. 한 줄 = 한 사람의 한 마디(1~2문장, 40자 안팎). 두 사람이 번갈아 말하되 ${la}가 먼저 시작한다.`,
    `- 각 줄은 반드시 이 형식: 이름: 대사 [감정:행복|미소|분노|슬픔|놀람|냠냠|삐짐|기본]  (이름은 "${la}" / "${lb}" 그대로)`,
    "- 원작에서 둘의 관계(친구·라이벌·동료·가족 등)를 안다면 반영하고, 모르면 첫 만남처럼 자연스럽게. 서로의 말투·성격이 뚜렷이 드러나게.",
    "- 마크다운·이모지·설명·따옴표 금지. 대사만.",
    opts.extra || "",
  ].filter(Boolean).join("\n");
}
function parseDuo(text, a, b) {
  const out = []; const [la, lb] = duoLabels(a, b); const same = a.ko === b.ko;
  const norm = (s) => s.replace(/[\s"'“”()（）·]/g, "");
  let turn = "a"; // 같은 사도 둘인데 라벨 없이 이름만 쓴 경우 → 번갈아 배정
  for (const raw of (text || "").split(/\r?\n/)) {
    const line = raw.replace(/^[-*\d.)\s]+/, "").trim(); if (!line) continue;
    const m = /^(.{1,30}?)\s*[:：]\s*(.+)$/.exec(line); if (!m) continue;
    const name = norm(m[1]);
    let who = name === norm(la) ? "a" : name === norm(lb) ? "b" : null;
    if (!who && !same) who = name === a.ko || a.ko.startsWith(name) || name.startsWith(a.ko) ? "a" : name === b.ko || b.ko.startsWith(name) || name.startsWith(b.ko) ? "b" : null;
    if (!who && same && (name.startsWith(a.ko) || a.ko.startsWith(name))) who = turn;
    if (!who) continue;
    turn = who === "a" ? "b" : "a";
    const pe = parseEmotion(m[2].replace(/^["'“]|["'”]$/g, ""));
    if (pe.text) out.push({ who, text: pe.text, emotion: pe.emotion });
  }
  return out;
}
async function duo(ai, profA, profB, opts = {}) {
  const cfg = merge(ai); const s = await status(cfg); const provider = opts.provider || s.resolved;
  if (!provider) throw new Error("no-provider");
  const system = buildDuoSystem(profA, profB, opts);
  const messages = [{ role: "user", text: `대화를 써라.${opts.topic ? " 화제: " + opts.topic : ""}` }];
  const noop = () => {}; let text;
  if (provider === "ollama") text = await chatOllama(cfg.ollama, system, messages, noop, opts.signal);
  else if (provider === "gemini") text = await chatGemini(cfg.gemini, decKey(cfg.keys.gemini), system, messages, noop, opts.signal);
  else if (provider === "anthropic") text = await chatAnthropic(cfg.anthropic, decKey(cfg.keys.anthropic), system, messages, noop, opts.signal);
  else text = await chatOpenAI(cfg.openai, decKey(cfg.keys.openai), system, messages, noop, opts.signal);
  const lines = parseDuo(text, profA, profB);
  return { lines, raw: text, provider, model: cfg[provider]?.model || "" };
}
module.exports = { DEFAULTS, EMOTIONS, merge, status, chat, duo, buildSystem, buildDuoSystem, parseDuo, parseEmotion, encKey, decKey, loadHistory, saveHistory, clearHistory, ollamaTags };
