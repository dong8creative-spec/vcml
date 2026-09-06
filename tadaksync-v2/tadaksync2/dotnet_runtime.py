"""pywebview import 전 pythonnet 런타임 설정.

배포본(PyInstaller)에서 기존에는 시스템에 설치된 .NET(WindowsDesktop.App 6.0)을
coreclr로 로드했는데, 사용자 환경의 실제 .NET 버전에 따라 pywebview가 쓰는
Microsoft.Web.WebView2.WinForms.dll이 참조하는 System.Windows.Forms.ContextMenu를
찾지 못해 TypeLoadException이 나는 사례가 있었다(체험판에서 이미 겪은 문제와 동일).
그래서 이제는 앱과 함께 배포하는 .NET 8 데스크톱 런타임(dotnet/ 폴더, prepare_dotnet
스크립트로 준비)을 coreclr로 직접 지정해 로드한다 — 시스템에 뭐가 깔려 있든 항상
같은 버전으로 뜬다. Windows가 다운로드 파일에 붙이는 Zone.Identifier 표시(파일 차단)도
미리 풀어준다.

개발 모드(프로즌 아님)는 netfx가 여전히 더 안정적이라 그대로 둔다.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent.parent
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


def _bundled_dotnet_root() -> Path | None:
    if getattr(sys, "frozen", False):
        root = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent)) / "dotnet"
    else:
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

    frozen = getattr(sys, "frozen", False)
    if not frozen:
        # 개발: netfx가 pywebview(WebView2)와 호환성이 더 좋다.
        os.environ.setdefault("PYTHONNET_RUNTIME", "netfx")
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
