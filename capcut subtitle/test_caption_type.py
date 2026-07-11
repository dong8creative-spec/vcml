#!/usr/bin/env python3
"""캡컷 프로젝트들에서 자동 캡션(subtitle) vs 일반 텍스트 구조 차이 조사."""

import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

root = Path(r"C:\Users\dong8\AppData\Local\CapCut\User Data\Projects\com.lveditor.draft")

for proj in sorted(root.iterdir()):
    content = proj / "draft_content.json"
    if not content.is_file():
        continue
    try:
        d = json.loads(content.read_text(encoding='utf-8'))
    except Exception:
        continue
    texts = (d.get("materials") or {}).get("texts") or []
    tracks = d.get("tracks") or []
    text_tracks = [t for t in tracks if t.get("type") == "text"]
    if not texts and not text_tracks:
        continue
    print(f"=== {proj.name}")
    for m in texts:
        print(f"  text material: type={m.get('type')!r} subtype={m.get('subtype')!r}"
              f" id={m.get('id', '')[:8]}")
    for t in text_tracks:
        print(f"  text track: name={t.get('name')!r} flag={t.get('flag')!r}"
              f" attribute={t.get('attribute')!r} segs={len(t.get('segments') or [])}")
    # 자동 캡션 흔적: extra 필드
    for key in ("subtitle_taskinfo", "subtitle_fragment_info_list", "caption_info"):
        if d.get(key):
            print(f"  {key}: {str(d[key])[:200]}")
