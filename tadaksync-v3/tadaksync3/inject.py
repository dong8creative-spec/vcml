"""자막을 캡컷 프로젝트(draft_content.json)에 텍스트 트랙으로 삽입.

캡컷 9.x가 실제로 생성하는 자막 구조(native_text_schema의 실측 템플릿)를
그대로 복제해 삽입한다. 수동 자막 세그먼트를 복제해 넣으면 캡컷이 정상
인식함을 실험(0627_test4)으로 확인한 방식이다.

주의: 캡컷은 프로젝트 최상위 draft_content.json 외에
'Timelines/<내부 id>/draft_content.json' 사본도 편집기 상태로 쓰므로
두 파일을 모두 갱신해야 한다.

v2 확장: 스타일 프리셋(styles.py)을 위해 그림자·배경 박스를 지원한다.
실측 템플릿에 이미 존재하는 소재 필드(has_shadow, background_*)에 값을
채우는 방식이라 구조 자체는 검증된 형태를 벗어나지 않는다.
"""

from __future__ import annotations

import copy
import json
import os
import shutil
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

from .native_text_schema import (ANIMATION_TPL, MATERIAL_TPL, SEGMENT_TPL,
                                 TRACK_TPL)
from .transcribe import SubtitleLine

# v1/v2와 같은 원어 트랙 이름 유지. v3 번역 트랙은 별도 이름으로 분리한다.
TRACK_NAME = "AI 자막"
TRACK_NAME_TRANSLATED = "AI 자막(번역)"
TRACK_NAMES = (TRACK_NAME, TRACK_NAME_TRANSLATED)
# 이중 자막일 때 번역 트랙을 원어보다 약간 위에 둔다.
TRANSLATED_Y_OFFSET = 0.18

Color = tuple[float, float, float]


@dataclass
class SubtitleStyle:
    size: float = 7.0
    color: Color = (1.0, 1.0, 1.0)   # 흰색
    border_color: Color = (0.0, 0.0, 0.0)
    border: bool = True
    bold: bool = False
    transform_x: float = 0.0
    transform_y: float = -0.8   # -1(하단) ~ 1(상단)
    # 캡컷 위치 패널에 보이는 픽셀값. 있으면 삽입 시 캔버스 크기로 나눠
    # transform에 기록한다. (패널표시 ≈ transform * canvas_w/h)
    ui_x: float | None = None
    ui_y: float | None = None
    as_caption: bool = True     # True면 캡컷 '자동 캡션'과 같은 캡션 트랙으로 삽입
    # --- v2 확장 ---
    shadow: bool = False
    shadow_color: Color = (0.0, 0.0, 0.0)
    shadow_alpha: float = 0.8
    bg: bool = False                    # 배경 박스 (뉴스 자막 바 스타일)
    bg_color: Color = (0.0, 0.0, 0.0)
    bg_alpha: float = 0.75
    bg_round_radius: float = 0.24
    bg_width: float = 0.14
    bg_height: float = 0.14


def _canvas_size(data: dict) -> tuple[float, float]:
    cc = data.get("canvas_config") or {}
    w = float(cc.get("width") or 1920)
    h = float(cc.get("height") or 1080)
    return max(w, 1.0), max(h, 1.0)


def _resolve_transform(style: SubtitleStyle,
                       canvas_w: float, canvas_h: float) -> tuple[float, float]:
    """정규화 transform 또는 캡컷 UI 픽셀 → clip.transform 값."""
    if style.ui_x is not None and style.ui_y is not None:
        return style.ui_x / canvas_w, style.ui_y / canvas_h
    return style.transform_x, style.transform_y


def _hex(color: Color) -> str:
    r, g, b = (max(0, min(255, round(c * 255))) for c in color)
    return f"#{r:02X}{g:02X}{b:02X}"


def _rgb_hex(hex_color: str) -> Color:
    value = str(hex_color or "").strip().lstrip("#")
    if len(value) != 6:
        return (1.0, 1.0, 1.0)
    try:
        return tuple(int(value[i:i + 2], 16) / 255.0 for i in (0, 2, 4))  # type: ignore[return-value]
    except ValueError:
        return (1.0, 1.0, 1.0)


def _new_id() -> str:
    return str(uuid.uuid4()).upper()


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


def _timelines_copy(draft_dir: Path, content_id: str) -> Path | None:
    """캡컷 편집기가 함께 읽는 Timelines 사본 경로 (없으면 None)."""
    if not content_id:
        return None
    p = draft_dir / "Timelines" / content_id / "draft_content.json"
    return p if p.is_file() else None


def _system_font_path(data: dict) -> str:
    """캡컷 기본 폰트 경로를 찾는다.

    실측상 캡컷 자막 소재는 설치 폴더의 SystemFont ttf 절대경로를 담는다.
    1) 프로젝트 안 기존 텍스트 소재의 font_path 재사용 (가장 확실)
    2) 설치된 캡컷 Apps/<버전>/Resources/Font/SystemFont 에서 탐색
    3) 못 찾으면 빈 문자열 (캡컷이 기본 폰트로 대체)
    """
    for m in (data.get("materials") or {}).get("texts") or []:
        path = m.get("font_path") or ""
        if path and os.path.isfile(path):
            return path

    local = os.environ.get("LOCALAPPDATA", "")
    if local:
        for app in ("CapCut", "JianyingPro"):  # 국제판 / 중국판(剪映)
            apps = Path(local) / app / "Apps"
            candidates = sorted(apps.glob("*/Resources/Font/SystemFont/en.ttf"))
            if not candidates:
                candidates = sorted(apps.glob("*/Resources/Font/SystemFont/*.ttf"))
            if candidates:
                return str(candidates[-1]).replace("\\", "/")
    return ""


def _style_entry(text_len: int, style: SubtitleStyle, font_path: str,
                 start: int, end: int, color: Color) -> dict:
    entry: dict = {
        "fill": {
            "content": {
                "render_type": "solid",
                "solid": {"color": list(color)},
            }
        },
        "font": {"path": font_path, "id": ""},
        "size": style.size,
        "range": [max(0, min(text_len, start)), max(0, min(text_len, end))],
    }
    if style.bold:
        entry["bold"] = True
    if style.border:
        entry["strokes"] = [{
            "content": {"solid": {"color": list(style.border_color)}},
            "width": 0.08,
        }]
    return entry


def _normalize_color_spans(text: str, spans: list[dict] | None) -> list[dict]:
    out: list[dict] = []
    used_end = 0
    text_len = len(text)
    for s in sorted(spans or [], key=lambda x: (x.get("start", 0), x.get("end", 0))):
        try:
            start = int(s.get("start", -1))
            end = int(s.get("end", -1))
        except (AttributeError, TypeError, ValueError):
            continue
        if start < used_end or start < 0 or end <= start or end > text_len:
            continue
        out.append({"start": start, "end": end, "color": str(s.get("color") or "")})
        used_end = end
    return out


def _build_content(text: str, style: SubtitleStyle, font_path: str,
                   spans: list[dict] | None = None) -> str:
    """소재의 content 필드(JSON 문자열)를 실측 구조로 생성."""
    text_len = len(text)
    color_spans = _normalize_color_spans(text, spans)
    if not color_spans:
        entry = _style_entry(text_len, style, font_path, 0, text_len, style.color)
        return json.dumps({"text": text, "styles": [entry]}, ensure_ascii=False)

    styles: list[dict] = []
    cursor = 0
    for span in color_spans:
        start, end = span["start"], span["end"]
        if cursor < start:
            styles.append(_style_entry(text_len, style, font_path,
                                       cursor, start, style.color))
        styles.append(_style_entry(text_len, style, font_path,
                                   start, end, _rgb_hex(span["color"])))
        cursor = end
    if cursor < text_len:
        styles.append(_style_entry(text_len, style, font_path,
                                   cursor, text_len, style.color))
    return json.dumps({"text": text, "styles": styles}, ensure_ascii=False)


def _remove_previous_track(data: dict) -> None:
    """이전에 삽입한 'AI 자막' / 'AI 자막(번역)' 트랙과 관련 소재를 제거."""
    tracks = data.get("tracks") or []
    targets = [t for t in tracks
               if t.get("type") == "text" and t.get("name") in TRACK_NAMES]
    if not targets:
        return

    dead_ids: set[str] = set()
    for t in targets:
        for seg in t.get("segments") or []:
            dead_ids.add(seg.get("material_id", ""))
            dead_ids.update(seg.get("extra_material_refs") or [])

    data["tracks"] = [t for t in tracks if t not in targets]
    mats = data.get("materials") or {}
    for kind in ("texts", "material_animations"):
        if kind in mats and mats[kind]:
            mats[kind] = [m for m in mats[kind] if m.get("id") not in dead_ids]


def _build_track(data: dict, lines: list[SubtitleLine],
                 style: SubtitleStyle, *, track_name: str = TRACK_NAME,
                 y_offset: float = 0.0) -> dict:
    """자막 라인들로 텍스트 트랙을 만들고 소재를 등록한다."""
    mats = data.setdefault("materials", {})
    texts = mats.setdefault("texts", [])
    anims = mats.setdefault("material_animations", [])

    font_path = _system_font_path(data)
    text_track_count = sum(1 for t in data.get("tracks") or []
                           if t.get("type") == "text")
    canvas_w, canvas_h = _canvas_size(data)
    tx, ty = _resolve_transform(style, canvas_w, canvas_h)
    ty = max(-1.0, min(1.0, ty + y_offset))

    track = copy.deepcopy(TRACK_TPL)
    track["id"] = _new_id()
    track["name"] = track_name
    if style.as_caption:
        # 캡컷 '자동 캡션'과 동일한 캡션 트랙: 소재 type을 subtitle로,
        # 트랙 flag를 1로 설정하면 캡컷이 자막(캡션) 트랙으로 취급해
        # 캡션 패널에서 일괄 편집·스타일 변경이 가능하다.
        track["flag"] = 1

    for line in lines:
        mat = copy.deepcopy(MATERIAL_TPL)
        mat["id"] = _new_id()
        if style.as_caption:
            mat["type"] = "subtitle"
        mat["content"] = _build_content(line.text, style, font_path,
                                        getattr(line, "spans", None))
        mat["font_path"] = font_path
        mat["font_size"] = style.size
        mat["text_size"] = round(style.size * 2)
        mat["text_color"] = _hex(style.color)
        mat["border_width"] = 0.08 if style.border else 0.0
        # 캡컷 check_flag: 7 기본 | 8 외곽선 | 16 배경 | 32 그림자
        check_flag = 7
        if style.border:
            check_flag |= 8
            mat["border_color"] = _hex(style.border_color)
        if style.bold:
            mat["bold_width"] = 0.008
        if style.shadow:
            check_flag |= 32
            mat["has_shadow"] = True
            mat["shadow_color"] = _hex(style.shadow_color)
            mat["shadow_alpha"] = style.shadow_alpha
        if style.bg:
            check_flag |= 16
            mat["background_style"] = 1
            mat["background_color"] = _hex(style.bg_color)
            mat["background_alpha"] = style.bg_alpha
            mat["background_round_radius"] = style.bg_round_radius
            mat["background_width"] = style.bg_width
            # 높이 0이면 캡컷이 박스를 그리지 않음
            mat["background_height"] = (
                style.bg_height if style.bg_height > 0 else 0.14)
        mat["check_flag"] = check_flag

        anim = copy.deepcopy(ANIMATION_TPL)
        anim["id"] = _new_id()

        seg = copy.deepcopy(SEGMENT_TPL)
        seg["id"] = _new_id()
        seg["material_id"] = mat["id"]
        seg["extra_material_refs"] = [anim["id"]]
        seg["target_timerange"] = {
            "start": line.start_us,
            "duration": max(1, line.end_us - line.start_us),
        }
        seg["clip"]["transform"]["x"] = tx
        seg["clip"]["transform"]["y"] = ty
        seg["track_render_index"] = text_track_count + 1

        texts.append(mat)
        anims.append(anim)
        track["segments"].append(seg)

    return track


def inject_subtitles(
    draft_dir: Path,
    lines: list[SubtitleLine],
    style: SubtitleStyle | None = None,
    *,
    translated_lines: list[SubtitleLine] | None = None,
    inject_mode: str = "original",
) -> Path:
    """자막 라인을 캡컷 프로젝트에 삽입. 백업 파일 경로를 반환.

    inject_mode: original | translated | both
    """
    style = style or SubtitleStyle()
    mode = (inject_mode or "original").strip().lower()
    if mode not in ("original", "translated", "both"):
        mode = "original"
    content_path = draft_dir / "draft_content.json"
    if not content_path.is_file():
        raise FileNotFoundError(f"draft_content.json이 없습니다: {draft_dir}")

    backup = backup_draft(draft_dir)
    data = json.loads(content_path.read_text(encoding="utf-8"))
    timeline_path = _timelines_copy(draft_dir, data.get("id", ""))
    timeline_backup = None
    if timeline_path is not None:
        timeline_backup = timeline_path.with_name(
            f"draft_content.aisub_backup_{time.strftime('%Y%m%d_%H%M%S')}.json")
        shutil.copy2(timeline_path, timeline_backup)

    try:
        _remove_previous_track(data)
        all_lines: list[SubtitleLine] = []
        if mode in ("original", "both") and lines:
            data.setdefault("tracks", []).append(
                _build_track(data, lines, style, track_name=TRACK_NAME))
            all_lines.extend(lines)
        if mode in ("translated", "both") and translated_lines:
            y_off = TRANSLATED_Y_OFFSET if mode == "both" else 0.0
            data.setdefault("tracks", []).append(
                _build_track(
                    data, translated_lines, style,
                    track_name=TRACK_NAME_TRANSLATED,
                    y_offset=y_off,
                ))
            all_lines.extend(translated_lines)
        if not all_lines:
            raise ValueError("삽입할 자막이 없습니다.")
        data["duration"] = max(int(data.get("duration", 0)),
                               max(l.end_us for l in all_lines))

        serialized = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        content_path.write_text(serialized, encoding="utf-8")
        if timeline_path is not None:
            timeline_path.write_text(serialized, encoding="utf-8")
    except Exception:
        shutil.copy2(backup, content_path)  # 실패 시 원상 복구
        if timeline_backup is not None:
            shutil.copy2(timeline_backup, timeline_path)
        raise
    return backup
