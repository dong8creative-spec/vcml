"""자막 구간 오디오 미리듣기 재생 (Windows winsound 기반)."""

from __future__ import annotations

import io
import wave

import numpy as np

SR = 16000


def _wav_bytes(audio: np.ndarray) -> bytes:
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SR)
        wf.writeframes(pcm.tobytes())
    return buf.getvalue()


class Player:
    """오디오 조각을 메모리에서 바로 재생 (다음 play/stop 호출 전까지).

    이전에는 매번 임시 wav 파일을 디스크에 썼다가 winsound로 다시 읽어
    재생했는데, 그 디스크 왕복 자체가 버튼을 누른 시점과 실제로 소리가
    나오는 시점 사이에 수백 ms 지연을 만들어 "자막이 오디오보다 먼저 뜬다"처럼
    보이게 했다. SND_MEMORY로 파일 I/O 없이 바로 재생해 이 지연을 없앤다.
    """

    def play(self, audio: np.ndarray) -> None:
        self.stop()
        if len(audio) == 0:
            return
        data = _wav_bytes(audio)
        try:
            import winsound
            winsound.PlaySound(data, winsound.SND_MEMORY | winsound.SND_ASYNC)
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
