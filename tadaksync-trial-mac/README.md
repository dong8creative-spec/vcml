# 타닥싱크 체험판 (맥)

윈도우용 `tadaksync-trial`의 맥 변환본입니다.
로그인·코인 없이 Whisper `base`로 캡컷 초안에 자막을 넣습니다.

## 준비

- Python 3.12 이상 (3.13도 가능)
- 캡컷(CapCut) 맥 앱

zip을 받은 경우 압축을 푼 뒤 **`타닥싱크 체험 실행.command`** 를 더블클릭하세요.
처음만 가상환경·패키지를 설치하고, 이후에는 바로 창이 뜹니다.

맥이 “확인되지 않은 개발자”라고 막으면 **우클릭 → 열기** 로 한 번 허용하세요.

터미널에서 직접 실행하려면:

```bash
cd tadaksync-trial-mac
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 run.py
```

## 사용

1. 자막을 넣을 캡컷 프로젝트는 **캡컷에서 닫아** 둡니다.
2. 창에서 초안을 고르고 전문 인식 → 엔터로 줄 나누기 → 삽입합니다.
3. 캡컷에서 초안을 다시 열어 확인합니다.

체험 횟수는 이 Mac 사용자 계정 기준 기본 10회입니다.
저장 위치: `~/Library/Application Support/TadakSyncTrial/uses.json`

캡컷 기본 초안 위치: `~/Movies/CapCut/User Data/Projects/com.lveditor.draft/`
(목록에 없으면 프로그램에서 폴더를 지정하세요.)

## 윈도우 체험판과의 차이

- 실행은 embed Python이 아니라 이 Mac의 venv입니다.
- 초안 파일은 `draft_info.json`을 우선 사용합니다.
- `.app` 패키징은 이번 버전에 포함하지 않습니다.
