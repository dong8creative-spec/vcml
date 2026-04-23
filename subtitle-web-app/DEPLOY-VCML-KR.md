# VCML.kr + 자막 앱 연동 가이드 (호스팅KR · Google Cloud Run)

메인 사이트는 **vcml.kr**(GitHub Pages 등), 자막 생성·편집은 **Cloud Run**에서 동작합니다. **서브도메인 없이** Run 기본 URL(`*.run.app`)로 연결합니다.

---

## 이미 레포에 반영된 것

- 루트 `index.html`의 `<meta name="vcml-subtitle-app" content="...">` 가 Cloud Run 서비스 URL과 맞춰져 있습니다.
- 자막 서버는 `subtitle-web-app/` 폴더, 배포 시 `cloud-run-env.yaml` 로 CORS 등 환경 변수를 넣을 수 있습니다.

**Run 서비스를 새로 만들거나 URL이 바뀌면** 반드시 `index.html`의 meta `content` 를 콘솔에 나온 새 URL로 수정한 뒤 메인 사이트를 다시 배포하세요.

---

## 앞으로 하실 일 (체크리스트)

### 1. Google Cloud (자막 서버)

| 할 일 | 설명 |
|--------|------|
| 빌링 | 프로젝트에 결제 계정 연결 (API 사용에 필요). |
| 배포 유지 | Cloud Run 서비스 `vcml-subtitle` 이 삭제·중지되지 않게 관리. |
| 환경 변수 | `subtitle-web-app` 에서 `gcloud run services update ... --env-vars-file=cloud-run-env.yaml` 로 갱신. `VCML_CORS_ORIGINS` 에 `https://vcml.kr,https://www.vcml.kr` 포함 확인. |
| 성능·한도 | 전사가 느리거나 OOM 이면 콘솔에서 메모리·CPU·요청 제한 시간(timeout) 조정. |
| URL 변경 시 | 새 서비스 URL을 복사해 `index.html` meta 에 반영. |

### 2. 호스팅KR (도메인 vcml.kr)

| 할 일 | 설명 |
|--------|------|
| DNS | `@` → GitHub Pages용 A 레코드 4개, `www` → `username.github.io` CNAME **유지** (메인 사이트용). |
| `sub` 잘못된 A | 예전에 GitHub IP(185.199.x.x)로 넣은 **`sub` 레코드가 있으면 삭제** (자막은 Run URL 사용, 서브도메인 불필요). |
| Search Console | Google Search Console 도메인 인증용 **TXT** 는 호스팅KR DNS에 `@`(루트) TXT 로 추가. 자막 기능과는 별개. |

### 3. GitHub / 메인 사이트 배포

| 할 일 | 설명 |
|--------|------|
| 로컬 미리보기 | 저장소 **루트**에서 `python3 serve_main_site.py` 또는 **`npm run dev`** → `http://127.0.0.1:8080/` (포트: `python3 serve_main_site.py 9000` / `VCML_SITE_PORT`). |
| 푸시 | 수정한 `index.html` 을 커밋 후 `vcml.kr` 이 바라보는 브랜치에 푸시. |
| 반영 확인 | 시크릿 창에서 `https://vcml.kr` 열고, 페이지 소스에서 `vcml-subtitle-app` 의 `content` 가 최신 Run URL인지 확인. |

### 4. 동작 테스트

1. `https://vcml.kr` → **자막 자동생성** → 접속 코드 `0625` → 자막 페이지로 이동하는지. (중단 시 `VCML_SUBTITLE_ENABLED=0` 및 메뉴 제거.)
2. 짧은 오디오로 **자막 만들기** 한 번 실행.
3. 개발자 도구 Network 탭에서 `subtitle-gate`·`/api/jobs` 가 실패하지 않는지 (CORS·401 등).

### 5. 보안·운영 (권장)

- `cloud-run-env.yaml` 의 `VCML_ACCESS_CODE`·시크릿은 **공개 저장소에 올리지 않기** (`.gitignore` 후 로컬만 보관하거나 Secret Manager 사용).
- `VCML_GATE_SECRET` / `VCML_USAGE_SECRET` 을 임의 긴 문자열로 설정.
- GCP **예산 알림** 설정.

---

## 참고: 서울 리전과 맞춤 도메인

**asia-northeast3(서울)** 은 Cloud Run **도메인 매핑( sub.vcml.kr )** 이 제한될 수 있습니다.  
`https://vcml-subtitle-….asia-northeast3.run.app` 만으로 연동하는 현재 방식이 가장 단순합니다.

---

## 문제 발생 시

- **메인에서 자막 서버 연결 실패** → meta URL과 Cloud Run 콘솔 URL 일치 여부, `VCML_CORS_ORIGINS`, 브라우저 콘솔 CORS/네트워크 오류 확인.
- **전사 실패·타임아웃** → Run 메모리·timeout·`WHISPER_MODEL` 크기 조정.
