(function () {
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
  var dockBtnChain = document.getElementById("dockBtnChain");
  var dockBtnResetSpacing = document.getElementById("dockBtnResetSpacing");
  var dockBtnSaveSubtitle = document.getElementById("dockBtnSaveSubtitle");
  var dockSeek = document.getElementById("dockSeek");
  var dockMediaTime = document.getElementById("dockMediaTime");
  var dockVolume = document.getElementById("dockVolume");
  var srtFile = document.getElementById("srtFile");
  var mediaFile = document.getElementById("mediaFile");

  var dockSeekDragging = false;
  var dockVolumeDragging = false;
  var state = { duration: 0, format: "srt", downloadBase: "subtitle" };
  var cues = [];
  var timingSnapshot = [];
  var mediaWired = false;
  var mediaObjectUrl = null;
  var replaceCountTimer = null;
  var previewOverlaySourceTr = null;
  var timelineTimer = null;

  function updateDockSaveButton() {
    if (dockBtnSaveSubtitle) {
      dockBtnSaveSubtitle.disabled = !cues.length;
    }
  }

  function showErr(msg) {
    if (loadError) {
      loadError.textContent = msg;
      loadError.classList.remove("hidden");
    }
  }

  function hideErr() {
    if (loadError) loadError.classList.add("hidden");
  }

  function updateMetaLine() {
    if (!metaLine) return;
    var md = state.duration > 0 ? "미리보기 길이 " + state.duration.toFixed(3) + "초" : "미리보기 파일 없음(타임라인은 자막 끝 시각 기준)";
    metaLine.textContent =
      "형식: " + state.format.toUpperCase() + " · " + md + " · 파일명 기준 저장: " + state.downloadBase;
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

  function formatMediaShort(sec) {
    sec = Math.max(0, Number(sec) || 0);
    var s = Math.floor(sec % 60);
    var m = Math.floor(sec / 60) % 60;
    var h = Math.floor(sec / 3600);
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

  function parseEnd(tr) {
    var inp = tr.querySelector(".cue-end");
    var v = parseFloat(inp && inp.value);
    return isNaN(v) ? 0 : v;
  }

  function maxCueExtentSec() {
    var lastEnd = 0;
    cues.forEach(function (c) {
      if (c.end > lastEnd) lastEnd = c.end;
      if (c.start > lastEnd) lastEnd = c.start;
    });
    return lastEnd;
  }

  function getEditorRunDur() {
    var lastEnd = maxCueExtentSec();
    var md = Number(state.duration);
    if (isFinite(md) && md > 0) return Math.max(md, lastEnd, 0.001);
    return Math.max(lastEnd, 0.001);
  }

  function refreshEnds() {
    scheduleTimelineRefresh();
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
    var runDur = getEditorRunDur();
    var track = document.createElement("div");
    track.className = "cue-timeline-track";
    cueTimeline.appendChild(track);

    var times = [];
    for (var i = 0; i < rows.length; i++) {
      times.push({
        start: parseStart(rows[i]),
        end: parseEnd(rows[i]),
        tr: rows[i],
        i: i,
      });
    }

    var tCursor = 0;
    if (times[0].start > 0) {
      var lead = document.createElement("div");
      lead.className = "cue-timeline-lead";
      lead.style.flex = times[0].start + " 1 0%";
      lead.setAttribute("aria-hidden", "true");
      track.appendChild(lead);
      tCursor = times[0].start;
    }

    for (var j = 0; j < times.length; j++) {
      var segInfo = times[j];
      if (segInfo.start > tCursor + 1e-6) {
        var gap = document.createElement("div");
        gap.className = "cue-timeline-lead";
        gap.style.flex = segInfo.start - tCursor + " 1 0%";
        gap.style.opacity = "0.35";
        gap.setAttribute("aria-hidden", "true");
        track.appendChild(gap);
      }
      var len = Math.max(0, segInfo.end - segInfo.start);
      var grow = len > 0 ? len : runDur * 1e-6;
      var seg = document.createElement("button");
      seg.type = "button";
      seg.className = "cue-timeline-block";
      seg.style.flex = grow + " 1 0%";
      seg.setAttribute(
        "aria-label",
        "자막 " +
          (j + 1) +
          "번, 길이 " +
          len.toFixed(2) +
          "초. 클릭 시 해당 줄로 이동"
      );
      seg.title = "#" + (j + 1) + " · " + len.toFixed(2) + "초";
      var numEl = document.createElement("span");
      numEl.className = "cue-timeline-block__badge";
      numEl.setAttribute("aria-hidden", "true");
      numEl.appendChild(document.createTextNode("#" + String(j + 1)));
      seg.appendChild(numEl);
      styleCueTimelineBlockByIndex(seg, numEl, j, times.length);
      (function (tr) {
        seg.addEventListener("click", function () {
          tr.scrollIntoView({ block: "nearest", behavior: "smooth" });
          var ta = tr.querySelector(".cue-text");
          if (ta) ta.focus();
          var m = getActiveMedia();
          if (m) {
            m.currentTime = Math.max(0, parseStart(tr));
            updateOverlayFromMedia();
          }
        });
      })(segInfo.tr);
      track.appendChild(seg);
      tCursor = Math.max(tCursor, segInfo.end);
    }
    if (runDur > tCursor + 1e-6) {
      var tail = document.createElement("div");
      tail.className = "cue-timeline-lead";
      tail.style.flex = runDur - tCursor + " 1 0%";
      tail.setAttribute("aria-hidden", "true");
      track.appendChild(tail);
    }
  }

  function syncCuesFromTable() {
    var rows = getRows();
    var next = [];
    for (var i = 0; i < rows.length; i++) {
      var tr = rows[i];
      var ta = tr.querySelector(".cue-text");
      var trimmed = String((ta && ta.value) || "").trim();
      next.push({
        start: parseStart(tr),
        end: parseEnd(tr),
        text: ta ? ta.value : "",
        blank: tr.dataset.cueBlank === "1" || !trimmed,
      });
    }
    cues = next;
  }

  function sortRowsByStart() {
    syncCuesFromTable();
    cues.sort(function (a, b) {
      return a.start - b.start;
    });
    renderTable();
  }

  function wireRow(tr) {
    tr.querySelector(".cue-start").addEventListener("input", function () {
      var i = parseInt(tr.dataset.cueIndex, 10);
      if (i >= 0 && i < cues.length) cues[i].start = parseStart(tr);
      refreshEnds();
      updateOverlayFromMedia();
    });
    tr.querySelector(".cue-end").addEventListener("input", function () {
      var i = parseInt(tr.dataset.cueIndex, 10);
      if (i >= 0 && i < cues.length) cues[i].end = parseEnd(tr);
      refreshEnds();
      updateOverlayFromMedia();
    });
    tr.querySelector(".cue-start").addEventListener("blur", function () {
      sortRowsByStart();
    });
    tr.querySelector(".cue-text").addEventListener("input", function () {
      var i = parseInt(tr.dataset.cueIndex, 10);
      if (String(this.value || "").trim()) delete tr.dataset.cueBlank;
      if (i >= 0 && i < cues.length) {
        cues[i].text = this.value;
        cues[i].blank = !String(this.value || "").trim();
      }
      updateOverlayFromMedia();
      scheduleReplaceCountUpdate();
    });
  }

  function renderTable() {
    if (!cueBody) return;
    cueBody.innerHTML = "";
    cues.forEach(function (c, i) {
      var tr = document.createElement("tr");
      tr.className = "cue-row";
      tr.dataset.cueIndex = String(i);
      tr.innerHTML =
        '<td class="cue-ix seek-hit">' +
        (i + 1) +
        '</td><td><input type="number" class="cue-start" step="0.001" min="0" /></td>' +
        '<td><input type="number" class="cue-end" step="0.001" min="0" /></td>' +
        '<td><textarea class="cue-text" rows="2" spellcheck="false"></textarea></td>';
      tr.querySelector(".cue-start").value = String(Number(c.start).toFixed(3));
      tr.querySelector(".cue-end").value = String(Number(c.end).toFixed(3));
      tr.querySelector(".cue-text").value = c.text != null ? c.text : "";
      if (c.blank) tr.dataset.cueBlank = "1";
      wireRow(tr);
      cueBody.appendChild(tr);
    });
    renderTimelineBlocks();
    updateOverlayFromMedia();
    updateDockSaveButton();
    updateReplaceCountDisplay();
  }

  function mergeGaps() {
    if (!cues.length) return;
    syncCuesFromTable();
    cues.sort(function (a, b) {
      return a.start - b.start;
    });
    var n = cues.length;
    var lastEnd =
      timingSnapshot.length === n
        ? timingSnapshot[n - 1].end
        : cues[n - 1].end;
    for (var i = 0; i < n - 1; i++) {
      cues[i].end = cues[i + 1].start;
      if (cues[i].end < cues[i].start) cues[i].end = cues[i].start;
    }
    cues[n - 1].end = lastEnd;
    renderTable();
  }

  function resetSpacing() {
    if (timingSnapshot.length !== cues.length) {
      window.alert("큐 개수가 바뀌어 간격 초기화를 할 수 없습니다. 자막 파일을 다시 불러오세요.");
      return;
    }
    syncCuesFromTable();
    for (var i = 0; i < cues.length; i++) {
      cues[i].start = timingSnapshot[i].start;
      cues[i].end = timingSnapshot[i].end;
    }
    cues.sort(function (a, b) {
      return a.start - b.start;
    });
    renderTable();
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
      pauseSvg.classList.toggle("hidden", !m.paused);
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
    var ranges = [];
    for (var i = 0; i < rows.length; i++) {
      var s = parseStart(rows[i]);
      var e = parseEnd(rows[i]);
      ranges.push({
        tr: rows[i],
        start: s,
        end: e,
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
      var i = parseInt(previewOverlaySourceTr.dataset.cueIndex, 10);
      if (i >= 0 && i < cues.length) {
        cues[i].text = v;
        cues[i].blank = !v;
      }
      scheduleReplaceCountUpdate();
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
      var md = Number(el.duration);
      if (isFinite(md) && md > 0) state.duration = md;
      updateMetaLine();
      syncDockTransportFromMedia();
      refreshEnds();
    });
  }

  function revokeMediaUrl() {
    if (mediaObjectUrl) {
      try {
        URL.revokeObjectURL(mediaObjectUrl);
      } catch (e) {}
      mediaObjectUrl = null;
    }
  }

  function guessLocalPreviewKind(name) {
    var n = (name || "").toLowerCase();
    if (/\.(mp4|webm|mpeg)$/.test(n)) return "video";
    return "audio";
  }

  function setupLocalPreview(file) {
    revokeMediaUrl();
    mediaWired = false;
    state.duration = 0;
    if (!file) {
      if (previewVideo) {
        previewVideo.removeAttribute("src");
        previewVideo.classList.add("hidden");
      }
      if (previewAudio) {
        previewAudio.removeAttribute("src");
        previewAudio.classList.add("hidden");
      }
      if (previewSection) previewSection.classList.add("hidden");
      if (editorMain) editorMain.classList.add("edit-layout--no-preview");
      updateDockTransportVisibility();
      updateMetaLine();
      refreshEnds();
      return;
    }
    mediaObjectUrl = URL.createObjectURL(file);
    var kind = guessLocalPreviewKind(file.name);
    if (previewVideo) {
      previewVideo.classList.add("hidden");
      previewVideo.removeAttribute("src");
    }
    if (previewAudio) {
      previewAudio.classList.add("hidden");
      previewAudio.removeAttribute("src");
    }
    if (kind === "video" && previewVideo) {
      previewVideo.src = mediaObjectUrl;
      previewVideo.classList.remove("hidden");
      wirePreviewMedia(previewVideo);
    } else if (previewAudio) {
      previewAudio.src = mediaObjectUrl;
      previewAudio.classList.remove("hidden");
      wirePreviewMedia(previewAudio);
    }
    if (previewSection) previewSection.classList.remove("hidden");
    if (editorMain) editorMain.classList.remove("edit-layout--no-preview");
    if (subOverlayWrap) subOverlayWrap.classList.add("sub-overlay--empty");
    updateDockTransportVisibility();
    updateMetaLine();
  }

  function safeStem(name) {
    var base = name.replace(/^.*[/\\]/, "").replace(/\.[^.]+$/, "");
    return base.replace(/[^\w\-가-힣.]+/g, "_").slice(0, 80) || "subtitle";
  }

  function parseErrorDetail(res, text) {
    try {
      var data = JSON.parse(text);
      if (typeof data.detail === "string") return data.detail;
    } catch (e) {}
    return text || res.statusText || "오류";
  }

  function ingestParsed(data) {
    hideErr();
    cues = (data.cues || []).map(function (c) {
      return {
        start: Number(c.start) || 0,
        end: Number(c.end) || 0,
        text: c.text != null ? c.text : "",
        blank: !!c.blank,
      };
    });
    cues.sort(function (a, b) {
      return a.start - b.start;
    });
    timingSnapshot = cues.map(function (c) {
      return { start: c.start, end: c.end };
    });
    state.format = data.format === "vtt" ? "vtt" : "srt";
    updateMetaLine();
    renderTable();
    if (editorMain) editorMain.classList.remove("hidden");
    setTimingDockVisible(true);
    updateDockTransportVisibility();
  }

  function doSubtitleDownload() {
    syncCuesFromTable();
    var payload = [];
    cues.forEach(function (c) {
      var trimmed = String(c.text || "").trim();
      if (!trimmed && !c.blank) return;
      payload.push({
        start: c.start,
        end: c.end,
        text: c.text,
        blank: !trimmed,
      });
    });
    payload.sort(function (a, b) {
      return a.start - b.start;
    });
    if (!payload.length) {
      window.alert("저장할 자막 텍스트가 없습니다.");
      return;
    }
    if (dockBtnSaveSubtitle) dockBtnSaveSubtitle.disabled = true;
    fetch("/api/build-subtitle-explicit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        format: state.format,
        cues: payload,
      }),
    })
      .then(function (res) {
        if (!res.ok) return res.text().then(function (t) {
          throw new Error(parseErrorDetail(res, t));
        });
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
        window.alert(e.message || String(e));
      })
      .finally(function () {
        updateDockSaveButton();
      });
  }

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

  if (srtFile) {
    srtFile.addEventListener("change", function () {
      var f = srtFile.files && srtFile.files[0];
      if (!f) return;
      hideErr();
      state.downloadBase = safeStem(f.name);
      updateMetaLine();
      var fd = new FormData();
      fd.append("file", f);
      fetch("/api/parse-subtitle-upload", {
        method: "POST",
        body: fd,
      })
        .then(function (res) {
          if (!res.ok) return res.text().then(function (t) {
            throw new Error(parseErrorDetail(res, t));
          });
          return res.json();
        })
        .then(ingestParsed)
        .catch(function (e) {
          showErr(e.message || String(e));
        });
    });
  }

  if (mediaFile) {
    mediaFile.addEventListener("change", function () {
      var f = mediaFile.files && mediaFile.files[0];
      setupLocalPreview(f || null);
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
      previewOverlaySourceTr = null;
      updateOverlayFromMedia();
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

  if (dockBtnChain) {
    dockBtnChain.addEventListener("click", function () {
      mergeGaps();
    });
  }
  if (dockBtnResetSpacing) {
    dockBtnResetSpacing.addEventListener("click", function () {
      resetSpacing();
    });
  }
  if (dockBtnSaveSubtitle) {
    dockBtnSaveSubtitle.addEventListener("click", function () {
      doSubtitleDownload();
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
          var i = parseInt(tr.dataset.cueIndex, 10);
          if (i >= 0 && i < cues.length) {
            cues[i].text = ta.value;
            cues[i].blank = !String(ta.value || "").trim();
          }
        }
      });
      if (changed) {
        scheduleTimelineRefresh();
        updateOverlayFromMedia();
        updateReplaceCountDisplay();
      }
    });
  }

  document.addEventListener("keydown", function (e) {
    if (e.defaultPrevented) return;
    var typing = isTextEditingTarget(e.target);

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

    if (e.key === "ArrowLeft") {
      e.preventDefault();
      seekActiveMediaByDelta(-1);
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      seekActiveMediaByDelta(1);
      return;
    }

    var frame = getFrameStepSec();
    if (e.key === "," || e.key === "<") {
      e.preventDefault();
      seekActiveMediaByDelta(-frame);
      return;
    }
    if (e.key === "." || e.key === ">") {
      e.preventDefault();
      seekActiveMediaByDelta(frame);
      return;
    }
  });

  updateMetaLine();
})();
