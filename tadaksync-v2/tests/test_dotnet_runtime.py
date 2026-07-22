#!/usr/bin/env python3
"""dotnet_runtime 런타임 선택·사전 검사 테스트 (pytest 없이 실행 가능)."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tadaksync2 import dotnet_runtime as dr  # noqa: E402


def test_path_has_non_ascii() -> None:
    assert not dr._path_has_non_ascii("C:\\TadakSync")
    assert dr._path_has_non_ascii("C:\\Users\\홍길동")
    assert not dr._path_has_non_ascii(None, "")


def test_pick_runtime_frozen_uses_coreclr() -> None:
    with patch.object(sys, "platform", "win32"):
        with patch.object(dr, "_relevant_paths", lambda: ["C:\\TadakSync"]):
            assert dr.pick_runtime(frozen=True) == "coreclr"


def test_pick_runtime_dev_ascii_uses_netfx() -> None:
    with patch.object(sys, "platform", "win32"):
        with patch.object(dr, "_relevant_paths", lambda: ["C:\\dev\\tadaksync-v2"]):
            assert dr.pick_runtime(frozen=False) == "netfx"


def test_pick_runtime_dev_non_ascii_uses_coreclr() -> None:
    with patch.object(sys, "platform", "win32"):
        with patch.object(dr, "_relevant_paths", lambda: ["C:\\Users\\홍길동\\tadaksync-v2"]):
            assert dr.pick_runtime(frozen=False) == "coreclr"


def test_format_prerequisite_message_lists_items() -> None:
    with patch.object(sys, "platform", "win32"):
        with patch.object(dr, "_relevant_paths", lambda: ["C:\\Users\\홍길동"]):
            text = dr.format_prerequisite_message(
                ["webview2", "desktop_runtime"], runtime="coreclr"
            )
    assert "WebView2" in text
    assert ".NET 6 Desktop Runtime" in text
    assert "go.microsoft.com" in text or "dotnet.microsoft.com" in text


def test_missing_prerequisites_non_windows() -> None:
    if sys.platform == "win32":
        return
    assert dr.missing_prerequisites() == []


def main() -> int:
    tests = [
        test_path_has_non_ascii,
        test_pick_runtime_frozen_uses_coreclr,
        test_pick_runtime_dev_ascii_uses_netfx,
        test_pick_runtime_dev_non_ascii_uses_coreclr,
        test_format_prerequisite_message_lists_items,
        test_missing_prerequisites_non_windows,
    ]
    for test in tests:
        test()
        print(f"OK {test.__name__}")
    print("ALL OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
