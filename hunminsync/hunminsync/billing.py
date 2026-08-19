"""HunminSync MVP coin policy."""

from __future__ import annotations

import math

RECOGNITION_UNIT_SECONDS = 30
RECOGNITION_COINS_PER_UNIT = 1
MANUAL_SPLIT_COINS = 2


def recognition_coins(duration_us: int) -> int:
    """30 seconds (or fraction) costs one coin; empty media costs zero."""
    if duration_us <= 0:
        return 0
    return math.ceil(duration_us / (RECOGNITION_UNIT_SECONDS * 1_000_000))


def manual_split_coins() -> int:
    return MANUAL_SPLIT_COINS


def billing_meta() -> dict:
    return {
        "recognition_unit_seconds": RECOGNITION_UNIT_SECONDS,
        "recognition_coins_per_unit": RECOGNITION_COINS_PER_UNIT,
        "manual_split_coins": MANUAL_SPLIT_COINS,
    }
