"""Small development-mode helpers."""

from __future__ import annotations

import os
import time
from typing import Any


def is_dev_mode() -> bool:
    return os.environ.get("HUNMINSYNC_DEV", "").lower() in {"1", "true", "yes"}


def dev_log(tag: str, message: str, *extra: Any) -> None:
    if not is_dev_mode():
        return
    suffix = " ".join(str(value) for value in extra if value is not None)
    print(f"[{time.strftime('%H:%M:%S')}] [{tag}] {message} {suffix}".rstrip(), flush=True)
