"""pywebview API for the HunminSync MVP."""

from __future__ import annotations

import json
import threading
import traceback
from pathlib import Path

from . import APP_NAME, VERSION, billing, license, premiere
from .media import SAMPLE_RATE, duration_us
from .playback import Player
from .pro_plan import build_enter_lines
from .srt import dump as dump_srt
from .transcribe import LANGUAGE_CHOICES, FullScript, SubtitleLine, Transcriber


def _ok(**values) -> dict:
    return {"ok": True, **values}


def _error(message: str, **values) -> dict:
    return {"ok": False, "error": message, **values}


def _line_dict(line: SubtitleLine) -> dict:
    return {"start_us": line.start_us, "end_us": line.end_us, "text": line.text}


def _dict_lines(blocks: list[dict]) -> list[SubtitleLine]:
    lines: list[SubtitleLine] = []
    for block in blocks or []:
        text = str(block.get("text") or "").strip()
        start, end = int(block.get("start_us", 0)), int(block.get("end_us", 0))
        if text and end > start >= 0:
            lines.append(SubtitleLine(start, end, text))
    return lines


def _duration_label(value_us: int) -> str:
    total_seconds = max(0, int(value_us)) / 1_000_000
    minutes, seconds = divmod(total_seconds, 60)
    return f"{int(minutes)}:{seconds:05.2f}"


def _sequence_dict(sequence: premiere.SequenceInfo, index: int) -> dict:
    return {
        "index": index,
        "id": sequence.id,
        "name": sequence.name,
        "duration_us": sequence.duration_us,
        "duration": _duration_label(sequence.duration_us),
        "estimated_coins": billing.recognition_coins(sequence.duration_us),
        "clip_count": len(sequence.clips),
        "missing_path_count": sum(clip.media_path is None for clip in sequence.clips),
        "warnings": sequence.warnings,
    }


def _project_dict(project: premiere.Project, index: int, include_sequences: bool = False) -> dict:
    value = {
        "index": index,
        "name": project.name,
        "path": str(project.path),
        "mtime": project.mtime,
    }
    if include_sequences:
        value["sequences"] = [
            _sequence_dict(sequence, sequence_index)
            for sequence_index, sequence in enumerate(project.sequences)
        ]
    return value


class Api:
    """Stateful, dependency-injectable bridge exposed as window.pywebview.api."""

    def __init__(self, transcriber: Transcriber | None = None,
                 player: Player | None = None) -> None:
        self._window = None
        self._auth = license.load_auth()
        self._transcriber = transcriber or Transcriber()
        self._player = player or Player()
        self._projects: list[premiere.Project] = []
        self._project: premiere.Project | None = None
        self._sequence: premiere.SequenceInfo | None = None
        self._audio = None
        self._script: FullScript | None = None
        self._busy = False
        self._login_cancel: threading.Event | None = None
        self._recognition_job_id: str | None = None
        self._split_job_id: str | None = None

    def set_window(self, window) -> None:
        self._window = window

    def _emit(self, event: str, data=None) -> None:
        if self._window is None:
            return
        payload = json.dumps({"event": event, "data": data}, ensure_ascii=False)
        try:
            self._window.evaluate_js(f"window.__pyEvent && window.__pyEvent({payload})")
        except Exception:
            pass

    def _auth_state(self) -> dict:
        auth = self._auth or {}
        return {
            "logged_in": bool(auth.get("token")),
            "user_name": auth.get("user_name") or "",
            "email": auth.get("email") or "",
            "balance": auth.get("balance"),
        }

    def get_state(self) -> dict:
        return _ok(
            app={"name": APP_NAME, "version": VERSION},
            auth=self._auth_state(),
            languages=list(LANGUAGE_CHOICES),
            billing=billing.billing_meta(),
            project=(
                _project_dict(self._project, 0, include_sequences=True)
                if self._project else None
            ),
            sequence=(
                _sequence_dict(self._sequence, 0) if self._sequence else None
            ),
            busy=self._busy,
        )

    def refresh_me(self) -> dict:
        if not self._auth:
            return _error("로그인이 필요해요.")
        try:
            me = license.fetch_me(self._auth["token"])
            self._auth = license.save_auth(
                me.get("token") or self._auth["token"],
                me.get("user_name") or me.get("name") or self._auth.get("user_name"),
                me.get("balance"),
                me.get("email") or self._auth.get("email"),
            )
            return _ok(auth=self._auth_state())
        except RuntimeError as exc:
            if getattr(exc, "status", None) in (401, 403):
                self.logout()
            return _error(str(exc))

    def start_login(self) -> dict:
        if self._login_cancel is not None:
            return _error("이미 로그인을 진행하고 있어요.")
        cancel = threading.Event()
        self._login_cancel = cancel

        def work() -> None:
            try:
                self._auth = license.start_device_login(
                    on_status=lambda message: self._emit("login_status", {"message": message}),
                    on_code=lambda code, url: self._emit(
                        "login_code", {"code": code, "url": url}
                    ),
                    cancel_event=cancel,
                )
                self._emit("auth", self._auth_state())
            except Exception as exc:
                if str(exc) != "cancelled":
                    self._emit("login_error", {"message": str(exc)})
            finally:
                self._login_cancel = None

        threading.Thread(target=work, daemon=True).start()
        return _ok()

    def cancel_login(self) -> dict:
        if self._login_cancel:
            self._login_cancel.set()
        return _ok()

    def logout(self) -> dict:
        license.clear_auth()
        self._auth = None
        return _ok(auth=self._auth_state())

    def fetch_history(self) -> dict:
        if not self._auth:
            return _error("로그인이 필요해요.")
        try:
            return _ok(history=license.fetch_history(self._auth["token"]))
        except RuntimeError as exc:
            return _error(str(exc))

    def list_projects(self) -> dict:
        try:
            self._projects = premiere.list_projects()
        except Exception as exc:
            return _error(f"프리미어 프로젝트 탐색에 실패했어요: {exc}")
        return _ok(
            projects=[
                _project_dict(project, index)
                for index, project in enumerate(self._projects)
            ]
        )

    def pick_project_file(self, path: str | None = None) -> dict:
        if path is None:
            if self._window is None:
                return _error("창이 준비되지 않았어요.")
            import webview
            picked = self._window.create_file_dialog(
                webview.OPEN_DIALOG,
                file_types=("Premiere Pro 프로젝트 (*.prproj)",),
            )
            if not picked:
                return _ok(cancelled=True)
            path = picked[0]
        try:
            project = premiere.parse_project(path)
        except (OSError, ValueError, RuntimeError) as exc:
            return _error(str(exc))
        self._projects = [
            project,
            *[item for item in self._projects if item.path != project.path],
        ]
        self._set_project(project)
        return _ok(project=_project_dict(project, 0, include_sequences=True))

    def add_project_root(self) -> dict:
        if self._window is None:
            return _error("창이 준비되지 않았어요.")
        import webview
        picked = self._window.create_file_dialog(webview.FOLDER_DIALOG)
        if not picked:
            return _ok(cancelled=True)
        try:
            premiere.add_manual_project_root(picked[0])
        except (OSError, ValueError) as exc:
            return _error(str(exc))
        return self.list_projects()

    def select_project(self, project_index: int) -> dict:
        try:
            index = int(project_index)
            project = premiere.parse_project(self._projects[index].path)
            self._projects[index] = project
        except (IndexError, TypeError, ValueError, OSError, RuntimeError) as exc:
            return _error(f"프로젝트를 열지 못했어요: {exc}")
        self._set_project(project)
        return _ok(project=_project_dict(project, index, include_sequences=True))

    def _set_project(self, project: premiere.Project) -> None:
        self._project = project
        self._sequence = None
        self._audio = None
        self._script = None
        self._recognition_job_id = None
        self._split_job_id = None

    def select_sequence(self, sequence_index: int) -> dict:
        if not self._project:
            return _error("먼저 프리미어 프로젝트를 선택해 주세요.")
        try:
            index = int(sequence_index)
            sequence = self._project.sequences[index]
        except (IndexError, TypeError, ValueError):
            return _error("시퀀스를 다시 선택해 주세요.")
        self._sequence = sequence
        self._audio = None
        self._script = None
        self._recognition_job_id = None
        self._split_job_id = None
        return _ok(sequence=_sequence_dict(sequence, index))

    def start_transcription(self, language: str | None = None) -> dict:
        if self._busy:
            return _error("이미 작업이 진행 중이에요.")
        if not self._auth:
            return _error("로그인이 필요해요.")
        if not self._project or not self._sequence:
            return _error("먼저 프리미어 프로젝트와 시퀀스를 선택해 주세요.")
        language_code = LANGUAGE_CHOICES.get(language, language or None)
        self._busy = True
        threading.Thread(
            target=self._transcription_worker,
            args=(self._project, self._sequence, language_code),
            daemon=True,
        ).start()
        return _ok()

    # Compatibility with frontends that use the shorter related-app method name.
    start_transcribe = start_transcription

    def _transcription_worker(
        self,
        project: premiere.Project,
        sequence: premiere.SequenceInfo,
        language: str | None,
    ) -> None:
        try:
            self._emit("progress", {
                "message": f"[{sequence.name}] 타임라인 오디오를 구성하고 있어요."
            })
            built = premiere.build_sequence_audio(project, sequence)
            audio = built.audio
            if len(audio) == 0:
                raise RuntimeError("시퀀스에서 오디오를 찾지 못했어요.")
            script = self._transcriber.transcribe(
                audio,
                language=language,
                progress=lambda message: self._emit("progress", {"message": message}),
                progress_ratio=lambda ratio: self._emit(
                    "progress_ratio", {"ratio": max(0.0, min(1.0, ratio))}
                ),
            )
            if not script.text:
                raise RuntimeError("인식된 음성이 없어요. 코인은 차감되지 않았어요.")
            media_duration = built.duration_us
            job_id = self._recognition_job_id or license.new_job_id()
            charged = license.consume_recognition(
                self._auth["token"], media_duration, job_id
            )
            self._recognition_job_id = job_id
            if charged.get("balance") is not None:
                self._auth = license.save_auth(
                    self._auth["token"], self._auth.get("user_name"),
                    charged["balance"], self._auth.get("email"),
                )
            self._audio, self._script = audio, script
            self._emit("script_ready", {
                "text": script.text,
                "language": script.language,
                "language_probability": script.language_probability,
                "duration_us": media_duration,
                "recognition_coins": billing.recognition_coins(media_duration),
                "manual_split_coins": billing.manual_split_coins(),
                "missing_files": built.missing_files,
                "warnings": built.warnings,
                "auth": self._auth_state(),
            })
        except Exception as exc:
            traceback.print_exc()
            self._emit("transcribe_error", {"message": str(exc)})
        finally:
            self._busy = False

    def build_enter_blocks(self, script_text: str) -> dict:
        if not self._script:
            return _error("먼저 전문을 인식해 주세요.")
        lines = build_enter_lines(script_text, self._script.words)
        if not lines:
            return _error("Enter로 나눈 자막 줄을 타임코드에 연결하지 못했어요.")
        if self._auth:
            job_id = self._split_job_id or license.new_job_id()
            try:
                charged = license.consume_manual_split(
                    self._auth["token"], duration_us(self._audio), job_id
                )
            except RuntimeError as exc:
                return _error(str(exc))
            self._split_job_id = job_id
            if charged.get("balance") is not None:
                self._auth = license.save_auth(
                    self._auth["token"], self._auth.get("user_name"),
                    charged["balance"], self._auth.get("email"),
                )
        return _ok(
            blocks=[_line_dict(line) for line in lines],
            manual_split_coins=billing.manual_split_coins(),
            auth=self._auth_state(),
        )

    build_blocks = build_enter_blocks

    def export_srt(self, blocks: list[dict], path: str | None = None) -> dict:
        lines = _dict_lines(blocks)
        if not lines:
            return _error("내보낼 자막이 없어요.")
        if path is None:
            if self._window is None:
                return _error("창이 준비되지 않았어요.")
            import webview
            default_name = (self._sequence.name if self._sequence else "subtitles") + ".srt"
            picked = self._window.create_file_dialog(
                webview.SAVE_DIALOG,
                save_filename=default_name,
                file_types=("자막 파일 (*.srt)",),
            )
            if not picked:
                return _ok(cancelled=True)
            path = picked if isinstance(picked, str) else picked[0]
        try:
            dump_srt(lines, path)
        except OSError as exc:
            return _error(f"SRT 저장에 실패했어요: {exc}")
        return _ok(path=str(Path(path).resolve()), count=len(lines))

    def preview_play(self, start_us: int, end_us: int) -> dict:
        if self._audio is None:
            return _error("전문 인식 후 미리듣기를 사용할 수 있어요.")
        start = max(0, round(int(start_us) * SAMPLE_RATE / 1_000_000))
        end = min(len(self._audio), round(int(end_us) * SAMPLE_RATE / 1_000_000))
        if end <= start:
            return _error("재생할 구간이 없어요.")
        try:
            self._player.play(self._audio[start:end])
        except RuntimeError as exc:
            return _error(str(exc))
        return _ok()

    def preview_stop(self) -> dict:
        self._player.stop()
        return _ok()

    def reset_job(self) -> dict:
        if self._busy:
            return _error("받아쓰기가 끝난 뒤 새 작업을 시작해 주세요.")
        self._player.stop()
        self._project = None
        self._sequence = None
        self._audio = None
        self._script = None
        self._recognition_job_id = None
        self._split_job_id = None
        return _ok()

    def cleanup(self) -> None:
        self._player.cleanup()
