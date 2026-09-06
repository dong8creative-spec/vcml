"""웹 UI(JS) ↔ Python 브리지.

pywebview의 js_api로 노출된다. JS에서 window.pywebview.api.<메서드>(...)로
호출하면 각 호출이 별도 스레드에서 실행되고 Promise로 반환된다.
오래 걸리는 작업(전문 인식)은 내부 스레드로 돌리고 진행 상황을
window.__pyEvent({event, data}) 이벤트로 push한다.

로그인·코인 없음 — 전사·번역·삽입 전부 로컬에서 무료로 동작한다.
번역은 Argos Translate(translate_local.py)로 완전 오프라인 처리한다.
"""

from __future__ import annotations

import json
import re
import threading
import time
import traceback
from pathlib import Path

from . import APP_NAME, VERSION
from . import capcut
from . import license as license_api
from . import srt as srt_io
from . import styles
from . import translate_local
from .inject import inject_subtitles
from .playback import Player
from . import keyword_spans
from .dev_util import dev_log, is_dev_mode
from .pro_plan import build_lines_auto, build_lines_from_script, _clamp_word_range
from .transcribe import (LANGUAGE_CHOICES, MODEL, SR, FullScript,
                         SubtitleLine, Transcriber, _close_gaps,
                         _refine_speech_boundaries, audio_has_speech)

TRANSLATION_LANGS = {
    "en": "영어",
    "ja": "일본어",
    "zh": "중국어",
}


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


def _dicts_to_lines(blocks: list[dict], text_key: str = "text") -> list[SubtitleLine]:
    out: list[SubtitleLine] = []
    for b in blocks:
        raw_text = str(b.get(text_key) or "")
        text = raw_text.strip()
        start = int(b.get("start_us", 0))
        end = int(b.get("end_us", 0))
        if text and end > start:
            spans = (_clean_spans(b.get("spans") or [], raw_text)
                     if text_key == "text" else [])
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
    ends = [int(b.get("end_us", 0) or 0) for b in (blocks or [])]
    return max(ends) if ends else 0


class Api:
    def __init__(self) -> None:
        self._window = None
        self._style_editor_window = None
        self._style_editor_url = ""
        self._editor_blocks: list[dict] = []
        self._editor_config: dict = {}
        self._transcriber = Transcriber()
        self._player = Player()

        self._projects: list[capcut.Project] = []
        self._project: capcut.Project | None = None
        self._audio = None                    # np.ndarray | None
        self._script: FullScript | None = None
        self._duration_us: int | None = None
        self._from_transcribe = False
        self._source_lang: str = ""
        self._split_mode: str | None = None

        self._busy = False
        self._prewarm_started = False

    def set_window(self, window) -> None:
        self._window = window
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
            languages=list(LANGUAGE_CHOICES.keys()),
            styles=styles.list_presets(),
            capcut_running=running,
        )

    # --------------------------------------------------------------- 광고
    def get_banner_ad(self, slot: str) -> dict:
        return _ok(**license_api.fetch_banner_ad(slot))

    def report_ad_click(self, campaign_id: str) -> dict:
        license_api.report_ad_click(campaign_id)
        return _ok()

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
        """전문 인식 시작 (백그라운드). 진행/완료는 이벤트로 push."""
        if self._busy:
            return _err("이미 작업이 진행 중이에요.")
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
        try:
            status(f"[{project.name}] 타임라인 오디오를 분석하고 있어요...")
            res = capcut.build_timeline_audio(project)
            if not res.used_files:
                raise RuntimeError(
                    "인식할 오디오를 찾지 못했어요. 프로젝트의 음성 파일을 확인해 주세요.")

            status("발화(말)가 있는지 확인하고 있어요…")
            if not audio_has_speech(res.audio):
                raise RuntimeError("오디오에서 말을 찾지 못했어요.")

            duration_us = res.duration_us or int(len(res.audio) * 1_000_000 / SR)
            minutes = max(1, -(-duration_us // 60_000_000))
            self._transcriber.load(MODEL, progress=status)
            script = self._transcriber.transcribe_full_script(
                res.audio, language=language,
                progress=status, progress_ratio=ratio)
            if not (script.text or "").strip():
                raise RuntimeError("자막으로 인식된 내용이 없어요.")

            self._audio = res.audio
            self._script = script
            self._duration_us = duration_us
            self._from_transcribe = True
            self._source_lang = script.language or ""
            self._emit("script_ready", {
                "text": script.text,
                "language": script.language,
                "minutes": minutes,
                "duration_us": duration_us,
                "missing_files": res.missing_files,
            })
        except Exception as e:
            traceback.print_exc()
            self._emit("transcribe_error", {"message": str(e) or "전문 인식에 실패했어요."})
        finally:
            self._busy = False

    # ------------------------------------------------------------- 자막 블록
    def build_blocks_auto(self, *word_args: int) -> dict:
        """자동 어절 분할 → 타임코드 블록.

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
            lines = _close_gaps(_refine_speech_boundaries(lines, self._audio))
        blocks = _lines_to_dicts(lines)
        duration_us = _duration_us_from_blocks(blocks) or self._duration_us or 0
        self._duration_us = duration_us
        self._split_mode = "auto"
        return _ok(blocks=blocks, duration_us=duration_us, split_mode="auto")

    def build_blocks(self, script_text: str) -> dict:
        """엔터로 나눈 전문 → 타임코드 자막 블록."""
        if not self._script:
            return _err("먼저 전문을 인식해 주세요.")
        lines = build_lines_from_script(script_text or "", self._script.words)
        if not lines:
            return _err("타임코드를 만들 수 있는 자막 줄이 없어요.")
        if self._audio is not None and len(self._audio) > 0:
            lines = _close_gaps(_refine_speech_boundaries(lines, self._audio))
        blocks = _lines_to_dicts(lines)
        duration_us = _duration_us_from_blocks(blocks) or self._duration_us or 0
        self._duration_us = duration_us
        self._split_mode = "manual"
        return _ok(blocks=blocks, duration_us=duration_us, split_mode="manual")

    # --------------------------------------------------------------- 번역
    def translate_blocks(self, blocks: list[dict], target_lang: str) -> dict:
        """블록별 번역(Argos Translate, 완전 오프라인·무료)."""
        if self._busy:
            return _err("이미 작업이 진행 중이에요.")
        lang = str(target_lang or "").strip().lower()
        if lang not in TRANSLATION_LANGS:
            return _err("지원하지 않는 번역 언어예요. (영어/일본어/중국어)")
        safe_blocks = []
        for b in blocks or []:
            text = str(b.get("text") or "").strip()
            start = int(b.get("start_us", 0) or 0)
            end = int(b.get("end_us", 0) or 0)
            if text and end > start:
                item = {"start_us": start, "end_us": end, "text": text}
                if b.get("spans"):
                    item["spans"] = b.get("spans")
                safe_blocks.append(item)
        if not safe_blocks:
            return _err("번역할 자막 블록이 없어요.")

        source_lang = self._source_lang or (
            self._script.language if self._script else "")
        self._busy = True
        try:
            out_blocks = translate_local.translate_blocks(safe_blocks, lang, source_lang)
        except Exception as e:
            traceback.print_exc()
            return _err(str(e) or "번역에 실패했어요.")
        finally:
            self._busy = False
        return _ok(
            blocks=out_blocks,
            target_lang=lang,
            target_language_label=TRANSLATION_LANGS[lang],
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
            background_color="#FFFDFB",
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
        self._source_lang = ""
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
    @staticmethod
    def _parse_clip_cuts(clip_cuts) -> list[tuple[int, int]]:
        """프런트가 넘긴 [{start_us,end_us}, ...] → [(s,e), ...] (양수 길이만)."""
        out: list[tuple[int, int]] = []
        for c in clip_cuts or []:
            try:
                s, e = int(c.get("start_us", 0)), int(c.get("end_us", 0))
            except (AttributeError, TypeError, ValueError):
                continue
            if e > s:
                out.append((s, e))
        return out

    def inject(self, blocks: list[dict], style_key: str,
               size: str = "medium", position: str = "bottom",
               project_index: int | None = None,
               inject_mode: str = "original",
               clip_cuts: list[dict] | None = None) -> dict:
        # 삽입 시점의 UI 선택을 최종 기준으로 다시 고정 (SRT/인식 공통)
        if project_index is None:
            return _err("프로젝트를 먼저 선택해 주세요.")
        sel = self.select_project(project_index)
        if not sel.get("ok"):
            return sel
        lines = _dicts_to_lines(blocks or [])
        translated_lines = _dicts_to_lines(blocks or [], text_key="text_translated")
        if inject_mode in ("original", "both") and not lines:
            return _err("삽입할 자막이 없어요.")
        if inject_mode in ("translated", "both") and not translated_lines:
            return _err("번역된 자막이 없어요. 먼저 번역을 실행해 주세요.")
        cuts = capcut.merge_ranges(self._parse_clip_cuts(clip_cuts))
        style = styles.build_style(style_key, size=size, position=position)
        try:
            backup = inject_subtitles(
                self._project.dir, lines, style,
                translated_lines=(translated_lines
                                  if inject_mode in ("translated", "both") else None),
                inject_mode=inject_mode,
                clip_delete_ranges=cuts or None,
            )
        except Exception as e:
            traceback.print_exc()
            return _err(f"삽입에 실패했어요: {e}")
        count = len(lines) if inject_mode in ("original", "both") else 0
        if inject_mode in ("translated", "both"):
            count += len(translated_lines)
        return _ok(count=count, backup=str(backup),
                   project=self._project.name, inject_mode=inject_mode,
                   clip_cuts=len(cuts),
                   removed_us=sum(e - s for s, e in cuts))

    # ---------------------------------------------------------------- 기타
    def open_external_link(self, url: str) -> dict:
        """광고 등 외부(광고주) 링크를 앱 창이 아니라 기본 브라우저로 연다."""
        import webbrowser
        url = str(url or "").strip()
        if not url.lower().startswith(("http://", "https://")):
            return _err("올바르지 않은 링크예요.")
        try:
            webbrowser.open(url)
            return _ok()
        except Exception as e:
            return _err(f"링크를 열지 못했어요: {e}")

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
