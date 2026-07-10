"""도각 자막패치 GUI (Tkinter) - 브루(Vrew) 스타일 문서 편집."""

from __future__ import annotations

import re
import threading
import time
import traceback
import tkinter as tk
from tkinter import filedialog, ttk

import numpy as np

from . import __version__, capcut, inject, theme
from . import license as license_api
from . import srt as srt_io
from .playback import Player
from .transcribe import (LANGUAGE_CHOICES, MODEL, SubtitleLine,
                         Transcriber, merge_lines, split_line)
from .theme import toast, confirm

US = 1_000_000
SR = 16000


def _fmt_sec(us: int) -> str:
    s = us / US
    return f"{int(s // 60)}:{s % 60:05.2f}"


def _parse_sec(text: str) -> int:
    text = text.strip()
    m = re.match(r"^(?:(\d+):)?(\d+(?:\.\d+)?)$", text)
    if not m:
        raise ValueError(f"시간 형식이 잘못됨: {text}")
    minutes = int(m.group(1) or 0)
    return int((minutes * 60 + float(m.group(2))) * US)


class App(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title(f"도각 자막패치 v{__version__}")
        self.geometry("1000x720")
        self.minsize(820, 560)
        self.configure(bg=theme.WHITE)
        theme.apply_style(self)

        self.projects: list[capcut.Project] = []
        self.lines: list[SubtitleLine] = []
        self.blocks: list[dict] = []
        self.transcriber = Transcriber()
        self.player = Player()
        self._audio: np.ndarray | None = None
        self._busy = False
        self._playing = False
        self._play_after_id: str | None = None
        self._play_start_wall = 0.0
        self._play_start_us = 0
        self._highlighted_idx: int | None = None
        self._last_focus_idx: int | None = None
        self._auth = license_api.load_auth()
        self._balance: int | None = self._auth.get("balance") if self._auth else None

        self._build_ui()
        self.refresh_projects()
        self._refresh_auth_ui()
        self.protocol("WM_DELETE_WINDOW", self._on_close)
        if self._auth:
            threading.Thread(target=self._refresh_balance_worker, daemon=True).start()
        else:
            self.after(500, self._prompt_login_on_start)

    def _on_close(self) -> None:
        self.player.cleanup()
        self.destroy()

    # ------------------------------------------------------------- UI 구성
    def _build_ui(self) -> None:
        root = ttk.Frame(self, padding=8)
        root.pack(fill="both", expand=True)

        # 계정 / 코인
        auth_frame = ttk.Frame(root)
        auth_frame.pack(fill="x", pady=(0, 6))
        self.auth_var = tk.StringVar(value="로그인 필요")
        ttk.Label(auth_frame, textvariable=self.auth_var,
                 foreground=theme.TEXT_MUTED).pack(side="left")
        self.login_btn = theme.RoundedButton(
            auth_frame, "구글 로그인", command=self.on_login,
            fill=theme.SKY, hover=theme.SKY_DARK, fg=theme.TEXT_DARK, min_width=110)
        self.login_btn.pack(side="right")
        self.logout_btn = theme.RoundedButton(
            auth_frame, "로그아웃", command=self.on_logout,
            fill=theme.SKY, hover=theme.SKY_DARK, fg=theme.TEXT_DARK, min_width=90)

        # 프로젝트 선택
        proj_frame = ttk.LabelFrame(root, text="1. 캡컷 프로젝트 선택", padding=6)
        proj_frame.pack(fill="x")
        self.proj_tree = ttk.Treeview(
            proj_frame, columns=("name", "dur", "mtime"), show="headings", height=4)
        for col, text, w in (("name", "프로젝트 이름", 380),
                             ("dur", "길이", 90), ("mtime", "마지막 수정", 170)):
            self.proj_tree.heading(col, text=text)
            self.proj_tree.column(col, width=w, anchor="w")
        self.proj_tree.pack(side="left", fill="x", expand=True)
        self.proj_tree.bind("<<TreeviewSelect>>", lambda e: setattr(self, "_audio", None))
        theme.RoundedButton(proj_frame, "새로고침", command=self.refresh_projects,
                           fill=theme.SKY, hover=theme.SKY_DARK, fg=theme.TEXT_DARK
                           ).pack(side="left", padx=6, anchor="n")

        # 옵션
        opt = ttk.LabelFrame(root, text="2. 인식 옵션", padding=6)
        opt.pack(fill="x", pady=(8, 0))
        self.lang_var = tk.StringVar(value="자동 감지")
        self.max_words_var = tk.IntVar(value=5)
        self.size_var = tk.DoubleVar(value=7.0)
        self.posy_var = tk.DoubleVar(value=-0.8)
        self.border_var = tk.BooleanVar(value=True)
        self.bold_var = tk.BooleanVar(value=False)

        def add_opt(label: str, widget: tk.Widget) -> None:
            ttk.Label(opt, text=label).pack(side="left", padx=(10, 2))
            widget.pack(side="left")

        add_opt("언어", ttk.Combobox(opt, textvariable=self.lang_var,
                                    values=list(LANGUAGE_CHOICES), width=9, state="readonly"))
        add_opt("최대 어절", ttk.Spinbox(opt, from_=3, to=9, width=3,
                                        textvariable=self.max_words_var))
        add_opt("글자 크기", ttk.Spinbox(opt, from_=3, to=30, increment=0.5, width=5,
                                     textvariable=self.size_var))
        add_opt("세로 위치", ttk.Spinbox(opt, from_=-1.0, to=1.0, increment=0.1, width=5,
                                     textvariable=self.posy_var))
        ttk.Checkbutton(opt, text="테두리", variable=self.border_var).pack(side="left", padx=(10, 0))
        ttk.Checkbutton(opt, text="굵게", variable=self.bold_var).pack(side="left", padx=(6, 0))

        # 실행 버튼
        btns = ttk.Frame(root)
        btns.pack(fill="x", pady=8)
        self.gen_btn = theme.RoundedButton(btns, "① 자막 생성 (음성 인식)",
                                          command=self.on_generate)
        self.gen_btn.pack(side="left")
        self.insert_btn = theme.RoundedButton(btns, "② 캡컷 프로젝트에 삽입",
                                             command=self.on_insert)
        self.insert_btn.pack(side="left", padx=6)
        theme.RoundedButton(btns, "SRT 내보내기", command=self.on_export_srt,
                           fill=theme.SKY, hover=theme.SKY_DARK, fg=theme.TEXT_DARK
                           ).pack(side="left", padx=(18, 0))
        theme.RoundedButton(btns, "SRT 불러오기", command=self.on_import_srt,
                           fill=theme.SKY, hover=theme.SKY_DARK, fg=theme.TEXT_DARK
                           ).pack(side="left", padx=6)

        # 자막 편집 (브루 스타일 문서)
        doc_frame = ttk.LabelFrame(root, text="3. 자막 편집", padding=6)
        doc_frame.pack(fill="both", expand=True)

        doc_toolbar = ttk.Frame(doc_frame)
        doc_toolbar.pack(fill="x", pady=(0, 4))
        self.play_btn = theme.RoundedButton(doc_toolbar, "▶ 전체 재생",
                                           command=self.on_toggle_play_all, min_width=110)
        self.play_btn.pack(side="left")
        theme.RoundedButton(doc_toolbar, "+ 새 자막", command=self.on_add_row,
                           fill=theme.SKY, hover=theme.SKY_DARK, fg=theme.TEXT_DARK
                           ).pack(side="left", padx=6)
        ttk.Label(doc_toolbar, foreground=theme.TEXT_MUTED,
                 text="Enter: 커서 위치에서 분할   ·   Backspace(문장 맨 앞): 윗줄과 합치기   ·   시간 클릭: 그 지점부터 재생"
                 ).pack(side="left", padx=12)

        canvas_wrap = ttk.Frame(doc_frame)
        canvas_wrap.pack(fill="both", expand=True)
        self.doc_canvas = tk.Canvas(canvas_wrap, highlightthickness=0, bg=theme.WHITE)
        vsb = ttk.Scrollbar(canvas_wrap, orient="vertical", command=self.doc_canvas.yview)
        self.doc_inner = tk.Frame(self.doc_canvas, bg=theme.WHITE)
        self.doc_inner.bind(
            "<Configure>",
            lambda e: self.doc_canvas.configure(scrollregion=self.doc_canvas.bbox("all")))
        self._doc_window = self.doc_canvas.create_window((0, 0), window=self.doc_inner, anchor="nw")
        self.doc_canvas.bind(
            "<Configure>",
            lambda e: self.doc_canvas.itemconfigure(self._doc_window, width=e.width))
        self.doc_canvas.configure(yscrollcommand=vsb.set)
        self.doc_canvas.pack(side="left", fill="both", expand=True)
        vsb.pack(side="left", fill="y")
        self.doc_canvas.bind_all("<MouseWheel>",
                                 lambda e: self.doc_canvas.yview_scroll(int(-e.delta / 120), "units"))

        # 상태 표시
        status = ttk.Frame(root)
        status.pack(fill="x", pady=(8, 0))
        self.progress = ttk.Progressbar(status, mode="determinate", maximum=1.0)
        self.progress.pack(side="left", fill="x", expand=True)
        self.status_var = tk.StringVar(value="프로젝트를 선택하고 [① 자막 생성]을 누르세요.")
        ttk.Label(status, textvariable=self.status_var).pack(side="left", padx=8)

    # ------------------------------------------------------------ 프로젝트
    def refresh_projects(self) -> None:
        self.projects = capcut.list_projects()
        self.proj_tree.delete(*self.proj_tree.get_children())
        import datetime
        for i, p in enumerate(self.projects):
            mtime = datetime.datetime.fromtimestamp(p.mtime).strftime("%Y-%m-%d %H:%M")
            self.proj_tree.insert("", "end", iid=str(i),
                                  values=(p.name, p.duration_str, mtime))
        if self.projects:
            self.proj_tree.selection_set("0")
        else:
            self.set_status("캡컷 프로젝트를 찾지 못했습니다. 캡컷에서 프로젝트를 한 번 열어주세요.")

    def selected_project(self) -> capcut.Project | None:
        sel = self.proj_tree.selection()
        if not sel:
            toast(self, "먼저 프로젝트를 선택하세요.", "warning")
            return None
        return self.projects[int(sel[0])]

    # ------------------------------------------------------------- 상태
    def set_status(self, msg: str) -> None:
        self.after(0, lambda: self.status_var.set(msg))

    def set_ratio(self, r: float) -> None:
        self.after(0, lambda: self.progress.configure(value=r))

    def _set_busy(self, busy: bool) -> None:
        self._busy = busy
        state = "disabled" if busy else "normal"
        for b in (self.gen_btn, self.insert_btn, self.login_btn):
            b.configure(state=state)
        try:
            self.logout_btn.configure(state=state)
        except tk.TclError:
            pass

    def _refresh_auth_ui(self) -> None:
        if self._auth and self._auth.get("token"):
            name = self._auth.get("user_name") or "수강생"
            bal = self._balance
            bal_txt = f" · 코인 {bal}" if bal is not None else ""
            self.auth_var.set(f"{name} 로그인됨{bal_txt}")
            self.login_btn.pack_forget()
            self.logout_btn.pack(side="right")
        else:
            self.auth_var.set("로그인 필요 — 캡컷 초신속 스탠다드 수강생 전용")
            self.logout_btn.pack_forget()
            self.login_btn.pack(side="right")

    def _refresh_balance_worker(self) -> None:
        try:
            if not self._auth or not self._auth.get("token"):
                return
            me = license_api.fetch_me(self._auth["token"])
            self._balance = me.get("balance")
            self._auth = license_api.save_auth(
                self._auth["token"],
                self._auth.get("user_name"),
                self._balance,
            )
            self.after(0, self._refresh_auth_ui)
        except Exception:
            pass

    def on_login(self) -> None:
        if self._busy:
            return
        self._set_busy(True)
        self.set_status("브라우저에서 구글 로그인 후 기기를 연동하세요…")
        threading.Thread(target=self._login_worker, daemon=True).start()

    def _login_worker(self) -> None:
        try:
            auth = license_api.start_device_login(on_status=self.set_status)
            self._auth = auth
            self._balance = auth.get("balance")
            self.after(0, self._refresh_auth_ui)
            self.after(0, lambda: toast(self, "로그인되었습니다.", "success"))
            self.set_status("로그인 완료. 프로젝트를 선택하고 자막을 생성하세요.")
            try:
                me = license_api.fetch_me(auth["token"])
                self._balance = me.get("balance")
                self._auth = license_api.save_auth(auth["token"], auth.get("user_name"), self._balance)
                self.after(0, self._refresh_auth_ui)
            except Exception:
                pass
        except Exception as e:
            self.after(0, lambda: toast(self, str(e) or "로그인에 실패했습니다.", "error"))
            self.set_status("로그인 실패")
        finally:
            self.after(0, lambda: self._set_busy(False))

    def on_logout(self) -> None:
        license_api.clear_auth()
        self._auth = None
        self._balance = None
        self._refresh_auth_ui()
        toast(self, "로그아웃되었습니다.", "info")

    def _prompt_login_on_start(self) -> None:
        if self._auth and self._auth.get("token"):
            return
        ok = confirm(
            self,
            "구글 로그인",
            "도각 자막패치는 캡컷 초신속 스탠다드 수강생 전용입니다.\n"
            "브라우저에서 구글 로그인 후 이 기기를 연동할까요?",
            ok_text="로그인",
            cancel_text="나중에",
        )
        if ok:
            self.on_login()

    # ------------------------------------------------------------- 생성
    def on_generate(self) -> None:
        if self._busy:
            return
        if not self._auth or not self._auth.get("token"):
            toast(self, "먼저 구글 로그인해 주세요.", "warning")
            self.after(200, self._prompt_login_on_start)
            return
        project = self.selected_project()
        if project is None:
            return
        self._stop_playback()
        self._set_busy(True)
        self.progress.configure(value=0)
        threading.Thread(target=self._generate_worker, args=(project,), daemon=True).start()

    def _generate_worker(self, project: capcut.Project) -> None:
        job_id = None
        token = self._auth["token"] if self._auth else None
        consumed = False
        try:
            self.set_status(f"[{project.name}] 타임라인 오디오 분석 중...")
            res = capcut.build_timeline_audio(project)
            if res.missing_files:
                n = len(res.missing_files)
                self.after(0, lambda n=n: toast(
                    self, f"원본 {n}개를 찾지 못해 해당 구간은 제외됩니다.", "warning"))
            if not res.used_files:
                self.set_status("인식할 오디오가 없습니다.")
                return
            minutes = license_api.minutes_from_audio(len(res.audio), SR)
            job_id = license_api.new_job_id()
            self.set_status(f"코인 {minutes}개 차감 중… (약 {minutes}분)")
            try:
                consumed_res = license_api.consume(token, minutes, job_id)
            except Exception as e:
                payload = getattr(e, "payload", {}) or {}
                if payload.get("code") == "insufficient":
                    bal = payload.get("balance", 0)
                    need = payload.get("needed", minutes)
                    self.after(0, lambda: toast(
                        self,
                        f"코인이 부족합니다. (보유 {bal} / 필요 {need}) 수강 후기 작성 시 100코인이 추가됩니다.",
                        "error"))
                    self.set_status("코인 부족")
                    return
                raise
            consumed = True
            self._balance = consumed_res.get("balance", self._balance)
            if self._auth:
                self._auth = license_api.save_auth(token, self._auth.get("user_name"), self._balance)
            self.after(0, self._refresh_auth_ui)

            self.transcriber.load(MODEL, progress=self.set_status)
            lang = LANGUAGE_CHOICES.get(self.lang_var.get())
            lines = self.transcriber.transcribe(
                res.audio, language=lang,
                max_words_per_line=int(self.max_words_var.get()),
                progress=self.set_status,
                progress_ratio=self.set_ratio,
            )
            self.lines = lines
            self._audio = res.audio
            self.after(0, self._render_document)
            self.set_ratio(1.0)
            self.set_status(
                f"자막 {len(lines)}개 생성 완료 (−{minutes}코인). "
                f"자막을 직접 수정한 뒤 [② 캡컷 프로젝트에 삽입]을 누르세요."
            )
        except Exception as e:
            traceback.print_exc()
            if consumed and job_id and token:
                try:
                    refunded = license_api.refund(token, job_id)
                    self._balance = refunded.get("balance", self._balance)
                    if self._auth:
                        self._auth = license_api.save_auth(
                            token, self._auth.get("user_name"), self._balance)
                    self.after(0, self._refresh_auth_ui)
                except Exception:
                    traceback.print_exc()
            self.after(0, lambda: toast(self, "자막 생성에 실패했습니다.", "error"))
            self.set_status("자막 생성 실패")
        finally:
            self.after(0, lambda: self._set_busy(False))

    # ------------------------------------------------------- 문서형 자막 편집
    def _render_document(self) -> None:
        self._stop_playback()
        for child in self.doc_inner.winfo_children():
            child.destroy()
        self.blocks = []
        for i, line in enumerate(self.lines):
            self._add_block_widget(i, line)
        self.doc_inner.update_idletasks()
        self.doc_canvas.configure(scrollregion=self.doc_canvas.bbox("all"))

    def _add_block_widget(self, idx: int, line: SubtitleLine) -> None:
        card = theme.RoundedFrame(self.doc_inner, container_bg=theme.WHITE)
        card.pack(fill="x", padx=8, pady=5)
        content = card.inner

        header = ttk.Frame(content, style="Card.TFrame")
        header.pack(fill="x", padx=8, pady=(6, 0))
        ttk.Label(header, text=f"#{idx + 1}", width=4, style="Card.TLabel",
                 foreground=theme.PRIMARY, font=("맑은 고딕", 9, "bold")).pack(side="left")

        start_var = tk.StringVar(value=_fmt_sec(line.start_us))
        end_var = tk.StringVar(value=_fmt_sec(line.end_us))
        start_entry = ttk.Entry(header, textvariable=start_var, width=8)
        start_entry.pack(side="left", padx=(4, 2))
        ttk.Label(header, text="~", style="Card.TLabel").pack(side="left")
        end_entry = ttk.Entry(header, textvariable=end_var, width=8)
        end_entry.pack(side="left", padx=(2, 8))

        def commit_time(_e=None, i=idx, sv=start_var, ev=end_var) -> None:
            if i >= len(self.lines):
                return
            try:
                self.lines[i].start_us = _parse_sec(sv.get())
                self.lines[i].end_us = _parse_sec(ev.get())
            except ValueError:
                toast(self, "시간 형식이 올바르지 않습니다.", "warning")

        start_entry.bind("<Return>", commit_time)
        start_entry.bind("<FocusOut>", commit_time)
        end_entry.bind("<Return>", commit_time)
        end_entry.bind("<FocusOut>", commit_time)

        # 브루처럼 시간 영역을 클릭하면 그 지점부터 재생
        header.bind("<Button-1>", lambda e, i=idx: self._play_from(i))

        theme.RoundedButton(header, "▶", command=lambda i=idx: self._play_segment(i),
                           fill=theme.PRIMARY, hover=theme.PRIMARY_DARK,
                           container_bg=theme.CARD_FILL, min_width=32, padx=6
                           ).pack(side="left", padx=2)
        theme.RoundedButton(header, "⌃ 합치기", command=lambda i=idx: self._merge_with_previous(i),
                           fill=theme.WHITE, hover=theme.SKY_DARK, fg=theme.PRIMARY,
                           container_bg=theme.CARD_FILL, padx=8
                           ).pack(side="left", padx=2)
        theme.RoundedButton(header, "✕", command=lambda i=idx: self._delete_block(i),
                           fill=theme.CARD_FILL, hover=theme.DANGER_LIGHT,
                           fg=theme.DANGER, hover_fg=theme.DANGER_DARK,
                           container_bg=theme.CARD_FILL, min_width=32, padx=6
                           ).pack(side="right")

        text = tk.Text(content, height=2, wrap="word", font=("맑은 고딕", 12),
                       undo=True, relief="flat", bg=theme.WHITE, fg=theme.TEXT_DARK,
                       highlightthickness=1, highlightbackground=theme.SKY_BORDER,
                       highlightcolor=theme.PRIMARY, padx=6, pady=4)
        text.insert("1.0", line.text)
        text.pack(fill="x", padx=8, pady=(6, 8))
        text.bind("<Return>", lambda e, i=idx: self._on_enter_split(i))
        text.bind("<BackSpace>", lambda e, i=idx: self._on_backspace_merge(i))
        text.bind("<FocusIn>", lambda e, i=idx: setattr(self, "_last_focus_idx", i))
        text.bind("<FocusOut>", lambda e, i=idx: self._sync_text_one(i))

        self.blocks.append({"card": card, "text": text,
                            "start_var": start_var, "end_var": end_var})

    def _sync_text_one(self, idx: int) -> None:
        if idx < len(self.blocks) and idx < len(self.lines):
            try:
                self.lines[idx].text = self.blocks[idx]["text"].get("1.0", "end-1c").strip()
            except tk.TclError:
                pass

    def _sync_all_text(self) -> None:
        for i in range(min(len(self.blocks), len(self.lines))):
            self._sync_text_one(i)

    def _focus_block(self, idx: int, char_offset: int | None = None) -> None:
        if 0 <= idx < len(self.blocks):
            widget = self.blocks[idx]["text"]
            widget.focus_set()
            if char_offset is not None:
                widget.mark_set("insert", f"1.0+{char_offset}c")
            widget.see("insert")

    def _on_enter_split(self, idx: int):
        self._sync_all_text()
        text_widget = self.blocks[idx]["text"]
        offset = len(text_widget.get("1.0", "insert"))
        result = split_line(self.lines[idx], offset)
        if result is None:
            self.bell()
            return "break"
        left, right = result
        self.lines[idx:idx + 1] = [left, right]
        self._render_document()
        self._focus_block(idx + 1, char_offset=0)
        return "break"

    def _on_backspace_merge(self, idx: int):
        text_widget = self.blocks[idx]["text"]
        if text_widget.tag_ranges("sel") or text_widget.index("insert") != "1.0":
            return None  # 선택 영역이 있거나 커서가 맨 앞이 아니면 기본 backspace 동작
        if idx == 0:
            self.bell()
            return "break"
        self._merge_with_previous(idx)
        return "break"

    def _merge_with_previous(self, idx: int) -> None:
        if not (0 < idx < len(self.lines)):
            return
        self._sync_all_text()
        join_at = len(self.lines[idx - 1].text)
        merged = merge_lines([self.lines[idx - 1], self.lines[idx]])
        self.lines[idx - 1:idx + 1] = [merged]
        self._render_document()
        self._focus_block(idx - 1, char_offset=join_at)

    def _delete_block(self, idx: int) -> None:
        if not (0 <= idx < len(self.lines)):
            return
        self._sync_all_text()
        del self.lines[idx]
        self._render_document()

    def on_add_row(self) -> None:
        self._sync_all_text()
        if self.lines:
            idx = self._last_focus_idx if self._last_focus_idx is not None else len(self.lines) - 1
            idx = max(0, min(idx, len(self.lines) - 1))
            prev = self.lines[idx]
            self.lines.insert(idx + 1, SubtitleLine(prev.end_us, prev.end_us + 2 * US, "새 자막"))
            insert_at = idx + 1
        else:
            self.lines.append(SubtitleLine(0, 2 * US, "새 자막"))
            insert_at = 0
        self._render_document()
        self._focus_block(insert_at, char_offset=0)

    # ------------------------------------------------------------- 재생
    def _play_segment(self, idx: int) -> None:
        if self._audio is None:
            toast(self, "먼저 [① 자막 생성]을 실행하세요.", "info")
            return
        self._stop_playback()
        line = self.lines[idx]
        a = int(line.start_us * SR / US)
        b = int(line.end_us * SR / US)
        self.player.play(self._audio[a:b])

    def _play_from(self, idx: int) -> None:
        if self._audio is None:
            toast(self, "먼저 [① 자막 생성]을 실행하세요.", "info")
            return
        self._start_playback(self.lines[idx].start_us)

    def on_toggle_play_all(self) -> None:
        if self._playing:
            self._stop_playback()
            return
        if self._audio is None:
            toast(self, "먼저 [① 자막 생성]을 실행하세요.", "info")
            return
        self._start_playback(0)

    def _start_playback(self, from_us: int) -> None:
        self._stop_playback()
        a = int(from_us * SR / US)
        self.player.play(self._audio[a:])
        self._playing = True
        self._play_start_wall = time.monotonic()
        self._play_start_us = from_us
        self.play_btn.configure(text="■ 정지")
        self._tick_playback()

    def _tick_playback(self) -> None:
        if not self._playing:
            return
        elapsed_us = self._play_start_us + int((time.monotonic() - self._play_start_wall) * US)
        total_us = len(self._audio) * US // SR if self._audio is not None else 0
        if elapsed_us >= total_us:
            self._stop_playback()
            return
        self._highlight_at(elapsed_us)
        self._play_after_id = self.after(120, self._tick_playback)

    def _stop_playback(self) -> None:
        self._playing = False
        if self._play_after_id is not None:
            self.after_cancel(self._play_after_id)
            self._play_after_id = None
        self.player.stop()
        self.play_btn.configure(text="▶ 전체 재생")
        self._clear_highlight()

    def _highlight_at(self, us: int) -> None:
        idx = next((i for i, l in enumerate(self.lines) if l.start_us <= us < l.end_us), None)
        if idx == self._highlighted_idx:
            return
        self._clear_highlight()
        if idx is not None and idx < len(self.blocks):
            self.blocks[idx]["card"].set_colors(border=theme.PRIMARY, border_width=3)
            self.blocks[idx]["text"].configure(bg=theme.PRIMARY_LIGHT,
                                              highlightbackground=theme.PRIMARY)
            self._highlighted_idx = idx
            self._scroll_to(idx)

    def _clear_highlight(self) -> None:
        if self._highlighted_idx is not None and self._highlighted_idx < len(self.blocks):
            self.blocks[self._highlighted_idx]["card"].set_colors(
                border=theme.SKY_BORDER, border_width=1.5)
            self.blocks[self._highlighted_idx]["text"].configure(
                bg=theme.WHITE, highlightbackground=theme.SKY_BORDER)
        self._highlighted_idx = None

    def _scroll_to(self, idx: int) -> None:
        self.doc_inner.update_idletasks()
        total_h = max(1, self.doc_inner.winfo_height())
        y = self.blocks[idx]["card"].winfo_y()
        self.doc_canvas.yview_moveto(max(0.0, min(1.0, y / total_h)))

    # ------------------------------------------------------------- 삽입
    def on_insert(self) -> None:
        if self._busy:
            return
        project = self.selected_project()
        if project is None:
            return
        self._sync_all_text()
        if not self.lines:
            toast(self, "먼저 자막을 생성하거나 SRT를 불러오세요.", "warning")
            return
        if capcut.is_capcut_running():
            msg = ("캡컷에서 이 프로젝트가 열려 있다면 먼저 닫아주세요.\n"
                   "열린 상태로 삽입하면 자막이 사라질 수 있습니다.\n\n"
                   "계속 삽입할까요?")
            kind = "warning"
        else:
            msg = "선택한 프로젝트에 'AI 자막' 트랙을 추가합니다."
            kind = "info"
        if not confirm(self, "자막 삽입", msg, ok_text="삽입", kind=kind):
            return
        try:
            style = inject.SubtitleStyle(
                size=float(self.size_var.get()),
                border=self.border_var.get(),
                bold=self.bold_var.get(),
                transform_y=float(self.posy_var.get()),
            )
            backup = inject.inject_subtitles(project.dir, self.lines, style)
            toast(self, f"{len(self.lines)}개 자막이 삽입되었습니다.", "success")
            self.set_status("삽입 완료")
        except Exception as e:
            traceback.print_exc()
            self.after(0, lambda: toast(self, "삽입에 실패했습니다. 원본은 복구되었습니다.", "error"))

    # ------------------------------------------------------------- SRT
    def on_export_srt(self) -> None:
        self._sync_all_text()
        if not self.lines:
            toast(self, "내보낼 자막이 없습니다.", "warning")
            return
        path = filedialog.asksaveasfilename(
            defaultextension=".srt", filetypes=[("SRT 자막", "*.srt")])
        if path:
            srt_io.dump(self.lines, path)
            self.set_status(f"SRT 저장 완료: {path}")

    def on_import_srt(self) -> None:
        path = filedialog.askopenfilename(filetypes=[("SRT 자막", "*.srt")])
        if path:
            try:
                self.lines = srt_io.load(path)
                self._render_document()
                self.set_status(f"SRT {len(self.lines)}개 라인 불러옴")
            except Exception:
                toast(self, "SRT 파일을 읽지 못했습니다.", "error")


def main() -> None:
    app = App()
    app.mainloop()


if __name__ == "__main__":
    main()
