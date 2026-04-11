(function () {
  var params = new URLSearchParams(window.location.search);
  var jobId = params.get("job");
  var loadError = document.getElementById("loadError");
  var editorMain = document.getElementById("editorMain");
  var metaLine = document.getElementById("metaLine");
  var cueBody = document.getElementById("cueBody");
  var previewSection = document.getElementById("previewSection");
  var previewVideo = document.getElementById("previewVideo");
  var previewAudio = document.getElementById("previewAudio");
  var subOverlayWrap = document.getElementById("subOverlayWrap");
  var subOverlay = document.getElementById("subOverlay");
  var cueTimeline = document.getElementById("cueTimeline");
  var replaceFind = document.getElementById("replaceFind");
  var replaceWith = document.getElementById("replaceWith");
  var btnReplaceAll = document.getElementById("btnReplaceAll");
  var replaceCountEl = document.getElementById("replaceCount");
  var editTimingDock = document.getElementById("editTimingDock");
  var dockBtnPlay = document.getElementById("dockBtnPlay");
  var dockBtnMute = document.getElementById("dockBtnMute");
  var dockBtnUndo = document.getElementById("dockBtnUndo");
  var dockBtnRedo = document.getElementById("dockBtnRedo");
  var dockBtnSaveSubtitle = document.getElementById("dockBtnSaveSubtitle");
  var dockSeek = document.getElementById("dockSeek");
  var dockMediaTime = document.getElementById("dockMediaTime");
  var dockVolume = document.getElementById("dockVolume");
  var dockSeekDragging = false;
  var dockVolumeDragging = false;

  var state = { duration: 0, format: "srt", downloadBase: "subtitle" };
  var mediaWired = false;
  var timelineTimer = null;
  var timelineSuppressClick = false;
  var timelineDragStartX = 0;
  var timelineDragStartY = 0;
  var timelineResizeState = null;
  var TIMELINE_MIN_CUE_SEC = 0.03;
  /** 슬라이더 썸(재생 헤드) 근처 이 픽셀 안이면 블록 경계가 시간에 스냅 */
  var TIMELINE_PLAYHEAD_MAGNET_PX = 22;
  var replaceCountTimer = null;
  var cueHistorySnaps = [];
  var cueHistoryIndex = 0;
  var cueHistoryInited = false;
  var cueHistoryApplying = false;
  var cueHistoryDebounce = null;
  /** 미리보기 자막 입력 중 동기화 대상 행(포커스 시점 큐) */
  var previewOverlaySourceTr = null;

  function updateDockHistoryButtons() {
    if (dockBtnUndo) {
      dockBtnUndo.disabled = !cueHistoryInited || cueHistoryIndex <= 0;
    }
    if (dockBtnRedo) {
      dockBtnRedo.disabled =
        !cueHistoryInited || cueHistoryIndex >= cueHistorySnaps.length - 1;
    }
    if (dockBtnSaveSubtitle) {
      dockBtnSaveSubtitle.disabled = !cueBody || !cueBody.querySelector("tr");
    }
  }

  /** innerHTML 스냅샷은 input/textarea의 현재 값을 잃으므로 구조화 상태만 저장 */
  function captureCueState() {
    return getRows().map(function (tr) {
      var inp = tr.querySelector(".cue-start");
      var ta = tr.querySelector(".cue-text");
      return {
        start: inp ? String(inp.value) : "0",
        text: ta ? String(ta.value) : "",
        blank: tr.dataset.cueBlank === "1",
      };
    });
  }

  function initCueHistory() {
    if (!cueBody) return;
    cueHistorySnaps = [JSON.parse(JSON.stringify(captureCueState()))];
    cueHistoryIndex = 0;
    cueHistoryInited = true;
    updateDockHistoryButtons();
  }

  function pushCueHistoryImmediate() {
    if (cueHistoryApplying || !cueHistoryInited || !cueBody) return;
    var snap = captureCueState();
    var encoded = JSON.stringify(snap);
    if (
      cueHistorySnaps.length &&
      encoded === JSON.stringify(cueHistorySnaps[cueHistoryIndex])
    ) {
      return;
    }
    cueHistorySnaps = cueHistorySnaps.slice(0, cueHistoryIndex + 1);
    cueHistorySnaps.push(JSON.parse(encoded));
    cueHistoryIndex = cueHistorySnaps.length - 1;
    while (cueHistorySnaps.length > 80) {
      cueHistorySnaps.shift();
      cueHistoryIndex--;
    }
    updateDockHistoryButtons();
  }

  function scheduleCueHistoryPush() {
    if (!cueHistoryInited) return;
    if (cueHistoryDebounce) clearTimeout(cueHistoryDebounce);
    cueHistoryDebounce = setTimeout(function () {
      cueHistoryDebounce = null;
      pushCueHistoryImmediate();
    }, 420);
  }

  function applyCueStateSnapshot(rows) {
    if (!cueBody) return;
    cueHistoryApplying = true;
    restoreCueStateFromData(rows);
    refreshEnds();
    scheduleTimelineRefresh();
    updateOverlayFromMedia();
    updateReplaceCountDisplay();
    cueHistoryApplying = false;
    updateDockHistoryButtons();
  }

  function undoCueHistory() {
    if (!cueHistoryInited || cueHistoryIndex <= 0) return;
    cueHistoryIndex--;
    applyCueStateSnapshot(cueHistorySnaps[cueHistoryIndex]);
  }

  function redoCueHistory() {
    if (!cueHistoryInited || cueHistoryIndex >= cueHistorySnaps.length - 1) return;
    cueHistoryIndex++;
    applyCueStateSnapshot(cueHistorySnaps[cueHistoryIndex]);
  }

  function updateMetaLine() {
    if (!metaLine) return;
    metaLine.textContent =
      "형식: " +
      state.format.toUpperCase() +
      " · 영상 길이 " +
      (Number(state.duration) || 0).toFixed(3) +
      "초 (마지막 자막 끝이 여기에 맞춰집니다)";
  }

  function setTimingDockVisible(show) {
    if (!editTimingDock) return;
    editTimingDock.classList.toggle("hidden", !show);
    if (document.body) document.body.classList.toggle("edit-timing-dock-active", !!show);
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function countOccurrencesInText(text, find, wholeToken, caseSensitive) {
    if (!find) return 0;
    if (wholeToken) {
      var parts = String(text).split(/(\s+)/);
      var n = 0;
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (/^\s+$/.test(p)) continue;
        var ok = caseSensitive ? p === find : p.toLowerCase() === find.toLowerCase();
        if (ok) n++;
      }
      return n;
    }
    var re = new RegExp(escapeRegExp(find), caseSensitive ? "g" : "gi");
    var m = String(text).match(re);
    return m ? m.length : 0;
  }

  function replaceInText(text, find, withStr, wholeToken, caseSensitive) {
    if (!find) return text;
    if (wholeToken) {
      return String(text)
        .split(/(\s+)/)
        .map(function (part) {
          if (/^\s+$/.test(part)) return part;
          var ok = caseSensitive ? part === find : part.toLowerCase() === find.toLowerCase();
          return ok ? withStr : part;
        })
        .join("");
    }
    var re = new RegExp(escapeRegExp(find), caseSensitive ? "g" : "gi");
    return String(text).replace(re, function () {
      return withStr;
    });
  }

  function getReplaceOptions() {
    return {
      find: replaceFind ? replaceFind.value : "",
      withStr: replaceWith ? replaceWith.value : "",
      wholeToken: false,
      caseSensitive: false,
    };
  }

  function updateReplaceCountDisplay() {
    if (!replaceCountEl) return;
    var o = getReplaceOptions();
    if (!o.find) {
      replaceCountEl.textContent = "";
      return;
    }
    var total = 0;
    getRows().forEach(function (tr) {
      var ta = tr.querySelector(".cue-text");
      if (!ta) return;
      total += countOccurrencesInText(ta.value, o.find, o.wholeToken, o.caseSensitive);
    });
    replaceCountEl.textContent = total ? "일치 " + total + "곳" : "일치 없음";
  }

  function scheduleReplaceCountUpdate() {
    if (!replaceCountEl) return;
    if (replaceCountTimer) clearTimeout(replaceCountTimer);
    replaceCountTimer = setTimeout(function () {
      replaceCountTimer = null;
      updateReplaceCountDisplay();
    }, 200);
  }

  function showErr(msg) {
    if (loadError) {
      loadError.textContent = msg;
      loadError.classList.remove("hidden");
    }
  }

  function formatClock(sec) {
    sec = Math.max(0, Number(sec) || 0);
    var ms = Math.round((sec % 1) * 1000);
    if (ms >= 1000) ms = 999;
    var t = Math.floor(sec);
    var s = t % 60;
    var m = Math.floor(t / 60) % 60;
    var h = Math.floor(t / 3600);
    var pad = function (n, w) {
      n = String(n);
      while (n.length < w) n = "0" + n;
      return n;
    };
    return pad(h, 2) + ":" + pad(m, 2) + ":" + pad(s, 2) + "." + pad(ms, 3);
  }

  function formatMediaShort(sec) {
    sec = Math.max(0, Number(sec) || 0);
    var t = Math.floor(sec);
    var s = t % 60;
    var m = Math.floor(t / 60) % 60;
    var h = Math.floor(t / 3600);
    function pad2(n) {
      return (n < 10 ? "0" : "") + n;
    }
    if (h > 0) return h + ":" + pad2(m) + ":" + pad2(s);
    return m + ":" + pad2(s);
  }

  function getRows() {
    if (!cueBody) return [];
    return Array.prototype.slice.call(cueBody.querySelectorAll("tr"));
  }

  function parseStart(tr) {
    var inp = tr.querySelector(".cue-start");
    var v = parseFloat(inp && inp.value);
    return isNaN(v) ? 0 : v;
  }

  function sortRows() {
    if (!cueBody) return;
    var rows = getRows();
    rows.sort(function (a, b) {
      return parseStart(a) - parseStart(b);
    });
    rows.forEach(function (r) {
      cueBody.appendChild(r);
    });
    refreshEnds();
    renumber();
    updateOverlayFromMedia();
  }

  function syncEndCells() {
    var rows = getRows();
    var dur = state.duration;
    for (var i = 0; i < rows.length; i++) {
      var endCell = rows[i].querySelector(".cue-end");
      if (!endCell) continue;
      var endVal = i + 1 < rows.length ? parseStart(rows[i + 1]) : dur;
      endCell.textContent = formatClock(endVal) + " (" + endVal.toFixed(3) + "s)";
    }
  }

  function refreshEnds() {
    syncEndCells();
    renderTimelineBlocks();
    updateDockTransportVisibility();
  }

  function scheduleTimelineRefresh() {
    if (!cueTimeline) return;
    if (timelineTimer) clearTimeout(timelineTimer);
    timelineTimer = setTimeout(function () {
      timelineTimer = null;
      renderTimelineBlocks();
    }, 120);
  }

  function timelineTotalSec() {
    var d = Number(state.duration) || 0;
    if (d > 0) return d;
    var rows = getRows();
    if (!rows.length) return 1;
    var last = parseStart(rows[rows.length - 1]);
    return Math.max(last + 0.5, 1);
  }

  /** 편집 러닝타임(초) — 미리보기 시크·타임라인과 동일 기준 */
  function getEditorRunDur() {
    var d = Number(state.duration) || 0;
    if (isFinite(d) && d > 0) return d;
    return timelineTotalSec();
  }

  /** 트랙의 화면상 박스 기준으로만 변환 — offsetLeft/스크롤 혼합 시 드래그 중 막대와 커서가 어긋남 */
  function clientXToRunTime(e) {
    if (!cueTimeline) return 0;
    var track = cueTimeline.querySelector(".cue-timeline-track");
    if (!track) return 0;
    var tr = track.getBoundingClientRect();
    var w = tr.width;
    var runDur = getEditorRunDur();
    if (w <= 0 || runDur <= 0) return 0;
    var x = e.clientX - tr.left;
    var t = (x / w) * runDur;
    if (t < 0) t = 0;
    if (t > runDur) t = runDur;
    return t;
  }

  function getPlayheadTimeForMagnet() {
    var m = getActiveMedia();
    if (!m || !m.src) return null;
    var ct = Number(m.currentTime);
    if (!isFinite(ct)) return null;
    var runDur = getEditorRunDur();
    if (runDur <= 0) return null;
    if (ct < 0) ct = 0;
    if (ct > runDur) ct = runDur;
    return ct;
  }

  function playheadMagnetWindowSec() {
    var runDur = getEditorRunDur();
    var track = cueTimeline && cueTimeline.querySelector(".cue-timeline-track");
    var w = track && track.offsetWidth > 0 ? track.offsetWidth : 1;
    if (runDur <= 0 || w <= 0) return 0.24;
    var sec = (TIMELINE_PLAYHEAD_MAGNET_PX / w) * runDur;
    if (sec < 0.13) sec = 0.13;
    if (sec > 0.4) sec = 0.4;
    return sec;
  }

  function snapBoundaryTowardPlayhead(rows, rowIndex, t, head) {
    if (head == null || !isFinite(head)) return { t: t, snapped: false };
    if (Math.abs(t - head) > playheadMagnetWindowSec()) return { t: t, snapped: false };
    var MIN = TIMELINE_MIN_CUE_SEC;
    var lo = parseStart(rows[rowIndex - 1]) + MIN;
    var hi =
      rowIndex + 1 < rows.length
        ? parseStart(rows[rowIndex + 1]) - MIN
        : getEditorRunDur() - MIN;
    if (lo > hi) return { t: t, snapped: false };
    if (head < lo || head > hi) return { t: t, snapped: false };
    return { t: head, snapped: true };
  }

  function cueDurationAtIndex(rows, i) {
    var start = parseStart(rows[i]);
    var end =
      i + 1 < rows.length
        ? parseStart(rows[i + 1])
        : Number(state.duration) || timelineTotalSec();
    return Math.max(0, end - start);
  }

  function clearTimelineDropTargets() {
    if (!cueTimeline) return;
    var blocks = cueTimeline.querySelectorAll(".cue-timeline-block--drop-target");
    for (var k = 0; k < blocks.length; k++) {
      blocks[k].classList.remove("cue-timeline-block--drop-target");
    }
  }

  function moveCueRow(fromIndex, toIndex) {
    if (!cueBody) return;
    var rows = getRows();
    var n = rows.length;
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= n || toIndex >= n) {
      return;
    }
    var durs = [];
    for (var i = 0; i < n; i++) {
      durs.push(cueDurationAtIndex(rows, i));
    }
    var t0 = parseStart(rows[0]);
    var arr = rows.slice();
    var moved = arr.splice(fromIndex, 1)[0];
    arr.splice(toIndex, 0, moved);
    var t = t0;
    for (var j = 0; j < arr.length; j++) {
      var tr = arr[j];
      var oldIdx = rows.indexOf(tr);
      tr.querySelector(".cue-start").value = t.toFixed(3);
      t += durs[oldIdx];
    }
    for (var a = 0; a < arr.length; a++) {
      cueBody.appendChild(arr[a]);
    }
    sortRows();
    pushCueHistoryImmediate();
  }

  function layoutTimelineResizeHandles() {
    if (!cueTimeline) return;
    var track = cueTimeline.querySelector(".cue-timeline-track");
    if (!track) return;
    var lead = track.querySelector(".cue-timeline-lead");
    var blocks = track.querySelectorAll(".cue-timeline-block");
    var handles = track.querySelectorAll(".cue-timeline-resize");
    var x = lead ? lead.offsetWidth : 0;
    for (var i = 0; i < blocks.length - 1; i++) {
      x += blocks[i].offsetWidth;
      if (handles[i]) handles[i].style.left = x + "px";
    }
  }

  function clampBoundaryStart(rows, rowIndex, t) {
    var MIN = TIMELINE_MIN_CUE_SEC;
    var lo = parseStart(rows[rowIndex - 1]) + MIN;
    var hi;
    if (rowIndex + 1 < rows.length) {
      hi = parseStart(rows[rowIndex + 1]) - MIN;
    } else {
      hi = getEditorRunDur() - MIN;
    }
    if (lo > hi) return parseStart(rows[rowIndex]);
    if (t < lo) return lo;
    if (t > hi) return hi;
    return t;
  }

  function updateTimelineBlocksFlexOnly() {
    if (!cueTimeline) return;
    var track = cueTimeline.querySelector(".cue-timeline-track");
    if (!track) return;
    var rows = getRows();
    var runDur = getEditorRunDur();
    var lead = track.querySelector(".cue-timeline-lead");
    if (lead && rows.length) {
      var s0 = parseStart(rows[0]);
      lead.style.flex = Math.max(s0, 0) + " 1 0%";
    }
    var blocks = track.querySelectorAll(".cue-timeline-block");
    for (var i = 0; i < rows.length && i < blocks.length; i++) {
      var start = parseStart(rows[i]);
      var end = i + 1 < rows.length ? parseStart(rows[i + 1]) : runDur;
      var len = Math.max(0, end - start);
      var grow = len > 0 ? len : runDur * 1e-6;
      blocks[i].style.flex = grow + " 1 0%";
    }
    layoutTimelineResizeHandles();
  }

  function moveTimelineResize(e) {
    if (!timelineResizeState) return;
    if (timelineResizeState.pointerId != null && e.pointerId !== timelineResizeState.pointerId) return;
    e.preventDefault();
    var st = timelineResizeState;
    var rows = getRows();
    var tr = rows[st.boundaryRowIndex];
    if (!tr) return;
    var tRaw = clientXToRunTime(e);
    var head = getPlayheadTimeForMagnet();
    var snap = snapBoundaryTowardPlayhead(rows, st.boundaryRowIndex, tRaw, head);
    var t = clampBoundaryStart(rows, st.boundaryRowIndex, snap.t);
    var inp = tr.querySelector(".cue-start");
    if (inp) inp.value = t.toFixed(3);
    if (st.handleEl) {
      var onHead = snap.snapped && head != null && Math.abs(t - head) < 0.00015;
      st.handleEl.classList.toggle("cue-timeline-resize--snapped", onHead);
    }
    syncEndCells();
    updateTimelineBlocksFlexOnly();
    updateOverlayFromMedia();
  }

  function endTimelineResize(e) {
    if (!timelineResizeState) return;
    if (
      e &&
      e.pointerId != null &&
      timelineResizeState.pointerId != null &&
      e.pointerId !== timelineResizeState.pointerId
    ) {
      return;
    }
    var st = timelineResizeState;
    var el = st.handleEl;
    var pid = st.pointerId;
    timelineResizeState = null;
    if (cueTimeline) cueTimeline.classList.remove("cue-timeline--resizing");
    if (el != null && pid != null) {
      try {
        el.releasePointerCapture(pid);
      } catch (ex) {}
    }
    refreshEnds();
    pushCueHistoryImmediate();
    window.setTimeout(function () {
      timelineSuppressClick = false;
    }, 80);
  }

  function styleCueTimelineBlockByIndex(seg, badgeEl, index, total) {
    var t = total <= 1 ? 0 : index / (total - 1);
    var h = 348 + t * 12;
    var s = 14 + t * 76;
    var l = 97 - t * 68;
    seg.style.background = "hsl(" + h + ", " + s + "%, " + l + "%)";
    var insetHi = 0.38 - t * 0.28;
    var insetSh = 0.1 + t * 0.2;
    seg.style.boxShadow =
      "inset 0 0 0 1px rgba(0, 0, 0, " +
      insetSh +
      "), inset 0 1px 0 rgba(255, 255, 255, " +
      insetHi +
      ")";
    if (!badgeEl) return;
    badgeEl.style.border = "1px solid";
    if (l > 64) {
      badgeEl.style.color = "#5c0814";
      badgeEl.style.background = "rgba(255, 255, 255, 0.94)";
      badgeEl.style.borderColor = "rgba(255, 240, 245, 0.98)";
      badgeEl.style.boxShadow = "0 1px 2px rgba(80, 0, 20, 0.2)";
    } else if (l > 44) {
      badgeEl.style.color = "#fff8f8";
      badgeEl.style.background = "rgba(40, 0, 10, 0.35)";
      badgeEl.style.borderColor = "rgba(255, 255, 255, 0.28)";
      badgeEl.style.boxShadow = "0 1px 3px rgba(0, 0, 0, 0.35)";
    } else {
      badgeEl.style.color = "#ffffff";
      badgeEl.style.background = "rgba(255, 255, 255, 0.14)";
      badgeEl.style.borderColor = "rgba(255, 255, 255, 0.22)";
      badgeEl.style.boxShadow = "0 1px 3px rgba(0, 0, 0, 0.45)";
    }
  }

  function renderTimelineBlocks() {
    if (!cueTimeline) return;
    cueTimeline.innerHTML = "";
    var rows = getRows();
    if (!rows.length) return;
    var track = document.createElement("div");
    track.className = "cue-timeline-track";
    cueTimeline.appendChild(track);
    var runDur = getEditorRunDur();
    var n = rows.length;
    var sFirst = parseStart(rows[0]);
    if (sFirst > 0) {
      var lead = document.createElement("div");
      lead.className = "cue-timeline-lead";
      lead.setAttribute("aria-hidden", "true");
      lead.style.flex = sFirst + " 1 0%";
      track.appendChild(lead);
    }
    for (var i = 0; i < rows.length; i++) {
      var start = parseStart(rows[i]);
      var end = i + 1 < rows.length ? parseStart(rows[i + 1]) : runDur;
      var len = Math.max(0, end - start);
      var grow = len > 0 ? len : runDur * 1e-6;
      var seg = document.createElement("button");
      seg.type = "button";
      seg.className = "cue-timeline-block";
      seg.style.flex = grow + " 1 0%";
      seg.draggable = true;
      seg.dataset.cueIndex = String(i);
      seg.setAttribute(
        "aria-label",
        "자막 " +
          (i + 1) +
          "번, 길이 " +
          len.toFixed(2) +
          "초. 블록 사이 막대로 인접 길이 조절, 드래그로 순서 변경, 클릭 시 편집 줄로 이동"
      );
      seg.title = "#" + (i + 1) + " · " + len.toFixed(2) + "초 · 막대로 길이 · 드래그로 이동";
      var numEl = document.createElement("span");
      numEl.className = "cue-timeline-block__badge";
      numEl.setAttribute("aria-hidden", "true");
      numEl.appendChild(document.createTextNode("#" + String(i + 1)));
      seg.appendChild(numEl);
      styleCueTimelineBlockByIndex(seg, numEl, i, n);
      (function (tr, idx) {
        seg.addEventListener("click", function (e) {
          if (timelineSuppressClick) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          tr.scrollIntoView({ block: "nearest", behavior: "smooth" });
          var ta = tr.querySelector(".cue-text");
          if (ta) ta.focus();
          var m = getActiveMedia();
          if (m) {
            m.currentTime = Math.max(0, parseStart(tr));
            updateOverlayFromMedia();
          }
        });
        seg.addEventListener("dragstart", function (e) {
          if (timelineResizeState) {
            e.preventDefault();
            return;
          }
          timelineDragStartX = e.clientX;
          timelineDragStartY = e.clientY;
          try {
            e.dataTransfer.setData("text/plain", String(idx));
            e.dataTransfer.effectAllowed = "move";
          } catch (err) {}
          seg.classList.add("cue-timeline-block--dragging");
          cueTimeline.classList.add("cue-timeline--dnd");
        });
        seg.addEventListener("dragend", function (e) {
          seg.classList.remove("cue-timeline-block--dragging");
          cueTimeline.classList.remove("cue-timeline--dnd");
          clearTimelineDropTargets();
          var dx = e.clientX - timelineDragStartX;
          var dy = e.clientY - timelineDragStartY;
          if (dx * dx + dy * dy > 36) {
            timelineSuppressClick = true;
            window.setTimeout(function () {
              timelineSuppressClick = false;
            }, 80);
          }
        });
        seg.addEventListener("dragover", function (e) {
          e.preventDefault();
          try {
            e.dataTransfer.dropEffect = "move";
          } catch (err2) {}
          clearTimelineDropTargets();
          seg.classList.add("cue-timeline-block--drop-target");
        });
        seg.addEventListener("dragleave", function (e) {
          if (!seg.contains(e.relatedTarget)) {
            seg.classList.remove("cue-timeline-block--drop-target");
          }
        });
        seg.addEventListener("drop", function (e) {
          e.preventDefault();
          clearTimelineDropTargets();
          var from = NaN;
          try {
            from = parseInt(e.dataTransfer.getData("text/plain"), 10);
          } catch (err3) {}
          if (isNaN(from)) return;
          var to = idx;
          moveCueRow(from, to);
        });
      })(rows[i], i);
      track.appendChild(seg);
    }
    for (var j = 1; j < rows.length; j++) {
      (function (boundaryIdx) {
        var h = document.createElement("div");
        h.className = "cue-timeline-resize";
        h.tabIndex = 0;
        h.setAttribute("role", "separator");
        h.setAttribute("aria-orientation", "vertical");
        h.setAttribute(
          "aria-label",
          "자막 " + (boundaryIdx + 1) + "번 시작 시각(앞·뒤 자막 길이) 조절. 좌우로 드래그"
        );
        h.addEventListener("pointerdown", function (e) {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          var r = getRows();
          if (boundaryIdx < 1 || boundaryIdx >= r.length) return;
          var trk = cueTimeline.querySelector(".cue-timeline-track");
          if (!trk) return;
          try {
            h.setPointerCapture(e.pointerId);
          } catch (e2) {}
          timelineResizeState = {
            boundaryRowIndex: boundaryIdx,
            pointerId: e.pointerId,
            handleEl: h
          };
          cueTimeline.classList.add("cue-timeline--resizing");
          timelineSuppressClick = true;
        });
        track.appendChild(h);
      })(j);
    }
    requestAnimationFrame(function () {
      layoutTimelineResizeHandles();
      requestAnimationFrame(layoutTimelineResizeHandles);
    });
  }

  document.addEventListener("pointermove", moveTimelineResize);
  document.addEventListener("pointerup", endTimelineResize);
  document.addEventListener("pointercancel", endTimelineResize);

  cueTimeline &&
    cueTimeline.addEventListener("dragover", function (e) {
      e.preventDefault();
      try {
        e.dataTransfer.dropEffect = "move";
      } catch (err4) {}
    });

  cueTimeline &&
    cueTimeline.addEventListener("scroll", function () {
      layoutTimelineResizeHandles();
    });

  function renumber() {
    getRows().forEach(function (tr, i) {
      var ix = tr.querySelector(".cue-ix");
      if (ix) ix.textContent = String(i + 1);
    });
  }

  function onCueTextKeydown(e) {
    if (e.isComposing) return;
    var ta = e.target;
    if (!ta || !ta.classList || !ta.classList.contains("cue-text")) return;
    var tr = ta.closest("tr");
    if (!cueBody || !tr || !cueBody.contains(tr)) return;
    var rows = getRows();
    var i = rows.indexOf(tr);
    if (i < 0) return;

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      var v = ta.value;
      var pos = ta.selectionStart != null ? ta.selectionStart : v.length;
      var before = v.slice(0, pos);
      var after = v.slice(pos);
      ta.value = before;
      var cs = parseStart(tr);
      var ce =
        i + 1 < rows.length
          ? parseStart(rows[i + 1])
          : Number(state.duration) || timelineTotalSec();
      var span = Math.max(0, ce - cs);
      var ratio = v.length > 0 ? pos / v.length : 0.5;
      var splitT = cs + span * ratio;
      var ntr = createCueRow(splitT, after);
      if (tr.nextSibling) {
        cueBody.insertBefore(ntr, tr.nextSibling);
      } else {
        cueBody.appendChild(ntr);
      }
      renumber();
      refreshEnds();
      var nta = ntr.querySelector(".cue-text");
      nta.focus();
      var pl = after.length;
      nta.setSelectionRange(pl, pl);
      updateOverlayFromMedia();
      pushCueHistoryImmediate();
      return;
    }

    if (e.key === "Backspace" && ta.selectionStart === 0 && ta.selectionEnd === 0 && i > 0) {
      e.preventDefault();
      var prev = rows[i - 1];
      var pta = prev.querySelector(".cue-text");
      var prevStr = (pta.value != null ? pta.value : "") || "";
      var curStr = (ta.value != null ? ta.value : "") || "";
      var joiner = prevStr.length && curStr.length ? " " : "";
      var caret = prevStr.length + joiner.length;
      pta.value = prevStr + joiner + curStr;
      cueBody.removeChild(tr);
      renumber();
      refreshEnds();
      updateOverlayFromMedia();
      pta.focus();
      pta.setSelectionRange(caret, caret);
      pushCueHistoryImmediate();
    }
  }

  function wireCueRow(tr) {
    tr.querySelector(".cue-start").addEventListener("input", function () {
      refreshEnds();
      updateOverlayFromMedia();
      scheduleCueHistoryPush();
    });
    tr.querySelector(".cue-start").addEventListener("blur", function () {
      sortRows();
      pushCueHistoryImmediate();
    });
    tr.querySelector(".cue-text").addEventListener("input", function () {
      if (String(this.value || "").trim()) delete tr.dataset.cueBlank;
      updateOverlayFromMedia();
      scheduleTimelineRefresh();
      scheduleCueHistoryPush();
    });
    tr.querySelector(".cue-text").addEventListener("keydown", onCueTextKeydown);
  }

  function createCueRow(startSec, text) {
    var tr = document.createElement("tr");
    tr.className = "cue-row";
    tr.innerHTML =
      '<td class="cue-ix seek-hit">0</td><td><input type="number" class="cue-start" step="0.001" min="0" /></td>' +
      '<td class="cue-end mono seek-hit"></td>' +
      '<td><textarea class="cue-text" rows="2" spellcheck="false"></textarea></td>';
    tr.querySelector(".cue-start").value = String(Number(startSec).toFixed(3));
    tr.querySelector(".cue-text").value = text != null ? text : "";
    wireCueRow(tr);
    return tr;
  }

  function restoreCueStateFromData(rows) {
    if (!cueBody) return;
    cueBody.innerHTML = "";
    (rows || []).forEach(function (c, i) {
      var rawStart = c && c.start != null ? String(c.start) : "0";
      var startNum = parseFloat(rawStart);
      if (!isFinite(startNum)) startNum = 0;
      var tr = createCueRow(startNum, c && c.text != null ? c.text : "");
      var inp = tr.querySelector(".cue-start");
      if (inp) {
        inp.value = rawStart.trim() !== "" ? rawStart : startNum.toFixed(3);
      }
      tr.querySelector(".cue-ix").textContent = String(i + 1);
      if (c && c.blank) tr.dataset.cueBlank = "1";
      cueBody.appendChild(tr);
    });
  }

  function addRow(cue, index) {
    if (!cueBody) return;
    var tr = createCueRow(cue.start, cue.text || "");
    tr.querySelector(".cue-ix").textContent = String(index + 1);
    if (cue.blank) tr.dataset.cueBlank = "1";
    cueBody.appendChild(tr);
  }

  function getActiveMedia() {
    if (previewVideo && previewVideo.src && !previewVideo.classList.contains("hidden")) {
      return previewVideo;
    }
    if (previewAudio && previewAudio.src && !previewAudio.classList.contains("hidden")) {
      return previewAudio;
    }
    return null;
  }

  function updateSeekVisual() {
    if (!dockSeek) return;
    var max = parseFloat(dockSeek.max) || 1;
    var val = parseFloat(dockSeek.value) || 0;
    var pct = max > 0 ? Math.min(100, Math.max(0, (val / max) * 100)) : 0;
    dockSeek.style.setProperty("--yt-seek-pct", pct + "%");
  }

  function syncTransportPlayPauseIcons(m) {
    if (!dockBtnPlay) return;
    var playSvg = dockBtnPlay.querySelector(".yt-ico-play");
    var pauseSvg = dockBtnPlay.querySelector(".yt-ico-pause");
    if (playSvg && pauseSvg) {
      playSvg.classList.toggle("hidden", !m.paused);
      pauseSvg.classList.toggle("hidden", m.paused);
    }
    dockBtnPlay.setAttribute("aria-label", m.paused ? "재생" : "일시정지");
  }

  function syncTransportMuteIcons(m) {
    if (!dockBtnMute) return;
    var volSvg = dockBtnMute.querySelector(".yt-ico-vol");
    var muteSvg = dockBtnMute.querySelector(".yt-ico-mute");
    var muted = !!m.muted;
    if (volSvg && muteSvg) {
      volSvg.classList.toggle("hidden", muted);
      muteSvg.classList.toggle("hidden", !muted);
    }
    dockBtnMute.setAttribute("aria-label", muted ? "소리 켬기" : "음소거");
  }

  function syncDockTransportFromMedia() {
    if (!dockSeek || !dockMediaTime || !dockBtnPlay || !dockBtnMute) return;
    var m = getActiveMedia();
    if (!m) return;
    var runDur = getEditorRunDur();
    dockSeek.max = Math.max(runDur, 0.001);
    dockSeek.step = runDur > 180 ? 0.1 : runDur > 60 ? 0.05 : 0.01;
    var md = Number(m.duration);
    if (!dockSeekDragging && runDur > 0) {
      var ct = Number(m.currentTime);
      if (isFinite(ct)) {
        ct = Math.min(runDur, Math.max(0, ct));
        if (isFinite(md) && md > 0) ct = Math.min(ct, md);
        if (Math.abs(Number(dockSeek.value) - ct) > 0.025) dockSeek.value = String(ct);
      }
    }
    updateSeekVisual();
    dockMediaTime.textContent =
      formatMediaShort(m.currentTime) + " / " + formatMediaShort(runDur);
    syncTransportPlayPauseIcons(m);
    syncTransportMuteIcons(m);
    if (dockVolume && !dockVolumeDragging) {
      dockVolume.value = String(Math.round(Math.min(1, Math.max(0, m.volume)) * 100));
    }
  }

  /** 단축키: 자막/찾기 입력 중이면 true (되돌리기·시크는 입력 필드에 맡김) */
  function isTextEditingTarget(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    var tag = el.tagName.toLowerCase();
    if (tag === "textarea") return true;
    if (tag === "select") return true;
    if (tag === "input") {
      var it = (el.type || "").toLowerCase();
      if (
        it === "checkbox" ||
        it === "radio" ||
        it === "button" ||
        it === "submit" ||
        it === "reset" ||
        it === "file" ||
        it === "range" ||
        it === "color" ||
        it === "image" ||
        it === "hidden"
      ) {
        return false;
      }
      return true;
    }
    return false;
  }

  function getFrameStepSec() {
    var m = getActiveMedia();
    if (m && m.tagName === "VIDEO" && m.getVideoPlaybackQuality) {
      try {
        var q = m.getVideoPlaybackQuality();
        var dur = Number(m.duration);
        if (q && dur > 0.5 && q.totalVideoFrames > 5) {
          var fps = q.totalVideoFrames / dur;
          if (fps >= 12 && fps <= 120) return 1 / fps;
        }
      } catch (ex) {}
    }
    return 1 / 30;
  }

  function seekActiveMediaByDelta(deltaSec) {
    var m = getActiveMedia();
    if (!m || !m.src) return;
    var runDur = getEditorRunDur();
    var md = Number(m.duration);
    var ct = Number(m.currentTime);
    if (!isFinite(ct)) return;
    var next = ct + deltaSec;
    next = Math.max(0, next);
    if (runDur > 0) next = Math.min(next, runDur);
    if (isFinite(md) && md > 0) next = Math.min(next, md);
    m.currentTime = next;
    syncDockTransportFromMedia();
    updateOverlayFromMedia();
  }

  function updateDockTransportVisibility() {
    var m = getActiveMedia();
    var show = !!(m && m.src);
    var chromes = document.querySelectorAll(".yt-editor-dock-inner .yt-dock-media-chrome");
    for (var i = 0; i < chromes.length; i++) {
      chromes[i].classList.toggle("hidden", !show);
    }
    if (show) syncDockTransportFromMedia();
  }

  function getCueRanges() {
    var rows = getRows();
    var dur = state.duration;
    var n = rows.length;
    var ranges = [];
    for (var i = 0; i < n; i++) {
      var start = parseStart(rows[i]);
      var end = i + 1 < n ? parseStart(rows[i + 1]) : dur;
      ranges.push({
        tr: rows[i],
        start: start,
        end: end,
        textEl: rows[i].querySelector(".cue-text"),
      });
    }
    return ranges;
  }

  function pickCueAtTime(t) {
    var ranges = getCueRanges();
    var n = ranges.length;
    if (!n) return null;
    for (var i = 0; i < n; i++) {
      var r = ranges[i];
      var last = i === n - 1;
      if (last) {
        if (t >= r.start && t <= r.end + 0.02) return r;
      } else if (t >= r.start && t < r.end) {
        return r;
      }
    }
    return null;
  }

  function normalizeSubtitleOneLine(s) {
    return String(s || "")
      .replace(/\r?\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function syncPreviewOverlayInputToTable() {
    if (!subOverlay || !previewOverlaySourceTr) return;
    var tableTa = previewOverlaySourceTr.querySelector(".cue-text");
    if (!tableTa) return;
    var v = normalizeSubtitleOneLine(subOverlay.value);
    if (tableTa.value !== v) {
      tableTa.value = v;
      if (v) delete previewOverlaySourceTr.dataset.cueBlank;
      scheduleReplaceCountUpdate();
      scheduleCueHistoryPush();
      scheduleTimelineRefresh();
    }
  }

  function updateOverlay(t) {
    if (!subOverlay || !subOverlayWrap) return;
    var cur = pickCueAtTime(t);
    var ranges = getCueRanges();
    ranges.forEach(function (r) {
      r.tr.classList.toggle("cue-active", cur && r.tr === cur.tr);
    });
    var editingPreview = document.activeElement === subOverlay;
    if (cur && cur.textEl) {
      var txt = normalizeSubtitleOneLine(cur.textEl.value);
      if (!editingPreview) {
        subOverlay.value = txt;
      }
      subOverlay.disabled = false;
      subOverlayWrap.classList.remove("sub-overlay--empty");
    } else {
      if (!editingPreview) {
        subOverlay.value = "";
      }
      subOverlay.disabled = true;
      subOverlayWrap.classList.add("sub-overlay--empty");
    }
  }

  function updateOverlayFromMedia() {
    var m = getActiveMedia();
    if (m) updateOverlay(m.currentTime);
    else updateOverlay(0);
  }

  if (subOverlay) {
    subOverlay.addEventListener("focus", function () {
      var m = getActiveMedia();
      var t = m ? m.currentTime : 0;
      var cur = pickCueAtTime(t);
      previewOverlaySourceTr = cur && cur.tr ? cur.tr : null;
    });
    subOverlay.addEventListener("input", function () {
      syncPreviewOverlayInputToTable();
    });
    subOverlay.addEventListener("blur", function () {
      syncPreviewOverlayInputToTable();
      pushCueHistoryImmediate();
      previewOverlaySourceTr = null;
      updateOverlayFromMedia();
    });
  }

  function wirePreviewMedia(el) {
    if (!el || mediaWired) return;
    mediaWired = true;
    var tick = function () {
      updateOverlay(el.currentTime);
      syncDockTransportFromMedia();
    };
    el.addEventListener("timeupdate", tick);
    el.addEventListener("seeked", tick);
    el.addEventListener("play", tick);
    el.addEventListener("pause", tick);
    el.addEventListener("volumechange", tick);
    el.addEventListener("loadedmetadata", function () {
      syncDockTransportFromMedia();
    });
  }

  function setupPreview(data) {
    if (!previewSection || !data.preview_available) {
      if (previewSection) previewSection.classList.add("hidden");
      if (editorMain) editorMain.classList.add("edit-layout--no-preview");
      updateDockTransportVisibility();
      return;
    }
    if (editorMain) editorMain.classList.remove("edit-layout--no-preview");
    var url = "/api/jobs/" + encodeURIComponent(jobId) + "/preview-media";
    previewVideo.classList.add("hidden");
    previewAudio.classList.add("hidden");
    previewVideo.removeAttribute("src");
    previewAudio.removeAttribute("src");
    mediaWired = false;
    if (data.preview_kind === "video") {
      previewVideo.src = url;
      previewVideo.classList.remove("hidden");
      wirePreviewMedia(previewVideo);
    } else {
      previewAudio.src = url;
      previewAudio.classList.remove("hidden");
      wirePreviewMedia(previewAudio);
    }
    previewSection.classList.remove("hidden");
    if (subOverlayWrap) subOverlayWrap.classList.add("sub-overlay--empty");
    updateDockTransportVisibility();
  }

  function parseErrorDetail(res, text) {
    try {
      var data = JSON.parse(text);
      if (typeof data.detail === "string") return data.detail;
    } catch (e) {}
    return text || res.statusText || "오류";
  }

  if (!jobId) {
    showErr("URL에 job 번호가 없습니다. 업로드 페이지에서 자막 생성을 완료해 주세요.");
  } else {
    fetch("/api/jobs/" + encodeURIComponent(jobId) + "/cues")
      .then(function (res) {
        if (!res.ok) return res.text().then(function (t) { throw new Error(parseErrorDetail(res, t)); });
        return res.json();
      })
      .then(function (data) {
        state.duration = Number(data.duration) || 0;
        state.format = data.format === "vtt" ? "vtt" : "srt";
        state.downloadBase = data.download_base || "subtitle";
        updateMetaLine();
        if (!cueBody) {
          showErr("페이지 구조를 읽을 수 없습니다. 새로고침해 주세요.");
          return;
        }
        (data.cues || []).forEach(function (c, i) {
          addRow(c, i);
        });
        if (!cueBody.children.length) {
          showErr("자막 큐가 없습니다.");
          return;
        }
        sortRows();
        setupPreview(data);
        if (editorMain) editorMain.classList.remove("hidden");
        setTimingDockVisible(true);
        updateDockTransportVisibility();
        updateReplaceCountDisplay();
        initCueHistory();
      })
      .catch(function (e) {
        showErr(e.message || String(e));
      });
  }

  if (cueBody) {
    cueBody.addEventListener("click", function (e) {
      if (!e.target.closest(".seek-hit")) return;
      var tr = e.target.closest("tr");
      if (!tr || !cueBody.contains(tr)) return;
      var m = getActiveMedia();
      if (!m) return;
      m.currentTime = Math.max(0, parseStart(tr));
      updateOverlayFromMedia();
    });

    cueBody.addEventListener("input", function (e) {
      if (e.target && e.target.classList && e.target.classList.contains("cue-text")) {
        scheduleReplaceCountUpdate();
      }
    });
  }

  if (dockBtnPlay) {
    dockBtnPlay.addEventListener("click", function () {
      var m = getActiveMedia();
      if (!m) return;
      if (m.paused) {
        m.play().catch(function () {});
      } else {
        m.pause();
      }
      syncDockTransportFromMedia();
    });
  }
  if (dockBtnMute) {
    dockBtnMute.addEventListener("click", function () {
      var m = getActiveMedia();
      if (!m) return;
      m.muted = !m.muted;
      syncDockTransportFromMedia();
    });
  }
  if (dockSeek) {
    dockSeek.addEventListener("pointerdown", function () {
      dockSeekDragging = true;
    });
    dockSeek.addEventListener("pointerup", function () {
      dockSeekDragging = false;
      syncDockTransportFromMedia();
    });
    dockSeek.addEventListener("pointercancel", function () {
      dockSeekDragging = false;
    });
    dockSeek.addEventListener("input", function () {
      var m = getActiveMedia();
      if (!m) return;
      var v = parseFloat(dockSeek.value);
      if (!isFinite(v)) return;
      var runDur = getEditorRunDur();
      v = Math.max(0, Math.min(runDur, v));
      var md = Number(m.duration);
      if (isFinite(md) && md > 0) v = Math.min(v, md);
      m.currentTime = v;
      updateSeekVisual();
      updateOverlayFromMedia();
    });
  }
  if (dockVolume) {
    dockVolume.addEventListener("pointerdown", function () {
      dockVolumeDragging = true;
    });
    dockVolume.addEventListener("pointerup", function () {
      dockVolumeDragging = false;
      syncDockTransportFromMedia();
    });
    dockVolume.addEventListener("pointercancel", function () {
      dockVolumeDragging = false;
    });
    dockVolume.addEventListener("input", function () {
      var m = getActiveMedia();
      if (!m) return;
      var v = parseInt(dockVolume.value, 10);
      if (!isFinite(v)) return;
      v = Math.min(100, Math.max(0, v));
      m.volume = v / 100;
      if (v > 0) m.muted = false;
      syncTransportMuteIcons(m);
    });
  }

  if (replaceFind) replaceFind.addEventListener("input", scheduleReplaceCountUpdate);
  if (replaceWith) replaceWith.addEventListener("input", scheduleReplaceCountUpdate);

  if (btnReplaceAll) {
    btnReplaceAll.addEventListener("click", function () {
      var o = getReplaceOptions();
      if (!String(o.find).length) {
        window.alert("찾을 텍스트를 입력해 주세요.");
        return;
      }
      var totalBefore = 0;
      getRows().forEach(function (tr) {
        var ta = tr.querySelector(".cue-text");
        if (!ta) return;
        totalBefore += countOccurrencesInText(ta.value, o.find, o.wholeToken, o.caseSensitive);
      });
      if (!totalBefore) {
        window.alert("일치하는 곳이 없습니다.");
        return;
      }
      if (totalBefore > 25 && !window.confirm("총 " + totalBefore + "곳을 바꿉니다. 계속할까요?")) {
        return;
      }
      var changed = false;
      getRows().forEach(function (tr) {
        var ta = tr.querySelector(".cue-text");
        if (!ta) return;
        var next = replaceInText(ta.value, o.find, o.withStr, o.wholeToken, o.caseSensitive);
        if (next !== ta.value) {
          ta.value = next;
          changed = true;
          if (String(ta.value || "").trim()) delete tr.dataset.cueBlank;
        }
      });
      if (changed) {
        scheduleTimelineRefresh();
        updateOverlayFromMedia();
        updateReplaceCountDisplay();
        pushCueHistoryImmediate();
      }
    });
  }

  function doSubtitleDownload() {
    var cues = [];
    getRows().forEach(function (tr) {
      var text = (tr.querySelector(".cue-text") && tr.querySelector(".cue-text").value) || "";
      var trimmed = String(text).trim();
      if (!trimmed && !tr.dataset.cueBlank) return;
      cues.push({
        start: parseStart(tr),
        text: text,
        blank: !trimmed,
      });
    });
    cues.sort(function (a, b) {
      return a.start - b.start;
    });
    if (!cues.length) {
      window.alert("저장할 자막 텍스트가 없습니다.");
      return;
    }
    if (dockBtnSaveSubtitle) dockBtnSaveSubtitle.disabled = true;
    fetch("/api/build-subtitle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        format: state.format,
        duration: state.duration,
        cues: cues,
      }),
    })
      .then(function (res) {
        if (!res.ok) return res.text().then(function (t) { throw new Error(parseErrorDetail(res, t)); });
        return res.blob();
      })
      .then(function (blob) {
        var name = state.downloadBase + "_edited." + state.format;
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      })
      .catch(function (e) {
        alert(e.message || String(e));
      })
      .finally(function () {
        updateDockHistoryButtons();
      });
  }

  if (dockBtnUndo) {
    dockBtnUndo.addEventListener("click", function () {
      undoCueHistory();
    });
  }
  if (dockBtnRedo) {
    dockBtnRedo.addEventListener("click", function () {
      redoCueHistory();
    });
  }
  if (dockBtnSaveSubtitle) {
    dockBtnSaveSubtitle.addEventListener("click", function () {
      doSubtitleDownload();
    });
  }

  document.addEventListener("keydown", function (e) {
    if (e.defaultPrevented) return;
    var typing = isTextEditingTarget(e.target);
    var mod = e.metaKey || e.ctrlKey;
    var k = e.key;

    if (mod && (k === "z" || k === "Z")) {
      if (typing) return;
      e.preventDefault();
      if (e.shiftKey) redoCueHistory();
      else undoCueHistory();
      return;
    }
    if (mod && (k === "y" || k === "Y")) {
      if (typing) return;
      e.preventDefault();
      redoCueHistory();
      return;
    }

    if (e.code === "Space") {
      if (typing) return;
      if (e.repeat) return;
      var mPlay = getActiveMedia();
      if (!mPlay || !mPlay.src) return;
      e.preventDefault();
      if (mPlay.paused) mPlay.play().catch(function () {});
      else mPlay.pause();
      syncDockTransportFromMedia();
      return;
    }

    if (typing) return;
    var mSeek = getActiveMedia();
    if (!mSeek || !mSeek.src) return;

    if (k === "ArrowLeft") {
      e.preventDefault();
      seekActiveMediaByDelta(-1);
      return;
    }
    if (k === "ArrowRight") {
      e.preventDefault();
      seekActiveMediaByDelta(1);
      return;
    }

    var frame = getFrameStepSec();
    if (k === "," || k === "<") {
      e.preventDefault();
      seekActiveMediaByDelta(-frame);
      return;
    }
    if (k === "." || k === ">") {
      e.preventDefault();
      seekActiveMediaByDelta(frame);
      return;
    }
  });
})();
