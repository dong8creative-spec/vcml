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
  /** /api/transcription-quota 의 max_upload_mb (없으면 보수적 기본 28MB, Cloud Run 대응) */
  var serverMaxUploadMb = 28;

  /** 서버 main.py ALLOWED_EXT 와 동기화 */
  var AUDIO_EXT_RE = /\.(mp3|wav|m4a|aac|ogg|opus|flac|mpga|oga|aiff|aif|wma|caf)$/i;
  var FILE_TYPE_WARN_TEXT =
    "오디오 파일만 업로드할 수 있습니다. mp3·wav·m4a 등 음성 파일을 선택해 주세요. (영상·문서·이미지는 불가)";

  function isAllowedAudioFile(file) {
    if (!file || !file.name) return false;
    var t = (file.type || "").toLowerCase();
    if (t.indexOf("video/") === 0) return false;
    if (t.indexOf("audio/") === 0) return true;
    return AUDIO_EXT_RE.test(file.name);
  }

  function setFileTypeWarning(show) {
    var el = document.getElementById("fileTypeWarning");
    if (!el) return;
    el.textContent = show ? FILE_TYPE_WARN_TEXT : "";
    el.classList.toggle("hidden", !show);
  }

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
    if (data && typeof data.max_upload_mb === "number" && data.max_upload_mb > 0) {
      serverMaxUploadMb = data.max_upload_mb;
    }
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
    if (res.status === 413) {
      return (
        "파일 용량이 서버 한도를 넘습니다. " +
        serverMaxUploadMb +
        "MB 이하로 줄이거나, 긴 파일은 잘라서 나누어 올려 주세요. (클라우드 호스팅은 요청 크기 상한이 더 작을 수 있습니다.)"
      );
    }
    if (res.status === 404) {
      return "작업을 찾을 수 없습니다. 새로고침 후 다시 업로드하거나, 다른 탭에서 같은 작업을 열지 않았는지 확인해 주세요.";
    }
    if (res.status === 429) {
      return (
        "지금은 서버에서 다른 전사가 진행 중입니다. 잠시 후 다시 시도해 주세요. " +
        "(탭을 여러 개 열어 동시에 올리면 이 메시지가 날 수 있습니다.)"
      );
    }
    if (res.status === 503 || res.status === 502) {
      return "서버가 일시적으로 응답할 수 없습니다(과부하 또는 재시작). 잠시 후 다시 시도해 주세요.";
    }
    return text || res.statusText || "요청 실패";
  }

  function sleepMs(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  /**
   * 작업 상태 폴링. Cloud Run OOM/재시작·일시 과부하 시 502/503 이 잠깐 나올 수 있어
   * 짧은 백오프로 재시도한다(한 번의 폴링 틱 안에서만).
   */
  function fetchJobStatus(jobId) {
    var url = "/api/jobs/" + encodeURIComponent(jobId);
    var attempt = 0;
    var maxAttempts = 14;

    function tryOnce() {
      return fetch(url, { credentials: "same-origin" }).then(function (res) {
        if (
          (res.status === 502 || res.status === 503 || res.status === 504) &&
          attempt < maxAttempts - 1
        ) {
          attempt += 1;
          var wait = Math.min(1500 + attempt * 800, 12000);
          setProgressUi(
            Math.min(12 + attempt * 3, 45),
            "서버 연결 대기 중… (" + attempt + "/" + maxAttempts + ")"
          );
          return sleepMs(wait).then(tryOnce);
        }
        return res;
      });
    }

    return tryOnce();
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
    if (f) setFileTypeWarning(!isAllowedAudioFile(f));
    else setFileTypeWarning(false);
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
      if (!isAllowedAudioFile(file)) {
        setFileTypeWarning(true);
        setStatus("", false);
        return;
      }
      setFileTypeWarning(false);
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
      fetchJobStatus(jobId)
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
    if (!isAllowedAudioFile(f)) {
      setFileTypeWarning(true);
      setStatus(FILE_TYPE_WARN_TEXT, true);
      return;
    }
    setFileTypeWarning(false);
    var maxBytes = serverMaxUploadMb * 1024 * 1024;
    if (f.size > maxBytes) {
      setStatus(
        "파일이 너무 큽니다(약 " +
          serverMaxUploadMb +
          "MB 이하만 가능). 긴 녹음은 잘라서 올려 주세요.",
        true
      );
      return;
    }

    submitBtn.disabled = true;
    clearPoll();
    setStatus("서버에 작업을 등록하는 중…");
    setProgressVisible(true);
    setProgressUi(1, "업로드 중…");

    function buildJobFormData() {
      var x = new FormData();
      x.append("file", f);
      x.append("subtitle_format", (subtitleFormat && subtitleFormat.value) || "srt");
      x.append("max_chars", (maxChars && maxChars.value) || "0");
      x.append("max_eojeol", (maxEojeol && maxEojeol.value) || "0");
      x.append("max_line_chars", "0");
      x.append("time_offset_sec", (timeOffsetSec && timeOffsetSec.value) || "0");
      return x;
    }

    function postJobsOnce() {
      return fetch("/api/jobs", {
        method: "POST",
        body: buildJobFormData(),
        credentials: "same-origin",
      });
    }

    function postJobsWith429Retry(attempt) {
      var maxR = 10;
      return postJobsOnce().then(function (res) {
        return res.text().then(function (text) {
          if (res.status === 429 && attempt < maxR - 1) {
            setProgressUi(
              Math.min(5 + attempt * 3, 32),
              "다른 전사가 끝날 때까지 대기 중… 자동 재시도 (" + (attempt + 1) + "/" + maxR + ")"
            );
            return sleepMs(2000 + attempt * 800).then(function () {
              return postJobsWith429Retry(attempt + 1);
            });
          }
          if (!res.ok) throw new Error(parseErrorDetail(res, text));
          try {
            return JSON.parse(text);
          } catch (e2) {
            throw new Error("서버 응답을 해석할 수 없습니다.");
          }
        });
      });
    }

    postJobsWith429Retry(0)
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

  updateLabelFromInput();
  refreshQuota();
})();
