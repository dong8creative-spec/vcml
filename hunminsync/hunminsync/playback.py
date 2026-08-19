"""Cross-platform preview playback using OS-provided players."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

SR = 16_000


def write_wav(audio: np.ndarray, path: str | Path) -> None:
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(SR)
        output.writeframes(pcm.tobytes())


class Player:
    def __init__(self) -> None:
        self._directory = Path(tempfile.mkdtemp(prefix="hunminsync_preview_"))
        self._process: subprocess.Popen | None = None
        self._counter = 0

    def play(self, audio: np.ndarray) -> None:
        self.stop()
        if len(audio) == 0:
            return
        self._counter += 1
        path = self._directory / f"preview-{self._counter}.wav"
        write_wav(audio, path)
        if os.name == "nt":
            import winsound
            winsound.PlaySound(
                str(path), winsound.SND_FILENAME | winsound.SND_ASYNC | winsound.SND_NODEFAULT
            )
        elif shutil.which("afplay"):
            self._process = subprocess.Popen(
                ["afplay", str(path)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        else:
            raise RuntimeError("미리듣기는 Windows 또는 macOS에서 지원돼요.")

    def stop(self) -> None:
        if os.name == "nt":
            import winsound
            winsound.PlaySound(None, winsound.SND_PURGE)
        process, self._process = self._process, None
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                process.kill()

    def cleanup(self) -> None:
        self.stop()
        shutil.rmtree(self._directory, ignore_errors=True)
