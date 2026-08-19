"""Map user-defined Enter lines back to word timestamps."""

from __future__ import annotations

import re
from difflib import SequenceMatcher

from .transcribe import SubtitleLine, Word

_NON_TEXT = re.compile(r"[^\w가-힣ぁ-んァ-ン一-龥]+", re.UNICODE)


def normalize_text(text: str) -> str:
    return _NON_TEXT.sub("", text or "").casefold()


def split_enter_lines(script: str) -> list[str]:
    """Only Enter creates blocks; wrapping and punctuation never do."""
    return [line.strip() for line in (script or "").splitlines() if line.strip()]


def _score(target: str, candidate: str) -> float:
    if not target and not candidate:
        return 1.0
    similarity = SequenceMatcher(None, target, candidate, autojunk=False).ratio()
    length_penalty = abs(len(target) - len(candidate)) / max(len(target), len(candidate), 1)
    return similarity - 0.25 * length_penalty


def build_enter_lines(script: str, words: list[Word]) -> list[SubtitleLine]:
    """Globally align edited Enter lines to ordered words using dynamic programming."""
    lines = split_enter_lines(script)
    valid = [word for word in words if normalize_text(word[0]) and word[2] > word[1]]
    if not lines or not valid:
        return []

    # More lines than words cannot preserve one timestamped word per block.
    line_count = min(len(lines), len(valid))
    lines = lines[:line_count]
    targets = [normalize_text(line) for line in lines]
    word_text = [normalize_text(word[0]) for word in valid]
    n, m = len(lines), len(valid)
    neg_inf = float("-inf")
    dp = [[neg_inf] * (m + 1) for _ in range(n + 1)]
    back = [[-1] * (m + 1) for _ in range(n + 1)]
    dp[0][0] = 0.0

    for i in range(1, n + 1):
        min_end = i
        max_end = m - (n - i)
        for end in range(min_end, max_end + 1):
            candidate = ""
            for start in range(end - 1, i - 2, -1):
                candidate = word_text[start] + candidate
                if dp[i - 1][start] == neg_inf:
                    continue
                value = dp[i - 1][start] + _score(targets[i - 1], candidate)
                if value > dp[i][end]:
                    dp[i][end], back[i][end] = value, start

    boundaries: list[tuple[int, int]] = []
    end = m
    for i in range(n, 0, -1):
        start = back[i][end]
        if start < 0:
            return []
        boundaries.append((start, end))
        end = start
    boundaries.reverse()

    result: list[SubtitleLine] = []
    for text, (start, end) in zip(lines, boundaries):
        chunk = valid[start:end]
        result.append(SubtitleLine(
            start_us=chunk[0][1],
            end_us=max(chunk[-1][2], chunk[0][1] + 100_000),
            text=text,
            words=chunk,
        ))
    return result


# Practical compatibility name for callers from related VCML apps.
build_lines_from_script = build_enter_lines
