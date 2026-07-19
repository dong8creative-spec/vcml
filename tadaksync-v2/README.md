# 타닥싱크 2 (TadakSync 2)

캡컷(CapCut) PC 프로젝트의 음성을 Whisper로 인식해 **전문(全文)을 먼저 보여주고**,
**줄 나누기 방식**을 고른 뒤 **스타일·어절·키워드 강조**를 적용해
캡컷 프로젝트에 **자동 캡션 트랙**으로 삽입하는 프로그램입니다.

계정·코인·기기 연동은 vcml.kr `/api/subtitle` 과 공유합니다.
로그인 정보는 `%APPDATA%\TadakSync`에 저장됩니다.

## 워크플로

1. 프로젝트 선택  
2. 전문 인식 (30초당 1코인)  
3. 줄 나누기 방식 선택 — **자동 어절(1코인)** 또는 **엔터 줄 나눔(2코인)**  
   - 자동: Step 3 생략 → 바로 블록 확인  
   - 엔터: Step 3에서 Enter 1번 = 블록 1개  
4. 자막 블록 확인 · 키워드 일괄 강조 · 미리듣기  
5. 스타일 선택 → 캡션 트랙 삽입  

## 자막 스타일 (`tadaksync2/styles.py`)

1. **클래식 화이트** — 흰 글자 + 검은 외곽선  
2. **예능 옐로** — 노란 볼드 + 검은 외곽선  
3. **네온 라임** — 라임 볼드 + 검은 외곽선  

## 개발 실행 (빌드 없이 실시간 확인)

**PyInstaller 빌드는 배포 직전에만** 하면 됩니다. 평소에는 소스에서 바로 실행하세요.

### 1) 추천 — 감시 + 자동 재시작

프로젝트 루트(vcml)에서:

```powershell
npm run dev:subtitle-tool
```

또는 `tadaksync-v2` 폴더에서:

```powershell
$env:CAPCUT_SUBTITLE_API = "http://localhost:3300"   # 로컬 vcml 서버 쓸 때
.\.venv\Scripts\python dev_watch.py
```

| 동작 | 설명 |
|------|------|
| `.py` 저장 | 터미널에서 앱 **자동 재시작** |
| `.js` / `.css` 저장 | 앱 창에서 **F5** 로 UI만 새로고침 |
| 터미널 | `[API]` `[EVENT]` 로 Python 호출·진행 실시간 출력 |
| 앱 하단 | DEV 패널 — step / busy / API·이벤트 로그 |
| F12 | pywebview DevTools (콘솔·네트워크) |

### 2) 1회 실행

```powershell
cd tadaksync-v2
$env:TADAKSYNC_DEV = "1"
$env:TADAKSYNC_DEBUG = "1"
.\.venv\Scripts\python run.py
```

### 3) GUI 없이 빠른 검증 (smoke)

```powershell
npm run smoke:subtitle-tool
```

import·어절 분할·`api.py` import 누락 등을 exe 빌드 전에 확인합니다.

### 4) UI만 브라우저 (mock, CapCut/Whisper 없음)

`tadaksync2/web/index.html?dev=1` — 로그인·인식 흐름만 mock으로 확인

---

최초 1회 venv:

```powershell
cd tadaksync-v2
py -3.12 -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
```

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
- `tadaksync2/keyword_spans.py` — 키워드 일괄 강조  
- `tadaksync2/styles.py` — 자막 스타일  
- `tadaksync2/web/` — UI  
- `tadaksync2/license.py` — 로그인·코인·스마트스토어 후기 API  

## 코인

- 전문 인식: 타임라인 **30초당 1코인** (성공 시에만 차감)
- 자동 어절 나누기: **1회 1코인**
- 엔터 줄 나눔: **1회 2코인**
- 무음·미인식이면 차감 없이 자동 취소
- 전문이 확정·차감된 뒤에는 환불하지 않음
- SRT 불러오기 → 삽입은 코인 미사용
- 계정 메뉴 「후기 안내」에서 수강/스마트스토어 후기 보너스
