"""타닥싱크(TadakSync) — 웹 라이선스/코인 연동."""

from __future__ import annotations

import json
import math
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import webbrowser
from pathlib import Path

DEFAULT_API_BASE = os.environ.get("CAPCUT_SUBTITLE_API", "https://vcml.kr")
APP_DIR_NAME = "TadakSync"
AUTH_FILE = "auth.json"
DEVICE_ID_FILE = "device_id.txt"
POLL_INTERVAL_SEC = 0.5
POLL_TIMEOUT_SEC = 10 * 60


def app_data_dir() -> Path:
    base = os.environ.get("APPDATA") or str(Path.home() / ".config")
    path = Path(base) / APP_DIR_NAME
    path.mkdir(parents=True, exist_ok=True)
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


def save_auth(token: str, user_name: str | None = None, balance: int | None = None,
              email: str | None = None) -> dict:
    prev = load_auth() or {}
    data = {
        "token": token,
        "user_name": user_name if user_name is not None else prev.get("user_name"),
        "balance": balance,
        "email": email if email is not None else prev.get("email"),
        "saved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    auth_path().write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return data


def clear_auth() -> None:
    path = auth_path()
    if path.exists():
        path.unlink()


def get_device_id() -> str:
    """이 PC 고유 기기 ID (계정당 1프로그램 연동용)."""
    path = app_data_dir() / DEVICE_ID_FILE
    if path.exists():
        try:
            did = path.read_text(encoding="utf-8").strip()
            if len(did) >= 16:
                return did
        except OSError:
            pass
    did = uuid.uuid4().hex
    try:
        path.write_text(did, encoding="utf-8")
    except OSError:
        pass
    return did


def api_base() -> str:
    return (os.environ.get("CAPCUT_SUBTITLE_API") or DEFAULT_API_BASE).rstrip("/")


def review_write_url(course_id: str | None = None) -> str:
    """마이페이지 수강 후기 작성 화면 URL."""
    params = {"tab": "courses"}
    if course_id:
        params["review_course"] = course_id
    return f"{api_base()}/mypage.html?{urllib.parse.urlencode(params)}"


def _request(method: str, path: str, body: dict | None = None, token: str | None = None,
             device_id: str | None = None) -> dict:
    url = api_base() + path
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    did = device_id or (get_device_id() if token else None)
    if did:
        headers["X-Subtitle-Device-Id"] = did
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
        raise RuntimeError(f"서버에 연결하지 못했어요: {e.reason}") from None


def minutes_from_audio(audio_len: int, sample_rate: int = 16000) -> int:
    seconds = max(0.0, float(audio_len) / float(sample_rate))
    return max(1, int(math.ceil(seconds / 60.0)))


def new_job_id() -> str:
    return uuid.uuid4().hex


def start_device_login(on_status=None, on_code=None, cancel_event=None) -> dict:
    """브라우저 연동 후 수강 권한 확인·JWT 저장. 성공 시 auth dict 반환.

    on_code(code, verify_url)는 연동 코드가 발급된 직후 한 번 호출된다(팝업에 코드 표시용).
    cancel_event가 set되면 폴링을 즉시 중단하고 RuntimeError("cancelled")를 던진다.
    """
    started = _request("POST", "/api/subtitle/device/start",
                       body={"device_id": get_device_id()})
    code = started.get("code")
    verify_url = started.get("verify_url")
    if not code or not verify_url:
        raise RuntimeError("연동 코드를 받지 못했어요. 다시 시도해 주세요.")
    if on_code:
        on_code(code, verify_url)
    if on_status:
        on_status(f"브라우저에서 구글 로그인 후 연동해 주세요. 코드: {code}")
    webbrowser.open(verify_url)

    deadline = time.time() + POLL_TIMEOUT_SEC
    while time.time() < deadline:
        if cancel_event is not None and cancel_event.is_set():
            raise RuntimeError("cancelled")
        time.sleep(POLL_INTERVAL_SEC)
        if cancel_event is not None and cancel_event.is_set():
            raise RuntimeError("cancelled")
        polled = _request("GET", "/api/subtitle/device/poll?" + urllib.parse.urlencode({"code": code}))
        status = polled.get("status")
        if status == "denied":
            msg = polled.get("error") or "이용 권한이 없어요."
            code = polled.get("code")
            if code == "not_enrolled":
                msg = polled.get("error") or (
                    "캡컷 초신속 스탠다드 강의를 수강 중인 분만 이용할 수 있어요."
                )
            elif code == "google_required":
                msg = polled.get("error") or "구글 로그인 계정만 이용할 수 있어요."
            elif code in ("session_revoked", "device_mismatch"):
                msg = polled.get("error") or "다른 기기에서 로그인되어 연동이 해제됐어요."
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
            return save_auth(me.get("token") or token, user_name, me.get("balance"), me.get("email"))
        if status in ("expired", "invalid"):
            raise RuntimeError("연동 코드가 만료됐어요. 다시 로그인해 주세요.")
        if on_status:
            on_status(f"연동 대기 중… 코드 {code}")
    raise RuntimeError("연동 시간이 초과됐어요. 다시 시도해 주세요.")


def fetch_me(token: str) -> dict:
    return _request("GET", "/api/subtitle/me", token=token)


def verify_entitlement(token: str) -> dict:
    """수강·구글 권한 확인. 실패 시 RuntimeError (payload.code / status 포함)."""
    try:
        me = fetch_me(token)
    except RuntimeError as e:
        payload = getattr(e, "payload", None) or {}
        code = payload.get("code")
        if code == "not_enrolled":
            err = RuntimeError(
                payload.get("error")
                or "캡컷 초신속 스탠다드 강의를 수강 중인 분만 이용할 수 있어요.")
            err.status = getattr(e, "status", 403)  # type: ignore[attr-defined]
        elif code == "google_required":
            err = RuntimeError(
                payload.get("error")
                or "구글 로그인 계정만 이용할 수 있어요.")
            err.status = getattr(e, "status", 403)  # type: ignore[attr-defined]
        elif code == "session_revoked":
            err = RuntimeError(
                payload.get("error")
                or "다른 기기에서 로그인되어 이 기기의 연동이 해제됐어요.")
            err.status = 401  # type: ignore[attr-defined]
        elif code == "device_mismatch":
            err = RuntimeError(
                payload.get("error")
                or "이 기기와 연동된 계정이 아니에요. 다시 로그인해 주세요.")
            err.status = 401  # type: ignore[attr-defined]
        elif code in ("subtitle_login_required", "device_required", "token_expired"):
            err = RuntimeError(
                payload.get("error")
                or "기기 연동이 만료됐어요. 다시 로그인해 주세요.")
            err.status = 401  # type: ignore[attr-defined]
        else:
            raise
        err.payload = payload  # type: ignore[attr-defined]
        raise err from e
    if not me.get("enrolled"):
        err = RuntimeError(
            "캡컷 초신속 스탠다드 강의를 수강 중인 분만 이용할 수 있어요.")
        err.status = 403  # type: ignore[attr-defined]
        raise err
    return me


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


def fetch_history(token: str, limit: int = 30) -> list[dict]:
    result = _request("GET", f"/api/subtitle/history?limit={limit}", token=token)
    return result.get("history", [])


def claim_smartstore_review(token: str) -> dict:
    return _request("POST", "/api/subtitle/smartstore-review/claim", body={}, token=token)


def ack_inbox(token: str, message_ids: list[str]) -> dict:
    return _request("POST", "/api/subtitle/inbox/ack",
                    body={"message_ids": message_ids}, token=token)
