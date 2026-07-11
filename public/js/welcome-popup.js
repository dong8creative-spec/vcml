/** 가입 직후 환영 안내 팝업 */
;(function () {
  const STORAGE_KEY = 'tc_welcome'

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  function ensureStyles() {
    if (document.querySelector('link[href="/css/welcome-popup.css"]')) return
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = '/css/welcome-popup.css'
    document.head.appendChild(link)
  }

  function closePopup() {
    document.getElementById('welcome-popup-overlay')?.remove()
    document.body.style.overflow = ''
    sessionStorage.removeItem(STORAGE_KEY)
  }

  function showWelcomePopup() {
    if (!window.API?.isLoggedIn?.()) return
    if (sessionStorage.getItem(STORAGE_KEY) !== '1') return
    if (document.getElementById('welcome-popup-overlay')) return

    ensureStyles()
    const user = API.user()
    const name = esc(user?.name || '회원')

    const overlay = document.createElement('div')
    overlay.id = 'welcome-popup-overlay'
    overlay.className = 'welcome-popup-overlay'
    overlay.innerHTML = `
      <div class="welcome-popup" role="dialog" aria-labelledby="welcome-popup-title">
        <button type="button" class="welcome-popup-close" aria-label="닫기" onclick="WelcomePopup.close()">&times;</button>
        <h2 id="welcome-popup-title">${name}님, 가입해 주셔서 감사합니다!</h2>
        <p class="welcome-popup-body">
          타닥클래스에 오신 것을 환영합니다. 원하는 강의를 둘러보고 바로 수강을 시작해 보세요.
          공지·일정은 <a href="/notices.html">공지사항</a>에서 확인할 수 있습니다.
        </p>
        <div class="welcome-popup-actions">
          <a href="/#all" class="welcome-popup-btn primary">강의 보러 가기</a>
          <button type="button" class="welcome-popup-btn secondary" onclick="WelcomePopup.close()">닫기</button>
        </div>
      </div>`
    overlay.addEventListener('click', e => { if (e.target === overlay) closePopup() })
    document.body.appendChild(overlay)
    document.body.style.overflow = 'hidden'
    overlay.querySelector('.welcome-popup-close')?.focus()
  }

  function markPending() {
    sessionStorage.setItem(STORAGE_KEY, '1')
  }

  function boot() {
    if (sessionStorage.getItem(STORAGE_KEY) === '1' && API.isLoggedIn()) {
      setTimeout(showWelcomePopup, 300)
    }
  }

  window.WelcomePopup = { close: closePopup, markPending, show: showWelcomePopup }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
