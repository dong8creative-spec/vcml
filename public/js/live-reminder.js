/**
 * 라이브 강의 — 카운트다운 · Google Meet · 1시간 전 알림
 */
;(function () {
  const REMIND_BEFORE_MS = 60 * 60 * 1000
  const MEET_OPEN_BEFORE_MS = 60 * 60 * 1000
  const LIVE_WINDOW_AFTER_MS = 3 * 60 * 60 * 1000
  const POLL_MS = 30 * 1000

  function parseLiveStart(course) {
    if (course?.live_starts_at) {
      const d = new Date(course.live_starts_at)
      if (!isNaN(d.getTime())) return d
    }
    if (course?.live_schedule) {
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
        font-size: 13px; font-weight: 700; color: #e65100;
        background: #fff3e0; border-radius: 8px; padding: 8px 10px;
        margin: 8px 0; text-align: center; font-variant-numeric: tabular-nums;
      }
      .live-countdown.is-live { color: #2e7d32; background: #e8f5e9; }
      .live-countdown.is-ended { color: #888; background: #f5f5f5; }
      .btn-meet {
        display: flex; align-items: center; justify-content: center; gap: 8px;
        width: 100%; padding: 10px 12px; border-radius: 8px; font-size: 14px;
        font-weight: 700; text-decoration: none; border: none; cursor: pointer;
        transition: .15s; box-sizing: border-box;
      }
      .btn-meet--active { background: #1a73e8; color: #fff; }
      .btn-meet--active:hover { background: #1557b0; }
      .btn-meet--waiting { background: #eef2ff; color: #5c67f2; cursor: default; }
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
        background: #fce8e8; color: #c62828; font-size: 12px; font-weight: 800;
        padding: 4px 10px; border-radius: 20px; margin-bottom: 12px;
      }
      .live-remind-title { font-size: 20px; font-weight: 900; line-height: 1.35; margin-bottom: 8px; }
      .live-remind-schedule { font-size: 14px; color: #888; margin-bottom: 16px; }
      .live-remind-countdown {
        font-size: 28px; font-weight: 900; color: #e65100;
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
      .mc-live-badge {
        position: absolute; top: 8px; left: 8px; background: #e53935; color: #fff;
        font-size: 11px; font-weight: 800; padding: 3px 8px; border-radius: 6px;
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
    const url = meetUrl(course.meet_code)
    const join = canJoinMeet(course, start)
    if (!url) {
      return `<span class="btn-meet btn-meet--waiting">Meet 링크 준비 중</span>`
    }
    if (join) {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="btn-meet btn-meet--active"><i class="ti ti-brand-google"></i> Google Meet 입장</a>`
    }
    const label = compact ? '1시간 전부터 입장 가능' : 'Google Meet (1시간 전부터 입장 가능)'
    return `<span class="btn-meet btn-meet--waiting"><i class="ti ti-brand-google"></i> ${label}</span>`
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
            ? `<a href="${url}" target="_blank" rel="noopener noreferrer" class="btn-meet btn-meet--active"><i class="ti ti-brand-google"></i> Google Meet 입장하기</a>`
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
    meetUrl,
    formatCountdown,
    canJoinMeet,
    meetButtonHtml,
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
