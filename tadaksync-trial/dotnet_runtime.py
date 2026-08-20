"""pywebview import 전 pythonnet 런타임 설정.

pythonnet 3.x는 .NET 데스크톱 런타임(WindowsDesktop.App)이 필요하다.
일반 .NET Runtime만 설치돼 있으면 FrameworkMissingFailure가 난다.
체험판 폴더의 dotnet\\ 을 우선 쓰고, 시스템 런타임은 메이저 버전을 올려 따라간다.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent
RUNTIME_CONFIG_JSON = """{
  "runtimeOptions": {
    "tfm": "net8.0",
    "framework": {
      "name": "Microsoft.WindowsDesktop.App",
      "version": "8.0.0"
    },
    "rollForward": "LatestMajor"
  }
}
"""


def _pythonnet_runtime_dir() -> Path | None:
    try:
        import pythonnet  # noqa: WPS433 — runtime 경로 탐색용
    except ImportError:
        return None
    directory = Path(pythonnet.__file__).resolve().parent / "runtime"
    if (directory / "Python.Runtime.dll").is_file():
        return directory
    return None


def _bundled_dotnet_root() -> Path | None:
    root = APP_ROOT / "dotnet"
    if (root / "dotnet.exe").is_file() and (root / "shared" / "Microsoft.WindowsDesktop.App").is_dir():
        return root
    return None


def _ensure_runtime_config(runtime_dir: Path) -> Path:
    runtime_config = runtime_dir / "Python.Runtime.runtimeconfig.json"
    runtime_config.write_text(RUNTIME_CONFIG_JSON, encoding="utf-8")
    return runtime_config


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

    os.environ["PYTHONNET_RUNTIME"] = "coreclr"
    os.environ["DOTNET_ROLL_FORWARD"] = "LatestMajor"

    bundled = _bundled_dotnet_root()
    if bundled is not None:
        os.environ["DOTNET_ROOT"] = str(bundled)
        _unblock_windows_files(bundled)

    python_home = Path(sys.executable).resolve().parent
    _unblock_windows_files(python_home)

    runtime_dir = _pythonnet_runtime_dir()
    if runtime_dir is None:
        return

    _unblock_windows_files(runtime_dir)
    runtime_config = _ensure_runtime_config(runtime_dir)
    os.environ["PYTHONNET_CORECLR_RUNTIME_CONFIG"] = str(runtime_config)

    load_kwargs = {"runtime_config": str(runtime_config)}
    if bundled is not None:
        load_kwargs["dotnet_root"] = str(bundled)

    try:
        import pythonnet  # noqa: WPS433

        pythonnet.load("coreclr", **load_kwargs)
    except Exception:
        pass
