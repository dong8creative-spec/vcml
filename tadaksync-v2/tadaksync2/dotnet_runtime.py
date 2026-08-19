"""pywebview import 전 pythonnet 런타임 설정·사전 검사.

Windows에서 사용자 폴더 경로에 한글 등 비-ASCII 문자가 있으면
기본 .NET Framework(netfx) 경로에서 Python.Runtime.dll 로드가 실패할 수 있다.
PyInstaller 배포본과 한글 경로 개발 환경에서는 coreclr + runtimeconfig.json 을 사용한다.

개발 모드(영문 경로)에서는 coreclr + WebView2 WinForms 조합에서 ContextMenu TypeLoad
오류가 나는 환경이 있어 netfx(.NET Framework)를 우선한다.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# 이용자 안내용 — 사용법.md / start.html 과 동기화
PREREQUISITES = {
    "desktop_runtime": {
        "name": ".NET 6 Desktop Runtime",
        "url": "https://dotnet.microsoft.com/download/dotnet/6.0",
        "note": "배포본(TadakSync2.exe) 실행 시 필요합니다.",
    },
    "netfx": {
        "name": ".NET Framework 4.6.2 이상",
        "url": "https://dotnet.microsoft.com/download/dotnet-framework",
        "note": "개발 모드(영문 경로)에서 사용합니다. Windows 10/11에는 대부분 기본 포함.",
    },
    "webview2": {
        "name": "Microsoft Edge WebView2 Runtime",
        "url": "https://go.microsoft.com/fwlink/p/?LinkId=2124703",
        "note": "프로그램 화면(UI) 표시에 필요합니다. Windows 11은 대부분 기본 포함.",
    },
    "vcredist": {
        "name": "Visual C++ 재배포 패키지 (2015–2022)",
        "url": "https://aka.ms/vs/17/release/vc_redist.x64.exe",
        "note": "음성 인식 엔진 등 네이티브 라이브러리 실행에 필요할 수 있습니다.",
    },
}


def _path_has_non_ascii(*paths: Path | str | None) -> bool:
    for raw in paths:
        if not raw:
            continue
        try:
            if not str(raw).isascii():
                return True
        except Exception:
            return True
    return False


def _relevant_paths() -> list[Path | str]:
    paths: list[Path | str] = [sys.executable, os.getcwd()]
    profile = os.environ.get("USERPROFILE") or os.environ.get("HOME")
    if profile:
        paths.append(profile)
    if getattr(sys, "frozen", False):
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            paths.append(meipass)
    return paths


def pick_runtime(*, frozen: bool | None = None) -> str:
    """pythonnet 런타임 종류(netfx/coreclr)를 선택한다."""
    if sys.platform != "win32":
        return ""

    frozen = getattr(sys, "frozen", False) if frozen is None else frozen
    if _path_has_non_ascii(*_relevant_paths()):
        return "coreclr"
    if frozen:
        return "coreclr"
    return "netfx"


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


def _has_netfx() -> bool:
    if sys.platform != "win32":
        return True
    try:
        import winreg

        with winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full",
        ) as key:
            release, _ = winreg.QueryValueEx(key, "Release")
            return int(release) >= 394802  # .NET Framework 4.6.2
    except Exception:
        return False


def _has_desktop_runtime() -> bool:
    if sys.platform != "win32":
        return True
    try:
        from clr_loader.util.find import find_runtimes

        for runtime in find_runtimes():
            if runtime.name == "Microsoft.WindowsDesktop.App":
                return True
    except Exception:
        pass
    return False


def _webview2_build(key_type: str, key: str) -> str:
    import winreg

    try:
        from platform import machine

        if machine() == "x86" or key_type == "HKEY_CURRENT_USER":
            path = rf"Microsoft\EdgeUpdate\Clients\{key}"
        else:
            path = rf"WOW6432Node\Microsoft\EdgeUpdate\Clients\{key}"
        with winreg.OpenKey(getattr(winreg, key_type), rf"SOFTWARE\{path}") as reg_key:
            build, _ = winreg.QueryValueEx(reg_key, "pv")
            return str(build)
    except Exception:
        return "0"


def _is_newer_version(current: str, minimum: str) -> bool:
    cur = current.split(".")
    min_parts = minimum.split(".")
    for index, part in enumerate(min_parts):
        if len(cur) <= index:
            return False
        if int(cur[index]) > int(part):
            return True
        if int(cur[index]) < int(part):
            return False
    return True


def _has_webview2() -> bool:
    if sys.platform != "win32":
        return True
    try:
        if not _has_netfx():
            return False
    except Exception:
        pass

    keys = (
        "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        "{2CD8A007-E189-409D-A2C8-9AF4EF3C72AA}",
        "{0D50BFEC-CD6A-4F9A-964C-C7416E3ACB10}",
        "{65C35B14-6C1D-4122-AC46-7148CC9D6497}",
    )
    for key in keys:
        for key_type in ("HKEY_CURRENT_USER", "HKEY_LOCAL_MACHINE"):
            build = _webview2_build(key_type, key)
            if _is_newer_version(build, "86.0.622.0"):
                return True
    return False


def missing_prerequisites(*, runtime: str | None = None) -> list[str]:
    """설치되지 않은 필수 구성 요소 키 목록."""
    if sys.platform != "win32":
        return []

    runtime = runtime or pick_runtime()
    missing: list[str] = []

    if runtime == "coreclr":
        if not _has_desktop_runtime():
            missing.append("desktop_runtime")
    elif not _has_netfx():
        missing.append("netfx")

    if not _has_webview2():
        missing.append("webview2")

    return missing


def format_prerequisite_message(missing: list[str], *, runtime: str | None = None) -> str:
    runtime = runtime or pick_runtime()
    lines = [
        "타닥싱크 2를 실행하려면 아래 구성 요소가 필요합니다.",
        "",
        f"선택된 .NET 런타임: {runtime or '없음'}",
        "",
    ]
    for key in missing:
        item = PREREQUISITES[key]
        lines.append(f"• {item['name']}")
        lines.append(f"  {item['note']}")
        lines.append(f"  다운로드: {item['url']}")
        lines.append("")

    if runtime == "coreclr" and _path_has_non_ascii(*_relevant_paths()):
        lines.append("※ PC 사용자 이름·설치 폴더에 한글이 있으면")
        lines.append("  .NET 6 Desktop Runtime이 필요합니다.")
        lines.append("  가능하면 C:\\TadakSync\\ 처럼 영문 경로에 설치하세요.")
        lines.append("")

    lines.append("설치 후 PC를 재시작하고 TadakSync2.exe를 다시 실행해 주세요.")
    return "\n".join(lines)


def show_startup_error(message: str, title: str = "타닥싱크 2 — 실행 오류") -> None:
    if sys.platform == "win32":
        try:
            import ctypes

            ctypes.windll.user32.MessageBoxW(0, message, title, 0x10)
            return
        except Exception:
            pass
    print(f"{title}\n{message}", file=sys.stderr)


def verify_or_exit() -> None:
    """필수 런타임이 없으면 안내 후 종료."""
    if sys.platform != "win32":
        return

    missing = missing_prerequisites()
    if missing:
        show_startup_error(format_prerequisite_message(missing))
        raise SystemExit(1)


def configure() -> None:
    if sys.platform != "win32":
        return

    runtime = pick_runtime()
    os.environ.setdefault("PYTHONNET_RUNTIME", runtime)

    if runtime != "coreclr":
        return

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
