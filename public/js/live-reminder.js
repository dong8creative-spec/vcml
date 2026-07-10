/**
 * 라이브 강의 — 카운트다운 · Google Meet · 1시간 전 알림 · 2시간 전 입장
 */
if (!window.LiveSession) (function () {
  const REMIND_BEFORE_MS = 60 * 60 * 1000
  const MEET_OPEN_BEFORE_MS = 2 * 60 * 60 * 1000
  const LIVE_WINDOW_AFTER_MS = 3 * 60 * 60 * 1000
  const POLL_MS = 30 * 1000
  const MEET_WAIT_LABEL = '2시간 전부터 입장 가능'

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

  function canJoinMeet(course, start, at = new Date()) {
    return isMeetJoinAvailableClient(course, start, at)
  }

  function parseLiveEnd(course, start) {
    if (course?.live_ends_at) {
      const d = new Date(course.live_ends_at)
      if (!isNaN(d.getTime())) return d
    }
    if (course?.live_resources?.live_ends_at) {
      const d = new Date(course.live_resources.live_ends_at)
      if (!isNaN(d.getTime())) return d
    }
    if (!start) return null
    return new Date(start.getTime() + LIVE_WINDOW_AFTER_MS)
  }

  function isMeetJoinAvailableClient(course, start, at = new Date()) {
    if (course?.live_status === 'ended' || course?.live_ended || course?.live_resources?.live_ended) return false
    if (!String(course?.meet_code || '').trim()) return false
    if (!start) return false
    const now = at.getTime()
    const t = start.getTime()
    const endAt = parseLiveEnd(course, start)
    const endMs = endAt ? endAt.getTime() : t + LIVE_WINDOW_AFTER_MS
    return now >= t - MEET_OPEN_BEFORE_MS && now <= endMs
  }

  function isWithinReminderWindow(course, start) {
    if (!start || course.live_status === 'ended' || course.live_ended || course.live_resources?.live_ended) return false
    const now = Date.now()
    const t = start.getTime()
    const endAt = parseLiveEnd(course, start)
    const endMs = endAt ? endAt.getTime() : t + LIVE_WINDOW_AFTER_MS
    return now >= t - REMIND_BEFORE_MS && now <= endMs
  }

  let whenReadyResolve
  const whenReady = new Promise(resolve => { whenReadyResolve = resolve })

  function buildLiveMeetPayload(course) {
    return encodeURIComponent(JSON.stringify({
      meet_code: course?.meet_code,
      live_status: course?.live_status,
      live_ended: course?.live_ended,
      live_starts_at: course?.live_starts_at,
      live_ends_at: course?.live_ends_at || course?.live_resources?.live_ends_at,
      live_schedule: course?.live_schedule,
      live_resources: course?.live_resources,
    }))
  }

  function enrolledCompleteHtml(compact) {
    if (compact) {
      return `<span class="btn-meet btn-meet--enrolled"><i class="ti ti-check"></i> 신청 완료</span>`
    }
    return `<div class="btn-enroll enrolled buy-live-enrolled"><i class="ti ti-check"></i> 신청 완료</div>`
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
        const enrolledMode = wrap.getAttribute('data-live-meet-enrolled') === '1'
        const compact = wrap.getAttribute('data-live-meet-compact') !== '0'
        const next = meetButtonHtml(course, start, compact, { enrolledMode })
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

  function meetButtonHtml(course, start, compact, options = {}) {
    const { enrolledMode = false } = options
    if (course?.live_status === 'ended' || course?.live_ended || course?.live_resources?.live_ended) {
      return `<span class="btn-meet btn-meet--waiting">라이브 종료</span>`
    }
    const url = meetUrl(course.meet_code)
    const join = canJoinMeet(course, start)
    const icon = `<span class="btn-meet__icon">${googleMeetIcon()}</span>`
    if (!url) {
      if (enrolledMode) return enrolledCompleteHtml(compact)
      return `<span class="btn-meet btn-meet--waiting">${icon} Meet 링크 준비 중</span>`
    }
    if (join) {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="btn-meet btn-meet--active">${icon} Google Meet 입장</a>`
    }
    if (enrolledMode) return enrolledCompleteHtml(compact)
    const label = compact ? MEET_WAIT_LABEL : `Google Meet (${MEET_WAIT_LABEL})`
    return `<span class="btn-meet btn-meet--waiting">${icon} ${label}</span>`
  }

  function materialButtonHtml(course) {
    const r = course?.live_resources
    if (!r?.material_available) return ''
    return `<button type="button" class="btn-enroll btn-enroll--material" onclick="event.stopPropagation();LiveSession.openMaterial('${escapeHtml(course.id)}')"><i class="ti ti-download"></i> 강의자료 다운로드</button>`
  }

  function youtubeReplayIcon() {
    return `<svg class="replay-youtube-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="#FF0000" d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z"/><path fill="#FFF" d="M9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`
  }

  function replayButtonContentHtml(label = '강의 다시보기') {
    return `${youtubeReplayIcon()}<span>${escapeHtml(label)}</span>`
  }

  function replayPendingHtml(course, { label = '강의 다시보기', compact = false } = {}) {
    const r = course?.live_resources
    const when = r?.replay_opens_label || '다음 날 오후 1시'
    if (compact) {
      return `<div class="btn-enroll btn-enroll--replay btn-enroll--replay-pending" aria-disabled="true">
        <i class="ti ti-player-play"></i> ${escapeHtml(label)}
        <span class="btn-enroll__sub">${escapeHtml(when)}에 제공</span>
      </div>`
    }
    return `<span class="btn-live-extra btn-live-extra--replay btn-live-extra--locked btn-live-extra--replay-pending">
      <span style="display:inline-flex;align-items:center;justify-content:center;gap:8px">${replayButtonContentHtml(label)}</span>
      <span class="btn-live-extra__sub">${escapeHtml(when)}에 제공됩니다</span>
    </span>`
  }

  function endedReplayButtonHtml(course, { label = '다시보기' } = {}) {
    const r = course?.live_resources
    if (!r?.replay_configured) return ''
    if (r.replay_available) {
      const slug = escapeHtml(course.slug || '')
      return `<button type="button" class="btn-enroll btn-enroll--replay" onclick="LiveSession.openReplay(null, '${slug}')">${youtubeReplayIcon()} ${escapeHtml(label)}</button>`
    }
    if (r.replay_pending) return replayPendingHtml(course, { label, compact: true })
    return ''
  }

  function liveResourceButtonsHtml(course, { includeReplay = true } = {}) {
    const r = course?.live_resources
    if (!r) return ''
    const parts = []
    if (includeReplay) {
      if (r.replay_available) {
        const slug = course.slug ? `, '${escapeHtml(course.slug)}'` : ''
        parts.push(`<button type="button" class="btn-live-extra btn-live-extra--replay" onclick="LiveSession.openReplay('${escapeHtml(course.id)}'${slug})">${replayButtonContentHtml()}</button>`)
      } else if (r.replay_pending) {
        parts.push(replayPendingHtml(course))
      }
    }
    if (!parts.length) return ''
    return `<div class="live-extra-actions">${parts.join('')}</div>`
  }

  function openExternalResource(apiPath, fallbackError, { requireLogin = true } = {}) {
    if (requireLogin && !window.API?.isLoggedIn?.()) {
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
      .then(({ url }) => { tab.location.href = url })
      .catch((e) => {
        try { tab.close() } catch (_) {}
        const msg = e.message || fallbackError
        if (typeof toast === 'function') toast(msg, 'error')
        else alert(msg)
      })
  }

  function openReplay(courseId, slug) {
    const path = slug
      ? '/courses/' + encodeURIComponent(slug) + '/live-replay'
      : '/my/courses/' + encodeURIComponent(courseId) + '/live-replay'
    openExternalResource(path, '다시보기를 열 수 없습니다.', { requireLogin: true })
  }

  function openMaterial(courseId) {
    API.get('/my/courses/' + encodeURIComponent(courseId) + '/live-material')
      .then(({ url }) => { location.href = url })
      .catch((e) => {
        const msg = e.message || '자료를 다운로드할 수 없습니다.'
        if (typeof toast === 'function') toast(msg, 'error')
        else alert(msg)
      })
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

  function initLiveReminders() {
    startCountdownTicker()
    whenReadyResolve()
    document.dispatchEvent(new CustomEvent('live-session-ready'))
    if (!window.API?.isLoggedIn?.()) return
    checkLiveReminders()
    setInterval(checkLiveReminders, POLL_MS)
  }

  window.LiveSession = {
    whenReady,
    parseLiveStart,
    parseKoreanLocaleDate,
    meetUrl,
    formatCountdown,
    canJoinMeet,
    buildLiveMeetPayload,
    meetButtonHtml,
    materialButtonHtml,
    liveResourceButtonsHtml,
    endedReplayButtonHtml,
    openReplay,
    openMaterial,
    startCountdownTicker,
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLiveReminders)
  } else {
    initLiveReminders()
  }
})()
