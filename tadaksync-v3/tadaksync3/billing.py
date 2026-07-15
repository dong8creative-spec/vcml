"""타닥싱크 코인 정책 — 20초 단위 올림 차감."""

from __future__ import annotations

import math

BILLING_UNIT_SEC = 20
RECOGNITION_COINS_PER_UNIT = 1
LINE_SPLIT_COINS_PER_UNIT = 1
TRANSLATION_COINS_PER_UNIT = 10
COIN_WON_REFERENCE = 15


def billing_meta() -> dict:
    return {
        "billing_unit_sec": BILLING_UNIT_SEC,
        "recognition_coins_per_unit": RECOGNITION_COINS_PER_UNIT,
        "line_split_coins_per_unit": LINE_SPLIT_COINS_PER_UNIT,
        "translation_coins_per_unit": TRANSLATION_COINS_PER_UNIT,
        "coin_won_reference": COIN_WON_REFERENCE,
    }


def billing_units_from_duration_us(duration_us: int) -> int:
    sec = max(0.0, float(duration_us) / 1_000_000.0)
    return max(1, int(math.ceil(sec / BILLING_UNIT_SEC)))


def recognition_coins(duration_us: int) -> int:
    return billing_units_from_duration_us(duration_us) * RECOGNITION_COINS_PER_UNIT


def line_split_coins(duration_us: int) -> int:
    return billing_units_from_duration_us(duration_us) * LINE_SPLIT_COINS_PER_UNIT


def translation_coins(duration_us: int) -> int:
    return billing_units_from_duration_us(duration_us) * TRANSLATION_COINS_PER_UNIT


def duration_us_from_audio(audio_len: int, sample_rate: int = 16000) -> int:
    samples = max(0, int(audio_len))
    rate = max(1, int(sample_rate))
    return int(samples * 1_000_000 / rate)


def duration_us_from_blocks(blocks: list[dict]) -> int:
    ends = [int(b.get("end_us", 0) or 0) for b in (blocks or [])]
    return max(ends) if ends else 0


def minutes_label_from_duration_us(duration_us: int) -> int:
    return max(1, int(math.ceil(max(0, duration_us) / 60_000_000)))
