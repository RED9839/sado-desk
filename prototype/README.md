# 사도 데스크 (SadoDesk) — 트릭컬 리바이브 사도 데스크탑 마스코트

Electron + 공식 spine-ts 4.1 런타임으로 트릭컬 **미니미** Spine 데이터를 그대로 재생하는 데스크탑 펫.

## 실행
```
run.cmd            # 또는 npm start
npm run pyruntime   # 설치판용 임베디드 Python 준비 (pyruntime/, 최초 1회)
npm run dist        # 설치판 빌드 → dist/SadoDesk-Setup-<ver>.exe (electron-builder NSIS, 에셋 미포함 ≈ 117MB). dist:dir = 무설치 폴더
run.cmd --setup-test # 에셋 없는 상태에서 가져오기 창 → 추출(미니미·효과음) → 마스코트 시작까지 자동 검증
run.cmd --selftest # 합성 마우스 이벤트로 클릭/드래그/던지기/메뉴 상태 전이 자동 검증 (run.log 또는 콘솔에 SELFTEST 줄)
run.cmd --log-pos  # 1초마다 상태/좌표 로그
run.cmd --open-menu # 2.5초 후 메뉴 자동 열기 (스크린샷용)
run.cmd --settings  # 시작하면서 설정창도 열기 (--shot-settings: 탭별 스크린샷을 out/에 저장)
run.cmd --news-test  # 4초 뒤 실제 최신 소식 말풍선 미리보기 (--news-test-fake: 가짜 2건 주입)
run.cmd --multi-test # 사도 추가 → 개별 설정 → 2번 사도 메뉴 → 제거 자동 검증 (콘솔에 MULTI 줄)
```
에셋(`assets/`)은 저장소·설치판에 포함하지 않음. 개발 중엔 `prototype/assets/`(있으면 우선), 설치판은 `%APPDATA%\사도 데스크\assets`(앱의 '에셋 가져오기'가 `tools/extract-all.py`로 사용자 PC의 뮤뮤 트릭컬에서 추출). 우선순위: 설정 `assets.root` → 개발 폴더 → userData. 한글 이름표·말투 프로필은 앱 안 `data/`.

## 용어 (화면에 보이는 말 — v0.24.4 에서 통일)
사도(등장인물) · 외형(사도+사복 선택 목록) · 사복(의상) · 미니미/스탠딩/전투 SD(표시 형태) · 동작(애니메이션) · 음성(녹음된 목소리) · 음성 대사 · 혼잣말(대본) · AI 대화 · 게임 데이터(일반 안내; 경로·진단에서는 에셋). 항목명은 짧은 명사형, 설명은 ~합니다, 요청·오류는 ~해 주세요. 코드·설정 키·문서의 `ingame`/`asset`/`voice` 같은 식별자는 그대로다.

## 사도 형태 3종 (설정 → 사도 → 형태 / 우클릭 메뉴 '형태' / 트레이)
- **미니미 (스틱)**: 공용 미니미 스켈레톤 + 외형(사도 139명·사복 279벌). 폴짝 이동·큰 점프·등장 낙하 등 게임 원본 애니 77개
- **스탠딩** (`mode: "sd"`): 대기·클릭·드래그·착지 = 스탠딩(사도 상세 화면 Spine). **이동 = 미니미 폴짝**(게임 로비처럼), 멈추면 스탠딩 복귀. 미니미 높이는 스탠딩의 0.78배. 스탠딩에 Move가 있는 사도(크레페)는 스탠딩이 직접 걷음. 스탠딩이 없는 사도는 전투 SD로 대체, 둘 다 없으면 미니미.
- **전투 SD** (`mode: "ingame"`, 화면 표기는 '전투 SD'): 전투 모델(Idle · Move · Spawn · Victory · 공격) 그대로. Move로 걷고 Spawn으로 등장하며 표정·교감 동작은 없음. 게임 데이터 가져오기에서 '전투 SD' 단계가 필요.
- 스탠딩·전투 SD 공통 구현 메모: 두 스켈레톤이 같은 단위(에르핀 Head 본 y=429 동일)라 단위 고정 배율(`SD_UNIT=0.8 × scale`) + 발→Head 높이 캐릭터별 보정(`hybridFix`). 바닥 그림자 슬롯(`CommonShadow`)은 숨김. 애니는 캐릭터별 구성이 달라 접두어로 자동 분류(`sdPools`/`ingamePools`). 에셋 폴더: `assets/standing/`(게임 추출 스탠딩) · `assets/ingame/`(인게임 SD). 설정 파일의 옛 값 `standing/ingame/hybrid`는 `sd`로 이관

## 조작
- 좌클릭(스탠딩) — 게임 교감 4종과 동일: **탭 = 볼 당기기**(누르는 동안 Touch_Idle, 떼면 Touch_End + "당기지 마!" 대사), **머리 드래그 = 쓰다듬기**(Pat_Idle → Pat_End + "더 쓰다듬으라고"), **머리 탭 = 꿀밤**(Smash_End + "머리 때리지 마!"), **몸을 0.5초 누르고 있기 = 간지럽히기**(Tickle_Idle + 웃음 → Tickle_End), 몸 드래그 = 들어서 던지기. 미니미: 반응 애니 + 모션에 맞는 대사
- 드래그: 들기 → 놓으면 속도대로 날아가서 벽/바닥에 튕기고 착지(Idle2_3)
- 우클릭: 메뉴 — 동작 재생 / 외형 바꾸기(검색) / 모든 사도에 적용 / 형태·크기·표정 / **소리(끄기·전체·음성·효과음 슬라이더)** / AI 대화 · 혼잣말 · 내 화면 보고 한마디 · 새 소식 / **사도 추가 · 선택한 사도 보내기** / 다시 등장 / 설정… / 진단 정보 표시 / 종료
- **설정창** (우클릭 메뉴 → 설정… / 트레이 클릭): 상단 **설정할 사도** 칩(선택·＋ 사도 추가·선택한 사도 보내기·모든 사도에 적용) · 사도(형태, 외형 썸네일 그리드·검색·음성/스탠딩 필터) · 행동(자동 행동 on-off, 확률·속도·거리·대기 시간, 혼잣말, 동작 미리보기) · 소리(음소거·음량·재생 조건·미리 듣기) · 화면(크기·불투명도 = 사도별 / 현재 모니터 안에서만 이동·작업표시줄·자동 실행·화면 갱신 속도·맨 앞 유지·전체화면 숨김·진단 = 공통) · 새 소식 · AI 대화 · 정보(경로·게임 데이터 다시 가져오기·초기화)
- **사도 여러 명**: 우클릭 메뉴/트레이/설정창에서 '사도 추가'. 각자 독립적으로 움직이고 외형·형태·크기·행동을 따로 설정. 소리와 화면 설정만 공통. 최소 1명
- 트레이 아이콘 우클릭: 사도별(설정/다시 등장/보내기) · 사도 추가 · 새 소식 · AI 대화 · 설정 · 게임 데이터 가져오기 · 소리 끄기 · 종료
- **새 소식 알림**: 공식 유튜브(EPID Games) 새 영상, 네이버 게임 라운지(트릭컬) 공지사항·업데이트·개발자 노트 새 글을 10분마다 확인해 사도 머리 위 말풍선으로 **첫 사도의 말투**로 알려줌(나무위키 대사표에서 134명 어미·호칭·자칭·감탄사·실제 대사 학습 — `data/talk-ko.json`, `tools/build-talk.py`; 마요 "확인해야 함", 실비아 "확인해 보시옵소서", 쥬비 "확인해 보라비!", 크레페 "라운지님에 새 공지사항님이 붙었어요! 샥샥 확인해 주세요~"). 항목 클릭 → 브라우저. 설정 → 알림 탭에서 게시판·주기·표시 시간 조절, 이벤트/PV/쿠폰 게시판 추가 가능. 상태 파일 `news-state.json`
- 창은 모든 모니터 합집합을 덮고(작업표시줄 포함), 모니터별 작업표시줄 높이에 맞춰 바닥이 다름. 사도는 놓아둔 모니터에 머물며 끌어서 옮긴다(설정 → 화면 → '현재 모니터 안에서만 이동' 을 끄면 모든 모니터를 오간다)
- 마스코트 창은 **항상 클릭 통과**. 사도 크기만 한 투명 히트 창이 30Hz로 따라다니며 입력을 받음 — 큰 창의 클릭 통과를 끄면 Chrome이 '완전히 가려짐'으로 판단해 유튜브 영상을 회색으로 멈추기 때문(재현 확인)
- 사도 위가 아닌 곳은 클릭이 아래 창으로 통과

## 소리
- 음성(`assets/voice/{hero}/*.ogg` + `index.json`, 147명 7632파일): **선택한 외형의 전용 음성**. 클릭 → touch, 들기 → ticklestart/tickleduring, 착지 → surprise/sorry/anger(50%), 스킨 교체 → greeting/spawn. 한 번에 하나만. 카탈로그: `../docs/05-보이스-카탈로그.md`
- 효과음(`assets/sfx/`): 던져져 착지/튕김·등장 착지 jump02만 (이동 효과음은 제거)
- 재생성: `python tools/build-voices.py <raw_dir>` (imageio-ffmpeg 필요)
- 볼륨 = 전체 × 카테고리, 음소거 시 0. 슬라이더 놓으면 미리듣기. 트레이 메뉴에도 음소거 토글

## 한글 표기
- 사도/사복 이름: `data/names-ko.json` ← `python tools/build-names.py <나무위키 캐시>`
  - 사도 144명: 나무위키 사도 문서 상단 표의 영문 표기(`Erpin | エルフィン | …`)로 게임 id ↔ 한글 이름 대응. 문서가 없는 것(더미·위스프 4종)은 추정(UI에 '?')
  - 사복 273/274개: 나무위키 '사복' 절의 테마 사복 이름 + **게임 아이콘 대조로 확정한 번호표** `tools/names-verified.json` (사복 번호는 출시 순서와 17% 불일치해 이름만으로는 못 정함). 미확정: SilviaSkin3
- 동작/음성 종류 한글: `renderer/ko.js` (KO.anim, KO.voiceCat)

## GIF 추출 (스탠딩 Spine → 투명 GIF)
```
electron tools/render-gif.js -- <skel> <atlas> <out.gif> [--anim Idle_1] [--skin Normal] [--fps 24] [--size 512] [--list] [--all-anims]
python tools/render-all-gifs.py [--anim Idle_1] [--skins base|all] [--size 480] [--only alice,crepe] [--all-anims]
```
- `renderer/gif.html`이 spine-webgl로 프레임을 뽑고(`canvas.toDataURL`), `tools/render-gif.js`가 ffmpeg(imageio-ffmpeg 내장 바이너리) palettegen/paletteuse로 투명 GIF 인코딩
- 입력은 본인 게임에서 가져온 `assets/standing/` 이다. 출력: `out/gif/<한글이름>/<사복>_<동작>.gif`

## 설정 저장
`%APPDATA%\사도 데스크\settings.json` (예전 `trickcal-crepe-mascot-proto` 폴더가 있으면 첫 실행에 자동 복사) (v2) — `{version:2, global:{sound, display, talk, news, ai, assets}, characters:[{id, skin, mode, mood, scale, opacity, monitor, behavior}, …]}`. 메인 프로세스가 단일 소스로 관리: 각 창이 `settings:set`(패치, 캐릭터 id) → 메인이 `sanitizePatch`로 걸러(모르는 키는 버리고 범위 밖 수치는 범위 안으로, `ai.keys`는 여기로 못 들어옴) → `GLOBAL_KEYS`(sound·display·talk·news·ai·assets)에 든 키는 global, 나머지(`CHAR_KEYS` = `CHAR_DEFAULTS`의 키)는 해당 캐릭터에 병합·저장 → 마스코트 창에는 `viewFor(id)`(내 캐릭터 + 공통), 설정창에는 전체를 브로드캐스트. 기본값·분류·범위는 모두 `settings-schema.js`(Electron 없이 `npm test`가 그대로 부른다). 저장은 `.tmp`에 쓴 뒤 이름 바꾸기(쓰는 도중 전원이 나가도 반쪽 파일이 안 남게), 깨진 파일은 `settings.json.bad`로 옆에 두고 기본값으로 시작, '초기화'는 AI 설정(제공자·키)만 남기고 나머지를 기본값으로. v1 파일은 자동 이관.

## 테스트
```
npm test          # 순수 로직 51개 — 설정 검사·AI 파서(끊김 재시도·오류 안내)·혼잣말 검사기·데이터 짝·동작별 음성·새 소식(로컬 가짜 서버). Node 내장 node --test, 의존성 없음
npm run test:flow # 사용 흐름 — Electron 을 새 프로필로 띄워 시나리오 셋을 돌린다 (약 50초). chat: 대화 상태 경쟁 11가지(대상 전환·기록 지우기·연속 열기·캡처 중 닫기/전환/끄기·답하는 중 닫기·재열기)를 모의 AI(SADO_AI_MOCK)로 · extract: 가짜 추출기(test/fake-extract.js)로 실패·재시도·취소(손자 프로세스까지 죽는지) · settings: 깨진 설정 파일 복구·저장 걸러내기·초기화 · aifail: 가짜 OpenAI 호환 서버(test/fake-ai.js)가 스트림 끊김 → 429 → 401 → 정상 순으로 답할 때 안내 문구·받은 조각 보존·입력 복구·기록. `node test/flow.js chat` 처럼 하나만도 됨
npm run test:first-run # 설치판 첫 실행 — 빌드된 exe(dist/win-unpacked 또는 설치본)를 빈 프로필로 띄워 '가져오기' 창이 첫 화면으로 뜨는지 (먼저 npm run pack 또는 npm run dist)
```
설정 창 키보드 조작(탭 줄 ←→·Home·End)은 `--keys-test`, 진단 정보(설정 → 정보 → '진단 정보 복사')는 `--diag-test` 로 검사한다 — 필요한 줄이 다 있고 API 키·대화 내용이 섞이지 않는지.
그 밖의 수동 훅은 `test-hooks.js` (`--selftalk-test`, `--menu-test --menu-click`, `--screen-test --dry`, `--memdump` …).

## 구조
```
main.js            마스코트 창 **하나**(모든 모니터 합집합, 투명·최상위·항상 클릭 통과, 사도 전부를 여기 그림 — 모니터마다 창을 나누는 건 창 하나당 고정 비용 190MB 라 접었다, docs/04) + 히트 창 **하나**(커서가 올라간 사도 크기로 옮겨 보임, 실제 입력 수신→해당 사도에 중계) + 메뉴·말풍선·대화 창 + 설정 저장·방송 + 트레이 + AI 턴
settings-schema.js 설정 기본값·병합·범위 검사 (순수, 테스트가 부른다)
setup-window.js    게임 데이터 가져오기 창 · 파이썬 추출기 실행
selftalk.js        혼잣말 대본 적재·상황 고르기·말풍선
screen-capture.js  화면 보기 — 허용 창 목록·캡처
chat.js            AI 대화 창 — 창·대상·요청 번호(chatSeq)·턴(스트림→저장)·화면 보고 한마디·chat:* IPC
updater.js         깃허브 릴리스 확인·알림
test-hooks.js      --selftalk-test 같은 시험 훅 (제품 코드 아님)
ai.js              AI 제공자 4종(Gemini·Claude·Ollama·OpenAI 호환) + 모의 제공자(SADO_AI_MOCK)
preload.js         fs 읽기 · IPC 브리지
renderer/mascot.js Spine 로드/렌더, 상태머신(spawn→idle⇄hop/jump/react, drag→thrown→land), HTML 메뉴, 셀프테스트
renderer/index.html
renderer/hit.html, hit-preload.js  사도를 따라다니는 투명 히트 창 (mousedown/up/move를 화면 좌표로 메인에 전달)
renderer/menu.html, menu.js  우클릭 메뉴 (별도 작은 창, 검색·슬라이더가 실제 입력으로 동작)
renderer/settings.html, settings.js  설정창 (탭 8개: 조작법·사도·행동·소리·화면·새 소식·AI 대화·정보, 아틀라스에서 미니미 썸네일 직접 크롭)
```
