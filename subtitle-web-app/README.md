# 자막 웹 앱 (단일 폴더)

이 디렉터리만 복사·Git 서브모듈·별도 레포로 옮기면 **웹 서버용 자막 생성·편집**을 그대로 배포할 수 있습니다.  
(Win/Mac 설치 스크립트·Inno/DMG 등 데스크톱 패키징은 포함하지 않습니다.)

## 요구 사항

- **ffmpeg / ffprobe** (Dockerfile에 포함)
- **Python 3.9+** 권장 (로컬 직접 실행 시; 3.10+ 권장)

## Docker로 실행

```bash
cd subtitle-web-app
docker compose up --build
```

브라우저: `http://localhost:8765`

## 로컬에서 직접 실행

```bash
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python3 -m uvicorn main:app --host 0.0.0.0 --port 8765
```

## Heroku 스타일(Procfile)

`PORT`를 주입하는 PaaS용입니다.

## 환경 변수 요약

- `WHISPER_MODEL`, `WHISPER_DEVICE`, `VCML_USAGE_BYPASS`, `VCML_ALLOWED_IPS` 등은 `main.py` 상단 주석 참고.

## 데스크톱 설치판

Win/Mac 설치 스크립트가 필요하면 같은 모노레포의 **`subtitle-web`** 을 참고하세요.
