# Little LUMI Model 분석

> 분석일: 2026-09-11
> 대상: `C:\Program Files (x86)\Steam\steamapps\common\Little LUMI` (Steam 설치본, 512MB)
> 목적: 트릭컬 데스크탑 마스코트("사도 데스크")를 같은 방식으로 만들기 위한 구조 파악

---

## 1. 한 줄 요약

**Little LUMI Model = 오픈소스 시메지(Shimeji-Desktop v1.0.22, Java) + STUDIO LUMI 확장 코드(Java, `com.group_finity.mascot.lumi.*`) + 루미 전용 스프라이트/대사/음성 + 부가 앱(Electron 정원, 봉고, 미니게임) + Steamworks 연동.**

→ 엔진은 BSD 라이선스 오픈소스라 **트릭컬 버전을 같은 엔진 위에 만드는 것은 합법**. 루미의 그림/대사/음성만 재사용 금지(CREDITS.txt).

---

## 2. 기술 스택

| 구성 | 내용 | 근거 |
|---|---|---|
| 언어/런타임 | Java 25 (Eclipse Temurin JRE 25 내장, `app/jre`, 180MB) | `CREDITS.txt`, `MANIFEST.MF` |
| 엔진 | Shimeji-Desktop 1.0.22 (DalekCraft2) ← Shimeji-ee ← Shimeji(Group-Finity) | `CREDITS.txt` |
| 메인 JAR | `app/Shimeji-ee.jar` (1.6MB, 652 클래스) — Main: `com.group_finity.mascot.lumi.LumiMain` | `MANIFEST.MF` |
| 런처 | `Little LUMI.exe` = **javaw.exe 리네임** (아이콘/버전 리소스만 교체) | `THIRD_PARTY_LICENSES.txt` |
| UI | Swing + FlatLaf 3.7.2 (테마 자동/밝게/어둡게, jSystemThemeDetector) | `app/lib` |
| 네이티브 | JNA 5.19 (Win32 창 열거/투명창/후킹), OSHI 6.11 (시스템 정보) | `app/lib` |
| 스크립트 | Nashorn 15.7 (actions.xml의 `${...}` `#{...}` 조건식 샌드박스) | `app/lib`, `Custom Characters.txt` |
| 플러그인 | Java Agent(`PluginAgent`, `Can-Retransform-Classes`) + ASM 7.3 — 창작마당 플러그인(LUMI Chat)이 바이트코드 변환으로 끼어듦 | `MANIFEST.MF`, `lumi/plugin/*` |
| Steam | steamworks4j 1.10 — 도전과제 50개, 창작마당(UGC), 클라우드(`preferences.properties`), 오프라인 토큰 30일 | `lumi/steam/*` |
| 부가 앱 | **Electron 33.4.1** (`app/garden`, 270MB!) — "두둥실 정원" three.js 지형 그리기, 별도 프로세스 | `garden/package.json` |
| 폰트 | Jua, DoHyeon, M PLUS 1p, KTXP ComRound (말풍선용) | `app/assets` |

### 용량 구성
- jre 180MB / garden(Electron) 270MB / assets 42MB / img 7MB / lib 9.4MB / conf 1.4MB
- **핵심 앱 자체는 ~20MB**. 나머지는 런타임 번들.

---

## 3. 폴더 구조

```
Little LUMI/
├─ Little LUMI.exe            javaw.exe 리네임 런처
├─ steam_api64.dll
├─ CREDITS.txt / LICENSE.txt / THIRD_PARTY_LICENSES.txt
├─ User Guide (ko|en).txt     ★ 기능 명세서 역할 (41KB)
├─ mods/
│   └─ Mods Guide.txt         모드 폴더 = 매 실행 시 app/ 위에 오버레이
└─ app/
    ├─ Shimeji-ee.jar         엔진 + 루미 확장
    ├─ lib/*.jar              18개 의존성
    ├─ jre/                   내장 JRE
    ├─ conf/                  전역 설정·대사
    │   ├─ actions.xml, behaviors.xml   (기본 이미지셋용 폴백)
    │   ├─ Mascot.xsd
    │   ├─ affection.json               호감도 저장 (일자별 .bak)
    │   ├─ preferences.properties       Steam Cloud 동기화 설정
    │   ├─ language_*.properties        UI 문자열 22개 언어
    │   ├─ self_talk_{ko,en,ja,zh,zh_TW}.txt      혼잣말 (ko 724줄)
    │   └─ meet_dialogues_{ko,...}.txt            둘 이상 만났을 때 대화 (ko 1922줄)
    ├─ img/                   ★ 캐릭터(이미지셋)
    │   ├─ Custom Characters.txt   ★ 이미지셋 제작 규격서
    │   ├─ Lumi/
    │   │   ├─ shime1..121.png     192×192 프레임 (117장, 왼쪽 방향만, 우측은 미러)
    │   │   ├─ hires/              576×576 고해상도 (일부 프레임, 3배)
    │   │   ├─ conf/actions.xml    333 액션 (219KB)
    │   │   ├─ conf/behaviors.xml  118 행동 (34KB)
    │   │   ├─ conf/info.xml       이름/미리보기/작가
    │   │   ├─ persona.txt         LLM 채팅용 캐릭터 페르소나 (한국어)
    │   │   ├─ sound/*.wav         효과음 60개
    │   │   ├─ cursor/             헤드팻 커서 png + .hotspot
    │   │   ├─ effect/             하트/음표 이펙트
    │   │   └─ hifive/ko/          하이파이브 전용 프레임(언어별)
    │   └─ Credit/                크레딧 아이템(떨어지는 코인) 이미지셋
    ├─ assets/                bongo(36프레임), house, 폰트, ico
    ├─ game/                  피타고라스(퍼즐 플랫포머) 타일
    ├─ garden/                Electron 정원 앱
    └─ speech/                파일 채널 IPC (say.txt에 글 쓰면 말풍선)
```

---

## 4. 시메지 엔진 핵심 개념 (그대로 재사용)

### 4.1 이미지셋 규격 (`Custom Characters.txt`)
- PNG 투명 배경, **192×192 고정 캔버스**, `ImageAnchor="96,192"` (발 위치 = 하단 중앙)
- 왼쪽 보는 그림만 그리면 됨 (엔진이 좌우 반전). 반전 금지 프레임은 `ImageRight`
- 더 큰 캔버스도 가능 → Anchor = "가로/2, 세로"
- 필수 행동 4개: `ChaseMouse`, `Fall`, `Dragged`, `Thrown` (없으면 로드 거부)
- 실용 최소: + `Stand`(1프레임), `Walk`(3~4프레임), `Sit`
- `Action Type`은 6종만: `Stay Move Animate Sequence Select Embedded`
- `sound/` 폴더의 wav를 Pose에 `Sound="x.wav" Volume="-10"`로 붙임 (없는 파일 참조 시 셋 전체 로드 실패)
- `info.xml` 선택: 선택창 표시 이름/미리보기

### 4.2 actions.xml 예시
```xml
<Action Name="Walk" Type="Move" BorderType="Floor">
  <Animation>
    <Pose Image="/shime1.png" ImageAnchor="96,192" Velocity="-2,0" Duration="6"/>
    <Pose Image="/shime2.png" ImageAnchor="96,192" Velocity="-2,0" Duration="1" Sound="step_walk_a.wav" Volume="-14"/>
    ...
    <Hotspot Shape="Ellipse" Origin="54,86" Size="84,50" Behavior="HeadPat"/>  <!-- 머리 클릭영역 -->
  </Animation>
</Action>
```
- `Hotspot`으로 머리 영역 정의 → 쓰다듬기 진입점
- `Embedded` 타입은 Java 클래스 직접 참조: `Class="com.group_finity.mascot.action.Fall"`

### 4.3 behaviors.xml
- `<Behavior Name Frequency Hidden Toggleable>` + `<NextBehaviorList>`로 상태 전이 그래프
- `Frequency="0"`이면 자발적으로 안 나옴 (Java에서 이름으로만 호출: Talk, Flying, AlarmNotice, HeadPat*)
- `Condition="#{mascot.environment.screen.width &lt; 2000}"` 식 조건
- 루미의 118개 행동 카탈로그 (분류):
  - **기본 이동**: Walk/Run/Crawl AlongWorkAreaFloor, SprintAndBrake, HappyHop, SitDown, LieDown, StandUp, LookAround, TiltHead, Chatter
  - **벽/천장**: HoldOntoWall, ClimbAlongWall, ClimbAlongCeiling, FallFromWall/Ceiling
  - **창(IE) 상호작용**: ClimbIEWall, WalkAlongIECeiling, SitOnTheLeft/RightEdgeOfIE, JumpFromLeftEdgeOfIE, WindowDive, ThrowIEFromLeft/Right, RunAndThrowIE…
  - **헤드팻 8종**: HeadPat, HeadPatTilt2/3, HeadPatSit*, HeadPatSitLedge
  - **멀티 캐릭터**: ChatHost/Guest, HiFiveHost/Guest, GiftGiver/Receiver, LeadParade/JoinParade, GatherCall/Join, TagRun/TagChase/TagWin/TagCaught
  - **이벤트**: CreditEvent/CreditSpot/CreditGet(하늘에서 크레딧 떨어짐), EventDrop, SkyReturn, VoidRescue
  - **집중모드 전용**: FocusHoldOntoIEWall, FocusHoldOntoCeiling
  - **Java 호출 전용**: Talk, Flying, AlarmNotice, SelfTalk

---

## 5. 루미 확장 기능 카탈로그 (재현 대상)

`com.group_finity.mascot.lumi` 패키지 175 클래스에서 추출. 우선순위는 트릭컬 버전 기준 제안.

### P0 — 핵심 (없으면 시메지랑 차이 없음)
| 기능 | 클래스 | 동작 |
|---|---|---|
| 헤드팻 | `HeadPatDirector`, `HeadPatHeartEffect`, `LumiCursors` | 머리 핫스팟 누른 뒤: 톡→인사 / 좌우 문지르기→쓰다듬기 / 0.7초 유지→고개 까딱 / 멀리 끌기→들기. 커서가 손 모양으로 바뀜, 하트 이펙트 |
| 말풍선 | `SpeechBubbleWindow`, `SpeechDirector`, `BubbleQueue`, `MouthFlap` | 클릭 인사, 혼잣말, 알람. 큐로 겹침 방지. 입 움직임 |
| 혼잣말 | `SelfTalkDirector` | `self_talk_ko.txt` 헤더 `@min-interval-sec 120 @max-interval-sec 240`, `[호2]~[호6]` 태그로 호감도 해금 |
| 호감도 | `AffectionDirector`, `AffectionStore`, `AffectionPanel` | 6단계(0/35/150/380/720/1200), 8종 획득(첫 실행+10, 30분+1…), 하루 상한 26+10, 미접속일 -1, 단계 강하 없음. `affection.json` |
| 트레이/우클릭 메뉴 | `LumiWindows`, `BehaviorMenuGroups`, `MenuProto` | 캐릭터 우클릭(긴 메뉴: 호감도 카드·행동 시키기·얼어붙기·부탁·알람·집중모드·하나 더/보내기·설정) / 트레이(짧은 메뉴) |
| 설정창 | `LumiSettings`, `SettingsUi`, `HomePanel`, `SkyPanel`… | 7탭: 홈·루미·행동·사운드·화면·방송·정보. 즉시 저장 |
| 전체화면 자동숨김 | `FullscreenWatcher` | 진짜 전체화면(F11/게임)만 감지, 최대화는 무시 |
| 크기/불투명도 | `GlobalOpacity`, hqx 스케일러 | 배율(hires 폴더 활용), 불투명도 전체 적용 |

### P1 — 차별화
| 기능 | 클래스 | 동작 |
|---|---|---|
| 멀티 캐릭터 상호작용 | `InteractionMatchmaker`, `MeetChatDirector` | 가까운 한가한 캐릭터끼리 대화(`meet_dialogues`)·하이파이브·선물·행진·모이기·술래잡기 |
| 알람 | `AlarmWindow`, `AlarmSound`, `PanicDirector`, `ReminderDirector` | 정시 알림 / HH:MM 알람 / 뽀모도로(25/5). 울리면 1분간 뛰어다님. 숨김 중이면 미룸 |
| 집중 모드 | `FocusDirector`, `FocusAutoWatcher` | 시끄러운 행동(창 타기·놀이·크레딧) 정지. 자동: 한 창 3분 연속 사용 시 진입, 창 전환 시 해제 |
| 부탁하기 | `ShortcutDirector`, `ShortcutStore`, `ShortcutsWindow`, `ShortcutIcons` | 프로그램/URL/단축키 등록 → 캐릭터가 폴짝 뛰고 실행 (기본: 게임 실행 = Steam 상점 폴백) |
| 창 던지기 | `LumiThrowingWindows` | 창을 들고 옮기거나 던짐. 화면 밖으로 안 나감, "옮긴 창 되돌리기" |
| 클릭 통과 | (설정) | 마스코트 위에서도 아래 창 클릭. 호버 시 불투명도 절반 |
| 시작 프로그램 등록 | `StartupRegistration` | Windows 로그인 시 자동 실행 |
| 종료 인사 | `FarewellDirector`, `ExitWatchdog` | 종료 시 인사 동작 후 닫힘(최대 8초) |
| 다국어 | `SystemLanguage`, `language_*.properties` | 첫 실행 시 OS 언어 → 5개 중 선택 |

### P2 — 부가
| 기능 | 클래스/폴더 | 동작 |
|---|---|---|
| 방송 모드 | `BroadcastServer/Source/Stage`, `BroadcastBehaviorProfiles` | 전용 창 + 로컬 HTTP → OBS 브라우저 소스. 일반/방송 행동설정 분리 |
| 봉고 모드 | `BongoWindow`, `BongoWheelSense`, `InputReactionWatcher` | 키/마우스 입력 있음만 감지(내용 안 읽음), 우하단 봉고 캐릭터 |
| 두둥실 정원 | `GardenApp`, `GardenFloorFeed`, `IslandWalkAssist`, `garden/` | Electron+three.js 별도 앱. 캐릭터가 섬 지형을 걷음. Ctrl+Shift+G 그리기 |
| 피타고라스 게임 | `lumi/game/*` | 퍼즐 플랫포머, 레벨 에디터 |
| 크레딧 흔들기 | `ShakeCreditDirector` | 들고 2.5초 내 10회 방향전환 → 크레딧 드랍 |
| 루미의 집 | `HouseWindows`, `assets/house` | 벽/지붕 창 |
| 홀로그램 | `CosmosHologram`, `ShinyLumi` | 변신 스킨 |
| 온보딩 | `OnboardingDirector` | 첫 실행 안내 |
| LLM 채팅 | `lumi/ai/*`, `persona.txt`, 플러그인 | 창작마당 플러그인으로 OpenAI 호환 API·TTS·음성입력·MCP. 본체엔 페르소나 파일만 |
| 파일 IPC | `speech/say.txt` | 외부 프로그램이 글 쓰면 말풍선 (`@8000` 첫 줄로 ms 지정) |
| 모드 시스템 | `ModCatalog`, `ModFragments`, `mods/` | 매 실행 시 app/ 위에 오버레이. Steam 검증/업데이트에 안전 |
| 안정성 | `EdtWatchdog`, `DragWatchdog`, `StuckWalkRescue`, `UncaughtErrors`, `PanicDirector` | 각종 워치독. 로그 `LittleLumiLog0.log` |

---

## 6. 콘텐츠 분량 (제작 공수 참고)

| 항목 | 루미 | 비고 |
|---|---|---|
| 스프라이트 프레임 | 117장 (192×192) + hires 14장 (576×576) | 스토어 표기 "64 behaviours / 122 frames" |
| 액션 | 333 | actions.xml 219KB |
| 행동 | 118 | behaviors.xml 34KB |
| 효과음 | 60 wav | 발소리·점프·알람·채팅 등 |
| 혼잣말(ko) | 724줄 (해금 포함 658개 활성) | 호감도별 태그 |
| 만남 대화(ko) | 1922줄 (A/B 3줄 묶음) | |
| UI 문자열 | 22개 언어 properties | 앱 UI는 5개 언어만 노출 |
| 도전과제 | 50 | Steam |

---

## 7. 트릭컬 버전에 그대로 가져갈 것 / 바꿀 것

### 그대로 (엔진·구조)
- Shimeji-Desktop 1.0.22 소스 fork (GitHub: DalekCraft2/Shimeji-Desktop, BSD)
- actions.xml / behaviors.xml 문법, 192×192 규격, Hotspot 기반 헤드팻
- 설정·호감도·혼잣말·알람·집중모드·부탁하기 **설계** (코드는 재작성 — 루미 확장 코드는 배포되지 않은 폐쇄 소스는 아니지만 BSD라 참고 가능, 디컴파일 없이 기능 명세 기준으로 재구현 권장)
- 폴더 레이아웃: `img/<캐릭터>/`, `conf/`, `mods/` 오버레이

### 바꿀 것
- **캐릭터 렌더링**: 루미는 손그림 PNG 프레임. 트릭컬은 **Spine 4.1 데이터**가 게임에 있음 → (a) Spine 런타임으로 직접 렌더 (자체 엔진 개조 필요, 품질 최상) 또는 (b) Spine에서 프레임 PNG를 굽어 시메지 규격으로 변환 (엔진 무수정, 용량 증가). 자세한 건 `02-분석-트릭컬.md`
- 대사/페르소나: 트릭컬 사도별 성격 (순수/활발/냉정/우울/광기)
- 부탁하기 기본 항목: 트릭컬 실행(뮤뮤/Google Play Games) 링크
- 크레딧 드랍 → 엘드/별사탕 드랍 등 트릭컬 재화로
- IP: 에피드게임즈 2차 창작 가이드라인 확인 필수. 게임 리소스 직접 추출·재배포는 불가 → **직접 그린 SD 도트/일러스트로 대체**하거나 팬 창작 허용 범위 확인

---

## 8. 참고 파일 위치 (원본에서 바로 열어볼 것)
- 기능 명세: `User Guide (ko).txt` (섹션: 조작·설정창·알림·부탁하기·집중모드·방송·호감도·LUMI Chat)
- 이미지셋 규격: `app/img/Custom Characters.txt`
- 모드 규칙: `mods/Mods Guide.txt`
- 행동 정의 원본: `app/img/Lumi/conf/{actions,behaviors}.xml` (주석이 한국어로 상세함 — 설계 의도 파악에 유용)
- 페르소나 예시: `app/img/Lumi/persona.txt`
- 대사 포맷: `app/conf/self_talk_ko.txt`, `app/conf/meet_dialogues_ko.txt`
