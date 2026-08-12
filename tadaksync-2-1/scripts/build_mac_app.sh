#!/bin/bash
# 타닥싱크 2-1 macOS .app 빌드 → 설치
# 사용: ./scripts/build_mac_app.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APP_NAME="TadakSync 2-1"
APP_BUNDLE="dist/${APP_NAME}.app"
VENV_PY="${ROOT}/.venv/bin/python"

if [[ ! -x "$VENV_PY" ]]; then
  echo "가상환경이 없습니다. 먼저:"
  echo "  python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt"
  exit 1
fi

"$VENV_PY" -m pip install -q -U pyinstaller
"$VENV_PY" scripts/smoke_check.py

echo "==> PyInstaller 빌드 중 (수 분 소요)…"
"$VENV_PY" -m PyInstaller --noconfirm --clean TadakSync-2-1.spec

if [[ ! -d "$APP_BUNDLE" ]]; then
  echo "빌드 실패: $APP_BUNDLE 없음"
  exit 1
fi

echo "==> ad-hoc 코드서명 (로컬 실행용)…"
codesign --force --deep -s - "$APP_BUNDLE" 2>/dev/null || true
xattr -cr "$APP_BUNDLE" 2>/dev/null || true

INSTALL_DIR="${HOME}/Applications"
mkdir -p "$INSTALL_DIR"
DEST="${INSTALL_DIR}/${APP_NAME}.app"
rm -rf "$DEST"
cp -R "$APP_BUNDLE" "$DEST"
xattr -cr "$DEST" 2>/dev/null || true

DESKTOP_APP="${HOME}/Desktop/${APP_NAME}.app"
rm -rf "$DESKTOP_APP"
# 바탕화면에는 심볼릭 링크 (용량 절약)
ln -sfn "$DEST" "$DESKTOP_APP"

echo ""
echo "완료."
echo "  빌드:   ${ROOT}/${APP_BUNDLE}"
echo "  설치:   ${DEST}"
echo "  바탕화면 바로가기: ${DESKTOP_APP}"
echo ""
echo "실행: open \"${DEST}\""
echo "처음 Gatekeeper 경고 시: 우클릭 → 열기"
