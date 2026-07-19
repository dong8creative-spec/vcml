#!/usr/bin/env python
"""타닥싱크2 개발 감시 — 소스 변경 시 자동 재시작 (PyInstaller 빌드 불필요).

사용:
  .\\.venv\\Scripts\\python dev_watch.py

환경 변수 (선택):
  CAPCUT_SUBTITLE_API=http://localhost:3300  로컬 vcml 서버 연동
  TADAKSYNC_DEV=1   API·이벤트 로그 (기본 켜짐)
  TADAKSYNC_DEBUG=1 pywebview DevTools (기본 켜짐)
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WATCH_ROOT = ROOT / "tadaksync2"
WATCH_EXTS = {".py", ".js", ".css", ".html"}
POLL_SEC = 0.9


def _snapshot() -> dict[str, float]:
    out: dict[str, float] = {}
    if not WATCH_ROOT.is_dir():
        return out
    for path in WATCH_ROOT.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() not in WATCH_EXTS:
            continue
        if any(part.startswith(".") or part in {"__pycache__", "dist", "build"} for part in path.parts):
            continue
        try:
            out[str(path)] = path.stat().st_mtime
        except OSError:
            pass
    return out


def _dev_env() -> dict[str, str]:
    env = os.environ.copy()
    env.setdefault("TADAKSYNC_DEV", "1")
    env.setdefault("TADAKSYNC_DEBUG", "1")
    return env


def _print_banner() -> None:
    api = os.environ.get("CAPCUT_SUBTITLE_API", "https://vcml.kr")
    print("=" * 60, flush=True)
    print(" TadakSync2 DEV — 파일 저장 시 자동 재시작", flush=True)
    print("=" * 60, flush=True)
    print(f" watch : {WATCH_ROOT}", flush=True)
    print(f" API   : {api}", flush=True)
    print(" tips  : 앱 창에서 F5=UI 새로고침, F12/Ctrl+Shift+I=DevTools", flush=True)
    print("         Python(.py) 변경은 앱 전체 재시작, JS/CSS는 F5만으로도 OK", flush=True)
    print(" build : npm run build:subtitle-tool 은 배포 직전에만 실행", flush=True)
    print("=" * 60, flush=True)


def main() -> int:
    _print_banner()
    snap = _snapshot()
    proc: subprocess.Popen | None = None
    try:
        while True:
            if proc is None or proc.poll() is not None:
                code = proc.returncode if proc is not None else None
                if proc is not None:
                    print(f"[dev_watch] process exited code={code}", flush=True)
                print("[dev_watch] starting run.py …", flush=True)
                proc = subprocess.Popen(
                    [sys.executable, str(ROOT / "run.py")],
                    cwd=str(ROOT),
                    env=_dev_env(),
                )
                snap = _snapshot()

            cur = _snapshot()
            changed = [p for p, mt in cur.items() if snap.get(p) != mt]
            changed += [p for p in snap if p not in cur]
            if changed:
                rel = [str(Path(p).relative_to(ROOT)) for p in changed[:5]]
                more = len(changed) - len(rel)
                tail = f" (+{more} more)" if more > 0 else ""
                print(f"[dev_watch] changed: {', '.join(rel)}{tail}", flush=True)
                if proc and proc.poll() is None:
                    proc.terminate()
                    try:
                        proc.wait(timeout=8)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.wait(timeout=3)
                proc = None
                snap = cur
                time.sleep(0.25)
                continue

            snap = cur
            time.sleep(POLL_SEC)
    except KeyboardInterrupt:
        print("\n[dev_watch] stopped", flush=True)
        if proc and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
