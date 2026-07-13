"""타닥싱크(TadakSync) GUI (Tkinter) - 브루(Vrew) 스타일 문서 편집."""

from __future__ import annotations

import re
import threading
import time
import traceback
import tkinter as tk
import webbrowser
from tkinter import filedialog, ttk

import numpy as np

from . import __version__, capcut, inject, theme
from . import license as license_api
from . import srt as srt_io
from .account_ui import (CoinPurchaseDialog, LoginDialog, MemberInfoDialog,
                         ReviewGuideDialog)
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
        self.title(f"타닥싱크 TadakSync v{__version__}")
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
        self._authenticated = False
        self._auth_verifying = bool(self._auth and self._auth.get("token"))
        self._session_epoch = 0
        self._last_balance_sync = 0.0
        self._review_bonus_granted: bool | None = None  # None=미확인
        self._has_review: bool | None = None
        self._course_id: str | None = None
        self._coin_courses: list = []
        self._smartstore_review: dict = {}
        self._pending_actions: list[dict] = []
        self._shown_inbox_ids: set[str] = set()
        self._community_links: dict[str, str] = {}

        self._build_ui()
        self._refresh_auth_ui()
        self._apply_auth_lock()
        self.protocol("WM_DELETE_WINDOW", self._on_close)
        # 웹에서 일어난 변화(후기 보너스·코인 충전)를 앱 복귀 시 자동 반영
        self.bind("<FocusIn>", self._on_focus_sync)
        if self._auth and self._auth.get("token"):
            self.set_status("로그인 확인 중…")
            threading.Thread(target=self._startup_verify_worker, daemon=True).start()
        else:
            self.after(300, self._prompt_login_on_start)

    def _on_close(self) -> None:
        self.player.cleanup()
        self.destroy()

    # ------------------------------------------------------------- UI 구성
    def _build_ui(self) -> None:
        self._root_frame = ttk.Frame(self, padding=8)
        self._root_frame.pack(fill="both", expand=True)
        root = self._root_frame

        # 계정 / 코인
        auth_frame = ttk.Frame(root)
        auth_frame.pack(fill="x", pady=(0, 6))
        self.auth_var = tk.StringVar(value="로그인이 필요해요")
        ttk.Label(auth_frame, textvariable=self.auth_var,
                 foreground=theme.TEXT_MUTED).pack(side="left")
        self.login_btn = theme.RoundedButton(
            auth_frame, "구글 로그인", command=self.on_login,
            fill=theme.SKY, hover=theme.SKY_DARK, fg=theme.TEXT_DARK, min_width=110)
        self.login_btn.pack(side="right")
        self.logout_btn = theme.RoundedButton(
            auth_frame, "로그아웃", command=self.on_logout,
            fill=theme.SKY, hover=theme.SKY_DARK, fg=theme.TEXT_DARK, min_width=90)
        self.coin_btn = theme.RoundedButton(
            auth_frame, "코인 충전", command=self.on_open_coin_purchase,
            fill=theme.SKY, hover=theme.SKY_DARK, fg=theme.TEXT_DARK, min_width=90)
        self.myinfo_btn = theme.RoundedButton(
            auth_frame, "내 정보", command=self.on_open_member_info,
            fill=theme.SKY, hover=theme.SKY_DARK, fg=theme.TEXT_DARK, min_width=90)
        self.review_guide_btn = theme.RoundedButton(
            auth_frame, "후기 안내", command=self.on_open_review_guide,
            fill=theme.SKY, hover=theme.SKY_DARK, fg=theme.TEXT_DARK, min_width=90)

        # 미로그인 게이트
        self.gate_frame = ttk.Frame(root, padding=24)
        gate_inner = ttk.Frame(self.gate_frame)
        gate_inner.pack(expand=True)
        ttk.Label(
            gate_inner,
            text="타닥싱크 TadakSync",
            font=("맑은 고딕", 18, "bold"),
        ).pack(pady=(40, 8))
        ttk.Label(
            gate_inner,
            text="캡컷 초신속 스탠다드 수강생 전용입니다.\n"
                 "구글 로그인 후 기기 연동이 완료되어야 사용할 수 있습니다.\n"
                 "계정당 1대 PC만 연동되며, 다른 기기에서 연동하면 기존 기기는 해제됩니다.",
            foreground=theme.TEXT_MUTED,
            justify="center",
        ).pack(pady=(0, 20))
        gate_btns = ttk.Frame(gate_inner)
        gate_btns.pack()
        theme.RoundedButton(
            gate_btns, "구글 로그인", command=self.on_login,
            min_width=140,
        ).pack(side="left", padx=6)
        theme.RoundedButton(
            gate_btns, "종료", command=self._on_close,
            fill=theme.SKY, hover=theme.SKY_DARK, fg=theme.TEXT_DARK, min_width=90,
        ).pack(side="left", padx=6)

        # 메인 작업 영역 (로그인 후에만 표시)
        self.main_panel = ttk.Frame(root)

        # 프로젝트 선택
        proj_frame = ttk.LabelFrame(self.main_panel, text="1. 캡컷 프로젝트 선택", padding=6)
        proj_frame.pack(fill="x")
        self.proj_tree = ttk.Treeview(
            proj_frame, columns=("name", "dur", "mtime"), show="headings", height=4)
        for col, text, w in (("name", "프로젝트 이름", 380),
                             ("dur", "길이", 90), ("mtime", "마지막 수정", 170)):
            self.proj_tree.heading(col, text=text)
            self.proj_tree.column(col, width=w, anchor="w")
        self.proj_tree.pack(side="left", fill="x", expand=True)
        self.proj_tree.bind("<<TreeviewSelect>>", lambda e: setattr(self, "_audio", None))
        self.refresh_btn = theme.RoundedButton(
            proj_frame, "새로고침", command=self.refresh_projects,
            fill=theme.SKY, hover=theme.SKY_DARK, fg=theme.TEXT_DARK)
        self.refresh_btn.pack(side="left", padx=6, anchor="n")
        # 자동 탐색으로 못 찾는 설치(초안 위치 변경 등)를 위한 수동 지정
        self.pick_folder_btn = theme.RoundedButton(
            proj_frame, "폴더 지정", command=self.on_pick_draft_folder,
            fill=theme.SKY, hover=theme.SKY_DARK, fg=theme.TEXT_DARK)
        self.pick_folder_btn.pack(side="left", padx=(0, 6), anchor="n")

        # 옵션
        opt = ttk.LabelFrame(self.main_panel, text="2. 인식 옵션", padding=6)
        opt.pack(fill="x", pady=(8, 0))
        self.lang_var = tk.StringVar(value="자동 감지")
        self.max_words_var = tk.IntVar(value=5)
        self.size_var = tk.DoubleVar(value=7.0)
        self.posy_var = tk.DoubleVar(value=-0.8)
        self.border_var = tk.BooleanVar(value=True)
        self.bold_var = tk.BooleanVar(value=False)
        self.caption_var = tk.BooleanVar(value=True)  # 자동 캡션 방식 삽입

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
        ttk.Checkbutton(opt, text="자동 캡션 방식", variable=self.caption_var).pack(side="left", padx=(6, 0))

        # 실행 버튼
        btns = ttk.Frame(self.main_panel)
        btns.pack(fill="x", pady=8)
        self.gen_btn = theme.RoundedButton(btns, "① 자막 생성 (음성 인식)",
                                          command=self.on_generate)
        self.gen_btn.pack(side="left")
        self.insert_btn = theme.RoundedButton(btns, "② 캡컷 프로젝트에 삽입",
                                             command=self.on_insert)
        self.insert_btn.pack(side="left", padx=6)
        self.export_btn = theme.RoundedButton(
            btns, "SRT 내보내기", command=self.on_export_srt,
            fill=theme.SKY, hover=theme.SKY_DARK, fg=theme.TEXT_DARK)
        self.export_btn.pack(side="left", padx=(18, 0))
        self.import_btn = theme.RoundedButton(
            btns, "SRT 불러오기", command=self.on_import_srt,
            fill=theme.SKY, hover=theme.SKY_DARK, fg=theme.TEXT_DARK)
        self.import_btn.pack(side="left", padx=6)

        # 자막 편집 (브루 스타일 문서)
        doc_frame = ttk.LabelFrame(self.main_panel, text="3. 자막 편집", padding=6)
        doc_frame.pack(fill="both", expand=True)

        doc_toolbar = ttk.Frame(doc_frame)
        doc_toolbar.pack(fill="x", pady=(0, 4))
        self.play_btn = theme.RoundedButton(doc_toolbar, "▶ 전체 재생",
                                           command=self.on_toggle_play_all, min_width=110)
        self.play_btn.pack(side="left")
        self.add_row_btn = theme.RoundedButton(
            doc_toolbar, "+ 새 자막", command=self.on_add_row,
            fill=theme.SKY, hover=theme.SKY_DARK, fg=theme.TEXT_DARK)
        self.add_row_btn.pack(side="left", padx=6)
        ttk.Label(doc_toolbar, foreground=theme.TEXT_MUTED,
                 text="Enter 분할 · 맨 앞에서 Backspace 합치기 · 시간 클릭 재생"
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

        # 로그인 후 커뮤니티 바로가기
        self.community_frame = ttk.Frame(root)
        self.community_label = ttk.Label(
            self.community_frame,
            text="도각쌤 커뮤니티",
            foreground=theme.TEXT_MUTED,
        )
        self.community_label.pack(side="left", padx=(0, 8))
        self.instagram_btn = theme.RoundedButton(
            self.community_frame, "인스타그램", command=lambda: self._open_community_link("instagram"),
            fill=theme.SKY, hover=theme.SKY_DARK, fg=theme.TEXT_DARK, min_width=96)
        self.chat_btn = theme.RoundedButton(
            self.community_frame, "단톡방 입장", command=lambda: self._open_community_link("chat"),
            fill=theme.SKY, hover=theme.SKY_DARK, fg=theme.TEXT_DARK, min_width=96)
        self.website_btn = theme.RoundedButton(
            self.community_frame, "웹사이트", command=lambda: self._open_community_link("website"),
            fill=theme.SKY, hover=theme.SKY_DARK, fg=theme.TEXT_DARK, min_width=84)

        # 상태 표시
        self._status_frame = ttk.Frame(root)
        self._status_frame.pack(fill="x", pady=(8, 0), side="bottom")
        self.progress = ttk.Progressbar(self._status_frame, mode="determinate", maximum=1.0)
        self.progress.pack(side="left", fill="x", expand=True)
        self.status_var = tk.StringVar(value="구글 로그인 후 이용할 수 있어요.")
        ttk.Label(self._status_frame, textvariable=self.status_var).pack(side="left", padx=8)

    # ------------------------------------------------------------ 프로젝트
    def refresh_projects(self) -> None:
        if not self._require_auth("프로젝트 목록"):
            return
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
            self.set_status(
                "캡컷 프로젝트를 찾지 못했어요. 캡컷에서 프로젝트를 한 번 열어보시고, "
                "그래도 안 보이면 [폴더 지정]으로 초안 폴더를 선택해 주세요.")

    def on_pick_draft_folder(self) -> None:
        """자동 탐색으로 못 찾는 초안 폴더를 직접 지정 (초안 위치 변경 등)."""
        if not self._require_auth("폴더 지정"):
            return
        path = filedialog.askdirectory(title="캡컷 초안(프로젝트) 폴더 선택")
        if not path:
            return
        root = capcut.add_manual_draft_root(path)
        self.refresh_projects()
        if self.projects:
            toast(self, f"프로젝트 {len(self.projects)}개를 찾았습니다.", "success")
        else:
            toast(self,
                  "선택한 폴더에서 캡컷 프로젝트를 찾지 못했습니다.\n"
                  "draft_content.json이 들어있는 프로젝트 폴더나 그 상위 폴더를 선택해 주세요.",
                  "warning")
            self.set_status(f"등록된 폴더: {root}")

    def selected_project(self) -> capcut.Project | None:
        sel = self.proj_tree.selection()
        if not sel:
            toast(self, "프로젝트를 먼저 선택해 주세요.", "warning")
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
        for b in (self.gen_btn, self.insert_btn, self.login_btn,
                  self.export_btn, self.import_btn, self.play_btn,
                  self.add_row_btn, self.refresh_btn, self.pick_folder_btn,
                  self.logout_btn, self.myinfo_btn, self.coin_btn,
                  self.review_guide_btn, self.instagram_btn, self.chat_btn,
                  self.website_btn):
            try:
                b.configure(state=state)
            except tk.TclError:
                pass

    def _is_logged_in(self) -> bool:
        return bool(
            self._authenticated and self._auth and self._auth.get("token")
        )

    def _bump_session_epoch(self) -> int:
        self._session_epoch += 1
        return self._session_epoch

    def _start_model_prewarm(self) -> None:
        """로그인 직후 백그라운드에서 Whisper 모델을 미리 적재.

        모델 다운로드는 최초 1회지만 RAM 적재는 매 실행마다 30초~1분 걸리므로,
        사용자가 프로젝트를 고르는 동안 미리 준비해 생성 버튼의 대기를 없앤다.
        (Transcriber.load는 내부 잠금으로 중복 적재를 막는다)
        """
        if getattr(self, "_prewarm_started", False):
            return
        self._prewarm_started = True

        def worker() -> None:
            try:
                self.transcriber.load(MODEL, progress=self.set_status)
            except Exception:
                pass  # 실패해도 조용히 — 자막 생성 시 다시 시도하며 그때 안내

        threading.Thread(target=worker, daemon=True).start()

    def _require_auth(self, action: str = "이 기능") -> bool:
        if self._is_logged_in():
            return True
        toast(self, "로그인이 필요해요. 구글 계정으로 로그인해 주세요.", "warning")
        self._apply_auth_lock()
        self.after(200, self._prompt_login_on_start)
        return False

    def _apply_auth_lock(self) -> None:
        """로그인 여부에 따라 메인 UI / 게이트 전환."""
        if self._is_logged_in():
            self.gate_frame.pack_forget()
            self.main_panel.pack(fill="both", expand=True, before=self._status_frame)
        else:
            self.main_panel.pack_forget()
            self.community_frame.pack_forget()
            self.gate_frame.pack(fill="both", expand=True, before=self._status_frame)
            self.projects = []
            try:
                self.proj_tree.delete(*self.proj_tree.get_children())
            except tk.TclError:
                pass
            self.lines = []
            self._audio = None
            try:
                self._render_document()
            except Exception:
                pass

    def _set_authenticated(self, ok: bool, auth: dict | None = None, balance: int | None = None) -> None:
        if ok and not (auth and auth.get("token")):
            ok = False
        self._authenticated = ok
        if ok and auth:
            self._auth = auth
            self._auth_verifying = False
            if balance is not None:
                self._balance = balance
            elif auth.get("balance") is not None:
                self._balance = auth.get("balance")
        elif not ok:
            self._auth = None
            self._balance = None
            self._auth_verifying = False
            self._review_bonus_granted = None
            self._has_review = None
            self._course_id = None
            self._coin_courses = []
            self._smartstore_review = {}
            self._pending_actions = []
            self._shown_inbox_ids = set()
            self._community_links = {}
        self._refresh_auth_ui()
        self._refresh_community_ui()
        self._apply_auth_lock()
        if ok:
            self.refresh_projects()
            self.set_status("프로젝트를 선택하고 [① 자막 생성]을 눌러 주세요.")
            self._start_model_prewarm()
        else:
            self.set_status("구글 로그인 후 이용할 수 있어요.")

    def _refresh_auth_ui(self) -> None:
        self.login_btn.pack_forget()
        self.logout_btn.pack_forget()
        self.myinfo_btn.pack_forget()
        self.coin_btn.pack_forget()
        self.review_guide_btn.pack_forget()
        if self._is_logged_in():
            name = self._auth.get("user_name") or "수강생"
            bal = self._balance
            bal_txt = f" · 코인 {bal}" if bal is not None else ""
            self.auth_var.set(f"{name} 로그인됨{bal_txt}")
            self.logout_btn.pack(side="right")
            self.myinfo_btn.pack(side="right", padx=(0, 6))
            self.coin_btn.pack(side="right", padx=(0, 6))
            if self._review_guide_available():
                self.review_guide_btn.pack(side="right", padx=(0, 6))
        elif self._auth_verifying:
            self.auth_var.set("로그인 확인 중…")
            self.login_btn.pack(side="right")
        else:
            self.auth_var.set("로그인이 필요해요 — 캡컷 초신속 스탠다드 수강생만 이용할 수 있어요")
            self.login_btn.pack(side="right")

    def apply_me_snapshot(self, me: dict) -> None:
        """서버 /me 응답을 앱 전역 상태(잔액·이름·이메일·후기 상태)에 반영하고 저장."""
        if not self._is_logged_in():
            return
        if me.get("balance") is not None:
            self._balance = me.get("balance")
        if me.get("review_bonus_granted") is not None:
            self._review_bonus_granted = bool(me.get("review_bonus_granted"))
        if me.get("has_review") is not None:
            self._has_review = bool(me.get("has_review"))
        if me.get("course_id"):
            self._course_id = me.get("course_id")
        self._coin_courses = me.get("coin_courses") or []
        self._smartstore_review = me.get("smartstore_review") or {}
        self._pending_actions = me.get("pending_actions") or []
        self._community_links = {
            "instagram": me.get("community_instagram_url") or "",
            "chat": me.get("community_chat_url") or "",
            "website": me.get("community_website_url") or "",
        }
        self._auth = license_api.save_auth(
            self._auth["token"],
            me.get("name") or self._auth.get("user_name"),
            self._balance,
            me.get("email"),
        )
        self._refresh_auth_ui()
        self._refresh_community_ui()
        self._handle_pending_actions()

    def _refresh_community_ui(self) -> None:
        for btn in (self.instagram_btn, self.chat_btn, self.website_btn):
            btn.pack_forget()
        if not self._is_logged_in():
            self.community_frame.pack_forget()
            return

        # 후기 작성 여부와 무관하게 로그인된 수강생에게는 항상 노출한다.
        self.website_btn.pack(side="left", padx=(0, 6))
        self.instagram_btn.pack(side="left", padx=(0, 6))
        self.chat_btn.pack(side="left", padx=(0, 6))
        self.community_frame.pack(fill="x", pady=(6, 0), side="bottom")

    def _open_community_link(self, key: str) -> None:
        url = (self._community_links.get(key) or "").strip()
        if key == "website" and not url:
            url = "https://vcml.kr"
        if not url:
            toast(self, "아직 연결된 링크가 없어요.", "warning")
            return
        webbrowser.open(url)

    def _pending_review_courses(self) -> list:
        return [c for c in (self._coin_courses or []) if not c.get("review_bonus_granted")]

    def _review_guide_available(self) -> bool:
        smart_status = (self._smartstore_review or {}).get("status")
        smart_available = smart_status in ("none", "pending", "rejected")
        return bool(self._pending_review_courses()) or smart_available

    def _handle_pending_actions(self) -> None:
        if not self._is_logged_in():
            return
        for action in self._pending_actions:
            msg_id = str(action.get("id") or "")
            if not msg_id or msg_id in self._shown_inbox_ids:
                continue
            self._shown_inbox_ids.add(msg_id)
            typ = action.get("type")
            title = action.get("title") or "알림"
            body = action.get("body") or ""
            if typ == "smartstore_rewrite":
                confirm(
                    self,
                    title,
                    body or "스마트스토어에서 작성하신 후기를 아직 확인하지 못했어요. "
                    "후기를 작성해 주신 후 다시 「작성 완료」를 눌러 주세요.",
                    ok_text="확인",
                    cancel_text="닫기",
                    kind="warning",
                )
                self._ack_inbox_async([msg_id])
            elif typ == "smartstore_granted":
                toast(self, body or "정성스러운 후기 감사합니다! 스마트스토어 보너스 코인이 지급됐어요.",
                      "success", duration=3600)
                self._ack_inbox_async([msg_id])

    def _ack_inbox_async(self, message_ids: list[str]) -> None:
        token = self._auth.get("token") if self._auth else None
        if not token or not message_ids:
            return
        threading.Thread(
            target=lambda: license_api.ack_inbox(token, message_ids),
            daemon=True,
        ).start()

    @staticmethod
    def _is_auth_denied(e: Exception) -> bool:
        """서버가 명시적으로 권한을 거부(만료·미수강)한 오류인지.

        일시적 네트워크 장애나 서버 5xx로는 로그아웃하지 않기 위한 구분.
        """
        return getattr(e, "status", None) in (401, 403)

    def _startup_verify_worker(self) -> None:
        epoch = self._session_epoch
        token = (self._auth or {}).get("token")
        try:
            if not token:
                raise RuntimeError("no token")
            me = license_api.verify_entitlement(token)
            if epoch != self._session_epoch:
                return
            balance = me.get("balance")
            auth = license_api.save_auth(
                token,
                me.get("name") or (self._auth or {}).get("user_name"),
                balance,
                me.get("email"),
            )
            self.after(0, lambda: self._finish_session_restore(epoch, auth, balance, me))
        except Exception as e:
            if epoch != self._session_epoch:
                return
            self.after(0, lambda err=e, tok=token: self._handle_verify_failure(epoch, tok, err))

    def _finish_session_restore(self, epoch: int, auth: dict, balance: int | None,
                                me: dict | None = None) -> None:
        """저장된 세션 자동 복구 — 서버 확인 후에만 로그인 처리(토스트 없음)."""
        if epoch != self._session_epoch:
            return
        self._set_authenticated(True, auth, balance)
        self._last_balance_sync = time.monotonic()
        if me:
            self.apply_me_snapshot(me)

    def _handle_verify_failure(self, epoch: int, token: str | None, err: Exception) -> None:
        if epoch != self._session_epoch:
            return
        no_token = str(err) == "no token"
        if no_token or self._is_auth_denied(err):
            stored = license_api.load_auth()
            if stored and stored.get("token") == token:
                license_api.clear_auth()
            msg = str(err) if str(err) and not no_token else "세션이 만료됐어요. 다시 로그인해 주세요."
        else:
            msg = "서버에 연결하지 못했어요. 인터넷 연결을 확인한 뒤 다시 로그인해 주세요."
        self._set_authenticated(False)
        toast(self, msg, "warning")
        self.after(400, self._prompt_login_on_start)

    def _refresh_balance_worker(self) -> None:
        epoch = self._session_epoch
        try:
            if not self._is_logged_in():
                return
            token = self._auth["token"]
            me = license_api.verify_entitlement(token)
            if epoch != self._session_epoch:
                return
            self._last_balance_sync = time.monotonic()
            self.after(0, lambda m=me: self.apply_me_snapshot(m))
        except Exception as e:
            if epoch != self._session_epoch:
                return
            if self._is_auth_denied(e):
                token = (self._auth or {}).get("token")
                stored = license_api.load_auth()
                if stored and stored.get("token") == token:
                    license_api.clear_auth()
                msg = str(e) if str(e) else "세션이 만료됐어요. 다시 로그인해 주세요."
                self.after(0, lambda: self._set_authenticated(False))
                self.after(0, lambda m=msg: toast(self, m, "warning"))
                self.after(400, self._prompt_login_on_start)
            # 일시적 오류는 무시 — 다음 동기화 때 다시 시도

    def _on_focus_sync(self, event) -> None:
        """앱 창이 다시 포커스를 얻으면 잔액을 재동기화 (최소 30초 간격)."""
        if event.widget is not self:
            return
        if not self._is_logged_in():
            return
        if self._busy or time.monotonic() - self._last_balance_sync < 30:
            return
        self._last_balance_sync = time.monotonic()
        threading.Thread(target=self._refresh_balance_worker, daemon=True).start()

    def on_login(self) -> None:
        if self._busy:
            return
        self._bump_session_epoch()
        self._auth_verifying = False
        LoginDialog(self, exit_on_cancel=not self._is_logged_in(),
                   on_done=self._on_login_dialog_done)

    def _on_login_dialog_done(self, auth: dict | None) -> None:
        if auth is None:
            if not self._is_logged_in():
                self._on_close()
            return
        self._bump_session_epoch()
        self._set_authenticated(True, auth, auth.get("balance"))
        self._last_balance_sync = time.monotonic()
        toast(self, "로그인됐어요!", "success")
        # 후기 보너스 상태 등 계정 정보를 백그라운드로 동기화
        threading.Thread(target=self._refresh_balance_worker, daemon=True).start()

    def on_logout(self) -> None:
        self._bump_session_epoch()
        license_api.clear_auth()
        self._set_authenticated(False)
        toast(self, "로그아웃됐어요.", "info")
        self.after(200, self._prompt_login_on_start)

    def _prompt_login_on_start(self) -> None:
        if self._is_logged_in():
            return
        LoginDialog(self, exit_on_cancel=True, on_done=self._on_login_dialog_done)

    def on_open_member_info(self) -> None:
        if not self._require_auth("내 정보"):
            return
        MemberInfoDialog(self, self)

    def on_open_coin_purchase(self) -> None:
        if not self._require_auth("코인 충전"):
            return
        CoinPurchaseDialog(self, self)

    def on_open_review_guide(self) -> None:
        if not self._require_auth("후기 안내"):
            return
        ReviewGuideDialog(self, self)

    # ------------------------------------------------------------- 생성
    def on_generate(self) -> None:
        if self._busy:
            return
        if not self._require_auth("자막 생성"):
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
            self.set_status(f"[{project.name}] 타임라인 오디오를 분석하고 있어요...")
            res = capcut.build_timeline_audio(project)
            if res.missing_files:
                n = len(res.missing_files)
                self.after(0, lambda n=n: toast(
                    self, f"원본 파일 {n}개를 찾지 못해 해당 구간은 제외했어요.", "warning"))
            if not res.used_files:
                self.set_status("인식할 오디오를 찾지 못했어요. 프로젝트의 음성 파일을 확인해 주세요.")
                return
            minutes = license_api.minutes_from_audio(len(res.audio), SR)
            job_id = license_api.new_job_id()
            self.set_status(f"코인 {minutes}개를 차감하고 있어요… (약 {minutes}분)")
            try:
                consumed_res = license_api.consume(token, minutes, job_id)
            except Exception as e:
                payload = getattr(e, "payload", {}) or {}
                if payload.get("code") == "insufficient":
                    bal = payload.get("balance", 0)
                    need = payload.get("needed", minutes)
                    self.after(0, lambda: toast(
                        self, f"코인이 조금 부족해요. (보유 {bal}개 / 필요 {need}개) 충전 후 다시 시도해 주세요.", "error"))
                    # 충전·후기 안내 화면으로 바로 연결
                    self.after(600, self.on_open_coin_purchase)
                    self.set_status("코인이 부족해요")
                    return
                if self._is_auth_denied(e):
                    license_api.clear_auth()
                    self.after(0, lambda: self._set_authenticated(False))
                    self.after(0, lambda m=str(e): toast(self, m, "warning"))
                    self.after(400, self._prompt_login_on_start)
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
            bal_txt = f" · 잔액 {self._balance}" if self._balance is not None else ""
            self.set_status(
                f"자막 {len(lines)}개를 생성했어요! (코인 {minutes}개 사용{bal_txt}) — "
                f"확인 후 [② 캡컷 프로젝트에 삽입]을 눌러 주세요"
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
            if self._is_auth_denied(e):
                license_api.clear_auth()
                self.after(0, lambda: self._set_authenticated(False))
                msg = str(e) if str(e) else "기기 연동이 만료됐어요. 다시 로그인해 주세요."
                self.after(0, lambda m=msg: toast(self, m, "warning"))
                self.after(400, self._prompt_login_on_start)
                self.set_status("로그인이 필요해요")
                return
            msg = str(e) if isinstance(e, RuntimeError) and str(e) else "자막 생성에 실패했어요. 잠시 후 다시 시도해 주세요."
            self.after(0, lambda m=msg: toast(self, m, "error"))
            self.set_status("자막 생성에 실패했어요")
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
                toast(self, "시간 형식이 올바르지 않아요. 예: 1:23.45", "warning")

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
        if not self._require_auth("자막 편집"):
            return "break"
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
        if not self._require_auth("자막 편집"):
            return
        if not (0 < idx < len(self.lines)):
            return
        self._sync_all_text()
        join_at = len(self.lines[idx - 1].text)
        merged = merge_lines([self.lines[idx - 1], self.lines[idx]])
        self.lines[idx - 1:idx + 1] = [merged]
        self._render_document()
        self._focus_block(idx - 1, char_offset=join_at)

    def _delete_block(self, idx: int) -> None:
        if not self._require_auth("자막 편집"):
            return
        if not (0 <= idx < len(self.lines)):
            return
        self._sync_all_text()
        del self.lines[idx]
        self._render_document()

    def on_add_row(self) -> None:
        if not self._require_auth("자막 편집"):
            return
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
        if not self._require_auth("미리듣기"):
            return
        if self._audio is None:
            toast(self, "먼저 [① 자막 생성]을 실행해 주세요.", "info")
            return
        self._stop_playback()
        line = self.lines[idx]
        a = int(line.start_us * SR / US)
        b = int(line.end_us * SR / US)
        self.player.play(self._audio[a:b])

    def _play_from(self, idx: int) -> None:
        if not self._require_auth("재생"):
            return
        if self._audio is None:
            toast(self, "먼저 [① 자막 생성]을 실행해 주세요.", "info")
            return
        self._start_playback(self.lines[idx].start_us)

    def on_toggle_play_all(self) -> None:
        if not self._require_auth("전체 재생"):
            return
        if self._playing:
            self._stop_playback()
            return
        if self._audio is None:
            toast(self, "먼저 [① 자막 생성]을 실행해 주세요.", "info")
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
        if not self._require_auth("자막 삽입"):
            return
        project = self.selected_project()
        if project is None:
            return
        self._sync_all_text()
        if not self.lines:
            toast(self, "삽입할 자막이 아직 없어요. 자막을 생성하거나 SRT 파일을 불러와 주세요.", "warning")
            return
        # 캡컷이 닫혀 있으면 확인 없이 바로 삽입, 열려 있을 때만 경고
        if capcut.is_capcut_running():
            msg = ("캡컷에서 이 프로젝트가 열려 있다면 먼저 닫아주세요.\n"
                   "열린 상태로 삽입하면 자막이 사라질 수 있어요.\n\n"
                   "그래도 계속 삽입할까요?")
            if not confirm(self, "자막 삽입", msg, ok_text="삽입", kind="warning"):
                return
        try:
            style = inject.SubtitleStyle(
                size=float(self.size_var.get()),
                border=self.border_var.get(),
                bold=self.bold_var.get(),
                transform_y=float(self.posy_var.get()),
                as_caption=self.caption_var.get(),
            )
            backup = inject.inject_subtitles(project.dir, self.lines, style)
            toast(self, f"자막 {len(self.lines)}개를 삽입했어요!\n캡컷에서 프로젝트를 열어 확인해 주세요.", "success")
            self.set_status("삽입 완료! 캡컷에서 프로젝트를 열어 확인해 주세요.")
        except Exception as e:
            traceback.print_exc()
            self.after(0, lambda: toast(self, "삽입 중 문제가 발생했어요. 걱정 마세요, 원본은 안전하게 복구됐어요.", "error"))

    # ------------------------------------------------------------- SRT
    def on_export_srt(self) -> None:
        if not self._require_auth("SRT 내보내기"):
            return
        self._sync_all_text()
        if not self.lines:
            toast(self, "내보낼 자막이 아직 없어요.", "warning")
            return
        sel = self.proj_tree.selection()
        default_name = self.projects[int(sel[0])].name if sel else "자막"
        path = filedialog.asksaveasfilename(
            defaultextension=".srt", filetypes=[("SRT 자막", "*.srt")],
            initialfile=f"{default_name}.srt")
        if path:
            srt_io.dump(self.lines, path)
            self.set_status(f"SRT 파일을 저장했어요: {path}")

    def on_import_srt(self) -> None:
        if not self._require_auth("SRT 불러오기"):
            return
        path = filedialog.askopenfilename(filetypes=[("SRT 자막", "*.srt")])
        if path:
            try:
                self.lines = srt_io.load(path)
                self._render_document()
                self.set_status(f"SRT 파일에서 자막 {len(self.lines)}개를 불러왔어요")
            except Exception:
                toast(self, "SRT 파일을 읽지 못했어요. 파일 형식을 확인해 주세요.", "error")


def main() -> None:
    app = App()
    app.mainloop()


if __name__ == "__main__":
    main()
