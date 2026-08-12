#!/usr/bin/env python3
"""Fast checks that do not download or load a Whisper model."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from hunminsync import APP_NAME, VERSION
from hunminsync.api import Api
from hunminsync.billing import manual_split_coins, recognition_coins
from hunminsync.pro_plan import build_enter_lines
from hunminsync.srt import dumps, loads
from hunminsync.transcribe import SubtitleLine


def main() -> None:
    assert APP_NAME == "훈민정음 싱크"
    assert VERSION
    assert recognition_coins(30_000_001) == 2
    assert manual_split_coins() == 2

    words = [
        (" 안녕하세요", 0, 500_000),
        (" 여러분", 550_000, 900_000),
        (" 반갑습니다", 1_000_000, 1_600_000),
    ]
    lines = build_enter_lines("안녕하세요 여러분\n반갑습니다", words)
    assert len(lines) == 2
    assert loads(dumps(lines))[1].text == "반갑습니다"

    assert Api.__name__ == "Api"
    print("SMOKE OK - imports / billing / Enter mapping / SRT / API")


if __name__ == "__main__":
    main()

