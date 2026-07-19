#!/usr/bin/env python
"""GUI 없이 핵심 import·어절 분할 smoke test (배포 전 빠른 검증)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def main() -> int:
    errors: list[str] = []

    try:
        from tadaksync2.pro_plan import build_lines_auto, build_lines_from_script
    except Exception as exc:
        print(f"FAIL import: {exc}")
        return 1

    words = [
        (" 안녕", 0, 400_000),
        ("하세요", 400_000, 900_000),
        (" 여러분.", 900_000, 1_500_000),
    ]
    lines = build_lines_auto(words, 5)
    if not lines:
        errors.append("build_lines_auto returned empty")

    script_lines = build_lines_from_script("안녕하세요\n여러분.", words)
    if not script_lines:
        errors.append("build_lines_from_script returned empty")

    try:
        from tadaksync2 import api as api_mod
        assert hasattr(api_mod, "Api")
        src = Path(api_mod.__file__).read_text(encoding="utf-8")
        if "build_lines_auto" in src and "from .pro_plan import" not in src:
            errors.append("api.py uses build_lines_auto without pro_plan import")
    except Exception as exc:
        errors.append(f"api module check: {exc}")

    if errors:
        print("SMOKE FAIL:")
        for e in errors:
            print(f"  - {e}")
        return 1

    print("SMOKE OK - build_lines_auto / build_lines_from_script / api import")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
