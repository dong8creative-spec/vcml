# 도각 자막패치

캡컷(CapCut) PC 버전 프로젝트의 음성을 **OpenAI Whisper**(오픈소스 음성인식)로 인식해서
자막을 자동 생성하고, 수정한 뒤 **캡컷 프로젝트에 텍스트 트랙으로 바로 삽입**하는 프로그램입니다.

- 캡컷 프로젝트 자동 인식 (복합 클립 포함)
- Whisper 모델로 자막 자동 생성 (한국어 포함 다국어, 100% 로컬 처리 — 영상이 외부로 전송되지 않음)
- **브루(Vrew)와 거의 동일한 편집 방식**: 자막을 표가 아니라 문서처럼 직접 타이핑해서 수정
  - **Enter** → 커서 위치에서 자막을 두 줄로 분할 (단어 타임스탬프 기준으로 정확한 시점에 분할)
  - **Backspace**(문장 맨 앞에서) → 윗줄과 합치기
  - 각 줄 클릭(▶) → 그 구간만 미리듣기 재생, 시간 영역 클릭 → 그 지점부터 이어서 재생
  - **전체 재생** 시 지금 재생 중인 자막이 하이라이트되며 자동 스크롤
- 캡컷 프로젝트에 "AI 자막" 텍스트 트랙으로 즉시 삽입 (자동 백업 포함)
- SRT 내보내기/불러오기 지원

## 수강생용 사용법 파일 (배포 시 zip에 포함)

수강생에게 보여줄 사용법은 **`사용법.txt`** 와 **`사용법.md`** 를 함께 수정하면 됩니다.

```
capcut subtitle/사용법.txt   ← 배포 zip 필수 포함
capcut subtitle/사용법.md    ← 배포 zip에 함께 포함
```

**사용법만 바꿔서 다시 배포할 때** (exe 재빌드 없이):

```powershell
# 프로젝트 루트(vcml)에서
npm run redeploy:subtitle-tool
```

내부 동작: `dist/CapCutSubtitle`에 문서 복사 → zip 생성 → Firebase Storage 업로드

## 설치 방법 (배포판 사용자)

1. [도각 자막패치 페이지](https://vcml.kr/subtitle-tool.html)에서 구글 로그인 후 zip 다운로드
2. 원하는 폴더에 압축 해제 → **`사용법.txt`** 또는 **`사용법.md`** 참고
3. `CapCutSubtitle.exe` 실행 → **구글 로그인** → 브라우저에서 **이 기기로 연동**
4. 처음 자막을 생성할 때 Whisper 모델을 자동 다운로드합니다 (인터넷 필요, 이후엔 오프라인 동작)

> 캡컷 초신속 스탠다드(`capcut-pro-basic`) 수강생만 이용할 수 있습니다.
> 최초 100코인, 수강 후기 작성 시 +100코인. 자막 생성은 타임라인 1분당 1코인이 차감됩니다.

> Windows SmartScreen 경고가 뜨면 "추가 정보 → 실행"을 누르세요 (서명되지 않은 프로그램이라 표시되는 경고입니다).

## 사용 방법

1. **캡컷에서 프로젝트를 닫습니다** (캡컷 프로그램은 켜져 있어도 되지만, 해당 프로젝트는 닫아야 합니다)
2. 프로그램 실행 → 목록에서 프로젝트 선택
3. **[① 자막 생성]** 클릭 → Whisper large-v3로 음성 인식이 끝나면 자막이 문서 형태로 한 줄씩 나타남
   - 최대 어절 수(3~9): 한 자막 줄에 최대 몇 어절(공백 단위)까지 포함할지 설정
   - 언어: 자동 감지, 한국어, 일본어 중 선택
4. **브루처럼 자막을 직접 편집**:
   - 자막 칸을 클릭해서 **그냥 타이핑**하면 바로 수정됨 (팝업 없음)
   - 문장 중간에 커서를 두고 **Enter** → 그 위치에서 두 자막으로 분할
   - 자막 맨 앞에 커서를 두고 **Backspace** → 윗 자막과 합쳐짐 (헤더의 [⌃ 합치기] 버튼도 동일)
   - 각 줄의 **[▶]** 버튼 → 그 구간 오디오만 재생, **시간 표시 영역 클릭** → 그 지점부터 이어서 재생
   - 상단 **[▶ 전체 재생]** → 처음부터 재생하며 지금 나오는 자막이 노란색으로 하이라이트/자동 스크롤
   - **[✕]** → 자막 줄 삭제, **[+ 새 자막]** → 새 줄 추가
   - 시간(시작/끝) 값도 직접 입력해 수정 가능
5. **[② 캡컷 프로젝트에 삽입]** 클릭
6. 캡컷에서 프로젝트를 열면 "AI 자막" 트랙이 추가되어 있습니다
   (다시 삽입하면 기존 "AI 자막" 트랙이 교체됩니다)

### 옵션 설명

| 옵션 | 설명 |
|---|---|
| 모델 | `tiny`(빠름/부정확) ~ `large-v3`(느림/정확). 한국어는 `small` 이상 권장 |
| 언어 | 자동 감지 또는 직접 지정 (지정하면 더 정확) |
| 줄 최대 글자 | 자막 한 줄의 최대 글자 수 |
| 글자 크기 / 세로 위치 | 캡컷에 삽입될 자막 스타일 (세로 위치 -1=하단, 1=상단) |

### 안전장치

- 삽입 전 `draft_content.aisub_backup_날짜.json` 형식으로 프로젝트 파일이 자동 백업됩니다 (최근 10개 유지)
- 삽입 실패 시 자동으로 원본이 복구됩니다
- 문제가 생기면 백업 파일을 `draft_content.json`으로 복사해 되돌릴 수 있습니다

## 개발자용: 소스에서 실행

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python run.py
```

### 배포판 빌드

```powershell
.\.venv\Scripts\pip install pyinstaller
.\.venv\Scripts\pyinstaller --noconfirm --clean --windowed --name CapCutSubtitle `
  --collect-all ctranslate2 --collect-all faster_whisper --collect-all av `
  --collect-all onnxruntime --collect-all pycapcut run.py
# 결과물: dist\CapCutSubtitle\
# 사용법.txt 수정 후: npm run redeploy:subtitle-tool (프로젝트 루트)
```

## 구조

- `capcut_subtitle/capcut.py` — 캡컷 프로젝트 탐색, draft_content.json 파싱, 타임라인 오디오 재구성 (복합 클립 subdraft 재귀 처리)
- `capcut_subtitle/transcribe.py` — faster-whisper(OpenAI Whisper 경량 구현) 음성 인식, 자막 라인 분할, 단어 타임스탬프 기반 정밀 분할/병합
- `capcut_subtitle/inject.py` — pycapcut 라이브러리로 텍스트 트랙 삽입, 백업/복구
- `capcut_subtitle/srt.py` — SRT 입출력
- `capcut_subtitle/playback.py` — 자막 구간 오디오 미리듣기 (winsound)
- `capcut_subtitle/theme.py` — 로열블루/화이트 톤 UI 테마 (둥근 버튼·카드, ttk 스타일)
- `capcut_subtitle/gui.py` — Tkinter GUI (브루 스타일 문서형 편집기)

## 사용한 오픈소스

- [Whisper](https://github.com/openai/whisper) (OpenAI) / [faster-whisper](https://github.com/SYSTRAN/faster-whisper) — 음성 인식
- [pycapcut](https://pypi.org/project/pycapcut/) — 캡컷 draft 파일 조작
- [PyAV](https://github.com/PyAV-Org/PyAV) — 미디어 디코딩

## 제한 사항

- 캡컷 **PC(Windows) 버전** 로컬 프로젝트만 지원 (클라우드 전용 프로젝트 미지원)
- 원본 영상 파일이 이동/삭제된 프로젝트는 해당 구간 인식 불가
- 캡컷 업데이트로 프로젝트 파일 형식이 바뀌면 동작하지 않을 수 있음 (CapCut 8.9 기준 확인)
