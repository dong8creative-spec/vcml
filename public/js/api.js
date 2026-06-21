// 공통 API 유틸
const GOOGLE_ICON_SVG = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.56 2.95-2.23 5.45-4.76 7.12l7.73 6c4.51-4.16 7.12-10.27 7.12-17.59z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>'

const API = {
  base: '/api',

  token() { return localStorage.getItem('tc_token') },
  user()  { try { return JSON.parse(localStorage.getItem('tc_user')) } catch { return null } },
  isLoggedIn() { return !!this.token() },
  isAdmin() {
    const u = this.user()
    if (!u) return false
    if (u.can_access_admin !== undefined) return !!u.can_access_admin
    return u.role === 'admin'
  },

  login(token, user) {
    localStorage.setItem('tc_token', token)
    localStorage.setItem('tc_user', JSON.stringify(user))
    if (typeof renderHeaderAuth === 'function') renderHeaderAuth()
    if (typeof renderChromeAuth === 'function') renderChromeAuth()
    if (typeof syncAdminFab === 'function') syncAdminFab().catch(() => {})
  },
  logout() {
    localStorage.removeItem('tc_token')
    localStorage.removeItem('tc_user')
    if (typeof syncAdminFab === 'function') syncAdminFab().catch(() => {})
    location.href = '/'
  },

  async req(method, path, body) {
    const res = await fetch(this.base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token() ? { Authorization: 'Bearer ' + this.token() } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    })
    const data = await res.json()
    if (!res.ok) {
      const err = new Error(data.error || '오류가 발생했습니다.')
      if (data.timed_out) err.timed_out = true
      if (data.code) err.code = data.code
      throw err
    }
    return data
  },

  get(path)         { return this.req('GET', path) },
  post(path, body)  { return this.req('POST', path, body) },
  patch(path, body) { return this.req('PATCH', path, body) },
  del(path)         { return this.req('DELETE', path) },
}

window.API = API
window.GOOGLE_ICON_SVG = GOOGLE_ICON_SVG

function googleMeetIconHtml(size = 28) {
  return GOOGLE_ICON_SVG
    .replace('<svg ', `<svg class="meet-google-icon" width="${size}" height="${size}" `)
}

/** 라이브 강의 썸네일·히어로용 Google Meet 딱지 */
function googleMeetBadgeHtml(className = 'badge-live') {
  return `<span class="${className}">${googleMeetIconHtml()}<span class="badge-meet-label">Google Meet</span></span>`
}

window.googleMeetBadgeHtml = googleMeetBadgeHtml
window.googleMeetIconHtml = googleMeetIconHtml

function buildGoogleAuthUrl(next, memberType) {
  const params = new URLSearchParams()
  const safeNext = next && String(next).startsWith('/') && !String(next).startsWith('//') ? next : '/'
  params.set('next', safeNext)
  params.set('member_type', memberType)
  return '/api/auth/google?' + params.toString()
}

function readGoogleMemberTypeFromPage() {
  return document.querySelector('input[name="google-member-type"]:checked')?.value
    || document.querySelector('input[name="member-type"]:checked')?.value
    || null
}

function decodeNextPath(nextPath) {
  if (nextPath == null || nextPath === '') return location.pathname + location.search
  try {
    return decodeURIComponent(String(nextPath))
  } catch {
    return String(nextPath)
  }
}

function showGoogleMemberTypeModal(nextPath) {
  let overlay = document.getElementById('google-member-modal')
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.id = 'google-member-modal'
    overlay.className = 'google-member-modal'
    overlay.innerHTML = `
      <div class="google-member-dialog" role="dialog" aria-labelledby="google-member-title">
        <button type="button" class="google-member-close" aria-label="닫기">&times;</button>
        <div class="google-member-title" id="google-member-title">가입 유형 선택</div>
        <div class="google-member-sub">Google 계정 연결 전에 선택해주세요. <span class="hint">(가입 후 변경 불가)</span></div>
        <div class="google-member-type-row">
          <label class="google-member-type-card">
            <input type="radio" name="google-member-modal-type" value="student" checked />
            <div class="google-member-type-title">수강생</div>
            <div class="google-member-type-desc">온라인 강의 수강·학습</div>
          </label>
          <label class="google-member-type-card">
            <input type="radio" name="google-member-modal-type" value="client" />
            <div class="google-member-type-title">의뢰인</div>
            <div class="google-member-type-desc">클라이언츠 · 매칭</div>
          </label>
        </div>
        <button type="button" class="google-member-continue btn-google">Google 계정 선택하기</button>
      </div>`
    document.body.appendChild(overlay)
    overlay.querySelector('.google-member-close').onclick = () => overlay.classList.remove('is-open')
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.remove('is-open')
    })
    overlay.querySelector('.google-member-continue').onclick = () => {
      const mt = overlay.querySelector('input[name="google-member-modal-type"]:checked')?.value
      if (!mt) {
        toast('가입 유형을 선택해주세요.', 'error')
        return
      }
      const next = overlay.dataset.next || '/'
      location.href = buildGoogleAuthUrl(next, mt)
    }
  }
  overlay.dataset.next = decodeNextPath(nextPath)
  overlay.classList.add('is-open')
}

function startGoogleLogin(nextPath) {
  const next = decodeNextPath(nextPath)
  if (document.getElementById('google-member-type-section')) {
    const mt = readGoogleMemberTypeFromPage()
    if (!mt) {
      toast('가입 유형(수강생/의뢰인)을 선택해주세요.', 'error')
      return
    }
    location.href = buildGoogleAuthUrl(next, mt)
    return
  }
  showGoogleMemberTypeModal(next)
}

window.buildGoogleAuthUrl = buildGoogleAuthUrl
window.startGoogleLogin = startGoogleLogin

function comingSoon(e) {
  if (e) e.preventDefault()
  toast('준비 중입니다. 곧 오픈할 예정이에요.', 'info')
}

function toast(msg, type = 'info') {
  const el = document.createElement('div')
  el.className = `toast toast-${type}`
  el.textContent = msg
  document.body.appendChild(el)
  setTimeout(() => el.classList.add('show'), 10)
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300) }, 3000)
}

window.toast = toast
window.comingSoon = comingSoon

;(function () {
  const s = document.createElement('script')
  s.src = '/js/admin-fab.js?v=1'
  s.defer = true
  document.head.appendChild(s)
})()
;(function () {
  const s = document.createElement('script')
  s.src = '/js/live-reminder.js?v=13'
  s.defer = true
  document.head.appendChild(s)
})()
;(function () {
  const s = document.createElement('script')
  s.src = '/js/welcome-popup.js'
  s.defer = true
  document.head.appendChild(s)
})()
;(function () {
  const s = document.createElement('script')
  s.src = '/js/mobile-nav.js?v=6'
  s.defer = true
  document.head.appendChild(s)
})()
;(function () {
  const s = document.createElement('script')
  s.src = '/js/phone-prompt.js?v=6'
  s.defer = true
  document.head.appendChild(s)
})()
