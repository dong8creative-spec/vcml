#!/usr/bin/env python3
"""
VCML 정적 사이트(index=분기, main-site, reel board 등)를 로컬에서 미리보기합니다.

  python3 serve_main_site.py
  python3 serve_main_site.py 9000

환경 변수 VCML_SITE_PORT 가 있으면 인자가 없을 때 그 값을 포트로 씁니다(기본 8080).

브라우저: 터미널에 찍힌 주소(기본 8080, 이미 쓰이면 8081… 자동 시도).
종료: Ctrl+C
"""
from __future__ import annotations

import argparse
import errno
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
    httpd = None
    chosen = port
    for off in range(40):
        candidate = port + off
        if candidate > 65535:
            break
        try:
            httpd = ThreadingHTTPServer((host, candidate), RootHandler)
            chosen = candidate
            if off > 0:
                print(
                    f"포트 {port}은(는) 이미 사용 중입니다. → {chosen} 로 띄웁니다.",
                    file=sys.stderr,
                )
            break
        except OSError as e:
            if e.errno != errno.EADDRINUSE:
                raise
    if httpd is None:
        print(
            f"포트 {port}~{min(port + 39, 65535)} 모두 사용 중입니다. "
            "이전에 켠 serve_main_site(또는 다른 서버)를 종료(Ctrl+C)하거나 "
            "`python3 serve_main_site.py 9000` 처럼 비어 있는 포트를 지정하세요.",
            file=sys.stderr,
        )
        return 1

    url = f"http://{host}:{chosen}/"
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
