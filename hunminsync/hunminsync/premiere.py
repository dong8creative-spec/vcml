"""Read Premiere Pro projects and reconstruct sequence audio.

Premiere project files are gzip-compressed XML object graphs.  This module is
intentionally read-only: it follows the subset of the graph needed for normal
audio track items and never modifies the user's project.
"""

from __future__ import annotations

import gzip
import json
import os
import re
import urllib.parse
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

SAMPLE_RATE = 16_000
US = 1_000_000
TICKS_PER_SECOND = 254_016_000_000
PROJECT_EXTENSION = ".prproj"


def _tag(element: ET.Element) -> str:
    return element.tag.rsplit("}", 1)[-1]


def _children(element: ET.Element | None, name: str) -> list[ET.Element]:
    if element is None:
        return []
    return [child for child in element if _tag(child) == name]


def _child(element: ET.Element | None, name: str) -> ET.Element | None:
    if element is None:
        return None
    return next((child for child in element if _tag(child) == name), None)


def _path(element: ET.Element | None, *names: str) -> ET.Element | None:
    current = element
    for name in names:
        current = _child(current, name)
        if current is None:
            return None
    return current


def _text(element: ET.Element | None, *names: str, default: str = "") -> str:
    node = _path(element, *names) if names else element
    return (node.text or "").strip() if node is not None else default


def _integer(element: ET.Element | None, *names: str, default: int = 0) -> int:
    try:
        return int(_text(element, *names, default=str(default)))
    except (TypeError, ValueError):
        return default


def _reference(element: ET.Element | None) -> str:
    if element is None:
        return ""
    return (
        element.get("ObjectRef")
        or element.get("ObjectURef")
        or element.get("ObjectUID")
        or ""
    )


def ticks_to_us(value: int) -> int:
    return round(value * US / TICKS_PER_SECOND)


def _time_to_us(value: int) -> int:
    """Convert Premiere's canonical 254,016,000,000 ticks/second to microseconds."""
    return ticks_to_us(value)


def read_project_xml(path: str | Path) -> bytes:
    project_path = validate_project_path(path)
    raw = project_path.read_bytes()
    try:
        return gzip.decompress(raw)
    except (gzip.BadGzipFile, EOFError, OSError):
        if raw.lstrip().startswith(b"<?xml") or raw.lstrip().startswith(b"<PremiereData"):
            return raw
        raise ValueError("프리미어 프로젝트를 열 수 없어요. 손상되었거나 지원하지 않는 형식이에요.")


def validate_project_path(path: str | Path) -> Path:
    project_path = Path(path).expanduser().resolve()
    if not project_path.is_file():
        raise FileNotFoundError(f"프리미어 프로젝트를 찾을 수 없어요: {project_path}")
    if project_path.suffix.lower() != PROJECT_EXTENSION:
        raise ValueError("`.prproj` 프리미어 프로젝트 파일을 선택해 주세요.")
    return project_path


def _decode_file_path(raw: str, project_dir: Path) -> Path | None:
    value = (raw or "").strip().strip('"')
    if not value or value.isdigit():
        return None
    if value.lower().startswith("file:"):
        parsed = urllib.parse.urlparse(value)
        value = urllib.parse.unquote(parsed.path)
        if parsed.netloc and parsed.netloc not in ("", "localhost"):
            value = f"//{parsed.netloc}{value}"
        if os.name == "nt" and re.match(r"^/[A-Za-z]:/", value):
            value = value[1:]
    value = urllib.parse.unquote(value)
    value = value.replace("\\", os.sep)
    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        candidate = project_dir / candidate
    return candidate.resolve(strict=False)


@dataclass
class ClipInfo:
    id: str
    media_path: Path | None
    timeline_start_us: int
    timeline_end_us: int
    source_in_us: int
    source_out_us: int
    speed: float = 1.0
    muted: bool = False
    track_index: int = 0

    @property
    def duration_us(self) -> int:
        return max(0, self.timeline_end_us - self.timeline_start_us)


@dataclass
class SequenceInfo:
    id: str
    name: str
    duration_us: int
    clips: list[ClipInfo] = field(default_factory=list, repr=False)
    warnings: list[str] = field(default_factory=list, repr=False)

    @property
    def duration_str(self) -> str:
        seconds = self.duration_us / US
        return f"{int(seconds // 60)}:{seconds % 60:05.2f}"


@dataclass
class Project:
    name: str
    path: Path
    mtime: float
    sequences: list[SequenceInfo] = field(default_factory=list)


@dataclass
class AudioBuildResult:
    audio: np.ndarray
    duration_us: int
    missing_files: list[str] = field(default_factory=list)
    used_files: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


class _Graph:
    def __init__(self, root: ET.Element, project_dir: Path) -> None:
        self.root = root
        self.project_dir = project_dir
        self.by_id: dict[str, ET.Element] = {}
        self.by_uid: dict[str, ET.Element] = {}
        self.by_tag: dict[str, list[ET.Element]] = {}
        for element in root.iter():
            self.by_tag.setdefault(_tag(element), []).append(element)
            object_id = element.get("ObjectID")
            object_uid = element.get("ObjectUID")
            if object_id:
                self.by_id[object_id] = element
            if object_uid:
                self.by_uid[object_uid] = element

    def object(self, reference: str) -> ET.Element | None:
        found = self.by_id.get(reference)
        return found if found is not None else self.by_uid.get(reference)

    def objects(self, name: str) -> list[ET.Element]:
        return self.by_tag.get(name, [])

    def media_path_for_subclip(self, subclip: ET.Element | None) -> Path | None:
        master_ref = _reference(_child(subclip, "MasterClip"))
        clip_ref = _reference(_child(subclip, "Clip"))
        master = self.object(master_ref)
        if master is not None:
            clips = _path(master, "Clips")
            first_clip = _child(clips, "Clip")
            clip_ref = clip_ref or _reference(first_clip)
        clip = self.object(clip_ref)
        source_ref = _reference(_path(clip, "Clip", "Source"))
        source = self.object(source_ref)
        media_ref = _reference(_path(source, "MediaSource", "Media"))
        media = self.object(media_ref)
        raw = _text(media, "FilePath")
        if not raw and media is not None:
            raw = _text(media, "Media", "FilePath")
        return _decode_file_path(raw, self.project_dir)


def _sequence_elements(graph: _Graph) -> list[ET.Element]:
    return [
        element
        for element in graph.objects("Sequence")
        if element.get("ObjectUID") and _child(element, "TrackGroups") is not None
    ]


def _sequence_tracks(graph: _Graph, sequence: ET.Element) -> list[ET.Element]:
    tracks: list[ET.Element] = []
    groups = _child(sequence, "TrackGroups")
    for group_entry in _children(groups, "TrackGroup"):
        group_ref = _reference(_path(group_entry, "Second"))
        group = graph.object(group_ref)
        if group is None or _tag(group) != "AudioTrackGroup":
            continue
        track_list = _path(group, "TrackGroup", "Tracks")
        for track_ref_node in _children(track_list, "Track"):
            track = graph.object(_reference(track_ref_node))
            if track is not None and _tag(track) == "AudioClipTrack":
                muted = (
                    _text(track, "ClipTrack", "Track", "IsMuted")
                    or _text(track, "ClipTrack", "IsMuted")
                ).lower()
                if muted in ("true", "1"):
                    continue
                tracks.append(track)
    return tracks


def _parse_track_item(
    graph: _Graph, item: ET.Element, track_index: int
) -> ClipInfo | None:
    base = _child(item, "ClipTrackItem")
    track_item = _child(base, "TrackItem")
    start = _integer(track_item, "Start")
    end = _integer(track_item, "End")
    if end <= start:
        return None
    muted_text = _text(base, "IsMuted").lower()
    subclip = graph.object(_reference(_child(base, "SubClip")))
    clip = graph.object(_reference(_child(subclip, "Clip")))
    clip_base = _child(clip, "Clip")
    source_in = _integer(clip_base, "InPoint")
    source_out = _integer(clip_base, "OutPoint")
    speed_text = _text(clip_base, "PlaybackSpeed", default="1")
    try:
        speed = float(speed_text)
    except ValueError:
        speed = 1.0
    if speed == 0:
        speed = 1.0
    if _text(clip_base, "PlayBackwards").lower() == "true":
        speed = -abs(speed)
    start_us, end_us = _time_to_us(start), _time_to_us(end)
    source_in_us, source_out_us = _time_to_us(source_in), _time_to_us(source_out)
    if source_out_us <= source_in_us:
        source_out_us = source_in_us + (end_us - start_us)
    return ClipInfo(
        id=item.get("ObjectID") or item.get("ObjectUID") or "",
        media_path=graph.media_path_for_subclip(subclip),
        timeline_start_us=start_us,
        timeline_end_us=end_us,
        source_in_us=max(0, source_in_us),
        source_out_us=max(0, source_out_us),
        speed=speed,
        muted=muted_text in ("true", "1"),
        track_index=track_index,
    )


def parse_project(path: str | Path) -> Project:
    project_path = validate_project_path(path)
    try:
        root = ET.fromstring(read_project_xml(project_path))
    except ET.ParseError as exc:
        raise ValueError(f"프리미어 프로젝트 XML을 읽지 못했어요: {exc}") from exc
    graph = _Graph(root, project_path.parent)
    sequences: list[SequenceInfo] = []
    for sequence_number, element in enumerate(_sequence_elements(graph), start=1):
        clips: list[ClipInfo] = []
        warnings: list[str] = []
        for track_index, track in enumerate(_sequence_tracks(graph, element)):
            clip_items = _path(track, "ClipTrack", "ClipItems", "TrackItems")
            for item_ref in _children(clip_items, "TrackItem"):
                item = graph.object(_reference(item_ref))
                if item is None or _tag(item) != "AudioClipTrackItem":
                    continue
                parsed = _parse_track_item(graph, item, track_index)
                if parsed is not None and not parsed.muted:
                    clips.append(parsed)
        duration = max((clip.timeline_end_us for clip in clips), default=0)
        name = _text(element, "Name", default=f"시퀀스 {sequence_number}")
        if not clips:
            warnings.append("지원되는 일반 오디오 클립을 찾지 못했어요.")
        sequences.append(
            SequenceInfo(
                id=element.get("ObjectUID") or element.get("ObjectID") or str(sequence_number),
                name=name or f"시퀀스 {sequence_number}",
                duration_us=duration,
                clips=clips,
                warnings=warnings,
            )
        )
    return Project(
        name=project_path.stem,
        path=project_path,
        mtime=project_path.stat().st_mtime,
        sequences=sequences,
    )


def _settings_path() -> Path:
    from . import license as license_api

    return license_api.app_data_dir() / "settings.json"


def manual_project_roots() -> list[Path]:
    try:
        data = json.loads(_settings_path().read_text(encoding="utf-8"))
        return [Path(value) for value in data.get("project_roots", []) if value]
    except (OSError, ValueError, json.JSONDecodeError):
        return []


def add_manual_project_root(path: str | Path) -> Path:
    root = Path(path).expanduser().resolve()
    if root.is_file():
        root = root.parent
    if not root.is_dir():
        raise FileNotFoundError(f"프로젝트 폴더를 찾을 수 없어요: {root}")
    settings_path = _settings_path()
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        settings = json.loads(settings_path.read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError):
        settings = {}
    roots = [str(root)] + [str(item) for item in manual_project_roots() if item != root]
    settings["project_roots"] = roots[:5]
    settings_path.write_text(json.dumps(settings, ensure_ascii=False, indent=2), encoding="utf-8")
    return root


def default_project_roots() -> list[Path]:
    home = Path.home()
    candidates = [home / "Documents" / "Adobe" / "Premiere Pro"]
    if os.name == "nt":
        documents = Path(os.environ.get("USERPROFILE", str(home))) / "Documents"
        candidates.append(documents / "Adobe" / "Premiere Pro")
    candidates.extend(manual_project_roots())
    seen: set[str] = set()
    result: list[Path] = []
    for candidate in candidates:
        key = os.path.normcase(str(candidate.resolve(strict=False)))
        if key not in seen and candidate.is_dir():
            seen.add(key)
            result.append(candidate)
    return result


def list_projects(limit: int = 50) -> list[Project]:
    paths: dict[str, Path] = {}
    for root in default_project_roots():
        try:
            for path in root.rglob(f"*{PROJECT_EXTENSION}"):
                if path.is_file():
                    paths[os.path.normcase(str(path.resolve()))] = path
        except OSError:
            continue
    projects = [
        Project(path.stem, path.resolve(), path.stat().st_mtime)
        for path in paths.values()
    ]
    projects.sort(key=lambda project: project.mtime, reverse=True)
    return projects[:limit]


class _Decoder:
    def __init__(self) -> None:
        self.cache: dict[str, np.ndarray | None] = {}

    def decode(self, path: Path) -> np.ndarray | None:
        key = os.path.normcase(str(path))
        if key not in self.cache:
            try:
                from faster_whisper.audio import decode_audio

                audio = decode_audio(str(path), sampling_rate=SAMPLE_RATE)
                self.cache[key] = np.asarray(audio, dtype=np.float32)
            except Exception:
                self.cache[key] = None
        return self.cache[key]


def _fit_duration(samples: np.ndarray, target_samples: int, reverse: bool) -> np.ndarray:
    if reverse:
        samples = samples[::-1]
    if target_samples <= 0 or len(samples) == 0:
        return np.zeros(0, dtype=np.float32)
    if len(samples) == target_samples:
        return samples
    positions = np.linspace(0, len(samples) - 1, target_samples)
    return np.interp(positions, np.arange(len(samples)), samples).astype(np.float32)


def build_sequence_audio(project: Project, sequence: SequenceInfo) -> AudioBuildResult:
    if sequence.duration_us <= 0:
        raise RuntimeError("선택한 시퀀스에 지원되는 오디오 클립이 없어요.")
    result = AudioBuildResult(
        audio=np.zeros(round(sequence.duration_us * SAMPLE_RATE / US) + 1, dtype=np.float32),
        duration_us=sequence.duration_us,
        warnings=list(sequence.warnings),
    )
    decoder = _Decoder()
    for clip in sequence.clips:
        if clip.media_path is None or not clip.media_path.is_file():
            missing = str(clip.media_path) if clip.media_path else f"클립 {clip.id} (경로 없음)"
            if missing not in result.missing_files:
                result.missing_files.append(missing)
            continue
        source = decoder.decode(clip.media_path)
        if source is None:
            missing = str(clip.media_path)
            if missing not in result.missing_files:
                result.missing_files.append(missing)
            continue
        source_start = max(0, round(clip.source_in_us * SAMPLE_RATE / US))
        source_end = min(len(source), round(clip.source_out_us * SAMPLE_RATE / US))
        if source_end <= source_start:
            continue
        target_length = round(clip.duration_us * SAMPLE_RATE / US)
        samples = _fit_duration(source[source_start:source_end], target_length, clip.speed < 0)
        timeline_start = round(clip.timeline_start_us * SAMPLE_RATE / US)
        source_offset = max(0, -timeline_start)
        destination_start = max(0, timeline_start)
        destination_end = min(len(result.audio), destination_start + len(samples) - source_offset)
        if destination_end > destination_start:
            result.audio[destination_start:destination_end] += samples[
                source_offset:source_offset + destination_end - destination_start
            ]
            path_text = str(clip.media_path)
            if path_text not in result.used_files:
                result.used_files.append(path_text)
    peak = float(np.max(np.abs(result.audio))) if len(result.audio) else 0.0
    if peak > 1.0:
        result.audio /= peak
    if not result.used_files:
        raise RuntimeError("시퀀스에서 읽을 수 있는 온라인 오디오 파일을 찾지 못했어요.")
    return result
