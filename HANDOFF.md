# HANDOFF — vcml.kr (타닥클래스)

> **처음 여는 에이전트/사람은 이 파일부터 읽는다.** 매 섹션 종료 시 덮어써서 항상 "지금 진짜 상태"만 담는다. 자세한 이력은 `docs/changelog/`(날짜순, append-only).

## 이 저장소가 진짜다

`/Users/donghnc/Desktop/tadakclass`라는 또 다른 클론이 있는데, **그건 2026-06-20 이후 갱신이 없는 죽은 클론**이다. 이 폴더(`/Volumes/DONGHNC/VCML/vcml`)가 실제 `vcml.kr` 배포 소스이며(같은 git remote `github.com/dong8creative-spec/vcml.git`, 같은 Vercel 프로젝트 `tadakclass`), 어제(작업일 기준)까지 실제로 갱신됐다. 앞으로의 모든 작업은 여기서 한다.

## 사업 실체 (절대 다시 지어내지 말 것)

- **1인 기업, 강사는 도각쌤 한 명뿐.** 여러 강사가 있는 것처럼 쓰지 말 것.
- 실제 강의 범위: **캡컷, 프리미어 프로, 영상 촬영, 기획.**
- **타닥싱크(자막 자동화 프로그램, `/tadaksync-auto` = `public/subtitle-tool.html`)가 이 웹사이트의 메인 제품이고, 강의는 그다음이다.** (사용자 직접 발언: "타닥싱크란 프로그램이 이 웹사이트의 메인이어야하고, 강의는 그 다음이야")
- 예전에 검토하던 3단계 강의 체계(EDIT/CONNECT/PLAN, 저장소 루트의 `강의*.html` 초안 6개)는 **보류 상태이며 지금은 의미 없음** — 되살리지 말 것. 시각적으로는 완성도 있게 잘 만들어져 있으니(라이트/다크 각 3종), 나중에 다른 용도로 재활용할 여지는 있음.
- `docs/voice-guide.md`에 사이트 톤앤매너 가이드가 있음 — 새 카피 쓸 때 항상 참고("~해요"체, 기능보다 마음 먼저, 실패해도 괜찮다고 말하기).

## 핵심 파일 지도

| 경로 | 역할 |
|---|---|
| `server.js` | 라우트 마운트. `/tadaksync-auto` → `public/subtitle-tool.html` 정적 서빙(301: `/subtitle-tool.html` → `/tadaksync-auto`) |
| `routes/*.js` | API 라우트 — `subtitle.js`(타닥싱크 앱 전용 API), `courses.js`, `orders.js`, `admin.js`, `public.js`, `reviews.js`, `cleaner.js`, `anticipation.js` 등 |
| `lib/homepage-layout-defaults.js` | 홈페이지 섹션/네비 노출 기본값(서버). `public/js/site-layout.js`의 `DEFAULT`와 항상 동기화해야 함 |
| `public/index.html` | 홈페이지. 이번에 타닥싱크 히어로를 최상단에 추가, 기존 강의 히어로는 `#course-hero`로 축소 |
| `public/subtitle-tool.html` | 타닥싱크 Auto 전용 랜딩 페이지 (이미 잘 만들어져 있음, 이번엔 안 건드림) |
| `public/admin.html` | 관리자 SPA. 홈페이지 레이아웃 편집기 있음(`#hp-section-toggles`/`#hp-nav-toggles` 부근, ~1884-1905줄) — `[data-hp-section]`/`[data-hp-nav]` 체크박스를 추가하면 `readHpLayoutForm`/`fillHpLayoutForm`이 자동으로 읽고 씀(제네릭 패턴, JS 수정 불필요) |
| `public/js/site-header.js` | 공용 헤더 마크업(`APP_HEADER_HTML`) — nav 링크의 `data-nav-key`가 `public/js/site-layout.js`의 `nav` 설정과 매칭돼야 보임/숨김이 작동함 |
| `public/css/style.css` | `.hero` 계열 스타일. 색 토큰은 `common.css`(`--primary:#111111` 등 완전 모노톤 — 색상 강조 없음, 명암/여백으로만 위계를 만드는 시스템) |
| `db/tadak.db.json` 같은 건 여기 없음 — 이 저장소는 순수 Firestore(`vcmlmembers` DB) | |

## 지금까지 끝난 것

- [x] 낡은 클론(`/Users/donghnc/Desktop/tadakclass`)과 이 저장소가 같은 배포임을 확인, 낡은 쪽에 경고 남김
- [x] 홈페이지 최상단에 **타닥싱크 히어로 섹션** 추가 (`data-home-section="tadaksync_hero"`) — 헤드라인/서브카피는 `docs/voice-guide.md` 톤 + `subtitle-tool.html` 실제 소개문구 근거
- [x] 기존 강의 히어로를 `#course-hero`로 축소(`.hero--compact`, `min-height 240px`) — 내용은 그대로, 크기만 서브 취급
- [x] 헤더 나비게이션 버그 수정: "타닥싱크" 링크가 `data-nav-key="institution"`이라는 엉뚱한 키로 걸려 있던 것을 `data-nav-key="tadaksync"`로 정정 (`public/js/site-header.js`) — 어드민 토글(`public/admin.html`)도 같이 정정
- [x] `lib/homepage-layout-defaults.js` + `public/js/site-layout.js` 양쪽에 `sections.tadaksync_hero: true`, `nav.tadaksync: true` 추가(서버/클라 동기화 유지)
- [x] `public/admin.html`의 홈 레이아웃 편집기에 "타닥싱크 히어로" 토글 추가, 기존 "히어로" 라벨을 "강의 히어로"로 명확화
- [x] 로컬 서버(포트 3400) + Playwright로 검증: 콘솔 에러 없음, 두 히어로 다 렌더, nav 링크가 `/tadaksync-auto`로 정확히 연결, `GET /api/homepage-layout`이 새 키를 기본값(true)으로 정상 병합해서 내려줌

## 지금 하고 있던 것 / 중단 시점

위 작업 완료 후 정지. **어드민 UI에서 실제로 토글 체크박스를 껐다 켜보는 것까지는 검증 안 함**(관리자 로그인 필요, 이번 세션에선 API 응답 병합 로직으로만 간접 확인) — 다음 사람이 실제 관리자 계정으로 로그인해서 `홈페이지 레이아웃` 탭에서 "타닥싱크 히어로" 체크박스 껐다 켜보고 저장 후 홈페이지에 실제 반영되는지 눈으로 한 번 확인할 것.

## 다음에 할 일 (우선순위 순)

1. 위에서 못한 어드민 토글 실제 클릭 검증
2. **SEO 메타(title/description/OG/JSON-LD) 갱신 여부 사용자 확인** — 지금 `<title>`/구조화 데이터가 여전히 "캡컷·프리미어 영상편집 강의" 중심이라 실제 검색 노출과 화면 내용이 어긋남. 검색 순위에 영향 주는 별도 리스크라 이번 라운드에선 일부러 안 건드림
3. (원하면) 타닥싱크 히어로에 실제 프로그램 스크린샷/움짤 추가해서 텍스트만 있는 지금보다 제품을 더 잘 보여주기 — 이번엔 텍스트만으로 최소 구현
4. `nav.institution`이라는 옛 이름이 무엇을 가리키려 했었는지는 끝내 불명 — 지금은 `tadaksync`로 통합됐고 별도 조치 불필요

## 결정사항 (다시 논의하지 않아도 됨)

- 타닥싱크가 홈페이지 최상단(메인), 강의 히어로는 그 아래 축소된 서브 섹션
- 3단계 강의 체계(EDIT/CONNECT/PLAN)는 보류 확정, 이번 작업 대상 아님
- 색 팔레트는 완전 모노톤(`--primary:#111111` 등, 색상 강조 없음) — 새 색 도입하지 않고 명암/크기로만 위계 표현
- SEO 메타/JSON-LD는 이번 라운드에서 의도적으로 보류 (위 "다음 할 일" 2번)

## 알려진 블로커

- 이 셸에서 `git`이 Xcode 라이선스 미동의로 막혀 있음(`git status` 등 실패) — 사용자가 `sudo xcodebuild -license` 직접 실행해야 풀림. 최근 커밋들은 다른 도구(VS Code 등)로 이뤄진 것으로 보임. 이 셸에서 커밋 시도하지 말 것.
- `test/`에 홈페이지 레이아웃 관련 자동 테스트 없음 — 검증은 로컬 서버 + Playwright 스크린샷/DOM 체크로 함.

## 이력

- `docs/changelog/2026-09-26-01-tadaksync-homepage-hero.md` — 이번 작업 전체
