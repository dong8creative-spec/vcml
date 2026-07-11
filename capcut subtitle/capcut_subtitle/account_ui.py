"""계정 관련 팝업: 로그인, 내 정보(코인·사용내역), 코인 충전."""

from __future__ import annotations

import threading
import tkinter as tk
from tkinter import ttk

from . import theme
from . import license as license_api
from .theme import PRIMARY, SKY, SKY_DARK, TEXT_DARK, TEXT_MUTED, WHITE, DANGER
from .theme import RoundedButton, _center_over, toast

_REASON_LABEL = {
    "initial": "최초 지급",
    "review_bonus": "후기 보너스",
    "consume": "자막 생성",
    "refund": "환불",
}


class LoginDialog(tk.Toplevel):
    """브랜딩된 로그인 팝업.

    안내 → 연동 코드 표시·대기 → 완료/실패까지 한 창에서 처리한다.
    exit_on_cancel이 True면(=아직 로그인 전 상태에서 뜬 경우) 취소 버튼 텍스트가
    '종료'로 바뀌고, 콜백(on_done)이 None을 받은 쪽에서 앱 종료 여부를 판단한다.
    """

    def __init__(self, parent, exit_on_cancel: bool, on_done) -> None:
        super().__init__(parent)
        self._exit_on_cancel = exit_on_cancel
        self._on_done = on_done
        self._cancel_event = threading.Event()
        self._done = False

        self.title("타닥싱크 로그인")
        self.resizable(False, False)
        self.configure(bg=WHITE)
        self.transient(parent)
        self.attributes("-topmost", True)
        self.protocol("WM_DELETE_WINDOW", self._cancel)

        card = tk.Frame(self, bg=WHITE)
        card.pack(fill="both", expand=True, padx=28, pady=24)

        tk.Label(card, text="타닥싱크", font=("맑은 고딕", 20, "bold"),
                 fg=PRIMARY, bg=WHITE).pack(pady=(0, 2))
        tk.Label(card, text="TadakSync", font=("맑은 고딕", 9),
                 fg=TEXT_MUTED, bg=WHITE).pack(pady=(0, 18))

        self._body = tk.Frame(card, bg=WHITE)
        self._body.pack(fill="both", expand=True)

        self._show_intro()

        self.update_idletasks()
        _center_over(self, parent, max(360, self.winfo_reqwidth()), self.winfo_reqheight())
        self.grab_set()
        self.bind("<Escape>", lambda e: self._cancel())

    # ------------------------------------------------------------ 화면 전환
    def _clear_body(self) -> None:
        for w in self._body.winfo_children():
            w.destroy()

    def _cancel_label(self) -> str:
        return "종료" if self._exit_on_cancel else "취소"

    def _show_intro(self) -> None:
        self._clear_body()
        tk.Label(self._body,
                 text="캡컷 초신속 스탠다드 수강생 전용입니다.\n"
                      "구글 로그인 후 이 기기를 연동해야 사용할 수 있습니다.",
                 font=("맑은 고딕", 10), fg=TEXT_MUTED, bg=WHITE, justify="center",
                 wraplength=320).pack(pady=(0, 20))
        btns = tk.Frame(self._body, bg=WHITE)
        btns.pack()
        RoundedButton(btns, "구글 로그인 시작", command=self._start,
                      min_width=140).pack(side="left", padx=4)
        RoundedButton(btns, self._cancel_label(), command=self._cancel,
                      fill=SKY, hover=SKY_DARK, fg=TEXT_DARK).pack(side="left", padx=4)

    def _start(self) -> None:
        self._clear_body()
        tk.Label(self._body, text="브라우저에서 구글 로그인 후 연동해 주세요",
                 font=("맑은 고딕", 10), fg=TEXT_MUTED, bg=WHITE).pack(pady=(0, 10))

        self._code_var = tk.StringVar(value="발급 중…")
        code_row = tk.Frame(self._body, bg=WHITE)
        code_row.pack(pady=(0, 6))
        tk.Label(code_row, textvariable=self._code_var, font=("Consolas", 17, "bold"),
                 fg=PRIMARY, bg=WHITE).pack(side="left")
        self._copy_btn = RoundedButton(code_row, "복사", command=self._copy_code,
                                       fill=SKY, hover=SKY_DARK, fg=TEXT_DARK, min_width=50)
        self._copy_btn.pack(side="left", padx=(10, 0))

        self._status_var = tk.StringVar(value="연동 코드를 발급하는 중…")
        tk.Label(self._body, textvariable=self._status_var, font=("맑은 고딕", 9),
                 fg=TEXT_MUTED, bg=WHITE, wraplength=320, justify="center").pack(pady=(4, 16))

        btns = tk.Frame(self._body, bg=WHITE)
        btns.pack()
        RoundedButton(btns, self._cancel_label(), command=self._cancel,
                      fill=SKY, hover=SKY_DARK, fg=TEXT_DARK).pack()

        self._cancel_event.clear()
        threading.Thread(target=self._worker, daemon=True).start()

    def _copy_code(self) -> None:
        code = self._code_var.get().strip()
        if code and code != "발급 중…":
            self.clipboard_clear()
            self.clipboard_append(code)
            self._status_var.set("코드를 복사했습니다.")

    # ------------------------------------------------------------- 로직
    def _worker(self) -> None:
        try:
            auth = license_api.start_device_login(
                on_status=lambda m: self.after(0, lambda m=m: self._safe_set_status(m)),
                on_code=lambda code, url: self.after(0, lambda c=code: self._safe_set_code(c)),
                cancel_event=self._cancel_event,
            )
            self.after(0, lambda: self._succeed(auth))
        except Exception as e:
            if str(e) == "cancelled":
                return
            msg = str(e) or "로그인에 실패했습니다."
            self.after(0, lambda: self._fail(msg))

    def _safe_set_status(self, msg: str) -> None:
        try:
            self._status_var.set(msg)
        except tk.TclError:
            pass

    def _safe_set_code(self, code: str) -> None:
        try:
            self._code_var.set(code)
        except tk.TclError:
            pass

    def _succeed(self, auth: dict) -> None:
        self._done = True
        self._clear_body()
        tk.Label(self._body, text="✓ 연동 완료!", font=("맑은 고딕", 14, "bold"),
                 fg=PRIMARY, bg=WHITE).pack(pady=24)
        self.after(700, lambda: self._finish(auth))

    def _fail(self, msg: str) -> None:
        self._clear_body()
        tk.Label(self._body, text=msg, font=("맑은 고딕", 10), fg=DANGER, bg=WHITE,
                 wraplength=320, justify="center").pack(pady=(0, 16))
        btns = tk.Frame(self._body, bg=WHITE)
        btns.pack()
        RoundedButton(btns, "다시 시도", command=self._start, min_width=90).pack(side="left", padx=4)
        RoundedButton(btns, self._cancel_label(), command=self._cancel,
                      fill=SKY, hover=SKY_DARK, fg=TEXT_DARK).pack(side="left", padx=4)

    def _cancel(self) -> None:
        self._cancel_event.set()
        was_done = self._done
        self.grab_release()
        self.destroy()
        if not was_done:
            self._on_done(None)

    def _finish(self, auth: dict) -> None:
        self.grab_release()
        self.destroy()
        self._on_done(auth)


class CoinPurchaseDialog(tk.Toplevel):
    """코인 충전 팝업. 결제(KG이니시스)는 아직 연동 전이라 안내만 표시한다."""

    _PACKAGES = [
        (100, 5_000),
        (300, 13_000),
        (1000, 40_000),
    ]

    def __init__(self, parent) -> None:
        super().__init__(parent)
        self.title("코인 충전")
        self.resizable(False, False)
        self.configure(bg=WHITE)
        self.transient(parent)
        self.attributes("-topmost", True)

        card = tk.Frame(self, bg=WHITE)
        card.pack(fill="both", expand=True, padx=24, pady=20)

        tk.Label(card, text="코인 충전", font=("맑은 고딕", 14, "bold"),
                 fg=PRIMARY, bg=WHITE).pack(anchor="w", pady=(0, 4))
        tk.Label(card, text="카드 결제(KG이니시스 연동)는 준비 중입니다. 곧 이용하실 수 있어요.",
                 font=("맑은 고딕", 9), fg=TEXT_MUTED, bg=WHITE,
                 wraplength=300, justify="left").pack(anchor="w", pady=(0, 14))

        self._choice = tk.IntVar(value=0)
        for i, (coins, price) in enumerate(self._PACKAGES):
            tk.Radiobutton(card, text=f"{coins}코인  —  {price:,}원 (가격 예정)",
                          variable=self._choice, value=i, bg=WHITE, fg=TEXT_DARK,
                          selectcolor=SKY, activebackground=WHITE,
                          font=("맑은 고딕", 10)).pack(anchor="w", pady=3)

        btn_row = tk.Frame(card, bg=WHITE)
        btn_row.pack(fill="x", pady=(16, 0))
        RoundedButton(btn_row, "결제하기 (준비 중)", command=self._notify_soon,
                      fill=theme.DISABLED_FILL, hover=theme.DISABLED_FILL,
                      fg=theme.DISABLED_FG).pack(side="left")
        RoundedButton(btn_row, "닫기", command=self.destroy,
                      fill=SKY, hover=SKY_DARK, fg=TEXT_DARK).pack(side="left", padx=(8, 0))

        self.update_idletasks()
        _center_over(self, parent, max(340, self.winfo_reqwidth()), self.winfo_reqheight())
        self.grab_set()

    def _notify_soon(self) -> None:
        toast(self, "카드 결제 연동을 준비 중입니다. 조금만 기다려 주세요!", "info")


class MemberInfoDialog(tk.Toplevel):
    """내 정보: 이름/이메일/코인 잔액/수강 상태 + 코인 사용 내역."""

    def __init__(self, parent, app) -> None:
        super().__init__(parent)
        self._app = app
        self.title("내 정보")
        self.resizable(False, False)
        self.configure(bg=WHITE)
        self.transient(parent)
        self.attributes("-topmost", True)

        card = tk.Frame(self, bg=WHITE)
        card.pack(fill="both", expand=True, padx=22, pady=18)

        auth = app._auth or {}
        tk.Label(card, text="내 정보", font=("맑은 고딕", 14, "bold"),
                 fg=PRIMARY, bg=WHITE).pack(anchor="w", pady=(0, 12))

        info = ttk.Frame(card)
        info.pack(fill="x", pady=(0, 10))
        enrolled_txt = "수강 중 · 기기 연동됨" if app._authenticated else "-"
        rows = [
            ("이름", auth.get("user_name") or "-"),
            ("이메일", auth.get("email") or "-"),
            ("보유 코인", f"{app._balance} 코인" if app._balance is not None else "-"),
            ("수강 상태", enrolled_txt),
        ]
        for i, (label, value) in enumerate(rows):
            ttk.Label(info, text=label, foreground=TEXT_MUTED, width=9
                     ).grid(row=i, column=0, sticky="w", pady=2)
            ttk.Label(info, text=value, font=("맑은 고딕", 10, "bold")
                     ).grid(row=i, column=1, sticky="w", pady=2, padx=(4, 0))

        btn_row = tk.Frame(card, bg=WHITE)
        btn_row.pack(fill="x", pady=(0, 14))
        RoundedButton(btn_row, "코인 충전", command=lambda: CoinPurchaseDialog(self)
                     ).pack(side="left")

        ttk.Label(card, text="코인 사용 내역", font=("맑은 고딕", 10, "bold"),
                 foreground=PRIMARY).pack(anchor="w", pady=(0, 4))

        tree_wrap = ttk.Frame(card)
        tree_wrap.pack(fill="both", expand=True)
        self._history_tree = ttk.Treeview(
            tree_wrap, columns=("date", "reason", "delta", "balance"),
            show="headings", height=8)
        for col, text, w in (("date", "일시", 130), ("reason", "구분", 90),
                             ("delta", "변동", 60), ("balance", "잔액", 60)):
            self._history_tree.heading(col, text=text)
            anchor = "w" if col == "date" else "center"
            self._history_tree.column(col, width=w, anchor=anchor)
        self._history_tree.pack(fill="both", expand=True)
        self._history_tree.insert("", "end", values=("불러오는 중…", "", "", ""))

        self.update_idletasks()
        _center_over(self, parent, max(440, self.winfo_reqwidth()), self.winfo_reqheight())

        threading.Thread(target=self._load_history, daemon=True).start()

    def _load_history(self) -> None:
        history = None
        try:
            token = self._app._auth.get("token") if self._app._auth else None
            if token:
                history = license_api.fetch_history(token, limit=30)
        except Exception:
            history = None
        self.after(0, lambda: self._render_history(history))

    def _render_history(self, history: list[dict] | None) -> None:
        try:
            self._history_tree.delete(*self._history_tree.get_children())
        except tk.TclError:
            return
        if not history:
            self._history_tree.insert("", "end", values=("내역이 없습니다.", "", "", ""))
            return
        for h in history:
            date = (h.get("created_at") or "")[:16].replace("T", " ")
            reason = _REASON_LABEL.get(h.get("reason"), h.get("reason") or "-")
            delta = h.get("delta", 0)
            delta_txt = f"+{delta}" if delta > 0 else str(delta)
            self._history_tree.insert(
                "", "end", values=(date, reason, delta_txt, h.get("balance_after", "-")))
