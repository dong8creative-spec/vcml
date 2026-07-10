"""자막을 캡컷 프로젝트(draft_content.json)에 텍스트 트랙으로 삽입."""

from __future__ import annotations

import json
import shutil
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

from . import srt as srt_io
from .transcribe import SubtitleLine

TRACK_NAME = "AI 자막"


@dataclass
class SubtitleStyle:
    size: float = 7.0
    color: tuple[float, float, float] = (1.0, 1.0, 1.0)   # 흰색
    border_color: tuple[float, float, float] = (0.0, 0.0, 0.0)
    border: bool = True
    bold: bool = False
    transform_y: float = -0.8   # -1(하단) ~ 1(상단)


def backup_draft(draft_dir: Path) -> Path:
    """draft_content.json 백업본 생성."""
    src = draft_dir / "draft_content.json"
    stamp = time.strftime("%Y%m%d_%H%M%S")
    dst = draft_dir / f"draft_content.aisub_backup_{stamp}.json"
    shutil.copy2(src, dst)
    # 백업이 쌓이면 오래된 것부터 정리 (최근 10개 유지)
    backups = sorted(draft_dir.glob("draft_content.aisub_backup_*.json"))
    for old in backups[:-10]:
        old.unlink(missing_ok=True)
    return dst


def _remove_previous_track(content_path: Path) -> bool:
    """이전에 삽입한 'AI 자막' 트랙과 관련 소재를 제거."""
    with open(content_path, encoding="utf-8") as f:
        raw = json.load(f)

    tracks = raw.get("tracks") or []
    targets = [t for t in tracks
               if t.get("type") == "text" and t.get("name") == TRACK_NAME]
    if not targets:
        return False

    dead_ids: set[str] = set()
    for t in targets:
        for seg in t.get("segments") or []:
            dead_ids.add(seg.get("material_id", ""))
            dead_ids.update(seg.get("extra_material_refs") or [])

    raw["tracks"] = [t for t in tracks if t not in targets]
    mats = raw.get("materials") or {}
    for kind in ("texts", "material_animations"):
        if kind in mats and mats[kind]:
            mats[kind] = [m for m in mats[kind] if m.get("id") not in dead_ids]

    with open(content_path, "w", encoding="utf-8") as f:
        json.dump(raw, f, ensure_ascii=False, separators=(",", ":"))
    return True


def inject_subtitles(draft_dir: Path, lines: list[SubtitleLine],
                     style: SubtitleStyle | None = None) -> Path:
    """자막 라인을 캡컷 프로젝트에 삽입. 백업 파일 경로를 반환."""
    import pycapcut as pc

    style = style or SubtitleStyle()
    content_path = draft_dir / "draft_content.json"
    if not content_path.is_file():
        raise FileNotFoundError(f"draft_content.json이 없습니다: {draft_dir}")

    backup = backup_draft(draft_dir)
    try:
        _remove_previous_track(content_path)

        with tempfile.TemporaryDirectory() as td:
            srt_path = Path(td) / "subs.srt"
            srt_io.dump(lines, srt_path)

            script = pc.ScriptFile.load_template(str(content_path))
            reference = pc.TextSegment(
                "참조", pc.trange(0, 1_000_000),
                style=pc.TextStyle(
                    size=style.size, color=style.color, bold=style.bold,
                    align=1, auto_wrapping=True, max_line_width=0.82,
                ),
                border=(pc.TextBorder(color=style.border_color)
                        if style.border else None),
            )
            script.import_srt(
                str(srt_path), TRACK_NAME,
                style_reference=reference,
                clip_settings=pc.ClipSettings(transform_y=style.transform_y),
            )
            script.save()
    except Exception:
        shutil.copy2(backup, content_path)  # 실패 시 원상 복구
        raise
    return backup
