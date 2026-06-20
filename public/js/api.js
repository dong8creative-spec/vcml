// 공통 API 유틸
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
    if (!res.ok) throw new Error(data.error || '오류가 발생했습니다.')
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
      <a href="/login.html?tab=register" class="btn-black">무료 시작</a>
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
