# 타닥싱크 2 (TadakSync 2)

캡컷(CapCut) PC 프로젝트의 음성을 Whisper로 인식해 **전문(全文)을 먼저 보여주고**,
이용자가 **엔터로 줄을 나누면** 그대로 자막 블록이 되어, **5가지 스타일** 중 하나를
골라 캡컷 프로젝트에 **자동 캡션 트랙**으로 삽입하는 프로그램입니다.

v1(`capcut subtitle/`)과 별도로 배포되는 독립 프로그램이며, 계정·코인 시스템은
v1과 공유합니다 (`%APPDATA%\TadakSync`의 로그인 정보를 함께 사용 — v1에서
로그인했다면 v2도 자동 로그인).

## v1과 다른 점

| | v1 (타닥싱크) | v2 (타닥싱크 2) |
|---|---|---|
| 워크플로 | 자동 분할된 자막을 표에서 편집 | **전문 인식 → 엔터로 줄 나누기 → 블록 확인** |
| 삽입 | 텍스트 트랙 (스타일 고정) | **스타일 5종 선택 → 캡션 트랙** |
| UI | Tkinter (로열블루/화이트) | **pywebview 웹 UI (다크 + 네온 라임)** |
| 코어 | — | v1의 인식·주입·탐색 모듈을 그대로 이어받음 |

## 자막 스타일 5종 (`tadaksync2/styles.py`)

1. **클래식 화이트** — 흰 글자 + 검은 외곽선
2. **예능 옐로** — 노란 볼드 + 검은 외곽선
3. **블랙 박스** — 흰 글자 + 반투명 검은 박스
4. **네온 라임** — 라임 볼드 + 검은 외곽선
5. **소프트 섀도** — 흰 글자 + 부드러운 그림자

색·외곽선·볼드는 실측 검증된 필드이고, **블랙 박스(배경)와 소프트 섀도(그림자)는
실측 템플릿의 소재 필드를 채우는 방식**이라 캡컷 실기기에서 첫 확인이 필요합니다.
캡션 트랙이므로 삽입 후 캡컷 캡션 패널에서 일괄 재스타일도 가능합니다.

## 개발 실행

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python run.py
```

- 디버그(개발자 도구): `$env:TADAKSYNC_DEBUG = "1"; .\.venv\Scripts\python run.py`
- UI만 브라우저에서 보기: `tadaksync2/web/index.html`을 열면 자동으로 mock 모드로
  동작합니다 (Python 없이 화면·흐름 확인용).

## 구조

- `tadaksync2/app.py` — pywebview 창 생성 (진입점)
- `tadaksync2/api.py` — JS ↔ Python 브리지 (로그인·인식·블록·삽입·SRT·미리듣기)
- `tadaksync2/styles.py` — 자막 스타일 프리셋 5종
- `tadaksync2/web/` — 힉스필드풍 다크+라임 웹 UI (index.html / app.css / app.js)
- `tadaksync2/capcut.py, transcribe.py, inject.py, native_text_schema.py, srt.py,
  playback.py, license.py, pro_plan.py` — v1에서 이어받은 코어 (v1과 독립적으로 진화)

## 코인 정책 (v1과 동일)

- 전문 인식 시작 시 타임라인 1분당 1코인 차감, 실패하면 자동 환불
- SRT 불러오기 → 삽입 경로는 코인을 쓰지 않음

## 미이식 항목 (v1에는 있고 v2 1차에는 없는 것)

- 자막 표 편집기의 Enter 분할/Backspace 병합 (v2는 전문 단계에서 줄을 나누는 것으로 대체)
- 전체 재생·하이라이트 따라가기 (블록별 미리듣기는 지원)
- 스마트스토어 후기 보상 청구, 인박스 알림 UI
