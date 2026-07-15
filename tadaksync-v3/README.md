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

## 사용법

`사용법.txt` / `사용법.md` 참고.
