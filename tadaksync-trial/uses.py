"""체험 횟수 — 기본 10회, 퀴즈 정답마다 10회 추가."""

from __future__ import annotations

import json
import os
import random
import unicodedata
from pathlib import Path

MAX_USES = 10
APP_DIR_NAME = "TadakSyncTrial"
QUIZZES = (
    {"question": "이 프로그램을 개발한 사람은?", "answer": "도각쌤"},
    {"question": "영상편집의 기본 단축키 대표적인 3개는?", "answer": "qwe"},
)


def _state_path() -> Path:
    base = os.environ.get("APPDATA") or str(Path.home() / ".config")
    folder = Path(base) / APP_DIR_NAME
    folder.mkdir(parents=True, exist_ok=True)
    return folder / "uses.json"


def _load() -> dict:
    path = _state_path()
    if not path.exists():
        return {"used": 0, "granted": MAX_USES}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        used = max(0, int(data.get("used") or 0))
        if "granted" in data:
            granted = max(MAX_USES, int(data.get("granted") or MAX_USES))
        elif data.get("unlocked"):
            granted = used + MAX_USES
        else:
            granted = MAX_USES
        return {"used": used, "granted": granted}
    except (OSError, ValueError, json.JSONDecodeError):
        return {"used": 0, "granted": MAX_USES}


def _save(data: dict) -> None:
    _state_path().write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def remaining() -> int:
    data = _load()
    return max(0, data["granted"] - data["used"])


def can_use() -> bool:
    return remaining() > 0


def remaining_label() -> str:
    return f"{remaining()}회"


def consume_one() -> str:
    data = _load()
    data["used"] = data["used"] + 1
    _save(data)
    return f"{max(0, data['granted'] - data['used'])}회"


def _normalize_answer(text: str) -> str:
    value = unicodedata.normalize("NFC", str(text or ""))
    return "".join(value.split()).casefold()


def pick_quiz() -> dict:
    return random.choice(QUIZZES)


def check_quiz_answer(quiz: dict, text: str) -> bool:
    return _normalize_answer(text) == _normalize_answer(quiz["answer"])


def grant_quiz_bonus() -> int:
    data = _load()
    data["granted"] = data["granted"] + MAX_USES
    _save(data)
    return remaining()
