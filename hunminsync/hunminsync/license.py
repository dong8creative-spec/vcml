"""Shared vcml.kr /api/subtitle authentication and coin endpoints."""

from __future__ import annotations

import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import webbrowser
from pathlib import Path

DEFAULT_API_BASE = "https://vcml.kr"
APP_DIR_NAME = "HunminSync"
AUTH_FILE = "auth.json"
DEVICE_FILE = "device_id.txt"


def app_data_dir() -> Path:
    if sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    elif os.name == "nt":
        base = Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming")
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
    path = base / APP_DIR_NAME
    path.mkdir(parents=True, exist_ok=True)
    # Keep the existing TadakSync login bound to the same physical device.
    # Files are copied into HunminSync's own settings directory, so later
    # logout or settings changes remain product-local.
    tadak_dir = base / "TadakSync"
    for name in (DEVICE_FILE, AUTH_FILE):
        source, target = tadak_dir / name, path / name
        if not target.exists() and source.is_file():
            try:
                shutil.copy2(source, target)
            except OSError:
                pass
    return path


def api_base() -> str:
    return os.environ.get("CAPCUT_SUBTITLE_API", DEFAULT_API_BASE).rstrip("/")


def get_device_id() -> str:
    path = app_data_dir() / DEVICE_FILE
    if path.exists():
        value = path.read_text(encoding="utf-8").strip()
        if len(value) >= 16:
            return value
    value = uuid.uuid4().hex
    path.write_text(value, encoding="utf-8")
    return value


def load_auth() -> dict | None:
    try:
        data = json.loads((app_data_dir() / AUTH_FILE).read_text(encoding="utf-8"))
        return data if data.get("token") else None
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return None


def save_auth(token: str, user_name: str | None = None,
              balance: int | None = None, email: str | None = None) -> dict:
    data = {
        "token": token, "user_name": user_name, "balance": balance, "email": email,
        "saved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    (app_data_dir() / AUTH_FILE).write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return data


def clear_auth() -> None:
    (app_data_dir() / AUTH_FILE).unlink(missing_ok=True)


def _request(method: str, endpoint: str, body: dict | None = None,
             token: str | None = None, timeout: float = 30) -> dict:
    headers = {"Accept": "application/json", "X-Subtitle-Device-Id": get_device_id()}
    payload = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        payload = json.dumps(body).encode("utf-8")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(
        api_base() + endpoint, data=payload, headers=headers, method=method
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            server_payload = json.loads(raw)
        except json.JSONDecodeError:
            server_payload = {}
        error = RuntimeError(server_payload.get("error") or f"HTTP {exc.code}")
        error.status = exc.code  # type: ignore[attr-defined]
        error.payload = server_payload  # type: ignore[attr-defined]
        raise error from None
    except urllib.error.URLError as exc:
        raise RuntimeError(f"서버에 연결하지 못했어요: {exc.reason}") from None


def start_device_login(on_status=None, on_code=None, cancel_event=None) -> dict:
    started = _request("POST", "/api/subtitle/device/start", {"device_id": get_device_id()})
    code, verify_url = started.get("code"), started.get("verify_url")
    if not code or not verify_url:
        raise RuntimeError("로그인 연동 코드를 받지 못했어요.")
    if on_code:
        on_code(code, verify_url)
    webbrowser.open(verify_url)
    deadline = time.monotonic() + 600
    while time.monotonic() < deadline:
        if cancel_event is not None and cancel_event.wait(0.5):
            raise RuntimeError("cancelled")
        if cancel_event is None:
            time.sleep(0.5)
        result = _request(
            "GET", "/api/subtitle/device/poll?" + urllib.parse.urlencode({"code": code})
        )
        if result.get("status") == "approved" and result.get("token"):
            me = fetch_me(result["token"])
            return save_auth(
                me.get("token") or result["token"],
                me.get("user_name") or me.get("name") or result.get("user_name"),
                me.get("balance"),
                me.get("email"),
            )
        if result.get("status") in {"denied", "expired", "invalid"}:
            raise RuntimeError(result.get("error") or "로그인 연동에 실패했어요.")
        if on_status:
            on_status(f"브라우저 로그인 대기 중… 코드 {code}")
    raise RuntimeError("로그인 시간이 초과됐어요.")


def fetch_me(token: str) -> dict:
    return _request("GET", "/api/subtitle/me", token=token)


def consume_recognition(token: str, duration_us: int, job_id: str) -> dict:
    return _request("POST", "/api/subtitle/consume",
                    {"duration_us": duration_us, "job_id": job_id}, token)


def consume_manual_split(token: str, duration_us: int, job_id: str) -> dict:
    return _request("POST", "/api/subtitle/consume-lines", {
        "duration_us": duration_us, "job_id": job_id, "split_mode": "manual",
    }, token)


def fetch_history(token: str, limit: int = 30) -> list[dict]:
    data = _request("GET", f"/api/subtitle/history?limit={int(limit)}", token=token)
    return data.get("history", [])


def new_job_id() -> str:
    return uuid.uuid4().hex
