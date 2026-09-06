"""타닥싱크(TadakSync) — vcml.kr API 클라이언트 (광고 슬롯 조회 전용).

로그인·코인 시스템은 제거됐다. 전사·번역·삽입은 전부 로컬에서 무료로 동작하고,
서버와는 배너광고를 가져오고 클릭을 기록하는 용도로만 통신한다.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_API_BASE = os.environ.get("CAPCUT_SUBTITLE_API", "https://vcml.kr")


def api_base() -> str:
    return (os.environ.get("CAPCUT_SUBTITLE_API") or DEFAULT_API_BASE).rstrip("/")


def _request(method: str, path: str, body: dict | None = None) -> dict:
    url = api_base() + path
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
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


def fetch_banner_ad(slot: str) -> dict:
    """전사 중 배너 등 광고 슬롯 조회. 로그인 불필요(접속 IP로 지역 추정)."""
    path = "/api/subtitle/trial-ad?slot=" + urllib.parse.quote(str(slot or ""))
    try:
        return _request("GET", path)
    except RuntimeError:
        return {"enabled": False}


def report_ad_click(campaign_id: str) -> None:
    if not campaign_id:
        return
    try:
        _request("POST", "/api/subtitle/trial-ad/click", body={"campaign_id": campaign_id})
    except RuntimeError:
        pass
