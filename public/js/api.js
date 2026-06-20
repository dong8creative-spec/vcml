// 공통 API 유틸
const GOOGLE_ICON_SVG = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.56 2.95-2.23 5.45-4.76 7.12l7.73 6c4.51-4.16 7.12-10.27 7.12-17.59z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>'

const API = {
  base: '/api',

  token() { return localStorage.getItem('tc_token') },
  user()  { try { return JSON.parse(localStorage.getItem('tc_user')) } catch { return null } },
  isLoggedIn() { return !!this.token() },
  isAdmin() { return this.user()?.role === 'admin' },

  login(token, user) {
    localStorage.setItem('tc_token', token)
    localStorage.setItem('tc_user', JSON.stringify(user))
  },
  logout() {
    localStorage.removeItem('tc_token')
    localStorage.removeItem('tc_user')
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

// 공통 헤더 UI 업데이트
function updateNav() {
  const user = API.user()
  const navRight = document.getElementById('nav-right')
  if (!navRight) return
  if (user) {
    navRight.innerHTML = `
      <a href="/mypage.html" class="btn-ghost">내 강의</a>
      ${user.role === 'admin' ? '<a href="/admin.html" class="btn-ghost">관리자</a>' : ''}
      <button class="btn-black" onclick="API.logout()">로그아웃</button>
    `
  } else {
    navRight.innerHTML = `
      <a href="/login.html" class="btn-ghost">로그인</a>
      <a href="/api/auth/google?next=${encodeURIComponent(location.pathname + location.search)}" class="nav-btn nav-btn-google">${GOOGLE_ICON_SVG} Google로 시작</a>
    `
  }
}

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

document.addEventListener('DOMContentLoaded', updateNav)
