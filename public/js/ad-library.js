;(function () {
  const PAGE_PATH = '/ad-library.html'

  function setGate(message, sub) {
    const gate = document.getElementById('ad-library-gate')
    if (!gate) return
    const title = gate.querySelector('.ad-library-gate__title')
    const hint = gate.querySelector('.ad-library-gate__sub')
    if (title && message) title.textContent = message
    if (hint && sub) hint.textContent = sub
  }

  function unlockPage() {
    document.body.classList.remove('ad-library-page--locked')
    const main = document.getElementById('ad-library-main')
    if (main) main.hidden = false
  }

  function setStatus(text, isError) {
    const el = document.getElementById('ad-library-status')
    if (!el) return
    el.textContent = text
    el.classList.toggle('is-error', !!isError)
  }

  async function verifyApiAccess() {
    try {
      await API.get('/admin/ad-library/ping')
      setStatus('관리자 API 연결됨')
    } catch {
      setStatus('API 연결 실패', true)
    }
  }

  async function boot() {
    setGate('관리자 권한 확인 중', '잠시만 기다려 주세요.')
    const allowed = await AdminAuth.guardAdminAccess({ next: PAGE_PATH })
    if (!allowed) return

    unlockPage()
    await verifyApiAccess()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { boot().catch(() => {}) })
  } else {
    boot().catch(() => {})
  }
})()
