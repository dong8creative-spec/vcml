"""자막 구간 오디오 미리듣기 재생 (Windows winsound 기반)."""

from __future__ import annotations

import shutil
import tempfile
import wave
from pathlib import Path

import numpy as np

SR = 16000


def _write_wav(audio: np.ndarray, path: Path) -> None:
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SR)
        wf.writeframes(pcm.tobytes())


class Player:
    """오디오 조각을 임시 wav로 저장해 비동기 재생 (다음 play/stop 호출 전까지)."""

    def __init__(self) -> None:
        self._tmpdir = Path(tempfile.mkdtemp(prefix="capcut_subtitle_"))
        self._counter = 0

    def play(self, audio: np.ndarray) -> None:
        self.stop()
        if len(audio) == 0:
            return
        self._counter += 1
        path = self._tmpdir / f"seg_{self._counter}.wav"
        _write_wav(audio, path)
        try:
            import winsound
            winsound.PlaySound(str(path), winsound.SND_FILENAME | winsound.SND_ASYNC)
        except Exception:
            pass

    def stop(self) -> None:
        try:
            import winsound
            winsound.PlaySound(None, 0)
        except Exception:
            pass

    def cleanup(self) -> None:
        self.stop()
        shutil.rmtree(self._tmpdir, ignore_errors=True)
