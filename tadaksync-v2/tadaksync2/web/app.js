/* 타닥싱크 2 — 프런트엔드 상태 머신.
 *
 * Python 브리지: window.pywebview.api.<메서드>() → Promise
 * Python 이벤트: window.__pyEvent({event, data})
 * 브라우저 단독(개발)에서는 pywebview가 없으므로 Mock API로 동작한다.
 */

"use strict";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  api: null,
  step: 1,
  auth: { logged_in: false },
  languages: [],
  styles: [],
  projects: [],
  selectedProject: null,   // {index, name, ...}
  blocks: [],              // [{start_us, end_us, text}]
  fromSrt: false,
  styleKey: "classic",
  size: "medium",
  position: "bottom",
  playingIdx: null,
  busy: false,
};

/* ───────────────────────── 유틸 ───────────────────────── */

function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.textContent = msg;
  $("#toast-root").appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; }, 2600);
  setTimeout(() => el.remove(), 3000);
}

function fmtTime(us) {
  const totalMs = Math.max(0, Math.round(us / 1000));
  const m = Math.floor(totalMs / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const d = Math.floor((totalMs % 1000) / 100);
  return `${m}:${String(s).padStart(2, "0")}.${d}`;
}

function parseTime(str) {
  const m = String(str).trim().match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const min = parseInt(m[1] || "0", 10);
  const sec = parseFloat(m[2]);
  if (!isFinite(sec)) return null;
  return Math.round((min * 60 + sec) * 1_000_000);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/* ───────────────────────── 스텝 전환 ───────────────────────── */

function gotoStep(n) {
  state.step = n;
  $$(".view").forEach((v) => v.classList.add("hidden"));
  $(`#view-${n}`).classList.remove("hidden");
  $$("#step-nav .step").forEach((el) => {
    const s = parseInt(el.dataset.step, 10);
    el.classList.toggle("active", s === n);
    el.classList.toggle("done", s < n);
  });
  if (n === 3) updateLineCount();
  if (n === 4) renderBlocks();
  if (n === 5) renderInjectSummary();
}

/* ───────────────────────── 인증 ───────────────────────── */

function renderAuth() {
  const a = state.auth;
  if (!a.logged_in) {
    $("#login-gate").classList.remove("hidden");
    $("#shell").classList.add("hidden");
    $("#login-idle").classList.remove("hidden");
    $("#login-pending").classList.add("hidden");
    return;
  }
  $("#login-gate").classList.add("hidden");
  $("#shell").classList.remove("hidden");
  $("#acc-name").textContent = a.user_name || a.email || "수강생";
  $("#acc-balance").textContent = (a.balance ?? "—");
}

async function startLogin() {
  $("#login-error").classList.add("hidden");
  $("#login-idle").classList.add("hidden");
  $("#login-pending").classList.remove("hidden");
  $("#login-code").textContent = "·····";
  $("#login-status").textContent = "연동 코드를 발급받고 있어요…";
  await state.api.start_login();
}

/* ───────────────────────── 프로젝트 ───────────────────────── */

async function loadProjects() {
  const res = await state.api.list_projects();
  if (!res.ok) { toast(res.error, "error"); return; }
  state.projects = res.projects;
  $("#capcut-warn").classList.toggle("hidden", !res.capcut_running);
  renderProjects();
}

function renderProjects() {
  const grid = $("#project-grid");
  grid.innerHTML = "";
  $("#project-empty").classList.toggle("hidden", state.projects.length > 0);
  for (const p of state.projects) {
    const card = document.createElement("div");
    card.className = "project-card" +
      (state.selectedProject?.index === p.index ? " selected" : "");
    card.innerHTML = `
      <div class="p-name" title="${esc(p.name)}">${esc(p.name)}</div>
      <div class="p-meta"><span class="p-dur">${esc(p.duration)}</span><span>${esc(p.mtime)}</span></div>`;
    card.addEventListener("click", () => {
      state.selectedProject = p;
      renderProjects();
      $("#start-bar").classList.remove("hidden");
      $("#sel-project-name").textContent = p.name;
    });
    grid.appendChild(card);
  }
}

/* ───────────────────────── 전문 인식 ───────────────────────── */

async function startTranscribe() {
  if (!state.selectedProject) { toast("프로젝트를 먼저 선택해 주세요.", "warn"); return; }
  const lang = $("#sel-language").value;
  gotoStep(2);
  $("#progress-fill").style.width = "0%";
  $("#progress-msg").textContent = "준비 중…";
  const res = await state.api.start_transcribe(state.selectedProject.index, lang);
  if (!res.ok) {
    toast(res.error, "error");
    gotoStep(1);
  }
}

function onScriptReady(data) {
  $("#script-editor").value = data.text;
  state.fromSrt = false;
  if (data.missing_files && data.missing_files.length) {
    toast(`원본 파일 ${data.missing_files.length}개를 찾지 못해 일부 구간이 빠졌을 수 있어요.`, "warn");
  }
  gotoStep(3);
  toast("전문 인식 완료! 엔터로 자막을 나눠보세요.", "success");
}

function updateLineCount() {
  const lines = $("#script-editor").value.split("\n").filter((l) => l.trim());
  $("#line-count").textContent = lines.length;
}

/* ───────────────────────── 자막 블록 ───────────────────────── */

async function buildBlocks() {
  const text = $("#script-editor").value;
  if (!text.trim()) { toast("전문이 비어 있어요.", "warn"); return; }
  const res = await state.api.build_blocks(text);
  if (!res.ok) { toast(res.error, "error"); return; }
  state.blocks = res.blocks;
  gotoStep(4);
}

function renderBlocks() {
  const list = $("#block-list");
  list.innerHTML = "";
  state.blocks.forEach((b, i) => {
    const row = document.createElement("div");
    row.className = "block-row" + (state.playingIdx === i ? " playing" : "");
    row.innerHTML = `
      <span class="block-idx">${i + 1}</span>
      <span class="block-time">
        <input class="t-start" value="${fmtTime(b.start_us)}">
        <span class="tilde">–</span>
        <input class="t-end" value="${fmtTime(b.end_us)}">
      </span>
      <input class="block-text" value="${esc(b.text)}">
      <span class="block-btns">
        <button class="icon-btn play" title="이 구간 미리듣기">${state.playingIdx === i ? "⏸" : "▶"}</button>
        <button class="icon-btn del" title="삭제">✕</button>
      </span>`;

    row.querySelector(".t-start").addEventListener("change", (e) => {
      const us = parseTime(e.target.value);
      if (us === null) { e.target.value = fmtTime(b.start_us); return; }
      b.start_us = us; e.target.value = fmtTime(us);
    });
    row.querySelector(".t-end").addEventListener("change", (e) => {
      const us = parseTime(e.target.value);
      if (us === null || us <= b.start_us) { e.target.value = fmtTime(b.end_us); return; }
      b.end_us = us; e.target.value = fmtTime(us);
    });
    row.querySelector(".block-text").addEventListener("input", (e) => {
      b.text = e.target.value;
    });
    row.querySelector(".play").addEventListener("click", async () => {
      if (state.playingIdx === i) {
        await state.api.preview_stop();
        state.playingIdx = null;
        renderBlocks();
        return;
      }
      const res = await state.api.preview_play(b.start_us, b.end_us);
      if (!res.ok) { toast(res.error, "warn"); return; }
      state.playingIdx = i;
      renderBlocks();
      const durMs = Math.max(200, (b.end_us - b.start_us) / 1000);
      setTimeout(() => {
        if (state.playingIdx === i) { state.playingIdx = null; renderBlocks(); }
      }, durMs + 150);
    });
    row.querySelector(".del").addEventListener("click", () => {
      state.blocks.splice(i, 1);
      renderBlocks();
    });
    list.appendChild(row);
  });
}

async function importSrt() {
  const res = await state.api.import_srt();
  if (res.cancelled) return;
  if (!res.ok) { toast(res.error, "error"); return; }
  state.blocks = res.blocks;
  state.fromSrt = true;
  gotoStep(4);
  toast(`SRT에서 자막 ${res.blocks.length}개를 불러왔어요.`, "success");
}

async function exportSrt() {
  const res = await state.api.export_srt(state.blocks);
  if (res.cancelled) return;
  if (!res.ok) { toast(res.error, "error"); return; }
  toast("SRT로 저장했어요: " + res.path, "success");
}

/* ───────────────────────── 스타일 · 삽입 ───────────────────────── */

const SAMPLE_CAP = "자막이 이렇게 보여요";

function renderStyles() {
  const grid = $("#style-grid");
  grid.innerHTML = "";
  for (const s of state.styles) {
    const card = document.createElement("div");
    card.className = "style-card" + (state.styleKey === s.key ? " selected" : "");
    card.innerHTML = `
      <div class="style-preview"><span class="cap cap-${esc(s.key)}">${SAMPLE_CAP}</span></div>
      <div class="style-info">
        <div class="s-name"><span class="s-check">✓</span>${esc(s.name)}</div>
        <div class="s-desc">${esc(s.desc)}</div>
      </div>`;
    card.addEventListener("click", () => {
      state.styleKey = s.key;
      renderStyles();
    });
    grid.appendChild(card);
  }
}

function renderInjectSummary() {
  const name = state.selectedProject?.name || "—";
  $("#inject-summary").textContent =
    `${name} · 자막 ${state.blocks.length}개`;
}

function bindSegmented(rootSel, key) {
  $(rootSel).addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-v]");
    if (!btn) return;
    state[key] = btn.dataset.v;
    $$(rootSel + " button").forEach((b) => b.classList.toggle("on", b === btn));
  });
}

async function requestInject() {
  if (!state.blocks.length) { toast("삽입할 자막이 없어요.", "warn"); return; }
  const chk = await state.api.capcut_running();
  if (chk.ok && chk.running) {
    $("#confirm-overlay").classList.remove("hidden");
    return;
  }
  doInject();
}

async function doInject() {
  $("#confirm-overlay").classList.add("hidden");
  const btn = $("#btn-inject");
  btn.disabled = true;
  btn.textContent = "삽입하고 있어요…";
  try {
    const res = await state.api.inject(
      state.blocks, state.styleKey, state.size, state.position);
    if (!res.ok) { toast(res.error, "error"); return; }
    $("#done-msg").textContent =
      `「${res.project}」에 자막 ${res.count}개를 삽입했어요.`;
    $("#done-overlay").classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "④ 캡컷 프로젝트에 삽입";
  }
}

function resetJob() {
  $("#done-overlay").classList.add("hidden");
  state.blocks = [];
  state.playingIdx = null;
  state.fromSrt = false;
  $("#script-editor").value = "";
  $("#start-bar").classList.add("hidden");
  state.selectedProject = null;
  gotoStep(1);
  loadProjects();
}

/* ───────────────────────── 사용 내역 ───────────────────────── */

async function openHistory() {
  $("#account-menu").classList.add("hidden");
  $("#history-overlay").classList.remove("hidden");
  const list = $("#history-list");
  list.innerHTML = '<p class="sub">불러오는 중…</p>';
  const res = await state.api.fetch_history();
  if (!res.ok) { list.innerHTML = `<p class="sub">${esc(res.error)}</p>`; return; }
  if (!res.history.length) { list.innerHTML = '<p class="sub">아직 내역이 없어요.</p>'; return; }
  list.innerHTML = res.history.map((h) => {
    const delta = h.delta ?? h.amount ?? 0;
    const plus = delta > 0;
    return `<div class="history-row">
      <span class="h-when">${esc(h.created_at || h.when || "")}</span>
      <span class="h-desc">${esc(h.description || h.reason || h.type || "")}</span>
      <span class="h-delta ${plus ? "plus" : "minus"}">${plus ? "+" : ""}${delta}</span>
    </div>`;
  }).join("");
}

/* ───────────────────────── Python 이벤트 ───────────────────────── */

window.__pyEvent = (msg) => {
  const { event, data } = msg;
  switch (event) {
    case "auth":
      state.auth = data;
      renderAuth();
      if (data.logged_in && state.step === 1) loadProjects();
      break;
    case "login_code":
      $("#login-code").textContent = data.code;
      break;
    case "login_status":
      $("#login-status").textContent = data.message;
      break;
    case "login_error":
      $("#login-idle").classList.remove("hidden");
      $("#login-pending").classList.add("hidden");
      $("#login-error").textContent = data.message;
      $("#login-error").classList.remove("hidden");
      break;
    case "progress":
      if (state.step === 2) $("#progress-msg").textContent = data.message;
      break;
    case "progress_ratio":
      if (state.step === 2)
        $("#progress-fill").style.width = Math.round(data.ratio * 100) + "%";
      break;
    case "script_ready":
      $("#progress-fill").style.width = "100%";
      onScriptReady(data);
      break;
    case "transcribe_error":
      toast(data.message, "error");
      gotoStep(1);
      break;
  }
};

/* ───────────────────────── Mock API (브라우저 개발용) ───────────────────────── */

function makeMockApi() {
  const emit = (event, data, delay) =>
    setTimeout(() => window.__pyEvent({ event, data }), delay);
  const WORDS = [];
  const SENT = ["안녕하세요 여러분", "오늘은 캡컷에서 자막을 자동으로 넣는 방법을 알아볼게요",
    "먼저 프로그램을 열고 프로젝트를 선택합니다", "전문 인식을 누르면 이렇게 전체 대본이 나와요",
    "이제 엔터만 눌러서 자막을 나누면 끝입니다", "스타일까지 고르면 캡컷에 바로 들어가요"];
  let mockAuth = { logged_in: false };
  return {
    get_state: async () => ({
      ok: true,
      app: { name: "타닥싱크 2", version: "2.0.0-mock" },
      auth: mockAuth,
      languages: ["자동 감지", "한국어", "일본어"],
      styles: [
        { key: "classic", name: "클래식 화이트", desc: "흰 글자 + 검은 외곽선 — 어떤 영상에도 어울리는 기본" },
        { key: "variety", name: "예능 옐로", desc: "노란 볼드 + 검은 외곽선 — 예능·리액션 하이라이트" },
        { key: "box", name: "블랙 박스", desc: "흰 글자 + 반투명 검은 박스 — 인터뷰·뉴스·강의" },
        { key: "lime", name: "네온 라임", desc: "라임 볼드 + 검은 외곽선 — 쇼츠·트렌디한 영상" },
        { key: "soft", name: "소프트 섀도", desc: "흰 글자 + 부드러운 그림자 — 브이로그·감성 영상" },
      ],
      capcut_running: false,
    }),
    start_login: async () => {
      emit("login_code", { code: "83A2FQ", url: "#" }, 700);
      emit("login_status", { message: "브라우저에서 구글 로그인 후 연동해 주세요… (mock)" }, 800);
      mockAuth = { logged_in: true, user_name: "테스트 수강생", email: "mock@tadak.kr", balance: 128 };
      emit("auth", mockAuth, 2400);
      return { ok: true };
    },
    cancel_login: async () => ({ ok: true }),
    logout: async () => { mockAuth = { logged_in: false }; return { ok: true, auth: mockAuth }; },
    refresh_me: async () => ({ ok: true, auth: mockAuth }),
    fetch_history: async () => ({
      ok: true,
      history: [
        { created_at: "2026-07-14 10:22", description: "자막 생성 (0714 브이로그)", delta: -4 },
        { created_at: "2026-07-12 18:03", description: "수강 후기 보상", delta: 100 },
        { created_at: "2026-07-10 09:41", description: "가입 보너스", delta: 100 },
      ],
    }),
    list_projects: async () => ({
      ok: true, capcut_running: Math.random() < 0.5,
      projects: [
        { index: 0, name: "0714 브이로그 최종", dir: "C:\\...", duration: "4:12.5", mtime: "2026-07-14 09:12" },
        { index: 1, name: "쇼츠 - 자막 실험", dir: "C:\\...", duration: "0:58.2", mtime: "2026-07-13 22:40" },
        { index: 2, name: "강의 3강 편집본", dir: "C:\\...", duration: "12:03.0", mtime: "2026-07-11 15:27" },
        { index: 3, name: "0627_test4", dir: "C:\\...", duration: "2:31.8", mtime: "2026-06-27 14:02" },
      ],
    }),
    add_draft_root: async () => ({ ok: true, cancelled: true }),
    capcut_running: async () => ({ ok: true, running: Math.random() < 0.4 }),
    start_transcribe: async () => {
      emit("progress", { message: "타임라인 오디오를 분석하고 있어요..." }, 400);
      emit("progress", { message: "코인 5개를 차감하고 있어요… (타임라인 약 5분)" }, 1300);
      emit("progress", { message: "음성을 인식하고 있어요..." }, 2200);
      for (let i = 1; i <= 8; i++) emit("progress_ratio", { ratio: i / 8 }, 2200 + i * 500);
      emit("script_ready", { text: SENT.join(" "), language: "ko", minutes: 5, missing_files: [] }, 6600);
      return { ok: true };
    },
    build_blocks: async (text) => {
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      if (!lines.length) return { ok: false, error: "자막 줄이 없어요." };
      let t = 0;
      return {
        ok: true,
        blocks: lines.map((l) => {
          const dur = Math.max(1_200_000, l.length * 130_000);
          const b = { start_us: t, end_us: t + dur, text: l };
          t += dur + 150_000;
          return b;
        }),
      };
    },
    import_srt: async () => ({ ok: true, cancelled: true }),
    export_srt: async () => ({ ok: true, path: "C:\\mock\\subtitles.srt" }),
    preview_play: async () => ({ ok: true }),
    preview_stop: async () => ({ ok: true }),
    inject: async (blocks) => {
      await new Promise((r) => setTimeout(r, 900));
      return { ok: true, count: blocks.length, backup: "draft_content.aisub_backup_mock.json", project: "0714 브이로그 최종" };
    },
    open_url: async () => ({ ok: true }),
  };
}

/* ───────────────────────── 초기화 ───────────────────────── */

async function init() {
  const st = await state.api.get_state();
  state.auth = st.auth;
  state.languages = st.languages;
  state.styles = st.styles;
  if (st.styles.length && !st.styles.some((s) => s.key === state.styleKey)) {
    state.styleKey = st.styles[0].key;
  }

  const langSel = $("#sel-language");
  langSel.innerHTML = state.languages
    .map((l) => `<option${l === "한국어" ? " selected" : ""}>${esc(l)}</option>`).join("");

  renderStyles();
  renderAuth();
  gotoStep(1);
  if (state.auth.logged_in) {
    loadProjects();
    state.api.refresh_me().then((r) => {
      if (r.ok) { state.auth = r.auth; renderAuth(); }
      else if (r.logged_out) toast(r.error, "warn");
    });
  }
}

function bindEvents() {
  $("#btn-login").addEventListener("click", startLogin);
  $("#btn-login-cancel").addEventListener("click", async () => {
    await state.api.cancel_login();
    $("#login-idle").classList.remove("hidden");
    $("#login-pending").classList.add("hidden");
  });

  $("#btn-acc-menu").addEventListener("click", (e) => {
    e.stopPropagation();
    $("#account-menu").classList.toggle("hidden");
  });
  document.addEventListener("click", () => $("#account-menu").classList.add("hidden"));
  $("#btn-logout").addEventListener("click", async () => {
    const r = await state.api.logout();
    state.auth = r.auth || { logged_in: false };
    renderAuth();
  });
  $("#btn-history").addEventListener("click", openHistory);
  $("#btn-history-close").addEventListener("click", () =>
    $("#history-overlay").classList.add("hidden"));
  $("#btn-refresh-me").addEventListener("click", async () => {
    const r = await state.api.refresh_me();
    if (r.ok) { state.auth = r.auth; renderAuth(); toast("잔액을 새로고침했어요.", "success"); }
    else toast(r.error, "warn");
  });

  $("#btn-reload-projects").addEventListener("click", loadProjects);
  $("#btn-add-root").addEventListener("click", async () => {
    const r = await state.api.add_draft_root();
    if (r.ok && r.projects) { state.projects = r.projects; renderProjects(); }
  });
  $("#btn-start-transcribe").addEventListener("click", startTranscribe);
  $("#btn-import-srt").addEventListener("click", importSrt);

  $("#script-editor").addEventListener("input", updateLineCount);
  $("#btn-build-blocks").addEventListener("click", buildBlocks);

  $("#btn-back-script").addEventListener("click", () => {
    if (state.fromSrt) { toast("SRT로 불러온 자막은 줄 나누기 화면이 없어요.", "warn"); return; }
    gotoStep(3);
  });
  $("#btn-export-srt").addEventListener("click", exportSrt);
  $("#btn-go-style").addEventListener("click", () => {
    if (!state.blocks.length) { toast("자막 블록이 없어요.", "warn"); return; }
    gotoStep(5);
  });

  $("#btn-back-blocks").addEventListener("click", () => gotoStep(4));
  bindSegmented("#seg-size", "size");
  bindSegmented("#seg-position", "position");
  $("#btn-inject").addEventListener("click", requestInject);
  $("#btn-confirm-cancel").addEventListener("click", () =>
    $("#confirm-overlay").classList.add("hidden"));
  $("#btn-confirm-inject").addEventListener("click", doInject);
  $("#btn-new-job").addEventListener("click", resetJob);
}

function boot() {
  bindEvents();
  if (window.pywebview && window.pywebview.api) {
    state.api = window.pywebview.api;
    init();
    return;
  }
  let booted = false;
  window.addEventListener("pywebviewready", () => {
    if (booted) return;
    booted = true;
    state.api = window.pywebview.api;
    init();
  });
  // pywebview가 아닌 순수 브라우저(개발 미리보기)에서는 mock으로 동작
  setTimeout(() => {
    if (booted || (window.pywebview && window.pywebview.api)) return;
    booted = true;
    state.api = makeMockApi();
    document.title += " (mock)";
    init();
  }, 600);
}

boot();
