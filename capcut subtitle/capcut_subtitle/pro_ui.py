"""타닥싱크 프로 테스트 모달."""

from __future__ import annotations

import threading
import tkinter as tk
from tkinter import ttk
from typing import Callable

from . import theme
from .pro_plan import build_lines_from_script
from .transcribe import FullScript, SubtitleLine


class ProTestDialog(tk.Toplevel):
    """전문을 먼저 보고 Enter로 자막 블록을 정하는 실험 모달."""

    def __init__(
        self,
        parent,
        *,
        project_name: str,
        transcribe_func: Callable[[Callable[[str], None], Callable[[float], None]], FullScript],
        on_apply: Callable[[list[SubtitleLine]], None],
    ):
        super().__init__(parent)
        self._parent = parent
        self._project_name = project_name
        self._transcribe_func = transcribe_func
        self._on_apply = on_apply
        self._script: FullScript | None = None
        self._busy = False

        self.title("타닥싱크 프로 테스트")
        self.geometry("760x620")
        self.minsize(640, 500)
        self.configure(bg=theme.WHITE)
        self.transient(parent)
        self.grab_set()

        self._build()
        self.protocol("WM_DELETE_WINDOW", self._close)
        self.bind("<Escape>", lambda _e: self._close())

    def _build(self) -> None:
        root = ttk.Frame(self, padding=16)
        root.pack(fill="both", expand=True)

        ttk.Label(
            root,
            text="타닥싱크 프로 테스트",
            font=("맑은 고딕", 16, "bold"),
        ).pack(anchor="w")
        ttk.Label(
            root,
            text=(
                f"프로젝트: {self._project_name}\n"
                "전문을 먼저 인식한 뒤, Enter로 자막 블록을 나누고 적용하세요."
            ),
            foreground=theme.TEXT_MUTED,
            justify="left",
        ).pack(anchor="w", pady=(4, 12))

        btns = ttk.Frame(root)
        btns.pack(fill="x", pady=(0, 8))
        self.recognize_btn = theme.RoundedButton(
            btns, "전문 인식", command=self.on_recognize, min_width=110)
        self.recognize_btn.pack(side="left")
        self.apply_btn = theme.RoundedButton(
            btns, "적용", command=self.on_apply,
            fill=theme.SKY, hover=theme.SKY_DARK, fg=theme.TEXT_DARK, min_width=90)
        self.apply_btn.pack(side="left", padx=6)
        theme.RoundedButton(
            btns, "닫기", command=self._close,
            fill=theme.SKY, hover=theme.SKY_DARK, fg=theme.TEXT_DARK, min_width=80,
        ).pack(side="right")

        self.status_var = tk.StringVar(value="전문 인식을 눌러 시작하세요.")
        ttk.Label(btns, textvariable=self.status_var,
                 foreground=theme.TEXT_MUTED).pack(side="left", padx=10)

        self.progress = ttk.Progressbar(root, mode="determinate", maximum=1.0)
        self.progress.pack(fill="x", pady=(0, 8))

        text_frame = ttk.Frame(root)
        text_frame.pack(fill="both", expand=True)
        self.text = tk.Text(
            text_frame,
            wrap="word",
            font=("맑은 고딕", 12),
            undo=True,
            padx=10,
            pady=10,
            relief="solid",
            bd=1,
            highlightthickness=1,
            highlightcolor=theme.SKY_BORDER,
        )
        ysb = ttk.Scrollbar(text_frame, orient="vertical", command=self.text.yview)
        self.text.configure(yscrollcommand=ysb.set)
        self.text.pack(side="left", fill="both", expand=True)
        ysb.pack(side="left", fill="y")

        ttk.Label(
            root,
            text="Enter 한 줄 = 캡컷에 들어갈 자막 블록 하나입니다. 빈 줄은 무시됩니다.",
            foreground=theme.TEXT_MUTED,
        ).pack(anchor="w", pady=(8, 0))

    def _set_busy(self, busy: bool) -> None:
        self._busy = busy
        state = "disabled" if busy else "normal"
        self.recognize_btn.configure(state=state)
        self.apply_btn.configure(state=state)

    def _set_status(self, message: str) -> None:
        self.after(0, lambda: self.status_var.set(message))

    def _set_ratio(self, ratio: float) -> None:
        self.after(0, lambda: self.progress.configure(value=max(0.0, min(1.0, ratio))))

    def on_recognize(self) -> None:
        if self._busy:
            return
        self._set_busy(True)
        self.progress.configure(value=0)
        self.status_var.set("전문 인식을 준비하고 있어요...")
        threading.Thread(target=self._recognize_worker, daemon=True).start()

    def _recognize_worker(self) -> None:
        try:
            script = self._transcribe_func(self._set_status, self._set_ratio)
            self._script = script
            self.after(0, lambda: self._show_script(script))
        except Exception as e:
            msg = str(e) or "전문 인식에 실패했어요."
            self._set_status(msg)
            self.after(0, lambda m=msg: theme.toast(self, m, "error"))
        finally:
            self.after(0, lambda: self._set_busy(False))

    def _show_script(self, script: FullScript) -> None:
        self.text.delete("1.0", "end")
        self.text.insert("1.0", script.text)
        self.progress.configure(value=1.0)
        self.status_var.set("전문 인식 완료. Enter로 줄을 나눈 뒤 적용하세요.")

    def on_apply(self) -> None:
        if self._busy:
            return
        if not self._script:
            theme.toast(self, "먼저 전문을 인식해 주세요.", "warning")
            return
        edited = self.text.get("1.0", "end").strip()
        lines = build_lines_from_script(edited, self._script.words)
        if not lines:
            theme.toast(self, "타임코드를 만들 수 있는 자막 줄이 없습니다.", "warning")
            return
        self._on_apply(lines)
        theme.toast(self._parent, f"프로 테스트 자막 {len(lines)}개를 적용했어요.", "success")
        self._close()

    def _close(self) -> None:
        if self._busy:
            theme.toast(self, "진행 중입니다. 잠시만 기다려 주세요.", "warning")
            return
        try:
            self.grab_release()
        except Exception:
            pass
        self.destroy()
