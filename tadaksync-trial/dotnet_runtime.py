"""pywebview import 전 pythonnet 런타임 설정.

pywebview가 번들하는 Microsoft.Web.WebView2.WinForms.dll은 .NET Framework용이라,
coreclr(.NET 6/8)로 열면 System.Windows.Forms.ContextMenu 타입을 찾지 못해
TypeLoadException이 난다. netfx(.NET Framework, Windows에 기본 내장)로 열어야 한다.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def _unblock_windows_files(root: Path) -> None:
    try:
        import ctypes
        delete_file = ctypes.windll.kernel32.DeleteFileW
    except Exception:
        return
    for path in root.rglob("*"):
        if path.suffix.lower() not in {".dll", ".exe", ".pyd"}:
            continue
        try:
            delete_file(str(path) + ":Zone.Identifier")
        except Exception:
            pass


def configure() -> None:
    if sys.platform != "win32":
        return

    os.environ.setdefault("PYTHONNET_RUNTIME", "netfx")

    python_home = Path(sys.executable).resolve().parent
    _unblock_windows_files(python_home)
