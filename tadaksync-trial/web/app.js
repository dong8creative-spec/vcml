"use strict";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const SAMPLE_CAP = "타닥싱크";

const state = {
  api: null,
  step: 1,
  remaining: 0,
  canUse: true,
  styles: [],
  projects: [],
  selectedProject: null,
  lineCount: 0,
  styleKey: "classic",
  size: "medium",
  position: "bottom",
  busy: false,
  pendingAfterQuiz: null,
};

function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.textContent = msg;
  $("#toast-root").appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; }, 2600);
  setTimeout(() => el.remove(), 3000);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function applyUses(data) {
  if (!data) return;
  if (typeof data.remaining === "number") state.remaining = data.remaining;
  if (typeof data.can_use === "boolean") state.canUse = data.can_use;
  $("#acc-remaining").textContent = data.label || `${state.remaining}회`;
}

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
  if (n === 4) renderInjectSummary();
}

function updateLineCount() {
  const text = $("#script-editor")?.value || "";
  const n = text.split(/\r?\n/).filter((line) => line.trim()).length;
  const el = $("#line-count");
  if (el) el.textContent = String(n);
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
      <div class="p-meta">
        <div class="p-dur-row">
          <span class="p-badge">
            <span class="p-badge-label">길이</span>
            <span class="p-badge-val">${esc(p.duration)}</span>
          </span>
        </div>
        <div class="p-mtime">최근 수정 ${esc(p.mtime)}</div>
      </div>`;
    card.addEventListener("click", async () => {
      state.selectedProject = p;
      renderProjects();
      $("#start-bar").classList.remove("hidden");
      $("#sel-project-name").textContent = p.name;
      const r = await state.api.select_project(p.index);
      if (!r.ok) toast(r.error, "error");
    });
    grid.appendChild(card);
  }
}

async function loadProjects() {
  const r = await state.api.list_projects();
  if (!r.ok) { toast(r.error, "error"); return; }
  applyUses(r);
  state.projects = r.projects || [];
  $("#capcut-warn").classList.toggle("hidden", !r.capcut_running);
  renderProjects();
}

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
  $("#inject-summary").textContent = `「${name}」에 자막 ${state.lineCount}개 삽입`;
}

function bindSegmented(rootSel, key) {
  $(rootSel).addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-v]");
    if (!btn) return;
    state[key] = btn.dataset.v;
    $$(rootSel + " button").forEach((b) => b.classList.toggle("on", b === btn));
  });
}

async function openQuiz(thenDo) {
  state.pendingAfterQuiz = thenDo || null;
  const r = await state.api.quiz_question();
  if (!r.ok) { toast(r.error, "error"); return; }
  $("#quiz-q").textContent = "Q. " + r.question;
  $("#quiz-answer").value = "";
  $("#quiz-error").classList.add("hidden");
  $("#quiz-overlay").classList.remove("hidden");
  $("#quiz-answer").focus();
}

async function submitQuiz() {
  const answer = $("#quiz-answer").value;
  const r = await state.api.quiz_answer(answer);
  if (!r.ok) {
    $("#quiz-error").textContent = r.error || "정답이 아닙니다.";
    $("#quiz-error").classList.remove("hidden");
    return;
  }
  applyUses(r);
  $("#quiz-overlay").classList.add("hidden");
  toast("정답입니다. 10회가 추가되었어요.", "success");
  const next = state.pendingAfterQuiz;
  state.pendingAfterQuiz = null;
  if (typeof next === "function") next();
}

async function startTranscribe() {
  if (!state.selectedProject) { toast("프로젝트를 먼저 선택해 주세요.", "warn"); return; }
  if (!state.canUse) {
    openQuiz(startTranscribe);
    return;
  }
  state.busy = true;
  $("#progress-msg").textContent = "준비 중…";
  $("#progress-fill").style.width = "6%";
  gotoStep(2);
  const r = await state.api.start_transcribe(state.selectedProject.index);
  if (!r.ok) {
    state.busy = false;
    if (r.needs_quiz) { gotoStep(1); openQuiz(startTranscribe); return; }
    toast(r.error, "error");
    gotoStep(1);
  }
}

async function buildBlocks() {
  const text = $("#script-editor").value;
  if (!text.split(/\r?\n/).some((line) => line.trim())) {
    toast("엔터로 자막 줄을 나눠 주세요.", "warn");
    return;
  }
  const r = await state.api.build_blocks(text);
  if (!r.ok) { toast(r.error, "error"); return; }
  state.lineCount = r.line_count || 0;
  renderStyles();
  gotoStep(4);
  toast(`자막 ${state.lineCount}줄을 만들었어요.`, "success");
}

async function requestInject() {
  if (!state.lineCount) { toast("삽입할 자막이 없어요.", "warn"); return; }
  if (!state.canUse) {
    openQuiz(requestInject);
    return;
  }
  const chk = await state.api.capcut_running();
  if (chk.ok && chk.running) {
    $("#confirm-project-name").textContent = state.selectedProject?.name || "—";
    $("#confirm-overlay").classList.remove("hidden");
    return;
  }
  doInject();
}

async function doInject() {
  $("#confirm-overlay").classList.add("hidden");
  const r = await state.api.inject(state.styleKey, state.size, state.position);
  if (!r.ok) {
    if (r.needs_quiz) { openQuiz(doInject); return; }
    toast(r.error, "error");
    return;
  }
  applyUses(r);
  $("#done-msg").textContent = `「${r.project}」에 자막 ${r.line_count}개가 들어갔어요.`;
  $("#done-overlay").classList.remove("hidden");
}

window.__pyEvent = (msg) => {
  const { event, data } = msg || {};
  if (event === "progress") {
    if (data?.message) $("#progress-msg").textContent = data.message;
    if (typeof data?.ratio === "number") {
      $("#progress-fill").style.width = Math.round(data.ratio * 100) + "%";
    }
  } else if (event === "script_ready") {
    state.busy = false;
    state.lineCount = 0;
    $("#progress-fill").style.width = "100%";
    $("#script-editor").value = data?.text || "";
    updateLineCount();
    gotoStep(3);
    toast("전문을 인식했어요. 엔터로 줄을 나눠 주세요.", "success");
  } else if (event === "transcribe_error") {
    state.busy = false;
    toast(data?.message || "인식에 실패했어요.", "error");
    gotoStep(1);
  }
};

async function boot() {
  const wait = () => new Promise((resolve) => {
    if (window.pywebview?.api) return resolve(window.pywebview.api);
    const t = setInterval(() => {
      if (window.pywebview?.api) { clearInterval(t); resolve(window.pywebview.api); }
    }, 50);
  });
  state.api = await wait();
  const r = await state.api.boot();
  if (!r.ok) { toast(r.error, "error"); return; }
  applyUses(r);
  state.styles = r.styles || [];
  await loadProjects();
}

$("#btn-reload-projects").addEventListener("click", loadProjects);
$("#btn-add-root").addEventListener("click", async () => {
  const r = await state.api.add_draft_root();
  if (r.ok && r.projects) {
    applyUses(r);
    state.projects = r.projects;
    $("#capcut-warn").classList.toggle("hidden", !r.capcut_running);
    renderProjects();
  }
});
$("#btn-start-transcribe").addEventListener("click", startTranscribe);
$("#btn-back-projects").addEventListener("click", () => gotoStep(1));
$("#btn-back-script").addEventListener("click", () => gotoStep(3));
$("#script-editor").addEventListener("input", updateLineCount);
$("#btn-build-blocks").addEventListener("click", buildBlocks);
bindSegmented("#seg-size", "size");
bindSegmented("#seg-position", "position");
$("#btn-inject").addEventListener("click", requestInject);
$("#btn-confirm-cancel").addEventListener("click", () => $("#confirm-overlay").classList.add("hidden"));
$("#btn-confirm-inject").addEventListener("click", doInject);
$("#btn-new-job").addEventListener("click", () => {
  $("#done-overlay").classList.add("hidden");
  state.selectedProject = null;
  state.lineCount = 0;
  $("#script-editor").value = "";
  $("#start-bar").classList.add("hidden");
  gotoStep(1);
  loadProjects();
});
$("#btn-quiz-cancel").addEventListener("click", () => $("#quiz-overlay").classList.add("hidden"));
$("#btn-quiz-submit").addEventListener("click", submitQuiz);
$("#quiz-answer").addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitQuiz();
});

boot();
