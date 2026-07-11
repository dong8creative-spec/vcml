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

    def load(self, model_size: str, progress: Callable[[str], None] = print) -> None:
        if self._model is not None and self._model_size == model_size:
            return
        from faster_whisper import WhisperModel

        path = bundled_model_dir()
        if path:
            progress("동봉된 Whisper 모델 로딩 중...")
        else:
            path = self._ensure_downloaded(model_size, progress)
            progress(f"Whisper 모델({model_size}) 로딩 중...")
        self._model = WhisperModel(path, device="cpu", compute_type="int8")
        self._model_size = model_size
        progress("모델 로딩 완료")

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
                    progress(f"Whisper 모델 다운로드 중... {pct:.0f}% "
                             f"(약 3.1GB, 최초 1회만 받습니다)")
                except OSError:
                    pass

        progress("Whisper 모델 다운로드 중... (약 3.1GB, 최초 1회만 받습니다)")
        t = threading.Thread(target=monitor, daemon=True)
        t.start()
        try:
            return download_model(model_size)
        except Exception as e:
            raise RuntimeError(
                "Whisper 모델 다운로드에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 시도하거나, "
                "홈페이지에서 '음성인식 모델' 파일을 받아 프로그램 폴더 안 "
                "models\\faster-whisper-large-v3 폴더에 풀어주세요."
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
        progress("음성 인식 중...")
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
        progress("자막 타이밍 정밀 보정 중...")
        return _close_gaps(_refine_with_vad(lines, audio))


def _close_gaps(lines: list[SubtitleLine]) -> list[SubtitleLine]:
    """연속 자막 사이 간격을 0으로 맞춘다.

    각 자막의 끝 시각을 다음 자막의 시작 시각까지 연장해,
    화면에서 자막이 끊기지 않고 다음 자막이 뜰 때까지 유지되게 한다.
    """
    if len(lines) < 2:
        return lines
    for i in range(len(lines) - 1):
        lines[i].end_us = lines[i + 1].start_us
    return [l for l in lines if l.end_us > l.start_us]


def _split_lines_from_segments(segments: list, max_words_per_line: int) -> list[SubtitleLine]:
    """Segment 기반 분할 (word 타이밍은 보조용).

    Whisper의 segment는 문장 단위로 이미 나뉘어 있고, 타이밍(start/end)도
    정확하다. 각 segment 내의 word를 사용해 어절 단위로 세부 분할하되,
    전체 구간은 segment의 시작/끝을 따른다.
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

        words = seg.words or []
        if not words:
            # word 정보가 없으면 segment 전체를 하나의 라인으로
            lines.append(SubtitleLine(
                start_us=int(seg.start * US),
                end_us=int(seg.end * US),
                text=text,
            ))
            continue

        # Segment 내에서 word를 max_words_per_line씩 묶어 서브라인 생성
        cur_words = []
        seg_lines: list[SubtitleLine] = []

        def flush_subline():
            nonlocal cur_words
            if not cur_words:
                return
            sub_text = "".join(w.word for w in cur_words).strip()
            if sub_text:
                # Subline의 시작/끝: word 타이밍을 사용하되, segment 범위 내로 제한
                start = max(seg.start, cur_words[0].start)
                end = min(seg.end, cur_words[-1].end)
                seg_lines.append(SubtitleLine(
                    start_us=int(start * US),
                    end_us=int(end * US),
                    text=sub_text,
                ))
            cur_words = []

        for w in words:
            token = w.word.strip()
            if not token:
                continue
            cur_words.append(w)
            if len(cur_words) >= max_words_per_line:
                flush_subline()

        flush_subline()

        # Segment에서 서브라인이 없으면 전체를 하나로
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


def _detect_speech_regions(audio: np.ndarray) -> list[tuple[float, float]]:
    """Silero VAD로 실제 발화 구간(초 단위)을 검출."""
    from faster_whisper.vad import VadOptions, get_speech_timestamps
    opts = VadOptions(
        threshold=0.35,
        min_speech_duration_ms=100,
        min_silence_duration_ms=200,
        speech_pad_ms=40,
    )
    regions = get_speech_timestamps(audio, vad_options=opts)
    return [(r["start"] / SR, r["end"] / SR) for r in regions]


def _refine_with_vad(lines: list[SubtitleLine],
                     audio: np.ndarray) -> list[SubtitleLine]:
    """자막 타이밍을 실제 음성 경계에 스냅.

    Whisper의 segment 타이밍은 발화보다 일찍 시작하거나 늦게 끝나는 오차가
    ±0.2~0.5초 수준으로 흔하다. VAD가 검출한 발화 구간을 기준으로:
    - 침묵에서 시작하는 자막 → 발화 시작점으로 당김
    - 발화가 끝났는데 남아있는 자막 → 발화 끝점으로 자름
    - 발화가 전혀 없는 구간의 자막(환각) → 제거
    """
    if not lines:
        return lines
    try:
        regions = _detect_speech_regions(audio)
    except Exception:
        return lines  # VAD 실패 시 원본 타이밍 유지
    if not regions:
        return lines

    refined: list[SubtitleLine] = []
    prev_end = 0.0
    for line in lines:
        s, e = line.start_us / US, line.end_us / US
        ov = [(rs, re_) for rs, re_ in regions if re_ > s and rs < e]
        if not ov:
            # 자막 구간 자체에 발화가 없으면 근처(±0.3초)까지 확대 탐색
            ov = [(rs, re_) for rs, re_ in regions
                  if re_ > s - 0.3 and rs < e + 0.3]
        if not ov:
            continue  # 무성 구간 환각 → 제거

        # 직전 발화의 꼬리(0.2초 미만)만 살짝 걸친 경우, 그 구간은
        # 이전 자막의 발화이므로 다음 구간의 온셋을 기준으로 삼는다
        if len(ov) > 1 and ov[0][1] - s < 0.2:
            ov = ov[1:]
        # 다음 발화의 머리(0.2초 미만)만 살짝 걸친 경우도 마찬가지로 제외
        if len(ov) > 1 and e - ov[-1][0] < 0.2:
            ov = ov[:-1]

        onset, offset = ov[0][0], ov[-1][1]
        new_s, new_e = s, e
        if onset > s:
            new_s = onset          # 자막이 음성보다 일찍 뜸 → 온셋으로 당김
        elif onset >= prev_end and s - onset <= 0.6:
            new_s = onset          # 새 온셋인데 자막이 살짝 늦음 → 온셋으로 확장
        if offset < e:
            new_e = offset         # 발화가 끝났는데 자막이 남음 → 끝 스냅
        new_e = max(new_e, new_s + 0.2)
        line.start_us, line.end_us = int(new_s * US), int(new_e * US)
        refined.append(line)
        prev_end = new_e

    # 붙어있는 두 자막의 경계가 실제 침묵 구간과 어긋나면 경계를 침묵으로 이동.
    # (이어붙인 녹음 등에서 Whisper가 침묵을 사이에 둔 두 발화를 연속으로
    # 착각해 경계를 최대 1초가량 앞당기는 오차를 보정)
    gaps = [(regions[k][1], regions[k + 1][0])
            for k in range(len(regions) - 1)
            if regions[k + 1][0] - regions[k][1] >= 0.25]
    for i in range(len(refined) - 1):
        a, b = refined[i], refined[i + 1]
        ae, bs = a.end_us / US, b.start_us / US
        if bs - ae > 0.05:
            continue  # 이미 떨어져 있는 자막은 그대로
        cand = [(gs, ge) for gs, ge in gaps
                if a.start_us / US + 0.2 < gs and ge < b.end_us / US - 0.2
                and abs(gs - ae) <= 1.2]
        if not cand:
            continue
        gs, ge = min(cand, key=lambda g: abs(g[0] - ae))
        a.end_us = int(gs * US)
        b.start_us = int(ge * US)

    # 겹침 제거 및 최소 표시시간 보정 (간격 0은 호출부 _close_gaps에서 처리)
    for i, line in enumerate(refined):
        if line.end_us - line.start_us < 500_000:
            line.end_us = line.start_us + 500_000
        if i + 1 < len(refined) and line.end_us > refined[i + 1].start_us:
            line.end_us = refined[i + 1].start_us
    return [l for l in refined if l.end_us > l.start_us]


def _split_lines(words: list, max_words_per_line: int) -> list[SubtitleLine]:
    """어절 단위로 자막을 분할.

    Whisper는 한국어/일본어에서 각 어절을 앞에 공백이 붙은 개별 토큰
    (' 네', ' 여러분', ' 반갑습니다.')으로 반환한다. 즉 words의 각 원소가
    곧 하나의 어절이므로, 이를 max_words_per_line개씩 묶어 라인을 만든다.
    각 라인의 시작/끝 시간은 첫 어절의 시작 ~ 마지막 어절의 끝으로,
    말이 시작하는 지점부터 끝나는 지점까지 정확히 맞춘다.
    """
    lines: list[SubtitleLine] = []
    cur: list = []  # 현재 라인에 쌓인 어절(단어 객체)들

    def flush() -> None:
        nonlocal cur
        if not cur:
            return
        text = "".join(w.word for w in cur).strip()
        if text:
            lines.append(SubtitleLine(
                start_us=int(cur[0].start * US),
                end_us=int(cur[-1].end * US),
                text=text,
                words=[(w.word, int(w.start * US), int(w.end * US)) for w in cur],
            ))
        cur = []

    for w in words:
        token = w.word.strip()
        if not token:  # 순수 공백 토큰(드묾)은 건너뜀
            continue

        # 어절 사이 침묵이 0.8초 이상이면 여기서 라인 분리
        if cur and w.start - cur[-1].end > 0.8:
            flush()

        cur.append(w)

        # 어절 수가 상한에 도달하면 라인 분리
        if len(cur) >= max_words_per_line:
            flush()
            continue

        # 문장 끝(.!? 등) 또는 6초 초과 시 라인 분리
        if _SENTENCE_END.search(token) or (w.end - cur[0].start) > 6.0:
            flush()

    flush()

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
