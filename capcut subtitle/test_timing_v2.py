#!/usr/bin/env python3
"""VAD 파라미터 조정 후 Whisper 타이밍 재검증."""

import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

base = Path(r"C:\Users\dong8\AppData\Local\CapCut\User Data\Projects\com.lveditor.draft\0627")

# 수동 자막 (정확한 기준)
cid = json.loads((base / "draft_content.json").read_text(encoding='utf-8'))['id']
td = json.loads((base / "Timelines" / cid / "draft_content.json").read_text(encoding='utf-8'))
mats_by_id = {m['id']: m for m in td['materials']['texts']}

print("=" * 70)
print("수동 자막 타이밍 (정확한 기준)")
print("=" * 70)
manual_track = [t for t in td['tracks'] if t.get('type') == 'text'][1]  # Track 2
for i, seg in enumerate(manual_track['segments'][:5], 1):
    mat = mats_by_id.get(seg['material_id'])
    if mat:
        text = json.loads(mat['content'])['text']
        start = seg['target_timerange']['start'] / 1_000_000
        dur = seg['target_timerange']['duration'] / 1_000_000
        print(f"  {i}. [{start:6.2f}s ~ {start+dur:6.2f}s] {text}")

print("\n" + "=" * 70)
print("Whisper 분석 (VAD min_silence=300ms)")
print("=" * 70)

from faster_whisper import WhisperModel

mp4_file = list((base / "Resources" / "videoAlg").glob("*.mp4"))[0]
model = WhisperModel("large-v3", device="cpu", compute_type="int8")

# 300ms로 조정
segments, info = model.transcribe(
    str(mp4_file),
    language="ko",
    word_timestamps=True,
    vad_filter=True,
    vad_parameters={"min_silence_duration_ms": 300},
)

words = []
for seg in segments:
    for w in seg.words or []:
        words.append(w)

print(f"감지된 단어: {len(words)}개")
print(f"\n첫 15개 단어:")
for i, w in enumerate(words[:15], 1):
    print(f"  {i:2d}. [{w.start:6.2f}s ~ {w.end:6.2f}s] '{w.word.strip()}'")

if words:
    print("\n" + "=" * 70)
    print("비교")
    print("=" * 70)
    print(f"수동 자막 첫 단어 시작: 0.07s")
    print(f"Whisper 첫 단어 시작:   {words[0].start:.2f}s")
    print(f"차이: {words[0].start - 0.07:.3f}s")
    if words[0].start < 0.5:
        print("✓ 개선됨! (처음 음성을 이제 감지)")
    else:
        print("✗ 여전히 첫 음성을 놓치고 있음")
