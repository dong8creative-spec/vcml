"""Whisper(faster-whisper) 기반 음성 인식 → 자막 라인 생성."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Callable, Optional

import numpy as np

US = 1_000_000

MODEL = "large-v3"  # 고정 모델
LANGUAGE_CHOICES = {
    "자동 감지": None,
    "한국어": "ko",
    "일본어": "ja",
}

_SENTENCE_END = re.compile(r"[.!?。！？…]$")

Word = tuple[str, int, int]  # (단어 텍스트, 시작us, 끝us)


@dataclass
class SubtitleLine:
    start_us: int
    end_us: int
    text: str
    words: list[Word] = field(default_factory=list)  # 정밀 분할에 사용, 없어도 동작


class Transcriber:
    """faster-whisper 모델 로딩/인식 래퍼. 모델은 첫 사용 시 자동 다운로드."""

    def __init__(self) -> None:
        self._model = None
        self._model_size: Optional[str] = None

    def load(self, model_size: str, progress: Callable[[str], None] = print) -> None:
        if self._model is not None and self._model_size == model_size:
            return
        progress(f"Whisper 모델({model_size}) 로딩 중... (최초 1회 자동 다운로드)")
        from faster_whisper import WhisperModel
        self._model = WhisperModel(model_size, device="cpu", compute_type="int8")
        self._model_size = model_size
        progress("모델 로딩 완료")

    def transcribe(
        self,
        audio: np.ndarray,
        language: Optional[str] = None,
        max_words_per_line: int = 5,
        progress: Callable[[str], None] = print,
        progress_ratio: Callable[[float], None] = lambda r: None,
    ) -> list[SubtitleLine]:
        assert self._model is not None, "모델을 먼저 load() 하세요"
        total_sec = len(audio) / 16000
        progress("음성 인식 중...")
        segments, info = self._model.transcribe(
            audio,
            language=language,
            word_timestamps=True,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 400},
        )
        words = []
        for seg in segments:
            for w in seg.words or []:
                words.append(w)
            if total_sec > 0:
                progress_ratio(min(seg.end / total_sec, 1.0))
        progress(f"인식 언어: {info.language} (확률 {info.language_probability:.0%})")
        return _split_lines(words, max_words_per_line)


def _split_lines(words: list, max_words_per_line: int) -> list[SubtitleLine]:
    """어절 단위로 자막을 분할.

    Whisper는 한국어/일본어에서 각 어절을 앞에 공백이 붙은 개별 토큰
    (' 네', ' 여러분', ' 반갑습니다.')으로 반환한다. 즉 words의 각 원소가
    곧 하나의 어절이므로, 이를 max_words_per_line개씩 묶어 라인을 만든다.
    각 라인의 시작/끝 시간은 첫 어절의 시작 ~ 마지막 어절의 끝으로,
    말이 시작하는 지점부터 끝나는 지점까지 정확히 맞춘다.
    """
    lines: list[SubtitleLine] = []
    cur: list = []  # 현재 라인에 쌓인 어절(단어 객체)들

    def flush() -> None:
        nonlocal cur
        if not cur:
            return
        text = "".join(w.word for w in cur).strip()
        if text:
            lines.append(SubtitleLine(
                start_us=int(cur[0].start * US),
                end_us=int(cur[-1].end * US),
                text=text,
                words=[(w.word, int(w.start * US), int(w.end * US)) for w in cur],
            ))
        cur = []

    for w in words:
        token = w.word.strip()
        if not token:  # 순수 공백 토큰(드묾)은 건너뜀
            continue

        # 어절 사이 침묵이 0.8초 이상이면 여기서 라인 분리
        if cur and w.start - cur[-1].end > 0.8:
            flush()

        cur.append(w)

        # 어절 수가 상한에 도달하면 라인 분리
        if len(cur) >= max_words_per_line:
            flush()
            continue

        # 문장 끝(.!? 등) 또는 6초 초과 시 라인 분리
        if _SENTENCE_END.search(token) or (w.end - cur[0].start) > 6.0:
            flush()

    flush()

    # 라인 간 겹침 제거 및 최소 표시시간 보정
    for i, line in enumerate(lines):
        if line.end_us - line.start_us < 500_000:
            line.end_us = line.start_us + 500_000
        if i + 1 < len(lines) and line.end_us > lines[i + 1].start_us:
            line.end_us = lines[i + 1].start_us
    return [l for l in lines if l.text.strip()]


def _matched_words(line: SubtitleLine) -> list[Word] | None:
    """line.words가 현재 line.text와 여전히 일치하면(수동 편집되지 않았으면) 반환."""
    if not line.words:
        return None
    raw = "".join(w[0] for w in line.words)
    return line.words if raw.strip() == line.text else None


def split_line(line: SubtitleLine, offset: int) -> tuple[SubtitleLine, SubtitleLine] | None:
    """line.text의 offset(문자 위치)에서 두 자막으로 분할.

    단어 타임스탬프가 남아있으면(=텍스트를 수동 수정하지 않았으면) 단어 경계로
    정확히 나누고, 아니면 시간 길이를 문자 수 비율로 나눈다(브루의 커서 분할과 동일한 방식).
    """
    text = line.text
    if not (0 < offset < len(text)):
        return None
    left_text, right_text = text[:offset].rstrip(), text[offset:].lstrip()
    if not left_text or not right_text:
        return None

    words = _matched_words(line)
    split_time = None
    left_words: list[Word] = []
    right_words: list[Word] = []
    if words:
        raw = "".join(w[0] for w in words)
        target = offset + (len(raw) - len(raw.lstrip()))  # 앞쪽 공백 보정
        pos = 0
        for w in words:
            w_start_char, w_end_char = pos, pos + len(w[0])
            pos = w_end_char
            if w_end_char <= target:
                left_words.append(w)
            elif w_start_char >= target:
                right_words.append(w)
            else:
                # 분할 지점이 한 단어(한국어 등에서 흔히 여러 음절이 공백 없이
                # 하나로 묶인 토큰) 내부를 가로지름: 그 단어의 시간 구간 안에서
                # 문자 비율로 보간한다 (통째로 한쪽에 몰아주면 시간이 왜곡됨).
                frac = (target - w_start_char) / (w_end_char - w_start_char)
                split_time = round(w[1] + (w[2] - w[1]) * frac)
        if split_time is None:
            if right_words:
                split_time = right_words[0][1]
            elif left_words:
                split_time = left_words[-1][2]

    if split_time is None:
        ratio = offset / len(text)
        split_time = line.start_us + round((line.end_us - line.start_us) * ratio)
    split_time = max(line.start_us + 1, min(line.end_us - 1, split_time))

    left = SubtitleLine(line.start_us, split_time, left_text, left_words)
    right = SubtitleLine(split_time, line.end_us, right_text, right_words)
    return left, right


def merge_lines(lines: list[SubtitleLine]) -> SubtitleLine:
    """연속된 자막 여러 개를 하나로 합침 (시간순으로 정렬되어 있다고 가정)."""
    text = " ".join(l.text for l in lines).strip()
    words: list[Word] = []
    if all(l.words for l in lines):
        for l in lines:
            words.extend(l.words)
    return SubtitleLine(lines[0].start_us, lines[-1].end_us, text, words)
