"""웹 UI(JS) ↔ Python 브리지.

pywebview의 js_api로 노출된다. JS에서 window.pywebview.api.<메서드>(...)로
호출하면 각 호출이 별도 스레드에서 실행되고 Promise로 반환된다.
오래 걸리는 작업(로그인 폴링, 전문 인식)은 내부 스레드로 돌리고
진행 상황을 window.__pyEvent({event, data}) 이벤트로 push한다.

코인 정책: 전문 인식에 성공(비어 있지 않은 전문)한 뒤에만 분당 1코인 차감.
무음·미인식이면 차감하지 않는다. 전문이 확정된 뒤에는 환불하지 않는다.
"""

from __future__ import annotations

import json
import threading
import time
import traceback
from pathlib import Path

from . import APP_NAME, VERSION
from . import capcut
from . import license as license_api
from . import srt as srt_io
from . import styles
from .inject import inject_subtitles
from .playback import Player
from .pro_plan import build_lines_from_script
from .transcribe import (LANGUAGE_CHOICES, MODEL, SR, FullScript,
                         SubtitleLine, Transcriber, _close_gaps,
                         _refine_speech_boundaries, audio_has_speech)


def _ok(**kw) -> dict:
    return {"ok": True, **kw}


def _err(message: str, **kw) -> dict:
    return {"ok": False, "error": message, **kw}


def _project_dict(p: capcut.Project, index: int) -> dict:
    return {
        "index": index,
        "name": p.name,
        "dir": str(p.dir),
        "duration": p.duration_str,
        "mtime": time.strftime("%Y-%m-%d %H:%M", time.localtime(p.mtime)),
    }


def _lines_to_dicts(lines: list[SubtitleLine]) -> list[dict]:
    return [{"start_us": l.start_us, "end_us": l.end_us, "text": l.text}
            for l in lines]


def _dicts_to_lines(blocks: list[dict]) -> list[SubtitleLine]:
    out: list[SubtitleLine] = []
    for b in blocks:
        text = (b.get("text") or "").strip()
        start = int(b.get("start_us", 0))
        end = int(b.get("end_us", 0))
        if text and end > start:
            out.append(SubtitleLine(start_us=start, end_us=end, text=text))
    return out


class Api:
    def __init__(self) -> None:
        self._window = None
        self._auth = license_api.load_auth()
        self._balance = (self._auth or {}).get("balance")
        self._transcriber = Transcriber()
        self._player = Player()

        self._projects: list[capcut.Project] = []
        self._project: capcut.Project | None = None
        self._audio = None                    # np.ndarray | None
        self._script: FullScript | None = None

        self._busy = False
        self._login_cancel: threading.Event | None = None

    def set_window(self, window) -> None:
        self._window = window

    # ---------------------------------------------------------------- 이벤트
    def _emit(self, event: str, data=None) -> None:
        if self._window is None:
            return
        payload = json.dumps({"event": event, "data": data}, ensure_ascii=False)
        try:
            self._window.evaluate_js(f"window.__pyEvent && window.__pyEvent({payload})")
        except Exception:
            pass

    def _auth_state(self) -> dict:
        if not self._auth:
            return {"logged_in": False}
        return {
            "logged_in": True,
            "user_name": self._auth.get("user_name") or "",
            "email": self._auth.get("email") or "",
            "balance": self._balance,
        }

    def _save_balance(self, balance) -> None:
        if balance is None or not self._auth:
            return
        self._balance = balance
        self._auth = license_api.save_auth(
            self._auth["token"], self._auth.get("user_name"),
            balance, self._auth.get("email"))
        self._emit("auth", self._auth_state())

    # ----------------------------------------------------------------- 상태
    def get_state(self) -> dict:
        try:
            running = capcut.is_capcut_running()
        except Exception:
            running = False
        return _ok(
            app={"name": APP_NAME, "version": VERSION},
            auth=self._auth_state(),
            languages=list(LANGUAGE_CHOICES.keys()),
            styles=styles.list_presets(),
            capcut_running=running,
        )

    def refresh_me(self) -> dict:
        """서버에서 잔액/권한 재확인. 401/403이면 로그아웃 처리."""
        if not self._auth:
            return _err("로그인이 필요해요.", logged_in=False)
        try:
            me = license_api.verify_entitlement(self._auth["token"])
            self._save_balance(me.get("balance"))
            pending = me.get("pending_actions") or []
            if pending:
                self._emit("pending_actions", pending)
            return _ok(
                auth=self._auth_state(),
                coin_courses=me.get("coin_courses") or [],
                smartstore_review=me.get("smartstore_review") or {},
                pending_actions=pending,
            )
        except RuntimeError as e:
            status = getattr(e, "status", None)
            if status in (401, 403):
                license_api.clear_auth()
                self._auth = None
                self._balance = None
                self._emit("auth", self._auth_state())
                return _err(str(e), logged_out=True)
            return _err(str(e))

    def claim_smartstore_review(self) -> dict:
        if not self._auth:
            return _err("로그인이 필요해요.")
        try:
            result = license_api.claim_smartstore_review(self._auth["token"])
            me = license_api.fetch_me(self._auth["token"])
            self._save_balance(me.get("balance"))
            return _ok(
                result=result,
                auth=self._auth_state(),
                coin_courses=me.get("coin_courses") or [],
                smartstore_review=me.get("smartstore_review") or {},
            )
        except RuntimeError as e:
            return _err(str(e))

    def ack_inbox(self, message_ids: list) -> dict:
        if not self._auth:
            return _err("로그인이 필요해요.")
        ids = [str(x) for x in (message_ids or []) if x]
        if not ids:
            return _ok()
        try:
            license_api.ack_inbox(self._auth["token"], ids)
            return _ok()
        except RuntimeError as e:
            return _err(str(e))

    def review_write_url(self, course_id: str | None = None) -> dict:
        return _ok(url=license_api.review_write_url(course_id))

    # --------------------------------------------------------------- 로그인
    def start_login(self) -> dict:
        if self._login_cancel is not None:
            return _err("이미 로그인 진행 중이에요.")
        cancel = threading.Event()
        self._login_cancel = cancel

        def worker() -> None:
            try:
                auth = license_api.start_device_login(
                    on_status=lambda m: self._emit("login_status", {"message": m}),
                    on_code=lambda code, url: self._emit(
                        "login_code", {"code": code, "url": url}),
                    cancel_event=cancel,
                )
                self._auth = auth
                self._balance = auth.get("balance")
                self._emit("auth", self._auth_state())
            except Exception as e:
                if str(e) != "cancelled":
                    self._emit("login_error", {"message": str(e) or "로그인에 실패했어요."})
            finally:
                self._login_cancel = None

        threading.Thread(target=worker, daemon=True).start()
        return _ok()

    def cancel_login(self) -> dict:
        if self._login_cancel is not None:
            self._login_cancel.set()
        return _ok()

    def logout(self) -> dict:
        license_api.clear_auth()
        self._auth = None
        self._balance = None
        return _ok(auth=self._auth_state())

    def fetch_history(self) -> dict:
        if not self._auth:
            return _err("로그인이 필요해요.")
        try:
            history = license_api.fetch_history(self._auth["token"])
            return _ok(history=history)
        except RuntimeError as e:
            return _err(str(e))

    # ------------------------------------------------------------- 프로젝트
    def list_projects(self) -> dict:
        try:
            self._projects = capcut.list_projects()
            running = capcut.is_capcut_running()
        except Exception as e:
            return _err(f"프로젝트 탐색에 실패했어요: {e}")
        return _ok(
            projects=[_project_dict(p, i) for i, p in enumerate(self._projects)],
            capcut_running=running,
        )

    def add_draft_root(self) -> dict:
        """폴더 지정 다이얼로그 → 초안 폴더 수동 등록."""
        import webview
        if self._window is None:
            return _err("창이 준비되지 않았어요.")
        picked = self._window.create_file_dialog(webview.FOLDER_DIALOG)
        if not picked:
            return _ok(cancelled=True)
        capcut.add_manual_draft_root(Path(picked[0]))
        return self.list_projects()

    def capcut_running(self) -> dict:
        return _ok(running=capcut.is_capcut_running())

    # ------------------------------------------------------------- 전문 인식
    def start_transcribe(self, project_index: int, language_label: str) -> dict:
        """전문 인식 시작 (백그라운드). 진행/완료는 이벤트로 push.

        코인: 비어 있지 않은 전문이 나온 뒤에만 차감. 무음·미인식은 미차감.
        전문 확정 후에는 환불하지 않음.
        """
        if self._busy:
            return _err("이미 작업이 진행 중이에요.")
        if not self._auth:
            return _err("로그인이 필요해요.")
        try:
            project = self._projects[int(project_index)]
        except (IndexError, ValueError):
            return _err("프로젝트를 다시 선택해 주세요.")
        language = LANGUAGE_CHOICES.get(language_label)

        self._busy = True
        self._project = project
        threading.Thread(
            target=self._transcribe_worker, args=(project, language), daemon=True
        ).start()
        return _ok()

    def _transcribe_worker(self, project: capcut.Project, language) -> None:
        status = lambda m: self._emit("progress", {"message": m})
        ratio = lambda r: self._emit("progress_ratio", {"ratio": max(0.0, min(1.0, r))})
        job_id = None
        token = self._auth["token"] if self._auth else None
        consumed = False
        script_committed = False  # 전문 확정 후에는 환불 불가
        try:
            status(f"[{project.name}] 타임라인 오디오를 분석하고 있어요...")
            res = capcut.build_timeline_audio(project)
            if not res.used_files:
                raise RuntimeError(
                    "인식할 오디오를 찾지 못했어요. 프로젝트의 음성 파일을 확인해 주세요.")

            status("발화(말)가 있는지 확인하고 있어요…")
            if not audio_has_speech(res.audio):
                raise RuntimeError(
                    "오디오에서 말을 찾지 못했어요. 작업이 취소되었고 코인은 차감되지 않았어요.")

            minutes = license_api.minutes_from_audio(len(res.audio), SR)
            self._transcriber.load(MODEL, progress=status)
            script = self._transcriber.transcribe_full_script(
                res.audio, language=language,
                progress=status, progress_ratio=ratio)
            if not (script.text or "").strip():
                raise RuntimeError(
                    "자막으로 인식된 내용이 없어요. 작업이 취소되었고 코인은 차감되지 않았어요.")

            # 전문이 확보된 뒤에만 차감 — 이후에는 환불하지 않음
            job_id = license_api.new_job_id()
            status(f"코인 {minutes}개를 차감하고 있어요… (타임라인 약 {minutes}분)")
            try:
                consumed_res = license_api.consume(token, minutes, job_id)
            except Exception as e:
                payload = getattr(e, "payload", {}) or {}
                if payload.get("code") == "insufficient":
                    raise RuntimeError(
                        f"코인이 부족해요. (필요 {minutes}개, 보유 "
                        f"{payload.get('balance', '?')}개)") from e
                if getattr(e, "status", None) in (401, 403):
                    license_api.clear_auth()
                    self._auth = None
                    self._balance = None
                    self._emit("auth", self._auth_state())
                    raise RuntimeError("로그인이 만료됐어요. 다시 로그인해 주세요.") from e
                raise
            consumed = True
            script_committed = True
            self._save_balance(consumed_res.get("balance"))

            self._audio = res.audio
            self._script = script
            self._emit("script_ready", {
                "text": script.text,
                "language": script.language,
                "minutes": minutes,
                "missing_files": res.missing_files,
            })
        except Exception as e:
            traceback.print_exc()
            # 전문 확정(차감 완료) 이후에는 어떤 경우에도 환불하지 않음
            if consumed and (not script_committed) and job_id and token:
                try:
                    refunded = license_api.refund(token, job_id)
                    self._save_balance(refunded.get("balance"))
                    status("작업에 실패해서 차감된 코인을 환불했어요.")
                except Exception:
                    traceback.print_exc()
            self._emit("transcribe_error", {"message": str(e) or "전문 인식에 실패했어요."})
        finally:
            self._busy = False

    # ------------------------------------------------------------- 자막 블록
    def build_blocks(self, script_text: str) -> dict:
        """엔터로 나눈 전문 → 타임코드 자막 블록.

        build_lines_from_script()가 주는 시각은 Whisper 원시 단어 타임스탬프라
        ±0.3~1초 오차(특히 자막이 실제보다 일찍 나오는 경향)가 흔하다.
        v1의 세그먼트 분할 경로가 쓰던 VAD 기반 발화 경계 스냅을 여기서도
        동일하게 적용해 실제 발화 시작/끝에 맞춘다.
        """
        if not self._script:
            return _err("먼저 전문을 인식해 주세요.")
        lines = build_lines_from_script(script_text or "", self._script.words)
        if not lines:
            return _err("타임코드를 만들 수 있는 자막 줄이 없어요.")
        if self._audio is not None and len(self._audio) > 0:
            lines = _close_gaps(_refine_speech_boundaries(lines, self._audio))
        return _ok(blocks=_lines_to_dicts(lines))

    def import_srt(self) -> dict:
        """SRT 파일을 불러와 블록으로 사용 (인식 없이, 코인 차감 없음)."""
        import webview
        if self._window is None:
            return _err("창이 준비되지 않았어요.")
        picked = self._window.create_file_dialog(
            webview.OPEN_DIALOG, file_types=("자막 파일 (*.srt)",))
        if not picked:
            return _ok(cancelled=True)
        try:
            lines = srt_io.load(picked[0])
        except Exception as e:
            return _err(f"SRT를 읽지 못했어요: {e}")
        if not lines:
            return _err("SRT에서 자막을 찾지 못했어요.")
        return _ok(blocks=_lines_to_dicts(lines))

    def export_srt(self, blocks: list[dict]) -> dict:
        import webview
        if self._window is None:
            return _err("창이 준비되지 않았어요.")
        lines = _dicts_to_lines(blocks or [])
        if not lines:
            return _err("내보낼 자막이 없어요.")
        name = (self._project.name if self._project else "subtitles") + ".srt"
        picked = self._window.create_file_dialog(
            webview.SAVE_DIALOG, save_filename=name,
            file_types=("자막 파일 (*.srt)",))
        if not picked:
            return _ok(cancelled=True)
        path = picked if isinstance(picked, str) else picked[0]
        try:
            srt_io.dump(lines, path)
        except Exception as e:
            return _err(f"SRT 저장에 실패했어요: {e}")
        return _ok(path=str(path))

    # ------------------------------------------------------------ 미리듣기
    def preview_play(self, start_us: int, end_us: int) -> dict:
        if self._audio is None or len(self._audio) == 0:
            return _err("미리듣기는 전문 인식을 한 경우에만 쓸 수 있어요.")
        a = max(0, int(int(start_us) * SR / 1_000_000))
        b = min(len(self._audio), int(int(end_us) * SR / 1_000_000))
        if b <= a:
            return _err("재생할 구간이 없어요.")
        self._player.play(self._audio[a:b])
        return _ok()

    def preview_stop(self) -> dict:
        self._player.stop()
        return _ok()

    # ---------------------------------------------------------------- 삽입
    def inject(self, blocks: list[dict], style_key: str,
               size: str = "medium", position: str = "bottom") -> dict:
        if self._project is None:
            return _err("프로젝트를 먼저 선택해 주세요.")
        lines = _dicts_to_lines(blocks or [])
        if not lines:
            return _err("삽입할 자막이 없어요.")
        style = styles.build_style(style_key, size=size, position=position)
        try:
            backup = inject_subtitles(self._project.dir, lines, style)
        except Exception as e:
            traceback.print_exc()
            return _err(f"삽입에 실패했어요: {e}")
        return _ok(count=len(lines), backup=str(backup),
                   project=self._project.name)

    # ---------------------------------------------------------------- 기타
    def open_url(self, url: str) -> dict:
        import webbrowser
        if not str(url).startswith(license_api.api_base()):
            return _err("허용되지 않은 주소예요.")
        webbrowser.open(str(url))
        return _ok()

    def cleanup(self) -> None:
        try:
            self._player.cleanup()
        except Exception:
            pass
