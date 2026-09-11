# 사도 데스크 (SadoDesk) — 트릭컬 리바이브 사도 데스크탑 마스코트

Electron + 공식 spine-ts 4.1 런타임으로 트릭컬 **미니미** Spine 데이터를 그대로 재생하는 데스크탑 펫.

## 실행
```
run.cmd            # 또는 npm start
npm run pyruntime   # 설치판용 임베디드 Python 준비 (pyruntime/, 최초 1회)
npm run dist        # 설치판 빌드 → dist/SadoDesk-Setup-<ver>.exe (electron-builder NSIS, 에셋 미포함 ≈ 300MB). dist:dir = 무설치 폴더
run.cmd --setup-test # 에셋 없는 상태에서 가져오기 창 → 추출(미니미·효과음) → 마스코트 시작까지 자동 검증
run.cmd --selftest # 합성 마우스 이벤트로 클릭/드래그/던지기/메뉴 상태 전이 자동 검증 (run.log 또는 콘솔에 SELFTEST 줄)
run.cmd --log-pos  # 1초마다 상태/좌표 로그
run.cmd --open-menu # 2.5초 후 메뉴 자동 열기 (스크린샷용)
run.cmd --settings  # 시작하면서 설정창도 열기 (--shot-settings: 탭별 스크린샷을 out/에 저장)
run.cmd --news-test  # 4초 뒤 실제 최신 소식 말풍선 미리보기 (--news-test-fake: 가짜 2건 주입)
run.cmd --multi-test # 캐릭터 추가 → 개별 설정 → 2번 캐릭터 메뉴 → 제거 자동 검증 (콘솔에 MULTI 줄)
```
에셋(`assets/`)은 저장소·설치판에 포함하지 않음. 개발 중엔 `prototype/assets/`(있으면 우선), 설치판은 `%APPDATA%\사도 데스크ssets`(앱의 '에셋 가져오기'가 `tools/extract-all.py`로 사용자 PC의 뮤뮤 트릭컬에서 추출). 우선순위: 설정 `assets.root` → 개발 폴더 → userData. 한글 이름표·말투 프로필은 앱 안 `data/`.

## 캐릭터 형태 2종 (설정 → 캐릭터 → 형태 / 우클릭 메뉴 '형태' 토글 / 트레이)
- **미니미 (스틱)**: 공용 미니미 스켈레톤 + 스킨 418개. 폴짝 이동·큰 점프·등장 낙하 등 게임 원본 애니 77개
- **SD**: 대기·클릭·드래그·착지 = 스탠딩. **이동 = 미니미(스틱) 폴짝**(게임 로비처럼), 멈추면 스탠딩 복귀. 미니미 높이는 스탠딩의 0.78배. 스탠딩에 Move가 있는 캐릭터(크레페)는 스탠딩이 직접 걷음. (인게임 SD는 스탠딩이 없는 캐릭터의 대체용) 대기·클릭·드래그·착지 = **스탠딩**(사도 상세 화면, 표정·상호작용 애니 풍부; `assets/standing-hd/` 사이트 HD 101명+스킨 → `assets/standing/` 게임 추출 33명), 이동·등장 = **인게임 SD**(전투·마이홈, `assets/ingame/` 416세트, 414세트에 `Move`). 둘 중 하나만 있으면 그것만 사용, 둘 다 없으면 미니미. 크기는 두 스켈레톤이 같은 단위(에르핀 Head 본 y=429 동일)라 단위 고정 배율(`SD_UNIT=0.8 × scale`) + 발→Head 높이 캐릭터별 보정(`hybridFix`). 바닥 그림자 슬롯(`CommonShadow`)은 숨김. 애니는 캐릭터별 구성이 달라 접두어로 자동 분류(`sdPools`/`ingamePools`). 설정 파일의 옛 값 `standing/ingame/hybrid`는 `sd`로 이관

## 조작
- 좌클릭(SD) — 게임 교감 4종과 동일: **탭 = 볼 당기기**(누르는 동안 Touch_Idle, 떼면 Touch_End + "당기지 마!" 대사), **머리 드래그 = 쓰다듬기**(Pat_Idle → Pat_End + "더 쓰다듬으라고"), **머리 탭 = 꿀밤**(Smash_End + "머리 때리지 마!"), **몸을 0.5초 누르고 있기 = 간지럽히기**(Tickle_Idle + 웃음 → Tickle_End), 몸 드래그 = 들어서 던지기. 미니미: 반응 애니 + 모션에 맞는 대사
- 드래그: 들기 → 놓으면 속도대로 날아가서 벽/바닥에 튕기고 착지(Idle2_3)
- 우클릭: 메뉴 — 행동 77개 직접 재생 / 캐릭터 418명 검색·교체 / 크기 / **사운드(음소거·전체·목소리·효과음 슬라이더)** / 설정… / **하나 더 부르기 · 이 캐릭터 보내기** / 다시 등장 / 디버그 / 종료
- **설정창** (우클릭 메뉴 → 설정… / 트레이 클릭): 상단 **설정할 캐릭터** 칩(선택·＋·보내기) · 캐릭터(썸네일 그리드·검색·보이스 필터) · 행동(이동/점프/잔동작 on-off, 확률·속도·거리·대기시간) · 사운드(음소거·볼륨·이벤트별 on-off·미리듣기) · 화면(크기 20~150%·불투명도 = 캐릭터별 / 멀티모니터·작업표시줄·디버그 = 공통) · 정보(경로·초기화)
- **캐릭터 여러 명**: 우클릭 메뉴/트레이/설정창에서 '하나 더 부르기'. 각자 독립적으로 움직이고 스킨·형태·크기·행동을 따로 설정. 사운드와 화면 동작만 공통. 최소 1명
- 트레이 아이콘 우클릭: 캐릭터별(설정/다시 등장/보내기) · 하나 더 부르기 · 설정 · 음소거 · 종료
- **새 소식 알림**: 공식 유튜브(EPID Games) 새 영상, 네이버 게임 라운지(트릭컬) 공지사항·업데이트·개발자 노트 새 글을 10분마다 확인해 캐릭터 머리 위 말풍선으로 **첫 캐릭터의 말투**로 알려줌(나무위키 대사표에서 134명 어미·호칭·자칭·감탄사·실제 대사 학습 — `data/talk-ko.json`, `tools/build-talk.py`; 마요 "확인해야 함", 실비아 "확인해 보시옵소서", 쥬비 "확인해 보라비!", 크레페 "라운지님에 새 공지사항님이 붙었어요! 샥샥 확인해 주세요~"). 항목 클릭 → 브라우저. 설정 → 알림 탭에서 게시판·주기·표시 시간 조절, 이벤트/PV/쿠폰 게시판 추가 가능. 상태 파일 `news-state.json`
- 창은 모든 모니터 합집합을 덮고(작업표시줄 포함), 모니터별 작업표시줄 높이에 맞춰 바닥이 다름. 옆 모니터로 이동 가능(설정 → 화면)
- 마스코트 창은 **항상 클릭 통과**. 캐릭터 크기만 한 투명 히트 창이 30Hz로 따라다니며 입력을 받음 — 큰 창의 클릭 통과를 끄면 Chrome이 '완전히 가려짐'으로 판단해 유튜브 영상을 회색으로 멈추기 때문(재현 확인)
- 캐릭터 위가 아닌 곳은 클릭이 아래 창으로 통과

## 사운드
- 목소리(`assets/voice/{hero}/*.ogg` + `index.json`, 147명 7632파일): **선택한 캐릭터의 전용 보이스**. 클릭 → touch, 들기 → ticklestart/tickleduring, 착지 → surprise/sorry/anger(50%), 스킨 교체 → greeting/spawn. 한 번에 하나만. 카탈로그: `../docs/05-보이스-카탈로그.md`
- 효과음(`assets/sfx/`): 던져져 착지/튕김·등장 착지 jump02만 (이동 효과음은 제거)
- 재생성: `python tools/build-voices.py <raw_dir>` (imageio-ffmpeg 필요)
- 볼륨 = 전체 × 카테고리, 음소거 시 0. 슬라이더 놓으면 미리듣기. 트레이 메뉴에도 음소거 토글

## 한글 표기
- 사도/스킨 이름: `data/names-ko.json` ← `python tools/build-names.py <나무위키 캐시>`
  - 사도 144명: 나무위키 사도 문서 상단 표의 영문 표기(`Erpin | エルフィン | …`)로 게임 id ↔ 한글 이름 대응. 문서가 없는 것(더미·위스프 4종)은 추정(UI에 '?')
  - 스킨 273/274개: 나무위키 '사복' 절의 테마 사복 이름 + **게임 아이콘 대조로 확정한 번호표** `tools/names-verified.json` (스킨 번호는 출시 순서와 17% 불일치해 이름만으로는 못 정함). 미확정: SilviaSkin3
- 애니/보이스 종류 한글: `renderer/ko.js` (KO.anim, KO.voiceCat)

## GIF 추출 (스탠딩 Spine → 투명 GIF)
```
electron tools/render-gif.js -- <skel> <atlas> <out.gif> [--anim Idle_1] [--skin Normal] [--fps 24] [--size 512] [--list] [--all-anims]
python tools/law-download.py assets/standing-hd            # lootandwaifus.com 의 고해상도 스탠딩 에셋(133명, 스킨 포함) 다운로드
python tools/render-all-gifs.py [--anim Idle_1] [--skins base|all] [--size 480] [--only alice,crepe] [--all-anims]
```
- `renderer/gif.html`이 spine-webgl로 프레임을 뽑고(`canvas.toDataURL`), `tools/render-gif.js`가 ffmpeg(imageio-ffmpeg 내장 바이너리) palettegen/paletteuse로 투명 GIF 인코딩
- 출력: `out/gif/<한글이름>/<스킨>_<애니>.gif`. 크레페는 사이트에 없어 게임 추출본(`assets/standing/`)으로 렌더
- 사이트 에셋은 2048px 무손실(pma:false), 게임 모바일 추출본은 ASTC 1024px(pma:true) — 둘 다 지원

## 설정 저장
`%APPDATA%\사도 데스크\settings.json` (예전 `trickcal-crepe-mascot-proto` 폴더가 있으면 첫 실행에 자동 복사) (v2) — `{version:2, global:{sound, display}, characters:[{id, skin, mode, scale, opacity, behavior}, …]}`. 메인 프로세스가 단일 소스로 관리: 각 창이 `settings:set`(패치, 캐릭터 id) → 메인이 sound/display는 global에, 나머지는 해당 캐릭터에 병합·저장 → 마스코트 창에는 `viewFor(id)`(내 캐릭터 + 공통), 설정창에는 전체를 브로드캐스트. 기본값은 `main.js`의 `CHAR_DEFAULTS`/`GLOBAL_DEFAULTS`. v1 파일은 자동 이관.

## 구조
```
main.js            투명·최상위·포커스불가 마스코트 창 **하나**(모든 모니터 합집합, 항상 클릭 통과, 캐릭터 전부를 여기 그림) + 히트 창 **하나**(커서가 올라간 캐릭터 크기로 옮겨 보임, 실제 입력 수신→해당 캐릭터에 중계) + 메뉴 창 + 설정 저장·브로드캐스트 + 설정창 + 트레이
preload.js         fs 읽기 · IPC 브리지
renderer/mascot.js Spine 로드/렌더, 상태머신(spawn→idle⇄hop/jump/react, drag→thrown→land), HTML 메뉴, 셀프테스트
renderer/index.html
renderer/hit.html, hit-preload.js  캐릭터를 따라다니는 투명 히트 창 (mousedown/up/move를 화면 좌표로 메인에 전달)
renderer/menu.html, menu.js  우클릭 메뉴 (별도 작은 창, 검색·슬라이더가 실제 입력으로 동작)
renderer/settings.html, settings.js  설정창 (탭 5개, 아틀라스에서 미니미 썸네일 직접 크롭)
tools/analyze-minimi.mjs  spine-core로 skel 애니 77개 길이/이동량/변형 범위 표 → out/minimi-anims.json
```
