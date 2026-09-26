# 2026-09-26 · 01 · 타닥싱크를 홈페이지 메인으로

## 계기

사용자 직접 발언: "타닥싱크란 프로그램이 이 웹사이트의 메인이어야하고, 강의는 그 다음이야." 이전까지 홈페이지는 `<title>`부터 히어로까지 100% "캡컷·프리미어 영상편집 강의" 중심이었고, 타닥싱크는 헤더의 4번째 링크 하나로만 존재했음(그마저도 `data-nav-key="institution"`이라는 잘못된 키로 우연히 걸려 있던 상태).

## 무엇을 했나

1. `public/index.html` — 새 `<section class="hero hero--tadaksync" data-home-section="tadaksync_hero">`를 최상단(헤더 바로 아래, 기존 강의 히어로보다 위)에 추가. 헤드라인 "자막 만드느라 밤새운 적 있으시죠?"는 `docs/voice-guide.md`에 실려 있는 실제 예시 카피를 거의 그대로 가져다 씀. CTA: 주 "타닥싱크 무료로 받기"(`/tadaksync-auto`), 보조 "강의도 보러가기"(`#course-hero`로 스크롤).
2. 기존 강의 히어로 섹션에 `id="course-hero"`와 `.hero--compact` 클래스 추가 — 내용/카피는 그대로, 높이·타이포만 축소해서 "서브"로 읽히게 함.
3. `public/css/style.css` — `.hero--tadaksync`(더 어두운 단색 그라디언트로 구분), `.hero--compact`(min-height 240px, 헤딩 28px로 축소) 추가. 기존 `.hero`/`.hero-text`/`.btn-hero-*` 등은 그대로 재사용, 새 색 도입 안 함(이 사이트 팔레트가 완전 모노톤이라 색으로 구분하지 않고 명암·크기로만 구분).
4. **네비 버그 수정**: `public/js/site-header.js`의 "타닥싱크" 링크가 쓰던 `data-nav-key="institution"`을 `data-nav-key="tadaksync"`로 정정. 저장소 전체에서 `institution`이 이 용도로만 쓰이고 있었음을 grep으로 확인 후 진행(다른 기능과 충돌 없음). `public/admin.html`의 어드민 토글도 같이 `data-hp-nav="tadaksync"`로 정정.
5. `lib/homepage-layout-defaults.js`(서버 기본값)와 `public/js/site-layout.js`의 `DEFAULT`(클라이언트 기본값) 양쪽에 `sections.tadaksync_hero: true`, `nav.tadaksync: true` 추가 — 두 파일은 항상 동기화해서 유지해야 함(주석에도 명시돼 있던 기존 관례).
6. `public/admin.html`의 홈페이지 레이아웃 편집기(`#hp-section-toggles`)에 "타닥싱크 히어로" 토글 추가, 기존 "히어로" 라벨은 "강의 히어로"로 바꿔 구분되게 함. `readHpLayoutForm`/`fillHpLayoutForm`이 `[data-hp-section]`을 제네릭하게 읽고 쓰는 구조라 JS 변경은 필요 없었음.

## 의도적으로 안 한 것

- SEO `<title>`/`meta description`/OG·Twitter 태그/JSON-LD 구조화 데이터 — 여전히 "캡컷·프리미어 영상편집 강의" 문구 그대로임. 검색 노출·소셜 공유 미리보기에 영향을 주는 변경이라 화면 개편이 실제로 반영된 뒤 별도로 확인받고 진행하기로 함.
- 타닥싱크 히어로에 실제 제품 스크린샷/이미지 추가 — 이번엔 텍스트만으로 최소 구현. `public/images/tadaksync-auto.png`, `public/images/tadaksync-auto-free/*` 등 쓸 만한 실제 이미지 에셋이 이미 있으니 다음에 추가 가능.
- `nav.institution`이 원래 의도했을 수도 있는 별도 용도 — 파악 안 됨, 그대로 `tadaksync`로 통합.

## 검증

- 로컬 서버(`PORT=3400 npm run dev`) + Playwright:
  - `.hero--tadaksync`, `#course-hero` 둘 다 정상 렌더, 콘솔 에러 없음
  - 헤더의 `[data-nav-key="tadaksync"]` 링크 href가 `/tadaksync-auto`로 정확함
  - `GET /api/homepage-layout` 응답에 `sections.tadaksync_hero: true`, `nav.tadaksync: true`가 정상적으로 기본값 병합되어 내려옴(기존 저장된 레이아웃 문서에 이 키가 없어도 코드 기본값으로 채워짐 확인)
- **못한 것**: 어드민 UI에서 실제로 관리자 로그인 후 토글을 껐다 켜보는 것 — 로그인 계정 정보 없어서 API 레벨 검증까지만 함. `HANDOFF.md`의 "다음에 할 일 1번"에 남겨둠.
