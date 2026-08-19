"""PyInstaller 런타임 훅 — pythonnet을 webview보다 먼저 설정."""

import sys

if sys.platform == "win32":
    from tadaksync2.dotnet_runtime import configure, verify_or_exit

    configure()
    verify_or_exit()
