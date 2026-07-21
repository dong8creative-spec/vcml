"""pywebview import 전 pythonnet 런타임 설정.

Windows에서 사용자 폴더 경로에 한글 등 비-ASCII 문자가 있으면
기본 .NET Framework(netfx) 경로에서 Python.Runtime.dll 로드가 실패한다.
PyInstaller 배포본에서는 coreclr + runtimeconfig.json 을 사용한다.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def _pythonnet_runtime_dir() -> Path | None:
    if getattr(sys, "frozen", False):
        base = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
        candidates = (
            base / "pythonnet" / "runtime",
            base / "runtime",
        )
    else:
        try:
            import pythonnet  # noqa: WPS433 — runtime 경로 탐색용
        except ImportError:
            return None
        candidates = (Path(pythonnet.__file__).resolve().parent / "runtime",)

    for directory in candidates:
        if (directory / "Python.Runtime.dll").is_file():
            return directory
    return None


def configure() -> None:
    if sys.platform != "win32":
        return

    # netfx 기본값은 한글 사용자 경로(C:\Users\301호\...)에서 자주 실패한다.
    os.environ.setdefault("PYTHONNET_RUNTIME", "coreclr")

    runtime_dir = _pythonnet_runtime_dir()
    if runtime_dir is None:
        return

    runtime_config = runtime_dir / "Python.Runtime.runtimeconfig.json"
    if runtime_config.is_file():
        os.environ.setdefault("PYTHONNET_CORECLR_RUNTIME_CONFIG", str(runtime_config))
