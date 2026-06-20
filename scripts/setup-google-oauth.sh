#!/usr/bin/env bash
# Google OAuth 설정 안내 + .env 값 적용
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"
PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-vcml-30438}"
LOCAL_REDIRECT="http://localhost:3300/api/auth/google/callback"
PROD_REDIRECT="https://vcml.kr/api/auth/google/callback"

echo ""
echo "=== 타닥클래스 Google OAuth 설정 ==="
echo "프로젝트: $PROJECT_ID"
echo ""

CONSENT_URL="https://console.cloud.google.com/apis/credentials/consent?project=${PROJECT_ID}"
CREDS_URL="https://console.cloud.google.com/apis/credentials?project=${PROJECT_ID}"

echo "1) OAuth 동의 화면 (최초 1회)"
echo "   - User type: 외부(External)"
echo "   - 앱 이름: 타닥클래스"
echo "   - 사용자 지원 이메일: 본인 Gmail"
echo "   - 범위(scope): 기본(openid, email, profile)만 — 추가 불필요"
echo "   - 테스트 사용자: 로그인할 Google 계정 추가 (Testing 모드일 때 필수)"
echo "   → $CONSENT_URL"
echo ""
echo "2) OAuth 클라이언트 ID 생성"
echo "   - 유형: 웹 애플리케이션"
echo "   - 승인된 JavaScript 원본: (비워도 됨)"
echo "   - 승인된 리디렉션 URI (둘 다 추가 권장):"
echo "     • $LOCAL_REDIRECT"
echo "     • $PROD_REDIRECT"
echo "   → $CREDS_URL"
echo ""

if [[ "$(uname)" == "Darwin" ]]; then
  read -r -p "브라우저에서 콘솔 페이지를 열까요? [Y/n] " OPEN_BROWSER
  OPEN_BROWSER="${OPEN_BROWSER:-Y}"
  if [[ "$OPEN_BROWSER" =~ ^[Yy]$ ]]; then
    open "$CONSENT_URL"
    sleep 1
    open "$CREDS_URL"
  fi
fi

echo ""
read -r -p "Google Client ID: " CLIENT_ID
read -r -s -p "Google Client Secret: " CLIENT_SECRET
echo ""

if [[ -z "$CLIENT_ID" || -z "$CLIENT_SECRET" ]]; then
  echo "Client ID/Secret이 비어 있습니다. .env는 변경하지 않았습니다."
  exit 1
fi

python3 - "$ENV_FILE" "$CLIENT_ID" "$CLIENT_SECRET" "$LOCAL_REDIRECT" <<'PY'
import re, sys
path, cid, secret, redirect = sys.argv[1:5]
with open(path, encoding='utf-8') as f:
    text = f.read()

def set_var(name, value):
    global text
    pat = rf'^{name}=.*$'
    line = f'{name}={value}'
    if re.search(pat, text, flags=re.M):
        text = re.sub(pat, line, text, count=1, flags=re.M)
    else:
        text = text.rstrip() + '\n' + line + '\n'

set_var('GOOGLE_CLIENT_ID', cid)
set_var('GOOGLE_CLIENT_SECRET', secret)
set_var('GOOGLE_REDIRECT_URI', redirect)
if 'AUTH_BETA_MODE=' not in text:
    set_var('AUTH_BETA_MODE', '1')

with open(path, 'w', encoding='utf-8') as f:
    f.write(text)
print(f'✓ {path} 에 Google OAuth 값을 저장했습니다.')
PY

echo ""
echo "3) 서버 재시작 후 확인"
echo "   npm run dev"
echo "   curl http://localhost:3300/api/auth/providers"
echo "   → {\"google\":true,...} 이면 성공"
echo ""
echo "4) 로그인 테스트"
echo "   http://localhost:3300/login.html"
echo ""
