#!/usr/bin/env python3
"""VAD 완전 비활성화 후 Whisper 타이밍 재검증."""

import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

base = Path(r"C:\Users\dong8\AppData\Local\CapCut\User Data\Projects\com.lveditor.draft\0627")

# 수동 자막
cid = json.loads((base / "draft_content.json").read_text(encoding='utf-8'))['id']
td = json.loads((base / "Timelines" / cid / "draft_content.json").read_text(encoding='utf-8'))
mats_by_id = {m['id']: m for m in td['materials']['texts']}

print("=" * 70)
print("수동 자막 (정확한 기준)")
print("=" * 70)
manual_track = [t for t in td['tracks'] if t.get('type') == 'text'][1]
for i, seg in enumerate(manual_track['segments'][:5], 1):
    mat = mats_by_id.get(seg['material_id'])
    if mat:
        text = json.loads(mat['content'])['text']
        start = seg['target_timerange']['start'] / 1_000_000
        dur = seg['target_timerange']['duration'] / 1_000_000
        print(f"  {i}. [{start:6.2f}s ~ {start+dur:6.2f}s] {text}")

print("\n" + "=" * 70)
print("Whisper 분석 (VAD 비활성화)")
print("=" * 70)

from faster_whisper import WhisperModel

mp4_file = list((base / "Resources" / "videoAlg").glob("*.mp4"))[0]
model = WhisperModel("large-v3", device="cpu", compute_type="int8")

# VAD 비활성화
segments, info = model.transcribe(
    str(mp4_file),
    language="ko",
    word_timestamps=True,
    vad_filter=False,
)

words = []
for seg in segments:
    for w in seg.words or []:
        words.append(w)

print(f"감지된 단어: {len(words)}개")
print(f"\n첫 20개 단어:")
for i, w in enumerate(words[:20], 1):
    print(f"  {i:2d}. [{w.start:6.2f}s ~ {w.end:6.2f}s] '{w.word.strip()}'")

if words:
    print("\n" + "=" * 70)
    print("분석")
    print("=" * 70)
    manual_first = 0.07
    whisper_first = words[0].start
    diff = whisper_first - manual_first

    print(f"수동 자막 첫 단어:   {manual_first:.2f}s")
    print(f"Whisper 첫 단어:    {whisper_first:.2f}s")
    print(f"차이:              {diff:+.3f}s")

    if abs(diff) < 0.1:
        print("✓ 매우 정확! (±0.1초 이내)")
    elif abs(diff) < 0.3:
        print("◎ 양호 (±0.3초 이내)")
    elif abs(diff) < 0.5:
        print("△ 개선 필요 (±0.5초 이내)")
    else:
        print(f"✗ 부정확 (±{abs(diff):.1f}초 오차)")
