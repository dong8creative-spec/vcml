(function () {
  var form = document.getElementById("form");
  var fileInput = document.getElementById("file");
  var dropZone = document.getElementById("dropZone");
  var fileLabel = document.getElementById("fileLabel");
  var subtitleFormat = document.getElementById("subtitle_format");
  var maxChars = document.getElementById("max_chars");
  var maxEojeol = document.getElementById("max_eojeol");
  var timeOffsetSec = document.getElementById("time_offset_sec");
  var submitBtn = document.getElementById("submitBtn");
  var statusEl = document.getElementById("status");
  var progressModal = document.getElementById("progressModal");
  var progressBar = document.getElementById("progressBar");
  var progressPhase = document.getElementById("progressPhase");
  var progressA11y = document.getElementById("progressA11y");
  var quotaBadge = document.getElementById("quotaBadge");

  var pollTimer = null;

  /** 서버 job_id 는 uuid.hex 32자리. 깨진 ID로 폴링하면 404 만 반복된다. */
  function normalizeJobId(raw) {
    var id = String(raw == null ? "" : raw)
      .trim()
      .toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(id)) {
      throw new Error(
        "서버에서 받은 작업 ID가 올바르지 않습니다. 페이지를 새로고침(Cmd/Ctrl+Shift+R) 후 다시 시도해 주세요."
      );
    }
    return id;
  }

  function applyQuotaFromServer(data) {
    var unlimited = !data || data.limited === false;
    var rem = unlimited ? null : typeof data.remaining === "number" ? data.remaining : 0;
    var exhausted = !unlimited && rem <= 0;

    if (quotaBadge) {
      if (unlimited) {
        quotaBadge.textContent = "자막 만들기 · 제한 없음";
        quotaBadge.classList.remove("quota-empty");
      } else {
        quotaBadge.textContent = "자막 만들기 " + rem + "회 남음";
        quotaBadge.classList.toggle("quota-empty", exhausted);
      }
    }

    var qbm = document.getElementById("quotaBlockMsg");
    if (qbm) {
      if (exhausted) {
        qbm.textContent =
          "이 접속에서 자막 자동 생성을 이용할 수 있는 횟수가 모두 소진되었습니다. 파일을 올리거나 「자막 만들기」를 더 이상 사용할 수 없습니다.";
        qbm.classList.remove("hidden");
      } else {
        qbm.classList.add("hidden");
      }
    }

    if (form) form.classList.toggle("quota-locked", exhausted && !unlimited);
    if (dropZone) dropZone.classList.toggle("quota-locked", exhausted && !unlimited);
    if (fileInput) fileInput.disabled = !!(exhausted && !unlimited);
    if (submitBtn && pollTimer === null) {
      submitBtn.disabled = !!(exhausted && !unlimited);
    }
  }

  function refreshQuota() {
    fetch("/api/transcription-quota", { credentials: "same-origin" })
      .then(function (res) {
        if (!res.ok) throw new Error("quota");
        return res.json();
      })
      .then(applyQuotaFromServer)
      .catch(function () {
        if (quotaBadge) quotaBadge.textContent = "자막 만들기 · 횟수 확인 실패";
      });
  }

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.classList.toggle("error", !!isError);
  }

  function setProgressVisible(show) {
    if (!progressModal) return;
    progressModal.classList.toggle("hidden", !show);
    progressModal.setAttribute("aria-hidden", show ? "false" : "true");
    document.body.classList.toggle("progress-modal-open", !!show);
    if (!show) {
      setProgressUi(0, "");
    }
  }

  function setProgressUi(pct, phase) {
    pct = Math.max(0, Math.min(100, Math.round(pct)));
    if (progressBar) progressBar.style.width = pct + "%";
    if (progressA11y) progressA11y.setAttribute("aria-valuenow", String(pct));
    if (progressPhase) progressPhase.textContent = phase || "";
  }

  function clearPoll() {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function parseErrorDetail(res, text) {
    try {
      var data = JSON.parse(text);
      if (typeof data.detail === "string") return data.detail;
      if (Array.isArray(data.detail) && data.detail[0] && data.detail[0].msg) {
        return data.detail.map(function (x) { return x.msg; }).join(" ");
      }
    } catch (e) {}
    return text || res.statusText || "요청 실패";
  }

  function setFileFromBlob(file) {
    if (!fileInput || !fileLabel) return;
    var dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    fileLabel.textContent = file.name || "선택된 파일";
  }

  function updateLabelFromInput() {
    if (!fileInput || !fileLabel) return;
    var f = fileInput.files[0];
    fileLabel.textContent = f ? f.name : "선택된 파일 없음";
  }

  if (fileInput) fileInput.addEventListener("change", updateLabelFromInput);

  if (dropZone && form && fileInput && submitBtn) {
    dropZone.addEventListener("dragover", function (e) {
      if (form && form.classList.contains("quota-locked")) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      dropZone.classList.add("dragover");
    });

    dropZone.addEventListener("dragleave", function (e) {
      e.preventDefault();
      var rel = e.relatedTarget;
      if (!rel || !dropZone.contains(rel)) dropZone.classList.remove("dragover");
    });

    dropZone.addEventListener("drop", function (e) {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove("dragover");
      if (form && form.classList.contains("quota-locked")) return;
      if (submitBtn.disabled) return;
      var files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) {
        setStatus("파일을 놓아 주세요.", true);
        return;
      }
      var file = files[0];
      setFileFromBlob(file);
      setStatus("");
      form.requestSubmit();
    });

    dropZone.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fileInput.click();
      }
    });
  }

  function runJob(jobId) {
    clearPoll();
    setProgressVisible(true);
    setProgressUi(0, "작업 시작…");

    pollTimer = setInterval(function () {
      fetch("/api/jobs/" + encodeURIComponent(jobId))
        .then(function (res) {
          if (!res.ok) return res.text().then(function (t) { throw new Error(parseErrorDetail(res, t)); });
          return res.json();
        })
        .then(function (data) {
          setProgressUi(data.progress, data.phase);
          if (data.status === "error") {
            clearPoll();
            setStatus(data.error || "전사 실패", true);
            setProgressVisible(false);
            if (submitBtn) submitBtn.disabled = false;
            refreshQuota();
            return;
          }
          if (data.status === "done") {
            clearPoll();
            setProgressUi(100, "완료");
            setProgressVisible(false);
            setStatus("완료! 편집 페이지로 이동합니다…");
            if (submitBtn) submitBtn.disabled = false;
            window.location.href = "/edit?job=" + encodeURIComponent(jobId);
          }
        })
        .catch(function (err) {
          clearPoll();
          setStatus(err.message || String(err), true);
          setProgressVisible(false);
          if (submitBtn) submitBtn.disabled = false;
          refreshQuota();
        });
    }, 400);
  }

  if (form && fileInput && submitBtn) {
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (form.classList.contains("quota-locked")) {
      setStatus("자막 자동 생성 사용 횟수가 모두 소진되었습니다.", true);
      return;
    }
    var f = fileInput.files[0];
    if (!f) {
      setStatus("파일을 선택해 주세요.", true);
      return;
    }

    var fd = new FormData();
    fd.append("file", f);
    fd.append("subtitle_format", (subtitleFormat && subtitleFormat.value) || "srt");
    fd.append("max_chars", (maxChars && maxChars.value) || "0");
    fd.append("max_eojeol", (maxEojeol && maxEojeol.value) || "0");
    fd.append("max_line_chars", "0");
    fd.append("time_offset_sec", (timeOffsetSec && timeOffsetSec.value) || "0");

    submitBtn.disabled = true;
    clearPoll();
    setStatus("서버에 작업을 등록하는 중…");
    setProgressVisible(true);
    setProgressUi(1, "업로드 중…");

    fetch("/api/jobs", {
      method: "POST",
      body: fd,
    })
      .then(function (res) {
        return res.text().then(function (text) {
          if (!res.ok) throw new Error(parseErrorDetail(res, text));
          try {
            return JSON.parse(text);
          } catch (e2) {
            throw new Error("서버 응답을 해석할 수 없습니다.");
          }
        });
      })
      .then(function (data) {
        if (!data.job_id) throw new Error("job_id가 없습니다.");
        setStatus("");
        runJob(normalizeJobId(data.job_id));
      })
      .catch(function (err) {
        setStatus(err.message || String(err), true);
        setProgressVisible(false);
      })
      .finally(function () {
        if (!pollTimer && submitBtn) submitBtn.disabled = false;
        refreshQuota();
      });
  });
  }

  var btnClearPreviewCache = document.getElementById("btnClearPreviewCache");
  if (btnClearPreviewCache) {
    btnClearPreviewCache.addEventListener("click", function () {
      if (!window.confirm("미리보기용 원본 사본을 모두 삭제할까요?")) return;
      btnClearPreviewCache.disabled = true;
      fetch("/api/preview-cache/clear", { method: "POST" })
        .then(function (res) {
          return res.json().then(function (data) {
            if (!res.ok) {
              var msg =
                typeof data.detail === "string"
                  ? data.detail
                  : Array.isArray(data.detail) && data.detail[0] && data.detail[0].msg
                    ? data.detail[0].msg
                    : "삭제 실패";
              throw new Error(msg);
            }
            return data;
          });
        })
        .then(function (data) {
          setStatus((data.message || "완료") + (data.path ? " · " + data.path : ""), false);
        })
        .catch(function (err) {
          setStatus(err.message || String(err), true);
        })
        .finally(function () {
          btnClearPreviewCache.disabled = false;
        });
    });
  }

  updateLabelFromInput();
  refreshQuota();
})();
