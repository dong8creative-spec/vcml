#!/usr/bin/env python3
"""발화 경계 스냅 단위 테스트 + 프로젝트 검증.

1) 합성 오디오로 find_onset / find_offset 정확도 확인
2) (선택) 캡컷 프로젝트로 온셋·오프셋 오차 검사

사용:
  python test_timing_v4.py              # 합성 테스트만
  python test_timing_v4.py --project    # 가장 최근 프로젝트
  python test_timing_v4.py 프로젝트명
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).parent))

from capcut_subtitle.transcribe import (
    SR,
    SubtitleLine,
    _detect_speech_regions,
    _refine_speech_boundaries,
    find_offset,
    find_onset,
)


def _tone(dur_s: float, freq: float = 220.0, amp: float = 0.3) -> np.ndarray:
    n = int(dur_s * SR)
    t = np.arange(n, dtype=np.float64) / SR
    return (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def _silence(dur_s: float) -> np.ndarray:
    return np.zeros(int(dur_s * SR), dtype=np.float32)


def test_synthetic_onset_offset() -> bool:
    print("=" * 70)
    print("합성 오디오: find_onset / find_offset")
    print("=" * 70)
    # 0.5s 침묵 + 1.0s 톤 + 0.4s 침묵 + 0.8s 톤
    audio = np.concatenate([
        _silence(0.5),
        _tone(1.0),
        _silence(0.4),
        _tone(0.8, freq=330.0),
        _silence(0.3),
    ])
    # 첫 발화
    onset1 = find_onset(audio, 0.0, 1.2)
    offset1 = find_offset(audio, 0.4, 2.0)
    # 둘째 발화
    onset2 = find_onset(audio, 1.3, 2.5)
    offset2 = find_offset(audio, 1.8, 3.2)

    ok = True
    checks = [
        ("onset1≈0.50", onset1, 0.50, 0.08),
        ("offset1≈1.50", offset1, 1.50, 0.12),
        ("onset2≈1.90", onset2, 1.90, 0.08),
        ("offset2≈2.70", offset2, 2.70, 0.12),
    ]
    for name, got, expect, tol in checks:
        if got is None:
            print(f"  ✗ {name}: None")
            ok = False
            continue
        err = abs(got - expect)
        mark = "✓" if err <= tol else "✗"
        if err > tol:
            ok = False
        print(f"  {mark} {name}: got={got:.3f}s err={err:.3f}s (tol={tol})")
    return ok


def test_refine_no_early_pull() -> bool:
    print("=" * 70)
    print("refine: Whisper보다 앞으로 당기지 않음")
    print("=" * 70)
    # 0.5 침묵 + 2초 톤
    audio = np.concatenate([_silence(0.5), _tone(2.0), _silence(0.3)])
    # Whisper가 조기(0.2)로 잡은 줄 → 온셋(0.5)으로 뒤로
    early = [SubtitleLine(int(0.2 * 1e6), int(1.5 * 1e6), "early")]
    # Whisper가 늦은(0.7)로 잡은 줄 → 앞으로 당기지 않고 0.7 유지(발화 안)
    late = [SubtitleLine(int(0.7 * 1e6), int(2.0 * 1e6), "late")]

    r_early = _refine_speech_boundaries(early, audio)
    r_late = _refine_speech_boundaries(late, audio)
    ok = True
    if not r_early:
        print("  ✗ early 줄이 제거됨")
        return False
    es = r_early[0].start_us / 1e6
    if es < 0.2 - 0.01:
        print(f"  ✗ early가 앞으로 당겨짐: {es:.3f}")
        ok = False
    elif abs(es - 0.5) <= 0.12:
        print(f"  ✓ early 침묵→온셋 스냅: {es:.3f}s")
    else:
        print(f"  · early start={es:.3f}s (온셋 근처 기대)")

    if not r_late:
        print("  ✗ late 줄이 제거됨")
        return False
    ls = r_late[0].start_us / 1e6
    if ls < 0.7 - 0.02:
        print(f"  ✗ late가 Whisper보다 앞으로 당겨짐: {ls:.3f} < 0.70")
        ok = False
    else:
        print(f"  ✓ late 앞당김 없음: {ls:.3f}s >= 0.70")
    return ok


def test_project(name: str | None) -> bool:
    from capcut_subtitle import capcut
    from capcut_subtitle.transcribe import MODEL, Transcriber

    projects = capcut.list_projects()
    if name:
        projects = [p for p in projects if p.name == name]
    if not projects:
        print(f"프로젝트를 찾을 수 없습니다: {name}")
        return False
    project = projects[0]
    print("=" * 70)
    print(f"프로젝트: {project.name} ({project.duration_str})")
    print("=" * 70)

    res = capcut.build_timeline_audio(project)
    regions = _detect_speech_regions(res.audio)
    print(f"VAD 발화 구간 {len(regions)}개")

    tr = Transcriber()
    tr.load(MODEL)
    lines = tr.transcribe(res.audio, language="ko", max_words_per_line=5)
    print(f"생성 자막 {len(lines)}개")

    bad_silence = 0
    onset_miss = 0
    offset_miss = 0

    print("\n검사 1: 침묵에서 시작 금지 / 온셋 오차 ≤ 0.10s")
    for i, l in enumerate(lines, 1):
        s = l.start_us / 1e6
        in_speech = any(rs - 0.05 <= s < re_ for rs, re_ in regions)
        nearest_onset = min((abs(rs - s) for rs, re_ in regions), default=99)
        if nearest_onset <= 0.10:
            print(f"  ✓ #{i} [{s:6.2f}s] 온셋 일치 (오차 {nearest_onset:.2f}s)")
        elif in_speech:
            print(f"  · #{i} [{s:6.2f}s] 발화 중간 줄바꿈")
        else:
            print(f"  ✗ #{i} [{s:6.2f}s] 침묵 시작! {l.text[:24]}")
            bad_silence += 1

    print("\n검사 2: 오프셋 — 끝점이 침묵이거나 다음 온셋 직전 (오차 ≤ 0.15s)")
    for i, l in enumerate(lines, 1):
        e = l.end_us / 1e6
        nearest_off = min((abs(re_ - e) for rs, re_ in regions), default=99)
        in_speech = any(rs + 0.05 < e < re_ - 0.05 for rs, re_ in regions)
        next_start = lines[i].start_us / 1e6 if i < len(lines) else None
        held_to_next = next_start is not None and abs(e - next_start) < 0.02
        if nearest_off <= 0.15 or held_to_next or not in_speech:
            print(f"  ✓ #{i} [{e:6.2f}s] end ok")
        else:
            print(f"  ✗ #{i} [{e:6.2f}s] 발화 한가운데에서 끝 (최근접 오프셋 {nearest_off:.2f}s)")
            offset_miss += 1

    print("\n검사 3: 각 발화 온셋 커버")
    for rs, re_ in regions:
        d = min((abs(l.start_us / 1e6 - rs) for l in lines), default=99)
        covered = any(l.start_us / 1e6 <= rs < l.end_us / 1e6 for l in lines)
        if d <= 0.10:
            print(f"  ✓ 온셋 {rs:6.2f}s → 오차 {d:.2f}s")
        elif covered:
            print(f"  · 온셋 {rs:6.2f}s → 이전 자막 이어짐")
        else:
            print(f"  ✗ 온셋 {rs:6.2f}s → 미커버 (최근접 {d:.2f}s)")
            onset_miss += 1

    print("\n" + "=" * 70)
    print(f"결과: 침묵시작 {bad_silence} / 온셋미커버 {onset_miss} / 오프셋 {offset_miss}")
    return bad_silence == 0 and onset_miss == 0 and offset_miss == 0


def main() -> None:
    args = sys.argv[1:]
    ok = test_synthetic_onset_offset()
    ok = test_refine_no_early_pull() and ok

    if args and args[0] == "--project":
        ok = test_project(None) and ok
    elif args:
        ok = test_project(args[0]) and ok

    print("\n" + ("✓ 합격" if ok else "✗ 추가 개선 필요"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
