"""자막 구간 오디오 미리듣기 재생 (맥 afplay 기반).

맥 기본 제공 명령 `afplay`로 임시 wav를 비동기 재생한다. 다음 play/stop
호출 시 이전 재생을 중단한다. 외부 파이썬 오디오 라이브러리가 필요 없다.
"""

from __future__ import annotations

import shutil
import subprocess
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
    """오디오 조각을 임시 wav로 저장해 afplay로 비동기 재생."""

    def __init__(self) -> None:
        self._tmpdir = Path(tempfile.mkdtemp(prefix="tadaksync_preview_"))
        self._counter = 0
        self._proc: subprocess.Popen | None = None

    def play(self, audio: np.ndarray) -> None:
        self.stop()
        if len(audio) == 0:
            return
        self._counter += 1
        path = self._tmpdir / f"seg_{self._counter}.wav"
        _write_wav(audio, path)
        try:
            self._proc = subprocess.Popen(
                ["afplay", str(path)],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        except (OSError, subprocess.SubprocessError):
            self._proc = None

    def stop(self) -> None:
        proc = self._proc
        self._proc = None
        if proc is None:
            return
        try:
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=1.0)
                except subprocess.TimeoutExpired:
                    proc.kill()
        except (OSError, subprocess.SubprocessError):
            pass

    def cleanup(self) -> None:
        self.stop()
        shutil.rmtree(self._tmpdir, ignore_errors=True)
