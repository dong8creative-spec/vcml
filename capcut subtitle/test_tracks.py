#!/usr/bin/env python3
"""0627 프로젝트의 비디오/오디오 트랙 배치 확인."""

import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

base = Path(r"C:\Users\dong8\AppData\Local\CapCut\User Data\Projects\com.lveditor.draft\0627")
d = json.loads((base / "draft_content.json").read_text(encoding='utf-8'))

mats = {}
for kind in ("videos", "audios", "drafts"):
    for m in (d.get("materials") or {}).get(kind) or []:
        m["_kind"] = kind
        mats[m["id"]] = m

print("duration:", d.get("duration"))
for i, t in enumerate(d.get("tracks") or []):
    ty = t.get("type")
    if ty not in ("video", "audio"):
        continue
    print(f"--- track[{i}] type={ty} attribute={t.get('attribute')}")
    for j, s in enumerate(t.get("segments") or []):
        m = mats.get(s.get("material_id"), {})
        src = s.get("source_timerange") or {}
        tgt = s.get("target_timerange") or {}
        name = Path(m.get("path") or "?").name
        print(f"  seg{j}: tgt {tgt.get('start', 0)/1e6:.3f}+{tgt.get('duration', 0)/1e6:.3f}s"
              f" | src {src.get('start', 0)/1e6:.3f}+{src.get('duration', 0)/1e6:.3f}s"
              f" | speed={s.get('speed')} vol={s.get('volume')}"
              f" | kind={m.get('_kind')} | {name}")
