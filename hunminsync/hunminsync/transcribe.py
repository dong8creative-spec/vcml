"""faster-whisper transcription with word timestamps."""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import numpy as np

US = 1_000_000
SR = 16_000
DEFAULT_MODEL = "large-v3"
LANGUAGE_CHOICES = {"자동 감지": None, "한국어": "ko", "영어": "en", "일본어": "ja"}
Word = tuple[str, int, int]
Progress = Callable[[str], None]
RatioProgress = Callable[[float], None]


@dataclass
class SubtitleLine:
    start_us: int
    end_us: int
    text: str
    words: list[Word] = field(default_factory=list)


@dataclass
class FullScript:
    text: str
    words: list[Word]
    language: str = ""
    language_probability: float = 0.0


class Transcriber:
    def __init__(self, model_name: str = DEFAULT_MODEL) -> None:
        self.model_name = model_name
        self._model = None
        self._lock = threading.Lock()

    def load(self, progress: Progress = lambda _message: None) -> None:
        with self._lock:
            if self._model is not None:
                return
            from faster_whisper import WhisperModel

            progress("음성 인식 모델을 준비하고 있어요.")
            try:
                import ctranslate2
                use_cuda = ctranslate2.get_cuda_device_count() > 0
            except Exception:
                use_cuda = False
            device, compute_type = ("cuda", "float16") if use_cuda else ("cpu", "int8")
            self._model = WhisperModel(
                self._bundled_model() or self.model_name,
                device=device,
                compute_type=compute_type,
            )
            progress(f"음성 인식 모델 준비 완료 ({device})")

    def _bundled_model(self) -> str | None:
        root = Path(__file__).resolve().parent.parent / "models"
        for name in (f"faster-whisper-{self.model_name}", self.model_name):
            candidate = root / name
            if (candidate / "model.bin").is_file():
                return str(candidate)
        return None

    def transcribe(
        self,
        audio: np.ndarray,
        language: str | None = None,
        progress: Progress = lambda _message: None,
        progress_ratio: RatioProgress = lambda _ratio: None,
    ) -> FullScript:
        self.load(progress)
        if self._model is None:
            raise RuntimeError("음성 인식 모델을 불러오지 못했어요.")
        progress("음성을 전문으로 변환하고 있어요.")
        segments, info = self._model.transcribe(
            np.asarray(audio, dtype=np.float32),
            language=language,
            word_timestamps=True,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        total_seconds = len(audio) / SR
        words: list[Word] = []
        fallback: list[str] = []
        for segment in segments:
            if total_seconds:
                progress_ratio(min(1.0, max(0.0, float(segment.end) / total_seconds)))
            segment_words = [
                word for word in (segment.words or []) if (word.word or "").strip()
            ]
            if segment_words:
                words.extend(
                    (word.word, round(word.start * US), round(word.end * US))
                    for word in segment_words
                )
            elif (segment.text or "").strip():
                fallback.append(segment.text.strip())
        text = "".join(word[0] for word in words).strip() or " ".join(fallback)
        progress_ratio(1.0)
        return FullScript(
            text=text.strip(),
            words=words,
            language=str(info.language or ""),
            language_probability=float(info.language_probability or 0.0),
        )
