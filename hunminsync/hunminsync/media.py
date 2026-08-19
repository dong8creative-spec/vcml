"""Media decoding helpers."""

from __future__ import annotations

from pathlib import Path

import numpy as np

SAMPLE_RATE = 16_000
MEDIA_EXTENSIONS = {
    ".aac", ".flac", ".m4a", ".mkv", ".mov", ".mp3", ".mp4",
    ".ogg", ".opus", ".wav", ".webm", ".wma",
}


def validate_media_path(path: str | Path) -> Path:
    media_path = Path(path).expanduser().resolve()
    if not media_path.is_file():
        raise FileNotFoundError(f"미디어 파일을 찾을 수 없어요: {media_path}")
    if media_path.suffix.lower() not in MEDIA_EXTENSIONS:
        raise ValueError(f"지원하지 않는 미디어 형식이에요: {media_path.suffix}")
    return media_path


def decode_media(path: str | Path) -> np.ndarray:
    """Decode any faster-whisper/FFmpeg-supported media to mono float32 16 kHz."""
    from faster_whisper.audio import decode_audio

    media_path = validate_media_path(path)
    audio = np.asarray(decode_audio(str(media_path), sampling_rate=SAMPLE_RATE))
    if audio.ndim > 1:
        audio = audio.mean(axis=0)
    return np.ascontiguousarray(audio, dtype=np.float32)


def duration_us(audio: np.ndarray) -> int:
    return round(len(audio) * 1_000_000 / SAMPLE_RATE)


def probe_duration_us(path: str | Path) -> int:
    """Read container duration without decoding the full media file."""
    import av

    media_path = validate_media_path(path)
    with av.open(str(media_path)) as container:
        if container.duration is not None:
            return max(0, int(container.duration))
        durations = []
        for stream in container.streams:
            if stream.duration is not None and stream.time_base is not None:
                durations.append(float(stream.duration * stream.time_base))
        if durations:
            return max(0, round(max(durations) * 1_000_000))
    raise ValueError("미디어 재생 시간을 확인하지 못했어요.")
