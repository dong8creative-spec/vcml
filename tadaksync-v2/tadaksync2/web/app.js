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
  maxStep: 1,              // 방문·해금된 최고 단계 (2는 진행 화면이라 내비 제외)
  unlocked: { 1: true },   // 클릭으로 갈 수 있는 단계
  auth: { logged_in: false },
  languages: [],
  styles: [],
  projects: [],
  selectedProject: null,   // {index, name, ...}
  blocks: [],              // [{start_us, end_us, text}]
  fromSrt: false,
  splitMode: null,           // 'auto' | 'manual'
  scriptReadyMeta: null,
  styleKey: "classic",
  size: "medium",
  position: "bottom",
  highlightColor: "#ffef3b",
  recentHighlightColors: ["#ffef3b", "#00e5ff", "#ff5c8a", "#c8ff00"],
  playingIdx: null,
  busy: false,
  coinCourses: [],
  smartstoreReview: {},
  shownInboxIds: new Set(),
  keywordScan: null,
  blocksUndo: null,
  styleEditorOpen: false,
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

function normalizeColor(color) {
  const s = String(color || "").trim();
  const m = s.match(/^#?([0-9a-fA-F]{6})$/);
  return m ? `#${m[1].toLowerCase()}` : "#ffef3b";
}

function rememberHighlightColor(color) {
  const c = normalizeColor(color);
  state.highlightColor = c;
  state.recentHighlightColors = [c, ...state.recentHighlightColors.filter((x) => x !== c)].slice(0, 6);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/* ───────────────────────── 스텝 전환 ───────────────────────── */

/** 사이드바에서 갈 수 있는 단계만 해금. 2(인식 중)는 내비 대상이 아님. */
function unlockStep(n) {
  if (n === 2) return;
  state.unlocked[n] = true;
  if (n > state.maxStep) state.maxStep = n;
}

function renderStepNav() {
  $$("#step-nav .step").forEach((el) => {
    const s = parseInt(el.dataset.step, 10);
    const isActive = s === state.step;
    const canGo = canGoToStep(s);
    el.classList.toggle("active", isActive);
    el.classList.toggle("done", !!state.unlocked[s] && !isActive && s !== 2);
    el.classList.toggle("navable", canGo);
    el.classList.toggle("locked", !canGo && !isActive);
    el.setAttribute("role", "button");
    el.tabIndex = canGo ? 0 : -1;
    const label = el.querySelector(".step-label")?.textContent || String(s);
    el.title = canGo
      ? `${label}(으)로 이동`
      : (s === 2
        ? "인식이 끝나면 다음 단계로 이동합니다"
        : (isActive ? "현재 단계" : "아직 진행하지 않은 단계예요"));
  });
}

function canGoToStep(n) {
  if (state.busy || state.step === 2) return false;
  if (n === 2) return false;
  if (n === state.step) return false;
  if (!state.unlocked[n]) return false;
  if (n === 3 && state.fromSrt) return false;
  return true;
}

function gotoStep(n, opts = {}) {
  const { unlock = true } = opts;
  state.step = n;
  if (unlock) unlockStep(n);
  $$(".view").forEach((v) => v.classList.add("hidden"));
  $(`#view-${n}`).classList.remove("hidden");
  renderStepNav();
  if (n === 3) updateLineCount();
  if (n === 4) {
    renderBlocks();
    if (state.blocks.length) openStyleEditor({ silent: true });
    else closeStyleEditor();
  } else {
    closeStyleEditor();
  }
  if (n === 5) renderInjectSummary();
}

function onStepNavClick(n) {
  if (!canGoToStep(n)) return;
  gotoStep(n, { unlock: false });
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
  let res;
  try {
    res = await state.api.list_projects();
  } catch (e) {
    toast("프로젝트 탐색 중 오류가 발생했어요: " + (e?.message || e), "error");
    return;
  }
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
    const coins = p.estimated_coins ?? 1;
    const card = document.createElement("div");
    card.className = "project-card" +
      (state.selectedProject?.index === p.index ? " selected" : "");
    card.innerHTML = `
      <div class="p-name" title="${esc(p.name)}">${esc(p.name)}</div>
      <div class="p-meta">
        <div class="p-dur-row">
          <span class="p-badge" title="영상 최종길이 · 예상 코인">
            <span class="p-badge-label">최종길이</span>
            <span class="p-badge-val">${esc(p.duration)}</span>
            <span class="p-badge-sep">·</span>
            <span class="p-badge-coin">🪙 ${esc(coins)}</span>
          </span>
        </div>
        <div class="p-mtime">프로젝트 최신 수정일자 ${esc(p.mtime)}</div>
      </div>`;
    card.addEventListener("click", async () => {
      state.selectedProject = p;
      renderProjects();
      $("#start-bar").classList.remove("hidden");
      $("#sel-project-name").textContent = p.name;
      const r = await state.api.select_project(p.index);
      if (!r.ok) toast(r.error, "error");
      if (state.step === 5) renderInjectSummary();
    });
    grid.appendChild(card);
  }
}

/* ───────────────────────── 전문 인식 ───────────────────────── */

async function startTranscribe() {
  if (!state.selectedProject) { toast("프로젝트를 먼저 선택해 주세요.", "warn"); return; }
  const lang = $("#sel-language").value;
  state.busy = true;
  state.splitMode = null;
  $("#progress-stage").classList.remove("hidden");
  $("#split-choice").classList.add("hidden");
  gotoStep(2, { unlock: false });
  $("#progress-fill").style.width = "0%";
  $("#progress-msg").textContent = "준비 중…";
  const res = await state.api.start_transcribe(state.selectedProject.index, lang);
  if (!res.ok) {
    state.busy = false;
    toast(res.error, "error");
    gotoStep(1, { unlock: false });
  }
}

function onScriptReady(data) {
  state.busy = false;
  state.scriptReadyMeta = data;
  $("#script-editor").value = data.text;
  state.fromSrt = false;
  state.splitMode = null;
  if (data.missing_files && data.missing_files.length) {
    toast(`원본 파일 ${data.missing_files.length}개를 찾지 못해 일부 구간이 빠졌을 수 있어요.`, "warn");
  }
  const autoCoins = data.line_split_auto_coins ?? data.line_split_coins ?? 1;
  const manualCoins = data.line_split_manual_coins ?? 2;
  $("#split-auto-coins").textContent = autoCoins;
  $("#split-manual-coins").textContent = manualCoins;
  $("#progress-stage").classList.add("hidden");
  $("#split-choice").classList.remove("hidden");
  gotoStep(2);
  toast("전문 인식 완료! 줄 나누기 방식을 선택하세요.", "success");
}

function showSplitChoice() {
  $("#progress-stage").classList.add("hidden");
  $("#split-choice").classList.remove("hidden");
}

async function chooseSplitAuto() {
  if (state.busy) return;
  const minW = Number($("#split-min-words")?.value || 1);
  const maxW = Number($("#split-max-words")?.value || 5);
  if (minW > maxW) {
    toast("최소 어절은 최대 어절보다 클 수 없어요.", "warn");
    return;
  }
  state.busy = true;
  try {
    const res = await state.api.build_blocks_auto(minW, maxW);
    if (!res.ok) { toast(res.error, "error"); return; }
    state.splitMode = "auto";
    state.blocks = res.blocks;
    if (res.line_split_coins) {
      toast(`자동 어절 나누기 (${minW}~${maxW}어절) · ${res.line_split_coins}코인 차감`, "success");
      if (res.balance != null && state.auth) state.auth.balance = res.balance;
      renderAuth();
    }
    gotoStep(4);
  } catch (e) {
    toast(e?.message || "자동 어절 나누기에 실패했어요.", "error");
  } finally {
    state.busy = false;
  }
}

function chooseSplitManual() {
  state.splitMode = "manual";
  $("#split-choice").classList.add("hidden");
  gotoStep(3);
  updateLineCount();
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
  state.splitMode = "manual";
  state.blocks = res.blocks;
  if (res.line_split_coins) {
    toast(`엔터 줄 나누기 · ${res.line_split_coins}코인 차감`, "success");
    if (res.balance != null && state.auth) state.auth.balance = res.balance;
    renderAuth();
  }
  gotoStep(4);
}

function remapSpansOnTextChange(oldText, newText, spans) {
  if (!Array.isArray(spans) || !spans.length) return [];
  const src = String(oldText || "");
  const dst = String(newText || "");
  if (src === dst) return spans;
  const out = [];
  let from = 0;
  for (const span of spans) {
    const frag = src.slice(span.start, span.end);
    if (!frag) continue;
    const idx = dst.indexOf(frag, from);
    if (idx < 0) continue;
    out.push({ ...span, start: idx, end: idx + frag.length });
    from = idx + frag.length;
  }
  return out;
}

function syncSplitWordRange() {
  const minEl = $("#split-min-words");
  const maxEl = $("#split-max-words");
  if (!minEl || !maxEl) return;
  if (Number(minEl.value) > Number(maxEl.value)) {
    minEl.value = maxEl.value;
  }
}

let syncEditorTimer = null;

function updateStyleEditorButton() {
  const btn = $("#btn-open-style-editor");
  if (!btn) return;
  btn.classList.toggle("active", state.styleEditorOpen);
  btn.textContent = state.styleEditorOpen ? "단어·스타일 편집 (열림)" : "단어·스타일 편집";
}

function scheduleSyncEditorBlocks() {
  if (!state.styleEditorOpen) return;
  clearTimeout(syncEditorTimer);
  syncEditorTimer = setTimeout(async () => {
    await state.api.sync_editor_blocks(state.blocks);
  }, 280);
}

async function openStyleEditor(opts = {}) {
  if (!state.blocks.length) {
    if (!opts.silent) toast("편집할 자막 블록이 없어요.", "warn");
    return;
  }
  await state.api.sync_editor_blocks(state.blocks);
  await state.api.sync_editor_config({ highlightColor: state.highlightColor });
  const res = await state.api.open_style_editor_window();
  if (!res.ok) {
    if (!opts.silent) toast(res.error, "error");
    return;
  }
  state.styleEditorOpen = true;
  updateStyleEditorButton();
}

async function closeStyleEditor() {
  if (!state.styleEditorOpen) return;
  await state.api.close_style_editor_window();
  state.styleEditorOpen = false;
  updateStyleEditorButton();
}

async function toggleStyleEditor() {
  if (state.styleEditorOpen) await closeStyleEditor();
  else await openStyleEditor();
}

function renderBlocks() {
  const list = $("#block-list");
  list.innerHTML = "";
  state.blocks.forEach((b, i) => {
    if (!Array.isArray(b.spans)) b.spans = [];
    const row = document.createElement("div");
    row.className = "block-row" + (state.playingIdx === i ? " playing" : "");
    const spanHint = (b.spans && b.spans.length)
      ? `<span class="block-span-hint">${b.spans.length}개 강조</span>` : "";
    row.innerHTML = `
      <span class="block-idx">${i + 1}</span>
      <span class="block-time">
        <input class="t-start" value="${fmtTime(b.start_us)}">
        <span class="tilde">–</span>
        <input class="t-end" value="${fmtTime(b.end_us)}">
      </span>
      <div class="block-text-wrap">
        <input class="block-text" value="${esc(b.text)}">
        ${spanHint}
      </div>
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
      const prev = b.text;
      b.text = e.target.value;
      b.spans = remapSpansOnTextChange(prev, b.text, b.spans || []);
      scheduleSyncEditorBlocks();
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
      scheduleSyncEditorBlocks();
    });
    list.appendChild(row);
  });
}

async function importSrt() {
  if (!state.selectedProject) {
    toast("자막을 넣을 프로젝트를 먼저 선택해 주세요.", "warn");
    return;
  }
  const res = await state.api.import_srt(state.selectedProject.index);
  if (res.cancelled) return;
  if (!res.ok) { toast(res.error, "error"); return; }
  state.blocks = res.blocks;
  state.fromSrt = true;
  gotoStep(4);
  const pname = res.project || state.selectedProject.name;
  toast(`「${pname}」용으로 SRT 자막 ${res.blocks.length}개를 불러왔어요.`, "success");
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
    `「${name}」에 자막 ${state.blocks.length}개 삽입`;
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
  if (!state.selectedProject) {
    toast("프로젝트를 먼저 선택해 주세요. 1단계에서 고를 수 있어요.", "warn");
    gotoStep(1, { unlock: false });
    return;
  }
  const chk = await state.api.capcut_running();
  if (chk.ok && chk.running) {
    $("#confirm-project-name").textContent = state.selectedProject.name;
    $("#confirm-overlay").classList.remove("hidden");
    return;
  }
  doInject();
}

async function doInject() {
  $("#confirm-overlay").classList.add("hidden");
  if (!state.selectedProject) {
    toast("프로젝트를 먼저 선택해 주세요. 1단계에서 고를 수 있어요.", "warn");
    gotoStep(1, { unlock: false });
    return;
  }
  const btn = $("#btn-inject");
  btn.disabled = true;
  btn.textContent = "삽입하고 있어요…";
  try {
    const res = await state.api.inject(
      state.blocks, state.styleKey, state.size, state.position,
      state.selectedProject.index);
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
  state.busy = false;
  state.unlocked = { 1: true };
  state.maxStep = 1;
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

function applyMeExtras(r) {
  if (!r) return;
  if (r.coin_courses) state.coinCourses = r.coin_courses;
  if (r.smartstore_review) state.smartstoreReview = r.smartstore_review;
  if (r.pending_actions) handlePendingActions(r.pending_actions);
}

function handlePendingActions(actions) {
  const ids = [];
  for (const action of actions || []) {
    const id = String(action.id || "");
    if (!id || state.shownInboxIds.has(id)) continue;
    state.shownInboxIds.add(id);
    const typ = action.type;
    const body = action.body || "";
    if (typ === "smartstore_rewrite") {
      toast(body || "스마트스토어 후기를 아직 확인하지 못했어요. 작성 후 다시 「작성 완료」를 눌러 주세요.", "warn");
      ids.push(id);
    } else if (typ === "smartstore_granted") {
      toast(body || "스마트스토어 후기 보너스 코인이 지급됐어요!", "success");
      ids.push(id);
    }
  }
  if (ids.length) state.api.ack_inbox(ids).catch(() => {});
}

async function openReviewGuide() {
  $("#account-menu").classList.add("hidden");
  $("#review-overlay").classList.remove("hidden");
  $("#review-courses").innerHTML = '<p class="sub">불러오는 중…</p>';
  $("#review-smartstore").innerHTML = "";
  const r = await state.api.refresh_me();
  if (!r.ok) {
    $("#review-courses").innerHTML = `<p class="sub">${esc(r.error || "불러오지 못했어요.")}</p>`;
    return;
  }
  applyMeExtras(r);
  state.auth = r.auth;
  renderAuth();
  renderReviewGuide();
}

function renderReviewGuide() {
  const pending = (state.coinCourses || []).filter((c) => !c.review_bonus_granted);
  const coursesEl = $("#review-courses");
  if (!pending.length) {
    coursesEl.innerHTML = '<p class="sub">수강 후기 보너스를 모두 받으셨어요. 감사합니다!</p>';
  } else {
    coursesEl.innerHTML = pending.map((c) => {
      const title = esc(c.course_title || "수강 강의");
      const bonus = Number(c.review_bonus_coins || 50).toLocaleString();
      const cid = esc(c.course_id || "");
      return `<button class="btn btn-ghost review-course-btn" data-course-id="${cid}" style="width:100%;margin-bottom:8px;justify-content:flex-start">
        ${title} 후기 작성하기 (+${bonus}코인)
      </button>`;
    }).join("");
    $$(".review-course-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const r = await state.api.review_write_url(btn.dataset.courseId || null);
        if (r.ok && r.url) state.api.open_url(r.url);
        else toast(r.error || "후기 작성 페이지를 열지 못했어요.", "warn");
      });
    });
  }

  const smart = state.smartstoreReview || {};
  const status = smart.status || "none";
  const bonus = Number(smart.bonus_coins || 150).toLocaleString();
  const storeUrl = (smart.store_review_url || "").trim();
  const smartEl = $("#review-smartstore");
  let html = `<h3 class="review-h3">네이버 스마트스토어 후기</h3>`;
  if (status === "approved") {
    html += `<p class="sub">스마트스토어 후기 보너스까지 받으셨어요. 감사합니다!</p>`;
  } else if (status === "pending") {
    html += `<p class="sub">작성 완료 신고를 접수했어요. 관리자가 확인하는 중이에요.</p>`;
  } else {
    let guide = `스마트스토어에 후기를 작성한 뒤 완료를 눌러 주시면, 관리자 확인 후 +${bonus}코인을 드려요.`;
    if (status === "rejected" && smart.reject_reason) {
      guide = `${esc(smart.reject_reason)}\n\n${guide}`;
    }
    html += `<p class="sub" style="white-space:pre-wrap;margin-bottom:12px">${guide}</p>
      <div class="done-actions" style="justify-content:flex-start">
        <button class="btn btn-ghost" id="btn-open-store">스토어 후기 작성</button>
        <button class="btn btn-primary" id="btn-claim-smartstore">작성 완료했어요 (+${bonus})</button>
      </div>`;
  }
  smartEl.innerHTML = html;
  const openBtn = $("#btn-open-store");
  if (openBtn) {
    openBtn.addEventListener("click", () => {
      if (!storeUrl) { toast("스마트스토어 링크가 아직 준비되지 않았어요.", "warn"); return; }
      state.api.open_url(storeUrl);
    });
  }
  const claimBtn = $("#btn-claim-smartstore");
  if (claimBtn) {
    claimBtn.addEventListener("click", async () => {
      if (!confirm("네이버 스마트스토어에 후기를 정말 작성하셨나요?\n관리자가 확인한 뒤 보너스 지급 여부를 알려드릴게요.")) return;
      claimBtn.disabled = true;
      const r = await state.api.claim_smartstore_review();
      claimBtn.disabled = false;
      if (!r.ok) { toast(r.error || "신고에 실패했어요.", "warn"); return; }
      applyMeExtras(r);
      state.auth = r.auth;
      renderAuth();
      renderReviewGuide();
      toast("작성 완료 신고를 접수했어요! 확인 후 코인이 지급돼요.", "success");
    });
  }
}

/* ───────────────────────── DEV 모니터 ───────────────────────── */

function isDevMode() {
  return window.__TADAKSYNC_DEV__ === true
    || new URLSearchParams(location.search).get("dev") === "1";
}

function devLine(tag, ...parts) {
  const msg = parts.map((p) => {
    if (p == null) return "";
    if (typeof p === "object") {
      try { return JSON.stringify(p).slice(0, 140); } catch (_) { return String(p); }
    }
    return String(p);
  }).filter(Boolean).join(" ");
  console.log(`[dev:${tag}]`, msg);
  const log = $("#dev-log");
  if (!log) return;
  const row = document.createElement("div");
  row.className = "dev-log-row";
  row.textContent = `[${tag}] ${msg}`;
  log.prepend(row);
  while (log.childNodes.length > 100) log.removeChild(log.lastChild);
}

function updateDevHud() {
  const hud = $("#dev-hud-state");
  if (!hud) return;
  hud.textContent = `step=${state.step} busy=${state.busy} split=${state.splitMode || "-"} blocks=${state.blocks.length}`;
}

function attachDevApiMonitor(api) {
  if (!api || typeof Proxy === "undefined") return api;
  return new Proxy(api, {
    get(target, prop) {
      const val = target[prop];
      if (typeof val !== "function") return val;
      return async (...args) => {
        devLine("api→", String(prop));
        const t0 = performance.now();
        try {
          const res = await val.apply(target, args);
          const ms = `${(performance.now() - t0).toFixed(0)}ms`;
          if (res && res.ok === false) devLine("api←", String(prop), res.error || "fail", ms);
          else devLine("api←", String(prop), ms);
          return res;
        } catch (e) {
          devLine("api!", String(prop), e?.message || e);
          throw e;
        }
      };
    },
  });
}

window.installDevMonitor = function installDevMonitor() {
  if (window.__devMonitorInstalled) return;
  window.__devMonitorInstalled = true;
  window.__TADAKSYNC_DEV__ = true;
  $("#dev-dock")?.classList.remove("hidden");
  const prev = window.__pyEvent;
  window.__pyEvent = (msg) => {
    devLine("event", msg?.event);
    return prev?.(msg);
  };
  updateDevHud();
  if (!window.__devHudTimer) {
    window.__devHudTimer = setInterval(updateDevHud, 400);
  }
  devLine("app", "dev monitor ready");
};

function maybeEnableDev(api) {
  if (!isDevMode()) return api;
  window.installDevMonitor();
  // pywebview.api는 Proxy로 감싸면 get_state 등 브리지 호출이 깨진다.
  // Python 쪽 DevApiWrapper가 API 로그를 이미 남긴다.
  return api;
}

/* ───────────────────────── Python 이벤트 ───────────────────────── */

window.__pyEvent = (msg) => {
  const { event, data } = msg;
  switch (event) {
    case "auth":
      state.auth = data;
      renderAuth();
      if (data.logged_in) {
        if (state.step === 1) loadProjects();
        state.api.refresh_me().then((r) => {
          if (r.ok) {
            applyMeExtras(r);
            state.auth = r.auth;
            renderAuth();
          }
        });
      }
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
      state.busy = false;
      toast(data.message, "error");
      gotoStep(1, { unlock: false });
      break;
    case "pending_actions":
      handlePendingActions(data || []);
      break;
    case "prewarm_status":
      if (data?.message && (
        data.kind === "warn"
        || data.message.includes("미리 준비")
        || data.message.includes("준비가 끝")
      )) {
        toast(data.message, data.kind || "success");
      }
      break;
    case "blocks_updated":
      if (data?.blocks) {
        state.blocks = data.blocks;
        if (state.step === 4) renderBlocks();
      }
      break;
    case "style_editor_closed":
      state.styleEditorOpen = false;
      updateStyleEditorButton();
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
  let mockEditorBlocks = [];
  let mockEditorConfig = {};
  let mockEditorWin = null;
  return {
    get_state: async () => ({
      ok: true,
      app: { name: "타닥싱크 2", version: "2.16.0-mock" },
      auth: mockAuth,
      languages: ["자동 감지", "한국어", "일본어"],
      styles: [
        { key: "classic", name: "클래식 화이트", desc: "흰 글자 + 검은 외곽선 — 어떤 영상에도 어울리는 기본" },
        { key: "variety", name: "예능 옐로", desc: "노란 볼드 + 검은 외곽선 — 예능·리액션 하이라이트" },
        { key: "lime", name: "네온 라임", desc: "라임 볼드 + 검은 외곽선 — 쇼츠·트렌디한 영상" },
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
    refresh_me: async () => ({
      ok: true,
      auth: mockAuth,
      coin_courses: [{ course_id: "c1", course_title: "캡컷 초신속", review_bonus_coins: 50, review_bonus_granted: false }],
      smartstore_review: { status: "none", bonus_coins: 150, store_review_url: "#" },
      pending_actions: [],
    }),
    claim_smartstore_review: async () => ({
      ok: true,
      auth: mockAuth,
      coin_courses: [],
      smartstore_review: { status: "pending", bonus_coins: 150 },
    }),
    ack_inbox: async () => ({ ok: true }),
    review_write_url: async (cid) => ({ ok: true, url: `https://vcml.kr/mypage.html?tab=courses&review_course=${cid || ""}` }),
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
        { index: 0, name: "0714 브이로그 최종", dir: "C:\\...", duration: "4:12.50", estimated_coins: 5, mtime: "2026-07-14 09:12" },
        { index: 1, name: "쇼츠 - 자막 실험", dir: "C:\\...", duration: "0:58.20", estimated_coins: 1, mtime: "2026-07-13 22:40" },
        { index: 2, name: "강의 3강 편집본", dir: "C:\\...", duration: "12:03.00", estimated_coins: 13, mtime: "2026-07-11 15:27" },
        { index: 3, name: "0627_test4", dir: "C:\\...", duration: "2:31.80", estimated_coins: 3, mtime: "2026-06-27 14:02" },
      ],
    }),
    add_draft_root: async () => ({ ok: true, cancelled: true }),
    select_project: async (index) => ({
      ok: true,
      project: { index, name: ["0714 브이로그 최종", "쇼츠 - 자막 실험", "강의 3강 편집본", "0627_test4"][index] || "프로젝트" },
    }),
    capcut_running: async () => ({ ok: true, running: Math.random() < 0.4 }),
    start_transcribe: async () => {
      emit("progress", { message: "타임라인 오디오를 분석하고 있어요..." }, 400);
      emit("progress", { message: "코인 5개를 차감하고 있어요… (타임라인 약 5분)" }, 1300);
      emit("progress", { message: "음성을 인식하고 있어요..." }, 2200);
      for (let i = 1; i <= 8; i++) emit("progress_ratio", { ratio: i / 8 }, 2200 + i * 500);
      emit("script_ready", {
        text: SENT.join(" "), language: "ko", minutes: 5, missing_files: [],
        line_split_auto_coins: 1, line_split_manual_coins: 2,
      }, 6600);
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
        line_split_coins: 2,
        split_mode: "manual",
      };
    },
    build_blocks_auto: async () => {
      const lines = SENT;
      let t = 0;
      return {
        ok: true,
        blocks: lines.map((l) => {
          const dur = Math.max(1_200_000, l.length * 130_000);
          const b = { start_us: t, end_us: t + dur, text: l };
          t += dur + 150_000;
          return b;
        }),
        line_split_coins: 1,
        split_mode: "auto",
      };
    },
    scan_keyword: async (blocks, keyword, mode) => {
      const kw = String(keyword || "").trim();
      if (!kw) return { ok: false, error: "키워드를 입력해 주세요." };
      const matches = [];
      (blocks || []).forEach((b, bi) => {
        const text = b.text || "";
        if (mode === "contains") {
          let start = 0;
          while (true) {
            const idx = text.indexOf(kw, start);
            if (idx < 0) break;
            matches.push({ block_index: bi, start: idx, end: idx + kw.length, snippet: text.slice(Math.max(0, idx - 4), idx + kw.length + 4) });
            start = idx + Math.max(1, kw.length);
          }
        } else {
          const re = /\S+/g;
          let m;
          while ((m = re.exec(text)) !== null) {
            if (m[0] === kw) matches.push({ block_index: bi, start: m.index, end: m.index + kw.length, snippet: m[0] });
          }
        }
      });
      const blockSet = new Set(matches.map((m) => m.block_index));
      return { ok: true, keyword: kw, mode, count: matches.length, block_count: blockSet.size, matches };
    },
    apply_keyword_highlight: async (blocks, keyword, mode, color, bold, boldWidth, italic, italicDegree) => {
      const kw = String(keyword || "").trim();
      const out = JSON.parse(JSON.stringify(blocks || []));
      let applied = 0;
      out.forEach((b, bi) => {
        const text = b.text || "";
        const hits = [];
        if (mode === "contains") {
          let start = 0;
          while (true) {
            const idx = text.indexOf(kw, start);
            if (idx < 0) break;
            hits.push({ start: idx, end: idx + kw.length });
            start = idx + Math.max(1, kw.length);
          }
        } else {
          const re = /\S+/g;
          let m;
          while ((m = re.exec(text)) !== null) {
            if (m[0] === kw) hits.push({ start: m.index, end: m.index + kw.length });
          }
        }
        hits.forEach(({ start, end }) => {
          b.spans = b.spans || [];
          const entry = { start, end };
          if (color) entry.color = color;
          if (bold) { entry.bold = true; if (boldWidth != null) entry.bold_width = boldWidth; }
          if (italic) { entry.italic = true; if (italicDegree != null) entry.italic_degree = italicDegree; }
          b.spans = b.spans.filter((s) => !(s.start === start && s.end === end));
          b.spans.push(entry);
          applied += 1;
        });
      });
      if (!applied) return { ok: false, error: "일치하는 단어가 없어요." };
      return { ok: true, blocks: out, applied, count: applied, block_count: out.length };
    },
    clear_keyword_highlight: async (blocks, keyword, mode) => {
      const kw = String(keyword || "").trim();
      const out = JSON.parse(JSON.stringify(blocks || []));
      out.forEach((b) => {
        const text = b.text || "";
        b.spans = (b.spans || []).filter((s) => {
          const frag = text.slice(s.start, s.end);
          if (mode === "contains") return frag !== kw && !text.slice(s.start, s.end).includes(kw);
          return frag !== kw;
        });
      });
      return { ok: true, blocks: out };
    },
    replace_keyword_text: async (blocks, keyword, replacement, mode) => {
      const kw = String(keyword || "").trim();
      const repl = String(replacement ?? "");
      const out = JSON.parse(JSON.stringify(blocks || []));
      let replaced = 0;
      out.forEach((b) => {
        let text = b.text || "";
        const old = text;
        const hits = [];
        if (mode === "contains") {
          let start = 0;
          while (true) {
            const idx = text.indexOf(kw, start);
            if (idx < 0) break;
            hits.push({ start: idx, end: idx + kw.length });
            start = idx + Math.max(1, kw.length);
          }
        } else {
          const re = /\S+/g;
          let m;
          while ((m = re.exec(text)) !== null) {
            if (m[0] === kw) hits.push({ start: m.index, end: m.index + kw.length });
          }
        }
        hits.reverse().forEach(({ start, end }) => {
          text = text.slice(0, start) + repl + text.slice(end);
          replaced += 1;
        });
        if (text !== old) {
          b.text = text;
          b.spans = remapSpansOnTextChange(old, text, b.spans || []);
        }
      });
      return { ok: true, blocks: out, replaced };
    },
    import_srt: async (projectIndex) => {
      if (projectIndex == null) return { ok: false, error: "프로젝트를 다시 선택해 주세요." };
      return { ok: true, cancelled: true };
    },
    export_srt: async () => ({ ok: true, path: "C:\\mock\\subtitles.srt" }),
    preview_play: async () => ({ ok: true }),
    preview_stop: async () => ({ ok: true }),
    inject: async (blocks, _style, _size, _pos, projectIndex) => {
      if (projectIndex == null) return { ok: false, error: "프로젝트를 먼저 선택해 주세요." };
      await new Promise((r) => setTimeout(r, 900));
      const names = ["0714 브이로그 최종", "쇼츠 - 자막 실험", "강의 3강 편집본", "0627_test4"];
      return {
        ok: true, count: blocks.length,
        backup: "draft_content.aisub_backup_mock.json",
        project: names[projectIndex] || "프로젝트",
      };
    },
    open_url: async () => ({ ok: true }),
    sync_editor_blocks: async (blocks) => {
      mockEditorBlocks = JSON.parse(JSON.stringify(blocks || []));
      if (mockEditorWin && !mockEditorWin.closed) {
        mockEditorWin.postMessage({ event: "blocks_synced", data: { blocks: mockEditorBlocks } }, "*");
      }
      return { ok: true };
    },
    sync_editor_config: async (config) => {
      mockEditorConfig = { ...(config || {}) };
      return { ok: true };
    },
    get_editor_state: async () => ({
      ok: true,
      blocks: mockEditorBlocks,
      config: mockEditorConfig,
    }),
    push_editor_blocks: async (blocks) => {
      mockEditorBlocks = JSON.parse(JSON.stringify(blocks || []));
      emit("blocks_updated", { blocks: mockEditorBlocks }, 0);
      return { ok: true };
    },
    style_editor_is_open: async () => ({ ok: true, open: !!(mockEditorWin && !mockEditorWin.closed) }),
    open_style_editor_window: async () => {
      if (!mockEditorBlocks.length) return { ok: false, error: "편집할 자막 블록이 없어요." };
      if (mockEditorWin && !mockEditorWin.closed) {
        mockEditorWin.focus();
        mockEditorWin.postMessage({ event: "blocks_synced", data: { blocks: mockEditorBlocks } }, "*");
        return { ok: true, open: true };
      }
      mockEditorWin = window.open("style-editor.html", "tadaksync-style-editor", "width=440,height=720");
      return { ok: true, open: true };
    },
    close_style_editor_window: async () => {
      if (mockEditorWin && !mockEditorWin.closed) mockEditorWin.close();
      mockEditorWin = null;
      emit("style_editor_closed", {}, 0);
      return { ok: true, open: false };
    },
    toggle_style_editor_window: async () => ({ ok: true }),
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
      if (r.ok) {
        applyMeExtras(r);
        state.auth = r.auth;
        renderAuth();
      } else if (r.logged_out) toast(r.error, "warn");
    });
  }
}

function bindEvents() {
  $$("#step-nav .step").forEach((el) => {
    el.addEventListener("click", () => {
      const n = parseInt(el.dataset.step, 10);
      onStepNavClick(n);
    });
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      onStepNavClick(parseInt(el.dataset.step, 10));
    });
  });

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
  $("#btn-review-guide").addEventListener("click", openReviewGuide);
  $("#btn-review-close").addEventListener("click", () =>
    $("#review-overlay").classList.add("hidden"));
  $("#btn-refresh-me").addEventListener("click", async () => {
    const r = await state.api.refresh_me();
    if (r.ok) {
      applyMeExtras(r);
      state.auth = r.auth;
      renderAuth();
      toast("잔액을 새로고침했어요.", "success");
    } else toast(r.error, "warn");
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
  $("#split-min-words")?.addEventListener("change", syncSplitWordRange);
  $("#split-max-words")?.addEventListener("change", syncSplitWordRange);

  $("#btn-open-style-editor").addEventListener("click", toggleStyleEditor);

  $("#btn-back-script").addEventListener("click", () => {
    if (state.fromSrt) { toast("SRT로 불러온 자막은 줄 나누기 화면이 없어요.", "warn"); return; }
    if (state.splitMode === "auto") {
      showSplitChoice();
      gotoStep(2);
      return;
    }
    gotoStep(3);
  });
  $("#btn-split-auto").addEventListener("click", chooseSplitAuto);
  $("#btn-split-manual").addEventListener("click", chooseSplitManual);
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
    state.api = maybeEnableDev(window.pywebview.api);
    init();
    return;
  }

  let booted = false;
  const bootReal = () => {
    if (booted) return;
    booted = true;
    state.api = maybeEnableDev(window.pywebview.api);
    init();
  };
  window.addEventListener("pywebviewready", bootReal);

  // pywebview API 주입은 창 초기화(디스크 I/O, 백신 스캔 등)에 따라
  // 수 초 걸릴 수 있어 짧은 타임아웃으로 mock과 경합시키면 안 된다.
  // 최대 15초(150ms x 100회) 동안 실제 브릿지가 나타나는지 폴링하고,
  // 그래도 없을 때만(=pywebview가 아예 아닌 순수 브라우저 미리보기) mock으로 전환한다.
  let tries = 0;
  const poll = setInterval(() => {
    if (booted) { clearInterval(poll); return; }
    if (window.pywebview && window.pywebview.api) {
      clearInterval(poll);
      bootReal();
      return;
    }
    tries += 1;
    if (tries >= 100) {
      clearInterval(poll);
      if (booted) return;
      booted = true;
      state.api = maybeEnableDev(makeMockApi());
      document.title += " (mock)";
      init();
    }
  }, 150);
}

boot();
