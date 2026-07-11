#!/usr/bin/env python3
"""타임라인 오디오에 대한 VAD 발화 구간 검출 결과 확인."""

import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, str(Path(__file__).parent))

from capcut_subtitle import capcut

projects = [p for p in capcut.list_projects() if p.name == "0627"]
res = capcut.build_timeline_audio(projects[0])
audio = res.audio

from faster_whisper.vad import VadOptions, get_speech_timestamps

for th in (0.5, 0.35, 0.25, 0.15):
    opts = VadOptions(threshold=th, min_speech_duration_ms=100,
                      min_silence_duration_ms=200, speech_pad_ms=40)
    regions = get_speech_timestamps(audio, vad_options=opts)
    parts = ", ".join(f"[{r['start']/16000:.2f}~{r['end']/16000:.2f}]"
                      for r in regions[:6])
    print(f"threshold={th}: {len(regions)}개 구간 → {parts}")

# 앞 1초 구간 에너지 프로파일 (50ms 단위)
import numpy as np
print("\n앞 1.2초 RMS(50ms 프레임):")
for i in range(24):
    a, b = int(i * 0.05 * 16000), int((i + 1) * 0.05 * 16000)
    rms = float(np.sqrt(np.mean(audio[a:b] ** 2)))
    print(f"  {i*0.05:.2f}s: {'#' * int(rms * 400)} {rms:.4f}")
