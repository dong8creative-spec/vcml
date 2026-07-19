# 타닥싱크 2-1 (TadakSync 2-1) — 맥(macOS) 버전

캡컷(CapCut) **맥** 프로젝트의 음성을 Whisper로 인식해 **전문(全文)을 먼저 보여주고**,
**줄 나누기 방식**을 고른 뒤 **스타일·어절·키워드 강조**를 적용해
캡컷 프로젝트에 **자동 캡션 트랙**으로 삽입하는 프로그램입니다.

타닥싱크 2(`tadaksync-v2/`, 윈도우) **v2.16.0**과 기능을 맞춘 맥 컨버팅 버전입니다.
계정·코인·기기 연동은 vcml.kr `/api/subtitle` 과 공유합니다.
로그인 정보는 `~/Library/Application Support/TadakSync`에 저장됩니다.

## 워크플로 (윈도우 v2와 동일)

1. 프로젝트 선택
2. 전문 인식 (30초당 1코인)
3. 줄 나누기 방식 선택 — **자동 어절(1코인)** 또는 **엔터 줄 나눔(2코인)**
4. 자막 블록 확인 · 키워드 일괄 강조 · 미리듣기
5. 스타일 선택 · 별도 편집 창 → 캡션 트랙 삽입

## 윈도우 v2와 다른 점 (맥 전용)

| 항목 | v2 (윈도우) | 2-1 (맥) |
|---|---|---|
| 캡컷 초안 폴더 | `%LOCALAPPDATA%\CapCut\...` | `~/Movies/CapCut/User Data/Projects/com.lveditor.draft` |
| 초안 파일명 | `draft_content.json` | `draft_info.json` (+ `template-2.tmp`, Timelines 사본) |
| 폰트 경로 | 캡컷 설치폴더 `Apps/<버전>/Resources/Font` | `CapCut.app/Contents/Resources/Font/SystemFont` |
| 실행 감지 | `tasklist` | `pgrep` |
| 미리듣기 재생 | `winsound` | `afplay` |
| GPU 음성인식 | NVIDIA CUDA (있으면 사용) | CPU (CUDA 없음) |

## 개발 실행 (맥)

```bash
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
./.venv/bin/python run.py
```

- 디버그: `TADAKSYNC_DEBUG=1 ./.venv/bin/python run.py`
- 감시 모드: `TADAKSYNC_DEV=1 ./.venv/bin/python dev_watch.py`
- smoke 검증: `./.venv/bin/python scripts/smoke_check.py`

## 배포판 빌드 (맥, .app)

```bash
./.venv/bin/pip install pyinstaller
./.venv/bin/pyinstaller --noconfirm --clean TadakSync-2-1.spec
# 결과물: dist/TadakSync 2-1.app
```

서명·공증(애플 개발자 계정)은 이 범위에 포함하지 않습니다.
