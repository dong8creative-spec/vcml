"""
로컬 오디오 → 자막(SRT/VTT) 웹 API (웹 전용 단일 패키지: `subtitle-web-app`).

실행 예:
  uvicorn main:app --host 0.0.0.0 --port 8765
  PORT 환경 변수가 있으면(예: Railway, Render) 해당 포트를 사용하세요.

Docker: 저장소의 Dockerfile / docker-compose.yml 참고.
사전 요구: ffmpeg·ffprobe가 PATH에 있음(이미지에 포함됨), pip install -r requirements.txt

정확도 관련 환경 변수(예시):
  WHISPER_MODEL=base|small|medium|large-v3  (기본 medium)
  WHISPER_BEAM_SIZE=5~10               (클수록 약간 유리할 수 있으나 느려짐, 기본 5)
  WHISPER_DEVICE=cuda                  (GPU 사용 시)
  WHISPER_COMPUTE=float16              (GPU일 때)
  MAX_AUDIO_DURATION_SEC=120           (업로드 허용 최대 길이 초, 기본 120=2분, 0이면 제한 없음)

타임코드: 업로드 폼의「시작 시각 보정(초)」로 전사 구간 전체를 앞·뒤로 밀 수 있음(음수=앞당김).
선두 무음: 첫 인식 자막 시작 전이 LEADING_SILENCE_MIN_SEC(기본 0.12) 이상이면 텍스트 없는 블랭크 큐를 하나 둡니다.
미리보기: 완료 시 원본 파일 사본이 SUBTITLE_PREVIEW_DIR(기본: 임시 폴더/subtitle_web_preview)에 저장됩니다.
  POST /api/preview-cache/clear — 위 사본만 삭제(업로드 페이지 등에서 호출 가능).

로컬 사용 횟수(기본 10회, 자막 자동 생성 POST /api/jobs 1회당 1차감):
  저장 위치는 사용자 홈 아래(앱 폴더와 무관)라 재설치해도 유지됩니다.
  VCML_MAX_USES — 허용 횟수(기본 10). 0 이하면 제한 없음.
  VCML_USAGE_BYPASS=1 — 제한 비활성화(개발·Docker·공용 서버 권장).
  VCML_USAGE_SECRET — 기록 위조 방지용 비밀값(선택).

VCML 메인(index) 연동 — 자막 자동생성 메뉴·접속 코드·IP별 할당량:
  VCML_SUBTITLE_GATE=1|0     기본 1. 1이면 접속 코드·쿠키 인증 후에만 자막 앱·API 사용.
  VCML_ACCESS_CODE           기본 0219. POST /api/subtitle-gate 의 code 와 일치해야 함.
  VCML_GATE_SECRET           게이트 쿠키 서명용(선택).
  VCML_CORS_ORIGINS          메인 사이트 출처(쉼표 구분). 비우면 로컬 127.0.0.1·localhost 임의 포트 허용.
  VCML_JOBS_SQLITE           (선택) 자막 작업 상태 SQLite 경로. 기본 $TMPDIR/vcml_subtitle_jobs.sqlite3.
                              Cloud Run 은 인스턴스마다 디스크가 분리되므로 --max-instances=1 권장(또는 공유 DB).
  운영(HTTPS)에서는 게이트 쿠키를 SameSite=None; Secure 로 발급해, 메인에서 fetch 로 코드 입력 후 Run 으로 넘어갈 때 한 번만 입력하면 됩니다.
  VCML_TRANSCRIPTION_QUOTA_MODE=ip|machine  기본 ip(IP별 할당량). machine 은 기존 PC·계정 지문 방식.
  VCML_MAX_USES_PER_IP       IP별 자막 자동 생성 허용 횟수(기본 10). 0 이하면 무제한.
  프록시 뒤에서는 VCML_TRUST_X_FORWARDED_FOR=1 로 실제 클라이언트 IP를 쓰세요.

웹 배포 시 IP 제한(선택):
  VCML_ALLOWED_IPS — 허용할 IP 또는 CIDR을 쉼표로 구분(예: 203.0.113.10,192.168.0.0/24).
  비우면 제한 없음. 리버스 프록시 뒤에서는 VCML_TRUST_X_FORWARDED_FOR=1 과 함께 쓰되,
  프록시에서 X-Forwarded-For를 덮어쓰도록 설정해야 합니다(직접 노출 시 위조 가능).
"""

from __future__ import annotations

import getpass
import hashlib
import hmac
import ipaddress
import mimetypes
import os
import platform
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass
from types import SimpleNamespace
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

STATIC = Path(__file__).resolve().parent / "static"
ALLOWED_EXT = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".flac", ".webm", ".mp4", ".mpeg", ".mpga"}
PREVIEW_VIDEO_EXT = {".mp4", ".webm", ".mpeg"}

_model = None

jobs_lock = threading.Lock()
_jobs_init_lock = threading.Lock()
_jobs_sqlite: Optional[sqlite3.Connection] = None

# 작업 ID는 uuid.uuid4().hex (32자리 16진) 만 허용 — 잘못된 URL·캐시 깨짐 시 원인 구분용
_JOB_ID_RE = re.compile(r"^[a-f0-9]{32}$")


def _jobs_db_path() -> Path:
    raw = (os.environ.get("VCML_JOBS_SQLITE") or "").strip()
    if raw:
        return Path(raw)
    return Path(os.environ.get("TMPDIR", "/tmp")) / "vcml_subtitle_jobs.sqlite3"


def _jobs_conn_unlocked() -> sqlite3.Connection:
    """단일 연결 + WAL. 호출부에서 jobs_lock(또는 _jobs_init_lock)으로 직렬화."""
    global _jobs_sqlite
    if _jobs_sqlite is not None:
        return _jobs_sqlite
    with _jobs_init_lock:
        if _jobs_sqlite is not None:
            return _jobs_sqlite
        path = _jobs_db_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(path), check_same_thread=False, timeout=120.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS jobs (
              id TEXT PRIMARY KEY NOT NULL,
              status TEXT NOT NULL,
              progress INTEGER NOT NULL DEFAULT 0,
              phase TEXT,
              error TEXT,
              body_bytes BLOB,
              media_type TEXT,
              download_filename TEXT,
              ext TEXT,
              duration_sec REAL,
              download_base TEXT,
              preview_path TEXT
            );
            """
        )
        conn.commit()
        _jobs_sqlite = conn
    return _jobs_sqlite


def _job_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "status": row["status"],
        "progress": row["progress"],
        "phase": row["phase"],
        "error": row["error"],
        "body_bytes": row["body_bytes"],
        "media_type": row["media_type"],
        "download_filename": row["download_filename"],
        "ext": row["ext"],
        "duration_sec": row["duration_sec"],
        "download_base": row["download_base"],
        "preview_path": row["preview_path"],
    }


def _job_tuple_for_write(job_id: str, d: dict[str, Any]) -> tuple:
    return (
        job_id,
        str(d.get("status") or "unknown"),
        int(d.get("progress") or 0),
        d.get("phase"),
        d.get("error"),
        d.get("body_bytes"),
        d.get("media_type"),
        d.get("download_filename"),
        d.get("ext"),
        d.get("duration_sec"),
        d.get("download_base"),
        d.get("preview_path"),
    )


def _validate_job_id(job_id: str) -> str:
    j = (job_id or "").strip().lower()
    if not _JOB_ID_RE.match(j):
        raise HTTPException(
            status_code=400,
            detail="잘못된 작업 ID입니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.",
        )
    return j


def _job_get(job_id: str) -> Optional[dict[str, Any]]:
    with jobs_lock:
        conn = _jobs_conn_unlocked()
        row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    return _job_row_to_dict(row) if row else None


def _job_insert(job_id: str, row: dict[str, Any]) -> None:
    with jobs_lock:
        conn = _jobs_conn_unlocked()
        conn.execute(
            """
            INSERT INTO jobs (id,status,progress,phase,error,body_bytes,media_type,download_filename,ext,duration_sec,download_base,preview_path)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            _job_tuple_for_write(job_id, row),
        )
        conn.commit()


def _usage_limit_db_path() -> Path:
    home = Path.home()
    if os.name == "nt":
        local = os.environ.get("LOCALAPPDATA")
        base = Path(local) if local else home / "AppData" / "Local"
        return base / "VCMLSubtitle" / "usage_limit.sqlite3"
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / "VCMLSubtitle" / "usage_limit.sqlite3"
    return home / ".local" / "share" / "vcml-subtitle" / "usage_limit.sqlite3"


def _machine_fingerprint() -> str:
    blob = "|".join(
        [
            str(uuid.getnode()),
            platform.node() or "",
            getpass.getuser() or "",
            sys.platform,
        ]
    ).encode("utf-8", errors="replace")
    return hashlib.sha256(blob).hexdigest()[:40]


def _usage_hmac_key() -> bytes:
    s = os.environ.get("VCML_USAGE_SECRET", "vcml-subtitle-quota-v1")
    return hashlib.sha256(s.encode("utf-8")).digest()


def _sign_usage(mid: str, n: int) -> str:
    msg = f"{mid}|{n}".encode("utf-8")
    return hmac.new(_usage_hmac_key(), msg, hashlib.sha256).hexdigest()


def _verify_usage(mid: str, n: int, mac: str) -> bool:
    try:
        return hmac.compare_digest(_sign_usage(mid, n), mac)
    except Exception:
        return False


def try_consume_local_transcription_quota() -> None:
    """
    자막 자동 생성(Whisper) 1회를 허용할 때 호출. 초과 시 HTTP 403.
    홈 디렉터리 외부 SQLite에 누적(프로젝트 재설치와 무관).
    """
    bypass = os.environ.get("VCML_USAGE_BYPASS", "").strip().lower()
    if bypass in ("1", "true", "yes", "on"):
        return
    try:
        max_uses = int(os.environ.get("VCML_MAX_USES", "10"))
    except ValueError:
        max_uses = 10
    if max_uses <= 0:
        return

    db_path = _usage_limit_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    mid = _machine_fingerprint()

    conn = sqlite3.connect(str(db_path), timeout=30)
    try:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS quota ("
            "id INTEGER PRIMARY KEY CHECK (id=1), mid TEXT NOT NULL, n INTEGER NOT NULL, mac TEXT NOT NULL)"
        )
        row = conn.execute("SELECT mid, n, mac FROM quota WHERE id=1").fetchone()
        if row is None:
            n = 0
            mac = _sign_usage(mid, n)
            conn.execute(
                "INSERT INTO quota (id, mid, n, mac) VALUES (1, ?, ?, ?)",
                (mid, n, mac),
            )
            conn.commit()
        else:
            stored_mid, n, mac = row
            if stored_mid != mid:
                raise HTTPException(
                    status_code=403,
                    detail="사용 기록이 이 PC·계정과 일치하지 않습니다. 자막 자동 생성을 계속할 수 없습니다.",
                )
            if not _verify_usage(str(stored_mid), int(n), str(mac)):
                raise HTTPException(
                    status_code=403,
                    detail="사용 기록이 손상되었거나 변조되었습니다. 더 이상 자막 자동 생성을 사용할 수 없습니다.",
                )

        if int(n) >= max_uses:
            raise HTTPException(
                status_code=403,
                detail=f"이 PC에서는 자막 자동 생성을 {max_uses}회까지만 사용할 수 있습니다. 허용 횟수를 모두 사용했습니다.",
            )

        n2 = int(n) + 1
        mac2 = _sign_usage(mid, n2)
        conn.execute("UPDATE quota SET n=?, mac=? WHERE id=1", (n2, mac2))
        conn.commit()
    finally:
        conn.close()


def _ip_quota_db_path() -> Path:
    raw = (os.environ.get("VCML_IP_QUOTA_DB") or "").strip()
    if raw:
        return Path(raw)
    return _usage_limit_db_path().parent / "ip_transcription_quota.sqlite3"


def _sign_ip_quota(ip: str, n: int) -> str:
    msg = f"{ip}|{n}".encode("utf-8")
    return hmac.new(_usage_hmac_key(), msg, hashlib.sha256).hexdigest()


def _verify_ip_quota(ip: str, n: int, mac: str) -> bool:
    try:
        return hmac.compare_digest(_sign_ip_quota(ip, n), mac)
    except Exception:
        return False


def try_consume_ip_transcription_quota(request: Request) -> None:
    """자막 자동 생성(Whisper) 1회당 클라이언트 IP별 SQLite 할당량 차감."""
    bypass = os.environ.get("VCML_USAGE_BYPASS", "").strip().lower()
    if bypass in ("1", "true", "yes", "on"):
        return
    try:
        max_uses = int(os.environ.get("VCML_MAX_USES_PER_IP", "10"))
    except ValueError:
        max_uses = 10
    if max_uses <= 0:
        return

    ip = _client_ip_for_allowlist(request).strip()
    if not ip:
        raise HTTPException(
            status_code=403,
            detail="클라이언트 IP를 확인할 수 없어 할당량을 적용할 수 없습니다.",
        )

    db_path = _ip_quota_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), timeout=30)
    try:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS ip_quota ("
            "ip TEXT PRIMARY KEY, n INTEGER NOT NULL, mac TEXT NOT NULL)"
        )
        row = conn.execute("SELECT n, mac FROM ip_quota WHERE ip=?", (ip,)).fetchone()
        if row is None:
            n = 0
            mac = _sign_ip_quota(ip, n)
            conn.execute("INSERT INTO ip_quota (ip, n, mac) VALUES (?, ?, ?)", (ip, n, mac))
            conn.commit()
        else:
            n, mac = int(row[0]), str(row[1])
            if not _verify_ip_quota(ip, n, mac):
                raise HTTPException(
                    status_code=403,
                    detail="IP별 사용 기록이 손상되었습니다. 관리자에게 문의하세요.",
                )

        if n >= max_uses:
            raise HTTPException(
                status_code=403,
                detail=f"이 접속(IP)에서는 자막 자동 생성을 {max_uses}회까지만 사용할 수 있습니다.",
            )

        n2 = n + 1
        mac2 = _sign_ip_quota(ip, n2)
        conn.execute("UPDATE ip_quota SET n=?, mac=? WHERE ip=?", (n2, mac2, ip))
        conn.commit()
    finally:
        conn.close()


def try_consume_transcription_quota(request: Request) -> None:
    mode = (os.environ.get("VCML_TRANSCRIPTION_QUOTA_MODE") or "ip").strip().lower()
    if mode == "machine":
        try_consume_local_transcription_quota()
    else:
        try_consume_ip_transcription_quota(request)


_GATE_COOKIE = "vcml_subtitle_gate"


def _subtitle_gate_enabled() -> bool:
    v = (os.environ.get("VCML_SUBTITLE_GATE") or "1").strip().lower()
    return v not in ("0", "false", "no", "off")


def _gate_hmac_key() -> bytes:
    s = os.environ.get("VCML_GATE_SECRET") or os.environ.get("VCML_USAGE_SECRET") or "vcml-subtitle-gate-v1"
    return hashlib.sha256(s.encode("utf-8")).digest()


def _make_gate_cookie_value(request: Request) -> str:
    exp = int(time.time()) + 60 * 60 * 24 * 30
    ip = _client_ip_for_allowlist(request).strip() or "unknown"
    msg = f"1|{exp}|{ip}".encode("utf-8")
    sig = hmac.new(_gate_hmac_key(), msg, hashlib.sha256).hexdigest()
    return f"1|{exp}|{sig}"


def _verify_gate_cookie(request: Request) -> bool:
    raw = request.cookies.get(_GATE_COOKIE)
    if not raw or raw.count("|") != 2:
        return False
    ver, exp_s, sig = raw.split("|", 2)
    if ver != "1":
        return False
    try:
        exp = int(exp_s)
    except ValueError:
        return False
    if int(time.time()) > exp:
        return False
    ip = _client_ip_for_allowlist(request).strip() or "unknown"
    msg = f"1|{exp}|{ip}".encode("utf-8")
    expected = hmac.new(_gate_hmac_key(), msg, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig)


def _request_is_https(request: Request) -> bool:
    if request.url.scheme == "https":
        return True
    proto = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip().lower()
    return proto == "https"


def _gate_cookie_samesite_and_secure(request: Request) -> tuple[str, bool]:
    """
    vcml.kr 등 다른 출처에서 fetch(credentials)로 /api/subtitle-gate 를 호출할 때
    브라우저가 쿠키를 저장하려면 SameSite=None 과 Secure 가 필요하다.
    로컬 http 는 Lax + Secure 미사용.
    """
    if _request_is_https(request):
        return "none", True
    return "lax", False


def _gate_should_return_landing_html(request: Request, path: str) -> bool:
    """
    주소창에서 Run URL을 열 때 등: Accept 에 text/html 이 없어도(예: */* 만) HTML 폼을 내려준다.
    application/json 만 명시한 클라이언트는 JSON 401 유지.
    """
    if request.method != "GET" or path not in ("/", "/edit", "/edit-srt"):
        return False
    accept = (request.headers.get("accept") or "").lower()
    if "text/html" in accept:
        return True
    if (request.headers.get("sec-fetch-mode") or "").lower() == "navigate":
        return True
    if "application/json" in accept and "text/html" not in accept:
        return False
    return True


def _gate_landing_html() -> str:
    """게이트 쿠키 없이 HTML 페이지를 요청했을 때: 접속 코드 입력 후 같은 호스트에서 자막 앱 시작."""
    return """<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>VCML 자막 자동생성 — 접속</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@300;400;500;600;700&amp;family=Montserrat:wght@400;500;600;700;800;900&amp;display=swap" rel="stylesheet"/>
<style>
/* index.html 과 동일 토큰 — 레이아웃 수치는 유지, 폰트·색만 통일 */
:root{--brand-blue:#10069F;--brand-blue-hover:#000080;--brand-light:#F0F2FF;--brand-white:#FFFFFF;--brand-gray:#F4F5F7;
  --text-main:#10069F;--text-sub:#555555;--text-white:#FFFFFF;--new-badge:#FF4757}
body{font-family:'Montserrat','IBM Plex Sans KR',sans-serif;max-width:420px;margin:2.5rem auto;padding:0 1.25rem;
  background:var(--brand-white);min-height:100vh;color:var(--text-main);letter-spacing:-.02em;line-height:1.6}
h1{font-size:1.35rem;font-weight:800;margin:0 0 .4rem;letter-spacing:-.02em;color:var(--text-main)}
.sub{color:var(--text-sub);font-size:.9rem;line-height:1.55;margin:0 0 1.35rem}
label{display:block;font-size:.78rem;font-weight:600;margin-bottom:.35rem;color:var(--text-main)}
input{width:100%;box-sizing:border-box;padding:.8rem 1rem;border-radius:10px;border:1px solid rgba(16,6,159,.08);
  background:var(--brand-white);color:var(--text-main);font-size:1rem;font-family:inherit;margin-bottom:1rem}
input::placeholder{color:rgba(16,6,159,.35)}
input:focus{outline:none;border-color:rgba(16,6,159,.22);box-shadow:0 0 0 3px rgba(16,6,159,.08)}
button{width:100%;padding:.9rem;border:none;border-radius:999px;font-family:inherit;
  background:linear-gradient(135deg,var(--brand-blue) 0%,#3020FF 100%);color:var(--text-white);
  font-weight:700;font-size:1rem;cursor:pointer;box-shadow:0 10px 20px rgba(16,6,159,.2)}
button:hover{filter:none;background:linear-gradient(135deg,var(--brand-blue-hover) 0%,#2520cc 100%);
  box-shadow:0 4px 12px rgba(16,6,159,.25)}
#error{color:var(--new-badge);font-size:.88rem;margin-top:.85rem;min-height:1.3rem;font-weight:600}
.foot{margin-top:1.75rem;font-size:.82rem}
.foot a{color:var(--brand-blue);text-decoration:none}
.foot a:hover{text-decoration:underline;color:var(--brand-blue-hover)}
</style>
</head>
<body>
<h1>VCML 자막 자동생성</h1>
<p class="sub">접속 코드를 입력하면 바로 자막 만들기 화면으로 이동합니다.</p>
<form id="gateForm">
<label for="gateCode">접속 코드</label>
<input id="gateCode" name="code" type="password" inputmode="numeric" autocomplete="off" maxlength="32" required placeholder="접속 코드"/>
<button type="submit">시작하기</button>
<div id="error" role="alert"></div>
</form>
<p class="foot"><a href="https://vcml.kr">VCML 메인 사이트</a></p>
<script>
(function(){
var form=document.getElementById("gateForm");
var err=document.getElementById("error");
form.addEventListener("submit",function(e){
  e.preventDefault();
  err.textContent="";
  var code=(document.getElementById("gateCode").value||"").trim();
  if(!code){err.textContent="접속 코드를 입력해 주세요.";return;}
  var fd=new FormData();
  fd.append("code",code);
  fetch("/api/subtitle-gate",{method:"POST",body:fd,credentials:"include"})
    .then(function(r){
      if(!r.ok){
        err.textContent=r.status===401?"접속 코드가 올바르지 않습니다.":"인증에 실패했습니다.";
        return;
      }
      var q=window.location.search||"";
      window.location.href=window.location.pathname+q;
    })
    .catch(function(){err.textContent="네트워크 오류입니다. 잠시 후 다시 시도해 주세요.";});
});
document.getElementById("gateCode").focus();
})();
</script>
</body>
</html>"""


def _cors_middleware_kwargs() -> dict[str, Any]:
    """
    VCML_CORS_ORIGINS 가 비어 있으면 로컬 전용: 127.0.0.1 / localhost 의 임의 포트 허용
    (Cursor·Live Preview 등 5785 등에서 메인 index → 자막 API fetch 시 필요).
    운영 도메인은 VCML_CORS_ORIGINS=https://your-main.com 형태로 반드시 지정하세요.
    """
    raw = os.environ.get("VCML_CORS_ORIGINS", "").strip()
    if raw:
        origins = [x.strip() for x in raw.split(",") if x.strip()]
        return {
            "allow_origins": origins,
            "allow_origin_regex": None,
        }
    return {
        "allow_origins": [],
        "allow_origin_regex": r"^https?://(127\.0\.0\.1|localhost)(:\d+)?$",
    }


app = FastAPI(title="VCML 자막 자동생성기 ver 3.5")

_cors_kw = _cors_middleware_kwargs()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_kw["allow_origins"],
    allow_origin_regex=_cors_kw["allow_origin_regex"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _parse_ip_allowed_networks() -> Optional[list]:
    raw = os.environ.get("VCML_ALLOWED_IPS", "").strip()
    if not raw:
        return None
    nets: list = []
    for tok in raw.split(","):
        tok = tok.strip()
        if not tok:
            continue
        try:
            if "/" in tok:
                nets.append(ipaddress.ip_network(tok, strict=False))
            else:
                addr = ipaddress.ip_address(tok)
                if addr.version == 4:
                    nets.append(ipaddress.ip_network(f"{tok}/32", strict=False))
                else:
                    nets.append(ipaddress.ip_network(f"{tok}/128", strict=False))
        except ValueError:
            continue
    return nets if nets else None


def _client_ip_for_allowlist(request: Request) -> str:
    trust = os.environ.get("VCML_TRUST_X_FORWARDED_FOR", "").strip().lower()
    if trust in ("1", "true", "yes", "on"):
        xff = request.headers.get("x-forwarded-for")
        if xff:
            return xff.split(",")[0].strip()
    if request.client:
        return request.client.host or ""
    return ""


def _machine_quota_snapshot_readonly() -> dict[str, Any]:
    try:
        max_uses = int(os.environ.get("VCML_MAX_USES", "10"))
    except ValueError:
        max_uses = 10
    if max_uses <= 0:
        return {"limited": False}
    mid = _machine_fingerprint()
    db_path = _usage_limit_db_path()
    n_used = 0
    blocked = False
    if db_path.is_file():
        conn = sqlite3.connect(str(db_path), timeout=10)
        try:
            row = conn.execute("SELECT mid, n, mac FROM quota WHERE id=1").fetchone()
            if row:
                stored_mid, n_val, mac = str(row[0]), int(row[1]), str(row[2])
                if stored_mid != mid or not _verify_usage(stored_mid, n_val, mac):
                    blocked = True
                    n_used = max_uses
                else:
                    n_used = n_val
        finally:
            conn.close()
    remaining = 0 if blocked else max(0, max_uses - n_used)
    return {
        "limited": True,
        "max": max_uses,
        "used": n_used,
        "remaining": remaining,
        "blocked": blocked,
    }


def _ip_quota_snapshot_readonly(request: Request) -> dict[str, Any]:
    try:
        max_uses = int(os.environ.get("VCML_MAX_USES_PER_IP", "10"))
    except ValueError:
        max_uses = 10
    if max_uses <= 0:
        return {"limited": False}
    ip = _client_ip_for_allowlist(request).strip()
    if not ip:
        return {
            "limited": True,
            "max": max_uses,
            "used": 0,
            "remaining": 0,
            "blocked": True,
        }
    n_used = 0
    bad = False
    db_path = _ip_quota_db_path()
    if db_path.is_file():
        conn = sqlite3.connect(str(db_path), timeout=10)
        try:
            row = conn.execute("SELECT n, mac FROM ip_quota WHERE ip=?", (ip,)).fetchone()
            if row:
                n_val, mac = int(row[0]), str(row[1])
                if not _verify_ip_quota(ip, n_val, mac):
                    bad = True
                    n_used = max_uses
                else:
                    n_used = n_val
        finally:
            conn.close()
    remaining = 0 if bad else max(0, max_uses - n_used)
    return {
        "limited": True,
        "max": max_uses,
        "used": n_used,
        "remaining": remaining,
        "blocked": bad,
    }


def transcription_quota_snapshot(request: Request) -> dict[str, Any]:
    bypass = os.environ.get("VCML_USAGE_BYPASS", "").strip().lower()
    if bypass in ("1", "true", "yes", "on"):
        return {"limited": False}
    mode = (os.environ.get("VCML_TRANSCRIPTION_QUOTA_MODE") or "ip").strip().lower()
    if mode == "machine":
        return _machine_quota_snapshot_readonly()
    return _ip_quota_snapshot_readonly(request)


@app.middleware("http")
async def vcml_ip_allowlist_middleware(request: Request, call_next):
    nets = _parse_ip_allowed_networks()
    if not nets:
        return await call_next(request)
    ip = _client_ip_for_allowlist(request)
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return JSONResponse(
            {"detail": "접근 거부: 클라이언트 IP를 확인할 수 없습니다."},
            status_code=403,
        )
    if not any(addr in net for net in nets):
        return JSONResponse(
            {"detail": "이 IP에서는 접근할 수 없습니다."},
            status_code=403,
        )
    return await call_next(request)


@app.middleware("http")
async def vcml_subtitle_gate_middleware(request: Request, call_next):
    if not _subtitle_gate_enabled():
        return await call_next(request)
    if request.method == "OPTIONS":
        return await call_next(request)
    p = request.url.path
    if p == "/api/subtitle-gate":
        return await call_next(request)
    if p in ("/docs", "/openapi.json", "/redoc", "/favicon.ico"):
        return await call_next(request)
    if _verify_gate_cookie(request):
        return await call_next(request)
    if _gate_should_return_landing_html(request, p):
        return HTMLResponse(content=_gate_landing_html(), status_code=200)
    return JSONResponse(
        {
            "detail": "접속 코드가 필요합니다. 브라우저에서 자막 앱 주소를 연 뒤 코드를 입력하거나, vcml.kr 자막 자동생성 메뉴를 이용하세요."
        },
        status_code=401,
    )


def _static_asset_file(name: str) -> FileResponse:
    path = STATIC / name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")
    if name.endswith(".js"):
        media = "application/javascript"
    elif name.endswith(".css"):
        media = "text/css"
    else:
        media = None
    return FileResponse(path, media_type=media)


# 예전 HTML·캐시에서 /app.js 처럼 루트 경로를 쓰는 경우 404 방지 (정식 경로는 /static/…)
@app.get("/app.js")
def legacy_root_app_js():
    return _static_asset_file("app.js")


@app.get("/edit.js")
def legacy_root_edit_js():
    return _static_asset_file("edit.js")


@app.get("/edit-srt.js")
def legacy_root_edit_srt_js():
    return _static_asset_file("edit-srt.js")


@app.get("/style.css")
def legacy_root_style_css():
    return _static_asset_file("style.css")


app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")


def get_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel

        name = os.environ.get("WHISPER_MODEL", "medium")
        device = os.environ.get("WHISPER_DEVICE", "cpu")
        compute = os.environ.get("WHISPER_COMPUTE", "int8")
        _model = WhisperModel(name, device=device, compute_type=compute)
    return _model


def format_srt_time(seconds: float) -> str:
    if seconds < 0:
        seconds = 0.0
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int(round((seconds - int(seconds)) * 1000))
    if ms >= 1000:
        ms = 999
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def format_vtt_time(seconds: float) -> str:
    if seconds < 0:
        seconds = 0.0
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    rest = seconds - h * 3600 - m * 60
    return f"{h:02d}:{m:02d}:{rest:06.3f}"


def segments_to_srt(segments: list) -> str:
    lines: list[str] = []
    n = 1
    for seg in segments:
        text = (seg.text or "").strip()
        if not text and not getattr(seg, "blank", False):
            continue
        lines.append(str(n))
        lines.append(f"{format_srt_time(seg.start)} --> {format_srt_time(seg.end)}")
        lines.append(text if text else "")
        lines.append("")
        n += 1
    return "\n".join(lines)


def segments_to_vtt(segments: list) -> str:
    lines = ["WEBVTT", ""]
    for seg in segments:
        text = (seg.text or "").strip()
        if not text and not getattr(seg, "blank", False):
            continue
        lines.append(f"{format_vtt_time(seg.start)} --> {format_vtt_time(seg.end)}")
        lines.append(text if text else "")
        lines.append("")
    return "\n".join(lines)


_TS_ARROW = re.compile(
    r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})"
)


def _hms_ms_to_sec(h: str, mi: str, s: str, ms: str) -> float:
    return int(h) * 3600 + int(mi) * 60 + int(s) + int(ms) / 1000.0


def sanitize_subtitle_text(text: str) -> str:
    """
    자막에 허용하는 문장 부호는 ! 와 ? 만.
    글자(한글·라틴 등)·숫자·공백은 유지하되, 줄바꿈·탭 등은 모두 한 칸 공백으로 합쳐
    큐당 한 줄만 남긴다. 전각 !? 는 반각으로 통일.
    (프랑스어 l' 등 아포스트로피·쉼표 등은 제거됨.)
    """
    if not text:
        return ""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.translate(str.maketrans("\uff01\uff1f", "!?"))
    text = re.sub(r"[\n\t]+", " ", text)
    text = re.sub(r" +", " ", text).strip()
    cleaned = "".join(ch for ch in text if ch.isalnum() or ch.isspace() or ch in "!?")
    return re.sub(r" +", " ", cleaned).strip()


def parse_srt(content: str) -> list[dict[str, Any]]:
    text = content.replace("\r\n", "\n").strip()
    if not text:
        return []
    cues: list[dict[str, Any]] = []
    for part in re.split(r"\n\s*\n", text):
        lines = part.strip().split("\n")
        if not lines:
            continue
        li = 0
        if re.fullmatch(r"\d+", lines[0].strip() or ""):
            li = 1
        if li >= len(lines):
            continue
        m = _TS_ARROW.search(lines[li])
        if not m:
            continue
        start = _hms_ms_to_sec(m.group(1), m.group(2), m.group(3), m.group(4))
        end = _hms_ms_to_sec(m.group(5), m.group(6), m.group(7), m.group(8))
        body = "\n".join(lines[li + 1 :]).strip()
        cues.append({"start": start, "end": end, "text": body})
    return cues


def parse_vtt(content: str) -> list[dict[str, Any]]:
    text = content.replace("\r\n", "\n")
    body = re.sub(r"^WEBVTT[^\n]*\n", "", text, count=1, flags=re.IGNORECASE)
    body = body.strip()
    if not body:
        return []
    cues: list[dict[str, Any]] = []
    for part in re.split(r"\n\s*\n", body):
        lines = part.strip().split("\n")
        if not lines:
            continue
        if lines[0].strip().upper().startswith("NOTE") or lines[0].strip().upper().startswith(
            "STYLE"
        ):
            continue
        li = 0
        if "-->" not in lines[0]:
            li = 1
        if li >= len(lines):
            continue
        m = _TS_ARROW.search(lines[li])
        if not m:
            continue
        start = _hms_ms_to_sec(m.group(1), m.group(2), m.group(3), m.group(4))
        end = _hms_ms_to_sec(m.group(5), m.group(6), m.group(7), m.group(8))
        body = "\n".join(lines[li + 1 :]).strip()
        cues.append({"start": start, "end": end, "text": body})
    return cues


@dataclass
class SubSeg:
    start: float
    end: float
    text: str
    blank: bool = False


def with_leading_silence_cues(
    speech_cues: list[dict[str, Any]], duration: float
) -> list[dict[str, Any]]:
    """
    첫 유음 자막 시작 전이 LEADING_SILENCE_MIN_SEC(기본 0.12초) 이상이면
    0초부터 그 시각까지 텍스트 없는 블랭크 큐를 앞에 붙인다.
    인식 결과가 없고 미디어 길이만 있으면 전체를 하나의 블랭크 큐로 둔다.
    """
    min_lead = float(os.environ.get("LEADING_SILENCE_MIN_SEC", "0.12"))
    if min_lead < 0:
        min_lead = 0.0
    dur = max(float(duration), 0.0)
    if not speech_cues:
        if dur >= min_lead:
            return [{"start": 0.0, "text": "", "blank": True}]
        return []
    first_start = min(float(c["start"]) for c in speech_cues)
    if first_start >= min_lead:
        return [{"start": 0.0, "text": "", "blank": True}, *speech_cues]
    return speech_cues


def normalize_chained_cues(cues_in: list[dict[str, Any]], duration: float) -> list[SubSeg]:
    """각 자막의 끝 = 다음 자막의 시작, 마지막 끝 = 영상 길이(duration). blank=True 는 텍스트 없는 큐(무음 구간)."""
    rows: list[dict[str, Any]] = []
    for c in cues_in:
        try:
            s = float(c.get("start", 0))
        except (TypeError, ValueError):
            continue
        is_blank = bool(c.get("blank"))
        t = sanitize_subtitle_text(c.get("text") or "")
        if t:
            is_blank = False
        if not t and not is_blank:
            continue
        rows.append({"start": max(0.0, s), "text": t, "blank": is_blank})
    if not rows:
        return []
    rows.sort(key=lambda x: x["start"])
    dur = max(float(duration), 0.0)
    out: list[SubSeg] = []
    n = len(rows)
    for i in range(n):
        s = float(rows[i]["start"])
        if i + 1 < n:
            e = float(rows[i + 1]["start"])
            if e < s:
                e = s
        else:
            e = dur
            if e < s:
                s = max(0.0, e - 0.05) if e > 0 else 0.0
        out.append(SubSeg(s, e, rows[i]["text"], blank=bool(rows[i]["blank"])))
    return out


def explicit_cues_to_subsegs(cues_in: list[dict[str, Any]]) -> list[SubSeg]:
    """SRT/VTT에 명시된 start·end를 그대로 사용해 SubSeg 리스트를 만든다."""
    rows: list[dict[str, Any]] = []
    for c in cues_in:
        try:
            s = float(c.get("start", 0))
            e = float(c.get("end", 0))
        except (TypeError, ValueError):
            continue
        is_blank = bool(c.get("blank"))
        t = sanitize_subtitle_text(c.get("text") or "")
        if t:
            is_blank = False
        if not t and not is_blank:
            continue
        s = max(0.0, s)
        if e < s:
            e = s
        rows.append({"start": s, "end": e, "text": t, "blank": is_blank})
    if not rows:
        return []
    rows.sort(key=lambda x: x["start"])
    return [
        SubSeg(float(r["start"]), float(r["end"]), r["text"], blank=bool(r["blank"])) for r in rows
    ]


class CueIn(BaseModel):
    start: float = Field(..., description="시작 시각(초)")
    text: str = ""
    blank: bool = False


class BuildSubtitleBody(BaseModel):
    format: str
    duration: float = Field(ge=0)
    cues: list[CueIn]


class ExplicitCueIn(BaseModel):
    start: float
    end: float
    text: str = ""
    blank: bool = False


class BuildExplicitSubtitleBody(BaseModel):
    format: str
    cues: list[ExplicitCueIn]


def count_eojeol(s: str) -> int:
    """공백으로 나뉜 어절(말덩어리) 수. 붙여 쓴 한 덩어리는 1어절."""
    s = s.strip()
    return len(s.split()) if s else 0


def split_long_token(token: str, max_chars: int) -> list[str]:
    """공백 없는 한 토큰이 max_chars를 넘으면 글자 단위로만 자른다."""
    if max_chars <= 0:
        max_chars = 10**9
    if len(token) <= max_chars:
        return [token]
    return [token[i : i + max_chars] for i in range(0, len(token), max_chars)]


def split_text_to_chunks(text: str, max_chars: int, max_eojeol: int) -> list[str]:
    """공백 어절·글자 수 상한에 맞춰 자막 블록을 나눈다."""
    if max_chars <= 0 and max_eojeol <= 0:
        return [text.strip()] if text.strip() else []
    mc = max_chars if max_chars > 0 else 10**9
    me = max_eojeol if max_eojeol > 0 else 10**9

    words = text.split()
    chunks: list[str] = []
    cur: list[str] = []

    def flush():
        if cur:
            chunks.append(" ".join(cur))
            cur.clear()

    for w in words:
        for piece in split_long_token(w, mc):
            trial = " ".join(cur + [piece]) if cur else piece
            if cur and (len(trial) > mc or count_eojeol(trial) > me):
                flush()
            cur.append(piece)
    flush()
    return [c for c in chunks if c.strip()]


def apply_segment_time_offset(segments: list, offset_sec: float, duration: float) -> list:
    """
    Whisper/VAD로 생기는 시작·끝 시각의 체계적 오차를 줄이기 위해 구간을 통째로 이동.
    offset_sec: 음수면 자막이 더 일찍 시작, 양수면 더 늦게 시작.
    """
    if abs(offset_sec) < 1e-9:
        return segments
    dur = max(float(duration), 0.0)
    out: list = []
    for s in segments:
        st = float(s.start) + offset_sec
        en = float(s.end) + offset_sec
        st = max(0.0, st)
        en = max(st + 0.05, en)
        if dur > 0:
            en = min(en, dur)
        if en <= st + 1e-6:
            continue
        text = (getattr(s, "text", None) or "").strip()
        if not text:
            continue
        out.append(SimpleNamespace(start=st, end=en, text=text))
    return out


def reflow_segments(raw: list, max_chars: int, max_eojeol: int) -> list[SubSeg]:
    if max_chars <= 0 and max_eojeol <= 0:
        return [
            SubSeg(s.start, s.end, (s.text or "").strip())
            for s in raw
            if (s.text or "").strip()
        ]

    out: list[SubSeg] = []
    for s in raw:
        text = (s.text or "").strip()
        if not text:
            continue
        chunks = split_text_to_chunks(text, max_chars, max_eojeol)
        if not chunks:
            continue
        dur = max(float(s.end) - float(s.start), 0.05)
        if len(chunks) == 1:
            out.append(SubSeg(float(s.start), float(s.end), chunks[0]))
            continue
        total_w = sum(max(len(c), 1) for c in chunks)
        acc = float(s.start)
        for i, c in enumerate(chunks):
            if i == len(chunks) - 1:
                out.append(SubSeg(acc, float(s.end), c))
            else:
                frac = max(len(c), 1) / total_w * dur
                end = acc + frac
                out.append(SubSeg(acc, end, c))
                acc = end
    return out


def get_media_duration_seconds(path: str) -> float:
    """ffprobe로 재생 길이(초). ffmpeg 설치 시 함께 제공되는 ffprobe 사용."""
    r = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path,
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if r.returncode != 0:
        raise RuntimeError((r.stderr or "").strip() or "ffprobe 실행 실패")
    out = (r.stdout or "").strip()
    if not out or out.upper() == "N/A":
        raise RuntimeError("이 파일에서 재생 시간을 읽을 수 없습니다.")
    return float(out)


def preview_media_root() -> Path:
    return Path(
        os.environ.get("SUBTITLE_PREVIEW_DIR", str(Path(tempfile.gettempdir()) / "subtitle_web_preview"))
    )


def guess_preview_kind(suffix: str) -> str:
    s = suffix.lower()
    if s in PREVIEW_VIDEO_EXT:
        return "video"
    if s in ALLOWED_EXT:
        return "audio"
    return "audio"


def mime_for_preview_path(path: Path) -> str:
    mt, _ = mimetypes.guess_type(path.name)
    return mt or "application/octet-stream"


def clear_preview_cache() -> dict[str, Any]:
    """미리보기 루트 아래 job별 사본만 삭제하고, 메모리 작업의 preview_path 참조를 비운다."""
    root = preview_media_root()
    removed = 0
    errors: list[str] = []
    if root.exists():
        for child in list(root.iterdir()):
            try:
                if child.is_dir():
                    shutil.rmtree(child, ignore_errors=True)
                else:
                    child.unlink(missing_ok=True)
                removed += 1
            except OSError as e:
                errors.append(f"{child.name}: {e}")
    with jobs_lock:
        conn = _jobs_conn_unlocked()
        conn.execute("UPDATE jobs SET preview_path = NULL")
        conn.commit()
    msg = f"삭제한 항목 {removed}개." if removed else "지울 사본이 없었습니다."
    if errors:
        msg += " 일부만 지워졌을 수 있습니다."
    return {
        "removed": removed,
        "path": str(root.resolve()),
        "message": msg,
        "errors": errors,
    }


def safe_stem(name: str) -> str:
    base = Path(name).stem
    base = re.sub(r"[^\w\-가-힣.]+", "_", base, flags=re.UNICODE)
    return (base or "subtitle")[:80]


@app.get("/", response_class=HTMLResponse)
async def index_page():
    return (STATIC / "index.html").read_text(encoding="utf-8")


@app.get("/edit", response_class=HTMLResponse)
async def edit_page():
    return (STATIC / "edit.html").read_text(encoding="utf-8")


@app.get("/edit-srt", response_class=HTMLResponse)
async def edit_srt_page():
    return (STATIC / "edit-srt.html").read_text(encoding="utf-8")


@app.post("/api/subtitle-gate")
async def subtitle_gate(request: Request, code: str = Form(...)):
    """메인 사이트에서 접속 코드 확인 후 HttpOnly 쿠키 발급(cross-port 127.0.0.1 공유)."""
    if not _subtitle_gate_enabled():
        return {"ok": True, "gate_disabled": True}
    expected = (os.environ.get("VCML_ACCESS_CODE") or "0219").strip()
    if (code or "").strip() != expected:
        raise HTTPException(status_code=401, detail="접속 코드가 올바르지 않습니다.")
    resp = JSONResponse({"ok": True})
    same_site, secure = _gate_cookie_samesite_and_secure(request)
    resp.set_cookie(
        key=_GATE_COOKIE,
        value=_make_gate_cookie_value(request),
        httponly=True,
        samesite=same_site,
        secure=secure,
        max_age=60 * 60 * 24 * 30,
        path="/",
    )
    return resp


@app.get("/api/transcription-quota")
def api_transcription_quota(request: Request):
    """자막 자동 생성(POST /api/jobs) 할당량 스냅샷. UI 카운터용."""
    return transcription_quota_snapshot(request)


def _job_update(job_id: str, **kwargs: object) -> None:
    with jobs_lock:
        conn = _jobs_conn_unlocked()
        row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if not row:
            return
        d = _job_row_to_dict(row)
        for k, v in kwargs.items():
            d[k] = v
        conn.execute(
            """
            INSERT OR REPLACE INTO jobs (id,status,progress,phase,error,body_bytes,media_type,download_filename,ext,duration_sec,download_base,preview_path)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            _job_tuple_for_write(job_id, d),
        )
        conn.commit()


def _parse_opt_float(v: str, name: str, min_v: float, max_v: float) -> float:
    s = (v or "").strip()
    if s == "":
        return 0.0
    try:
        x = float(s.replace(",", "."))
    except ValueError:
        raise HTTPException(400, f"{name}은(는) 숫자여야 합니다.")
    if x < min_v or x > max_v:
        raise HTTPException(400, f"{name}은(는) {min_v}~{max_v} 사이여야 합니다.")
    return x


def _parse_opt_int(v: str, name: str, min_v: int, max_v: int) -> int:
    s = (v or "").strip()
    if s == "":
        return 0
    try:
        n = int(s)
    except ValueError:
        raise HTTPException(400, f"{name}은(는) 정수여야 합니다.")
    if n < min_v or n > max_v:
        raise HTTPException(400, f"{name}은(는) {min_v}~{max_v} 사이여야 합니다.")
    return n


def _job_worker(
    job_id: str,
    tmp_path: str,
    tmp_dir: str,
    orig_filename: str,
    lang_param: Optional[str],
    fmt: str,
    mc: int,
    me: int,
    time_offset_sec: float,
) -> None:
    try:
        _job_update(job_id, status="working", progress=3, phase="길이 확인 중")
        max_sec = float(os.environ.get("MAX_AUDIO_DURATION_SEC", "120"))
        dur = 0.0
        try:
            dur = get_media_duration_seconds(tmp_path)
        except FileNotFoundError:
            _job_update(
                job_id,
                status="error",
                error="ffprobe를 찾을 수 없습니다. ffmpeg를 설치하고 PATH에 넣어 주세요.",
                progress=0,
            )
            return
        except Exception as e:
            if max_sec > 0:
                _job_update(
                    job_id,
                    status="error",
                    error=f"오디오 길이 확인 실패: {e}",
                    progress=0,
                )
                return
            dur = 0.0

        if max_sec > 0 and dur > max_sec:
            _job_update(
                job_id,
                status="error",
                error=(
                    f"길이가 허용 한도 {max_sec:.0f}초를 넘습니다. "
                    f"현재 약 {dur:.1f}초입니다. 잘라서 올려 주세요."
                ),
                progress=0,
            )
            return

        _job_update(job_id, progress=8, phase="모델 준비 중")
        model = get_model()
        _job_update(job_id, progress=12, phase="음성 인식 중")

        beam = max(1, min(15, int(os.environ.get("WHISPER_BEAM_SIZE", "5"))))
        segments_gen, _info = model.transcribe(
            tmp_path,
            language=lang_param,
            beam_size=beam,
            vad_filter=True,
        )
        segments: list = []
        for seg in segments_gen:
            segments.append(seg)
            last_end = float(seg.end)
            if dur > 0:
                pct = min(93, 12 + 81 * (last_end / dur))
            else:
                pct = min(93, 12 + min(len(segments), 80))
            _job_update(job_id, progress=int(pct), phase="음성 인식 중")

        segments = apply_segment_time_offset(segments, time_offset_sec, dur)

        _job_update(job_id, progress=94, phase="자막 후처리 중")
        cooked = reflow_segments(segments, mc, me)
        # 큐당 한 줄만 유지 (줄바꿈 삽입·유지 안 함). max_line_chars 폼값은 호환용으로만 받음.

        speech_rows = [
            {"start": float(s.start), "text": (s.text or "").strip(), "blank": False}
            for s in cooked
            if (s.text or "").strip()
        ]
        merged_rows = with_leading_silence_cues(speech_rows, float(dur))
        # 텀 제거: 이전 자막 끝 = 다음 자막 시작, 마지막 끝 = 영상 길이
        cooked = normalize_chained_cues(merged_rows, float(dur))

        if fmt == "srt":
            body = segments_to_srt(cooked)
            media = "text/plain; charset=utf-8"
            ext = "srt"
        else:
            body = segments_to_vtt(cooked)
            media = "text/vtt; charset=utf-8"
            ext = "vtt"

        stem = safe_stem(orig_filename)
        fname = f"{stem}.{ext}"

        preview_path_str: Optional[str] = None
        try:
            proot = preview_media_root()
            dest_dir = proot / job_id
            dest_dir.mkdir(parents=True, exist_ok=True)
            src_ext = Path(orig_filename).suffix.lower() or Path(tmp_path).suffix.lower() or ".bin"
            dest_file = dest_dir / f"source{src_ext}"
            shutil.copy2(tmp_path, dest_file)
            preview_path_str = str(dest_file.resolve())
        except OSError:
            preview_path_str = None

        _job_update(
            job_id,
            status="done",
            progress=100,
            phase="완료",
            body_bytes=body.encode("utf-8"),
            media_type=media,
            download_filename=fname,
            ext=ext,
            duration_sec=float(dur),
            download_base=stem,
            preview_path=preview_path_str,
        )
    except Exception as e:
        _job_update(job_id, status="error", error=str(e), progress=0, phase="오류")
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        try:
            os.rmdir(tmp_dir)
        except OSError:
            pass


@app.post("/api/jobs")
async def create_job(
    request: Request,
    file: UploadFile = File(...),
    subtitle_format: str = Form("srt"),
    max_chars: str = Form("0"),
    max_eojeol: str = Form("0"),
    max_line_chars: str = Form("0"),
    time_offset_sec: str = Form("0"),
):
    if not file.filename:
        raise HTTPException(400, "파일 이름이 없습니다.")

    suf = Path(file.filename).suffix.lower()
    if suf not in ALLOWED_EXT:
        raise HTTPException(
            400,
            f"지원 형식: {', '.join(sorted(ALLOWED_EXT))}",
        )

    fmt = (subtitle_format or "srt").lower().strip()
    if fmt not in ("srt", "vtt"):
        raise HTTPException(400, "subtitle_format은 srt 또는 vtt여야 합니다.")

    lang_param = "ko"

    mc = _parse_opt_int(max_chars, "max_chars", 0, 200)
    me = _parse_opt_int(max_eojeol, "max_eojeol", 0, 200)
    _ = _parse_opt_int(max_line_chars, "max_line_chars", 0, 200)  # 호환용; 자막은 큐당 한 줄 고정
    toff = _parse_opt_float(time_offset_sec, "time_offset_sec", -3.0, 3.0)

    content = await file.read()
    if len(content) > int(os.environ.get("MAX_UPLOAD_MB", "500")) * 1024 * 1024:
        raise HTTPException(413, "파일이 너무 큽니다.")

    try_consume_transcription_quota(request)

    tmp_dir = tempfile.mkdtemp(prefix="sub_")
    tmp_path = os.path.join(tmp_dir, f"{uuid.uuid4().hex}{suf}")
    with open(tmp_path, "wb") as f:
        f.write(content)

    job_id = uuid.uuid4().hex
    _job_insert(
        job_id,
        {
            "status": "queued",
            "progress": 0,
            "phase": "대기 중",
            "error": None,
            "body_bytes": None,
            "media_type": None,
            "download_filename": None,
            "ext": None,
            "duration_sec": None,
            "download_base": None,
            "preview_path": None,
        },
    )

    thread = threading.Thread(
        target=_job_worker,
        args=(job_id, tmp_path, tmp_dir, file.filename, lang_param, fmt, mc, me, toff),
        daemon=True,
    )
    thread.start()
    return {"job_id": job_id}


@app.get("/api/jobs/{job_id}")
def get_job_status(job_id: str):
    job_id = _validate_job_id(job_id)
    j = _job_get(job_id)
    if not j:
        raise HTTPException(404, "작업을 찾을 수 없습니다.")
    return {
        "status": j.get("status", "unknown"),
        "progress": int(j.get("progress", 0)),
        "phase": j.get("phase") or "",
        "error": j.get("error"),
    }


@app.get("/api/jobs/{job_id}/cues")
def get_job_cues(job_id: str):
    job_id = _validate_job_id(job_id)
    j = _job_get(job_id)
    if not j or j.get("status") != "done":
        raise HTTPException(404, "완료된 작업만 편집할 수 있습니다.")
    raw = (j.get("body_bytes") or b"").decode("utf-8")
    fmt = (j.get("ext") or "srt").lower()
    if fmt == "vtt":
        cue_list = parse_vtt(raw)
    else:
        cue_list = parse_srt(raw)
    for c in cue_list:
        if not (c.get("text") or "").strip():
            c["blank"] = True
    stem = j.get("download_base") or safe_stem(j.get("download_filename") or "subtitle.srt")
    pv = j.get("preview_path")
    pv_ok = bool(pv and Path(str(pv)).is_file())
    pv_kind = "none"
    if pv_ok:
        pv_kind = guess_preview_kind(Path(str(pv)).suffix)
    return {
        "job_id": job_id,
        "duration": float(j.get("duration_sec") or 0),
        "format": fmt,
        "download_base": stem,
        "cues": cue_list,
        "preview_available": pv_ok,
        "preview_kind": pv_kind,
    }


@app.post("/api/build-subtitle")
def build_subtitle(body: BuildSubtitleBody):
    fmt = (body.format or "").lower().strip()
    if fmt not in ("srt", "vtt"):
        raise HTTPException(400, "format은 srt 또는 vtt여야 합니다.")
    cues_dict = [
        c.model_dump() if hasattr(c, "model_dump") else c.dict() for c in body.cues
    ]
    segs = normalize_chained_cues(cues_dict, body.duration)
    if fmt == "srt":
        text = segments_to_srt(segs)
        media = "text/plain; charset=utf-8"
    else:
        text = segments_to_vtt(segs)
        media = "text/vtt; charset=utf-8"
    return Response(content=text.encode("utf-8"), media_type=media)


@app.post("/api/parse-subtitle-upload")
async def parse_subtitle_upload(
    file: UploadFile = File(...),
    format: Optional[str] = Form(None),
):
    raw = await file.read()
    try:
        content = raw.decode("utf-8")
    except UnicodeDecodeError:
        content = raw.decode("utf-8", errors="replace")
    fname = (file.filename or "").lower()
    fmt = (format or "").lower().strip()
    if fmt not in ("srt", "vtt", ""):
        raise HTTPException(400, "format은 srt, vtt 또는 비워 두세요.")
    if not fmt:
        if fname.endswith(".vtt"):
            fmt = "vtt"
        elif fname.endswith(".srt"):
            fmt = "srt"
        elif content.lstrip().upper().startswith("WEBVTT"):
            fmt = "vtt"
        else:
            fmt = "srt"
    if fmt == "vtt":
        cue_list = parse_vtt(content)
    else:
        cue_list = parse_srt(content)
    for c in cue_list:
        if not (c.get("text") or "").strip():
            c["blank"] = True
    return {"format": fmt, "cues": cue_list}


@app.post("/api/build-subtitle-explicit")
def build_subtitle_explicit(body: BuildExplicitSubtitleBody):
    fmt = (body.format or "").lower().strip()
    if fmt not in ("srt", "vtt"):
        raise HTTPException(400, "format은 srt 또는 vtt여야 합니다.")
    cues_dict = [
        c.model_dump() if hasattr(c, "model_dump") else c.dict() for c in body.cues
    ]
    segs = explicit_cues_to_subsegs(cues_dict)
    if not segs:
        raise HTTPException(400, "저장할 자막 큐가 없습니다.")
    if fmt == "srt":
        text = segments_to_srt(segs)
        media = "text/plain; charset=utf-8"
    else:
        text = segments_to_vtt(segs)
        media = "text/vtt; charset=utf-8"
    return Response(content=text.encode("utf-8"), media_type=media)


@app.get("/api/jobs/{job_id}/preview-media")
def get_job_preview_media(job_id: str):
    """편집 화면 미리보기용 원본 오디오/영상(완료 작업만)."""
    job_id = _validate_job_id(job_id)
    j = _job_get(job_id)
    if not j or j.get("status") != "done":
        raise HTTPException(404, "완료된 작업만 미리보기할 수 있습니다.")
    p = j.get("preview_path")
    if not p:
        raise HTTPException(404, "미리보기 파일이 없습니다.")
    path = Path(str(p))
    if not path.is_file():
        raise HTTPException(404, "미리보기 파일을 찾을 수 없습니다.")
    return FileResponse(
        path,
        media_type=mime_for_preview_path(path),
        filename=path.name,
    )


@app.post("/api/preview-cache/clear")
def post_clear_preview_cache():
    """미리보기용 원본 사본만 삭제. 자막 본문·작업 메타는 유지, preview_path 만 비움."""
    return clear_preview_cache()


@app.get("/api/jobs/{job_id}/download")
def download_job_result(job_id: str):
    job_id = _validate_job_id(job_id)
    j = _job_get(job_id)
    if not j or j.get("status") != "done":
        raise HTTPException(404, "아직 완료되지 않았거나 없는 작업입니다.")
    body = j.get("body_bytes")
    media = j.get("media_type") or "text/plain; charset=utf-8"
    fname = j.get("download_filename") or "subtitle.srt"
    ext = j.get("ext") or "srt"
    cd = (
        f'attachment; filename="subtitle.{ext}"; '
        f"filename*=UTF-8''{quote(fname)}"
    )
    return Response(
        content=body or b"",
        media_type=media,
        headers={"Content-Disposition": cd},
    )
