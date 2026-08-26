"""영구 라이선스 로컬 저장 — 서버가 키를 확인해준 결과를 기기에 남겨둔다."""

from __future__ import annotations

import json
import os
from pathlib import Path

APP_DIR_NAME = "TadakSyncTrial"


def _state_path() -> Path:
    base = os.environ.get("APPDATA") or str(Path.home() / ".config")
    folder = Path(base) / APP_DIR_NAME
    folder.mkdir(parents=True, exist_ok=True)
    return folder / "license.json"


def load() -> dict:
    path = _state_path()
    if not path.exists():
        return {"unlocked": False, "key": None, "tier": None}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return {
            "unlocked": bool(data.get("unlocked")),
            "key": data.get("key"),
            "tier": data.get("tier"),
        }
    except (OSError, ValueError, json.JSONDecodeError):
        return {"unlocked": False, "key": None, "tier": None}


def save(key: str, tier: str) -> dict:
    data = {"unlocked": True, "key": key, "tier": tier}
    _state_path().write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return data


def clear() -> dict:
    data = {"unlocked": False, "key": None, "tier": None}
    _state_path().write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return data
