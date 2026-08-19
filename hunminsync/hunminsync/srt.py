"""SRT serialization."""

from __future__ import annotations

import re
from pathlib import Path

from .transcribe import SubtitleLine


def format_timestamp(microseconds: int) -> str:
    milliseconds = max(0, int(microseconds)) // 1_000
    hours, milliseconds = divmod(milliseconds, 3_600_000)
    minutes, milliseconds = divmod(milliseconds, 60_000)
    seconds, milliseconds = divmod(milliseconds, 1_000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{milliseconds:03d}"


def parse_timestamp(value: str) -> int:
    match = re.fullmatch(r"\s*(\d+):(\d{2}):(\d{2})[,.](\d{3})\s*", value)
    if not match:
        raise ValueError(f"잘못된 SRT 타임스탬프예요: {value}")
    hours, minutes, seconds, milliseconds = map(int, match.groups())
    return ((hours * 3600 + minutes * 60 + seconds) * 1000 + milliseconds) * 1000


def dumps(lines: list[SubtitleLine]) -> str:
    blocks = [
        f"{index}\n{format_timestamp(line.start_us)} --> "
        f"{format_timestamp(line.end_us)}\n{line.text}"
        for index, line in enumerate(lines, 1)
        if line.text.strip() and line.end_us > line.start_us
    ]
    return "\n\n".join(blocks) + ("\n" if blocks else "")


def dump(lines: list[SubtitleLine], path: str | Path) -> None:
    Path(path).write_text(dumps(lines), encoding="utf-8-sig")


def loads(content: str) -> list[SubtitleLine]:
    result: list[SubtitleLine] = []
    for block in re.split(r"\r?\n\s*\r?\n", content.strip()):
        rows = block.splitlines()
        time_index = next((i for i, row in enumerate(rows) if "-->" in row), -1)
        if time_index < 0:
            continue
        start, end = rows[time_index].split("-->", 1)
        text = "\n".join(rows[time_index + 1:]).strip()
        if text:
            result.append(SubtitleLine(parse_timestamp(start), parse_timestamp(end), text))
    return result


def load(path: str | Path) -> list[SubtitleLine]:
    return loads(Path(path).read_text(encoding="utf-8-sig"))
