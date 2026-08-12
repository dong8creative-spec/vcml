"""타닥싱크 2 실행 진입점 — pywebview 창 생성."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import webview

from . import APP_NAME, VERSION
from .api import Api
from .dev_util import dev_log, is_dev_mode


def _web_dir() -> Path:
    if getattr(sys, "frozen", False):  # PyInstaller 배포판
        base = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
        return base / "tadaksync2" / "web"
    return Path(__file__).resolve().parent / "web"


_dev_httpd = None


def _local_http_url(web_dir: Path, page: str = "index.html", query: str = "") -> str:
    """file:// + 한글 경로/쿼리스트링은 Edge WebView2에서 ERR_FILE_NOT_FOUND가 난다."""
    import http.server
    import socketserver
    import threading

    global _dev_httpd
    if _dev_httpd is not None:
        host, port = _dev_httpd.server_address
        base = f"http://{host}:{port}/{page}"
        return f"{base}?{query}" if query else base

    web_dir = web_dir.resolve()

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(web_dir), **kwargs)

        def log_message(self, fmt, *args):
            if is_dev_mode():
                dev_log("HTTP", fmt % args)

    httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    httpd.allow_reuse_address = True
    _dev_httpd = httpd
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    host, port = httpd.server_address
    dev_log("HTTP", f"serving {web_dir} at http://{host}:{port}/")
    base = f"http://{host}:{port}/{page}"
    return f"{base}?{query}" if query else base


def _page_url(web_dir: Path, page: str) -> str:
    target = web_dir / page
    if not target.is_file():
        raise FileNotFoundError(f"UI not found: {target}")
    # file:// + 한글(_MEIPASS 포함) 경로는 WebView2에서 실패할 수 있어 항상 로컬 HTTP 사용.
    q = "dev=1" if is_dev_mode() else ""
    return _local_http_url(web_dir, page, q)


def _ui_url(web_dir: Path) -> str:
    return _page_url(web_dir, "index.html")


def main() -> None:
    raw_api = Api()
    url = _ui_url(_web_dir())
    if is_dev_mode():
        dev_log("APP", f"dev mode ON - {url}")

    window = webview.create_window(
        title=f"{APP_NAME} v{VERSION}" + (" [DEV]" if is_dev_mode() else ""),
        url=url,
        js_api=raw_api,
        width=1220,
        height=820,
        min_size=(980, 660),
        background_color="#0B0C0E",
    )
    raw_api.set_window(window)
    raw_api.set_style_editor_url(_page_url(_web_dir(), "style-editor.html"))

    if is_dev_mode():
        def _on_loaded() -> None:
            dev_log("APP", "window loaded - F12/Ctrl+Shift+I for DevTools, F5 reload UI")
            try:
                window.evaluate_js(
                    "window.__TADAKSYNC_DEV__=true;"
                    "if(window.installDevMonitor)window.installDevMonitor();"
                )
            except Exception:
                pass

        window.events.loaded += _on_loaded

    window.events.closed += raw_api.cleanup
    webview.start(debug=is_dev_mode())


if __name__ == "__main__":
    main()
