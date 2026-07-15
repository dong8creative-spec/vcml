"""타닥싱크 2 실행 진입점 — pywebview 창 생성."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import webview

from . import APP_NAME, VERSION
from .api import Api


def _web_dir() -> Path:
    if getattr(sys, "frozen", False):  # PyInstaller 배포판
        base = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
        return base / "tadaksync2" / "web"
    return Path(__file__).resolve().parent / "web"


def main() -> None:
    api = Api()
    window = webview.create_window(
        title=f"{APP_NAME} v{VERSION}",
        url=str(_web_dir() / "index.html"),
        js_api=api,
        width=1220,
        height=820,
        min_size=(980, 660),
        background_color="#0B0C0E",
    )
    api.set_window(window)
    window.events.closed += api.cleanup
    webview.start(debug=os.environ.get("TADAKSYNC_DEBUG") == "1")


if __name__ == "__main__":
    main()
