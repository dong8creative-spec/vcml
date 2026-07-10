"""SRT 파일 입출력."""

from __future__ import annotations

import re
from pathlib import Path

from .transcribe import SubtitleLine

US = 1_000_000


def _fmt_time(us: int) -> str:
    ms = us // 1000
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _parse_time(t: str) -> int:
    m = re.match(r"(\d+):(\d+):(\d+)[,.](\d+)", t.strip())
    if not m:
        raise ValueError(f"잘못된 시간 형식: {t}")
    h, mi, s, ms = (int(g) for g in m.groups())
    return ((h * 3600 + mi * 60 + s) * 1000 + ms) * 1000


def dump(lines: list[SubtitleLine], path: str | Path) -> None:
    out = []
    for i, line in enumerate(lines, 1):
        out.append(f"{i}\n{_fmt_time(line.start_us)} --> {_fmt_time(line.end_us)}\n{line.text}\n")
    Path(path).write_text("\n".join(out), encoding="utf-8-sig")


def load(path: str | Path) -> list[SubtitleLine]:
    text = Path(path).read_text(encoding="utf-8-sig")
    lines: list[SubtitleLine] = []
    for block in re.split(r"\n\s*\n", text.strip()):
        rows = [r for r in block.strip().splitlines() if r.strip()]
        if len(rows) < 2:
            continue
        idx = 1 if "-->" in rows[1] else 0
        if "-->" not in rows[idx]:
            continue
        start, end = rows[idx].split("-->")
        content = " ".join(rows[idx + 1:]).strip()
        if content:
            lines.append(SubtitleLine(_parse_time(start), _parse_time(end), content))
    return lines
