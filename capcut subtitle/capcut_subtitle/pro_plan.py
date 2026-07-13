"""프로 테스트: 사용자가 Enter로 나눈 전문을 타임코드 자막으로 변환."""

from __future__ import annotations

import re
from difflib import SequenceMatcher

from .transcribe import SubtitleLine, Word


_SPACE_RE = re.compile(r"\s+")


def normalize_text(text: str) -> str:
    """비교용 정규화: 공백과 문장부호 차이의 영향을 줄인다."""
    text = _SPACE_RE.sub("", text or "")
    return re.sub(r"[^\w가-힣ぁ-んァ-ン一-龥]", "", text).lower()


def split_script_to_lines(script: str) -> list[str]:
    """빈 줄은 제외하고, 이용자가 Enter로 정한 줄만 블록 후보로 사용."""
    return [line.strip() for line in (script or "").splitlines() if line.strip()]


def _line_target_len(line: str, remaining_norm: str, remaining_word_norm: list[str]) -> int:
    target = normalize_text(line)
    if not target:
        return 0
    best_count = 1
    best_score = -1.0
    acc = ""
    for idx, word_norm in enumerate(remaining_word_norm, 1):
        acc += word_norm
        if not acc:
            continue
        score = SequenceMatcher(None, target, acc).ratio()
        # 길이가 너무 다르면 비슷한 접두부가 과대평가되는 것을 완화한다.
        len_penalty = abs(len(acc) - len(target)) / max(len(target), len(acc), 1)
        score -= len_penalty * 0.35
        if score > best_score:
            best_score = score
            best_count = idx
        if len(acc) >= len(target) * 1.35 and idx > best_count:
            break
    if best_score < 0.35 and remaining_norm:
        ratio = min(1.0, len(target) / max(len(remaining_norm), 1))
        best_count = max(1, round(len(remaining_word_norm) * ratio))
    return best_count


def build_lines_from_script(script: str, words: list[Word]) -> list[SubtitleLine]:
    """전문 편집 결과를 단어 타임스탬프에 순차 매핑한다.

    사용자가 일부 문구를 고쳐도 전체 순서는 유지된다고 보고, 각 줄이 차지할
    단어 수를 유사도로 추정한다. 마지막 줄은 남은 단어를 모두 흡수한다.
    """
    blocks = split_script_to_lines(script)
    valid_words = [w for w in words if (w[0] or "").strip() and w[2] > w[1]]
    if not blocks or not valid_words:
        return []

    out: list[SubtitleLine] = []
    cursor = 0
    word_norms = [normalize_text(w[0]) for w in valid_words]
    for idx, line in enumerate(blocks):
        remaining = len(valid_words) - cursor
        if remaining <= 0:
            break
        remaining_blocks = len(blocks) - idx
        if remaining_blocks == 1:
            count = remaining
        else:
            remaining_word_norm = word_norms[cursor:]
            remaining_norm = "".join(remaining_word_norm)
            count = _line_target_len(line, remaining_norm, remaining_word_norm)
            # 뒤 줄마다 최소 1단어는 남긴다.
            count = max(1, min(count, remaining - (remaining_blocks - 1)))
        chunk = valid_words[cursor:cursor + count]
        cursor += count
        out.append(SubtitleLine(
            start_us=chunk[0][1],
            end_us=max(chunk[-1][2], chunk[0][1] + 200_000),
            text=line,
            words=chunk,
        ))

    # 간격·겹침 보정. 사용자가 만든 줄 순서는 유지한다.
    for i, line in enumerate(out):
        if line.end_us - line.start_us < 200_000:
            line.end_us = line.start_us + 200_000
        if i + 1 < len(out) and line.end_us > out[i + 1].start_us:
            line.end_us = out[i + 1].start_us
    return [line for line in out if line.end_us > line.start_us and line.text.strip()]
