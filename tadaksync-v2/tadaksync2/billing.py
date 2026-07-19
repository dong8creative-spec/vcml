"""타닥싱크 코인 정책 — 인식 30초/1코인, 번역 20초/10코인, 줄 나눔 auto 1 / manual 2."""

from __future__ import annotations

import math

RECOGNITION_BILLING_UNIT_SEC = 30
TRANSLATION_BILLING_UNIT_SEC = 20
BILLING_UNIT_SEC = TRANSLATION_BILLING_UNIT_SEC
RECOGNITION_COINS_PER_UNIT = 1
LINE_SPLIT_AUTO_COINS = 1
LINE_SPLIT_MANUAL_COINS = 2
# 하위 호환
LINE_SPLIT_FLAT_COINS = LINE_SPLIT_AUTO_COINS
LINE_SPLIT_COINS_PER_UNIT = LINE_SPLIT_AUTO_COINS
TRANSLATION_COINS_PER_UNIT = 10
COIN_WON_REFERENCE = 15


def normalize_line_split_mode(mode: str | None) -> str:
    return "manual" if str(mode or "").strip().lower() == "manual" else "auto"


def billing_meta() -> dict:
    return {
        "billing_unit_sec": TRANSLATION_BILLING_UNIT_SEC,
        "recognition_billing_unit_sec": RECOGNITION_BILLING_UNIT_SEC,
        "translation_billing_unit_sec": TRANSLATION_BILLING_UNIT_SEC,
        "recognition_coins_per_unit": RECOGNITION_COINS_PER_UNIT,
        "line_split_auto_coins": LINE_SPLIT_AUTO_COINS,
        "line_split_manual_coins": LINE_SPLIT_MANUAL_COINS,
        "line_split_flat_coins": LINE_SPLIT_FLAT_COINS,
        "line_split_coins_per_unit": LINE_SPLIT_COINS_PER_UNIT,
        "translation_coins_per_unit": TRANSLATION_COINS_PER_UNIT,
        "coin_won_reference": COIN_WON_REFERENCE,
    }


def recognition_billing_units_from_duration_us(duration_us: int) -> int:
    sec = max(0.0, float(duration_us) / 1_000_000.0)
    return max(1, int(math.ceil(sec / RECOGNITION_BILLING_UNIT_SEC)))


def translation_billing_units_from_duration_us(duration_us: int) -> int:
    sec = max(0.0, float(duration_us) / 1_000_000.0)
    return max(1, int(math.ceil(sec / TRANSLATION_BILLING_UNIT_SEC)))


def billing_units_from_duration_us(duration_us: int) -> int:
    return translation_billing_units_from_duration_us(duration_us)


def recognition_coins(duration_us: int) -> int:
    return recognition_billing_units_from_duration_us(duration_us) * RECOGNITION_COINS_PER_UNIT


def line_split_coins(_duration_us: int, mode: str | None = "auto") -> int:
    return LINE_SPLIT_MANUAL_COINS if normalize_line_split_mode(mode) == "manual" else LINE_SPLIT_AUTO_COINS


def translation_coins(duration_us: int) -> int:
    return translation_billing_units_from_duration_us(duration_us) * TRANSLATION_COINS_PER_UNIT


def duration_us_from_audio(audio_len: int, sample_rate: int = 16000) -> int:
    samples = max(0, int(audio_len))
    rate = max(1, int(sample_rate))
    return int(samples * 1_000_000 / rate)


def duration_us_from_blocks(blocks: list[dict]) -> int:
    ends = [int(b.get("end_us", 0) or 0) for b in (blocks or [])]
    return max(ends) if ends else 0


def minutes_label_from_duration_us(duration_us: int) -> int:
    return max(1, int(math.ceil(max(0, duration_us) / 60_000_000)))
