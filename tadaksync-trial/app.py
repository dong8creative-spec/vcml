"""타닥싱크 체험판 창 — pywebview."""

from __future__ import annotations

import http.server
import os
import shutil
import socketserver
import subprocess
import threading
import webbrowser
from pathlib import Path

import webview

from api import Api
from engine import APP_NAME, VERSION

ROOT = Path(__file__).resolve().parent
VCML_URL = "https://vcml.kr"
_httpd = None


def _web_dir() -> Path:
    return ROOT / "web"


def _chrome_exe() -> str | None:
    for name in ("chrome", "google-chrome"):
        found = shutil.which(name)
        if found:
            return found
    candidates = [
        Path(os.environ.get("PROGRAMFILES", r"C:\Program Files"))
        / "Google" / "Chrome" / "Application" / "chrome.exe",
        Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)"))
        / "Google" / "Chrome" / "Application" / "chrome.exe",
        Path(os.environ.get("LOCALAPPDATA", ""))
        / "Google" / "Chrome" / "Application" / "chrome.exe",
    ]
    for path in candidates:
        if path.is_file():
            return str(path)
    return None


def open_vcml_in_chrome() -> None:
    chrome = _chrome_exe()
    try:
        if chrome:
            kwargs = {}
            if os.name == "nt":
                kwargs["creationflags"] = getattr(subprocess, "DETACHED_PROCESS", 0)
            subprocess.Popen([chrome, VCML_URL], **kwargs)
            return
        webbrowser.open(VCML_URL)
    except Exception:
        try:
            webbrowser.open(VCML_URL)
        except Exception:
            pass


def _local_http_url(web_dir: Path) -> str:
    """file:// + 한글 경로는 Edge WebView2에서 실패할 수 있어 로컬 HTTP를 쓴다."""
    global _httpd
    web_dir = web_dir.resolve()

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(web_dir), **kwargs)

        def log_message(self, fmt, *args):
            pass

    httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    httpd.allow_reuse_address = True
    _httpd = httpd
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    host, port = httpd.server_address
    return f"http://{host}:{port}/index.html"


def main() -> None:
    threading.Thread(target=open_vcml_in_chrome, daemon=True).start()
    web_dir = _web_dir()
    if not (web_dir / "index.html").is_file():
        raise FileNotFoundError(f"UI not found: {web_dir / 'index.html'}")
    api = Api()
    window = webview.create_window(
        title=f"{APP_NAME} v{VERSION}",
        url=_local_http_url(web_dir),
        js_api=api,
        width=1220,
        height=820,
        min_size=(980, 660),
        background_color="#FFFFFF",
    )
    api.set_window(window)
    window.events.closed += api.cleanup
    webview.start()


if __name__ == "__main__":
    main()
