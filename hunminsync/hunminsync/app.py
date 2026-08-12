"""pywebview application entry point."""

from __future__ import annotations

import os
import sys
from pathlib import Path

from . import APP_NAME, VERSION
from .api import Api
from .dev_util import is_dev_mode

_httpd = None


def web_root() -> Path:
    override = os.environ.get("HUNMINSYNC_WEB_DIR")
    if override:
        return Path(override).expanduser().resolve()
    if getattr(sys, "frozen", False):
        base = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
        return base / "hunminsync" / "web"
    return Path(__file__).resolve().parent / "web"


def ui_url() -> str:
    index = web_root() / "index.html"
    if not index.is_file():
        raise FileNotFoundError(
            f"프런트엔드 index.html을 찾을 수 없어요: {index} "
            "(HUNMINSYNC_WEB_DIR로 위치를 지정할 수 있어요.)"
        )
    # Local HTTP keeps pywebview's JS bridge and relative assets reliable on
    # Cocoa and avoids file:// failures when the app lives under a Korean path.
    import http.server
    import socketserver
    import threading

    global _httpd
    if _httpd is None:
        root = web_root()

        class Handler(http.server.SimpleHTTPRequestHandler):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, directory=str(root), **kwargs)

            def log_message(self, _format, *args):
                return

        _httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Handler)
        _httpd.daemon_threads = True
        threading.Thread(target=_httpd.serve_forever, daemon=True).start()
    host, port = _httpd.server_address
    return f"http://{host}:{port}/index.html"


def main() -> None:
    import webview

    api = Api()
    window = webview.create_window(
        title=f"{APP_NAME} v{VERSION}",
        url=ui_url(),
        js_api=api,
        width=1200,
        height=820,
        min_size=(900, 620),
    )
    api.set_window(window)
    window.events.closed += api.cleanup
    webview.start(debug=is_dev_mode())


if __name__ == "__main__":
    main()
