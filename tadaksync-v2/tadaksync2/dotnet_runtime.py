"""pywebview import 전 pythonnet 런타임 설정.

Windows에서 사용자 폴더 경로에 한글 등 비-ASCII 문자가 있으면
기본 .NET Framework(netfx) 경로에서 Python.Runtime.dll 로드가 실패할 수 있다.
PyInstaller 배포본에서는 coreclr + runtimeconfig.json 을 사용한다.

개발 모드에서는 coreclr + WebView2 WinForms 조합에서 ContextMenu TypeLoad
오류가 나는 환경이 있어 netfx(.NET Framework)를 우선한다.
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


def _ensure_runtime_config(runtime_dir: Path) -> Path:
    runtime_config = runtime_dir / "Python.Runtime.runtimeconfig.json"
    if runtime_config.is_file():
        return runtime_config
    runtime_config.write_text(
        """{
  "runtimeOptions": {
    "tfm": "net6.0",
    "framework": {
      "name": "Microsoft.WindowsDesktop.App",
      "version": "6.0.0"
    },
    "rollForward": "LatestMinor"
  }
}
""",
        encoding="utf-8",
    )
    return runtime_config


def configure() -> None:
    if sys.platform != "win32":
        return

    frozen = getattr(sys, "frozen", False)
    if not frozen:
        # 개발: netfx가 pywebview(WebView2)와 호환성이 더 좋다.
        os.environ.setdefault("PYTHONNET_RUNTIME", "netfx")
        return

    # 배포본: 한글 경로에서 netfx Python.Runtime.dll 로드 실패를 피하기 위해 coreclr
    os.environ.setdefault("PYTHONNET_RUNTIME", "coreclr")

    runtime_dir = _pythonnet_runtime_dir()
    if runtime_dir is None:
        return

    runtime_config = _ensure_runtime_config(runtime_dir)
    os.environ.setdefault("PYTHONNET_CORECLR_RUNTIME_CONFIG", str(runtime_config))

    try:
        import clr  # noqa: WPS433

        clr.AddReference("Microsoft.Win32.SystemEvents")
    except Exception:
        pass
