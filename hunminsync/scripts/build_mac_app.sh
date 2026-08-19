#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PYTHON="${ROOT}/.venv/bin/python"
if [[ ! -x "$PYTHON" ]]; then
  echo "가상환경이 없습니다. python3 -m venv .venv 후 의존성을 설치해 주세요."
  exit 1
fi

"$PYTHON" scripts/smoke_check.py
"$PYTHON" -m pip install -q -U pyinstaller
"$PYTHON" -m PyInstaller --noconfirm --clean HunminSync.spec

APP="${ROOT}/dist/HunminSync.app"
if [[ ! -d "$APP" ]]; then
  echo "빌드 실패: ${APP}을 찾지 못했습니다."
  exit 1
fi

codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"
echo "완료: $APP"

