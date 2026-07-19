/* 단어·스타일 편집 — 별도 pywebview 창 */

"use strict";

const $ = (sel) => document.querySelector(sel);

const editorState = {
  api: null,
  blocks: [],
  blocksUndo: null,
  keywordScan: null,
  highlightColor: "#ffef3b",
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

function normalizeColor(color) {
  const s = String(color || "").trim();
  const m = s.match(/^#?([0-9a-fA-F]{6})$/);
  return m ? `#${m[1].toLowerCase()}` : "#ffef3b";
}

function emphasisBoldWidth() {
  const size = $("#kw-emphasis-size")?.value || "medium";
  if (size === "large") return 0.018;
  if (size === "medium") return 0.01;
  return 0.006;
}

function getKeywordStyleOptions() {
  const useColor = $("#kw-use-color").checked;
  const useBold = $("#kw-use-bold").checked;
  const useItalic = $("#kw-use-italic").checked;
  const emphasis = $("#kw-emphasis-size")?.value || "medium";
  const boldFromSize = emphasis !== "normal";
  return {
    useColor,
    useBold: useBold || boldFromSize,
    useItalic,
    boldWidth: (useBold || boldFromSize) ? emphasisBoldWidth() : null,
    italicDegree: useItalic ? Number($("#kw-italic-degree").value) : null,
  };
}

function renderKeywordSummary(scan) {
  const el = $("#keyword-summary");
  const applyBtn = $("#btn-keyword-apply");
  if (!scan || !scan.count) {
    el.textContent = scan ? "일치하는 단어가 없어요." : "키워드를 검색해 주세요.";
    applyBtn.disabled = true;
    return;
  }
  el.textContent = `총 ${scan.count}회 · ${scan.block_count}개 블록`;
  applyBtn.disabled = false;
}

function renderKeywordPreview(scan) {
  const list = $("#keyword-preview");
  if (!scan || !scan.matches || !scan.matches.length) {
    list.classList.add("hidden");
    list.innerHTML = "";
    return;
  }
  list.classList.remove("hidden");
  const show = scan.matches.slice(0, 50);
  list.innerHTML = show.map((m) =>
    `<li>#${m.block_index + 1} · …${esc(m.snippet)}…</li>`).join("")
    + (scan.matches.length > 50 ? `<li>외 ${scan.matches.length - 50}건</li>` : "");
}

async function commitBlocks(blocks) {
  editorState.blocks = blocks;
  const res = await editorState.api.push_editor_blocks(blocks);
  if (!res.ok) toast(res.error || "메인 화면 동기화에 실패했어요.", "error");
}

async function scanKeyword() {
  const keyword = $("#keyword-input").value.trim();
  if (!keyword) { toast("키워드를 입력해 주세요.", "warn"); return; }
  const mode = $("#keyword-mode").value;
  const res = await editorState.api.scan_keyword(editorState.blocks, keyword, mode);
  if (!res.ok) { toast(res.error, "error"); return; }
  editorState.keywordScan = res;
  renderKeywordSummary(res);
  renderKeywordPreview(res);
}

async function applyKeywordHighlight() {
  const keyword = $("#keyword-input").value.trim();
  if (!keyword) { toast("키워드를 입력해 주세요.", "warn"); return; }
  if (!editorState.keywordScan || !editorState.keywordScan.count) {
    await scanKeyword();
    if (!editorState.keywordScan || !editorState.keywordScan.count) return;
  }
  editorState.blocksUndo = JSON.parse(JSON.stringify(editorState.blocks));
  const opts = getKeywordStyleOptions();
  if (!opts.useColor && !opts.useBold && !opts.useItalic) {
    toast("색상·크기·굵기·기울기 중 하나 이상을 선택해 주세요.", "warn");
    return;
  }
  const res = await editorState.api.apply_keyword_highlight(
    editorState.blocks,
    keyword,
    $("#keyword-mode").value,
    opts.useColor ? editorState.highlightColor : null,
    opts.useBold || null,
    opts.boldWidth,
    opts.useItalic || null,
    opts.italicDegree,
  );
  if (!res.ok) { toast(res.error, "error"); return; }
  await commitBlocks(res.blocks);
  toast(`${res.applied || res.count}곳에 스타일을 적용했어요.`, "success");
}

async function replaceKeywordText() {
  const keyword = $("#keyword-input").value.trim();
  if (!keyword) { toast("키워드를 입력해 주세요.", "warn"); return; }
  if (!editorState.keywordScan || !editorState.keywordScan.count) {
    await scanKeyword();
    if (!editorState.keywordScan || !editorState.keywordScan.count) return;
  }
  editorState.blocksUndo = JSON.parse(JSON.stringify(editorState.blocks));
  const replacement = $("#keyword-replace").value;
  const res = await editorState.api.replace_keyword_text(
    editorState.blocks, keyword, replacement, $("#keyword-mode").value);
  if (!res.ok) { toast(res.error, "error"); return; }
  editorState.keywordScan = null;
  renderKeywordSummary(null);
  renderKeywordPreview(null);
  await commitBlocks(res.blocks);
  toast(`${res.replaced || 0}곳의 단어를 수정했어요.`, "success");
}

async function clearKeywordHighlight() {
  const keyword = $("#keyword-input").value.trim();
  if (!keyword) { toast("키워드를 입력해 주세요.", "warn"); return; }
  const res = await editorState.api.clear_keyword_highlight(
    editorState.blocks, keyword, $("#keyword-mode").value);
  if (!res.ok) { toast(res.error, "error"); return; }
  await commitBlocks(res.blocks);
  toast("키워드 강조를 해제했어요.", "success");
}

async function undoKeywordApply() {
  if (!editorState.blocksUndo) { toast("되돌릴 변경이 없어요.", "warn"); return; }
  const blocks = editorState.blocksUndo;
  editorState.blocksUndo = null;
  await commitBlocks(blocks);
  toast("이전 상태로 되돌렸어요.", "success");
}

function applyEditorState(data) {
  editorState.blocks = JSON.parse(JSON.stringify(data?.blocks || []));
  const color = normalizeColor(data?.config?.highlightColor);
  editorState.highlightColor = color;
  const colorEl = $("#highlight-color");
  if (colorEl) colorEl.value = color;
}

async function loadEditorState() {
  const res = await editorState.api.get_editor_state();
  if (!res.ok) {
    toast(res.error || "편집 데이터를 불러오지 못했어요.", "error");
    return;
  }
  applyEditorState(res);
}

async function closeEditorWindow() {
  const res = await editorState.api.close_style_editor_window();
  if (!res.ok) toast(res.error, "error");
}

window.__pyEvent = (msg) => {
  const { event, data } = msg || {};
  if (event === "blocks_synced" && data?.blocks) {
    applyEditorState({ blocks: data.blocks, config: { highlightColor: editorState.highlightColor } });
    editorState.keywordScan = null;
    renderKeywordSummary(null);
    renderKeywordPreview(null);
  }
};

function bindEvents() {
  $("#btn-style-editor-close").addEventListener("click", closeEditorWindow);
  $("#btn-keyword-scan").addEventListener("click", scanKeyword);
  $("#btn-keyword-apply").addEventListener("click", applyKeywordHighlight);
  $("#btn-keyword-clear").addEventListener("click", clearKeywordHighlight);
  $("#btn-keyword-undo").addEventListener("click", undoKeywordApply);
  $("#btn-keyword-replace").addEventListener("click", replaceKeywordText);
  $("#keyword-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); scanKeyword(); }
  });
  $("#highlight-color")?.addEventListener("input", (e) => {
    editorState.highlightColor = normalizeColor(e.target.value);
  });
}

function boot() {
  bindEvents();
  loadEditorState();
}

function startBoot() {
  if (window.pywebview && window.pywebview.api) {
    editorState.api = window.pywebview.api;
    boot();
    return;
  }

  let booted = false;
  const bootReal = () => {
    if (booted) return;
    booted = true;
    editorState.api = window.pywebview.api;
    boot();
  };
  window.addEventListener("pywebviewready", bootReal);

  let tries = 0;
  const poll = setInterval(() => {
    if (booted) { clearInterval(poll); return; }
    if (window.pywebview && window.pywebview.api) {
      clearInterval(poll);
      bootReal();
      return;
    }
    tries += 1;
    if (tries >= 100) clearInterval(poll);
  }, 150);
}

startBoot();
