# 훈민정음 싱크 (HunminSync)

Adobe Premiere Pro 프로젝트(`.prproj`)에서 시퀀스 타임라인 오디오를 읽어
Whisper로 전사하고, 전문을 Enter로 직접 나눈 뒤 SRT 자막으로 저장하는
데스크톱 앱입니다. 프로젝트 파일은 읽기 전용으로 사용하며 수정하지 않습니다.

## 지원 환경

- macOS 12 이상 (Apple Silicon / Intel)
- Windows 10 이상
- Python 3.11~3.13

## 작업 흐름

1. `.prproj` 프로젝트와 자막을 만들 시퀀스를 선택합니다.
2. 시퀀스의 오디오 트랙을 타임라인 기준으로 재구성해 Whisper로 전사합니다.
3. 전문에서 `Enter 한 번 = 자막 블록 하나` 방식으로 문단을 나눕니다.
4. 블록의 문장과 시작·종료 시간을 확인하고 SRT로 저장합니다.

프리미어 프로에서는 `파일 > 가져오기`로 저장한 SRT를 선택한 뒤,
프로젝트 패널의 자막 파일을 시퀀스로 드래그해 캡션 트랙을 만듭니다.

## Premiere 프로젝트 지원 범위

현재 MVP는 저장된 `.prproj`의 일반 오디오 트랙과 클립, 인/아웃 지점,
타임라인 배치를 지원합니다. 프로젝트 목록은 Premiere 기본 Documents 폴더와
사용자가 등록한 폴더에서 찾으며, `.prproj` 파일을 직접 열 수도 있습니다.

다음 항목은 아직 타임라인 오디오에 반영하지 않습니다.

- 중첩 시퀀스와 멀티캠
- 오디오 이펙트·볼륨 키프레임
- 활성 Premiere 시퀀스 자동 감지
- SRT 자동 삽입

오프라인 미디어는 해당 구간을 무음으로 두고 작업 완료 후 경고합니다.

## 개발 실행

```bash
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
./.venv/bin/python run.py
```

Windows PowerShell:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python run.py
```

브라우저에서 `hunminsync/web/index.html?mock=1`을 열면 Python 없이 UI 흐름을
확인할 수 있습니다.

## 빠른 검증

```bash
./.venv/bin/python scripts/smoke_check.py
```

## 배포 빌드

macOS:

```bash
chmod +x scripts/build_mac_app.sh
./scripts/build_mac_app.sh
```

Windows PowerShell:

```powershell
.\scripts\build_win.ps1
```

결과물은 `dist/HunminSync.app` 또는 `dist/HunminSync/HunminSync.exe`에
생성됩니다. macOS 스크립트의 서명은 로컬 실행용 ad-hoc 서명입니다.

## 코인

- 전문 인식: 30초당 1코인
- Enter 줄 나누기: 2코인
- SRT 내보내기: 무료

계정과 코인은 타닥싱크와 동일한 `vcml.kr/api/subtitle` 서비스를 공유합니다.

