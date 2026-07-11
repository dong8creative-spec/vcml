#!/usr/bin/env python3
"""캡션 모드 삽입 구조 검증 — 0711 사본에 삽입 후 JSON 확인."""

import json
import shutil
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, str(Path(__file__).parent))

src = Path(r"C:\Users\dong8\AppData\Local\CapCut\User Data\Projects\com.lveditor.draft\0711")
dst = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
    r"C:\Users\dong8\AppData\Local\Temp\claude\caption_test_0711")

if dst.exists():
    shutil.rmtree(dst)
shutil.copytree(src, dst)

from capcut_subtitle.inject import SubtitleStyle, inject_subtitles
from capcut_subtitle.transcribe import SubtitleLine

lines = [
    SubtitleLine(0, 1_500_000, "캡션 테스트 첫 줄"),
    SubtitleLine(1_500_000, 3_000_000, "캡션 테스트 둘째 줄"),
]
inject_subtitles(dst, lines, SubtitleStyle(as_caption=True))

d = json.loads((dst / "draft_content.json").read_text(encoding='utf-8'))
track = [t for t in d["tracks"] if t.get("name") == "AI 자막"][0]
mats = {m["id"]: m for m in d["materials"]["texts"]}

print(f"track: type={track['type']} flag={track.get('flag')} segs={len(track['segments'])}")
for seg in track["segments"]:
    m = mats[seg["material_id"]]
    text = json.loads(m["content"])["text"]
    print(f"  seg: mat type={m.get('type')!r} text={text!r}"
          f" t={seg['target_timerange']}")

# Timelines 사본 동기화 확인
cid = d["id"]
tl = dst / "Timelines" / cid / "draft_content.json"
if tl.is_file():
    td = json.loads(tl.read_text(encoding='utf-8'))
    tt = [t for t in td["tracks"] if t.get("name") == "AI 자막"]
    print(f"Timelines 사본: AI 자막 트랙 {len(tt)}개, flag={tt[0].get('flag') if tt else '-'}")

ok = (track.get("flag") == 1
      and all(mats[s["material_id"]].get("type") == "subtitle"
              for s in track["segments"]))
print("✓ 캡션 구조 확인" if ok else "✗ 구조 불일치")
