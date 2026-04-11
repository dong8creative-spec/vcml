#!/usr/bin/env python3
"""
VCML 메인 사이트(index.html 등)를 로컬에서 미리보기합니다.

  python3 serve_main_site.py
  python3 serve_main_site.py 9000

환경 변수 VCML_SITE_PORT 가 있으면 인자가 없을 때 그 값을 포트로 씁니다(기본 8080).

브라우저: http://127.0.0.1:8080/  또는 http://127.0.0.1:8080/index.html
종료: Ctrl+C
"""
from __future__ import annotations

import argparse
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


def main() -> int:
    root = os.path.dirname(os.path.abspath(__file__))
    os.chdir(root)

    env_port = os.environ.get("VCML_SITE_PORT", "").strip()
    default_port = int(env_port) if env_port.isdigit() else 8080

    ap = argparse.ArgumentParser(description="Serve VCML static site from repository root.")
    ap.add_argument(
        "port",
        nargs="?",
        type=int,
        default=default_port,
        help="listen port (default: 8080 or VCML_SITE_PORT)",
    )
    args = ap.parse_args()
    port = args.port
    if not (1 <= port <= 65535):
        print("포트는 1~65535 사이여야 합니다.", file=sys.stderr)
        return 1

    class RootHandler(SimpleHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def __init__(self, *a, **kw):
            super().__init__(*a, directory=root, **kw)

        def end_headers(self):
            self.send_header("Cache-Control", "no-store, max-age=0")
            super().end_headers()

        def log_message(self, format, *log_args):
            sys.stderr.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), format % log_args))

    host = "127.0.0.1"
    httpd = ThreadingHTTPServer((host, port), RootHandler)
    url = f"http://{host}:{port}/"
    print(f"VCML 메인 사이트: {url}")
    print("디자인 새로고침은 캐시 없이(Cmd/Ctrl+Shift+R) 권장합니다. 종료: Ctrl+C")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n종료합니다.")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
