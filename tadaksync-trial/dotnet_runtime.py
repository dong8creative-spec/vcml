"""pywebview import 전 pythonnet 런타임 설정.

체험판은 설치형 EXE가 아니라 embed Python이라, 정식판 개발 모드와
같이 netfx(.NET Framework)를 쓴다. coreclr + WebView2는
ContextMenu TypeLoad 오류가 난다.
"""

from __future__ import annotations

import os
import sys


def configure() -> None:
    if sys.platform != "win32":
        return
    os.environ.setdefault("PYTHONNET_RUNTIME", "netfx")
