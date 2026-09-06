"""캡컷 프로젝트(draft) 탐색 및 타임라인 오디오 재구성.

캡컷 draft_content.json의 트랙/세그먼트를 분석하여, 프로젝트 타임라인과
동일한 16kHz 모노 오디오 버퍼를 만들어 Whisper 인식에 사용한다.
복합 클립(subdraft)은 materials.drafts에 내장된 draft를 재귀 처리한다.
"""

from __future__ import annotations

import json
import math
import os
import re
import subprocess
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np


def _new_id() -> str:
    """캡컷 세그먼트/소재 id 형식(대문자 UUID)."""
    return str(uuid.uuid4()).upper()

US = 1_000_000  # microseconds per second
SR = 16000      # whisper sampling rate

_PLACEHOLDER_RE = re.compile(r"##_draftpath_placeholder_[^#]*_##")


# ---------------------------------------------------------------- discovery

_APP_NAMES = ("CapCut", "JianyingPro")  # 국제판 / 중국판(剪映)


def _custom_draft_paths() -> list[Path]:
    """캡컷 설정(globalSetting)에 저장된 사용자 지정 초안 위치를 읽는다.

    캡컷에서 '초안 위치'를 다른 드라이브 등으로 변경하면
    User Data\\Config\\globalSetting 의 currentCustomDraftPath에 기록된다.
    (값은 C:\\\\Users\\\\... 처럼 백슬래시가 이스케이프된 ini 형식)
    """
    local = os.environ.get("LOCALAPPDATA", "")
    paths: list[Path] = []
    if not local:
        return paths
    for app in _APP_NAMES:
        gs = Path(local) / app / "User Data" / "Config" / "globalSetting"
        if not gs.is_file():
            continue
        try:
            text = gs.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for line in text.splitlines():
            if line.startswith("currentCustomDraftPath="):
                raw = line.split("=", 1)[1].strip().replace("\\\\", "\\")
                if raw:
                    paths.append(Path(raw))
    return paths


def _app_data_dir() -> Path:
    base = os.environ.get("APPDATA") or str(Path.home() / ".config")
    folder = Path(base) / "TadakSync3"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def _settings_path() -> Path:
    return _app_data_dir() / "settings.json"


def manual_draft_roots() -> list[Path]:
    """사용자가 프로그램에서 직접 지정한 초안 폴더 목록."""
    try:
        data = json.loads(_settings_path().read_text(encoding="utf-8"))
        return [Path(p) for p in data.get("draft_roots", []) if p]
    except (OSError, json.JSONDecodeError, ValueError):
        return []


def add_manual_draft_root(path: Path) -> Path:
    """초안 폴더를 수동 등록. 프로젝트 폴더를 고르면 그 부모를 등록한다."""
    path = Path(path)
    if (path / "draft_content.json").is_file():
        path = path.parent
    roots = [str(path)] + [str(p) for p in manual_draft_roots() if Path(p) != path]
    settings = {}
    try:
        settings = json.loads(_settings_path().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, ValueError):
        pass
    settings["draft_roots"] = roots[:5]  # 최근 5개만 유지
    _settings_path().write_text(
        json.dumps(settings, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def find_draft_roots() -> list[Path]:
    """캡컷 초안 폴더 후보를 모든 방법으로 수집 (중복 제거, 존재하는 것만).

    ① 캡컷 설정의 사용자 지정 초안 위치 (초안 위치를 옮긴 경우)
    ② 기본 설치 경로 (국제판 CapCut / 중국판 JianyingPro)
    ③ Microsoft Store 패키지 설치 경로
    ④ 프로그램에서 직접 지정한 폴더
    """
    local = os.environ.get("LOCALAPPDATA", "")
    candidates: list[Path] = []
    candidates += _custom_draft_paths()
    if local:
        for app in _APP_NAMES:
            candidates.append(
                Path(local) / app / "User Data" / "Projects" / "com.lveditor.draft")
        packages = Path(local) / "Packages"
        if packages.is_dir():
            for pattern in ("*CapCut*", "*Jianying*"):
                for pkg in packages.glob(pattern):
                    candidates += pkg.glob(
                        "LocalCache/Local/*/User Data/Projects/com.lveditor.draft")
    candidates += manual_draft_roots()

    seen: set[str] = set()
    roots: list[Path] = []
    for p in candidates:
        try:
            key = str(p.resolve()).lower()
        except OSError:
            key = str(p).lower()
        if key in seen:
            continue
        seen.add(key)
        if p.is_dir():
            roots.append(p)
    return roots


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
        return f"{int(s // 60)}:{s % 60:05.2f}"


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
    """캡컷(국제판) 또는 剪映(중국판) 편집기가 실행 중인지."""
    try:
        out = subprocess.run(
            ["tasklist", "/FO", "CSV", "/NH"],
            capture_output=True, text=True, timeout=10,
            creationflags=subprocess.CREATE_NO_WINDOW,
        ).stdout
        return "CapCut.exe" in out or "JianyingPro.exe" in out
    except Exception:
        # tasklist가 없거나(OSError), 타임아웃(TimeoutExpired) 등 어떤 이유로든
        # 확인에 실패하면 목록 자체는 계속 보여줘야 하므로 조용히 False 처리.
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


# ------------------------------------------------------- ripple delete (v3)
#
# 자막 블록을 지울 때 그 [start, end) 구간을 타임라인에서 통째로 잘라내고
# 뒤쪽 세그먼트를 잘린 길이만큼 앞으로 당긴다(리플 삭제). 모든 트랙
# (영상·오디오·자막·효과·필터·조정 등)에 동일하게 적용해 싱크를 유지한다.
#
# 한계(문서화): 세그먼트 경계에 걸친 클립은 target/source_timerange를 잘라
# 붙이고, 잘려나간 구간에 있던 키프레임은 버린다. 트랜지션(겹침 전환)·복합
# 클립 내부 타임라인·마스크 애니메이션까지 완벽히 재계산하지는 않는다.


def merge_ranges(ranges: list[tuple[int, int]],
                 gap: int = 0) -> list[tuple[int, int]]:
    """(start, end) 구간들을 정렬·병합. gap 이하로 붙은 구간은 하나로 합친다."""
    clean = sorted((int(min(a, b)), int(max(a, b)))
                   for a, b in ranges if int(max(a, b)) > int(min(a, b)))
    out: list[tuple[int, int]] = []
    for s, e in clean:
        if out and s - out[-1][1] <= gap:
            out[-1] = (out[-1][0], max(out[-1][1], e))
        else:
            out.append((s, e))
    return out


def remap_time_through_deletions(t: int, ranges: list[tuple[int, int]]) -> int:
    """원본 타임라인의 시각 t를, 구간들이 리플 삭제된 뒤의 시각으로 변환."""
    t = int(t)
    shift = 0
    for s, e in ranges:  # ranges는 정렬·병합되어 있다고 가정
        if t >= e:
            shift += e - s
        elif t > s:            # 삭제 구간 내부 → 구간 시작으로 스냅
            return s - shift
    return t - shift


def _ripple_one_range(draft: dict, cs: int, ce: int) -> None:
    """단일 구간 [cs, ce)를 모든 트랙에서 잘라내고 뒤를 당긴다."""
    cut = ce - cs
    if cut <= 0:
        return
    for track in draft.get("tracks") or []:
        new_segments: list[dict] = []
        for seg in track.get("segments") or []:
            tgt = seg.get("target_timerange") or {}
            ts = int(tgt.get("start", 0))
            td = int(tgt.get("duration", 0))
            te = ts + td
            if td <= 0:
                new_segments.append(seg)
                continue
            if te <= cs:                       # 구간보다 완전히 앞
                new_segments.append(seg)
                continue
            if ts >= ce:                       # 구간보다 완전히 뒤 → 당기기
                tgt["start"] = ts - cut
                new_segments.append(seg)
                continue
            if ts >= cs and te <= ce:          # 구간 안에 완전히 포함 → 삭제
                continue

            speed = float(seg.get("speed", 1.0)) or 1.0
            src = seg.get("source_timerange") or {}
            src0 = int(src.get("start", 0))
            left = max(0, cs - ts)             # [ts, cs) 유지
            right = max(0, te - ce)            # [ce, te) 유지

            if left > 0 and right > 0:         # 구간을 완전히 가로지름 → 둘로 분할
                tgt["duration"] = left
                if src:
                    src["duration"] = int(round(left * speed))
                _drop_keyframes_outside(seg, 0, left)
                new_segments.append(seg)

                import copy as _copy
                tail = _copy.deepcopy(seg)
                tail["id"] = _new_id()
                t_tgt = tail.setdefault("target_timerange", {})
                t_tgt["start"] = cs           # 리플 후 위치
                t_tgt["duration"] = right
                t_src = tail.get("source_timerange")
                if t_src:
                    t_src["start"] = src0 + int(round((left + cut) * speed))
                    t_src["duration"] = int(round(right * speed))
                _drop_keyframes_outside(tail, 0, right)
                new_segments.append(tail)
            elif left > 0:                     # 뒤쪽이 구간에 물림 → 꼬리 자르기
                tgt["duration"] = left
                if src:
                    src["duration"] = int(round(left * speed))
                _drop_keyframes_outside(seg, 0, left)
                new_segments.append(seg)
            else:                             # 앞쪽이 구간에 물림 → 머리 자르고 당기기
                drop_front = ce - ts
                tgt["start"] = cs
                tgt["duration"] = right
                if src:
                    src["start"] = src0 + int(round(drop_front * speed))
                    src["duration"] = int(round(right * speed))
                _drop_keyframes_outside(seg, 0, right, offset=drop_front)
                new_segments.append(seg)
        track["segments"] = new_segments


def _drop_keyframes_outside(seg: dict, lo: int, hi: int, offset: int = 0) -> None:
    """세그먼트 시작 기준 [lo, hi) 밖 키프레임 제거, offset만큼 앞당김."""
    for grp in seg.get("common_keyframes") or []:
        kfs = grp.get("keyframe_list")
        if not isinstance(kfs, list):
            continue
        kept = []
        for kf in kfs:
            try:
                to = int(kf.get("time_offset", 0)) - offset
            except (TypeError, ValueError):
                continue
            if lo <= to <= hi:
                kf["time_offset"] = to
                kept.append(kf)
        grp["keyframe_list"] = kept


def ripple_delete_ranges(draft: dict,
                         ranges: list[tuple[int, int]]) -> int:
    """draft(dict)에서 여러 구간을 리플 삭제. 잘라낸 총 길이(us)를 반환."""
    merged = merge_ranges(ranges)
    if not merged:
        return 0
    for cs, ce in reversed(merged):   # 뒤 구간부터 처리해 좌표 무효화 방지
        _ripple_one_range(draft, cs, ce)
    removed = sum(e - s for s, e in merged)
    if "duration" in draft:
        draft["duration"] = max(0, int(draft.get("duration", 0)) - removed)
    return removed
