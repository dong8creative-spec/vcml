#!/bin/bash
cd "$(dirname "$0")" || exit 1

alert() {
  osascript -e "display dialog \"$1\" with title \"타닥싱크 체험\" buttons {\"확인\"} default button 1" >/dev/null 2>&1
}

pause_on_error() {
  status=$1
  echo
  echo "종료 코드: ${status}. 창을 닫으려면 Enter를 누르세요."
  read -r _
  exit "$status"
}

find_venv_python() {
  local candidate
  for candidate in \
    ".venv/bin/python3" \
    ".venv/bin/python" \
    .venv/bin/python3.*
  do
    if [ -e "$candidate" ] && "$candidate" -c "import sys" >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

if ! command -v python3 >/dev/null 2>&1; then
  alert "이 맥에 Python 3가 없습니다. python.org 또는 Homebrew로 Python 3를 설치한 뒤 다시 열어 주세요."
  pause_on_error 1
fi

VENV_PY="$(find_venv_python || true)"
if [ -z "$VENV_PY" ]; then
  echo "처음 실행입니다. 잠시만 기다려 주세요. (한 번만 설치합니다)"
  rm -rf .venv
  python3 -m venv .venv || {
    alert "가상환경을 만들지 못했습니다. Python 3가 정상인지 확인해 주세요."
    pause_on_error 1
  }
  VENV_PY="$(find_venv_python || true)"
  if [ -z "$VENV_PY" ]; then
    alert "가상환경의 Python을 찾지 못했습니다. 폴더 안의 .venv를 지운 뒤 다시 열어 주세요."
    pause_on_error 1
  fi
  "$VENV_PY" -m pip install --upgrade pip
  "$VENV_PY" -m pip install -r requirements.txt || {
    alert "필요한 프로그램을 설치하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 열어 주세요."
    pause_on_error 1
  }
fi

"$VENV_PY" run.py
status=$?
if [ "$status" -ne 0 ]; then
  pause_on_error "$status"
fi
