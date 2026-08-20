"""타닥싱크 체험판 — 로그인 없음, Whisper base, 창 UI."""

from __future__ import annotations

import os
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("PYTHONUTF8", "1")

# 압축을 풀 때 embed Python의 ._pth 가 빠지면 site-packages가 경로에서 사라진다.
SITE_PACKAGES = ROOT / "runtime" / "Lib" / "site-packages"
if SITE_PACKAGES.is_dir() and str(SITE_PACKAGES) not in sys.path:
    sys.path.append(str(SITE_PACKAGES))

REQUIRED_PACKAGES = {
    "webview": "pywebview",
    "faster_whisper": "faster-whisper",
    "numpy": "numpy",
    "pythonnet": "pythonnet",
}

INCOMPLETE_UNZIP_MESSAGE = (
    "압축이 제대로 풀리지 않았습니다.\n\n"
    "1. 지금 폴더를 삭제해 주세요.\n"
    "2. zip 파일을 오른쪽 클릭 → [압축 풀기]로 폴더 전체를 풀어 주세요.\n"
    "   (zip을 열어 안에서 바로 실행하면 안 됩니다)\n"
    "3. 풀린 폴더의 run.bat 을 눌러 주세요.\n\n"
    "백신이 파일을 지우는 경우도 있어, 압축을 푼 뒤 오류가 계속되면 알려 주세요.\n"
)


def _show_error(message: str) -> None:
    log = ROOT / "last_error.txt"
    try:
        log.write_text(message, encoding="utf-8")
    except OSError:
        pass
    shown = message
    if "FrameworkMissingFailure" in message or "Python.Runtime" in message or "pythonnet" in message or "ClrError" in message:
        shown = (
            "창을 여는 구성 요소를 불러오지 못했습니다.\n"
            ".NET Framework 4.8이 필요합니다. (Windows 10/11에는 보통 기본 설치되어 있습니다)\n"
            "https://dotnet.microsoft.com/download/dotnet-framework/net48\n"
            "설치 후 받은 폴더를 지우고 zip을 다시 받아 run.bat을 눌러 주세요.\n\n"
            + message
        )
    if sys.platform == "win32":
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(0, shown[:1500], "타닥싱크 체험", 0x10)
        except Exception:
            print(shown, file=sys.stderr)
    else:
        print(shown, file=sys.stderr)


def _missing_packages() -> list[str]:
    from importlib.util import find_spec

    missing = []
    for module, label in REQUIRED_PACKAGES.items():
        try:
            found = find_spec(module) is not None
        except Exception:
            found = False
        if not found:
            missing.append(label)
    return missing


def main() -> int:
    missing = _missing_packages()
    if missing:
        _show_error(INCOMPLETE_UNZIP_MESSAGE + "없는 구성 요소: " + ", ".join(missing))
        return 1

    from dotnet_runtime import configure
    configure()
    from app import main as run_app
    run_app()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception:
        _show_error(traceback.format_exc())
        raise SystemExit(1)
