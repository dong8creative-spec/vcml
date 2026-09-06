"""개발 모드 — API 호출·이벤트를 터미널에 실시간 출력."""

from __future__ import annotations

import os
import time
import traceback
from typing import Any


def is_dev_mode() -> bool:
    return (
        os.environ.get("TADAKSYNC_DEV") == "1"
        or os.environ.get("TADAKSYNC_DEBUG") == "1"
    )


def dev_log(tag: str, message: str, *extra: Any) -> None:
    if not is_dev_mode():
        return
    ts = time.strftime("%H:%M:%S")
    tail = " ".join(str(x) for x in extra if x is not None and x != "")
    line = f"[{ts}] [{tag}] {message}"
    if tail:
        line += f" {tail}"
    try:
        print(line, flush=True)
    except UnicodeEncodeError:
        print(line.encode('ascii', 'replace').decode('ascii'), flush=True)


class DevApiWrapper:
    """Api 인스턴스를 감싸 JS→Python 호출을 터미널에 기록한다."""

    def __init__(self, api: Any) -> None:
        object.__setattr__(self, "_api", api)

    def __getattr__(self, name: str) -> Any:
        api = object.__getattribute__(self, "_api")
        attr = getattr(api, name)
        if not callable(attr):
            return attr

        def wrapped(*args, **kwargs):
            preview = ""
            if args:
                preview = repr(args[0])[:120]
            dev_log("API", f"{name}({preview})")
            t0 = time.perf_counter()
            try:
                result = attr(*args, **kwargs)
                elapsed = time.perf_counter() - t0
                ok = result.get("ok") if isinstance(result, dict) else "—"
                err = result.get("error") if isinstance(result, dict) else None
                if err:
                    dev_log("API", f"{name} ← ok={ok} ({elapsed:.2f}s)", f"error={err}")
                else:
                    dev_log("API", f"{name} ← ok={ok} ({elapsed:.2f}s)")
                return result
            except Exception as exc:
                elapsed = time.perf_counter() - t0
                dev_log("API", f"{name} EXCEPTION ({elapsed:.2f}s)", exc)
                traceback.print_exc()
                raise

        return wrapped

    def __setattr__(self, name: str, value: Any) -> None:
        setattr(object.__getattribute__(self, "_api"), name, value)
