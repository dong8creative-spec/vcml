"""캡컷 프로젝트(draft) 탐색 및 타임라인 오디오 재구성.

캡컷 draft_content.json의 트랙/세그먼트를 분석하여, 프로젝트 타임라인과
동일한 16kHz 모노 오디오 버퍼를 만들어 Whisper 인식에 사용한다.
복합 클립(subdraft)은 materials.drafts에 내장된 draft를 재귀 처리한다.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

US = 1_000_000  # microseconds per second
SR = 16000      # whisper sampling rate

_PLACEHOLDER_RE = re.compile(r"##_draftpath_placeholder_[^#]*_##")


# ---------------------------------------------------------------- discovery

def find_draft_roots() -> list[Path]:
    """캡컷(및 剪映) 프로젝트 폴더 후보를 반환."""
    local = os.environ.get("LOCALAPPDATA", "")
    candidates = [
        Path(local) / "CapCut" / "User Data" / "Projects" / "com.lveditor.draft",
        Path(local) / "JianyingPro" / "User Data" / "Projects" / "com.lveditor.draft",
    ]
    return [p for p in candidates if p.is_dir()]


@dataclass
class Project:
    name: str
    dir: Path
    mtime: float
    duration_us: int = 0

    @property
    def content_path(self) -> Path:
        return self.dir / "draft_content.json"

    @property
    def duration_str(self) -> str:
        s = self.duration_us / US
        return f"{int(s // 60)}:{s % 60:04.1f}"


def list_projects() -> list[Project]:
    """draft_content.json이 있는 캡컷 프로젝트를 최근 수정순으로 나열."""
    projects: list[Project] = []
    for root in find_draft_roots():
        for d in root.iterdir():
            content = d / "draft_content.json"
            if not (d.is_dir() and content.is_file()):
                continue
            duration = 0
            try:
                with open(content, encoding="utf-8") as f:
                    duration = int(json.load(f).get("duration", 0))
            except (OSError, ValueError):
                pass
            projects.append(Project(d.name, d, content.stat().st_mtime, duration))
    projects.sort(key=lambda p: p.mtime, reverse=True)
    return projects


def is_capcut_running() -> bool:
    try:
        out = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq CapCut.exe", "/FO", "CSV", "/NH"],
            capture_output=True, text=True, timeout=10,
            creationflags=subprocess.CREATE_NO_WINDOW,
        ).stdout
        return "CapCut.exe" in out
    except OSError:
        return False


# ------------------------------------------------------- audio construction

@dataclass
class AudioBuildResult:
    audio: np.ndarray            # float32 mono 16kHz, 타임라인과 동일 길이
    duration_us: int
    missing_files: list[str] = field(default_factory=list)
    used_files: list[str] = field(default_factory=list)


class _Decoder:
    """미디어 파일 → 16kHz 모노 float32. 파일별 캐시."""

    def __init__(self) -> None:
        self._cache: dict[str, np.ndarray | None] = {}

    def decode(self, path: str) -> np.ndarray | None:
        if path not in self._cache:
            try:
                from faster_whisper.audio import decode_audio
                self._cache[path] = decode_audio(path, sampling_rate=SR)
            except Exception:
                self._cache[path] = None
        return self._cache[path]


def _resolve_path(raw: str, draft_dir: Path) -> str:
    """draft 상대경로 placeholder를 실제 경로로 치환."""
    if not raw:
        return ""
    p = _PLACEHOLDER_RE.sub(str(draft_dir).replace("\\", "/"), raw)
    if p.startswith("./") or p.startswith("../"):
        p = str((draft_dir / p).resolve())
    return p


def _mix_into(buf: np.ndarray, start_us: int, samples: np.ndarray) -> None:
    start = int(start_us * SR / US)
    if start >= len(buf) or len(samples) == 0:
        return
    end = min(start + len(samples), len(buf))
    buf[start:end] += samples[: end - start]


def _apply_speed(samples: np.ndarray, speed: float, target_us: int) -> np.ndarray:
    """재생 속도를 반영해 target 길이에 맞게 리샘플."""
    n_target = int(target_us * SR / US)
    if len(samples) == 0 or n_target <= 0:
        return np.zeros(0, dtype=np.float32)
    if abs(speed - 1.0) < 1e-6 and abs(len(samples) - n_target) < SR // 10:
        return samples[:n_target]
    idx = np.linspace(0, len(samples) - 1, n_target)
    return np.interp(idx, np.arange(len(samples)), samples).astype(np.float32)


def _materials_by_id(draft: dict) -> dict[str, dict]:
    out: dict[str, dict] = {}
    mats = draft.get("materials") or {}
    for kind in ("videos", "audios", "drafts"):
        for m in mats.get(kind) or []:
            m["_kind"] = kind
            out[m["id"]] = m
    return out


def _render_draft_audio(draft: dict, draft_dir: Path, decoder: _Decoder,
                        result: AudioBuildResult) -> np.ndarray:
    """draft(또는 내장 subdraft) 타임라인 전체의 오디오 버퍼 생성."""
    duration_us = int(draft.get("duration", 0))
    buf = np.zeros(int(duration_us * SR / US) + 1, dtype=np.float32)
    mats = _materials_by_id(draft)

    for track in draft.get("tracks") or []:
        if track.get("type") not in ("video", "audio"):
            continue
        if track.get("attribute") == 1:  # 음소거 트랙
            continue
        for seg in track.get("segments") or []:
            mat = mats.get(seg.get("material_id", ""))
            if mat is None or mat.get("type") == "photo":
                continue
            volume = float(seg.get("volume", 1.0))
            if volume <= 0:
                continue
            src = seg.get("source_timerange") or {}
            tgt = seg.get("target_timerange") or {}
            src_start, src_dur = int(src.get("start", 0)), int(src.get("duration", 0))
            tgt_start, tgt_dur = int(tgt.get("start", 0)), int(tgt.get("duration", 0))
            if src_dur <= 0 or tgt_dur <= 0:
                continue
            speed = float(seg.get("speed", 1.0)) or 1.0

            source_audio = _segment_source_audio(
                seg, mat, mats, draft_dir, decoder, result)
            if source_audio is None:
                continue
            a, b = int(src_start * SR / US), int((src_start + src_dur) * SR / US)
            piece = source_audio[a:b]
            piece = _apply_speed(piece, speed, tgt_dur)
            if volume != 1.0:
                piece = piece * min(volume, 2.0)
            _mix_into(buf, tgt_start, piece)
    return buf


def _segment_source_audio(seg: dict, mat: dict, mats: dict[str, dict],
                          draft_dir: Path, decoder: _Decoder,
                          result: AudioBuildResult) -> np.ndarray | None:
    """세그먼트의 소스(파일 또는 내장 subdraft) 오디오 전체를 반환."""
    path = _resolve_path(mat.get("path", ""), draft_dir)
    if path:
        if not os.path.isfile(path):
            if path not in result.missing_files:
                result.missing_files.append(path)
            return None
        audio = decoder.decode(path)
        if audio is None:
            if path not in result.missing_files:
                result.missing_files.append(path)
        elif path not in result.used_files:
            result.used_files.append(path)
        return audio

    # 경로가 없으면 복합 클립: extra_material_refs에서 내장 draft를 찾는다
    for ref in seg.get("extra_material_refs") or []:
        ref_mat = mats.get(ref)
        if ref_mat and ref_mat.get("_kind") == "drafts" and ref_mat.get("draft"):
            return _render_draft_audio(ref_mat["draft"], draft_dir, decoder, result)
    return None


def build_timeline_audio(project: Project) -> AudioBuildResult:
    """프로젝트 타임라인과 동일한 오디오 버퍼를 만든다."""
    with open(project.content_path, encoding="utf-8") as f:
        draft = json.load(f)
    result = AudioBuildResult(audio=np.zeros(0, dtype=np.float32),
                              duration_us=int(draft.get("duration", 0)))
    decoder = _Decoder()
    buf = _render_draft_audio(draft, project.dir, decoder, result)
    peak = float(np.max(np.abs(buf))) if len(buf) else 0.0
    if peak > 1.0:
        buf /= peak
    result.audio = buf
    return result
