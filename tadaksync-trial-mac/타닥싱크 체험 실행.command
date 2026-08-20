#!/bin/bash
# Finder에서 더블클릭하면 이 폴더에서 체험판 창을 엽니다.
cd "$(dirname "$0")" || exit 1

alert() {
  osascript -e "display dialog \"$1\" with title \"타닥싱크 체험\" buttons {\"확인\"} default button 1" >/dev/null 2>&1
}

if ! command -v python3 >/dev/null 2>&1; then
  alert "이 맥에 Python 3가 없습니다. python.org 또는 Homebrew로 Python 3를 설치한 뒤 다시 열어 주세요."
  exit 1
fi

if [ ! -x ".venv/bin/python3" ]; then
  echo "처음 실행입니다. 잠시만 기다려 주세요. (한 번만 설치합니다)"
  python3 -m venv .venv || {
    alert "가상환경을 만들지 못했습니다. Python 3가 정상인지 확인해 주세요."
    exit 1
  }
  .venv/bin/pip install --upgrade pip
  .venv/bin/pip install -r requirements.txt || {
    alert "필요한 프로그램을 설치하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 열어 주세요."
    exit 1
  }
fi

exec .venv/bin/python3 run.py
