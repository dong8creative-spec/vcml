#!/bin/bash
# Finder에서 더블클릭으로 타닥싱크 2-1 실행 (맥)
# 1) ~/Applications 또는 dist 의 .app 우선
# 2) 없으면 소스 + .venv 로 개발 실행
cd "$(dirname "$0")" || exit 1
ROOT="$(pwd)"

APP_CANDIDATES=(
  "${HOME}/Applications/TadakSync 2-1.app"
  "${ROOT}/dist/TadakSync 2-1.app"
  "/Applications/TadakSync 2-1.app"
)

for app in "${APP_CANDIDATES[@]}"; do
  if [[ -d "$app" ]]; then
    open "$app"
    exit 0
  fi
done

if [[ ! -d .venv ]]; then
  osascript -e 'display alert "타닥싱크 2-1" message "앱(.app)과 가상환경(.venv)이 없습니다.\n\n터미널에서:\ncd \"'"$ROOT"'\"\n./scripts/build_mac_app.sh"' as critical
  read -r -p "Enter 키를 누르면 닫습니다…" _
  exit 1
fi

if pgrep -f "tadaksync-2-1/.venv/bin/python.*run.py" >/dev/null 2>&1; then
  osascript -e 'display notification "이미 실행 중입니다." with title "타닥싱크 2-1"'
  exit 0
fi

source .venv/bin/activate
exec python3 run.py
