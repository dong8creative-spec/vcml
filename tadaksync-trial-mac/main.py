#!/usr/bin/env python3
"""타닥싱크 체험판 (맥) — 로그인 없음, Whisper base, 창 UI."""

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
    print(message, file=sys.stderr)


def main() -> int:
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
