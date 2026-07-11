#!/usr/bin/env python3
"""0711 프로젝트의 기존 AI 자막을 내용 그대로 캡션 타입으로 재삽입."""

import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, str(Path(__file__).parent))

from capcut_subtitle import capcut
from capcut_subtitle.inject import SubtitleStyle, inject_subtitles
from capcut_subtitle.transcribe import SubtitleLine

if capcut.is_capcut_running():
    print("캡컷이 실행 중입니다. 종료 후 다시 실행하세요.")
    sys.exit(1)

base = Path(r"C:\Users\dong8\AppData\Local\CapCut\User Data\Projects\com.lveditor.draft\0711")
d = json.loads((base / "draft_content.json").read_text(encoding='utf-8'))
mats = {m["id"]: m for m in d["materials"]["texts"]}
track = [t for t in d["tracks"]
         if t.get("type") == "text" and t.get("name") == "AI 자막"][0]

lines = []
for seg in track["segments"]:
    m = mats.get(seg["material_id"])
    if not m:
        continue
    text = json.loads(m["content"])["text"]
    tr = seg["target_timerange"]
    lines.append(SubtitleLine(tr["start"], tr["start"] + tr["duration"], text))

print(f"기존 AI 자막 {len(lines)}개를 캡션 타입으로 재삽입...")
backup = inject_subtitles(base, lines, SubtitleStyle(as_caption=True))
print(f"완료. 백업: {backup.name}")
