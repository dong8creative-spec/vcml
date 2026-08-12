"use strict";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const app = {
  api: null,
  auth: { logged_in: false },
  step: 1,
  unlocked: new Set([1]),
  projects: [],
  project: null,
  sequence: null,
  blocks: [],
  playing: null,
  busy: false,
  languages: [],
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function toast(message, type = "") {
  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.textContent = message;
  $("#toast-root").appendChild(item);
  setTimeout(() => {
    item.style.opacity = "0";
    item.style.transition = "opacity .25s ease";
  }, 2600);
  setTimeout(() => item.remove(), 2900);
}

function errorText(error, fallback = "요청을 처리하지 못했어요.") {
  return error?.message || error?.error || String(error || fallback);
}

function responseOk(response) {
  return response !== false && response?.ok !== false;
}

function formatDuration(value) {
  if (typeof value === "string" && value.trim()) return value;
  const us = Number(value) || 0;
  const seconds = Math.max(0, Math.round(us / 1_000_000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
}

function formatTime(us) {
  const totalMs = Math.max(0, Math.round((Number(us) || 0) / 1000));
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function parseTime(value) {
  const match = String(value).trim().match(/^(\d+):([0-5]?\d)(?:[.,](\d{1,3}))?$/);
  if (!match) return null;
  const milliseconds = Number((match[3] || "").padEnd(3, "0"));
  return (Number(match[1]) * 60 + Number(match[2])) * 1_000_000 + milliseconds * 1000;
}

function sequenceFrom(source) {
  if (!source) return null;
  const durationUs = Number(source.duration_us) || 0;
  return {
    ...source,
    name: source.name || "이름 없는 시퀀스",
    duration_us: durationUs,
    duration: source.duration || source.duration_text || formatDuration(durationUs),
    estimated_coins: Number(source.estimated_coins ?? source.coins) || Math.max(1, Math.ceil(durationUs / 30_000_000)),
  };
}

function renderAuth() {
  const loggedIn = Boolean(app.auth?.logged_in);
  $("#login-gate").classList.toggle("hidden", loggedIn);
  $("#app-shell").classList.toggle("hidden", !loggedIn);
  if (!loggedIn) {
    $("#login-idle").classList.remove("hidden");
    $("#login-pending").classList.add("hidden");
    return;
  }
  $("#account-name").textContent = app.auth.user_name || app.auth.name || app.auth.email || "사용자";
  $("#account-balance").textContent = app.auth.balance ?? app.auth.coins ?? "—";
}

function renderNavigation() {
  $$("#step-nav .step").forEach((button) => {
    const number = Number(button.dataset.step);
    button.classList.toggle("active", number === app.step);
    button.classList.toggle("done", app.unlocked.has(number) && number !== app.step);
    button.disabled = !app.unlocked.has(number) || number === 2 || app.busy;
    button.tabIndex = button.disabled ? -1 : 0;
  });
}

function goToStep(step, unlock = true) {
  if (unlock) app.unlocked.add(step);
  app.step = step;
  $$(".view").forEach((view) => view.classList.add("hidden"));
  $(`#view-${step}`).classList.remove("hidden");
  renderNavigation();
  if (step === 3) updateLineCount();
  if (step === 4) renderBlocks();
}

function renderProjects() {
  const grid = $("#project-grid");
  grid.innerHTML = "";
  $("#project-empty").classList.toggle("hidden", app.projects.length > 0);
  for (const project of app.projects) {
    const button = document.createElement("button");
    button.className = `project-card${app.project?.path === project.path ? " selected" : ""}`;
    button.innerHTML = `
      <span class="pr-badge">Pr</span>
      <span class="project-card-copy">
        <b title="${escapeHtml(project.path)}">${escapeHtml(project.name)}</b>
        <small>${escapeHtml(project.path)}</small>
      </span>
      <span class="project-open">선택 →</span>`;
    button.addEventListener("click", () => selectProject(project.index));
    grid.appendChild(button);
  }
}

function renderSequencePanel() {
  const panel = $("#sequence-panel");
  const sequences = app.project?.sequences || [];
  panel.classList.toggle("hidden", !sequences.length);
  $("#btn-transcribe").disabled = !app.sequence || app.busy;
  if (!sequences.length) return;
  $("#sequence-select").innerHTML = sequences.map((sequence) =>
    `<option value="${sequence.index}">${escapeHtml(sequence.name)}</option>`
  ).join("");
  $("#sequence-select").value = String(app.sequence?.index ?? sequences[0].index);
  $("#sequence-duration").textContent = app.sequence?.duration || "—";
  $("#media-coins").textContent = app.sequence?.estimated_coins ?? "—";
}

async function loadProjects() {
  try {
    const response = await app.api.list_projects();
    if (!responseOk(response)) throw new Error(response?.error);
    app.projects = response.projects || [];
    renderProjects();
  } catch (error) {
    toast(errorText(error, "프로젝트를 찾지 못했어요."), "error");
  }
}

async function selectProject(index) {
  if (app.busy) return;
  try {
    const response = await app.api.select_project(index);
    if (!responseOk(response)) throw new Error(response?.error);
    app.project = response.project;
    const listProject = app.projects.find((project) => project.index === index);
    if (listProject) Object.assign(listProject, response.project);
    renderProjects();
    if (!(app.project.sequences || []).length) {
      app.sequence = null;
      renderSequencePanel();
      toast("이 프로젝트에서 지원되는 시퀀스를 찾지 못했어요.", "warn");
      return;
    }
    await selectSequence(app.project.sequences[0].index);
  } catch (error) {
    toast(errorText(error, "프로젝트를 열지 못했어요."), "error");
  }
}

async function selectSequence(index) {
  try {
    const response = await app.api.select_sequence(Number(index));
    if (!responseOk(response)) throw new Error(response?.error);
    app.sequence = sequenceFrom(response.sequence);
    renderSequencePanel();
    const warning = app.sequence.warnings?.[0];
    if (warning) toast(warning, "warn");
  } catch (error) {
    app.sequence = null;
    renderSequencePanel();
    toast(errorText(error, "시퀀스를 선택하지 못했어요."), "error");
  }
}

async function openProjectFile() {
  try {
    const response = await app.api.pick_project_file();
    if (response?.cancelled) return;
    if (!responseOk(response)) throw new Error(response?.error);
    const project = response.project;
    app.projects = [project, ...app.projects.filter((item) => item.path !== project.path)]
      .map((item, index) => ({ ...item, index }));
    app.project = { ...project, index: 0 };
    renderProjects();
    if (!(project.sequences || []).length) {
      app.sequence = null;
      renderSequencePanel();
      toast("이 프로젝트에서 지원되는 시퀀스를 찾지 못했어요.", "warn");
      return;
    }
    await selectSequence(project.sequences[0].index);
  } catch (error) {
    toast(errorText(error, "프리미어 프로젝트를 열지 못했어요."), "error");
  }
}

async function addProjectRoot() {
  try {
    const response = await app.api.add_project_root();
    if (response?.cancelled) return;
    if (!responseOk(response)) throw new Error(response?.error);
    app.projects = response.projects || [];
    renderProjects();
  } catch (error) {
    toast(errorText(error, "프로젝트 폴더를 등록하지 못했어요."), "error");
  }
}

function setProgress(ratio, message) {
  const safeRatio = Math.max(0, Math.min(1, Number(ratio) || 0));
  const percent = Math.round(safeRatio * 100);
  $("#progress-fill").style.width = `${percent}%`;
  $("#progress-percent").textContent = `${percent}%`;
  if (message) $("#progress-message").textContent = message;
}

async function startTranscription() {
  if (!app.project || !app.sequence || app.busy) return;
  app.busy = true;
  setProgress(0, "시퀀스 타임라인을 준비하는 중…");
  goToStep(2, false);
  try {
    const response = await app.api.start_transcribe($("#language-select").value);
    if (!responseOk(response)) throw new Error(response?.error);
  } catch (error) {
    app.busy = false;
    toast(errorText(error), "error");
    goToStep(1, false);
  }
}

function receiveScript(data) {
  app.busy = false;
  const payload = typeof data === "string" ? { text: data } : (data || {});
  $("#script-editor").value = payload.text || payload.script || "";
  if (payload.duration_us && app.sequence) {
    app.sequence.duration_us = Number(payload.duration_us);
    app.sequence.duration = formatDuration(payload.duration_us);
  }
  if (payload.auth) app.auth = payload.auth;
  if (payload.balance != null) app.auth = { ...app.auth, logged_in: true, balance: payload.balance };
  renderAuth();
  goToStep(3);
  if (payload.missing_files?.length) {
    toast(`원본 미디어 ${payload.missing_files.length}개를 읽지 못해 일부 구간이 무음일 수 있어요.`, "warn");
  } else if (payload.warnings?.length) {
    toast(payload.warnings[0], "warn");
  }
  toast("받아쓰기가 완료됐어요.", "success");
}

function updateLineCount() {
  const count = $("#script-editor").value.split(/\r?\n/).filter((line) => line.trim()).length;
  $("#line-count").textContent = count;
  $("#btn-build").disabled = count === 0 || app.busy;
}

async function buildBlocks() {
  const text = $("#script-editor").value.trim();
  if (!text || app.busy) return;
  app.busy = true;
  $("#btn-build").disabled = true;
  $("#btn-build").textContent = "자막 블록 만드는 중…";
  try {
    const response = await app.api.build_blocks(text);
    if (!responseOk(response)) throw new Error(response?.error);
    app.blocks = Array.isArray(response) ? response : (response.blocks || []);
    if (response.auth) app.auth = response.auth;
    if (response.balance != null) app.auth = { ...app.auth, logged_in: true, balance: response.balance };
    renderAuth();
    if (!app.blocks.length) throw new Error("생성된 자막 블록이 없어요.");
    goToStep(4);
    toast("자막 블록을 만들었어요. 2코인이 사용됐습니다.", "success");
  } catch (error) {
    toast(errorText(error), "error");
  } finally {
    app.busy = false;
    $("#btn-build").textContent = "2코인으로 자막 블록 만들기 →";
    updateLineCount();
    renderNavigation();
  }
}

function renderBlocks() {
  const list = $("#block-list");
  list.innerHTML = "";
  $("#review-count").textContent = app.blocks.length;
  app.blocks.forEach((block, index) => {
    const row = document.createElement("article");
    row.className = `caption-block${app.playing === index ? " playing" : ""}`;
    row.innerHTML = `
      <span class="block-number">${String(index + 1).padStart(2, "0")}</span>
      <div class="times">
        <input class="time-input start" aria-label="${index + 1}번 자막 시작 시간" value="${formatTime(block.start_us)}">
        <span class="time-sep">–</span>
        <input class="time-input end" aria-label="${index + 1}번 자막 종료 시간" value="${formatTime(block.end_us)}">
      </div>
      <input class="caption-text" aria-label="${index + 1}번 자막 내용" value="${escapeHtml(block.text)}">
      <div class="block-actions">
        <button class="preview" title="이 구간 미리 듣기" aria-label="이 구간 미리 듣기">${app.playing === index ? "■" : "▶"}</button>
        <button class="delete" title="자막 블록 삭제" aria-label="자막 블록 삭제">✕</button>
      </div>`;

    const startInput = row.querySelector(".start");
    const endInput = row.querySelector(".end");
    startInput.addEventListener("change", () => {
      const parsed = parseTime(startInput.value);
      if (parsed === null || parsed >= Number(block.end_us)) {
        startInput.value = formatTime(block.start_us);
        toast("시작 시간은 종료 시간보다 빨라야 해요.", "warn");
        return;
      }
      block.start_us = parsed;
      startInput.value = formatTime(parsed);
    });
    endInput.addEventListener("change", () => {
      const parsed = parseTime(endInput.value);
      if (parsed === null || parsed <= Number(block.start_us)) {
        endInput.value = formatTime(block.end_us);
        toast("종료 시간은 시작 시간보다 늦어야 해요.", "warn");
        return;
      }
      block.end_us = parsed;
      endInput.value = formatTime(parsed);
    });
    row.querySelector(".caption-text").addEventListener("input", (event) => {
      block.text = event.target.value;
    });
    row.querySelector(".preview").addEventListener("click", () => togglePreview(index));
    row.querySelector(".delete").addEventListener("click", async () => {
      if (app.playing === index) await stopPreview();
      app.blocks.splice(index, 1);
      renderBlocks();
    });
    list.appendChild(row);
  });
}

async function stopPreview() {
  try { await app.api.preview_stop(); } catch (_) { /* Stop is best effort. */ }
  app.playing = null;
}

async function togglePreview(index) {
  if (app.playing === index) {
    await stopPreview();
    renderBlocks();
    return;
  }
  await stopPreview();
  const block = app.blocks[index];
  try {
    const response = await app.api.preview_play(block.start_us, block.end_us);
    if (!responseOk(response)) throw new Error(response?.error);
    app.playing = index;
    renderBlocks();
    const duration = Math.max(250, (Number(block.end_us) - Number(block.start_us)) / 1000);
    setTimeout(() => {
      if (app.playing === index) {
        app.playing = null;
        renderBlocks();
      }
    }, duration + 120);
  } catch (error) {
    toast(errorText(error, "미리 듣기를 시작하지 못했어요."), "warn");
  }
}

async function exportSrt() {
  if (!app.blocks.length) {
    toast("내보낼 자막 블록이 없어요.", "warn");
    return;
  }
  try {
    const response = await app.api.export_srt(app.blocks);
    if (response?.cancelled) return;
    if (!responseOk(response)) throw new Error(response?.error);
    toast(response?.path ? `SRT를 저장했어요: ${response.path}` : "SRT를 저장했어요.", "success");
  } catch (error) {
    toast(errorText(error, "SRT를 저장하지 못했어요."), "error");
  }
}

async function resetJob() {
  await stopPreview();
  try {
    const response = await app.api.reset_job();
    if (!responseOk(response)) throw new Error(response?.error);
  } catch (error) {
    toast(errorText(error, "새 작업을 시작하지 못했어요."), "error");
    return;
  }
  app.project = null;
  app.sequence = null;
  app.blocks = [];
  app.busy = false;
  app.unlocked = new Set([1]);
  $("#script-editor").value = "";
  renderProjects();
  renderSequencePanel();
  goToStep(1);
}

async function startLogin() {
  $("#login-error").classList.add("hidden");
  $("#login-idle").classList.add("hidden");
  $("#login-pending").classList.remove("hidden");
  $("#login-code").textContent = "······";
  $("#login-status").textContent = "로그인 페이지를 준비하고 있어요…";
  try {
    const response = await app.api.start_login();
    if (!responseOk(response)) throw new Error(response?.error);
  } catch (error) {
    showLoginError(errorText(error));
  }
}

function showLoginError(message) {
  $("#login-idle").classList.remove("hidden");
  $("#login-pending").classList.add("hidden");
  $("#login-error").textContent = message;
  $("#login-error").classList.remove("hidden");
}

async function refreshAccount(showToast = true) {
  try {
    const response = await app.api.refresh_me();
    if (!responseOk(response)) throw new Error(response?.error);
    app.auth = response.auth || response.me || { ...app.auth, ...response, logged_in: true };
    renderAuth();
    if (showToast) toast("잔액을 새로고침했어요.", "success");
  } catch (error) {
    toast(errorText(error, "계정 정보를 불러오지 못했어요."), "warn");
  }
}

async function openHistory() {
  $("#account-menu").classList.add("hidden");
  $("#history-overlay").classList.remove("hidden");
  const list = $("#history-list");
  list.innerHTML = '<p class="muted">불러오는 중…</p>';
  try {
    const response = await app.api.fetch_history();
    if (!responseOk(response)) throw new Error(response?.error);
    const history = response.history || response.items || [];
    if (!history.length) {
      list.innerHTML = '<p class="muted">아직 코인 사용 내역이 없어요.</p>';
      return;
    }
    const labels = {
      initial: "기본 코인 지급", daily_login: "로그인 코인 지급", consume: "음성 받아쓰기",
      transcription: "음성 받아쓰기", line_split: "문단 나누기", refund: "작업 실패 환불",
      line_split_refund: "문단 나누기 환불",
    };
    list.innerHTML = history.map((item) => {
      const delta = Number(item.delta ?? item.amount ?? 0);
      const description = item.description || labels[item.reason] || item.reason || item.type || "코인 내역";
      const date = item.created_at || item.when || item.date || "";
      return `<div class="history-row">
        <span class="date">${escapeHtml(date)}</span>
        <span>${escapeHtml(description)}</span>
        <span class="delta ${delta >= 0 ? "plus" : "minus"}">${delta > 0 ? "+" : ""}${delta}</span>
      </div>`;
    }).join("");
  } catch (error) {
    list.innerHTML = `<p class="error">${escapeHtml(errorText(error))}</p>`;
  }
}

function bindEvents() {
  $("#btn-open-project").addEventListener("click", openProjectFile);
  $("#btn-reload-projects").addEventListener("click", loadProjects);
  $("#btn-add-root").addEventListener("click", addProjectRoot);
  $("#sequence-select").addEventListener("change", (event) => selectSequence(event.target.value));
  $("#btn-transcribe").addEventListener("click", startTranscription);
  $("#script-editor").addEventListener("input", updateLineCount);
  $("#btn-build").addEventListener("click", buildBlocks);
  $("#btn-back-editor").addEventListener("click", () => goToStep(3, false));
  $("#btn-export").addEventListener("click", exportSrt);
  $("#btn-reset").addEventListener("click", resetJob);
  $("#btn-login").addEventListener("click", startLogin);
  $("#btn-login-cancel").addEventListener("click", async () => {
    await app.api.cancel_login();
    $("#login-idle").classList.remove("hidden");
    $("#login-pending").classList.add("hidden");
  });
  $("#btn-account").addEventListener("click", (event) => {
    event.stopPropagation();
    $("#account-menu").classList.toggle("hidden");
  });
  $("#account-menu").addEventListener("click", (event) => event.stopPropagation());
  document.addEventListener("click", () => $("#account-menu").classList.add("hidden"));
  $("#btn-refresh").addEventListener("click", () => {
    $("#account-menu").classList.add("hidden");
    refreshAccount();
  });
  $("#btn-history").addEventListener("click", openHistory);
  $("#btn-history-close").addEventListener("click", () => $("#history-overlay").classList.add("hidden"));
  $("#history-overlay").addEventListener("click", (event) => {
    if (event.target === $("#history-overlay")) $("#history-overlay").classList.add("hidden");
  });
  $("#btn-logout").addEventListener("click", async () => {
    const response = await app.api.logout();
    app.auth = response?.auth || { logged_in: false };
    $("#account-menu").classList.add("hidden");
    renderAuth();
  });
  $$("#step-nav .step").forEach((button) => button.addEventListener("click", () => {
    const step = Number(button.dataset.step);
    if (!button.disabled && app.unlocked.has(step)) goToStep(step, false);
  }));
  window.addEventListener("beforeunload", () => {
    try { app.api?.cleanup?.(); } catch (_) { /* Window is closing. */ }
  });
}

window.__pyEvent = (message) => {
  const event = message?.event;
  const data = message?.data;
  switch (event) {
    case "auth":
      app.auth = data || { logged_in: false };
      renderAuth();
      if (app.auth.logged_in) refreshAccount(false);
      break;
    case "login_code":
      $("#login-code").textContent = data?.code || data || "······";
      break;
    case "login_status":
      $("#login-status").textContent = data?.message || data || "로그인 확인 중…";
      break;
    case "login_error":
      showLoginError(data?.message || data || "로그인하지 못했어요.");
      break;
    case "progress":
      $("#progress-message").textContent = data?.message || data || "처리 중…";
      break;
    case "progress_ratio":
      setProgress(data?.ratio ?? data?.progress ?? data, data?.message);
      break;
    case "script_ready":
      setProgress(1, "받아쓰기가 완료됐어요.");
      receiveScript(data);
      break;
    case "transcribe_error":
      app.busy = false;
      toast(data?.message || data || "받아쓰기에 실패했어요.", "error");
      goToStep(1, false);
      break;
  }
};

function makeMockApi(loginRequired = false) {
  const emit = (event, data, delay = 0) => setTimeout(() => window.__pyEvent({ event, data }), delay);
  let auth = loginRequired
    ? { logged_in: false }
    : { logged_in: true, user_name: "김훈민", email: "demo@hunminsync.kr", balance: 148 };
  const script = "안녕하세요. 훈민정음 싱크를 시작합니다.\n영상의 말소리를 글로 옮긴 뒤 Enter로 자막 문단을 나눠 보세요.\n완성된 자막은 SRT 파일로 저장할 수 있습니다.";
  let timerIds = [];
  return {
    get_state: async () => ({
      ok: true,
      auth,
      languages: [
        { value: "auto", label: "자동 감지" },
        { value: "ko", label: "한국어" },
        { value: "en", label: "영어" },
        { value: "ja", label: "일본어" },
        { value: "zh", label: "중국어" },
      ],
    }),
    start_login: async () => {
      emit("login_code", { code: "HM2026" }, 250);
      emit("login_status", { message: "브라우저에서 로그인한 뒤 잠시 기다려 주세요." }, 350);
      auth = { logged_in: true, user_name: "김훈민", email: "demo@hunminsync.kr", balance: 148 };
      emit("auth", auth, 1200);
      return { ok: true };
    },
    cancel_login: async () => ({ ok: true }),
    logout: async () => {
      auth = { logged_in: false };
      return { ok: true, auth };
    },
    refresh_me: async () => ({ ok: true, auth }),
    fetch_history: async () => ({
      ok: true,
      history: [
        { created_at: "2026-08-01 14:21", description: "인터뷰 영상 받아쓰기", delta: -7 },
        { created_at: "2026-07-31 18:04", description: "문단 나누기", delta: -2 },
        { created_at: "2026-07-30 09:12", description: "기본 코인 지급", delta: 100 },
      ],
    }),
    list_projects: async () => ({
      ok: true,
      projects: [
        { index: 0, name: "브랜드 인터뷰", path: "/Users/demo/Documents/브랜드 인터뷰.prproj" },
        { index: 1, name: "온라인 강의 03", path: "/Users/demo/Documents/온라인 강의 03.prproj" },
      ],
    }),
    select_project: async (index) => ({
      ok: true,
      project: {
        index,
        name: index ? "온라인 강의 03" : "브랜드 인터뷰",
        path: index ? "/Users/demo/Documents/온라인 강의 03.prproj" : "/Users/demo/Documents/브랜드 인터뷰.prproj",
        sequences: [
          { index: 0, name: "인터뷰 최종본", duration_us: 187_000_000, duration: "3:07", estimated_coins: 7, clip_count: 6 },
          { index: 1, name: "세로형 숏폼", duration_us: 58_000_000, duration: "0:58", estimated_coins: 2, clip_count: 4 },
        ],
      },
    }),
    pick_project_file: async () => ({
      ok: true,
      project: {
        index: 0, name: "브랜드 인터뷰", path: "/Users/demo/Documents/브랜드 인터뷰.prproj",
        sequences: [{ index: 0, name: "인터뷰 최종본", duration_us: 187_000_000, duration: "3:07", estimated_coins: 7 }],
      },
    }),
    add_project_root: async () => ({
      ok: true,
      projects: [{ index: 0, name: "브랜드 인터뷰", path: "/Users/demo/Documents/브랜드 인터뷰.prproj" }],
    }),
    select_sequence: async (index) => ({
      ok: true,
      sequence: {
        index, name: index ? "세로형 숏폼" : "인터뷰 최종본",
        duration_us: index ? 58_000_000 : 187_000_000,
        duration: index ? "0:58" : "3:07", estimated_coins: index ? 2 : 7,
      },
    }),
    start_transcribe: async () => {
      emit("progress", { message: "미디어에서 음성을 준비하고 있어요…" }, 250);
      [0.12, 0.28, 0.46, 0.68, 0.84, 1].forEach((ratio, index) => {
        timerIds.push(setTimeout(() => window.__pyEvent({
          event: "progress_ratio",
          data: { ratio, message: ratio < .8 ? "음성을 분석하고 있어요…" : "대본을 정리하고 있어요…" },
        }), 550 + index * 430));
      });
      timerIds.push(setTimeout(() => window.__pyEvent({
        event: "script_ready", data: { text: script, duration_us: 187_000_000 },
      }), 3300));
      return { ok: true };
    },
    build_blocks: async (text) => {
      const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      let cursor = 0;
      const blocks = lines.map((line) => {
        const duration = Math.max(1_800_000, line.length * 105_000);
        const block = { start_us: cursor, end_us: cursor + duration, text: line };
        cursor += duration + 180_000;
        return block;
      });
      auth = { ...auth, balance: Math.max(0, Number(auth.balance || 0) - 2) };
      return { ok: true, blocks, auth };
    },
    preview_play: async () => ({ ok: true }),
    preview_stop: async () => ({ ok: true }),
    export_srt: async () => ({ ok: true, path: "/Users/demo/Desktop/브랜드_인터뷰_최종.srt" }),
    reset_job: async () => ({ ok: true }),
    cleanup: async () => {
      timerIds.forEach(clearTimeout);
      timerIds = [];
      return { ok: true };
    },
  };
}

function renderLanguages(languages) {
  const normalized = (languages?.length ? languages : [
    { value: "auto", label: "자동 감지" }, { value: "ko", label: "한국어" }, { value: "en", label: "영어" },
  ]).map((language) => typeof language === "string"
    ? { value: language, label: language }
    : { value: language.value ?? language.code ?? language.label, label: language.label ?? language.name ?? language.value });
  app.languages = normalized;
  $("#language-select").innerHTML = normalized.map((language) =>
    `<option value="${escapeHtml(language.value)}"${language.value === "ko" || language.label === "한국어" ? " selected" : ""}>${escapeHtml(language.label)}</option>`
  ).join("");
}

async function initialize() {
  try {
    const state = await app.api.get_state();
    if (!responseOk(state)) throw new Error(state?.error);
    app.auth = state.auth || state.me || { logged_in: false };
    renderLanguages(state.languages);
    if (state.project) app.project = state.project;
    if (state.sequence) app.sequence = sequenceFrom(state.sequence);
    if (Array.isArray(state.blocks)) app.blocks = state.blocks;
    renderProjects();
    renderSequencePanel();
    renderAuth();
    goToStep(1);
    if (app.auth.logged_in) {
      refreshAccount(false);
      loadProjects();
    }
  } catch (error) {
    showLoginError(errorText(error, "앱을 시작하지 못했어요."));
    $("#login-gate").classList.remove("hidden");
  }
}

function boot() {
  bindEvents();
  const params = new URLSearchParams(location.search);
  const explicitMock = params.has("mock");
  if (explicitMock) {
    app.api = makeMockApi(params.get("mock") === "login");
    document.title += " · Mock";
    initialize();
    return;
  }
  if (window.pywebview?.api) {
    app.api = window.pywebview.api;
    initialize();
    return;
  }
  let booted = false;
  const useRealApi = () => {
    if (booted || !window.pywebview?.api) return;
    booted = true;
    app.api = window.pywebview.api;
    initialize();
  };
  window.addEventListener("pywebviewready", useRealApi, { once: true });
  let attempts = 0;
  const poll = setInterval(() => {
    if (booted) {
      clearInterval(poll);
      return;
    }
    if (window.pywebview?.api) {
      clearInterval(poll);
      useRealApi();
      return;
    }
    attempts += 1;
    if (attempts >= 60) {
      clearInterval(poll);
      booted = true;
      app.api = makeMockApi(false);
      document.title += " · Mock";
      initialize();
    }
  }, 100);
}

boot();
