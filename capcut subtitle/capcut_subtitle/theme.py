"""로열블루 + 화이트 톤 UI 테마: 색상 팔레트, 둥근 버튼/카드 위젯, ttk 스타일."""

from __future__ import annotations

import tkinter as tk
from tkinter import ttk

# --- 색상 팔레트 -----------------------------------------------------------
PRIMARY = "#3B5BDB"          # 로열블루 (주요 액션 버튼)
PRIMARY_DARK = "#2C46B8"     # 로열블루 hover/강조
PRIMARY_LIGHT = "#EAF0FF"    # 아주 옅은 블루 (텍스트 강조 배경 등)
SKY = "#CFE7FF"              # 연하늘색 (보조 버튼, 카드 배경)
SKY_DARK = "#AAD4FA"         # 연하늘색 hover
SKY_BORDER = "#8FC4F2"       # 카드/입력창 테두리
CARD_FILL = "#EAF4FF"        # 자막 카드 배경 (버튼보다 더 옅게)
WHITE = "#FFFFFF"
TEXT_DARK = "#1B2559"
TEXT_MUTED = "#6B7A99"
DANGER = "#E03131"           # 빨강 (삭제/금지/에러)
DANGER_DARK = "#C21C1C"
DANGER_LIGHT = "#FFE9E9"
DISABLED_FILL = "#C9CFDD"
DISABLED_FG = "#8A93A6"


def round_rect(canvas: tk.Canvas, x1: float, y1: float, x2: float, y2: float,
               r: float, **kwargs):
    """둥근 모서리 사각형을 그린다 (smooth polygon 트릭)."""
    r = max(0, min(r, (x2 - x1) / 2, (y2 - y1) / 2))
    points = [
        x1 + r, y1, x2 - r, y1, x2, y1, x2, y1 + r,
        x2, y2 - r, x2, y2, x2 - r, y2, x1 + r, y2,
        x1, y2, x1, y2 - r, x1, y1 + r, x1, y1,
    ]
    return canvas.create_polygon(points, smooth=True, **kwargs)


class RoundedButton(tk.Canvas):
    """모서리가 둥근 버튼 (ttk.Button 대체용, Canvas 기반)."""

    def __init__(self, parent, text: str, command=None, *, fill=PRIMARY,
                hover=None, fg=WHITE, hover_fg=None, container_bg=WHITE, radius=9,
                font=("맑은 고딕", 10), padx=14, pady=6, min_width=0):
        self._text = text
        self._command = command
        self._fill = fill
        self._hover = hover or PRIMARY_DARK
        self._fg = fg
        self._hover_fg = hover_fg if hover_fg is not None else fg
        self._font = font
        self._state = "normal"
        self._radius = radius

        probe = tk.Label(parent, text=text, font=font)
        probe.update_idletasks()
        tw, th = probe.winfo_reqwidth(), probe.winfo_reqheight()
        probe.destroy()
        # 주의: self._w/self._h는 쓰면 안 됨 - Tkinter가 위젯 경로명 저장에 예약해둔
        # 내부 속성(BaseWidget._w)과 이름이 겹쳐서 super().__init__() 이후 덮어써짐.
        self._bw = max(tw + padx * 2, min_width)
        self._bh = th + pady * 2

        super().__init__(parent, width=self._bw, height=self._bh,
                         highlightthickness=0, bg=container_bg, bd=0, cursor="hand2")
        self._redraw(self._fill, self._fg)
        self.bind("<Enter>", self._on_enter)
        self.bind("<Leave>", self._on_leave)
        self.bind("<Button-1>", self._on_click)

    def _redraw(self, fill, fg) -> None:
        self.delete("all")
        round_rect(self, 1, 1, self._bw - 1, self._bh - 1, self._radius,
                  fill=fill, outline=fill)
        self.create_text(self._bw / 2, self._bh / 2, text=self._text, fill=fg, font=self._font)

    def _on_enter(self, _e=None) -> None:
        if self._state == "normal":
            self._redraw(self._hover, self._hover_fg)

    def _on_leave(self, _e=None) -> None:
        if self._state == "normal":
            self._redraw(self._fill, self._fg)

    def _on_click(self, _e=None) -> None:
        if self._state == "normal" and self._command:
            self._command()

    def configure(self, **kwargs) -> None:
        state = kwargs.pop("state", None)
        text = kwargs.pop("text", None)
        if text is not None:
            self._text = text
        if state is not None:
            self._state = state
        if state == "disabled":
            self.config(cursor="arrow")
            self._redraw(DISABLED_FILL, DISABLED_FG)
        elif state is not None or text is not None:
            self.config(cursor="hand2")
            self._redraw(self._fill, self._fg)
        if kwargs:
            super().configure(**kwargs)

    config = configure

    def cget(self, key):
        if key == "text":
            return self._text
        if key == "state":
            return self._state
        return super().cget(key)


class RoundedFrame(tk.Frame):
    """모서리가 둥근 카드 컨테이너. `.inner`에 실제 위젯들을 배치한다."""

    def __init__(self, parent, *, fill=CARD_FILL, border=SKY_BORDER, container_bg=WHITE,
                radius=12, inset=5, border_width=1.5):
        super().__init__(parent, bg=container_bg)
        self._canvas = tk.Canvas(self, highlightthickness=0, bg=container_bg, bd=0)
        self._canvas.pack(fill="both", expand=True)
        self._fill = fill
        self._border = border
        self._border_width = border_width
        self._radius = radius
        self._inset = inset
        self._last_w = 1

        self.inner = tk.Frame(self._canvas, bg=fill)
        self._win = self._canvas.create_window(inset, inset, window=self.inner, anchor="nw")
        self._canvas.bind("<Configure>", self._on_canvas_configure)
        self.inner.bind("<Configure>", self._on_inner_configure)

    def _on_canvas_configure(self, event) -> None:
        self._last_w = event.width
        self._canvas.itemconfigure(self._win, width=max(1, event.width - self._inset * 2))
        self._redraw(event.width, event.height)

    def _on_inner_configure(self, _event=None) -> None:
        h = self.inner.winfo_reqheight() + self._inset * 2
        if abs(self._canvas.winfo_height() - h) > 1:
            self._canvas.configure(height=h)
        self._redraw(self._last_w, h)

    def _redraw(self, w: int, h: int) -> None:
        if w < 4 or h < 4:
            return
        self._canvas.delete("bg")
        round_rect(self._canvas, 1, 1, w - 1, h - 1, self._radius,
                  fill=self._fill, outline=self._border, width=self._border_width, tags="bg")
        self._canvas.tag_lower("bg")

    def set_colors(self, *, fill=None, border=None, border_width=None) -> None:
        if fill is not None:
            self._fill = fill
            self.inner.configure(bg=fill)
        if border is not None:
            self._border = border
        if border_width is not None:
            self._border_width = border_width
        self._redraw(self._last_w, self._canvas.winfo_height())


def apply_style(root: tk.Tk) -> None:
    """ttk 위젯들을 로열블루/화이트 톤으로 일괄 스타일링."""
    style = ttk.Style(root)
    try:
        style.theme_use("clam")
    except tk.TclError:
        pass

    base_font = ("맑은 고딕", 10)
    style.configure(".", background=WHITE, foreground=TEXT_DARK, font=base_font)
    style.configure("TFrame", background=WHITE)
    style.configure("TLabel", background=WHITE, foreground=TEXT_DARK)
    style.configure("TLabelframe", background=WHITE, bordercolor=SKY_BORDER,
                    relief="solid", borderwidth=1)
    style.configure("TLabelframe.Label", background=WHITE, foreground=PRIMARY,
                    font=("맑은 고딕", 10, "bold"))
    style.configure("TCheckbutton", background=WHITE, foreground=TEXT_DARK)
    style.map("TCheckbutton", background=[("active", WHITE)])

    style.configure("Card.TFrame", background=CARD_FILL)
    style.configure("Card.TLabel", background=CARD_FILL, foreground=TEXT_DARK)

    style.configure("TEntry", fieldbackground=WHITE, foreground=TEXT_DARK,
                    bordercolor=SKY_BORDER, lightcolor=SKY_BORDER, darkcolor=SKY_BORDER,
                    padding=4, borderwidth=1)
    style.map("TEntry", bordercolor=[("focus", PRIMARY)], lightcolor=[("focus", PRIMARY)])

    style.configure("TCombobox", fieldbackground=WHITE, foreground=TEXT_DARK,
                    bordercolor=SKY_BORDER, arrowcolor=PRIMARY, padding=3, borderwidth=1)
    style.map("TCombobox",
             fieldbackground=[("readonly", WHITE), ("disabled", DISABLED_FILL)],
             bordercolor=[("focus", PRIMARY)])

    style.configure("TSpinbox", fieldbackground=WHITE, foreground=TEXT_DARK,
                    arrowcolor=PRIMARY, bordercolor=SKY_BORDER, padding=3, borderwidth=1)
    style.map("TSpinbox", bordercolor=[("focus", PRIMARY)])

    style.configure("Treeview", background=WHITE, fieldbackground=WHITE,
                    foreground=TEXT_DARK, bordercolor=SKY_BORDER, rowheight=24,
                    borderwidth=1)
    style.configure("Treeview.Heading", background=PRIMARY, foreground=WHITE,
                    font=("맑은 고딕", 9, "bold"), relief="flat")
    style.map("Treeview.Heading", background=[("active", PRIMARY_DARK)])
    style.map("Treeview", background=[("selected", SKY_DARK)],
             foreground=[("selected", TEXT_DARK)])

    style.configure("TProgressbar", background=PRIMARY, troughcolor=SKY,
                    bordercolor=SKY, lightcolor=PRIMARY, darkcolor=PRIMARY)

    style.configure("Vertical.TScrollbar", background=SKY, troughcolor=WHITE,
                    bordercolor=WHITE, arrowcolor=PRIMARY)
    style.configure("TSeparator", background=SKY_BORDER)


# --- 팝업(토스트/확인 다이얼로그) -------------------------------------------
# 종류별 강조색과 아이콘
_KIND = {
    "success": (PRIMARY, "✓"),
    "info":    (PRIMARY, "ℹ"),
    "warning": ("#E8A800", "!"),
    "error":   (DANGER, "✕"),
}


def _center_over(win, parent, w: int, h: int) -> None:
    win.update_idletasks()
    px, py = parent.winfo_rootx(), parent.winfo_rooty()
    pw, ph = parent.winfo_width(), parent.winfo_height()
    x = px + (pw - w) // 2
    y = py + max(60, (ph - h) // 3)
    win.geometry(f"{w}x{h}+{max(0, x)}+{max(0, y)}")


class Toast(tk.Toplevel):
    """간결한 안내 토스트: 좌측 강조 바 + 아이콘 + 한 줄 메시지, 자동 닫힘.

    클릭하면 바로 닫히고, 종류(success/info/warning/error)에 따라 색이 바뀐다.
    """

    def __init__(self, parent, message: str, kind: str = "success",
                 duration: int | None = None):
        super().__init__(parent)
        accent, icon = _KIND.get(kind, _KIND["info"])
        self.overrideredirect(True)          # 타이틀바 없는 카드 형태
        self.configure(bg=accent)
        self.attributes("-topmost", True)

        # 바깥 강조색 테두리(2px) 안에 흰 카드
        card = tk.Frame(self, bg=WHITE)
        card.pack(fill="both", expand=True, padx=2, pady=2)

        # 좌측 강조 바
        tk.Frame(card, bg=accent, width=6).pack(side="left", fill="y")

        body = tk.Frame(card, bg=WHITE)
        body.pack(side="left", fill="both", expand=True, padx=(16, 20), pady=16)

        row = tk.Frame(body, bg=WHITE)
        row.pack(anchor="w")
        tk.Label(row, text=icon, font=("맑은 고딕", 15, "bold"),
                 fg=accent, bg=WHITE).pack(side="left", padx=(0, 10))
        tk.Label(row, text=message, font=("맑은 고딕", 11),
                 fg=TEXT_DARK, bg=WHITE, justify="left", wraplength=300).pack(side="left")

        for wdg in (self, card, body, row):
            wdg.bind("<Button-1>", lambda e: self._close())

        self.update_idletasks()
        w = max(240, min(420, self.winfo_reqwidth()))
        h = self.winfo_reqheight()
        _center_over(self, parent, w, h)

        if duration is None:
            duration = 2600 if kind in ("success", "info") else 3400
        self._after_id = self.after(duration, self._close)

    def _close(self) -> None:
        try:
            self.after_cancel(self._after_id)
        except Exception:
            pass
        self.destroy()


class ConfirmDialog(tk.Toplevel):
    """둥근 버튼 확인 다이얼로그. .result 에 True/False."""

    def __init__(self, parent, title: str, message: str,
                 ok_text: str = "확인", cancel_text: str = "취소",
                 kind: str = "info"):
        super().__init__(parent)
        accent, icon = _KIND.get(kind, _KIND["info"])
        self.result = False
        self.title(title)
        self.resizable(False, False)
        self.configure(bg=accent)
        self.transient(parent)
        self.attributes("-topmost", True)

        card = tk.Frame(self, bg=WHITE)
        card.pack(fill="both", expand=True, padx=2, pady=2)

        head = tk.Frame(card, bg=WHITE)
        head.pack(fill="x", padx=24, pady=(22, 8))
        tk.Label(head, text=icon, font=("맑은 고딕", 18, "bold"),
                 fg=accent, bg=WHITE).pack(side="left", padx=(0, 12))
        tk.Label(head, text=title, font=("맑은 고딕", 13, "bold"),
                 fg=TEXT_DARK, bg=WHITE).pack(side="left")

        tk.Label(card, text=message, font=("맑은 고딕", 10),
                 fg=TEXT_MUTED, bg=WHITE, justify="left", wraplength=360
                 ).pack(fill="x", padx=24, pady=(0, 18))

        btns = tk.Frame(card, bg=WHITE)
        btns.pack(fill="x", padx=24, pady=(0, 20))
        RoundedButton(btns, ok_text, command=self._ok,
                      fill=accent, hover=PRIMARY_DARK if accent == PRIMARY else accent,
                      ).pack(side="right")
        RoundedButton(btns, cancel_text, command=self._cancel,
                      fill=SKY, hover=SKY_DARK, fg=TEXT_DARK).pack(side="right", padx=(0, 8))

        self.update_idletasks()
        _center_over(self, parent, max(360, self.winfo_reqwidth()),
                     self.winfo_reqheight())
        self.grab_set()
        self.bind("<Return>", lambda e: self._ok())
        self.bind("<Escape>", lambda e: self._cancel())
        self.wait_window()

    def _ok(self) -> None:
        self.result = True
        self.destroy()

    def _cancel(self) -> None:
        self.result = False
        self.destroy()


def toast(parent, message: str, kind: str = "success", duration: int | None = None):
    """안내 토스트를 띄운다 (비차단)."""
    return Toast(parent, message, kind, duration)


def confirm(parent, title: str, message: str, ok_text: str = "확인",
            cancel_text: str = "취소", kind: str = "info") -> bool:
    """확인/취소 다이얼로그. 확인 시 True."""
    return ConfirmDialog(parent, title, message, ok_text, cancel_text, kind).result
