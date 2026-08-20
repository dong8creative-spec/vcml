"""pywebview import 전 pythonnet 런타임 설정.

체험판은 embed Python 배포본이다. pythonnet 3.x의 Python.Runtime.dll은
.NET 6용이라, netfx(.NET Framework)로 열면
Failed to resolve Python.Runtime.Loader.Initialize 가 난다.
정식 배포본과 같이 coreclr + runtimeconfig.json 을 쓴다.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def _pythonnet_runtime_dir() -> Path | None:
    try:
        import pythonnet  # noqa: WPS433 — runtime 경로 탐색용
    except ImportError:
        return None
    directory = Path(pythonnet.__file__).resolve().parent / "runtime"
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

    os.environ["PYTHONNET_RUNTIME"] = "coreclr"

    runtime_dir = _pythonnet_runtime_dir()
    if runtime_dir is None:
        return

    runtime_config = _ensure_runtime_config(runtime_dir)
    os.environ["PYTHONNET_CORECLR_RUNTIME_CONFIG"] = str(runtime_config)

    try:
        import pythonnet  # noqa: WPS433

        pythonnet.load("coreclr", runtime_config=str(runtime_config))
    except Exception:
        pass
