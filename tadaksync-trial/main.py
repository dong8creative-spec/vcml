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
            "일반 .NET Runtime이 아니라 Windows Desktop Runtime x64가 필요합니다.\n"
            "https://aka.ms/dotnet/8.0/windowsdesktop-runtime-win-x64.exe\n"
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


def main() -> int:
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
