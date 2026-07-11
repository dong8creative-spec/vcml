"""타닥싱크(TadakSync) — 웹 라이선스/코인 연동."""

from __future__ import annotations

import json
import math
import os
import shutil
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import webbrowser
from pathlib import Path

DEFAULT_API_BASE = os.environ.get("CAPCUT_SUBTITLE_API", "https://vcml.kr")
APP_DIR_NAME = "TadakSync"
LEGACY_APP_DIR_NAME = "CapCutSubtitle"
AUTH_FILE = "auth.json"
POLL_INTERVAL_SEC = 2.0
POLL_TIMEOUT_SEC = 10 * 60


def app_data_dir() -> Path:
    base = os.environ.get("APPDATA") or str(Path.home() / ".config")
    path = Path(base) / APP_DIR_NAME
    path.mkdir(parents=True, exist_ok=True)
    # 구버전(CapCutSubtitle) 로그인 정보 이전
    legacy = Path(base) / LEGACY_APP_DIR_NAME / AUTH_FILE
    current = path / AUTH_FILE
    if legacy.exists() and not current.exists():
        try:
            shutil.copy2(legacy, current)
        except OSError:
            pass
    return path


def auth_path() -> Path:
    return app_data_dir() / AUTH_FILE


def load_auth() -> dict | None:
    path = auth_path()
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not data.get("token"):
        return None
    return data


def save_auth(token: str, user_name: str | None = None, balance: int | None = None) -> dict:
    data = {
        "token": token,
        "user_name": user_name,
        "balance": balance,
        "saved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    auth_path().write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return data


def clear_auth() -> None:
    path = auth_path()
    if path.exists():
        path.unlink()


def api_base() -> str:
    return (os.environ.get("CAPCUT_SUBTITLE_API") or DEFAULT_API_BASE).rstrip("/")


def _request(method: str, path: str, body: dict | None = None, token: str | None = None) -> dict:
    url = api_base() + path
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            raw = res.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload = {}
        msg = payload.get("error") or f"HTTP {e.code}"
        err = RuntimeError(msg)
        err.status = e.code  # type: ignore[attr-defined]
        err.payload = payload  # type: ignore[attr-defined]
        raise err from None
    except urllib.error.URLError as e:
        raise RuntimeError(f"서버에 연결하지 못했습니다: {e.reason}") from None


def minutes_from_audio(audio_len: int, sample_rate: int = 16000) -> int:
    seconds = max(0.0, float(audio_len) / float(sample_rate))
    return max(1, int(math.ceil(seconds / 60.0)))


def new_job_id() -> str:
    return uuid.uuid4().hex


def start_device_login(on_status=None) -> dict:
    """브라우저 연동 후 수강 권한 확인·JWT 저장. 성공 시 auth dict 반환."""
    started = _request("POST", "/api/subtitle/device/start")
    code = started.get("code")
    verify_url = started.get("verify_url")
    if not code or not verify_url:
        raise RuntimeError("연동 코드를 받지 못했습니다.")
    if on_status:
        on_status(f"브라우저에서 구글 로그인 후 연동하세요. 코드: {code}")
    webbrowser.open(verify_url)

    deadline = time.time() + POLL_TIMEOUT_SEC
    while time.time() < deadline:
        time.sleep(POLL_INTERVAL_SEC)
        polled = _request("GET", "/api/subtitle/device/poll?" + urllib.parse.urlencode({"code": code}))
        status = polled.get("status")
        if status == "denied":
            msg = polled.get("error") or "이용 권한이 없습니다."
            code = polled.get("code")
            if code == "not_enrolled":
                msg = polled.get("error") or (
                    "캡컷 초신속 스탠다드 강의를 수강 중인 분만 이용할 수 있습니다."
                )
            elif code == "google_required":
                msg = polled.get("error") or "구글 로그인 계정만 이용할 수 있습니다."
            clear_auth()
            raise RuntimeError(msg)
        if status == "approved" and polled.get("token"):
            token = polled["token"]
            user_name = polled.get("user_name")
            try:
                me = verify_entitlement(token)
            except RuntimeError:
                clear_auth()
                raise
            return save_auth(token, user_name, me.get("balance"))
        if status in ("expired", "invalid"):
            raise RuntimeError("연동 코드가 만료되었습니다. 다시 로그인해 주세요.")
        if on_status:
            on_status(f"연동 대기 중… 코드 {code}")
    raise RuntimeError("연동 시간이 초과되었습니다. 다시 시도해 주세요.")


def fetch_me(token: str) -> dict:
    return _request("GET", "/api/subtitle/me", token=token)


def verify_entitlement(token: str) -> dict:
    """수강·구글 권한 확인. 실패 시 RuntimeError (payload.code 포함)."""
    try:
        return fetch_me(token)
    except RuntimeError as e:
        payload = getattr(e, "payload", None) or {}
        code = payload.get("code")
        if code == "not_enrolled":
            raise RuntimeError(
                payload.get("error")
                or "캡컷 초신속 스탠다드 강의를 수강 중인 분만 이용할 수 있습니다."
            ) from e
        if code == "google_required":
            raise RuntimeError(
                payload.get("error")
                or "구글 로그인 계정만 이용할 수 있습니다."
            ) from e
        raise


def consume(token: str, minutes: int, job_id: str) -> dict:
    return _request(
        "POST",
        "/api/subtitle/consume",
        body={"minutes": minutes, "job_id": job_id},
        token=token,
    )


def refund(token: str, job_id: str) -> dict:
    return _request(
        "POST",
        "/api/subtitle/refund",
        body={"job_id": job_id},
        token=token,
    )
