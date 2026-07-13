"""Whisper(faster-whisper) 기반 음성 인식 → 자막 라인 생성."""

from __future__ import annotations

import re
import sys
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

import numpy as np

US = 1_000_000
SR = 16000

MODEL = "large-v3"  # 고정 모델
MODEL_BYTES = 3_100_000_000  # large-v3 다운로드 용량(진행률 표시용 근사치)
LANGUAGE_CHOICES = {
    "자동 감지": None,
    "한국어": "ko",
    "일본어": "ja",
}

_SENTENCE_END = re.compile(r"[.!?。！？…]$")

Word = tuple[str, int, int]  # (단어 텍스트, 시작us, 끝us)


@dataclass
class SubtitleLine:
    start_us: int
    end_us: int
    text: str
    words: list[Word] = field(default_factory=list)  # 정밀 분할에 사용, 없어도 동작


@dataclass
class FullScript:
    text: str
    words: list[Word]
    language: str = ""
    language_probability: float = 0.0


def bundled_model_dir() -> Optional[str]:
    """프로그램 폴더에 동봉된 Whisper 모델 경로를 찾는다.

    배포 zip에 모델을 포함하거나, 사용자가 별도 모델 zip을 받아
    프로그램 폴더의 models\\faster-whisper-large-v3 에 풀어두면 자동 인식된다.
    """
    bases: list[Path] = []
    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).resolve().parent
        bases += [exe_dir, exe_dir.parent]
    bases.append(Path(__file__).resolve().parent.parent)
    for base in bases:
        for name in (f"faster-whisper-{MODEL}", MODEL):
            d = base / "models" / name
            if (d / "model.bin").is_file():
                return str(d)
    return None


class Transcriber:
    """faster-whisper 모델 로딩/인식 래퍼.

    모델 탐색 순서: ① 동봉 모델(models 폴더) → ② 기존 다운로드 캐시 →
    ③ 자동 다운로드(진행률 표시). 다운로드 실패 시 대안 안내 메시지를 띄운다.
    """

    def __init__(self) -> None:
        self._model = None
        self._model_size: Optional[str] = None
        # 백그라운드 예열과 자막 생성이 동시에 load()를 불러도
        # 모델이 이중으로 적재(RAM 6GB+)되지 않도록 직렬화한다
        self._load_lock = threading.Lock()

    def load(self, model_size: str, progress: Callable[[str], None] = print) -> None:
        with self._load_lock:
            if self._model is not None and self._model_size == model_size:
                return
            from faster_whisper import WhisperModel

            path = bundled_model_dir()
            if path:
                progress("동봉된 Whisper 모델을 불러오고 있어요...")
            else:
                path = self._ensure_downloaded(model_size, progress)
                progress("음성인식 모델을 준비하고 있어요... (매 실행 시 30초~1분, 다운로드 아님)")
            self._model = WhisperModel(path, device="cpu", compute_type="int8")
            self._model_size = model_size
            progress("음성인식 준비 완료")

    def _ensure_downloaded(self, model_size: str,
                           progress: Callable[[str], None]) -> str:
        """캐시에 모델이 없으면 진행률을 보여주며 다운로드한다."""
        from faster_whisper.utils import download_model
        try:
            return download_model(model_size, local_files_only=True)
        except Exception:
            pass  # 캐시 없음 → 다운로드

        stop = threading.Event()

        def monitor() -> None:
            try:
                from huggingface_hub.constants import HF_HUB_CACHE
                cache = Path(HF_HUB_CACHE)
            except Exception:
                cache = Path.home() / ".cache" / "huggingface" / "hub"
            while not stop.wait(2.0):
                try:
                    size = sum(
                        f.stat().st_size
                        for d in cache.glob(f"models--*faster-whisper-{model_size}")
                        for f in d.rglob("*") if f.is_file())
                    pct = min(size / MODEL_BYTES * 100, 99)
                    progress(f"Whisper 모델을 다운로드하고 있어요... {pct:.0f}% "
                             f"(약 3.1GB, 최초 1회만 받아요)")
                except OSError:
                    pass

        progress("Whisper 모델을 다운로드하고 있어요... (약 3.1GB, 최초 1회만 받아요)")
        t = threading.Thread(target=monitor, daemon=True)
        t.start()
        try:
            return download_model(model_size)
        except Exception as e:
            raise RuntimeError(
                "Whisper 모델 다운로드에 실패했어요. 인터넷 연결을 확인한 뒤 다시 시도하거나, "
                "홈페이지에서 '음성인식 모델' zip을 받아 TadakSync.exe가 있는 "
                "프로그램 폴더에 압축 해제해 주세요. (models 폴더가 생겨요)"
            ) from e
        finally:
            stop.set()

    def transcribe(
        self,
        audio: np.ndarray,
        language: Optional[str] = None,
        max_words_per_line: int = 5,
        progress: Callable[[str], None] = print,
        progress_ratio: Callable[[float], None] = lambda r: None,
    ) -> list[SubtitleLine]:
        assert self._model is not None, "모델을 먼저 load() 하세요"
        total_sec = len(audio) / 16000
        progress("음성을 인식하고 있어요...")
        segments, info = self._model.transcribe(
            audio,
            language=language,
            word_timestamps=True,
            vad_filter=False,
            condition_on_previous_text=False,
        )
        all_segments = list(segments)
        for seg in all_segments:
            if total_sec > 0:
                progress_ratio(min(seg.end / total_sec, 1.0))
        progress(f"인식 언어: {info.language} (확률 {info.language_probability:.0%})")
        lines = _split_lines_from_segments(all_segments, max_words_per_line)
        progress("자막 타이밍을 정밀하게 보정하고 있어요...")
        return _close_gaps(_refine_speech_boundaries(lines, audio))

    def transcribe_full_script(
        self,
        audio: np.ndarray,
        language: Optional[str] = None,
        progress: Callable[[str], None] = print,
        progress_ratio: Callable[[float], None] = lambda r: None,
    ) -> FullScript:
        """자막 블록으로 자르지 않고 전문과 단어 타임스탬프만 반환."""
        assert self._model is not None, "모델을 먼저 load() 하세요"
        total_sec = len(audio) / 16000
        progress("전문을 인식하고 있어요...")
        segments, info = self._model.transcribe(
            audio,
            language=language,
            word_timestamps=True,
            vad_filter=False,
            condition_on_previous_text=False,
        )
        words: list[Word] = []
        fallback_parts: list[str] = []
        for seg in segments:
            if total_sec > 0:
                progress_ratio(min(seg.end / total_sec, 1.0))
            if (getattr(seg, "no_speech_prob", 0.0) > 0.6
                    and getattr(seg, "avg_logprob", 0.0) < -1.0):
                continue
            seg_words = [w for w in (seg.words or []) if (w.word or "").strip()]
            if seg_words:
                for w in seg_words:
                    words.append((w.word, int(w.start * US), int(w.end * US)))
            else:
                text = (seg.text or "").strip()
                if text:
                    fallback_parts.append(text)

        text = "".join(w[0] for w in words).strip()
        if not text:
            text = " ".join(fallback_parts).strip()
        progress(f"인식 언어: {info.language} (확률 {info.language_probability:.0%})")
        return FullScript(
            text=text,
            words=words,
            language=info.language or "",
            language_probability=float(info.language_probability or 0.0),
        )


def _close_gaps(lines: list[SubtitleLine]) -> list[SubtitleLine]:
    """표시 유지용 — start는 건드리지 않고 end만 다음 자막까지(최대 2초) 연장."""
    if len(lines) < 2:
        return lines
    max_hold_us = 2_000_000
    for i in range(len(lines) - 1):
        lines[i].end_us = min(lines[i + 1].start_us,
                              lines[i].end_us + max_hold_us)
    return [l for l in lines if l.end_us > l.start_us]


def _split_lines_from_segments(segments: list, max_words_per_line: int) -> list[SubtitleLine]:
    """Segment 기반 분할 — 문장 경계를 존중하는 어절 규칙.

    규칙:
    1. 기본 상한은 max_words_per_line(기본 5어절)
    2. 마침표(.!? 등)로 끝나는 문장은 다음 문장 어절을 끌어와 채우지 않음
       → 3어절 문장은 3어절 그대로, 7어절 문장은 5+2로만 나눔
    """
    lines: list[SubtitleLine] = []

    for seg in segments:
        text = (seg.text or "").strip()
        if not text:
            continue
        # 환각 필터: 무음 확률이 높고 신뢰도가 낮은 세그먼트는 배경 소음을
        # 잘못 받아적은 것일 가능성이 크다 (openai/whisper의 기본 휴리스틱).
        if (getattr(seg, "no_speech_prob", 0.0) > 0.6
                and getattr(seg, "avg_logprob", 0.0) < -1.0):
            continue

        words = [w for w in (seg.words or []) if (w.word or "").strip()]
        if not words:
            lines.append(SubtitleLine(
                start_us=int(seg.start * US),
                end_us=int(seg.end * US),
                text=text,
            ))
            continue

        # 1) 문장 단위로 묶기 (마침표 어절에서 끊음)
        sentences: list[list] = []
        cur_sent: list = []
        for w in words:
            cur_sent.append(w)
            if _SENTENCE_END.search(w.word.strip()):
                sentences.append(cur_sent)
                cur_sent = []
        if cur_sent:
            sentences.append(cur_sent)

        # 2) 문장 안에서만 max_words씩 청크 (문장 간 병합 금지)
        seg_lines: list[SubtitleLine] = []
        for sent in sentences:
            for i in range(0, len(sent), max_words_per_line):
                chunk = sent[i:i + max_words_per_line]
                sub_text = "".join(w.word for w in chunk).strip()
                if not sub_text:
                    continue
                start = max(seg.start, chunk[0].start)
                end = min(seg.end, chunk[-1].end)
                seg_lines.append(SubtitleLine(
                    start_us=int(start * US),
                    end_us=int(end * US),
                    text=sub_text,
                    words=[(w.word, int(w.start * US), int(w.end * US)) for w in chunk],
                ))

        if not seg_lines:
            lines.append(SubtitleLine(
                start_us=int(seg.start * US),
                end_us=int(seg.end * US),
                text=text,
            ))
        else:
            lines.extend(seg_lines)

    # 라인 간 겹침 제거 및 최소 표시시간 보정 (최종 간격 0 처리는 _close_gaps)
    for i, line in enumerate(lines):
        if line.end_us - line.start_us < 500_000:
            line.end_us = line.start_us + 500_000
        if i + 1 < len(lines) and line.end_us > lines[i + 1].start_us:
            line.end_us = lines[i + 1].start_us
    return [l for l in lines if l.text.strip()]


# ── 발화 경계 스냅 (에너지 + VAD) ──────────────────────────────────

_FRAME_SEC = 0.02  # 20ms
_FRAME = int(_FRAME_SEC * SR)
_HOP = _FRAME // 2


def _rms_envelope(audio: np.ndarray) -> np.ndarray:
    """20ms 프레임 / 10ms hop RMS envelope."""
    if len(audio) < _FRAME:
        return np.array([float(np.sqrt(np.mean(audio ** 2)))], dtype=np.float64)
    n = 1 + (len(audio) - _FRAME) // _HOP
    env = np.empty(n, dtype=np.float64)
    for i in range(n):
        a = i * _HOP
        chunk = audio[a:a + _FRAME]
        env[i] = float(np.sqrt(np.mean(chunk ** 2)))
    return env


def _frame_to_sec(i: int) -> float:
    return (i * _HOP + _FRAME / 2) / SR


def _sec_to_frame(t: float, n: int) -> int:
    return max(0, min(n - 1, int(round(t * SR / _HOP))))


def _local_thresholds(env: np.ndarray, lo_f: int, hi_f: int) -> tuple[float, float]:
    """구간 상대 임계값: (침묵, 발화)."""
    slice_ = env[lo_f:hi_f + 1]
    if len(slice_) == 0:
        return 0.0, 0.0
    floor = float(np.percentile(slice_, 20))
    peak = float(np.percentile(slice_, 90))
    span = max(peak - floor, 1e-6)
    silence = floor + 0.15 * span
    speech = floor + 0.35 * span
    return silence, speech


def find_onset(audio: np.ndarray, lo: float, hi: float,
               env: np.ndarray | None = None) -> float | None:
    """lo~hi에서 침묵→발화로 올라가는 첫 지점(초).

    창 시작이 이미 발화면, 침묵으로 떨어진 뒤의 다음 온셋을 찾는다.
    """
    if hi <= lo:
        return None
    if env is None:
        env = _rms_envelope(audio)
    lo_f, hi_f = _sec_to_frame(lo, len(env)), _sec_to_frame(hi, len(env))
    if hi_f <= lo_f:
        return None
    silence, speech = _local_thresholds(env, lo_f, hi_f)
    i = lo_f
    # 이미 발화 중이면 침묵까지 스킵한 뒤 다음 rise를 찾음
    if env[lo_f] >= speech:
        while i <= hi_f and env[i] >= silence * 0.9:
            i += 1
        if i > hi_f:
            return None
    below = True
    run = 0
    for j in range(i, hi_f + 1):
        if env[j] < silence:
            below = True
            run = 0
            continue
        if below and env[j] >= speech:
            run += 1
            if run >= 2:
                return _frame_to_sec(j - 1)
        elif env[j] >= speech:
            run += 1
        else:
            run = 0
    return None


def find_offset(audio: np.ndarray, lo: float, hi: float,
                env: np.ndarray | None = None) -> float | None:
    """lo~hi에서 발화→침묵으로 떨어지는 마지막 지점(초)."""
    if hi <= lo:
        return None
    if env is None:
        env = _rms_envelope(audio)
    lo_f, hi_f = _sec_to_frame(lo, len(env)), _sec_to_frame(hi, len(env))
    if hi_f <= lo_f:
        return None
    silence, speech = _local_thresholds(env, lo_f, hi_f)
    last = None
    above = env[lo_f] >= speech
    run = 0
    for i in range(lo_f, hi_f + 1):
        if env[i] >= speech:
            above = True
            run = 0
            continue
        if above and env[i] < silence:
            run += 1
            if run >= 2:
                last = _frame_to_sec(i - 1)
                above = False
                run = 0
        else:
            run = 0
    return last


def _energy_valley(audio: np.ndarray, center: float, half: float = 0.3,
                   env: np.ndarray | None = None) -> float:
    """center ± half 에서 RMS가 가장 낮은 시각(연속 발화 줄바꿈용)."""
    if env is None:
        env = _rms_envelope(audio)
    lo_f = _sec_to_frame(center - half, len(env))
    hi_f = _sec_to_frame(center + half, len(env))
    if hi_f <= lo_f:
        return center
    i = lo_f + int(np.argmin(env[lo_f:hi_f + 1]))
    return _frame_to_sec(i)


def _in_speech(t: float, regions: list[tuple[float, float]], pad: float = 0.0) -> bool:
    return any(rs - pad <= t < re_ + pad for rs, re_ in regions)


def _nearest_region(t: float, regions: list[tuple[float, float]]) -> tuple[float, float] | None:
    if not regions:
        return None
    return min(regions, key=lambda r: 0.0 if r[0] <= t <= r[1] else min(abs(t - r[0]), abs(t - r[1])))


def _detect_speech_regions(audio: np.ndarray) -> list[tuple[float, float]]:
    """Silero VAD로 실제 발화 구간(초 단위)을 검출. pad=0으로 경계를 넓히지 않음."""
    from faster_whisper.vad import VadOptions, get_speech_timestamps
    opts = VadOptions(
        threshold=0.4,
        min_speech_duration_ms=100,
        min_silence_duration_ms=200,
        speech_pad_ms=0,
    )
    regions = get_speech_timestamps(audio, vad_options=opts)
    return [(r["start"] / SR, r["end"] / SR) for r in regions]


def _refine_speech_boundaries(lines: list[SubtitleLine],
                              audio: np.ndarray) -> list[SubtitleLine]:
    """각 자막 start/end를 타임라인 오디오의 실제 발화 온셋·오프셋에 스냅.

    Whisper 시각은 탐색 창 힌트만 제공한다. 시작을 Whisper보다 앞으로 당기지 않는다.
    """
    if not lines:
        return lines
    try:
        regions = _detect_speech_regions(audio)
    except Exception:
        regions = []

    env = _rms_envelope(audio)
    audio_dur = len(audio) / SR
    if not regions:
        regions = _regions_from_energy(audio, env, audio_dur)
    if not regions:
        return lines

    refined: list[SubtitleLine] = []
    prev_end = 0.0

    for idx, line in enumerate(lines):
        s = line.start_us / US
        e = line.end_us / US
        next_s = lines[idx + 1].start_us / US if idx + 1 < len(lines) else audio_dur

        win_lo = max(prev_end, s - 0.15, 0.0)
        win_hi = min(e + 0.25, audio_dur)

        ov = [(rs, re_) for rs, re_ in regions if re_ > win_lo and rs < win_hi]
        if not ov:
            ov = [(rs, re_) for rs, re_ in regions
                  if re_ > s - 0.3 and rs < e + 0.3]
        if not ov:
            continue

        nearest = _nearest_region(s, ov) or ov[0]
        if len(ov) > 1 and nearest[1] - max(win_lo, s) < 0.15 and nearest is ov[0]:
            nearest = ov[1]

        rs, re_ = nearest
        # 온셋: whisper 시각 근처부터 탐색 (region 시작에 묶이지 않음)
        onset_lo = max(win_lo, prev_end)
        onset_hi = min(win_hi, max(e + 0.1, rs + 0.5), audio_dur)
        onset = find_onset(audio, onset_lo, max(onset_lo + 0.05, onset_hi), env)

        if not _in_speech(s, regions, pad=0.02):
            if onset is not None and onset >= s - 0.02:
                new_s = max(onset, prev_end)
            else:
                onset2 = find_onset(audio, max(s, prev_end), min(e + 0.6, audio_dur), env)
                new_s = max(onset2, prev_end) if onset2 is not None else max(s, prev_end)
        else:
            if onset is not None and onset > s:
                new_s = onset
            else:
                new_s = max(s, prev_end)

        new_s = max(new_s, prev_end)

        off_lo = max(new_s + 0.1, s)
        off_hi = min(win_hi, re_ + 0.05, next_s, audio_dur)
        offset = find_offset(audio, off_lo, max(off_lo + 0.05, off_hi), env)

        if offset is None:
            new_e = min(max(e, new_s + 0.2), re_ if re_ > new_s else e, next_s)
        else:
            new_e = min(max(offset, new_s + 0.2), next_s)

        if idx > 0 and refined:
            prev = refined[-1]
            mid = (prev.end_us / US + s) / 2
            if (new_s - prev.end_us / US) < 0.08 and _in_speech(mid, regions):
                valley = _energy_valley(audio, s, 0.3, env)
                valley = max(valley, prev.start_us / US + 0.15)
                if prev.end_us / US - 0.05 <= valley <= s + 0.3:
                    if valley < s:
                        prev.end_us = int(valley * US)
                        new_s = s
                    else:
                        prev.end_us = int(valley * US)
                        new_s = max(s, valley)
                    new_s = max(new_s, prev.end_us / US)

        new_e = max(new_e, new_s + 0.2)
        if new_e > next_s:
            new_e = max(new_s + 0.05, next_s)

        line.start_us = int(new_s * US)
        line.end_us = int(new_e * US)
        refined.append(line)
        prev_end = new_e

    gaps = [(regions[k][1], regions[k + 1][0])
            for k in range(len(regions) - 1)
            if regions[k + 1][0] - regions[k][1] >= 0.2]
    for i in range(len(refined) - 1):
        a, b = refined[i], refined[i + 1]
        ae, bs = a.end_us / US, b.start_us / US
        if bs - ae > 0.05:
            continue
        cand = [(gs, ge) for gs, ge in gaps
                if a.start_us / US + 0.15 < gs and ge < b.end_us / US - 0.15
                and abs(gs - ae) <= 1.0]
        if not cand:
            continue
        gs, ge = min(cand, key=lambda g: abs(g[0] - ae))
        a.end_us = int(gs * US)
        if ge >= bs - 0.05:
            b.start_us = int(ge * US)

    for i, line in enumerate(refined):
        if line.end_us - line.start_us < 200_000:
            line.end_us = line.start_us + 200_000
        if i + 1 < len(refined) and line.end_us > refined[i + 1].start_us:
            line.end_us = refined[i + 1].start_us
    return [l for l in refined if l.end_us > l.start_us]


def _regions_from_energy(audio: np.ndarray, env: np.ndarray,
                         audio_dur: float) -> list[tuple[float, float]]:
    """VAD 실패 시 RMS로 대략적인 발화 구간을 만든다."""
    if len(env) == 0:
        return []
    silence, speech = _local_thresholds(env, 0, len(env) - 1)
    regions: list[tuple[float, float]] = []
    in_sp = False
    start = 0.0
    for i, v in enumerate(env):
        t = _frame_to_sec(i)
        if not in_sp and v >= speech:
            in_sp = True
            start = t
        elif in_sp and v < silence:
            if t - start >= 0.08:
                regions.append((start, t))
            in_sp = False
    if in_sp and audio_dur - start >= 0.08:
        regions.append((start, audio_dur))
    return regions


# 하위 호환 별칭
def _refine_with_vad(lines: list[SubtitleLine],
                     audio: np.ndarray) -> list[SubtitleLine]:
    return _refine_speech_boundaries(lines, audio)


def _split_lines(words: list, max_words_per_line: int) -> list[SubtitleLine]:
    """어절 단위로 자막을 분할 (문장 경계 존중).

    Whisper는 한국어/일본어에서 각 어절을 앞에 공백이 붙은 개별 토큰
    (' 네', ' 여러분', ' 반갑습니다.')으로 반환한다.
    마침표로 끝나는 문장 경계를 넘지 않고, 문장 안에서만
    max_words_per_line개씩 묶는다.
    """
    valid = [w for w in words if (w.word or "").strip()]
    sentences: list[list] = []
    cur_sent: list = []
    for w in valid:
        # 어절 사이 긴 침묵은 문장 경계로도 취급
        if cur_sent and w.start - cur_sent[-1].end > 0.8:
            sentences.append(cur_sent)
            cur_sent = []
        cur_sent.append(w)
        if _SENTENCE_END.search(w.word.strip()):
            sentences.append(cur_sent)
            cur_sent = []
    if cur_sent:
        sentences.append(cur_sent)

    lines: list[SubtitleLine] = []
    for sent in sentences:
        for i in range(0, len(sent), max_words_per_line):
            chunk = sent[i:i + max_words_per_line]
            text = "".join(w.word for w in chunk).strip()
            if not text:
                continue
            lines.append(SubtitleLine(
                start_us=int(chunk[0].start * US),
                end_us=int(chunk[-1].end * US),
                text=text,
                words=[(w.word, int(w.start * US), int(w.end * US)) for w in chunk],
            ))

    # 라인 간 겹침 제거 및 최소 표시시간 보정
    for i, line in enumerate(lines):
        if line.end_us - line.start_us < 500_000:
            line.end_us = line.start_us + 500_000
        if i + 1 < len(lines) and line.end_us > lines[i + 1].start_us:
            line.end_us = lines[i + 1].start_us
    return [l for l in lines if l.text.strip()]


def _matched_words(line: SubtitleLine) -> list[Word] | None:
    """line.words가 현재 line.text와 여전히 일치하면(수동 편집되지 않았으면) 반환."""
    if not line.words:
        return None
    raw = "".join(w[0] for w in line.words)
    return line.words if raw.strip() == line.text else None


def split_line(line: SubtitleLine, offset: int) -> tuple[SubtitleLine, SubtitleLine] | None:
    """line.text의 offset(문자 위치)에서 두 자막으로 분할.

    단어 타임스탬프가 남아있으면(=텍스트를 수동 수정하지 않았으면) 단어 경계로
    정확히 나누고, 아니면 시간 길이를 문자 수 비율로 나눈다(브루의 커서 분할과 동일한 방식).
    """
    text = line.text
    if not (0 < offset < len(text)):
        return None
    left_text, right_text = text[:offset].rstrip(), text[offset:].lstrip()
    if not left_text or not right_text:
        return None

    words = _matched_words(line)
    split_time = None
    left_words: list[Word] = []
    right_words: list[Word] = []
    if words:
        raw = "".join(w[0] for w in words)
        target = offset + (len(raw) - len(raw.lstrip()))  # 앞쪽 공백 보정
        pos = 0
        for w in words:
            w_start_char, w_end_char = pos, pos + len(w[0])
            pos = w_end_char
            if w_end_char <= target:
                left_words.append(w)
            elif w_start_char >= target:
                right_words.append(w)
            else:
                # 분할 지점이 한 단어(한국어 등에서 흔히 여러 음절이 공백 없이
                # 하나로 묶인 토큰) 내부를 가로지름: 그 단어의 시간 구간 안에서
                # 문자 비율로 보간한다 (통째로 한쪽에 몰아주면 시간이 왜곡됨).
                frac = (target - w_start_char) / (w_end_char - w_start_char)
                split_time = round(w[1] + (w[2] - w[1]) * frac)
        if split_time is None:
            if right_words:
                split_time = right_words[0][1]
            elif left_words:
                split_time = left_words[-1][2]

    if split_time is None:
        ratio = offset / len(text)
        split_time = line.start_us + round((line.end_us - line.start_us) * ratio)
    split_time = max(line.start_us + 1, min(line.end_us - 1, split_time))

    left = SubtitleLine(line.start_us, split_time, left_text, left_words)
    right = SubtitleLine(split_time, line.end_us, right_text, right_words)
    return left, right


def merge_lines(lines: list[SubtitleLine]) -> SubtitleLine:
    """연속된 자막 여러 개를 하나로 합침 (시간순으로 정렬되어 있다고 가정)."""
    text = " ".join(l.text for l in lines).strip()
    words: list[Word] = []
    if all(l.words for l in lines):
        for l in lines:
            words.extend(l.words)
    return SubtitleLine(lines[0].start_us, lines[-1].end_us, text, words)
