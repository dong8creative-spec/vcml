# 타닥싱크 2 (TadakSync 2)

캡컷(CapCut) PC 프로젝트의 음성을 Whisper로 인식해 **전문(全文)을 먼저 보여주고**,
이용자가 **엔터로 줄을 나누면** 그대로 자막 블록이 되어, **스타일** 중 하나를
골라 캡컷 프로젝트에 **자동 캡션 트랙**으로 삽입하는 프로그램입니다.

계정·코인·기기 연동은 vcml.kr `/api/subtitle` 과 공유합니다.
로그인 정보는 `%APPDATA%\TadakSync`에 저장됩니다.

## 워크플로

1. 프로젝트 선택  
2. 전문 인식 (분당 1코인)  
3. 엔터로 줄 나누기  
4. 자막 블록 확인·미리듣기  
5. 스타일 선택 → 캡션 트랙 삽입  

## 자막 스타일 (`tadaksync2/styles.py`)

1. **클래식 화이트** — 흰 글자 + 검은 외곽선  
2. **예능 옐로** — 노란 볼드 + 검은 외곽선  
3. **네온 라임** — 라임 볼드 + 검은 외곽선  

## 개발 실행

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python run.py
```

- 디버그: `$env:TADAKSYNC_DEBUG = "1"; .\.venv\Scripts\python run.py`
- UI만 브라우저: `tadaksync2/web/index.html` (mock 모드)

## 배포 (프로젝트 루트)

```powershell
npm run build:subtitle-tool      # PyInstaller → dist/TadakSync2
npm run package:subtitle-tool    # 사용법 포함 zip
npm run upload:subtitle-tool     # Firebase Storage (기본: subtitle-tool/TadakSync.zip)
# 또는 한 번에
npm run release:subtitle-tool
```

수강생용 문서는 `사용법.txt` / `사용법.md` 를 수정한 뒤 `redeploy:subtitle-tool` 하세요.

## 구조

- `tadaksync2/app.py` — pywebview 창  
- `tadaksync2/api.py` — JS ↔ Python 브리지  
- `tadaksync2/styles.py` — 자막 스타일  
- `tadaksync2/web/` — UI  
- `tadaksync2/license.py` — 로그인·코인·스마트스토어 후기 API  

## 코인

- 전문 인식에 **성공(비어 있지 않은 전문)** 한 뒤에만 타임라인 1분당 1코인 차감
- 무음·미인식이면 차감 없이 자동 취소
- 전문이 확정·차감된 뒤에는 환불하지 않음
- SRT 불러오기 → 삽입은 코인 미사용
- 계정 메뉴 「후기 안내」에서 수강/스마트스토어 후기 보너스
