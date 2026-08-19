"""체험판 웹 UI ↔ Python 브리지. 로그인·코인 없음."""

from __future__ import annotations

import json
import threading
import time
import traceback
from pathlib import Path

import uses
from engine import APP_NAME, MAX_USES, VERSION, WHISPER_MODEL
from engine import capcut
from engine import styles
from engine.inject import inject_subtitles
from engine.pro_plan import build_lines_from_script
from engine.transcribe import (
    MODEL, SR, Transcriber, audio_has_speech,
    _close_gaps, _refine_speech_boundaries,
)

LAST_HOLD_US = 200_000


def _ok(**kw) -> dict:
    return {"ok": True, **kw}


def _err(message: str, **kw) -> dict:
    return {"ok": False, "error": message, **kw}


def _hold_last_subtitle(lines, audio) -> None:
    """다음 자막이 없는 마지막 줄만 발화 종료 후 0.2초 유지."""
    if not lines:
        return
    last = lines[-1]
    last.end_us += LAST_HOLD_US
    if audio is not None and len(audio) > 0:
        audio_end_us = int(len(audio) * 1_000_000 / SR)
        last.end_us = min(last.end_us, audio_end_us)
    if last.end_us <= last.start_us:
        last.end_us = last.start_us + LAST_HOLD_US


def _uses_state() -> dict:
    return {
        "remaining": uses.remaining(),
        "can_use": uses.can_use(),
        "label": uses.remaining_label(),
    }


def _project_dict(p: capcut.Project, index: int) -> dict:
    return {
        "index": index,
        "name": p.name,
        "dir": str(p.dir),
        "duration": p.duration_str,
        "mtime": time.strftime("%Y-%m-%d %H:%M", time.localtime(p.mtime)),
    }


class Api:
    def __init__(self) -> None:
        self._window = None
        self._transcriber = Transcriber()
        self._projects: list[capcut.Project] = []
        self._project: capcut.Project | None = None
        self._script = None
        self._audio = None
        self._lines = []
        self._busy = False
        self._quiz: dict | None = None
        self._prewarm_started = False

    def set_window(self, window) -> None:
        self._window = window
        self._prewarm_model()

    def _emit(self, event: str, data=None) -> None:
        if self._window is None:
            return
        payload = json.dumps({"event": event, "data": data}, ensure_ascii=False)
        try:
            self._window.evaluate_js(f"window.__pyEvent && window.__pyEvent({payload})")
        except Exception:
            pass

    def _prewarm_model(self) -> None:
        if self._prewarm_started:
            return
        self._prewarm_started = True

        def worker() -> None:
            try:
                self._transcriber.load(
                    MODEL,
                    progress=lambda m: self._emit("prewarm_status", {"message": m}),
                )
            except Exception:
                self._prewarm_started = False

        threading.Thread(target=worker, daemon=True).start()

    def boot(self) -> dict:
        return _ok(
            app_name=APP_NAME,
            version=VERSION,
            whisper=WHISPER_MODEL,
            max_uses=MAX_USES,
            styles=styles.list_presets(),
            **_uses_state(),
        )

    def list_projects(self) -> dict:
        try:
            self._projects = capcut.list_projects()
            running = capcut.is_capcut_running()
        except Exception as e:
            return _err(f"프로젝트 탐색에 실패했어요: {e}")
        return _ok(
            projects=[_project_dict(p, i) for i, p in enumerate(self._projects)],
            capcut_running=running,
            **_uses_state(),
        )

    def add_draft_root(self) -> dict:
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
        try:
            idx = int(project_index)
            project = self._projects[idx]
        except (IndexError, ValueError, TypeError):
            return _err("프로젝트를 다시 선택해 주세요.")
        self._project = project
        return _ok(project=_project_dict(project, idx))

    def quiz_question(self) -> dict:
        self._quiz = uses.pick_quiz()
        return _ok(question=self._quiz["question"], **_uses_state())

    def quiz_answer(self, text: str) -> dict:
        if not self._quiz:
            return _err("퀴즈가 없어요. 다시 시도해 주세요.")
        if uses.check_quiz_answer(self._quiz, text):
            uses.grant_quiz_bonus()
            self._quiz = None
            return _ok(**_uses_state())
        return _err("정답이 아닙니다.")

    def start_transcribe(self, project_index: int) -> dict:
        if self._busy:
            return _err("이미 작업을 진행 중이에요.")
        if not uses.can_use():
            return _err("사용 횟수가 없어요.", needs_quiz=True)
        try:
            idx = int(project_index)
            project = self._projects[idx]
        except (IndexError, ValueError, TypeError):
            return _err("프로젝트를 다시 선택해 주세요.")
        self._project = project
        self._busy = True
        threading.Thread(target=self._transcribe_worker, args=(project,), daemon=True).start()
        return _ok()

    def _transcribe_worker(self, project: capcut.Project) -> None:
        try:
            self._emit("progress", {"message": "타임라인 오디오를 읽고 있어요…", "ratio": 0.08})
            built = capcut.build_timeline_audio(project)
            if built.audio is None or len(built.audio) == 0:
                raise RuntimeError("오디오를 만들지 못했어요.")
            if not audio_has_speech(built.audio):
                raise RuntimeError("음성이 거의 들리지 않아요. 다른 초안을 골라 주세요.")

            self._emit("progress", {"message": "음성인식 모델을 준비하고 있어요…", "ratio": 0.18})
            self._transcriber.load(
                MODEL,
                progress=lambda m: self._emit("progress", {"message": m, "ratio": 0.28}),
            )
            script = self._transcriber.transcribe_full_script(
                built.audio,
                language="ko",
                progress=lambda m: self._emit("progress", {"message": m}),
                progress_ratio=lambda r: self._emit("progress", {"ratio": 0.3 + 0.55 * float(r)}),
            )
            if not (script.words or script.text.strip()):
                raise RuntimeError("인식된 문장이 없어요.")

            self._script = script
            self._audio = built.audio
            self._lines = []
            self._emit("script_ready", {
                "text": script.text,
                "project": _project_dict(project, 0),
            })
        except Exception as e:
            self._emit("transcribe_error", {"message": str(e)})
        finally:
            self._busy = False

    def build_blocks(self, script_text: str) -> dict:
        if not self._script:
            return _err("먼저 전문을 인식해 주세요.")
        lines = build_lines_from_script(script_text or "", self._script.words)
        if not lines:
            return _err("엔터로 나눈 자막 줄이 없어요.")
        if self._audio is not None and len(self._audio) > 0:
            lines = _close_gaps(_refine_speech_boundaries(lines, self._audio))
            _hold_last_subtitle(lines, self._audio)
        else:
            _hold_last_subtitle(lines, None)
        self._lines = lines
        return _ok(line_count=len(lines))

    def inject(self, style_key: str, size: str, position: str) -> dict:
        if not uses.can_use():
            return _err("사용 횟수가 없어요.", needs_quiz=True)
        if self._project is None:
            return _err("프로젝트를 먼저 선택해 주세요.")
        if not self._lines:
            return _err("삽입할 자막이 없어요. 엔터로 줄을 나눈 뒤 블록을 만들어 주세요.")
        try:
            style = styles.build_style(style_key, size=size, position=position)
            inject_subtitles(self._project.dir, self._lines, style=style)
            uses.consume_one()
            return _ok(
                project=self._project.name,
                line_count=len(self._lines),
                **_uses_state(),
            )
        except Exception as e:
            traceback.print_exc()
            return _err(f"삽입에 실패했어요: {e}")

    def cleanup(self) -> None:
        pass
