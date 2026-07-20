"""웹 UI(JS) ↔ Python 브리지.

pywebview의 js_api로 노출된다. JS에서 window.pywebview.api.<메서드>(...)로
호출하면 각 호출이 별도 스레드에서 실행되고 Promise로 반환된다.
오래 걸리는 작업(로그인 폴링, 전문 인식)은 내부 스레드로 돌리고
진행 상황을 window.__pyEvent({event, data}) 이벤트로 push한다.

코인 정책: 전문 인식 30초당 1코인, 자동 어절 1코인, 엔터 줄 나눔 2코인. 무음·미인식 시 미차감.
"""

from __future__ import annotations

import json
import re
import threading
import time
import traceback
from pathlib import Path

from . import APP_NAME, VERSION
from . import billing
from . import capcut
from . import license as license_api
from . import srt as srt_io
from . import styles
from .inject import inject_subtitles
from .playback import Player
from . import keyword_spans
from .dev_util import dev_log, is_dev_mode
from .pro_plan import build_lines_auto, build_lines_from_script, _clamp_word_range
from .transcribe import (LANGUAGE_CHOICES, MODEL, SR, FullScript,
                         SubtitleLine, Transcriber, _close_gaps,
                         align_line_starts_to_audio, align_words_to_audio,
                         audio_has_speech)


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
        "duration_us": p.duration_us,
        "estimated_coins": p.estimated_coins,
        "mtime": time.strftime("%Y-%m-%d %H:%M", time.localtime(p.mtime)),
    }


def _lines_to_dicts(lines: list[SubtitleLine]) -> list[dict]:
    out = []
    for l in lines:
        item = {"start_us": l.start_us, "end_us": l.end_us, "text": l.text}
        if getattr(l, "spans", None):
            item["spans"] = l.spans
        out.append(item)
    return out


def _dicts_to_lines(blocks: list[dict]) -> list[SubtitleLine]:
    out: list[SubtitleLine] = []
    for b in blocks:
        raw_text = str(b.get("text") or "")
        text = raw_text.strip()
        start = int(b.get("start_us", 0))
        end = int(b.get("end_us", 0))
        if text and end > start:
            spans = _clean_spans(b.get("spans") or [], raw_text)
            out.append(SubtitleLine(start_us=start, end_us=end, text=text, spans=spans))
    return out


def _clean_spans(spans: list, text: str) -> list[dict]:
    cleaned: list[dict] = []
    text_len = len(text)
    for s in spans:
        try:
            start = int(s.get("start", -1))
            end = int(s.get("end", -1))
        except (AttributeError, ValueError, TypeError):
            continue
        if not (0 <= start < end <= text_len):
            continue
        entry: dict = {"start": start, "end": end}
        color = str(s.get("color") or "").strip()
        if re.match(r"^#[0-9a-fA-F]{6}$", color):
            entry["color"] = color.lower()
        if s.get("bold") is True:
            entry["bold"] = True
        if s.get("italic") is True:
            entry["italic"] = True
        try:
            bw = float(s.get("bold_width"))
            entry["bold_width"] = max(0.0, min(0.05, bw))
        except (AttributeError, TypeError, ValueError):
            pass
        try:
            deg = float(s.get("italic_degree"))
            entry["italic_degree"] = max(-45.0, min(45.0, deg))
        except (AttributeError, TypeError, ValueError):
            pass
        if not (entry.get("color") or entry.get("bold") or entry.get("italic")):
            continue
        cleaned.append(entry)
    cleaned.sort(key=lambda x: (x["start"], x["end"]))
    return cleaned


def _normalize_keyword_style(
    color=None, bold=None, bold_width=None, italic=None, italic_degree=None,
) -> dict | None:
    style: dict = {}
    c = str(color or "").strip()
    if re.match(r"^#[0-9a-fA-F]{6}$", c):
        style["color"] = c.lower()
    if bold is True:
        style["bold"] = True
    if italic is True:
        style["italic"] = True
    try:
        if bold_width is not None:
            style["bold_width"] = max(0.0, min(0.05, float(bold_width)))
    except (TypeError, ValueError):
        pass
    try:
        if italic_degree is not None:
            style["italic_degree"] = max(-45.0, min(45.0, float(italic_degree)))
    except (TypeError, ValueError):
        pass
    if not (style.get("color") or style.get("bold") or style.get("italic")):
        return None
    return style


def _duration_us_from_blocks(blocks: list[dict]) -> int:
    return billing.duration_us_from_blocks(blocks)


class Api:
    def __init__(self) -> None:
        self._window = None
        self._style_editor_window = None
        self._style_editor_url = ""
        self._editor_blocks: list[dict] = []
        self._editor_config: dict = {}
        self._auth = license_api.load_auth()
        self._balance = (self._auth or {}).get("balance")
        self._transcriber = Transcriber()
        self._player = Player()

        self._projects: list[capcut.Project] = []
        self._project: capcut.Project | None = None
        self._audio = None                    # np.ndarray | None
        self._script: FullScript | None = None
        self._duration_us: int | None = None
        self._from_transcribe = False
        self._line_split_job_id: str | None = None
        self._split_mode: str | None = None

        self._busy = False
        self._login_cancel: threading.Event | None = None
        self._prewarm_started = False

    def set_window(self, window) -> None:
        self._window = window
        if self._auth:
            self._prewarm_model()

    def set_style_editor_url(self, url: str) -> None:
        self._style_editor_url = str(url or "")

    # ---------------------------------------------------------------- 이벤트
    def _emit(self, event: str, data=None) -> None:
        if is_dev_mode():
            preview = ""
            if isinstance(data, dict):
                keys = list(data.keys())[:4]
                preview = f" keys={keys}"
            dev_log("EVENT", event + preview)
        if self._window is None:
            return
        payload = json.dumps({"event": event, "data": data}, ensure_ascii=False)
        try:
            self._window.evaluate_js(f"window.__pyEvent && window.__pyEvent({payload})")
        except Exception:
            pass

    def _emit_editor(self, event: str, data=None) -> None:
        if self._style_editor_window is None:
            return
        payload = json.dumps({"event": event, "data": data}, ensure_ascii=False)
        try:
            self._style_editor_window.evaluate_js(
                f"window.__pyEvent && window.__pyEvent({payload})")
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

    def _apply_me_snapshot(self, me: dict) -> None:
        if not self._auth:
            return
        token = me.get("token") or self._auth["token"]
        self._balance = me.get("balance")
        self._auth = license_api.save_auth(
            token,
            me.get("name") or self._auth.get("user_name"),
            self._balance,
            me.get("email") or self._auth.get("email"),
        )
        self._emit("auth", self._auth_state())

    def _prewarm_model(self) -> None:
        if self._prewarm_started:
            return
        self._prewarm_started = True

        def worker() -> None:
            try:
                self._emit("prewarm_status", {"message": "음성인식 모델을 미리 준비하고 있어요."})
                self._transcriber.load(
                    MODEL,
                    progress=lambda m: self._emit("prewarm_status", {"message": m}),
                )
                self._emit("prewarm_status", {"message": "음성인식 모델 준비가 끝났어요."})
            except Exception as e:
                self._prewarm_started = False
                self._emit("prewarm_status", {
                    "message": f"음성인식 모델 예열에 실패했어요. 생성할 때 다시 준비할게요: {e}",
                    "kind": "warn",
                })

        threading.Thread(target=worker, daemon=True).start()

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
            billing=billing.billing_meta(),
        )

    def refresh_me(self) -> dict:
        """서버에서 잔액/권한 재확인. 401/403이면 로그아웃 처리."""
        if not self._auth:
            return _err("로그인이 필요해요.", logged_in=False)
        try:
            me = license_api.verify_entitlement(self._auth["token"])
            self._apply_me_snapshot(me)
            self._prewarm_model()
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
            self._apply_me_snapshot(me)
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
                self._prewarm_model()
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

    def select_project(self, project_index: int) -> dict:
        """UI에서 고른 프로젝트를 삽입 대상으로 고정."""
        try:
            idx = int(project_index)
            project = self._projects[idx]
        except (IndexError, ValueError, TypeError):
            return _err("프로젝트를 다시 선택해 주세요.")
        self._project = project
        return _ok(project=_project_dict(project, idx))

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
            duration_us = res.duration_us or billing.duration_us_from_audio(
                len(res.audio), SR)
            recognition_coin_cost = billing.recognition_coins(duration_us)
            if token:
                try:
                    me = license_api.fetch_me(token)
                    balance = int(me.get("balance") or 0)
                    self._save_balance(balance)
                    if balance < recognition_coin_cost:
                        raise RuntimeError(
                            f"코인이 부족해요. (필요 {recognition_coin_cost}개, 보유 {balance}개)")
                except RuntimeError as e:
                    payload = getattr(e, "payload", {}) or {}
                    if payload.get("code") == "insufficient":
                        raise RuntimeError(
                            f"코인이 부족해요. (필요 {recognition_coin_cost}개, 보유 "
                            f"{payload.get('balance', '?')}개)") from e
                    if getattr(e, "status", None) in (401, 403):
                        license_api.clear_auth()
                        self._auth = None
                        self._balance = None
                        self._emit("auth", self._auth_state())
                        raise RuntimeError("로그인이 만료됐어요. 다시 로그인해 주세요.") from e
                    if "코인이 부족" in str(e):
                        raise
                    cached = self._balance
                    if cached is not None and int(cached) < recognition_coin_cost:
                        raise RuntimeError(
                            f"코인이 부족해요. (필요 {recognition_coin_cost}개, 보유 "
                            f"{int(cached)}개)") from e
                    status(
                        "서버에서 잔액을 확인하지 못했어요. 인식은 계속 진행합니다… "
                        "(차감 단계에서 다시 확인돼요)")
            self._transcriber.load(MODEL, progress=status)
            script = self._transcriber.transcribe_full_script(
                res.audio, language=language,
                progress=status, progress_ratio=ratio)
            if script.words and len(res.audio) > 0:
                status("어절 단위 발화 시점을 맞추고 있어요…")
                script.words = align_words_to_audio(script.words, res.audio)
            if not (script.text or "").strip():
                raise RuntimeError(
                    "자막으로 인식된 내용이 없어요. 작업이 취소되었고 코인은 차감되지 않았어요.")

            # 전문이 확보된 뒤에만 차감 — 이후에는 환불하지 않음
            job_id = license_api.new_job_id()
            status(
                f"코인 {recognition_coin_cost}개를 차감하고 있어요… "
                f"(타임라인 약 {minutes}분 · 30초당 1코인)")
            try:
                consumed_res = license_api.consume(token, duration_us, job_id)
            except Exception as e:
                payload = getattr(e, "payload", {}) or {}
                if payload.get("code") == "insufficient":
                    raise RuntimeError(
                        f"코인이 부족해요. (필요 {recognition_coin_cost}개, 보유 "
                        f"{payload.get('balance', '?')}개)") from e
                if getattr(e, "status", None) in (401, 403):
                    license_api.clear_auth()
                    self._auth = None
                    self._balance = None
                    self._emit("auth", self._auth_state())
                    raise RuntimeError("로그인이 만료됐어요. 다시 로그인해 주세요.") from e
                if getattr(e, "status", None) == 500:
                    raise RuntimeError(
                        "음성 인식은 완료됐지만 코인 차감 중 서버 오류가 발생했어요. "
                        "캡컷 문제가 아닙니다. 잠시 후 다시 시도하거나 프로그램에서 다시 로그인해 보세요."
                    ) from e
                raise
            consumed = True
            script_committed = True
            self._save_balance(consumed_res.get("balance"))

            self._audio = res.audio
            self._script = script
            self._duration_us = duration_us
            self._from_transcribe = True
            self._line_split_job_id = None
            self._emit("script_ready", {
                "text": script.text,
                "language": script.language,
                "minutes": minutes,
                "duration_us": duration_us,
                "recognition_coins": recognition_coin_cost,
                "line_split_auto_coins": billing.line_split_coins(duration_us, "auto"),
                "line_split_manual_coins": billing.line_split_coins(duration_us, "manual"),
                "line_split_coins": billing.line_split_coins(duration_us, "auto"),
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
    def _charge_line_split(self, duration_us: int, split_mode: str) -> dict:
        """인식 경로에서 줄 나눔 코인 차감. ok/err dict 반환."""
        mode = billing.normalize_line_split_mode(split_mode)
        need = billing.line_split_coins(duration_us, mode)
        if not (self._from_transcribe and self._auth):
            return _ok(line_split_coins=0, split_mode=mode)
        if not self._line_split_job_id:
            self._line_split_job_id = license_api.new_job_id()
        try:
            charged = license_api.consume_line_split(
                self._auth["token"], duration_us, self._line_split_job_id, mode)
        except Exception as e:
            payload = getattr(e, "payload", {}) or {}
            if payload.get("code") == "insufficient":
                return _err(
                    f"줄 나눔 코인이 부족해요. (필요 {need}개, 보유 "
                    f"{payload.get('balance', '?')}개)",
                    needed=need, balance=payload.get("balance"))
            if getattr(e, "status", None) in (401, 403):
                license_api.clear_auth()
                self._auth = None
                self._balance = None
                self._emit("auth", self._auth_state())
                return _err("로그인이 만료됐어요. 다시 로그인해 주세요.")
            return _err(str(e) or "줄 나눔 코인 차감에 실패했어요.")
        self._save_balance(charged.get("balance"))
        self._split_mode = mode
        coins = charged.get("coins", need)
        return _ok(line_split_coins=coins, split_mode=mode, balance=charged.get("balance"))

    def build_blocks_auto(self, *word_args: int) -> dict:
        """자동 어절 분할 → 타임코드 블록 (1코인).

        인자: (max,) 또는 (min, max) — pywebview/구버전 호환.
        """
        min_w, max_w = 1, 5
        if len(word_args) == 1:
            max_w = word_args[0]
        elif len(word_args) >= 2:
            min_w, max_w = word_args[0], word_args[1]
        min_w, max_w = _clamp_word_range(min_w, max_w)
        if not self._script:
            return _err("먼저 전문을 인식해 주세요.")
        lines = build_lines_auto(self._script.words, min_w, max_w)
        if not lines:
            return _err("자동으로 나눌 자막 줄이 없어요.")
        if self._audio is not None and len(self._audio) > 0:
            lines = align_line_starts_to_audio(lines, self._audio)
            lines = _close_gaps(lines)
        blocks = _lines_to_dicts(lines)
        duration_us = _duration_us_from_blocks(blocks) or self._duration_us or 0
        self._duration_us = duration_us
        charged = self._charge_line_split(duration_us, "auto")
        if not charged.get("ok"):
            return charged
        return _ok(
            blocks=blocks,
            duration_us=duration_us,
            line_split_coins=charged.get("line_split_coins", 0),
            split_mode="auto",
            balance=charged.get("balance"),
        )

    def build_blocks(self, script_text: str) -> dict:
        """엔터로 나눈 전문 → 타임코드 자막 블록 (2코인)."""
        if not self._script:
            return _err("먼저 전문을 인식해 주세요.")
        lines = build_lines_from_script(script_text or "", self._script.words)
        if not lines:
            return _err("타임코드를 만들 수 있는 자막 줄이 없어요.")
        if self._audio is not None and len(self._audio) > 0:
            lines = align_line_starts_to_audio(lines, self._audio)
            lines = _close_gaps(lines)
        blocks = _lines_to_dicts(lines)
        duration_us = _duration_us_from_blocks(blocks) or self._duration_us or 0
        self._duration_us = duration_us
        charged = self._charge_line_split(duration_us, "manual")
        if not charged.get("ok"):
            return charged
        return _ok(
            blocks=blocks,
            duration_us=duration_us,
            line_split_coins=charged.get("line_split_coins", 0),
            split_mode="manual",
            balance=charged.get("balance"),
        )

    def scan_keyword(self, blocks: list[dict], keyword: str,
                     mode: str = "exact") -> dict:
        kw = str(keyword or "").strip()
        if not kw:
            return _err("키워드를 입력해 주세요.")
        result = keyword_spans.scan_blocks(blocks or [], kw, mode)
        return _ok(keyword=kw, mode=keyword_spans.normalize_match_mode(mode), **result)

    def apply_keyword_highlight(
        self,
        blocks: list[dict],
        keyword: str,
        mode: str = "exact",
        color: str | None = None,
        bold: bool | None = None,
        bold_width: float | None = None,
        italic: bool | None = None,
        italic_degree: float | None = None,
    ) -> dict:
        kw = str(keyword or "").strip()
        if not kw:
            return _err("키워드를 입력해 주세요.")
        style = _normalize_keyword_style(
            color=color, bold=bold, bold_width=bold_width,
            italic=italic, italic_degree=italic_degree,
        )
        if not style:
            return _err("색상·굵기·기울기 중 하나 이상을 선택해 주세요.")
        patched, applied = keyword_spans.apply_keyword_spans(
            blocks or [], kw, mode, style, merge=True)
        # spans 정규화
        for b in patched:
            raw = str(b.get("text") or "")
            if b.get("spans"):
                b["spans"] = _clean_spans(b["spans"], raw)
        scan = keyword_spans.scan_blocks(patched, kw, mode)
        return _ok(
            blocks=patched,
            applied=applied,
            count=scan["count"],
            block_count=scan["block_count"],
        )

    def replace_keyword_text(
        self,
        blocks: list[dict],
        keyword: str,
        replacement: str,
        mode: str = "exact",
    ) -> dict:
        kw = str(keyword or "").strip()
        if not kw:
            return _err("키워드를 입력해 주세요.")
        patched, count = keyword_spans.replace_keyword_text(
            blocks or [], kw, replacement or "", mode)
        for b in patched:
            raw = str(b.get("text") or "")
            if b.get("spans"):
                b["spans"] = _clean_spans(b["spans"], raw)
        return _ok(blocks=patched, replaced=count)

    def clear_keyword_highlight(self, blocks: list[dict], keyword: str,
                                mode: str = "exact") -> dict:
        kw = str(keyword or "").strip()
        if not kw:
            return _err("키워드를 입력해 주세요.")
        patched = keyword_spans.clear_keyword_spans(blocks or [], kw, mode)
        return _ok(blocks=patched)

    # ------------------------------------------------------- 단어·스타일 편집 창
    def sync_editor_blocks(self, blocks: list[dict]) -> dict:
        self._editor_blocks = json.loads(json.dumps(blocks or []))
        self._emit_editor("blocks_synced", {"blocks": self._editor_blocks})
        return _ok()

    def sync_editor_config(self, config: dict | None = None) -> dict:
        self._editor_config = dict(config or {})
        return _ok()

    def get_editor_state(self) -> dict:
        return _ok(blocks=self._editor_blocks, config=self._editor_config)

    def push_editor_blocks(self, blocks: list[dict]) -> dict:
        self._editor_blocks = json.loads(json.dumps(blocks or []))
        self._emit("blocks_updated", {"blocks": self._editor_blocks})
        return _ok()

    def style_editor_is_open(self) -> dict:
        return _ok(open=self._style_editor_window is not None)

    def open_style_editor_window(self) -> dict:
        if not self._editor_blocks:
            return _err("편집할 자막 블록이 없어요.")
        import webview

        if self._style_editor_window is not None:
            try:
                self._style_editor_window.show()
                self._emit_editor("blocks_synced", {"blocks": self._editor_blocks})
                return _ok(open=True)
            except Exception:
                self._style_editor_window = None

        if not self._style_editor_url:
            return _err("편집 창 URL을 준비하지 못했어요.")

        win = webview.create_window(
            title=f"단어·스타일 편집 — {APP_NAME}",
            url=self._style_editor_url,
            js_api=self,
            width=420,
            height=680,
            min_size=(360, 420),
            background_color="#0B0C0E",
            resizable=True,
        )
        win.events.closed += self._on_style_editor_closed
        self._style_editor_window = win
        return _ok(open=True)

    def close_style_editor_window(self) -> dict:
        win = self._style_editor_window
        if win is None:
            return _ok(open=False)
        self._style_editor_window = None
        try:
            win.destroy()
        except Exception:
            pass
        self._emit("style_editor_closed", {})
        return _ok(open=False)

    def toggle_style_editor_window(self) -> dict:
        if self._style_editor_window is not None:
            return self.close_style_editor_window()
        return self.open_style_editor_window()

    def _on_style_editor_closed(self) -> None:
        if self._style_editor_window is None:
            return
        self._style_editor_window = None
        self._emit("style_editor_closed", {})

    def import_srt(self, project_index: int) -> dict:
        """SRT 파일을 불러와 블록으로 사용 (인식 없이, 코인 차감 없음).

        삽입 대상 프로젝트를 먼저 확정한 뒤 파일을 연다.
        """
        sel = self.select_project(project_index)
        if not sel.get("ok"):
            return sel
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
        block_dicts = _lines_to_dicts(lines)
        self._duration_us = _duration_us_from_blocks(block_dicts)
        self._from_transcribe = False
        self._line_split_job_id = None
        return _ok(blocks=block_dicts, project=self._project.name)

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
               size: str = "medium", position: str = "bottom",
               project_index: int | None = None) -> dict:
        # 삽입 시점의 UI 선택을 최종 기준으로 다시 고정 (SRT/인식 공통)
        if project_index is None:
            return _err("프로젝트를 먼저 선택해 주세요.")
        sel = self.select_project(project_index)
        if not sel.get("ok"):
            return sel
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
        if self._style_editor_window is not None:
            try:
                self._style_editor_window.destroy()
            except Exception:
                pass
            self._style_editor_window = None
        try:
            self._player.cleanup()
        except Exception:
            pass
