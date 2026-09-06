"""pywebview import 전 pythonnet 런타임 설정.

coreclr로 시스템에 설치된 .NET(WindowsDesktop.App)을 로드하면, 사용자 PC에 깔린
버전에 따라 pywebview가 쓰는 Microsoft.Web.WebView2.WinForms.dll이 참조하는
System.Windows.Forms.ContextMenu를 찾지 못해 TypeLoadException이 나는 사례가
있었다(체험판에서 이미 겪은 문제와 동일 — dba87e5 참고). 체험판에서 검증된 대로
netfx(.NET Framework, Windows 기본 내장)로 고정한다. pythonnet 3.1.0+에서는
과거 Korean 등 비-ASCII 경로에서 나던 Python.Runtime.Loader.Initialize 오류도
없다.

환경변수(PYTHONNET_RUNTIME)만 설정하면 이후 `import clr` 시점에 clr_loader가
그 값을 읽어 적용하는데, 시스템에 coreclr(.NET 6/8 등)가 설치돼 있으면 이 값이
무시되고 coreclr가 먼저 선택되는 사례가 있었다. 그래서 pythonnet.load()를
명시적으로 호출해 netfx를 강제한다.
"""

from __future__ import annotations

import os
import sys


def configure() -> None:
    if sys.platform != "win32":
        return
    os.environ.setdefault("PYTHONNET_RUNTIME", "netfx")
    import pythonnet
    pythonnet.load("netfx")
