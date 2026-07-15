# 타닥싱크 3 (TadakSync 3)

타닥싱크 2를 기반으로 한 **맥락 번역** 확장판입니다.

- 전문 인식 → Enter 줄 나누기 → **영/일/중 맥락 번역(선택)** → 스타일 → 캡컷 삽입
- 원어 `AI 자막` / 번역 `AI 자막(번역)` 트랙 분리
- 인식 **1코인/분(약 50원)** + 번역 **추가 20코인/분(약 1,000원)**
- 인식 엔진: CPU `large-v3` (beam_size=1 등 속도 튜닝)

계정·코인은 vcml.kr `/api/subtitle` 공유. 로그인은 `%APPDATA%\TadakSync3`.

## 개발 실행

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python run.py
```

서버 번역에는 `OPENAI_API_KEY` 환경변수가 필요합니다 (`gpt-4o`).

## 로컬 엔진 모드 (오프라인 인식·번역 + 코인 차감)

인식(faster-whisper)은 항상 PC에서 처리됩니다. `TADAKSYNC_OFFLINE=1`이면 **번역도 PC(Argos)**에서 하고,
**코인 차감·로그인은 vcml 서버**를 그대로 사용합니다. (OpenAI 불필요)

```powershell
# 1) 로컬 번역 의존성 (선택)
.\.venv\Scripts\pip install -r requirements-offline.txt

# 2) 번역 언어팩 설치 (최초 1회, 인터넷 필요)
.\.venv\Scripts\python -m tadaksync3.offline_mode --install

# 3) vcml 서버 실행 (다른 터미널)
# npm run dev  → http://localhost:3300

# 4) 앱 실행
.\run_offline.ps1
```

서버에 `POST /api/subtitle/consume-translation`, `refund-translation` API가 추가되어
로컬 번역 시에도 기존과 동일하게 번역 코인(20초/10)이 차감됩니다.

## 사용법

`사용법.txt` / `사용법.md` 참고.
