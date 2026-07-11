#!/usr/bin/env python3
"""0627 프로젝트의 Whisper 타이밍 검증."""

import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

base = Path(r"C:\Users\dong8\AppData\Local\CapCut\User Data\Projects\com.lveditor.draft\0627")

# 수동 자막 타이밍 추출
draft_path = base / "draft_content.json"
with open(draft_path, encoding='utf-8') as f:
    data = json.load(f)

cid = data['id']
timeline_path = base / "Timelines" / cid / "draft_content.json"
with open(timeline_path, encoding='utf-8') as f:
    td = json.load(f)

mats_by_id = {m['id']: m for m in td['materials']['texts']}
text_tracks = [t for t in td['tracks'] if t.get('type') == 'text']

print("=" * 70)
print("0627 프로젝트 — 자막 타이밍 비교")
print("=" * 70)

for track_idx, track in enumerate(text_tracks, 1):
    print(f"\nTrack {track_idx}: '{track.get('name')}'")
    print("-" * 70)
    for i, seg in enumerate(track['segments'][:5], 1):
        mat = mats_by_id.get(seg['material_id'])
        if mat:
            text = json.loads(mat['content'])['text']
            start = seg['target_timerange']['start'] / 1_000_000
            dur = seg['target_timerange']['duration'] / 1_000_000
            print(f"  {i:2d}. [{start:6.2f}s ~ {start+dur:6.2f}s] {text}")

# Whisper 모델 로드 및 처리
print("\n" + "=" * 70)
print("Whisper 음성 인식 중... (첫 사용 시 모델 다운로드, ~2분)")
print("=" * 70)

from faster_whisper import WhisperModel

mp4_files = list((base / "Resources" / "videoAlg").glob("*.mp4"))
if not mp4_files:
    print("ERROR: MP4 파일을 찾을 수 없습니다.")
    sys.exit(1)

video_path = mp4_files[0]
print(f"처리 파일: {video_path.name}")

model = WhisperModel("large-v3", device="cpu", compute_type="int8")
segments, info = model.transcribe(
    str(video_path),
    language="ko",
    word_timestamps=True,
    vad_filter=True,
    vad_parameters={"min_silence_duration_ms": 400},
)

words = []
for seg in segments:
    for w in seg.words or []:
        words.append(w)

print(f"\nWhisper 결과 — 첫 15개 단어 타이밍:")
print("-" * 70)
for i, w in enumerate(words[:15], 1):
    print(f"  {i:2d}. [{w.start:6.2f}s ~ {w.end:6.2f}s] '{w.word.strip()}'")

print("\n" + "=" * 70)
print("분석:")
print("=" * 70)
if words:
    print(f"Whisper 첫 단어 시작: {words[0].start:.2f}s")
    print(f"수동 자막 첫 단어 시작: 0.07s (Track 2)")
    print(f"차이: {words[0].start - 0.07:.2f}s (Whisper가 {'+' if words[0].start > 0.07 else ''}{words[0].start - 0.07:.2f}s)")
    if words[0].start > 0.07:
        print(f"→ Whisper가 실제보다 약 {words[0].start - 0.07:.2f}s 뒤에 감지하고 있습니다.")
    else:
        print(f"→ Whisper가 실제보다 약 {0.07 - words[0].start:.2f}s 앞에 감지하고 있습니다.")
