/**
 * 라이브 강의 — 카운트다운 · Google Meet · 1시간 전 알림 · 30분 전 입장
 */
;(function () {
  const REMIND_BEFORE_MS = 60 * 60 * 1000
  const MEET_OPEN_BEFORE_MS = 30 * 60 * 1000
  const LIVE_WINDOW_AFTER_MS = 3 * 60 * 60 * 1000
  const POLL_MS = 30 * 1000
  const MEET_WAIT_LABEL = '30분 전부터 입장 가능'

  const GOOGLE_ICON_SVG = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" class="meet-google-icon"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.56 2.95-2.23 5.45-4.76 7.12l7.73 6c4.51-4.16 7.12-10.27 7.12-17.59z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>'

  function googleMeetIcon() {
    if (typeof window !== 'undefined' && window.GOOGLE_ICON_SVG) {
      return String(window.GOOGLE_ICON_SVG).replace('<svg ', '<svg class="meet-google-icon" ')
    }
    return GOOGLE_ICON_SVG
  }

  /** ko-KR 예: 2026. 6. 27. 오후 2:00:00 */
  function parseKoreanLocaleDate(str) {
    const s = String(str || '').trim()
    if (!s) return null
    const m = s.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(오전|오후)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/)
    if (!m) return null
    const year = parseInt(m[1], 10)
    const month = parseInt(m[2], 10) - 1
    const day = parseInt(m[3], 10)
    let hour = parseInt(m[5], 10)
    const minute = parseInt(m[6], 10)
    const second = parseInt(m[7] || '0', 10)
    if (m[4] === '오후' && hour !== 12) hour += 12
    if (m[4] === '오전' && hour === 12) hour = 0
    const d = new Date(year, month, day, hour, minute, second)
    return isNaN(d.getTime()) ? null : d
  }

  function parseLiveStart(course) {
    if (course?.live_starts_at) {
      const d = new Date(course.live_starts_at)
      if (!isNaN(d.getTime())) return d
    }
    if (course?.live_schedule) {
      const fromKo = parseKoreanLocaleDate(course.live_schedule)
      if (fromKo) return fromKo
      const d = new Date(course.live_schedule)
      if (!isNaN(d.getTime())) return d
    }
    return null
  }

  function meetUrl(code) {
    if (!code) return null
    const trimmed = String(code).trim()
    if (/^https?:\/\//i.test(trimmed)) return trimmed
    return 'https://meet.google.com/' + trimmed.replace(/\s+/g, '')
  }

  function formatCountdown(ms) {
    if (ms <= 0) return '곧 시작합니다'
    const totalSec = Math.floor(ms / 1000)
    const days = Math.floor(totalSec / 86400)
    const hours = Math.floor((totalSec % 86400) / 3600)
    const mins = Math.floor((totalSec % 3600) / 60)
    const secs = totalSec % 60
    const pad = n => String(n).padStart(2, '0')
    if (days > 0) return `${days}일 ${pad(hours)}:${pad(mins)}:${pad(secs)}`
    return `${pad(hours)}:${pad(mins)}:${pad(secs)}`
  }

  function canJoinMeet(course, start) {
    if (!course?.meet_code || course.live_status === 'ended') return false
    if (!start) return true
    const now = Date.now()
    const t = start.getTime()
    return now >= t - MEET_OPEN_BEFORE_MS && now <= t + LIVE_WINDOW_AFTER_MS
  }

  function isWithinReminderWindow(course, start) {
    if (!start || course.live_status === 'ended') return false
    const now = Date.now()
    const t = start.getTime()
    return now >= t - REMIND_BEFORE_MS && now <= t + LIVE_WINDOW_AFTER_MS
  }

  function dismissKey(courseId, startMs) {
    return `live-remind-dismiss:${courseId}:${startMs}`
  }

  function injectStyles() {
    if (document.getElementById('live-reminder-styles')) return
    const style = document.createElement('style')
    style.id = 'live-reminder-styles'
    style.textContent = `
      .live-countdown {
        font-size: 13px; font-weight: 700; color: #111;
        background: #f5f5f5; border-radius: 8px; padding: 8px 10px;
        margin: 8px 0; text-align: center; font-variant-numeric: tabular-nums;
      }
      .live-countdown.is-live { color: #111; background: #eee; }
      .live-countdown.is-ended { color: #888; background: #f5f5f5; }
      .btn-meet {
        display: flex; align-items: center; justify-content: center; gap: 8px;
        width: 100%; padding: 10px 12px; border-radius: 8px; font-size: 14px;
        font-weight: 700; text-decoration: none; border: none; cursor: pointer;
        transition: .15s; box-sizing: border-box;
      }
      .btn-meet--active { background: #1a73e8; color: #fff; }
      .btn-meet--active:hover { background: #1557b0; }
      .btn-meet--waiting {
        background: #e8f0fe; color: #1a73e8; border: 1px solid #c5d9f7;
        cursor: default;
      }
      .btn-meet--material-active {
        background: #111; color: #fff; border: none;
      }
      .btn-meet--material-active:hover { background: #333; }
      .btn-meet--material-waiting {
        background: #f5f5f5; color: #888; border: 1px solid #e8e8e8;
        cursor: default; font-weight: 600;
      }
      .btn-meet--material { margin: 8px 0; }
      .btn-meet__icon { display: inline-flex; align-items: center; flex-shrink: 0; line-height: 0; }
      .btn-meet .meet-google-icon { display: block; width: 18px; height: 18px; }
      .live-remind-overlay {
        position: fixed; inset: 0; z-index: 10000;
        background: rgba(0,0,0,.45); display: flex; align-items: center;
        justify-content: center; padding: 20px;
      }
      .live-remind-modal {
        background: #fff; border-radius: 16px; max-width: 420px; width: 100%;
        padding: 28px 24px; box-shadow: 0 20px 60px rgba(0,0,0,.2);
        animation: liveRemindIn .25s ease;
      }
      @keyframes liveRemindIn {
        from { opacity: 0; transform: translateY(12px) scale(.98); }
        to { opacity: 1; transform: none; }
      }
      .live-remind-badge {
        display: inline-flex; align-items: center; gap: 6px;
        background: #f0f0f0; color: #111; font-size: 12px; font-weight: 800;
        padding: 4px 10px; border-radius: 20px; margin-bottom: 12px;
      }
      .live-remind-title { font-size: 20px; font-weight: 900; line-height: 1.35; margin-bottom: 8px; }
      .live-remind-schedule { font-size: 14px; color: #888; margin-bottom: 16px; }
      .live-remind-countdown {
        font-size: 28px; font-weight: 900; color: #111;
        text-align: center; margin: 16px 0; font-variant-numeric: tabular-nums;
      }
      .live-remind-actions { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
      .live-remind-dismiss {
        background: none; border: none; color: #aaa; font-size: 13px;
        cursor: pointer; padding: 8px; margin-top: 4px;
      }
      .live-remind-dismiss:hover { color: #666; }
      .my-course-card--live { cursor: default; }
      .my-course-card--live:hover { transform: none; }
      .live-extra-actions { display: flex; flex-direction: column; gap: 8px; width: 100%; }
      .btn-live-extra {
        display: flex; align-items: center; justify-content: center; gap: 6px;
        width: 100%; padding: 10px 12px; border-radius: 8px; font-size: 14px;
        font-weight: 700; text-decoration: none; border: none; cursor: pointer;
        box-sizing: border-box; transition: .15s;
      }
      .btn-live-extra--replay {
        background: #fff;
        color: #111;
        border: 1px solid #e8e8e8;
        gap: 8px;
      }
      .btn-live-extra--replay:hover { background: #fafafa; border-color: #ddd; }
      .btn-live-extra--replay .replay-youtube-icon {
        flex-shrink: 0;
        display: block;
        width: 22px;
        height: 22px;
      }
      .btn-live-extra--replay.btn-live-extra--locked {
        background: #fff;
        color: #666;
        border: 1px solid #eee;
        cursor: default;
      }
      .btn-live-extra--replay.btn-live-extra--locked .replay-youtube-icon { opacity: 0.45; }
      .btn-live-extra--material { background: #f5f5f5; color: #111; border: 1px solid #ddd; }
      .btn-live-extra--material:hover { background: #eee; }
      .btn-live-extra--locked {
        background: #f5f5f5; color: #999; border: 1px solid #e8e8e8;
        cursor: default; font-weight: 600;
      }
      .btn-live-extra--replay-pending {
        flex-direction: column; gap: 4px; line-height: 1.4;
        padding: 12px; text-align: center;
      }
      .btn-live-extra__sub {
        font-size: 11px; font-weight: 500; color: #888;
      }
    `
    document.head.appendChild(style)
  }

  function updateCountdownElements() {
    document.querySelectorAll('[data-live-countdown]').forEach(el => {
      const startMs = Number(el.dataset.liveStartsAt)
      const ended = el.dataset.liveEnded === '1'
      if (ended || !startMs) {
        el.textContent = ended ? '종료된 라이브' : '일정 미정'
        el.classList.add('is-ended')
        return
      }
      const diff = startMs - Date.now()
      if (diff <= 0 && diff > -LIVE_WINDOW_AFTER_MS) {
        el.textContent = '라이브 진행 중'
        el.classList.add('is-live')
        el.classList.remove('is-ended')
      } else if (diff <= -LIVE_WINDOW_AFTER_MS) {
        el.textContent = '라이브 종료'
        el.classList.add('is-ended')
      } else {
        el.textContent = '시작까지 ' + formatCountdown(diff)
        el.classList.remove('is-live', 'is-ended')
      }
    })

    document.querySelectorAll('[data-live-meet-wrap]').forEach(wrap => {
      try {
        const raw = wrap.getAttribute('data-live-course')
        const course = raw ? JSON.parse(decodeURIComponent(raw)) : {}
        const start = parseLiveStart(course)
        const next = meetButtonHtml(course, start, true)
        if (wrap.innerHTML.trim() !== next) wrap.innerHTML = next
      } catch (_) {}
    })
  }

  let countdownTimer = null
  function startCountdownTicker() {
    if (countdownTimer) return
    updateCountdownElements()
    countdownTimer = setInterval(updateCountdownElements, 1000)
  }

  function meetButtonHtml(course, start, compact) {
    if (course?.live_status === 'ended' || course?.live_resources?.live_ended) {
      return `<span class="btn-meet btn-meet--waiting">라이브 종료</span>`
    }
    const url = meetUrl(course.meet_code)
    const join = canJoinMeet(course, start)
    const icon = `<span class="btn-meet__icon">${googleMeetIcon()}</span>`
    if (!url) {
      return `<span class="btn-meet btn-meet--waiting">${icon} Meet 링크 준비 중</span>`
    }
    if (join) {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="btn-meet btn-meet--active">${icon} Google Meet 입장</a>`
    }
    const label = compact ? MEET_WAIT_LABEL : `Google Meet (${MEET_WAIT_LABEL})`
    return `<span class="btn-meet btn-meet--waiting">${icon} ${label}</span>`
  }

  function materialButtonHtml(course) {
    const r = course?.live_resources
    if (!r?.material_configured) {
      return `<span class="btn-meet btn-meet--material btn-meet--material-waiting"><i class="ti ti-download"></i> 강의자료 대기중</span>`
    }
    if (r.material_available) {
      return `<a href="#" role="button" class="btn-meet btn-meet--material btn-meet--material-active" onclick="event.preventDefault();LiveSession.openMaterial('${escapeHtml(course.id)}')"><i class="ti ti-download"></i> 강의자료 다운로드</a>`
    }
    const hint = r.live_lecture_date ? ` (${r.live_lecture_date} 당일)` : ' (강의 당일)'
    return `<span class="btn-meet btn-meet--material btn-meet--material-waiting"><i class="ti ti-download"></i> 강의자료 다운로드${hint}</span>`
  }

  function youtubeReplayIcon() {
    return `<svg class="replay-youtube-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="#FF0000" d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z"/><path fill="#FFF" d="M9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`
  }

  function replayButtonContentHtml() {
    return `${youtubeReplayIcon()}<span>강의 다시보기</span>`
  }

  function replayPendingHtml(course) {
    const r = course?.live_resources
    const when = r?.replay_opens_label || '다음 날 오후 1시'
    return `<span class="btn-live-extra btn-live-extra--replay btn-live-extra--locked btn-live-extra--replay-pending">
      <span style="display:inline-flex;align-items:center;justify-content:center;gap:8px">${replayButtonContentHtml()}</span>
      <span class="btn-live-extra__sub">${escapeHtml(when)}에 제공됩니다</span>
    </span>`
  }

  function liveResourceButtonsHtml(course, { includeMaterial = true, enrolled } = {}) {
    const r = course?.live_resources
    if (!r) return ''
    const isEnrolled = enrolled ?? course?.enrolled
    if (isEnrolled === false) return ''
    const parts = []
    if (r.replay_available) {
      parts.push(`<button type="button" class="btn-live-extra btn-live-extra--replay" onclick="LiveSession.openReplay('${escapeHtml(course.id)}')">${replayButtonContentHtml()}</button>`)
    } else if (r.replay_pending) {
      parts.push(replayPendingHtml(course))
    }
    if (includeMaterial && r.material_configured) {
      if (r.material_available) {
        parts.push(`<a href="#" role="button" class="btn-live-extra btn-live-extra--material" onclick="event.preventDefault();LiveSession.openMaterial('${escapeHtml(course.id)}')"><i class="ti ti-download"></i> 자료 다운로드</a>`)
      } else {
        const hint = r.live_lecture_date ? ` (${r.live_lecture_date} 당일)` : ' (강의 당일)'
        parts.push(`<span class="btn-live-extra btn-live-extra--material btn-live-extra--locked"><i class="ti ti-download"></i> 자료 다운로드${hint}</span>`)
      }
    }
    if (!parts.length) return ''
    return `<div class="live-extra-actions">${parts.join('')}</div>`
  }

  function openExternalResource(apiPath, fallbackError) {
    if (!window.API?.isLoggedIn?.()) {
      location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search)
      return
    }
    const tab = window.open('about:blank', '_blank')
    if (!tab) {
      const blocked = '새 탭을 열 수 없습니다. 브라우저 팝업 차단을 해제해 주세요.'
      if (typeof toast === 'function') toast(blocked, 'error')
      else alert(blocked)
      return
    }
    try { tab.opener = null } catch (_) {}
    API.get(apiPath)
      .then(({ url }) => {
        tab.location.href = url
      })
      .catch((e) => {
        try { tab.close() } catch (_) {}
        const msg = e.message || fallbackError
        if (typeof toast === 'function') toast(msg, 'error')
        else alert(msg)
      })
  }

  function openReplay(courseId) {
    openExternalResource('/my/courses/' + courseId + '/live-replay', '다시보기를 열 수 없습니다.')
  }

  function openMaterial(courseId) {
    openExternalResource('/my/courses/' + courseId + '/live-material', '자료를 다운로드할 수 없습니다.')
  }

  function showReminderPopup(course, start) {
    if (document.querySelector('.live-remind-overlay')) return
    const startMs = start.getTime()
    const url = meetUrl(course.meet_code)
    const join = canJoinMeet(course, start)

    const overlay = document.createElement('div')
    overlay.className = 'live-remind-overlay'
    overlay.innerHTML = `
      <div class="live-remind-modal" role="dialog" aria-labelledby="live-remind-heading">
        <div class="live-remind-badge"><i class="ti ti-broadcast"></i> 라이브 1시간 전</div>
        <div class="live-remind-title" id="live-remind-heading">${escapeHtml(course.title)}</div>
        <div class="live-remind-schedule">${escapeHtml(course.live_schedule || '')}</div>
        <div class="live-remind-countdown" data-live-countdown data-live-starts-at="${startMs}"></div>
        <div class="live-remind-actions">
          ${join && url
            ? `<a href="${url}" target="_blank" rel="noopener noreferrer" class="btn-meet btn-meet--active"><span class="btn-meet__icon">${googleMeetIcon()}</span> Google Meet 입장하기</a>`
            : `<a href="/mypage.html" class="btn-meet btn-meet--active"><i class="ti ti-book"></i> 내 강의에서 확인</a>`
          }
        </div>
        <button type="button" class="live-remind-dismiss">닫기</button>
      </div>`
    overlay.querySelector('.live-remind-dismiss').onclick = () => {
      sessionStorage.setItem(dismissKey(course.id, startMs), '1')
      overlay.remove()
    }
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        sessionStorage.setItem(dismissKey(course.id, startMs), '1')
        overlay.remove()
      }
    })
    document.body.appendChild(overlay)
    updateCountdownElements()
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  let activePopupCourseId = null

  async function checkLiveReminders() {
    if (!window.API?.isLoggedIn?.()) return
    try {
      const sessions = await API.get('/my/live-sessions')
      startCountdownTicker()
      for (const course of sessions) {
        const start = parseLiveStart(course)
        if (!isWithinReminderWindow(course, start)) continue
        const startMs = start.getTime()
        if (sessionStorage.getItem(dismissKey(course.id, startMs))) continue
        if (activePopupCourseId === course.id) continue
        activePopupCourseId = course.id
        showReminderPopup(course, start)
        break
      }
    } catch (_) {}
  }

  window.LiveSession = {
    parseLiveStart,
    parseKoreanLocaleDate,
    meetUrl,
    formatCountdown,
    canJoinMeet,
    meetButtonHtml,
    materialButtonHtml,
    liveResourceButtonsHtml,
    openReplay,
    openMaterial,
    startCountdownTicker,
  }

  function initLiveReminders() {
    injectStyles()
    if (!window.API?.isLoggedIn?.()) return
    checkLiveReminders()
    setInterval(checkLiveReminders, POLL_MS)
    startCountdownTicker()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLiveReminders)
  } else {
    initLiveReminders()
  }
})()
